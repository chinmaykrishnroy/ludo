import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowBendUpLeft,
  ChatCircle,
  Copy,
  Gif,
  PaperPlaneRight,
  Pause,
  Play,
  SpeakerHigh,
  SpeakerSlash,
  X,
} from "@phosphor-icons/react";
import type { Chat, Reply, Room } from "../shared/protocol";
import type { Mention } from "../shared/chat";
import {
  CHAT_MAX_GIF_BYTES,
  CHAT_MAX_TEXT,
  editMentions,
  emojiOnly,
} from "../shared/chat";
import type { Color } from "../shared/game";
import { PALETTE } from "./Board";
import type { VoiceController } from "./useRoomVoice";
import type { ChatController } from "./useRoomChat";

export function RoomTools({
  voice,
  chat,
  online = true,
}: {
  voice: VoiceController;
  chat: ChatController;
  online?: boolean;
}) {
  return (
    <div className="room-tools">
      <button
        className="play-tool"
        aria-label={voice.muted ? "Unmute speakers" : "Mute speakers"}
        aria-pressed={voice.muted}
        title={voice.muted ? "Unmute speakers" : "Mute speakers"}
        onClick={voice.toggleMuted}
      >
        {voice.muted ? (
          <SpeakerSlash weight="bold" />
        ) : (
          <SpeakerHigh weight="bold" />
        )}
      </button>
      {online && (
        <button
          className="play-tool chat-launch"
          aria-label={`Open room chat${chat.unread ? `, ${chat.unread} unread messages` : ""}`}
          title="Room chat"
          onClick={chat.show}
        >
          <ChatCircle weight="bold" />
          {chat.unread > 0 && (
            <span className="chat-badge" aria-hidden="true">
              {chat.unread > 9 ? "9+" : chat.unread}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

function MessageText({ message }: { message: Chat }) {
  const result: ReactNode[] = [];
  let index = 0;
  for (const m of message.mentions ?? []) {
    if (m.start < index || m.end > message.text.length) continue;
    result.push(message.text.slice(index, m.start));
    result.push(
      <strong
        key={`${m.start}:${m.playerId}`}
        className={`chat-mention mention-${m.color}`}
        style={
          {
            "--player-colour": PALETTE[m.color as Color],
          } as React.CSSProperties
        }
      >
        {message.text.slice(m.start, m.end)}
      </strong>,
    );
    index = m.end;
  }
  result.push(message.text.slice(index));
  return <>{result}</>;
}

export default function RoomChat({
  room,
  me,
  chat,
  voice,
  send,
  notify,
  connected,
  notice,
}: {
  room: Room;
  me: string;
  chat: ChatController;
  voice: VoiceController;
  send: (event: string, data: unknown) => Promise<Reply>;
  notify: (text: string) => void;
  connected: boolean;
  notice?: ReactNode;
}) {
  const [text, setText] = useState(""),
    [mentions, setMentions] = useState<Mention[]>([]),
    [reply, setReply] = useState<string | null>(null),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [sending, setSending] = useState(false),
    [query, setQuery] = useState<{
      start: number;
      end: number;
      value: string;
    } | null>(null),
    [highlight, setHighlight] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    feed = useRef<HTMLDivElement>(null),
    pick = useRef<HTMLInputElement>(null),
    nodes = useRef(new Map<string, HTMLElement>()),
    lastTyping = useRef(0),
    typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    copying = useRef<HTMLElement | null>(null),
    gesture = useRef<{
      id: string;
      x: number;
      y: number;
      pointer: number;
    } | null>(null),
    currentRoom = useRef(room.code);
  currentRoom.current = room.code;
  const original = room.chat.find((m) => m.id === reply),
    choices = query
      ? room.seats.filter(
          (s) =>
            s &&
            !s.bot &&
            s.name
              .toLocaleLowerCase()
              .includes(query.value.toLocaleLowerCase()),
        )
      : [];
  const entries = [
    ...room.chat.map((message) => ({ kind: "chat" as const, message })),
    ...room.voices.map((message) => ({ kind: "voice" as const, message })),
  ].sort(
    (a, b) =>
      a.message.at - b.message.at || a.message.id.localeCompare(b.message.id),
  );
  function typing(active: boolean) {
    if (!connected) return;
    if (!active || Date.now() - lastTyping.current > 1800) {
      if (active) lastTyping.current = Date.now();
      else lastTyping.current = 0;
      void send("chat:typing", { active });
    }
    clearTimeout(typingTimer.current);
    if (active)
      typingTimer.current = setTimeout(() => {
        void send("chat:typing", { active: false });
      }, 2500);
  }
  useEffect(() => {
    if (chat.open) {
      dialog.current?.showModal();
      input.current?.focus({ preventScroll: true });
    } else {
      dialog.current?.close();
      typing(false);
    }
  }, [chat.open]);
  useEffect(() => {
    setText("");
    setMentions([]);
    setReply(null);
    setFile(null);
    setQuery(null);
    return () => {
      clearTimeout(typingTimer.current);
      clearTimeout(highlightTimer.current);
    };
  }, [room.code]);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (chat.open && feed.current)
      feed.current.scrollTop = feed.current.scrollHeight;
  }, [chat.open, room.chat.at(-1)?.id, room.voices.at(-1)?.id]);
  function updateQuery(value: string, cursor: number) {
    const match = /(?:^|\s)@([^@\n]{0,24})$/.exec(value.slice(0, cursor));
    setQuery(
      match
        ? { start: cursor - match[1].length - 1, end: cursor, value: match[1] }
        : null,
    );
    setSuggestion(0);
  }
  function chooseMention(player: NonNullable<Room["seats"][number]>) {
    if (!query) return;
    const token = `@${player.name}`,
      next = text.slice(0, query.start) + token + " " + text.slice(query.end);
    if (next.length > CHAT_MAX_TEXT) return;
    const updated = editMentions(text, next, mentions);
    updated.push({
      playerId: player.id,
      name: player.name,
      color: player.color,
      start: query.start,
      end: query.start + token.length,
    });
    setMentions(updated.sort((a, b) => a.start - b.start));
    setText(next);
    setQuery(null);
    chat.activity();
    typing(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        query.start + token.length + 1,
        query.start + token.length + 1,
      );
    });
  }
  function attach(file: File) {
    chat.activity();
    if (file.type !== "image/gif" || file.size > CHAT_MAX_GIF_BYTES) {
      notify("Choose a GIF file up to 1 MB.");
      return;
    }
    setFile(file);
  }
  async function submit() {
    if (sending || !connected || (!text.trim() && !file)) return;
    const code = room.code,
      draft = text,
      attachment = file;
    setSending(true);
    chat.activity();
    typing(false);
    try {
      const gif = attachment ? await attachment.arrayBuffer() : undefined;
      if (currentRoom.current !== code) return;
      const result = await send("chat:send", {
        text: draft,
        ...(reply ? { replyTo: reply } : {}),
        mentions: mentions.map(({ playerId, start, end }) => ({
          playerId,
          start,
          end,
        })),
        ...(gif ? { gif } : {}),
      });
      if (currentRoom.current !== code) return;
      if (!result.ok) {
        notify(result.error ?? "Your message could not be sent.");
        return;
      }
      setText("");
      setMentions([]);
      setReply(null);
      setFile(null);
      setQuery(null);
      chat.activity();
    } catch {
      notify("Your GIF could not be read. Try choosing it again.");
    } finally {
      setSending(false);
    }
  }
  function quote(id: string) {
    setReply(id);
    chat.activity();
    input.current?.focus({ preventScroll: true });
  }
  function jump(id: string) {
    const target = nodes.current.get(id);
    if (!target) {
      notify("The original message is no longer in this room’s history.");
      return;
    }
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlight(id);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 2000);
    chat.activity();
  }
  async function copy(message: Chat, element: HTMLElement) {
    chat.activity();
    if (!message.text) return;
    try {
      await navigator.clipboard.writeText(message.text);
      notify("Message copied.");
    } catch {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      notify("Text selected. Use Copy to copy it.");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="dialog room-chat"
      aria-labelledby="room-chat-title"
      onCancel={(e) => {
        e.preventDefault();
        chat.close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) chat.close();
      }}
    >
      <div
        className="chat-shell"
        onPointerDown={chat.activity}
        onKeyDown={chat.activity}
      >
        <header className="chat-heading">
          <div>
            <h2 id="room-chat-title">TABLE CHAT</h2>
            <small>{room.name}</small>
          </div>
          <button
            className="square-button"
            aria-label="Close room chat"
            onClick={chat.close}
          >
            <X weight="bold" />
          </button>
        </header>
        {voice.needsPlayback && !voice.muted && (
          <button
            className="voice-playback-prompt"
            onClick={() => {
              voice.resumePlayback();
              chat.activity();
            }}
          >
            <Play weight="fill" />
            Play voice messages
          </button>
        )}
        <div
          className="chat-feed"
          ref={feed}
          role="log"
          aria-label="Room messages"
          aria-live="polite"
          onScroll={chat.activity}
        >
          {!entries.length && (
            <p className="chat-empty">Say hello to your table.</p>
          )}
          {entries.map(({ kind, message }) => {
            const own = message.senderId === me,
              m = kind === "chat" ? (message as Chat) : null,
              source = m?.replyTo
                ? room.chat.find((v) => v.id === m.replyTo)
                : null;
            return (
              <article
                key={message.id}
                ref={(node) => {
                  if (node) nodes.current.set(message.id, node);
                  else nodes.current.delete(message.id);
                }}
                className={`chat-entry ${own ? "own" : ""} ${highlight === message.id ? "chat-highlight" : ""}`}
                data-message-id={message.id}
              >
                <span className="chat-author">
                  <i style={{ background: PALETTE[message.color as Color] }} />
                  {own ? "You" : message.name}
                </span>
                {kind === "voice" ? (
                  <button
                    className="chat-voice chat-bubble"
                    aria-label={`${voice.playing === message.id ? "Pause" : "Play"} voice message from ${message.name}`}
                    disabled={voice.muted}
                    onClick={() => {
                      voice.togglePlay(message.id);
                      chat.activity();
                    }}
                  >
                    {voice.playing === message.id ? (
                      <Pause weight="fill" />
                    ) : (
                      <Play weight="fill" />
                    )}
                    <span>
                      {voice.muted ? "Speakers muted" : "Voice message"}
                    </span>
                    <small>
                      {Math.ceil("duration" in message ? message.duration : 0)}s
                    </small>
                  </button>
                ) : (
                  <>
                    <div
                      className={`chat-bubble ${m && emojiOnly(m.text) && !m.gif && !m.replyTo ? "emoji-only" : ""}`}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        const target = e.target as HTMLElement;
                        copying.current = target.closest(".chat-text");
                        if (!copying.current && !target.closest("button"))
                          e.currentTarget.setPointerCapture(e.pointerId);
                        gesture.current = {
                          id: message.id,
                          x: e.clientX,
                          y: e.clientY,
                          pointer: e.pointerId,
                        };
                      }}
                      onPointerUp={(e) => {
                        const g = gesture.current;
                        gesture.current = null;
                        if (
                          !g ||
                          g.pointer !== e.pointerId ||
                          Math.abs(e.clientY - g.y) > 35 ||
                          Math.abs(e.clientX - g.x) < 55
                        )
                          return;
                        if (copying.current && m) void copy(m, copying.current);
                        else quote(message.id);
                      }}
                      onPointerCancel={() => {
                        gesture.current = null;
                      }}
                    >
                      {m?.replyTo && (
                        <button
                          className="quoted-message"
                          aria-label={`Go to original message from ${source?.name ?? "unavailable player"}`}
                          onClick={() => jump(m.replyTo!)}
                        >
                          <strong>
                            {source?.name ?? "Original message unavailable"}
                          </strong>
                          <span>
                            {source
                              ? source.text || "GIF"
                              : "This message is no longer available."}
                          </span>
                        </button>
                      )}
                      {m?.gif && (
                        <img
                          className="chat-gif"
                          src={`/api/chat-media/${m.gif.id}`}
                          width={m.gif.width}
                          height={m.gif.height}
                          alt={`GIF shared by ${m.name}`}
                          loading="lazy"
                          onLoad={() => {
                            if (
                              feed.current &&
                              message.id === entries.at(-1)?.message.id
                            )
                              feed.current.scrollTop =
                                feed.current.scrollHeight;
                          }}
                        />
                      )}
                      {m?.text && (
                        <p className="chat-text">
                          <MessageText message={m} />
                        </p>
                      )}
                      <time>
                        {new Date(message.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <div className="chat-message-tools">
                      <button
                        aria-label={`Reply to ${message.name}`}
                        title="Reply"
                        onClick={() => quote(message.id)}
                      >
                        <ArrowBendUpLeft />
                      </button>
                      {m?.text && (
                        <button
                          aria-label={`Copy message from ${message.name}`}
                          title="Copy text"
                          onClick={(e) => {
                            const element = e.currentTarget
                              .closest("article")
                              ?.querySelector<HTMLElement>(".chat-text");
                            if (element) void copy(m, element);
                          }}
                        >
                          <Copy />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
        <div className="chat-typing" role="status">
          {chat.typing.length > 0
            ? `${chat.typing.map((p) => p.name).join(", ")} ${chat.typing.length > 1 ? "are" : "is"} typing…`
            : !connected
              ? "Reconnecting…"
              : ""}
        </div>
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {reply && (
            <div className="chat-reply-draft">
              <div>
                <strong>
                  Replying to {original?.name ?? "unavailable message"}
                </strong>
                <span>
                  {original?.text ||
                    (original?.gif ? "GIF" : "Original message unavailable")}
                </span>
              </div>
              <button
                type="button"
                aria-label="Cancel reply"
                onClick={() => {
                  setReply(null);
                  chat.activity();
                }}
              >
                <X />
              </button>
            </div>
          )}
          {preview && (
            <div className="chat-attachment">
              <img src={preview} alt="GIF ready to send" />
              <button
                type="button"
                aria-label="Remove GIF"
                onClick={() => {
                  setFile(null);
                  chat.activity();
                }}
              >
                <X />
              </button>
            </div>
          )}
          {query && choices.length > 0 && (
            <div
              className="mention-suggestions"
              id="room-mention-list"
              role="listbox"
              aria-label="Mention a player"
            >
              {choices.map(
                (p, index) =>
                  p && (
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === suggestion}
                      id={`mention-option-${p.id}`}
                      key={p.id}
                      onClick={() => chooseMention(p)}
                    >
                      <i style={{ background: PALETTE[p.color] }} />
                      <strong
                        className="chat-mention"
                        style={
                          {
                            "--player-colour": PALETTE[p.color],
                          } as React.CSSProperties
                        }
                      >
                        {p.name}
                      </strong>
                      {p.id === me && <small>You</small>}
                    </button>
                  ),
              )}
            </div>
          )}
          <div className="chat-input-row">
            <input
              type="file"
              ref={pick}
              accept="image/gif"
              aria-label="Choose GIF file"
              hidden
              disabled={sending}
              onChange={(e) => {
                if (e.target.files?.[0]) attach(e.target.files[0]);
                e.target.value = "";
              }}
            />
            <button
              className="chat-gif-button"
              type="button"
              aria-label="Attach GIF"
              disabled={sending}
              onClick={() => {
                chat.activity();
                pick.current?.click();
              }}
            >
              <Gif size={28} />
            </button>
            <textarea
              ref={input}
              aria-label="Message to room"
              aria-autocomplete="list"
              aria-controls={
                query && choices.length ? "room-mention-list" : undefined
              }
              aria-activedescendant={
                query && choices[suggestion]
                  ? `mention-option-${choices[suggestion]!.id}`
                  : undefined
              }
              placeholder="Message · @ to mention"
              value={text}
              maxLength={CHAT_MAX_TEXT}
              rows={1}
              disabled={sending}
              onChange={(e) => {
                const next = e.target.value;
                setMentions(editMentions(text, next, mentions));
                setText(next);
                updateQuery(next, e.target.selectionStart);
                typing(!!next.trim());
                chat.activity();
              }}
              onSelect={(e) =>
                updateQuery(text, e.currentTarget.selectionStart)
              }
              onKeyDown={(e) => {
                if (
                  query &&
                  choices.length &&
                  (e.key === "ArrowDown" || e.key === "ArrowUp")
                ) {
                  e.preventDefault();
                  setSuggestion(
                    (n) =>
                      (n + (e.key === "ArrowDown" ? 1 : choices.length - 1)) %
                      choices.length,
                  );
                } else if (e.key === "Escape" && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery(null);
                } else if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (query && choices[suggestion])
                    chooseMention(choices[suggestion]!);
                  else void submit();
                }
              }}
              onPaste={(e) => {
                const gif = [...e.clipboardData.files].find(
                  (f) => f.type === "image/gif",
                );
                if (gif) {
                  e.preventDefault();
                  attach(gif);
                }
              }}
            />
            <button
              type="submit"
              className="chat-send"
              aria-label="Send message"
              disabled={sending || !connected || (!text.trim() && !file)}
            >
              <PaperPlaneRight weight="bold" />
            </button>
          </div>
          <small className="chat-footnote">
            {text.length}/{CHAT_MAX_TEXT} · Messages stay with this room
          </small>
        </form>
        {chat.open && notice}
      </div>
    </dialog>
  );
}
