import { memo, useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Star,
  ArrowRight,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
} from "@phosphor-icons/react";
import {
  COLORS,
  PATH,
  SAFE,
  STARTS,
  HOMES,
  position,
  legalMoves,
  type Game,
  type Color,
} from "../shared/game";

export const PALETTE: Record<Color, string> = {
  red: "#e85050",
  green: "#26966a",
  yellow: "#edbb38",
  blue: "#477ee0",
};
const LIGHT: Record<Color, string> = {
  red: "#fceceb",
  green: "#e4f3eb",
  yellow: "#fcf3d9",
  blue: "#e8effc",
};
function Token({
  game,
  color,
  index,
  step,
  onMove,
  enabled,
  disconnected,
}: {
  game: Game;
  color: Color;
  index: number;
  step: number;
  onMove: (n: number) => void;
  enabled: boolean;
  disconnected: boolean;
}) {
  const reduced = useReducedMotion();
  const [path, setPath] = useState<[number, number][]>([
    position(color, step, index),
  ]);
  useEffect(() => {
    const m = game.lastMove;
    if (
      m?.color === color &&
      m.token === index &&
      m.to === step &&
      m.from >= 0 &&
      !reduced
    ) {
      setPath(
        Array.from({ length: m.to - m.from + 1 }, (_, i) =>
          position(color, m.from + i, index),
        ),
      );
    } else setPath([position(color, step, index)]);
    // A room chat update must not replay the last movement animation.
  }, [game.revision, color, index, step, reduced]);
  const stack = game.seats
    .flatMap((s) =>
      s ? s.tokens.map((t, i) => ({ color: s.color, t, i })) : [],
    )
    .filter((t) => {
      const a = position(t.color, t.t, t.i),
        b = position(color, step, index);
      return a[0] === b[0] && a[1] === b[1];
    });
  const order = stack.findIndex((t) => t.color === color && t.i === index),
    offset = stack.length > 1 ? (order - (stack.length - 1) / 2) * 0.85 : 0;
  return (
    <motion.button
      className={`token ${color} ${enabled ? "selectable" : ""} ${step === 56 ? "finished-token" : ""} ${disconnected ? "disconnected-token" : ""}`}
      aria-label={`${color} token ${index + 1}${step < 0 ? ", in yard" : step === 56 ? ", finished" : `, space ${step}`}${enabled ? ", move available" : ""}${disconnected ? ", player offline" : ""}`}
      disabled={!enabled}
      onClick={() => onMove(index)}
      initial={false}
      animate={{
        left: path.map((p) => `${((p[1] + 0.5) / 15) * 100 + offset}%`),
        top: path.map((p) => `${((p[0] + 0.5) / 15) * 100}%`),
      }}
      transition={{
        duration: reduced
          ? 0
          : Math.min(0.78, Math.max(0.18, (path.length - 1) * 0.11)),
        ease: "easeInOut",
      }}
      style={
        {
          "--token-color": PALETTE[color],
          zIndex: enabled ? 30 : 10 + order,
        } as React.CSSProperties
      }
    >
      <span className="round-token" />
      {enabled && <span className="token-ring" />}
    </motion.button>
  );
}
export const Board = memo(function Board({
  game,
  me,
  onMove,
  busy,
}: {
  game: Game;
  me: string;
  onMove: (n: number) => void;
  busy: boolean;
}) {
  const moves = legalMoves(game),
    current = game.seats[game.turn]!;
  return (
    <div className="board" aria-label="Ludo game board">
      <svg
        className="board-grid"
        viewBox="0 0 480 480"
        role="img"
        aria-label="Classic four-colour Ludo board. Stars mark safe squares."
      >
        <rect width="480" height="480" fill="#fffdf8" />
        {COLORS.map((color, i) => {
          const x = i === 1 || i === 2 ? 288 : 0,
            y = i >= 2 ? 288 : 0;
          return (
            <g key={color}>
              <rect
                x={x}
                y={y}
                width="192"
                height="192"
                fill={PALETTE[color]}
              />
              <rect
                x={x + 30}
                y={y + 30}
                width="132"
                height="132"
                rx="19"
                fill={LIGHT[color]}
              />
              {[0, 1, 2, 3].map((n) => (
                <circle
                  key={n}
                  cx={x + 64 + (n % 2) * 64}
                  cy={y + 64 + Math.floor(n / 2) * 64}
                  r="14"
                  fill={PALETTE[color]}
                  opacity=".17"
                />
              ))}
            </g>
          );
        })}
        {PATH.map(([r, c], i) => {
          const color = STARTS.includes(i) ? COLORS[STARTS.indexOf(i)] : null;
          return (
            <rect
              key={i}
              x={c * 32}
              y={r * 32}
              width="32"
              height="32"
              fill={color ? PALETTE[color] : "#fffdf8"}
              stroke="#9b9f93"
              strokeWidth=".8"
            />
          );
        })}
        {COLORS.map((color, i) =>
          HOMES[i]
            .slice(0, 5)
            .map(([r, c], j) => (
              <rect
                key={`${color}${j}`}
                x={c * 32}
                y={r * 32}
                width="32"
                height="32"
                fill={j === 4 ? PALETTE[color] : LIGHT[color]}
                stroke="#9b9f93"
                strokeWidth=".8"
              />
            )),
        )}
        <path d="M192 192 L240 240 L192 288Z" fill={PALETTE.red} />
        <path d="M192 192 L288 192 L240 240Z" fill={PALETTE.green} />
        <path d="M288 192 L288 288 L240 240Z" fill={PALETTE.yellow} />
        <path d="M192 288 L240 240 L288 288Z" fill={PALETTE.blue} />
        <circle cx="240" cy="240" r="12" fill="#fffdf8" />
        <circle cx="240" cy="240" r="4" fill="#253e37" />
        {[...SAFE]
          .filter((i) => !STARTS.includes(i))
          .map((i) => {
            const [r, c] = PATH[i];
            return (
              <Star
                key={i}
                weight="regular"
                aria-hidden="true"
                className="safe-star"
                x={c * 32 + 7}
                y={r * 32 + 7}
                width={18}
                height={18}
              />
            );
          })}
        {[ArrowRight, ArrowDown, ArrowLeft, ArrowUp].map((Icon, i) => {
          const [r, c] = PATH[STARTS[i]];
          return (
            <Icon
              key={i}
              weight="bold"
              aria-hidden="true"
              className="start-arrow"
              x={c * 32 + 8}
              y={r * 32 + 8}
              width={16}
              height={16}
              color={i === 2 ? "#594719" : "white"}
            />
          );
        })}
      </svg>
      {game.seats.map(
        (s) =>
          s &&
          s.tokens.map((step, i) => (
            <Token
              key={`${s.color}${i}`}
              game={game}
              color={s.color}
              index={i}
              step={step}
              onMove={onMove}
              disconnected={!s.connected && !s.id.startsWith("bot:")}
              enabled={
                !busy && s.id === me && current.id === me && moves.includes(i)
              }
            />
          )),
      )}
    </div>
  );
});
