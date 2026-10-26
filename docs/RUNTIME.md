# Runtime latency investigation

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
