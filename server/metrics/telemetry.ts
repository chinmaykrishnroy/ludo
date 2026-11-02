/**
 * Structured Logging and Telemetry for Ludo Club
 * Standardized JSON logs for metrics, alerts, and operational observability.
 */

export interface LogContext {
  event: string;
  room?: string;
  guest?: string;
  code?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export function logInfo(
  event: string,
  context: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      level: "info",
      event,
      at: new Date().toISOString(),
      ...context,
    }),
  );
}

export function logWarn(
  event: string,
  context: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      event,
      at: new Date().toISOString(),
      ...context,
    }),
  );
}

export function logError(
  event: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(
    JSON.stringify({
      level: "error",
      event,
      at: new Date().toISOString(),
      message: err.message,
      name: err.name,
      code: (error as { code?: string })?.code,
      stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
      ...context,
    }),
  );
}

/** Operational rate counters for game telemetry */
export class GameTelemetry {
  private roomsCreated = 0;
  private gamesStarted = 0;
  private gamesFinished = 0;
  private movesExecuted = 0;
  private diceRolls = 0;
  private reconnects = 0;
  private disconnects = 0;

  recordRoomCreated(): void {
    this.roomsCreated++;
  }

  recordGameStarted(): void {
    this.gamesStarted++;
  }

  recordGameFinished(): void {
    this.gamesFinished++;
  }

  recordMove(): void {
    this.movesExecuted++;
  }

  recordRoll(): void {
    this.diceRolls++;
  }

  recordReconnect(): void {
    this.reconnects++;
  }

  recordDisconnect(): void {
    this.disconnects++;
  }

  snapshot() {
    return {
      roomsCreated: this.roomsCreated,
      gamesStarted: this.gamesStarted,
      gamesFinished: this.gamesFinished,
      movesExecuted: this.movesExecuted,
      diceRolls: this.diceRolls,
      reconnects: this.reconnects,
      disconnects: this.disconnects,
    };
  }
}

export const telemetry = new GameTelemetry();
