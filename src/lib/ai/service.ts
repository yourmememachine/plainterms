import type { InferenceRequest, InferenceResult, RoutingDecision } from "../types";
import type { InferenceProvider } from "./provider";

/**
 * Runs one request: ask the model provider under the routed mode, and if the
 * model path fails for any reason (offline, unsupported browser, quota,
 * empty output), degrade to the local provider so the user always gets an
 * answer. The result records what actually served the request, and when a
 * model attempt failed, why — the UI shows that instead of staying silent.
 */
export class InferenceService {
  constructor(
    private readonly modelProvider: InferenceProvider | null,
    private readonly localProvider: InferenceProvider,
  ) {}

  async run(request: InferenceRequest, decision: RoutingDecision): Promise<InferenceResult> {
    const started = performance.now();
    const finish = (
      text: string,
      source: InferenceResult["source"],
      routingReason: string,
      degradedReason?: string,
    ): InferenceResult => ({
      text,
      source,
      latencyMs: Math.round(performance.now() - started),
      requestedMode: decision.mode,
      routingReason,
      ...(degradedReason ? { degradedReason } : {}),
    });

    // Offline simulation must be honest: a PREFER_* SDK call could still
    // reach the real cloud, so the model is not called at all. ONLY_ON_DEVICE
    // calls cannot leave the device and stay allowed.
    const suppressedBySimulation =
      decision.forceLocal && decision.mode !== "ONLY_ON_DEVICE";

    if (this.modelProvider && !decision.expectLocalFallback && !suppressedBySimulation) {
      try {
        const out = await this.modelProvider.generate(request.prompt, decision.mode);
        if (out.text.trim().length === 0) {
          throw new Error("The model returned an empty answer.");
        }
        return finish(out.text, out.source, decision.reason);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const out = await this.localProvider.generate(request.prompt, decision.mode);
        return finish(
          out.text,
          out.source,
          `${decision.reason} The model was unavailable (${message}), so the local engine answered instead.`,
          message,
        );
      }
    }

    const out = await this.localProvider.generate(request.prompt, decision.mode);
    const reason = suppressedBySimulation
      ? `${decision.reason} Offline simulation is on: cloud paths are disabled, so the local engine answered.`
      : decision.reason;
    return finish(out.text, out.source, reason);
  }
}
