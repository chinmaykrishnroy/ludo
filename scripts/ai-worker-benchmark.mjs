import { performance } from "node:perf_hooks";
import { AiScheduler } from "../build/server/ai/scheduler.js";
import { newGame, seat, roll } from "../build/shared/game.js";
const scheduler = new AiScheduler({
    timeoutMs: 1500,
    searchBudget: { iterations: 96, maxDepth: 24, maxTimeMs: 120 },
  }),
  latencies = [],
  compute = [],
  iterations = [];
const cpu = process.cpuUsage();
let peak = process.memoryUsage().rss;
const timer = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage().rss);
}, 20);
try {
  for (let i = 0; i < 72; i++) {
    const g = newGame(
      [0, 1, 2, 3].map((n) => seat(String(n), String(n), n, true)),
    );
    g.seats[0].tokens = [5, 16, 37, 51];
    g.seats[1].tokens = [7, 19, 35, 48];
    g.seats[2].tokens = [3, 20, 38, 50];
    g.seats[3].tokens = [2, 21, 36, 53];
    g.turn = i % 4;
    const pending = roll(g, 1 + (i % 6)),
      start = performance.now(),
      decision = await scheduler.request("benchmark", pending, 10);
    latencies.push(performance.now() - start);
    compute.push(decision.search.elapsedMs);
    iterations.push(decision.search.iterations);
  }
  const used = process.cpuUsage(cpu);
  latencies.sort((a, b) => a - b);
  compute.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope:
          "One isolated Node worker, 72 four-player positions, actual 96 iteration / 24 transition / 120ms budget; includes warm startup.",
        decisions: latencies.length,
        ackP95Ms: Number(
          latencies[Math.floor(latencies.length * 0.95)].toFixed(2),
        ),
        ackMaxMs: Number(latencies.at(-1).toFixed(2)),
        searchP95Ms: Number(
          compute[Math.floor(compute.length * 0.95)].toFixed(2),
        ),
        meanIterations: Number(
          (iterations.reduce((a, b) => a + b, 0) / iterations.length).toFixed(
            1,
          ),
        ),
        peakSampledRssMiB: Number((peak / 1048576).toFixed(1)),
        processCpuMs: (used.user + used.system) / 1000,
        ...scheduler.stats,
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(timer);
  await scheduler.close();
}
