import { Dialog } from "../../lib";
import type { Room } from "../../../shared/protocol";

interface ModerationDialogProps {
  room: Room;
  me: string;
  moderationTarget: string;
  setModerationTarget: (target: string) => void;
  moderationReason: string;
  setModerationReason: (reason: string) => void;
  onBlock: () => void;
  onReport: () => void;
  onClose: () => void;
}

export function ModerationDialog({
  room,
  me,
  moderationTarget,
  setModerationTarget,
  moderationReason,
  setModerationReason,
  onBlock,
  onReport,
  onClose,
}: ModerationDialogProps) {
  return (
    <Dialog title="REPORT OR BLOCK" onClose={onClose}>
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
        Blocking hides their messages and prevents future matching. Reports are
        visible only to the site moderator.
      </p>
      <div className="dialog-buttons">
        <button
          className="secondary"
          disabled={!moderationTarget}
          onClick={onBlock}
        >
          BLOCK
        </button>
        <button
          className="primary"
          disabled={!moderationTarget || !moderationReason.trim()}
          onClick={onReport}
        >
          REPORT
        </button>
      </div>
    </Dialog>
  );
}
