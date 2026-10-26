import { test } from "node:test";
import assert from "node:assert/strict";
import { editMentions, emojiOnly } from "../shared/chat.js";

test("emoji-only rendering recognises joined families, flags and keycaps without promoting ordinary text", () => {
  for (const text of ["😀", "👨‍👩‍👧‍👦 👋🏽", "🇮🇳🇬🇧", "1️⃣ #️⃣", "❤️\n🎲"])
    assert(emojiOnly(text), text);
  for (const text of [
    "",
    " ",
    "nice 😀",
    "123",
    "@Alice 🎲",
    "a",
    "1",
    "#",
    "🇮",
  ])
    assert(!emojiOnly(text), text);
});
test("mentions follow edits outside their range and disappear when their identity text changes", () => {
  const m = {
    playerId: "alice",
    name: "Alice",
    color: "red",
    start: 3,
    end: 9,
  };
  assert.deepEqual(editMentions("Hi @Alice!", "Hey, Hi @Alice!", [m]), [
    { ...m, start: 8, end: 14 },
  ]);
  assert.deepEqual(editMentions("Hi @Alice!", "Hi @Alice!!", [m]), [m]);
  assert.deepEqual(editMentions("Hi @Alice!", "Hi @Al!", [m]), []);
});
