import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useAppearance } from "../src/useAppearance.js";
import { savePractice } from "../src/persistence.js";
import { newGame, seat } from "../shared/game.js";
import { createSafeStorage } from "../src/storage.js";

test("appearance renders when obtaining localStorage itself is denied", () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("Storage denied");
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => ({ matches: false }) },
  });
  function Probe() {
    return createElement("span", null, useAppearance()[0]);
  }
  try {
    assert.equal(renderToString(createElement(Probe)), "<span>system</span>");
  } finally {
    if (storageDescriptor)
      Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (windowDescriptor)
      Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("failed writes retain the newest in-memory values without erasing durable saves", () => {
  const disk = new Map([["game", "saved-game"]]);
  let blocked = true;
  const safe = createSafeStorage(() => ({
    getItem: (key) => {
      if (blocked) throw new Error("Denied");
      return disk.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (blocked) throw new Error("Full");
      disk.set(key, value);
    },
    removeItem: (key) => {
      if (blocked) throw new Error("Denied");
      disk.delete(key);
    },
  }));
  assert.equal(safe.getItem("game"), null);
  assert.equal(disk.get("game"), "saved-game");
  safe.setItem("theme", "dark");
  assert.equal(safe.getItem("theme"), "dark");
  safe.removeItem("theme");
  assert.equal(safe.getItem("theme"), null);
  assert(safe.unavailable());
  blocked = false;
  assert.equal(safe.getItem("game"), "saved-game");
  safe.setItem("theme", "light");
  assert.equal(disk.get("theme"), "light");
});
test("quota failures saving an offline game never escape into the UI", () => {
  const storage = {
    getItem: () => null,
    setItem() {
      throw new Error("Quota exceeded");
    },
    removeItem() {
      throw new Error("Storage denied");
    },
  };
  const game = newGame([seat("a", "A", 0), seat("b", "B", 1), null, null]);
  assert.doesNotThrow(() => savePractice(storage, game));
  assert.doesNotThrow(() => savePractice(storage, null));
});
