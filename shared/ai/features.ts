import { SAFE, STARTS, type Game } from "../game.js";
export const absolute = (player: number, step: number) =>
  (STARTS[player] + step) % 52;

// Probability of at least one rival being able to capture this square on its
// next roll. Distinct dice outcomes are counted once, including stacked tokens.
export function exposure(g: Game, player: number, step: number) {
  if (step < 0 || step > 50 || SAFE.has(absolute(player, step))) return 0;
  const square = absolute(player, step);
  let survive = 1;
  for (let i = 0; i < 4; i++) {
    if (i === player || !g.seats[i]) continue;
    const dice = new Set<number>();
    for (const other of g.seats[i]!.tokens) {
      if (other < 0 || other > 50) continue;
      const distance = (square - absolute(i, other) + 52) % 52;
      if (
        distance >= 1 &&
        distance <= 6 &&
        other + distance <= 50 &&
        !(i === g.turn && g.sixes === 2 && distance === 6)
      )
        dice.add(distance);
    }
    survive *= 1 - dice.size / 6;
  }
  return 1 - survive;
}
// A protected staging square is valuable only if a fair future roll can hit a
// capturable rival. Count each target once, even with several own tokens there.
export function ambushValue(g: Game, player: number) {
  const own = g.seats[player];
  if (!own) return 0;
  let value = 0;
  for (let other = 0; other < 4; other++) {
    const rival = g.seats[other];
    if (!rival || other === player) continue;
    const completed = rival.tokens.filter((t) => t === 56).length;
    for (const target of rival.tokens) {
      if (target < 0 || target > 50 || SAFE.has(absolute(other, target)))
        continue;
      let best = 0;
      for (const step of own.tokens) {
        if (step < 0 || step > 50 || !SAFE.has(absolute(player, step)))
          continue;
        const gap =
          (absolute(other, target) - absolute(player, step) + 52) % 52;
        if (
          gap < 1 ||
          gap > 6 ||
          step + gap > 50 ||
          (g.turn === player && g.sixes === 2 && gap === 6)
        )
          continue;
        const rivalActsFirst =
          (other - g.turn + 4) % 4 < (player - g.turn + 4) % 4;
        best = Math.max(
          best,
          ((18 + target * 0.7 + (completed === 3 ? 95 : completed * 10)) / 6) *
            (rivalActsFirst ? 0.5 : 1),
        );
      }
      value += best;
    }
  }
  return value;
}
export function strength(g: Game, player: number, level: number) {
  const seat = g.seats[player];
  if (!seat) return 0;
  let value = 0,
    active = 0;
  for (const step of seat.tokens) {
    if (step < 0) continue;
    active++;
    if (step === 56) {
      value += 175;
      continue;
    }
    const progress = 20 + step * 1.25 + 40 * (step / 56) ** 3;
    value += progress;
    if (step > 50) value += 24;
    else if (SAFE.has(absolute(player, step))) value += 9;
    if (level >= 4) {
      // Losing an advanced token costs its invested progress. Protect stacks
      // too: safe squares protect every token; an unsafe stack can lose all.
      const urgency = g.turn === player && g.phase === "roll" ? 0.65 : 1;
      value -=
        exposure(g, player, step) *
        (progress + 24) *
        urgency *
        (0.5 + level / 10);
    }
  }
  if (level >= 7) {
    for (let other = 0; other < 4; other++) {
      const opponent = g.seats[other];
      if (!opponent || other === player) continue;
      const finished = opponent.tokens.filter((t) => t === 56).length;
      if (finished < 2) continue;
      for (const target of opponent.tokens) {
        if (target < 0 || target > 50 || SAFE.has(absolute(other, target)))
          continue;
        let chase = 0;
        for (const step of seat.tokens) {
          if (step < 0 || step > 50) continue;
          const gap =
            (absolute(other, target) - absolute(player, step) + 52) % 52;
          // Only the best pursuer counts. Releasing onto a duplicate square
          // must not double an imagined chance to chase one rival token.
          if (gap >= 1 && gap <= 12 && step + gap <= 50)
            chase = Math.max(
              chase,
              ((finished === 3 ? 95 : 32) * (13 - gap)) / 12,
            );
        }
        value += chase;
      }
    }
  }
  // Multiple runners give future dice choices, but a release is not given an
  // unconditional bonus large enough to overrule a valuable capture.
  value += Math.sqrt(active) * (level >= 3 ? 15 : 23);
  if (level >= 5) value += ambushValue(g, player) * (level >= 9 ? 1.4 : 1);
  return value;
}
