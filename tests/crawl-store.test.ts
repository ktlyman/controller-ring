import { describe, it, expect, beforeEach } from "vitest";
import { CrawlStore } from "../src/storage/crawl-store.js";
import { createTestCrawlStore } from "./helpers/test-db.js";
import type { RingDatabase } from "../src/storage/database.js";
import type { CrawlState } from "../src/types/index.js";

function makeCrawlState(overrides: Partial<CrawlState> = {}): CrawlState {
  return {
    entityId: "camera-1",
    phase: "events",
    status: "running",
    paginationKey: null,
    oldestFetchedAt: null,
    newestFetchedAt: null,
    totalFetched: 0,
    lastError: null,
    updatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

describe("CrawlStore", () => {
  let db: RingDatabase;
  let store: CrawlStore;

  beforeEach(() => {
    const result = createTestCrawlStore();
    db = result.db;
    store = result.store;
  });

  it("returns null for nonexistent entity state", () => {
    expect(store.getState("nonexistent", "events")).toBeNull();
  });

  it("upserts and retrieves crawl state", () => {
    const state = makeCrawlState({
      entityId: "cam-1",
      phase: "events",
      status: "running",
      paginationKey: "cursor-abc",
      totalFetched: 42,
    });

    store.upsertState(state);
    const retrieved = store.getState("cam-1", "events");

    expect(retrieved).not.toBeNull();
    expect(retrieved!.entityId).toBe("cam-1");
    expect(retrieved!.phase).toBe("events");
    expect(retrieved!.status).toBe("running");
    expect(retrieved!.paginationKey).toBe("cursor-abc");
    expect(retrieved!.totalFetched).toBe(42);
  });

  it("updates existing state on upsert", () => {
    store.upsertState(makeCrawlState({ entityId: "cam-1", totalFetched: 10 }));
    store.upsertState(makeCrawlState({ entityId: "cam-1", totalFetched: 50, paginationKey: "new-cursor" }));

    const retrieved = store.getState("cam-1", "events");
    expect(retrieved!.totalFetched).toBe(50);
    expect(retrieved!.paginationKey).toBe("new-cursor");
  });

  it("uses composite primary key (entityId + phase)", () => {
    store.upsertState(makeCrawlState({ entityId: "cam-1", phase: "events", totalFetched: 10 }));
    store.upsertState(makeCrawlState({ entityId: "cam-1", phase: "videos", totalFetched: 20 }));

    const events = store.getState("cam-1", "events");
    const videos = store.getState("cam-1", "videos");

    expect(events!.totalFetched).toBe(10);
    expect(videos!.totalFetched).toBe(20);
  });

  it("returns all states unfiltered", () => {
    store.upsertState(makeCrawlState({ entityId: "cam-1", phase: "events" }));
    store.upsertState(makeCrawlState({ entityId: "cam-1", phase: "videos" }));
    store.upsertState(makeCrawlState({ entityId: "loc-1", phase: "device_history" }));

    const all = store.getAllStates();
    expect(all).toHaveLength(3);
  });

  it("returns all states filtered by phase", () => {
    store.upsertState(makeCrawlState({ entityId: "cam-1", phase: "events" }));
    store.upsertState(makeCrawlState({ entityId: "cam-2", phase: "events" }));
    store.upsertState(makeCrawlState({ entityId: "cam-1", phase: "videos" }));

    const events = store.getAllStates("events");
    expect(events).toHaveLength(2);
    expect(events.every((s) => s.phase === "events")).toBe(true);
  });

  it("markCompleted sets status and completedAt", () => {
    store.upsertState(makeCrawlState({ entityId: "cam-1", status: "running" }));
    store.markCompleted("cam-1", "events");

    const state = store.getState("cam-1", "events");
    expect(state!.status).toBe("completed");
    expect(state!.completedAt).not.toBeNull();
  });

  it("markError sets status and lastError", () => {
    store.upsertState(makeCrawlState({ entityId: "cam-1", status: "running" }));
    store.markError("cam-1", "events", "API timeout");

    const state = store.getState("cam-1", "events");
    expect(state!.status).toBe("error");
    expect(state!.lastError).toBe("API timeout");
  });

  it("markCompleted is a no-op for nonexistent state", () => {
    store.markCompleted("nonexistent", "events");
    expect(store.getState("nonexistent", "events")).toBeNull();
  });

  it("resetState clears progress back to idle", () => {
    store.upsertState(makeCrawlState({
      entityId: "cam-1",
      status: "completed",
      totalFetched: 100,
      paginationKey: "cursor",
      oldestFetchedAt: "2025-01-01T00:00:00Z",
      completedAt: "2025-06-01T00:00:00Z",
    }));

    store.resetState("cam-1", "events");

    const state = store.getState("cam-1", "events");
    expect(state!.status).toBe("idle");
    expect(state!.totalFetched).toBe(0);
    expect(state!.paginationKey).toBeNull();
    expect(state!.oldestFetchedAt).toBeNull();
    expect(state!.startedAt).toBeNull();
    expect(state!.completedAt).toBeNull();
  });

  it("resetAll clears all entries", () => {
    store.upsertState(makeCrawlState({ entityId: "cam-1", phase: "events" }));
    store.upsertState(makeCrawlState({ entityId: "cam-2", phase: "videos" }));
    store.upsertState(makeCrawlState({ entityId: "loc-1", phase: "device_history" }));

    store.resetAll();
    expect(store.getAllStates()).toHaveLength(0);
  });

  it("preserves all nullable fields correctly", () => {
    store.upsertState(makeCrawlState({
      entityId: "cam-1",
      paginationKey: null,
      oldestFetchedAt: null,
      newestFetchedAt: null,
      lastError: null,
      startedAt: null,
      completedAt: null,
    }));

    const state = store.getState("cam-1", "events");
    expect(state!.paginationKey).toBeNull();
    expect(state!.oldestFetchedAt).toBeNull();
    expect(state!.newestFetchedAt).toBeNull();
    expect(state!.lastError).toBeNull();
    expect(state!.startedAt).toBeNull();
    expect(state!.completedAt).toBeNull();
  });
});
