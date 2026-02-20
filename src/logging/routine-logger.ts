/**
 * Routine logger — tracks actions taken through the tool, creating
 * an audit trail of all device commands and alarm changes.
 */

import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { RoutineLogEntry } from "../types/index.js";

export class RoutineLogger {
  private entries: RoutineLogEntry[] = [];
  private maxSize: number;
  private logFile: string | null;

  constructor(maxSize = 500, logFile?: string) {
    this.maxSize = maxSize;
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

    this.entries.push(full);

    if (this.entries.length > this.maxSize) {
      this.entries = this.entries.slice(this.entries.length - this.maxSize);
    }

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
    let results = [...this.entries];

    if (filter.action) {
      results = results.filter((e) => e.action === filter.action);
    }
    if (filter.deviceId) {
      results = results.filter((e) => e.deviceId === filter.deviceId);
    }
    if (filter.locationId) {
      results = results.filter((e) => e.locationId === filter.locationId);
    }
    if (filter.result) {
      results = results.filter((e) => e.result === filter.result);
    }
    if (filter.startTime) {
      const start = new Date(filter.startTime).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() >= start);
    }
    if (filter.endTime) {
      const end = new Date(filter.endTime).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() <= end);
    }

    results.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    if (filter.limit && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Return a summary of routines grouped by action.
   */
  summary(): Record<string, { total: number; success: number; failure: number }> {
    const summary: Record<string, { total: number; success: number; failure: number }> = {};

    for (const entry of this.entries) {
      if (!summary[entry.action]) {
        summary[entry.action] = { total: 0, success: 0, failure: 0 };
      }
      summary[entry.action].total++;
      if (entry.result === "success") summary[entry.action].success++;
      if (entry.result === "failure") summary[entry.action].failure++;
    }

    return summary;
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}
