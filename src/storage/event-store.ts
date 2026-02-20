/**
 * Event store — persists Ring events in SQLite and provides
 * efficient filtered queries and summary aggregation.
 */

import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { RingEvent, EventQuery, RingEventType } from "../types/index.js";

export class EventStore {
  private insertStmt: Statement;
  private countStmt: Statement;
  private deleteOldestStmt: Statement;
  private clearStmt: Statement;

  constructor(
    private db: DatabaseType,
    private maxSize: number
  ) {
    this.insertStmt = db.prepare(`
      INSERT OR REPLACE INTO events
        (id, timestamp, device_id, device_name, location_id, location_name, type, duration_sec, recording_url, snapshot_base64, metadata)
      VALUES
        (@id, @timestamp, @deviceId, @deviceName, @locationId, @locationName, @type, @durationSec, @recordingUrl, @snapshotBase64, @metadata)
    `);

    this.countStmt = db.prepare("SELECT COUNT(*) as count FROM events");

    this.deleteOldestStmt = db.prepare(`
      DELETE FROM events WHERE id IN (
        SELECT id FROM events ORDER BY timestamp ASC LIMIT @excess
      )
    `);

    this.clearStmt = db.prepare("DELETE FROM events");
  }

  /** Insert an event and trim the oldest entries if over maxSize. */
  insert(event: RingEvent): void {
    this.insertStmt.run({
      id: event.id,
      timestamp: event.timestamp,
      deviceId: event.deviceId,
      deviceName: event.deviceName,
      locationId: event.locationId,
      locationName: event.locationName,
      type: event.type,
      durationSec: event.durationSec ?? null,
      recordingUrl: event.recordingUrl ?? null,
      snapshotBase64: event.snapshotBase64 ?? null,
      metadata: JSON.stringify(event.metadata),
    });

    this.trimIfNeeded();
  }

  /** Query events with optional filters, ordered newest-first. */
  query(filter: EventQuery = {}): RingEvent[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.deviceId) {
      conditions.push("device_id = @deviceId");
      params.deviceId = filter.deviceId;
    }
    if (filter.locationId) {
      conditions.push("location_id = @locationId");
      params.locationId = filter.locationId;
    }
    if (filter.type) {
      conditions.push("type = @type");
      params.type = filter.type;
    }
    if (filter.startTime) {
      conditions.push("timestamp >= @startTime");
      params.startTime = filter.startTime;
    }
    if (filter.endTime) {
      conditions.push("timestamp <= @endTime");
      params.endTime = filter.endTime;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ? `LIMIT @limit` : "";
    if (filter.limit) {
      params.limit = filter.limit;
    }

    const sql = `SELECT * FROM events ${where} ORDER BY timestamp DESC ${limit}`;
    const rows = this.db.prepare(sql).all(params) as EventRow[];

    return rows.map(rowToEvent);
  }

  /** Get event counts grouped by type, with optional filters. */
  summary(filter: Omit<EventQuery, "limit"> = {}): Record<RingEventType, number> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.deviceId) {
      conditions.push("device_id = @deviceId");
      params.deviceId = filter.deviceId;
    }
    if (filter.locationId) {
      conditions.push("location_id = @locationId");
      params.locationId = filter.locationId;
    }
    if (filter.type) {
      conditions.push("type = @type");
      params.type = filter.type;
    }
    if (filter.startTime) {
      conditions.push("timestamp >= @startTime");
      params.startTime = filter.startTime;
    }
    if (filter.endTime) {
      conditions.push("timestamp <= @endTime");
      params.endTime = filter.endTime;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT type, COUNT(*) as count FROM events ${where} GROUP BY type`;
    const rows = this.db.prepare(sql).all(params) as { type: string; count: number }[];

    const counts = {} as Record<string, number>;
    for (const row of rows) {
      counts[row.type] = row.count;
    }
    return counts as Record<RingEventType, number>;
  }

  /** Delete all events. */
  clear(): void {
    this.clearStmt.run();
  }

  /** Total number of stored events. */
  get size(): number {
    const row = this.countStmt.get() as { count: number };
    return row.count;
  }

  private trimIfNeeded(): void {
    const currentSize = this.size;
    if (currentSize > this.maxSize) {
      this.deleteOldestStmt.run({ excess: currentSize - this.maxSize });
    }
  }
}

// ── Row Mapping ──

interface EventRow {
  id: string;
  timestamp: string;
  device_id: string;
  device_name: string;
  location_id: string;
  location_name: string;
  type: string;
  duration_sec: number | null;
  recording_url: string | null;
  snapshot_base64: string | null;
  metadata: string;
}

function rowToEvent(row: EventRow): RingEvent {
  return {
    id: row.id,
    timestamp: row.timestamp,
    deviceId: row.device_id,
    deviceName: row.device_name,
    locationId: row.location_id,
    locationName: row.location_name,
    type: row.type as RingEventType,
    durationSec: row.duration_sec ?? undefined,
    recordingUrl: row.recording_url ?? undefined,
    snapshotBase64: row.snapshot_base64 ?? undefined,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  };
}
