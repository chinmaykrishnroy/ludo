export type Rng = () => number;
export type ReasonCode =
  | "FIRST_LEGAL"
  | "EXPLORE"
  | "IMMEDIATE_WIN"
  | "STOP_LEADER"
  | "CAPTURE"
  | "ESCAPE_THREAT"
  | "SAFE_POSITION"
  | "SAFE_AMBUSH"
  | "RELEASE_TOKEN"
  | "CHASE_LEADER"
  | "ADVANCE"
  | "WORKER_FALLBACK";
export type SearchBudget = {
  iterations?: number;
  maxDepth?: number;
  maxTimeMs?: number;
};
export type BotOptions = {
  difficulty?: number;
  rng?: Rng;
  searchBudget?: SearchBudget;
  clock?: () => number;
};
export type BotDecision = {
  token: number;
  difficulty: number;
  reasons: ReasonCode[];
  utility: number;
  search: {
    algorithm: "policy" | "lookahead" | "mcts";
    iterations: number;
    nodes: number;
    depth: number;
    elapsedMs: number;
    stopped: "tactical" | "policy" | "iterations" | "time";
  };
  candidates: { token: number; utility: number; visits: number }[];
};
export type AiJob = {
  id: string;
  game: import("../game.js").Game;
  difficulty: number;
  seed: number;
  searchBudget?: SearchBudget;
};
export type AiResult = { id: string; decision?: BotDecision; error?: string };
