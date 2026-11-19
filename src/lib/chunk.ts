/** Split a pasted document into readable clauses/sections for the clause list. */
import { keywordsOf, splitSentences } from "./fallback";

export interface Chunk {
  id: string;
  /** Short label: a heading, a clause number, or the first words. */
  label: string;
  text: string;
}

/** Lines that open a new clause: "1. TERM. ...", "Section 2 ...", "Article IV ...". */
const CLAUSE_START_RE = /^(\d{1,2}\.|Section\s+\d+|Clause\s+\d+|Article\s+[IVX\d]+)\s+/i;
/** A short line written entirely in capitals works as a heading. */
const CAPS_HEADING_RE = /^[A-Z][A-Z0-9 ,&'’\-]{3,60}$/;
/** "1. TERM." / "2. RENT." — the label at the start of a numbered clause. */
const NUMBERED_LABEL_RE = /^(\d{1,2}\.\s+[A-Z][A-Z ]{2,30})\./;

/**
 * Heuristic splitter: numbered clauses and standalone headings start a new
 * chunk; other text groups by paragraph, splitting very long runs. A chunk
 * that is still very long (one huge paragraph) is split again on sentence
 * boundaries. Good enough for pasted leases, letters, and terms — routing,
 * not chunking, decides how each part is processed.
 */
export function splitIntoChunks(documentText: string): Chunk[] {
  const lines = documentText.replace(/\r\n/g, "\n").split("\n");
  const raw: { label: string | null; lines: string[] }[] = [];
  let current: { label: string | null; lines: string[] } = { label: null, lines: [] };

  const flush = () => {
    if (current.lines.some((l) => l.trim().length > 0)) raw.push(current);
    current = { label: null, lines: [] };
  };
  const hasContent = () => current.lines.some((l) => l.trim().length > 0);

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed !== "" && CAPS_HEADING_RE.test(trimmed) && !CLAUSE_START_RE.test(trimmed)) {
      if (hasContent()) flush();
      current.label = trimmed;
      // The heading is part of the section's text too: explaining the clause
      // must not lose the words that name it.
      current.lines.push(line);
      continue;
    }

    if (trimmed !== "" && CLAUSE_START_RE.test(trimmed)) {
      if (hasContent()) flush();
      const labelMatch = trimmed.match(NUMBERED_LABEL_RE);
      if (labelMatch) current.label = labelMatch[1].trim();
      current.lines.push(line);
      continue;
    }

    if (trimmed === "") {
      if (current.lines.join("\n").length > 700) flush();
      else current.lines.push(line);
      continue;
    }
    current.lines.push(line);
  }
  flush();

  const chunks: Chunk[] = [];
  for (const c of raw) {
    const text = c.lines.join("\n").trim();
    const label =
      c.label ?? (text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text);
    for (const part of splitLongText(text)) {
      chunks.push({ id: "", label, text: part });
    }
  }
  if (chunks.length > 1) {
    // Number repeated labels so split parts stay distinguishable.
    const seen = new Map<string, number>();
    for (const ch of chunks) {
      const n = (seen.get(ch.label) ?? 0) + 1;
      seen.set(ch.label, n);
    }
    const counts = new Map<string, number>();
    for (const ch of chunks) {
      if ((seen.get(ch.label) ?? 0) > 1) {
        const n = (counts.get(ch.label) ?? 0) + 1;
        counts.set(ch.label, n);
        ch.label = `${ch.label} (part ${n})`;
      }
    }
  }
  return chunks.map((c, i) => ({ ...c, id: `chunk-${i}`, label: c.label || `Part ${i + 1}` }));
}

/** Split an over-long chunk on sentence boundaries into ~1,200-char parts. */
function splitLongText(text: string, cap = 1400): string[] {
  if (text.length <= cap) return [text];
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return [text];
  const parts: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf && buf.length + s.length + 1 > cap) {
      parts.push(buf);
      buf = s;
    } else {
      buf = buf ? `${buf} ${s}` : s;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

export interface Passage {
  text: string;
  /** Label of the best-matching chunk, for the UI note. */
  label: string;
}

/**
 * Pick the passage of the document a question is about. Asking a question
 * routes and prompts on this passage — never on the whole document — so a
 * question about the last page of a long lease is still passage-sized work.
 * Falls back to the opening chunks when nothing matches.
 */
export function selectPassage(documentText: string, question: string, maxChars: number): Passage {
  const chunks = splitIntoChunks(documentText);
  if (chunks.length === 0) return { text: "", label: "" };
  const keywords = [...new Set(keywordsOf(question))];
  const scored = chunks.map((c, i) => {
    const lower = c.text.toLowerCase();
    const score = keywords.reduce((acc, k) => acc + (lower.includes(k) ? 1 : 0), 0);
    return { i, score };
  });
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);

  const picked = new Set<number>();
  if (best.score > 0) {
    picked.add(best.i);
    let total = chunks[best.i].text.length;
    // Grow with neighbours (next first, then previous) while they fit.
    for (const j of [best.i + 1, best.i - 1, best.i + 2, best.i - 2]) {
      if (j < 0 || j >= chunks.length || picked.has(j)) continue;
      if (total + chunks[j].text.length > maxChars) continue;
      picked.add(j);
      total += chunks[j].text.length;
    }
  } else {
    let total = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (picked.size > 0 && total + chunks[i].text.length > maxChars) break;
      picked.add(i);
      total += chunks[i].text.length;
    }
  }

  const ordered = [...picked].sort((a, b) => a - b);
  return {
    text: ordered.map((i) => chunks[i].text).join("\n\n"),
    label: chunks[best.score > 0 ? best.i : ordered[0]].label,
  };
}
