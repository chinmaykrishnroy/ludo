import {
  ArrowUpRight,
  ArrowRight,
  DiceFive,
  Users,
  Robot,
  DownloadSimple,
} from "@phosphor-icons/react";
import { Board, PALETTE } from "./features/game/Board";
import {
  newGame,
  seat,
  COLORS,
  roll,
  move,
  legalMoves,
  type Game,
} from "../shared/game";
import { useId, useState, useEffect, useRef } from "react";
import { formatCount } from "./formatCount";

const BOT_NAMES = ["Milo", "Sunny", "Coco", "Pip"];

function createDemoGame(): Game {
  const g = newGame(
    COLORS.map((_, i) => seat(`demo-${i}`, BOT_NAMES[i], i, true)),
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
}: {
  stats: ClubStats | null;
  onOnline: () => void;
  onOffline: () => void;
  onRules: () => void;
  onInstall: () => void;
  installed: boolean;
  resume?: boolean;
  onResume?: () => void;
}) {
  const [demoGame, setDemoGame] = useState<Game>(createDemoGame);
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

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

  const activeColor = demoGame.seats[demoGame.turn]?.color ?? "red";
  const activeBot =
    demoGame.seats[demoGame.turn]?.name ?? BOT_NAMES[demoGame.turn] ?? "Milo";

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cardRef.current || window.matchMedia("(max-width: 899px)").matches)
      return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 14;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * -14;
    setTilt({ x, y });
  };

  const handlePointerLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-copy">
          <div className="home-copy-header">
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
          </div>

          <div className="home-actions desktop-only">
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
          <span className="home-smallprint desktop-only">
            2–4 PLAYERS. ZERO SIGN-UP.
          </span>
        </div>

        <div className="home-art" aria-hidden="true">
          <div
            ref={cardRef}
            className="home-board-card"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            style={
              {
                "--aura-color": PALETTE[activeColor],
                transform: `perspective(900px) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg)`,
              } as React.CSSProperties
            }
          >
            <div className="home-board-aura" />
            <div className="home-board-live-pill">
              <span className="live-pulse-dot" />
              <span>
                LIVE DEMO • <strong>{activeBot}</strong>{" "}
                {demoGame.phase === "roll" ? "rolling..." : "moving..."}
              </span>
            </div>
            <div className="home-board-illustration">
              <Board game={demoGame} me="none" onMove={() => {}} busy />
            </div>
          </div>
          <span className="home-art-caption">
            YOUR NEXT RIVALRY STARTS HERE.
          </span>
        </div>

        <div className="mobile-actions-wrapper mobile-only">
          <div className="home-actions">
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
          <span className="home-smallprint">2–4 PLAYERS. ZERO SIGN-UP.</span>
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
          <button className="secondary compact" onClick={onInstall}>
            <DownloadSimple />
            INSTALL APP
          </button>
        )}
      </footer>
    </div>
  );
}
