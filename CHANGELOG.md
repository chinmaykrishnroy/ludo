# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.13] - 2026-11-02

### Architecture & Domain Modularization

- Split monoliths into domain features:
  - `src/features/game`: Board, Dice, PlayScreen, useDicePresentation, useGameFeedback, feedback audio/haptics, offline AI
  - `src/features/chat`: RoomChat dialog, useRoomChat controller
  - `src/features/voice`: VoicePanel, useRoomVoice, live voice worklet & Opus/Ogg streaming
  - `src/features/lobby`: RoomBrowser modal, BotDifficulty selector
  - `src/store`: State persistence, local appearance, server admission, user profile
  - `src/lib`: Common dialog focus trapping, error reporting, number formatting, photo preparation
  - `server/rooms`: Room manager, member channels, room view projection, host authority transfer
  - `server/game`: Game action authority validation, turn deadlines, idempotency cache
  - `server/voice`: Live voice relay orchestration
  - `server/metrics`: Structured JSON logging, GameTelemetry metrics, Monitor telemetry
- Maintained 100% backward-compatible re-exports across `src/` and `server/` root files.

### Game State & Network Reliability

- Defined canonical TypeScript state models and runtime Zod schemas for all socket events in `shared/types/`.
- Implemented `IdempotencyCache` for game actions (`game:roll` and `game:move`), preventing duplicate execution from network jitter or rapid clicks.
- Extracted strict server-side authority validation (`validateGameAction`) ensuring deterministic turn resolution.

### Testing & Observability

- Added `tests/game-rules-edge.test.ts` covering:
  - Idempotency cache lifecycle (TTL expiration, capacity trimming, clear)
  - Game action authority validation (rejection of stale revision, wrong turn, expired deadlines, bot hijacking, invalid phases)
  - Game rules edge cases (exact finish requirements, home lane overshooting rejection, multi-token captures on unsafe squares, extra roll on capture)
  - Room code entropy and format verification (Crockford base32 format)
  - Operational telemetry counters and structured JSON log formatting
- Total automated test count expanded to 138 passing test suites.

### Performance & Accessibility

- Memoized high-frequency components (`Token`, `Board`, `BotDifficulty`, `RoomBrowser`) eliminating unnecessary re-renders during state transitions.
- Added `@media (prefers-contrast: more)` styles for enhanced visibility on borders, focus rings, badges, and boards.
- Improved ARIA labels and screen-reader status across `PlayScreen` and `Dice`.

### Engineering Quality

- Configured ESLint 10 flat configuration (`eslint.config.mjs`) with strict TypeScript rules.
- Added Git pre-commit hooks via Husky and `lint-staged`.
- Added PR template (`.github/PULL_REQUEST_TEMPLATE.md`) with domain-driven quality checklist.

---

## [0.1.12] - 2026-11-02

- Stable release with comprehensive PWA offline caching, multi-architecture docker builds, and admission control.
