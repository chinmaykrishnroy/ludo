const token = process.env.ADMIN_TOKEN,
  url = process.env.LUDO_URL ?? "http://127.0.0.1:3000";
if (!token) throw new Error("ADMIN_TOKEN is required");
const [command, player, minutes, ...reason] = process.argv.slice(2);
let path,
  options = { headers: { Authorization: `Bearer ${token}` } };
if (command === "reports") path = "/api/admin/reports";
else if (command === "ban" && player && minutes && reason.length) {
  path = "/api/admin/bans";
  options = {
    method: "POST",
    headers: { ...options.headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      player,
      minutes: Number(minutes),
      reason: reason.join(" "),
    }),
  };
} else
  throw new Error(
    "Usage: node scripts/moderate.mjs reports | ban <guest-id> <minutes> <reason>",
  );
const response = await fetch(new URL(path, url), options);
if (!response.ok)
  throw new Error(`Moderator request failed: HTTP ${response.status}`);
console.log(JSON.stringify(await response.json(), null, 2));
