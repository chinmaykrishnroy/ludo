import { DotsThree, ArrowLeft } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Board, PALETTE } from "./Board";
import Dice from "./Dice";
import VoicePanel from "./VoicePanel";
import type { Game } from "../shared/game";
import type { Reply, Room } from "../shared/protocol";

export default function PlayScreen({
  game,
  me,
  room,
  busy,
  rolling,
  connected,
  onRoll,
  onMove,
  onMenu,
  send,
  notify,
  onOnline,
  showVoice = true,
  onBack,
  clockOffset,
}: {
  game: Game;
  me: string;
  room: Room | null;
  busy: boolean;
  rolling: boolean;
  connected: boolean;
  onRoll: () => void;
  onMove: (n: number) => void;
  onMenu: () => void;
  send: (e: string, d: unknown) => Promise<Reply>;
  notify: (s: string) => void;
  onOnline: () => void;
  showVoice?: boolean;
  onBack: () => void;
  clockOffset: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(
    0,
    Math.ceil((game.deadline - (now + clockOffset)) / 1000),
  );
  const current = game.seats[game.turn]!,
    mine = current.id === me && !current.bot,
    finished = game.phase === "finished";
  return (
    <div className="game-stage">
      <header className="game-header">
        <button className="play-tool header-back" onClick={onBack}>
          <ArrowLeft weight="bold" />
          BACK
        </button>
      </header>
      <main className="play-screen">
        <div
          className="play-board"
          style={
            { "--turn-colour": PALETTE[current.color] } as React.CSSProperties
          }
        >
          <Board
            game={game}
            me={me}
            onMove={onMove}
            busy={busy || (!connected && !!room)}
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
                color: current.color === "yellow" ? "#191919" : "#fffdf5",
              } as React.CSSProperties
            }
            disabled={
              !mine || busy || game.phase !== "roll" || (!!room && !connected)
            }
            onClick={onRoll}
            aria-label="Roll dice"
          >
            <span className="dice-turn">
              <i style={{ background: PALETTE[current.color] }} />
              {finished
                ? "GAME OVER"
                : mine
                  ? !room && current.name !== "You"
                    ? `${current.name.toUpperCase()}’S TURN`
                    : "YOUR TURN"
                  : `${current.name.toUpperCase()}’S TURN`}
            </span>
            <span className="dice-clock" aria-label="Time remaining">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
            </span>
            <Dice value={game.dice ?? 1} rolling={rolling} />
            <span className="dice-action">
              {rolling
                ? "ROLLING"
                : game.phase === "move" && mine
                  ? "PICK TOKEN"
                  : mine
                    ? "ROLL DICE"
                    : "WAITING"}
            </span>
          </button>
          {showVoice && (
            <VoicePanel
              compact
              room={room}
              send={send}
              notify={notify}
              onOnline={onOnline}
            />
          )}
          <span className="sr-only" role="status" aria-live="polite">
            {game.notice}
          </span>
        </div>
      </main>
    </div>
  );
}
