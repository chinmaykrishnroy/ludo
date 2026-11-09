import { z } from "zod";

/** Room code schema: 6 uppercase alphanumeric characters excluding ambiguous letters */
export const RoomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z2-9]{6}$/, "Room code must be 6 alphanumeric characters");

/** Player display name */
export const PlayerNameSchema = z
  .string()
  .trim()
  .min(1, "Name cannot be empty")
  .max(24, "Name must be 24 characters or less")
  .regex(/^[\p{L}\p{N} ._'’-]+$/u, "Name contains unsupported characters");

/** Room name / title */
export const RoomTitleSchema = z
  .string()
  .trim()
  .min(1, "Room name cannot be empty")
  .max(24, "Room name must be 24 characters or less");

/** Bot difficulty level: integer from 0 to 10 */
export const BotDifficultySchema = z.number().int().min(0).max(10);

/** room:create event payload */
export const RoomCreateSchema = z.object({
  name: RoomTitleSchema,
  playerName: PlayerNameSchema,
  public: z.boolean().default(false),
  bots: z.number().int().min(0).max(3).default(0),
  botDifficulty: BotDifficultySchema.optional(),
  finishMode: z.enum(["first", "all"]).default("first"),
});
export type RoomCreatePayload = z.infer<typeof RoomCreateSchema>;

/** room:join event payload */
export const RoomJoinSchema = z.object({
  code: RoomCodeSchema,
  playerName: PlayerNameSchema,
});
export type RoomJoinPayload = z.infer<typeof RoomJoinSchema>;

/** room:leave event payload */
export const RoomLeaveSchema = z.object({
  code: RoomCodeSchema.optional(),
});
export type RoomLeavePayload = z.infer<typeof RoomLeaveSchema>;

/** room:kick event payload */
export const RoomKickSchema = z.object({
  seat: z.number().int().min(0).max(3),
});
export type RoomKickPayload = z.infer<typeof RoomKickSchema>;

/** room:typing event payload */
export const RoomTypingSchema = z.object({
  active: z.boolean(),
});
export type RoomTypingPayload = z.infer<typeof RoomTypingSchema>;

/** rooms:list event payload */
export const RoomsListSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(20).default(8),
});
export type RoomsListPayload = z.infer<typeof RoomsListSchema>;

/** bot:add event payload */
export const BotAddSchema = z.object({
  seat: z.number().int().min(0).max(3),
  botDifficulty: BotDifficultySchema.optional(),
});
export type BotAddPayload = z.infer<typeof BotAddSchema>;

/** bot:remove event payload */
export const BotRemoveSchema = z.object({
  seat: z.number().int().min(0).max(3),
});
export type BotRemovePayload = z.infer<typeof BotRemoveSchema>;

/** bot:difficulty event payload */
export const BotChangeDifficultySchema = z.object({
  seat: z.number().int().min(0).max(3),
  difficulty: BotDifficultySchema,
});
export type BotChangeDifficultyPayload = z.infer<
  typeof BotChangeDifficultySchema
>;

/** game:start event payload */
export const GameStartSchema = z.object({
  revision: z.number().int().nonnegative().optional(),
});
export type GameStartPayload = z.infer<typeof GameStartSchema>;

/** game:roll event payload (with idempotency support via revision) */
export const GameRollSchema = z.object({
  revision: z.number().int().nonnegative(),
  idempotencyKey: z.string().max(64).optional(),
});
export type GameRollPayload = z.infer<typeof GameRollSchema>;

/** game:move event payload (with idempotency support via revision) */
export const GameMoveSchema = z.object({
  revision: z.number().int().nonnegative(),
  token: z.number().int().min(0).max(3),
  idempotencyKey: z.string().max(64).optional(),
});
export type GameMovePayload = z.infer<typeof GameMoveSchema>;

/** chat:send event payload */
export const ChatSendSchema = z.object({
  text: z.string().max(180),
  replyTo: z.string().max(100).optional(),
  gif: z
    .object({
      id: z.string().uuid(),
      width: z.number().int().min(1).max(2048),
      height: z.number().int().min(1).max(2048),
    })
    .optional(),
  photo: z
    .object({
      id: z.string().uuid(),
      width: z.number().int().min(1).max(1080),
      height: z.number().int().min(1).max(1080),
      mime: z.literal("image/jpeg"),
    })
    .optional(),
});
export type ChatSendPayload = z.infer<typeof ChatSendSchema>;
