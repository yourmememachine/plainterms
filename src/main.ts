import "./style.css";
import { initFirebase, readFirebaseConfig, type FirebaseServices } from "./lib/firebase";
import { loadSettings } from "./lib/remoteConfig";
import { routeRequest } from "./lib/router";
import { buildPrompt } from "./lib/prompts";
import { selectPassage, splitIntoChunks, type Chunk } from "./lib/chunk";
import { scanRedFlags } from "./lib/redflags";
import { splitSentences } from "./lib/fallback";
import { extractPdfText } from "./lib/pdf";
import { SAMPLES } from "./lib/samples";
import {
  FirestoreHistoryStore,
  LocalHistoryStore,
  historyStoreFor,
  type HistoryStore,
} from "./lib/store";
import { HybridProvider, probeOnDeviceAvailability } from "./lib/ai/hybridProvider";
import { LocalProvider } from "./lib/ai/localProvider";
import { InferenceService } from "./lib/ai/service";
import type {
  AnalysisRecord,
  EnvironmentState,
  LedgerEntry,
  OnDeviceStatus,
  RoutingSettings,
  TaskKind,
} from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
};

const docInput = $<HTMLTextAreaElement>("doc-input");
const docStats = $<HTMLElement>("doc-stats");
const chunkList = $<HTMLElement>("chunk-list");
const resultBody = $<HTMLElement>("result-body");
const resultSource = $<HTMLElement>("result-source");
const resultMeta = $<HTMLElement>("result-meta");
const primeProgress = $<HTMLElement>("prime-progress");
const flagsBody = $<HTMLElement>("flags-body");
const ledgerEl = $<HTMLElement>("ledger");
const historyEl = $<HTMLElement>("history-list");
const chipsEl = $<HTMLElement>("status-chips");
const privacyToggle = $<HTMLInputElement>("privacy-mode");
const offlineToggle = $<HTMLInputElement>("offline-sim");
const questionInput = $<HTMLInputElement>("question-input");
const askHint = $<HTMLElement>("ask-hint");
const sampleSelect = $<HTMLSelectElement>("sample-select");
const fileInput = $<HTMLInputElement>("file-input");

let settings: RoutingSettings = { ...DEFAULT_SETTINGS };
let chunks: Chunk[] = [];
let selectedChunk = 0;
let hybrid: HybridProvider | null = null;
let services: FirebaseServices | null = null;
const localStore: HistoryStore = new LocalHistoryStore(localStorage);
let cloudStore: HistoryStore | null = null;
let onDevice: OnDeviceStatus = "unavailable";
const ledger: LedgerEntry[] = [];

/** The store saves go to right now — privacy mode never writes to the cloud. */
function activeStore(): HistoryStore {
  return historyStoreFor(privacyToggle.checked, cloudStore, localStore);
}

function currentEnv(): EnvironmentState {
  return {
    onDevice,
    online: navigator.onLine,
    firebaseConfigured: hybrid !== null,
  };
}

function renderChips(): void {
  const deviceChip =
    onDevice === "available"
      ? { label: "On-device model: ready in this Chrome", cls: "ok" }
      : onDevice === "downloadable"
        ? { label: "On-device model: downloadable — first use downloads it", cls: "" }
        : onDevice === "downloading"
          ? { label: "On-device model: downloading…", cls: "" }
          : { label: "On-device model: not available here", cls: "off" };
  const chips: { label: string; cls: string }[] = [
    deviceChip,
    hybrid
      ? { label: "Cloud: Firebase connected", cls: "ok" }
      : { label: "Demo mode: connect a Firebase project for cloud briefs", cls: "off" },
  ];
  if (services) {
    chips.push(
      services.appCheck === "debug"
        ? { label: "App Check: debug token (local)", cls: "" }
        : services.appCheck === "ok"
          ? { label: "App Check: on", cls: "ok" }
          : { label: "App Check: no site key — cloud calls may be rejected", cls: "off" },
    );
    if (!services.uid) {
      chips.push({ label: "Sign-in failed: history stays on this device", cls: "off" });
    }
  }
  const store = activeStore();
  chips.push({
    label:
      store.name === "firestore"
        ? "History: saved to your account"
        : privacyToggle.checked && cloudStore
          ? "History: kept on this device (privacy mode)"
          : "History: saved on this device",
    cls: "",
  });
  chipsEl.innerHTML = chips
    .map((c) => `<span class="chip ${c.cls}">${escapeHtml(c.label)}</span>`)
    .join("");
}

function renderChunks(): void {
  if (chunks.length === 0) {
    chunkList.innerHTML =
      '<p class="empty">Paste a document or load a sample to see its clauses here.</p>';
    return;
  }
  chunkList.innerHTML = "";
  chunks.forEach((chunk, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chunk";
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", String(i === selectedChunk));
    btn.innerHTML = `<strong>${escapeHtml(chunk.label)}</strong><small>${escapeHtml(chunk.text)}</small>`;
    btn.addEventListener("click", () => {
      selectedChunk = i;
      renderChunks();
    });
    chunkList.appendChild(btn);
  });
}

function refreshDocument(): void {
  const text = docInput.value;
  chunks = splitIntoChunks(text);
  if (selectedChunk >= chunks.length) selectedChunk = 0;
  docStats.textContent = `${text.length} characters · ${splitSentences(text).length} sentences · ${chunks.length} clauses`;
  renderChunks();
}

function sourceBadge(source: string): { text: string; cls: string } {
  switch (source) {
    case "on-device":
      return { text: "Ran on your device", cls: "badge-device" };
    case "cloud":
      return { text: "Ran in the cloud", cls: "badge-cloud" };
    default:
      return { text: "Ran locally (no model)", cls: "badge-local" };
  }
}

const SECTION_HEADER_RE = /^[A-Z][A-Z0-9 ()&'’\-]{3,60}$/;

/**
 * Render an answer with light structure: ALL-CAPS section headers become
 * headings, "- " lines become a list, everything else paragraphs. Built with
 * DOM APIs only — model text is never injected as HTML.
 */
function renderResultText(text: string): void {
  resultBody.innerHTML = "";
  let list: HTMLUListElement | null = null;
  const flushList = () => {
    if (list) resultBody.appendChild(list);
    list = null;
  };
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    if (SECTION_HEADER_RE.test(line) && !line.startsWith("- ")) {
      flushList();
      const h = document.createElement("h3");
      h.textContent = line;
      resultBody.appendChild(h);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!list) list = document.createElement("ul");
      const li = document.createElement("li");
      li.textContent = line.slice(2);
      list.appendChild(li);
      continue;
    }
    flushList();
    const p = document.createElement("p");
    p.textContent = line;
    resultBody.appendChild(p);
  }
  flushList();
  if (!resultBody.hasChildNodes()) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No answer was produced.";
    resultBody.appendChild(p);
  }
}

function showPrimeProgress(fraction: number): void {
  primeProgress.hidden = false;
  primeProgress.textContent = `Downloading the on-device model… ${Math.round(fraction * 100)}%`;
}

function hidePrimeProgress(): void {
  primeProgress.hidden = true;
  primeProgress.textContent = "";
}

/**
 * Refresh the on-device probe and, when a model is downloadable, prime it
 * (awaited, inside this click-driven flow) so routing decisions are made
 * with the true, current state.
 */
async function prepareDeviceModel(): Promise<void> {
  onDevice = await probeOnDeviceAvailability();
  if (!hybrid) return;
  if (onDevice === "available" && hybrid.primed) return;
  if (onDevice === "unavailable") return;
  try {
    await hybrid.primeDeviceModel(showPrimeProgress);
    onDevice = await probeOnDeviceAvailability();
  } catch {
    // Prime failed (e.g. download interrupted): the probe state stands and
    // routing degrades honestly. The next click retries — no latch.
  } finally {
    hidePrimeProgress();
  }
}

async function runTask(
  task: TaskKind,
  sourceText: string,
  question?: string,
  note?: string,
): Promise<void> {
  if (!sourceText.trim()) {
    resultBody.innerHTML = '<p class="empty">Add a document first — paste text or load a sample.</p>';
    return;
  }
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    ".result-actions .btn, #explain-clause, #ask-btn",
  );
  buttons.forEach((b) => (b.disabled = true));
  resultSource.className = "badge badge-busy";
  resultSource.textContent = "Working…";
  resultMeta.textContent = "";
  try {
    await prepareDeviceModel();
    renderChips();

    const decision = routeRequest({
      task,
      sourceChars: sourceText.length,
      privacyMode: privacyToggle.checked,
      simulateOffline: offlineToggle.checked,
      env: currentEnv(),
      settings,
    });
    const prompt = buildPrompt(task, sourceText, question);
    const local = new LocalProvider(task, sourceText, question);
    const service = new InferenceService(hybrid, local);
    const result = await service.run(
      { task, prompt, sourceChars: sourceText.length },
      decision,
    );

    const badge = sourceBadge(result.source);
    resultSource.className = `badge ${badge.cls}`;
    resultSource.textContent = badge.text;
    renderResultText(result.text);
    resultMeta.textContent =
      `Route requested: ${result.requestedMode.replaceAll("_", " ").toLowerCase()} · ` +
      `${result.latencyMs} ms · ${result.routingReason}` +
      (result.degradedReason ? ` Model note: ${result.degradedReason}` : "") +
      (note ? ` ${note}` : "");

    const entry: LedgerEntry = {
      id: `ledger-${Date.now()}-${ledger.length}`,
      at: Date.now(),
      task,
      requestedMode: result.requestedMode,
      source: result.source,
      latencyMs: result.latencyMs,
      routingReason: result.routingReason,
    };
    ledger.unshift(entry);
    if (ledger.length > 50) ledger.length = 50;
    renderLedger();

    const record: Omit<AnalysisRecord, "id"> = {
      at: Date.now(),
      title: docTitle(),
      task,
      source: result.source,
      excerpt: sourceText.slice(0, 140),
      result: result.text,
    };
    await activeStore().save(record);
    await renderHistory();
  } catch (err) {
    resultSource.className = "badge badge-error";
    resultSource.textContent = "Something went wrong";
    resultBody.textContent =
      err instanceof Error ? err.message : "The request failed unexpectedly.";
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function docTitle(): string {
  const sample = SAMPLES.find((s) => s.text === docInput.value);
  if (sample) return sample.title;
  const first = chunks[0]?.label;
  return first ? first.slice(0, 60) : "Pasted document";
}

function renderLedger(): void {
  if (ledger.length === 0) return;
  ledgerEl.innerHTML = "";
  for (const e of ledger.slice(0, 12)) {
    const li = document.createElement("li");
    const badge = sourceBadge(e.source);
    li.innerHTML =
      `<strong>${escapeHtml(e.task)}</strong> · ${badge.text} · ${e.latencyMs} ms` +
      `<span class="why">${escapeHtml(e.routingReason)}</span>`;
    ledgerEl.appendChild(li);
  }
}

async function renderHistory(): Promise<void> {
  const items = await activeStore().list(8);
  if (items.length === 0) {
    historyEl.innerHTML = '<li class="empty">No saved analyses yet.</li>';
    return;
  }
  historyEl.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    const badge = sourceBadge(item.source);
    li.innerHTML =
      `<strong>${escapeHtml(item.title)}</strong> — ${escapeHtml(item.task)}` +
      `<span class="meta">${new Date(item.at).toLocaleString()} · ${badge.text}</span>`;
    li.title = "Show this answer again";
    li.addEventListener("click", () => {
      renderResultText(item.result);
      resultSource.className = `badge ${badge.cls}`;
      resultSource.textContent = badge.text;
      resultMeta.textContent = `From history · ${new Date(item.at).toLocaleString()}`;
    });
    historyEl.appendChild(li);
  }
}

function renderFlags(): void {
  const text = docInput.value;
  if (!text.trim()) {
    flagsBody.innerHTML = '<p class="empty">Add a document first.</p>';
    return;
  }
  const flags = scanRedFlags(text);
  if (flags.length === 0) {
    flagsBody.innerHTML =
      '<p class="empty">No common trap patterns found. That is reassuring, not a guarantee — read the brief too.</p>';
    return;
  }
  flagsBody.innerHTML = "";
  for (const f of flags) {
    const div = document.createElement("div");
    div.className = `flag ${f.severity}`;
    div.innerHTML =
      `<div class="kind">${escapeHtml(f.kind)} · ${f.severity.toUpperCase()}</div>` +
      `<div class="note">${escapeHtml(f.note)}</div>` +
      `<div class="excerpt">${escapeHtml(f.excerpt)}</div>`;
    flagsBody.appendChild(div);
  }
  const caveat = document.createElement("p");
  caveat.className = "hint";
  caveat.textContent =
    "Pattern matches only — this scan recognises common traps, not every trap. A short list here, or none, is not a safety verdict on the document.";
  flagsBody.appendChild(caveat);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function init(): Promise<void> {
  for (const s of SAMPLES) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.title;
    sampleSelect.appendChild(opt);
  }

  const env = import.meta.env as Record<string, string | undefined>;
  const config = readFirebaseConfig(env);
  services = await initFirebase(config, env.VITE_APPCHECK_SITE_KEY, env).catch(() => null);
  if (services) {
    settings = await loadSettings(services.remoteConfig);
    hybrid = new HybridProvider(services.app, settings);
    if (services.uid) {
      cloudStore = new FirestoreHistoryStore(services.db, services.uid);
    }
  } else {
    // Demo mode's first impression should be a working document, not empty
    // boxes: preload the lease sample (the demo-mode chip explains itself).
    docInput.value = SAMPLES[0].text;
    sampleSelect.value = SAMPLES[0].id;
  }
  onDevice = await probeOnDeviceAvailability();

  renderChips();
  refreshDocument();
  await renderHistory();
}

docInput.addEventListener("input", refreshDocument);
sampleSelect.addEventListener("change", () => {
  const sample = SAMPLES.find((s) => s.id === sampleSelect.value);
  if (sample) {
    docInput.value = sample.text;
    selectedChunk = 0;
    refreshDocument();
  }
});
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    if (file.name.toLowerCase().endsWith(".pdf")) {
      const { text, truncated } = await extractPdfText(file);
      docInput.value = text;
      selectedChunk = 0;
      refreshDocument();
      if (truncated) {
        docStats.textContent += " · PDF text was truncated at 200,000 characters.";
      }
    } else {
      docInput.value = await file.text();
      selectedChunk = 0;
      refreshDocument();
    }
  } catch (err) {
    docStats.textContent =
      err instanceof Error ? err.message : "That file could not be read.";
  } finally {
    fileInput.value = "";
  }
});
$<HTMLButtonElement>("clear-doc").addEventListener("click", () => {
  docInput.value = "";
  selectedChunk = 0;
  refreshDocument();
});
$<HTMLButtonElement>("explain-clause").addEventListener("click", () => {
  const chunk = chunks[selectedChunk];
  if (chunk) void runTask("explain-clause", chunk.text);
});
$<HTMLButtonElement>("brief-btn").addEventListener("click", () => {
  void runTask("document-brief", docInput.value);
});
$<HTMLButtonElement>("flags-btn").addEventListener("click", renderFlags);

function ask(): void {
  const question = questionInput.value.trim();
  if (!question) {
    askHint.textContent = "Type a question first — for example, “When does this renew?”";
    questionInput.focus();
    return;
  }
  if (!docInput.value.trim()) {
    resultBody.innerHTML = '<p class="empty">Add a document first — paste text or load a sample.</p>';
    return;
  }
  askHint.textContent =
    "Asking searches the most relevant passage and routes on its size — short passages run on-device when the model is available, and in the cloud when it is not.";
  const passage = selectPassage(docInput.value, question, settings.maxOnDeviceChars);
  void runTask(
    "ask-document",
    passage.text,
    question,
    `Answered from the passage headed “${passage.label}”.`,
  );
}
$<HTMLButtonElement>("ask-btn").addEventListener("click", ask);
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") ask();
});
privacyToggle.addEventListener("change", () => {
  renderChips();
  void renderHistory();
});

void init();
