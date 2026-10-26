import {
  Microphone,
  Play,
  Pause,
  SpeakerHigh,
  SpeakerSlash,
  Waveform,
  ArrowUpRight,
} from "@phosphor-icons/react";
import type { Room } from "../shared/protocol";
import { PALETTE } from "./Board";
import type { Color } from "../shared/game";
import type { VoiceController } from "./useRoomVoice";
export default function VoicePanel({
  room,
  voice,
  onOnline,
  compact = false,
}: {
  room: Room | null;
  voice: VoiceController;
  onOnline: () => void;
  compact?: boolean;
}) {
  const {
    recording,
    pending,
    seconds,
    auto,
    playing,
    toggleAuto,
    togglePlay,
    begin,
    stop,
    cancelIfHeld,
  } = voice;
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
          onClick={toggleAuto}
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
              aria-label={`${playing === v.id ? "Pause" : "Play"} voice message from ${v.name}`}
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
          cancelIfHeld();
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
          ? voice.requesting
            ? "Waiting for microphone…"
            : "Sending voice…"
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
