import type { TaskKind } from "./types";

/**
 * Prompt builders. Each returns a single-turn prompt: on-device inference in
 * Chrome supports single-turn text generation only, so every job is phrased
 * as one self-contained request.
 */

const GUARDRAILS =
  "Use plain language a non-lawyer can follow. Do not invent facts that are not in the text. " +
  "If the text does not say something, say so. This is general information, not legal advice.";

export function buildPrompt(task: TaskKind, source: string, question?: string): string {
  switch (task) {
    case "explain-clause":
      return [
        "Explain the following clause from a document in plain English.",
        "Cover: (1) what it means in everyday words, (2) what it obliges each side to do,",
        "(3) any money, dates, or deadlines it mentions, (4) anything the reader should watch out for.",
        GUARDRAILS,
        "",
        "CLAUSE:",
        source,
      ].join("\n");
    case "document-brief":
      return [
        "Read the following document and produce a structured brief with these sections:",
        "SUMMARY - three sentences maximum, in plain English.",
        "KEY OBLIGATIONS - a bullet list of what each party must do.",
        "MONEY - every amount, fee, deposit, or penalty mentioned, with what triggers it.",
        "DATES AND DEADLINES - every date, notice period, or renewal term mentioned.",
        "WATCH OUT - clauses that are one-sided, surprising, or easy to trip over.",
        "QUESTIONS TO ASK - what a careful reader should clarify before signing or agreeing.",
        GUARDRAILS,
        "",
        "DOCUMENT:",
        source,
      ].join("\n");
    case "ask-document":
      return [
        "Answer the question using only the document below.",
        "Quote the relevant words from the document when you can.",
        GUARDRAILS,
        "",
        "QUESTION:",
        question ?? "",
        "",
        "DOCUMENT:",
        source,
      ].join("\n");
  }
}
