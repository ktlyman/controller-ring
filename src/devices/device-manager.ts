/**
 * Device manager — enumerates, inspects, and controls Ring devices.
 */

import type { RingCamera, RingDevice, Location } from "ring-client-api";
import { RingDeviceType } from "ring-client-api";
import type { RingClient } from "../client/ring-client.js";
import type {
  RingDeviceInfo,
  RingLocationInfo,
  RingDeviceCategory,
  DeviceCapabilities,
  DeviceCommand,
  AlarmAction,
  AlarmMode,
} from "../types/index.js";

export class DeviceManager {
  constructor(private client: RingClient) {}

  // ── Locations ──

  async listLocations(): Promise<RingLocationInfo[]> {
    const locations = await this.client.getLocations();
    const results: RingLocationInfo[] = [];

    for (const loc of locations) {
      let alarmMode: AlarmMode | null = null;
      if (loc.hasHubs) {
        try {
          alarmMode = await loc.getAlarmMode();
        } catch {
          // Alarm mode may not be available
        }
      }
      const cameras = loc.cameras ?? [];
      results.push({
        id: loc.id,
        name: loc.name,
        alarmMode,
        hasAlarm: loc.hasHubs,
        deviceCount: cameras.length,
        cameraCount: cameras.length,
      });
    }

    return results;
  }

  // ── Device Listing ──

  async listAllDevices(): Promise<RingDeviceInfo[]> {
    const locations = await this.client.getLocations();
    const devices: RingDeviceInfo[] = [];

    for (const loc of locations) {
      // Cameras
      for (const cam of loc.cameras ?? []) {
        devices.push(this.cameraToDeviceInfo(cam, loc));
      }

      // Alarm and smart-home devices
      if (loc.hasHubs) {
        try {
          const ringDevices = await loc.getDevices();
          for (const dev of ringDevices) {
            devices.push(this.ringDeviceToDeviceInfo(dev, loc));
          }
        } catch {
          // Location may not have accessible devices
        }
      }
    }

    return devices;
  }

  async getDevice(deviceId: string): Promise<RingDeviceInfo | null> {
    const allDevices = await this.listAllDevices();
    return allDevices.find((d) => d.id === deviceId) ?? null;
  }

  // ── Device Control ──

  async executeCommand(command: DeviceCommand): Promise<Record<string, unknown>> {
    const camera = await this.client.getCameraById(command.deviceId);

    switch (command.action) {
      case "turn_light_on": {
        if (!camera) throw new Error(`Camera/light not found: ${command.deviceId}`);
        if (!camera.hasLight) throw new Error(`Device ${command.deviceId} has no light`);
        await camera.setLight(true);
        return { success: true, action: "turn_light_on", deviceId: command.deviceId };
      }
      case "turn_light_off": {
        if (!camera) throw new Error(`Camera/light not found: ${command.deviceId}`);
        if (!camera.hasLight) throw new Error(`Device ${command.deviceId} has no light`);
        await camera.setLight(false);
        return { success: true, action: "turn_light_off", deviceId: command.deviceId };
      }
      case "enable_siren": {
        if (!camera) throw new Error(`Camera not found: ${command.deviceId}`);
        if (!camera.hasSiren) throw new Error(`Device ${command.deviceId} has no siren`);
        await camera.setSiren(true);
        return { success: true, action: "enable_siren", deviceId: command.deviceId };
      }
      case "disable_siren": {
        if (!camera) throw new Error(`Camera not found: ${command.deviceId}`);
        if (!camera.hasSiren) throw new Error(`Device ${command.deviceId} has no siren`);
        await camera.setSiren(false);
        return { success: true, action: "disable_siren", deviceId: command.deviceId };
      }
      case "capture_snapshot": {
        if (!camera) throw new Error(`Camera not found: ${command.deviceId}`);
        const snapshot = await camera.getSnapshot();
        return {
          success: true,
          action: "capture_snapshot",
          deviceId: command.deviceId,
          snapshotBase64: snapshot.toString("base64"),
          mimeType: "image/jpeg",
        };
      }
      case "get_health": {
        if (!camera) throw new Error(`Camera not found: ${command.deviceId}`);
        const health = await camera.getHealth();
        return {
          success: true,
          action: "get_health",
          deviceId: command.deviceId,
          health,
        };
      }
      case "get_recording_url": {
        if (!camera) throw new Error(`Camera not found: ${command.deviceId}`);
        const dingId = command.parameters?.dingId as string | undefined;
        if (!dingId) throw new Error("dingId parameter is required for get_recording_url");
        const url = await camera.getRecordingUrl(dingId);
        return {
          success: true,
          action: "get_recording_url",
          deviceId: command.deviceId,
          recordingUrl: url,
        };
      }
      case "set_volume": {
        const volume = command.parameters?.volume as number | undefined;
        if (volume === undefined) throw new Error("volume parameter is required (0-1)");
        // Volume control is on base stations / keypads which are RingDevices
        const locations = await this.client.getLocations();
        for (const loc of locations) {
          if (!loc.hasHubs) continue;
          const devices = await loc.getDevices();
          const target = devices.find((d) => d.zid === command.deviceId);
          if (target) {
            await target.setVolume(volume);
            return { success: true, action: "set_volume", deviceId: command.deviceId, volume };
          }
        }
        throw new Error(`Device not found for volume control: ${command.deviceId}`);
      }
      default:
        throw new Error(`Unknown action: ${command.action}`);
    }
  }

  // ── Alarm Control ──

  async setAlarmMode(locationId: string, action: AlarmAction): Promise<Record<string, unknown>> {
    const location = await this.client.getLocationById(locationId);
    if (!location) throw new Error(`Location not found: ${locationId}`);
    if (!location.hasHubs) throw new Error(`Location ${locationId} has no alarm system`);

    switch (action) {
      case "arm_home":
        await location.armHome();
        break;
      case "arm_away":
        await location.armAway();
        break;
      case "disarm":
        await location.disarm();
        break;
    }

    return { success: true, locationId, action };
  }

  async getAlarmMode(locationId: string): Promise<AlarmMode> {
    const location = await this.client.getLocationById(locationId);
    if (!location) throw new Error(`Location not found: ${locationId}`);
    if (!location.hasHubs) throw new Error(`Location ${locationId} has no alarm system`);
    return location.getAlarmMode();
  }

  // ── Helpers ──

  private cameraToDeviceInfo(camera: RingCamera, location: Location): RingDeviceInfo {
    return {
      id: String(camera.id),
      name: camera.name,
      type: camera.isDoorbot ? "doorbell" : "camera",
      locationId: location.id,
      locationName: location.name,
      online: true, // cameras in the list are considered reachable
      batteryLevel: camera.batteryLevel ?? undefined,
      capabilities: {
        hasLight: camera.hasLight,
        hasSiren: camera.hasSiren,
        hasCamera: true,
        hasBattery: camera.batteryLevel !== null,
        supportsMotionDetection: true,
        supportsDoorbellPress: camera.isDoorbot,
        supportsSnapshot: true,
        supportsVideo: true,
        supportsAlarm: false,
      },
    };
  }

  private ringDeviceToDeviceInfo(device: RingDevice, location: Location): RingDeviceInfo {
    return {
      id: device.zid,
      name: device.name,
      type: this.classifyDeviceType(device),
      locationId: location.id,
      locationName: location.name,
      online: device.data?.faulted !== true,
      capabilities: {
        hasLight: false,
        hasSiren: device.data?.deviceType === RingDeviceType.BaseStation,
        hasCamera: false,
        hasBattery: device.data?.batteryLevel !== undefined,
        supportsMotionDetection: device.data?.deviceType === RingDeviceType.MotionSensor,
        supportsDoorbellPress: false,
        supportsSnapshot: false,
        supportsVideo: false,
        supportsAlarm: true,
      },
      batteryLevel: device.data?.batteryLevel ?? undefined,
    };
  }

  private classifyDeviceType(device: RingDevice): RingDeviceCategory {
    const dt = device.data?.deviceType;
    if (dt === RingDeviceType.BaseStation) return "alarm_base_station";
    if (dt === RingDeviceType.Keypad) return "alarm_keypad";
    if (
      dt === RingDeviceType.ContactSensor ||
      dt === RingDeviceType.MotionSensor
    ) {
      return "alarm_sensor";
    }
    if (dt === RingDeviceType.RangeExtender) return "alarm_range_extender";
    return "unknown";
  }
}
