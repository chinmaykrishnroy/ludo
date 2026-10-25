import { useEffect, useRef, useState } from "react";
import {
  Microphone,
  Play,
  Pause,
  SpeakerHigh,
  SpeakerSlash,
  Waveform,
  ArrowUpRight,
} from "@phosphor-icons/react";
import type { Room, Reply } from "../shared/protocol";
import { PALETTE } from "./Board";
import type { Color } from "../shared/game";
import { VOICE_MAX_SECONDS, VOICE_MAX_BYTES } from "../shared/voice";
export default function VoicePanel({
  room,
  send,
  notify,
  onOnline,
  compact = false,
}: {
  room: Room | null;
  send: (event: string, data: unknown) => Promise<Reply>;
  notify: (s: string) => void;
  onOnline: () => void;
  compact?: boolean;
}) {
  const [recording, setRecording] = useState(false),
    [pending, setPending] = useState(false),
    [seconds, setSeconds] = useState(0),
    [auto, setAuto] = useState(true),
    [playing, setPlaying] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null),
    held = useRef(false),
    mounted = useRef(true),
    stream = useRef<MediaStream | null>(null),
    started = useRef(0),
    audio = useRef<HTMLAudioElement | null>(null),
    cancelled = useRef(false),
    stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    playbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    seen = useRef(new Set<string>()),
    queue = useRef<string[]>([]);
  const microphoneReady = useRef(false),
    permissionPending = useRef(false);
  const roomCode = useRef(room?.code);
  roomCode.current = room?.code;
  function cleanup() {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }
  function stop(cancel = false) {
    held.current = false;
    cancelled.current = cancel;
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
    cleanup();
    setRecording(false);
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
      if (event.key === "Escape" && held.current) stop(true);
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
      if (recorder.current?.state === "recording") recorder.current.stop();
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
      if (recorder.current?.state === "recording") recorder.current.stop();
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
    if (permissionPending.current || recording) return;
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
      const r = new MediaRecorder(s, {
          mimeType: mime,
          audioBitsPerSecond: 32000,
        }),
        chunks: BlobPart[] = [];
      let size = 0;
      recorder.current = r;
      r.ondataavailable = (e) => {
        size += e.data.size;
        chunks.push(e.data);
        if (size > VOICE_MAX_BYTES) stop(true);
      };
      r.onerror = () => {
        stop(true);
        notify("Recording interrupted. Please try again.");
      };
      r.onstop = async () => {
        cleanup();
        const duration = Math.min(
          VOICE_MAX_SECONDS,
          (Date.now() - started.current) / 1000,
        );
        if (
          cancelled.current ||
          !mounted.current ||
          roomCode.current !== initialRoom
        )
          return;
        if (duration < 0.2) {
          notify("Hold a little longer to record a message.");
          return;
        }
        try {
          const blob = new Blob(chunks, { type: mime });
          if (blob.size > VOICE_MAX_BYTES)
            throw new Error("Message is too large. Try a shorter recording.");
          const result = await send("voice:send", {
            audio: await blob.arrayBuffer(),
            mime: mime.split(";")[0],
            duration,
          });
          if (!result.ok) throw new Error(result.error);
          notify("Voice message sent to the table.");
        } catch (e) {
          notify(
            e instanceof Error ? e.message : "Could not send voice message.",
          );
        }
      };
      started.current = Date.now();
      setSeconds(0);
      r.start(250);
      setRecording(true);
      stopTimer.current = setTimeout(() => stop(), VOICE_MAX_SECONDS * 1000);
    } catch (e) {
      cleanup();
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
  return (
    <section className={`voice-section ${compact ? "compact-voice" : ""}`}>
      <div className="section-title">
        <h3>
          Table talk <span>VOICE MESSAGES</span>
        </h3>
        <button
          className="icon-button"
          aria-label={
            auto
              ? "Disable automatic voice playback"
              : "Enable automatic voice playback"
          }
          aria-pressed={auto}
          onClick={() => {
            setAuto(!auto);
            if (auto) {
              pausePlayback();
              setPlaying(null);
              queue.current = [];
            }
          }}
        >
          {auto ? <SpeakerHigh /> : <SpeakerSlash />}
        </button>
      </div>
      <div className="voice-feed">
        {room?.voices.length ? (
          room.voices.slice(-4).map((v) => (
            <button
              key={v.id}
              className="voice-message"
              onClick={() => togglePlay(v.id)}
            >
              <span
                className="voice-avatar"
                style={{ background: PALETTE[v.color as Color] }}
              >
                {v.name[0]}
              </span>
              <span className="voice-message-main">
                <strong>{v.name}</strong>
                <span className="wave-bars">
                  {Array.from({ length: 24 }, (_, i) => (
                    <i key={i} style={{ height: `${5 + ((i * 7) % 17)}px` }} />
                  ))}
                </span>
              </span>
              {playing === v.id ? (
                <Pause weight="fill" />
              ) : (
                <Play weight="fill" />
              )}
              <small>{Math.ceil(v.duration)}s</small>
            </button>
          ))
        ) : (
          <div className="voice-empty">
            <Waveform size={30} weight="light" />
            <strong>Good moves. Better banter.</strong>
            <p>
              {room
                ? "Hold the mic to say something to everyone at the table."
                : "Bring your friends to the table and make yourself heard."}
            </p>
            {!room && (
              <button className="text-button" onClick={onOnline}>
                Start an online room <ArrowUpRight />
              </button>
            )}
          </div>
        )}
      </div>
      <button
        className={`record-button ${recording ? "is-recording" : ""}`}
        aria-label="Hold to record a voice message"
        aria-disabled={pending}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          void begin();
        }}
        onPointerUp={() => stop()}
        onPointerCancel={() => stop(true)}
        onLostPointerCapture={() => {
          if (held.current) stop(true);
        }}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            void begin();
          }
          if (e.key === "Escape") stop(true);
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            stop();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Microphone weight={recording ? "fill" : "bold"} />
        {pending
          ? "Waiting for microphone…"
          : recording
            ? `Recording · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} / 1:00`
            : "HOLD TO SPEAK"}
        {recording && <span className="record-dot" />}
      </button>
      <p className="record-hint">
        {recording
          ? "Release to send · Escape to cancel"
          : "Release to send to everyone · Up to 60 sec"}
      </p>
    </section>
  );
}
