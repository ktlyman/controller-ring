/**
 * Ring Ecosystem Tool — the main orchestrator that ties together the
 * Ring client, device manager, event logger, real-time monitor, and
 * routine logger into a single agent-facing interface.
 */

import { RingClient } from "../client/ring-client.js";
import { DeviceManager } from "../devices/device-manager.js";
import { EventLogger } from "../events/event-logger.js";
import { RealtimeMonitor } from "../events/realtime-monitor.js";
import { RoutineLogger } from "../logging/routine-logger.js";
import type {
  RingToolConfig,
  RingDeviceInfo,
  RingLocationInfo,
  RingEvent,
  RoutineLogEntry,
  DeviceCommand,
  AlarmAction,
  EventQuery,
} from "../types/index.js";

export class RingEcosystemTool {
  private client: RingClient;
  private deviceManager: DeviceManager;
  private eventLogger: EventLogger;
  private realtimeMonitor: RealtimeMonitor;
  private routineLogger: RoutineLogger;

  constructor(config: RingToolConfig) {
    this.client = new RingClient(config);
    this.deviceManager = new DeviceManager(this.client);
    this.eventLogger = new EventLogger(
      config.eventLogMaxSize ?? 1000,
      config.eventLogFile
    );
    this.realtimeMonitor = new RealtimeMonitor(this.client, this.eventLogger);
    this.routineLogger = new RoutineLogger(500);
  }

  // ── Lifecycle ──

  async initialize(): Promise<{ locations: number; devices: number }> {
    await this.client.initialize();
    await this.realtimeMonitor.start();
    const locations = await this.deviceManager.listLocations();
    const devices = await this.deviceManager.listAllDevices();
    return { locations: locations.length, devices: devices.length };
  }

  shutdown(): void {
    this.realtimeMonitor.stop();
  }

  // ── Location Operations ──

  async listLocations(): Promise<RingLocationInfo[]> {
    return this.deviceManager.listLocations();
  }

  // ── Device Operations ──

  async listDevices(): Promise<RingDeviceInfo[]> {
    return this.deviceManager.listAllDevices();
  }

  async getDevice(deviceId: string): Promise<RingDeviceInfo | null> {
    return this.deviceManager.getDevice(deviceId);
  }

  async controlDevice(command: DeviceCommand): Promise<Record<string, unknown>> {
    const device = await this.deviceManager.getDevice(command.deviceId);

    // Log the routine attempt
    const logEntry = this.routineLogger.log({
      action: command.action,
      deviceId: command.deviceId,
      deviceName: device?.name,
      locationId: device?.locationId ?? "unknown",
      locationName: device?.locationName ?? "unknown",
      parameters: command.parameters ?? {},
      result: "pending",
    });

    try {
      const result = await this.deviceManager.executeCommand(command);

      // Update the routine log to success
      this.routineLogger.log({
        id: logEntry.id,
        timestamp: logEntry.timestamp,
        action: command.action,
        deviceId: command.deviceId,
        deviceName: device?.name,
        locationId: device?.locationId ?? "unknown",
        locationName: device?.locationName ?? "unknown",
        parameters: command.parameters ?? {},
        result: "success",
      });

      return result;
    } catch (err) {
      this.routineLogger.log({
        id: logEntry.id + "-fail",
        timestamp: new Date().toISOString(),
        action: command.action,
        deviceId: command.deviceId,
        deviceName: device?.name,
        locationId: device?.locationId ?? "unknown",
        locationName: device?.locationName ?? "unknown",
        parameters: command.parameters ?? {},
        result: "failure",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // ── Alarm Operations ──

  async setAlarmMode(
    locationId: string,
    action: AlarmAction
  ): Promise<Record<string, unknown>> {
    const locations = await this.deviceManager.listLocations();
    const loc = locations.find((l) => l.id === locationId);

    this.routineLogger.log({
      action: `alarm_${action}`,
      locationId,
      locationName: loc?.name ?? "unknown",
      parameters: { action },
      result: "pending",
    });

    try {
      const result = await this.deviceManager.setAlarmMode(locationId, action);

      this.routineLogger.log({
        action: `alarm_${action}`,
        locationId,
        locationName: loc?.name ?? "unknown",
        parameters: { action },
        result: "success",
      });

      return result;
    } catch (err) {
      this.routineLogger.log({
        action: `alarm_${action}`,
        locationId,
        locationName: loc?.name ?? "unknown",
        parameters: { action },
        result: "failure",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async getAlarmMode(locationId: string): Promise<string> {
    return this.deviceManager.getAlarmMode(locationId);
  }

  // ── Event Queries ──

  queryEvents(filter: EventQuery = {}): RingEvent[] {
    return this.eventLogger.query(filter);
  }

  getEventSummary(
    filter: Omit<EventQuery, "limit"> = {}
  ): Record<string, number> {
    return this.eventLogger.summary(filter);
  }

  // ── Routine Queries ──

  queryRoutines(filter: {
    action?: string;
    deviceId?: string;
    locationId?: string;
    result?: "success" | "failure" | "pending";
    startTime?: string;
    endTime?: string;
    limit?: number;
  } = {}): RoutineLogEntry[] {
    return this.routineLogger.query(filter);
  }

  getRoutineSummary(): Record<
    string,
    { total: number; success: number; failure: number }
  > {
    return this.routineLogger.summary();
  }

  // ── Real-time Subscriptions ──

  subscribeToEvents(
    callback: (event: RingEvent) => void,
    filter?: {
      deviceId?: string;
      locationId?: string;
      types?: RingEvent["type"][];
    }
  ): string {
    return this.realtimeMonitor.subscribe({ filter, callback });
  }

  unsubscribeFromEvents(subscriptionId: string): boolean {
    return this.realtimeMonitor.unsubscribe(subscriptionId);
  }

  // ── Status ──

  status(): {
    monitoring: boolean;
    eventsLogged: number;
    routinesLogged: number;
  } {
    return {
      monitoring: this.realtimeMonitor.isRunning,
      eventsLogged: this.eventLogger.size,
      routinesLogged: this.routineLogger.size,
    };
  }
}
