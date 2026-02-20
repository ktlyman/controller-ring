/**
 * Event logger — captures, stores, and queries Ring events.
 *
 * Maintains an in-memory ring buffer of recent events and optionally
 * appends them to a log file for persistence.
 */

import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { RingEvent, EventQuery, RingEventType } from "../types/index.js";

export class EventLogger {
  private events: RingEvent[] = [];
  private maxSize: number;
  private logFile: string | null;

  constructor(maxSize = 1000, logFile?: string) {
    this.maxSize = maxSize;
    this.logFile = logFile ?? null;
  }

  /**
   * Record an event and optionally persist it to disk.
   */
  record(event: Omit<RingEvent, "id" | "timestamp"> & { id?: string; timestamp?: string }): RingEvent {
    const fullEvent: RingEvent = {
      id: event.id ?? randomUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      deviceId: event.deviceId,
      deviceName: event.deviceName,
      locationId: event.locationId,
      locationName: event.locationName,
      type: event.type,
      durationSec: event.durationSec,
      recordingUrl: event.recordingUrl,
      snapshotBase64: event.snapshotBase64,
      metadata: event.metadata ?? {},
    };

    this.events.push(fullEvent);

    // Trim to max size (ring buffer behaviour)
    if (this.events.length > this.maxSize) {
      this.events = this.events.slice(this.events.length - this.maxSize);
    }

    // Persist to file
    if (this.logFile) {
      try {
        const line = JSON.stringify(fullEvent) + "\n";
        appendFileSync(this.logFile, line, "utf-8");
      } catch {
        // Non-fatal
      }
    }

    return fullEvent;
  }

  /**
   * Query stored events with optional filters.
   */
  query(filter: EventQuery = {}): RingEvent[] {
    let results = [...this.events];

    if (filter.deviceId) {
      results = results.filter((e) => e.deviceId === filter.deviceId);
    }
    if (filter.locationId) {
      results = results.filter((e) => e.locationId === filter.locationId);
    }
    if (filter.type) {
      results = results.filter((e) => e.type === filter.type);
    }
    if (filter.startTime) {
      const start = new Date(filter.startTime).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() >= start);
    }
    if (filter.endTime) {
      const end = new Date(filter.endTime).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() <= end);
    }

    // Sort newest first
    results.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    if (filter.limit && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Get a summary count of events grouped by type.
   */
  summary(filter: Omit<EventQuery, "limit"> = {}): Record<RingEventType, number> {
    const events = this.query({ ...filter, limit: undefined });
    const counts = {} as Record<string, number>;

    for (const event of events) {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
    }

    return counts as Record<RingEventType, number>;
  }

  /**
   * Clear all in-memory events.
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Return the total number of events stored in memory.
   */
  get size(): number {
    return this.events.length;
  }
}
