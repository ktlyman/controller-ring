import { describe, it, expect, beforeEach } from "vitest";
import { RoutineLogger } from "../src/logging/routine-logger.js";
import { createTestRoutineStore } from "./helpers/test-db.js";

describe("RoutineLogger", () => {
  let logger: RoutineLogger;

  beforeEach(() => {
    logger = new RoutineLogger(createTestRoutineStore(100));
  });

  it("logs a routine entry", () => {
    const entry = logger.log({
      action: "turn_light_on",
      deviceId: "cam-1",
      deviceName: "Front Door",
      locationId: "loc-1",
      locationName: "Home",
      parameters: {},
      result: "success",
    });

    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(entry.action).toBe("turn_light_on");
    expect(entry.result).toBe("success");
    expect(logger.size).toBe(1);
  });

  it("enforces max size", () => {
    const small = new RoutineLogger(createTestRoutineStore(2));
    small.log({ action: "a", timestamp: "2025-01-15T10:00:00Z", locationId: "l", locationName: "L", parameters: {}, result: "success" });
    small.log({ action: "b", timestamp: "2025-01-15T11:00:00Z", locationId: "l", locationName: "L", parameters: {}, result: "success" });
    small.log({ action: "c", timestamp: "2025-01-15T12:00:00Z", locationId: "l", locationName: "L", parameters: {}, result: "success" });

    expect(small.size).toBe(2);
    const entries = small.query();
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("b");
    expect(actions).toContain("c");
    expect(actions).not.toContain("a");
  });

  describe("query", () => {
    beforeEach(() => {
      logger.log({
        id: "r1",
        timestamp: "2025-01-15T10:00:00Z",
        action: "turn_light_on",
        deviceId: "cam-1",
        deviceName: "Front Door",
        locationId: "loc-1",
        locationName: "Home",
        parameters: {},
        result: "success",
      });
      logger.log({
        id: "r2",
        timestamp: "2025-01-15T11:00:00Z",
        action: "capture_snapshot",
        deviceId: "cam-2",
        deviceName: "Back Yard",
        locationId: "loc-1",
        locationName: "Home",
        parameters: {},
        result: "failure",
        error: "Camera offline",
      });
      logger.log({
        id: "r3",
        timestamp: "2025-01-15T12:00:00Z",
        action: "turn_light_on",
        deviceId: "cam-1",
        deviceName: "Front Door",
        locationId: "loc-2",
        locationName: "Office",
        parameters: {},
        result: "success",
      });
    });

    it("filters by action", () => {
      const entries = logger.query({ action: "turn_light_on" });
      expect(entries).toHaveLength(2);
    });

    it("filters by result", () => {
      const entries = logger.query({ result: "failure" });
      expect(entries).toHaveLength(1);
      expect(entries[0].error).toBe("Camera offline");
    });

    it("filters by deviceId", () => {
      const entries = logger.query({ deviceId: "cam-2" });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("capture_snapshot");
    });

    it("limits results", () => {
      const entries = logger.query({ limit: 1 });
      expect(entries).toHaveLength(1);
    });
  });

  describe("summary", () => {
    it("groups counts by action", () => {
      logger.log({ action: "turn_light_on", locationId: "l", locationName: "L", parameters: {}, result: "success" });
      logger.log({ action: "turn_light_on", locationId: "l", locationName: "L", parameters: {}, result: "failure" });
      logger.log({ action: "capture_snapshot", locationId: "l", locationName: "L", parameters: {}, result: "success" });

      const s = logger.summary();
      expect(s["turn_light_on"]).toEqual({ total: 2, success: 1, failure: 1 });
      expect(s["capture_snapshot"]).toEqual({ total: 1, success: 1, failure: 0 });
    });
  });

  it("clears all entries", () => {
    logger.log({ action: "a", locationId: "l", locationName: "L", parameters: {}, result: "success" });
    logger.clear();
    expect(logger.size).toBe(0);
  });
});
