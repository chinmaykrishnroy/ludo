import { test } from "node:test";
import assert from "node:assert/strict";
import { incident, issueUrl, type FailureKind } from "../src/errorReporting.js";
test("issue drafts contain only allowlisted diagnostics and no private runtime data", () => {
  const item = incident("SERVER_ERROR");
  const url = new URL(
    issueUrl(
      item,
      "secret-cookie room ABC123 https://private/?token=secret Chrome/142.1.2.3",
      true,
    ),
  );
  assert.equal(
    url.origin + url.pathname,
    "https://github.com/chinmaykrishnroy/ludo/issues/new",
  );
  const body = url.searchParams.get("body")!;
  assert.match(body, /Browser: Chrome\/142\n/);
  assert.match(body, /Category: SERVER_ERROR/);
  assert(!/secret|ABC123|private\/|142\.1/.test(body));
  const untrusted = new URL(
    issueUrl(
      { kind: "secret" as FailureKind, id: "private-room" },
      "secret",
      false,
    ),
  );
  assert(!untrusted.search.includes("secret"));
  assert.match(untrusted.searchParams.get("body")!, /Incident: unavailable/);
});
