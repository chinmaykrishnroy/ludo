import { SAFE, type Game } from "../game.js";
import { absolute, exposure, strength, ambushValue } from "./features.js";
export function analyzeBoard(g: Game, difficulty = 10) {
  return g.seats.map((seat, index) =>
    seat
      ? {
          index,
          strength: strength(g, index, difficulty),
          ambush: ambushValue(g, index),
          completed: seat.tokens.filter((t) => t === 56).length,
          active: seat.tokens.filter((t) => t >= 0 && t < 56).length,
          threat:
            seat.tokens.reduce(
              (n, t) => n + (t === 56 ? 1 : Math.max(0, t) / 56),
              0,
            ) / 4,
          tokens: seat.tokens.map((step) => ({
            step,
            remaining: step < 0 ? 57 : 56 - step,
            safe: step > 50 || (step >= 0 && SAFE.has(absolute(index, step))),
            exposure: exposure(g, index, step),
            capturable:
              step >= 0 && step <= 50 && !SAFE.has(absolute(index, step)),
          })),
        }
      : null,
  );
}
