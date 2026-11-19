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

export function scanRedFlags(text: string): RedFlag[] {
  const flags: RedFlag[] = [];
  for (const rule of RULES) {
    const m = rule.pattern.exec(text);
    if (m) {
      flags.push({
        kind: rule.kind,
        severity: rule.severity,
        excerpt: excerptAround(text, m.index, m[0]),
        note: rule.note,
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
