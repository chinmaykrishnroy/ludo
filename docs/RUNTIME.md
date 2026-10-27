# Runtime latency investigation

The current deployment is the Delta-hosted k3s workload. Historical standalone
Pi measurements below describe that earlier environment, not current cluster
performance.

On 27 October 2026, the deployed v0.1.6 process reported a 21.14-ms event-loop p95
and a 4020.24-ms maximum over approximately 46 minutes. Its RSS was 118 MiB, the
database was approximately 832 KiB, WAL approximately 4 MiB, and disk free space
approximately 5.7 GiB. It reported no application/storage errors or AI worker
fallbacks/timeouts. The aggregate snapshot is in
[pi-baseline-2026-10-27.json](benchmarks/pi-baseline-2026-10-27.json).

Container CPU throttling totalled approximately 31 ms across two of 16,567 quota
periods. Host I/O pressure was nonzero (about 1–2% in the sampled windows). These
samples do not identify the cause of the historical four-second pause, and do
not establish a supported production capacity.

v0.1.7 adds bounded operation timing to `/api/admin/health`: count, recent p95,
last duration and lifetime maximum with its timestamp. Categories distinguish
room persistence, view preparation, commits, maintenance, backup copy,
verification/hash and retention. Each category retains at most 128 samples.
Operations over 250 ms produce an aggregate warning, throttled to once per
category per ten seconds. No room contents or session credentials are logged.
AI diagnostics include the age of the oldest pending job.

Source inspection found backup integrity/schema validation performed twice,
synchronously on the application thread. It is consolidated into a worker with a
20-second timeout and 128-MiB JavaScript heap limit. SQLite still owns snapshot
consistency, and validation still completes before publishing a backup. This
removes a known blocking path; it does not prove that path caused the measured
pause. Snapshot copying and synchronous room writes still require observation.

Next acceptance is a sustained, isolated Pi workload combining bot games, media,
backups and reconnects, correlating operation peaks with host I/O, CPU and disk
pressure. Keep the live database and real activity counters out of synthetic
load tests. Do not remove host data or change unrelated services to chase a
latency hypothesis.

The local v0.1.7 smoke used 20 rooms and 40 sockets for 342 manual game actions
over 24.72 seconds: acknowledgement p95 was 83.12 ms, maximum 106.85 ms, and
event-loop p95 35.65 ms. Recent persistence p95 was 1.84 ms. This short Windows
loopback run excludes audio, network interruptions and the Pi host. It is not a
capacity claim. See [local-actions-v0.1.7.json](benchmarks/local-actions-v0.1.7.json).

## Historical standalone Pi: confirmed persistent-write stalls

The live v0.1.7 process subsequently reported a 2768.69-ms room persistence
maximum. v0.1.8 now distinguishes SQLite BEGIN, transaction body and COMMIT, and
avoids rewriting an unchanged room-membership index on every roll/move. FULL
synchronous durability and persist-before-broadcast remain enabled.

A disposable candidate backend ran for 180.9 seconds on the Pi's **same ext4
filesystem as production**, with 0.75 CPU / 384 MiB limits, eight rooms, 16 human
WebSocket clients, 16 bot seats, four verified backups, 298 player actions, 40
valid WebM fixture uploads/downloads and eight reconnects. It had zero server
errors and 190 AI completions with no failures/timeouts/fallbacks. Acknowledgement
p95 was 216.48 ms and maximum 2016.02 ms. The explicit targets were p95 <= 250 ms
and maximum <= 1000 ms: **the maximum target failed**.

A SQLite COMMIT took 1458.5 ms while the maximum transaction-body time was
29.57 ms. Event-loop maximum was 1469.05 ms. This locates a blocking path in
persistent transaction commit; it does not distinguish SD-card latency from
other host I/O activity or prove every historical stall has that cause.
[Ext4 workload evidence](benchmarks/pi-v018-ext4-2026-10-27.json).

An initial control used RAM-backed /tmp, which does **not** represent production
storage: p95 11.61 ms, maximum 84.21 ms and maximum COMMIT 1.1 ms. It is explicitly
labelled [tmpfs control](benchmarks/pi-v018-tmpfs-control-2026-10-27.json).
These short runs use different random games; they are diagnostic samples, not a
paired capacity/strength benchmark. Voice transport used a valid recorded fixture,
not physical-device listening. Test databases and containers were removed; public
rooms and counters were not used for load traffic.

Next steps are a persistent-volume SSD trial and, if latency remains material,
a dedicated asynchronous database owner with ordered per-room commands. Such a
change must retain durable acknowledgements, revision/deadline validation, room
serialization and failure rollback. Do not switch to weaker SQLite synchronous
settings or publish memory-only state to disguise storage delays.

## Current Delta k3s deployment

The v0.1.7 cluster process on Delta reported, over approximately ten hours,
maximum persistence 7.31 ms, maximum event-loop delay 26.79 ms, and zero application
or storage errors. Its source, image, node placement, local-path PVC and healthy
GitOps revision were inspected through the control plane.

An isolated candidate pod on Delta used its own local-path PVC, 750m CPU /
384-MiB limits, denied network ingress/egress and a loopback workload. It ran for
180.6 seconds with eight rooms, 16 human clients, 16 bot seats, 274 manual actions,
40 valid WebM fixture uploads/downloads, verified backups and eight reconnects.
Acknowledgement p95 was **16.72 ms**, maximum **55.51 ms**, event-loop maximum
70.65 ms. It completed 213 AI decisions without failure/timeout/fallback and had
zero server errors. Both explicit latency targets (p95 <= 250 ms, maximum <=
1000 ms) passed in this bounded sample. Production rooms and counters were not
used. [Delta evidence](benchmarks/delta-k3s-v0.1.8-2026-10-27.json).

This verifies a bounded mixed workload on the actual deployment class, not a
maximum concurrency promise, full network-outage test or physical audibility
test. The candidate backend was mounted into the previous verified runtime;
release image architecture gates and post-release deployment checks remain
independent requirements. Longer soak testing and overload/admission testing
remain open. Immediate dice presentation addresses the visible input/turn-handoff
problem even when an otherwise healthy network adds a round trip.
