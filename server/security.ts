import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import type { IncomingMessage } from "node:http";
import { ipKeyGenerator } from "express-rate-limit";
const proxyAddress = createRequire(import.meta.url)("proxy-addr") as {
  (
    request: IncomingMessage,
    trust: (ip: string, index: number) => boolean,
  ): string;
  compile: (ranges: string[]) => (ip: string, index: number) => boolean;
};
export const COOKIE = "ludo_session",
  SESSION_MS = 30 * 86400000;
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function secretFromCookie(header = "") {
  const value = header
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function newSecret() {
  return randomBytes(32).toString("hex");
}
export const normalizeIp = (ip: string) => ipKeyGenerator(ip, 64);
export function trustedClient(ranges = ["loopback"]) {
  const trust = proxyAddress.compile(ranges);
  return {
    trust,
    address: (req: IncomingMessage) =>
      ipKeyGenerator(proxyAddress(req, trust), 64),
  };
}
export function adminAuthorized(
  header: string | undefined,
  token: string | undefined,
) {
  if (!token || !header?.startsWith("Bearer ")) return false;
  return timingSafeEqual(
    Buffer.from(hash(header.slice(7)), "hex"),
    Buffer.from(hash(token), "hex"),
  );
}
export class Budget {
  private buckets = new Map<string, { used: number; until: number }>();
  private capacityRejected = 0;
  private quotaRejected = 0;
  snapshot() {
    return {
      keys: this.buckets.size,
      maxKeys: this.maxKeys,
      capacityRejected: this.capacityRejected,
      quotaRejected: this.quotaRejected,
    };
  }
  constructor(private maxKeys = 20000) {}
  take(
    key: string,
    limit: number,
    windowMs: number,
    cost = 1,
    now = Date.now(),
  ) {
    const old = this.buckets.get(key);
    if (old && old.until > now) {
      if (old.used + cost > limit) {
        this.quotaRejected++;
        return false;
      }
      old.used += cost;
      return true;
    }
    if (this.buckets.size >= this.maxKeys) {
      this.sweep(now);
      if (this.buckets.size >= this.maxKeys) {
        this.capacityRejected++;
        return false;
      }
    }
    this.buckets.set(key, { used: cost, until: now + windowMs });
    if (cost > limit) this.quotaRejected++;
    return cost <= limit;
  }
  sweep(now = Date.now()) {
    for (const [k, v] of this.buckets)
      if (v.until <= now) this.buckets.delete(k);
  }
}
export class PublicError extends Error {
  constructor(
    message: string,
    public code = "INVALID_ACTION",
  ) {
    super(message);
  }
}
