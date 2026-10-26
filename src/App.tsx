import {
  useCallback,
  useId,
  useSyncExternalStore,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import {
  DiceFive,
  Users,
  Question,
  GearSix,
  ArrowUpRight,
  ArrowRight,
  Plus,
  GlobeHemisphereWest,
  LockSimple,
  X,
  Copy,
  Check,
  Robot,
  Play,
  ShieldCheck,
  ArrowCounterClockwise,
  SignOut,
  Trophy,
  CircleNotch,
  CaretLeft,
  CaretRight,
} from "@phosphor-icons/react";
import { PALETTE } from "./Board";
import PlayScreen from "./PlayScreen";
import { useAppearance, type Appearance } from "./useAppearance";
import Home, { type ClubStats } from "./Home";
import { useInstall } from "./useInstall";
import { browserStorage } from "./storage";
import { loadPractice, savePractice } from "./persistence";
import { loadDisplayName, rememberDisplayName } from "./profile";
import { requestOfflineMove } from "./offlineAi";
import VoicePanel from "./VoicePanel";
import { useRoomVoice } from "./useRoomVoice";
import {
  COLORS,
  seat,
  newGame,
  roll,
  move,
  legalMoves,
  type Game,
} from "../shared/game";
import type { Room, Reply, PublicRoom } from "../shared/protocol";

const LOCAL_ID = "local-you";
function practice(
  name = "You",
  bots = 3,
  difficulty = 10,
  levels: number[] = [],
) {
  const seats = [seat(LOCAL_ID, name, 0), null, null, null];
  const indexes = bots === 1 ? [2] : bots === 2 ? [1, 2] : [1, 2, 3];
  for (const [j, i] of indexes.entries())
    seats[i] = seat(
      `cpu-${i}`,
      ["", "Milo", "Sunny", "Coco"][i],
      i,
      true,
      levels[j] ?? difficulty,
    );
  return newGame(seats, Date.now(), difficulty);
}
function passAndPlay(name: string, count: number) {
  const arranged: (ReturnType<typeof seat> | null)[] = [null, null, null, null];
  for (let i = 0; i < count; i++) {
    const index = count === 2 && i === 1 ? 2 : i;
    arranged[index] = seat(
      i === 0 ? LOCAL_ID : `local-human-${i}`,
      i === 0 ? name : `Player ${i + 1}`,
      index,
    );
  }
  return newGame(arranged);
}
function randomDice() {
  const a = new Uint32Array(1);
  do {
    crypto.getRandomValues(a);
  } while (a[0] >= 4294967292);
  return (a[0] % 6) + 1;
}
function Dialog({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`dialog ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current!.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            closeRef.current();
        }
      }}
    >
      <div className="dialog-head">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function BotDifficulty({
  value,
  onChange,
  disabled = false,
  label = "Bot difficulty",
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <label className="field-label">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {Array.from({ length: 11 }, (_, level) => (
          <option key={level} value={level}>
            {level}
            {level === 0
              ? " — First legal move"
              : level === 10
                ? " — Expert"
                : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
function RoomBrowser({
  send,
  notify,
  onClose,
  name,
  setName,
  online,
  publicEnabled,
  botDifficulty,
  setBotDifficulty,
}: {
  send: (e: string, d: unknown) => Promise<Reply>;
  notify: (s: string) => void;
  onClose: () => void;
  name: string;
  setName: (name: string) => void;
  online: boolean;
  publicEnabled: boolean;
  botDifficulty: number;
  setBotDifficulty: (value: number) => void;
}) {
  const [tab, setTab] = useState<"create" | "join" | "public">(
      new URLSearchParams(location.search).has("room") ? "join" : "create",
    ),
    [title, setTitle] = useState("The good company"),
    [isPublic, setPublic] = useState(false),
    [bots, setBots] = useState(0),
    [code, setCode] = useState(
      new URLSearchParams(location.search).get("room") ?? "",
    ),
    [list, setList] = useState<PublicRoom[]>([]),
    [page, setPage] = useState(1),
    [roomPage, setRoomPage] = useState({
      page: 1,
      pageSize: 8,
      total: 0,
      pages: 1,
    }),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const listRequest = useRef(0),
    listArea = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true);
    const r = await send("rooms:list", { page, pageSize: 8 });
    if (request !== listRequest.current) return;
    setLoading(false);
    if (r.ok) {
      setList(r.rooms ?? []);
      if (r.roomPage) {
        setRoomPage(r.roomPage);
        if (r.roomPage.page !== page) setPage(r.roomPage.page);
      }
    }
  }, [send, page]);
  useEffect(() => {
    listArea.current?.scrollTo({ top: 0 });
  }, [roomPage.page]);
  useEffect(() => {
    if (tab !== "public") return;
    void refresh();
    const t = setInterval(() => void refresh(), 7000);
    return () => {
      clearInterval(t);
      listRequest.current++;
    };
  }, [tab, refresh]);
  async function join(joinCode = code) {
    setBusy(true);
    const r = await send("room:join", {
      code: joinCode.trim().toUpperCase(),
      playerName: name,
    });
    setBusy(false);
    if (r.ok) {
      onClose();
      history.replaceState(null, "", location.pathname);
    } else notify(r.error ?? "Unable to join.");
  }
  return (
    <Dialog
      title="PLAY ONLINE"

      onClose={onClose}
    >
      <p className="dialog-intro">Create a room or join your friends.</p>
      <div className="tab-bar">
        {(["create", "join", "public"] as const).map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            disabled={t === "public" && !publicEnabled}
            onClick={() => setTab(t)}
          >
            {t === "create"
              ? "Create room"
              : t === "join"
                ? "Join with code"
                : "Public tables"}
          </button>
        ))}
      </div>
      <label className="field-label">
        Your name
        <input
          autoComplete="nickname"
          maxLength={24}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What should we call you?"
        />
      </label>
      {!online && (
        <p className="inline-warning">Connecting to the room server…</p>
      )}
      {tab === "create" ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await send("room:create", {
              name: title,
              playerName: name,
              public: isPublic,
              bots,
              botDifficulty,
            });
            setBusy(false);
            if (r.ok) onClose();
            else notify(r.error ?? "Unable to create room.");
          }}
        >
          <label className="field-label">
            Room name
            <input
              maxLength={24}
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="privacy-options">
            <button
              type="button"
              className={!isPublic ? "chosen" : ""}
              onClick={() => setPublic(false)}
            >
              <LockSimple />
              <strong>Private room</strong>
              <small>Just you and your invitees</small>
              {!isPublic && <Check />}
            </button>
            <button
              type="button"
              className={isPublic ? "chosen" : ""}
              onClick={() => setPublic(true)}
              disabled={!publicEnabled}
            >
              <GlobeHemisphereWest />
              <strong>Public room</strong>
              <small>Anyone can pull up a chair</small>
              {isPublic && <Check />}
            </button>
          </div>
          <label className="field-label">
            Computer players to start
            <select
              value={bots}
              onChange={(e) => setBots(Number(e.target.value))}
            >
              <option value={0}>None — keep the seats open</option>
              <option value={1}>1 computer player</option>
              <option value={2}>2 computer players</option>
              <option value={3}>3 computer players</option>
            </select>
          </label>
          <p className="field-note">
            You can add or remove computer players before starting. Friends can
            also take a computer’s seat.
          </p>
          {bots > 0 && (
            <BotDifficulty value={botDifficulty} onChange={setBotDifficulty} />
          )}
          <button
            className="primary full"
            disabled={busy || !online || !name.trim()}
          >
            {busy ? <CircleNotch className="spin" /> : <Plus />} Create room{" "}
            <ArrowRight />
          </button>
        </form>
      ) : tab === "join" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <label className="field-label">
            Six-character room code
            <input
              className="code-input"
              placeholder="ABC234"
              minLength={6}
              maxLength={6}
              value={code}
              required
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          <button
            className="primary full"
            disabled={busy || !online || !name.trim() || code.length !== 6}
          >
            Join the table <ArrowRight />
          </button>
        </form>
      ) : (
        <div className="public-list">
          <div className="public-list-heading">
            <span>
              Open tables <small>{roomPage.total} available</small>
            </span>
            <button
              className="text-button"
              disabled={!online || loading}
              onClick={() => void refresh()}
            >
              Refresh <ArrowCounterClockwise />
            </button>
          </div>
          {list.length ? (
            <>
              <div
                className="public-room-scroll"
                ref={listArea}
                role="region"
                aria-label="Available public rooms"
                tabIndex={0}
                aria-busy={loading}
              >
                {list.map((r) => (
                  <button
                    key={r.code}
                    className="public-room"
                    disabled={busy || !online || !name.trim()}
                    onClick={() => void join(r.code)}
                  >
                    <span className="room-mini">
                      <DiceFive />
                    </span>
                    <span>
                      <strong>{r.name}</strong>
                      <small>
                        {r.players} of 4 players · {r.bots} computer
                        {r.bots === 1 ? "" : "s"}
                      </small>
                    </span>
                    <ArrowRight />
                  </button>
                ))}
              </div>
              <nav className="room-pagination" aria-label="Public room pages">
                <button
                  className="secondary"
                  aria-label="Previous room page"
                  disabled={loading || page <= 1 || !online}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <CaretLeft /> Previous
                </button>
                <span aria-live="polite">
                  Page {roomPage.page} of {roomPage.pages}
                </span>
                <button
                  className="secondary"
                  aria-label="Next room page"
                  disabled={loading || page >= roomPage.pages || !online}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next <CaretRight />
                </button>
              </nav>
            </>
          ) : (
            <div className="empty-tables">
              <Users size={38} weight="light" />
              <h3>A seat for something new.</h3>
              <p>
                No public tables right now. Create one and let the good company
                come to you.
              </p>
              <button
                className="secondary"
                onClick={() => {
                  setPublic(true);
                  setTab("create");
                }}
              >
                Create a public table <Plus />
              </button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
function Rules({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="A classic for a reason."
      eyebrow="HOW TO PLAY"
      onClose={onClose}
    >
      <div className="rules-list">
        {[
          [
            "01",
            "Make your entrance",
            "Roll a six to move a token from the yard onto your starting square.",
          ],
          [
            "02",
            "Find your way home",
            "Move clockwise around the board, then up your colour’s home lane. Choose a highlighted token after rolling.",
          ],
          [
            "03",
            "A little friendly rivalry",
            "Land on an opponent to send their tokens to the yard. Star squares and coloured starting squares are safe. Tokens may share squares; stacks do not block movement.",
          ],
          [
            "04",
            "Keep a good thing going",
            "Rolling a six, capturing a token, or finishing a token earns another roll. Three consecutive sixes forfeit that roll and end your turn.",
          ],
          [
            "05",
            "Bring the whole team home",
            "You need the exact number to finish. Bring all four tokens home first to win. No capture is required to enter the home lane.",
          ],
        ].map(([n, t, d]) => (
          <div key={n}>
            <span>{n}</span>
            <section>
              <h3>{t}</h3>
              <p>{d}</p>
            </section>
          </div>
        ))}
      </div>
      <div className="rule-note">
        <ShieldCheck />
        <p>
          Each human has 60 seconds to roll, then 60 seconds to choose a token.
          If time runs out, the game rolls automatically or moves the first
          legal token. Your seat stays saved until you explicitly quit.
        </p>
      </div>
    </Dialog>
  );
}

export default function App() {
  const storageUnavailable = useSyncExternalStore(
    browserStorage.subscribe,
    browserStorage.unavailable,
    () => false,
  );
  const [storageDismissed, setStorageDismissed] = useState(false);
  const [name, setName] = useState(() => loadDisplayName(browserStorage));
  const [botDifficulty, setBotDifficulty] = useState(10);
  const [offlineBotLevels, setOfflineBotLevels] = useState([10, 10, 10]);
  const difficultyTouched = useRef(false);
  const changeDifficulty = (value: number) => {
    difficultyTouched.current = true;
    setBotDifficulty(value);
    setOfflineBotLevels([value, value, value]);
  };
  const [appearance, setAppearance] = useAppearance();
  const [clubStats, setClubStats] = useState<ClubStats | null>(null);
  const [publicRoomsEnabled, setPublicRoomsEnabled] = useState(false),
    [moderationTarget, setModerationTarget] = useState(""),
    [moderationReason, setModerationReason] = useState("");
  const { installed, install } = useInstall();
  const [initialPractice] = useState(() => loadPractice(browserStorage));
  const [local, setLocal] = useState<Game>(
      () => initialPractice ?? practice(name),
    ),
    [practiceOpen, setPracticeOpen] = useState(!!initialPractice),
    [room, setRoom] = useState<Room | null>(null),
    [me, setMe] = useState(""),
    [connected, setConnected] = useState(false),
    [clockOffset, setClockOffset] = useState(0),
    [modal, setModal] = useState<
      | "rooms"
      | "rules"
      | "settings"
      | "leave"
      | "reset"
      | "menu"
      | "install"
      | "moderation"
      | "offline"
      | null
    >(new URLSearchParams(location.search).has("room") ? "rooms" : null),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [rolling, setRolling] = useState(false),
    [sound, setSound] = useState(
      () => browserStorage.getItem("ludo-sound") !== "off",
    ),
    [botCount, setBotCount] = useState(3),
    [localMode, setLocalMode] = useState("computer"),
    [humanCount, setHumanCount] = useState(4),
    [setup, setSetup] = useState(!initialPractice),
    [copied, setCopied] = useState(false);
  const socket = useRef<Socket | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    animationTimers = useRef<ReturnType<typeof setTimeout>[]>([]),
    lastRevision = useRef(""),
    audioContext = useRef<AudioContext | null>(null),
    soundRef = useRef(sound);
  soundRef.current = sound;
  const notify = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  const send = useCallback(
    async (event: string, data: unknown): Promise<Reply> => {
      const s = socket.current;
      if (!s?.connected)
        return {
          ok: false,
          error: "The server is reconnecting. Please try again shortly.",
        };
      try {
        return await s.timeout(8000).emitWithAck(event, data);
      } catch {
        return {
          ok: false,
          error:
            "Connection interrupted. The room will sync when you reconnect.",
        };
      }
    },
    [],
  );
  useEffect(() => {
    let disposed = false,
      s: Socket | undefined,
      pending = false,
      attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let clockTimer: ReturnType<typeof setInterval> | undefined;
    const syncClock = async () => {
      if (!s?.connected) return;
      const sent = Date.now();
      try {
        const reply = (await s
          .timeout(3000)
          .emitWithAck("clock:sync", {})) as Reply;
        if (reply.ok && typeof reply.serverNow === "number" && !disposed)
          setClockOffset(reply.serverNow - (sent + Date.now()) / 2);
      } catch {
        /* Next heartbeat retries. */
      }
    };
    const connect = () => {
      if (disposed || pending) return;
      if (s) {
        s.connect();
        return;
      }
      pending = true;
      attempts++;
      void fetch("/api/session")
        .then((r) => {
          if (!r.ok) throw new Error("Server unavailable");
          if (disposed) return;
          s = io({ autoConnect: false, reconnection: true });
          socket.current = s;
          s.on("connect", () => {
            setConnected(true);
            void syncClock();
            if (clockTimer) clearInterval(clockTimer);
            clockTimer = setInterval(() => void syncClock(), 30000);
          });
          s.on("disconnect", () => {
            setConnected(false);
            if (clockTimer) clearInterval(clockTimer);
          });
          const renew = () => {
            s?.disconnect();
            s?.removeAllListeners();
            s = undefined;
            socket.current = null;
            setRoom(null);
            setSetup(true);
            if (retry) clearTimeout(retry);
            retry = setTimeout(connect, 250);
          };
          s.on(
            "connect_error",
            (error: Error & { data?: { code?: string } }) => {
              setConnected(false);
              if (error.data?.code === "SESSION_EXPIRED") renew();
              else if (error.data?.code === "STORAGE_UNAVAILABLE") {
                if (retry) clearTimeout(retry);
                retry = setTimeout(connect, 5000);
              }
            },
          );
          s.on("session:expired", () => {
            notify("Your guest session expired. Reconnecting as a new guest.");
            renew();
          });
          s.on("session:blocked", () => {
            notify("Online access is blocked for this guest.");
            setRoom(null);
            setSetup(true);
            s?.disconnect();
            if (retry) clearTimeout(retry);
          });
          s.on("server:unavailable", (value?: { message?: string }) => {
            notify(
              value?.message ??
                "Saved game is temporarily unavailable. Reconnecting shortly.",
            );
            if (retry) clearTimeout(retry);
            retry = setTimeout(connect, 5000);
          });
          s.on(
            "session",
            ({ me, serverNow }: { me: string; serverNow: number }) => {
              setMe(me);
              if (typeof serverNow === "number")
                setClockOffset(serverNow - Date.now());
            },
          );
          s.on("room:state", (r: Room) => {
            setRoom(r);
            setSetup(!r.game);
          });
          s.on("room:closed", () => {
            setRoom(null);
            notify("That room expired. A new table is ready whenever you are.");
          });
          s.on("room:left", () => {
            setRoom(null);
            setSetup(true);
          });
          s.connect();
        })
        .catch(() => {
          if (navigator.onLine && attempts === 1)
            notify("Online play is unavailable. Offline play is ready.");
          if (!disposed) retry = setTimeout(connect, 5000);
        })
        .finally(() => {
          pending = false;
        });
    };
    connect();
    window.addEventListener("online", connect);
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      if (clockTimer) clearInterval(clockTimer);
      window.removeEventListener("online", connect);
      s?.disconnect();
    };
  }, [notify]);
  useEffect(() => {
    if (connected)
      void fetch("/api/config")
        .then((r) => r.json())
        .then((c) => {
          setPublicRoomsEnabled(c.publicRoomsEnabled === true);
          if (
            !difficultyTouched.current &&
            Number.isInteger(c.defaultBotDifficulty) &&
            c.defaultBotDifficulty >= 0 &&
            c.defaultBotDifficulty <= 10
          ) {
            setBotDifficulty(c.defaultBotDifficulty);
            setOfflineBotLevels([
              c.defaultBotDifficulty,
              c.defaultBotDifficulty,
              c.defaultBotDifficulty,
            ]);
          }
        })
        .catch(() => {});
  }, [connected]);
  useEffect(() => {
    if (!setup || room) return;
    let disposed = false;
    const update = () =>
      void fetch("/api/stats")
        .then((r) => {
          if (!r.ok) throw new Error("Stats unavailable");
          return r.json();
        })
        .then((stats) => {
          if (!disposed) setClubStats(stats);
        })
        .catch(() => {});
    update();
    const timer = setInterval(update, 20000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [setup, room]);
  const voice = useRoomVoice({
    room,
    send,
    notify,
    onOnline: () => setModal("rooms"),
  });
  const game =
      room?.game ??
      (room
        ? {
            ...local,
            seats: room.seats,
            turn: 0,
            dice: null,
            phase: "roll" as const,
            lastMove: null,
          }
        : local),
    playerId = room
      ? me
      : local.seats[local.turn]?.bot
        ? LOCAL_ID
        : local.seats[local.turn]!.id,
    current = game.seats[game.turn],
    lobby = !!room && !room.game,
    myTurn = !!current && current.id === playerId && !current.bot && !lobby,
    finished = game.phase === "finished";
  useEffect(() => {
    if (practiceOpen) savePractice(browserStorage, local);
  }, [local, practiceOpen]);
  useEffect(() => {
    if (room || !practiceOpen || setup || modal || local.phase === "finished")
      return;
    const timer = setInterval(
      () =>
        setLocal((g) => {
          if (
            g.phase === "finished" ||
            g.seats[g.turn]?.bot ||
            Date.now() < g.deadline
          )
            return g;
          return g.phase === "roll"
            ? roll(g, randomDice())
            : move(g, legalMoves(g)[0]);
        }),
      250,
    );
    return () => clearInterval(timer);
  }, [room, practiceOpen, setup, modal, local.phase]);
  function chime(high = false) {
    if (!soundRef.current) return;
    try {
      const a = (audioContext.current ??= new AudioContext());
      void a.resume();
      const o = a.createOscillator(),
        v = a.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(high ? 680 : 340, a.currentTime);
      o.frequency.exponentialRampToValueAtTime(
        high ? 880 : 220,
        a.currentTime + 0.09,
      );
      v.gain.setValueAtTime(0.045, a.currentTime);
      v.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.12);
      o.connect(v);
      v.connect(a.destination);
      o.start();
      o.stop(a.currentTime + 0.13);
    } catch {
      /* Sound is optional; play always remains available. */
    }
  }
  useEffect(() => {
    if (lobby) return;
    const key = `${room?.code ?? "local"}:${game.revision}`;
    if (lastRevision.current === key) return;
    lastRevision.current = key;
    if (game.revision === 0) return;
    animationTimers.current.forEach(clearTimeout);
    setBusy(true);
    if (!game.lastMove) {
      setRolling(true);
      chime();
    } else chime(game.lastMove.captured > 0 || game.lastMove.to === 56);
    animationTimers.current = [
      setTimeout(() => setRolling(false), 650),
      setTimeout(() => setBusy(false), 950),
    ];
  }, [game.revision, room?.code, lobby]);
  useEffect(
    () => () => {
      animationTimers.current.forEach(clearTimeout);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      void audioContext.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (
      room ||
      setup ||
      modal ||
      local.phase === "finished" ||
      !local.seats[local.turn]?.bot
    )
      return;
    const controller = new AbortController(),
      snapshot = local;
    const t = setTimeout(() => {
      if (snapshot.phase === "roll")
        setLocal((g) => (g === snapshot ? roll(g, randomDice()) : g));
      else if (snapshot.phase === "move")
        void requestOfflineMove(snapshot, controller.signal)
          .then((decision) => {
            if (controller.signal.aborted) return;
            setLocal((g) =>
              g === snapshot && legalMoves(g).includes(decision.token)
                ? move(g, decision.token)
                : g,
            );
          })
          .catch((error) => {
            if (error.name !== "AbortError")
              notify("Bot interrupted. Retrying.");
          });
    }, 1600);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [room, setup, modal, local, notify]);

  useEffect(() => {
    rememberDisplayName(browserStorage, name);
  }, [name]);
  useEffect(() => {
    browserStorage.setItem("ludo-sound", sound ? "on" : "off");
  }, [sound]);
  async function act(event: "game:roll" | "game:move", token?: number) {
    if (busy || !myTurn || finished) return;
    if (room) {
      const r = await send(event, {
        revision: game.revision,
        ...(token !== undefined ? { token } : {}),
      });
      if (!r.ok) notify(r.error ?? "Please try again.");
    } else {
      try {
        setLocal((g) =>
          event === "game:roll" ? roll(g, randomDice()) : move(g, token!),
        );
      } catch (e) {
        notify((e as Error).message);
      }
    }
  }
  async function copyInvite() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/?room=${room.code}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      notify(`Room code: ${room.code}`);
    }
  }
  async function start() {
    const r = await send("room:start", {});
    if (!r.ok) notify(r.error ?? "Could not start.");
  }
  async function leave() {
    const r = await send("room:leave", {});
    if (r.ok) {
      setRoom(null);
      setModal(null);
      setBusy(false);
      setRolling(false);
      lastRevision.current = "";
    } else notify(r.error ?? "Could not leave.");
  }

  const host = room?.host === me;
  const occupied = game.seats.filter(Boolean).length;
  useEffect(() => {
    const openMenu = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !modal &&
        !setup &&
        !lobby &&
        !document.querySelector(".is-recording")
      )
        setModal("menu");
    };
    window.addEventListener("keydown", openMenu);
    return () => window.removeEventListener("keydown", openMenu);
  }, [modal, setup, lobby]);
  const offlineForm = (
    <>
      {practiceOpen && local.phase !== "finished" && (
        <button
          className="secondary full resume-button"
          onClick={() => {
            setSetup(false);
            setModal(null);
          }}
        >
          <Play weight="fill" />
          RESUME GAME
        </button>
      )}
      <label className="field-label">
        Your name
        <input
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field-label">
        Offline game
        <select
          value={localMode}
          onChange={(e) => setLocalMode(e.target.value)}
        >
          <option value="computer">Play with computer</option>
          <option value="pass">
            Pass &amp; play — everyone rolls manually
          </option>
        </select>
      </label>
      {localMode === "pass" ? (
        <label className="field-label">
          Players
          <select
            value={humanCount}
            onChange={(e) => setHumanCount(Number(e.target.value))}
          >
            <option value={2}>2 players</option>
            <option value={3}>3 players</option>
            <option value={4}>4 players</option>
          </select>
        </label>
      ) : (
        <label className="field-label">
          Computer players
          <select
            value={botCount}
            onChange={(e) => setBotCount(Number(e.target.value))}
          >
            <option value={1}>1 computer</option>
            <option value={2}>2 computers</option>
            <option value={3}>3 computers</option>
          </select>
        </label>
      )}
      {localMode === "computer" && (
        <BotDifficulty value={botDifficulty} onChange={changeDifficulty} />
      )}
      {localMode === "computer" && (
        <details className="bot-levels">
          <summary>Individual bot levels</summary>
          {Array.from({ length: botCount }, (_, i) => (
            <BotDifficulty
              key={i}
              label={`Bot ${i + 1} difficulty`}
              value={offlineBotLevels[i]}
              onChange={(value) =>
                setOfflineBotLevels((levels) =>
                  levels.map((n, j) => (j === i ? value : n)),
                )
              }
            />
          ))}
        </details>
      )}
      <button
        className="primary full"
        onClick={() => {
          setLocal(
            localMode === "pass"
              ? passAndPlay(name, humanCount)
              : practice(name, botCount, botDifficulty, offlineBotLevels),
          );
          setPracticeOpen(true);
          setBusy(false);
          setRolling(false);
          lastRevision.current = "";
          setSetup(false);
          setModal(null);
        }}
      >
        <Robot />
        PLAY OFFLINE
        <ArrowRight />
      </button>
    </>
  );
  return (
    <div className="app-shell">
      {storageUnavailable && !storageDismissed && (
        <div className="storage-notice" role="status">
          <span>
            Browser storage is unavailable. Keep this tab open; changes may not
            survive a refresh.
          </span>
          <button
            className="icon-button"
            aria-label="Dismiss storage notice"
            onClick={() => setStorageDismissed(true)}
          >
            <X />
          </button>
        </div>
      )}
      {!setup && !lobby ? (
        <PlayScreen
          game={game}
          me={playerId}
          room={room}
          busy={busy}
          rolling={rolling}
          showVoice={modal !== "menu"}
          onBack={() => setModal("leave")}
          connected={connected}
          clockOffset={room ? clockOffset : 0}
          onRoll={() => void act("game:roll")}
          onMove={(n) => void act("game:move", n)}
          onMenu={() => setModal("menu")}
          voice={voice}
          onOnline={() => setModal("rooms")}
        />
      ) : (
        <main className="setup-screen">
          <header className="setup-header">
            <a href="/" className="wordmark">
              <DiceFive weight="fill" />
              LUDO CLUB
            </a>
            <button
              className="square-button"
              aria-label="Settings"
              onClick={() => setModal("settings")}
            >
              <GearSix weight="bold" />
            </button>
          </header>
          {room ? (
            <section className="lobby-card">
              <div className="lobby-title">
                <h1>{room.name}</h1>
                <span className="room-visibility">
                  {room.public ? <GlobeHemisphereWest /> : <LockSimple />}
                  {room.public ? "PUBLIC" : "PRIVATE"}
                </span>
              </div>
              <div className="invite-strip">
                <span>
                  ROOM CODE <strong>{room.code}</strong>
                </span>
                <button
                  className="square-button"
                  aria-label="Copy room invite link"
                  onClick={() => void copyInvite()}
                >
                  {copied ? <Check /> : <Copy />}
                </button>
              </div>
              <div className="seat-editor">
                {room.seats.map((p, i) => (
                  <div className="seat-row" key={i}>
                    <span
                      className="seat-colour"
                      style={{ background: PALETTE[COLORS[i]] }}
                    />
                    <span>
                      <strong>{p?.name ?? "Empty seat"}</strong>
                      <small>
                        {p?.id === room.host
                          ? "Organiser"
                          : p?.bot
                            ? `Bot · Level ${p.botDifficulty ?? room.botDifficulty ?? 10}`
                            : p
                              ? "Player"
                              : "Open to a friend"}
                      </small>
                      {p?.id.startsWith("bot:") && (
                        <BotDifficulty
                          label={`${COLORS[i]} bot difficulty`}
                          value={
                            p.botDifficulty ??
                            room.botDifficulty ??
                            botDifficulty
                          }
                          disabled={
                            !host || (!!room.game && !finished) || !connected
                          }
                          onChange={async (difficulty) => {
                            const r = await send("room:difficulty", {
                              difficulty,
                              seat: i,
                            });
                            if (!r.ok)
                              notify(
                                r.error ?? "Unable to change bot difficulty.",
                              );
                          }}
                        />
                      )}
                    </span>
                    {host &&
                    (!room.game || finished) &&
                    (!p || p.id.startsWith("bot:")) ? (
                      <button
                        className="secondary"
                        aria-label={`${p ? "Remove" : "Add"} Bot in ${COLORS[i]} seat`}
                        onClick={async () => {
                          const r = await send("room:configure", {
                            seat: i,
                            bot: !p,
                          });
                          if (!r.ok) notify(r.error!);
                        }}
                      >
                        {p ? (
                          <>
                            <X />
                            Remove Bot
                          </>
                        ) : (
                          <>
                            <Plus />
                            Add Bot
                          </>
                        )}
                      </button>
                    ) : p?.id === me ? (
                      <span className="you-label">YOU</span>
                    ) : null}
                  </div>
                ))}
              </div>
              <BotDifficulty
                label="Default for new bots"
                value={
                  room.botDifficulty ??
                  room.game?.botDifficulty ??
                  botDifficulty
                }
                disabled={!host || (!!room.game && !finished) || !connected}
                onChange={async (difficulty) => {
                  const r = await send("room:difficulty", { difficulty });
                  if (!r.ok)
                    notify(r.error ?? "Unable to change bot difficulty.");
                }}
              />
              <div className="lobby-actions">
                <button className="secondary" onClick={() => setModal("leave")}>
                  <SignOut />
                  Leave
                </button>
                <button
                  className="primary"
                  disabled={!room.game && (!host || occupied < 2 || !connected)}
                  onClick={() => {
                    setSetup(false);
                    if (!room.game || finished) void start();
                  }}
                >
                  <Play weight="fill" />
                  {room.game && !finished
                    ? "RESUME GAME"
                    : host
                      ? "START GAME"
                      : "WAITING FOR HOST"}
                </button>
              </div>
            </section>
          ) : (
            <Home
              stats={clubStats}
              onOnline={() => setModal("rooms")}
              onOffline={() => setModal("offline")}
              onRules={() => setModal("rules")}
              onInstall={() =>
                void install().then((shown) => {
                  if (!shown) setModal("install");
                })
              }
              installed={installed}
              resume={practiceOpen}
              onResume={() => setSetup(false)}
            />
          )}
        </main>
      )}
      {modal === "menu" && (
        <Dialog title="GAME MENU" onClose={() => setModal(null)}>
          <div className="menu-actions">
            <button className="primary full" onClick={() => setModal(null)}>
              <Play weight="fill" />
              KEEP PLAYING
            </button>
            {room && (
              <button
                className="secondary full"
                onClick={() => void copyInvite()}
              >
                <Copy />
                {copied ? "INVITE COPIED" : "COPY ROOM INVITE"}
              </button>
            )}
            <button
              className="secondary full"
              onClick={() => setModal("settings")}
            >
              <GearSix />
              SETTINGS
            </button>
            <button
              className="secondary full"
              onClick={() => setModal("rules")}
            >
              <Question />
              RULES
            </button>
            {room &&
              room.seats.some(
                (s) => s && s.id !== me && !s.id.startsWith("bot:"),
              ) && (
                <button
                  className="secondary full"
                  onClick={() => setModal("moderation")}
                >
                  <ShieldCheck />
                  REPORT / BLOCK PLAYER
                </button>
              )}
            {room ? (
              <button
                className="secondary full"
                onClick={() => setModal("leave")}
              >
                <SignOut />
                LEAVE ROOM
              </button>
            ) : (
              <button
                className="secondary full"
                onClick={() => {
                  setModal("leave");
                }}
              >
                <ArrowCounterClockwise />
                QUIT GAME
              </button>
            )}
            {room && (
              <VoicePanel
                room={room}
                voice={voice}
                onOnline={() => setModal("rooms")}
              />
            )}
          </div>
        </Dialog>
      )}
      {modal === "offline" && (
        <Dialog title="PLAY OFFLINE" onClose={() => setModal(null)}>
          {offlineForm}
        </Dialog>
      )}
      {modal === "rooms" && (
        <RoomBrowser
          send={send}
          notify={notify}
          onClose={() => {
            setModal(null);
          }}
          name={name}
          setName={setName}
          online={connected}
          publicEnabled={publicRoomsEnabled}
          botDifficulty={botDifficulty}
          setBotDifficulty={changeDifficulty}
        />
      )}
      {modal === "rules" && <Rules onClose={() => setModal(null)} />}
      {modal === "settings" && (
        <Dialog title="SETTINGS" onClose={() => setModal(null)}>
          <label className="field-label">
            Appearance
            <select
              value={appearance}
              onChange={(e) => setAppearance(e.target.value as Appearance)}
            >
              <option value="system">System default</option>
              <option value="light">Light mode</option>
              <option value="dark">Dark mode</option>
            </select>
          </label>
          <label className="field-label">
            Your display name
            <input
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="settings-row">
            <span>
              <strong>Game sounds</strong>
            </span>
            <button
              className={`switch ${sound ? "on" : ""}`}
              role="switch"
              aria-checked={sound}
              aria-label="Game sounds"
              onClick={() => setSound(!sound)}
            >
              <i />
            </button>
          </div>
          <button className="primary full" onClick={() => setModal(null)}>
            DONE <Check />
          </button>
          <a
            className="text-button privacy-link"
            href="/privacy.html"
            target="_blank"
            rel="noreferrer"
          >
            Privacy &amp; retention
          </a>
        </Dialog>
      )}
      {modal === "moderation" && room && (
        <Dialog title="REPORT OR BLOCK" onClose={() => setModal(null)}>
          <label className="field-label">
            Player
            <select
              value={moderationTarget}
              onChange={(e) => setModerationTarget(e.target.value)}
            >
              <option value="">Choose a player</option>
              {room.seats
                .filter((s) => s && s.id !== me && !s.id.startsWith("bot:"))
                .map((s) => (
                  <option key={s!.id} value={s!.id}>
                    {s!.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field-label">
            What happened?
            <textarea
              maxLength={500}
              value={moderationReason}
              onChange={(e) => setModerationReason(e.target.value)}
            />
          </label>
          <p className="field-note">
            Blocking hides their messages and prevents future matching. Reports
            are visible only to the site moderator.
          </p>
          <div className="dialog-buttons">
            <button
              className="secondary"
              disabled={!moderationTarget}
              onClick={async () => {
                const r = await send("moderation:block", {
                  player: moderationTarget,
                });
                notify(r.ok ? "Player blocked." : r.error!);
                if (r.ok) setModal(null);
              }}
            >
              BLOCK
            </button>
            <button
              className="primary"
              disabled={!moderationTarget || !moderationReason.trim()}
              onClick={async () => {
                const r = await send("moderation:report", {
                  player: moderationTarget,
                  reason: moderationReason,
                });
                notify(r.ok ? "Report sent to the moderator." : r.error!);
                if (r.ok) {
                  setModerationReason("");
                  setModal(null);
                }
              }}
            >
              REPORT
            </button>
          </div>
        </Dialog>
      )}
      {(modal === "leave" || modal === "reset") && (
        <Dialog
          title={modal === "leave" ? "QUIT GAME?" : "START AGAIN?"}
          onClose={() => setModal(null)}
        >
          <p className="dialog-intro">
            {modal === "leave"
              ? room
                ? "Release your seat and leave this game? A computer will take over. Refreshing or closing the app keeps your seat saved."
                : "End this offline game and clear its saved progress?"
              : "This ends your current practice game."}
          </p>
          <div className="dialog-buttons">
            <button className="secondary" onClick={() => setModal(null)}>
              CANCEL
            </button>
            <button
              className="primary"
              onClick={() =>
                modal === "leave"
                  ? room
                    ? void leave().then(() => setSetup(true))
                    : (savePractice(browserStorage, null),
                      setPracticeOpen(false),
                      setSetup(true),
                      setModal(null))
                  : (setLocal(practice(name, botCount)),
                    setModal(null),
                    setBusy(false),
                    setRolling(false),
                    (lastRevision.current = ""))
              }
            >
              CONFIRM <ArrowRight />
            </button>
          </div>
        </Dialog>
      )}
      {modal === "install" && (
        <Dialog title="INSTALL LUDO" onClose={() => setModal(null)}>
          <p className="dialog-intro">
            In Chrome or Edge, use the browser’s Install app option. On iPhone
            or iPad, use Share, then Add to Home Screen. Open the app once
            online to download offline play.
          </p>
          <button className="primary full" onClick={() => setModal(null)}>
            GOT IT
            <Check />
          </button>
        </Dialog>
      )}
      {finished && !setup && !modal && (
        <Dialog
          title={`${game.seats.find((s) => s?.id === game.winner)?.name.toUpperCase()} WINS!`}
          onClose={() => setSetup(true)}
        >
          <div className="finish-trophy">
            <Trophy weight="fill" />
          </div>
          <button
            className="primary full"
            disabled={!!room && !host}
            onClick={() =>
              room
                ? void start()
                : setLocal(
                    local.seats.filter((s) => s && !s.bot).length > 1
                      ? passAndPlay(
                          name,
                          local.seats.filter((s) => s && !s.bot).length,
                        )
                      : practice(name, botCount),
                  )
            }
          >
            <ArrowCounterClockwise />
            {room && !host ? "WAITING FOR HOST" : "PLAY AGAIN"}
          </button>
          <button
            className="secondary full"
            onClick={() => {
              setModal("leave");
            }}
          >
            BACK TO SETUP
          </button>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X />
          </button>
        </div>
      )}
    </div>
  );
}
