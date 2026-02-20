/**
 * Core type definitions for the Ring Ecosystem Tool.
 */

// ── Device Types ──

export interface RingDeviceInfo {
  id: string;
  name: string;
  type: RingDeviceCategory;
  locationId: string;
  locationName: string;
  online: boolean;
  batteryLevel?: number;
  firmwareVersion?: string;
  /** Device-specific capabilities */
  capabilities: DeviceCapabilities;
  /** Raw device data from Ring API */
  raw?: Record<string, unknown>;
}

export type RingDeviceCategory =
  | "doorbell"
  | "camera"
  | "alarm_base_station"
  | "alarm_keypad"
  | "alarm_sensor"
  | "alarm_range_extender"
  | "light"
  | "lock"
  | "thermostat"
  | "unknown";

export interface DeviceCapabilities {
  hasLight: boolean;
  hasSiren: boolean;
  hasCamera: boolean;
  hasBattery: boolean;
  supportsMotionDetection: boolean;
  supportsDoorbellPress: boolean;
  supportsSnapshot: boolean;
  supportsVideo: boolean;
  supportsAlarm: boolean;
}

// ── Location Types ──

export interface RingLocationInfo {
  id: string;
  name: string;
  alarmMode: AlarmMode | null;
  hasAlarm: boolean;
  deviceCount: number;
  cameraCount: number;
}

export type AlarmMode = "all" | "some" | "none";

// ── Event Types ──

export interface RingEvent {
  id: string;
  deviceId: string;
  deviceName: string;
  locationId: string;
  locationName: string;
  type: RingEventType;
  timestamp: string;
  /** Duration in seconds for events that have a span (e.g., motion) */
  durationSec?: number;
  /** URL to recording if available */
  recordingUrl?: string;
  /** Snapshot buffer encoded as base64, if captured */
  snapshotBase64?: string;
  /** Additional event-specific metadata */
  metadata: Record<string, unknown>;
}

export type RingEventType =
  | "motion"
  | "doorbell_press"
  | "alarm_triggered"
  | "alarm_mode_change"
  | "device_online"
  | "device_offline"
  | "light_on"
  | "light_off"
  | "lock_locked"
  | "lock_unlocked"
  | "siren_on"
  | "siren_off"
  | "snapshot_captured"
  | "connection_change"
  | "contact_open"
  | "contact_close"
  | "sensor_motion"
  | "sensor_motion_clear"
  | "tamper"
  | "tamper_clear"
  | "flood"
  | "freeze"
  | "smoke_alarm"
  | "co_alarm"
  | "unknown";

// ── Routine Types ──

export interface RoutineLogEntry {
  id: string;
  timestamp: string;
  action: string;
  deviceId?: string;
  deviceName?: string;
  locationId: string;
  locationName: string;
  parameters: Record<string, unknown>;
  result: "success" | "failure" | "pending";
  error?: string;
}

// ── Tool / Action Types ──

export interface DeviceCommand {
  deviceId: string;
  action: DeviceAction;
  parameters?: Record<string, unknown>;
}

export type DeviceAction =
  | "turn_light_on"
  | "turn_light_off"
  | "enable_siren"
  | "disable_siren"
  | "capture_snapshot"
  | "get_health"
  | "get_recording_url"
  | "set_volume";

export type AlarmAction = "arm_home" | "arm_away" | "disarm";

export interface EventQuery {
  /** Filter by device ID */
  deviceId?: string;
  /** Filter by location ID */
  locationId?: string;
  /** Filter by event type */
  type?: RingEventType;
  /** Start of time range (ISO 8601) */
  startTime?: string;
  /** End of time range (ISO 8601) */
  endTime?: string;
  /** Max number of events to return */
  limit?: number;
}

export interface EventSubscription {
  /** Unique subscription ID */
  id: string;
  /** Filter criteria for events to receive */
  filter?: {
    deviceId?: string;
    locationId?: string;
    types?: RingEventType[];
  };
  /** Callback invoked when a matching event occurs */
  callback: (event: RingEvent) => void;
}

// ── Cloud History Types ──

/** Event kind from Ring's cloud API (camera dings, motion, etc.) */
export type DingKind =
  | "motion"
  | "ding"
  | "on_demand"
  | "alarm"
  | "on_demand_link"
  | "door_activity"
  | "key_access"
  | "DELETED_FOOTAGE"
  | "OFFLINE_FOOTAGE"
  | "OFFLINE_MOTION";

/** A camera event fetched from Ring's cloud history. */
export interface CloudCameraEvent {
  id: string;
  dingIdStr: string;
  deviceId: string;
  deviceName: string;
  locationId: string;
  locationName: string;
  kind: DingKind;
  createdAt: string;
  favorite: boolean;
  recordingStatus: string;
  state: string;
  cvProperties: {
    personDetected: unknown;
    detectionType: unknown;
    streamBroken: unknown;
  };
}

/** Query parameters for fetching cloud camera events. */
export interface CloudEventQuery {
  /** Camera device ID (if omitted, queries location-wide) */
  deviceId?: string;
  /** Location ID to scope the query */
  locationId?: string;
  /** Filter by event kind */
  kind?: DingKind;
  /** Filter by event state */
  state?: "missed" | "accepted" | "person_detected";
  /** Only return favorited events */
  favorites?: boolean;
  /** Max number of events (default: 20) */
  limit?: number;
  /** Cursor for pagination from a previous response */
  paginationKey?: string;
}

/** Result of a cloud event query, with pagination info. */
export interface CloudEventQueryResult {
  events: CloudCameraEvent[];
  paginationKey: string | null;
  hasMore: boolean;
}

/** A video recording result from Ring's cloud. */
export interface CloudVideoResult {
  dingId: string;
  createdAt: string;
  kind: DingKind;
  state: string;
  duration: number;
  favorite: boolean;
  thumbnailUrl: string | null;
  lqUrl: string;
  hqUrl: string | null;
  untranscodedUrl: string;
  cvProperties: {
    personDetected: unknown;
    detectionType: unknown;
    streamBroken: unknown;
  };
}

/** Query parameters for searching video recordings. */
export interface VideoSearchQuery {
  /** Camera device ID */
  deviceId: string;
  /** Start of date range (ISO 8601) */
  dateFrom: string;
  /** End of date range (ISO 8601) */
  dateTo: string;
  /** Sort order (default: "desc") */
  order?: "asc" | "desc";
}

/** Query parameters for alarm/beams device history. */
export interface DeviceHistoryQuery {
  /** Location ID */
  locationId: string;
  /** Max number of events (default: 50) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by device category */
  category?: "alarm" | "beams";
}

// ── Configuration ──

export interface RingToolConfig {
  refreshToken: string;
  locationIds?: string[];
  cameraStatusPollingSeconds?: number;
  locationModePollingSeconds?: number;
  debug?: boolean;
  eventLogMaxSize?: number;
  eventLogFile?: string;
  /** Path to the SQLite database file. Default: "./ring-data.db" */
  databasePath?: string;
  /** Max routine log entries to keep. Default: 100000 */
  routineLogMaxSize?: number;
  /** Cloud event cache max age in minutes. Default: 30 */
  cloudCacheMaxAgeMinutes?: number;
}
