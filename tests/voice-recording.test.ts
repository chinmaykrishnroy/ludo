import { test } from "node:test";
import assert from "node:assert/strict";
import { createVoiceRecording } from "../src/voiceRecording.js";
import { VOICE_MAX_BYTES } from "../shared/voice.js";

function codec({ size = 32, flush = true, startFails = false } = {}) {
  let live = true,
    stopped = 0,
    time = 0;
  const stream = {
    getTracks: () => [
      {
        stop() {
          live = false;
          stopped++;
        },
      },
    ],
  } as unknown as MediaStream;
  const recorder = {
    state: "inactive",
    ondataavailable: null as null | ((event: { data: Blob }) => void),
    onstop: null as null | (() => void),
    onerror: null as null | (() => void),
    start() {
      if (startFails) throw new Error("Codec unavailable");
      this.state = "recording";
    },
    stop() {
      this.state = "inactive";
      if (flush)
        queueMicrotask(() => {
          this.ondataavailable?.({
            data: new Blob([new Uint8Array(live ? size : 0)]),
          });
          this.onstop?.();
        });
    },
  };
  return {
    stream,
    recorder,
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
    createRecorder: () => recorder as unknown as MediaRecorder,
    stopped: () => stopped,
    live: () => live,
  };
}
test("release flushes the final audio before stopping tracks; repeated stop cannot duplicate a send", async () => {
  const c = codec(),
    capture = createVoiceRecording(c.stream, "audio/webm", c);
  c.advance(400);
  capture.stop();
  capture.stop();
  assert(c.live(), "stream must stay alive until codec dataavailable/onstop");
  const result = await capture.finished;
  assert.equal(result.kind, "ready");
  if (result.kind === "ready") {
    assert.equal(result.blob.size, 32);
    assert.equal(result.duration, 0.4);
  }
  assert.equal(c.stopped(), 1);
});
test("cancel remains sticky across release events and the recorder is always released", async () => {
  const c = codec(),
    capture = createVoiceRecording(c.stream, "audio/webm", c);
  c.advance(500);
  capture.stop(true);
  capture.stop(false);
  assert.deepEqual(await capture.finished, { kind: "cancelled" });
  assert.equal(c.stopped(), 1);
});
test("empty recordings never become uploads or misleading oversized errors", async () => {
  const c = codec({ size: 0 }),
    capture = createVoiceRecording(c.stream, "audio/webm", c);
  c.advance(500);
  capture.stop();
  const result = await capture.finished;
  assert.equal(result.kind, "error");
  if (result.kind === "error") assert.match(result.message, /No audio/);
});
test("oversized and failed codecs release microphone tracks", async () => {
  for (const config of [{ size: VOICE_MAX_BYTES + 1 }, { startFails: true }]) {
    const c = codec(config),
      capture = createVoiceRecording(c.stream, "audio/webm", c);
    c.advance(1000);
    capture.stop();
    assert.equal((await capture.finished).kind, "error");
    assert.equal(c.stopped(), 1);
  }
});
test("a stalled finalizer releases tracks and the automatic deadline caps duration at 60 seconds", async () => {
  const stalled = codec({ flush: false });
  const capture = createVoiceRecording(stalled.stream, "audio/webm", {
    ...stalled,
    finalizeMs: 10,
  });
  capture.stop();
  assert.equal((await capture.finished).kind, "error");
  assert.equal(stalled.stopped(), 1);
  const c = codec(),
    timed = createVoiceRecording(c.stream, "audio/webm", {
      ...c,
      autoStopMs: 10,
    });
  c.advance(61000);
  const result = await timed.finished;
  assert.equal(result.kind, "ready");
  if (result.kind === "ready") assert.equal(result.duration, 60);
  assert.equal(c.stopped(), 1);
});
