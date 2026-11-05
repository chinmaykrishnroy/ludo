# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.17]

- Restored recorded hold-to-speak with lobby access, overlapping playback and board speaker highlights.
- Kept chat above the phone keyboard and added three-second message previews.
- Made room switching atomic and added organiser succession and seat colour changes.

## [0.1.15] - 2026-11-02

### Live Voice Resilience & Speaking Indicator Fixes

- **Speaking Indicator Watchdog**:
  - Implemented 3.5s speaking watchdog on listeners to ensure `<name> is speaking` never remains stuck on screen.
  - Ensured speaking state is unconditionally cleared upon `end`, `abort`, `stopPlayback`, and socket close.
- **Jitter & Packet Loss Handling**:
  - Removed 500ms packet gap fatal error that killed live sessions during normal speech pauses.
  - Allowed out-of-order and skipped packet sequence numbers without aborting the session.
  - Replaced fatal playback queue crashes with smooth real-time resynchronization.
- **Buffer & Concurrency Headroom**:
  - Increased AudioWorklet queue tolerance to 50 frames with graceful frame dropping.
  - Increased WebCodecs queue thresholds to 32 frames.
  - Extended encoder flush and server sweep timeouts for WAN reliability.
- **Server Floor Orchestration**:
  - Dropping or unready listeners no longer terminate the floor for remaining members.
  - Relaxed drift detection window to 2,000ms.
  - Broadcast room-wide aborts to clear all client speaking states.

## [0.1.14] - 2026-11-02

### Live Push-to-Talk Reliability & Architecture

- **Fault-Tolerant Floor Granting**:
  - Removed rigid 100% all-listeners readiness requirement in `LiveVoiceRelay`, isolating dropped/unready peers instead of terminating the session.
  - Enabled live talk in solo and bot rooms.
  - Preserved strict bidirectional block enforcement.
- **Background Playback**:
  - Removed hidden document check so background tab listeners receive live audio without interruption.
- **Universal Hardware Support**:
  - Allowed native Web Audio resampling from Opus frame rates to any client hardware rate (e.g. 44.1 kHz Bluetooth/AirPods and iOS devices).
- **Network Resilience**:
  - Increased socket buffer threshold from 1 KB to 16 KB (`LIVE_BUFFER_BYTES`).
  - Extended floor grant timeout to 3,000 ms and end delivery sweep timeout to 3,500 ms to eliminate false voice note fallbacks over WAN latency.
- **Mobile Safari/Chrome Audio**:
  - Added `touchstart` capture and immediate unlock invocation on room mount.

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
