import { randomUUID } from "node:crypto";
import {
  REACTION_GAP_MS,
  REACTION_MS,
  DEFAULT_REACTION_STYLE,
  selectBotReaction,
  type BotReaction,
  type EffectActor,
  type ReactionId,
  type ReactionStyle,
  type RoomEffects,
  type SoundCue,
} from "../shared/effects.js";

type Entry = RoomEffects & {
  recentBots: Map<string, number>;
  reactionTimes: Map<string, number[]>;
  pendingBot?: ReturnType<typeof setTimeout>;
};

export class TableEffects {
  private rooms = new Map<string, Entry>();
  constructor(
    private now = Date.now,
    private random = Math.random,
  ) {}

  private entry(room: string): Entry {
    const found = this.rooms.get(room);
    if (found) return found;
    const fresh: Entry = {
      room,
      reactionReadyAt: 0,
      soundReadyAt: 0,
      recentBots: new Map(),
      reactionTimes: new Map(),
    };
    this.rooms.set(room, fresh);
    return fresh;
  }
  view(
    room: string,
    visible: (actor: EffectActor) => boolean = () => true,
  ): RoomEffects | undefined {
    const entry = this.rooms.get(room);
    if (!entry) return;
    const { reaction, sound, reactionReadyAt, soundReadyAt } = entry;
    const now = this.now();
    const visibleReaction =
      reaction && visible(reaction.actor) ? reaction : undefined;
    return {
      room,
      reactionReadyAt,
      soundReadyAt,
      coolingReaction:
        reactionReadyAt > now ? visibleReaction?.reaction : undefined,
      reaction:
        visibleReaction && visibleReaction.endsAt > now
          ? visibleReaction
          : undefined,
      sound:
        sound && sound.endsAt > now && visible(sound.actor) ? sound : undefined,
    };
  }
  react(
    room: string,
    actor: EffectActor,
    reaction: ReactionId,
    delay = 0,
    style: ReactionStyle = DEFAULT_REACTION_STYLE[reaction],
  ) {
    const entry = this.entry(room);
    const now = this.now();
    if (entry.reactionReadyAt > now) return false;
    const startsAt = now + delay;
    const endsAt = startsAt + REACTION_MS;
    entry.reaction = {
      id: randomUUID(),
      actor,
      reaction,
      style,
      startsAt,
      endsAt,
    };
    entry.reactionReadyAt = endsAt + REACTION_GAP_MS;
    return true;
  }
  sound(
    room: string,
    actor: EffectActor,
    clip: Pick<SoundCue, "sound" | "title" | "gain">,
    duration: number,
  ) {
    const entry = this.entry(room);
    const now = this.now();
    if (entry.soundReadyAt > now) return false;
    const endsAt = now + Math.ceil(duration * 1000) + 500;
    entry.sound = { ...clip, id: randomUUID(), actor, startsAt: now, endsAt };
    entry.soundReadyAt = endsAt;
    return true;
  }
  removeActor(room: string, id: string) {
    const entry = this.rooms.get(room);
    if (!entry) return;
    entry.reactionTimes.delete(id);
    if (entry.reaction?.actor.id === id) entry.reaction = undefined;
    if (entry.sound?.actor.id === id) entry.sound = undefined;
  }
  bot(room: string, candidates: BotReaction[], delay: number) {
    if (!candidates.length) return false;
    const entry = this.entry(room);
    const now = this.now();
    if (entry.reactionReadyAt > now) return false;
    const choice = selectBotReaction(
      candidates,
      entry.recentBots,
      now,
      this.random,
    );
    if (!choice) return false;
    if (!this.react(room, choice.actor, choice.reaction, delay)) return false;
    entry.recentBots.set(choice.actor.id, now);
    return true;
  }
  afterRepeatedReactions(
    room: string,
    guest: string,
    candidates: BotReaction[],
    active: () => BotReaction[],
    publish: () => void,
  ) {
    if (!candidates.length) return;
    const entry = this.entry(room);
    const now = this.now();
    const recent = [
      ...(entry.reactionTimes.get(guest) ?? [])
        .filter((at) => now - at < 22000)
        .slice(-2),
      now,
    ];
    entry.reactionTimes.set(guest, recent);
    if (recent.length < 3 || entry.pendingBot) return;
    entry.reactionTimes.delete(guest);
    entry.pendingBot = setTimeout(
      () => {
        entry.pendingBot = undefined;
        const current = active();
        if (this.bot(room, current, 0)) publish();
      },
      entry.reactionReadyAt - now + 80,
    );
    entry.pendingBot.unref();
  }
  delete(room: string) {
    clearTimeout(this.rooms.get(room)?.pendingBot);
    this.rooms.delete(room);
  }
  clear() {
    for (const room of this.rooms.keys()) this.delete(room);
  }
}
