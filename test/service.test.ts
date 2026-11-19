import { describe, expect, it } from "vitest";
import { InferenceService } from "../src/lib/ai/service";
import type { InferenceProvider, ProviderOutput } from "../src/lib/ai/provider";
import type { HybridMode, RoutingDecision } from "../src/lib/types";

class FakeProvider implements InferenceProvider {
  calls = 0;
  seen: { prompt: string; mode: HybridMode }[] = [];
  constructor(
    readonly name: string,
    private readonly behaviour: () => Promise<ProviderOutput>,
  ) {}
  async generate(prompt: string, mode: HybridMode): Promise<ProviderOutput> {
    this.calls += 1;
    this.seen.push({ prompt, mode });
    return this.behaviour();
  }
}

const decision = (over: Partial<RoutingDecision> = {}): RoutingDecision => ({
  mode: "PREFER_ON_DEVICE",
  reason: "test route",
  expectLocalFallback: false,
  forceLocal: false,
  ...over,
});

const request = { task: "explain-clause" as const, prompt: "p", sourceChars: 10 };
const okLocal = () =>
  new FakeProvider("local", async () => ({ text: "local", source: "local-fallback" }));

describe("InferenceService", () => {
  it("returns the model provider's answer and its true source, forwarding prompt and mode", async () => {
    const model = new FakeProvider("model", async () => ({ text: "hi", source: "on-device" }));
    const local = okLocal();
    const svc = new InferenceService(model, local);
    const out = await svc.run(request, decision({ mode: "PREFER_IN_CLOUD" }));
    expect(out.text).toBe("hi");
    expect(out.source).toBe("on-device");
    expect(out.degradedReason).toBeUndefined();
    expect(local.calls).toBe(0);
    expect(model.seen).toEqual([{ prompt: "p", mode: "PREFER_IN_CLOUD" }]);
  });

  it("degrades to the local engine and says why when the model call throws", async () => {
    const model = new FakeProvider("model", async () => {
      throw new Error("quota exceeded");
    });
    const svc = new InferenceService(model, okLocal());
    const out = await svc.run(request, decision());
    expect(out.source).toBe("local-fallback");
    expect(out.text).toBe("local");
    expect(out.degradedReason).toContain("quota exceeded");
    expect(out.routingReason).toContain("quota exceeded");
    expect(out.routingReason).toContain("local engine answered instead");
  });

  it("treats an empty model answer as a failure and degrades", async () => {
    const model = new FakeProvider("model", async () => ({ text: "   ", source: "cloud" }));
    const svc = new InferenceService(model, okLocal());
    const out = await svc.run(request, decision());
    expect(out.source).toBe("local-fallback");
    expect(out.degradedReason).toContain("empty");
  });

  it("skips the model entirely when the router expects local fallback", async () => {
    const model = new FakeProvider("model", async () => ({ text: "hi", source: "cloud" }));
    const svc = new InferenceService(model, okLocal());
    const out = await svc.run(request, decision({ expectLocalFallback: true }));
    expect(model.calls).toBe(0);
    expect(out.source).toBe("local-fallback");
    expect(out.routingReason).toBe("test route");
  });

  it("offline simulation suppresses PREFER model calls entirely", async () => {
    const model = new FakeProvider("model", async () => ({ text: "hi", source: "cloud" }));
    const svc = new InferenceService(model, okLocal());
    const out = await svc.run(request, decision({ forceLocal: true }));
    expect(model.calls).toBe(0);
    expect(out.source).toBe("local-fallback");
    expect(out.routingReason).toContain("Offline simulation");
  });

  it("offline simulation still allows ONLY_ON_DEVICE model calls", async () => {
    const model = new FakeProvider("model", async () => ({ text: "hi", source: "on-device" }));
    const svc = new InferenceService(model, okLocal());
    const out = await svc.run(request, decision({ forceLocal: true, mode: "ONLY_ON_DEVICE" }));
    expect(model.calls).toBe(1);
    expect(out.source).toBe("on-device");
  });

  it("works with no model provider at all (demo mode)", async () => {
    const svc = new InferenceService(null, okLocal());
    const out = await svc.run(request, decision());
    expect(out.source).toBe("local-fallback");
  });
});
