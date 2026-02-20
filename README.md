# Ring Ecosystem Tool

An agent-facing tool for interacting with the [Ring](https://ring.com) smart home ecosystem. Built on top of the unofficial [`ring-client-api`](https://github.com/dgreif/ring), it provides:

- **Device access & control** — list, inspect, and command Ring cameras, doorbells, alarm systems, lights, and sensors
- **Real-time event monitoring** — subscribe to live motion, doorbell press, alarm, and connection events
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
├── events/          Event capture & querying
│   ├── event-logger.ts
│   └── realtime-monitor.ts
├── logging/         Routine action audit log
│   └── routine-logger.ts
├── tools/           Core orchestrator
│   └── ring-ecosystem-tool.ts
├── types/           TypeScript type definitions
│   └── index.ts
├── index.ts         Library exports & CLI entry point
└── mcp-server.ts    MCP server exposing all tools
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

## Programmatic Usage

```typescript
import { RingEcosystemTool } from "ring-ecosystem-tool";

const tool = new RingEcosystemTool({
  refreshToken: process.env.RING_REFRESH_TOKEN!,
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

// Subscribe to real-time events
tool.subscribeToEvents((event) => {
  console.log(`${event.type} on ${event.deviceName}`);
});

// Query historic events
const motionEvents = tool.queryEvents({
  type: "motion",
  limit: 10,
});

// Check routine audit log
const routines = tool.queryRoutines({ result: "failure" });

// Clean up
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
| `EVENT_LOG_MAX_SIZE` | No | 1000 | Max events in memory |
| `EVENT_LOG_FILE` | No | ./ring-events.log | Event log file path |

## Development

```bash
npm run dev       # Watch mode TypeScript compilation
npm test          # Run tests
npm run test:watch # Watch mode tests
npm run build     # Production build
```

## Disclaimer

This is an unofficial tool built on the community-driven `ring-client-api`. It is not affiliated with or endorsed by Ring or Amazon.
