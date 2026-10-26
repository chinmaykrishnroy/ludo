import type { Game } from "../shared/game";
import { gameSchema } from "../shared/state-schema";
import type { LocalStore } from "./storage";
// Existing installations keep their key. Bare objects are v1; new saves use v2.
export const PRACTICE_KEY = "ludo-local-game-v1";
export function loadPractice(storage: LocalStore): Game | null {
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
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function savePractice(storage: LocalStore, game: Game | null) {
  try {
    if (game)
      storage.setItem(PRACTICE_KEY, JSON.stringify({ version: 2, game }));
    else storage.removeItem(PRACTICE_KEY);
    return true;
  } catch {
    return false;
  }
}
