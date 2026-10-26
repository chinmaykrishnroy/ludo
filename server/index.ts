import { resolve, dirname } from "node:path";
import { createApplication } from "./app.js";
import { createVerifiedBackup, pruneBackups } from "./backups.js";
import { adminAuthorized } from "./security.js";
const production =
  process.argv.includes("--production") ||
  process.env.NODE_ENV === "production";
if (production) process.env.NODE_ENV = "production";
const integer = (
  key: string,
  fallback: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
) => {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`Invalid ${key}`);
  return n;
};
const service = createApplication({
  dbPath: process.env.DB_PATH,
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()),
  maxRooms: integer("MAX_ROOMS", 500, 1, 5000),
  maxConnections: integer("MAX_CONNECTIONS", 1000, 1, 10000),
  maxGuestConnections: integer("MAX_GUEST_CONNECTIONS", 4, 1, 12),
  maxIpConnections: integer("MAX_IP_CONNECTIONS", 80, 1, 2000),
  trustProxy: process.env.TRUST_PROXY_CIDRS?.split(",").map((s) => s.trim()),
  maxVoiceBytes: integer("MAX_VOICE_BYTES", 268435456),
  voiceRetentionMs: integer("VOICE_RETENTION_MS", 86400000),
  chatIdleSeconds: integer("CHAT_IDLE_SECONDS", 10, 1, 300),
});
let devServer: { close: () => Promise<void> } | undefined,
  backupTimer: ReturnType<typeof setInterval> | undefined,
  backupPromise: Promise<unknown> | undefined,
  stopping = false;
const backupDirectory = resolve(
  process.env.BACKUP_DIR ?? `${dirname(service.store.path)}/backups`,
);
function runBackup() {
  if (backupPromise) return backupPromise;
  const backupStarted = performance.now();
  backupPromise = createVerifiedBackup(
    service.store,
    backupDirectory,
    undefined,
    (stage, elapsed) => service.monitor.observe(stage, elapsed),
  )
    .then(async (result) => {
      const retentionStarted = performance.now();
      const retention = await pruneBackups(backupDirectory);
      service.monitor.observe(
        "retention",
        performance.now() - retentionStarted,
      );
      service.monitor.backup.retentionWarnings = retention.invalid.length;
      if (retention.invalid.length)
        console.warn(
          JSON.stringify({
            event: "backup_retention_review",
            files: retention.invalid.length,
          }),
        );
      service.monitor.backup.lastSuccessAt = Date.now();
      console.log(
        JSON.stringify({
          event: "backup_verified",
          rooms: result.rooms,
          file: result.path,
        }),
      );
      return {
        ok: true,
        rooms: result.rooms,
        at: service.monitor.backup.lastSuccessAt,
      };
    })
    .catch((error) => {
      service.monitor.backup.lastFailureAt = Date.now();
      service.monitor.failure("backup", error, false);
      throw error;
    })
    .finally(() => {
      service.monitor.observe("backup", performance.now() - backupStarted);
      backupPromise = undefined;
    });
  return backupPromise;
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  service.beginShutdown();
  if (backupTimer) clearInterval(backupTimer);
  const forced = setTimeout(() => process.exit(1), 25000);
  forced.unref();
  try {
    await backupPromise?.catch(() => {});
    await service.close();
    await devServer?.close();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "shutdown_failed",
        message: (error as Error).message,
      }),
    );
    code = 1;
  } finally {
    clearTimeout(forced);
    process.exitCode = code;
  }
}
try {
  if (production) {
    const { default: express } = await import("express");
    service.app.post("/api/admin/backup", async (req, res) => {
      if (
        !adminAuthorized(req.headers.authorization, process.env.ADMIN_TOKEN)
      ) {
        res.sendStatus(404);
        return;
      }
      try {
        res.json(await runBackup());
      } catch {
        res
          .status(503)
          .json({ ok: false, error: "Backup failed; review operator logs" });
      }
    });
    service.app.use("/api", (_req, res) =>
      res.status(404).json({ ok: false, error: "API route not found" }),
    );
    service.app.get("/sw.js", (_req, res) =>
      res.sendFile(resolve("dist/sw.js"), {
        headers: { "Cache-Control": "no-cache" },
      }),
    );
    service.app.use(
      express.static(resolve("dist"), { maxAge: "1h", index: false }),
    );
    service.app.use("/assets", (_req, res) => {
      res.status(404).type("text/plain").send("Asset not found");
    });
    service.app.get("/{*path}", (req, res) => {
      if (/\.[^/]+$/.test(req.path)) {
        res.sendStatus(404);
        return;
      }
      res.sendFile(resolve("dist/index.html"), {
        headers: { "Cache-Control": "no-cache" },
      });
    });
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    devServer = vite;
    service.app.use(vite.middlewares);
  }
  const port = integer("PORT", 3000, 1, 65535),
    host = process.env.HOST ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    service.http.once("error", reject);
    service.http.listen(port, host, () => {
      service.http.removeListener("error", reject);
      resolve();
    });
  });
  console.log(`Ludo Club is ready at http://${host}:${port}`);
  if (production) {
    const interval = integer("BACKUP_INTERVAL_MS", 21600000, 0);
    if (interval) {
      void runBackup().catch(() => {});
      backupTimer = setInterval(
        () => void runBackup().catch(() => {}),
        interval,
      );
      backupTimer.unref();
    }
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => void shutdown());
  process.once("uncaughtException", (error) => {
    service.monitor.failure("uncaught_exception", error, false);
    void shutdown(1);
  });
  process.once("unhandledRejection", (error) => {
    service.monitor.failure("unhandled_rejection", error, false);
    void shutdown(1);
  });
} catch (error) {
  console.error(
    JSON.stringify({
      event: "startup_failed",
      message: (error as Error).message,
    }),
  );
  await shutdown(1);
}
