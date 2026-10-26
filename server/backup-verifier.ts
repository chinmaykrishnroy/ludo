import { Worker } from "node:worker_threads";
export function verifyBackupAsync(
  path: string,
  timeoutMs = 20000,
): Promise<{ rooms: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL(
        import.meta.url.endsWith(".ts")
          ? "./backup-verifier.worker.ts"
          : "./backup-verifier.worker.js",
        import.meta.url,
      ),
      {
        workerData: { path },
        execArgv: import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : [],
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      },
    );
    let settled = false;
    const finish = (error?: Error, result?: { rooms: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker
        .terminate()
        .then(() => (error ? reject(error) : resolve(result!)), reject);
    };
    const timer = setTimeout(
      () => finish(new Error("Backup verification timed out")),
      timeoutMs,
    );
    worker.once("message", (message) => {
      if (
        message.ok === true &&
        Number.isInteger(message.result?.rooms) &&
        message.result.rooms >= 0
      )
        finish(undefined, message.result);
      else finish(new Error(message.message ?? "Backup verification failed"));
    });
    worker.once("error", (error) => finish(error));
    worker.once("exit", () => {
      if (!settled)
        finish(new Error("Backup verifier exited without a result"));
    });
  });
}
