import { DotsThree, ArrowLeft } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Board, PALETTE } from "./Board";
import Dice from "./Dice";
import { useDicePresentation } from "./useDicePresentation";
import type { VoiceController } from "./useRoomVoice";
import { RoomTools } from "./RoomChat";
import type { ChatController } from "./useRoomChat";
import VoicePanel from "./VoicePanel";
import { soleLegalMove, type Game } from "../shared/game";
import type { Room } from "../shared/protocol";

export default function PlayScreen({
  game,
  me,
  room,
  busy,
  pending,
  connected,
  onRoll,
  onMove,
  onMenu,
  voice,
  onOnline,
  showVoice = true,
  onBack,
  clockOffset,
  chat,
}: {
  game: Game;
  me: string;
  room: Room | null;
  busy: boolean;
  pending: boolean;
  connected: boolean;
  onRoll: () => void;
  onMove: (n: number) => void;
  onMenu: () => void;
  voice: VoiceController;
  onOnline: () => void;
  showVoice?: boolean;
  onBack: () => void;
  clockOffset: number;
  chat: ChatController;
}) {
  const presentation = useDicePresentation(
    game,
    room?.code ?? "local",
    pending,
  );
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(
    0,
    Math.ceil((presentation.board.deadline - (now + clockOffset)) / 1000),
  );
  const inputBusy =
    busy ||
    presentation.active ||
    (!!room && now + clockOffset < (room.actionReadyAt ?? 0));
  const current = presentation.actor,
    mine = current.id === me && !current.bot,
    sharedDevice = !room && game.seats.filter((s) => s && !s.bot).length > 1,
    finished = game.phase === "finished";
  return (
    <div className="game-stage">
      <header className="game-header">
        <button className="play-tool header-back" onClick={onBack}>
          <ArrowLeft weight="bold" />
          BACK
        </button>
        <RoomTools voice={voice} chat={chat} online={!!room} />
      </header>
      <main className="play-screen">
        <div
          className="play-board"
          style={
            { "--turn-colour": PALETTE[current.color] } as React.CSSProperties
          }
        >
          <Board
            game={presentation.board}
            me={me}
            onMove={onMove}
            busy={inputBusy || (!connected && !!room)}
          />
          <button
            className="board-menu"
            aria-label="Open game menu"
            title="Game menu"
            onClick={onMenu}
          >
            <DotsThree weight="bold" />
          </button>
        </div>
        <div className="play-controls">
          <button
            className={`big-dice-button ${mine ? "your-roll" : ""}`}
            style={
              {
                "--turn-colour": PALETTE[current.color],
                background: PALETTE[current.color],
                color: "#111111",
              } as React.CSSProperties
            }
            disabled={
              !mine ||
              inputBusy ||
              game.phase !== "roll" ||
              (!!room && !connected)
            }
            onClick={() => {
              presentation.begin();
              onRoll();
            }}
            aria-label="Roll dice"
          >
            <span className="dice-turn">
              <i style={{ background: PALETTE[current.color] }} />
              {finished
                ? "GAME OVER"
                : mine
                  ? sharedDevice
                    ? `${current.name.toUpperCase()}’S TURN`
                    : "YOUR TURN"
                  : `${current.name.toUpperCase()}’S TURN`}
            </span>
            <span className="dice-clock" aria-label="Time remaining">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
            </span>
            <Dice value={presentation.value} rolling={presentation.rolling} />
            <span className="dice-action">
              {presentation.rolling
                ? "ROLLING"
                : presentation.result?.phase === "roll"
                  ? "TURN OVER"
                  : game.phase === "move" && mine
                    ? soleLegalMove(game) !== undefined
                      ? "AUTO MOVE"
                      : "PICK TOKEN"
                    : mine
                      ? "ROLL DICE"
                      : "WAITING"}
            </span>
          </button>
          {showVoice && (
            <VoicePanel compact room={room} voice={voice} onOnline={onOnline} />
          )}
          <span className="sr-only" role="status" aria-live="polite">
            {presentation.active ? `${current.name} is rolling.` : game.notice}
          </span>
        </div>
      </main>
    </div>
  );
}
