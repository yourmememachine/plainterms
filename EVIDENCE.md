# PlainTerms — evidence map

Every load-bearing claim in the README and the Devpost entry, mapped to
the proof a reviewer can check. Verified 2026-11-27 against the live app
(https://plainterms-326cd.web.app), this repo, and the Firebase project.

## The hosted app runs Firebase-configured, not in demo mode

- A fresh browser profile shows the status chips **"Cloud: Firebase
  connected"**, **"App Check: on"**, **"History: saved to your account"**
  (demo mode instead shows "Demo mode: connect a Firebase project" and
  never touches the network).
- Model calls go to the real project endpoint
  (`firebasevertexai.googleapis.com/v1beta/projects/plainterms-326cd/models/gemini-3.8-flash:generateContent`)
  and history rows written in one session are read back from Firestore in
  the UI.

## Fresh-profile first run (2026-11-27, empty profile, no prior session)

- The app loads with no stored state; anonymous sign-in succeeds without
  any user action; the lease sample loads and splits into 8 clauses.
- A clause explanation and a full brief both complete. When the cloud
  model answers, the badge says "Ran in the cloud"; in one fresh session
  the generateContent call returned HTTP 200.
- When the model cannot answer — observed causes: Gemini capacity errors
  (HTTP 500/503, "high demand") and App Check's reCAPTCHA declining to
  issue a token to an automated headless browser (token exchange 403 →
  AI call 401) — the app degrades to the built-in local engine, labels
  the answer "Ran locally (no model)", and shows the model's error in the
  result meta line. It never blocks the visitor and never upgrades a
  local answer's label. App Check enforcement itself was verified live:
  requests without a valid token are rejected (401), requests with one
  reach the model.

## The badge never guesses where inference ran

- `src/lib/ai/hybridProvider.ts`: if the Firebase AI Logic response does
  not report an `inferenceSource`, `generate()` throws instead of
  guessing — the UI can only display a source the SDK actually reported.
- `src/lib/ai/service.ts`: any model failure degrades to the local engine
  with the failure message carried into the UI, so a degraded answer is
  visibly degraded.

## Routing does what the text says

- Short passages route `PREFER_ON_DEVICE`; when the device model is not
  ready, the hybrid SDK falls back to the cloud. A regression test
  (`test/router.test.ts`, "short passage with cloud usable but no ready
  device model still attempts the model") pins a bug where that fallback
  was silently skipped (fixed in commit c79fbe0).
- The full policy is unit-tested in `test/router.test.ts` (14 tests).

## Privacy mode is enforced, and the enforcement is tested

- Privacy mode routes `ONLY_ON_DEVICE` and stores history only in the
  browser. `test/privacy.test.ts` (6 tests) wires a trap model provider
  and a trap cloud store into the real orchestration seams
  (`InferenceService`, `historyStoreFor`): the suite fails if a
  privacy-mode operation ever requests a cloud-capable mode or writes to
  the cloud store. A control test proves the traps do fire in normal
  mode.
- The three privacy levels (Preferred local / Cloud / Strict privacy)
  are spelled out in the README and in the app itself, above the
  document box, before anything is run.

## On-device capture attempt (2026-11-27) — blocked by the machine, documented

A deliberate attempt was made to capture a genuine `ON_DEVICE`
invocation (badge "Ran on your device") from the deployed build, using
Google Chrome for Testing 157.0.8103.50 on this Linux x86_64 VM (no
physical GPU). Three launch configurations were tried against the live
app, polling `LanguageModel.availability()` for ~2 minutes each:

- **A — feature flags on** (`OptimizationGuideOnDeviceModel`,
  `PromptApiForGeminiNano`; SwiftShader WebGL): the Prompt API exists,
  `availability()` returned **"unavailable"** on every poll; WebGPU
  exposed **no adapter**.
- **B — A plus the performance-requirement bypass**
  (`OptimizationGuideOnDeviceModel:BypassPerfRequirement/true`):
  still **"unavailable"** on every poll.
- **C — B plus a SwiftShader WebGPU adapter**
  (`--use-webgpu-adapter=swiftshader`): a WebGPU adapter was then
  present (`google|swiftshader`, maxBufferSize 1 GiB) — and
  `availability()` **still** returned **"unavailable"** on every poll.

No on-device model component was ever downloaded (the profiles stayed
at ~28 MB; no on-device-model component directory appeared), i.e.
Chrome never reached the "downloadable" state: the eligibility gate
itself refuses on this hardware — a software-rendered adapter in a
Linux VM does not satisfy Chrome's device requirements for Gemini
Nano, and the perf-bypass flag does not override that gate. So no
ON_DEVICE capture exists, and none is claimed. In every run the app
behaved as designed: the status chip honestly read "On-device model:
not available here" and answers degraded to the labelled local engine.
On a supported machine (a real GPU meeting Chrome's requirements) the
same build probes "available"/"downloadable" and primes the model on
the first click — that path is unit-tested (`test/hybridProvider.test.ts`)
but, as of this writing, not captured live. Closing that gap needs one
run on supported hardware; it cannot be produced from this VM.

## Accuracy benchmark

[`BENCHMARK.md`](BENCHMARK.md): 23 clause scenarios (renewal,
termination/notice, indemnity in both directions, rent increase,
conflicting clauses and dates, ambiguous wording, a missing
obligation, prompt-injection text inside the document, an
unanswerable question, exact money/date extraction) run against the
app's real deterministic paths — final run 23/23 scenarios, 39/39
checks. The benchmark's first run failed two scenarios; both failures,
including the real scanner gap it exposed and the fix, are documented
in BENCHMARK.md itself.

## Red-flag scan: bench, including negation

- `test/redflags.test.ts` (22 tests): one positive case per rule, benign
  documents that must stay silent, and negation/exception cases —
  "does not automatically renew", "no early termination fee applies",
  "a cancellation fee will not be charged" — which are reported as
  qualified notes, never as unqualified warnings. A real "shall not be
  liable" waiver is verified NOT to be talked away as a negation.
- The benchmark above caught one phrasing the rule missed — "with 24
  hours' notice" — fixed 2026-11-27 with a failing-first test (see
  BENCHMARK.md). The fix is in this repo; the live site picks it up on
  the next "Deploy to Firebase" workflow dispatch.
- The results UI states, in both the empty and populated states, that a
  scan is pattern matching only and is not a safety verdict.

## Firestore history is owner-only — checked live, cross-user

- Rules (`firestore.rules`): `users/{uid}/analyses` is readable/writable
  only when `request.auth.uid == uid`; everything else is denied.
- Live check (2026-11-27, Firestore REST API, two fresh anonymous
  accounts A and B): A writes an analysis doc → **200**; B reads A's
  doc → **403 PERMISSION_DENIED**; B lists A's collection → **403
  PERMISSION_DENIED**; A reads its own doc back → **200**; probe doc
  deleted afterwards → **200**.

## Problem-statement statistics

- Deloitte, *Global Mobile Consumer Survey: US Edition* (2017): 91% of
  US consumers accept legal terms without reading them; 97% among
  18–34-year-olds.
- Citizens Advice (England), *Rental Roulette* (October 2018): one in
  three renters signed a tenancy agreement without fully understanding
  it; 51% were shown the agreement only after putting down money.

## Test suite

`npm test` — 99 tests, 9 files: routing, orchestration, providers,
privacy regression, red-flag bench, stores, config, PDF, text.
`npm run build` type-checks (`tsc --noEmit`) before bundling.
