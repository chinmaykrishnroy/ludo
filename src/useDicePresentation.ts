import { useLayoutEffect, useEffect, useRef, useState } from "react";
import { isDiceRoll, type Game } from "../shared/game";
const SPIN_MS = 650,
  RESULT_MS = 360;
type RollView = {
  before: Game;
  result: Game | null;
  started: number;
  revealed: boolean;
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
    const finish = setTimeout(
      () => setView((v) => (v?.started === identity ? null : v)),
      until + RESULT_MS,
    );
    return () => {
      clearTimeout(reveal);
      clearTimeout(finish);
    };
  }, [view?.result, view?.started]);
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
      }),
    active: !!view,
    rolling: !!view && !view.revealed,
    actor: (view?.before ?? game).seats[(view?.before ?? game).turn]!,
    board: view?.before ?? game,
    value: view
      ? view.revealed
        ? (view.result?.dice ?? null)
        : null
      : game.phase === "move"
        ? game.dice
        : null,
    result: view?.revealed ? view.result : null,
  };
}
