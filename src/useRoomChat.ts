import { useCallback, useEffect, useRef, useState } from "react";
import type { Room, Typing } from "../shared/protocol";

export function useRoomChat(
  room: Room | null,
  me: string,
  idleSeconds: number,
  typingEvent: (Typing & { at: number }) | null,
) {
  const [open, setOpen] = useState(false),
    [unread, setUnread] = useState(0),
    [typing, setTyping] = useState<(Typing & { at: number })[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    opened = useRef(false),
    picking = useRef(false),
    seen = useRef(new Set<string>()),
    idle = useRef(idleSeconds);
  idle.current = idleSeconds;
  const close = useCallback(() => {
    picking.current = false;
    opened.current = false;
    setOpen(false);
    clearTimeout(timer.current);
  }, []);
  const activity = useCallback(() => {
    if (picking.current) return;
    clearTimeout(timer.current);
    if (opened.current) timer.current = setTimeout(close, idle.current * 1000);
  }, [close]);
  const show = useCallback(() => {
    opened.current = true;
    setOpen(true);
    setUnread(0);
    activity();
  }, [activity]);
  const pauseForPicker = useCallback(() => {
    picking.current = true;
    clearTimeout(timer.current);
    if (opened.current) timer.current = setTimeout(close, 120000);
  }, [close]);
  const resumeFromPicker = useCallback(() => {
    picking.current = false;
    activity();
  }, [activity]);
  useEffect(() => {
    close();
    setUnread(0);
    setTyping([]);
    seen.current = new Set(
      [...(room?.chat ?? []), ...(room?.voices ?? [])].map((m) => m.id),
    );
    return () => clearTimeout(timer.current);
  }, [room?.code, close]);
  useEffect(() => {
    const messages = [...(room?.chat ?? []), ...(room?.voices ?? [])],
      fresh = messages.filter((m) => !seen.current.has(m.id));
    seen.current = new Set(messages.map((m) => m.id));
    if (fresh.length && opened.current) activity();
    else if (fresh.length)
      setUnread((n) => n + fresh.filter((m) => m.senderId !== me).length);
  }, [room?.chat, room?.voices, me, activity]);
  useEffect(() => {
    if (
      !typingEvent ||
      typingEvent.room !== room?.code ||
      typingEvent.playerId === me
    )
      return;
    setTyping((list) => [
      ...list.filter((p) => p.playerId !== typingEvent.playerId),
      ...(typingEvent.active ? [typingEvent] : []),
    ]);
    if (typingEvent.active) activity();
  }, [typingEvent, me, room?.code, activity]);
  useEffect(() => {
    if (!typing.length) return;
    const interval = setInterval(
      () => setTyping((list) => list.filter((p) => p.at > Date.now() - 4000)),
      1000,
    );
    return () => clearInterval(interval);
  }, [typing.length]);
  return {
    open,
    unread,
    typing,
    show,
    close,
    activity,
    pauseForPicker,
    resumeFromPicker,
  };
}
export type ChatController = ReturnType<typeof useRoomChat>;
