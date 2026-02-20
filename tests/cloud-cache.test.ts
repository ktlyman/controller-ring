import { describe, it, expect, beforeEach } from "vitest";
import { CloudCache } from "../src/storage/cloud-cache.js";
import { createTestDatabase } from "./helpers/test-db.js";
import type { RingDatabase } from "../src/storage/database.js";
import type { CloudCameraEvent, CloudVideoResult } from "../src/types/index.js";

function makeCloudEvent(overrides: Partial<CloudCameraEvent> = {}): CloudCameraEvent {
  return {
    id: overrides.id ?? `ding-${Math.random().toString(36).slice(2, 8)}`,
    dingIdStr: overrides.dingIdStr ?? `ding-${Math.random().toString(36).slice(2, 8)}`,
    deviceId: overrides.deviceId ?? "cam-1",
    deviceName: overrides.deviceName ?? "Front Door",
    locationId: overrides.locationId ?? "loc-1",
    locationName: overrides.locationName ?? "Home",
    kind: overrides.kind ?? "motion",
    createdAt: overrides.createdAt ?? "2025-06-15T10:30:00.000Z",
    favorite: overrides.favorite ?? false,
    recordingStatus: overrides.recordingStatus ?? "ready",
    state: overrides.state ?? "completed",
    cvProperties: overrides.cvProperties ?? {
      personDetected: null,
      detectionType: null,
      streamBroken: null,
    },
  };
}

function makeCloudVideo(overrides: Partial<CloudVideoResult> = {}): CloudVideoResult {
  const defaults: CloudVideoResult = {
    dingId: `vid-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: "2025-06-15T10:30:00.000Z",
    kind: "motion",
    state: "completed",
    duration: 30,
    favorite: false,
    thumbnailUrl: "https://ring.com/thumb.jpg",
    lqUrl: "https://ring.com/lq.mp4",
    hqUrl: "https://ring.com/hq.mp4",
    untranscodedUrl: "https://ring.com/raw.mp4",
    cvProperties: {
      personDetected: true,
      detectionType: "human",
      streamBroken: null,
    },
  };
  return { ...defaults, ...overrides };
}

describe("CloudCache", () => {
  let db: RingDatabase;
  let cache: CloudCache;

  beforeEach(() => {
    db = createTestDatabase();
    // Use a very long maxAge so entries don't expire during tests
    cache = new CloudCache(db.getConnection(), 60 * 60 * 1000);
  });

  // ── Cloud Events ──

  describe("cacheEvents / getCachedEvents", () => {
    it("caches and retrieves cloud events", () => {
      const events = [
        makeCloudEvent({ id: "e1", dingIdStr: "e1" }),
        makeCloudEvent({ id: "e2", dingIdStr: "e2" }),
      ];

      cache.cacheEvents(events);

      const cached = cache.getCachedEvents({ deviceId: "cam-1" });
      expect(cached).not.toBeNull();
      expect(cached).toHaveLength(2);
    });

    it("returns null on cache miss", () => {
      const cached = cache.getCachedEvents({ deviceId: "nonexistent" });
      expect(cached).toBeNull();
    });

    it("filters by deviceId", () => {
      cache.cacheEvents([
        makeCloudEvent({ id: "e1", dingIdStr: "e1", deviceId: "cam-1" }),
        makeCloudEvent({ id: "e2", dingIdStr: "e2", deviceId: "cam-2" }),
      ]);

      const cached = cache.getCachedEvents({ deviceId: "cam-1" });
      expect(cached).toHaveLength(1);
      expect(cached![0].deviceId).toBe("cam-1");
    });

    it("filters by locationId", () => {
      cache.cacheEvents([
        makeCloudEvent({ id: "e1", dingIdStr: "e1", locationId: "loc-1" }),
        makeCloudEvent({ id: "e2", dingIdStr: "e2", locationId: "loc-2" }),
      ]);

      const cached = cache.getCachedEvents({ locationId: "loc-2" });
      expect(cached).toHaveLength(1);
      expect(cached![0].locationId).toBe("loc-2");
    });

    it("filters by kind", () => {
      cache.cacheEvents([
        makeCloudEvent({ id: "e1", dingIdStr: "e1", kind: "motion" }),
        makeCloudEvent({ id: "e2", dingIdStr: "e2", kind: "ding" }),
      ]);

      const cached = cache.getCachedEvents({ kind: "ding" });
      expect(cached).toHaveLength(1);
      expect(cached![0].kind).toBe("ding");
    });

    it("respects limit parameter", () => {
      cache.cacheEvents([
        makeCloudEvent({ id: "e1", dingIdStr: "e1" }),
        makeCloudEvent({ id: "e2", dingIdStr: "e2" }),
        makeCloudEvent({ id: "e3", dingIdStr: "e3" }),
      ]);

      const cached = cache.getCachedEvents({ limit: 2 });
      expect(cached).toHaveLength(2);
    });

    it("upserts on duplicate ding_id_str", () => {
      cache.cacheEvents([
        makeCloudEvent({ id: "e1", dingIdStr: "same-ding", favorite: false }),
      ]);
      cache.cacheEvents([
        makeCloudEvent({ id: "e1", dingIdStr: "same-ding", favorite: true }),
      ]);

      const cached = cache.getCachedEvents({});
      expect(cached).toHaveLength(1);
      expect(cached![0].favorite).toBe(true);
    });

    it("round-trips cvProperties correctly", () => {
      const event = makeCloudEvent({
        id: "e1",
        dingIdStr: "e1",
        cvProperties: {
          personDetected: true,
          detectionType: "human",
          streamBroken: false,
        },
      });
      cache.cacheEvents([event]);

      const cached = cache.getCachedEvents({});
      expect(cached![0].cvProperties).toEqual({
        personDetected: true,
        detectionType: "human",
        streamBroken: false,
      });
    });
  });

  // ── Cloud Videos ──

  describe("cacheVideos / getCachedVideos", () => {
    it("caches and retrieves video results", () => {
      const videos = [
        makeCloudVideo({ dingId: "v1", createdAt: "2025-06-15T10:00:00Z" }),
        makeCloudVideo({ dingId: "v2", createdAt: "2025-06-15T11:00:00Z" }),
      ];

      cache.cacheVideos(videos);

      const cached = cache.getCachedVideos(
        "cam-1",
        "2025-06-15T00:00:00Z",
        "2025-06-15T23:59:59Z"
      );
      expect(cached).not.toBeNull();
      expect(cached).toHaveLength(2);
    });

    it("returns null on cache miss", () => {
      const cached = cache.getCachedVideos(
        "cam-1",
        "2025-06-15T00:00:00Z",
        "2025-06-15T23:59:59Z"
      );
      expect(cached).toBeNull();
    });

    it("filters by date range", () => {
      cache.cacheVideos([
        makeCloudVideo({ dingId: "v1", createdAt: "2025-06-14T10:00:00Z" }),
        makeCloudVideo({ dingId: "v2", createdAt: "2025-06-15T10:00:00Z" }),
        makeCloudVideo({ dingId: "v3", createdAt: "2025-06-16T10:00:00Z" }),
      ]);

      const cached = cache.getCachedVideos(
        "cam-1",
        "2025-06-15T00:00:00Z",
        "2025-06-15T23:59:59Z"
      );
      expect(cached).toHaveLength(1);
      expect(cached![0].dingId).toBe("v2");
    });

    it("upserts on duplicate ding_id", () => {
      cache.cacheVideos([
        makeCloudVideo({ dingId: "same-id", favorite: false }),
      ]);
      cache.cacheVideos([
        makeCloudVideo({ dingId: "same-id", favorite: true }),
      ]);

      const cached = cache.getCachedVideos(
        "cam-1",
        "2025-06-15T00:00:00Z",
        "2025-06-15T23:59:59Z"
      );
      expect(cached).toHaveLength(1);
      expect(cached![0].favorite).toBe(true);
    });

    it("round-trips video fields correctly", () => {
      const video = makeCloudVideo({
        dingId: "v1",
        duration: 42.5,
        thumbnailUrl: null,
        hqUrl: null,
      });
      cache.cacheVideos([video]);

      const cached = cache.getCachedVideos(
        "cam-1",
        "2025-06-15T00:00:00Z",
        "2025-06-15T23:59:59Z"
      );
      expect(cached![0].duration).toBe(42.5);
      expect(cached![0].thumbnailUrl).toBeNull();
      expect(cached![0].hqUrl).toBeNull();
    });
  });

  // ── Staleness ──

  describe("staleness", () => {
    it("returns null when cache entries are stale", () => {
      // Use the normal long-lived cache but manually backdated cached_at
      cache.cacheEvents([
        makeCloudEvent({ id: "e1", dingIdStr: "e1" }),
      ]);

      // Manually set cached_at to 2 hours ago to simulate stale entries
      db.getConnection().prepare(
        "UPDATE cloud_events SET cached_at = datetime('now', '-2 hours')"
      ).run();

      const cached = cache.getCachedEvents({});
      expect(cached).toBeNull();
    });

    it("pruneStale removes old entries", () => {
      cache.cacheEvents([
        makeCloudEvent({ id: "e1", dingIdStr: "e1" }),
      ]);
      cache.cacheVideos([
        makeCloudVideo({ dingId: "v1" }),
      ]);

      // Manually set cached_at to 2 hours ago
      db.getConnection().prepare(
        "UPDATE cloud_events SET cached_at = datetime('now', '-2 hours')"
      ).run();
      db.getConnection().prepare(
        "UPDATE cloud_videos SET cached_at = datetime('now', '-2 hours')"
      ).run();

      cache.pruneStale();

      // Verify rows are actually deleted from the database
      const eventCount = db.getConnection()
        .prepare("SELECT COUNT(*) as count FROM cloud_events")
        .get() as { count: number };
      const videoCount = db.getConnection()
        .prepare("SELECT COUNT(*) as count FROM cloud_videos")
        .get() as { count: number };

      expect(eventCount.count).toBe(0);
      expect(videoCount.count).toBe(0);
    });
  });
});
