import { fetchAndActivate, getNumber, getString, type RemoteConfig } from "firebase/remote-config";
import type { RoutingSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

/**
 * Routing thresholds live in Remote Config so the on-device/cloud balance
 * can be tuned without redeploying. Defaults ship in code (and are set as
 * Remote Config defaults), so the app behaves identically before the first
 * fetch and when no project is connected.
 */
export function mergeSettings(raw: Partial<RoutingSettings>): RoutingSettings {
  const merged: RoutingSettings = { ...DEFAULT_SETTINGS };
  if (typeof raw.maxOnDeviceChars === "number" && raw.maxOnDeviceChars >= 100) {
    merged.maxOnDeviceChars = Math.floor(raw.maxOnDeviceChars);
  }
  if (typeof raw.cloudModel === "string" && raw.cloudModel.trim().length > 0) {
    merged.cloudModel = raw.cloudModel.trim();
  }
  return merged;
}

export async function loadSettings(remoteConfig: RemoteConfig | null): Promise<RoutingSettings> {
  if (!remoteConfig) return { ...DEFAULT_SETTINGS };
  try {
    remoteConfig.defaultConfig = {
      max_on_device_chars: DEFAULT_SETTINGS.maxOnDeviceChars,
      cloud_model: DEFAULT_SETTINGS.cloudModel,
    };
    await fetchAndActivate(remoteConfig);
    return mergeSettings({
      maxOnDeviceChars: getNumber(remoteConfig, "max_on_device_chars"),
      cloudModel: getString(remoteConfig, "cloud_model"),
    });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
