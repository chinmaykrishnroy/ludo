import type { Game, Seat } from "./game.js";
import type { Mention } from "./chat.js";
export type Typing = {
  room: string;
  playerId: string;
  name: string;
  color: string;
  active: boolean;
};
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
  replyTo?: string;
  mentions?: Mention[];
  gif?: { id: string; width: number; height: number };
  photo?: { id: string; width: number; height: number; mime: "image/jpeg" };
  at: number;
};
export type Room = {
  botDifficulty?: number;
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
  roomPage?: { page: number; pageSize: number; total: number; pages: number };
};
