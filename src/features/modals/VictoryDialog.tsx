import { Trophy, ArrowCounterClockwise } from "@phosphor-icons/react";
import { Dialog } from "../../lib";
import { PALETTE } from "../game/Board";
import type { Game } from "../../../shared/game";
import type { Room } from "../../../shared/protocol";

interface VictoryDialogProps {
  game: Game;
  room: Room | null;
  host: boolean;
  onClose: () => void;
  onPlayAgain: () => void;
  onBackToSetup: () => void;
}

export function VictoryDialog({
  game,
  room,
  host,
  onClose,
  onPlayAgain,
  onBackToSetup,
}: VictoryDialogProps) {
  const winner = game.seats.find((s) => s?.id === game.winner);
  const winnerName = winner?.name ?? "PLAYER";

  return (
    <Dialog title={`${winnerName.toUpperCase()} WINS!`} onClose={onClose}>
      <div className="finish-trophy">
        <Trophy weight="fill" />
      </div>
      {game.rankings && game.rankings.length > 1 && (
        <div className="finish-podium" aria-label="Final podium">
          {game.rankings.map((pid, rank) => {
            const s = game.seats.find((st) => st?.id === pid);
            if (!s) return null;
            const medal =
              rank === 0
                ? "🥇 1st"
                : rank === 1
                  ? "🥈 2nd"
                  : rank === 2
                    ? "🥉 3rd"
                    : "4th";
            return (
              <div key={pid} className="podium-row">
                <span className="podium-rank">{medal}</span>
                <span
                  className="podium-color"
                  style={{ background: PALETTE[s.color] }}
                />
                <strong className="podium-name">{s.name}</strong>
              </div>
            );
          })}
        </div>
      )}
      <button
        className="primary full"
        disabled={!!room && !host}
        onClick={onPlayAgain}
      >
        <ArrowCounterClockwise />
        {room && !host ? "WAITING FOR HOST" : "PLAY AGAIN"}
      </button>
      <button className="secondary full" onClick={onBackToSetup}>
        BACK TO SETUP
      </button>
    </Dialog>
  );
}
