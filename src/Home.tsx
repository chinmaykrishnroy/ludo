import {
  ArrowUpRight,
  ArrowRight,
  Users,
  Robot,
  DownloadSimple,
  Lightning,
  Microphone,
  Sparkle,
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
import { useId, useState, useEffect } from "react";
import { formatCount } from "./formatCount";
import { KineticBackground } from "./components/KineticBackground";

const BOT_ROSTER = [
  { name: "Milo", color: "red" as const },
  { name: "Sunny", color: "green" as const },
  { name: "Coco", color: "yellow" as const },
  { name: "Pip", color: "blue" as const },
];

function createDemoGame(): Game {
  const g = newGame(
    COLORS.map((_, i) => seat(`demo-${i}`, BOT_ROSTER[i].name, i, true)),
  );
  g.seats.forEach((s) => {
    if (!s) return;
    const pos1 = Math.floor(Math.random() * 12) + 2;
    const pos2 = Math.floor(Math.random() * 14) + 18;
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
    }, 1200);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const activeSeatIndex = demoGame.turn;
  const activeColor = demoGame.seats[activeSeatIndex]?.color ?? "red";

  return (
    <div className="home-page">
      {/* Interactive GPU Kinetic Particle Constellation Canvas */}
      <KineticBackground />

      {/* Atmospheric Multi-Hue Aurora Backlight */}
      <div
        className="home-aurora-glow"
        aria-hidden="true"
        style={
          { "--active-color": PALETTE[activeColor] } as React.CSSProperties
        }
      />

      <section className="home-hero">
        <div className="home-copy">
          <div className="home-copy-header">
            <span className="home-kicker">
              <Sparkle weight="fill" className="kicker-sparkle" />
              THE PRO MULTIPLAYER ARENA
            </span>
            <h1>
              <span>BIG MOVES.</span>
              <span className="home-highlight">SAVAGE GRUDGES.</span>
            </h1>
            <p>
              The classic board game re-engineered for fast competitive tables,
              live voice banter, and smart AI bots. Instant multiplayer right in
              your browser.
            </p>
          </div>

          {/* High-Impact Magnetic CTA Buttons */}
          <div className="home-actions-wrapper">
            <div className="home-actions">
              <button className="primary home-btn-primary" onClick={onOnline}>
                <span className="btn-label-group">
                  <Users weight="bold" />
                  <span>PLAY WITH FRIENDS</span>
                </span>
                <span className="btn-icon-circle">
                  <ArrowUpRight weight="bold" />
                </span>
              </button>
              <button
                className="secondary home-btn-secondary"
                onClick={onOffline}
              >
                <span className="btn-label-group">
                  <Robot weight="bold" />
                  <span>PLAY OFFLINE</span>
                </span>
                <span className="btn-icon-circle">
                  <ArrowRight weight="bold" />
                </span>
              </button>
            </div>
            <div className="home-perks-row">
              <span className="perk-pill">
                <Lightning weight="fill" /> Zero Sign-Up
              </span>
              <span className="perk-pill">
                <Microphone weight="fill" /> Spatial Voice
              </span>
              <span className="perk-pill">
                <Robot weight="fill" /> 10 Bot Levels
              </span>
            </div>
          </div>
        </div>

        {/* Board Showcase with Active Player HUD */}
        <div className="home-stage-container" aria-hidden="true">
          <div className="home-board-showcase">
            {/* Live Match Turn Badges */}
            <div className="showcase-turn-hud">
              {BOT_ROSTER.map((bot, idx) => (
                <div
                  key={bot.name}
                  className={`showcase-hud-badge seat-${bot.color} ${activeSeatIndex === idx ? "active-turn" : ""}`}
                >
                  <span
                    className="hud-color-dot"
                    style={{ background: PALETTE[bot.color] }}
                  />
                  <span className="hud-bot-name">{bot.name}</span>
                  {activeSeatIndex === idx && (
                    <span className="hud-turn-pill">ROLLING</span>
                  )}
                </div>
              ))}
            </div>

            {/* Double-Bezel Concentric Enclosure */}
            <div className="home-board-enclosure">
              <div className="home-board-card">
                <Board game={demoGame} me="none" onMove={() => {}} busy />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="home-stat-section">
        <div className="home-stat-heading">
          <span>
            <i /> LIVE FROM THE CLUB
          </span>
          <small>Real games. Real rolls. Updated live.</small>
        </div>
        <div className="home-stats">
          <div>
            <StatCounter value={stats?.gamesStarted} label="GAMES STARTED" />
          </div>
          <div>
            <StatCounter value={stats?.diceRolls} label="DICE ROLLED" />
          </div>
          <div>
            <StatCounter
              value={stats?.gamesFinished}
              label="RIVALRIES SETTLED"
            />
          </div>
        </div>
      </section>

      {/* Footer Strip */}
      <footer className="home-footer-strip">
        <span className="home-footer-tagline">
          SAME BOARD. YOUR KIND OF COMPANY.
        </span>
        <button
          type="button"
          className="text-button home-rules-link"
          onClick={onRules}
        >
          New to the table? House rules <ArrowUpRight weight="bold" />
        </button>
        {!installed && (
          <button
            type="button"
            className="secondary home-install-btn"
            onClick={onInstall}
          >
            <DownloadSimple weight="bold" />
            <span>INSTALL APP</span>
          </button>
        )}
      </footer>
    </div>
  );
}
