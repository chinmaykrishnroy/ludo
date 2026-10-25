import { test } from "node:test";
import assert from "node:assert/strict";
import { publicRoomPage } from "../server/public-rooms.js";
import { seat, newGame } from "../shared/game.js";
import type { Room } from "../shared/protocol.js";
const room = (i: number): Room => ({
  code:
    "AAAA" +
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(i / 31)] +
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[i % 31],
  name: `Table ${i}`,
  public: true,
  host: `host-${i}`,
  seats: [seat(`host-${i}`, "Host", 0), null, null, null],
  game: null,
  voices: [],
  chat: [],
  createdAt: i,
  updatedAt: i,
  lastHumanAt: i,
});
test("50 public rooms are reachable exactly once through bounded stable pages", () => {
  const rooms = Array.from({ length: 50 }, (_, i) => room(i + 1)),
    before = JSON.stringify(rooms),
    seen: string[] = [];
  for (let page = 1; page <= 7; page++) {
    const result = publicRoomPage(rooms, page, 8, () => false);
    assert.equal(result.roomPage.total, 50);
    assert.equal(result.roomPage.pages, 7);
    assert.equal(result.roomPage.page, page);
    assert(result.rooms.length <= 8);
    seen.push(...result.rooms.map((r) => r.code));
  }
  assert.equal(seen.length, 50);
  assert.equal(new Set(seen).size, 50);
  assert.equal(
    publicRoomPage(rooms, 1, 8, () => false).rooms[0].name,
    "Table 50",
  );
  assert.equal(publicRoomPage(rooms, 500, 8, () => false).roomPage.page, 7);
  assert.equal(JSON.stringify(rooms), before);
});
test("pagination counts exclude private, blocked, archived, unattended, full and started rooms", () => {
  const rooms = Array.from({ length: 7 }, (_, i) => room(i + 1));
  rooms[1].public = false;
  rooms[2].archived = true;
  rooms[3].seats[0]!.connected = false;
  rooms[4].seats = [0, 1, 2, 3].map((i) => seat(`full-${i}`, "Full", i));
  rooms[5].seats[1] = seat("bot:one", "Bot", 1, true);
  rooms[5].game = newGame(rooms[5].seats);
  const result = publicRoomPage(rooms, 1, 8, (id) => id === "host-7");
  assert.equal(result.roomPage.total, 1);
  assert.deepEqual(
    result.rooms.map((r) => r.name),
    ["Table 1"],
  );
  const empty = publicRoomPage([], 9, 8, () => false);
  assert.deepEqual(empty, {
    rooms: [],
    roomPage: { page: 1, pageSize: 8, total: 0, pages: 1 },
  });
});
