import { describe, it, expect, beforeEach } from "vitest";
import { DeviceHistoryStore } from "../src/storage/device-history-store.js";
import { createTestDeviceHistoryStore } from "./helpers/test-db.js";
import type { RingDatabase } from "../src/storage/database.js";

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    device_id: "sensor-1",
    device_name: "Front Door Sensor",
    type: "contact.open",
    created_at: "2025-06-15T10:00:00Z",
    zid: 42,
    ...overrides,
  };
}

describe("DeviceHistoryStore", () => {
  let db: RingDatabase;
  let store: DeviceHistoryStore;

  beforeEach(() => {
    const result = createTestDeviceHistoryStore();
    db = result.db;
    store = result.store;
  });

  it("inserts and queries events", () => {
    const events = [
      makeEvent({ created_at: "2025-06-15T10:00:00Z" }),
      makeEvent({ created_at: "2025-06-15T11:00:00Z", type: "contact.close" }),
    ];

    const inserted = store.insert("loc-1", events);
    expect(inserted).toBe(2);
    expect(store.size).toBe(2);

    const results = store.query({ locationId: "loc-1" });
    expect(results).toHaveLength(2);
    // Ordered by created_at DESC
    expect(results[0].eventType).toBe("contact.close");
    expect(results[1].eventType).toBe("contact.open");
  });

  it("deduplicates events with identical body", () => {
    const event = makeEvent();
    store.insert("loc-1", [event]);
    store.insert("loc-1", [event]);

    expect(store.size).toBe(1);
  });

  it("stores events with different bodies separately", () => {
    store.insert("loc-1", [
      makeEvent({ created_at: "2025-06-15T10:00:00Z" }),
      makeEvent({ created_at: "2025-06-15T11:00:00Z" }),
    ]);

    expect(store.size).toBe(2);
  });

  it("extracts device_id from event body", () => {
    store.insert("loc-1", [makeEvent({ device_id: "sensor-42" })]);

    const results = store.query({ deviceId: "sensor-42" });
    expect(results).toHaveLength(1);
    expect(results[0].deviceId).toBe("sensor-42");
  });

  it("extracts device_id from zid field when device_id missing", () => {
    store.insert("loc-1", [makeEvent({ device_id: undefined, zid: 99 })]);

    const results = store.query();
    expect(results).toHaveLength(1);
    expect(results[0].deviceId).toBe("99");
  });

  it("extracts event_type from type field", () => {
    store.insert("loc-1", [makeEvent({ type: "alarm.mode_change" })]);

    const results = store.query({ eventType: "alarm.mode_change" });
    expect(results).toHaveLength(1);
  });

  it("extracts event_type from action field when type missing", () => {
    store.insert("loc-1", [makeEvent({ type: undefined, action: "disarm" })]);

    const results = store.query({ eventType: "disarm" });
    expect(results).toHaveLength(1);
  });

  it("extracts created_at from datestamp field", () => {
    store.insert("loc-1", [
      makeEvent({ created_at: undefined, datestamp: "2025-06-15T12:00:00Z" }),
    ]);

    const results = store.query();
    expect(results[0].createdAt).toBe("2025-06-15T12:00:00Z");
  });

  it("extracts created_at from timestamp field (unix seconds)", () => {
    const ts = Math.floor(new Date("2025-06-15T12:00:00Z").getTime() / 1000);
    store.insert("loc-1", [makeEvent({ created_at: undefined, datestamp: undefined, timestamp: ts })]);

    const results = store.query();
    expect(results[0].createdAt).toBe("2025-06-15T12:00:00.000Z");
  });

  it("queries with time range filter", () => {
    store.insert("loc-1", [
      makeEvent({ created_at: "2025-06-15T08:00:00Z" }),
      makeEvent({ created_at: "2025-06-15T12:00:00Z", type: "motion" }),
      makeEvent({ created_at: "2025-06-15T18:00:00Z", type: "tamper" }),
    ]);

    const results = store.query({
      startTime: "2025-06-15T10:00:00Z",
      endTime: "2025-06-15T14:00:00Z",
    });
    expect(results).toHaveLength(1);
    expect(results[0].eventType).toBe("motion");
  });

  it("queries with limit", () => {
    store.insert("loc-1", [
      makeEvent({ created_at: "2025-06-15T08:00:00Z", type: "a" }),
      makeEvent({ created_at: "2025-06-15T09:00:00Z", type: "b" }),
      makeEvent({ created_at: "2025-06-15T10:00:00Z", type: "c" }),
    ]);

    const results = store.query({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("getNewestTimestamp returns the newest event time for a location", () => {
    store.insert("loc-1", [
      makeEvent({ created_at: "2025-06-15T08:00:00Z" }),
      makeEvent({ created_at: "2025-06-15T18:00:00Z", type: "latest" }),
      makeEvent({ created_at: "2025-06-15T12:00:00Z", type: "mid" }),
    ]);

    expect(store.getNewestTimestamp("loc-1")).toBe("2025-06-15T18:00:00Z");
  });

  it("getNewestTimestamp returns null for empty location", () => {
    expect(store.getNewestTimestamp("nonexistent")).toBeNull();
  });

  it("preserves full JSON body in round-trip", () => {
    const event = makeEvent({
      custom_field: "value",
      nested: { deep: true },
      array: [1, 2, 3],
    });

    store.insert("loc-1", [event]);

    const results = store.query();
    expect(results[0].body).toEqual(event);
  });

  it("handles events with minimal fields", () => {
    store.insert("loc-1", [{ some_unknown_field: "data" }]);

    const results = store.query();
    expect(results).toHaveLength(1);
    expect(results[0].deviceId).toBeNull();
    expect(results[0].deviceName).toBeNull();
    expect(results[0].eventType).toBeNull();
    expect(results[0].createdAt).toBeNull();
    expect(results[0].body).toEqual({ some_unknown_field: "data" });
  });

  it("clear removes all events", () => {
    store.insert("loc-1", [makeEvent(), makeEvent({ type: "b" })]);
    expect(store.size).toBe(2);

    store.clear();
    expect(store.size).toBe(0);
  });

  it("filters by multiple criteria simultaneously", () => {
    store.insert("loc-1", [
      makeEvent({ device_id: "s1", type: "contact.open", created_at: "2025-06-15T10:00:00Z" }),
      makeEvent({ device_id: "s1", type: "contact.close", created_at: "2025-06-15T11:00:00Z" }),
      makeEvent({ device_id: "s2", type: "contact.open", created_at: "2025-06-15T12:00:00Z" }),
    ]);

    const results = store.query({
      locationId: "loc-1",
      deviceId: "s1",
      eventType: "contact.open",
    });
    expect(results).toHaveLength(1);
    expect(results[0].createdAt).toBe("2025-06-15T10:00:00Z");
  });
});
