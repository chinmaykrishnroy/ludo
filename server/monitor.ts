import { monitorEventLoopDelay } from "node:perf_hooks";
import { statfsSync } from "node:fs";
import { dirname, resolve } from "node:path";
export class Monitor {
  private timings = new Map<
    string,
    {
      count: number;
      maxMs: number;
      maxAt: number;
      recent: number[];
      loggedAt: number;
    }
  >();
  observe(
    operation:
      | "commit"
      | "persist"
      | "views"
      | "backup"
      | "retention"
      | "maintenance"
      | "backupCopy"
      | "backupVerify"
      | "backupHash"
      | "dbBegin"
      | "dbBody"
      | "dbCommit",
    elapsedMs: number,
  ) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
    const timing = this.timings.get(operation) ?? {
      count: 0,
      maxMs: 0,
      maxAt: 0,
      recent: [],
      loggedAt: 0,
    };
    timing.count++;
    timing.recent.push(elapsedMs);
    if (timing.recent.length > 128) timing.recent.shift();
    if (elapsedMs >= timing.maxMs) {
      timing.maxMs = elapsedMs;
      timing.maxAt = Date.now();
    }
    this.timings.set(operation, timing);
    if (elapsedMs >= 250 && Date.now() - timing.loggedAt >= 10000) {
      timing.loggedAt = Date.now();
      console.warn(
        JSON.stringify({
          event: "slow_operation",
          operation,
          elapsedMs: Math.round(elapsedMs),
          at: Date.now(),
        }),
      );
    }
  }
  measure<T>(operation: Parameters<Monitor["observe"]>[0], action: () => T): T {
    const started = performance.now();
    try {
      return action();
    } finally {
      this.observe(operation, performance.now() - started);
    }
  }
  backup = {
    retentionWarnings: 0,
    lastSuccessAt: null as number | null,
    lastFailureAt: null as number | null,
  };
  readonly loop = monitorEventLoopDelay({ resolution: 20 });
  errors = 0;
  storageErrors = 0;
  actions = 0;
  rejected = 0;
  lastErrorAt: number | null = null;
  storageHealthy = true;
  closing = false;
  constructor() {
    this.loop.enable();
  }
  failure(context: string, error: unknown, storage = true) {
    this.errors++;
    if (storage) {
      this.storageErrors++;
      this.storageHealthy = false;
    }
    this.lastErrorAt = Date.now();
    const e = error as { code?: string; message?: string };
    process.stderr.write(
      JSON.stringify({
        level: "error",
        event: context,
        at: new Date().toISOString(),
        code: e?.code ?? "ERROR",
        message: (e?.message ?? "Unknown failure").slice(0, 240),
      }) + "\n",
    );
  }
  success() {
    this.storageHealthy = true;
  }
  disk(path: string) {
    const s = statfsSync(dirname(resolve(path)));
    return {
      freeBytes: Number(s.bavail) * Number(s.bsize),
      totalBytes: Number(s.blocks) * Number(s.bsize),
    };
  }
  snapshot() {
    return {
      uptimeSeconds: Math.floor(process.uptime()),
      backup: this.backup,
      timings: Object.fromEntries(
        [...this.timings].map(([name, timing]) => {
          const sorted = [...timing.recent].sort((a, b) => a - b);
          return [
            name,
            {
              count: timing.count,
              recentSamples: sorted.length,
              lastMs: Number(timing.recent.at(-1)!.toFixed(2)),
              p95Ms: Number(
                sorted[Math.floor((sorted.length - 1) * 0.95)].toFixed(2),
              ),
              maxMs: Number(timing.maxMs.toFixed(2)),
              maxAt: timing.maxAt,
            },
          ];
        }),
      ),
      memory: process.memoryUsage(),
      eventLoopP95Ms: Number((this.loop.percentile(95) / 1e6).toFixed(2)),
      eventLoopMaxMs: Number((this.loop.max / 1e6).toFixed(2)),
      errors: this.errors,
      storageErrors: this.storageErrors,
      lastErrorAt: this.lastErrorAt,
      storageHealthy: this.storageHealthy,
      actions: this.actions,
      rejected: this.rejected,
      closing: this.closing,
    };
  }
  close() {
    this.loop.disable();
  }
}
