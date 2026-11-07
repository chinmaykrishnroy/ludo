import { legalMoves, move, type Game, type Seat } from "./game.js";

export const REACTIONS = {
  laugh: { emoji: "😂", label: "Laugh" },
  angry: { emoji: "😡", label: "Angry" },
  celebrate: { emoji: "🎉", label: "Celebrate" },
  plead: { emoji: "🥺", label: "Please" },
  wave: { emoji: "😏", label: "Bye" },
  surprised: { emoji: "😮", label: "Surprised" },
} as const;
export type BaseReactionId = keyof typeof REACTIONS;
export type ReactionId = BaseReactionId | (string & {});
export const REACTION_IDS = Object.keys(REACTIONS) as BaseReactionId[];
export const REACTION_STYLES = ["pop", "burst", "float", "ripple"] as const;
export type ReactionStyle = (typeof REACTION_STYLES)[number];
export const DEFAULT_REACTION_STYLE: Record<string, ReactionStyle> = {
  laugh: "float",
  angry: "pop",
  celebrate: "burst",
  plead: "ripple",
  wave: "float",
  surprised: "pop",
};
export const REACTION_MS = 2100;
export const REACTION_GAP_MS = 1100;
export const REACTION_COOLDOWN_MS = 1000;
export const SOUND_MAX_SECONDS = 15;

export type EffectActor = Pick<Seat, "id" | "name" | "color">;
type Cue = { id: string; actor: EffectActor; startsAt: number; endsAt: number };
export type ReactionCue = Cue & { reaction: ReactionId; style?: ReactionStyle };
export type SoundCue = Cue & { sound: string; title: string; gain: number };
export type RoomEffects = {
  room: string;
  reactionReadyAt: number;
  coolingReaction?: ReactionId;
  soundReadyAt: number;
  reaction?: ReactionCue;
  reactions?: ReactionCue[];
  sound?: SoundCue;
  cooldowns?: Record<string, number>;
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
export type BotReaction = {
  actor: EffectActor;
  reaction: ReactionId;
  alternatives?: ReactionId[];
  observer?: boolean;
  soundCategory?: string;
};
const BOT_REACTION_REST_MS = 7000;

export function selectBotReaction(
  candidates: BotReaction[],
  recent: ReadonlyMap<string, number>,
  now: number,
  random = Math.random,
) {
  const available = candidates.filter(
    ({ actor }) =>
      now - (recent.get(actor.id) ?? -Infinity) >= BOT_REACTION_REST_MS,
  );
  if (!available.length || random() >= 0.82) return;
  const oldest = Math.min(
    ...available.map(({ actor }) => recent.get(actor.id) ?? -Infinity),
  );
  const waiting = available.filter(
    ({ actor }) => (recent.get(actor.id) ?? -Infinity) === oldest,
  );
  const direct = waiting.filter((candidate) => !candidate.observer);
  const pool = direct.length ? direct : waiting;
  const choice = pool[Math.floor(random() * pool.length)];
  const reactions = [choice.reaction, ...(choice.alternatives ?? [])];
  return {
    actor: choice.actor,
    reaction: reactions[Math.floor(random() * reactions.length)],
    soundCategory: choice.soundCategory,
  };
}

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
      choices.push({
        actor: effectActor(actor),
        reaction: "celebrate",
        alternatives: ["laugh", "wave"],
      });
    for (const victim of capturedBots(before, after))
      choices.push({
        actor: effectActor(victim),
        reaction: "angry",
        alternatives: ["surprised", "plead"],
      });
    for (const seat of before.seats.filter(isBot)) {
      if (choices.some(({ actor }) => actor.id === seat.id)) continue;
      choices.push({
        actor: effectActor(seat),
        reaction: "surprised",
        alternatives: ["laugh", "wave"],
        observer: true,
      });
    }
  } else if (
    after.lastMove &&
    (after.lastMove.from < 0 || after.lastMove.to === 56)
  ) {
    const actor = before.seats[before.turn];
    if (isBot(actor))
      choices.push({
        actor: effectActor(actor),
        reaction: "celebrate",
        alternatives: ["wave", "surprised"],
      });
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
      choices.push({ actor, reaction: "plead", alternatives: ["surprised"] });
  }
  return choices;
}
