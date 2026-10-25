// Compatibility for existing consumers of shared/game.ts. Runtime bot jobs use
// chooseBotMove through platform workers; this wrapper performs no I/O.
import type { Game } from "./game.js";
import { chooseBotMove } from "./ai/index.js";
export { DEFAULT_BOT_DIFFICULTY, validDifficulty } from "./ai/policy.js";
export const botMove = (game: Game, difficulty?: number) =>
  chooseBotMove(game, { difficulty }).token;
