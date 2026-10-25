import {
  chooseBotMove,
  type AiResult,
  type BotDecision,
} from "../shared/ai/index";
import type { Game } from "../shared/game";
export function requestOfflineMove(
  game: Game,
  signal: AbortSignal,
): Promise<BotDecision> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    const difficulty =
      game.seats[game.turn]?.botDifficulty ?? game.botDifficulty ?? 10;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      worker?.terminate();
    };
    const finish = (decision: BotDecision) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };
    const fallback = () => {
      if (signal.aborted) {
        cancel();
        return;
      }
      const d = chooseBotMove(game, {
        difficulty: Math.min(difficulty, 6),
        rng: () => 0.999,
      });
      d.difficulty = difficulty;
      d.reasons.unshift("WORKER_FALLBACK");
      finish(d);
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException("AI job cancelled", "AbortError"));
    };
    const timer = setTimeout(fallback, 1500);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    try {
      worker = new Worker(new URL("./workers/ai.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent<AiResult>) => {
        if (event.data.decision) finish(event.data.decision);
        else fallback();
      };
      worker.onerror = fallback;
      worker.postMessage({
        id: String(game.revision),
        game,
        difficulty,
        seed: crypto.getRandomValues(new Uint32Array(1))[0],
        searchBudget: { maxTimeMs: 120 },
      });
    } catch {
      fallback();
    }
  });
}
