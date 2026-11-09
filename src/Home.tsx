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
import { BouncyDie } from "./components/BouncyDie";
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
  const id = useId();
  const count = formatCount(value);
  return (
    <div className="telemetry-item">
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
          <strong aria-hidden="true" className="telemetry-value">
            {count.compact}
          </strong>
        </summary>
        <span className="stat-tooltip" id={id} role="tooltip">
          {count.exact}
        </span>
      </details>
      <span className="telemetry-label">{label}</span>
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
  const [lastRoll, setLastRoll] = useState<number>(6);
  const [actionText, setActionText] = useState<string>("Milo is ready");
  const [isRolling, setIsRolling] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

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

          const currentBot = BOT_ROSTER[current.turn] ?? BOT_ROSTER[0];

          if (current.phase === "roll") {
            const dice = Math.floor(Math.random() * 6) + 1;
            setLastRoll(dice);
            setIsRolling(true);
            setTimeout(() => setIsRolling(false), 550);
            setActionText(`${currentBot.name} rolled ${dice}!`);

            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("ludo:dice-roll", {
                  detail: { value: dice, color: PALETTE[currentBot.color] },
                }),
              );
            }

            return roll(current, dice);
          }

          if (current.phase === "move") {
            const legal = legalMoves(current);
            if (!legal.length) return current;
            let bestToken = legal[0];
            let captured = false;
            for (const t of legal) {
              try {
                const nextState = move(current, t);
                if (nextState.lastMove?.captured) {
                  bestToken = t;
                  captured = true;
                  break;
                }
              } catch {
                // Ignore test move error
              }
            }
            if (captured) {
              setActionText(`${currentBot.name} captured a token! ⚔️`);
            } else {
              setActionText(`${currentBot.name} advances 🚀`);
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

  const activeSeatIndex = demoGame.turn;
  const activeBot = BOT_ROSTER[activeSeatIndex] ?? BOT_ROSTER[0];
  const activeColor = activeBot.color;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (window.innerWidth < 900) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: -py * 16, y: px * 16 });
  };

  const handlePointerLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  return (
    <div className="home-page">
      {/* Interactive GPU Kinetic Particle & Floating 3D Dice Canvas */}
      <KineticBackground />

      {/* Atmospheric Multi-Hue Dynamic Underglow */}
      <div
        className="home-aurora-glow"
        aria-hidden="true"
        style={
          { "--active-color": PALETTE[activeColor] } as React.CSSProperties
        }
      />

      <section className="home-hero">
        {/* Left Column (Desktop) / Ordered Elements (Mobile) */}
        <div className="home-copy">
          <div className="home-copy-header">
            <div className="home-kicker-beacon">
              <span className="beacon-pulse" aria-hidden="true" />
              <span className="home-kicker-text">
                LIVE MULTIPLAYER • NO SIGN-UP
              </span>
              <Sparkle weight="fill" className="kicker-sparkle" />
            </div>

            <h1 className="home-headline">
              <span className="headline-lead">BIG MOVES.</span>
              <span className="headline-accent home-highlight">
                SAVAGE GRUDGES.
              </span>
            </h1>

            <p className="home-subhead">
              The classic board game elevated for fast competitive tables, live
              voice banter, and smart AI bots. Jump into a match in 2 seconds.
            </p>
          </div>

          {/* High-Tactility CTA Buttons */}
          <div className="home-actions-wrapper">
            <div className="home-actions">
              <button
                type="button"
                className="primary home-btn-primary"
                onClick={onOnline}
              >
                <span className="btn-label-group">
                  <Users weight="bold" className="btn-main-icon" />
                  <span className="btn-text">PLAY WITH FRIENDS</span>
                </span>
                <span className="btn-icon-circle">
                  <ArrowUpRight weight="bold" />
                </span>
              </button>

              <button
                type="button"
                className="secondary home-btn-secondary"
                onClick={onOffline}
              >
                <span className="btn-label-group">
                  <Robot weight="bold" className="btn-main-icon" />
                  <span className="btn-text">PLAY OFFLINE</span>
                </span>
                <span className="btn-icon-circle">
                  <ArrowRight weight="bold" />
                </span>
              </button>
            </div>

            {/* Feature Perks Bar */}
            <div className="home-perks-row">
              <span className="perk-pill">
                <Lightning weight="fill" className="perk-icon" /> Instant Tables
              </span>
              <span className="perk-pill">
                <Microphone weight="fill" className="perk-icon" /> Spatial Voice
              </span>
              <span className="perk-pill">
                <Robot weight="fill" className="perk-icon" /> 10 Bot Levels
              </span>
            </div>
          </div>
        </div>

        {/* 3D Board Stadium Showcase with Interactive Tilt & Live Dice */}
        <div
          ref={containerRef}
          className="home-stage-container"
          aria-hidden="true"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <div
            className="home-board-showcase"
            style={{
              transform: `perspective(1000px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
            }}
          >
            {/* Live Match Turn Badges & Bouncy Action Callout */}
            <div className="showcase-header-bar">
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
                      <span className="hud-turn-pill">TURN</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Live Action Ticker with Animated Bouncy Die */}
              <div className="showcase-live-action">
                <BouncyDie
                  value={lastRoll}
                  isRolling={isRolling}
                  color={PALETTE[activeColor]}
                  pipColor="#ffffff"
                  size={26}
                  interactive
                  onRoll={(newVal) => {
                    setLastRoll(newVal);
                    setActionText(`Rolled ${newVal}!`);
                  }}
                />
                <span className="action-pill-text">{actionText}</span>
              </div>
            </div>

            {/* Stadium Double-Bezel Enclosure with Specular Top Sheen */}
            <div
              className="home-board-enclosure"
              style={
                {
                  "--glow-color": PALETTE[activeColor],
                } as React.CSSProperties
              }
            >
              <div className="board-sheen-overlay" />
              <div className="home-board-card">
                <Board game={demoGame} me="none" onMove={() => {}} busy />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Integrated Live Telemetry HUD Strip */}
      <section
        className="home-stat-section"
        aria-label="Live online game statistics"
      >
        <div className="home-stat-heading">
          <span className="stat-live-badge">
            <span className="pulse-dot" /> LIVE FROM THE CLUB
          </span>
          <small className="stat-subtitle">
            Real games • Real rolls • Updated live
          </small>
        </div>

        <div className="home-stats">
          <StatCounter value={stats?.gamesStarted} label="GAMES STARTED" />
          <StatCounter value={stats?.diceRolls} label="DICE ROLLED" />
          <StatCounter value={stats?.gamesFinished} label="RIVALRIES SETTLED" />
        </div>
      </section>

      {/* Footer Strip */}
      <footer className="home-footer">
        <div className="home-footer-left">
          <strong className="home-footer-tagline">
            SAME BOARD. YOUR KIND OF COMPANY.
          </strong>
          <span className="footer-dot">•</span>
          <button
            type="button"
            className="text-button home-rules-link"
            onClick={onRules}
          >
            New to the table? House rules <ArrowUpRight weight="bold" />
          </button>
        </div>
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
