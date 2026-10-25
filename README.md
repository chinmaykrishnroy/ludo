# Ludo Club

[![Validate](https://github.com/chinmaykrishnroy/ludo/actions/workflows/ci.yml/badge.svg)](https://github.com/chinmaykrishnroy/ludo/actions/workflows/ci.yml)

A self-hosted Ludo game for friends: bold, solid colours, round tokens, animated dice and moves, private/public tables, optional computers, and recorded room voice. Install it as a PWA for offline computer games or manual pass-and-play.

## Run locally

Requires **Node.js 24 or newer**. Node's built-in SQLite API is experimental.

```sh
npm ci
npm run check
npm start
```

Open `http://localhost:3000`. Development: `npm run dev`. In PowerShell use `npm.cmd` if script execution policy blocks `npm`.

## Deploy with Docker

```sh
cp .env.example .env
# Set ALLOWED_ORIGINS to the exact HTTPS origin.
# Set ADMIN_TOKEN to a securely generated secret of at least 32 characters.
docker compose up -d --build
```

The default published port is **127.0.0.1:3011**. Point Cloudflare Tunnel at `http://localhost:3011` on the Docker host. The application uses HTTPS/WebSockets for gameplay and recorded audio; it needs no browser UDP transport. Microphones require HTTPS outside localhost.

Public matchmaking is disabled by default. Keep it disabled until the [acceptance gates](docs/DELIVERY.md) pass and an operator is available to moderate reports. Private rooms work during staging.

The Pi deployment helper is `bash ops/deploy-pi.sh 3011`. It installs a supervised container under `~/ludo`, generates a private environment file, preserves shared data across versioned deployments, and checks readiness. See [operations, backup, restore and rollback](docs/OPERATIONS.md).

## Play

- **Online:** create a private table, share its code/link, or join a public waiting table when enabled. Hosts choose computers or empty seats before starting. Humans can replace computers in the lobby.
- **Offline:** play against computers, or choose manual pass-and-play for two to four people on one device.
- **Turns:** 60 seconds to roll, then a separate 60 seconds to choose a token. A missed roll happens automatically; a missed move uses the first legal token. Online deadlines come from the server and survive refresh.
- **Voice:** hold the mic, then release to send. Permission is requested on first use. After a permission prompt, hold again to start. Cancellation discards the recording. Each message is limited to **60 seconds / 1 MiB**. Audio playback may need a browser interaction.
- **Resume:** refresh or reopen in the same browser and hostname to recover your game and tokens. Back opens a confirmation; only confirming Quit releases your seat or clears the offline save. Saved online games have the retention limits below.
- **Appearance:** Settings offers System default, Light and Dark. System default follows OS changes. The playing screen keeps the board, dice and microphone together, with Back in a separate header.

The shared house rules include safe squares, exact finishes, captures, bonus rolls, and the three-sixes penalty. Read the in-app rules for details. There are no stakes, payments or rankings.

## Install and use offline

Open the HTTPS app once and finish loading its assets. Choose Install app or use your browser install menu. On iOS use Share → Add to Home Screen. Offline computer play and manual pass-and-play include saved progress. Online rooms and voice require a connection.

The service worker caches the app, fonts and static assets; it never caches private APIs, sessions or recordings. Close existing app windows and reopen after an update to activate the new cache. Clearing browser data removes your guest identity and local save.

## Reliability and privacy

- Server-issued random guest sessions, HttpOnly/SameSite cookies, expiry, exact origin checks and trusted-proxy handling.
- User/IP rate budgets and connection caps shared across tabs. Leaving revokes every tab's room membership.
- Server-authoritative rolls, legal moves, absolute deadlines and revision checks. One transactional persistence operation precedes state publication.
- SQLite WAL, a renewable single-writer lease, bounded voice storage, archived-room cleanup, verified backups and graceful shutdown.
- Player reporting/blocking, operator guest bans, private admin health/metrics, and a [privacy notice](public/privacy.html).

Voice retention: most recent 20 per room, maximum 24 hours, default global quota 256 MiB. Unattended tables archive after 15 minutes; archived unfinished games expire after 30 days, finished games after seven days, and waiting rooms after one day. Sessions expire after 30 days of inactivity, with a one-year maximum. Reports expire after 30 days. Backups retain at least two copies, normally seven days, with a 28-copy cap. Backups must be copied off the host separately for protection against host loss.

## Architecture and scaling

React 19, TypeScript, Vite, Motion and Phosphor icons form the client. Express 5 and Socket.IO run an authoritative room owner. `shared/game.ts` supplies the same pure rules for browser games, server games and simulations. SQLite stores snapshots, sessions and capped audio blobs.

This is a **single-server deployment** with persistent local storage. A database lease prevents concurrent owners; do not scale replicas against one SQLite file. The configured 500-room cap is a safety limit, not measured capacity.

For horizontal growth, partition rooms among authoritative owners, use PostgreSQL for durable state, private object storage for voice, and shared routing/rate limits/presence. A Socket.IO Redis adapter alone does not coordinate game state or bot timers. Measure deployment-specific load before increasing limits.

## Validation and contribution

```sh
npm test          # rules, HTTP/WebSocket, failure and recovery regressions
npm run build    # type checks, client/server build, versioned offline cache
npm run check    # both
npm run test:load # bounded local smoke; not a capacity certification
```

CI runs tests/builds on Linux and Windows, audits production dependencies, and verifies container startup/restart. It creates no releases, tags or deployments. Release automation is intentionally deferred.

See [delivery and remaining acceptance gates](docs/DELIVERY.md). Physical Android/iOS audio and installation acceptance require real devices; automated transport tests cannot establish audibility.

## License

[MIT](LICENSE), copyright 2026 Chinmay Krishn Roy.
