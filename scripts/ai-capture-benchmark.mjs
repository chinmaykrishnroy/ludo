import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { newGame, seat, roll, move, legalMoves } from "../shared/game.ts";
import { chooseBotMove, createRng } from "../shared/ai/index.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
if (!process.argv[2])
  throw new Error(
    "Usage: node --import tsx scripts/ai-capture-benchmark.mjs <baseline-shared/ai/index.ts>",
  );
const { chooseBotMove: previous } = await import(
  pathToFileURL(resolve(process.argv[2])).href
);
const fresh = (count) =>
    newGame(
      [0, 1, 2, 3].map((i) =>
        i < count ? seat("p" + i, "P" + i, i, true) : null,
      ),
      0,
    ),
  sampleRng = createRng("capture-review"),
  positions = [];
let state = fresh(4);
while (positions.length < 256) {
  if (state.phase === "finished") state = fresh(4);
  if (state.phase === "roll") {
    state = roll(state, 1 + Math.floor(sampleRng() * 6), 0);
    continue;
  }
  const legal = legalMoves(state);
  if (
    legal.length > 1 &&
    legal.some((t) => move(state, t, 0).lastMove.captured)
  )
    positions.push(structuredClone(state));
  state = move(state, legal[Math.floor(sampleRng() * legal.length)], 0);
}
const options = (seed, budget) => ({
  difficulty: 10,
  rng: createRng(seed),
  clock: () => 0,
  searchBudget: {
    iterations: budget,
    maxDepth: budget === 96 ? 24 : 12,
    maxTimeMs: 120,
  },
});
const style = {
    positions: positions.length,
    previousCaptures: 0,
    balancedCaptures: 0,
    retainedNonCaptureChoices: 0,
    changedChoices: 0,
  },
  timings = { previous: [], balanced: [] };
for (const [i, g] of positions.entries()) {
  const snapshot = JSON.stringify(g),
    start = performance.now(),
    old = previous(g, options("snapshot:" + i, 96));
  timings.previous.push(performance.now() - start);
  const nextStart = performance.now(),
    next = chooseBotMove(g, options("snapshot:" + i, 96));
  timings.balanced.push(performance.now() - nextStart);
  assert(
    legalMoves(g).includes(old.token) && legalMoves(g).includes(next.token),
  );
  assert.equal(JSON.stringify(g), snapshot);
  if (move(g, old.token, 0).lastMove.captured) style.previousCaptures++;
  if (move(g, next.token, 0).lastMove.captured) style.balancedCaptures++;
  else style.retainedNonCaptureChoices++;
  if (old.token !== next.token) style.changedChoices++;
}
console.log(JSON.stringify({ stage: "positions", ...style }));
const games = {
  total: 48,
  balancedWins: 0,
  previousWins: 0,
  finished: 0,
  byPlayers: {},
};
for (let id = 0; id < games.total; id++) {
  const players = 2 + (id % 3),
    balancedSeat = Math.floor(id / 3) % players,
    dice = createRng("game-dice:" + id);
  let g = fresh(players),
    actions = 0;
  const rngs = Array.from({ length: players }, (_, p) =>
    createRng("game-search:" + id + ":" + p),
  );
  while (g.phase !== "finished" && actions < 8000) {
    if (g.phase === "roll") g = roll(g, 1 + Math.floor(dice() * 6), 0);
    else {
      const pick = g.turn === balancedSeat ? chooseBotMove : previous;
      const decision = pick(g, {
        difficulty: 10,
        rng: rngs[g.turn],
        clock: () => 0,
        searchBudget: { iterations: 24, maxDepth: 12, maxTimeMs: 120 },
      });
      assert(legalMoves(g).includes(decision.token));
      g = move(g, decision.token, 0);
    }
    actions++;
  }
  assert.equal(g.phase, "finished");
  games.finished++;
  const win = g.winner === "p" + balancedSeat;
  games[win ? "balancedWins" : "previousWins"]++;
  const row = (games.byPlayers[players] ??= { games: 0, balancedWins: 0 });
  row.games++;
  if (win) row.balancedWins++;
  if ((id + 1) % 12 === 0)
    console.log(
      JSON.stringify({
        stage: "games",
        finished: games.finished,
        balancedWins: games.balancedWins,
      }),
    );
}
const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return {
    meanMs: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
    p95Ms: +s[Math.floor((s.length - 1) * 0.95)].toFixed(3),
    maxMs: +s.at(-1).toFixed(3),
  };
};
const report = {
  date: "2026-10-26",
  baseline: "29a835a0b8fa60f954f973b1e01c7b256aadd7ad",
  style,
  decisionTiming: {
    previous: stats(timings.previous),
    balanced: stats(timings.balanced),
  },
  games,
  limitations: [
    "Seeded legal positions selected for multiple moves and an available capture; not a population-wide capture rate.",
    "Position comparison uses 96 iterations/depth 24 with elapsed cutoff disabled for reproducibility.",
    "Full-game smoke uses 24 iterations/depth 12 for both policies and rotates one balanced challenger against previous-policy rivals.",
    "48 games cannot prove stronger play or strict win-rate ranking. No physical-device or production-load claim.",
  ],
};
writeFileSync(
  "docs/benchmarks/ai-capture-balance-2026-10-26.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
