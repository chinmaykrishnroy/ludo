import { legalMoves, type Game } from "../game.js";
import { analyzeMoves } from "./tactics.js";
import { difficultyPolicy, DEFAULT_BOT_DIFFICULTY } from "./policy.js";
import { createRng } from "./rng.js";
import { mcts, lookahead } from "./search.js";
import type { BotOptions, BotDecision } from "./types.js";
export { DEFAULT_BOT_DIFFICULTY, validDifficulty } from "./policy.js";
export { createRng } from "./rng.js";
export { analyzeBoard } from "./analyzer.js";
export type {
  BotOptions,
  BotDecision,
  SearchBudget,
  AiJob,
  AiResult,
} from "./types.js";
export function chooseBotMove(
  game: Game,
  options: BotOptions = {},
): BotDecision {
  const difficulty =
    options.difficulty ??
    game.seats[game.turn]?.botDifficulty ??
    game.botDifficulty ??
    DEFAULT_BOT_DIFFICULTY;
  const policy = difficultyPolicy(difficulty, options.searchBudget);
  const legal = legalMoves(game);
  if (!legal.length) throw new Error("The bot has no legal move.");
  const clock = options.clock ?? (() => performance.now()),
    start = clock(),
    deadline = start + policy.maxTimeMs;
  if (!difficulty)
    return {
      token: legal[0],
      difficulty,
      reasons: ["FIRST_LEGAL"],
      utility: 0,
      search: {
        algorithm: "policy",
        iterations: 0,
        nodes: 0,
        depth: 0,
        elapsedMs: clock() - start,
        stopped: "policy",
      },
      candidates: legal.map((token) => ({ token, utility: 0, visits: 0 })),
    };
  const moves = analyzeMoves(game, difficulty),
    rng =
      options.rng ??
      createRng(
        `${game.revision}:${game.turn}:${game.dice}:${game.seats.map((s) => s?.tokens.join(",")).join(";")}`,
      );
  const win = moves.find((a) => a.next.phase === "finished");
  let candidates = moves.map((a) => ({
      token: a.token,
      utility: a.utility,
      visits: 0,
    })),
    selected = win?.token ?? candidates[0].token;
  let algorithm: BotDecision["search"]["algorithm"] = "policy",
    iterations = 0,
    nodes = 0,
    depth = 0,
    stopped: BotDecision["search"]["stopped"] = win ? "tactical" : "policy";
  let exploring = false;
  if (!win && difficulty < 7 && rng() < policy.exploration) {
    selected = legal[Math.floor(rng() * legal.length)];
    exploring = true;
  } else if (!win && legal.length > 1 && difficulty >= 7) {
    if (difficulty < 9) {
      const result = lookahead(game, difficulty, policy.beam, deadline, clock);
      candidates = result.candidates;
      nodes = result.nodes;
      algorithm = "lookahead";
      depth = difficulty === 8 ? 2 : 1;
      stopped = result.timedOut ? "time" : "iterations";
    } else {
      const result = mcts(
        game,
        difficulty,
        rng,
        policy.iterations,
        policy.depth,
        deadline,
        clock,
      );
      candidates = result.candidates;
      nodes = result.nodes;
      iterations = result.iterations;
      algorithm = "mcts";
      depth = policy.depth;
      stopped = result.timedOut ? "time" : "iterations";
    }
    selected = candidates[0].token;
  }
  return {
    token: selected,
    difficulty,
    reasons: exploring
      ? ["EXPLORE"]
      : moves.find((a) => a.token === selected)!.reasons,
    utility: candidates.find((a) => a.token === selected)!.utility,
    search: {
      algorithm,
      iterations,
      nodes,
      depth,
      elapsedMs: Math.max(0, clock() - start),
      stopped,
    },
    candidates,
  };
}
