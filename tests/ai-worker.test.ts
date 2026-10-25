import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AiScheduler, type WorkerPort } from "../server/ai/scheduler.js";
import { newGame, seat, roll, legalMoves } from "../shared/game.js";
import { chooseBotMove, createRng, type AiJob } from "../shared/ai/index.js";
class FakeWorker extends EventEmitter implements WorkerPort {
  jobs: AiJob[] = [];
  stopped = false;
  postMessage(job: AiJob) {
    this.jobs.push(job);
  }
  async terminate() {
    this.stopped = true;
    return 0;
  }
}
const game = () =>
  roll(
    newGame([seat("a", "A", 0, true), seat("b", "B", 1, true), null, null]),
    6,
  );
test("real Node worker executes the shared MCTS and closes cleanly", async () => {
  const scheduler = new AiScheduler({
    timeoutMs: 10000,
    searchBudget: { iterations: 8, maxDepth: 6, maxTimeMs: 500 },
  });
  try {
    const result = await scheduler.request("real", game(), 10);
    assert(legalMoves(game()).includes(result.token));
    assert.equal(scheduler.stats.completed, 1);
    assert.equal(scheduler.stats.fallbacks, 0);
    assert.equal(result.search.algorithm, "mcts");
  } finally {
    await scheduler.close();
  }
});
test("cancelled jobs reject and stale worker messages never resolve replacement jobs", async () => {
  const workers: FakeWorker[] = [];
  const scheduler = new AiScheduler({
    factory: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    timeoutMs: 5000,
  });
  try {
    const first = scheduler.request("room", game(), 10);
    const rejected = assert.rejects(first, { name: "AbortError" });
    scheduler.cancel("room");
    await rejected;
    assert(workers[0].stopped);
    const next = scheduler.request("room", game(), 0);
    workers[0].emit("message", {
      id: workers[0].jobs[0].id,
      decision: chooseBotMove(game(), { difficulty: 10 }),
    });
    assert.equal(scheduler.pending, 1);
    const current = workers[1].jobs[0];
    workers[1].emit("message", {
      id: current.id,
      decision: chooseBotMove(current.game, { difficulty: 0 }),
    });
    assert.equal((await next).token, 0);
    assert.equal(scheduler.stats.completed, 1);
  } finally {
    await scheduler.close();
  }
});
test("only one worker job runs at a time and timeout uses a legal lightweight fallback", async () => {
  const w = new FakeWorker();
  const scheduler = new AiScheduler({ factory: () => w, timeoutMs: 30 });
  try {
    const a = scheduler.request("one", game(), 10),
      b = scheduler.request("two", game(), 0);
    assert.equal(w.jobs.length, 1);
    const results = await Promise.all([a, b]);
    assert(results.every((r) => legalMoves(game()).includes(r.token)));
    assert(results.every((r) => r.reasons.includes("WORKER_FALLBACK")));
    assert.equal(results[1].token, 0);
    assert.equal(scheduler.stats.timeouts, 2);
  } finally {
    await scheduler.close();
  }
});
test("fixed search seeds and iteration budgets replay exactly and a time budget terminates search", () => {
  const g = game(),
    run = () =>
      chooseBotMove(g, {
        difficulty: 10,
        rng: createRng(123),
        clock: () => 0,
        searchBudget: { iterations: 24, maxDepth: 10, maxTimeMs: 100 },
      });
  assert.deepEqual(run(), run());
  let clock = 0;
  const limited = chooseBotMove(g, {
    difficulty: 10,
    rng: createRng(123),
    clock: () => clock++,
    searchBudget: { iterations: 2048, maxDepth: 96, maxTimeMs: 3 },
  });
  assert.equal(limited.search.stopped, "time");
  assert(limited.search.iterations < 2048);
  assert(legalMoves(g).includes(limited.token));
});
test("search RNG is separate from production dice and samples six outcomes without changing the board", () => {
  const rng = createRng("distribution"),
    counts = Array(6).fill(0);
  for (let i = 0; i < 60000; i++) counts[Math.floor(rng() * 6)]++;
  for (const n of counts) assert(Math.abs(n - 10000) < 400);
  const g = game(),
    before = JSON.stringify(g);
  chooseBotMove(g, { difficulty: 10, rng: createRng("search") });
  assert.equal(JSON.stringify(g), before);
});
