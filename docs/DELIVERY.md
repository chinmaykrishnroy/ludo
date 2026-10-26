# Delivery and acceptance

## Increments implemented

1. Shared classic rules, optional computers, animated dice/token movement and a centered responsive board with solid circular tokens.
2. Private/public room support, host seat configuration, authoritative revisions and 15-second roll / 30-second move deadlines, persistent reconnects and explicit quit confirmation.
3. Hold/release voice, first-use permission, cancellation, 60-second/1-MiB limits and membership-checked downloads.
4. Offline PWA computer games and manual pass-and-play; System/Light/Dark settings; neo-brutalist homepage with durable online statistics.
5. Correctness/security hardening, storage lifecycle, moderation, monitoring, Docker supervision, verified backup/recovery and validation CI.

## Verified on 2026-10-26

- **65 automated tests pass:** rules (including 100 seeded full games), multiplayer integration, storage/security hardening, recovery, local persistence, service-worker caching, profiles/statistics, AI strategy/workers, public-room pagination, release validation and stalled-peer shutdown.
- TypeScript and the production client/server build pass. Production dependency audit reports no vulnerabilities at validation time.
- Multi-tab departure removes all tabs from a private room before further updates. Concurrent actions advance one revision only once. Expired deadlines are rejected in the action handler before a delayed background tick.
- Injected SQLite write failures leave persisted and canonical state unchanged. Voice metadata/blob insertion rolls back atomically. Background timer write failures are contained and recover.
- Unknown/expired guest sessions are rejected; limits span tabs/reconnects. Blocked audio cannot be recovered through legacy direct URLs; report review is operator-only.
- A second database owner is refused. Backup checksum/integrity/schema verification and a restore into a new file preserve unfinished tokens and the original deadline. Corrupt saved rooms are quarantined with source data preserved.
- Voice replacement/quota/expiry, abandoned-room cleanup and reconnect after server reopen have regression coverage.
- The reference ARM64 deployment passed HTTPS, readiness, manifest and private room creation/start checks through a real tunnel. Docker reports healthy, runs as `node`, restarts unless stopped, and created its first verified backup.
- Real browser checks through Cloudflare: reconnect restores the game, refresh continues the countdown, and Back requires confirmation. Cancelling returns to the game.
- Browser geometry checks at 320x568, 390x844, 844x390 and 1440x900 show the centered board, dice and mic within the viewport without document scrolling. Portrait mobile boards reach both screen edges.
- Real browser offline check: stop an isolated local production server, reload the installed cache, retain the manual game, and roll for subsequent players with the origin unavailable.

## Pending gates and limits

- The user reports successful Android/iPhone gameplay, cross-device microphone playback, refresh/state recovery and network switching through the actual tunnel. Denied permissions, 60-second recording cutoff, interrupted recording and installed offline reopen still need targeted physical-device checks.
- Deployment-specific sustained workload and restart observations are recorded below as they finish. A bounded workload is not a maximum-capacity result.
- Host reboot/power loss, loss of the Pi disk, and recovery from an independently stored off-host backup require operator acceptance. Local verified backups alone cannot recover a lost host.
- Public matchmaking is enabled on the user's explicit request after successful physical-phone gameplay. Guest blocking/reporting/bans are implemented; guest identities can be lost by clearing browser data. Operator moderation remains necessary for public tables.
- Version tags now run the container release workflow described in [RELEASING.md](RELEASING.md): full validation, smoke-tested AMD64/ARM64 images, GHCR version/latest tags and a GitHub release. See the repository Actions page for actual run results.

## Operational handoff

See [OPERATIONS.md](OPERATIONS.md) for environment settings, monitoring, backup/restore, moderation and rollback. Keep each future increment independently reviewable and run its relevant tests; do not infer real-device success from synthetic audio transport or simulated gameplay.

## Pi sustained workload

A disposable instance of the deployed image ran for **301.1 seconds** with eight rooms, 16 human WebSocket clients, 16 computer seats, 713 human game actions, 64 audio uploads/downloads (8 MiB downloaded) and 14 deliberate reconnects. No server errors occurred. Acknowledgement p95 was **144.06 ms**, maximum **6204.13 ms**; peak sampled RSS was **127.1 MiB** and event-loop p95 peaked at **21.22 ms**. The 6.2-second acknowledgement outlier requires further timing/host observation before making latency guarantees. Audio used synthetic format-header payloads to exercise storage/transport; this does not prove physical-device playback. The test used a separate database, so its games did not inflate public staging counters.

A 90.5-second diagnostic repeat also completed without errors (192 actions, 16 audio transfers, four reconnects), but game-action acknowledgements still showed long tails: p95 621.8 ms, maximum 2376.05 ms. This overlapped the Pi image/test validation on the same host. The server's cumulative event-loop maximum reached 6211.76 ms. The root filesystem was 95% used with about 6.8 GiB free. These observations identify a shared-host latency/storage investigation gate; they do not establish the precise cause. All 40 regressions also passed inside the Pi Linux/ARM build. No unrelated host data was removed.

## AI and usability increment

Random guest names are remembered across online/offline setup and Settings. Counters display compact K/M/B/T/Q totals with an exact-count hover/tap disclosure. Lobby seat actions use Add Bot / Remove Bot. The AI subsystem is documented in [AI.md](AI.md), including per-seat difficulty, asynchronous server/browser workers, safe-square staging, a 6,000-game benchmark with confidence intervals, and measured limitations. The original rules remain authoritative.

The deployed public-room update has been verified through the actual HTTPS tunnel: an independent guest discovered a browser-created public table, joined it and left cleanly. The browser shows Add Bot / Remove Bot, per-seat levels and the room default. A generated guest name appeared and an edited online name survived refresh and appeared in Settings. The refreshed offline cache ran the expert opponent with the local origin stopped and no worker errors logged. See AI.md for measured Pi worker latency and resource use.

The expert-bot mixed Pi workload completed 163 AI decisions with no worker failures/timeouts/fallbacks and no server errors. The room acknowledgement p95 was 121 ms, but occasional 9.1-second acknowledgements and a 10.2-second event-loop maximum remain a real hosting limitation. The new worker prevents synchronous AI search from blocking handlers; it does not make synchronous SQLite commits or other shared-host pauses disappear. Public rooms were enabled on explicit request, and these remaining limitations are recorded in AI.md.

## Initial container release validation

The local regression suite passes all 65 tests, the production build passes, and the production dependency audit reports no vulnerabilities. A separate browser fixture with 50 public waiting rooms verified eight-room pages, distinct second-page contents, a bounded inner scroll area and visible paging controls at desktop and 390-pixel phone widths. Dark-mode room cards display black dice icons on sky blue and black text/icons on yellow hover. The Kubernetes example renders with `kubectl kustomize deploy/k8s`; it has not been applied to a cluster. Per-architecture container checks and publication are enforced by the tag workflow; consult its actual run before treating the image as released.

The first tag attempt's real-image restart gate found two issues: Docker reassigns an automatically allocated host port after restart, and an unresponsive WebSocket peer could delay shutdown beyond the process deadline, leaving the database lease. The image test now discovers the port again. Server shutdown allows a two-second close handshake before destroying remaining connections, then saves presence and releases the lease. A regression failed before the fix and passes afterward, reopening the database immediately with tokens and absolute deadline intact. The original full image test also passes against the patched Linux/ARM64 image on the reference host. The failed v0.1.0 tag published no release image; the corrected first release is v0.1.1.
