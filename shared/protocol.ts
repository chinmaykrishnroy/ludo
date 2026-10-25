import type { Game, Seat } from "./game.js";
export type Voice = {
  senderId?: string;
  id: string;
  name: string;
  color: string;
  mime: string;
  duration: number;
  at: number;
};
export type Chat = {
  senderId?: string;
  id: string;
  name: string;
  color: string;
  text: string;
  at: number;
};
export type Room = {
  archived?: boolean;
  code: string;
  name: string;
  public: boolean;
  host: string;
  seats: (Seat | null)[];
  game: Game | null;
  voices: Voice[];
  chat: Chat[];
  createdAt: number;
  updatedAt: number;
  lastHumanAt: number;
};
export type PublicRoom = {
  code: string;
  name: string;
  players: number;
  bots: number;
};
export type Reply = {
  code?: string;
  serverNow?: number;
  ok: boolean;
  error?: string;
  room?: Room;
  me?: string;
  rooms?: PublicRoom[];
};
