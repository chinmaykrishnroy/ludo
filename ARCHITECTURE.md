# Architecture Guide — Ludo Club

> Last updated: DEV branch refactor (v0.1.12+)

## Overview

Ludo Club is a real-time multiplayer Ludo game built on:
- **Frontend**: React 19 + TypeScript + Vite PWA
- **Backend**: Node.js 24 + Socket.IO + SQLite (via native Node `node:sqlite`)
- **Voice**: WebRTC-style WebSocket relay (live voice) + MediaRecorder (voice notes)
- **AI**: Shared game engine + MCTS-based bot in a Worker thread

---

## Folder Structure

```
.
├── src/                        # Frontend source (React + TypeScript)
│   ├── features/               # Domain-driven feature modules
│   │   ├── lobby/              # Room browser, create/join room flows
│   │   ├── game/               # Board, dice, PlayScreen, game hooks
│   │   ├── chat/               # RoomChat, useRoomChat, chat UI
│   │   └── voice/              # VoicePanel, liveVoice, recording, playback
│   ├── store/                  # Global state hooks (appearance, install, admission)
│   ├── lib/                    # Shared utilities (error reporting, formatting, dialog)
│   ├── workers/                # Web Workers (AI worker)
│   ├── App.tsx                 # Root orchestration shell (minimal)
│   ├── main.tsx                # Entry point
│   └── styles.css              # Global styles
│
├── server/                     # Backend source (Node.js + Socket.IO)
│   ├── rooms/                  # Room lifecycle: create, join, leave, host transfer
│   ├── game/                   # Game action handlers: roll, move, bot scheduling
│   ├── voice/                  # Live voice relay, voice note routes
│   ├── metrics/                # Observability: structured logs, metrics, health
│   ├── ai/                     # AI scheduler + worker
│   ├── app.ts                  # Application factory (orchestration shell)
│   ├── store.ts                # SQLite persistence layer
│   ├── security.ts             # Auth, rate limiting, secrets
│   ├── transport.ts            # Socket.IO transport guards
│   ├── validation.ts           # Zod schemas for socket events
│   ├── monitor.ts              # Performance monitor
│   ├── admission.ts            # Capacity admission controller
│   ├── pressure-sampler.ts     # Server pressure metrics
│   ├── live-voice.ts           # Live voice relay (WebSocket)
│   ├── backups.ts              # Backup management
│   └── index.ts                # Server entrypoint
│
├── shared/                     # Isomorphic code (frontend + backend)
│   ├── game.ts                 # Ludo game engine (canonical state model)
│   ├── protocol.ts             # Socket event types (Room, Reply, etc.)
│   ├── state-schema.ts         # Zod schemas for core state (Room, Game, Seat)
│   ├── voice.ts                # Voice constants
│   ├── chat.ts                 # Chat constants
│   ├── bot.ts                  # Bot constants
│   ├── photo.ts                # Photo utilities
│   ├── liveVoice.ts            # Live voice shared constants
│   └── ai/                     # AI evaluation, tactics, search (MCTS)
│
├── tests/                      # Unit + integration tests (Node test runner)
├── e2e/                        # End-to-end Playwright browser tests
├── scripts/                    # Build, release, smoke-test scripts
└── docs/                       # Documentation
```

---

## Domain Boundaries

### Frontend Features

| Feature | Location | Responsibility |
|---------|----------|---------------|
| **Lobby** | `src/features/lobby/` | Room browser (public tables), create room dialog, join with code |
| **Game** | `src/features/game/` | Board rendering, dice, legal move highlighting, PlayScreen |
| **Chat** | `src/features/chat/` | Room chat panel, GIF picker, message list, chat hook |
| **Voice** | `src/features/voice/` | Voice notes panel, live voice, recording, playback |

### Backend Modules

| Module | Location | Responsibility |
|--------|----------|---------------|
| **Rooms** | `server/rooms/` | Room create/join/leave, host transfer, seat management |
| **Game** | `server/game/` | Roll, move, bot scheduling, game state transitions |
| **Voice** | `server/voice/` | Live voice relay, voice note upload/serve routes |
| **Metrics** | `server/metrics/` | Structured logging, counters, health endpoints |

---

## State Model

The canonical game state is defined in `shared/game.ts` and validated by `shared/state-schema.ts`:

```
Room
├── code: string          (6-char uppercase, high-entropy)
├── host: string          (player ID)
├── seats: Seat[]         (4 seats, null = empty)
├── game?: Game           (null until game starts)
│   ├── revision: number  (monotonic, used for idempotency)
│   ├── phase: "roll" | "move" | "ended"
│   ├── turn: number      (seat index 0–3)
│   ├── dice: number      (1–6, 0 = not rolled)
│   ├── tokens: number[][]  (4 players × 4 tokens, position 0–57)
│   └── seats: Seat[]     (snapshot at game-start)
├── chat: ChatMessage[]
├── voices: VoiceMessage[]
└── updatedAt: number
```

All socket events carrying game mutations are validated at the server against Zod schemas before any state transition occurs.

---

## Data Flow

```
Browser                     Server (Socket.IO)            SQLite
───────                     ──────────────────            ──────
App.tsx                           app.ts
  │                                 │
  ├─ features/lobby  ──room:create──►  rooms/create.ts ──► store.save()
  ├─ features/game   ──game:roll  ──►  game/roll.ts    ──► store.save()
  ├─ features/chat   ──chat:send  ──►  inline handler  ──► store.save()
  └─ features/voice  ──voice:send ──►  voice/routes.ts ──► store.save()
                        ◄─room:state──  emitRoom()
```

---

## Testing Strategy

| Layer | Tool | Location | Coverage |
|-------|------|----------|---------|
| Unit | Node `--test` + tsx | `tests/` | Game engine, room logic, AI, security |
| Integration | Node `--test` + tsx | `tests/` | Socket events, room lifecycle, reconnect |
| E2E | Playwright | `e2e/` | Full user flows (create, join, chat, voice) |

Run all: `npm run check` (tests + build)
Run browser: `npm run test:browser`

---

## Engineering Standards

- **Formatting**: Prettier (`npm run format`)
- **Linting**: ESLint with `@typescript-eslint` strict rules
- **Type checking**: `tsc --noEmit` (strict mode, `noUncheckedIndexedAccess`)
- **Pre-commit hooks**: Husky + lint-staged (lint + format staged files)
- **CI**: GitHub Actions — lint + test + build + Docker smoke + browser E2E
- **Branch protection**: `main` requires passing CI + PR review
- **Conventional commits**: `feat|fix|refactor|chore|test|perf|docs(scope): message`

---

## Security Controls

- **Room codes**: 6-char Base32 (chars `A-Z2-9`), ≥5.9 bits/char entropy
- **Rate limiting**: Per-IP + per-session budgets on all socket events
- **Content security**: Helmet CSP headers, origin allowlist
- **Auth**: Cookie-based session secrets (HMAC-SHA256)
- **Admin**: Bearer token (≥32 chars) required for moderation endpoints
- **Transport**: Max payload size enforced at engine level (`MAX_TRANSPORT_BYTES`)
