import { describe, it, expect, beforeEach } from "vitest";
import { EventLogger } from "../src/events/event-logger.js";

describe("EventLogger", () => {
  let logger: EventLogger;

  beforeEach(() => {
    logger = new EventLogger(100);
  });

  it("records an event and assigns an id and timestamp", () => {
    const event = logger.record({
      deviceId: "cam-1",
      deviceName: "Front Door",
      locationId: "loc-1",
      locationName: "Home",
      type: "motion",
      metadata: {},
    });

    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
    expect(event.deviceId).toBe("cam-1");
    expect(event.type).toBe("motion");
    expect(logger.size).toBe(1);
  });

  it("preserves a provided id and timestamp", () => {
    const event = logger.record({
      id: "custom-id",
      timestamp: "2025-01-15T12:00:00Z",
      deviceId: "cam-1",
      deviceName: "Front Door",
      locationId: "loc-1",
      locationName: "Home",
      type: "doorbell_press",
      metadata: {},
    });

    expect(event.id).toBe("custom-id");
    expect(event.timestamp).toBe("2025-01-15T12:00:00Z");
  });

  it("enforces max size by trimming oldest events", () => {
    const small = new EventLogger(3);

    for (let i = 0; i < 5; i++) {
      small.record({
        deviceId: `dev-${i}`,
        deviceName: `Device ${i}`,
        locationId: "loc-1",
        locationName: "Home",
        type: "motion",
        metadata: { index: i },
      });
    }

    expect(small.size).toBe(3);
    const events = small.query();
    // Should contain the last 3 events (indices 2, 3, 4)
    const indices = events.map((e) => e.metadata.index);
    expect(indices).toContain(2);
    expect(indices).toContain(3);
    expect(indices).toContain(4);
    expect(indices).not.toContain(0);
    expect(indices).not.toContain(1);
  });

  describe("query", () => {
    beforeEach(() => {
      logger.record({
        id: "e1",
        timestamp: "2025-01-15T10:00:00Z",
        deviceId: "cam-1",
        deviceName: "Front Door",
        locationId: "loc-1",
        locationName: "Home",
        type: "motion",
        metadata: {},
      });
      logger.record({
        id: "e2",
        timestamp: "2025-01-15T11:00:00Z",
        deviceId: "cam-2",
        deviceName: "Back Yard",
        locationId: "loc-1",
        locationName: "Home",
        type: "doorbell_press",
        metadata: {},
      });
      logger.record({
        id: "e3",
        timestamp: "2025-01-15T12:00:00Z",
        deviceId: "cam-1",
        deviceName: "Front Door",
        locationId: "loc-2",
        locationName: "Office",
        type: "motion",
        metadata: {},
      });
    });

    it("returns all events sorted newest first when no filters applied", () => {
      const events = logger.query();
      expect(events).toHaveLength(3);
      expect(events[0].id).toBe("e3");
      expect(events[2].id).toBe("e1");
    });

    it("filters by deviceId", () => {
      const events = logger.query({ deviceId: "cam-1" });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.deviceId === "cam-1")).toBe(true);
    });

    it("filters by locationId", () => {
      const events = logger.query({ locationId: "loc-2" });
      expect(events).toHaveLength(1);
      expect(events[0].locationName).toBe("Office");
    });

    it("filters by type", () => {
      const events = logger.query({ type: "doorbell_press" });
      expect(events).toHaveLength(1);
      expect(events[0].deviceName).toBe("Back Yard");
    });

    it("filters by time range", () => {
      const events = logger.query({
        startTime: "2025-01-15T10:30:00Z",
        endTime: "2025-01-15T11:30:00Z",
      });
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe("e2");
    });

    it("limits results", () => {
      const events = logger.query({ limit: 2 });
      expect(events).toHaveLength(2);
    });
  });

  describe("summary", () => {
    it("returns counts grouped by type", () => {
      logger.record({ deviceId: "a", deviceName: "A", locationId: "l", locationName: "L", type: "motion", metadata: {} });
      logger.record({ deviceId: "a", deviceName: "A", locationId: "l", locationName: "L", type: "motion", metadata: {} });
      logger.record({ deviceId: "b", deviceName: "B", locationId: "l", locationName: "L", type: "doorbell_press", metadata: {} });

      const s = logger.summary();
      expect(s.motion).toBe(2);
      expect(s.doorbell_press).toBe(1);
    });
  });

  it("clears all events", () => {
    logger.record({ deviceId: "a", deviceName: "A", locationId: "l", locationName: "L", type: "motion", metadata: {} });
    expect(logger.size).toBe(1);
    logger.clear();
    expect(logger.size).toBe(0);
  });
});
