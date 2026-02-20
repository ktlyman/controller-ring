/**
 * Shared SQLite database — manages the connection, schema creation,
 * and migration versioning for all storage modules.
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

const CURRENT_SCHEMA_VERSION = 1;

export interface DatabaseConfig {
  /** Path to the SQLite database file. Use ":memory:" for tests. */
  filePath?: string;
  /** Enable WAL mode for better concurrent read performance. Default: true */
  walMode?: boolean;
}

export class RingDatabase {
  private db: DatabaseType;

  constructor(config: DatabaseConfig = {}) {
    const filePath = config.filePath ?? "./ring-data.db";
    this.db = new Database(filePath);

    if (config.walMode !== false) {
      this.db.pragma("journal_mode = WAL");
    }

    this.initializeSchema();
  }

  /** Return the raw better-sqlite3 connection for store classes. */
  getConnection(): DatabaseType {
    return this.db;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  private initializeSchema(): void {
    const hasVersionTable = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
      )
      .get();

    let currentVersion = 0;
    if (hasVersionTable) {
      const row = this.db
        .prepare("SELECT MAX(version) as version FROM schema_version")
        .get() as { version: number } | undefined;
      currentVersion = row?.version ?? 0;
    }

    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      this.applyMigrations(currentVersion);
    }
  }

  private applyMigrations(fromVersion: number): void {
    const migrate = this.db.transaction(() => {
      if (fromVersion < 1) {
        this.migrateToV1();
      }
    });
    migrate();
  }

  private migrateToV1(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        location_id TEXT NOT NULL,
        location_name TEXT NOT NULL,
        type TEXT NOT NULL,
        duration_sec REAL,
        recording_url TEXT,
        snapshot_base64 TEXT,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_events_device_id ON events(device_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_events_location_id ON events(location_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        device_id TEXT,
        device_name TEXT,
        location_id TEXT NOT NULL,
        location_name TEXT NOT NULL,
        parameters TEXT NOT NULL DEFAULT '{}',
        result TEXT NOT NULL,
        error TEXT
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_routines_timestamp ON routines(timestamp)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_routines_action ON routines(action)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_routines_device_id ON routines(device_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_routines_result ON routines(result)");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_events (
        id TEXT PRIMARY KEY,
        ding_id_str TEXT NOT NULL UNIQUE,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        location_id TEXT NOT NULL,
        location_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        recording_status TEXT NOT NULL,
        state TEXT NOT NULL,
        cv_properties TEXT NOT NULL DEFAULT '{}',
        cached_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_cloud_events_device_id ON cloud_events(device_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_cloud_events_created_at ON cloud_events(created_at)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_cloud_events_kind ON cloud_events(kind)");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_videos (
        ding_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        duration REAL NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        thumbnail_url TEXT,
        lq_url TEXT NOT NULL,
        hq_url TEXT,
        untranscoded_url TEXT NOT NULL,
        cv_properties TEXT NOT NULL DEFAULT '{}',
        cached_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_cloud_videos_created_at ON cloud_videos(created_at)");

    this.db.prepare(
      "INSERT INTO schema_version (version, applied_at) VALUES (?, datetime('now'))"
    ).run(1);
  }
}
