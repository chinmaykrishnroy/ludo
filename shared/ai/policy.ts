import type { SearchBudget } from "./types.js";
export const DEFAULT_BOT_DIFFICULTY = 10;
export const validDifficulty = (n: number) =>
  Number.isInteger(n) && n >= 0 && n <= 10;
export function difficultyPolicy(level: number, budget: SearchBudget = {}) {
  if (!validDifficulty(level))
    throw new Error("Bot difficulty must be an integer from 0 to 10.");
  const iterations = budget.iterations ?? (level === 10 ? 96 : 48);
  const depth = budget.maxDepth ?? (level === 10 ? 24 : 16);
  const maxTimeMs = budget.maxTimeMs ?? 120;
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 2048 ||
    !Number.isInteger(depth) ||
    depth < 1 ||
    depth > 96 ||
    !Number.isFinite(maxTimeMs) ||
    maxTimeMs < 0 ||
    maxTimeMs > 1000
  )
    throw new Error("Invalid AI search budget.");
  return {
    iterations,
    depth,
    maxTimeMs,
    exploration:
      level < 3 ? (level === 1 ? 1 : 0.7) : level < 7 ? (6 - level) * 0.08 : 0,
    beam: level === 7 ? 1 : 2,
  };
}
