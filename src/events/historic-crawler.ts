/**
 * Historic data crawler — runs in the background to fetch and persist
 * all historical Ring cloud events, video metadata, and device history
 * for every camera and location.
 *
 * Three crawl phases per entity:
 *   1. Cloud camera events (cursor-based pagination per camera)
 *   2. Video recordings (date-window pagination per camera)
 *   3. Device history (offset-based pagination per location)
 *
 * Crawl progress is persisted in SQLite via CrawlStore so crawls
 * survive process restarts.
 */

import type { RingClient } from "../client/ring-client.js";
import type { CloudHistory } from "./cloud-history.js";
import type { CrawlStore } from "../storage/crawl-store.js";
import type { DeviceHistoryStore } from "../storage/device-history-store.js";
import type {
  CrawlConfig,
  CrawlState,
  CrawlStatusReport,
  CrawlStatus,
} from "../types/index.js";

/** Maximum age of Ring cloud data in days. */
const MAX_HISTORY_DAYS = 180;

export class HistoricCrawler {
  private running = false;
  private abortController: AbortController | null = null;
  private incrementalTimer: ReturnType<typeof setInterval> | null = null;
  private backfillPromise: Promise<void> | null = null;

  constructor(
    private client: RingClient,
    private cloudHistory: CloudHistory,
    private crawlStore: CrawlStore,
    private deviceHistoryStore: DeviceHistoryStore,
    private config: CrawlConfig
  ) {}

  /** Start the background crawl. Non-blocking: launches the crawl loop as fire-and-forget. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();

    this.backfillPromise = this.runBackfill().catch((err) => {
      console.error("[historic-crawler] Backfill failed:", err);
    });
  }

  /** Stop the crawler and any pending work. */
  stop(): void {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
    if (this.incrementalTimer) {
      clearInterval(this.incrementalTimer);
      this.incrementalTimer = null;
    }
  }

  /** Whether the crawler is currently active. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Get the current crawl status report. */
  async getStatus(): Promise<CrawlStatusReport> {
    const allStates = this.crawlStore.getAllStates();

    // Build camera status (events + videos phases)
    const eventStates = allStates.filter((s) => s.phase === "events");
    const videoStates = allStates.filter((s) => s.phase === "videos");
    const historyStates = allStates.filter((s) => s.phase === "device_history");

    // Get camera names
    let cameraNames: Map<string, string> = new Map();
    let locationNames: Map<string, string> = new Map();
    try {
      const cameras = await this.client.getCameras();
      cameraNames = new Map(cameras.map((c) => [String(c.id), c.name]));
      const locations = await this.client.getLocations();
      locationNames = new Map(locations.map((l) => [l.id, l.name]));
    } catch {
      // If client not initialized, use entity IDs as names
    }

    const defaultPhaseStatus = (status: CrawlStatus = "idle") => ({
      status,
      totalFetched: 0,
      oldestFetchedAt: null as string | null,
    });

    const cameras = new Map<string, {
      deviceId: string;
      deviceName: string;
      events: { status: CrawlStatus; totalFetched: number; oldestFetchedAt: string | null };
      videos: { status: CrawlStatus; totalFetched: number; oldestFetchedAt: string | null };
    }>();

    for (const s of eventStates) {
      cameras.set(s.entityId, {
        deviceId: s.entityId,
        deviceName: cameraNames.get(s.entityId) ?? s.entityId,
        events: { status: s.status, totalFetched: s.totalFetched, oldestFetchedAt: s.oldestFetchedAt },
        videos: defaultPhaseStatus(),
      });
    }

    for (const s of videoStates) {
      const existing = cameras.get(s.entityId);
      if (existing) {
        existing.videos = { status: s.status, totalFetched: s.totalFetched, oldestFetchedAt: s.oldestFetchedAt };
      } else {
        cameras.set(s.entityId, {
          deviceId: s.entityId,
          deviceName: cameraNames.get(s.entityId) ?? s.entityId,
          events: defaultPhaseStatus(),
          videos: { status: s.status, totalFetched: s.totalFetched, oldestFetchedAt: s.oldestFetchedAt },
        });
      }
    }

    const locations = historyStates.map((s) => ({
      locationId: s.entityId,
      locationName: locationNames.get(s.entityId) ?? s.entityId,
      deviceHistory: {
        status: s.status,
        totalFetched: s.totalFetched,
        oldestFetchedAt: s.oldestFetchedAt,
      },
    }));

    const cameraArr = [...cameras.values()];
    const camerasCompleted = cameraArr.filter(
      (c) => c.events.status === "completed" && c.videos.status === "completed"
    ).length;
    const locationsCompleted = locations.filter(
      (l) => l.deviceHistory.status === "completed"
    ).length;

    return {
      running: this.running,
      cameras: cameraArr,
      locations,
      summary: {
        totalCameras: cameraArr.length,
        camerasCompleted,
        totalLocations: locations.length,
        locationsCompleted,
        totalEventsFetched: eventStates.reduce((sum, s) => sum + s.totalFetched, 0),
        totalVideosFetched: videoStates.reduce((sum, s) => sum + s.totalFetched, 0),
        totalDeviceHistoryFetched: historyStates.reduce((sum, s) => sum + s.totalFetched, 0),
      },
    };
  }

  // ── Internal Crawl Logic ──

  private async runBackfill(): Promise<void> {
    // Phase 1 & 2: Crawl cameras (events + videos)
    try {
      const cameras = await this.client.getCameras();
      for (const camera of cameras) {
        if (this.shouldStop()) break;
        const deviceId = String(camera.id);
        await this.crawlEventsForDevice(deviceId);
        if (this.shouldStop()) break;
        await this.crawlVideosForDevice(deviceId);
      }
    } catch (err) {
      console.error("[historic-crawler] Error enumerating cameras:", err);
    }

    // Phase 3: Crawl device history per location
    if (!this.shouldStop()) {
      try {
        const locations = await this.client.getLocations();
        for (const location of locations) {
          if (this.shouldStop()) break;
          await this.crawlDeviceHistoryForLocation(location.id);
        }
      } catch (err) {
        console.error("[historic-crawler] Error enumerating locations:", err);
      }
    }

    // Start incremental polling if all backfill completed and not stopped
    if (!this.shouldStop()) {
      this.startIncrementalPolling();
    }
  }

  private async crawlEventsForDevice(deviceId: string): Promise<void> {
    let state = this.crawlStore.getState(deviceId, "events");
    if (state?.status === "completed") return;

    if (!state || state.status === "idle" || state.status === "error") {
      state = this.makeInitialState(deviceId, "events");
      this.crawlStore.upsertState(state);
    } else if (state.status === "paused") {
      state.status = "running";
      this.crawlStore.upsertState(state);
    }

    let paginationKey = state.paginationKey ?? undefined;

    try {
      while (true) {
        if (this.shouldStop()) {
          state.status = "paused";
          this.crawlStore.upsertState(state);
          return;
        }

        const result = await this.cloudHistory.getEvents({
          deviceId,
          limit: this.config.pageSize,
          paginationKey,
        });

        if (result.events.length === 0) break;

        // CloudHistory.getEvents() auto-caches via CloudCache
        state.totalFetched += result.events.length;
        state.paginationKey = result.paginationKey;

        const timestamps = result.events.map((e) => e.createdAt);
        const oldest = timestamps.reduce((a, b) => (a < b ? a : b));
        const newest = timestamps.reduce((a, b) => (a > b ? a : b));

        if (!state.oldestFetchedAt || oldest < state.oldestFetchedAt) {
          state.oldestFetchedAt = oldest;
        }
        if (!state.newestFetchedAt || newest > state.newestFetchedAt) {
          state.newestFetchedAt = newest;
        }

        state.updatedAt = new Date().toISOString();
        this.crawlStore.upsertState(state);

        if (!result.hasMore) break;
        paginationKey = result.paginationKey ?? undefined;

        await this.delay(this.config.delayMs);
      }

      this.crawlStore.markCompleted(deviceId, "events");
    } catch (err) {
      this.crawlStore.markError(
        deviceId,
        "events",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  private async crawlVideosForDevice(deviceId: string): Promise<void> {
    let state = this.crawlStore.getState(deviceId, "videos");
    if (state?.status === "completed") return;

    if (!state || state.status === "idle" || state.status === "error") {
      state = this.makeInitialState(deviceId, "videos");
      this.crawlStore.upsertState(state);
    } else if (state.status === "paused") {
      state.status = "running";
      this.crawlStore.upsertState(state);
    }

    const windowDays = this.config.videoWindowDays;
    let dateTo = state.oldestFetchedAt
      ? new Date(state.oldestFetchedAt)
      : new Date();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_HISTORY_DAYS);

    try {
      while (dateTo > cutoff) {
        if (this.shouldStop()) {
          state.status = "paused";
          this.crawlStore.upsertState(state);
          return;
        }

        const dateFrom = new Date(dateTo);
        dateFrom.setDate(dateFrom.getDate() - windowDays);
        if (dateFrom < cutoff) dateFrom.setTime(cutoff.getTime());

        const videos = await this.cloudHistory.searchVideos({
          deviceId,
          dateFrom: dateFrom.toISOString(),
          dateTo: dateTo.toISOString(),
          order: "desc",
        });
        // searchVideos() auto-caches via CloudCache

        state.totalFetched += videos.length;
        state.oldestFetchedAt = dateFrom.toISOString();

        if (!state.newestFetchedAt && videos.length > 0) {
          state.newestFetchedAt = videos[0].createdAt;
        }

        state.updatedAt = new Date().toISOString();
        this.crawlStore.upsertState(state);

        dateTo = dateFrom;
        await this.delay(this.config.delayMs);
      }

      this.crawlStore.markCompleted(deviceId, "videos");
    } catch (err) {
      this.crawlStore.markError(
        deviceId,
        "videos",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  private async crawlDeviceHistoryForLocation(locationId: string): Promise<void> {
    let state = this.crawlStore.getState(locationId, "device_history");
    if (state?.status === "completed") return;

    if (!state || state.status === "idle" || state.status === "error") {
      state = this.makeInitialState(locationId, "device_history");
      this.crawlStore.upsertState(state);
    } else if (state.status === "paused") {
      state.status = "running";
      this.crawlStore.upsertState(state);
    }

    // Resume from stored offset
    let offset = state.paginationKey ? parseInt(state.paginationKey, 10) : 0;
    const pageSize = this.config.pageSize;

    try {
      while (true) {
        if (this.shouldStop()) {
          state.status = "paused";
          state.paginationKey = String(offset);
          this.crawlStore.upsertState(state);
          return;
        }

        const events = await this.cloudHistory.getDeviceHistory({
          locationId,
          limit: pageSize,
          offset,
        });

        if (!Array.isArray(events) || events.length === 0) break;

        const inserted = this.deviceHistoryStore.insert(locationId, events);
        state.totalFetched += inserted;

        // Track timestamps from inserted events
        for (const event of events) {
          const ts = this.extractTimestamp(event);
          if (ts) {
            if (!state.oldestFetchedAt || ts < state.oldestFetchedAt) {
              state.oldestFetchedAt = ts;
            }
            if (!state.newestFetchedAt || ts > state.newestFetchedAt) {
              state.newestFetchedAt = ts;
            }
          }
        }

        offset += events.length;
        state.paginationKey = String(offset);
        state.updatedAt = new Date().toISOString();
        this.crawlStore.upsertState(state);

        // If we got fewer results than requested, we've reached the end
        if (events.length < pageSize) break;

        await this.delay(this.config.delayMs);
      }

      this.crawlStore.markCompleted(locationId, "device_history");
    } catch (err) {
      this.crawlStore.markError(
        locationId,
        "device_history",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // ── Incremental Polling ──

  private startIncrementalPolling(): void {
    const intervalMs = this.config.incrementalIntervalMinutes * 60 * 1000;
    this.incrementalTimer = setInterval(() => {
      this.runIncrementalCrawl().catch((err) => {
        console.error("[historic-crawler] Incremental crawl error:", err);
      });
    }, intervalMs);
  }

  private async runIncrementalCrawl(): Promise<void> {
    // Fetch latest camera events (no pagination key = latest)
    try {
      const cameras = await this.client.getCameras();
      for (const camera of cameras) {
        if (this.shouldStop()) break;
        const deviceId = String(camera.id);

        const result = await this.cloudHistory.getEvents({
          deviceId,
          limit: this.config.pageSize,
        });

        if (result.events.length > 0) {
          const evState = this.crawlStore.getState(deviceId, "events");
          if (evState) {
            evState.totalFetched += result.events.length;
            const newest = result.events[0].createdAt;
            if (!evState.newestFetchedAt || newest > evState.newestFetchedAt) {
              evState.newestFetchedAt = newest;
            }
            evState.updatedAt = new Date().toISOString();
            this.crawlStore.upsertState(evState);
          }
        }

        await this.delay(this.config.delayMs);
      }
    } catch (err) {
      console.error("[historic-crawler] Incremental camera crawl error:", err);
    }

    // Fetch latest device history per location
    try {
      const locations = await this.client.getLocations();
      for (const location of locations) {
        if (this.shouldStop()) break;

        const events = await this.cloudHistory.getDeviceHistory({
          locationId: location.id,
          limit: this.config.pageSize,
          offset: 0,
        });

        if (Array.isArray(events) && events.length > 0) {
          const inserted = this.deviceHistoryStore.insert(location.id, events);
          const histState = this.crawlStore.getState(location.id, "device_history");
          if (histState && inserted > 0) {
            histState.totalFetched += inserted;
            histState.updatedAt = new Date().toISOString();
            this.crawlStore.upsertState(histState);
          }
        }

        await this.delay(this.config.delayMs);
      }
    } catch (err) {
      console.error("[historic-crawler] Incremental device history crawl error:", err);
    }
  }

  // ── Utilities ──

  private shouldStop(): boolean {
    return !this.running || (this.abortController?.signal.aborted ?? false);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abortController?.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
  }

  private makeInitialState(entityId: string, phase: CrawlState["phase"]): CrawlState {
    return {
      entityId,
      phase,
      status: "running",
      paginationKey: null,
      oldestFetchedAt: null,
      newestFetchedAt: null,
      totalFetched: 0,
      lastError: null,
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
  }

  private extractTimestamp(event: unknown): string | null {
    if (typeof event !== "object" || event === null) return null;
    const obj = event as Record<string, unknown>;

    if (typeof obj.created_at === "string") return obj.created_at;
    if (typeof obj.datestamp === "string") return obj.datestamp;
    if (typeof obj.timestamp === "number") {
      return new Date(obj.timestamp * 1000).toISOString();
    }
    return null;
  }
}
