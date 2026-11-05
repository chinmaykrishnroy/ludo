import assert from "node:assert/strict";
import { test } from "node:test";
import { botReactionCandidates, effectActor } from "../shared/effects.js";
import { move, newGame, roll, seat } from "../shared/game.js";
import { TableEffects } from "../server/table-effects.js";
import { speechGain } from "../src/features/voice/roomAudioMixer.js";

test("bots can plead when threatened, react to a capture, or decline", () => {
  const before = newGame([
    seat("alice", "Alice", 0),
    seat("bot:bob", "Bob", 1, true),
    null,
    null,
  ]);
  before.seats[0]!.tokens[0] = 12;
  before.seats[1]!.tokens[0] = 1;
  const rolled = roll(before, 2);
  assert.equal(botReactionCandidates(before, rolled)[0]?.reaction, "plead");
  const moved = move(rolled, 0);
  const candidates = botReactionCandidates(rolled, moved);
  assert.equal(candidates[0]?.reaction, "angry");
  const offline = {
    ...before,
    seats: [before.seats[0], { ...before.seats[1]!, id: "cpu-1" }, null, null],
  };
  assert.equal(
    botReactionCandidates(offline, roll(offline, 2))[0]?.actor.id,
    "cpu-1",
  );
  const clock = () => 100;
  assert.equal(
    new TableEffects(clock, () => 0.9).bot("room", candidates, 0),
    false,
  );
  const yes = new TableEffects(clock, () => 0);
  assert(yes.bot("room", candidates, 850));
  assert.equal(yes.view("room")!.reaction!.startsAt, 950);
  assert.equal(yes.bot("room", candidates, 0), false);
  const redBot = {
    ...rolled,
    seats: [
      { ...rolled.seats[0]!, id: "bot:red", bot: true },
      rolled.seats[1],
      null,
      null,
    ],
  };
  assert.equal(
    botReactionCandidates(redBot, move(redBot, 0))[0]?.reaction,
    "celebrate",
  );
});

test("a table has separate reaction and sound slots that expire and respect visibility", () => {
  let now = 100;
  const effects = new TableEffects(() => now);
  const a = effectActor(seat("alice", "Alice", 0));
  const b = effectActor(seat("bob", "Bob", 1));
  const clip = { sound: "ding", title: "Ding", gain: 0.4 };
  assert(effects.react("A", a, "celebrate"));
  assert(effects.sound("A", a, clip, 1));
  assert(!effects.react("A", b, "angry"));
  assert(!effects.sound("A", b, clip, 1));
  assert(effects.react("B", b, "angry"));
  assert.equal(effects.view("A", () => false)?.sound, undefined);
  assert(effects.view("A", () => false)!.soundReadyAt > now);
  now += 1700;
  assert(effects.sound("A", b, clip, 1));
  assert(!effects.react("A", b, "angry"));
  now += 1600;
  assert(effects.react("A", b, "angry"));
  effects.removeActor("A", b.id);
  assert.equal(effects.view("A")!.reaction, undefined);
});

test("voice leveling boosts quiet speech, leaves silence alone and tames loud peaks", () => {
  assert.equal(speechGain(0), 1);
  assert.equal(speechGain(0.005), 1);
  assert.equal(speechGain(0.009), 3.2);
  assert(speechGain(0.055) > 1);
  assert(speechGain(0.35) < 1);
});
