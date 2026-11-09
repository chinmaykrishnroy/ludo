import { useEffect } from "react";
import type { Game } from "../../../shared/game";
import {
  roll,
  move,
  legalMoves,
  soleLegalMove,
  forcedMoveAt,
} from "../../../shared/game";
import { requestOfflineMove } from "./offlineAi";

interface UseOfflineGameOptions {
  local: Game;
  setLocal: React.Dispatch<React.SetStateAction<Game>>;
  isOnlineRoom: boolean;
  practiceOpen: boolean;
  setup: boolean;
  hasModal: boolean;
  notify: (msg: string) => void;
  randomDice: () => number;
}

export function useOfflineGame({
  local,
  setLocal,
  isOnlineRoom,
  practiceOpen,
  setup,
  hasModal,
  notify,
  randomDice,
}: UseOfflineGameOptions) {
  // Turn deadline expiration
  useEffect(() => {
    if (
      isOnlineRoom ||
      !practiceOpen ||
      setup ||
      hasModal ||
      local.phase === "finished"
    )
      return;
    const timer = setInterval(
      () =>
        setLocal((g) => {
          if (
            g.phase === "finished" ||
            g.seats[g.turn]?.bot ||
            Date.now() < g.deadline
          )
            return g;
          return g.phase === "roll"
            ? roll(g, randomDice())
            : move(g, legalMoves(g)[0]);
        }),
      250,
    );
    return () => clearInterval(timer);
  }, [
    isOnlineRoom,
    practiceOpen,
    setup,
    hasModal,
    local.phase,
    randomDice,
    setLocal,
  ]);

  // Bot turns
  useEffect(() => {
    if (
      isOnlineRoom ||
      setup ||
      hasModal ||
      local.phase === "finished" ||
      !local.seats[local.turn]?.bot
    )
      return;
    const controller = new AbortController(),
      snapshot = local;
    const t = setTimeout(() => {
      if (snapshot.phase === "roll")
        setLocal((g) => (g === snapshot ? roll(g, randomDice()) : g));
      else if (snapshot.phase === "move")
        void requestOfflineMove(snapshot, controller.signal)
          .then((decision) => {
            if (controller.signal.aborted) return;
            setLocal((g) =>
              g === snapshot && legalMoves(g).includes(decision.token)
                ? move(g, decision.token)
                : g,
            );
          })
          .catch((error: unknown) => {
            if ((error as Error)?.name !== "AbortError")
              notify("Bot interrupted. Retrying.");
          });
    }, 1600);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [isOnlineRoom, setup, hasModal, local, notify, randomDice, setLocal]);

  // Forced single legal moves
  useEffect(() => {
    if (
      isOnlineRoom ||
      !practiceOpen ||
      setup ||
      hasModal ||
      local.seats[local.turn]?.bot
    )
      return;
    const token = soleLegalMove(local);
    if (token === undefined) return;
    const snapshot = local,
      timer = setTimeout(
        () =>
          setLocal((game) =>
            game === snapshot && soleLegalMove(game) === token
              ? move(game, token)
              : game,
          ),
        Math.max(0, forcedMoveAt(local) - Date.now()),
      );
    return () => clearTimeout(timer);
  }, [isOnlineRoom, practiceOpen, setup, hasModal, local, setLocal]);
}
