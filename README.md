# Ring Ecosystem Tool

An agent-facing tool for interacting with the [Ring](https://ring.com) smart home ecosystem. Built on top of the unofficial [`ring-client-api`](https://github.com/dgreif/ring), it provides:

- **Device access & control** — list, inspect, and command Ring cameras, doorbells, alarm systems, lights, and sensors
- **Real-time event monitoring** — subscribe to live motion, doorbell press, alarm, sensor, and connection events (including contact sensors, motion sensors, flood/freeze, smoke/CO, tamper, and siren)
- **Cloud history & video search** — query Ring's cloud-stored camera events and video recordings going back up to 180 days (with Ring Protect plan)
- **Background historic data crawler** — automatically backfill and persist all cloud events, video metadata, and device history (alarm sensors, contact sensors, motion sensors, etc.) with resumable progress tracking
- **SQLite persistent storage** — all events, routine logs, cloud history, and crawl state are persisted to a local SQLite database across restarts
- **Historic event logging** — query past events by device, location, type, or time range
- **Routine logging** — audit trail of every action taken through the tool

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Generate a Ring refresh token (requires Ring account with 2FA)
npm run auth

# 3. Configure your token
cp .env.example .env
# Edit .env and set RING_REFRESH_TOKEN=<your-token>

# 4. Run the CLI to verify connectivity
npm start

# 5. Or start the MCP server for agent integration
npm run start:mcp
```

## Architecture

```
src/
├── client/          Ring API client wrapper & config loader
│   ├── ring-client.ts
│   └── config.ts
├── devices/         Device enumeration & control
│   └── device-manager.ts
├── events/          Event capture, cloud history, crawling & querying
│   ├── event-logger.ts
│   ├── cloud-history.ts
│   ├── historic-crawler.ts
│   └── realtime-monitor.ts
├── logging/         Routine action audit log
│   └── routine-logger.ts
├── storage/         SQLite persistence layer
│   ├── database.ts
│   ├── event-store.ts
│   ├── routine-store.ts
│   ├── cloud-cache.ts
│   ├── crawl-store.ts
│   └── device-history-store.ts
├── tools/           Core orchestrator
│   └── ring-ecosystem-tool.ts
├── types/           TypeScript type definitions
│   └── index.ts
├── index.ts         Library exports & CLI entry point
└── mcp-server.ts    MCP server exposing 18 tools over stdio
```

## MCP Tools

When running as an MCP server (`npm run start:mcp`), the following tools are available to agents:

| Tool | Description |
|------|-------------|
| `list_locations` | List all Ring locations with alarm status and device counts |
| `list_devices` | List all Ring devices with capabilities |
| `get_device` | Get details about a specific device |
| `control_device` | Execute actions: light on/off, siren, snapshot, health, recording URL, volume |
| `set_alarm_mode` | Arm home, arm away, or disarm a location's alarm |
| `get_alarm_mode` | Get current alarm mode for a location |
| `query_events` | Query historic events with filters (device, location, type, time range) |
| `get_event_summary` | Get event counts grouped by type |
| `query_routines` | Query the audit log of all actions taken |
| `get_routine_summary` | Get routine counts grouped by action |
| `get_status` | Check monitoring status and log sizes |
| `get_cloud_events` | Query Ring's cloud-stored camera event history (up to 180 days) with pagination |
| `search_videos` | Search video recordings from a camera within a date range |
| `get_recording_url` | Get a temporary playback URL for a specific recording by ding ID |
| `get_device_history` | Get alarm or Ring Beams device/sensor history for a location |
| `start_crawl` | Start background historic data crawler for all cameras and locations |
| `get_crawl_status` | Get per-camera and per-location crawl progress |
| `stop_crawl` | Stop the crawler (resumes from where it left off) |

## Programmatic Usage

```typescript
import { RingEcosystemTool } from "ring-ecosystem-tool";

const tool = new RingEcosystemTool({
  refreshToken: process.env.RING_REFRESH_TOKEN!,
  databasePath: "./ring-data.db", // SQLite file (default; use ":memory:" for no persistence)
});

// Initialize and start real-time monitoring
await tool.initialize();

// List all devices
const devices = await tool.listDevices();

// Control a device
await tool.controlDevice({
  deviceId: "12345",
  action: "capture_snapshot",
});

// Subscribe to real-time events (cameras, doorbells, alarm sensors)
tool.subscribeToEvents((event) => {
  console.log(`${event.type} on ${event.deviceName}`);
});

// Query historic events (persisted in SQLite)
const motionEvents = tool.queryEvents({
  type: "motion",
  limit: 10,
});

// Query Ring's cloud-stored camera events (up to 180 days)
const cloudEvents = await tool.getCloudEvents({
  deviceId: "12345",
  kind: "motion",
  limit: 20,
});

// Search cloud video recordings by date range
const videos = await tool.searchVideos({
  deviceId: "12345",
  dateFrom: "2025-06-01T00:00:00Z",
  dateTo: "2025-06-15T23:59:59Z",
});

// Start background crawl of all historic data
await tool.startCrawl();
const crawlStatus = await tool.getCrawlStatus();
console.log(`Crawling: ${crawlStatus.summary.totalEventsFetched} events fetched`);

// Check routine audit log
const routines = tool.queryRoutines({ result: "failure" });

// Clean up (stops crawl and closes SQLite connection)
tool.shutdown();
```

## Claude Desktop Integration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ring": {
      "command": "node",
      "args": ["/path/to/ring-ecosystem-tool/build/mcp-server.js"],
      "env": {
        "RING_REFRESH_TOKEN": "your-token-here"
      }
    }
  }
}
```

## Configuration

All configuration is via environment variables (or `.env` file):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RING_REFRESH_TOKEN` | Yes | — | Ring OAuth refresh token |
| `RING_LOCATION_IDS` | No | All | Comma-separated location IDs to monitor |
| `RING_CAMERA_POLL_SECONDS` | No | 30 | Camera status polling interval |
| `RING_LOCATION_POLL_SECONDS` | No | — | Location mode polling interval |
| `RING_DEBUG` | No | false | Enable debug logging |
| `EVENT_LOG_MAX_SIZE` | No | 1000 | Max events in the database |
| `EVENT_LOG_FILE` | No | ./ring-events.log | Optional NDJSON event log file path |
| `RING_DATABASE_PATH` | No | ./ring-data.db | SQLite database file path (use `:memory:` for no persistence) |
| `ROUTINE_LOG_MAX_SIZE` | No | 100000 | Max routine log entries in the database |
| `CLOUD_CACHE_MAX_AGE_MINUTES` | No | 30 | Cloud event cache staleness threshold in minutes |
| `RING_CRAWL_ENABLED` | No | false | Enable automatic background crawling on startup |
| `RING_CRAWL_DELAY_MS` | No | 2000 | Delay between crawl API requests in milliseconds |
| `RING_CRAWL_PAGE_SIZE` | No | 50 | Events per page for crawl requests |
| `RING_CRAWL_VIDEO_WINDOW_DAYS` | No | 7 | Video search window size in days |
| `RING_CRAWL_INCREMENTAL_MINUTES` | No | 15 | Incremental crawl interval after backfill |

## Development

```bash
npm run dev       # Watch mode TypeScript compilation
npm test          # Run tests
npm run test:watch # Watch mode tests
npm run build     # Production build
```

## Disclaimer

This is an unofficial tool built on the community-driven `ring-client-api`. It is not affiliated with or endorsed by Ring or Amazon.
