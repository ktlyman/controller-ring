/**
 * Test utilities for SQLite-backed storage.
 *
 * Creates in-memory databases so tests run fast and isolated.
 */

import { RingDatabase } from "../../src/storage/database.js";
import { EventStore } from "../../src/storage/event-store.js";
import { RoutineStore } from "../../src/storage/routine-store.js";
import { CloudCache } from "../../src/storage/cloud-cache.js";

/** Create an in-memory RingDatabase for tests. */
export function createTestDatabase(): RingDatabase {
  return new RingDatabase({ filePath: ":memory:" });
}

/** Create an in-memory EventStore with the given max size. */
export function createTestEventStore(maxSize = 100): EventStore {
  const db = createTestDatabase();
  return new EventStore(db.getConnection(), maxSize);
}

/** Create an in-memory RoutineStore with the given max size. */
export function createTestRoutineStore(maxSize = 100): RoutineStore {
  const db = createTestDatabase();
  return new RoutineStore(db.getConnection(), maxSize);
}

/** Create an in-memory CloudCache with the given max age in ms. */
export function createTestCloudCache(maxAgeMs = 30 * 60 * 1000): CloudCache {
  const db = createTestDatabase();
  return new CloudCache(db.getConnection(), maxAgeMs);
}
