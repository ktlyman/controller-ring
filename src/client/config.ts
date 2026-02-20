/**
 * Configuration loader — reads settings from environment variables.
 */

import type { RingToolConfig } from "../types/index.js";

export function loadConfigFromEnv(): RingToolConfig {
  const refreshToken = process.env.RING_REFRESH_TOKEN ?? "";
  const locationIds = process.env.RING_LOCATION_IDS
    ? process.env.RING_LOCATION_IDS.split(",").map((id) => id.trim())
    : undefined;

  return {
    refreshToken,
    locationIds,
    cameraStatusPollingSeconds: optionalInt(process.env.RING_CAMERA_POLL_SECONDS, 30),
    locationModePollingSeconds: optionalInt(process.env.RING_LOCATION_POLL_SECONDS),
    debug: process.env.RING_DEBUG === "true",
    eventLogMaxSize: optionalInt(process.env.EVENT_LOG_MAX_SIZE, 1000),
    eventLogFile: process.env.EVENT_LOG_FILE ?? "./ring-events.log",
    databasePath: process.env.RING_DATABASE_PATH ?? "./ring-data.db",
    routineLogMaxSize: optionalInt(process.env.ROUTINE_LOG_MAX_SIZE, 100000),
    cloudCacheMaxAgeMinutes: optionalInt(process.env.CLOUD_CACHE_MAX_AGE_MINUTES, 30),
  };
}

function optionalInt(
  value: string | undefined,
  defaultValue?: number
): number | undefined {
  if (value === undefined || value === "") return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}
