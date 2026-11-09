import React from "react";
import { Play, Robot, Users, ArrowRight } from "@phosphor-icons/react";
import { Dialog } from "../../lib";
import { BotDifficulty } from "../lobby/BotDifficulty";

interface OfflineDialogProps {
  practiceOpen: boolean;
  isLocalPhaseFinished: boolean;
  name: string;
  setName: (name: string) => void;
  localMode: string;
  setLocalMode: (mode: string) => void;
  humanCount: number;
  setHumanCount: (count: number) => void;
  botCount: number;
  setBotCount: (count: number) => void;
  botDifficulty: number;
  onDifficultyChange: (value: number) => void;
  offlineBotLevels: number[];
  setOfflineBotLevels: React.Dispatch<React.SetStateAction<number[]>>;
  offlineFinishMode: "first" | "all";
  setOfflineFinishMode: (mode: "first" | "all") => void;
  onResume: () => void;
  onStart: () => void;
  onClose: () => void;
}

export function OfflineDialog({
  practiceOpen,
  isLocalPhaseFinished,
  name,
  setName,
  localMode,
  setLocalMode,
  humanCount,
  setHumanCount,
  botCount,
  setBotCount,
  botDifficulty,
  onDifficultyChange,
  offlineBotLevels,
  setOfflineBotLevels,
  offlineFinishMode,
  setOfflineFinishMode,
  onResume,
  onStart,
  onClose,
}: OfflineDialogProps) {
  return (
    <Dialog title="PLAY OFFLINE" onClose={onClose}>
      {practiceOpen && !isLocalPhaseFinished && (
        <div className="offline-resume-callout">
          <button
            type="button"
            className="primary full resume-button"
            onClick={onResume}
          >
            <Play weight="fill" />
            RESUME SAVED GAME
          </button>
          <div className="offline-divider">
            <span>or start a new game below</span>
          </div>
        </div>
      )}
      <label className="field-label">
        Your name
        <input
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field-label">
        Offline game
        <select
          value={localMode}
          onChange={(e) => setLocalMode(e.target.value)}
        >
          <option value="computer">Play vs Computer</option>
          <option value="pass">Pass &amp; Play</option>
        </select>
      </label>
      {localMode === "pass" ? (
        <label className="field-label">
          Players
          <select
            value={humanCount}
            onChange={(e) => setHumanCount(Number(e.target.value))}
          >
            <option value={2}>2 Players</option>
            <option value={3}>3 Players</option>
            <option value={4}>4 Players</option>
          </select>
        </label>
      ) : (
        <label className="field-label">
          Opponents
          <select
            value={botCount}
            onChange={(e) => setBotCount(Number(e.target.value))}
          >
            <option value={1}>1 Computer</option>
            <option value={2}>2 Computers</option>
            <option value={3}>3 Computers</option>
          </select>
        </label>
      )}
      {localMode === "computer" && (
        <BotDifficulty value={botDifficulty} onChange={onDifficultyChange} />
      )}
      {localMode === "computer" && (
        <details className="bot-levels">
          <summary>Individual bot levels</summary>
          {Array.from({ length: botCount }, (_, i) => (
            <BotDifficulty
              key={i}
              label={`Bot ${i + 1} difficulty`}
              value={offlineBotLevels[i]}
              onChange={(value) =>
                setOfflineBotLevels((levels) =>
                  levels.map((n, j) => (j === i ? value : n)),
                )
              }
            />
          ))}
        </details>
      )}
      <label className="field-label">
        Finish rule
        <select
          value={offlineFinishMode}
          onChange={(e) =>
            setOfflineFinishMode(e.target.value as "first" | "all")
          }
        >
          <option value="first">
            Quick Finish — 1st to bring all tokens home wins
          </option>
          <option value="all">
            Play Till End — 1st, 2nd, and 3rd place podium
          </option>
        </select>
      </label>
      <button className="primary full" onClick={onStart}>
        <Robot />
        PLAY OFFLINE
        <ArrowRight />
      </button>
    </Dialog>
  );
}
