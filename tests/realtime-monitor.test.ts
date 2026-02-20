import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BehaviorSubject, Subject } from "rxjs";
import { RealtimeMonitor } from "../src/events/realtime-monitor.js";
import { EventLogger } from "../src/events/event-logger.js";
import { createTestEventStore } from "./helpers/test-db.js";
import type { RingClient } from "../src/client/ring-client.js";
import type { RingDeviceData } from "ring-client-api";
import { RingDeviceType } from "ring-client-api";

// ── Mock Factories ──

function makeBaseDeviceData(overrides: Partial<RingDeviceData> = {}): RingDeviceData {
  return {
    zid: "device-1",
    name: "Test Device",
    deviceType: RingDeviceType.ContactSensor,
    categoryId: 5,
    batteryLevel: 95,
    batteryStatus: "ok",
    tamperStatus: "ok",
    tags: [],
    ...overrides,
  } as RingDeviceData;
}

function makeMockDevice(initialData: RingDeviceData) {
  const onData = new BehaviorSubject<RingDeviceData>(initialData);
  return {
    zid: initialData.zid,
    name: initialData.name,
    deviceType: initialData.deviceType,
    onData,
    get data() {
      return onData.getValue();
    },
    /** Simulate a state update from the Ring WebSocket */
    pushUpdate(update: Partial<RingDeviceData>) {
      onData.next({ ...onData.getValue(), ...update });
    },
  };
}

function makeMockLocation(overrides: {
  id: string;
  name: string;
  hasHubs?: boolean;
  cameras?: unknown[];
  devices?: ReturnType<typeof makeMockDevice>[];
}) {
  const onConnected = new Subject<boolean>();
  return {
    id: overrides.id,
    name: overrides.name,
    hasHubs: overrides.hasHubs ?? true,
    cameras: overrides.cameras ?? [],
    onConnected,
    getDevices: vi.fn().mockResolvedValue(overrides.devices ?? []),
  };
}

describe("RealtimeMonitor — alarm device monitoring", () => {
  let logger: EventLogger;
  let mockClient: { getLocations: ReturnType<typeof vi.fn> };
  let monitor: RealtimeMonitor;

  beforeEach(() => {
    logger = new EventLogger(createTestEventStore(100));
    mockClient = {
      getLocations: vi.fn(),
    };
    monitor = new RealtimeMonitor(
      mockClient as unknown as RingClient,
      logger
    );
  });

  afterEach(() => {
    monitor.stop();
  });

  // Helper to start monitor with given devices at a location
  async function startWithDevices(devices: ReturnType<typeof makeMockDevice>[]) {
    const location = makeMockLocation({
      id: "loc-1",
      name: "Home",
      hasHubs: true,
      devices,
    });
    mockClient.getLocations.mockResolvedValue([location]);
    await monitor.start();
    return location;
  }

  // ── Contact Sensor ──

  describe("contact sensor", () => {
    it("emits contact_open when faulted changes from false to true", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "contact-1",
          name: "Front Door",
          deviceType: RingDeviceType.ContactSensor,
          faulted: false,
        })
      );

      await startWithDevices([device]);
      device.pushUpdate({ faulted: true });

      const events = logger.query({ type: "contact_open" });
      expect(events).toHaveLength(1);
      expect(events[0].deviceId).toBe("contact-1");
      expect(events[0].deviceName).toBe("Front Door");
      expect(events[0].metadata.previousValue).toBe(false);
      expect(events[0].metadata.currentValue).toBe(true);
    });

    it("emits contact_close when faulted changes from true to false", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "contact-1",
          name: "Front Door",
          deviceType: RingDeviceType.ContactSensor,
          faulted: true,
        })
      );

      await startWithDevices([device]);
      device.pushUpdate({ faulted: false });

      const events = logger.query({ type: "contact_close" });
      expect(events).toHaveLength(1);
      expect(events[0].metadata.previousValue).toBe(true);
      expect(events[0].metadata.currentValue).toBe(false);
    });
  });

  // ── Motion Sensor ──

  describe("motion sensor", () => {
    it("emits sensor_motion when motionStatus changes to faulted", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "motion-1",
          name: "Hallway Motion",
          deviceType: RingDeviceType.MotionSensor,
          motionStatus: "clear",
        })
      );

      await startWithDevices([device]);
      device.pushUpdate({ motionStatus: "faulted" });

      const events = logger.query({ type: "sensor_motion" });
      expect(events).toHaveLength(1);
      expect(events[0].deviceName).toBe("Hallway Motion");
      expect(events[0].metadata.currentValue).toBe("faulted");
    });

    it("emits sensor_motion_clear when motionStatus changes to clear", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "motion-1",
          name: "Hallway Motion",
          deviceType: RingDeviceType.MotionSensor,
          motionStatus: "faulted",
        })
      );

      await startWithDevices([device]);
      device.pushUpdate({ motionStatus: "clear" });

      const events = logger.query({ type: "sensor_motion_clear" });
      expect(events).toHaveLength(1);
    });
  });

  // ── Tamper ──

  describe("tamper", () => {
    it("emits tamper when tamperStatus changes to tamper", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "sensor-1",
          name: "Window Sensor",
          tamperStatus: "ok",
        })
      );

      await startWithDevices([device]);
      device.pushUpdate({ tamperStatus: "tamper" });

      const events = logger.query({ type: "tamper" });
      expect(events).toHaveLength(1);
      expect(events[0].deviceName).toBe("Window Sensor");
    });

    it("emits tamper_clear when tamperStatus returns to ok", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "sensor-1",
          name: "Window Sensor",
          tamperStatus: "tamper",
        })
      );

      await startWithDevices([device]);
      device.pushUpdate({ tamperStatus: "ok" });

      const events = logger.query({ type: "tamper_clear" });
      expect(events).toHaveLength(1);
    });
  });

  // ── Alarm Mode ──

  describe("alarm mode", () => {
    it("emits alarm_mode_change when mode changes", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "panel-1",
          name: "Security Panel",
          deviceType: RingDeviceType.SecurityPanel,
          mode: "none" as RingDeviceData["mode"],
        })
      );

      await startWithDevices([device]);
      device.pushUpdate({ mode: "all" as RingDeviceData["mode"] });

      const events = logger.query({ type: "alarm_mode_change" });
      expect(events).toHaveLength(1);
      expect(events[0].metadata.previousMode).toBe("none");
      expect(events[0].metadata.currentMode).toBe("all");
    });
  });

  // ── Alarm Triggered ──

  describe("alarm triggered", () => {
    it("emits alarm_triggered when alarmInfo.state appears", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "panel-1",
          name: "Security Panel",
          deviceType: RingDeviceType.SecurityPanel,
        })
      );

      await startWithDevices([device]);
      device.pushUpdate({
        alarmInfo: {
          state: "burglar-alarm",
          faultedDevices: ["contact-1"],
        } as RingDeviceData["alarmInfo"],
      });

      const events = logger.query({ type: "alarm_triggered" });
      expect(events).toHaveLength(1);
      expect(events[0].metadata.alarmState).toBe("burglar-alarm");
      expect(events[0].metadata.faultedDevices).toEqual(["contact-1"]);
    });
  });

  // ── Siren ──

  describe("siren", () => {
    it("emits siren_on when siren state changes to on", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "base-1",
          name: "Base Station",
          deviceType: RingDeviceType.BaseStation,
          siren: { state: "off" },
        })
      );

      await startWithDevices([device]);
      device.pushUpdate({ siren: { state: "on" } });

      const events = logger.query({ type: "siren_on" });
      expect(events).toHaveLength(1);
    });

    it("emits siren_off when siren state changes to off", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "base-1",
          name: "Base Station",
          deviceType: RingDeviceType.BaseStation,
          siren: { state: "on" },
        })
      );

      await startWithDevices([device]);
      device.pushUpdate({ siren: { state: "off" } });

      const events = logger.query({ type: "siren_off" });
      expect(events).toHaveLength(1);
    });
  });

  // ── No Spurious Events ──

  describe("event suppression", () => {
    it("does not emit events on initial subscribe (pairwise skips first)", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "contact-1",
          name: "Front Door",
          deviceType: RingDeviceType.ContactSensor,
          faulted: true,
        })
      );

      await startWithDevices([device]);

      // No update pushed — only initial state
      const events = logger.query();
      // Filter out connection_change events from location monitor
      const deviceEvents = events.filter(
        (e) => e.type !== "connection_change"
      );
      expect(deviceEvents).toHaveLength(0);
    });

    it("does not emit when state does not change", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "contact-1",
          name: "Front Door",
          deviceType: RingDeviceType.ContactSensor,
          faulted: false,
          batteryLevel: 95,
        })
      );

      await startWithDevices([device]);
      // Push an update that only changes battery, not faulted
      device.pushUpdate({ batteryLevel: 90 });

      const contactEvents = logger.query({ type: "contact_open" });
      expect(contactEvents).toHaveLength(0);
    });
  });

  // ── Multiple Events ──

  describe("multiple state changes", () => {
    it("tracks sequential open/close cycles", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "contact-1",
          name: "Back Door",
          deviceType: RingDeviceType.ContactSensor,
          faulted: false,
        })
      );

      await startWithDevices([device]);

      device.pushUpdate({ faulted: true });
      device.pushUpdate({ faulted: false });
      device.pushUpdate({ faulted: true });

      const opens = logger.query({ type: "contact_open" });
      const closes = logger.query({ type: "contact_close" });
      expect(opens).toHaveLength(2);
      expect(closes).toHaveLength(1);
    });
  });

  // ── User Subscriptions ──

  describe("user subscriptions", () => {
    it("dispatches device events to user callbacks", async () => {
      const device = makeMockDevice(
        makeBaseDeviceData({
          zid: "contact-1",
          name: "Front Door",
          deviceType: RingDeviceType.ContactSensor,
          faulted: false,
        })
      );

      await startWithDevices([device]);

      const received: string[] = [];
      monitor.subscribe({
        callback: (event) => received.push(event.type),
        filter: { types: ["contact_open", "contact_close"] },
      });

      device.pushUpdate({ faulted: true });
      device.pushUpdate({ faulted: false });

      expect(received).toEqual(["contact_open", "contact_close"]);
    });
  });
});
