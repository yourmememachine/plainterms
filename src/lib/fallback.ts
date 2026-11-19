import type { TaskKind } from "./types";
import { scanRedFlags } from "./redflags";

/**
 * The built-in local engine. When neither the on-device model nor the cloud
 * is reachable (offline, unsupported browser, demo mode), PlainTerms still
 * answers with deterministic text processing: extractive summarization,
 * sentence ranking by term frequency, and the pattern-based red-flag scan.
 * Output is always labelled as coming from this engine — it never pretends
 * to be a model.
 */

const STOPWORDS = new Set(
  ("a an the and or but if then else of at by for with about into to from in on is are was were be been being " +
    "have has had do does did will would shall should may might can could this that these those it its as per " +
    "such any all each other more most than too very just not no yes")
    .split(" "),
);

/** Content words of a text (lowercased, stopwords removed) — shared scorer input. */
export function keywordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
}

export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) ?? [cleaned];
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

function wordFreq(sentences: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const s of sentences) {
    for (const w of s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
      if (!STOPWORDS.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return freq;
}

/** Rank sentences by keyword density and return the top ones, in original order. */
export function summarizeExtractive(text: string, maxSentences = 3): string {
  const sentences = splitSentences(text);
  if (sentences.length <= maxSentences) return sentences.join(" ");
  const freq = wordFreq(sentences);
  const scored = sentences.map((s, i) => {
    const words = s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
    const score = words.reduce((acc, w) => acc + (STOPWORDS.has(w) ? 0 : (freq.get(w) ?? 0)), 0) /
      Math.max(1, words.length);
    return { s, i, score };
  });
  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, maxSentences);
  return top.sort((a, b) => a.i - b.i).map((t) => t.s).join(" ");
}

export function localAnswer(task: TaskKind, source: string, question?: string): string {
  const sentences = splitSentences(source);
  switch (task) {
    case "explain-clause": {
      const key = summarizeExtractive(source, 2);
      const flags = scanRedFlags(source);
      const lines = [
        "Local explanation (built-in engine — no model was reachable):",
        "",
        key || "This passage is short; read it closely and check the flags below.",
      ];
      const money = source.match(/(?:\$|£|€)\s?\d[\d,]*(?:\.\d{2})?/g);
      if (money) lines.push("", `Money mentioned: ${[...new Set(money)].join(", ")}.`);
      if (flags.length > 0) {
        lines.push("", "Watch out for:");
        for (const f of flags.slice(0, 3)) lines.push(`- ${f.kind}: ${f.note}`);
      }
      lines.push("", "Connect a Firebase project or use a browser with an on-device model for a full plain-language explanation.");
      return lines.join("\n");
    }
    case "document-brief": {
      const flags = scanRedFlags(source);
      const lines = [
        "Local brief (built-in engine — no model was reachable):",
        "",
        "SUMMARY",
        summarizeExtractive(source, 3) || "No readable text found.",
        "",
        `DOCUMENT SIZE: ${source.length} characters, about ${sentences.length} sentences.`,
      ];
      if (flags.length > 0) {
        lines.push("", "WATCH OUT (pattern scan)");
        for (const f of flags) lines.push(`- [${f.severity.toUpperCase()}] ${f.kind}: ${f.note} (${f.excerpt})`);
      } else {
        lines.push("", "WATCH OUT (pattern scan)", "- No common trap patterns were found by the local scan.");
      }
      lines.push("", "Connect a Firebase project or use a browser with an on-device model for the full brief with obligations, money, and dates itemized.");
      return lines.join("\n");
    }
    case "ask-document": {
      const keywords = keywordsOf(question ?? "");
      const hits = sentences.filter((s) => {
        const lower = s.toLowerCase();
        return keywords.some((k) => lower.includes(k));
      });
      if (hits.length === 0) {
        return "Local answer (built-in engine): I could not find a sentence in the document that matches your question. Try different words, or connect a model for a fuller answer.";
      }
      return ["Local answer (built-in engine), from the document itself:", "", ...hits.slice(0, 3)].join("\n");
    }
  }
}
