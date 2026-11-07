import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  DiceFive,
  Users,
  ArrowRight,
  Plus,
  GlobeHemisphereWest,
  LockSimple,
  Check,
  ArrowCounterClockwise,
  CircleNotch,
  CaretLeft,
  CaretRight,
} from "@phosphor-icons/react";
import { Dialog } from "../../lib/Dialog";
import type { PublicRoom, Reply } from "../../../shared/protocol";
import type { AdmissionStatus } from "../../useServerAdmission";

export interface RoomBrowserProps {
  send: (e: string, d: unknown) => Promise<Reply>;
  notify: (s: string) => void;
  onClose: () => void;
  name: string;
  setName: (name: string) => void;
  online: boolean;
  publicEnabled: boolean;
  botDifficulty: number;
  setBotDifficulty: (value: number) => void;
  admission?: AdmissionStatus;
  joiningFromRoom?: boolean;
}

export const RoomBrowser = memo(function RoomBrowser({
  send,
  notify,
  onClose,
  name,
  setName,
  online,
  publicEnabled,
  botDifficulty,
  setBotDifficulty,
  admission,
  joiningFromRoom,
}: RoomBrowserProps) {
  const [tab, setTab] = useState<"create" | "join" | "public">(
      joiningFromRoom || new URLSearchParams(location.search).has("room")
        ? "join"
        : "create",
    ),
    [title, setTitle] = useState("The good company"),
    [isPublic, setPublic] = useState(false),
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
    <Dialog title="PLAY ONLINE" onClose={onClose}>
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
              bots: 0,
              botDifficulty,
              finishMode: "first",
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
          <button
            className="primary full"
            disabled={
              busy ||
              !online ||
              !name.trim() ||
              admission?.newRoomsAvailable === false
            }
          >
            {busy ? <CircleNotch className="spin" /> : <Plus />} Create room{" "}
            <ArrowRight />
          </button>
          {admission?.newRoomsAvailable === false && (
            <p role="status" className="admission-notice">
              The server is busy keeping existing games smooth. New rooms will
              reopen automatically. You can still join an existing room or play
              offline.
            </p>
          )}
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
});

export default RoomBrowser;
