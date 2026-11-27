import { describe, expect, it } from "vitest";
import { isNegatedMatch, scanRedFlags } from "../src/lib/redflags";
import { SAMPLES } from "../src/lib/samples";

const kinds = (text: string) => scanRedFlags(text).map((f) => f.kind);
const flag = (text: string, kind: string) => scanRedFlags(text).find((f) => f.kind === kind);

describe("scanRedFlags — positive bench (one per rule)", () => {
  it("flags automatic renewal", () => {
    expect(kinds("This agreement shall automatically renew for one-year terms.")).toContain("Automatic renewal");
  });
  it("flags unilateral change", () => {
    expect(kinds("The Landlord may change the rules at any time in its sole discretion.")).toContain("Unilateral change");
  });
  it("flags termination fee / penalty", () => {
    expect(kinds("An early termination fee of two months' rent applies.")).toContain("Termination fee / penalty");
  });
  it("flags indemnity", () => {
    expect(kinds("The Tenant shall indemnify the Landlord against all claims.")).toContain("Indemnity");
  });
  it("flags liability cap / waiver", () => {
    expect(kinds("The Landlord shall not be liable for any damage.")).toContain("Liability cap / waiver");
  });
  it("flags arbitration / jurisdiction", () => {
    expect(kinds("Disputes shall be resolved by binding arbitration.")).toContain("Arbitration / jurisdiction");
  });
  it("flags short notice window", () => {
    expect(kinds("Report defects within 48 hours of discovery.")).toContain("Short notice window");
  });
  it("flags deposit / non-refundable money", () => {
    expect(kinds("A security deposit of $500 is required. The deposit is non-refundable.")).toContain("Deposit / non-refundable money");
  });
  it("flags interest / late charges", () => {
    expect(kinds("A late charge of $75 applies, with interest at 12% per annum.")).toContain("Interest / late charges");
  });
  it("flags money and dates mentioned", () => {
    const ks = kinds("Pay $2,150.00 by September 1, 2026.");
    expect(ks).toContain("Money mentioned");
    expect(ks).toContain("Dates mentioned");
  });
  it("the built-in lease sample trips the expected set, none of them negated", () => {
    const lease = SAMPLES.find((s) => s.id === "lease")!.text;
    const flags = scanRedFlags(lease);
    const ks = flags.map((f) => f.kind);
    for (const expected of [
      "Automatic renewal",
      "Unilateral change",
      "Termination fee / penalty",
      "Arbitration / jurisdiction",
      "Deposit / non-refundable money",
      "Interest / late charges",
      "Money mentioned",
      "Dates mentioned",
    ]) {
      expect(ks).toContain(expected);
    }
    expect(flags.every((f) => !f.negated)).toBe(true);
  });
});

describe("scanRedFlags — negative bench (benign text stays quiet)", () => {
  it("plain benign text produces no flags at all", () => {
    const text =
      "The tenant may use the garden and the shared laundry room. Rent is due monthly by bank transfer. The landlord will repaint the hallway each spring.";
    expect(scanRedFlags(text)).toEqual([]);
  });
  it("the word 'renew' alone, without automatic renewal, is not flagged", () => {
    expect(kinds("Either party may renew this agreement by mutual written consent.")).not.toContain("Automatic renewal");
  });
});

describe("scanRedFlags — negation and exception bench", () => {
  it("'does not automatically renew' is qualified, not an unqualified warning", () => {
    const f = flag("This agreement does not automatically renew at the end of the term.", "Automatic renewal");
    expect(f).toBeDefined();
    expect(f!.negated).toBe(true);
    expect(f!.severity).toBe("info");
    expect(f!.note).toContain("negated or exception form");
  });
  it("'no early termination fee applies' is qualified", () => {
    const f = flag("No early termination fee applies if you give 60 days' notice.", "Termination fee / penalty");
    expect(f).toBeDefined();
    expect(f!.negated).toBe(true);
    expect(f!.severity).not.toBe("high");
  });
  it("a post-match 'does not apply' exception is qualified", () => {
    const f = flag(
      "An early termination fee does not apply when the tenant gives at least 90 days' notice.",
      "Termination fee / penalty",
    );
    expect(f).toBeDefined();
    expect(f!.negated).toBe(true);
  });
  it("'no cancellation fee will be charged' is qualified", () => {
    const f = flag("No cancellation fee will be charged for changes made 30 days ahead.", "Termination fee / penalty");
    expect(f).toBeDefined();
    expect(f!.negated).toBe(true);
  });
  it("a real 'shall not be liable' waiver is NOT talked away as a negation", () => {
    const f = flag("The Landlord shall not be liable for any loss or damage.", "Liability cap / waiver");
    expect(f).toBeDefined();
    expect(f!.negated).toBeUndefined();
    expect(f!.severity).toBe("medium");
  });
  it("a real fee stated plainly stays a high warning ('will apply' is not a negation)", () => {
    const f = flag("A cancellation fee will apply if you leave early.", "Termination fee / penalty");
    expect(f).toBeDefined();
    expect(f!.negated).toBeUndefined();
    expect(f!.severity).toBe("high");
  });
  it("a negation in a DIFFERENT sentence does not qualify a real flag", () => {
    const f = flag(
      "There is no application fee. An early termination fee of two months' rent applies if you leave early.",
      "Termination fee / penalty",
    );
    expect(f).toBeDefined();
    expect(f!.negated).toBeUndefined();
    expect(f!.severity).toBe("high");
  });
  it("isNegatedMatch: cue must be near the match", () => {
    const text = "No pets are allowed in the building under any circumstances whatsoever at any time. This agreement shall automatically renew.";
    const m = /automatically renew/.exec(text)!;
    expect(isNegatedMatch(text, m.index, m[0])).toBe(false);
  });
});
