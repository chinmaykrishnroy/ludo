import { legalMoves, move, SAFE, type Game } from "../game.js";
import { absolute, exposure, ambushValue } from "./features.js";
import { utilities } from "./evaluator.js";
import type { ReasonCode } from "./types.js";
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
      return { token, next, reasons, utility: utilities(next, level)[g.turn] };
    })
    .sort((a, b) => b.utility - a.utility || a.token - b.token);
}
