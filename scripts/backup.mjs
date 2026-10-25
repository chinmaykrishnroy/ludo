const url = process.env.LUDO_URL ?? "http://127.0.0.1:3000",
  token = process.env.ADMIN_TOKEN;
if (!token) throw new Error("ADMIN_TOKEN is required");
const response = await fetch(new URL("/api/admin/backup", url), {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok)
  throw new Error(`Backup request failed: HTTP ${response.status}`);
console.log(await response.text());
