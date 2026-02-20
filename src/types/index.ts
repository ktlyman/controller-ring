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

// ── Configuration ──

export interface RingToolConfig {
  refreshToken: string;
  locationIds?: string[];
  cameraStatusPollingSeconds?: number;
  locationModePollingSeconds?: number;
  debug?: boolean;
  eventLogMaxSize?: number;
  eventLogFile?: string;
}
