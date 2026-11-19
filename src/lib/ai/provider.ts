import type { HybridMode, InferenceSource } from "../types";

/** Raw output of one model call, before the service layer labels it. */
export interface ProviderOutput {
  text: string;
  source: InferenceSource;
}

/**
 * Anything that can answer a prompt under a requested hybrid mode.
 * The Firebase implementation and the local engine both satisfy this,
 * which keeps the orchestration logic testable without a network.
 */
export interface InferenceProvider {
  readonly name: string;
  generate(prompt: string, mode: HybridMode): Promise<ProviderOutput>;
}
