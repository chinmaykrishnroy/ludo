import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, seat, roll, move, legalMoves } from "../shared/game.js";
import { botMove } from "../shared/bot.js";
import { chooseBotMove, createRng, analyzeBoard } from "../shared/ai/index.js";
import { analyzeMoves } from "../shared/ai/tactics.js";
const board = () =>
  newGame([
    seat("a", "A", 0, true),
    seat("b", "B", 1, true),
    seat("c", "C", 2, true),
    seat("d", "D", 3, true),
  ]);
test("level zero is exactly the first legal timeout move, even when a capture is available", () => {
  const g = board();
  g.seats[0]!.tokens = [20, 5, -1, -1];
  g.seats[1]!.tokens = [50, 56, 56, 56];
  assert.equal(botMove(roll(g, 6), 0), 0);
  assert.equal(botMove(roll(g, 6), 10), 1);
});
test("expert uses a six to capture a rival close to winning rather than release a token", () => {
  const g = board();
  g.seats[0]!.tokens = [5, -1, -1, -1];
  g.seats[1]!.tokens = [50, 56, 56, 56];
  const pending = roll(g, 6),
    chosen = botMove(pending, 10);
  assert.equal(chosen, 0);
  assert.equal(move(pending, chosen).lastMove!.captured, 1);
});
test("expert pursues the final exposed runner instead of automatically releasing", () => {
  const g = board();
  g.seats[0]!.tokens = [0, -1, -1, -1];
  g.seats[1]!.tokens = [48, 56, 56, 56];
  assert.equal(botMove(roll(g, 6), 10), 0);
});
test("expert weighs safe squares and exact finishes", () => {
  const g = board();
  g.seats[0]!.tokens = [7, 30, 56, 56];
  g.seats[3]!.tokens = [40, -1, -1, -1];
  assert.equal(botMove(roll(g, 1), 10), 0);
  g.seats[0]!.tokens = [50, -1, -1, -1];
  assert.equal(botMove(roll(g, 6), 10), 0);
});

test("expert cashes in a safe capture and bonus roll instead of preserving a future ambush", () => {
  const g = board();
  // Reached during a seeded legal game: green can capture blue on
  // square45, or move another runner onto a protected square for a future hit.
  g.seats[0]!.tokens = [24, 33, 12, 51];
  g.seats[1]!.tokens = [-1, -1, 28, 22];
  g.seats[2]!.tokens = [-1, 40, -1, 34];
  g.seats[3]!.tokens = [41, -1, 6, 52];
  g.turn = 1;
  const pending = roll(g, 4);
  const decision = chooseBotMove(pending, {
    difficulty: 10,
    rng: createRng(42),
    clock: () => 0,
  });
  assert.equal(decision.token, 2);
  assert.equal(move(pending, decision.token).lastMove!.captured, 1);
  assert.equal(move(pending, decision.token).turn, pending.turn);
});

test("balanced expert can still protect an advanced runner instead of taking a cheap capture", () => {
  const g = board();
  g.seats[0]!.tokens = [17, 38, 56, 56];
  g.seats[1]!.tokens = [5, -1, -1, -1];
  g.seats[2]!.tokens = [8, 9, 10, 11];
  const pending = roll(g, 1);
  assert.equal(move(pending, 0).lastMove!.captured, 1);
  const decision = chooseBotMove(pending, {
    difficulty: 10,
    rng: createRng(42),
    clock: () => 0,
  });
  assert.equal(decision.token, 1);
  assert(decision.reasons.includes("SAFE_POSITION"));
});

test("a capture values a newly earned bonus roll without counting a six twice", () => {
  const one = board(),
    six = board();
  one.seats[0]!.tokens = [5, -1, -1, -1];
  six.seats[0]!.tokens = [0, -1, -1, -1];
  one.seats[1]!.tokens = [45, -1, -1, -1];
  six.seats[1]!.tokens = [45, -1, -1, -1];
  const fromOne = analyzeMoves(roll(one, 1), 10).find((m) => m.token === 0)!,
    fromSix = analyzeMoves(roll(six, 6), 10).find((m) => m.token === 0)!;
  assert.deepEqual(fromOne.next.seats, fromSix.next.seats);
  assert.equal(fromOne.next.turn, fromSix.next.turn);
  assert(fromOne.utility > fromSix.utility);
});
test("all levels return legal deterministic moves without modifying the board or inspecting future dice", () => {
  const g = board();
  g.seats[0]!.tokens = [5, 16, 37, 51];
  g.seats[1]!.tokens = [7, 19, 35, 48];
  g.seats[2]!.tokens = [3, 20, 38, 50];
  g.seats[3]!.tokens = [2, 21, 36, 53];
  for (let level = 0; level <= 10; level++)
    for (let dice = 1; dice <= 6; dice++) {
      const pending = roll(g, dice),
        before = JSON.stringify(pending),
        result = chooseBotMove(pending, {
          difficulty: level,
          rng: createRng(101),
          clock: () => 0,
          searchBudget: { iterations: 24, maxDepth: 10, maxTimeMs: 120 },
        });
      assert(legalMoves(pending).includes(result.token));
      assert.equal(
        result.token,
        chooseBotMove(pending, {
          difficulty: level,
          rng: createRng(101),
          clock: () => 0,
          searchBudget: { iterations: 24, maxDepth: 10, maxTimeMs: 120 },
        }).token,
      );
      assert(result.search.nodes <= 300);
      assert.equal(JSON.stringify(pending), before);
    }
  assert.throws(() => botMove(roll(g, 1), 11));
  assert.throws(() => botMove(roll(g, 1), 1.5));
});
test("protected stars can stage a future capture without inventing attacks on safe or home-lane tokens", () => {
  const g = board();
  g.seats[0]!.tokens = [8, -1, -1, -1];
  g.seats[1]!.tokens = [50, 56, 56, 56];
  const one = analyzeBoard(g)[0]!.ambush;
  assert(one > 0);
  assert.equal(analyzeBoard(g)[0]!.tokens[0].exposure, 0);
  g.seats[0]!.tokens = [8, 8, -1, -1];
  assert.equal(analyzeBoard(g)[0]!.ambush, one);
  g.seats[1]!.tokens[0] = 51;
  assert.equal(analyzeBoard(g)[0]!.ambush, 0);
  g.seats[1]!.tokens[0] = 47;
  assert.equal(analyzeBoard(g)[0]!.ambush, 0);
  g.seats[0]!.tokens = [21, -1, -1, -1];
  g.seats[1]!.tokens[0] = 14;
  g.sixes = 1;
  assert(analyzeBoard(g)[0]!.ambush > 0);
  g.sixes = 2;
  assert.equal(analyzeBoard(g)[0]!.ambush, 0);
});
test("terminal wins dominate heuristic rewards in two-, three- and four-player games", () => {
  for (const count of [2, 3, 4]) {
    const seats = [0, 1, 2, 3].map((i) =>
        i < count ? seat(String(i), String(i), i, true) : null,
      ),
      g = newGame(seats);
    g.seats[0]!.tokens = [55, 56, 56, 56];
    const decision = chooseBotMove(roll(g, 1), {
      difficulty: 10,
      rng: createRng(4),
    });
    assert.equal(decision.token, 0);
    assert(decision.reasons.includes("IMMEDIATE_WIN"));
    assert.equal(move(roll(g, 1), decision.token).phase, "finished");
  }
});
