import { useCallback, useEffect, useRef, useState } from "react";
import { isDiceRoll, type Game } from "../shared/game";
import {
  captureHaptic,
  playGameSound,
  type FeedbackKind,
} from "./gameFeedback";
export function useGameFeedback(
  game: Game,
  scope: string,
  active: boolean,
  sound: boolean,
  muted: boolean,
  haptics: boolean,
) {
  const previous = useRef<{ game: Game; scope: string } | undefined>(undefined),
    immediate = useRef<string | null>(null),
    audio = useRef<AudioContext | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const options = useRef({ sound, muted, haptics });
  options.current = { sound, muted, haptics };
  const [busy, setBusy] = useState(false);
  const play = useCallback((kind: FeedbackKind) => {
    if (!options.current.sound || options.current.muted || document.hidden)
      return;
    try {
      playGameSound((audio.current ??= new AudioContext()), kind);
    } catch {
      /* Optional device feedback. */
    }
  }, []);
  const reset = useCallback(() => {
    clearTimeout(timer.current);
    previous.current = undefined;
    immediate.current = null;
    setBusy(false);
  }, []);
  useEffect(() => {
    if (!active) {
      reset();
      return;
    }
    const old = previous.current;
    previous.current = { game, scope };
    if (!old || old.scope !== scope || game.revision < old.game.revision) {
      clearTimeout(timer.current);
      setBusy(false);
      return;
    }
    if (old.game.revision === game.revision) return;
    clearTimeout(timer.current);
    const rolled = isDiceRoll(old.game, game),
      moved =
        !!game.lastMove &&
        old.game.phase === "move" &&
        game.revision === old.game.revision + 1 &&
        old.game.seats.every((s, i) => s?.id === game.seats[i]?.id);
    if (!rolled && !moved) {
      setBusy(false);
      immediate.current = null;
      return;
    }
    setBusy(true);
    if (rolled) {
      if (immediate.current !== `${scope}:${game.revision}`) play("roll");
    } else if (game.lastMove) {
      play(
        game.lastMove.captured > 0
          ? "capture"
          : game.lastMove.to === 56
            ? "finish"
            : "move",
      );
      if (game.lastMove.captured > 0)
        captureHaptic(options.current.haptics, !document.hidden, navigator);
    }
    immediate.current = null;
    timer.current = setTimeout(() => setBusy(false), 1100);
  }, [game, scope, active, play, reset]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      void audio.current?.close();
    },
    [],
  );
  return {
    busy,
    reset,
    beginRoll: () => {
      immediate.current = `${scope}:${game.revision + 1}`;
      play("roll");
    },
  };
}
