import { legalMoves, move, type Game, type Seat } from "./game.js";

export const REACTIONS = {
  laugh: { emoji: "😂", label: "Laugh" },
  angry: { emoji: "😡", label: "Angry" },
  celebrate: { emoji: "🎉", label: "Celebrate" },
  plead: { emoji: "🥺", label: "Please" },
  wave: { emoji: "👋", label: "Wave" },
  surprised: { emoji: "😮", label: "Surprised" },
} as const;
export type ReactionId = keyof typeof REACTIONS;
export const REACTION_IDS = Object.keys(REACTIONS) as ReactionId[];
export const REACTION_STYLES = ["pop", "burst", "float", "ripple"] as const;
export type ReactionStyle = (typeof REACTION_STYLES)[number];
export const DEFAULT_REACTION_STYLE: Record<ReactionId, ReactionStyle> = {
  laugh: "float",
  angry: "pop",
  celebrate: "burst",
  plead: "ripple",
  wave: "float",
  surprised: "pop",
};
export const REACTION_MS = 2100;
export const REACTION_GAP_MS = 1100;
export const SOUND_MAX_SECONDS = 15;

export type EffectActor = Pick<Seat, "id" | "name" | "color">;
type Cue = { id: string; actor: EffectActor; startsAt: number; endsAt: number };
export type ReactionCue = Cue & { reaction: ReactionId; style?: ReactionStyle };
export type SoundCue = Cue & { sound: string; title: string; gain: number };
export type RoomEffects = {
  room: string;
  reactionReadyAt: number;
  soundReadyAt: number;
  reaction?: ReactionCue;
  sound?: SoundCue;
};
export type SoundCatalog = {
  categories: { id: string; label: string }[];
  clips: {
    id: string;
    label: string;
    categories: string[];
    duration: number;
  }[];
};
export type BotReaction = { actor: EffectActor; reaction: ReactionId };

export function effectActor(seat: Seat): EffectActor {
  return { id: seat.id, name: seat.name, color: seat.color };
}

function isBot(seat: Seat | null | undefined): seat is Seat {
  return (
    !!seat?.bot && (seat.id.startsWith("bot:") || seat.id.startsWith("cpu-"))
  );
}

function capturedBots(before: Game, after: Game) {
  return before.seats.flatMap((seat, index) => {
    const next = after.seats[index];
    return isBot(seat) &&
      next?.id === seat.id &&
      seat.tokens.some((step, token) => step >= 0 && next.tokens[token] === -1)
      ? [seat]
      : [];
  });
}

export function botReactionCandidates(
  before: Game,
  after: Game,
): BotReaction[] {
  if (after.revision !== before.revision + 1) return [];
  const choices: BotReaction[] = [];
  if (after.lastMove?.captured) {
    const actor = before.seats[before.turn];
    if (isBot(actor))
      choices.push({ actor: effectActor(actor), reaction: "celebrate" });
    for (const victim of capturedBots(before, after))
      choices.push({ actor: effectActor(victim), reaction: "angry" });
  } else if (
    before.phase === "roll" &&
    after.phase === "move" &&
    !after.seats[after.turn]?.bot
  ) {
    const threatened = new Map<string, EffectActor>();
    for (const token of legalMoves(after)) {
      for (const victim of capturedBots(after, move(after, token)))
        threatened.set(victim.id, effectActor(victim));
    }
    for (const actor of threatened.values())
      choices.push({ actor, reaction: "plead" });
  }
  return choices;
}
