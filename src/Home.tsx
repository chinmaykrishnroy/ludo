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
import { newGame, seat, COLORS } from "../shared/game";
import { useId } from "react";
import { formatCount } from "./formatCount";
const preview = newGame(
  COLORS.map((_, i) => seat(`preview-${i}`, COLORS[i], i, true)),
);
preview.seats[0]!.tokens = [0, 8, -1, -1];
preview.seats[1]!.tokens = [4, -1, -1, -1];
preview.seats[2]!.tokens = [1, 12, -1, -1];
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
            <Board game={preview} me="none" onMove={() => {}} busy />
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
