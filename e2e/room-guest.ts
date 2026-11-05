import { request, type Page } from "@playwright/test";
import { io } from "socket.io-client";
import type { Reply } from "../shared/protocol";

// Leave a reserved human seat offline. The organiser can still start the match.
export async function addOfflineGuest(page: Page) {
  const code = await page.locator(".invite-strip strong").innerText();
  const origin = new URL(page.url()).origin;
  const api = await request.newContext({ baseURL: origin });
  const session = await api.get("/api/session");
  const socket = io(origin, {
    transports: ["websocket"],
    extraHeaders: { Cookie: session.headers()["set-cookie"].split(";")[0] },
    reconnection: false,
    timeout: 5000,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    const reply: Reply = await socket.timeout(5000).emitWithAck("room:join", {
      code,
      playerName: "Test guest",
    });
    if (!reply.ok) throw new Error(reply.error);
  } finally {
    socket.disconnect();
    await api.dispose();
  }
}
