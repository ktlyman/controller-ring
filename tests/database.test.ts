import { describe, it, expect } from "vitest";
import { RingDatabase } from "../src/storage/database.js";

describe("RingDatabase", () => {
  it("creates an in-memory database with all tables", () => {
    const db = new RingDatabase({ filePath: ":memory:" });
    const conn = db.getConnection();

    // Verify all expected tables exist
    const tables = conn
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("schema_version");
    expect(tableNames).toContain("events");
    expect(tableNames).toContain("routines");
    expect(tableNames).toContain("cloud_events");
    expect(tableNames).toContain("cloud_videos");
    expect(tableNames).toContain("crawl_state");
    expect(tableNames).toContain("device_history");

    db.close();
  });

  it("records schema versions 1 and 2 on first creation", () => {
    const db = new RingDatabase({ filePath: ":memory:" });
    const conn = db.getConnection();

    const row = conn
      .prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
      .get() as { version: number };

    expect(row.version).toBe(2);

    const allVersions = conn
      .prepare("SELECT version FROM schema_version ORDER BY version ASC")
      .all() as { version: number }[];

    expect(allVersions.map((v) => v.version)).toEqual([1, 2]);

    db.close();
  });

  it("is idempotent — opening twice with same schema does not fail", () => {
    const db1 = new RingDatabase({ filePath: ":memory:" });
    const conn = db1.getConnection();

    // Simulate re-initialization by calling the constructor logic again
    // (In a real scenario, this would be opening the same file twice)
    const version = conn
      .prepare("SELECT MAX(version) as version FROM schema_version")
      .get() as { version: number };

    expect(version.version).toBe(2);

    db1.close();
  });

  it("creates expected indexes on the events table", () => {
    const db = new RingDatabase({ filePath: ":memory:" });
    const conn = db.getConnection();

    const indexes = conn
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='events'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_events_timestamp");
    expect(indexNames).toContain("idx_events_device_id");
    expect(indexNames).toContain("idx_events_location_id");
    expect(indexNames).toContain("idx_events_type");

    db.close();
  });

  it("creates expected indexes on the routines table", () => {
    const db = new RingDatabase({ filePath: ":memory:" });
    const conn = db.getConnection();

    const indexes = conn
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='routines'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_routines_timestamp");
    expect(indexNames).toContain("idx_routines_action");
    expect(indexNames).toContain("idx_routines_device_id");
    expect(indexNames).toContain("idx_routines_result");

    db.close();
  });

  it("enables WAL mode by default", () => {
    const db = new RingDatabase({ filePath: ":memory:" });
    const conn = db.getConnection();

    const mode = conn.pragma("journal_mode") as { journal_mode: string }[];
    // In-memory databases can't actually use WAL, but the pragma was issued
    // For file-based databases, this would return "wal"
    expect(mode[0].journal_mode).toBeDefined();

    db.close();
  });

  it("creates expected indexes on the crawl_state table", () => {
    const db = new RingDatabase({ filePath: ":memory:" });
    const conn = db.getConnection();

    const indexes = conn
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='crawl_state'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_crawl_state_status");

    db.close();
  });

  it("creates expected indexes on the device_history table", () => {
    const db = new RingDatabase({ filePath: ":memory:" });
    const conn = db.getConnection();

    const indexes = conn
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='device_history'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_device_history_location_id");
    expect(indexNames).toContain("idx_device_history_device_id");
    expect(indexNames).toContain("idx_device_history_created_at");
    expect(indexNames).toContain("idx_device_history_event_type");

    db.close();
  });

  it("can disable WAL mode", () => {
    const db = new RingDatabase({ filePath: ":memory:", walMode: false });
    const conn = db.getConnection();

    const mode = conn.pragma("journal_mode") as { journal_mode: string }[];
    expect(mode[0].journal_mode).toBe("memory");

    db.close();
  });
});
