/**
 * Cloud history — queries Ring's cloud-stored historical events
 * and video recordings for cameras and alarm devices.
 *
 * Unlike EventLogger (in-memory ring buffer of live events), this
 * module fetches on-demand from Ring's cloud APIs, which can return
 * data up to 180 days old depending on the user's Ring Protect plan.
 */

import type { RingCamera, Location } from "ring-client-api";
import type { RingClient } from "../client/ring-client.js";
import type { CloudCache } from "../storage/cloud-cache.js";
import type {
  CloudCameraEvent,
  CloudEventQuery,
  CloudEventQueryResult,
  CloudVideoResult,
  VideoSearchQuery,
  DeviceHistoryQuery,
} from "../types/index.js";

export class CloudHistory {
  private cache: CloudCache | null;

  constructor(private client: RingClient, cache?: CloudCache) {
    this.cache = cache ?? null;
  }

  // ── Cloud Camera Events ──

  /**
   * Fetch historical camera events from Ring's cloud.
   *
   * When `deviceId` is provided, queries that camera directly.
   * When only `locationId` is provided, queries all cameras at that location.
   * When neither is provided, queries across all locations.
   */
  async getEvents(query: CloudEventQuery = {}): Promise<CloudEventQueryResult> {
    // Check cache first (skip for paginated requests — they need fresh cursors)
    if (this.cache && !query.paginationKey) {
      const cached = this.cache.getCachedEvents({
        deviceId: query.deviceId,
        locationId: query.locationId,
        kind: query.kind,
        limit: query.limit,
      });
      if (cached) {
        return { events: cached, paginationKey: null, hasMore: false };
      }
    }

    const options = this.buildEventOptions(query);
    let result: CloudEventQueryResult;

    if (query.deviceId) {
      result = await this.getEventsForCamera(query.deviceId, options);
    } else if (query.locationId) {
      result = await this.getEventsForLocation(query.locationId, options);
    } else {
      // Query all locations
      const locations = await this.client.getLocations();
      const allEvents: CloudCameraEvent[] = [];

      for (const loc of locations) {
        const locResult = await this.fetchLocationEvents(loc, options);
        allEvents.push(...locResult.events);
      }

      // Sort newest-first and apply limit
      allEvents.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const limit = query.limit ?? allEvents.length;
      result = {
        events: allEvents.slice(0, limit),
        paginationKey: null,
        hasMore: false,
      };
    }

    // Cache the results for future lookups
    if (this.cache && result.events.length > 0) {
      this.cache.cacheEvents(result.events);
    }

    return result;
  }

  // ── Video Search ──

  /** Search video recordings for a camera within a date range. */
  async searchVideos(query: VideoSearchQuery): Promise<CloudVideoResult[]> {
    // Check cache first
    if (this.cache) {
      const cached = this.cache.getCachedVideos(
        query.deviceId,
        query.dateFrom,
        query.dateTo
      );
      if (cached) return cached;
    }

    const camera = await this.client.getCameraById(query.deviceId);
    if (!camera) {
      throw new Error(`Camera not found: ${query.deviceId}`);
    }

    const response = await camera.videoSearch({
      dateFrom: Date.parse(query.dateFrom),
      dateTo: Date.parse(query.dateTo),
      order: query.order ?? "desc",
    });

    const results = response.video_search.map((r) => this.mapVideoResult(r));

    // Cache the results
    if (this.cache && results.length > 0) {
      this.cache.cacheVideos(results);
    }

    return results;
  }

  // ── Recording URL ──

  /** Get a temporary playback URL for a specific recording. */
  async getRecordingUrl(
    deviceId: string,
    dingIdStr: string,
    options?: { transcoded?: boolean }
  ): Promise<string> {
    const camera = await this.client.getCameraById(deviceId);
    if (!camera) {
      throw new Error(`Camera not found: ${deviceId}`);
    }

    return camera.getRecordingUrl(dingIdStr, {
      transcoded: options?.transcoded ?? false,
    });
  }

  // ── Alarm / Device History ──

  /** Fetch alarm or beams device history for a location. */
  async getDeviceHistory(query: DeviceHistoryQuery): Promise<unknown[]> {
    const location = await this.client.getLocationById(query.locationId);
    if (!location) {
      throw new Error(`Location not found: ${query.locationId}`);
    }

    const events = await location.getHistory({
      limit: query.limit,
      offset: query.offset,
      category: query.category,
    });

    return events as unknown[];
  }

  // ── Private Helpers ──

  private buildEventOptions(query: CloudEventQuery): Record<string, unknown> {
    const opts: Record<string, unknown> = {};
    if (query.limit !== undefined) opts.limit = query.limit;
    if (query.kind !== undefined) opts.kind = query.kind;
    if (query.state !== undefined) opts.state = query.state;
    if (query.favorites !== undefined) opts.favorites = query.favorites;
    if (query.paginationKey !== undefined) opts.olderThanId = query.paginationKey;
    return opts;
  }

  private async getEventsForCamera(
    deviceId: string,
    options: Record<string, unknown>
  ): Promise<CloudEventQueryResult> {
    const camera = await this.client.getCameraById(deviceId);
    if (!camera) {
      throw new Error(`Camera not found: ${deviceId}`);
    }

    const locations = await this.client.getLocations();
    const location = locations.find((l) =>
      (l.cameras ?? []).some((c) => String(c.id) === String(deviceId))
    );

    const response = await camera.getEvents(options);
    const events = response.events.map((e) =>
      this.mapCameraEvent(e, camera, location)
    );

    const rawKey = response.meta?.pagination_key ?? null;
    const paginationKey = rawKey || null;

    return {
      events,
      paginationKey,
      hasMore: paginationKey !== null && events.length > 0,
    };
  }

  private async getEventsForLocation(
    locationId: string,
    options: Record<string, unknown>
  ): Promise<CloudEventQueryResult> {
    const location = await this.client.getLocationById(locationId);
    if (!location) {
      throw new Error(`Location not found: ${locationId}`);
    }

    return this.fetchLocationEvents(location, options);
  }

  private async fetchLocationEvents(
    location: Location,
    options: Record<string, unknown>
  ): Promise<CloudEventQueryResult> {
    const response = await location.getCameraEvents(options);
    const cameras = location.cameras ?? [];

    // Build a lookup from doorbot_id → camera for name resolution
    const cameraMap = new Map<number, RingCamera>();
    for (const cam of cameras) {
      cameraMap.set(cam.id, cam);
    }

    const events = response.events.map((e) => {
      const camera = cameraMap.get(e.doorbot_id);
      return this.mapCameraEvent(e, camera, location);
    });

    const rawKey = response.meta?.pagination_key ?? null;
    const paginationKey = rawKey || null;

    return {
      events,
      paginationKey,
      hasMore: paginationKey !== null && events.length > 0,
    };
  }

  private mapCameraEvent(
    event: { created_at: string; ding_id: number; ding_id_str: string; doorbot_id: number; favorite: boolean; kind: string; recording_status: string; state: string; cv_properties: { person_detected: unknown; detection_type: unknown; stream_broken: unknown } },
    camera: RingCamera | undefined,
    location: Location | undefined
  ): CloudCameraEvent {
    return {
      id: event.ding_id_str,
      dingIdStr: event.ding_id_str,
      deviceId: String(event.doorbot_id),
      deviceName: camera?.name ?? `Camera ${event.doorbot_id}`,
      locationId: location?.id ?? "unknown",
      locationName: location?.name ?? "unknown",
      kind: event.kind as CloudCameraEvent["kind"],
      createdAt: event.created_at,
      favorite: event.favorite,
      recordingStatus: event.recording_status,
      state: event.state,
      cvProperties: {
        personDetected: event.cv_properties.person_detected,
        detectionType: event.cv_properties.detection_type,
        streamBroken: event.cv_properties.stream_broken,
      },
    };
  }

  private mapVideoResult(result: {
    ding_id: string;
    created_at: number;
    kind: string;
    state: string;
    duration: number;
    favorite: boolean;
    thumbnail_url: string;
    lq_url: string;
    hq_url: string | null;
    untranscoded_url: string;
    cv_properties: { person_detected: unknown; detection_type: unknown; stream_broken: unknown };
  }): CloudVideoResult {
    return {
      dingId: result.ding_id,
      createdAt: new Date(result.created_at).toISOString(),
      kind: result.kind as CloudVideoResult["kind"],
      state: result.state,
      duration: result.duration,
      favorite: result.favorite,
      thumbnailUrl: result.thumbnail_url || null,
      lqUrl: result.lq_url,
      hqUrl: result.hq_url,
      untranscodedUrl: result.untranscoded_url,
      cvProperties: {
        personDetected: result.cv_properties.person_detected,
        detectionType: result.cv_properties.detection_type,
        streamBroken: result.cv_properties.stream_broken,
      },
    };
  }
}
