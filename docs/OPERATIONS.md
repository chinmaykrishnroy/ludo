# Operations

## Managed host example

The optional `ops/deploy-pi.sh` helper manages a single Docker host under `~/ludo`:

- `releases/<version>/`: immutable source and deployment helper.
- `shared/ludo.env`: generated environment, mode 0600; contains the admin secret.
- `shared/data/`: persistent SQLite database, WAL and verified backups.
- `current`: source symlink; `shared/current-image` and `previous-image`: rollback image names.
- Container: `ludo-club-staging`, published only on `127.0.0.1:3011`.

Run `bash ops/deploy-pi.sh 3011` from a versioned release. It builds before stopping the old container, takes a live verified backup, stops gracefully, starts the new image and checks readiness. A readiness failure restores the previous image when one exists. It refuses to replace an unmanaged container with the same name.

The host directory owner must match the image's `node` UID (1000 on the Pi deployment). Keep the data directory private. The container runs as `node`, with a read-only root, dropped capabilities, restart policy, init, resource limits and a writable data mount. Database leases prevent a second game process writing the same data. After an ungraceful kill, allow the previous 30-second lease to expire before starting a replacement.

Route an HTTPS reverse proxy or tunnel to the loopback listener, for example `https://ludo.example.com` to `http://localhost:3011`. If the proxy runs in another container, its `localhost` is that container; use a deliberately configured shared network rather than exposing the origin broadly. Configure the helper's generated environment for your hostname before exposing it.

## Configuration

`.env.example` lists supported limits. Set exact comma-separated `ALLOWED_ORIGINS`; set `TRUST_PROXY_CIDRS` only to the actual proxy hops. The Pi helper trusts loopback and the Docker bridge gateway, not arbitrary internet clients. Never trust arbitrary forwarded client addresses.

`PUBLIC_ROOMS_ENABLED=false` is the default. A nonempty `ADMIN_TOKEN` of at least 32 characters is required before public rooms can be enabled. Generate it with a cryptographic generator and keep it out of Git, logs and client bundles. Review reports and remaining acceptance checks before opening public matchmaking.

Defaults: 500 active rooms, 1,000 total sockets, four sockets per guest, 80 per IP, 256 MiB voice storage, 1 GiB SQLite page limit, 24-hour audio retention, six-hour backup interval. These are defensive caps, not a concurrency promise. Leave disk headroom for WAL and backup copies; the database page limit does not bound those files.

Guest and IP budgets cover room creation, joining, text, voice count/bytes, reports, connections and aggregate actions. IPv6 addresses are grouped by /64. Shared-network users consume shared IP budgets. Guest bans cannot establish permanent identity after browser data is cleared; public launch may need accounts and stronger abuse operations.

## Health and monitoring

- `GET /livez`: process liveness.
- `GET /readyz` or `/api/health`: readiness; fails on closing, storage failures, low disk (under 128 MiB) or quarantined saved rooms.
- `GET /api/admin/health`: database counts/quarantine, disk, memory, event-loop latency, connections, errors, action/rejection counts and backup timestamps.
- `GET /metrics`: Prometheus-format operational gauges/counters.

Admin endpoints require `Authorization: Bearer <ADMIN_TOKEN>`. Run operator scripts inside the container so its environment supplies the secret without printing it. Scrape metrics from a trusted monitor; do not embed the bearer token in URLs. Alert on readiness failure, storage errors, disk headroom, growing latency/memory, backup failures or no successful backup for over seven hours. Docker health status alone does not restart an unhealthy but still-running process; investigate the alert.

```sh
docker logs --tail 100 ludo-club-staging
docker exec ludo-club-staging node scripts/backup.mjs
docker exec ludo-club-staging node scripts/moderate.mjs reports
docker exec ludo-club-staging node scripts/moderate.mjs ban <guest-id> 1440 "reason"
```

Ban actions disconnect the affected guest's tabs. Reports contain user-submitted content: treat it as untrusted. Players can block another member to hide their text/audio and prevent matching. No public report feed is exposed.

## Backup and recovery

Startup and each six-hour interval use the SQLite online backup API. A backup is published only after SQLite integrity/foreign-key checks and saved-room schema validation. A companion JSON manifest contains its SHA-256. Retention keeps at least two backups, removes old copies after seven days and caps managed copies at 28. Room/voice retention deletes live data but older backup copies can retain it until backup expiry.

Copy verified `.sqlite` **and** `.sqlite.json` files to protected storage on another machine. Local automatic backups do not protect against loss of the Pi or its disk. Never copy just a live database file while ignoring its WAL.

Restore first to a **new filename**, never over the running database:

```sh
docker exec ludo-club-staging node scripts/restore.mjs \
  --from /data/backups/<backup>.sqlite --to /data/recovered.sqlite
```

The command verifies checksum, integrity and room schema, and clears the copied process lease. Test the recovery database in an isolated container before cutover. For cutover, stop the game container, preserve the old database and its WAL/SHM files together, change `DB_PATH` in `shared/ludo.env` to the verified new file, then start the desired image. Keep the same public hostname and browser cookie so returning players can recover their seats. Do not delete quarantine data to make health green; inspect and repair the saved state or recover a verified copy.

## Shutdown and rollback

SIGTERM drains the service, stops game/backup timers, persists presence and closes SQLite. Docker gives it 30 seconds. Unfinished tokens, phase and absolute deadlines are retained; reconnect does not grant a new minute.

For a failed manual update, use the immutable image recorded in `shared/previous-image`, the same environment and data mount, and the same security flags in `ops/deploy-pi.sh`. Validate readiness and a private room after rollback. A binary rollback cannot undo an incompatible database migration; restore a pre-update backup into a new file when needed. Review schema compatibility before updates.

CI validates Linux/Windows tests, production builds, dependency audit and a container restart. Version tags run the multi-architecture container release pipeline described in `RELEASING.md`. Staging approval includes a private game on the actual tunnel and physical-device checks in `DELIVERY.md`.

## Transport input limits in the follow-up source

The post-v0.1.2 source limits Socket.IO events to one binary attachment, 16 KiB of UTF-8 text metadata and 1 MiB of decoded binary data. Incomplete binary uploads expire after 30 seconds; this timer starts when an upload header arrives, after recording has finished. The separate 60-second recording limit is unchanged. The Engine.IO envelope permits base64 expansion for polling while decoded limits remain enforced.

Ingress budgets apply before Socket.IO reconstruction: each guest shares 600 message packets and 6 MiB per minute across tabs/reconnects; each trusted client IP shares 3,000 packets and 24 MiB per minute. Existing application voice/action quotas also apply. Rejected transport input disconnects that connection and increments the rejected counter. These limits are admission safeguards, not a claim of supported production concurrency. This section does not describe the immutable v0.1.2 release.

## Bot configuration

BOT_DIFFICULTY=10 sets the default for new bot seats. AI_SEARCH_ITERATIONS=96, AI_SEARCH_DEPTH=24 and AI_SEARCH_MS=120 bound the expert search in one worker. Hosts may override levels per bot before a match; saved seats retain those settings across deploys. Human timeouts remain first-legal moves. Admin health includes AI completions, pending jobs, cancellations, timeouts, failures and fallbacks. See AI.md for reproducible strategy/worker benchmarks.
