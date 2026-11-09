import { SignOut, Pause, ArrowRight } from "@phosphor-icons/react";
import { Dialog } from "../../lib";
import type { Room } from "../../../shared/protocol";

interface LeaveResetDialogProps {
  modal: "leave" | "reset";
  room: Room | null;
  isSpectator: boolean;
  onClose: () => void;
  onQuitOffline: () => void;
  onPauseOffline: () => void;
  onConfirm: () => void;
}

export function LeaveResetDialog({
  modal,
  room,
  isSpectator,
  onClose,
  onQuitOffline,
  onPauseOffline,
  onConfirm,
}: LeaveResetDialogProps) {
  const isLeave = modal === "leave";
  const title = isLeave
    ? room
      ? isSpectator
        ? "STOP SPECTATING?"
        : "LEAVE TABLE?"
      : "PAUSE OR QUIT GAME?"
    : "START AGAIN?";

  const intro = isLeave
    ? room
      ? isSpectator
        ? "Leave this room and return to home?"
        : "Leave this game and remove your tokens? Refreshing or closing the app keeps your seat saved."
      : "Would you like to pause and save this match to resume later, or quit and clear your progress?"
    : "This ends your current practice game.";

  return (
    <Dialog title={title} onClose={onClose}>
      <p className="dialog-intro">{intro}</p>
      <div
        className="dialog-buttons"
        style={
          !room && isLeave
            ? {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                gap: "12px",
              }
            : undefined
        }
      >
        {!room && isLeave ? (
          <>
            <button
              className="secondary danger-btn"
              style={{ flex: 1 }}
              onClick={onQuitOffline}
            >
              <SignOut weight="bold" />
              LEAVE & QUIT
            </button>
            <button
              className="primary"
              style={{ flex: 1 }}
              onClick={onPauseOffline}
            >
              <Pause weight="bold" />
              PAUSE GAME
            </button>
          </>
        ) : (
          <>
            <button className="secondary" onClick={onClose}>
              CANCEL
            </button>
            <button className="primary" onClick={onConfirm}>
              CONFIRM <ArrowRight />
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
