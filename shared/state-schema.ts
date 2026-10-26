import { z } from "zod";
import { COLORS, legalMoves } from "./game.js";
export const token = z.number().int().min(-1).max(56),
  timestamp = z.number().finite().nonnegative();
const seat = z.object({
  botDifficulty: z.number().int().min(0).max(10).optional(),
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(64),
  color: z.enum(COLORS),
  bot: z.boolean(),
  connected: z.boolean(),
  tokens: z.array(token).length(4),
});
export const seatsSchema = z
  .array(seat.nullable())
  .length(4)
  .refine(
    (s) => s.every((p, i) => !p || p.color === COLORS[i]),
    "Seat colours do not match board positions",
  );
export const gameSchema = z
  .object({
    botDifficulty: z.number().int().min(0).max(10).optional(),
    seats: seatsSchema,
    turn: z.number().int().min(0).max(3),
    dice: z.number().int().min(1).max(6).nullable(),
    phase: z.enum(["roll", "move", "finished"]),
    sixes: z.number().int().min(0).max(2),
    winner: z.string().nullable(),
    revision: z.number().int().nonnegative(),
    lastMove: z
      .object({
        color: z.enum(COLORS),
        token: z.number().int().min(0).max(3),
        from: z.number().int().min(-1).max(55),
        to: z.number().int().min(0).max(56),
        captured: z.number().int().min(0).max(12),
      })
      .nullable(),
    notice: z.string().max(512),
    deadline: timestamp,
  })
  .superRefine((g, c) => {
    const active = g.seats.filter((s) => s !== null);
    if (new Set(active.map((s) => s.id)).size !== active.length)
      c.addIssue({ code: "custom", message: "Duplicate player identities" });
    if (!g.seats[g.turn] || g.seats.filter(Boolean).length < 2)
      c.addIssue({ code: "custom", message: "Invalid active seats" });
    else if (g.phase === "move" && !legalMoves(g).length)
      c.addIssue({ code: "custom", message: "No legal move for pending dice" });
    if (
      g.phase === "finished" &&
      (g.seats[g.turn]?.id !== g.winner ||
        !g.seats[g.turn]?.tokens.every((t) => t === 56))
    )
      c.addIssue({ code: "custom", message: "Invalid winner" });
    if (
      g.phase !== "finished" &&
      (g.winner !== null || active.some((s) => s.tokens.every((t) => t === 56)))
    )
      c.addIssue({ code: "custom", message: "Unfinished game has a winner" });
    if (
      g.phase === "move" &&
      ((g.dice === 6 && g.sixes === 0) || (g.dice !== 6 && g.sixes !== 0))
    )
      c.addIssue({ code: "custom", message: "Invalid consecutive six count" });
  });
