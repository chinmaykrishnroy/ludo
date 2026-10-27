# Capacity and overload verification — 27 October 2026

These are bounded experiments on an isolated k3s worker, not a universal player
limit or availability promise. No production rooms, counters or database were used.

The server had 1500m CPU, 768 MiB memory, a fresh local-path PVC, SQLite FULL
synchronous durability and the same HTTP startup/readiness/liveness probes as
production. A separate 2-CPU / 2-GiB driver simulated two humans per room, game
intents about every 1.2 seconds, text chat every five seconds, and a valid 4,110-byte
WebM upload/download every 30 seconds. The no-bot capacity test complements the
[eight-room mixed bot/backup/reconnect test](RUNTIME.md). Static test ceilings were
raised to 5,000 rooms / 10,000 connections, with distinct simulated client IPs
trusted only inside the private test network. Public ingress was denied.

## Before pressure admission

| Rooms / seated users | Action/chat p95 |      Maximum | Outcome                              |
| -------------------- | --------------: | -----------: | ------------------------------------ |
| 8 / 16               |        17.17 ms |     25.44 ms | Clean                                |
| 100 / 200            |        49.03 ms |     91.33 ms | Clean                                |
| 200 / 400            |       114.83 ms |    249.22 ms | Clean                                |
| 300 / 600            |    10,000.28 ms | 10,001.23 ms | Liveness restart; transport failures |

Each stage lasted 35 seconds. The first observed operational failure was 300
rooms / 600 admitted players. The last clean short stage was 200 / 400; this does
not certify a sustained supported capacity. A liveness-probe timeout restarted
the process, rather than an OOM. A subsequent zero error counter was a reset,
not evidence of success. The test stopped at failure instead of continuing to
an arbitrary room count. [Raw summary and harness caveats](benchmarks/delta-capacity-unguarded-2026-10-27.json).

## With pressure admission

Existing tables stayed active during room creation. During the burst toward
100 rooms, the guard refused eight new-work requests after 32 active rooms / 64
seated humans had been admitted. These existing tables continued for 25 seconds:
action/chat p95 **18.81 ms**, maximum **37.28 ms**, no action/media failures and
**zero pod restarts**. The controller recorded one pause and one recovery; a new
room was accepted after recovery. It had already reopened during the observation
window. The 74 peak sockets include transient refused admissions and a recovery
visitor, so they are not 74 seated players.

This validates refusal before overload, continued service and automatic recovery
for this burst. It does not establish 32 as a ceiling, prove every possible burst
is survivable, or replace a longer soak. [Guarded summary](benchmarks/delta-capacity-guarded-2026-10-27.json).

## Admission policy

The normal server samples about once per second and refreshes on new-work
requests at most four times per second. It checks event-loop p95/max delay,
event-loop utilization, native RSS versus the process memory limit, available
memory headroom, persistence p95 over the last five seconds, and oldest bot work.
New room creation and new game starts pause after two pressured samples, or
immediately for severe pressure. Existing room joins, reconnects, rolls, moves,
chat and media keep their normal authorization and abuse limits.

Defaults pause at p95 delay >=100 ms, max delay >=500 ms, utilization >=80%,
memory pressure >=85%, persistence p95 >=40 ms, or bot queue age >=750 ms.
Severe memory >=93%, persistence >=200 ms or queue age >=1250 ms also pause
immediately. Memory pressure is the larger of RSS/limit and
`1 - availableBytes / min(limitBytes, 512 MiB)`; the latter reserves a bounded
amount of actual headroom without treating all other host usage as app usage.

Reopening requires five healthy samples and at least ten seconds closed, with
lower recovery thresholds (delay p95 <=50 ms/max <150 ms, utilization <=60%,
memory <=75%, persistence <=20 ms, bot age <=250 ms). Old persistence observations
expire so a historic spike cannot hold admission closed indefinitely. Protected
health exposes causes, pressure samples and pause/recovery/refusal counters.
`GET /api/admission` exposes only availability and a retry hint; the UI checks
without overlapping requests and the command handler remains authoritative.

Static hard ceilings and rate limits remain as a final safety bound. Admission
cannot remove work already accepted or guarantee survival of an instantaneous
unbounded burst, a full disk, or a host failure. Single-writer SQLite still
requires one active application instance. Before raising production capacity,
run a longer steady ramp, reconnect bursts, bot-heavy traffic and physical-device
checks over the real HTTPS route. The harness requires an explicitly disposable
target: `LOAD_CONFIRM_DISPOSABLE=1`, `LOAD_URL`, isolated `ADMIN_TOKEN`, and a valid
`LOAD_AUDIO_FILE`; do not point it at a public production server.
