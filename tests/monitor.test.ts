import { test } from "node:test";
import assert from "node:assert/strict";
import { Monitor } from "../server/monitor.js";
test("operation diagnostics bound samples, expose historical peaks and include failed writes", () => {
  const monitor = new Monitor();
  try {
    for (let i = 0; i < 300; i++) monitor.observe("commit", i % 100);
    const commit = monitor.snapshot().timings.commit;
    assert.equal(commit.count, 300);
    assert.equal(commit.recentSamples, 128);
    assert.equal(commit.maxMs, 99);
    assert(commit.maxAt > 0);
    assert.throws(
      () =>
        monitor.measure("persist", () => {
          throw new Error("Failed write");
        }),
      /Failed write/,
    );
    assert.equal(monitor.snapshot().timings.persist.count, 1);
    monitor.observe("persist", NaN);
    assert.equal(monitor.snapshot().timings.persist.count, 1);
  } finally {
    monitor.close();
  }
});
