import { Worker } from "node:worker_threads";
import { randomInt } from "node:crypto";
import {
  chooseBotMove,
  type AiJob,
  type AiResult,
  type BotDecision,
  type SearchBudget,
} from "../../shared/ai/index.js";
import type { Game } from "../../shared/game.js";
import { difficultyPolicy } from "../../shared/ai/policy.js";
export interface WorkerPort {
  on(event: string, handler: (...args: any[]) => void): unknown;
  postMessage(data: AiJob): void;
  terminate(): unknown;
  unref?(): void;
}
type Pending = {
  key: string;
  job: AiJob;
  resolve: (decision: BotDecision) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export class AiScheduler {
  private worker?: WorkerPort;
  private queue: Pending[] = [];
  private active?: Pending;
  private jobs = new Map<string, Pending>();
  private serial = 0;
  private closed = false;
  stats = {
    completed: 0,
    cancelled: 0,
    fallbacks: 0,
    timeouts: 0,
    failures: 0,
  };
  constructor(
    private options: {
      factory?: () => WorkerPort;
      timeoutMs?: number;
      searchBudget?: SearchBudget;
    } = {},
  ) {
    difficultyPolicy(10, options.searchBudget);
  }
  request(key: string, game: Game, difficulty: number): Promise<BotDecision> {
    if (this.closed) return Promise.reject(new Error("AI scheduler closed"));
    this.cancel(key);
    return new Promise((resolve, reject) => {
      const job: AiJob = {
        id: `${++this.serial}`,
        game: structuredClone(game),
        difficulty,
        seed: randomInt(0, 0x7fffffff),
        searchBudget:
          difficulty === 9
            ? {
                ...this.options.searchBudget,
                iterations: Math.max(
                  1,
                  Math.floor((this.options.searchBudget?.iterations ?? 96) / 2),
                ),
                maxDepth: Math.min(
                  16,
                  this.options.searchBudget?.maxDepth ?? 24,
                ),
              }
            : this.options.searchBudget,
      };
      const pending: Pending = {
        key,
        job,
        resolve,
        reject,
        timer: setTimeout(
          () => this.fallback(pending, true),
          this.options.timeoutMs ?? 1500,
        ),
      };
      this.jobs.set(key, pending);
      if (this.queue.length >= 128) {
        this.fallback(pending, false);
        return;
      }
      this.queue.push(pending);
      this.pump();
    });
  }
  private createWorker() {
    const worker =
      this.options.factory?.() ??
      new Worker(
        new URL(
          import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js",
          import.meta.url,
        ),
        {
          execArgv: import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : [],
        },
      );
    this.worker = worker;
    worker.unref?.();
    worker.on("message", (result: AiResult) => {
      const task = this.active;
      if (this.worker !== worker || !task || result.id !== task.job.id) return;
      if (!result.decision || result.error) {
        this.stats.failures++;
        this.fallback(task, false);
        return;
      }
      this.active = undefined;
      this.jobs.delete(task.key);
      clearTimeout(task.timer);
      this.stats.completed++;
      task.resolve(result.decision);
      this.pump();
    });
    worker.on("error", () => {
      if (this.worker === worker && this.active) {
        this.stats.failures++;
        this.fallback(this.active, false);
      }
    });
    worker.on("exit", () => {
      if (this.worker === worker) {
        this.worker = undefined;
        if (this.active) {
          this.stats.failures++;
          this.fallback(this.active, false);
        } else this.pump();
      }
    });
    return worker;
  }
  private pump() {
    if (this.closed || this.active || !this.queue.length) return;
    const task = this.queue.shift()!;
    this.active = task;
    try {
      (this.worker ?? this.createWorker()).postMessage(task.job);
    } catch {
      this.stats.failures++;
      this.fallback(task, false);
    }
  }
  private fallback(task: Pending, timeout: boolean) {
    if (this.jobs.get(task.key) !== task) return;
    clearTimeout(task.timer);
    this.jobs.delete(task.key);
    this.queue = this.queue.filter((t) => t !== task);
    if (this.active === task) {
      this.active = undefined;
      const old = this.worker;
      this.worker = undefined;
      void old?.terminate();
    }
    this.stats.fallbacks++;
    if (timeout) this.stats.timeouts++;
    try {
      const decision = chooseBotMove(task.job.game, {
        difficulty: Math.min(task.job.difficulty, 6),
        rng: () => 0.999,
      });
      decision.difficulty = task.job.difficulty;
      decision.reasons.unshift("WORKER_FALLBACK");
      task.resolve(decision);
    } catch (error) {
      task.reject(error as Error);
    }
    this.pump();
  }
  cancel(key: string) {
    const task = this.jobs.get(key);
    if (!task) return;
    this.jobs.delete(key);
    clearTimeout(task.timer);
    this.queue = this.queue.filter((t) => t !== task);
    this.stats.cancelled++;
    if (this.active === task) {
      this.active = undefined;
      const old = this.worker;
      this.worker = undefined;
      void old?.terminate();
    }
    const error = new Error("AI job cancelled");
    error.name = "AbortError";
    task.reject(error);
    this.pump();
  }
  get pending() {
    return this.jobs.size;
  }
  async close() {
    this.closed = true;
    for (const key of [...this.jobs.keys()]) this.cancel(key);
    const old = this.worker;
    this.worker = undefined;
    await old?.terminate();
  }
}
