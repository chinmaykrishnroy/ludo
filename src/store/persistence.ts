import type { Game } from "../../shared/game";
import { gameSchema } from "../../shared/state-schema";
import type { LocalStore } from "./storage";

export const PRACTICE_KEY = "ludo-local-game-v1";

export type SavedPractice = {
  game: Game;
  paused: boolean;
};

export function loadPracticeRecord(storage: LocalStore): SavedPractice | null {
  try {
    const raw = storage.getItem(PRACTICE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate =
      "version" in value
        ? value.version === 2 && "game" in value
          ? value.game
          : null
        : value;
    const result = gameSchema.safeParse(candidate);
    if (!result.success) return null;
    const paused = Boolean(
      value &&
      typeof value === "object" &&
      "paused" in value &&
      (value as { paused?: boolean }).paused,
    );
    return { game: result.data, paused };
  } catch {
    return null;
  }
}

export function loadPractice(storage: LocalStore): Game | null {
  return loadPracticeRecord(storage)?.game ?? null;
}

export function savePractice(
  storage: LocalStore,
  game: Game | null,
  paused = false,
) {
  try {
    if (game)
      storage.setItem(
        PRACTICE_KEY,
        JSON.stringify({ version: 2, game, paused }),
      );
    else storage.removeItem(PRACTICE_KEY);
    return true;
  } catch {
    return false;
  }
}
