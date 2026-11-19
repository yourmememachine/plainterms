/** Shared types for PlainTerms. */

/** The kind of AI job the user asked for. */
export type TaskKind = "explain-clause" | "document-brief" | "ask-document";

/** Where a result actually came from. */
export type InferenceSource = "on-device" | "cloud" | "local-fallback";

/**
 * Hybrid inference modes, mirroring Firebase AI Logic's InferenceMode 1:1.
 * No PlainTerms job requests ONLY_IN_CLOUD: cloud-preferred jobs keep the
 * on-device fallback, which is part of the hybrid design.
 */
export type HybridMode =
  | "PREFER_ON_DEVICE"
  | "ONLY_ON_DEVICE"
  | "PREFER_IN_CLOUD"
  | "ONLY_IN_CLOUD";

export interface RoutingSettings {
  /** Passages up to this many characters are steered to the on-device model. */
  maxOnDeviceChars: number;
  /** Cloud model used when a request escalates. */
  cloudModel: string;
}

export const DEFAULT_SETTINGS: RoutingSettings = {
  maxOnDeviceChars: 1200,
  cloudModel: "gemini-3.8-flash",
};

/** Chrome Prompt API availability states for the on-device model. */
export type OnDeviceStatus = "available" | "downloadable" | "downloading" | "unavailable";

export interface EnvironmentState {
  /** Tri-state on-device model status from the Chrome Prompt API. */
  onDevice: OnDeviceStatus;
  /** Browser reports a network connection. */
  online: boolean;
  /** A Firebase project is configured, so cloud calls are possible. */
  firebaseConfigured: boolean;
}

export interface RoutingDecision {
  mode: HybridMode;
  /** Plain-language explanation of the decision, shown in the UI and ledger. */
  reason: string;
  /** True when the router expects the local fallback engine to end up serving. */
  expectLocalFallback: boolean;
  /**
   * True when the user is simulating offline: cloud paths must not be used
   * even though the browser is really online, so PREFER_* model calls are
   * suppressed below the router.
   */
  forceLocal: boolean;
}

export interface InferenceRequest {
  task: TaskKind;
  /** The full prompt text to send to the model. */
  prompt: string;
  /** Character count of the source passage (drives routing). */
  sourceChars: number;
}

export interface InferenceResult {
  text: string;
  source: InferenceSource;
  latencyMs: number;
  /** Routing mode that was requested for this call. */
  requestedMode: HybridMode;
  /** Why the router chose that mode (annotated if degradation happened). */
  routingReason: string;
  /** Set when a model call was attempted and failed: the error's message. */
  degradedReason?: string;
}

/** One entry in the inference ledger (and in saved history). */
export interface LedgerEntry {
  id: string;
  at: number;
  task: TaskKind;
  requestedMode: HybridMode;
  source: InferenceSource;
  latencyMs: number;
  routingReason: string;
}

export interface AnalysisRecord {
  id: string;
  at: number;
  title: string;
  task: TaskKind;
  source: InferenceSource;
  excerpt: string;
  result: string;
}
