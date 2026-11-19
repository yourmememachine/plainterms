import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  type Auth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import { getRemoteConfig, type RemoteConfig } from "firebase/remote-config";

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

/** Read the web config from Vite env vars. Returns null in demo mode. */
export function readFirebaseConfig(env: Record<string, string | undefined>): FirebaseConfig | null {
  const cfg: FirebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: env.VITE_FIREBASE_APP_ID ?? "",
  };
  return cfg.apiKey && cfg.projectId && cfg.appId ? cfg : null;
}

/** Hosts where the App Check debug-token flow applies (Vite serves 127.0.0.1). */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export type AppCheckStatus = "ok" | "debug" | "unconfigured";

export interface AppCheckPlan {
  /** Set FIREBASE_APPCHECK_DEBUG_TOKEN before initializing App Check. */
  debug: boolean;
  /** Provider key to construct; on loopback the debug exchange ignores it. */
  providerKey: string;
  status: AppCheckStatus;
}

/**
 * App Check is always initialized when Firebase is configured — Firebase AI
 * Logic enforces it, so skipping init means cloud calls fail silently. On
 * loopback hosts the debug-token flow takes over the token exchange (the SDK
 * prints a token to register in the console), whatever provider is set.
 */
export function appCheckPlan(hostname: string, siteKey: string | undefined): AppCheckPlan {
  const debug = isLoopbackHost(hostname);
  return {
    debug,
    providerKey: siteKey ?? "debug-placeholder",
    status: debug ? "debug" : siteKey ? "ok" : "unconfigured",
  };
}

/** Emulator wiring is opt-in via VITE_USE_EMULATORS=true; off by default. */
export function useEmulators(env: Record<string, string | undefined>): boolean {
  return env.VITE_USE_EMULATORS === "true";
}

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  remoteConfig: RemoteConfig;
  /** Null when anonymous sign-in failed; the app then keeps history local. */
  uid: string | null;
  appCheck: AppCheckStatus;
}

/**
 * Initialize Firebase with the services PlainTerms uses: App Check
 * (required by Firebase AI Logic), anonymous Auth (history ownership),
 * Firestore (history), and Remote Config (routing thresholds). Each service
 * degrades independently — a failed anonymous sign-in keeps answers working
 * and only moves history to this device. Returns null when no project is
 * configured; the app then runs fully locally, a supported mode.
 */
export async function initFirebase(
  config: FirebaseConfig | null,
  appCheckSiteKey: string | undefined,
  env: Record<string, string | undefined> = {},
): Promise<FirebaseServices | null> {
  if (!config) return null;
  const app = initializeApp(config);

  const hostname = typeof location !== "undefined" ? location.hostname : "";
  const plan = appCheckPlan(hostname, appCheckSiteKey);
  if (plan.debug && typeof self !== "undefined") {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(plan.providerKey),
    isTokenAutoRefreshEnabled: true,
  });

  const emulators = useEmulators(env);
  const auth = getAuth(app);
  if (emulators) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  if (emulators) connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const remoteConfig = getRemoteConfig(app);
  remoteConfig.settings.minimumFetchIntervalMillis = 60_000;

  let uid: string | null = null;
  try {
    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
  } catch {
    uid = null;
  }
  return { app, auth, db, remoteConfig, uid, appCheck: plan.status };
}
