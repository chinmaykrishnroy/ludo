import {
  Play,
  Copy,
  ArrowRight,
  GearSix,
  Question,
  ShieldCheck,
  SignOut,
  Pause,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { Dialog } from "../../lib";
import { VoicePanel } from "../voice";
import type { Room } from "../../../shared/protocol";
import type { VoiceController } from "../voice/useRoomVoice";
import { APP_VERSION } from "../../version";

interface GameMenuDialogProps {
  room: Room | null;
  me: string;
  copied: boolean;
  copyInvite: () => void;
  voice: VoiceController;
  onClose: () => void;
  onOpenSettings: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpenRules: () => void;
  onOpenRooms: () => void;
  onOpenModeration: () => void;
  onOpenLeave: () => void;
  onPauseOffline: () => void;
}

export function GameMenuDialog({
  room,
  me,
  copied,
  copyInvite,
  voice,
  onClose,
  onOpenSettings,
  onOpenRules,
  onOpenRooms,
  onOpenModeration,
  onOpenLeave,
  onPauseOffline,
}: GameMenuDialogProps) {
  return (
    <Dialog title="GAME MENU" onClose={onClose}>
      <div className="menu-actions">
        <button className="primary full" onClick={onClose}>
          <Play weight="fill" />
          KEEP PLAYING
        </button>
        {room && (
          <button className="secondary full" onClick={copyInvite}>
            <Copy />
            {copied ? "INVITE COPIED" : "COPY ROOM INVITE"}
          </button>
        )}
        {room && (
          <button className="secondary full" onClick={onOpenRooms}>
            <ArrowRight /> JOIN ANOTHER ROOM
          </button>
        )}
        <button className="secondary full" onClick={onOpenSettings}>
          <GearSix />
          SETTINGS
        </button>
        <button className="secondary full" onClick={onOpenRules}>
          <Question />
          RULES
        </button>
        {room &&
          room.seats.some(
            (s) => s && s.id !== me && !s.id.startsWith("bot:"),
          ) && (
            <button className="secondary full" onClick={onOpenModeration}>
              <ShieldCheck />
              REPORT / BLOCK PLAYER
            </button>
          )}
        {room ? (
          <button className="secondary full" onClick={onOpenLeave}>
            <SignOut />
            LEAVE ROOM
          </button>
        ) : (
          <>
            <button className="secondary full" onClick={onPauseOffline}>
              <Pause weight="bold" />
              PAUSE &amp; GO TO HOME
            </button>
            <button className="secondary full" onClick={onOpenLeave}>
              <ArrowCounterClockwise />
              QUIT GAME
            </button>
          </>
        )}
        {room && (
          <VoicePanel room={room} voice={voice} onOnline={onOpenRooms} />
        )}
        <div className="dialog-version-tag">Ludo Club v{APP_VERSION}</div>
      </div>
    </Dialog>
  );
}
