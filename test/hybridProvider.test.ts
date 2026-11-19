import { afterEach, describe, expect, it } from "vitest";
import type { FirebaseApp } from "firebase/app";
import {
  HybridProvider,
  probeOnDeviceAvailability,
  type ModelFactory,
  type ModelLike,
} from "../src/lib/ai/hybridProvider";
import type { HybridMode } from "../src/lib/types";

const fakeApp = null as unknown as FirebaseApp;

function stubModel(over: Partial<ModelLike> = {}): ModelLike {
  return {
    generateContent: async () => ({
      response: { text: () => "answer", inferenceSource: "on_device" },
    }),
    initializeDeviceModel: async () => {},
    ...over,
  };
}

describe("HybridProvider inferenceSource mapping", () => {
  it("maps the SDK's on_device value to on-device", async () => {
    const provider = new HybridProvider(fakeApp, undefined, () => stubModel());
    const out = await provider.generate("p", "PREFER_ON_DEVICE");
    expect(out.source).toBe("on-device");
    expect(out.text).toBe("answer");
  });

  it("maps the SDK's in_cloud value to cloud", async () => {
    const provider = new HybridProvider(fakeApp, undefined, () =>
      stubModel({
        generateContent: async () => ({
          response: { text: () => "c", inferenceSource: "in_cloud" },
        }),
      }),
    );
    const out = await provider.generate("p", "PREFER_IN_CLOUD");
    expect(out.source).toBe("cloud");
  });

  it("throws instead of guessing when the SDK reports no source", async () => {
    const provider = new HybridProvider(fakeApp, undefined, () =>
      stubModel({
        generateContent: async () => ({ response: { text: () => "?" } }),
      }),
    );
    await expect(provider.generate("p", "PREFER_ON_DEVICE")).rejects.toThrow(
      "did not report",
    );
  });
});

describe("HybridProvider model caching and priming", () => {
  it("creates one model per mode and reuses it", async () => {
    const made: HybridMode[] = [];
    const factory: ModelFactory = (mode) => {
      made.push(mode);
      return stubModel();
    };
    const provider = new HybridProvider(fakeApp, undefined, factory);
    await provider.generate("a", "PREFER_ON_DEVICE");
    await provider.generate("b", "PREFER_ON_DEVICE");
    await provider.generate("c", "PREFER_IN_CLOUD");
    expect(made).toEqual(["PREFER_ON_DEVICE", "PREFER_IN_CLOUD"]);
  });

  it("primes the same instance that later generates", async () => {
    let primedInstance: ModelLike | null = null;
    let generatedInstance: ModelLike | null = null;
    const model = stubModel({
      initializeDeviceModel: async () => {
        primedInstance = model;
      },
      generateContent: async () => {
        generatedInstance = model;
        return { response: { text: () => "x", inferenceSource: "on_device" } };
      },
    });
    const provider = new HybridProvider(fakeApp, undefined, () => model);
    await provider.primeDeviceModel();
    await provider.generate("p", "PREFER_ON_DEVICE");
    expect(primedInstance).toBe(model);
    expect(generatedInstance).toBe(model);
    expect(provider.primed).toBe(true);
  });

  it("a failed prime does not latch — the next call retries", async () => {
    let attempts = 0;
    const model = stubModel({
      initializeDeviceModel: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("download interrupted");
      },
    });
    const provider = new HybridProvider(fakeApp, undefined, () => model);
    await expect(provider.primeDeviceModel()).rejects.toThrow("download interrupted");
    expect(provider.primed).toBe(false);
    await provider.primeDeviceModel();
    expect(provider.primed).toBe(true);
    expect(attempts).toBe(2);
  });

  it("reports download progress fractions while priming", async () => {
    const model = stubModel({
      initializeDeviceModel: async (cb) => {
        cb?.(0.25);
        cb?.(1);
      },
    });
    const provider = new HybridProvider(fakeApp, undefined, () => model);
    const seen: number[] = [];
    await provider.primeDeviceModel((f) => seen.push(f));
    expect(seen).toEqual([0.25, 1]);
  });
});

describe("probeOnDeviceAvailability", () => {
  afterEach(() => {
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
  });

  it("returns unavailable when the Prompt API is absent", async () => {
    expect(await probeOnDeviceAvailability()).toBe("unavailable");
  });

  it("passes through each Chrome availability state distinctly", async () => {
    for (const status of ["available", "downloadable", "downloading", "unavailable"] as const) {
      (globalThis as { LanguageModel?: unknown }).LanguageModel = {
        availability: async () => status,
      };
      expect(await probeOnDeviceAvailability()).toBe(status);
    }
  });

  it("maps an unexpected status to unavailable", async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => "after-download",
    };
    expect(await probeOnDeviceAvailability()).toBe("unavailable");
  });
});
