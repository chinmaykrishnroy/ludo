import type { Room } from "../../shared/protocol.js";

/** Socket.IO channel name for a specific guest ID */
export const guestChannel = (id: string) => `guest:${id}`;

/** Human player member IDs in a room (excluding bots and empty seats) */
export const memberIds = (r: Room): string[] =>
  r.seats.flatMap((s) => (s && !s.id.startsWith("bot:") ? [s.id] : []));

/** All participant IDs in a room, including seated human players and spectators */
export const allParticipantIds = (r: Room): string[] => [
  ...new Set([...memberIds(r), ...(r.spectators ?? [])]),
];

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

/** Keep join order independent of seat colours. Older rooms use their saved seat order. */
export function humanJoinOrder(room: Room): string[] {
  const members = memberIds(room);
  return [...new Set([...(room.joinOrder ?? []), ...members])].filter((id) =>
    members.includes(id),
  );
}

export function transferHostAuthority(room: Room): void {
  room.joinOrder = humanJoinOrder(room);
  const online = room.joinOrder.filter((id) =>
    room.seats.some((seat) => seat?.id === id && seat.connected),
  );
  if (!online.includes(room.host))
    room.host =
      online[0] ??
      (room.joinOrder.includes(room.host) ? room.host : room.joinOrder[0]) ??
      room.host;
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
      for (const id of allParticipantIds(old)) {
        if (this.playerRooms.get(id) === room.code) {
          this.playerRooms.delete(id);
        }
      }
    }
    this.rooms.set(room.code, room);
    for (const id of allParticipantIds(room)) {
      this.playerRooms.set(id, room.code);
    }
  }

  erase(code: string): Room | undefined {
    const old = this.rooms.get(code);
    if (old) {
      for (const id of allParticipantIds(old)) {
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
