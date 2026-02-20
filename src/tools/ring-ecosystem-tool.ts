/**
 * Ring Ecosystem Tool — the main orchestrator that ties together the
 * Ring client, device manager, event logger, real-time monitor, and
 * routine logger into a single agent-facing interface.
 */

import { RingClient } from "../client/ring-client.js";
import { DeviceManager } from "../devices/device-manager.js";
import { RingDatabase } from "../storage/database.js";
import { EventStore } from "../storage/event-store.js";
import { RoutineStore } from "../storage/routine-store.js";
import { CloudCache } from "../storage/cloud-cache.js";
import { CrawlStore } from "../storage/crawl-store.js";
import { DeviceHistoryStore } from "../storage/device-history-store.js";
import { EventLogger } from "../events/event-logger.js";
import { CloudHistory } from "../events/cloud-history.js";
import { HistoricCrawler } from "../events/historic-crawler.js";
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
  CloudEventQuery,
  CloudEventQueryResult,
  CloudVideoResult,
  CrawlStatusReport,
  VideoSearchQuery,
  DeviceHistoryQuery,
} from "../types/index.js";

export class RingEcosystemTool {
  private config: RingToolConfig;
  private client: RingClient;
  private database: RingDatabase;
  private deviceManager: DeviceManager;
  private eventLogger: EventLogger;
  private cloudHistory: CloudHistory;
  private historicCrawler: HistoricCrawler;
  private realtimeMonitor: RealtimeMonitor;
  private routineLogger: RoutineLogger;

  constructor(config: RingToolConfig) {
    this.config = config;
    this.client = new RingClient(config);
    this.deviceManager = new DeviceManager(this.client);

    // Initialize SQLite database and stores
    this.database = new RingDatabase({
      filePath: config.databasePath ?? "./ring-data.db",
    });
    const conn = this.database.getConnection();

    const eventStore = new EventStore(conn, config.eventLogMaxSize ?? 100000);
    const routineStore = new RoutineStore(conn, config.routineLogMaxSize ?? 100000);
    const cloudCache = new CloudCache(
      conn,
      (config.cloudCacheMaxAgeMinutes ?? 30) * 60 * 1000
    );

    const crawlStore = new CrawlStore(conn);
    const deviceHistoryStore = new DeviceHistoryStore(conn);

    this.eventLogger = new EventLogger(eventStore, config.eventLogFile);
    this.routineLogger = new RoutineLogger(routineStore);
    this.cloudHistory = new CloudHistory(this.client, cloudCache);
    this.historicCrawler = new HistoricCrawler(
      this.client,
      this.cloudHistory,
      crawlStore,
      deviceHistoryStore,
      {
        enabled: config.crawlEnabled ?? false,
        delayMs: config.crawlDelayMs ?? 2000,
        pageSize: config.crawlPageSize ?? 50,
        videoWindowDays: config.crawlVideoWindowDays ?? 7,
        incrementalIntervalMinutes: config.crawlIncrementalIntervalMinutes ?? 15,
      }
    );
    this.realtimeMonitor = new RealtimeMonitor(this.client, this.eventLogger);
  }

  // ── Lifecycle ──

  async initialize(): Promise<{ locations: number; devices: number }> {
    await this.client.initialize();
    await this.realtimeMonitor.start();

    // Start background historic data crawl if enabled
    if (this.historicCrawler && this.config.crawlEnabled) {
      await this.historicCrawler.start();
    }

    const locations = await this.deviceManager.listLocations();
    const devices = await this.deviceManager.listAllDevices();
    return { locations: locations.length, devices: devices.length };
  }

  shutdown(): void {
    this.historicCrawler.stop();
    this.realtimeMonitor.stop();
    this.database.close();
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

  // ── Cloud History ──

  async getCloudEvents(query: CloudEventQuery = {}): Promise<CloudEventQueryResult> {
    return this.cloudHistory.getEvents(query);
  }

  async searchVideos(query: VideoSearchQuery): Promise<CloudVideoResult[]> {
    return this.cloudHistory.searchVideos(query);
  }

  async getRecordingUrl(
    deviceId: string,
    dingIdStr: string,
    options?: { transcoded?: boolean }
  ): Promise<string> {
    return this.cloudHistory.getRecordingUrl(deviceId, dingIdStr, options);
  }

  async getDeviceHistory(query: DeviceHistoryQuery): Promise<unknown[]> {
    return this.cloudHistory.getDeviceHistory(query);
  }

  // ── Crawl Control ──

  /** Start the background historic data crawler. */
  async startCrawl(): Promise<void> {
    await this.historicCrawler.start();
  }

  /** Stop the background historic data crawler. */
  stopCrawl(): void {
    this.historicCrawler.stop();
  }

  /** Get the current crawl status report. */
  async getCrawlStatus(): Promise<CrawlStatusReport> {
    return this.historicCrawler.getStatus();
  }

  // ── Status ──

  status(): {
    monitoring: boolean;
    eventsLogged: number;
    routinesLogged: number;
    crawling: boolean;
  } {
    return {
      monitoring: this.realtimeMonitor.isRunning,
      eventsLogged: this.eventLogger.size,
      routinesLogged: this.routineLogger.size,
      crawling: this.historicCrawler.isRunning,
    };
  }
}
