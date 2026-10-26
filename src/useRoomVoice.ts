import { useEffect, useRef, useState } from "react";
import type { Room, Reply } from "../shared/protocol";
import { VOICE_MAX_SECONDS } from "../shared/voice";
import { browserStorage } from "./storage";
import { createVoiceRecording, type VoiceRecording } from "./voiceRecording";
export function useRoomVoice({
  room,
  send,
  notify,
  onOnline,
}: {
  room: Room | null;
  send: (event: string, data: unknown) => Promise<Reply>;
  notify: (text: string) => void;
  onOnline: () => void;
}) {
  const [recording, setRecording] = useState(false),
    [pending, setPending] = useState(false),
    [seconds, setSeconds] = useState(0),
    [auto, setAuto] = useState(
      () => browserStorage.getItem("ludo-voice-auto") !== "off",
    ),
    [playing, setPlaying] = useState<string | null>(null);
  const recorder = useRef<VoiceRecording | null>(null),
    held = useRef(false),
    mounted = useRef(true),
    stream = useRef<MediaStream | null>(null),
    started = useRef(0),
    audio = useRef<HTMLAudioElement | null>(null),
    cancelled = useRef(false),
    playbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    seen = useRef(new Set<string>()),
    queue = useRef<string[]>([]);
  const microphoneReady = useRef(false),
    permissionPending = useRef(false);
  const roomCode = useRef(room?.code);
  roomCode.current = room?.code;
  function cleanup() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }
  function stop(cancel = false) {
    held.current = false;
    cancelled.current ||= cancel;
    const r = recorder.current;
    r?.stop(cancel);
    cleanup();
    setRecording(false);
    if (r) setPending(true);
  }
  function pausePlayback() {
    if (playbackTimer.current) clearTimeout(playbackTimer.current);
    if (audio.current) {
      audio.current.onended = null;
      audio.current.onerror = null;
      audio.current.pause();
      audio.current = null;
    }
  }
  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && held.current) {
        event.preventDefault();
        stop(true);
      }
    };
    const cancelWhenHidden = () => {
      if (document.hidden && held.current) stop(true);
    };
    const releasedWhilePending = () => {
      if (permissionPending.current) held.current = false;
    };
    const blurred = () => {
      if (held.current) stop(true);
    };
    document.addEventListener("keydown", cancelOnEscape);
    document.addEventListener("visibilitychange", cancelWhenHidden);
    window.addEventListener("pointerup", releasedWhilePending);
    window.addEventListener("blur", blurred);
    return () => {
      document.removeEventListener("keydown", cancelOnEscape);
      document.removeEventListener("visibilitychange", cancelWhenHidden);
      window.removeEventListener("pointerup", releasedWhilePending);
      window.removeEventListener("blur", blurred);
    };
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      held.current = false;
      cancelled.current = true;
      recorder.current?.stop(true);
      cleanup();
      pausePlayback();
    };
  }, []);
  useEffect(() => {
    seen.current = new Set(room?.voices.map((v) => v.id) ?? []);
    queue.current = [];
    pausePlayback();
    setPlaying(null);
    return () => {
      cancelled.current = true;
      held.current = false;
      recorder.current?.stop(true);
      cleanup();
    };
  }, [room?.code]);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(
      () =>
        setSeconds(
          Math.min(
            VOICE_MAX_SECONDS,
            Math.floor((Date.now() - started.current) / 1000),
          ),
        ),
      200,
    );
    return () => clearInterval(t);
  }, [recording]);
  function playNext() {
    pausePlayback();
    const id = queue.current.shift();
    if (!id) {
      setPlaying(null);
      return;
    }
    const a = new Audio(`/api/voice/${id}`);
    audio.current = a;
    setPlaying(id);
    a.onended = playNext;
    a.onerror = () => {
      notify("This voice message could not be played.");
      playNext();
    };
    void a
      .play()
      .then(() => {
        // Uploaded duration is untrusted. Bound actual playback too.
        if (audio.current === a)
          playbackTimer.current = setTimeout(
            playNext,
            (VOICE_MAX_SECONDS + 0.5) * 1000,
          );
      })
      .catch(() => {
        if (audio.current !== a) return;
        setPlaying(null);
        queue.current = [];
        notify("Tap a voice message to allow audio playback.");
      });
  }
  useEffect(() => {
    if (playing && !room?.voices.some((v) => v.id === playing)) {
      pausePlayback();
      setPlaying(null);
    }
    queue.current = queue.current.filter((id) =>
      room?.voices.some((v) => v.id === id),
    );
    for (const v of room?.voices ?? []) {
      if (!seen.current.has(v.id)) {
        seen.current.add(v.id);
        if (auto) queue.current.push(v.id);
      }
    }
    if (auto && !playing && queue.current.length) playNext();
  }, [room?.voices, auto, playing]);
  async function begin() {
    if (permissionPending.current || recorder.current) return;
    if (!room) {
      onOnline();
      return;
    }
    held.current = true;
    cancelled.current = false;
    setPending(true);
    permissionPending.current = true;
    const initialRoom = room.code;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          "Voice recording needs a supported browser on HTTPS or localhost.",
        );
      let wasGranted = microphoneReady.current;
      if (!wasGranted && navigator.permissions?.query)
        try {
          wasGranted =
            (
              await navigator.permissions.query({
                name: "microphone" as PermissionName,
              })
            ).state === "granted";
        } catch {
          /* Safari can request directly without Permissions API support. */
        }
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      microphoneReady.current = true;
      if (!wasGranted) {
        s.getTracks().forEach((t) => t.stop());
        held.current = false;
        if (mounted.current) notify("Microphone ready. Hold again to record.");
        return;
      }
      if (
        !held.current ||
        !mounted.current ||
        roomCode.current !== initialRoom
      ) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime)
        throw new Error(
          "Your browser does not support a compatible recording format.",
        );
      const capture = createVoiceRecording(s, mime);
      recorder.current = capture;
      stream.current = null;
      started.current = capture.startedAt;
      setSeconds(0);
      setRecording(true);
      void capture.finished.then(async (result) => {
        if (recorder.current !== capture) return;
        held.current = false;
        if (mounted.current) {
          setRecording(false);
          setPending(true);
        }
        try {
          if (
            cancelled.current ||
            !mounted.current ||
            roomCode.current !== initialRoom ||
            result.kind === "cancelled"
          )
            return;
          if (result.kind === "error") {
            notify(result.message);
            return;
          }
          const bytes = await result.blob.arrayBuffer();
          if (
            cancelled.current ||
            !mounted.current ||
            roomCode.current !== initialRoom
          )
            return;
          const reply = await send("voice:send", {
            audio: bytes,
            mime: mime.split(";")[0],
            duration: result.duration,
          });
          if (!reply.ok) throw new Error(reply.error);
          notify("Voice message sent to the table.");
        } catch (error) {
          if (mounted.current)
            notify(
              error instanceof Error
                ? error.message
                : "Could not send voice message.",
            );
        } finally {
          if (recorder.current === capture) recorder.current = null;
          if (mounted.current) {
            setPending(false);
            setRecording(false);
          }
        }
      });
    } catch (e) {
      cleanup();
      recorder.current = null;
      held.current = false;
      notify(e instanceof Error ? e.message : "Microphone access was denied.");
    } finally {
      permissionPending.current = false;
      if (mounted.current) setPending(false);
    }
  }
  function togglePlay(id: string) {
    if (playing === id) {
      pausePlayback();
      queue.current = [];
      setPlaying(null);
    } else {
      pausePlayback();
      queue.current = [id];
      playNext();
    }
  }
  useEffect(() => {
    browserStorage.setItem("ludo-voice-auto", auto ? "on" : "off");
  }, [auto]);
  function toggleAuto() {
    setAuto(!auto);
    if (auto) {
      pausePlayback();
      setPlaying(null);
      queue.current = [];
    }
  }
  return {
    recording,
    pending,
    requesting: permissionPending.current,
    seconds,
    auto,
    playing,
    toggleAuto,
    togglePlay,
    begin,
    stop,
    cancelIfHeld: () => {
      if (held.current) stop(true);
    },
  };
}
export type VoiceController = ReturnType<typeof useRoomVoice>;
