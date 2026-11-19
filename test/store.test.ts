import { describe, expect, it } from "vitest";
import { LocalHistoryStore, type KeyValueStorage } from "../src/lib/store";
import type { AnalysisRecord } from "../src/lib/types";

class MemoryKV implements KeyValueStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

const rec = (title: string, at: number): Omit<AnalysisRecord, "id"> => ({
  at,
  title,
  task: "explain-clause",
  source: "on-device",
  excerpt: "x",
  result: "y",
});

describe("LocalHistoryStore", () => {
  it("saves and lists newest first", async () => {
    const store = new LocalHistoryStore(new MemoryKV());
    await store.save(rec("first", 1000));
    await store.save(rec("second", 2000));
    const items = await store.list(10);
    expect(items.map((i) => i.title)).toEqual(["second", "first"]);
    expect(items[0].id).toBeTruthy();
  });

  it("respects the list limit", async () => {
    const store = new LocalHistoryStore(new MemoryKV());
    for (let i = 0; i < 5; i++) await store.save(rec(`t${i}`, i));
    expect(await store.list(2)).toHaveLength(2);
  });

  it("survives corrupted stored data", async () => {
    const kv = new MemoryKV();
    kv.setItem("plainterms.history.v1", "{not json");
    const store = new LocalHistoryStore(kv);
    expect(await store.list(5)).toEqual([]);
    const saved = await store.save(rec("ok", 1));
    expect(saved.title).toBe("ok");
  });
});

describe("toAnalysisRecord", () => {
  it("picks exactly the declared fields and drops extras", async () => {
    const { toAnalysisRecord } = await import("../src/lib/store");
    const rec = toAnalysisRecord("id1", {
      at: 42,
      title: "Lease",
      task: "document-brief",
      source: "cloud",
      excerpt: "ex",
      result: "res",
      createdAt: "server-side",
      unexpected: true,
    });
    expect(rec).toEqual({
      id: "id1",
      at: 42,
      title: "Lease",
      task: "document-brief",
      source: "cloud",
      excerpt: "ex",
      result: "res",
    });
    expect("createdAt" in rec).toBe(false);
  });

  it("defaults missing or invalid fields safely", async () => {
    const { toAnalysisRecord } = await import("../src/lib/store");
    const rec = toAnalysisRecord("id2", { task: "bogus", source: "bogus" });
    expect(rec.task).toBe("explain-clause");
    expect(rec.source).toBe("local-fallback");
    expect(rec.at).toBe(0);
    expect(rec.title).toBe("");
  });
});

describe("historyStoreFor", () => {
  it("privacy mode always selects the local store", async () => {
    const { historyStoreFor } = await import("../src/lib/store");
    const local = new LocalHistoryStore(new MemoryKV());
    const fakeCloud = { name: "firestore", save: local.save.bind(local), list: local.list.bind(local) };
    expect(historyStoreFor(true, fakeCloud, local)).toBe(local);
    expect(historyStoreFor(false, fakeCloud, local)).toBe(fakeCloud);
    expect(historyStoreFor(false, null, local)).toBe(local);
  });
});
