import { useEffect, useRef, useState } from "react";
import type { Room, Reply, Voice } from "../../../shared/protocol";
import { VOICE_MAX_SECONDS } from "../../../shared/voice";
import { browserStorage } from "../../storage";
import { createVoiceRecording, type VoiceRecording } from "./voiceRecording";
import { VoicePlayback } from "./voicePlayback";
import { RoomAudioMixer } from "./roomAudioMixer";

const clip = (voice: Voice) => ({
  id: voice.id,
  speaker: voice.senderId ?? voice.color,
});

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
    [playing, setPlaying] = useState<string[]>([]),
    [needsPlayback, setNeedsPlayback] = useState(false),
    [muted, setMuted] = useState(
      () => browserStorage.getItem("ludo-room-muted") === "on",
    );
  const [mixer] = useState(() => new RoomAudioMixer());
  const playback = useRef<VoicePlayback | null>(null);
  if (!playback.current)
    playback.current = new VoicePlayback(
      (ids, blocked) => {
        mixer.voiceActivity(ids.length > 0);
        setPlaying(ids);
        setNeedsPlayback(blocked);
      },
      () => notify("This voice message could not be played."),
      undefined,
      (audio) => mixer.prepareVoice(audio),
    );

  const recorder = useRef<VoiceRecording | null>(null),
    held = useRef(false),
    mounted = useRef(true),
    cancelled = useRef(false),
    seen = useRef(new Set<string>()),
    microphoneReady = useRef(false),
    permissionPending = useRef(false),
    roomCode = useRef(room?.code);
  roomCode.current = room?.code;

  function stop(cancel = false) {
    held.current = false;
    cancelled.current ||= cancel;
    if (recorder.current) {
      recorder.current.stop(cancel);
      setRecording(false);
      setPending(true);
    }
  }

  useEffect(() => {
    mounted.current = true;
    const cancel = () => {
      if (held.current) stop(true);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && held.current) {
        event.preventDefault();
        cancel();
      }
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", cancel);
    return () => {
      mounted.current = false;
      held.current = false;
      cancelled.current = true;
      recorder.current?.stop(true);
      playback.current!.clear();
      mixer.close();
      document.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", cancel);
    };
  }, [mixer]);

  useEffect(() => {
    seen.current = new Set(room?.voices.map((voice) => voice.id) ?? []);
    playback.current!.clear();
    return () => {
      cancelled.current = true;
      held.current = false;
      recorder.current?.stop(true);
    };
  }, [room?.code]);

  useEffect(() => {
    if (!room?.code || muted || !auto) return;
    // Some mobile browsers only allow audio elements started from a user gesture.
    const unlock = () => {
      mixer.unlock();
      playback.current!.resume();
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
    document.addEventListener("click", unlock, true);
    document.addEventListener("keydown", unlock, true);
    return () => {
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
  }, [room?.code, muted, auto, mixer]);
  useEffect(() => {
    if (!room?.code || muted) return;
    const unlock = () => mixer.unlock();
    document.addEventListener("click", unlock, true);
    document.addEventListener("keydown", unlock, true);
    const restore = () => {
      if (!document.hidden) mixer.resume();
    };
    document.addEventListener("visibilitychange", restore);
    return () => {
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("keydown", unlock, true);
      document.removeEventListener("visibilitychange", restore);
    };
  }, [room?.code, muted, mixer]);

  useEffect(() => {
    const capture = recorder.current;
    if (!recording || !capture) return;
    const timer = setInterval(
      () =>
        setSeconds(
          Math.min(
            VOICE_MAX_SECONDS,
            Math.floor((Date.now() - capture.startedAt) / 1000),
          ),
        ),
      200,
    );
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    const voices = room?.voices ?? [];
    playback.current!.available(new Set(voices.map((voice) => voice.id)));
    const fresh = voices.filter((voice) => !seen.current.has(voice.id));
    seen.current = new Set(voices.map((voice) => voice.id));
    if (auto && !muted) playback.current!.enqueue(fresh.map(clip));
    if (muted)
      for (const voice of fresh) if (voice.senderId !== me) onMutedVoice(voice);
  }, [room?.voices, auto, muted, me, onMutedVoice]);

  async function begin() {
    if (permissionPending.current || recorder.current) return;
    if (!room) {
      onOnline();
      return;
    }
    if (!muted) mixer.unlock();
    playback.current!.resume();
    held.current = true;
    cancelled.current = false;
    setPending(true);
    permissionPending.current = true;
    const initialRoom = room.code;
    const stillHere = () =>
      mounted.current && roomCode.current === initialRoom && !cancelled.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          "Voice recording needs a supported browser on HTTPS or localhost.",
        );
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((format) => MediaRecorder.isTypeSupported(format));
      if (!mime)
        throw new Error(
          "Your browser does not support a compatible recording format.",
        );
      let wasGranted = microphoneReady.current;
      if (!wasGranted && navigator.permissions?.query) {
        try {
          wasGranted =
            (
              await navigator.permissions.query({
                name: "microphone" as PermissionName,
              })
            ).state === "granted";
        } catch {
          /* Safari can request directly without the Permissions API. */
        }
      }
      if (!stillHere()) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      microphoneReady.current = true;
      if (!wasGranted || !held.current || !stillHere()) {
        stream.getTracks().forEach((track) => track.stop());
        held.current = false;
        if (!wasGranted && stillHere())
          notify("Microphone ready. Hold again to record.");
        return;
      }
      const capture = createVoiceRecording(stream, mime);
      recorder.current = capture;
      setSeconds(0);
      setRecording(true);
      void capture.finished.then(async (result) => {
        held.current = false;
        if (mounted.current) {
          setRecording(false);
          setPending(true);
        }
        try {
          if (!stillHere() || result.kind === "cancelled") return;
          if (result.kind === "error") {
            notify(result.message);
            return;
          }
          const audio = await result.blob.arrayBuffer();
          if (!stillHere()) return;
          const reply = await send("voice:send", {
            room: initialRoom,
            audio,
            mime: mime.split(";")[0],
            duration: result.duration,
          });
          if (!reply.ok) throw new Error(reply.error);
        } catch (error) {
          if (stillHere())
            notify(
              error instanceof Error
                ? error.message
                : "Could not send voice message.",
            );
        } finally {
          recorder.current = null;
          if (mounted.current) setPending(false);
        }
      });
    } catch (error) {
      if (stillHere())
        notify(
          error instanceof Error
            ? error.message
            : "Microphone access was denied.",
        );
      held.current = false;
    } finally {
      permissionPending.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function togglePlay(id: string) {
    const message = room?.voices.find((voice) => voice.id === id);
    if (message) playback.current!.toggle(clip(message));
  }
  function toggleAuto() {
    if (auto) playback.current!.clear();
    setAuto(!auto);
  }
  useEffect(() => {
    browserStorage.setItem("ludo-voice-auto", auto ? "on" : "off");
  }, [auto]);
  useEffect(() => {
    playback.current!.setMuted(muted);
    browserStorage.setItem("ludo-room-muted", muted ? "on" : "off");
  }, [muted]);
  function setSpeakerMuted(next: boolean) {
    playback.current!.setMuted(next);
    setMuted(next);
  }
  return {
    mixer,
    recording,
    pending:
      !recording &&
      (pending || permissionPending.current || !!recorder.current),
    requesting: permissionPending.current,
    seconds,
    auto,
    playing,
    muted,
    needsPlayback,
    toggleMuted: () => {
      setSpeakerMuted(!muted);
      if (muted) playback.current!.resume();
    },
    unmuteAndPlay: (id: string) => {
      setSpeakerMuted(false);
      togglePlay(id);
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
