import React, { type ReactNode } from "react";
import type { Chat, Room } from "../../../shared/protocol";
import type { Color } from "../../../shared/game";
import { PALETTE } from "../game/Board";

interface MessageTextProps {
  message: Chat;
  room?: Room;
}

export function MessageText({ message, room }: MessageTextProps) {
  const result: ReactNode[] = [];
  let index = 0;

  if (message.mentions && message.mentions.length > 0) {
    for (const m of message.mentions) {
      if (m.start < index || m.end > message.text.length) continue;
      result.push(message.text.slice(index, m.start));
      result.push(
        <strong
          key={`${m.start}:${m.playerId}`}
          className={`chat-mention mention-${m.color}`}
          style={
            {
              "--player-colour": PALETTE[m.color as Color],
            } as React.CSSProperties
          }
        >
          {message.text.slice(m.start, m.end)}
        </strong>,
      );
      index = m.end;
    }
    result.push(message.text.slice(index));
    return <>{result}</>;
  }

  const activePlayers = (room?.seats ?? []).filter(
    (s): s is NonNullable<typeof s> => !!s,
  );
  if (activePlayers.length > 0) {
    const sorted = [...activePlayers].sort(
      (a, b) => b.name.length - a.name.length,
    );
    const names = sorted
      .map((p) => p.name.replace(/[.*+?^${}()|[\]\\]/g, (ch) => "\\" + ch))
      .join("|");
    const pattern = new RegExp(`@(${names})\\b`, "gi");
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    let keyIdx = 0;

    while ((match = pattern.exec(message.text)) !== null) {
      const matchStart = match.index;
      const matchEnd = pattern.lastIndex;
      const matchedName = match[1];
      const player = sorted.find(
        (p) => p.name.toLowerCase() === matchedName.toLowerCase(),
      );

      if (matchStart > lastIdx) {
        result.push(message.text.slice(lastIdx, matchStart));
      }
      result.push(
        <strong
          key={`auto-${keyIdx++}`}
          className={`chat-mention mention-${player ? player.color : "yellow"}`}
          style={
            {
              "--player-colour":
                PALETTE[(player ? player.color : "yellow") as Color],
            } as React.CSSProperties
          }
        >
          {message.text.slice(matchStart, matchEnd)}
        </strong>,
      );
      lastIdx = matchEnd;
    }
    if (lastIdx < message.text.length) {
      result.push(message.text.slice(lastIdx));
    }
    if (result.length > 0) {
      return <>{result}</>;
    }
  }

  return <>{message.text}</>;
}
