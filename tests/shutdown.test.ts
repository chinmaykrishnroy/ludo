import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApplication as createApplication } from "./application.js";
import { Store } from "../server/store.js";
import { seat, newGame, roll } from "../shared/game.js";

test("shutdown bounds an unresponsive WebSocket close and releases the lease with unfinished state intact", async () => {
  const root = mkdtempSync(join(tmpdir(), "ludo-shutdown-")),
    path = join(root, "game.sqlite");
  const app = createApplication({ dbPath: path, tickMs: 60000 });
  app.http.listen(0, "127.0.0.1");
  await once(app.http, "listening");
  const port = (app.http.address() as { port: number }).port;
  const response = await fetch(`http://127.0.0.1:${port}/api/session`),
    cookie = response.headers.get("set-cookie")!.split(";")[0];
  await response.text();
  const game = roll(
      newGame([
        seat("host", "Host", 0),
        seat("visitor", "Visitor", 1),
        null,
        null,
      ]),
      6,
    ),
    now = Date.now();
  const room = {
    code: "ABC234",
    name: "Saved match",
    host: "host",
    public: false,
    seats: structuredClone(game.seats),
    game,
    voices: [],
    chat: [],
    createdAt: now,
    updatedAt: now,
    lastHumanAt: now,
  };
  app.store.save(room);
  app.rooms.set(room.code, room);
  const socket = connect(port, "127.0.0.1");
  let closing: Promise<void> | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await once(socket, "connect");
    const upgraded = once(socket, "data");
    socket.write(
      `GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: bHVkby1zaHV0ZG93bi10cw==\r\nCookie: ${cookie}\r\n\r\n`,
    );
    assert.match(String((await upgraded)[0]), /101 Switching Protocols/);
    assert.equal(app.io.engine.clientsCount, 1);
    // A raw peer intentionally never responds to the server's WebSocket close frame.
    app.beginShutdown();
    closing = app.close();
    await Promise.race([
      closing,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Shutdown waited on an unresponsive peer instead of releasing the database",
              ),
            ),
          4000,
        );
      }),
    ]);
    const reopened = new Store(path);
    try {
      const saved = reopened.load()[0];
      assert.equal(saved.game!.revision, game.revision);
      assert.equal(saved.game!.deadline, game.deadline);
      assert.deepEqual(
        saved.game!.seats.map((s) => s?.tokens),
        game.seats.map((s) => s?.tokens),
      );
    } finally {
      reopened.close();
    }
  } finally {
    clearTimeout(timer);
    socket.destroy();
    await (closing ?? app.close());
    rmSync(root, { recursive: true, force: true });
  }
});
