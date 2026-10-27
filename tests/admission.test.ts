import { test } from "node:test";
import assert from "node:assert/strict";
import { Monitor } from "../server/monitor.js";
import {
  AdmissionController,
  type PressureSample,
} from "../server/admission.js";
const healthy: PressureSample = {
  lagP95Ms: 20,
  lagMaxMs: 25,
  utilization: 0.2,
  memoryRatio: 0.2,
  persistP95Ms: 3,
  aiQueueAgeMs: 0,
};
test("load admission responds to sustained pressure and recovers with hysteresis", () => {
  const c = new AdmissionController();
  assert(c.allow());
  c.observe({ ...healthy, utilization: 0.9 }, 1000);
  assert(c.allow());
  c.observe({ ...healthy, utilization: 0.9 }, 2000);
  assert.equal(c.allow(), false);
  assert.deepEqual(c.publicStatus(), {
    newRoomsAvailable: false,
    retryAfterSeconds: 5,
  });
  for (let i = 0; i < 6; i++) c.observe(healthy, 3000 + i * 1000);
  assert.equal(c.allow(), false);
  c.observe(healthy, 12000);
  assert(c.allow());
  assert.equal(c.snapshot().pauses, 1);
  assert.equal(c.snapshot().resumes, 1);
});
for (const [reason, change] of [
  ["event-loop-delay", { lagMaxMs: 600 }],
  ["memory", { memoryRatio: 0.94 }],
  ["persistence", { persistP95Ms: 210 }],
  ["ai-queue", { aiQueueAgeMs: 1300 }],
] as const) {
  test(
    "load admission immediately protects existing games from " + reason,
    () => {
      const c = new AdmissionController();
      c.observe({ ...healthy, ...change }, 1000);
      assert.equal(c.allow(), false);
      assert(c.snapshot().reasons.includes(reason));
    },
  );
}
test("an isolated spike does not close admission; invalid samples cannot corrupt recovery", () => {
  const c = new AdmissionController();
  c.observe({ ...healthy, utilization: 0.9 }, 1000);
  c.observe(healthy, 2000);
  assert(c.allow());
  c.observe({ ...healthy, memoryRatio: NaN }, 3000);
  assert(c.allow());
});
test("old storage latency expires from admission but remains in historical monitoring", () => {
  const monitor = new Monitor();
  try {
    monitor.observe("persist", 220);
    assert.equal(monitor.recentP95("persist"), 220);
    assert.equal(
      monitor.recentP95("persist", 5000, performance.now() + 6000),
      0,
    );
    assert.equal(monitor.snapshot().timings.persist.maxMs, 220);
  } finally {
    monitor.close();
  }
});
