import { test } from "node:test";
import assert from "node:assert/strict";
import { IdempotencyCache, validateGameAction } from "../server/game/index.js";
import {
  GameTelemetry,
  logInfo,
  logWarn,
  logError,
} from "../server/metrics/index.js";
import {
  newGame,
  seat,
  roll,
  move,
  legalMoves,
  COLORS,
} from "../shared/game.js";
import type { Room } from "../shared/protocol.js";
import { PublicError } from "../server/security.js";

test("IdempotencyCache: stores, retrieves, expires, and trims entries", async () => {
  const cache = new IdempotencyCache<string>(50, 5); // 50ms TTL, max 5 entries

  // Basic set and get
  cache.set("key1", "value1");
  assert.equal(cache.get("key1"), "value1");
  assert.equal(cache.get("nonexistent"), undefined);
  assert.equal(cache.size, 1);

  // Explicit delete
  cache.delete("key1");
  assert.equal(cache.get("key1"), undefined);
  assert.equal(cache.size, 0);

  // TTL expiration
  cache.set("expiring", "temp");
  assert.equal(cache.get("expiring"), "temp");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(cache.get("expiring"), undefined);

  // Capacity trimming when exceeding maxEntries
  for (let i = 0; i < 10; i++) {
    cache.set(`bulk-${i}`, `val-${i}`);
  }
  assert.ok(cache.size <= 8, `Cache size should be trimmed, got ${cache.size}`);

  // Clear
  cache.clear();
  assert.equal(cache.size, 0);
});

test("validateGameAction: enforces room, turn, phase, revision, and authority", () => {
  const g = newGame(
    COLORS.map((_, i) => seat(`p${i}`, `Player ${i}`, i)),
    0,
  );

  const mockRoom: Room = {
    code: "TEST01",
    host: "p0",
    created: Date.now(),
    seats: g.seats,
    chat: [],
    game: g,
  };

  // 1. Valid turn roll should pass and return game and seatIndex
  const result = validateGameAction(mockRoom, "p0", g.revision, {
    type: "roll",
  });
  assert.equal(result.seatIndex, 0);
  assert.equal(result.game.revision, g.revision);

  // 2. Unstarted game rejects with NO_GAME
  assert.throws(
    () => {
      validateGameAction({ ...mockRoom, game: null }, "p0", g.revision, {
        type: "roll",
      });
    },
    (err: unknown) => err instanceof PublicError && err.code === "NO_GAME",
  );

  // 3. Stale revision rejects with STALE_REVISION
  assert.throws(
    () => {
      validateGameAction(mockRoom, "p0", g.revision + 1, { type: "roll" });
    },
    (err: unknown) =>
      err instanceof PublicError && err.code === "STALE_REVISION",
  );

  // 4. Wrong turn rejects with WRONG_TURN
  assert.throws(
    () => {
      validateGameAction(mockRoom, "p1", g.revision, { type: "roll" });
    },
    (err: unknown) => err instanceof PublicError && err.code === "WRONG_TURN",
  );

  // 5. Bot control attempt rejects with BOT_CONTROL
  const botGame = newGame(
    COLORS.map((_, i) => seat(`bot-${i}`, `Bot ${i}`, i, true)),
    0,
  );
  assert.throws(
    () => {
      validateGameAction(
        { ...mockRoom, game: botGame },
        "bot-0",
        botGame.revision,
        { type: "roll" },
      );
    },
    (err: unknown) => err instanceof PublicError && err.code === "BOT_CONTROL",
  );

  // 6. Finished game rejects with GAME_FINISHED
  const finishedGame = { ...g, phase: "finished" as const };
  assert.throws(
    () => {
      validateGameAction(
        { ...mockRoom, game: finishedGame },
        "p0",
        finishedGame.revision,
        { type: "roll" },
      );
    },
    (err: unknown) =>
      err instanceof PublicError && err.code === "GAME_FINISHED",
  );

  // 7. Invalid phase for roll (when phase is 'move') rejects with INVALID_PHASE
  const movePhaseGame = roll(g, 6, 100);
  assert.equal(movePhaseGame.phase, "move");
  assert.throws(
    () => {
      validateGameAction(
        { ...mockRoom, game: movePhaseGame },
        "p0",
        movePhaseGame.revision,
        { type: "roll" },
      );
    },
    (err: unknown) =>
      err instanceof PublicError && err.code === "INVALID_PHASE",
  );

  // 8. Illegal token move rejects with ILLEGAL_MOVE
  // Red token 0 is at track 5; rolling 2 means only token 0 can move.
  // Trying to move token 1 (in yard) rejects with ILLEGAL_MOVE
  const gWithTrack = newGame(
    COLORS.map((_, i) => seat(`p${i}`, `Player ${i}`, i)),
    0,
  );
  gWithTrack.seats[0]!.tokens = [5, -1, -1, -1];
  const movePhaseGame2 = roll(gWithTrack, 2, 100);
  assert.equal(movePhaseGame2.phase, "move");
  assert.equal(movePhaseGame2.turn, 0);
  assert.throws(
    () => {
      validateGameAction(
        { ...mockRoom, game: movePhaseGame2 },
        "p0",
        movePhaseGame2.revision,
        { type: "move", token: 1 },
      );
    },
    (err: unknown) => err instanceof PublicError && err.code === "ILLEGAL_MOVE",
  );
});

test("GameTelemetry: correctly tracks metrics and logs structured events", () => {
  const telemetry = new GameTelemetry();

  // Test recording actions
  telemetry.recordRoomCreated();
  telemetry.recordGameStarted();
  telemetry.recordRoll();
  telemetry.recordMove();
  telemetry.recordGameFinished();
  telemetry.recordDisconnect();
  telemetry.recordDisconnect();
  telemetry.recordReconnect();

  const snap = telemetry.snapshot();
  assert.equal(snap.roomsCreated, 1);
  assert.equal(snap.gamesStarted, 1);
  assert.equal(snap.diceRolls, 1);
  assert.equal(snap.movesExecuted, 1);
  assert.equal(snap.gamesFinished, 1);
  assert.equal(snap.disconnects, 2);
  assert.equal(snap.reconnects, 1);

  // Logging helpers format without throwing
  assert.doesNotThrow(() => {
    logInfo("test:info", { key: "value" });
    logWarn("test:warn", { warning: "test" });
    logError("test:error", new Error("unit error"));
  });
});

test("Game rules edge cases: exact finish, overshooting, safe square captures, and multiple captures", () => {
  const g = newGame(
    COLORS.map((_, i) => seat(`p${i}`, `Player ${i}`, i)),
    0,
  );

  // 1. Exact finish requirement: token at home entry 54 needs exactly 2 to reach 56 (finish)
  g.seats[0]!.tokens = [54, -1, -1, -1];

  // Rolling 3 overshoots (54 + 3 = 57 > 56) -> no legal moves
  const rolled3 = roll(g, 3, 100);
  assert.deepEqual(legalMoves(rolled3), []);

  // Rolling 2 lands exactly on 56 -> legal move
  const rolled2 = roll(g, 2, 100);
  assert.deepEqual(legalMoves(rolled2), [0]);
  const movedToFinish = move(rolled2, 0, 200);
  assert.equal(movedToFinish.seats[0]!.tokens[0], 56);

  // Token on 56 cannot move again
  const rolledAfterFinish = roll(movedToFinish, 6, 300);
  assert.deepEqual(legalMoves(rolledAfterFinish), [1, 2, 3]); // only remaining tokens in yard can move

  // 2. Multi-token capture on unsafe square
  const g2 = newGame(
    COLORS.map((_, i) => seat(`p${i}`, `Player ${i}`, i)),
    0,
  );
  // Red player (p0) has token at track 5
  g2.seats[0]!.tokens = [5, -1, -1, -1];
  // Green player (p1) local position 49 = track 10
  g2.seats[1]!.tokens = [49, -1, -1, -1];
  // Yellow player (p2) local position 36 = track 10
  g2.seats[2]!.tokens = [36, -1, -1, -1];

  // Now p0 rolls 5 (from 5 to 10)
  const rolled5 = roll(g2, 5, 400);
  assert.deepEqual(legalMoves(rolled5), [0]);
  const afterCapture = move(rolled5, 0, 500);

  // Both p1 and p2 tokens at track 10 should be captured and returned to -1
  assert.equal(
    afterCapture.seats[1]!.tokens[0],
    -1,
    "p1 token should be sent back to yard",
  );
  assert.equal(
    afterCapture.seats[2]!.tokens[0],
    -1,
    "p2 token should be sent back to yard",
  );
  // p0 should get an extra roll for capturing
  assert.equal(afterCapture.turn, 0, "p0 retains turn after capture");
  assert.equal(afterCapture.phase, "roll", "phase is roll after capture");
});
