/**
 * Ring API client wrapper.
 *
 * Manages authentication, token refresh persistence, and provides
 * access to Ring locations, cameras, and devices.
 */

import { RingApi, RingCamera, RingDevice, Location } from "ring-client-api";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { RingToolConfig } from "../types/index.js";

const TOKEN_FILE = resolve(process.cwd(), "ring-config.json");

export class RingClient {
  private api: RingApi;
  private config: RingToolConfig;
  private initialized = false;

  constructor(config: RingToolConfig) {
    this.config = config;

    // Try to load a previously persisted refresh token
    const persistedToken = this.loadPersistedToken();
    const token = persistedToken ?? config.refreshToken;

    if (!token) {
      throw new Error(
        "No Ring refresh token provided. Run `npm run auth` to generate one, then set RING_REFRESH_TOKEN in your .env file."
      );
    }

    this.api = new RingApi({
      refreshToken: token,
      cameraStatusPollingSeconds: config.cameraStatusPollingSeconds ?? 30,
      locationModePollingSeconds: config.locationModePollingSeconds,
      locationIds: config.locationIds,
      debug: config.debug ?? false,
      controlCenterDisplayName: "ring-ecosystem-tool",
    });

    // Persist new refresh tokens as they are issued
    this.api.onRefreshTokenUpdated.subscribe({
      next: ({ newRefreshToken }) => {
        this.persistToken(newRefreshToken);
      },
    });
  }

  // ── Initialization ──

  async initialize(): Promise<void> {
    if (this.initialized) return;
    // Force a connection by fetching locations
    await this.api.getLocations();
    this.initialized = true;
  }

  // ── Locations ──

  async getLocations(): Promise<Location[]> {
    await this.initialize();
    return this.api.getLocations();
  }

  async getLocationById(locationId: string): Promise<Location | undefined> {
    const locations = await this.getLocations();
    return locations.find((l) => l.id === locationId);
  }

  // ── Cameras ──

  async getCameras(): Promise<RingCamera[]> {
    await this.initialize();
    return this.api.getCameras();
  }

  async getCameraById(cameraId: string): Promise<RingCamera | undefined> {
    const cameras = await this.getCameras();
    // Camera IDs from ring-client-api are numbers stored as the `id` property
    return cameras.find((c) => String(c.id) === String(cameraId));
  }

  // ── Devices (alarm/lighting/sensors) ──

  async getDevicesAtLocation(locationId: string): Promise<RingDevice[]> {
    const location = await this.getLocationById(locationId);
    if (!location) {
      throw new Error(`Location not found: ${locationId}`);
    }
    return location.getDevices();
  }

  // ── Raw API access for advanced use ──

  getRingApi(): RingApi {
    return this.api;
  }

  // ── Token Persistence ──

  private persistToken(token: string): void {
    try {
      writeFileSync(
        TOKEN_FILE,
        JSON.stringify({ refreshToken: token }, null, 2),
        "utf-8"
      );
    } catch {
      // Non-fatal — token persistence is best-effort
      if (this.config.debug) {
        console.error("[ring-client] Failed to persist refresh token");
      }
    }
  }

  private loadPersistedToken(): string | null {
    try {
      if (existsSync(TOKEN_FILE)) {
        const data = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
        return data.refreshToken ?? null;
      }
    } catch {
      // Ignore corrupt file
    }
    return null;
  }
}
