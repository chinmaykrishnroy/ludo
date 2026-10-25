export const COLORS = ["red", "green", "yellow", "blue"] as const;
export const TURN_MS = 60000;
export type Color = (typeof COLORS)[number];
export type Seat = {
  botDifficulty?: number;
  id: string;
  name: string;
  color: Color;
  bot: boolean;
  connected: boolean;
  tokens: number[];
};
export type Game = {
  botDifficulty?: number;
  seats: (Seat | null)[];
  turn: number;
  dice: number | null;
  phase: "roll" | "move" | "finished";
  sixes: number;
  winner: string | null;
  revision: number;
  lastMove: {
    color: Color;
    token: number;
    from: number;
    to: number;
    captured: number;
  } | null;
  notice: string;
  deadline: number;
};
export const PATH: [number, number][] = [
  [6, 1],
  [6, 2],
  [6, 3],
  [6, 4],
  [6, 5],
  [5, 6],
  [4, 6],
  [3, 6],
  [2, 6],
  [1, 6],
  [0, 6],
  [0, 7],
  [0, 8],
  [1, 8],
  [2, 8],
  [3, 8],
  [4, 8],
  [5, 8],
  [6, 9],
  [6, 10],
  [6, 11],
  [6, 12],
  [6, 13],
  [6, 14],
  [7, 14],
  [8, 14],
  [8, 13],
  [8, 12],
  [8, 11],
  [8, 10],
  [8, 9],
  [9, 8],
  [10, 8],
  [11, 8],
  [12, 8],
  [13, 8],
  [14, 8],
  [14, 7],
  [14, 6],
  [13, 6],
  [12, 6],
  [11, 6],
  [10, 6],
  [9, 6],
  [8, 5],
  [8, 4],
  [8, 3],
  [8, 2],
  [8, 1],
  [8, 0],
  [7, 0],
  [6, 0],
];
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const STARTS = [0, 13, 26, 39];
export const HOMES: [number, number][][] = [
  [
    [7, 1],
    [7, 2],
    [7, 3],
    [7, 4],
    [7, 5],
    [7, 6],
  ],
  [
    [1, 7],
    [2, 7],
    [3, 7],
    [4, 7],
    [5, 7],
    [6, 7],
  ],
  [
    [7, 13],
    [7, 12],
    [7, 11],
    [7, 10],
    [7, 9],
    [7, 8],
  ],
  [
    [13, 7],
    [12, 7],
    [11, 7],
    [10, 7],
    [9, 7],
    [8, 7],
  ],
];
const NESTS: [number, number][][] = [
  [
    [1.5, 1.5],
    [1.5, 3.5],
    [3.5, 1.5],
    [3.5, 3.5],
  ],
  [
    [1.5, 10.5],
    [1.5, 12.5],
    [3.5, 10.5],
    [3.5, 12.5],
  ],
  [
    [10.5, 10.5],
    [10.5, 12.5],
    [12.5, 10.5],
    [12.5, 12.5],
  ],
  [
    [10.5, 1.5],
    [10.5, 3.5],
    [12.5, 1.5],
    [12.5, 3.5],
  ],
];
export function position(
  color: Color,
  step: number,
  token = 0,
): [number, number] {
  const i = COLORS.indexOf(color);
  return step < 0
    ? NESTS[i][token]
    : step > 50
      ? HOMES[i][Math.min(step - 51, 5)]
      : PATH[(STARTS[i] + step) % 52];
}
export function seat(
  id: string,
  name: string,
  index: number,
  bot = false,
  botDifficulty?: number,
): Seat {
  return {
    ...(botDifficulty !== undefined ? { botDifficulty } : {}),
    id,
    name,
    color: COLORS[index],
    bot,
    connected: true,
    tokens: [-1, -1, -1, -1],
  };
}
export function newGame(
  seats: (Seat | null)[],
  now = Date.now(),
  botDifficulty = 10,
): Game {
  if (
    !Number.isInteger(botDifficulty) ||
    botDifficulty < 0 ||
    botDifficulty > 10
  )
    throw new Error("Bot difficulty must be an integer from 0 to 10.");
  if (seats.filter(Boolean).length < 2)
    throw new Error("At least two players are needed.");
  const turn = seats.findIndex(Boolean);
  return {
    botDifficulty,
    seats: seats.map((s) =>
      s
        ? {
            ...structuredClone(s),
            ...(s.bot
              ? { botDifficulty: s.botDifficulty ?? botDifficulty }
              : {}),
          }
        : null,
    ),
    turn,
    dice: null,
    phase: "roll",
    sixes: 0,
    winner: null,
    revision: 0,
    lastMove: null,
    notice: `${seats[turn]!.name === "You" ? "Your turn" : `${seats[turn]!.name} starts`}. Roll a six to leave home.`,
    deadline: now + TURN_MS,
  };
}
export function legalMoves(g: Game): number[] {
  if (g.phase !== "move" || !g.dice) return [];
  return g.seats[g.turn]!.tokens.flatMap((t, i) =>
    (t < 0 ? g.dice === 6 : t < 56 && t + g.dice! <= 56) ? [i] : [],
  );
}
function next(g: Game, bonus: boolean, now: number) {
  if (!bonus) {
    do {
      g.turn = (g.turn + 1) % 4;
    } while (!g.seats[g.turn]);
    g.sixes = 0;
  }
  g.phase = "roll";
  g.deadline = now + TURN_MS;
}
function cloneGame(g: Game): Game {
  // Explicitly clone the known rule state; avoids structured-clone overhead in
  // simulations while preserving independent tokens and input immutability.
  return {
    ...g,
    seats: g.seats.map((s) => (s ? { ...s, tokens: [...s.tokens] } : null)),
    lastMove: g.lastMove ? { ...g.lastMove } : null,
  };
}
export function roll(g: Game, value: number, now = Date.now()): Game {
  if (g.phase !== "roll" || !Number.isInteger(value) || value < 1 || value > 6)
    throw new Error("Cannot roll now.");
  const n = cloneGame(g);
  n.dice = value;
  n.lastMove = null;
  n.revision++;
  const player = n.seats[n.turn]!;
  n.sixes = value === 6 ? n.sixes + 1 : 0;
  if (n.sixes === 3) {
    n.notice = `${player.name} rolled three sixes. Turn forfeited.`;
    next(n, false, now);
    return n;
  }
  n.phase = "move";
  n.deadline = now + TURN_MS;
  if (!legalMoves(n).length) {
    n.notice = `${player.name} rolled ${value}. No available moves.`;
    next(n, value === 6, now);
  } else
    n.notice = `${player.name} rolled ${value}. Choose a highlighted token.`;
  return n;
}
export function move(g: Game, token: number, now = Date.now()): Game {
  if (!legalMoves(g).includes(token))
    throw new Error("That token cannot move.");
  const n = cloneGame(g),
    p = n.seats[n.turn]!,
    from = p.tokens[token];
  const to = from < 0 ? 0 : from + n.dice!;
  p.tokens[token] = to;
  let captured = 0;
  if (to <= 50) {
    const absolute = (STARTS[n.turn] + to) % 52;
    if (!SAFE.has(absolute))
      n.seats.forEach((other, i) => {
        if (!other || i === n.turn) return;
        other.tokens.forEach((t, j) => {
          if (t >= 0 && t <= 50 && (STARTS[i] + t) % 52 === absolute) {
            other.tokens[j] = -1;
            captured++;
          }
        });
      });
  }
  n.lastMove = { color: p.color, token, from, to, captured };
  n.revision++;
  n.notice = captured
    ? `${p.name} captured ${captured} token${captured > 1 ? "s" : ""}! Roll again.`
    : to === 56
      ? `${p.name} brought a token home!`
      : `${p.name} moved ${n.dice} spaces.`;
  if (p.tokens.every((t) => t === 56)) {
    n.phase = "finished";
    n.winner = p.id;
    n.notice = `${p.name} wins the table!`;
  } else next(n, n.dice === 6 || captured > 0 || to === 56, now);
  return n;
}
export { botMove } from "./bot.js";
