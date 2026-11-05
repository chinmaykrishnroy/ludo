import type { Chat } from "../../../shared/protocol";

export function ChatPreviews({ messages }: { messages: Chat[] }) {
  return (
    <div className="chat-previews" role="log" aria-label="New table messages">
      {messages.map((message) => (
        <p key={message.id} className="chat-preview">
          <strong>{message.name}:</strong>{" "}
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
