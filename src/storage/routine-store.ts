/**
 * Routine store — persists routine audit log entries in SQLite
 * and provides efficient filtered queries and summary aggregation.
 */

import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { RoutineLogEntry } from "../types/index.js";

export class RoutineStore {
  private insertStmt: Statement;
  private countStmt: Statement;
  private deleteOldestStmt: Statement;
  private clearStmt: Statement;

  constructor(
    private db: DatabaseType,
    private maxSize: number
  ) {
    this.insertStmt = db.prepare(`
      INSERT OR REPLACE INTO routines
        (id, timestamp, action, device_id, device_name, location_id, location_name, parameters, result, error)
      VALUES
        (@id, @timestamp, @action, @deviceId, @deviceName, @locationId, @locationName, @parameters, @result, @error)
    `);

    this.countStmt = db.prepare("SELECT COUNT(*) as count FROM routines");

    this.deleteOldestStmt = db.prepare(`
      DELETE FROM routines WHERE id IN (
        SELECT id FROM routines ORDER BY timestamp ASC LIMIT @excess
      )
    `);

    this.clearStmt = db.prepare("DELETE FROM routines");
  }

  /** Insert a routine log entry and trim oldest if over maxSize. */
  insert(entry: RoutineLogEntry): void {
    this.insertStmt.run({
      id: entry.id,
      timestamp: entry.timestamp,
      action: entry.action,
      deviceId: entry.deviceId ?? null,
      deviceName: entry.deviceName ?? null,
      locationId: entry.locationId,
      locationName: entry.locationName,
      parameters: JSON.stringify(entry.parameters),
      result: entry.result,
      error: entry.error ?? null,
    });

    this.trimIfNeeded();
  }

  /** Query routine log entries with optional filters, ordered newest-first. */
  query(filter: {
    action?: string;
    deviceId?: string;
    locationId?: string;
    result?: "success" | "failure" | "pending";
    startTime?: string;
    endTime?: string;
    limit?: number;
  } = {}): RoutineLogEntry[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.action) {
      conditions.push("action = @action");
      params.action = filter.action;
    }
    if (filter.deviceId) {
      conditions.push("device_id = @deviceId");
      params.deviceId = filter.deviceId;
    }
    if (filter.locationId) {
      conditions.push("location_id = @locationId");
      params.locationId = filter.locationId;
    }
    if (filter.result) {
      conditions.push("result = @result");
      params.result = filter.result;
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

    const sql = `SELECT * FROM routines ${where} ORDER BY timestamp DESC ${limit}`;
    const rows = this.db.prepare(sql).all(params) as RoutineRow[];

    return rows.map(rowToEntry);
  }

  /** Get routine counts grouped by action, with success/failure breakdown. */
  summary(): Record<string, { total: number; success: number; failure: number }> {
    const sql = `
      SELECT
        action,
        COUNT(*) as total,
        SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN result = 'failure' THEN 1 ELSE 0 END) as failure
      FROM routines
      GROUP BY action
    `;
    const rows = this.db.prepare(sql).all() as {
      action: string;
      total: number;
      success: number;
      failure: number;
    }[];

    const result: Record<string, { total: number; success: number; failure: number }> = {};
    for (const row of rows) {
      result[row.action] = {
        total: row.total,
        success: row.success,
        failure: row.failure,
      };
    }
    return result;
  }

  /** Delete all routine entries. */
  clear(): void {
    this.clearStmt.run();
  }

  /** Total number of stored routine entries. */
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

interface RoutineRow {
  id: string;
  timestamp: string;
  action: string;
  device_id: string | null;
  device_name: string | null;
  location_id: string;
  location_name: string;
  parameters: string;
  result: string;
  error: string | null;
}

function rowToEntry(row: RoutineRow): RoutineLogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    action: row.action,
    deviceId: row.device_id ?? undefined,
    deviceName: row.device_name ?? undefined,
    locationId: row.location_id,
    locationName: row.location_name,
    parameters: JSON.parse(row.parameters) as Record<string, unknown>,
    result: row.result as RoutineLogEntry["result"],
    error: row.error ?? undefined,
  };
}
