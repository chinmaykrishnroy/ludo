import assert from "node:assert/strict";
import { test } from "node:test";
import { COLORS, position } from "../shared/game.js";
import {
  homeOrigin,
  orientCell,
  rotationForHome,
} from "../src/features/game/boardOrientation.js";

test("each viewing seat has its own home and all its yard tokens in the bottom-left", () => {
  for (const color of COLORS) {
    const rotation = rotationForHome(color);
    assert.deepEqual(homeOrigin(color, rotation), [20, 80]);
    for (let token = 0; token < 4; token++) {
      const [x, y] = orientCell(position(color, -1, token), rotation);
      assert(x < 6 && y > 8, `${color} token ${token} is at ${x},${y}`);
    }
    assert.equal(
      new Set(COLORS.map((other) => homeOrigin(other, rotation).join(",")))
        .size,
      4,
    );
  }
});
