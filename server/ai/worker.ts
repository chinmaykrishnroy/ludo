import { parentPort } from "node:worker_threads";
import { chooseBotMove, createRng, type AiJob } from "../../shared/ai/index.js";
parentPort!.on("message", (job: AiJob) => {
  try {
    parentPort!.postMessage({
      id: job.id,
      decision: chooseBotMove(job.game, {
        difficulty: job.difficulty,
        rng: createRng(job.seed),
        searchBudget: job.searchBudget,
      }),
    });
  } catch (error) {
    parentPort!.postMessage({ id: job.id, error: (error as Error).message });
  }
});
