import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  newGame,
  seat,
  roll,
  move,
  legalMoves,
  SAFE,
  STARTS,
} from "../build/shared/game.js";
import { chooseBotMove, createRng } from "../build/shared/ai/index.js";
const levels = [0, 3, 5, 7, 9, 10];
function legacy(g) {
  return legalMoves(g)
    .map((token) => {
      const from = g.seats[g.turn].tokens[token],
        to = from < 0 ? 0 : from + g.dice,
        next = move(g, token, 0);
      return {
        token,
        score:
          next.lastMove.captured * 110 +
          (to === 56 ? 150 : 0) +
          (from < 0 ? 38 : 0) +
          (to <= 50 && SAFE.has((STARTS[g.turn] + to) % 52) ? 12 : 0) +
          to,
      };
    })
    .sort((a, b) => b.score - a.score || a.token - b.token)[0].token;
}
if (!isMainThread) {
  const results = [],
    cpu = process.cpuUsage(),
    start = performance.now();
  for (let id = workerData.start; id < workerData.end; id++) {
    const level = levels[id % 6],
      seed = Math.floor(id / 6),
      count = 2 + (seed % 3),
      indices = count === 2 ? [0, 2] : count === 3 ? [0, 1, 2] : [0, 1, 2, 3],
      challenger = indices[Math.floor(seed / 3) % count];
    let g = newGame(
      [0, 1, 2, 3].map((i) =>
        indices.includes(i) ? seat("p" + i, "P" + i, i, true) : null,
      ),
      0,
    );
    const dice = createRng("dice:" + seed),
      ai = createRng("ai:" + id),
      warm = createRng("warm:" + seed),
      timings = [];
    if (seed % 2)
      for (let k = 0; k < 48 && g.phase !== "finished"; k++)
        g =
          g.phase === "roll"
            ? roll(g, 1 + Math.floor(warm() * 6), 0)
            : move(
                g,
                legalMoves(g)[Math.floor(warm() * legalMoves(g).length)],
                0,
              );
    let actions = 0,
      fallbacks = 0;
    while (g.phase !== "finished" && actions < 6000) {
      if (g.phase === "roll") g = roll(g, 1 + Math.floor(dice() * 6), 0);
      else if (g.turn !== challenger) g = move(g, legacy(g), 0);
      else {
        const before = performance.now();
        const decision = chooseBotMove(g, {
          difficulty: level,
          rng: ai,
          clock: () => 0,
          searchBudget: {
            iterations:
              level === 9
                ? Math.max(4, Math.floor(workerData.iterations / 2))
                : workerData.iterations,
            maxDepth: level === 9 ? 16 : 24,
            maxTimeMs: 1000,
          },
        });
        timings.push(performance.now() - before);
        if (decision.reasons.includes("WORKER_FALLBACK")) fallbacks++;
        g = move(g, decision.token, 0);
      }
      actions++;
    }
    if (g.phase !== "finished") throw new Error("Tournament deadlock " + id);
    results.push({
      level,
      count,
      win: g.winner === "p" + challenger,
      actions,
      timings,
      fallbacks,
    });
    if ((id - workerData.start + 1) % 100 === 0)
      parentPort.postMessage({ progress: id - workerData.start + 1 });
  }
  parentPort.postMessage({
    results,
    cpu: process.cpuUsage(cpu),
    ms: performance.now() - start,
    rss: process.memoryUsage().rss,
  });
} else {
  const games = Number(process.env.AI_TOURNAMENT_GAMES ?? 2400),
    threads = Math.min(4, Number(process.env.AI_TOURNAMENT_WORKERS ?? 4)),
    iterations = Number(process.env.AI_TOURNAMENT_ITERATIONS ?? 32);
  if (
    !Number.isInteger(games) ||
    games < 12 ||
    games > 12000 ||
    !Number.isInteger(threads) ||
    threads < 1 ||
    !Number.isInteger(iterations) ||
    iterations < 4 ||
    iterations > 256
  )
    throw new Error("Invalid tournament configuration");
  const start = performance.now(),
    cpuStart = process.cpuUsage();
  let peakRss = process.memoryUsage().rss;
  const memoryTimer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 100);
  memoryTimer.unref();
  const parts = await Promise.all(
    Array.from(
      { length: threads },
      (_, i) =>
        new Promise((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), {
            workerData: {
              start: Math.floor((games * i) / threads),
              end: Math.floor((games * (i + 1)) / threads),
              iterations,
            },
          });
          w.on("message", (m) => {
            if (m.results) resolve(m);
            else console.log(JSON.stringify({ worker: i, ...m }));
          });
          w.on("error", reject);
          w.on("exit", (code) => {
            if (code) reject(new Error("Tournament worker exit " + code));
          });
        }),
    ),
  );
  const all = parts.flatMap((p) => p.results),
    wilson = (wins, n) => {
      const z = 1.96,
        p = wins / n,
        d = 1 + (z * z) / n,
        mid = (p + (z * z) / (2 * n)) / d,
        h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
      return [mid - h, mid + h].map((v) => Number((v * 100).toFixed(2)));
    };
  const groups = [];
  for (const level of levels)
    for (const count of [2, 3, 4]) {
      const rows = all.filter((r) => r.level === level && r.count === count),
        wins = rows.filter((r) => r.win).length,
        times = rows.flatMap((r) => r.timings).sort((a, b) => a - b);
      if (!rows.length) continue;
      groups.push({
        level,
        players: count,
        games: rows.length,
        wins,
        winRatePercent: Number(((wins / rows.length) * 100).toFixed(2)),
        wilson95Percent: wilson(wins, rows.length),
        meanDecisionMs: Number(
          (times.reduce((a, b) => a + b, 0) / times.length).toFixed(3),
        ),
        p95DecisionMs: Number(
          times[Math.floor(times.length * 0.95)].toFixed(3),
        ),
        fallbacks: rows.reduce((a, b) => a + b.fallbacks, 0),
      });
    }
  clearInterval(memoryTimer);
  const cpuTotal = process.cpuUsage(cpuStart);
  const result = {
    at: new Date().toISOString(),
    scope:
      "Seeded shared-engine tournament against the previous greedy policy; 2/3/4 players, rotating colours, legal midgame warmups, separate search/dice RNG. Fixed iteration benchmark budgets, not deployment latency.",
    games,
    threads,
    level10Iterations: iterations,
    level9Iterations: Math.max(4, Math.floor(iterations / 2)),
    elapsedSeconds: Number(((performance.now() - start) / 1000).toFixed(2)),
    processCpuMs: (cpuTotal.user + cpuTotal.system) / 1000,
    peakSampledProcessRssMiB: Number(
      (Math.max(peakRss, ...parts.map((p) => p.rss)) / 1048576).toFixed(1),
    ),
    groups,
  };
  mkdirSync("output", { recursive: true });
  writeFileSync("output/ai-tournament.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
