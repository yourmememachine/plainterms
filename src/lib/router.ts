import type {
  EnvironmentState,
  RoutingDecision,
  RoutingSettings,
  TaskKind,
} from "./types";
import { mergeSettings } from "./remoteConfig";

export interface RouteInput {
  task: TaskKind;
  sourceChars: number;
  /** Privacy mode: nothing may leave the device. */
  privacyMode: boolean;
  /** User toggled "simulate offline" to demonstrate local behaviour. */
  simulateOffline: boolean;
  env: EnvironmentState;
  settings?: Partial<RoutingSettings>;
}

/**
 * The routing policy at the heart of PlainTerms.
 *
 * Short, interactive work (explaining one clause, answering a quick question
 * about a passage) belongs on the device: it is instant, it works offline,
 * and the text of a private document is handled locally. Whole-document
 * synthesis belongs in the cloud, where the larger model and context window
 * earn their place. Privacy mode hard-pins everything to the device.
 *
 * The router only *requests* a hybrid mode; the service layer records where
 * the answer actually came from, and annotates the reason when reality
 * differed from the plan.
 */
export function routeRequest(input: RouteInput): RoutingDecision {
  const settings = mergeSettings(input.settings ?? {});
  const max = settings.maxOnDeviceChars;
  const deviceReady = input.env.onDevice === "available";
  const cloudUsable = input.env.firebaseConfigured && input.env.online;
  const offline = !input.env.online || input.simulateOffline;
  const base = { forceLocal: input.simulateOffline };

  if (input.privacyMode) {
    return {
      ...base,
      mode: "ONLY_ON_DEVICE",
      expectLocalFallback: !deviceReady,
      reason: deviceReady
        ? "Privacy mode: this request is pinned to the on-device model and never sent to the cloud."
        : "Privacy mode: no on-device model is ready, so the built-in local engine answers instead of the cloud.",
    };
  }

  if (input.task === "document-brief") {
    if (cloudUsable && !offline) {
      return {
        ...base,
        mode: "PREFER_IN_CLOUD",
        expectLocalFallback: false,
        reason:
          "Briefs are cloud work: synthesising the whole document needs the larger model's context and reasoning. The on-device model is the fallback.",
      };
    }
    if (deviceReady && input.sourceChars <= max) {
      return {
        ...base,
        mode: "PREFER_ON_DEVICE",
        expectLocalFallback: false,
        reason:
          "No cloud path is available, but this document is short enough for the on-device model to brief.",
      };
    }
    return {
      ...base,
      mode: "PREFER_ON_DEVICE",
      expectLocalFallback: true,
      reason:
        "No cloud path is available and this document is too long for one on-device pass, so the built-in local engine produces the brief from the text.",
    };
  }

  // explain-clause and ask-document: passage-sized jobs.
  if (offline || !cloudUsable) {
    if (deviceReady) {
      return {
        ...base,
        mode: "ONLY_ON_DEVICE",
        expectLocalFallback: false,
        reason:
          "No cloud path is available, so the on-device model answers and the text stays on this device for this request.",
      };
    }
    return {
      ...base,
      mode: "PREFER_ON_DEVICE",
      expectLocalFallback: true,
      reason:
        "No cloud path is available and no on-device model is ready, so the built-in local engine answers from the text.",
    };
  }

  if (input.sourceChars <= max) {
    return {
      ...base,
      mode: "PREFER_ON_DEVICE",
      expectLocalFallback: !deviceReady,
      reason: deviceReady
        ? "Short passage: answered on your device when the model is ready, with the cloud as fallback. The result badge shows where it actually ran."
        : "Short passage, but the on-device model is not ready, so the cloud answers (the local engine covers a cloud failure).",
    };
  }

  return {
    ...base,
    mode: "PREFER_IN_CLOUD",
    expectLocalFallback: false,
    reason:
      "This passage is longer than the on-device comfort zone, so the cloud model answers, with the on-device model as fallback.",
  };
}
