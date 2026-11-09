import React, { useCallback, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  DotsSixVertical,
  Eye,
  GlobeHemisphereWest,
  LockSimple,
  Play,
  Plus,
  SignOut,
  X,
} from "@phosphor-icons/react";
import type { Reply, Room } from "../../../shared/protocol";
import { COLORS } from "../../../shared/game";
import { PALETTE } from "../game/Board";
import { BotDifficulty } from "./BotDifficulty";
import { VoicePanel } from "../voice";
import { ChatPreviews } from "../chat/ChatPreviews";
import type { VoiceController } from "../voice/useRoomVoice";
import type { ChatController } from "../chat/useRoomChat";

interface RoomLobbyProps {
  room: Room;
  me: string;
  name: string;
  host: boolean;
  isSpectator: boolean;
  humans: number;
  finished: boolean;
  connected: boolean;
  admission?: { newRoomsAvailable?: boolean };
  chat: ChatController;
  voice: VoiceController;
  copied: boolean;
  copyInvite: () => void;
  botDifficulty: number;
  send: (event: string, data: unknown) => Promise<Reply>;
  notify: (msg: string) => void;
  onOpenLeave: () => void;
  onOpenRooms: () => void;
  onStartGame: () => void;
}

export function RoomLobby({
  room,
  me,
  name,
  host,
  isSpectator,
  humans,
  finished,
  connected,
  admission,
  chat,
  voice,
  copied,
  copyInvite,
  botDifficulty,
  send,
  notify,
  onOpenLeave,
  onOpenRooms,
  onStartGame,
}: RoomLobbyProps) {
  const [pointerDrag, setPointerDrag] = useState<{
    fromIndex: number;
    targetIndex: number;
    offsetY: number;
    cardHeight: number;
  } | null>(null);

  const pointerDragRef = useRef<{
    fromIndex: number;
    startY: number;
    cardHeight: number;
    pointerId: number;
  } | null>(null);

  const handleSwapSeats = useCallback(
    async (fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx || toIdx < 0 || toIdx >= COLORS.length) return;
      const player = room?.seats[fromIdx];
      if (!player) return;
      const res = await send("room:swap", {
        from: fromIdx,
        to: toIdx,
        player: player.id,
      });
      if (!res.ok) notify(res.error ?? "Could not change seats.");
    },
    [room?.seats, send, notify],
  );

  const handleSeatPointerDown = (
    index: number,
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!host || (room?.game && !finished) || !room?.seats[index]) return;
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const container = (e.currentTarget as HTMLElement).closest(".seat-editor");
    const cards = container
      ? Array.from(container.querySelectorAll<HTMLElement>(".seat-card"))
      : [];
    const height =
      cards.length > 0 ? cards[0].getBoundingClientRect().height + 8 : 72;

    pointerDragRef.current = {
      fromIndex: index,
      startY: e.clientY,
      cardHeight: height,
      pointerId: e.pointerId,
    };

    setPointerDrag({
      fromIndex: index,
      targetIndex: index,
      offsetY: 0,
      cardHeight: height,
    });
  };

  const handleSeatPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const deltaY = e.clientY - drag.startY;
    const targetIdx = Math.max(
      0,
      Math.min(
        COLORS.length - 1,
        Math.round(drag.fromIndex + deltaY / drag.cardHeight),
      ),
    );

    setPointerDrag((prev) =>
      prev
        ? {
            ...prev,
            targetIndex: targetIdx,
            offsetY: deltaY,
          }
        : null,
    );
  };

  const handleSeatPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const fromIdx = drag.fromIndex;
    const toIdx = pointerDrag?.targetIndex ?? fromIdx;

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    pointerDragRef.current = null;
    setPointerDrag(null);

    if (fromIdx !== toIdx) {
      void handleSwapSeats(fromIdx, toIdx);
    }
  };

  const startTooltip =
    room?.game && !finished
      ? "Resume game"
      : !connected
        ? "Connecting to server..."
        : admission?.newRoomsAvailable === false
          ? "The server is busy. Starting new games will reopen automatically."
          : !host
            ? "Waiting for table host to start the game."
            : humans < 2
              ? "Invite at least one more player to start."
              : "Start game";

  return (
    <section className="lobby-card">
      {!chat.open && <ChatPreviews messages={chat.previews} />}
      <div className="lobby-scroll-body">
        <div className="lobby-title">
          <h1>{room.name}</h1>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span className="room-visibility-badge">
              {room.public ? (
                <GlobeHemisphereWest weight="bold" />
              ) : (
                <LockSimple weight="bold" />
              )}
              <span>{room.public ? "PUBLIC TABLE" : "PRIVATE TABLE"}</span>
            </span>
            {isSpectator && (
              <span className="spectator-badge">
                <Eye weight="bold" />
                <span>SPECTATING</span>
              </span>
            )}
          </div>
        </div>
        {isSpectator && room.seats.some((seat) => !seat || seat.bot) && (
          <div className="spectator-seat-prompt">
            <span>An open seat is available at this table.</span>
            <button
              className="primary compact take-seat-btn"
              onClick={async () => {
                const res = await send("room:join", {
                  code: room.code,
                  playerName: name,
                  spectate: false,
                });
                if (!res.ok) notify(res.error ?? "Could not take seat.");
              }}
            >
              Take an Open Seat <ArrowRight />
            </button>
          </div>
        )}
        <div className="invite-strip">
          <div className="invite-code-box">
            <span className="invite-label">ROOM CODE</span>
            <strong className="invite-code">{room.code}</strong>
          </div>
          <button
            type="button"
            className={`invite-copy-btn ${copied ? "copied" : ""}`}
            aria-label={
              copied ? "Link copied to clipboard" : "Copy room invite link"
            }
            title={copied ? "Link Copied!" : "Copy Invite Link"}
            onClick={copyInvite}
          >
            {copied ? <Check weight="bold" /> : <Copy weight="bold" />}
          </button>
        </div>
        <div className="seat-editor">
          {room.seats.map((p, i) => {
            let cardTransform = "translateY(0px)";
            let cardZIndex = 1;
            let isDraggingCard = false;
            let isDropTargetCard = false;
            let cardTransition =
              "transform 0.22s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.2s ease, border-color 0.2s ease";

            if (pointerDrag) {
              if (i === pointerDrag.fromIndex) {
                isDraggingCard = true;
                cardTransform = `translateY(${pointerDrag.offsetY}px) scale(1.025)`;
                cardZIndex = 40;
                cardTransition = "box-shadow 0.2s ease, border-color 0.2s ease";
              } else {
                if (pointerDrag.fromIndex < pointerDrag.targetIndex) {
                  if (
                    i > pointerDrag.fromIndex &&
                    i <= pointerDrag.targetIndex
                  ) {
                    cardTransform = `translateY(-${pointerDrag.cardHeight}px)`;
                  }
                } else if (pointerDrag.fromIndex > pointerDrag.targetIndex) {
                  if (
                    i >= pointerDrag.targetIndex &&
                    i < pointerDrag.fromIndex
                  ) {
                    cardTransform = `translateY(${pointerDrag.cardHeight}px)`;
                  }
                }
                if (i === pointerDrag.targetIndex) {
                  isDropTargetCard = true;
                }
              }
            }

            return (
              <div
                key={i}
                className={`seat-card ${p ? "seat-occupied" : "seat-vacant"} ${isDraggingCard ? "is-dragging" : ""} ${isDropTargetCard ? "is-drop-target" : ""}`}
                data-seat-index={i}
                style={{
                  transform: cardTransform,
                  zIndex: cardZIndex,
                  transition: cardTransition,
                }}
              >
                <span
                  className="seat-colour-dot"
                  style={{
                    background: PALETTE[COLORS[i]],
                    boxShadow: `0 0 10px ${PALETTE[COLORS[i]]}88`,
                  }}
                />
                <div className="seat-main-info">
                  <div className="seat-header-row">
                    <strong className="seat-player-name">
                      {p?.name ?? "Open Seat"}
                    </strong>
                    {p?.id === me && (
                      <span className="seat-badge you-badge">YOU</span>
                    )}
                    {p?.id === room.host && (
                      <span className="seat-badge host-badge">HOST</span>
                    )}
                    {p?.bot && (
                      <span className="seat-badge bot-badge">BOT</span>
                    )}
                  </div>
                  <small className="seat-status-caption">
                    {p?.id === room.host
                      ? "Table Organiser"
                      : p?.bot
                        ? "Computer player"
                        : p
                          ? p.connected
                            ? "Ready"
                            : "Offline"
                          : "Open seat — invite a friend or add bot"}
                  </small>
                </div>
                <div className="seat-action-tools">
                  {p?.id.startsWith("bot:") &&
                    host &&
                    (!room.game || finished) && (
                      <BotDifficulty
                        compact
                        label={`${COLORS[i]} bot level`}
                        value={
                          p.botDifficulty ?? room.botDifficulty ?? botDifficulty
                        }
                        disabled={
                          !host || (!!room.game && !finished) || !connected
                        }
                        onChange={async (difficulty) => {
                          const r = await send("room:difficulty", {
                            difficulty,
                            seat: i,
                          });
                          if (!r.ok)
                            notify(
                              r.error ?? "Unable to change bot difficulty.",
                            );
                        }}
                      />
                    )}
                  {p && host && (!room.game || finished) && (
                    <div
                      className="seat-drag-handle"
                      role="button"
                      tabIndex={0}
                      aria-label={`Drag or use arrow keys to reorder ${p.name}`}
                      title="Drag to change seat position"
                      onPointerDown={(e) => handleSeatPointerDown(i, e)}
                      onPointerMove={handleSeatPointerMove}
                      onPointerUp={handleSeatPointerUp}
                      onPointerCancel={handleSeatPointerUp}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp" && i > 0) {
                          e.preventDefault();
                          void handleSwapSeats(i, i - 1);
                        } else if (
                          e.key === "ArrowDown" &&
                          i < COLORS.length - 1
                        ) {
                          e.preventDefault();
                          void handleSwapSeats(i, i + 1);
                        }
                      }}
                    >
                      <DotsSixVertical weight="bold" />
                    </div>
                  )}
                  {host &&
                  (!room.game || finished) &&
                  (!p || p.id.startsWith("bot:")) ? (
                    <button
                      type="button"
                      className={`seat-bot-action-btn ${p ? "remove-bot" : "add-bot"}`}
                      aria-label={`${p ? "Remove" : "Add"} Bot in ${COLORS[i]} seat`}
                      onClick={async () => {
                        const r = await send("room:configure", {
                          seat: i,
                          bot: !p,
                        });
                        if (!r.ok) notify(r.error!);
                      }}
                    >
                      {p ? (
                        <>
                          <X weight="bold" />
                          <span className="btn-label-text">Remove</span>
                        </>
                      ) : (
                        <>
                          <Plus weight="bold" />
                          <span className="btn-label-text">Add Bot</span>
                        </>
                      )}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <div className="lobby-finish-bar">
          <span className="lobby-finish-label">FINISH RULE</span>
          <div className="finish-rule-segmented lobby-segmented">
            <button
              type="button"
              disabled={!host || (!!room.game && !finished) || !connected}
              className={`finish-segment-btn ${(room.finishMode ?? "first") === "first" ? "active" : ""}`}
              onClick={async () => {
                const r = await send("room:mode", {
                  finishMode: "first",
                });
                if (!r.ok) notify(r.error ?? "Unable to change game mode.");
              }}
            >
              <span className="segment-title">Quick Finish</span>
            </button>
            <button
              type="button"
              disabled={!host || (!!room.game && !finished) || !connected}
              className={`finish-segment-btn ${(room.finishMode ?? "first") === "all" ? "active" : ""}`}
              onClick={async () => {
                const r = await send("room:mode", {
                  finishMode: "all",
                });
                if (!r.ok) notify(r.error ?? "Unable to change game mode.");
              }}
            >
              <span className="segment-title">Play Till End</span>
            </button>
          </div>
        </div>
        <div className="lobby-voice">
          <VoicePanel
            compact
            room={room}
            voice={voice}
            onOnline={onOpenRooms}
          />
        </div>
      </div>

      {/* Anchored Bottom Bar */}
      <div className="lobby-anchored-footer">
        <div className="lobby-actions">
          <button
            type="button"
            className="secondary lobby-btn-leave"
            onClick={onOpenLeave}
            title="Leave table"
          >
            <SignOut weight="bold" />
            Leave Table
          </button>
          <div className="lobby-btn-start-wrap" title={startTooltip}>
            <button
              type="button"
              className="primary lobby-btn-start"
              disabled={
                (!room.game || finished) &&
                (!host ||
                  humans < 2 ||
                  !connected ||
                  admission?.newRoomsAvailable === false)
              }
              title={startTooltip}
              onClick={onStartGame}
            >
              <Play weight="fill" />
              {room.game && !finished
                ? "RESUME GAME"
                : host
                  ? "START GAME"
                  : "WAITING FOR HOST"}
            </button>
          </div>
        </div>
        <div className="lobby-footer-strip">
          <button
            type="button"
            className="text-button lobby-switch"
            onClick={onOpenRooms}
          >
            Join another room <ArrowRight weight="bold" />
          </button>
          {host && !room.game && humans < 2 && (
            <span
              className="lobby-waiting-hint"
              title="Invite at least one more player to start."
            >
              Invite at least one more player to start.
            </span>
          )}
        </div>
        {(!room.game || finished) && admission?.newRoomsAvailable === false && (
          <p role="status" className="admission-notice">
            The server is busy. Starting new games will reopen automatically;
            your room and seats are saved.
          </p>
        )}
      </div>
    </section>
  );
}
