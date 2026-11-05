# Historical live push-to-talk design

Versions 0.1.11 through 0.1.15 used this design. Version 0.1.16 returned to recorded hold-to-speak.

The default hold-to-speak action attempts live room audio, falling back to the existing recorded-message architecture. This feature is independent of dice/game deadlines and has no effect on game rules. It requires no Coturn, peer-to-peer connectivity, new public ports or third-party media provider.

## Transport and audio

- Dedicated same-origin `/live-voice` WebSocket using subprotocol `ludo-voice-v1`. Socket.IO remains responsible for gameplay, chat and recorded uploads. Audio cannot fill its send queue.
- Mono Opus at 48 kHz, 24 kbps constant bitrate, 20 ms frames. An AudioWorklet gathers microphone samples; a dedicated worker owns WebCodecs encoding/decoding. The server never decodes or mixes audio.
- Native Opus support is probed at runtime in the actual worker. Both WebCodecs and AudioWorklet availability are required. Browsers without either keep voice notes. HTTPS and a listener gesture are required; the live-audio prompt unlocks playback without requesting a microphone.
- One live speaker per room. A room-local floor avoids competing speakers, unnecessary mixing and multiplying encoder/decoder work. Other holds still have recorded fallback. A guest receives a live session on one ready tab, rather than echoing it on every tab.
- A packet has a 12-byte big-endian header: uint32 stream ID, uint32 sequence, uint32 media timestamp in milliseconds, followed by one Opus packet. Sequences start at zero and timestamps advance by 20 ms. Maximum packet size is 512 bytes.
- At the configured bitrate, audio payload is approximately 3 kB/s per speaker. Headers add about 0.6 kB/s, excluding WebSocket/TLS/TCP/tunnel overhead. A four-person room has at most three outgoing copies, about 10.8 kB/s total relay egress. This is a sizing estimate, not a measured capacity claim.

## Bounded latency and failure

TCP still has head-of-line blocking. The implementation prevents indefinite application queues; it cannot remove retransmission delays inside the network.

- Capture allows at most ten unacknowledged worklet messages; encoder/decoder queues are limited to eight requests. Encoded packets and PCM frames transfer buffers between threads.
- Sender/relay WebSocket buffered amounts are capped at 1024 bytes. A slow listener aborts the session instead of retaining seconds of queued speech. Playback schedules about 60 ms ahead with a 250 ms ceiling and at most sixteen scheduled buffers. A receive gap above 500 ms ends live delivery.
- Server limits one hold to 60 seconds, enforces sequence/media-clock pacing, limits frames per user/IP, and aborts a stalled stream after 2.5 seconds without audio. Connection and control budgets also apply across tabs.
- A successful end requires listener decoder acknowledgements. If acknowledgements do not arrive, the sender does not silently throw away its recording. Acknowledgements confirm decoding/scheduling, not that a human physically heard sound.
- Existing `createVoiceRecording` runs on a cloned stream during a hold. After live delivery succeeds its local blob is discarded; otherwise the complete note is uploaded through the existing size/rate/storage/retention controls. A partially heard live session may therefore be followed by its full note. Explicit cancellation discards the note; live speech cannot be unsent.
- Room change, explicit leave, cancellation, unmount, hidden document and loss of focus stop microphone use. Reconnection uses exponential backoff with jitter; it never resumes a microphone automatically.

## Authentication, privacy and operations

The WebSocket upgrade validates the existing HttpOnly guest cookie, allowed origin, active primary game connection and room membership. It accepts no session secret in a URL. Per-IP/guest/global audio connection limits reuse the deployment's connection ceilings. Oversized frames are rejected before reaching application handlers; compression is disabled.

Each media frame checks in-memory membership and cached block policy. Successful membership changes revoke all of that guest's audio tabs synchronously, and blocks end affected sessions. Session/ban validation and ping/pong checks run periodically; primary-session disconnect immediately invalidates its audio connections. Failed persistence does not change membership. The frame hot path performs no database reads/writes and does not broadcast a room snapshot.

Mute discards live samples and stops scheduled sound immediately; the existing muted-speaker toast identifies the speaker. Unmuting during speech starts at the current sequence, without replaying earlier audio. Live media is neither stored in SQLite nor placed in offline caches. TLS terminates at the hosting infrastructure; this is not end-to-end encryption.

`LIVE_VOICE_ENABLED=false` disables live upgrades without disabling recorded voice. The existing HTTPS reverse proxy must pass WebSocket upgrades for `/live-voice` as well as Socket.IO. No special Cloudflare TCP service is used; normal HTTP(S) Tunnel routing is sufficient.

Protected `/api/admin/health` includes `liveVoice`: connections, active speakers, frame and byte counters, rejects, fallback count and completed sessions. Protected `/metrics` also exposes live connection/speaker gauges and frame/egress/fallback counters. Metrics contain no audio content.

## Scaling

Forwarding is room-local and bounded to three guest listeners. Each sender encodes once; each recipient decodes once. Frames are reused for fan-out without transcoding or persistence. One worker per browser room keeps codec work off the UI thread.

The whole application still has one authoritative process and SQLite writer. Do not add replicas sharing its database. A future distributed deployment must route game and audio connections to the room owner, or introduce an authenticated media tier with authoritative membership revocation. A Redis Socket.IO adapter alone does not route this independent WebSocket or coordinate game ownership. Load-test the real tunnel/network and CPU/memory limits before raising connection ceilings.

## Validation

Local verification completed with **133 automated tests and a production build**, full **37-check suites for Chromium, Firefox and WebKit**, and **24 additional focused checks** after the final status/focus changes. The focused runs cover live delivery/fallback, rapid typing without spending duplicate audio-control quotas, light/dark accessibility, and phone/desktop layout. Validation also reproduced a WebKit keyboard issue: native Tab order skipped the final link and let focus leave a dialog, while pointer clicks did not reliably focus the Settings opener for restoration. Dialogs now explicitly cycle visible controls, and Settings focuses its trigger before opening. The architecture-image smoke probe also checks authenticated live forwarding and delivery acknowledgement on the packaged server.

`tests/live-voice.test.ts` uses real HTTP/Socket.IO/WebSocket connections to test forwarding, successful delivery acknowledgement, no frame-path persistence, listener readiness, floor contention, all-tab leave revocation, audio-only reconnect, mute/unmute, malformed/oversized packets, missing acknowledgement and the kill switch.

`e2e/live-voice.spec.ts` exercises two isolated browser guests with generated microphone audio, never the host microphone. On capable browsers it verifies non-silent decoded Opus playback before release, speaker state, mute notices and recorded fallback selection. Unsupported browsers exercise the recording path. The generated signal validates the runtime path; it does not establish physical-device acoustic quality or end-to-end tunnel latency.

Run `npm run check` and `npm run test:browser`. The browser runner gives each engine a fresh server, matching CI and preserving production room-creation quotas rather than raising them for the combined suite. `npm run test:browser -- --project=chromium` runs just one engine. `npm run test:voice-load` runs a local synthetic relay/chat workload with controlled admission; it never connects to a deployment. Configure `LIVE_LOAD_ROOMS` (1–20), `LIVE_LOAD_SECONDS` (1–30) and optional `LIVE_LOAD_REPORT` to reproduce a report. This measures relay fan-out only, with client and server in one process and in-memory SQLite; it is not an Opus or production-capacity benchmark.

### Local relay smoke result — 1 November 2026

On the Windows development host with Node 24.12.0, a 15-second run admitted **20 rooms / 80 guests / 20 simultaneous speakers**. It forwarded all **15,000 input frames to 45,000 expected recipient frames**, completed all 20 sessions with zero fallbacks, and handled 300 concurrent text-chat commands. Chat p95 was **134.67 ms**, event-loop p95 **22.41 ms** (maximum **126.94 ms**), and maximum measured client WebSocket backlog was zero. Measured process RSS rose **40.29 MiB**; CPU was **34.24% of one core**, including synthetic clients in the same process. [Raw report](benchmarks/live-voice-local-2026-11-01.json).

This short local run uses synthetic 60-byte media packets, controlled admission and in-memory storage. It excludes native encoding/decoding, bots, network loss, the tunnel and disk persistence. The initial run with the real sampler refused new rooms while the shared development host was under pressure; the isolated relay measurement deliberately controls admission, so it must not be presented as a guarded production capacity test. Reproduce with `LIVE_LOAD_ROOMS=20`, `LIVE_LOAD_SECONDS=15` and `npm run test:voice-load` (set variables using your shell's syntax).

Before enabling a released build broadly, verify Android and iPhone over the HTTPS tunnel: permission timing, live speech before release, mute/unmute during speech, the 60-second cap, rapid re-holds, background/resume, network switching, loss of one listener and voice-note fallback. Physical-device acceptance remains a manual gate.

Primary API references: [AudioEncoder](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder), [AudioDecoder](https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder), [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet), [Cloudflare Tunnel WebSockets](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/). MediaRecorder blobs are kept for the existing recording path rather than assuming individual chunks are independently playable.
