import { test } from "node:test";
import assert from "node:assert/strict";
import { VoicePlayback } from "../src/voicePlayback.js";
const flush = () => new Promise((resolve) => setImmediate(resolve));
function player() {
  let created = 0,
    allowed = false,
    errors = 0;
  const state = { playing: null as string | null, blocked: false };
  const element = {
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
  };
  const playback = new VoicePlayback(
    (playing, blocked) => Object.assign(state, { playing, blocked }),
    () => errors++,
    () => {
      created++;
      return element as unknown as HTMLAudioElement;
    },
  );
  return {
    playback,
    element,
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
    p.playback.enqueue(["one"]);
    await flush();
    assert.deepEqual(p.state, { playing: null, blocked: true });
    p.playback.enqueue(["two"]);
    assert.equal(p.state.playing, null);
    p.allow();
    p.playback.resume();
    await flush();
    assert.equal(p.element.src, "/api/voice/one");
    assert.equal(p.state.playing, "one");
    p.element.onended!();
    await flush();
    assert.equal(p.element.src, "/api/voice/two");
    assert.equal(p.created(), 1);
    assert.equal(p.errors(), 0);
  } finally {
    p.playback.clear();
  }
});
test("muting stops playback and late autoplay rejections cannot resurrect a cleared queue", async () => {
  const p = player();
  p.playback.enqueue(["one"]);
  p.playback.setMuted(true);
  await flush();
  assert.deepEqual(p.state, { playing: null, blocked: false });
  p.playback.enqueue(["two"]);
  p.playback.resume();
  assert.equal(p.state.playing, null);
  p.playback.setMuted(false);
  p.allow();
  p.playback.toggle("three");
  await flush();
  assert.equal(p.state.playing, "three");
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
    p.playback.enqueue(["one"]);
    await flush();
    assert.equal(p.element.src, "/api/voice/one");
    assert.equal(p.created(), 1);
    await assert.rejects(fetch(url));
  } finally {
    p.playback.clear();
  }
});
