import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type Firestore,
} from "firebase/firestore";
import type { AnalysisRecord } from "./types";

/** Persistence for analysis history. Two implementations: Firestore, local. */
export interface HistoryStore {
  readonly name: string;
  save(record: Omit<AnalysisRecord, "id">): Promise<AnalysisRecord>;
  list(max: number): Promise<AnalysisRecord[]>;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `local-${Date.now()}-${counter}`;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "plainterms.history.v1";

/** localStorage-backed history, used in demo mode and as an offline cache. */
export class LocalHistoryStore implements HistoryStore {
  readonly name = "local";

  constructor(private readonly storage: KeyValueStorage) {}

  private readAll(): AnalysisRecord[] {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as AnalysisRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async save(record: Omit<AnalysisRecord, "id">): Promise<AnalysisRecord> {
    const saved: AnalysisRecord = { ...record, id: nextId() };
    const all = [saved, ...this.readAll()].slice(0, 100);
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      // Storage full/blocked: history is a convenience, not a requirement.
    }
    return saved;
  }

  async list(max: number): Promise<AnalysisRecord[]> {
    return this.readAll()
      .sort((a, b) => b.at - a.at)
      .slice(0, max);
  }
}

/** Firestore-backed history under users/{uid}/analyses, per firestore.rules. */
export class FirestoreHistoryStore implements HistoryStore {
  readonly name = "firestore";

  constructor(
    private readonly db: Firestore,
    private readonly uid: string,
  ) {}

  private col() {
    return collection(this.db, "users", this.uid, "analyses");
  }

  async save(record: Omit<AnalysisRecord, "id">): Promise<AnalysisRecord> {
    const ref = await addDoc(this.col(), { ...record });
    return { ...record, id: ref.id };
  }

  async list(max: number): Promise<AnalysisRecord[]> {
    const q = query(this.col(), orderBy("at", "desc"), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map((d) => toAnalysisRecord(d.id, d.data()));
  }
}

/**
 * Map a stored document to an AnalysisRecord, picking exactly the declared
 * fields: extra fields in the document never leak into the app, and missing
 * fields get safe defaults.
 */
export function toAnalysisRecord(id: string, data: Record<string, unknown>): AnalysisRecord {
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  const task = data.task;
  const source = data.source;
  return {
    id,
    at: num(data.at),
    title: str(data.title),
    task:
      task === "explain-clause" || task === "document-brief" || task === "ask-document"
        ? task
        : "explain-clause",
    source:
      source === "on-device" || source === "cloud" || source === "local-fallback"
        ? source
        : "local-fallback",
    excerpt: str(data.excerpt),
    result: str(data.result),
  };
}

/**
 * Which store a save goes to. Privacy mode never writes to the cloud store:
 * an answer the user kept on-device must not be uploaded as history.
 */
export function historyStoreFor(
  privacyOn: boolean,
  cloudStore: HistoryStore | null,
  localStore: HistoryStore,
): HistoryStore {
  if (privacyOn) return localStore;
  return cloudStore ?? localStore;
}
