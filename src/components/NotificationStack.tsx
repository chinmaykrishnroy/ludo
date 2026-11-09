import { Info, X } from "@phosphor-icons/react";
import type { Voice } from "../../shared/protocol";
import type { VoiceController } from "../features/voice/useRoomVoice";

interface NotificationStackProps {
  toast: string;
  onDismissToast: () => void;
  mutedVoice: Voice | null;
  onDismissMutedVoice: () => void;
  voice: VoiceController;
}

export function NotificationStack({
  toast,
  onDismissToast,
  mutedVoice,
  onDismissMutedVoice,
  voice,
}: NotificationStackProps) {
  if (!toast && (!mutedVoice || !voice.muted)) return null;

  return (
    <div className="notification-stack" aria-live="polite">
      {mutedVoice && voice.muted && (
        <div className="muted-voice-toast" role="status">
          <span>
            <strong>{mutedVoice.name}</strong> spoke
          </span>
          <button
            onClick={() => {
              voice.unmuteAndPlay(mutedVoice.id);
              onDismissMutedVoice();
            }}
          >
            Unmute to listen
          </button>
          <button
            className="muted-toast-close"
            aria-label="Dismiss voice notice"
            onClick={onDismissMutedVoice}
          >
            <X />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Info className="toast-icon" weight="fill" />
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={onDismissToast}>
            <X weight="bold" />
          </button>
        </div>
      )}
    </div>
  );
}
