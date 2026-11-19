import { describe, expect, it } from "vitest";
import { selectPassage, splitIntoChunks } from "../src/lib/chunk";
import { scanRedFlags } from "../src/lib/redflags";
import { localAnswer, splitSentences, summarizeExtractive } from "../src/lib/fallback";
import { buildPrompt } from "../src/lib/prompts";
import { SAMPLES } from "../src/lib/samples";

const lease = SAMPLES.find((s) => s.id === "lease")!;
const gym = SAMPLES.find((s) => s.id === "gym")!;

describe("splitIntoChunks", () => {
  it("splits the lease sample into its numbered clauses", () => {
    const chunks = splitIntoChunks(lease.text);
    expect(chunks.length).toBeGreaterThanOrEqual(6);
    expect(chunks.some((c) => c.text.includes("automatically renew"))).toBe(true);
  });

  it("returns a single chunk for a short paragraph", () => {
    const chunks = splitIntoChunks("One short clause about rent being due monthly.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("rent");
  });

  it("returns nothing for empty input", () => {
    expect(splitIntoChunks("   \n  ")).toEqual([]);
  });
});

describe("scanRedFlags", () => {
  it("flags automatic renewal and unilateral change in the lease", () => {
    const kinds = scanRedFlags(lease.text).map((f) => f.kind);
    expect(kinds).toContain("Automatic renewal");
    expect(kinds).toContain("Unilateral change");
    expect(kinds).toContain("Termination fee / penalty");
  });

  it("flags indemnity and money in the gym terms", () => {
    const flags = scanRedFlags(gym.text);
    expect(flags.map((f) => f.kind)).toContain("Indemnity");
    expect(flags.map((f) => f.kind)).toContain("Money mentioned");
  });

  it("sorts high severity first", () => {
    const flags = scanRedFlags(lease.text);
    expect(flags[0].severity).toBe("high");
  });

  it("finds nothing in benign text", () => {
    expect(scanRedFlags("The library opens at nine and closes at five.")).toEqual([]);
  });
});

describe("local engine", () => {
  it("splits sentences", () => {
    expect(splitSentences("One. Two? Three!")).toHaveLength(3);
  });

  it("extractive summary keeps the keyword-dense sentence", () => {
    const text =
      "Rent is due on the first of the month. The tenant pays rent monthly. " +
      "A cat sat outside in the sun all afternoon doing nothing at all.";
    const summary = summarizeExtractive(text, 1);
    expect(summary.toLowerCase()).toContain("rent");
  });

  it("explains locally and labels itself honestly", () => {
    const out = localAnswer("explain-clause", "The deposit of $500 is non-refundable.");
    expect(out).toContain("built-in engine");
    expect(out).toContain("$500");
  });

  it("answers questions from matching sentences", () => {
    const out = localAnswer(
      "ask-document",
      lease.text,
      "When does the agreement automatically renew?",
    );
    expect(out.toLowerCase()).toContain("renew");
  });

  it("builds a brief with a watch-out section", () => {
    const out = localAnswer("document-brief", lease.text);
    expect(out).toContain("SUMMARY");
    expect(out).toContain("WATCH OUT");
  });
});

describe("buildPrompt", () => {
  it("asks for the structured brief sections", () => {
    const p = buildPrompt("document-brief", "DOC");
    for (const section of ["SUMMARY", "KEY OBLIGATIONS", "MONEY", "DATES AND DEADLINES", "WATCH OUT"]) {
      expect(p).toContain(section);
    }
    expect(p).toContain("DOC");
  });

  it("includes the question for ask-document", () => {
    const p = buildPrompt("ask-document", "DOC", "What is the rent?");
    expect(p).toContain("What is the rent?");
  });

  it("includes the clause for explain-clause", () => {
    expect(buildPrompt("explain-clause", "CLAUSE-TEXT")).toContain("CLAUSE-TEXT");
  });
});

describe("chunk content fidelity", () => {
  it("keeps a CAPS heading inside its chunk's text, not just the label", () => {
    const doc = "TERMINATION\nEither party may end this agreement with thirty days of written notice to the other party.";
    const chunks = splitIntoChunks(doc);
    expect(chunks[0].label).toBe("TERMINATION");
    expect(chunks[0].text.startsWith("TERMINATION")).toBe(true);
  });

  it("splits one very long paragraph on sentence boundaries", () => {
    const sentence = "The tenant shall pay the monthly rent on the first day of each calendar month without deduction. ";
    const doc = sentence.repeat(30); // ~2,900 chars, no blank lines
    const chunks = splitIntoChunks(doc);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1600);
  });
});

describe("selectPassage", () => {
  const filler = (topic: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${i + 1}. ${topic}. The ${topic.toLowerCase()} rules in this section apply to every signatory of the agreement in full.`).join("\n");
  const doc = [filler("PARKING", 20), filler("PETS", 20), filler("INSURANCE", 20)].join("\n");

  it("the fixture document is genuinely long", () => {
    expect(doc.length).toBeGreaterThan(5000);
  });

  it("finds the passage about the last topic, sized for the device", () => {
    const passage = selectPassage(doc, "What does the insurance section require?", 1200);
    expect(passage.text).toContain("INSURANCE");
    expect(passage.text).not.toContain("1. PARKING");
    expect(passage.text.length).toBeLessThanOrEqual(1200 + 200);
    expect(passage.label).toContain("INSURANCE");
  });

  it("falls back to the opening when nothing matches", () => {
    const passage = selectPassage(doc, "zanzibar quixotic", 1200);
    expect(passage.text).toContain("PARKING");
  });
});
