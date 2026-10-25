import { roll, move, legalMoves, type Game } from "../game.js";
import { analyzeMoves } from "./tactics.js";
import { sampleDie } from "./rng.js";
import type { Rng } from "./types.js";
export function advanceSimulation(g: Game, rng: Rng, level: number): Game {
  if (g.phase === "roll") return roll(g, sampleDie(rng), 0);
  if (g.phase === "finished") return g;
  const legal = legalMoves(g);
  if (legal.length === 1) return move(g, legal[0], 0);
  const actions = analyzeMoves(g, level);
  // Each rival pursues its own utility; opponents do not collude against root.
  return actions[rng() < 0.12 ? Math.floor(rng() * actions.length) : 0].next;
}
