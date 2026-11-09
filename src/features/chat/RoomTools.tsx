import { ChatCircle, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import type { VoiceController } from "../voice/useRoomVoice";
import type { ChatController } from "./useRoomChat";

interface RoomToolsProps {
  voice: VoiceController;
  chat: ChatController;
  online?: boolean;
}

export function RoomTools({ voice, chat, online = true }: RoomToolsProps) {
  return (
    <div className="room-tools">
      <button
        className="square-button"
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
          className="square-button chat-launch"
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
