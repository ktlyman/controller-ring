/**
 * Ring Ecosystem Tool — main entry point.
 *
 * Exports the core classes for programmatic use and also serves as
 * a standalone CLI that prints device/event information.
 */

export { RingEcosystemTool } from "./tools/ring-ecosystem-tool.js";
export { RingClient } from "./client/ring-client.js";
export { DeviceManager } from "./devices/device-manager.js";
export { RingDatabase } from "./storage/database.js";
export { EventStore } from "./storage/event-store.js";
export { RoutineStore } from "./storage/routine-store.js";
export { CloudCache } from "./storage/cloud-cache.js";
export { CrawlStore } from "./storage/crawl-store.js";
export { DeviceHistoryStore } from "./storage/device-history-store.js";
export { EventLogger } from "./events/event-logger.js";
export { CloudHistory } from "./events/cloud-history.js";
export { HistoricCrawler } from "./events/historic-crawler.js";
export { RealtimeMonitor } from "./events/realtime-monitor.js";
export { RoutineLogger } from "./logging/routine-logger.js";
export { loadConfigFromEnv } from "./client/config.js";
export * from "./types/index.js";

// ── CLI mode ──

import { config as loadEnv } from "dotenv";
import { loadConfigFromEnv } from "./client/config.js";
import { RingEcosystemTool } from "./tools/ring-ecosystem-tool.js";

const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/index.js") || process.argv[1].endsWith("/index.ts"));

if (isMainModule) {
  loadEnv();
  const config = loadConfigFromEnv();

  if (!config.refreshToken) {
    console.error(
      "No RING_REFRESH_TOKEN set. Run `npm run auth` to generate one."
    );
    process.exit(1);
  }

  const tool = new RingEcosystemTool(config);

  (async () => {
    try {
      const stats = await tool.initialize();
      console.log(`Connected: ${stats.locations} location(s), ${stats.devices} device(s)\n`);

      const locations = await tool.listLocations();
      console.log("Locations:");
      for (const loc of locations) {
        console.log(
          `  - ${loc.name} (${loc.id}) — alarm: ${loc.alarmMode ?? "n/a"}, devices: ${loc.deviceCount}`
        );
      }

      const devices = await tool.listDevices();
      console.log(`\nDevices (${devices.length}):`);
      for (const dev of devices) {
        console.log(
          `  - [${dev.type}] ${dev.name} (${dev.id}) @ ${dev.locationName}`
        );
      }

      console.log("\nReal-time monitoring active. Press Ctrl+C to exit.");
      console.log("Events will be logged to the console:\n");

      tool.subscribeToEvents((event) => {
        console.log(
          `[${event.timestamp}] ${event.type} — ${event.deviceName} @ ${event.locationName}`
        );
      });
    } catch (err) {
      console.error("Failed to initialize:", err);
      process.exit(1);
    }
  })();

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    tool.shutdown();
    process.exit(0);
  });
}
