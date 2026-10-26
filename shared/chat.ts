export const CHAT_MAX_TEXT = 180;
export const CHAT_MAX_GIF_BYTES = 1024 * 1024;
export const CHAT_IDLE_SECONDS = 10;
export type Mention = {
  playerId: string;
  name: string;
  color: string;
  start: number;
  end: number;
};

export function emojiOnly(text: string) {
  const value = text.trim();
  if (!value) return false;
  const emoji =
    /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)(?:\p{Emoji_Modifier}|\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}))*|\s/gu;
  return value.replace(emoji, "") === "";
}

// Keep selected identities only while the text they describe survives an edit.
export function editMentions(
  before: string,
  after: string,
  mentions: Mention[],
) {
  let prefix = 0,
    suffix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix++;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  const shift = after.length - before.length;
  return mentions.flatMap((m) => {
    const next =
      m.end <= prefix
        ? m
        : m.start >= before.length - suffix
          ? { ...m, start: m.start + shift, end: m.end + shift }
          : null;
    return next && after.slice(next.start, next.end) === `@${next.name}`
      ? [next]
      : [];
  });
}
