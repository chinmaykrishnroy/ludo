# Implementation architecture

## Components

| Path                               | Responsibility                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `src/`                             | React interface, board animations, room controls, recording and offline saves         |
| `shared/game.ts`                   | Pure legal moves, dice application, captures, safe squares, turns and winning rules   |
| `shared/ai/`                       | Bot analysis, evaluation, difficulty policies and bounded search                      |
| `server/app.ts`                    | HTTP/WebSocket authentication, commands, room ownership, deadlines and publication    |
| `server/store.ts`                  | SQLite transactions, sessions, room snapshots, recordings, retention and writer lease |
| `server/ai/`                       | Background bot worker, queue, cancellation and fallback                               |
| `server/backups.ts`                | Verified online backups and restore validation                                        |
| `scripts/build-service-worker.mjs` | Versioned static offline app cache                                                    |

## Online game updates

The server owns online game state. Clients submit intentions such as roll or move with the revision they observed. The server validates the issued session, origin, rate budget, membership, actor, phase, revision, absolute deadline and legality as applicable to the command. A client cannot supply the outcome of an online roll.

Mutations operate on a draft. The database transaction must succeed before the canonical in-memory room changes and the new state is broadcast. A failed write leaves the previous game intact. Room membership has a player-to-room index; leaving evicts every tab belonging to that guest from the room channel before further private updates.

Online dice use cryptographic randomness. Bots search hypothetical future rolls using separate randomness; they cannot inspect future production dice or change the distribution. The rules remain authoritative for both actual and simulated moves.

## Deadlines and reconnects

Each roll has a 15-second deadline and each token-selection phase a 30-second deadline, assigned as absolute server timestamps by the shared rules. Handlers reject actions after that deadline even if a background tick is late. Missing a turn triggers a roll or the first legal token move; temporary disconnection does not grant expert bot decisions.

Server-issued HttpOnly guest cookies recover the same seat across tabs, refresh and reopening, subject to session and room retention. Saved snapshots retain tokens, phase, revision and deadline. Explicit Quit releases the seat; browser refresh does not. Offline progress uses browser storage and is cleared by explicit Quit or storage removal.

## Bot execution

The shared AI returns a legal token choice and diagnostics without network or storage access. Node and browser workers run searches away from UI and request handlers. Before committing a result, the server checks that its room, revision, actor, phase and legal moves still match. Stale results are discarded. Search budgets, queue limits and fallbacks keep computation bounded. See [AI.md](AI.md) for measured strength and limitations.

## Audio and offline operation

Hold-to-speak records a message for upload over HTTPS; it does not create a live call. Permission is requested on first use. Recordings are capped at 60 seconds and 1 MiB, membership checked, and subject to count, age and storage retention. SQLite stores recording blobs and metadata together.

The PWA caches the static app, fonts and browser worker. Offline computer games and manual pass-and-play use the shared rules locally. Session endpoints, private API responses and recordings are excluded from the offline cache. Online rooms still require connectivity.

## Deployment boundary

The current deployment has one authoritative Node process and a persistent SQLite volume. A renewable lease refuses a second database owner. Shutdown drains commands, bounds stalled network close handshakes, saves presence and releases the lease. Crash recovery retains the lease safety window; operators must not bypass it while another owner may be alive.

AMD64 and ARM64 images support different hosts; they do not make the game server horizontally distributed. Multiple replicas need room partitioning, shared routing/limits and redesigned durable ownership. A Socket.IO adapter alone does not provide that. See [operations](OPERATIONS.md) and [validation limits](DELIVERY.md).
