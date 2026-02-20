import { describe, it, expect, beforeEach, vi } from "vitest";
import { CloudHistory } from "../src/events/cloud-history.js";
import type { RingClient } from "../src/client/ring-client.js";

// ── Mock Factories ──

function makeMockCamera(overrides: {
  id: number;
  name: string;
  getEvents?: ReturnType<typeof vi.fn>;
  videoSearch?: ReturnType<typeof vi.fn>;
  getRecordingUrl?: ReturnType<typeof vi.fn>;
}) {
  return {
    id: overrides.id,
    name: overrides.name,
    getEvents: overrides.getEvents ?? vi.fn(),
    videoSearch: overrides.videoSearch ?? vi.fn(),
    getRecordingUrl: overrides.getRecordingUrl ?? vi.fn(),
  };
}

function makeMockLocation(overrides: {
  id: string;
  name: string;
  cameras?: ReturnType<typeof makeMockCamera>[];
  getCameraEvents?: ReturnType<typeof vi.fn>;
  getHistory?: ReturnType<typeof vi.fn>;
}) {
  return {
    id: overrides.id,
    name: overrides.name,
    cameras: overrides.cameras ?? [],
    getCameraEvents: overrides.getCameraEvents ?? vi.fn(),
    getHistory: overrides.getHistory ?? vi.fn(),
  };
}

const SAMPLE_CAMERA_EVENT = {
  created_at: "2025-06-15T10:30:00.000Z",
  ding_id: 123456789,
  ding_id_str: "123456789",
  doorbot_id: 666040790,
  favorite: false,
  kind: "motion" as const,
  recorded: false as const,
  recording_status: "ready" as const,
  state: "completed" as const,
  cv_properties: {
    person_detected: null,
    detection_type: null,
    stream_broken: null,
  },
};

const SAMPLE_VIDEO_RESULT = {
  ding_id: "987654321",
  created_at: 1718444400000,
  kind: "motion" as const,
  state: "completed" as const,
  duration: 30,
  favorite: true,
  thumbnail_url: "https://ring.com/thumb/987654321.jpg",
  lq_url: "https://ring.com/lq/987654321.mp4",
  hq_url: "https://ring.com/hq/987654321.mp4",
  untranscoded_url: "https://ring.com/raw/987654321.mp4",
  had_subscription: true,
  preroll_duration: null,
  cv_properties: {
    person_detected: true,
    detection_type: "human",
    stream_broken: null,
  },
};

describe("CloudHistory", () => {
  let mockClient: {
    getCameraById: ReturnType<typeof vi.fn>;
    getLocationById: ReturnType<typeof vi.fn>;
    getLocations: ReturnType<typeof vi.fn>;
  };
  let cloudHistory: CloudHistory;

  beforeEach(() => {
    mockClient = {
      getCameraById: vi.fn(),
      getLocationById: vi.fn(),
      getLocations: vi.fn(),
    };
    cloudHistory = new CloudHistory(mockClient as unknown as RingClient);
  });

  // ── getEvents ──

  describe("getEvents", () => {
    it("fetches events for a single camera by deviceId", async () => {
      const camera = makeMockCamera({
        id: 666040790,
        name: "Downstairs",
        getEvents: vi.fn().mockResolvedValue({
          events: [SAMPLE_CAMERA_EVENT],
          meta: { pagination_key: "next-page-key" },
        }),
      });

      mockClient.getCameraById.mockResolvedValue(camera);
      mockClient.getLocations.mockResolvedValue([
        makeMockLocation({
          id: "loc-1",
          name: "SF Loft",
          cameras: [camera],
        }),
      ]);

      const result = await cloudHistory.getEvents({ deviceId: "666040790" });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].deviceId).toBe("666040790");
      expect(result.events[0].deviceName).toBe("Downstairs");
      expect(result.events[0].locationId).toBe("loc-1");
      expect(result.events[0].locationName).toBe("SF Loft");
      expect(result.events[0].kind).toBe("motion");
      expect(result.events[0].createdAt).toBe("2025-06-15T10:30:00.000Z");
      expect(result.events[0].dingIdStr).toBe("123456789");
      expect(result.paginationKey).toBe("next-page-key");
      expect(result.hasMore).toBe(true);
    });

    it("fetches events for all cameras at a location", async () => {
      const camera = makeMockCamera({ id: 666040790, name: "Downstairs" });
      const location = makeMockLocation({
        id: "loc-1",
        name: "SF Loft",
        cameras: [camera],
        getCameraEvents: vi.fn().mockResolvedValue({
          events: [SAMPLE_CAMERA_EVENT],
          meta: { pagination_key: "" },
        }),
      });

      mockClient.getLocationById.mockResolvedValue(location);

      const result = await cloudHistory.getEvents({ locationId: "loc-1" });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].deviceName).toBe("Downstairs");
      expect(location.getCameraEvents).toHaveBeenCalled();
    });

    it("passes filter options through to the Ring API", async () => {
      const camera = makeMockCamera({
        id: 666040790,
        name: "Downstairs",
        getEvents: vi.fn().mockResolvedValue({
          events: [],
          meta: { pagination_key: "" },
        }),
      });

      mockClient.getCameraById.mockResolvedValue(camera);
      mockClient.getLocations.mockResolvedValue([
        makeMockLocation({ id: "loc-1", name: "SF Loft", cameras: [camera] }),
      ]);

      await cloudHistory.getEvents({
        deviceId: "666040790",
        kind: "ding",
        state: "person_detected",
        favorites: true,
        limit: 5,
        paginationKey: "prev-key",
      });

      expect(camera.getEvents).toHaveBeenCalledWith({
        kind: "ding",
        state: "person_detected",
        favorites: true,
        limit: 5,
        olderThanId: "prev-key",
      });
    });

    it("returns hasMore false when pagination_key is empty", async () => {
      const camera = makeMockCamera({
        id: 666040790,
        name: "Downstairs",
        getEvents: vi.fn().mockResolvedValue({
          events: [SAMPLE_CAMERA_EVENT],
          meta: { pagination_key: "" },
        }),
      });

      mockClient.getCameraById.mockResolvedValue(camera);
      mockClient.getLocations.mockResolvedValue([
        makeMockLocation({ id: "loc-1", name: "SF Loft", cameras: [camera] }),
      ]);

      const result = await cloudHistory.getEvents({ deviceId: "666040790" });

      // Empty string is normalized to null
      expect(result.paginationKey).toBeNull();
      expect(result.hasMore).toBe(false);
    });

    it("throws when camera not found", async () => {
      mockClient.getCameraById.mockResolvedValue(undefined);

      await expect(
        cloudHistory.getEvents({ deviceId: "nonexistent" })
      ).rejects.toThrow("Camera not found: nonexistent");
    });

    it("returns empty events when no events match", async () => {
      const camera = makeMockCamera({
        id: 666040790,
        name: "Downstairs",
        getEvents: vi.fn().mockResolvedValue({
          events: [],
          meta: { pagination_key: "" },
        }),
      });

      mockClient.getCameraById.mockResolvedValue(camera);
      mockClient.getLocations.mockResolvedValue([
        makeMockLocation({ id: "loc-1", name: "SF Loft", cameras: [camera] }),
      ]);

      const result = await cloudHistory.getEvents({ deviceId: "666040790" });

      expect(result.events).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it("queries across all locations when no filters provided", async () => {
      const cam1 = makeMockCamera({ id: 100, name: "Cam A" });
      const cam2 = makeMockCamera({ id: 200, name: "Cam B" });

      const loc1 = makeMockLocation({
        id: "loc-1",
        name: "Home",
        cameras: [cam1],
        getCameraEvents: vi.fn().mockResolvedValue({
          events: [{ ...SAMPLE_CAMERA_EVENT, doorbot_id: 100 }],
          meta: { pagination_key: "" },
        }),
      });
      const loc2 = makeMockLocation({
        id: "loc-2",
        name: "Office",
        cameras: [cam2],
        getCameraEvents: vi.fn().mockResolvedValue({
          events: [{ ...SAMPLE_CAMERA_EVENT, doorbot_id: 200, created_at: "2025-06-15T11:00:00.000Z" }],
          meta: { pagination_key: "" },
        }),
      });

      mockClient.getLocations.mockResolvedValue([loc1, loc2]);

      const result = await cloudHistory.getEvents();

      expect(result.events).toHaveLength(2);
      // Should be sorted newest-first
      expect(result.events[0].deviceName).toBe("Cam B");
      expect(result.events[1].deviceName).toBe("Cam A");
    });
  });

  // ── searchVideos ──

  describe("searchVideos", () => {
    it("returns normalized video results with correct field mapping", async () => {
      const camera = makeMockCamera({
        id: 666040790,
        name: "Downstairs",
        videoSearch: vi.fn().mockResolvedValue({
          video_search: [SAMPLE_VIDEO_RESULT],
        }),
      });

      mockClient.getCameraById.mockResolvedValue(camera);

      const results = await cloudHistory.searchVideos({
        deviceId: "666040790",
        dateFrom: "2025-06-15T00:00:00Z",
        dateTo: "2025-06-15T23:59:59Z",
      });

      expect(results).toHaveLength(1);
      expect(results[0].dingId).toBe("987654321");
      expect(results[0].duration).toBe(30);
      expect(results[0].favorite).toBe(true);
      expect(results[0].thumbnailUrl).toBe("https://ring.com/thumb/987654321.jpg");
      expect(results[0].lqUrl).toBe("https://ring.com/lq/987654321.mp4");
      expect(results[0].hqUrl).toBe("https://ring.com/hq/987654321.mp4");
      expect(results[0].kind).toBe("motion");
      expect(results[0].cvProperties.personDetected).toBe(true);
      expect(results[0].cvProperties.detectionType).toBe("human");
    });

    it("converts ISO dates to millisecond timestamps for the Ring API", async () => {
      const camera = makeMockCamera({
        id: 666040790,
        name: "Downstairs",
        videoSearch: vi.fn().mockResolvedValue({ video_search: [] }),
      });

      mockClient.getCameraById.mockResolvedValue(camera);

      const dateFrom = "2025-06-15T00:00:00Z";
      const dateTo = "2025-06-15T23:59:59Z";

      await cloudHistory.searchVideos({
        deviceId: "666040790",
        dateFrom,
        dateTo,
      });

      expect(camera.videoSearch).toHaveBeenCalledWith({
        dateFrom: Date.parse(dateFrom),
        dateTo: Date.parse(dateTo),
        order: "desc",
      });
    });

    it("passes order parameter through", async () => {
      const camera = makeMockCamera({
        id: 666040790,
        name: "Downstairs",
        videoSearch: vi.fn().mockResolvedValue({ video_search: [] }),
      });

      mockClient.getCameraById.mockResolvedValue(camera);

      await cloudHistory.searchVideos({
        deviceId: "666040790",
        dateFrom: "2025-06-15T00:00:00Z",
        dateTo: "2025-06-15T23:59:59Z",
        order: "asc",
      });

      expect(camera.videoSearch).toHaveBeenCalledWith(
        expect.objectContaining({ order: "asc" })
      );
    });

    it("throws when camera not found", async () => {
      mockClient.getCameraById.mockResolvedValue(undefined);

      await expect(
        cloudHistory.searchVideos({
          deviceId: "nonexistent",
          dateFrom: "2025-06-15T00:00:00Z",
          dateTo: "2025-06-15T23:59:59Z",
        })
      ).rejects.toThrow("Camera not found: nonexistent");
    });

    it("returns empty array when no videos match", async () => {
      const camera = makeMockCamera({
        id: 666040790,
        name: "Downstairs",
        videoSearch: vi.fn().mockResolvedValue({ video_search: [] }),
      });

      mockClient.getCameraById.mockResolvedValue(camera);

      const results = await cloudHistory.searchVideos({
        deviceId: "666040790",
        dateFrom: "2025-01-01T00:00:00Z",
        dateTo: "2025-01-01T23:59:59Z",
      });

      expect(results).toHaveLength(0);
    });
  });

  // ── getRecordingUrl ──

  describe("getRecordingUrl", () => {
    it("returns the URL from the camera API", async () => {
      const camera = makeMockCamera({
        id: 666040790,
        name: "Downstairs",
        getRecordingUrl: vi.fn().mockResolvedValue("https://ring.com/recording/123.mp4"),
      });

      mockClient.getCameraById.mockResolvedValue(camera);

      const url = await cloudHistory.getRecordingUrl("666040790", "123456789");

      expect(url).toBe("https://ring.com/recording/123.mp4");
      expect(camera.getRecordingUrl).toHaveBeenCalledWith("123456789", {
        transcoded: false,
      });
    });

    it("passes transcoded option through", async () => {
      const camera = makeMockCamera({
        id: 666040790,
        name: "Downstairs",
        getRecordingUrl: vi.fn().mockResolvedValue("https://ring.com/recording/123-tc.mp4"),
      });

      mockClient.getCameraById.mockResolvedValue(camera);

      await cloudHistory.getRecordingUrl("666040790", "123456789", {
        transcoded: true,
      });

      expect(camera.getRecordingUrl).toHaveBeenCalledWith("123456789", {
        transcoded: true,
      });
    });

    it("throws when camera not found", async () => {
      mockClient.getCameraById.mockResolvedValue(undefined);

      await expect(
        cloudHistory.getRecordingUrl("nonexistent", "123")
      ).rejects.toThrow("Camera not found: nonexistent");
    });
  });

  // ── getDeviceHistory ──

  describe("getDeviceHistory", () => {
    it("returns events from location.getHistory()", async () => {
      const historyEvents = [
        { msg: "DataUpdate", datatype: "some-type", body: { action: "disarm" } },
      ];
      const location = makeMockLocation({
        id: "loc-1",
        name: "SF Loft",
        getHistory: vi.fn().mockResolvedValue(historyEvents),
      });

      mockClient.getLocationById.mockResolvedValue(location);

      const result = await cloudHistory.getDeviceHistory({ locationId: "loc-1" });

      expect(result).toHaveLength(1);
      expect(location.getHistory).toHaveBeenCalledWith({
        limit: undefined,
        offset: undefined,
        category: undefined,
      });
    });

    it("passes options through to location.getHistory()", async () => {
      const location = makeMockLocation({
        id: "loc-1",
        name: "SF Loft",
        getHistory: vi.fn().mockResolvedValue([]),
      });

      mockClient.getLocationById.mockResolvedValue(location);

      await cloudHistory.getDeviceHistory({
        locationId: "loc-1",
        limit: 10,
        offset: 5,
        category: "alarm",
      });

      expect(location.getHistory).toHaveBeenCalledWith({
        limit: 10,
        offset: 5,
        category: "alarm",
      });
    });

    it("throws when location not found", async () => {
      mockClient.getLocationById.mockResolvedValue(undefined);

      await expect(
        cloudHistory.getDeviceHistory({ locationId: "nonexistent" })
      ).rejects.toThrow("Location not found: nonexistent");
    });
  });
});
