import { describe, expect, it } from "vitest";
import { routeRequest, type RouteInput } from "../src/lib/router";
import type { EnvironmentState } from "../src/lib/types";
import { DEFAULT_SETTINGS } from "../src/lib/types";

const env = (over: Partial<EnvironmentState> = {}): EnvironmentState => ({
  onDevice: "available",
  online: true,
  firebaseConfigured: true,
  ...over,
});

const base = (over: Partial<RouteInput> = {}): RouteInput => ({
  task: "explain-clause",
  sourceChars: 300,
  privacyMode: false,
  simulateOffline: false,
  env: env(),
  ...over,
});

describe("routeRequest", () => {
  it("sends short clause explanations to the device first", () => {
    const d = routeRequest(base());
    expect(d.mode).toBe("PREFER_ON_DEVICE");
    expect(d.expectLocalFallback).toBe(false);
    expect(d.forceLocal).toBe(false);
  });

  it("never claims short passages never leave the device on a PREFER route", () => {
    const d = routeRequest(base());
    expect(d.reason).not.toContain("never leaves this device");
    expect(d.reason).toContain("badge shows where it actually ran");
  });

  it("privacy mode hard-pins to the device", () => {
    const d = routeRequest(base({ privacyMode: true, task: "document-brief", sourceChars: 9000 }));
    expect(d.mode).toBe("ONLY_ON_DEVICE");
    expect(d.expectLocalFallback).toBe(false);
  });

  it("privacy mode without a ready device model expects the local engine", () => {
    const d = routeRequest(base({ privacyMode: true, env: env({ onDevice: "unavailable" }) }));
    expect(d.mode).toBe("ONLY_ON_DEVICE");
    expect(d.expectLocalFallback).toBe(true);
    expect(d.reason).toContain("local engine");
  });

  it("a downloadable (not yet ready) model does not count as ready", () => {
    const d = routeRequest(base({ privacyMode: true, env: env({ onDevice: "downloadable" }) }));
    expect(d.expectLocalFallback).toBe(true);
  });

  it("briefs prefer the cloud with one honest reason", () => {
    const short = routeRequest(base({ task: "document-brief", sourceChars: 200 }));
    const long = routeRequest(base({ task: "document-brief", sourceChars: 9000 }));
    expect(short.mode).toBe("PREFER_IN_CLOUD");
    expect(long.mode).toBe("PREFER_IN_CLOUD");
    expect(short.reason).toBe(long.reason);
  });

  it("briefs without a cloud path fall back honestly", () => {
    const d = routeRequest(
      base({ task: "document-brief", sourceChars: 9000, env: env({ firebaseConfigured: false }) }),
    );
    expect(d.expectLocalFallback).toBe(true);
    expect(d.reason).toContain("local engine");
  });

  it("passage boundary: exactly maxOnDeviceChars stays on-device, one more escalates", () => {
    const max = DEFAULT_SETTINGS.maxOnDeviceChars;
    expect(routeRequest(base({ sourceChars: max })).mode).toBe("PREFER_ON_DEVICE");
    expect(routeRequest(base({ sourceChars: max + 1 })).mode).toBe("PREFER_IN_CLOUD");
  });

  it("offline with a ready device model pins short work to the device", () => {
    const d = routeRequest(base({ env: env({ online: false }) }));
    expect(d.mode).toBe("ONLY_ON_DEVICE");
    expect(d.expectLocalFallback).toBe(false);
  });

  it("offline without a device model expects the local engine, without inventing chunking", () => {
    const d = routeRequest(base({ env: env({ online: false, onDevice: "unavailable" }) }));
    expect(d.expectLocalFallback).toBe(true);
    expect(d.reason).toContain("local engine");
    expect(d.reason).not.toContain("in chunks");
  });

  it("simulate offline sets forceLocal so the service layer cannot reach the cloud", () => {
    const d = routeRequest(base({ simulateOffline: true }));
    expect(d.forceLocal).toBe(true);
  });

  it("invalid settings are sanitised by the same validation as everywhere else", () => {
    const d = routeRequest(base({ settings: { maxOnDeviceChars: -5 } }));
    expect(d.mode).toBe("PREFER_ON_DEVICE");
    const d2 = routeRequest(
      base({ sourceChars: DEFAULT_SETTINGS.maxOnDeviceChars + 1, settings: { maxOnDeviceChars: -5 } }),
    );
    expect(d2.mode).toBe("PREFER_IN_CLOUD");
  });

  it("ask-document routes on the passage size it is given, not the document", () => {
    const d = routeRequest(base({ task: "ask-document", sourceChars: 280 }));
    expect(d.mode).toBe("PREFER_ON_DEVICE");
  });

  it("short passage with cloud usable but no ready device model still attempts the model (cloud fallback)", () => {
    const d = routeRequest(base({ env: env({ onDevice: "unavailable" }) }));
    expect(d.mode).toBe("PREFER_ON_DEVICE");
    expect(d.expectLocalFallback).toBe(false);
    expect(d.reason).toContain("the cloud answers");
  });
});
