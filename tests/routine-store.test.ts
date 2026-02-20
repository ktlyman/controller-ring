import { describe, it, expect, beforeEach } from "vitest";
import { RoutineStore } from "../src/storage/routine-store.js";
import { createTestDatabase } from "./helpers/test-db.js";
import type { RingDatabase } from "../src/storage/database.js";
import type { RoutineLogEntry } from "../src/types/index.js";

function makeEntry(overrides: Partial<RoutineLogEntry> = {}): RoutineLogEntry {
  return {
    id: overrides.id ?? `r-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: overrides.timestamp ?? "2025-01-15T12:00:00Z",
    action: overrides.action ?? "turn_light_on",
    deviceId: overrides.deviceId,
    deviceName: overrides.deviceName,
    locationId: overrides.locationId ?? "loc-1",
    locationName: overrides.locationName ?? "Home",
    parameters: overrides.parameters ?? {},
    result: overrides.result ?? "success",
    error: overrides.error,
  };
}

describe("RoutineStore", () => {
  let db: RingDatabase;
  let store: RoutineStore;

  beforeEach(() => {
    db = createTestDatabase();
    store = new RoutineStore(db.getConnection(), 100);
  });

  it("inserts and retrieves a routine entry", () => {
    const entry = makeEntry({ id: "r1", action: "turn_light_on" });
    store.insert(entry);

    expect(store.size).toBe(1);
    const results = store.query();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("r1");
    expect(results[0].action).toBe("turn_light_on");
  });

  it("round-trips JSON parameters correctly", () => {
    const entry = makeEntry({
      id: "r1",
      parameters: { volume: 0.5, device: "speaker" },
    });
    store.insert(entry);

    const results = store.query();
    expect(results[0].parameters).toEqual({ volume: 0.5, device: "speaker" });
  });

  it("handles optional deviceId and deviceName", () => {
    const entry = makeEntry({ id: "r1", deviceId: undefined, deviceName: undefined });
    store.insert(entry);

    const results = store.query();
    expect(results[0].deviceId).toBeUndefined();
    expect(results[0].deviceName).toBeUndefined();
  });

  it("stores error field for failures", () => {
    const entry = makeEntry({
      id: "r1",
      result: "failure",
      error: "Device offline",
    });
    store.insert(entry);

    const results = store.query();
    expect(results[0].result).toBe("failure");
    expect(results[0].error).toBe("Device offline");
  });

  it("trims oldest entries when exceeding maxSize", () => {
    const smallStore = new RoutineStore(db.getConnection(), 2);

    smallStore.insert(makeEntry({ id: "r0", timestamp: "2025-01-15T10:00:00Z", action: "a" }));
    smallStore.insert(makeEntry({ id: "r1", timestamp: "2025-01-15T11:00:00Z", action: "b" }));
    smallStore.insert(makeEntry({ id: "r2", timestamp: "2025-01-15T12:00:00Z", action: "c" }));

    expect(smallStore.size).toBe(2);
    const entries = smallStore.query();
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("b");
    expect(actions).toContain("c");
    expect(actions).not.toContain("a");
  });

  describe("query filters", () => {
    beforeEach(() => {
      store.insert(makeEntry({ id: "r1", timestamp: "2025-01-15T10:00:00Z", action: "turn_light_on", deviceId: "cam-1", result: "success" }));
      store.insert(makeEntry({ id: "r2", timestamp: "2025-01-15T11:00:00Z", action: "capture_snapshot", deviceId: "cam-2", result: "failure", error: "Offline" }));
      store.insert(makeEntry({ id: "r3", timestamp: "2025-01-15T12:00:00Z", action: "turn_light_on", deviceId: "cam-1", locationId: "loc-2", result: "success" }));
    });

    it("filters by action", () => {
      const results = store.query({ action: "turn_light_on" });
      expect(results).toHaveLength(2);
    });

    it("filters by deviceId", () => {
      const results = store.query({ deviceId: "cam-2" });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("capture_snapshot");
    });

    it("filters by locationId", () => {
      const results = store.query({ locationId: "loc-2" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("r3");
    });

    it("filters by result", () => {
      const results = store.query({ result: "failure" });
      expect(results).toHaveLength(1);
      expect(results[0].error).toBe("Offline");
    });

    it("filters by time range", () => {
      const results = store.query({
        startTime: "2025-01-15T10:30:00Z",
        endTime: "2025-01-15T11:30:00Z",
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("r2");
    });

    it("limits results", () => {
      const results = store.query({ limit: 1 });
      expect(results).toHaveLength(1);
    });

    it("orders results newest-first", () => {
      const results = store.query();
      expect(results[0].id).toBe("r3");
      expect(results[2].id).toBe("r1");
    });
  });

  describe("summary", () => {
    it("groups counts by action with success/failure breakdown", () => {
      store.insert(makeEntry({ id: "r1", action: "turn_light_on", result: "success" }));
      store.insert(makeEntry({ id: "r2", action: "turn_light_on", result: "failure" }));
      store.insert(makeEntry({ id: "r3", action: "capture_snapshot", result: "success" }));

      const s = store.summary();
      expect(s["turn_light_on"]).toEqual({ total: 2, success: 1, failure: 1 });
      expect(s["capture_snapshot"]).toEqual({ total: 1, success: 1, failure: 0 });
    });

    it("counts pending entries in total but not in success or failure", () => {
      store.insert(makeEntry({ id: "r1", action: "test_action", result: "pending" }));

      const s = store.summary();
      expect(s["test_action"]).toEqual({ total: 1, success: 0, failure: 0 });
    });
  });

  it("clear removes all entries", () => {
    store.insert(makeEntry({ id: "r1" }));
    store.insert(makeEntry({ id: "r2" }));
    expect(store.size).toBe(2);

    store.clear();
    expect(store.size).toBe(0);
  });
});
