import type { Chat } from "../../../shared/protocol";
import type { Color } from "../../../shared/game";
import { PALETTE } from "../game/Board";

export function ChatPreviews({ messages }: { messages: Chat[] }) {
  return (
    <div className="chat-previews" role="log" aria-label="New table messages">
      {messages.map((message) => (
        <p
          key={message.id}
          className={`chat-preview chat-preview-${message.color}`}
        >
          <strong
            className="chat-preview-author"
            style={{
              color: PALETTE[message.color as Color] ?? "inherit",
              marginRight: "4px",
            }}
          >
            {message.name}:
          </strong>
          {message.gif
            ? "sent a GIF"
            : message.photo
              ? "sent an image"
              : message.text}
        </p>
      ))}
    </div>
  );
}
