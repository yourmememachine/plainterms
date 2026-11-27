import { describe, expect, it } from "vitest";
import { InferenceService } from "../src/lib/ai/service";
import type { InferenceProvider, ProviderOutput } from "../src/lib/ai/provider";
import { routeRequest } from "../src/lib/router";
import { historyStoreFor, type HistoryStore } from "../src/lib/store";
import type { AnalysisRecord, HybridMode, RoutingDecision } from "../src/lib/types";

/**
 * Privacy regression bench. Privacy mode is the product's one absolute
 * guarantee: document text must not be sent to the cloud model and must
 * not be written to the cloud (Firestore) history store. These tests wire
 * a trap provider and a trap store into the real orchestration seams —
 * if a future change lets a privacy-mode operation reach either one, the
 * suite goes red.
 */

class TrapModelProvider implements InferenceProvider {
  readonly name = "trap-model";
  modesSeen: HybridMode[] = [];
  constructor(private readonly behaviour: (mode: HybridMode) => Promise<ProviderOutput>) {}
  async generate(_prompt: string, mode: HybridMode): Promise<ProviderOutput> {
    this.modesSeen.push(mode);
    return this.behaviour(mode);
  }
}

const localProvider: InferenceProvider = {
  name: "local",
  async generate() {
    return { text: "local answer", source: "local-fallback" };
  },
};

class RecordingStore implements HistoryStore {
  saves: AnalysisRecord[] = [];
  lists = 0;
  readonly name: string;
  constructor(label: string) {
    this.name = label;
  }
  async save(record: Omit<AnalysisRecord, "id">): Promise<AnalysisRecord> {
    const full = { ...record, id: `${this.name}-1` };
    this.saves.push(full);
    return full;
  }
  async list(): Promise<AnalysisRecord[]> {
    this.lists += 1;
    return this.saves;
  }
}

const privacyDecision = (over: Partial<RoutingDecision> = {}): RoutingDecision => ({
  mode: "ONLY_ON_DEVICE",
  reason: "Privacy mode: pinned to the device.",
  expectLocalFallback: false,
  forceLocal: false,
  ...over,
});

const request = { task: "explain-clause" as const, prompt: "PRIVATE DOCUMENT TEXT", sourceChars: 21 };

describe("privacy mode — inference orchestration", () => {
  it("never asks the model provider for a cloud-capable mode", async () => {
    // The trap answers on-device for ONLY_ON_DEVICE and would answer
    // "from the cloud" for any PREFER mode. Privacy must never ask in a
    // mode that permits cloud — the recorded modes are the guarantee.
    const trap = new TrapModelProvider(async (mode) =>
      mode === "ONLY_ON_DEVICE"
        ? { text: "device answer", source: "on-device" }
        : { text: "cloud answer", source: "cloud" },
    );
    const svc = new InferenceService(trap, localProvider);
    const out = await svc.run(request, privacyDecision());
    expect(trap.modesSeen).toEqual(["ONLY_ON_DEVICE"]);
    expect(out.source).toBe("on-device");
  });

  it("when no device model is ready, the model provider is not invoked at all", async () => {
    const trap = new TrapModelProvider(async () => ({ text: "cloud answer", source: "cloud" }));
    const svc = new InferenceService(trap, localProvider);
    const out = await svc.run(request, privacyDecision({ expectLocalFallback: true }));
    expect(trap.modesSeen).toEqual([]);
    expect(out.source).toBe("local-fallback");
  });

  it("a failing device model degrades to the local engine, never to the cloud", async () => {
    const trap = new TrapModelProvider(async () => {
      throw new Error("on-device model unavailable");
    });
    const svc = new InferenceService(trap, localProvider);
    const out = await svc.run(request, privacyDecision());
    expect(trap.modesSeen).toEqual(["ONLY_ON_DEVICE"]);
    expect(out.source).toBe("local-fallback");
    expect(out.text).toBe("local answer");
  });

  it("end to end: the router's privacy decision keeps the trap provider on-device-only", async () => {
    const decision = routeRequest({
      task: "explain-clause",
      sourceChars: 300,
      privacyMode: true,
      simulateOffline: false,
      env: { onDevice: "unavailable", online: true, firebaseConfigured: true },
    });
    expect(decision.mode).toBe("ONLY_ON_DEVICE");
    const trap = new TrapModelProvider(async () => ({ text: "cloud answer", source: "cloud" }));
    const svc = new InferenceService(trap, localProvider);
    const out = await svc.run(request, decision);
    expect(trap.modesSeen.every((m) => m === "ONLY_ON_DEVICE")).toBe(true);
    expect(out.source).toBe("local-fallback");
  });
});

describe("privacy mode — history persistence", () => {
  it("saves and lists go to the local store only; the cloud store sees nothing", async () => {
    const cloud = new RecordingStore("cloud");
    const local = new RecordingStore("local");
    const store = historyStoreFor(true, cloud, local);
    await store.save({
      at: Date.now(),
      title: "Apartment lease excerpt",
      task: "explain-clause",
      source: "local-fallback",
      excerpt: "PRIVATE DOCUMENT TEXT",
      result: "local answer",
    });
    await store.list(8);
    expect(cloud.saves).toEqual([]);
    expect(cloud.lists).toBe(0);
    expect(local.saves).toHaveLength(1);
    expect(local.saves[0].excerpt).toBe("PRIVATE DOCUMENT TEXT");
  });

  it("control case: without privacy mode the cloud store IS used (the trap works)", async () => {
    const cloud = new RecordingStore("cloud");
    const local = new RecordingStore("local");
    const store = historyStoreFor(false, cloud, local);
    await store.save({
      at: Date.now(),
      title: "t",
      task: "explain-clause",
      source: "cloud",
      excerpt: "x",
      result: "y",
    });
    expect(cloud.saves).toHaveLength(1);
    expect(local.saves).toEqual([]);
  });
});
