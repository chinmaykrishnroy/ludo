import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadDisplayName,
  rememberDisplayName,
  DISPLAY_NAME_KEY,
} from "../src/profile.js";
import { formatCount } from "../src/formatCount.js";
const storage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};
test("first visit gets a memorable name that survives reopening", () => {
  const s = storage(),
    name = loadDisplayName(s);
  assert.match(name, /^[A-Z][a-z]+[A-Z][a-z]+\d{3}$/);
  assert(name.length <= 24);
  assert.equal(loadDisplayName(s), name);
});
test("legacy You migrates once and chosen names are remembered without blank overwrites", () => {
  const s = storage();
  s.setItem(DISPLAY_NAME_KEY, "You");
  assert.notEqual(loadDisplayName(s), "You");
  rememberDisplayName(s, "  Chinmay  ");
  rememberDisplayName(s, "   ");
  assert.equal(loadDisplayName(s), "Chinmay");
  rememberDisplayName(s, "You");
  assert.equal(loadDisplayName(s), "You");
});
test("existing custom names survive migration and storage failures do not block play", () => {
  const s = storage();
  s.setItem(DISPLAY_NAME_KEY, "Roy");
  assert.equal(loadDisplayName(s), "Roy");
  assert.doesNotThrow(() =>
    loadDisplayName({
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    }),
  );
});
test("large counters stay compact with the exact integer available", () => {
  assert.deepEqual(formatCount(2462467246724), {
    compact: "2.46T",
    exact: "2,462,467,246,724",
  });
  for (const [value, result] of [
    [0, "0"],
    [999, "999"],
    [1000, "1K"],
    [12345, "12.3K"],
    [999999, "1M"],
    [1e9, "1B"],
    [Number.MAX_SAFE_INTEGER, "9.01Q"],
  ] as const)
    assert.equal(formatCount(value).compact, result);
  assert.equal(formatCount(undefined).compact, "—");
  assert.equal(formatCount(NaN).compact, "—");
});
