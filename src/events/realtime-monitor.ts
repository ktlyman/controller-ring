/**
 * Real-time event monitor — subscribes to live Ring events and feeds
 * them into the EventLogger.
 *
 * Monitors cameras (motion, doorbell, notifications), location
 * connection status, and alarm device state changes (contact sensors,
 * motion sensors, tamper, alarm mode, sirens, flood/freeze, smoke/CO).
 */

import type { RingCamera, RingDevice, Location, PushNotificationDingV2, RingDeviceData } from "ring-client-api";
import { PushNotificationAction, RingDeviceType } from "ring-client-api";
import { pairwise } from "rxjs";
import type { Subscription } from "rxjs";
import type { RingClient } from "../client/ring-client.js";
import type { EventLogger } from "./event-logger.js";
import type { EventSubscription, RingEvent, RingEventType } from "../types/index.js";
import { randomUUID } from "node:crypto";

export class RealtimeMonitor {
  private subscriptions: Subscription[] = [];
  private userSubscriptions: Map<string, EventSubscription> = new Map();
  private running = false;

  constructor(
    private client: RingClient,
    private logger: EventLogger
  ) {}

  /**
   * Start listening to all cameras, locations, and alarm devices for live events.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const locations = await this.client.getLocations();

    for (const location of locations) {
      this.monitorLocation(location);

      for (const camera of location.cameras ?? []) {
        this.monitorCamera(camera, location);
      }

      // Monitor alarm/sensor devices if the location has hubs
      if (location.hasHubs) {
        try {
          const devices = await location.getDevices();
          for (const device of devices) {
            this.monitorDevice(device, location);
          }
        } catch {
          // Location may not have accessible devices
        }
      }
    }
  }

  /**
   * Stop all real-time subscriptions.
   */
  stop(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
    this.running = false;
  }

  /**
   * Register a user-level subscription to receive matching events.
   * Returns the subscription ID.
   */
  subscribe(sub: Omit<EventSubscription, "id">): string {
    const id = randomUUID();
    this.userSubscriptions.set(id, { ...sub, id });
    return id;
  }

  /**
   * Unsubscribe a previously registered subscription.
   */
  unsubscribe(subscriptionId: string): boolean {
    return this.userSubscriptions.delete(subscriptionId);
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ── Camera Monitors ──

  private monitorCamera(camera: RingCamera, location: Location): void {
    // Motion detection
    const motionSub = camera.onMotionDetected.subscribe((motionDetected) => {
      if (motionDetected) {
        this.emit({
          deviceId: String(camera.id),
          deviceName: camera.name,
          locationId: location.id,
          locationName: location.name,
          type: "motion",
          metadata: { cameraKind: camera.isDoorbot ? "doorbell" : "camera" },
        });
      }
    });
    this.subscriptions.push(motionSub);

    // Doorbell press
    if (camera.isDoorbot) {
      const doorbellSub = camera.onDoorbellPressed.subscribe(
        (notification: PushNotificationDingV2) => {
          this.emit({
            deviceId: String(camera.id),
            deviceName: camera.name,
            locationId: location.id,
            locationName: location.name,
            type: "doorbell_press",
            metadata: { dingId: notification?.data?.event?.ding?.id },
          });
        }
      );
      this.subscriptions.push(doorbellSub);
    }

    // New notifications (covers dings, motion, and video-on-demand)
    const notifSub = camera.onNewNotification.subscribe(
      (notification: PushNotificationDingV2) => {
        const category = notification.android_config?.category;
        const type = this.mapNotificationType(category);
        if (type) {
          this.emit({
            deviceId: String(camera.id),
            deviceName: camera.name,
            locationId: location.id,
            locationName: location.name,
            type,
            metadata: {
              category,
              dingId: notification.data?.event?.ding?.id,
              subtype: notification.data?.event?.ding?.subtype,
            },
          });
        }
      }
    );
    this.subscriptions.push(notifSub);
  }

  // ── Location Monitors ──

  private monitorLocation(location: Location): void {
    // Connection status changes
    const connSub = location.onConnected.subscribe((connected) => {
      this.emit({
        deviceId: location.id,
        deviceName: location.name,
        locationId: location.id,
        locationName: location.name,
        type: "connection_change",
        metadata: { connected },
      });
    });
    this.subscriptions.push(connSub);
  }

  // ── Alarm Device Monitors ──

  /**
   * Subscribe to a device's onData stream using pairwise() to detect
   * state transitions. The first emission from the BehaviorSubject is
   * the initial state — pairwise() skips it, so we only react to
   * actual changes.
   */
  private monitorDevice(device: RingDevice, location: Location): void {
    const sub = device.onData
      .pipe(pairwise())
      .subscribe(([prev, curr]) => {
        this.detectStateChanges(prev, curr, device, location);
      });
    this.subscriptions.push(sub);
  }

  /**
   * Compare previous and current device data to detect meaningful
   * state transitions and emit events for each one.
   */
  private detectStateChanges(
    prev: RingDeviceData,
    curr: RingDeviceData,
    device: RingDevice,
    location: Location
  ): void {
    const base = {
      deviceId: device.zid,
      deviceName: device.name,
      locationId: location.id,
      locationName: location.name,
    };
    const deviceType = curr.deviceType as string;
    const batteryLevel = curr.batteryLevel;

    // Contact sensor open/close (faulted field)
    if (prev.faulted !== curr.faulted && curr.faulted !== undefined) {
      const isContact =
        deviceType === RingDeviceType.ContactSensor ||
        deviceType === (RingDeviceType as Record<string, string>).RetrofitZone;

      if (isContact) {
        this.emit({
          ...base,
          type: curr.faulted ? "contact_open" : "contact_close",
          metadata: {
            deviceType,
            previousValue: prev.faulted,
            currentValue: curr.faulted,
            batteryLevel,
          },
        });
      }
    }

    // Motion sensor trigger/clear
    if (prev.motionStatus !== curr.motionStatus && curr.motionStatus !== undefined) {
      this.emit({
        ...base,
        type: curr.motionStatus === "faulted" ? "sensor_motion" : "sensor_motion_clear",
        metadata: {
          deviceType,
          previousValue: prev.motionStatus,
          currentValue: curr.motionStatus,
          batteryLevel,
        },
      });
    }

    // Tamper detection
    if (prev.tamperStatus !== curr.tamperStatus && curr.tamperStatus !== undefined) {
      this.emit({
        ...base,
        type: curr.tamperStatus === "tamper" ? "tamper" : "tamper_clear",
        metadata: {
          deviceType,
          previousValue: prev.tamperStatus,
          currentValue: curr.tamperStatus,
          batteryLevel,
        },
      });
    }

    // Alarm mode change (security panel)
    const prevMode = prev.mode as string | undefined;
    const currMode = curr.mode as string | undefined;
    if (prevMode !== currMode && currMode !== undefined) {
      this.emit({
        ...base,
        type: "alarm_mode_change",
        metadata: {
          deviceType,
          previousMode: prevMode,
          currentMode: currMode,
        },
      });
    }

    // Alarm triggered
    const prevAlarmState = prev.alarmInfo?.state;
    const currAlarmState = curr.alarmInfo?.state;
    if (prevAlarmState !== currAlarmState && currAlarmState !== undefined) {
      this.emit({
        ...base,
        type: "alarm_triggered",
        metadata: {
          deviceType,
          alarmState: currAlarmState,
          previousAlarmState: prevAlarmState,
          faultedDevices: curr.alarmInfo?.faultedDevices,
        },
      });
    }

    // Siren state
    const prevSiren = prev.siren?.state;
    const currSiren = curr.siren?.state;
    if (prevSiren !== currSiren && currSiren !== undefined) {
      this.emit({
        ...base,
        type: currSiren === "on" ? "siren_on" : "siren_off",
        metadata: {
          deviceType,
          previousValue: prevSiren,
          currentValue: currSiren,
        },
      });
    }

    // Flood sensor
    const prevFlood = prev.flood?.faulted;
    const currFlood = curr.flood?.faulted;
    if (prevFlood !== currFlood && currFlood === true) {
      this.emit({
        ...base,
        type: "flood",
        metadata: { deviceType, batteryLevel },
      });
    }

    // Freeze sensor
    const prevFreeze = prev.freeze?.faulted;
    const currFreeze = curr.freeze?.faulted;
    if (prevFreeze !== currFreeze && currFreeze === true) {
      this.emit({
        ...base,
        type: "freeze",
        metadata: { deviceType, batteryLevel },
      });
    }

    // Smoke alarm
    const prevSmoke = prev.smoke?.alarmStatus;
    const currSmoke = curr.smoke?.alarmStatus;
    if (prevSmoke !== currSmoke && currSmoke === "active") {
      this.emit({
        ...base,
        type: "smoke_alarm",
        metadata: { deviceType },
      });
    }

    // CO alarm
    const prevCO = prev.co?.alarmStatus;
    const currCO = curr.co?.alarmStatus;
    if (prevCO !== currCO && currCO === "active") {
      this.emit({
        ...base,
        type: "co_alarm",
        metadata: { deviceType },
      });
    }
  }

  // ── Event Dispatch ──

  private emit(
    partial: Omit<RingEvent, "id" | "timestamp" | "metadata"> & {
      metadata?: Record<string, unknown>;
    }
  ): void {
    const event = this.logger.record({
      ...partial,
      metadata: partial.metadata ?? {},
    });

    // Dispatch to user subscriptions
    for (const sub of this.userSubscriptions.values()) {
      if (this.matchesFilter(event, sub)) {
        try {
          sub.callback(event);
        } catch {
          // Don't let a user callback crash the monitor
        }
      }
    }
  }

  private matchesFilter(event: RingEvent, sub: EventSubscription): boolean {
    const f = sub.filter;
    if (!f) return true;
    if (f.deviceId && event.deviceId !== f.deviceId) return false;
    if (f.locationId && event.locationId !== f.locationId) return false;
    if (f.types && f.types.length > 0 && !f.types.includes(event.type)) return false;
    return true;
  }

  private mapNotificationType(category: string | undefined): RingEventType | null {
    if (!category) return null;
    switch (category) {
      case PushNotificationAction.Ding:
        return "doorbell_press";
      case PushNotificationAction.Motion:
        return "motion";
      default:
        return null;
    }
  }
}
