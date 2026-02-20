/**
 * Cloud cache — caches cloud camera events and video search results
 * in SQLite for offline access and reduced API calls.
 *
 * Uses a cache-aside pattern: check cache first, fetch from API on
 * miss, store results for future lookups.
 */

import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { CloudCameraEvent, CloudVideoResult } from "../types/index.js";

export class CloudCache {
  private insertEventStmt: Statement;
  private insertVideoStmt: Statement;
  private pruneEventsStmt: Statement;
  private pruneVideosStmt: Statement;

  constructor(
    private db: DatabaseType,
    private maxAgeMs: number = 30 * 60 * 1000
  ) {
    this.insertEventStmt = db.prepare(`
      INSERT OR REPLACE INTO cloud_events
        (id, ding_id_str, device_id, device_name, location_id, location_name,
         kind, created_at, favorite, recording_status, state, cv_properties, cached_at)
      VALUES
        (@id, @dingIdStr, @deviceId, @deviceName, @locationId, @locationName,
         @kind, @createdAt, @favorite, @recordingStatus, @state, @cvProperties, datetime('now'))
    `);

    this.insertVideoStmt = db.prepare(`
      INSERT OR REPLACE INTO cloud_videos
        (ding_id, created_at, kind, state, duration, favorite,
         thumbnail_url, lq_url, hq_url, untranscoded_url, cv_properties, cached_at)
      VALUES
        (@dingId, @createdAt, @kind, @state, @duration, @favorite,
         @thumbnailUrl, @lqUrl, @hqUrl, @untranscodedUrl, @cvProperties, datetime('now'))
    `);

    this.pruneEventsStmt = db.prepare(
      "DELETE FROM cloud_events WHERE cached_at < datetime('now', @offset)"
    );

    this.pruneVideosStmt = db.prepare(
      "DELETE FROM cloud_videos WHERE cached_at < datetime('now', @offset)"
    );
  }

  // ── Cloud Events ──

  /** Cache a batch of cloud camera events (upsert). */
  cacheEvents(events: CloudCameraEvent[]): void {
    const batch = this.db.transaction(() => {
      for (const event of events) {
        this.insertEventStmt.run({
          id: event.id,
          dingIdStr: event.dingIdStr,
          deviceId: event.deviceId,
          deviceName: event.deviceName,
          locationId: event.locationId,
          locationName: event.locationName,
          kind: event.kind,
          createdAt: event.createdAt,
          favorite: event.favorite ? 1 : 0,
          recordingStatus: event.recordingStatus,
          state: event.state,
          cvProperties: JSON.stringify(event.cvProperties),
        });
      }
    });
    batch();
  }

  /**
   * Look up cached cloud events matching the given criteria.
   * Returns null on cache miss (no cached data for these params or data is stale).
   */
  getCachedEvents(query: {
    deviceId?: string;
    locationId?: string;
    kind?: string;
    limit?: number;
  }): CloudCameraEvent[] | null {
    const conditions: string[] = [
      `cached_at >= datetime('now', @offset)`,
    ];
    const params: Record<string, unknown> = {
      offset: this.sqliteOffset(),
    };

    if (query.deviceId) {
      conditions.push("device_id = @deviceId");
      params.deviceId = query.deviceId;
    }
    if (query.locationId) {
      conditions.push("location_id = @locationId");
      params.locationId = query.locationId;
    }
    if (query.kind) {
      conditions.push("kind = @kind");
      params.kind = query.kind;
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const limit = query.limit ? `LIMIT @limit` : "";
    if (query.limit) {
      params.limit = query.limit;
    }

    const sql = `SELECT * FROM cloud_events ${where} ORDER BY created_at DESC ${limit}`;
    const rows = this.db.prepare(sql).all(params) as CloudEventRow[];

    if (rows.length === 0) return null;

    return rows.map(rowToCloudEvent);
  }

  // ── Cloud Videos ──

  /** Cache a batch of video search results (upsert). */
  cacheVideos(videos: CloudVideoResult[]): void {
    const batch = this.db.transaction(() => {
      for (const video of videos) {
        this.insertVideoStmt.run({
          dingId: video.dingId,
          createdAt: video.createdAt,
          kind: video.kind,
          state: video.state,
          duration: video.duration,
          favorite: video.favorite ? 1 : 0,
          thumbnailUrl: video.thumbnailUrl ?? null,
          lqUrl: video.lqUrl,
          hqUrl: video.hqUrl ?? null,
          untranscodedUrl: video.untranscodedUrl,
          cvProperties: JSON.stringify(video.cvProperties),
        });
      }
    });
    batch();
  }

  /**
   * Look up cached video results for a device within a date range.
   * Returns null on cache miss (no fresh cached data).
   */
  getCachedVideos(
    deviceId: string,
    dateFrom: string,
    dateTo: string
  ): CloudVideoResult[] | null {
    const sql = `
      SELECT * FROM cloud_videos
      WHERE cached_at >= datetime('now', @offset)
        AND created_at >= @dateFrom
        AND created_at <= @dateTo
      ORDER BY created_at DESC
    `;
    const rows = this.db.prepare(sql).all({
      offset: this.sqliteOffset(),
      dateFrom,
      dateTo,
    }) as CloudVideoRow[];

    if (rows.length === 0) return null;

    return rows.map(rowToCloudVideo);
  }

  // ── Maintenance ──

  /** Remove cached entries older than maxAge. */
  pruneStale(): void {
    const offset = this.sqliteOffset();
    this.pruneEventsStmt.run({ offset });
    this.pruneVideosStmt.run({ offset });
  }

  /** Convert maxAgeMs to a negative SQLite time offset string. */
  private sqliteOffset(): string {
    const seconds = Math.floor(this.maxAgeMs / 1000);
    return `-${seconds} seconds`;
  }
}

// ── Row Types & Mapping ──

interface CloudEventRow {
  id: string;
  ding_id_str: string;
  device_id: string;
  device_name: string;
  location_id: string;
  location_name: string;
  kind: string;
  created_at: string;
  favorite: number;
  recording_status: string;
  state: string;
  cv_properties: string;
  cached_at: string;
}

function rowToCloudEvent(row: CloudEventRow): CloudCameraEvent {
  const cv = JSON.parse(row.cv_properties) as {
    personDetected: unknown;
    detectionType: unknown;
    streamBroken: unknown;
  };
  return {
    id: row.id,
    dingIdStr: row.ding_id_str,
    deviceId: row.device_id,
    deviceName: row.device_name,
    locationId: row.location_id,
    locationName: row.location_name,
    kind: row.kind as CloudCameraEvent["kind"],
    createdAt: row.created_at,
    favorite: row.favorite === 1,
    recordingStatus: row.recording_status,
    state: row.state,
    cvProperties: {
      personDetected: cv.personDetected,
      detectionType: cv.detectionType,
      streamBroken: cv.streamBroken,
    },
  };
}

interface CloudVideoRow {
  ding_id: string;
  created_at: string;
  kind: string;
  state: string;
  duration: number;
  favorite: number;
  thumbnail_url: string | null;
  lq_url: string;
  hq_url: string | null;
  untranscoded_url: string;
  cv_properties: string;
  cached_at: string;
}

function rowToCloudVideo(row: CloudVideoRow): CloudVideoResult {
  const cv = JSON.parse(row.cv_properties) as {
    personDetected: unknown;
    detectionType: unknown;
    streamBroken: unknown;
  };
  return {
    dingId: row.ding_id,
    createdAt: row.created_at,
    kind: row.kind as CloudVideoResult["kind"],
    state: row.state,
    duration: row.duration,
    favorite: row.favorite === 1,
    thumbnailUrl: row.thumbnail_url,
    lqUrl: row.lq_url,
    hqUrl: row.hq_url,
    untranscodedUrl: row.untranscoded_url,
    cvProperties: {
      personDetected: cv.personDetected,
      detectionType: cv.detectionType,
      streamBroken: cv.streamBroken,
    },
  };
}
