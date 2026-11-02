import type { Room } from "../../shared/protocol.js";

/** Socket.IO channel name for a specific guest ID */
export const guestChannel = (id: string) => `guest:${id}`;

/** Human player member IDs in a room (excluding bots and empty seats) */
export const memberIds = (r: Room): string[] =>
  r.seats.flatMap((s) => (s && !s.id.startsWith("bot:") ? [s.id] : []));

/** Generates a tailored room view for a specific member, respecting muted/blocked voices and chats */
export function createRoomView(
  room: Room,
  memberId: string,
  blocked: Set<string> = new Set(),
  actionReadyAt = 0,
): Room {
  return {
    ...room,
    actionReadyAt,
    voices: room.voices.filter((v) =>
      v.senderId ? !blocked.has(v.senderId) : blocked.size === 0,
    ),
    chat: room.chat.filter((v) =>
      v.senderId ? !blocked.has(v.senderId) : blocked.size === 0,
    ),
  };
}

/** Transfers room host authority to the first connected human player if the current host is missing/disconnected */
export function transferHostAuthority(room: Room): void {
  if (!room.seats.some((s) => s?.id === room.host && !s.bot && s.connected)) {
    const host = room.seats.find((s) => s && !s.bot && s.connected);
    if (host) room.host = host.id;
  }
}

/** Room state manager that tracks active rooms and player-to-room mappings */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly playerRooms = new Map<string, string>();

  constructor(initialRooms: Room[] = []) {
    for (const room of initialRooms) {
      this.index(room);
    }
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  has(code: string): boolean {
    return this.rooms.has(code);
  }

  activeRoomFor(playerId: string): Room | undefined {
    const code = this.playerRooms.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  index(room: Room): void {
    const old = this.rooms.get(room.code);
    if (old) {
      for (const id of memberIds(old)) {
        if (this.playerRooms.get(id) === room.code) {
          this.playerRooms.delete(id);
        }
      }
    }
    this.rooms.set(room.code, room);
    for (const id of memberIds(room)) {
      this.playerRooms.set(id, room.code);
    }
  }

  erase(code: string): Room | undefined {
    const old = this.rooms.get(code);
    if (old) {
      for (const id of memberIds(old)) {
        if (this.playerRooms.get(id) === code) {
          this.playerRooms.delete(id);
        }
      }
    }
    this.rooms.delete(code);
    return old;
  }

  values(): IterableIterator<Room> {
    return this.rooms.values();
  }

  get size(): number {
    return this.rooms.size;
  }
}
