import {
  ArrowUpRight,
  ArrowRight,
  DiceFive,
  Users,
  Robot,
  DownloadSimple,
  Play,
} from "@phosphor-icons/react";
import { Board } from "./Board";
import {
  newGame,
  seat,
  COLORS,
  roll,
  move,
  legalMoves,
  type Game,
} from "../shared/game";
import { useId, useState, useEffect } from "react";
import { formatCount } from "./formatCount";

function createDemoGame(): Game {
  const g = newGame(
    COLORS.map((_, i) => seat(`demo-${i}`, COLORS[i], i, true)),
  );
  g.seats.forEach((s) => {
    if (!s) return;
    const pos1 = Math.floor(Math.random() * 14) + 2;
    const pos2 = Math.floor(Math.random() * 16) + 18;
    s.tokens = [pos1, pos2, -1, -1];
  });
  g.phase = "roll";
  return g;
}
export type ClubStats = {
  gamesStarted: number;
  gamesFinished: number;
  diceRolls: number;
  activePlayers: number;
};
function StatCounter({
  value,
  label,
}: {
  value: number | undefined;
  label: string;
}) {
  const id = useId(),
    count = formatCount(value);
  return (
    <div>
      <details
        className="stat-detail"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            e.currentTarget.open = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.open = false;
        }}
      >
        <summary
          aria-label={`${label}: ${count.exact}`}
          aria-describedby={id}
          title={count.exact}
        >
          <strong aria-hidden="true">{count.compact}</strong>
        </summary>
        <span className="stat-tooltip" id={id} role="tooltip">
          {count.exact}
        </span>
      </details>
      <span>{label}</span>
    </div>
  );
}
export default function Home({
  stats,
  onOnline,
  onOffline,
  onRules,
  onInstall,
  installed,
  resume,
  onResume,
}: {
  stats: ClubStats | null;
  onOnline: () => void;
  onOffline: () => void;
  onRules: () => void;
  onInstall: () => void;
  installed: boolean;
  resume: boolean;
  onResume: () => void;
}) {
  const [demoGame, setDemoGame] = useState<Game>(createDemoGame);

  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      if (!active || document.hidden) return;
      setDemoGame((current) => {
        try {
          if (
            current.phase === "finished" ||
            (current.rankings?.length ?? 0) > 0
          ) {
            return createDemoGame();
          }
          if (current.phase === "roll") {
            const dice = Math.floor(Math.random() * 6) + 1;
            return roll(current, dice);
          }
          if (current.phase === "move") {
            const legal = legalMoves(current);
            if (!legal.length) return current;
            let bestToken = legal[0];
            for (const t of legal) {
              try {
                const nextState = move(current, t);
                if (nextState.lastMove?.captured) {
                  bestToken = t;
                  break;
                }
              } catch {
                // Ignore test move error
              }
            }
            return move(current, bestToken);
          }
        } catch {
          return createDemoGame();
        }
        return current;
      });
    }, 1300);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-copy">
          <span className="home-kicker">THE CLASSIC. A LITTLE LOUDER.</span>
          <h1>
            <span>BIG MOVES.</span>
            <span className="home-highlight">SMALL GRUDGES.</span>
          </h1>
          <p>
            Bring your friends. Roll your luck.
            <br />
            Settle it on the board.
          </p>
          <div className="home-actions">
            {resume && (
              <button
                className="secondary home-resume-top"
                onClick={onResume}
                style={{
                  gridColumn: "1 / -1",
                  background: "rgba(245, 158, 11, 0.15)",
                  borderColor: "rgba(245, 158, 11, 0.4)",
                  color: "#d97706",
                }}
              >
                <Play weight="fill" />
                RESUME SAVED GAME
              </button>
            )}
            <button className="primary" onClick={onOnline}>
              <Users weight="bold" />
              PLAY WITH FRIENDS
              <ArrowUpRight weight="bold" />
            </button>
            <button className="secondary" onClick={onOffline}>
              <Robot />
              PLAY OFFLINE
              <ArrowRight />
            </button>
          </div>
          {resume && (
            <button className="text-button home-resume" onClick={onResume}>
              <Play weight="fill" />
              Resume your saved game
            </button>
          )}
          <span className="home-smallprint">2–4 PLAYERS. ZERO SIGN-UP.</span>
        </div>
        <div className="home-art" aria-hidden="true">
          <div className="home-board-illustration">
            <Board game={demoGame} me="none" onMove={() => {}} busy />
          </div>
          <div className="home-sticker">
            <DiceFive weight="fill" />
            <span>
              ROLL.
              <br />
              RACE.
              <br />
              REPEAT.
            </span>
          </div>
          <span className="home-art-caption">
            YOUR NEXT RIVALRY STARTS HERE.
          </span>
        </div>
      </section>
      <section
        className="home-stat-section"
        aria-label="Live online game statistics"
      >
        <div className="home-stat-heading">
          <span>
            <i />
            LIVE FROM THE CLUB
          </span>
          <small>
            {stats
              ? "Real games. Real rolls. Updated live."
              : "Online stats appear when connected."}
          </small>
        </div>
        <div className="home-stats">
          <StatCounter value={stats?.gamesStarted} label="GAMES STARTED" />
          <StatCounter value={stats?.diceRolls} label="DICE ROLLED" />
          <StatCounter value={stats?.gamesFinished} label="RIVALRIES SETTLED" />
        </div>
      </section>
      <footer className="home-footer">
        <div>
          <strong>SAME BOARD. YOUR KIND OF COMPANY.</strong>
          <button className="text-button" onClick={onRules}>
            New to the table? House rules
            <ArrowUpRight />
          </button>
        </div>
        {!installed && (
          <button className="secondary" onClick={onInstall}>
            <DownloadSimple />
            INSTALL APP
          </button>
        )}
      </footer>
    </div>
  );
}
