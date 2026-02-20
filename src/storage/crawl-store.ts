/**
 * Crawl state store — tracks the progress of background historic data
 * crawling for each entity (camera or location) and phase (events, videos,
 * device_history).
 */

import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { CrawlPhase, CrawlState, CrawlStatus } from "../types/index.js";

interface CrawlStateRow {
  entity_id: string;
  phase: string;
  status: string;
  pagination_key: string | null;
  oldest_fetched_at: string | null;
  newest_fetched_at: string | null;
  total_fetched: number;
  last_error: string | null;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export class CrawlStore {
  private getStmt: Statement;
  private getAllStmt: Statement;
  private getAllByPhaseStmt: Statement;
  private upsertStmt: Statement;
  private resetOneStmt: Statement;
  private resetAllStmt: Statement;

  constructor(private db: DatabaseType) {
    this.getStmt = this.db.prepare(
      "SELECT * FROM crawl_state WHERE entity_id = @entityId AND phase = @phase"
    );

    this.getAllStmt = this.db.prepare(
      "SELECT * FROM crawl_state ORDER BY entity_id, phase"
    );

    this.getAllByPhaseStmt = this.db.prepare(
      "SELECT * FROM crawl_state WHERE phase = @phase ORDER BY entity_id"
    );

    this.upsertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO crawl_state
        (entity_id, phase, status, pagination_key, oldest_fetched_at, newest_fetched_at,
         total_fetched, last_error, updated_at, started_at, completed_at)
      VALUES
        (@entityId, @phase, @status, @paginationKey, @oldestFetchedAt, @newestFetchedAt,
         @totalFetched, @lastError, datetime('now'), @startedAt, @completedAt)
    `);

    this.resetOneStmt = this.db.prepare(`
      UPDATE crawl_state
      SET status = 'idle', pagination_key = NULL, oldest_fetched_at = NULL,
          newest_fetched_at = NULL, total_fetched = 0, last_error = NULL,
          updated_at = datetime('now'), started_at = NULL, completed_at = NULL
      WHERE entity_id = @entityId AND phase = @phase
    `);

    this.resetAllStmt = this.db.prepare("DELETE FROM crawl_state");
  }

  /** Get the crawl state for a specific entity and phase. */
  getState(entityId: string, phase: CrawlPhase): CrawlState | null {
    const row = this.getStmt.get({ entityId, phase }) as CrawlStateRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  /** Get all crawl states, optionally filtered by phase. */
  getAllStates(phase?: CrawlPhase): CrawlState[] {
    const rows = phase
      ? (this.getAllByPhaseStmt.all({ phase }) as CrawlStateRow[])
      : (this.getAllStmt.all() as CrawlStateRow[]);
    return rows.map((r) => this.mapRow(r));
  }

  /** Upsert the crawl state for an entity+phase. */
  upsertState(state: CrawlState): void {
    this.upsertStmt.run({
      entityId: state.entityId,
      phase: state.phase,
      status: state.status,
      paginationKey: state.paginationKey,
      oldestFetchedAt: state.oldestFetchedAt,
      newestFetchedAt: state.newestFetchedAt,
      totalFetched: state.totalFetched,
      lastError: state.lastError,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
    });
  }

  /** Mark an entity+phase as completed. */
  markCompleted(entityId: string, phase: CrawlPhase): void {
    const existing = this.getState(entityId, phase);
    if (!existing) return;

    this.upsertState({
      ...existing,
      status: "completed",
      completedAt: new Date().toISOString(),
    });
  }

  /** Mark an entity+phase as error with message. */
  markError(entityId: string, phase: CrawlPhase, error: string): void {
    const existing = this.getState(entityId, phase);
    if (!existing) return;

    this.upsertState({
      ...existing,
      status: "error",
      lastError: error,
    });
  }

  /** Reset an entity+phase back to idle. */
  resetState(entityId: string, phase: CrawlPhase): void {
    this.resetOneStmt.run({ entityId, phase });
  }

  /** Reset all crawl states. */
  resetAll(): void {
    this.resetAllStmt.run();
  }

  private mapRow(row: CrawlStateRow): CrawlState {
    return {
      entityId: row.entity_id,
      phase: row.phase as CrawlPhase,
      status: row.status as CrawlStatus,
      paginationKey: row.pagination_key,
      oldestFetchedAt: row.oldest_fetched_at,
      newestFetchedAt: row.newest_fetched_at,
      totalFetched: row.total_fetched,
      lastError: row.last_error,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }
}
