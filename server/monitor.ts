import { monitorEventLoopDelay } from "node:perf_hooks";
import { statfsSync } from "node:fs";
import { dirname, resolve } from "node:path";
export class Monitor {
  backup = {
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
