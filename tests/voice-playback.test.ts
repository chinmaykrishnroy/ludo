import { test } from "node:test";
import assert from "node:assert/strict";
import { VoicePlayback } from "../src/voicePlayback.js";
const flush = () => new Promise((resolve) => setImmediate(resolve));
function player() {
  let created = 0,
    allowed = false,
    errors = 0;
  const state = { playing: [] as string[], blocked: false };
  const createElement = () => ({
    src: "",
    onended: null as null | (() => void),
    onerror: null as null | (() => void),
    pause() {},
    play: async () => {
      if (!allowed) {
        const e = new Error("Tap required");
        e.name = "NotAllowedError";
        throw e;
      }
    },
  });
  const elements: ReturnType<typeof createElement>[] = [];
  const playback = new VoicePlayback(
    (playing, blocked) => Object.assign(state, { playing, blocked }),
    () => errors++,
    () => {
      created++;
      const element = createElement();
      elements.push(element);
      return element as unknown as HTMLAudioElement;
    },
  );
  return {
    playback,
    elements,
    get element() {
      return elements[0]!;
    },
    state,
    allow: () => {
      allowed = true;
    },
    created: () => created,
    errors: () => errors,
  };
}
test("blocked autoplay preserves the recording and a tap reuses the unlocked element for queued recordings", async () => {
  const p = player();
  try {
    p.playback.enqueue([{ id: "one", speaker: "alice" }]);
    await flush();
    assert.deepEqual(p.state, { playing: [], blocked: true });
    p.playback.enqueue([{ id: "two", speaker: "alice" }]);
    assert.deepEqual(p.state.playing, []);
    p.allow();
    p.playback.resume();
    await flush();
    assert.equal(p.element.src, "/api/voice/one");
    assert.deepEqual(p.state.playing, ["one"]);
    p.element.onended!();
    await flush();
    assert.equal(p.element.src, "/api/voice/two");
    assert.equal(p.created(), 4);
    assert.equal(p.errors(), 0);
  } finally {
    p.playback.clear();
  }
});
test("muting stops playback and late autoplay rejections cannot resurrect a cleared queue", async () => {
  const p = player();
  p.playback.enqueue([{ id: "one", speaker: "alice" }]);
  p.playback.setMuted(true);
  await flush();
  assert.deepEqual(p.state, { playing: [], blocked: false });
  p.playback.enqueue([{ id: "two", speaker: "alice" }]);
  p.playback.resume();
  assert.deepEqual(p.state.playing, []);
  p.playback.setMuted(false);
  p.allow();
  p.playback.toggle({ id: "three", speaker: "alice" });
  await flush();
  assert.deepEqual(p.state.playing, ["three"]);
  p.playback.clear();
});

test("speaker unlock uses an allowed local blob and releases it before the next recording", async () => {
  const p = player();
  p.allow();
  try {
    p.playback.resume();
    await flush();
    const url = p.element.src;
    assert(url.startsWith("blob:"));
    assert.equal((await fetch(url)).headers.get("content-type"), "audio/wav");
    p.playback.enqueue([{ id: "one", speaker: "alice" }]);
    await flush();
    assert.equal(p.element.src, "/api/voice/one");
    assert.equal(p.created(), 4);
    await assert.rejects(fetch(url));
  } finally {
    p.playback.clear();
  }
});

test("four speakers overlap while a second note from the same speaker queues", async () => {
  const p = player();
  p.allow();
  try {
    p.playback.enqueue([
      { id: "red", speaker: "alice" },
      { id: "green", speaker: "bob" },
      { id: "yellow", speaker: "carol" },
      { id: "blue", speaker: "dan" },
      { id: "red-again", speaker: "alice" },
    ]);
    await flush();
    assert.deepEqual(p.state.playing, ["red", "green", "yellow", "blue"]);
    p.element.onended!();
    await flush();
    assert.deepEqual(p.state.playing, ["red-again", "green", "yellow", "blue"]);
    p.playback.setMuted(true);
    assert.deepEqual(p.state.playing, []);
  } finally {
    p.playback.clear();
  }
});
