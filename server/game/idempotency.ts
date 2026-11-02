import type { Reply } from "../../shared/protocol.js";

/**
 * In-memory idempotency cache for game mutations (rolls and moves).
 * Prevents duplicate processing from network re-transmissions, rapid double-clicks,
 * or reconnect retry loops.
 */

export interface CachedActionResult<T = Reply> {
  reply: T;
  at: number;
}

export class IdempotencyCache<T = Reply> {
  private readonly cache = new Map<string, CachedActionResult<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs = 120_000, maxEntries = 5000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.at > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.reply;
  }

  set(key: string, reply: T): void {
    if (this.cache.size >= this.maxEntries) {
      this.cleanup();
    }
    this.cache.set(key, { reply, at: Date.now() });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.at > this.ttlMs) {
        this.cache.delete(key);
      }
    }
    // If still over capacity, trim oldest entries
    if (this.cache.size >= this.maxEntries) {
      const keysToDelete = Array.from(this.cache.keys()).slice(
        0,
        Math.floor(this.maxEntries / 4),
      );
      for (const k of keysToDelete) {
        this.cache.delete(k);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export const actionIdempotency = new IdempotencyCache<Reply>();
