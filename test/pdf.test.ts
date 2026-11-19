import { describe, expect, it } from "vitest";
import { joinPageTexts } from "../src/lib/pdf";

describe("joinPageTexts", () => {
  it("joins items within a page and separates pages", () => {
    const out = joinPageTexts([
      ["Hello", "world"],
      ["Second", "page"],
    ]);
    expect(out.text).toBe("Hello world\n\nSecond page");
    expect(out.truncated).toBe(false);
  });

  it("truncates at the cap and says so", () => {
    const out = joinPageTexts([["x".repeat(50)]], 10);
    expect(out.text).toHaveLength(10);
    expect(out.truncated).toBe(true);
  });

  it("handles empty pages", () => {
    expect(joinPageTexts([]).text).toBe("");
    expect(joinPageTexts([[]]).text).toBe("");
  });
});
