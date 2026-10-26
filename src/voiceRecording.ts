import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from "../shared/voice";

type Result =
  | { kind: "ready"; blob: Blob; duration: number }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };
type Options = {
  createRecorder?: (
    stream: MediaStream,
    options: MediaRecorderOptions,
  ) => MediaRecorder;
  now?: () => number;
  autoStopMs?: number;
  finalizeMs?: number;
};

// Owns one capture, including its stream. stop() requests codec finalization;
// tracks stay alive until onstop, after the final dataavailable event.
export function createVoiceRecording(
  stream: MediaStream,
  mime: string,
  options: Options = {},
) {
  const now = options.now ?? Date.now,
    startedAt = now();
  const chunks: BlobPart[] = [];
  let bytes = 0,
    stoppedAt: number | undefined,
    cancelled = false,
    settled = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let finalization: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (result: Result) => void;
  const finished = new Promise<Result>((done) => {
    resolve = done;
  });
  const make =
    options.createRecorder ?? ((s, config) => new MediaRecorder(s, config));
  let recorder: MediaRecorder;
  try {
    recorder = make(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  function finish(result: Result) {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    clearTimeout(finalization);
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* Release tracks even when the codec fails. */
    }
    stream.getTracks().forEach((track) => track.stop());
    chunks.length = 0;
    resolve(result);
  }
  function stop(cancel = false) {
    if (settled) return;
    cancelled ||= cancel;
    if (stoppedAt !== undefined) return;
    stoppedAt = now();
    clearTimeout(deadline);
    finalization = setTimeout(
      () =>
        finish({
          kind: "error",
          message: "The recording could not finish. Please try again.",
        }),
      options.finalizeMs ?? 5000,
    );
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      finish({
        kind: "error",
        message: "Recording interrupted. Please try again.",
      });
    }
  }
  recorder.ondataavailable = (event) => {
    if (settled) return;
    bytes += event.data.size;
    if (bytes > VOICE_MAX_BYTES) {
      finish({
        kind: "error",
        message: "Recording reached the size limit. Try a shorter message.",
      });
      return;
    }
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onerror = () =>
    finish({
      kind: "error",
      message: "Recording interrupted. Please try again.",
    });
  recorder.onstop = () => {
    if (cancelled) {
      finish({ kind: "cancelled" });
      return;
    }
    const duration = Math.min(
      VOICE_MAX_SECONDS,
      ((stoppedAt ?? now()) - startedAt) / 1000,
    );
    const blob = new Blob(chunks, { type: mime });
    if (blob.size < 16) {
      finish({
        kind: "error",
        message:
          "No audio was captured. Hold the button a little longer and try again.",
      });
      return;
    }
    if (duration < 0.2) {
      finish({
        kind: "error",
        message: "Hold a little longer to record a message.",
      });
      return;
    }
    finish({ kind: "ready", blob, duration });
  };
  try {
    recorder.start(250);
    deadline = setTimeout(
      () => stop(),
      options.autoStopMs ?? VOICE_MAX_SECONDS * 1000,
    );
  } catch {
    finish({
      kind: "error",
      message: "Recording could not start. Please try again.",
    });
  }
  return { startedAt, stop, finished };
}
export type VoiceRecording = ReturnType<typeof createVoiceRecording>;
