import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Room, Reply, Typing } from "../../../shared/protocol";
import type { RoomEffects } from "../../../shared/effects";
import { reportUnexpected } from "../../lib";

interface UseRoomSessionOptions {
  notify: (msg: string) => void;
  onClearRoomModal?: () => void;
  onBotDifficultyConfig?: (difficulty: number) => void;
  onGameActive?: (hasGame: boolean) => void;
}

export function useRoomSession({
  notify,
  onClearRoomModal,
  onBotDifficultyConfig,
  onGameActive,
}: UseRoomSessionOptions) {
  const socket = useRef<Socket | null>(null);
  const activeRoomCode = useRef<string | undefined>(undefined);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomEffects, setRoomEffects] = useState<RoomEffects>();
  const [typingEvent, setTypingEvent] = useState<
    (Typing & { at: number }) | null
  >(null);
  const [me, setMe] = useState("");
  const [connected, setConnected] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [publicRoomsEnabled, setPublicRoomsEnabled] = useState(false);
  const [chatIdleSeconds, setChatIdleSeconds] = useState(10);

  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const onClearRoomModalRef = useRef(onClearRoomModal);
  onClearRoomModalRef.current = onClearRoomModal;
  const onBotDifficultyConfigRef = useRef(onBotDifficultyConfig);
  onBotDifficultyConfigRef.current = onBotDifficultyConfig;
  const onGameActiveRef = useRef(onGameActive);
  onGameActiveRef.current = onGameActive;

  const clearRoom = useCallback((code?: string) => {
    if (code && activeRoomCode.current !== code) return false;
    activeRoomCode.current = undefined;
    setRoom(null);
    setRoomEffects(undefined);
    setTypingEvent(null);
    onGameActiveRef.current?.(false);
    onClearRoomModalRef.current?.();
    return true;
  }, []);

  const send = useCallback(
    async (event: string, data: unknown): Promise<Reply> => {
      const s = socket.current;
      if (!s?.connected)
        return {
          ok: false,
          error: "The server is reconnecting. Please try again shortly.",
        };
      try {
        const reply = (await s.timeout(8000).emitWithAck(event, data)) as Reply;
        if (!reply.ok && reply.code === "STORAGE_UNAVAILABLE")
          reportUnexpected("SERVER_ERROR");
        return reply;
      } catch {
        return {
          ok: false,
          error:
            "Connection interrupted. The room will sync when you reconnect.",
        };
      }
    },
    [],
  );

  useEffect(() => {
    let disposed = false,
      s: Socket | undefined,
      pending = false,
      attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let clockTimer: ReturnType<typeof setInterval> | undefined;

    const syncClock = async () => {
      if (!s?.connected) return;
      const connection = s;
      const currentCode = activeRoomCode.current;
      const sent = Date.now();
      try {
        const reply = (await connection
          .timeout(3000)
          .emitWithAck("clock:sync", { room: currentCode })) as Reply;
        if (disposed || connection !== s || !reply.ok) return;
        if (typeof reply.serverNow === "number")
          setClockOffset(reply.serverNow - (sent + Date.now()) / 2);
        if (currentCode && reply.roomMissing && clearRoom(currentCode))
          notifyRef.current("This room is no longer available.");
      } catch {
        /* Next heartbeat retries. */
      }
    };

    const resume = () => {
      if (document.visibilityState === "visible") void syncClock();
    };

    const connect = () => {
      if (disposed || pending) return;
      if (s) {
        s.connect();
        return;
      }
      pending = true;
      attempts++;
      void fetch("/api/session")
        .then((r) => {
          if (!r.ok) throw new Error("Server unavailable");
          if (disposed) return;
          s = io({ autoConnect: false, reconnection: true });
          socket.current = s;
          s.on("connect", () => {
            setConnected(true);
            void syncClock();
            if (clockTimer) clearInterval(clockTimer);
            clockTimer = setInterval(() => void syncClock(), 30000);
          });
          s.on("disconnect", () => {
            setConnected(false);
            if (clockTimer) clearInterval(clockTimer);
          });
          const renew = () => {
            s?.disconnect();
            s?.removeAllListeners();
            s = undefined;
            socket.current = null;
            clearRoom();
            if (retry) clearTimeout(retry);
            retry = setTimeout(connect, 250);
          };
          s.on(
            "connect_error",
            (error: Error & { data?: { code?: string } }) => {
              setConnected(false);
              if (error.data?.code === "SESSION_EXPIRED") renew();
              else if (error.data?.code === "STORAGE_UNAVAILABLE") {
                reportUnexpected("SERVER_ERROR");
                if (retry) clearTimeout(retry);
                retry = setTimeout(connect, 5000);
              }
            },
          );
          s.on("session:expired", () => {
            notifyRef.current(
              "Your guest session expired. Reconnecting as a new guest.",
            );
            renew();
          });
          s.on("session:blocked", () => {
            notifyRef.current("Online access is blocked for this guest.");
            clearRoom();
            s?.disconnect();
            if (retry) clearTimeout(retry);
          });
          s.on("server:unavailable", (value?: { message?: string }) => {
            reportUnexpected("SERVER_ERROR");
            notifyRef.current(
              value?.message ??
                "Saved game is temporarily unavailable. Reconnecting shortly.",
            );
            if (retry) clearTimeout(retry);
            retry = setTimeout(connect, 5000);
          });
          s.on(
            "session",
            ({ me, serverNow }: { me: string; serverNow: number }) => {
              setMe(me);
              if (typeof serverNow === "number")
                setClockOffset(serverNow - Date.now());
            },
          );
          s.on("room:state", (r: Room) => {
            activeRoomCode.current = r.code;
            setRoom(r);
            setRoomEffects(r.effects);
            onGameActiveRef.current?.(Boolean(r.game));
          });
          s.on("room:effects", (state: RoomEffects) => {
            if (state?.room === activeRoomCode.current) setRoomEffects(state);
          });
          s.on("chat:typing", (event: Typing) =>
            setTypingEvent({ ...event, at: Date.now() }),
          );
          s.on("room:closed", (event: { code: string }) => {
            if (event?.code && clearRoom(event.code))
              notifyRef.current("This room expired.");
          });
          s.on("room:left", (event: { code: string; closed?: boolean }) => {
            if (event?.code && clearRoom(event.code) && event.closed)
              notifyRef.current(
                "This room closed because fewer than two players remained.",
              );
          });
          s.connect();
        })
        .catch(() => {
          if (navigator.onLine && attempts === 1)
            notifyRef.current(
              "Online play is unavailable. Offline play is ready.",
            );
          if (!disposed) retry = setTimeout(connect, 5000);
        })
        .finally(() => {
          pending = false;
        });
    };

    connect();
    window.addEventListener("online", connect);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      if (clockTimer) clearInterval(clockTimer);
      window.removeEventListener("online", connect);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
      s?.disconnect();
    };
  }, [clearRoom]);

  useEffect(() => {
    if (connected)
      void fetch("/api/config")
        .then((r) => r.json())
        .then((c) => {
          setPublicRoomsEnabled(c.publicRoomsEnabled === true);
          if (
            Number.isInteger(c.chatIdleSeconds) &&
            c.chatIdleSeconds >= 1 &&
            c.chatIdleSeconds <= 300
          )
            setChatIdleSeconds(c.chatIdleSeconds);
          if (
            Number.isInteger(c.defaultBotDifficulty) &&
            c.defaultBotDifficulty >= 0 &&
            c.defaultBotDifficulty <= 10
          ) {
            onBotDifficultyConfigRef.current?.(c.defaultBotDifficulty);
          }
        })
        .catch(() => {});
  }, [connected]);

  return {
    socket,
    activeRoomCode,
    room,
    setRoom,
    roomEffects,
    typingEvent,
    me,
    connected,
    clockOffset,
    publicRoomsEnabled,
    chatIdleSeconds,
    send,
    clearRoom,
  };
}
