import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { totalmem } from "node:os";
import { AdmissionController } from "./admission.js";
export class PressureSampler {
  private loop = monitorEventLoopDelay({ resolution: 20 });
  private last = performance.now();
  private utilization = performance.eventLoopUtilization();
  private timer: ReturnType<typeof setInterval>;
  constructor(
    private controller: AdmissionController,
    private extra: () => { persistP95Ms: number; aiQueueAgeMs: number },
  ) {
    this.loop.enable();
    this.timer = setInterval(() => this.refresh(), 1000);
    this.timer.unref();
  }
  refresh() {
    const now = performance.now();
    if (now - this.last < 250) return;
    const current = performance.eventLoopUtilization(),
      delta = performance.eventLoopUtilization(current, this.utilization);
    this.utilization = current;
    this.last = now;
    const limit = process.constrainedMemory() || totalmem();
    // Reserve a bounded amount of actual headroom as well as checking RSS
    // against the cgroup/host limit. Other applications using a large host
    // should not block a small server that still has ample free memory.
    const available = process.availableMemory();
    this.controller.observe(
      {
        lagP95Ms: this.loop.percentile(95) / 1e6,
        lagMaxMs: this.loop.max / 1e6,
        utilization: delta.utilization,
        memoryRatio: Math.max(
          process.memoryUsage.rss() / limit,
          1 - available / Math.min(limit, 512 * 1024 * 1024),
        ),
        ...this.extra(),
      },
      now,
    );
    this.loop.reset();
  }
  close() {
    clearInterval(this.timer);
    this.loop.disable();
  }
}
