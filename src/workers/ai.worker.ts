import { chooseBotMove, createRng, type AiJob } from "../../shared/ai/index";
self.onmessage = (event: MessageEvent<AiJob>) => {
  const job = event.data;
  try {
    self.postMessage({
      id: job.id,
      decision: chooseBotMove(job.game, {
        difficulty: job.difficulty,
        rng: createRng(job.seed),
        searchBudget: job.searchBudget,
      }),
    });
  } catch (error) {
    self.postMessage({ id: job.id, error: (error as Error).message });
  }
};
