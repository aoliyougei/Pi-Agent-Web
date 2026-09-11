type Entry<T = unknown> = {
  fingerprint: string;
  promise: Promise<T>;
  settledAt?: number;
};

// ponytail: in-memory dedup is valid for the single-active server; use a durable store before multi-active replicas.
export class RequestDeduplicator {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.maxEntries = options.maxEntries ?? 1_000;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  run<T>(request: { id: string; fingerprint: string }, operation: () => Promise<T>): Promise<T> {
    this.prune();
    const existing = this.entries.get(request.id);
    if (existing) {
      if (existing.fingerprint !== request.fingerprint) {
        return Promise.reject(Object.assign(new Error("Request id already used with different content"), {
          code: "request_id_conflict",
        }));
      }
      return existing.promise as Promise<T>;
    }

    let promise: Promise<T>;
    try {
      promise = Promise.resolve(operation());
    } catch (error) {
      promise = Promise.reject(error);
    }
    const entry: Entry<T> = { fingerprint: request.fingerprint, promise };
    this.entries.set(request.id, entry);
    void entry.promise.then(
      () => { entry.settledAt = this.now(); this.prune(); },
      () => { entry.settledAt = this.now(); this.prune(); },
    );
    return entry.promise;
  }

  private prune(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.settledAt !== undefined && now - entry.settledAt >= this.ttlMs) this.entries.delete(id);
    }
    if (this.entries.size <= this.maxEntries) return;
    for (const [id, entry] of this.entries) {
      if (entry.settledAt === undefined) continue;
      this.entries.delete(id);
      if (this.entries.size <= this.maxEntries) break;
    }
  }
}
