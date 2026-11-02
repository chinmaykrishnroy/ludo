import type { Color, Game, Seat } from "../game.js";
import type { Chat, Room, Voice } from "../protocol.js";

/** Canonical representation of a seated player */
export interface PlayerState {
  id: string;
  name: string;
  color: Color;
  bot: boolean;
  connected: boolean;
  tokens: number[];
  botDifficulty?: number;
}

/** Canonical representation of an active game turn */
export interface TurnState {
  seatIndex: number;
  player: PlayerState | null;
  phase: "roll" | "move" | "finished";
  dice: number | null;
  sixes: number;
  deadline: number;
}

/** Canonical representation of legal move calculation */
export interface LegalMove {
  token: number;
  from: number;
  to: number;
  captured: number;
}

/** Outcome of rolling a die */
export interface DiceOutcome {
  value: number;
  isSix: boolean;
  sixCount: number;
  hasLegalMoves: boolean;
  legalTokens: number[];
}

/** Canonical game state */
export type GameState = Game;

/** Canonical room state */
export type RoomState = Room;

/** Re-export base types for convenience */
export type { Color, Game, Seat, Room, Chat, Voice };
