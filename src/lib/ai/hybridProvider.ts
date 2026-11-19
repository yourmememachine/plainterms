import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
} from "firebase/ai";
import type { FirebaseApp } from "firebase/app";
import type { HybridMode, OnDeviceStatus, RoutingSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import type { InferenceProvider, ProviderOutput } from "./provider";

/** The slice of the SDK model surface PlainTerms uses — stubbed in tests. */
export interface ModelLike {
  generateContent(prompt: string): Promise<{
    response: { text(): string; inferenceSource?: string };
  }>;
  initializeDeviceModel(onProgress?: (fraction: number) => void): Promise<void>;
}

export type ModelFactory = (mode: HybridMode) => ModelLike;

/**
 * Firebase AI Logic hybrid inference.
 *
 * One GenerativeModel is cached per requested mode: the SDK attaches the
 * on-device model's download state to the model instance, so priming and
 * generating must go through the same instance. The response's
 * `inferenceSource` tells us where the answer actually came from; if the SDK
 * does not report a source, generate() throws rather than guessing, so the
 * UI badge never lies.
 */
export class HybridProvider implements InferenceProvider {
  readonly name = "firebase-ai-logic";
  private readonly factory: ModelFactory;
  private readonly models = new Map<HybridMode, ModelLike>();
  private deviceModelPrimed = false;

  constructor(
    app: FirebaseApp,
    settings: RoutingSettings = DEFAULT_SETTINGS,
    factory?: ModelFactory,
  ) {
    this.factory =
      factory ??
      ((mode: HybridMode) => {
        const ai = getAI(app, { backend: new GoogleAIBackend() });
        const model: GenerativeModel = getGenerativeModel(ai, {
          mode: InferenceMode[mode],
          inCloudParams: { model: settings.cloudModel },
        });
        return model as unknown as ModelLike;
      });
  }

  private modelFor(mode: HybridMode): ModelLike {
    let model = this.models.get(mode);
    if (!model) {
      model = this.factory(mode);
      this.models.set(mode, model);
    }
    return model;
  }

  /**
   * Prime the on-device model (downloads Gemini Nano in Chrome if needed).
   * Callers await this after a user interaction and before device inference:
   * without it, ONLY_ON_DEVICE errors and PREFER_ON_DEVICE silently falls
   * back to the cloud. A failed prime does not latch — the next call retries.
   */
  async primeDeviceModel(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.deviceModelPrimed) return;
    const model = this.modelFor("PREFER_ON_DEVICE");
    await model.initializeDeviceModel(onProgress);
    this.deviceModelPrimed = true;
  }

  get primed(): boolean {
    return this.deviceModelPrimed;
  }

  async generate(prompt: string, mode: HybridMode): Promise<ProviderOutput> {
    const model = this.modelFor(mode);
    const result = await model.generateContent(prompt);
    const reported = result.response.inferenceSource;
    if (reported === InferenceSource.ON_DEVICE) {
      return { text: result.response.text(), source: "on-device" };
    }
    if (reported === InferenceSource.IN_CLOUD) {
      return { text: result.response.text(), source: "cloud" };
    }
    throw new Error("The model response did not report where inference ran.");
  }
}

/**
 * Ask Chrome's Prompt API what state the on-device model is in. Only
 * "available" means ready to answer right now; "downloadable" and
 * "downloading" mean a prime/download still has to happen first. Absence of
 * the API means no on-device model, a normal state the router handles.
 */
export async function probeOnDeviceAvailability(): Promise<OnDeviceStatus> {
  try {
    const lm = (globalThis as { LanguageModel?: { availability?: () => Promise<string> } })
      .LanguageModel;
    if (!lm || typeof lm.availability !== "function") return "unavailable";
    const status = await lm.availability();
    if (status === "available" || status === "downloadable" || status === "downloading") {
      return status;
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
