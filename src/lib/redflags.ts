/**
 * Deterministic red-flag scan. No model involved: these are pattern checks
 * over the raw text, so the scan works offline, instantly, and identically
 * for every user. It complements — never replaces — the model brief.
 */

export type FlagSeverity = "high" | "medium" | "info";

export interface RedFlag {
  kind: string;
  severity: FlagSeverity;
  excerpt: string;
  note: string;
  /** True when the match sits in a negated/exception form ("does not
   * automatically renew") — the flag is then qualified, not a warning. */
  negated?: boolean;
}

interface Rule {
  kind: string;
  severity: FlagSeverity;
  pattern: RegExp;
  note: string;
}

const RULES: Rule[] = [
  {
    kind: "Automatic renewal",
    severity: "high",
    pattern: /\b(automatically renew|auto[- ]?renew|renew automatically)\b/i,
    note: "This renews on its own. Note the cancellation deadline before it rolls over.",
  },
  {
    kind: "Unilateral change",
    severity: "high",
    pattern: /\b(may (change|modify|amend)[^.]{0,60}(at any time|without notice|in (its|our) sole discretion))\b/i,
    note: "The other side can change the terms without asking you.",
  },
  {
    kind: "Termination fee / penalty",
    severity: "high",
    pattern: /\b(early termination (fee|charge|penalty)|cancellation fee|liquidated damages)\b/i,
    note: "Leaving early costs money. Find the exact amount before you sign.",
  },
  {
    kind: "Indemnity",
    severity: "medium",
    pattern: /\b(indemnif\w*|hold harmless)\b/i,
    note: "You may be agreeing to cover the other side's costs or losses.",
  },
  {
    kind: "Liability cap / waiver",
    severity: "medium",
    pattern: /\b(shall not be liable|no liability|waive[sd]? (any|all)|as[- ]is)\b/i,
    note: "This limits what you can claim if something goes wrong.",
  },
  {
    kind: "Arbitration / jurisdiction",
    severity: "medium",
    pattern: /\b(binding arbitration|arbitrat\w+|governed by the laws of|exclusive jurisdiction)\b/i,
    note: "Disputes may be kept out of court, or decided under another place's laws.",
  },
  {
    kind: "Short notice window",
    severity: "medium",
    pattern: /\bwithin (24|48) hours\b|\b(1|2|3|5|7) (calendar |business )?days('|\s)? notice\b/i,
    note: "A tight deadline: miss it and you may lose rights or money.",
  },
  {
    kind: "Deposit / non-refundable money",
    severity: "info",
    pattern: /\b(non[- ]refundable|security deposit|damage deposit|retainer)\b/i,
    note: "Money changes hands here. Check when — and whether — it comes back.",
  },
  {
    kind: "Interest / late charges",
    severity: "info",
    pattern: /\b(late (fee|charge|payment)|interest (of|at) \d|APR|per annum)\b/i,
    note: "Late or unpaid amounts grow. Note the rate and when it starts.",
  },
];

const MONEY_RE = /(?:\$|£|€)\s?\d[\d,]*(?:\.\d{2})?|\b\d+(?:\.\d{2})?\s?(?:dollars|USD|CAD)\b/g;
const DATE_RE =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;

function excerptAround(text: string, index: number, match: string): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + match.length + 40);
  const slice = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${slice}${end < text.length ? "…" : ""}`;
}

/**
 * Negation / exception detection. A pattern that appears as "does not
 * automatically renew" or "no early termination fee applies" must not be
 * reported as an unqualified warning: the document is ruling the thing
 * out, not imposing it. Detection is deliberately narrow — a negation cue
 * in the same sentence, shortly before the match ("no …", "does not …",
 * "never …"), or a ruling-out phrase shortly after it ("… does not
 * apply", "… will not be charged"). Anything else keeps the plain
 * warning, so a real trap is never talked away by a distant "not".
 */
const PRE_NEGATION_RE = /\b(no|not|never|n't|free of)\b/i;
const POST_NEGATION_RE =
  /\b(does not apply|do not apply|shall not apply|will not apply|not be charged|not charged|is waived|are waived|is excluded|are excluded|not subject to)\b/i;

function sentenceBounds(text: string, index: number, matchLen: number): [number, number] {
  const isBoundary = (ch: string) => ch === "." || ch === "!" || ch === "?" || ch === "\n";
  let start = index;
  while (start > 0 && !isBoundary(text[start - 1])) start -= 1;
  let end = index + matchLen;
  while (end < text.length && !isBoundary(text[end])) end += 1;
  return [start, end];
}

export function isNegatedMatch(text: string, index: number, match: string): boolean {
  const [sStart, sEnd] = sentenceBounds(text, index, match.length);
  const before = text.slice(Math.max(sStart, index - 60), index);
  if (PRE_NEGATION_RE.test(before)) return true;
  const after = text.slice(index + match.length, Math.min(sEnd, index + match.length + 60));
  return POST_NEGATION_RE.test(after);
}

const NEGATED_NOTE =
  "Mentioned in a negated or exception form — the document appears to rule this out rather than impose it. Read the exact sentence before relying on either reading.";

export function scanRedFlags(text: string): RedFlag[] {
  const flags: RedFlag[] = [];
  for (const rule of RULES) {
    const m = rule.pattern.exec(text);
    if (m) {
      const negated = isNegatedMatch(text, m.index, m[0]);
      flags.push({
        kind: rule.kind,
        severity: negated ? "info" : rule.severity,
        excerpt: excerptAround(text, m.index, m[0]),
        note: negated ? NEGATED_NOTE : rule.note,
        ...(negated ? { negated: true } : {}),
      });
    }
  }
  const money = text.match(MONEY_RE);
  if (money && money.length > 0) {
    flags.push({
      kind: "Money mentioned",
      severity: "info",
      excerpt: [...new Set(money)].slice(0, 5).join(", "),
      note: `${money.length} amount(s) appear in this document. The brief lists what each one is for.`,
    });
  }
  const dates = text.match(DATE_RE);
  if (dates && dates.length > 0) {
    flags.push({
      kind: "Dates mentioned",
      severity: "info",
      excerpt: [...new Set(dates)].slice(0, 5).join(", "),
      note: `${dates.length} date(s) appear in this document. Put any deadline on your calendar now, not later.`,
    });
  }
  const order: Record<FlagSeverity, number> = { high: 0, medium: 1, info: 2 };
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}
