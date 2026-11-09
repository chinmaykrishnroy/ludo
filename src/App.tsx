import {
  useCallback,
  useSyncExternalStore,
  useEffect,
  useRef,
  useState,
} from "react";
import { DiceFive, GearSix, X } from "@phosphor-icons/react";
import {
  useAppearance,
  type Appearance,
  useInstall,
  browserStorage,
  loadPracticeRecord,
  savePractice,
  loadDisplayName,
  rememberDisplayName,
  useServerAdmission,
} from "./store";
import { RoomBrowser, RoomLobby, useRoomSession } from "./features/lobby";
import { PlayScreen, useGameFeedback, useOfflineGame } from "./features/game";
import { RoomChat, RoomTools, useRoomChat } from "./features/chat";
import { useRoomVoice } from "./features/voice";
import Home, { type ClubStats } from "./Home";
import type { Voice } from "../shared/protocol";
import { seat, newGame, roll, move, type Game } from "../shared/game";
import {
  RulesDialog,
  SettingsDialog,
  GameMenuDialog,
  OfflineDialog,
  ModerationDialog,
  LeaveResetDialog,
  VictoryDialog,
  InstallDialog,
} from "./features/modals";
import { NotificationStack } from "./components/NotificationStack";

const LOCAL_ID = "local-you";

function practice(
  name = "You",
  bots = 3,
  difficulty = 10,
  levels: number[] = [],
  finishMode: "first" | "all" = "first",
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
  return newGame(seats, Date.now(), difficulty, finishMode);
}

function passAndPlay(
  name: string,
  count: number,
  finishMode: "first" | "all" = "first",
) {
  const arranged: (ReturnType<typeof seat> | null)[] = [null, null, null, null];
  for (let i = 0; i < count; i++) {
    const index = count === 2 && i === 1 ? 2 : i;
    arranged[index] = seat(
      i === 0 ? LOCAL_ID : `local-human-${i}`,
      i === 0 ? name : `Player ${i + 1}`,
      index,
    );
  }
  return newGame(arranged, Date.now(), 10, finishMode);
}

function randomDice() {
  const a = new Uint32Array(1);
  do {
    crypto.getRandomValues(a);
  } while (a[0] >= 4294967292);
  return (a[0] % 6) + 1;
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
  const [moderationTarget, setModerationTarget] = useState(""),
    [moderationReason, setModerationReason] = useState("");
  const { installed, install } = useInstall();
  const [initialPracticeRecord] = useState(() =>
    loadPracticeRecord(browserStorage),
  );
  const initialPractice = initialPracticeRecord?.game ?? null;
  const [local, setLocal] = useState<Game>(
      () => initialPractice ?? practice(name),
    ),
    [practiceOpen, setPracticeOpen] = useState(
      Boolean(initialPractice && initialPractice.phase !== "finished"),
    ),
    [mutedVoice, setMutedVoice] = useState<Voice | null>(null),
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
    [commandBusy, setCommandBusy] = useState(false),
    [sound, setSound] = useState(
      () => browserStorage.getItem("ludo-sound") !== "off",
    ),
    [haptics, setHaptics] = useState(
      () => browserStorage.getItem("ludo-haptics") !== "off",
    ),
    [botCount, setBotCount] = useState(3),
    [localMode, setLocalMode] = useState("computer"),
    [offlineFinishMode, setOfflineFinishMode] = useState<"first" | "all">(
      "first",
    ),
    [humanCount, setHumanCount] = useState(4),
    [setup, setSetup] = useState(
      !initialPractice ||
        initialPractice.phase === "finished" ||
        Boolean(initialPracticeRecord?.paused),
    ),
    [copied, setCopied] = useState(false);

  const commandPending = useRef(false),
    issuedAction = useRef<string | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mutedVoiceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );

  const notify = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);

  const {
    room,
    setRoom,
    roomEffects,
    typingEvent,
    me,
    connected,
    clockOffset,
    publicRoomsEnabled,
    chatIdleSeconds,
    activeRoomCode,
    send,
    clearRoom,
  } = useRoomSession({
    notify,
    onClearRoomModal: () => {
      setSetup(true);
      setModal((current) =>
        current === "leave" || current === "moderation" ? null : current,
      );
    },
    onBotDifficultyConfig: (diff) => {
      if (!difficultyTouched.current) {
        setBotDifficulty(diff);
        setOfflineBotLevels([diff, diff, diff]);
      }
    },
    onGameActive: (hasGame) => {
      setSetup(!hasGame);
    },
  });

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

  const announceMutedVoice = useCallback((message: Voice) => {
    setMutedVoice(message);
    clearTimeout(mutedVoiceTimer.current);
    mutedVoiceTimer.current = setTimeout(() => setMutedVoice(null), 5000);
  }, []);

  const voice = useRoomVoice({
    room,
    send,
    notify,
    onOnline: () => setModal("rooms"),
    me,
    onMutedVoice: announceMutedVoice,
  });

  useEffect(() => {
    setMutedVoice(null);
    clearTimeout(mutedVoiceTimer.current);
    return () => clearTimeout(mutedVoiceTimer.current);
  }, [room?.code, voice.muted]);

  const chat = useRoomChat(room, me, chatIdleSeconds, typingEvent);
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

  const admission = useServerAdmission(
    connected && (setup || lobby || modal === "rooms"),
  );

  const feedback = useGameFeedback(
      game,
      room?.code ?? "local",
      !lobby && !setup && (!!room || practiceOpen),
      sound,
      voice.muted,
      haptics,
      voice.mixer,
    ),
    busy = feedback.busy;

  useEffect(() => {
    if (practiceOpen && !setup) savePractice(browserStorage, local, false);
  }, [local, practiceOpen, setup]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  useOfflineGame({
    local,
    setLocal,
    isOnlineRoom: Boolean(room),
    practiceOpen,
    setup,
    hasModal: Boolean(modal),
    notify,
    randomDice,
  });

  useEffect(() => {
    rememberDisplayName(browserStorage, name);
  }, [name]);

  useEffect(() => {
    browserStorage.setItem("ludo-sound", sound ? "on" : "off");
  }, [sound]);

  useEffect(() => {
    browserStorage.setItem("ludo-haptics", haptics ? "on" : "off");
  }, [haptics]);

  async function act(event: "game:roll" | "game:move", token?: number) {
    if (
      commandPending.current ||
      busy ||
      !myTurn ||
      finished ||
      (room && Date.now() + clockOffset < (room.actionReadyAt ?? 0))
    )
      return;
    if (event === "game:roll") {
      feedback.beginRoll();
    }
    if (room) {
      const actionKey = `${room.code}:${game.revision}`;
      if (issuedAction.current === actionKey) return;
      issuedAction.current = actionKey;
      commandPending.current = true;
      setCommandBusy(true);
      const code = room.code;
      try {
        const r = await send(event, {
          revision: game.revision,
          ...(token !== undefined ? { token } : {}),
        });
        if (activeRoomCode.current !== code) return;
        if (!r.ok) issuedAction.current = null;
        if (r.room?.code === code)
          setRoom((current) =>
            current?.code === code &&
            (r.room!.game?.revision ?? 0) >= (current.game?.revision ?? 0)
              ? r.room!
              : current,
          );
        if (
          !r.ok &&
          !["STALE_REVISION", "ANIMATION_PENDING", "WRONG_TURN"].includes(
            r.code ?? "",
          )
        )
          notify(r.error ?? "Please try again.");
      } finally {
        commandPending.current = false;
        setCommandBusy(false);
      }
    } else {
      try {
        setLocal((g) =>
          g !== local
            ? g
            : event === "game:roll"
              ? roll(g, randomDice())
              : move(g, token!),
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
    const code = room?.code;
    if (!code) return;
    const r = await send("room:leave", { room: code });
    if (r.ok) {
      if (activeRoomCode.current && activeRoomCode.current !== code) return;
      clearRoom(code);
      feedback.reset();
    } else notify(r.error ?? "Could not leave.");
  }

  const isSpectator = Boolean(room && !room.seats.some((s) => s?.id === me));
  const host = room?.host === me;
  const humans =
    room?.seats.filter((seat) => seat && !seat.id.startsWith("bot:")).length ??
    0;

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

  const notices = (
    <NotificationStack
      toast={toast}
      onDismissToast={() => setToast("")}
      mutedVoice={mutedVoice}
      onDismissMutedVoice={() => setMutedVoice(null)}
      voice={voice}
    />
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
          roomEffects={roomEffects}
          send={send}
          notify={notify}
          busy={busy || commandBusy}
          pending={commandBusy}
          showVoice={modal !== "menu" && !chat.open}
          onBack={() => {
            setModal("leave");
          }}
          connected={connected}
          clockOffset={room ? clockOffset : 0}
          onRoll={() => void act("game:roll")}
          onMove={(n) => void act("game:move", n)}
          onMenu={() => setModal("menu")}
          voice={voice}
          chat={chat}
          onOnline={() => setModal("rooms")}
        />
      ) : (
        <main className="setup-screen">
          <header className="setup-header">
            <a href="/" className="wordmark">
              <DiceFive weight="fill" />
              LUDO CLUB
            </a>
            <div className="header-actions">
              {room && <RoomTools voice={voice} chat={chat} />}
              <button
                className="square-button"
                aria-label="Settings"
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  setModal("settings");
                }}
              >
                <GearSix weight="bold" />
              </button>
            </div>
          </header>
          {room ? (
            <RoomLobby
              room={room}
              me={me}
              name={name}
              host={host}
              isSpectator={isSpectator}
              humans={humans}
              finished={finished}
              connected={connected}
              admission={admission}
              chat={chat}
              voice={voice}
              copied={copied}
              copyInvite={() => void copyInvite()}
              botDifficulty={botDifficulty}
              send={send}
              notify={notify}
              onOpenLeave={() => setModal("leave")}
              onOpenRooms={() => setModal("rooms")}
              onStartGame={() => void start()}
            />
          ) : (
            <Home
              stats={clubStats}
              onOnline={() => setModal("rooms")}
              onOffline={() => {
                setModal("offline");
              }}
              onRules={() => setModal("rules")}
              onInstall={() =>
                void install().then((shown) => {
                  if (!shown) setModal("install");
                })
              }
              installed={installed}
            />
          )}
        </main>
      )}

      {modal === "menu" && (
        <GameMenuDialog
          room={room}
          me={me}
          copied={copied}
          copyInvite={() => void copyInvite()}
          voice={voice}
          onClose={() => setModal(null)}
          onOpenSettings={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            setModal("settings");
          }}
          onOpenRules={() => setModal("rules")}
          onOpenRooms={() => setModal("rooms")}
          onOpenModeration={() => setModal("moderation")}
          onOpenLeave={() => setModal("leave")}
          onPauseOffline={() => {
            setSetup(true);
            setModal(null);
          }}
        />
      )}

      {modal === "offline" && (
        <OfflineDialog
          practiceOpen={practiceOpen}
          isLocalPhaseFinished={local.phase === "finished"}
          name={name}
          setName={setName}
          localMode={localMode}
          setLocalMode={setLocalMode}
          humanCount={humanCount}
          setHumanCount={setHumanCount}
          botCount={botCount}
          setBotCount={setBotCount}
          botDifficulty={botDifficulty}
          onDifficultyChange={changeDifficulty}
          offlineBotLevels={offlineBotLevels}
          setOfflineBotLevels={setOfflineBotLevels}
          offlineFinishMode={offlineFinishMode}
          setOfflineFinishMode={setOfflineFinishMode}
          onResume={() => {
            setSetup(false);
            setModal(null);
          }}
          onStart={() => {
            setLocal(
              localMode === "pass"
                ? passAndPlay(name, humanCount, offlineFinishMode)
                : practice(
                    name,
                    botCount,
                    botDifficulty,
                    offlineBotLevels,
                    offlineFinishMode,
                  ),
            );
            setPracticeOpen(true);
            feedback.reset();
            setSetup(false);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
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
          joiningFromRoom={!!room}
          botDifficulty={botDifficulty}
          setBotDifficulty={changeDifficulty}
          admission={admission}
        />
      )}

      {modal === "rules" && <RulesDialog onClose={() => setModal(null)} />}

      {modal === "settings" && (
        <SettingsDialog
          appearance={appearance}
          setAppearance={setAppearance}
          name={name}
          setName={setName}
          sound={sound}
          setSound={setSound}
          haptics={haptics}
          setHaptics={setHaptics}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "moderation" && room && (
        <ModerationDialog
          room={room}
          me={me}
          moderationTarget={moderationTarget}
          setModerationTarget={setModerationTarget}
          moderationReason={moderationReason}
          setModerationReason={setModerationReason}
          onBlock={async () => {
            const r = await send("moderation:block", {
              player: moderationTarget,
            });
            notify(r.ok ? "Player blocked." : r.error!);
            if (r.ok) setModal(null);
          }}
          onReport={async () => {
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
          onClose={() => setModal(null)}
        />
      )}

      {(modal === "leave" || modal === "reset") && (
        <LeaveResetDialog
          modal={modal}
          room={room}
          isSpectator={isSpectator}
          onClose={() => setModal(null)}
          onQuitOffline={() => {
            savePractice(browserStorage, null);
            setPracticeOpen(false);
            setLocal(practice(name, botCount));
            setSetup(true);
            setModal(null);
          }}
          onPauseOffline={() => {
            savePractice(browserStorage, local, true);
            setSetup(true);
            setModal(null);
          }}
          onConfirm={() =>
            modal === "leave"
              ? void leave()
              : (setLocal(practice(name, botCount)),
                setModal(null),
                feedback.reset())
          }
        />
      )}

      {modal === "install" && <InstallDialog onClose={() => setModal(null)} />}

      {finished && !setup && !modal && (
        <VictoryDialog
          game={game}
          room={room}
          host={host}
          onClose={() => setSetup(true)}
          onPlayAgain={() =>
            room
              ? void start()
              : setLocal(
                  local.seats.filter((s) => s && !s.bot).length > 1
                    ? passAndPlay(
                        name,
                        local.seats.filter((s) => s && !s.bot).length,
                        offlineFinishMode,
                      )
                    : practice(
                        name,
                        botCount,
                        botDifficulty,
                        offlineBotLevels,
                        offlineFinishMode,
                      ),
                )
          }
          onBackToSetup={() => {
            setModal("leave");
          }}
        />
      )}

      {room && (
        <RoomChat
          room={room}
          me={me}
          chat={chat}
          voice={voice}
          notice={notices}
          send={send}
          notify={notify}
          connected={connected}
        />
      )}
      {!chat.open && notices}
    </div>
  );
}
