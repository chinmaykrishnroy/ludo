import { useCallback, useEffect, useRef, useState } from "react";
import type { Chat, Room, Typing } from "../../../shared/protocol";

export function useRoomChat(
  room: Room | null,
  me: string,
  idleSeconds: number,
  typingEvent: (Typing & { at: number }) | null,
) {
  const [open, setOpen] = useState(false),
    [unread, setUnread] = useState(0),
    [previews, setPreviews] = useState<Chat[]>([]),
    [typing, setTyping] = useState<(Typing & { at: number })[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    opened = useRef(false),
    picking = useRef(false),
    previewTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>()),
    seen = useRef(new Set<string>()),
    idle = useRef(idleSeconds);
  idle.current = idleSeconds;
  const clearPreviews = useCallback(() => {
    for (const timer of previewTimers.current.values()) clearTimeout(timer);
    previewTimers.current.clear();
    setPreviews([]);
  }, []);
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
    clearPreviews();
    activity();
  }, [activity, clearPreviews]);
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
    clearPreviews();
    seen.current = new Set(
      [...(room?.chat ?? []), ...(room?.voices ?? [])].map((m) => m.id),
    );
    return () => {
      clearTimeout(timer.current);
      for (const preview of previewTimers.current.values())
        clearTimeout(preview);
      previewTimers.current.clear();
    };
  }, [room?.code, close, clearPreviews]);
  useEffect(() => {
    const messages = [...(room?.chat ?? []), ...(room?.voices ?? [])],
      fresh = messages.filter((m) => !seen.current.has(m.id)),
      freshText = (room?.chat ?? []).filter(
        (m) => !seen.current.has(m.id) && m.senderId !== me,
      );
    seen.current = new Set(messages.map((m) => m.id));
    if (fresh.length && opened.current) activity();
    else if (fresh.length)
      setUnread((n) => n + fresh.filter((m) => m.senderId !== me).length);
    if (!opened.current && freshText.length) {
      setPreviews((current) => [...current, ...freshText].slice(-3));
      for (const message of freshText) {
        previewTimers.current.set(
          message.id,
          setTimeout(() => {
            previewTimers.current.delete(message.id);
            setPreviews((current) =>
              current.filter((m) => m.id !== message.id),
            );
          }, 3000),
        );
      }
    }
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
    previews,
    typing,
    show,
    close,
    activity,
    pauseForPicker,
    resumeFromPicker,
  };
}
export type ChatController = ReturnType<typeof useRoomChat>;
