/**
 * Real-time event monitor — subscribes to live Ring events and feeds
 * them into the EventLogger.
 */

import type { RingCamera, Location, PushNotificationDingV2 } from "ring-client-api";
import { PushNotificationAction } from "ring-client-api";
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
   * Start listening to all cameras and locations for live events.
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

  // ── Internal Monitors ──

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
