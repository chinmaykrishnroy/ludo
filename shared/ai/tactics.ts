import { legalMoves, move, SAFE, type Game } from "../game.js";
import { absolute, exposure, ambushValue } from "./features.js";
import { utilities } from "./evaluator.js";
import type { ReasonCode } from "./types.js";

// Cashing in an attack should compete with keeping a theoretical safe-square
// ambush alive. This is a bounded playing-style preference, not a win probability
// or an unconditional capture rule. The positional evaluation/search still
// decides whether exposing an important runner makes that capture too costly.
function capturePreference(before: Game, after: Game, level: number) {
  const change = after.lastMove!;
  if (level < 3 || !change.captured) return 0;
  let investment = 0;
  for (let player = 0; player < 4; player++) {
    if (player === before.turn || !before.seats[player]) continue;
    before.seats[player]!.tokens.forEach((step, token) => {
      if (step >= 0 && after.seats[player]!.tokens[token] === -1)
        investment += (step + 1) / 57;
    });
  }
  // A six already earns another roll: do not count its initiative twice.
  const newBonusRoll = before.dice !== 6 && after.turn === before.turn;
  const reward = Math.min(
    0.08,
    0.028 +
      Math.min(0.03, investment * 0.024) +
      Math.min(0.012, (change.captured - 1) * 0.004) +
      (newBonusRoll ? 0.016 : 0),
  );
  const risk = exposure(after, before.turn, change.to);
  const investedRunner = Math.max(0, change.to) / 56;
  return (
    reward *
    (1 - risk * (0.35 + investedRunner * 0.65)) *
    Math.min(1, (level - 2) / 4)
  );
}

export function analyzeMoves(g: Game, level: number) {
  return legalMoves(g)
    .map((token) => {
      const next = move(g, token, 0),
        change = next.lastMove!,
        reasons: ReasonCode[] = [];
      if (next.phase === "finished") reasons.push("IMMEDIATE_WIN");
      if (change.captured) {
        const stopsLeader = g.seats.some(
          (s, i) =>
            s &&
            i !== g.turn &&
            s.tokens.filter((t) => t === 56).length === 3 &&
            next.seats[i]!.tokens.some((t, j) => t === -1 && s.tokens[j] >= 0),
        );
        reasons.push(stopsLeader ? "STOP_LEADER" : "CAPTURE");
      }
      if (exposure(g, g.turn, change.from) > exposure(next, g.turn, change.to))
        reasons.push("ESCAPE_THREAT");
      if (change.to > 50 || SAFE.has(absolute(g.turn, change.to)))
        reasons.push("SAFE_POSITION");
      if (level >= 5 && ambushValue(next, g.turn) > ambushValue(g, g.turn))
        reasons.push("SAFE_AMBUSH");
      if (change.from < 0) reasons.push("RELEASE_TOKEN");
      if (!reasons.length) reasons.push("ADVANCE");
      return {
        token,
        next,
        reasons,
        utility:
          next.phase === "finished"
            ? utilities(next, level)[g.turn]
            : Math.min(
                0.999,
                utilities(next, level)[g.turn] +
                  capturePreference(g, next, level),
              ),
      };
    })
    .sort((a, b) => b.utility - a.utility || a.token - b.token);
}
