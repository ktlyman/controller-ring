/**
 * Routine logger — tracks actions taken through the tool, creating
 * an audit trail of all device commands and alarm changes.
 *
 * Delegates persistence to a RoutineStore (SQLite-backed) and
 * optionally appends entries to an NDJSON log file.
 */

import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { RoutineStore } from "../storage/routine-store.js";
import type { RoutineLogEntry } from "../types/index.js";

export class RoutineLogger {
  private logFile: string | null;

  constructor(
    private store: RoutineStore,
    logFile?: string
  ) {
    this.logFile = logFile ?? null;
  }

  /**
   * Log a routine action (command executed by the tool on behalf of an agent).
   */
  log(
    entry: Omit<RoutineLogEntry, "id" | "timestamp"> & { id?: string; timestamp?: string }
  ): RoutineLogEntry {
    const full: RoutineLogEntry = {
      id: entry.id ?? randomUUID(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
      action: entry.action,
      deviceId: entry.deviceId,
      deviceName: entry.deviceName,
      locationId: entry.locationId,
      locationName: entry.locationName,
      parameters: entry.parameters ?? {},
      result: entry.result,
      error: entry.error,
    };

    this.store.insert(full);

    if (this.logFile) {
      try {
        appendFileSync(this.logFile, JSON.stringify(full) + "\n", "utf-8");
      } catch {
        // Non-fatal
      }
    }

    return full;
  }

  /**
   * Query routine log entries.
   */
  query(filter: {
    action?: string;
    deviceId?: string;
    locationId?: string;
    result?: "success" | "failure" | "pending";
    startTime?: string;
    endTime?: string;
    limit?: number;
  } = {}): RoutineLogEntry[] {
    return this.store.query(filter);
  }

  /**
   * Return a summary of routines grouped by action.
   */
  summary(): Record<string, { total: number; success: number; failure: number }> {
    return this.store.summary();
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
