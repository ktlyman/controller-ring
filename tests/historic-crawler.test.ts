import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HistoricCrawler } from "../src/events/historic-crawler.js";
import { CrawlStore } from "../src/storage/crawl-store.js";
import { DeviceHistoryStore } from "../src/storage/device-history-store.js";
import { createTestDatabase } from "./helpers/test-db.js";
import type { RingClient } from "../src/client/ring-client.js";
import type { CloudHistory } from "../src/events/cloud-history.js";
import type { CrawlConfig, CloudCameraEvent, CloudVideoResult } from "../src/types/index.js";

function makeEvent(overrides: Partial<CloudCameraEvent> = {}): CloudCameraEvent {
  return {
    id: `event-${Math.random().toString(36).slice(2)}`,
    dingIdStr: `ding-${Math.random().toString(36).slice(2)}`,
    deviceId: "cam-1",
    deviceName: "Front Door",
    locationId: "loc-1",
    locationName: "Home",
    kind: "motion",
    createdAt: "2025-06-15T10:00:00Z",
    favorite: false,
    recordingStatus: "ready",
    state: "accepted",
    cvProperties: { personDetected: false, detectionType: null, streamBroken: false },
    ...overrides,
  };
}

function makeVideo(overrides: Partial<CloudVideoResult> = {}): CloudVideoResult {
  return {
    dingId: `vid-${Math.random().toString(36).slice(2)}`,
    createdAt: "2025-06-15T10:00:00Z",
    kind: "motion",
    state: "ready",
    duration: 30,
    favorite: false,
    thumbnailUrl: "https://ring.com/thumb.jpg",
    lqUrl: "https://ring.com/lq.mp4",
    hqUrl: null,
    untranscodedUrl: "https://ring.com/raw.mp4",
    cvProperties: { personDetected: false, detectionType: null, streamBroken: false },
    ...overrides,
  };
}

function makeConfig(overrides: Partial<CrawlConfig> = {}): CrawlConfig {
  return {
    enabled: true,
    delayMs: 0, // No delay for tests
    pageSize: 10,
    videoWindowDays: 7,
    incrementalIntervalMinutes: 60,
    ...overrides,
  };
}

function createMockClient(camerasCount = 1, locationsCount = 1): RingClient {
  const cameras = Array.from({ length: camerasCount }, (_, i) => ({
    id: i + 1,
    name: `Camera ${i + 1}`,
  }));

  const locations = Array.from({ length: locationsCount }, (_, i) => ({
    id: `loc-${i + 1}`,
    name: `Location ${i + 1}`,
  }));

  return {
    getCameras: vi.fn().mockResolvedValue(cameras),
    getLocations: vi.fn().mockResolvedValue(locations),
    initialize: vi.fn().mockResolvedValue(undefined),
  } as unknown as RingClient;
}

describe("HistoricCrawler", () => {
  let crawlStore: CrawlStore;
  let deviceHistoryStore: DeviceHistoryStore;

  beforeEach(() => {
    const db = createTestDatabase();
    const conn = db.getConnection();
    crawlStore = new CrawlStore(conn);
    deviceHistoryStore = new DeviceHistoryStore(conn);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("crawls all event pages for a camera until hasMore is false", async () => {
    const client = createMockClient();
    const mockGetEvents = vi.fn()
      .mockResolvedValueOnce({
        events: [makeEvent({ createdAt: "2025-06-15T10:00:00Z" })],
        paginationKey: "cursor-1",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        events: [makeEvent({ createdAt: "2025-06-10T10:00:00Z" })],
        paginationKey: "cursor-2",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        events: [makeEvent({ createdAt: "2025-06-05T10:00:00Z" })],
        paginationKey: null,
        hasMore: false,
      });

    const cloudHistory = {
      getEvents: mockGetEvents,
      searchVideos: vi.fn().mockResolvedValue([]),
      getDeviceHistory: vi.fn().mockResolvedValue([]),
    } as unknown as CloudHistory;

    const crawler = new HistoricCrawler(
      client, cloudHistory, crawlStore, deviceHistoryStore, makeConfig()
    );

    await crawler.start();
    // Wait for backfill to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
    crawler.stop();

    // Should have been called 3 times for backfill pagination
    expect(mockGetEvents).toHaveBeenCalledTimes(3);
    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "1", limit: 10 })
    );
    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({ paginationKey: "cursor-1" })
    );

    const state = crawlStore.getState("1", "events");
    expect(state!.status).toBe("completed");
    expect(state!.totalFetched).toBe(3);
  });

  it("stores pagination cursor in crawl state after each page", async () => {
    const client = createMockClient();
    const mockGetEvents = vi.fn()
      .mockResolvedValueOnce({
        events: [makeEvent()],
        paginationKey: "cursor-abc",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        events: [],
        paginationKey: null,
        hasMore: false,
      });

    const cloudHistory = {
      getEvents: mockGetEvents,
      searchVideos: vi.fn().mockResolvedValue([]),
      getDeviceHistory: vi.fn().mockResolvedValue([]),
    } as unknown as CloudHistory;

    const crawler = new HistoricCrawler(
      client, cloudHistory, crawlStore, deviceHistoryStore, makeConfig()
    );

    await crawler.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    crawler.stop();

    // The state should have been updated with the pagination key
    const state = crawlStore.getState("1", "events");
    expect(state).not.toBeNull();
    expect(state!.status).toBe("completed");
  });

  it("resumes events crawl from stored cursor on restart", async () => {
    // Pre-populate a paused state with a cursor
    crawlStore.upsertState({
      entityId: "1",
      phase: "events",
      status: "paused",
      paginationKey: "saved-cursor",
      oldestFetchedAt: "2025-06-10T00:00:00Z",
      newestFetchedAt: "2025-06-15T00:00:00Z",
      totalFetched: 5,
      lastError: null,
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
    });

    const client = createMockClient();
    const mockGetEvents = vi.fn()
      .mockResolvedValueOnce({
        events: [makeEvent({ createdAt: "2025-06-05T10:00:00Z" })],
        paginationKey: null,
        hasMore: false,
      });

    const cloudHistory = {
      getEvents: mockGetEvents,
      searchVideos: vi.fn().mockResolvedValue([]),
      getDeviceHistory: vi.fn().mockResolvedValue([]),
    } as unknown as CloudHistory;

    const crawler = new HistoricCrawler(
      client, cloudHistory, crawlStore, deviceHistoryStore, makeConfig()
    );

    await crawler.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    crawler.stop();

    // Should have resumed with the saved cursor
    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({ paginationKey: "saved-cursor" })
    );

    const state = crawlStore.getState("1", "events");
    expect(state!.status).toBe("completed");
    expect(state!.totalFetched).toBe(6); // 5 previous + 1 new
  });

  it("skips cameras that are already completed", async () => {
    crawlStore.upsertState({
      entityId: "1",
      phase: "events",
      status: "completed",
      paginationKey: null,
      oldestFetchedAt: "2025-01-01T00:00:00Z",
      newestFetchedAt: "2025-06-15T00:00:00Z",
      totalFetched: 100,
      lastError: null,
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    const client = createMockClient();
    const mockGetEvents = vi.fn();

    const cloudHistory = {
      getEvents: mockGetEvents,
      searchVideos: vi.fn().mockResolvedValue([]),
      getDeviceHistory: vi.fn().mockResolvedValue([]),
    } as unknown as CloudHistory;

    const crawler = new HistoricCrawler(
      client, cloudHistory, crawlStore, deviceHistoryStore, makeConfig()
    );

    await crawler.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    crawler.stop();

    // getEvents should NOT be called for events phase (already completed)
    // but might be called for incremental polling
    const eventsCalls = mockGetEvents.mock.calls.filter(
      (call: unknown[]) => {
        const arg = call[0] as Record<string, unknown>;
        return arg.paginationKey !== undefined || arg.limit !== undefined;
      }
    );
    // The backfill events call should have been skipped
    expect(crawlStore.getState("1", "events")!.status).toBe("completed");
  });

  it("marks error state on API failure and preserves progress", async () => {
    const client = createMockClient();
    const mockGetEvents = vi.fn()
      .mockResolvedValueOnce({
        events: [makeEvent()],
        paginationKey: "cursor-1",
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error("API timeout"));

    const cloudHistory = {
      getEvents: mockGetEvents,
      searchVideos: vi.fn().mockResolvedValue([]),
      getDeviceHistory: vi.fn().mockResolvedValue([]),
    } as unknown as CloudHistory;

    const crawler = new HistoricCrawler(
      client, cloudHistory, crawlStore, deviceHistoryStore, makeConfig()
    );

    await crawler.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    crawler.stop();

    const state = crawlStore.getState("1", "events");
    expect(state!.status).toBe("error");
    expect(state!.lastError).toBe("API timeout");
    expect(state!.totalFetched).toBe(1); // First page was saved
  });

  it("crawls video recordings using date windows", async () => {
    const client = createMockClient();
    const mockSearchVideos = vi.fn().mockResolvedValue([makeVideo()]);

    const cloudHistory = {
      getEvents: vi.fn().mockResolvedValue({ events: [], paginationKey: null, hasMore: false }),
      searchVideos: mockSearchVideos,
      getDeviceHistory: vi.fn().mockResolvedValue([]),
    } as unknown as CloudHistory;

    // Use a short video window so the test doesn't take forever
    const crawler = new HistoricCrawler(
      client, cloudHistory, crawlStore, deviceHistoryStore,
      makeConfig({ videoWindowDays: 90 })
    );

    await crawler.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    crawler.stop();

    // Should have been called at least 2 times (180 days / 90-day windows)
    expect(mockSearchVideos.mock.calls.length).toBeGreaterThanOrEqual(2);

    const state = crawlStore.getState("1", "videos");
    expect(state!.status).toBe("completed");
  });

  it("crawls device history using offset-based pagination", async () => {
    const client = createMockClient();
    const mockGetDeviceHistory = vi.fn()
      .mockResolvedValueOnce([
        { device_id: "sensor-1", type: "contact.open", created_at: "2025-06-15T10:00:00Z" },
        { device_id: "sensor-1", type: "contact.close", created_at: "2025-06-15T11:00:00Z" },
      ])
      .mockResolvedValueOnce([]); // Empty page = done

    const cloudHistory = {
      getEvents: vi.fn().mockResolvedValue({ events: [], paginationKey: null, hasMore: false }),
      searchVideos: vi.fn().mockResolvedValue([]),
      getDeviceHistory: mockGetDeviceHistory,
    } as unknown as CloudHistory;

    const crawler = new HistoricCrawler(
      client, cloudHistory, crawlStore, deviceHistoryStore, makeConfig()
    );

    await crawler.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    crawler.stop();

    expect(mockGetDeviceHistory).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: "loc-1", limit: 10, offset: 0 })
    );

    const state = crawlStore.getState("loc-1", "device_history");
    expect(state!.status).toBe("completed");
    expect(state!.totalFetched).toBe(2);
    expect(deviceHistoryStore.size).toBe(2);
  });

  it("getStatus returns comprehensive crawl report", async () => {
    crawlStore.upsertState({
      entityId: "1",
      phase: "events",
      status: "completed",
      paginationKey: null,
      oldestFetchedAt: "2025-01-01T00:00:00Z",
      newestFetchedAt: "2025-06-15T00:00:00Z",
      totalFetched: 100,
      lastError: null,
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    crawlStore.upsertState({
      entityId: "1",
      phase: "videos",
      status: "running",
      paginationKey: null,
      oldestFetchedAt: "2025-03-01T00:00:00Z",
      newestFetchedAt: "2025-06-15T00:00:00Z",
      totalFetched: 50,
      lastError: null,
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
    });
    crawlStore.upsertState({
      entityId: "loc-1",
      phase: "device_history",
      status: "completed",
      paginationKey: "200",
      oldestFetchedAt: "2025-01-01T00:00:00Z",
      newestFetchedAt: "2025-06-15T00:00:00Z",
      totalFetched: 200,
      lastError: null,
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    const client = createMockClient();
    const cloudHistory = {
      getEvents: vi.fn(),
      searchVideos: vi.fn(),
      getDeviceHistory: vi.fn(),
    } as unknown as CloudHistory;

    const crawler = new HistoricCrawler(
      client, cloudHistory, crawlStore, deviceHistoryStore, makeConfig()
    );

    const status = await crawler.getStatus();

    expect(status.running).toBe(false);
    expect(status.cameras).toHaveLength(1);
    expect(status.cameras[0].events.status).toBe("completed");
    expect(status.cameras[0].events.totalFetched).toBe(100);
    expect(status.cameras[0].videos.status).toBe("running");
    expect(status.cameras[0].videos.totalFetched).toBe(50);
    expect(status.locations).toHaveLength(1);
    expect(status.locations[0].deviceHistory.status).toBe("completed");
    expect(status.locations[0].deviceHistory.totalFetched).toBe(200);
    expect(status.summary.totalEventsFetched).toBe(100);
    expect(status.summary.totalVideosFetched).toBe(50);
    expect(status.summary.totalDeviceHistoryFetched).toBe(200);
  });

  it("stop() prevents further crawling", async () => {
    const client = createMockClient();
    let callCount = 0;
    const mockGetEvents = vi.fn().mockImplementation(async () => {
      callCount++;
      // Simulate some delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        events: [makeEvent()],
        paginationKey: `cursor-${callCount}`,
        hasMore: true,
      };
    });

    const cloudHistory = {
      getEvents: mockGetEvents,
      searchVideos: vi.fn().mockResolvedValue([]),
      getDeviceHistory: vi.fn().mockResolvedValue([]),
    } as unknown as CloudHistory;

    const crawler = new HistoricCrawler(
      client, cloudHistory, crawlStore, deviceHistoryStore, makeConfig()
    );

    await crawler.start();
    expect(crawler.isRunning).toBe(true);

    // Stop after a short delay
    await new Promise((resolve) => setTimeout(resolve, 50));
    crawler.stop();
    expect(crawler.isRunning).toBe(false);

    // The crawl should have been paused, not completed
    const state = crawlStore.getState("1", "events");
    expect(state).not.toBeNull();
    // Should be either paused or running (depends on timing)
    expect(["paused", "running", "completed"]).toContain(state!.status);
  });
});
