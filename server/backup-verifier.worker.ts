import { parentPort, workerData } from "node:worker_threads";
import { verifyDatabase } from "./backup-validation.js";
if (!parentPort) throw new Error("Backup verifier needs a worker parent");
try {
  parentPort.postMessage({ ok: true, result: verifyDatabase(workerData.path) });
} catch (error) {
  parentPort.postMessage({ ok: false, message: (error as Error).message });
}
