# Delivery and acceptance

## Increments implemented

1. Shared classic rules, optional computers, animated dice/token movement and a centered responsive board with solid circular tokens.
2. Private/public room support, host seat configuration, authoritative revisions and 60-second roll/move deadlines, persistent reconnects and explicit quit confirmation.
3. Hold/release voice, first-use permission, cancellation, 60-second/1-MiB limits and membership-checked downloads.
4. Offline PWA computer games and manual pass-and-play; System/Light/Dark settings; neo-brutalist homepage with durable online statistics.
5. Correctness/security hardening, storage lifecycle, moderation, monitoring, Docker supervision, verified backup/recovery and validation CI.

## Verified on 2026-10-26

- **60 automated tests pass:** 16 rules (including 100 seeded full games), five multiplayer integration, 12 hardening, five operations/recovery, three local-persistence, one service-worker, four profile/statistics, seven AI strategy, five AI worker and two public-room tests.
- TypeScript and the production client/server build pass. Production dependency audit reports no vulnerabilities at validation time.
- Multi-tab departure removes all tabs from a private room before further updates. Concurrent actions advance one revision only once. Expired deadlines are rejected in the action handler before a delayed background tick.
- Injected SQLite write failures leave persisted and canonical state unchanged. Voice metadata/blob insertion rolls back atomically. Background timer write failures are contained and recover.
- Unknown/expired guest sessions are rejected; limits span tabs/reconnects. Blocked audio cannot be recovered through legacy direct URLs; report review is operator-only.
- A second database owner is refused. Backup checksum/integrity/schema verification and a restore into a new file preserve unfinished tokens and the original deadline. Corrupt saved rooms are quarantined with source data preserved.
- Voice replacement/quota/expiry, abandoned-room cleanup and reconnect after server reopen have regression coverage.
- The production app is running on the Pi under `/home/roy/ludo`, behind the configured Cloudflare hostname `https://ludo.octu.online`. HTTPS, readiness, manifest and private room creation/start succeeded. Docker reports healthy, runs as `node`, restarts unless stopped, and created its first verified backup.
- Real browser checks through Cloudflare: reconnect restores the game, refresh continues the countdown, and Back requires confirmation. Cancelling returns to the game.
- Browser geometry checks at 320x568, 390x844, 844x390 and 1440x900 show the centered board, dice and mic within the viewport without document scrolling. Portrait mobile boards reach both screen edges.
- Real browser offline check: stop an isolated local production server, reload the installed cache, retain the manual game, and roll for subsequent players with the origin unavailable.

## Pending gates and limits

- The user reports successful Android/iPhone gameplay, cross-device microphone playback, refresh/state recovery and network switching through the actual tunnel. Denied permissions, 60-second recording cutoff, interrupted recording and installed offline reopen still need targeted physical-device checks.
- Deployment-specific sustained workload and restart observations are recorded below as they finish. A bounded workload is not a maximum-capacity result.
- Host reboot/power loss, loss of the Pi disk, and recovery from an independently stored off-host backup require operator acceptance. Local verified backups alone cannot recover a lost host.
- Public matchmaking is enabled on the user's explicit request after successful physical-phone gameplay. Guest blocking/reporting/bans are implemented; guest identities can be lost by clearing browser data. Operator moderation remains necessary for public tables.
- CI workflow is validation only: Linux/Windows tests/builds, production dependency audit and a container restart. A release pipeline is intentionally deferred. See the repository Actions page for actual run results.

## Operational handoff

See [OPERATIONS.md](OPERATIONS.md) for environment settings, monitoring, backup/restore, moderation and rollback. Keep each future increment independently reviewable and run its relevant tests; do not infer real-device success from synthetic audio transport or simulated gameplay.

## Pi sustained workload

A disposable instance of the deployed image ran for **301.1 seconds** with eight rooms, 16 human WebSocket clients, 16 computer seats, 713 human game actions, 64 audio uploads/downloads (8 MiB downloaded) and 14 deliberate reconnects. No server errors occurred. Acknowledgement p95 was **144.06 ms**, maximum **6204.13 ms**; peak sampled RSS was **127.1 MiB** and event-loop p95 peaked at **21.22 ms**. The 6.2-second acknowledgement outlier requires further timing/host observation before making latency guarantees. Audio used synthetic format-header payloads to exercise storage/transport; this does not prove physical-device playback. The test used a separate database, so its games did not inflate public staging counters.

A 90.5-second diagnostic repeat also completed without errors (192 actions, 16 audio transfers, four reconnects), but game-action acknowledgements still showed long tails: p95 621.8 ms, maximum 2376.05 ms. This overlapped the Pi image/test validation on the same host. The server's cumulative event-loop maximum reached 6211.76 ms. The root filesystem was 95% used with about 6.8 GiB free. These observations identify a shared-host latency/storage investigation gate; they do not establish the precise cause. All 40 regressions also passed inside the Pi Linux/ARM build. No unrelated host data was removed.

## AI and usability increment

Random guest names are remembered across online/offline setup and Settings. Counters display compact K/M/B/T/Q totals with an exact-count hover/tap disclosure. Lobby seat actions use Add Bot / Remove Bot. The AI subsystem is documented in [AI.md](AI.md), including per-seat difficulty, asynchronous server/browser workers, safe-square staging, a 6,000-game benchmark with confidence intervals, and measured limitations. The original rules remain authoritative.

The deployed public-room update has been verified through the actual HTTPS tunnel: an independent guest discovered a browser-created public table, joined it and left cleanly. The browser shows Add Bot / Remove Bot, per-seat levels and the room default. A generated guest name appeared and an edited online name survived refresh and appeared in Settings. The refreshed offline cache ran the expert opponent with the local origin stopped and no worker errors logged. See AI.md for measured Pi worker latency and resource use.

The expert-bot mixed Pi workload completed 163 AI decisions with no worker failures/timeouts/fallbacks and no server errors. The room acknowledgement p95 was 121 ms, but occasional 9.1-second acknowledgements and a 10.2-second event-loop maximum remain a real hosting limitation. The new worker prevents synchronous AI search from blocking handlers; it does not make synchronous SQLite commits or other shared-host pauses disappear. Public rooms were enabled on explicit request, and these remaining limitations are recorded in AI.md.
