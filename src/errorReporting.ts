import pkg from "../package.json";
export type FailureKind = "UI_RENDER_ERROR" | "RUNTIME_ERROR" | "SERVER_ERROR";
export type Incident = { kind: FailureKind; id: string };
export const REPORT_EVENT = "ludo:unexpected-error";
const kinds = new Set<FailureKind>([
  "UI_RENDER_ERROR",
  "RUNTIME_ERROR",
  "SERVER_ERROR",
]);
export function incident(kind: FailureKind): Incident {
  return { kind, id: globalThis.crypto?.randomUUID?.() ?? "unavailable" };
}
export function reportUnexpected(kind: FailureKind) {
  window.dispatchEvent(new CustomEvent(REPORT_EVENT, { detail: { kind } }));
}
export function issueUrl(
  item: Incident,
  agent = navigator.userAgent,
  online = navigator.onLine,
) {
  const kind = kinds.has(item.kind) ? item.kind : "RUNTIME_ERROR";
  const id = /^[a-f0-9-]{36}$/i.test(item.id) ? item.id : "unavailable";
  const browser =
    agent.match(/(Firefox|Edg|Chrome|Version)\/\d+/)?.[0] ?? "Unknown browser";
  const body = `## What happened?\n\nPlease describe the problem and the steps to reproduce it. Do not include private room codes, recordings or messages.\n\n## App diagnostics\n\n- Version: ${pkg.version}\n- Category: ${kind}\n- Incident: ${id}\n- Browser: ${browser}\n- Network: ${online ? "online" : "offline"}\n`;
  return (
    "https://github.com/chinmaykrishnroy/ludo/issues/new?" +
    new URLSearchParams({
      title: `[Bug] ${kind === "SERVER_ERROR" ? "Server error" : "Unexpected app error"}`,
      body,
    }).toString()
  );
}
