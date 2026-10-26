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

`useRoomVoice` owns recording and playback above its compact/menu presentations. `VoicePlayback` reuses one audio element so a user tap can unlock playback on iOS. Blocked autoplay retains a bounded queue and exposes a visible playback action; speaker mute stops queued audio and game sounds. Up to 30 voice sends per guest and 180 per IP per minute allow normal conversation, with separate byte, transport and storage limits retained.

## Room chat

The header opens a chat dialog without changing the board layout. It shows the most recent 50 chat messages and retained voice recordings, unread counts, selectable/copyable text, large standalone emoji, replies and player mentions. Reply references point to message IDs; the client renders only originals present in its filtered room view. Mention positions and player IDs are checked on the server, which assigns canonical names and colours. Text is rendered as React text, never HTML.

GIFs are uploaded or pasted as files rather than fetched from arbitrary third-party URLs. A single GIF is bounded to 1 MiB and dimensions up to 2048 pixels per side. Binary data lives in `chat_media`, with a 64-MiB server quota; snapshots contain only metadata. A single transaction persists message metadata and media, deletes GIFs whose messages left the 50-message history, then broadcasts. Room deletion cascades to its GIFs. Media routes recheck session, membership and blocks on each request and are excluded from offline caching.

Photos follow the same storage and authorization path. `preparePhoto` decodes supported raster files locally, fits the longest edge to 1080 pixels without upscaling and re-encodes JPEG pixels, dropping original metadata. It targets 256 KiB with a 1-MiB hard cap; source files are limited to 20 MiB and 64 megapixels. The server parses JPEG frame headers and rejects dimensions above 1080 independently of the client. The mobile camera input uses native `capture="environment"`; availability and the picker interface depend on the device/browser. File picking temporarily suspends the short idle timer, with a two-minute fallback; returning resumes normal inactivity handling. No GIF search provider or third-party media URL fetch is involved.

Typing events use authenticated room membership and player identity, respect blocks, are rate limited, and expire on clients after four seconds without refresh. They do not write SQLite or keep abandoned rooms alive. The overlay closes after `CHAT_IDLE_SECONDS` without local input, scrolling, new messages or typing updates; the default is 10 seconds. Drafts survive closing the overlay but are cleared when changing rooms. Disconnecting remains distinct from explicitly leaving; existing room and voice retention policies are unchanged.

The PWA caches the static app, fonts and browser worker. Offline computer games and manual pass-and-play use the shared rules locally. Session endpoints, private API responses and recordings are excluded from the offline cache. Online rooms still require connectivity.

## Deployment boundary

The current deployment has one authoritative Node process and a persistent SQLite volume. A renewable lease refuses a second database owner. Shutdown drains commands, bounds stalled network close handshakes, saves presence and releases the lease. Crash recovery retains the lease safety window; operators must not bypass it while another owner may be alive.

AMD64 and ARM64 images support different hosts; they do not make the game server horizontally distributed. Multiple replicas need room partitioning, shared routing/limits and redesigned durable ownership. A Socket.IO adapter alone does not provide that. See [operations](OPERATIONS.md) and [validation limits](DELIVERY.md).
