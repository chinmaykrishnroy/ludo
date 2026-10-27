export type PressureSample = {
  lagP95Ms: number;
  lagMaxMs: number;
  utilization: number;
  memoryRatio: number;
  persistP95Ms: number;
  aiQueueAgeMs: number;
};
export class AdmissionController {
  private paused = false;
  private since = 0;
  private high = 0;
  private healthy = 0;
  private rejected = 0;
  private pauses = 0;
  private resumes = 0;
  private sample: PressureSample | null = null;
  private reasons: string[] = [];
  private lastPause: { reasons: string[]; sample: PressureSample } | null =
    null;
  observe(sample: PressureSample, now = performance.now()) {
    if (Object.values(sample).some((v) => !Number.isFinite(v) || v < 0)) return;
    this.sample = { ...sample };
    const reasons = [];
    if (sample.lagP95Ms >= 100 || sample.lagMaxMs >= 500)
      reasons.push("event-loop-delay");
    if (sample.utilization >= 0.8) reasons.push("event-loop-utilization");
    if (sample.memoryRatio >= 0.85) reasons.push("memory");
    if (sample.persistP95Ms >= 40) reasons.push("persistence");
    // Act before the scheduler's 1.5-second fallback deadline.
    if (sample.aiQueueAgeMs >= 750) reasons.push("ai-queue");
    const severe =
      sample.lagMaxMs >= 500 ||
      sample.memoryRatio >= 0.93 ||
      sample.persistP95Ms >= 200 ||
      sample.aiQueueAgeMs >= 1250;
    this.high = reasons.length ? this.high + 1 : 0;
    const healthy =
      sample.lagP95Ms <= 50 &&
      sample.lagMaxMs < 150 &&
      sample.utilization <= 0.6 &&
      sample.memoryRatio <= 0.75 &&
      sample.persistP95Ms <= 20 &&
      sample.aiQueueAgeMs <= 250;
    this.healthy = healthy ? this.healthy + 1 : 0;
    if (!this.paused && (severe || this.high >= 2)) {
      this.paused = true;
      this.since = now;
      this.reasons = reasons;
      this.lastPause = { reasons: [...reasons], sample: { ...sample } };
      this.pauses++;
      this.healthy = 0;
    } else if (this.paused && this.healthy >= 5 && now - this.since >= 10000) {
      this.paused = false;
      this.reasons = [];
      this.resumes++;
      this.high = 0;
    } else if (this.paused && reasons.length) this.reasons = reasons;
  }
  allow() {
    if (this.paused) {
      this.rejected++;
      return false;
    }
    return true;
  }
  publicStatus() {
    return {
      newRoomsAvailable: !this.paused,
      retryAfterSeconds: this.paused ? 5 : 0,
    };
  }
  snapshot(now = performance.now()) {
    return {
      ...this.publicStatus(),
      pausedForMs: this.paused ? Math.max(0, Math.floor(now - this.since)) : 0,
      reasons: [...this.reasons],
      sample: this.sample,
      lastPause: this.lastPause,
      rejected: this.rejected,
      pauses: this.pauses,
      resumes: this.resumes,
    };
  }
}
