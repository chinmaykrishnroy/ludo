import {
  useCallback,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
} from "react";
import { isDiceRoll, type Game } from "../shared/game";
const SPIN_MS = 420,
  RESULT_HOLD_MS = 320;
type RollView = {
  before: Game;
  result: Game | null;
  started: number;
  revealed: boolean;
  landed: boolean;
};
// Presentation can lag authority briefly; it never generates a result or changes a deadline.
export function useDicePresentation(
  game: Game,
  scope: string,
  pending: boolean,
) {
  const previous = useRef({ game, scope }),
    latest = useRef(game);
  latest.current = game;
  const [view, setView] = useState<RollView | null>(null);
  const onSettled = useCallback(
    (value: number) =>
      setView((v) =>
        v?.revealed && v.result?.dice === value && !v.landed
          ? { ...v, landed: true }
          : v,
      ),
    [],
  );
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = { game, scope };
    if (old.scope !== scope || game.revision < old.game.revision) {
      setView(null);
      return;
    }
    if (game.revision === old.game.revision) return;
    if (isDiceRoll(old.game, game))
      setView((current) => ({
        before:
          current?.before.revision === old.game.revision
            ? current.before
            : old.game,
        result: game,
        started:
          current?.before.revision === old.game.revision
            ? current.started
            : performance.now(),
        revealed: false,
        landed: false,
      }));
    else setView(null);
  }, [game, scope]);
  useEffect(() => {
    if (!view?.result) return;
    const identity = view.started,
      until = Math.max(0, SPIN_MS - (performance.now() - view.started), 80);
    const reveal = setTimeout(
      () =>
        setView((v) =>
          v?.started === identity ? { ...v, revealed: true } : v,
        ),
      until,
    );
    return () => {
      clearTimeout(reveal);
    };
  }, [view?.result, view?.started]);
  useEffect(() => {
    if (!view?.landed) return;
    const identity = view.started;
    const timer = setTimeout(
      () => setView((v) => (v?.started === identity ? null : v)),
      RESULT_HOLD_MS,
    );
    return () => clearTimeout(timer);
  }, [view?.landed, view?.started]);
  useEffect(() => {
    if (pending || view?.result || !view) return;
    const timer = setTimeout(
      () =>
        setView((v) =>
          v && !v.result && latest.current.revision === v.before.revision
            ? null
            : v,
        ),
      50,
    );
    return () => clearTimeout(timer);
  }, [pending, view?.started, view?.result]);
  return {
    begin: () =>
      setView({
        before: game,
        result: null,
        started: performance.now(),
        revealed: false,
        landed: false,
      }),
    active: !!view,
    rolling: !!view && !view.revealed,
    settling: !!view?.revealed && !view.landed,
    onSettled,
    actor: (view?.before ?? game).seats[(view?.before ?? game).turn]!,
    // Only the die's actor/timer are held for presentation. A roll does not
    // change token positions, so feeding the previous board back to Token
    // would rewind its revision and replay the preceding movement.
    board: game,
    deadline: (view?.before ?? game).deadline,
    value: view
      ? view.revealed
        ? (view.result?.dice ?? null)
        : null
      : game.phase === "move"
        ? game.dice
        : null,
    result: view?.landed ? view.result : null,
  };
}
