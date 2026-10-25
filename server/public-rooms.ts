import type { Room, PublicRoom } from "../shared/protocol.js";

export const PUBLIC_ROOM_PAGE_SIZE = 8;
export function publicRoomPage(
  rooms: Iterable<Room>,
  requestedPage: number,
  pageSize: number,
  blocked: (player: string) => boolean,
) {
  const visible = [...rooms]
    .filter(
      (r) =>
        r.public &&
        !r.archived &&
        !r.game &&
        r.seats.some((s) => !s || s.id.startsWith("bot:")) &&
        r.seats.some((s) => s && !s.id.startsWith("bot:") && s.connected) &&
        !r.seats.some((s) => s && !s.id.startsWith("bot:") && blocked(s.id)),
    )
    .sort((a, b) => b.createdAt - a.createdAt || a.code.localeCompare(b.code));
  const total = visible.length,
    pages = Math.max(1, Math.ceil(total / pageSize)),
    page = Math.min(requestedPage, pages);
  const list: PublicRoom[] = visible
    .slice((page - 1) * pageSize, page * pageSize)
    .map((r) => ({
      code: r.code,
      name: r.name,
      players: r.seats.filter((s) => s && !s.id.startsWith("bot:")).length,
      bots: r.seats.filter((s) => s?.id.startsWith("bot:")).length,
    }));
  return { rooms: list, roomPage: { page, pageSize, total, pages } };
}
