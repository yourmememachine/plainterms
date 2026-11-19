import type { HybridMode, TaskKind } from "../types";
import type { InferenceProvider, ProviderOutput } from "./provider";
import { localAnswer } from "../fallback";

/** The built-in engine exposed through the provider interface. */
export class LocalProvider implements InferenceProvider {
  readonly name = "local-engine";

  constructor(
    private readonly task: TaskKind,
    private readonly sourceText: string,
    private readonly question?: string,
  ) {}

  async generate(_prompt: string, _mode: HybridMode): Promise<ProviderOutput> {
    return {
      text: localAnswer(this.task, this.sourceText, this.question),
      source: "local-fallback",
    };
  }
}
