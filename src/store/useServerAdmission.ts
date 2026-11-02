import { useEffect, useState } from "react";
export type AdmissionStatus = {
  newRoomsAvailable: boolean;
  retryAfterSeconds: number;
};
export function useServerAdmission(enabled: boolean) {
  const [status, setStatus] = useState<AdmissionStatus | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = async () => {
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 4500);
      try {
        const response = await fetch("/api/admission", {
          signal: controller.signal,
          cache: "no-store",
        });
        const value = response.ok ? await response.json() : null;
        if (value && typeof value.newRoomsAvailable === "boolean" && !disposed)
          setStatus(value);
      } catch {
        // The command handler remains authoritative when this hint is offline.
      } finally {
        clearTimeout(timeout);
        if (!disposed) timer = setTimeout(update, 5000);
      }
    };
    void update();
    return () => {
      disposed = true;
      request?.abort();
      clearTimeout(timer);
    };
  }, [enabled]);
  return status;
}
