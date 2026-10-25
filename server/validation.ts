import { z } from "zod";
import { COLORS, legalMoves } from "../shared/game.js";
import { VOICE_MAX_SECONDS } from "../shared/voice.js";
const token = z.number().int().min(-1).max(56),
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
const seats = z
  .array(seat.nullable())
  .length(4)
  .refine(
    (s) => s.every((p, i) => !p || p.color === COLORS[i]),
    "Seat colours do not match board positions",
  );
const game = z
  .object({
    botDifficulty: z.number().int().min(0).max(10).optional(),
    seats,
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
    if (!g.seats[g.turn] || g.seats.filter(Boolean).length < 2)
      c.addIssue({ code: "custom", message: "Invalid active seats" });
    else if (g.phase === "move" && !legalMoves(g).length)
      c.addIssue({ code: "custom", message: "No legal move for pending dice" });
    if (
      g.phase === "finished" &&
      !g.seats.some(
        (s) => s?.id === g.winner && s.tokens.every((t) => t === 56),
      )
    )
      c.addIssue({ code: "custom", message: "Invalid winner" });
  });
export const roomSchema = z
  .object({
    botDifficulty: z.number().int().min(0).max(10).optional(),
    archived: z.boolean().optional(),
    code: z.string().regex(/^[A-Z2-9]{6}$/),
    name: z.string().min(1).max(64),
    public: z.boolean(),
    host: z.string().min(1).max(100),
    seats,
    game: game.nullable(),
    voices: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          name: z.string().max(64),
          color: z.enum(COLORS),
          mime: z.enum(["audio/webm", "audio/mp4", "audio/ogg"]),
          duration: z
            .number()
            .min(0.2)
            .max(VOICE_MAX_SECONDS + 0.5),
          senderId: z.string().max(100).optional(),
          at: timestamp,
        }),
      )
      .max(20),
    chat: z
      .array(
        z.object({
          id: z.string().max(100),
          name: z.string().max(64),
          color: z.enum(COLORS),
          text: z.string().max(180),
          senderId: z.string().max(100).optional(),
          at: timestamp,
        }),
      )
      .max(50),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastHumanAt: timestamp,
  })
  .superRefine((r, c) => {
    if (r.game && JSON.stringify(r.seats) !== JSON.stringify(r.game.seats))
      c.addIssue({ code: "custom", message: "Room and game seats differ" });
    const ids = r.seats.filter(Boolean).map((s) => s!.id);
    if (new Set(ids).size !== ids.length)
      c.addIssue({ code: "custom", message: "Duplicate player seat" });
  });
