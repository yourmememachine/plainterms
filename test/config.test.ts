import { describe, expect, it } from "vitest";
import {
  appCheckPlan,
  isLoopbackHost,
  readFirebaseConfig,
  useEmulators,
} from "../src/lib/firebase";
import { mergeSettings } from "../src/lib/remoteConfig";
import { DEFAULT_SETTINGS } from "../src/lib/types";

describe("readFirebaseConfig", () => {
  it("returns null when required fields are missing (demo mode)", () => {
    expect(readFirebaseConfig({})).toBeNull();
    expect(readFirebaseConfig({ VITE_FIREBASE_API_KEY: "k" })).toBeNull();
  });

  it("returns a config when the essentials are present", () => {
    const cfg = readFirebaseConfig({
      VITE_FIREBASE_API_KEY: "k",
      VITE_FIREBASE_PROJECT_ID: "p",
      VITE_FIREBASE_APP_ID: "a",
      VITE_FIREBASE_AUTH_DOMAIN: "d",
    });
    expect(cfg?.projectId).toBe("p");
    expect(cfg?.authDomain).toBe("d");
    expect(cfg?.storageBucket).toBe("");
  });
});

describe("mergeSettings", () => {
  it("keeps defaults for empty input", () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("accepts sane overrides and rejects nonsense", () => {
    const merged = mergeSettings({ maxOnDeviceChars: 800, cloudModel: "  " });
    expect(merged.maxOnDeviceChars).toBe(800);
    expect(merged.cloudModel).toBe(DEFAULT_SETTINGS.cloudModel);
    expect(mergeSettings({ maxOnDeviceChars: -5 }).maxOnDeviceChars).toBe(
      DEFAULT_SETTINGS.maxOnDeviceChars,
    );
  });

  it("trims and accepts a model name", () => {
    expect(mergeSettings({ cloudModel: " gemini-3.8-flash " }).cloudModel).toBe("gemini-3.8-flash");
  });
});

describe("App Check planning", () => {
  it("recognises loopback hosts including the one Vite serves", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
  });

  it("loopback without a site key uses the debug flow", () => {
    const plan = appCheckPlan("127.0.0.1", undefined);
    expect(plan.debug).toBe(true);
    expect(plan.status).toBe("debug");
  });

  it("loopback with a site key still uses the debug flow", () => {
    const plan = appCheckPlan("localhost", "site-key");
    expect(plan.debug).toBe(true);
    expect(plan.providerKey).toBe("site-key");
  });

  it("a real host with a site key is a normal init", () => {
    const plan = appCheckPlan("plainterms.web.app", "site-key");
    expect(plan.debug).toBe(false);
    expect(plan.status).toBe("ok");
    expect(plan.providerKey).toBe("site-key");
  });

  it("a real host without a site key still initializes, flagged unconfigured", () => {
    const plan = appCheckPlan("plainterms.web.app", undefined);
    expect(plan.debug).toBe(false);
    expect(plan.status).toBe("unconfigured");
  });
});

describe("useEmulators", () => {
  it("is on only for the exact string true", () => {
    expect(useEmulators({ VITE_USE_EMULATORS: "true" })).toBe(true);
    expect(useEmulators({ VITE_USE_EMULATORS: "1" })).toBe(false);
    expect(useEmulators({})).toBe(false);
  });
});
