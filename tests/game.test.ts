import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newGame,
  seat,
  roll,
  move,
  legalMoves,
  botMove,
  COLORS,
  PATH,
  position,
} from "../shared/game.js";
const full = () =>
  newGame(
    COLORS.map((_, i) => seat(`p${i}`, `Player ${i}`, i)),
    0,
  );
test("board has 52 distinct track squares and adjacent steps", () => {
  assert.equal(PATH.length, 52);
  assert.equal(new Set(PATH.map((p) => p.join(","))).size, 52);
  for (let i = 0; i < 52; i++) {
    const a = PATH[i],
      b = PATH[(i + 1) % 52];
    assert.equal(
      Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]),
      i === 4 || i === 17 || i === 30 || i === 43 ? 2 : 1,
    );
  }
});
test("a six releases a token and grants a bonus roll without mutating input", () => {
  const g = full(),
    r = roll(g, 6, 100);
  assert.deepEqual(legalMoves(r), [0, 1, 2, 3]);
  const n = move(r, 0, 200);
  assert.equal(n.seats[0]!.tokens[0], 0);
  assert.equal(n.turn, 0);
  assert.equal(n.phase, "roll");
  assert.deepEqual(g.seats[0]!.tokens, [-1, -1, -1, -1]);
  assert.equal(n.deadline, 15200);
});
test("a non-six cannot leave the yard and skips the turn", () => {
  const g = roll(full(), 3);
  assert.equal(g.turn, 1);
  assert.equal(g.phase, "roll");
  assert.deepEqual(legalMoves(g), []);
});

test("phase deadlines are 15 seconds for rolls and 30 seconds for moves", () => {
  const initial = newGame(full().seats, 1000);
  assert.equal(initial.deadline, 16000);
  const pending = roll(initial, 6, 2000);
  assert.equal(pending.phase, "move");
  assert.equal(pending.deadline, 32000);
  const bonus = move(pending, 0, 3000);
  assert.equal(bonus.turn, initial.turn);
  assert.equal(bonus.deadline, 18000);
  const skipped = roll(initial, 1, 4000);
  assert.equal(skipped.phase, "roll");
  assert.equal(skipped.deadline, 19000);
  const next = move(roll(bonus, 1, 5000), 0, 6000);
  assert.equal(next.turn, 1);
  assert.equal(next.deadline, 21000);
});
test("three consecutive sixes forfeit the third roll and retain earlier moves", () => {
  let g = full();
  g = move(roll(g, 6), 0);
  g = move(roll(g, 6), 0);
  g = roll(g, 6);
  assert.equal(g.turn, 1);
  assert.equal(g.sixes, 0);
  assert.equal(g.seats[0]!.tokens[0], 6);
  assert.match(g.notice, /three sixes/);
});
test("capturing sends opponents home and earns an extra turn", () => {
  const g = full();
  g.seats[0]!.tokens[0] = 12;
  g.seats[1]!.tokens[0] = 1;
  const n = move(roll(g, 2), 0);
  assert.equal(n.seats[1]!.tokens[0], -1);
  assert.equal(n.turn, 0);
  assert.equal(n.lastMove!.captured, 1);
});
test("all opposing tokens on an unsafe square can be captured", () => {
  const g = full();
  g.seats[0]!.tokens[0] = 12;
  g.seats[1]!.tokens = [1, 1, -1, -1];
  const n = move(roll(g, 2), 0);
  assert.equal(n.lastMove!.captured, 2);
});
test("coloured starts are safe even when another player lands there", () => {
  const g = full();
  g.seats[0]!.tokens[0] = 12;
  g.seats[1]!.tokens[0] = 0;
  const n = move(roll(g, 1), 0);
  assert.equal(n.seats[1]!.tokens[0], 0);
  assert.equal(n.lastMove!.captured, 0);
  assert.equal(n.turn, 1);
});
test("star squares are safe", () => {
  const g = full();
  g.seats[0]!.tokens[0] = 20;
  g.seats[1]!.tokens[0] = 8;
  const n = move(roll(g, 1), 0);
  assert.equal(n.seats[1]!.tokens[0], 8);
});
test("home lane entry is continuous for each colour", () => {
  for (let i = 0; i < 4; i++) {
    const a = position(COLORS[i], 50),
      b = position(COLORS[i], 51);
    assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1);
  }
});
test("exact finish is required, and finished tokens cannot move", () => {
  const g = full();
  g.seats[0]!.tokens = [55, 56, -1, -1];
  const r = roll(g, 2);
  assert.equal(r.turn, 1);
  const n = move(roll(g, 1), 0);
  assert.equal(n.seats[0]!.tokens[0], 56);
  assert.equal(n.turn, 0);
});
test("four finished tokens end the game and reject subsequent rolls", () => {
  const g = full();
  g.seats[0]!.tokens = [56, 56, 56, 55];
  const n = move(roll(g, 1), 3);
  assert.equal(n.phase, "finished");
  assert.equal(n.winner, "p0");
  assert.throws(() => roll(n, 6));
});
test("empty seats are skipped in two-player games", () => {
  const g = newGame([seat("a", "A", 0), null, seat("b", "B", 2), null]);
  assert.equal(roll(g, 1).turn, 2);
  assert.equal(roll(roll(g, 1), 2).turn, 0);
});
test("at least two players are required", () =>
  assert.throws(() => newGame([seat("a", "A", 0), null, null, null])));
test("illegal token indexes, phases, and forged dice are rejected", () => {
  const g = full();
  assert.throws(() => move(g, 0));
  assert.throws(() => roll(g, 7));
  assert.throws(() => roll(g, 1.4));
  assert.throws(() => move(roll(g, 6), 4));
  assert.throws(() => roll(roll(g, 6), 6));
});
test("tactical computer prioritizes capture over ordinary progress", () => {
  const g = full();
  g.seats[0]!.tokens = [12, 40, -1, -1];
  g.seats[1]!.tokens[0] = 1;
  assert.equal(botMove(roll(g, 2), 6), 0);
});
test("100 seeded full games terminate with exactly one valid winner", () => {
  let seed = 7;
  const rng = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed % 6) + 1;
  };
  for (let round = 0; round < 100; round++) {
    let g = full(),
      actions = 0;
    while (g.phase !== "finished" && actions < 10000) {
      g = g.phase === "roll" ? roll(g, rng()) : move(g, botMove(g, 2));
      for (const s of g.seats)
        assert(
          s!.tokens.every((t) => Number.isInteger(t) && t >= -1 && t <= 56),
        );
      actions++;
    }
    assert.equal(g.phase, "finished", `game ${round} did not finish`);
    assert.equal(
      g.seats.filter((s) => s!.tokens.every((t) => t === 56)).length,
      1,
    );
  }
});
