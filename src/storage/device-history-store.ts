/**
 * Device history store — persists alarm/beams device history events
 * fetched from Ring's cloud API. These events are untyped (unknown[])
 * from the Ring API, so we store the full JSON body alongside extracted
 * index fields for queryability.
 */

import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { DeviceHistoryEntry, DeviceHistoryStoreQuery } from "../types/index.js";

interface DeviceHistoryRow {
  id: number;
  location_id: string;
  device_id: string | null;
  device_name: string | null;
  event_type: string | null;
  created_at: string | null;
  body: string;
  cached_at: string;
}

export class DeviceHistoryStore {
  private insertStmt: Statement;
  private countStmt: Statement;
  private clearStmt: Statement;
  private newestStmt: Statement;

  constructor(private db: DatabaseType) {
    this.insertStmt = this.db.prepare(`
      INSERT INTO device_history
        (location_id, device_id, device_name, event_type, created_at, body, cached_at)
      VALUES
        (@locationId, @deviceId, @deviceName, @eventType, @createdAt, @body, datetime('now'))
    `);

    this.countStmt = this.db.prepare("SELECT COUNT(*) as count FROM device_history");

    this.clearStmt = this.db.prepare("DELETE FROM device_history");

    this.newestStmt = this.db.prepare(
      "SELECT MAX(created_at) as newest FROM device_history WHERE location_id = @locationId"
    );
  }

  /**
   * Insert device history events for a location.
   * Extracts device_id, device_name, event_type, and created_at from each
   * raw event body where possible.
   */
  insert(locationId: string, events: unknown[]): number {
    let inserted = 0;
    const insertMany = this.db.transaction((evts: unknown[]) => {
      for (const event of evts) {
        const parsed = this.extractFields(event);
        const bodyStr = JSON.stringify(event);

        // Check for duplicate by matching location + body hash
        const exists = this.db
          .prepare(
            "SELECT 1 FROM device_history WHERE location_id = @locationId AND body = @body LIMIT 1"
          )
          .get({ locationId, body: bodyStr });

        if (!exists) {
          this.insertStmt.run({
            locationId,
            deviceId: parsed.deviceId,
            deviceName: parsed.deviceName,
            eventType: parsed.eventType,
            createdAt: parsed.createdAt,
            body: bodyStr,
          });
          inserted++;
        }
      }
    });
    insertMany(events);
    return inserted;
  }

  /** Query device history events with optional filters. */
  query(filter: DeviceHistoryStoreQuery = {}): DeviceHistoryEntry[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.locationId !== undefined) {
      conditions.push("location_id = @locationId");
      params.locationId = filter.locationId;
    }
    if (filter.deviceId !== undefined) {
      conditions.push("device_id = @deviceId");
      params.deviceId = filter.deviceId;
    }
    if (filter.eventType !== undefined) {
      conditions.push("event_type = @eventType");
      params.eventType = filter.eventType;
    }
    if (filter.startTime !== undefined) {
      conditions.push("created_at >= @startTime");
      params.startTime = filter.startTime;
    }
    if (filter.endTime !== undefined) {
      conditions.push("created_at <= @endTime");
      params.endTime = filter.endTime;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit !== undefined ? `LIMIT ${Number(filter.limit)}` : "";

    const sql = `SELECT * FROM device_history ${where} ORDER BY created_at DESC ${limit}`;
    const rows = this.db.prepare(sql).all(params) as DeviceHistoryRow[];

    return rows.map((r) => this.mapRow(r));
  }

  /** Get the newest event timestamp for a location. */
  getNewestTimestamp(locationId: string): string | null {
    const row = this.newestStmt.get({ locationId }) as { newest: string | null };
    return row.newest;
  }

  /** Get the total number of stored device history events. */
  get size(): number {
    const row = this.countStmt.get() as { count: number };
    return row.count;
  }

  /** Delete all device history events. */
  clear(): void {
    this.clearStmt.run();
  }

  /** Extract queryable fields from a raw Ring device history event. */
  private extractFields(event: unknown): {
    deviceId: string | null;
    deviceName: string | null;
    eventType: string | null;
    createdAt: string | null;
  } {
    if (typeof event !== "object" || event === null) {
      return { deviceId: null, deviceName: null, eventType: null, createdAt: null };
    }

    const obj = event as Record<string, unknown>;

    const deviceId = typeof obj.device_id === "string"
      ? obj.device_id
      : typeof obj.zid === "number"
        ? String(obj.zid)
        : null;

    const deviceName = typeof obj.device_name === "string"
      ? obj.device_name
      : typeof obj.name === "string"
        ? obj.name
        : null;

    const eventType = typeof obj.type === "string"
      ? obj.type
      : typeof obj.action === "string"
        ? obj.action
        : null;

    const createdAt = typeof obj.created_at === "string"
      ? obj.created_at
      : typeof obj.datestamp === "string"
        ? obj.datestamp
        : typeof obj.timestamp === "number"
          ? new Date(obj.timestamp * 1000).toISOString()
          : null;

    return { deviceId, deviceName, eventType, createdAt };
  }

  private mapRow(row: DeviceHistoryRow): DeviceHistoryEntry {
    return {
      id: row.id,
      locationId: row.location_id,
      deviceId: row.device_id,
      deviceName: row.device_name,
      eventType: row.event_type,
      createdAt: row.created_at,
      body: JSON.parse(row.body) as Record<string, unknown>,
      cachedAt: row.cached_at,
    };
  }
}
