/**
 * MCP (Model Context Protocol) server for the Ring Ecosystem Tool.
 *
 * Exposes Ring device access, control, event querying, and routine
 * logging as tools that any MCP-compatible agent can invoke.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config as loadEnv } from "dotenv";
import { loadConfigFromEnv } from "./client/config.js";
import { RingEcosystemTool } from "./tools/ring-ecosystem-tool.js";

loadEnv();

const toolConfig = loadConfigFromEnv();
const ring = new RingEcosystemTool(toolConfig);

const server = new McpServer({
  name: "ring-ecosystem-tool",
  version: "1.0.0",
});

// ── Tool: list_locations ──

server.tool(
  "list_locations",
  "List all Ring locations associated with the account, including alarm status and device counts.",
  {},
  async () => {
    try {
      const locations = await ring.listLocations();
      return { content: [{ type: "text", text: JSON.stringify(locations, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: list_devices ──

server.tool(
  "list_devices",
  "List all Ring devices across all locations, including cameras, doorbells, alarm sensors, lights, and locks with their capabilities.",
  {},
  async () => {
    try {
      const devices = await ring.listDevices();
      return { content: [{ type: "text", text: JSON.stringify(devices, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: get_device ──

server.tool(
  "get_device",
  "Get detailed information about a specific Ring device by its ID.",
  { device_id: z.string().describe("The ID of the device to look up") },
  async ({ device_id }) => {
    try {
      const device = await ring.getDevice(device_id);
      if (!device) {
        return { content: [{ type: "text", text: `Device not found: ${device_id}` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(device, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: control_device ──

server.tool(
  "control_device",
  "Execute a control action on a Ring device. Supported actions: turn_light_on, turn_light_off, enable_siren, disable_siren, capture_snapshot, get_health, get_recording_url, set_volume.",
  {
    device_id: z.string().describe("The ID of the device to control"),
    action: z.enum([
      "turn_light_on",
      "turn_light_off",
      "enable_siren",
      "disable_siren",
      "capture_snapshot",
      "get_health",
      "get_recording_url",
      "set_volume",
    ]).describe("The action to perform on the device"),
    parameters: z
      .record(z.unknown())
      .optional()
      .describe("Additional parameters for the action (e.g., { dingId: '...' } for get_recording_url, { volume: 0.5 } for set_volume)"),
  },
  async ({ device_id, action, parameters }) => {
    try {
      const result = await ring.controlDevice({
        deviceId: device_id,
        action,
        parameters,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: set_alarm_mode ──

server.tool(
  "set_alarm_mode",
  "Set the alarm mode for a Ring location. Actions: arm_home, arm_away, disarm.",
  {
    location_id: z.string().describe("The location ID"),
    action: z.enum(["arm_home", "arm_away", "disarm"]).describe("The alarm action to take"),
  },
  async ({ location_id, action }) => {
    try {
      const result = await ring.setAlarmMode(location_id, action);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: get_alarm_mode ──

server.tool(
  "get_alarm_mode",
  "Get the current alarm mode (all, some, none) for a Ring location.",
  {
    location_id: z.string().describe("The location ID"),
  },
  async ({ location_id }) => {
    try {
      const mode = await ring.getAlarmMode(location_id);
      return { content: [{ type: "text", text: JSON.stringify({ locationId: location_id, alarmMode: mode }) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: query_events ──

server.tool(
  "query_events",
  "Query historic Ring events (motion, doorbell presses, alarm triggers, etc.) with optional filters. Events are collected in real time while the tool is running.",
  {
    device_id: z.string().optional().describe("Filter by device ID"),
    location_id: z.string().optional().describe("Filter by location ID"),
    type: z.enum([
      "motion", "doorbell_press", "alarm_triggered", "alarm_mode_change",
      "device_online", "device_offline", "light_on", "light_off",
      "lock_locked", "lock_unlocked", "siren_on", "siren_off",
      "snapshot_captured", "connection_change", "unknown",
    ]).optional().describe("Filter by event type"),
    start_time: z.string().optional().describe("Start of time range (ISO 8601)"),
    end_time: z.string().optional().describe("End of time range (ISO 8601)"),
    limit: z.number().optional().describe("Max number of events to return (default: all)"),
  },
  async ({ device_id, location_id, type, start_time, end_time, limit }) => {
    try {
      const events = ring.queryEvents({
        deviceId: device_id,
        locationId: location_id,
        type,
        startTime: start_time,
        endTime: end_time,
        limit,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ count: events.length, events }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: get_event_summary ──

server.tool(
  "get_event_summary",
  "Get a count of logged events grouped by event type, with optional filters.",
  {
    device_id: z.string().optional().describe("Filter by device ID"),
    location_id: z.string().optional().describe("Filter by location ID"),
    start_time: z.string().optional().describe("Start of time range (ISO 8601)"),
    end_time: z.string().optional().describe("End of time range (ISO 8601)"),
  },
  async ({ device_id, location_id, start_time, end_time }) => {
    try {
      const summary = ring.getEventSummary({
        deviceId: device_id,
        locationId: location_id,
        startTime: start_time,
        endTime: end_time,
      });
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: query_routines ──

server.tool(
  "query_routines",
  "Query the routine log — an audit trail of all device commands and alarm actions executed through this tool.",
  {
    action: z.string().optional().describe("Filter by action name"),
    device_id: z.string().optional().describe("Filter by device ID"),
    location_id: z.string().optional().describe("Filter by location ID"),
    result: z.enum(["success", "failure", "pending"]).optional().describe("Filter by result status"),
    start_time: z.string().optional().describe("Start of time range (ISO 8601)"),
    end_time: z.string().optional().describe("End of time range (ISO 8601)"),
    limit: z.number().optional().describe("Max number of entries to return"),
  },
  async ({ action, device_id, location_id, result, start_time, end_time, limit }) => {
    try {
      const entries = ring.queryRoutines({
        action,
        deviceId: device_id,
        locationId: location_id,
        result,
        startTime: start_time,
        endTime: end_time,
        limit,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ count: entries.length, routines: entries }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: get_routine_summary ──

server.tool(
  "get_routine_summary",
  "Get a summary of all routines grouped by action, showing total, success, and failure counts.",
  {},
  async () => {
    try {
      const summary = ring.getRoutineSummary();
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: get_status ──

server.tool(
  "get_status",
  "Get the current status of the Ring Ecosystem Tool, including whether real-time monitoring is active and how many events/routines have been logged.",
  {},
  async () => {
    try {
      const status = ring.status();
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: get_cloud_events ──

server.tool(
  "get_cloud_events",
  "Query Ring's cloud-stored camera event history (motion, doorbell presses, on-demand recordings, etc.). Returns events from Ring's cloud servers, which can go back up to 180 days depending on Ring Protect plan. Supports cursor-based pagination via pagination_key.",
  {
    device_id: z
      .string()
      .optional()
      .describe("Camera device ID to query. If omitted, queries all cameras at the specified location or across all locations."),
    location_id: z
      .string()
      .optional()
      .describe("Location ID to scope the query. Used when device_id is not provided."),
    kind: z
      .enum(["motion", "ding", "on_demand", "alarm", "on_demand_link", "door_activity", "key_access"])
      .optional()
      .describe("Filter by event kind"),
    state: z
      .enum(["missed", "accepted", "person_detected"])
      .optional()
      .describe("Filter by event state"),
    favorites: z.boolean().optional().describe("Only return favorited events"),
    limit: z.number().optional().describe("Max events to return (default: 20)"),
    pagination_key: z
      .string()
      .optional()
      .describe("Cursor from a previous response to fetch the next page of results"),
  },
  async ({ device_id, location_id, kind, state, favorites, limit, pagination_key }) => {
    try {
      const result = await ring.getCloudEvents({
        deviceId: device_id,
        locationId: location_id,
        kind,
        state,
        favorites,
        limit,
        paginationKey: pagination_key,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: search_videos ──

server.tool(
  "search_videos",
  "Search for video recordings from a specific Ring camera within a date range. Returns video metadata including thumbnail URLs, playback URLs, duration, and person detection info. Requires a Ring Protect plan for recorded video access.",
  {
    device_id: z.string().describe("The camera device ID to search videos for"),
    date_from: z.string().describe("Start of date range (ISO 8601, e.g., '2025-06-15T00:00:00Z')"),
    date_to: z.string().describe("End of date range (ISO 8601, e.g., '2025-06-15T23:59:59Z')"),
    order: z
      .enum(["asc", "desc"])
      .optional()
      .describe("Sort order by creation time (default: desc)"),
  },
  async ({ device_id, date_from, date_to, order }) => {
    try {
      const results = await ring.searchVideos({
        deviceId: device_id,
        dateFrom: date_from,
        dateTo: date_to,
        order,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ count: results.length, videos: results }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: get_recording_url ──

server.tool(
  "get_recording_url",
  "Get a direct playback URL for a specific Ring camera recording by its ding ID. The URL is temporary and expires after a short period. Use get_cloud_events or search_videos first to find the ding ID.",
  {
    device_id: z.string().describe("The camera device ID"),
    ding_id: z.string().describe("The ding ID string (from event or video search results)"),
    transcoded: z
      .boolean()
      .optional()
      .describe("Request the transcoded (H.264 MP4) version instead of original format (default: false)"),
  },
  async ({ device_id, ding_id, transcoded }) => {
    try {
      const url = await ring.getRecordingUrl(device_id, ding_id, { transcoded });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ deviceId: device_id, dingId: ding_id, recordingUrl: url }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: get_device_history ──

server.tool(
  "get_device_history",
  "Get alarm or Ring Beams device history for a location. Returns events from the security panel and connected sensors (not camera events — use get_cloud_events for cameras).",
  {
    location_id: z.string().describe("The location ID"),
    limit: z.number().optional().describe("Max number of events (default: 50)"),
    offset: z.number().optional().describe("Offset for pagination (default: 0)"),
    category: z
      .enum(["alarm", "beams"])
      .optional()
      .describe("Filter by device category"),
  },
  async ({ location_id, limit, offset, category }) => {
    try {
      const events = await ring.getDeviceHistory({
        locationId: location_id,
        limit,
        offset,
        category,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ count: events.length, events }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: start_crawl ──

server.tool(
  "start_crawl",
  "Start the background historic data crawler, which fetches all historical Ring cloud events, video metadata, and device history for all cameras and locations, storing them in the local database. Safe to call if already running. The crawl resumes from where it left off if previously stopped.",
  {},
  async () => {
    try {
      await ring.startCrawl();
      const status = await ring.getCrawlStatus();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ started: true, ...status }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: get_crawl_status ──

server.tool(
  "get_crawl_status",
  "Get the current status of the background historic data crawler, including per-camera progress for cloud events and video crawling, and per-location progress for device history crawling.",
  {},
  async () => {
    try {
      const status = await ring.getCrawlStatus();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(status, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Tool: stop_crawl ──

server.tool(
  "stop_crawl",
  "Stop the background historic data crawler. The crawl can be resumed later from where it left off by calling start_crawl.",
  {},
  async () => {
    try {
      ring.stopCrawl();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ stopped: true, message: "Crawl stopped. Can be resumed with start_crawl." }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${errorMessage(err)}` }], isError: true };
    }
  }
);

// ── Start server ──

async function main() {
  try {
    const stats = await ring.initialize();
    console.error(
      `[ring-ecosystem-tool] Initialized: ${stats.locations} location(s), ${stats.devices} device(s)`
    );
  } catch (err) {
    console.error(`[ring-ecosystem-tool] Warning: initialization failed — ${errorMessage(err)}`);
    console.error("[ring-ecosystem-tool] Tools will attempt to connect on first use.");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ring-ecosystem-tool] MCP server running on stdio");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().catch((err) => {
  console.error("[ring-ecosystem-tool] Fatal:", err);
  process.exit(1);
});
