import type { Room } from "../../shared/protocol.js";
import { legalMoves, type Game } from "../../shared/game.js";
import { PublicError } from "../security.js";

/** Validates player turn authority and action legality on the server */
export function validateGameAction(
  room: Room,
  playerId: string,
  expectedRevision: number,
  action: { type: "roll" } | { type: "move"; token: number },
): { game: Game; seatIndex: number } {
  const game = room.game;
  if (!game) {
    throw new PublicError("No active game in this room", "NO_GAME");
  }

  if (game.phase === "finished") {
    throw new PublicError("Game has already ended", "GAME_FINISHED");
  }

  const currentSeat = game.seats[game.turn];
  if (!currentSeat || currentSeat.id !== playerId) {
    throw new PublicError("It is not your turn to act", "WRONG_TURN");
  }

  if (currentSeat.bot) {
    throw new PublicError("Cannot play a move for a bot player", "BOT_CONTROL");
  }

  if (game.revision !== expectedRevision) {
    throw new PublicError(
      "Game state has advanced. Please refresh to latest state.",
      "STALE_REVISION",
    );
  }

  if (action.type === "roll") {
    if (game.phase !== "roll") {
      throw new PublicError(
        "Dice roll not expected in current phase",
        "INVALID_PHASE",
      );
    }
  } else if (action.type === "move") {
    if (game.phase !== "move") {
      throw new PublicError(
        "Token move not expected in current phase",
        "INVALID_PHASE",
      );
    }
    const legal = legalMoves(game);
    if (!legal.includes(action.token)) {
      throw new PublicError("Chosen token move is not legal", "ILLEGAL_MOVE");
    }
  }

  return { game, seatIndex: game.turn };
}
