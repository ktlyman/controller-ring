/**
 * Event logger — captures, stores, and queries Ring events.
 *
 * Delegates persistence to an EventStore (SQLite-backed) and
 * optionally appends events to an NDJSON log file.
 */

import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { EventStore } from "../storage/event-store.js";
import type { RingEvent, EventQuery, RingEventType } from "../types/index.js";

export class EventLogger {
  private logFile: string | null;

  constructor(
    private store: EventStore,
    logFile?: string
  ) {
    this.logFile = logFile ?? null;
  }

  /**
   * Record an event, persist it to SQLite, and optionally to a log file.
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

    this.store.insert(fullEvent);

    // Persist to file (append-only log)
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
    return this.store.query(filter);
  }

  /**
   * Get a summary count of events grouped by type.
   */
  summary(filter: Omit<EventQuery, "limit"> = {}): Record<RingEventType, number> {
    return this.store.summary(filter);
  }

  /**
   * Clear all stored events.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Return the total number of events stored.
   */
  get size(): number {
    return this.store.size;
  }
}
