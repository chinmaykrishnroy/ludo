import { useEffect, useRef, useState } from "react";
import { MusicNotes, SpeakerSlash, Play, X } from "@phosphor-icons/react";
import {
  REACTIONS,
  DEFAULT_REACTION_STYLE,
  type ReactionStyle,
  type ReactionCue,
  type ReactionId,
  type RoomEffects,
  type SoundCatalog,
} from "../../../shared/effects";
import type { Reply } from "../../../shared/protocol";
import { browserStorage } from "../../store/storage";
import type { TableSoundController } from "./useTableSound";
import { PALETTE } from "./Board";
import { homeOrigin, type BoardRotation } from "./boardOrientation";
import { QuickReactions } from "./QuickReactions";

const SOUND_CATEGORY_KEY = "ludo-soundboard-category";

export function ReactionOverlay({
  cue,
  rotation,
}: {
  cue: ReactionCue;
  rotation: BoardRotation;
}) {
  const meta = REACTIONS[cue.reaction as keyof typeof REACTIONS] as
    { emoji: string; label: string } | undefined;
  const emoji = meta ? meta.emoji : cue.reaction;
  const label = meta ? meta.label : emoji;
  const style =
    cue.style ??
    (meta
      ? DEFAULT_REACTION_STYLE[
          cue.reaction as keyof typeof DEFAULT_REACTION_STYLE
        ]
      : "burst");
  const [x, y] = homeOrigin(cue.actor.color, rotation);
  return (
    <div
      className={`table-reaction reaction-${cue.reaction} reaction-style-${style}`}
      data-reaction-style={style}
      role="status"
      aria-label={`${cue.actor.name}: ${label}`}
    >
      <div
        className="reaction-animation"
        style={
          {
            "--reaction-colour": PALETTE[cue.actor.color],
            "--origin-x": x + "%",
            "--origin-y": y + "%",
            "--travel-x": (50 - x) * 0.48 + "%",
            "--travel-y": (50 - y) * 0.48 + "%",
          } as React.CSSProperties
        }
      >
        {style === "burst" && (
          <div className="reaction-confetti" aria-hidden="true">
            {Array.from({ length: 20 }, (_, index) => (
              <i
                key={index}
                style={
                  {
                    "--particle-angle": index * 18 + "deg",
                    "--particle-colour": Object.values(PALETTE)[index % 4],
                    "--particle-delay": (index % 4) * 0.04 + "s",
                    "--particle-distance": 55 + (index % 5) * 14 + "px",
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        )}
        {style === "ripple" && (
          <div className="reaction-ripples" aria-hidden="true">
            <span className="reaction-ripple ripple-1" />
            <span className="reaction-ripple ripple-2" />
            <span className="reaction-ripple ripple-3" />
          </div>
        )}
        {style === "pop" && (
          <span className="reaction-pop-halo" aria-hidden="true" />
        )}
        <span className="reaction-emoji" aria-hidden="true">
          {emoji}
        </span>
        <strong>{cue.actor.name}</strong>
      </div>
    </div>
  );
}

export function TableEffectsControls({
  room,
  actorId,
  effects,
  now,
  connected,
  muted,
  onReact,
  sound,
  send,
  notify,
}: {
  room?: string;
  actorId?: string;
  effects?: RoomEffects;
  now: number;
  connected: boolean;
  muted: boolean;
  onReact: (id: ReactionId, style: ReactionStyle) => void;
  sound: TableSoundController;
  send: (event: string, payload: unknown) => Promise<Reply>;
  notify: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<SoundCatalog>();
  const [preferredCategory, setPreferredCategory] = useState(
    () => browserStorage.getItem(SOUND_CATEGORY_KEY) ?? "",
  );
  const category =
    catalog?.categories.find((entry) => entry.id === preferredCategory)?.id ??
    catalog?.categories[0]?.id ??
    "";
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const actorReadyAt =
    actorId && effects?.cooldowns
      ? (effects.cooldowns[actorId] ?? 0)
      : (effects?.reactionReadyAt ?? 0);
  const wait = Math.max(0, Math.ceil((actorReadyAt - now) / 1000));
  const waitSound = Math.max(
    0,
    Math.ceil(((effects?.soundReadyAt ?? 0) - now) / 1000),
  );

  useEffect(() => {
    setOpen(false);
    setCatalog(undefined);
    setLoadError("");
    setBusy(false);
    return () => {
      request.current++;
    };
  }, [room]);
  useEffect(() => {
    if (muted) setOpen(false);
  }, [muted]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !panel.current?.contains(target) &&
        !trigger.current?.contains(target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  async function toggle() {
    if (open) return setOpen(false);
    if (!room) return;
    setOpen(true);
    if (busy) return;
    const id = ++request.current;
    setBusy(true);
    setLoadError("");
    const reply = await send("room:sound-catalog", { room });
    if (request.current !== id) return;
    setBusy(false);
    if (!reply.ok || !reply.soundCatalog) {
      setLoadError(reply.error ?? "The soundboard is unavailable.");
      return;
    }
    setCatalog(reply.soundCatalog);
  }
  async function choose(id: string) {
    if (busy || waitSound || muted) return;
    const sequence = ++request.current;
    setBusy(true);
    const result = await send("room:sound", { room, sound: id });
    if (request.current !== sequence) return;
    setBusy(false);
    if (result.code === "SOUND_UNAVAILABLE" && result.soundCatalog) {
      setCatalog(result.soundCatalog);
      return;
    }
    if (!result.ok && result.code !== "EFFECT_BUSY")
      notify(result.error ?? "Could not play this sound.");
  }

  return (
    <>
      <div className="table-effects-row" aria-label="Table effects">
        <QuickReactions
          wait={wait}
          coolingReaction={
            effects?.coolingReaction ?? effects?.reaction?.reaction
          }
          offline={!!room && !connected}
          onReact={onReact}
        />
        {room && (
          <div className="sound-tools">
            <button
              className="effect-tool"
              type="button"
              ref={trigger}
              aria-label="Soundboard"
              aria-expanded={open}
              aria-controls={open ? "table-soundboard" : undefined}
              disabled={!connected || muted}
              onClick={() => void toggle()}
            >
              <MusicNotes weight="bold" />
              <span>Sounds</span>
            </button>
            {sound.playing && (
              <button
                className="effect-tool"
                type="button"
                aria-label="Silence current sound effect"
                title="Silence sound"
                onClick={sound.stop}
              >
                <SpeakerSlash weight="bold" />
              </button>
            )}
            {sound.needsTap && (
              <button
                className="effect-tool"
                type="button"
                aria-label="Play current sound effect"
                onClick={sound.resume}
              >
                <Play weight="fill" />
              </button>
            )}
          </div>
        )}
      </div>
      {open && !muted && (
        <div
          ref={panel}
          className="table-soundboard"
          id="table-soundboard"
          role="region"
          aria-label="Room soundboard"
        >
          <header>
            <strong>Soundboard</strong>
            {waitSound > 0 && (
              <span className="sound-clock" aria-label="Time until next sound">
                {waitSound}s
              </span>
            )}
            <button
              type="button"
              className="effect-tool"
              aria-label="Close soundboard"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus({ preventScroll: true });
              }}
            >
              <X weight="bold" />
            </button>
          </header>
          {catalog?.categories.length ? (
            <>
              <label className="sound-category">
                <span className="sr-only">Sound category</span>
                <select
                  value={category}
                  onChange={(event) => {
                    const choice = event.target.value;
                    setPreferredCategory(choice);
                    browserStorage.setItem(SOUND_CATEGORY_KEY, choice);
                  }}
                >
                  {catalog.categories.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <ul className="sound-list">
                {catalog.clips
                  .filter((clip) => clip.categories.includes(category))
                  .map((clip) => (
                    <li key={clip.id}>
                      <button
                        type="button"
                        aria-label={`Play sound: ${clip.label}`}
                        disabled={busy || waitSound > 0 || !connected}
                        onClick={() => void choose(clip.id)}
                      >
                        <Play weight="fill" /> <span>{clip.label}</span>{" "}
                        <small>{Math.ceil(clip.duration)}s</small>
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <p role="status">
              {loadError ||
                (busy
                  ? "Loading sounds…"
                  : "This server has no sounds installed.")}
            </p>
          )}
        </div>
      )}
    </>
  );
}
