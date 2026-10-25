import { COLORS, type Game } from "../shared/game";
export const PRACTICE_KEY = "ludo-local-game-v1";
type LocalStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function loadPractice(storage: LocalStore): Game | null {
  try {
    const raw = storage.getItem(PRACTICE_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Game;
    if (
      !g ||
      !Array.isArray(g.seats) ||
      g.seats.length !== 4 ||
      g.seats.filter(Boolean).length < 2 ||
      !Number.isInteger(g.turn) ||
      !g.seats[g.turn] ||
      !["roll", "move", "finished"].includes(g.phase) ||
      !Number.isInteger(g.revision) ||
      g.revision < 0 ||
      !Number.isFinite(g.deadline) ||
      typeof g.notice !== "string"
    )
      return null;
    if (
      g.dice !== null &&
      (!Number.isInteger(g.dice) || g.dice < 1 || g.dice > 6)
    )
      return null;
    if (g.phase === "move" && !g.dice) return null;
    for (let i = 0; i < 4; i++) {
      const s = g.seats[i];
      if (
        s &&
        (s.color !== COLORS[i] ||
          typeof s.id !== "string" ||
          typeof s.name !== "string" ||
          typeof s.bot !== "boolean" ||
          !Array.isArray(s.tokens) ||
          s.tokens.length !== 4 ||
          s.tokens.some((t) => !Number.isInteger(t) || t < -1 || t > 56))
      )
        return null;
    }
    return g;
  } catch {
    return null;
  }
}
export function savePractice(storage: LocalStore, game: Game | null) {
  if (game) storage.setItem(PRACTICE_KEY, JSON.stringify(game));
  else storage.removeItem(PRACTICE_KEY);
}
