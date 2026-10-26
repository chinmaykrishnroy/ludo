import { useEffect, useRef, useState } from "react";
import type { Room, Reply, Voice } from "../shared/protocol";
import { VOICE_MAX_SECONDS } from "../shared/voice";
import { browserStorage } from "./storage";
import { createVoiceRecording, type VoiceRecording } from "./voiceRecording";
import { VoicePlayback } from "./voicePlayback";
export function useRoomVoice({
  room,
  send,
  notify,
  onOnline,
  me,
  onMutedVoice,
}: {
  room: Room | null;
  send: (event: string, data: unknown) => Promise<Reply>;
  notify: (text: string) => void;
  onOnline: () => void;
  me: string;
  onMutedVoice: (voice: Voice) => void;
}) {
  const [recording, setRecording] = useState(false),
    [pending, setPending] = useState(false),
    [seconds, setSeconds] = useState(0),
    [auto, setAuto] = useState(
      () => browserStorage.getItem("ludo-voice-auto") !== "off",
    ),
    [playing, setPlaying] = useState<string | null>(null),
    [needsPlayback, setNeedsPlayback] = useState(false),
    [muted, setMuted] = useState(
      () => browserStorage.getItem("ludo-room-muted") === "on",
    );
  const playback = useRef<VoicePlayback | null>(null);
  if (!playback.current)
    playback.current = new VoicePlayback(
      (id, blocked) => {
        setPlaying(id);
        setNeedsPlayback(blocked);
      },
      () => notify("This voice message could not be played."),
    );
  const recorder = useRef<VoiceRecording | null>(null),
    held = useRef(false),
    mounted = useRef(true),
    stream = useRef<MediaStream | null>(null),
    started = useRef(0),
    cancelled = useRef(false),
    seen = useRef(new Set<string>());
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
    playback.current!.clear();
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
  useEffect(() => {
    playback.current!.available(new Set(room?.voices.map((v) => v.id) ?? []));
    const fresh: string[] = [];
    for (const v of room?.voices ?? []) {
      if (!seen.current.has(v.id)) {
        seen.current.add(v.id);
        if (auto && !muted) fresh.push(v.id);
        if (muted && v.senderId !== me) onMutedVoice(v);
      }
    }
    playback.current!.enqueue(fresh);
  }, [room?.voices, auto, muted]);
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
    playback.current!.toggle(id);
  }
  useEffect(() => {
    browserStorage.setItem("ludo-voice-auto", auto ? "on" : "off");
  }, [auto]);
  function toggleAuto() {
    setAuto(!auto);
    if (auto) {
      pausePlayback();
      setPlaying(null);
    }
  }
  useEffect(() => {
    playback.current!.setMuted(muted);
    browserStorage.setItem("ludo-room-muted", muted ? "on" : "off");
  }, [muted]);
  function toggleMuted() {
    const next = !muted;
    playback.current!.setMuted(next);
    setMuted(next);
    if (!next) playback.current!.resume();
  }
  return {
    recording,
    pending,
    requesting: permissionPending.current,
    seconds,
    auto,
    playing,
    muted,
    needsPlayback,
    toggleMuted,
    unmuteAndPlay: (id: string) => {
      playback.current!.setMuted(false);
      setMuted(false);
      playback.current!.toggle(id);
    },
    resumePlayback: () => playback.current!.resume(),
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
