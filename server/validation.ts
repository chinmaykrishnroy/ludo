import { z } from "zod";
import { COLORS } from "../shared/game.js";
import { gameSchema, seatsSchema } from "../shared/state-schema.js";
import { VOICE_MAX_SECONDS } from "../shared/voice.js";
const timestamp = z.number().finite().nonnegative();
export const roomSchema = z
  .object({
    botDifficulty: z.number().int().min(0).max(10).optional(),
    archived: z.boolean().optional(),
    code: z.string().regex(/^[A-Z2-9]{6}$/),
    name: z.string().min(1).max(64),
    public: z.boolean(),
    host: z.string().min(1).max(100),
    seats: seatsSchema,
    game: gameSchema.nullable(),
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
          replyTo: z.string().max(100).optional(),
          photo: z
            .object({
              id: z.string().uuid(),
              width: z.number().int().min(1).max(1080),
              height: z.number().int().min(1).max(1080),
              mime: z.literal("image/jpeg"),
            })
            .optional(),
          mentions: z
            .array(
              z.object({
                playerId: z.string().max(100),
                name: z.string().max(64),
                color: z.enum(COLORS),
                start: z.number().int().min(0).max(180),
                end: z.number().int().min(1).max(180),
              }),
            )
            .max(10)
            .optional(),
          gif: z
            .object({
              id: z.string().uuid(),
              width: z.number().int().min(1).max(2048),
              height: z.number().int().min(1).max(2048),
            })
            .optional(),
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
