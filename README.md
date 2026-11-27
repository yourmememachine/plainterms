# PlainTerms — understand any document, privately

**Live demo:** https://plainterms-326cd.web.app
**Demo video:** https://youtu.be/5HSe3sB3JHI

I built PlainTerms because the documents that matter most in everyday life —
a lease, an insurance denial letter, a gym contract, a loan agreement — are
written to be hard to read, and the moment you paste one into a cloud AI tool
you have handed a private document to a server you do not control.

The audience is anyone who has to sign before they understand: renters
reading a lease under time pressure, people reading an insurance denial
letter, gig and platform workers handed terms they cannot negotiate. The
problem is measured, not vibes: Deloitte's 2017 Global Mobile Consumer
Survey found 91% of US consumers accept legal terms without reading them
(97% among 18–34-year-olds), and Citizens Advice found one in three renters
signed a tenancy agreement without fully understanding it — half were only
shown the agreement after putting down money. The obvious fix, "paste it
into a chatbot", hands a private document to a stranger's server.

PlainTerms explains documents in plain English, and it is deliberate about
*where* each piece of work runs:

- **Explaining one clause** or **answering a quick question** runs **on your
  device** first (Gemini Nano, built into Chrome). When the device model
  answers it is instant and the text stays on the machine — and when the
  device model is not ready, the same passage falls back to the **cloud**
  model. The badge on every answer says which one actually ran.
- **A full document brief** — summary, obligations, money, deadlines, traps —
  escalates to the **cloud** (Gemini via Firebase AI Logic), where the larger
  model and context window earn their keep.
- **Privacy mode** pins everything to the device — inference *and* history:
  a privacy-mode answer is never written to cloud storage. If no model is reachable at
  all, a built-in local engine still answers with extractive summaries and a
  pattern-based red-flag scan — and every answer is labelled with where it
  actually ran. Nothing pretends.

Every request is logged in an on-screen **inference ledger**: the task, the
route requested, where it actually ran, and how long it took. The routing is
the product, so the routing is visible.

## Three levels of privacy

"Private" is not one promise; PlainTerms separates it into three levels and
labels which one produced every answer:

- **Preferred local (the default).** Short jobs request the on-device model
  first. If it is not ready, the relevant passage may be sent to the cloud
  model — that fallback is the hybrid working as designed, and the badge
  and ledger disclose it. History is saved to your (anonymous) account.
- **Cloud.** Full document briefs and over-long passages are deliberately
  sent to the cloud model: whole-document synthesis is what it is for.
- **Strict privacy (Privacy mode).** Everything is pinned to the device
  (`ONLY_ON_DEVICE`): no cloud fallback is attempted, and history is kept
  only in this browser, never written to the cloud. This is the only level
  where document text never leaves the machine — and if no device model is
  ready, the built-in local engine answers instead of the cloud. An
  automated regression test fails the build if a privacy-mode operation
  ever reaches the cloud provider or the cloud history store
  (`test/privacy.test.ts`).

**Platform:** Web (Chrome desktop). **Built with:** Firebase AI Logic hybrid
inference, App Check, Anonymous Authentication, Firestore, Remote Config,
TypeScript + Vite. Licensed under Apache-2.0.

## Try it

Without any Firebase configuration the app runs in demo mode: routing,
red-flag scan, history, and the local engine all work, and the lease sample
is preloaded so the first screen is a working document — but model calls
resolve to the local engine. Connect a Firebase project (below) to light up
real on-device and cloud inference.

The fastest path is a sample: open the app, pick **"Apartment lease excerpt"**
from the sample menu, click a clause, and hit **Explain selected clause**.
Then run the **Full document brief** and the **Red-flag scan**, and watch the
ledger record three different routes. Toggle **Privacy mode** and
**Simulate offline** to see the routing change. You can also open a real
document — .txt, .md, or PDF (text is extracted on-device).

## How the hybrid routing works

`src/lib/router.ts` holds the policy; `src/lib/ai/` holds the machinery:

| Job | Route requested | Why |
| --- | --- | --- |
| Explain a clause (≤ ~1,200 chars) | `PREFER_ON_DEVICE` | Interactive and private; on-device is instant and free, cloud is the fallback |
| Ask a question about the document | `PREFER_ON_DEVICE` | The best-matching passage is selected first, then routed on its size — a question about page 9 of a lease is still passage-sized work |
| Explain a long passage | `PREFER_IN_CLOUD` | Past the on-device sweet spot; cloud context and reasoning win |
| Full document brief | `PREFER_IN_CLOUD` | Whole-document synthesis is the cloud model's job |
| Anything, with Privacy mode on | `ONLY_ON_DEVICE` | The user's text must not leave the device, full stop |
| Anything, while offline | on-device / local engine | A brief that cannot reach the cloud degrades instead of failing |

Firebase AI Logic does the heavy lifting: a `GenerativeModel` is created per
requested mode (`InferenceMode` from `firebase/ai`), the SDK runs the prompt
on-device via Chrome's Prompt API when available and falls back to the cloud
model otherwise, and the response's `inferenceSource` tells the app where
the answer actually came from — that is what the badge and the ledger show.
If the model call throws (offline, quota, unsupported browser), the service
layer degrades to the local engine and records that honestly.

The threshold (`maxOnDeviceChars`) and the cloud model name live in
**Remote Config** (`max_on_device_chars`, `cloud_model`) with in-code
defaults, so the device/cloud balance can be tuned without a redeploy.

## Firebase services used

- **Firebase AI Logic** (`firebase/ai`, Gemini Developer API backend) — all
  model calls, hybrid on-device/cloud.
- **App Check** — enforced for AI Logic, so it is always initialized when a
  project is configured; reCAPTCHA Enterprise in production, debug-token
  flow on loopback hosts (localhost / 127.0.0.1; debug tokens registered in
  the console). The status chips show which mode is active.
- **Authentication** — anonymous sign-in; history is owned per user.
- **Firestore** — analysis history under `users/{uid}/analyses`, locked down
  by `firestore.rules` (owner-only).
- **Remote Config** — routing thresholds and cloud model selection.
- **Hosting** — static hosting for the built app (optional; any static host works).

## Run it locally

You need Node 20+ and Chrome 139+ desktop for on-device inference.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # 98 unit tests: routing, orchestration, providers, scan, engine, stores
npm run build      # type-check + production build to dist/
```

### Connect your own Firebase project (free tier)

Everything below works on the no-cost Spark plan; no billing is required.

1. In the [Firebase console](https://console.firebase.google.com), create a
   project (no Google Analytics needed) and add a **Web app**.
2. Go to **AI Logic** and run the *Get started* workflow; choose the
   **Gemini Developer API** as the provider (free). The workflow enables the
   required APIs and enforces App Check.
3. Under **App Check**, register a reCAPTCHA Enterprise key for your web app
   and put it in `VITE_APPCHECK_SITE_KEY`. For local development you can
   leave it empty: on localhost / 127.0.0.1 the app uses the debug-token
   flow — run the app once, copy the debug token printed in the browser
   console, and register it under **App Check → Apps → Manage debug tokens**.
4. Enable **Authentication → Anonymous** sign-in, and create a **Firestore**
   database (production mode; deploy `firestore.rules` with
   `firebase deploy --only firestore:rules`, or paste the rules in the console).
5. Copy `.env.example` to `.env` and fill in your web app config values.
6. Optionally publish the Remote Config parameters named above.
7. Set your project id in `.firebaserc`, then `npm run build` and
   `firebase deploy` if you want it hosted.

To try the Firebase Emulator Suite for Auth and Firestore, set
`VITE_USE_EMULATORS=true` in `.env` and run:

```bash
npx firebase emulators:start   # requires Java; config in firebase.json
```

AI Logic and App Check are not emulated — model calls in emulator mode
still go to the real services (or degrade to the local engine).

## Project layout

```
src/
  main.ts                  App shell and wiring
  style.css                Styling (no framework)
  lib/
    types.ts               Shared types + default routing settings
    router.ts              The routing policy (pure, unit-tested)
    prompts.ts             Single-turn prompt builders
    chunk.ts               Clause splitter for pasted documents
    redflags.ts            Deterministic trap-pattern scan
    fallback.ts            Built-in local engine (extractive answers)
    samples.ts             One-click sample documents
    pdf.ts                 On-device PDF text extraction (lazy-loaded)
    firebase.ts            Firebase init: App Check, Auth, Firestore, Remote Config
    remoteConfig.ts        Threshold loading with safe merging
    store.ts               History: Firestore + local implementations
    ai/
      provider.ts          InferenceProvider interface
      hybridProvider.ts    Firebase AI Logic hybrid inference
      localProvider.ts     Local engine behind the same interface
      service.ts           Orchestration: model first, degrade honestly
test/                      Vitest suite (99 tests)
firestore.rules            Owner-only history access
firebase.json              Hosting / Firestore / emulator configuration
```

## For reviewers

- **Evidence map:** [EVIDENCE.md](EVIDENCE.md) ties each claim in this
  README to its proof — fresh-profile first-run results, the privacy
  regression test, the red-flag bench, and a live cross-user Firestore
  check.
- **Accuracy benchmark:** [BENCHMARK.md](BENCHMARK.md) — 23 clause
  scenarios run against the app's deterministic paths, failures
  included.
- The hosted build runs against a real Firebase project: load it, explain a
  clause (badge: *Ran on your device* in Chrome 139+ with the built-in model
  ready; otherwise *Ran in the cloud*), then run a full brief (cloud) and
  watch the **inference ledger** record each route.
- To run it yourself: `npm install`, copy `.env.example` to `.env` (empty =
  demo mode with the local engine), `npm run dev`, `npm test`.
- No billing is involved anywhere: the Gemini Developer API backend and the
  Spark plan cover every service used.

## Sources for the problem statement

- Deloitte, *Global Mobile Consumer Survey: US Edition* (2017) — 91% accept
  terms without reading; 97% for ages 18–34.
- Citizens Advice (England), *Rental Roulette* (October 2018) — one in
  three renters signed a tenancy agreement without fully understanding it;
  51% were shown the agreement only after putting down money.

## Notes and limits

- On-device inference needs Chrome 139+ on desktop with the built-in model
  available; elsewhere the same requests fall back to the cloud, and then to
  the local engine. The app is designed so every one of those states is a
  working product, not an error page.
- On-device generation is single-turn text only, so every PlainTerms job is
  phrased as one self-contained prompt.
- PlainTerms gives general information about documents, not legal advice.

## License

Apache-2.0 — see [LICENSE](LICENSE). Copyright 2026 Dilip Teneti.
