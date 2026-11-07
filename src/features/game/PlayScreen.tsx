import { DotsThree, ArrowLeft, Eye } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Board, PALETTE } from "./Board";
import Dice from "./Dice";
import { useDicePresentation } from "./useDicePresentation";
import type { VoiceController } from "../../useRoomVoice";
import { RoomTools } from "../../RoomChat";
import type { ChatController } from "../../useRoomChat";
import VoicePanel from "../../VoicePanel";
import { ChatPreviews } from "../chat/ChatPreviews";
import { soleLegalMove, type Game } from "../../../shared/game";
import type { Reply, Room } from "../../../shared/protocol";
import {
  DEFAULT_REACTION_STYLE,
  botReactionCandidates,
  selectBotReaction,
  effectActor,
  REACTION_GAP_MS,
  REACTION_MS,
  REACTION_COOLDOWN_MS,
  type EffectActor,
  type ReactionId,
  type ReactionStyle,
  type ReactionCue,
  type RoomEffects,
} from "../../../shared/effects";
import { ReactionOverlay, TableEffectsControls } from "./TableEffectsControls";
import { useTableSound } from "./useTableSound";
import { playGameSound } from "./gameFeedback";
import { rotationForHome } from "./boardOrientation";

export default function PlayScreen({
  game,
  me,
  room,
  roomEffects,
  send,
  notify,
  busy,
  pending,
  connected,
  onRoll,
  onMove,
  onMenu,
  voice,
  onOnline,
  showVoice = true,
  onBack,
  clockOffset,
  chat,
}: {
  game: Game;
  me: string;
  room: Room | null;
  roomEffects?: RoomEffects;
  send: (event: string, data: unknown) => Promise<Reply>;
  notify: (text: string) => void;
  busy: boolean;
  pending: boolean;
  connected: boolean;
  onRoll: () => void;
  onMove: (n: number) => void;
  onMenu: () => void;
  voice: VoiceController;
  onOnline: () => void;
  showVoice?: boolean;
  onBack: () => void;
  clockOffset: number;
  chat: ChatController;
}) {
  const presentation = useDicePresentation(
    game,
    room?.code ?? "local",
    pending,
  );
  const [now, setNow] = useState(Date.now());
  const [localEffects, setLocalEffects] = useState<RoomEffects>();
  const previousGame = useRef(game);
  const recentBots = useRef(new Map<string, number>());
  const localCueId = useRef(0);
  const tableEffects = room
    ? roomEffects?.room === room.code
      ? roomEffects
      : undefined
    : localEffects;
  const serverNow = now + clockOffset;
  const sound = useTableSound(
    tableEffects?.sound,
    connected ? room?.code : undefined,
    clockOffset,
    voice.muted,
    voice.recording || voice.playing.length > 0,
    voice.mixer,
  );
  const cues =
    tableEffects?.reactions && tableEffects.reactions.length > 0
      ? tableEffects.reactions
      : tableEffects?.reaction
        ? [tableEffects.reaction]
        : [];
  const localCooldowns = useRef<Map<string, number>>(new Map());

  function localReact(
    actor: EffectActor,
    reaction: ReactionId,
    delay = 0,
    style?: ReactionStyle,
  ) {
    const timestamp = Date.now();
    const readyAt = localCooldowns.current.get(actor.id) ?? 0;
    if (readyAt > timestamp) return;
    const startsAt = timestamp + delay;
    const endsAt = startsAt + REACTION_MS;
    const id = String(++localCueId.current);
    const finalStyle =
      style ??
      (reaction in DEFAULT_REACTION_STYLE
        ? DEFAULT_REACTION_STYLE[
            reaction as keyof typeof DEFAULT_REACTION_STYLE
          ]
        : "burst");
    const cue: ReactionCue = {
      id,
      actor,
      reaction,
      style: finalStyle,
      startsAt,
      endsAt,
    };
    const nextReady = startsAt + REACTION_COOLDOWN_MS;
    localCooldowns.current.set(actor.id, nextReady);
    setLocalEffects((current) => {
      const active = (
        current?.reactions ?? (current?.reaction ? [current.reaction] : [])
      ).filter((r) => r.endsAt > timestamp && r.actor.id !== actor.id);
      active.push(cue);
      const cooldownsObj: Record<string, number> = {};
      for (const [k, v] of localCooldowns.current.entries()) {
        if (v > timestamp) cooldownsObj[k] = v;
      }
      return {
        room: "local",
        reactionReadyAt: nextReady,
        cooldowns: cooldownsObj,
        coolingReaction: reaction,
        soundReadyAt: 0,
        reaction: cue,
        reactions: active,
      };
    });
  }
  useEffect(() => {
    const before = previousGame.current;
    previousGame.current = game;
    if (room || game === before || game.revision <= before.revision) {
      if (game.revision < before.revision || room) {
        recentBots.current.clear();
        setLocalEffects(undefined);
      }
      return;
    }
    const timestamp = Date.now();
    if ((localEffects?.reactionReadyAt ?? 0) > timestamp) return;
    const selected = selectBotReaction(
      botReactionCandidates(before, game),
      recentBots.current,
      timestamp,
    );
    if (selected) {
      recentBots.current.set(selected.actor.id, timestamp);
      localReact(selected.actor, selected.reaction, 950);
      if (!voice.muted) {
        setTimeout(() => {
          try {
            const ctx = voice.mixer.unlock();
            if (ctx) {
              const r = selected.reaction;
              if (
                r === "celebrate" ||
                r === "🎉" ||
                r === "🏆" ||
                r === "🔥" ||
                r === "👑"
              ) {
                playGameSound(ctx, "botCheer");
              } else if (
                r === "angry" ||
                r === "plead" ||
                r === "😭" ||
                r === "💔" ||
                r === "🥺"
              ) {
                playGameSound(ctx, "botGroan");
              } else {
                playGameSound(ctx, "botTaunt");
              }
            }
          } catch {
            /* optional sound feedback */
          }
        }, 950);
      }
    }
  }, [game, room, localEffects?.reactionReadyAt]);

  function react(reaction: ReactionId, style: ReactionStyle) {
    if (room) {
      void send("room:reaction", { room: room.code, reaction, style }).then(
        (reply) => {
          if (!reply.ok && reply.code !== "EFFECT_BUSY")
            notify(reply.error ?? "Could not send the reaction.");
        },
      );
      return;
    }
    const player = game.seats.find((seat) => seat?.id === me && !seat.bot);
    if (player) localReact(effectActor(player), reaction, 0, style);
  }
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(
    0,
    Math.ceil((presentation.deadline - (now + clockOffset)) / 1000),
  );
  const inputBusy =
    busy ||
    presentation.active ||
    (!!room && now + clockOffset < (room.actionReadyAt ?? 0));
  const isSpectator = Boolean(
    room && !room.seats.some((seat) => seat?.id === me),
  );
  const current = presentation.actor,
    mine = !isSpectator && current.id === me && !current.bot,
    sharedDevice = !room && game.seats.filter((s) => s && !s.bot).length > 1,
    finished = game.phase === "finished";
  // A shared device stays fixed so a hand-off cannot interrupt a token's move.
  const rotation = sharedDevice
    ? 0
    : rotationForHome(game.seats.find((seat) => seat?.id === me)?.color);
  const speaking = room?.seats.reduce(
    (mask, seat, index) =>
      seat &&
      room.voices.some(
        (clip) =>
          voice.playing.includes(clip.id) &&
          (clip.senderId
            ? clip.senderId === seat.id
            : clip.color === seat.color),
      )
        ? mask | (1 << index)
        : mask,
    0,
  );
  return (
    <div className="game-stage">
      <header className="game-header">
        <button
          className="play-tool header-back"
          onClick={onBack}
          title={
            room
              ? isSpectator
                ? "Exit spectating"
                : "Leave table"
              : "Pause game and return to home"
          }
        >
          <ArrowLeft weight="bold" />
          {room ? (isSpectator ? "EXIT" : "BACK") : "PAUSE"}
        </button>
        {isSpectator && (
          <span className="spectator-header-pill">
            <Eye weight="bold" /> SPECTATING
          </span>
        )}
        <RoomTools voice={voice} chat={chat} online={!!room} />
      </header>
      <main className="play-screen">
        <div
          className="play-board"
          style={
            { "--turn-colour": PALETTE[current.color] } as React.CSSProperties
          }
        >
          <Board
            game={presentation.board}
            me={me}
            onMove={onMove}
            busy={inputBusy || (!connected && !!room)}
            speaking={speaking}
            rotation={rotation}
          />
          {!chat.open && <ChatPreviews messages={chat.previews} />}
          {cues
            .filter((c) => c.startsAt <= serverNow && c.endsAt > serverNow)
            .map((c) => (
              <ReactionOverlay key={c.id} cue={c} rotation={rotation} />
            ))}
          <button
            className="board-menu"
            aria-label="Open game menu"
            title="Game menu"
            onClick={onMenu}
          >
            <DotsThree weight="bold" />
          </button>
        </div>
        <div className={`play-controls ${room ? "with-room-voice" : ""}`}>
          <button
            className={`big-dice-button ${mine ? "your-roll" : ""}`}
            data-turn-color={current.color}
            style={
              {
                "--turn-colour": PALETTE[current.color],
                background: PALETTE[current.color],
                color: current.color === "yellow" ? "#11100e" : "#ffffff",
              } as React.CSSProperties
            }
            disabled={
              !mine ||
              inputBusy ||
              game.phase !== "roll" ||
              (!!room && !connected)
            }
            onClick={() => {
              presentation.begin();
              onRoll();
            }}
            aria-label="Roll dice"
          >
            <span className="dice-turn">
              <i style={{ background: PALETTE[current.color] }} />
              {finished
                ? "GAME OVER"
                : mine
                  ? sharedDevice
                    ? `${current.name.toUpperCase()}’S TURN`
                    : "YOUR TURN"
                  : `${current.name.toUpperCase()}’S TURN`}
            </span>
            <span className="dice-clock" aria-label="Time remaining">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
            </span>
            <Dice
              value={presentation.value}
              rolling={presentation.rolling}
              onSettled={presentation.onSettled}
            />
            <span className="dice-action">
              {isSpectator
                ? "SPECTATING"
                : presentation.rolling || presentation.settling
                  ? "ROLLING"
                  : presentation.result?.phase === "roll"
                    ? "TURN OVER"
                    : game.phase === "move" && mine
                      ? soleLegalMove(game) !== undefined
                        ? "AUTO MOVE"
                        : "PICK TOKEN"
                      : mine
                        ? "ROLL DICE"
                        : "WAITING"}
            </span>
          </button>
          {showVoice && (
            <VoicePanel compact room={room} voice={voice} onOnline={onOnline} />
          )}
          <TableEffectsControls
            room={room?.code}
            actorId={me}
            effects={tableEffects}
            now={serverNow}
            connected={connected}
            muted={voice.muted}
            onReact={react}
            sound={sound}
            send={send}
            notify={notify}
          />
          <span className="sr-only" role="status" aria-live="polite">
            {presentation.active ? `${current.name} is rolling.` : game.notice}
          </span>
        </div>
      </main>
    </div>
  );
}
