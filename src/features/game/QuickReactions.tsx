import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Confetti, Circle, ArrowUp, Waves } from "@phosphor-icons/react";
import {
  DEFAULT_REACTION_STYLE,
  REACTIONS,
  REACTION_IDS,
  REACTION_STYLES,
  type ReactionId,
  type ReactionStyle,
} from "../../../shared/effects";

const icons = { pop: Circle, burst: Confetti, float: ArrowUp, ripple: Waves };
const labels = { pop: "Pop", burst: "Burst", float: "Float", ripple: "Ripple" };
type Picker = { reaction: ReactionId; above: boolean; keyboard: boolean };
type Gesture = {
  pointer: number;
  reaction: ReactionId;
  startY: number;
  revealed: boolean;
};

export function QuickReactions({
  wait,
  coolingReaction,
  offline,
  onReact,
}: {
  wait: number;
  coolingReaction?: ReactionId;
  offline: boolean;
  onReact: (reaction: ReactionId, style: ReactionStyle) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const lastTrigger = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const [picker, setPicker] = useState<Picker>();
  const [hovered, setHovered] = useState<ReactionStyle>();
  const locked = wait > 0 || offline;

  function resetGesture() {
    clearTimeout(hold.current);
    gesture.current = null;
    setHovered(undefined);
  }
  function reveal(reaction: ReactionId, keyboard = false) {
    clearTimeout(hold.current);
    if (gesture.current) gesture.current.revealed = true;
    const bottom = group.current?.getBoundingClientRect().bottom ?? 0;
    setPicker({ reaction, above: window.innerHeight - bottom < 85, keyboard });
  }
  function choose(reaction: ReactionId, style: ReactionStyle) {
    setPicker(undefined);
    resetGesture();
    if (!locked) onReact(reaction, style);
  }
  function target(event: PointerEvent<HTMLButtonElement>) {
    const option = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLButtonElement>("button[data-reaction-style]");
    return option && options.current?.contains(option)
      ? (option.dataset.reactionStyle as ReactionStyle)
      : undefined;
  }
  useEffect(() => {
    if (locked) {
      resetGesture();
      setPicker(undefined);
    }
  }, [locked]);
  useEffect(() => {
    if (!picker) return;
    if (picker.keyboard) options.current?.querySelector("button")?.focus();
    const outside = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node &&
        !group.current?.contains(event.target)
      )
        setPicker(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPicker(undefined);
      lastTrigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [picker]);
  useEffect(() => () => clearTimeout(hold.current), []);

  return (
    <div
      ref={group}
      className="reaction-buttons"
      role="group"
      aria-label="Quick reactions"
      aria-describedby={wait > 0 ? "reaction-countdown" : undefined}
    >
      {wait > 0 && (
        <span id="reaction-countdown" className="sr-only">
          Next reaction in {wait} seconds
        </span>
      )}
      {REACTION_IDS.map((id) => (
        <button
          type="button"
          key={id}
          title={
            REACTIONS[id].label + " · Hold, drag down or right-click for styles"
          }
          aria-label={`React: ${REACTIONS[id].label}`}
          aria-expanded={picker?.reaction === id}
          disabled={locked}
          onPointerDown={(event) => {
            if (locked || !event.isPrimary || event.button !== 0) return;
            lastTrigger.current = event.currentTarget;
            resetGesture();
            setPicker(undefined);
            suppressClick.current = false;
            gesture.current = {
              pointer: event.pointerId,
              reaction: id,
              startY: event.clientY,
              revealed: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            hold.current = setTimeout(() => reveal(id), 340);
          }}
          onPointerMove={(event) => {
            const press = gesture.current;
            if (!press || press.pointer !== event.pointerId) return;
            if (!press.revealed && event.clientY - press.startY >= 12)
              reveal(id);
            if (press.revealed) setHovered(target(event));
          }}
          onPointerUp={(event) => {
            const press = gesture.current;
            if (!press || press.pointer !== event.pointerId) return;
            suppressClick.current = press.revealed;
            const style = press.revealed ? target(event) : undefined;
            resetGesture();
            if (style) choose(press.reaction, style);
          }}
          onPointerCancel={() => {
            resetGesture();
            setPicker(undefined);
          }}
          onLostPointerCapture={resetGesture}
          onContextMenu={(event) => {
            event.preventDefault();
            if (event.button !== 2 || locked) return;
            lastTrigger.current = event.currentTarget;
            reveal(id);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            lastTrigger.current = event.currentTarget;
            reveal(id, true);
          }}
          onClick={(event) => {
            if (event.detail && suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            choose(id, DEFAULT_REACTION_STYLE[id]);
          }}
        >
          <span className="reaction-button-emoji" aria-hidden="true">
            {REACTIONS[id].emoji}
          </span>
          {wait > 0 && id === coolingReaction && (
            <span className="reaction-button-time" aria-hidden="true">
              {wait}s
            </span>
          )}
        </button>
      ))}
      {picker && (
        <div
          ref={options}
          className={`reaction-picker ${picker.above ? "reaction-picker-above" : ""}`}
          role="group"
          aria-label={`${REACTIONS[picker.reaction].label} reaction styles`}
        >
          {REACTION_STYLES.map((style) => {
            const Icon = icons[style];
            return (
              <button
                type="button"
                key={style}
                data-reaction-style={style}
                className={
                  hovered === style ? "reaction-picker-hover" : undefined
                }
                onClick={() => choose(picker.reaction, style)}
              >
                <Icon weight="bold" aria-hidden="true" />
                <span>{labels[style]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
