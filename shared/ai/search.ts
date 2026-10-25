import { roll, type Game } from "../game.js";
import { analyzeMoves } from "./tactics.js";
import { utilities } from "./evaluator.js";
import { advanceSimulation } from "./simulator.js";
import { sampleDie } from "./rng.js";
import type { Rng } from "./types.js";
type Node = {
  game: Game;
  visits: number;
  totals: number[];
  children: Map<number, Node>;
  actions?: ReturnType<typeof analyzeMoves>;
};
const node = (game: Game): Node => ({
  game,
  visits: 0,
  totals: [0, 0, 0, 0],
  children: new Map(),
});
export function mcts(
  game: Game,
  level: number,
  rng: Rng,
  iterations: number,
  maxDepth: number,
  deadline: number,
  clock: () => number,
) {
  const root = node(game);
  let completed = 0,
    nodes = 1,
    timedOut = false;
  for (let iteration = 0; iteration < iterations; iteration++) {
    if (clock() >= deadline) {
      timedOut = true;
      break;
    }
    let current = root,
      depth = 0;
    const path = [root];
    while (depth < maxDepth && current.game.phase !== "finished") {
      const state = current.game;
      let action: number, next: Game;
      if (state.phase === "roll") {
        action = sampleDie(rng);
        next = roll(state, action, 0);
      } else {
        const actions = (current.actions ??= analyzeMoves(state, level));
        const unseen = actions.filter((a) => !current.children.has(a.token));
        if (unseen.length) {
          const chosen = unseen[0];
          action = chosen.token;
          next = chosen.next;
        } else {
          const chosen = actions
            .map((a) => {
              const child = current.children.get(a.token)!;
              return {
                a,
                value:
                  child.totals[state.turn] / child.visits +
                  0.65 *
                    Math.sqrt(Math.log(current.visits + 1) / child.visits) +
                  (0.15 * a.utility) / (child.visits + 1),
              };
            })
            .sort((a, b) => b.value - a.value || a.a.token - b.a.token)[0].a;
          action = chosen.token;
          next = chosen.next;
        }
      }
      let child = current.children.get(action);
      const expanded = !child;
      if (!child) {
        child = node(next);
        current.children.set(action, child);
        nodes++;
      }
      current = child;
      path.push(child);
      depth++;
      if (expanded) break;
    }
    let simulated = current.game;
    while (depth < maxDepth && simulated.phase !== "finished") {
      if (clock() >= deadline) {
        timedOut = true;
        break;
      }
      simulated = advanceSimulation(simulated, rng, 5);
      depth++;
    }
    const rewards = utilities(simulated, level);
    for (const visited of path) {
      visited.visits++;
      for (let i = 0; i < 4; i++) visited.totals[i] += rewards[i];
    }
    completed++;
    if (timedOut) break;
  }
  const candidates = analyzeMoves(game, level)
    .map((action) => {
      const child = root.children.get(action.token);
      const estimate = child?.visits
        ? child.totals[game.turn] / child.visits
        : action.utility;
      return {
        token: action.token,
        utility: action.utility * 0.65 + estimate * 0.35,
        visits: child?.visits ?? 0,
      };
    })
    .sort((a, b) => b.utility - a.utility || a.token - b.token);
  return { candidates, iterations: completed, nodes, timedOut };
}
export function lookahead(
  game: Game,
  level: number,
  beam: number,
  deadline: number,
  clock: () => number,
) {
  let nodes = 0,
    timedOut = false;
  const root = game.turn;
  const evaluate = (g: Game, depth: number): number => {
    nodes++;
    if (clock() >= deadline) {
      timedOut = true;
      return utilities(g, level)[root];
    }
    if (g.phase === "finished" || depth < 0 || nodes > 256)
      return utilities(g, level)[root];
    if (g.phase === "roll") {
      if (!depth) return utilities(g, level)[root];
      let expected = 0;
      for (let dice = 1; dice <= 6; dice++)
        expected += evaluate(roll(g, dice, 0), depth - 1) / 6;
      return expected;
    }
    const choices = analyzeMoves(g, level).slice(0, beam);
    // Each actor selects according to its own position; never minimize root's
    // score on behalf of all opponents as if they were a coordinated team.
    const weights = choices.map((a) =>
        Math.exp(8 * (a.utility - choices[0].utility)),
      ),
      total = weights.reduce((a, b) => a + b, 0);
    return choices.reduce(
      (value, a, i) => value + (weights[i] / total) * evaluate(a.next, depth),
      0,
    );
  };
  const candidates = analyzeMoves(game, level)
    .map((a) => ({
      token: a.token,
      utility: 0.6 * a.utility + 0.4 * evaluate(a.next, level === 8 ? 2 : 1),
      visits: 0,
    }))
    .sort((a, b) => b.utility - a.utility || a.token - b.token);
  return { candidates, nodes, timedOut };
}
