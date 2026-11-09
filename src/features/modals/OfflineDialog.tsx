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
      <div className="field-label">
        <span>Offline game</span>
        <div className="segmented-control mode-segmented">
          <button
            type="button"
            className={`segment-btn ${localMode === "computer" ? "active" : ""}`}
            onClick={() => setLocalMode("computer")}
          >
            <Robot weight="bold" />
            <span>Play vs Computer</span>
          </button>
          <button
            type="button"
            className={`segment-btn ${localMode === "pass" ? "active" : ""}`}
            onClick={() => setLocalMode("pass")}
          >
            <Users weight="bold" />
            <span>Pass &amp; Play</span>
          </button>
        </div>
      </div>
      {localMode === "pass" ? (
        <div className="field-label">
          <span>Players</span>
          <div className="segmented-control count-segmented">
            {[2, 3, 4].map((count) => (
              <button
                type="button"
                key={count}
                className={`segment-btn ${humanCount === count ? "active" : ""}`}
                onClick={() => setHumanCount(count)}
              >
                <span>{count} Players</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="field-label">
          <span>Opponents</span>
          <div className="segmented-control count-segmented">
            {[1, 2, 3].map((count) => (
              <button
                type="button"
                key={count}
                className={`segment-btn ${botCount === count ? "active" : ""}`}
                onClick={() => setBotCount(count)}
              >
                <span>
                  {count} {count === 1 ? "Computer" : "Computers"}
                </span>
              </button>
            ))}
          </div>
        </div>
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
      <div className="field-label">
        <span>Finish rule</span>
        <div className="finish-rule-segmented">
          <button
            type="button"
            className={`finish-segment-btn ${offlineFinishMode === "first" ? "active" : ""}`}
            onClick={() => setOfflineFinishMode("first")}
          >
            <span className="segment-title">Quick Finish</span>
            <small className="segment-desc">
              First to bring tokens home wins
            </small>
          </button>
          <button
            type="button"
            className={`finish-segment-btn ${offlineFinishMode === "all" ? "active" : ""}`}
            onClick={() => setOfflineFinishMode("all")}
          >
            <span className="segment-title">Play Till End</span>
            <small className="segment-desc">Full 1st, 2nd, 3rd podium</small>
          </button>
        </div>
      </div>
      <button className="primary full" onClick={onStart}>
        <Robot />
        PLAY OFFLINE
        <ArrowRight />
      </button>
    </Dialog>
  );
}
