import { describe, it, expect, beforeEach } from "vitest";
import { EventStore } from "../src/storage/event-store.js";
import { createTestDatabase } from "./helpers/test-db.js";
import type { RingDatabase } from "../src/storage/database.js";
import type { RingEvent } from "../src/types/index.js";

function makeEvent(overrides: Partial<RingEvent> = {}): RingEvent {
  return {
    id: overrides.id ?? `evt-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: overrides.timestamp ?? "2025-01-15T12:00:00Z",
    deviceId: overrides.deviceId ?? "cam-1",
    deviceName: overrides.deviceName ?? "Front Door",
    locationId: overrides.locationId ?? "loc-1",
    locationName: overrides.locationName ?? "Home",
    type: overrides.type ?? "motion",
    durationSec: overrides.durationSec,
    recordingUrl: overrides.recordingUrl,
    snapshotBase64: overrides.snapshotBase64,
    metadata: overrides.metadata ?? {},
  };
}

describe("EventStore", () => {
  let db: RingDatabase;
  let store: EventStore;

  beforeEach(() => {
    db = createTestDatabase();
    store = new EventStore(db.getConnection(), 100);
  });

  it("inserts and retrieves an event", () => {
    const event = makeEvent({ id: "e1" });
    store.insert(event);

    expect(store.size).toBe(1);
    const results = store.query();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("e1");
    expect(results[0].deviceId).toBe("cam-1");
  });

  it("round-trips JSON metadata correctly", () => {
    const event = makeEvent({
      id: "e1",
      metadata: { previousValue: false, currentValue: true, nested: { deep: "value" } },
    });
    store.insert(event);

    const results = store.query();
    expect(results[0].metadata).toEqual({
      previousValue: false,
      currentValue: true,
      nested: { deep: "value" },
    });
  });

  it("preserves optional fields (durationSec, recordingUrl, snapshotBase64)", () => {
    const event = makeEvent({
      id: "e1",
      durationSec: 15.5,
      recordingUrl: "https://ring.com/rec.mp4",
      snapshotBase64: "base64data==",
    });
    store.insert(event);

    const results = store.query();
    expect(results[0].durationSec).toBe(15.5);
    expect(results[0].recordingUrl).toBe("https://ring.com/rec.mp4");
    expect(results[0].snapshotBase64).toBe("base64data==");
  });

  it("returns undefined for null optional fields", () => {
    const event = makeEvent({ id: "e1" });
    store.insert(event);

    const results = store.query();
    expect(results[0].durationSec).toBeUndefined();
    expect(results[0].recordingUrl).toBeUndefined();
    expect(results[0].snapshotBase64).toBeUndefined();
  });

  it("trims oldest events when exceeding maxSize", () => {
    const smallStore = new EventStore(db.getConnection(), 3);

    for (let i = 0; i < 5; i++) {
      smallStore.insert(
        makeEvent({ id: `e${i}`, timestamp: `2025-01-15T10:0${i}:00Z` })
      );
    }

    expect(smallStore.size).toBe(3);
    const events = smallStore.query();
    const ids = events.map((e) => e.id);
    expect(ids).toContain("e2");
    expect(ids).toContain("e3");
    expect(ids).toContain("e4");
    expect(ids).not.toContain("e0");
    expect(ids).not.toContain("e1");
  });

  describe("query filters", () => {
    beforeEach(() => {
      store.insert(makeEvent({ id: "e1", timestamp: "2025-01-15T10:00:00Z", deviceId: "cam-1", locationId: "loc-1", type: "motion" }));
      store.insert(makeEvent({ id: "e2", timestamp: "2025-01-15T11:00:00Z", deviceId: "cam-2", locationId: "loc-1", type: "doorbell_press" }));
      store.insert(makeEvent({ id: "e3", timestamp: "2025-01-15T12:00:00Z", deviceId: "cam-1", locationId: "loc-2", type: "motion" }));
    });

    it("filters by deviceId", () => {
      const results = store.query({ deviceId: "cam-1" });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.deviceId === "cam-1")).toBe(true);
    });

    it("filters by locationId", () => {
      const results = store.query({ locationId: "loc-2" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("e3");
    });

    it("filters by type", () => {
      const results = store.query({ type: "doorbell_press" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("e2");
    });

    it("filters by time range", () => {
      const results = store.query({
        startTime: "2025-01-15T10:30:00Z",
        endTime: "2025-01-15T11:30:00Z",
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("e2");
    });

    it("limits results", () => {
      const results = store.query({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("orders results newest-first", () => {
      const results = store.query();
      expect(results[0].id).toBe("e3");
      expect(results[2].id).toBe("e1");
    });

    it("combines multiple filters", () => {
      const results = store.query({ deviceId: "cam-1", type: "motion" });
      expect(results).toHaveLength(2);
    });
  });

  describe("summary", () => {
    it("groups counts by event type", () => {
      store.insert(makeEvent({ id: "e1", type: "motion" }));
      store.insert(makeEvent({ id: "e2", type: "motion" }));
      store.insert(makeEvent({ id: "e3", type: "doorbell_press" }));

      const s = store.summary();
      expect(s.motion).toBe(2);
      expect(s.doorbell_press).toBe(1);
    });

    it("applies filters to summary", () => {
      store.insert(makeEvent({ id: "e1", type: "motion", deviceId: "cam-1" }));
      store.insert(makeEvent({ id: "e2", type: "motion", deviceId: "cam-2" }));
      store.insert(makeEvent({ id: "e3", type: "doorbell_press", deviceId: "cam-1" }));

      const s = store.summary({ deviceId: "cam-1" });
      expect(s.motion).toBe(1);
      expect(s.doorbell_press).toBe(1);
    });
  });

  it("clear removes all events", () => {
    store.insert(makeEvent({ id: "e1" }));
    store.insert(makeEvent({ id: "e2" }));
    expect(store.size).toBe(2);

    store.clear();
    expect(store.size).toBe(0);
    expect(store.query()).toHaveLength(0);
  });
});
