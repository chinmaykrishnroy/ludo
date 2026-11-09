import { randomUUID } from "node:crypto";
import {
  REACTION_GAP_MS,
  REACTION_MS,
  REACTION_COOLDOWN_MS,
  DEFAULT_REACTION_STYLE,
  selectBotReaction,
  type BotReaction,
  type EffectActor,
  type ReactionId,
  type ReactionStyle,
  type ReactionCue,
  type RoomEffects,
  type SoundCue,
} from "../shared/effects.js";

type Entry = RoomEffects & {
  recentBots: Map<string, number>;
  reactionTimes: Map<string, number[]>;
  playerCooldowns: Map<string, number>;
  activeReactions: ReactionCue[];
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
      playerCooldowns: new Map(),
      activeReactions: [],
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
    const now = this.now();
    entry.activeReactions = (entry.activeReactions ?? []).filter(
      (r) => r.endsAt > now,
    );
    const visibleReactions = entry.activeReactions.filter((r) =>
      visible(r.actor),
    );
    const latestReaction =
      visibleReactions[visibleReactions.length - 1] ??
      (entry.reaction &&
      visible(entry.reaction.actor) &&
      entry.reaction.endsAt > now
        ? entry.reaction
        : undefined);
    const cooldowns: Record<string, number> = {};
    for (const [id, readyAt] of entry.playerCooldowns.entries()) {
      if (readyAt > now) cooldowns[id] = readyAt;
      else entry.playerCooldowns.delete(id);
    }
    const { sound, soundReadyAt } = entry;
    return {
      room,
      reactionReadyAt: latestReaction
        ? latestReaction.startsAt + REACTION_COOLDOWN_MS
        : 0,
      soundReadyAt,
      cooldowns,
      coolingReaction: latestReaction?.reaction,
      reaction: latestReaction,
      reactions: visibleReactions,
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
    const playerReady = entry.playerCooldowns.get(actor.id) ?? 0;
    if (playerReady > now) return false;
    const startsAt = now + delay;
    const endsAt = startsAt + REACTION_MS;
    const cue: ReactionCue = {
      id: randomUUID(),
      actor,
      reaction,
      style,
      startsAt,
      endsAt,
    };
    entry.activeReactions = (entry.activeReactions ?? [])
      .filter((r) => r.endsAt > now)
      .filter((r) => r.actor.id !== actor.id);
    entry.activeReactions.push(cue);
    entry.reaction = cue;
    const readyAt = startsAt + REACTION_COOLDOWN_MS;
    entry.playerCooldowns.set(actor.id, readyAt);
    entry.reactionReadyAt = readyAt;
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
    entry.playerCooldowns.delete(id);
    entry.activeReactions = (entry.activeReactions ?? []).filter(
      (r) => r.actor.id !== id,
    );
    if (entry.reaction?.actor.id === id) entry.reaction = undefined;
    if (entry.sound?.actor.id === id) entry.sound = undefined;
  }
  bot(room: string, candidates: BotReaction[], delay: number) {
    if (!candidates.length) return false;
    const entry = this.entry(room);
    const now = this.now();
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
