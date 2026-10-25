import type { Game } from "../game.js";
import { strength } from "./features.js";
// These are normalized, interpretable utilities, not calibrated win probabilities.
export function utilities(g: Game, difficulty: number): number[] {
  if (g.phase === "finished")
    return g.seats.map((s) => (s?.id === g.winner ? 1 : 0));
  const scores = g.seats.map((s, i) => {
    if (!s) return -Infinity;
    const finished = s.tokens.filter((t) => t === 56).length;
    const last = s.tokens.find((t) => t !== 56) ?? -1;
    return (
      strength(g, i, difficulty) +
      (difficulty >= 7 && finished === 3 ? Math.max(0, last + 1) * 5 : 0)
    );
  });
  const leader = Math.max(...scores),
    values = scores.map((s) =>
      Number.isFinite(s) ? Math.exp((s - leader) / 150) : 0,
    ),
    total = values.reduce((a, b) => a + b, 0);
  return values.map((v) => v / total);
}
