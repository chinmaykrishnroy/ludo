import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, seat, roll, move } from "../shared/game.js";
import {
  loadPractice,
  savePractice,
  PRACTICE_KEY,
} from "../src/persistence.js";
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
test("offline manual players retain tokens, pending dice and turn across reload", () => {
  const s = storage();
  let g = newGame([
    seat("local-you", "Alice", 0),
    seat("local-2", "Bob", 1),
    null,
    null,
  ]);
  g = move(roll(g, 6), 0);
  g = roll(g, 3);
  savePractice(s, g);
  const restored = loadPractice(s)!;
  assert.deepEqual(restored, g);
  assert.equal(restored.phase, "move");
  assert.equal(restored.dice, 3);
  assert.equal(restored.seats[0]!.tokens[0], 0);
  const next = move(restored, 0);
  assert.equal(next.turn, 1);
  assert.equal(next.seats[1]!.bot, false);
});

test("legacy saves migrate to versioned envelopes and unknown versions stay untouched", () => {
  const s = storage(),
    game = newGame([seat("a", "A", 0), seat("b", "B", 1), null, null]);
  s.setItem(PRACTICE_KEY, JSON.stringify(game));
  const loaded = loadPractice(s)!;
  assert.deepEqual(loaded, game);
  savePractice(s, loaded);
  assert.equal(JSON.parse(s.getItem(PRACTICE_KEY)!).version, 2);
  assert.deepEqual(loadPractice(s), game);
  const newer = JSON.stringify({ version: 999, game });
  s.setItem(PRACTICE_KEY, newer);
  assert.equal(loadPractice(s), null);
  assert.equal(s.getItem(PRACTICE_KEY), newer);
});
test("only explicit clearing removes an offline saved game", () => {
  const s = storage(),
    g = newGame([seat("a", "A", 0), null, seat("b", "B", 2), null]);
  savePractice(s, g);
  assert(loadPractice(s));
  savePractice(s, null);
  assert.equal(loadPractice(s), null);
});
test("damaged local saves fall back safely instead of crashing the board", () => {
  const s = storage();
  for (const value of [
    "not json",
    "null",
    "{}",
    JSON.stringify({ seats: [null, null, null, null], turn: 0 }),
  ]) {
    s.setItem(PRACTICE_KEY, value);
    assert.equal(loadPractice(s), null);
  }
  const g = newGame([seat("a", "A", 0), seat("b", "B", 1), null, null]);
  g.seats[0]!.tokens[0] = 100;
  s.setItem(PRACTICE_KEY, JSON.stringify(g));
  assert.equal(loadPractice(s), null);
});

test("offline recovery rejects impossible phases, winners, counters and duplicate identities", () => {
  const s = storage();
  const fresh = () =>
    newGame([seat("a", "A", 0), seat("b", "B", 1), null, null]);
  const invalid = [
    { ...fresh(), phase: "move", dice: 1 },
    { ...fresh(), winner: "a" },
    { ...fresh(), phase: "finished", winner: "missing" },
    { ...fresh(), sixes: 3 },
    { ...fresh(), sixes: -1 },
    { ...fresh(), phase: "move", dice: 6, sixes: 0 },
  ];
  const duplicate = fresh();
  duplicate.seats[1]!.id = "a";
  invalid.push(duplicate);
  for (const game of invalid) {
    s.setItem(PRACTICE_KEY, JSON.stringify(game));
    assert.equal(loadPractice(s), null, JSON.stringify(game));
  }
});
