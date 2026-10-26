# Project review — 26 October 2026

## Assessment

**Overall: 7/10. Public production readiness: 6/10.** This is a useful, playable single-server product with a solid foundation. The outstanding transport-memory issue and operational stalls prevent an unrestricted-public-launch recommendation. Scores are engineering judgments, not certification or measured availability guarantees.

| Area                        | Rating | Assessment                                                                                                                                 |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Gameplay and interaction    | 8/10   | Focused board, local play, rooms, reconnects and recorded voice; accessibility and voice-state defects remain.                             |
| Rules and state correctness | 8/10   | Shared pure rules, authoritative deadlines and persist-before-publish updates; offline recovery needs stronger validation.                 |
| Bot design                  | 8/10   | Bounded worker search, separate random streams and tactical features; each revised policy needs its own strength evidence.                 |
| Security                    | 6/10   | Meaningful session, membership, moderation and rate controls; one confirmed high-severity transport resource-exhaustion finding remains.   |
| Operations                  | 6/10   | Verified backups, health endpoints and tested container releases; host-loss recovery, alerting and observed long stalls remain gates.      |
| Maintainability             | 6.5/10 | Good rules/AI boundaries; large client/server orchestration modules hide lifecycle coupling.                                               |
| Validation                  | 7/10   | Good rules, integration, restart and worker coverage; browser/media/PWA upgrade automation and sustained capacity evidence are incomplete. |

## Scope and evidence

The source baseline was `29a835a0b8fa60f954f973b1e01c7b256aadd7ad`. Review covered client flows, game/AI logic, server authorization and membership, persistence, background work, deployment, release automation, privacy documentation and tests. The security portion used independent source inspection and a bounded local parser reproduction. Dependencies were inspected where relevant; generated output, private environment/data files and all third-party code were not exhaustively audited. No destructive production or memory-exhaustion test was performed.

The accompanying local patch tunes bot capture preferences and adds three regressions. Other findings below are **not fixes already applied**. The private security workbench report contains detailed evidence; exploit packet recipes and operational secrets are absent from repository documentation.

Prior physical-device checks reported by the owner confirmed Android/iOS private-room audio, refresh and reconnection. Those checks do not cover every permission-denial, installed-offline or upgrade scenario. Existing Pi measurements in [AI.md](AI.md) are prior workload results, not a fresh capacity test during this review.

## Confirmed problems

1. **High: incomplete Socket.IO binary events retain data before application budgets run.** `server/app.ts` sets a per-message limit but uses the default parser. Application action/voice budgets run after event reconstruction. A bounded decoder reproduction retained partial attachments without dispatching an event. Authenticated anonymous connections can therefore consume substantially more memory than the intended application budget. Add parser-level attachment, aggregate-byte and reconstruction-time limits first. This demonstrates a retention path, not a production OOM incident.
2. **Browser storage failures can prevent rendering.** `src/useAppearance.ts` reads/writes local storage without protection; `src/App.tsx` and `src/persistence.ts` have further unguarded accesses. Rendering the real appearance hook against denied storage throws. A shared fallback must handle obtaining the storage object as well as failed operations.
3. **Malformed offline saves can enter an impossible move phase.** `loadPractice()` accepts a move state with a die but no legal token. A local reproduction accepts this state and the timeout path subsequently attempts an undefined token. Validate semantic invariants before restoring and test migration/recovery.
4. **Automatic voice playback preferences reset when the menu closes.** Reproduced in a real browser: disable autoplay in the menu, resume play, reopen the menu; autoplay is enabled again. `VoicePanel` owns the preference but is replaced between compact and menu views. Playback/recording ownership should outlive those presentations.
5. **Archived room restoration bypasses active-room admission checks.** Creation checks the cap; saved-room restoration lacks equivalent admission control. Define reconnect capacity without sacrificing valid saved games. The control-flow gap is confirmed; an overload incident is not.
6. **Small turn labels have insufficient contrast.** Cream `#fffdf5` on red `#e85050`, green `#26966a` and blue `#477ee0` measures approximately 3.62:1, 3.65:1 and 3.87:1. Normal text needs 4.5:1 under the [WCAG contrast criterion](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Test rendered text sizes and both themes. Dialogs also need explicit accessible names.
7. **Documentation has drifted.** Operations still says there is no release pipeline. Privacy retention language is more absolute than configurable voice retention and the backup policy that always retains at least two copies. Registry-only runtime deployments need accurate upgrade/rollback instructions.

## Risks and acceptance gates

These require investigation or validation rather than being additional reproduced vulnerabilities:

- A prior mixed Pi workload recorded approximately nine-second action delays and a ten-second event-loop maximum. Instrument database/backup work and host disk latency before choosing a fix; the root cause is unproven. Recheck previously reported high disk use.
- Verified local backups cannot recover a lost host. Automate protected off-host copies and restore drills, with alerts for backup age, failed writes, disk headroom and long event-loop delays.
- Release concurrency is per tag and publication unconditionally moves `latest`. Older tags or concurrent releases can move that alias backwards. Serialize publication and enforce version ordering independently of immutable version tags.
- Browser media lifecycle, denied permissions, rapid recording, PWA upgrades and missing cached assets need automated regressions and Android/iOS checks. A possible recorder callback/lifecycle race remains unconfirmed.
- Fault-inject backup failures and inspect temporary-file cleanup. Inventory runtime license notices and bundled font notices; the container does not explicitly copy the repository LICENSE into its runtime stage. This is a packaging review task, not a legal conclusion.
- Moderation tools exist, but operator response, guest identity resets, report retention and abuse drills need validation. Large public concurrency is unproven.

## Bot behavior change

The requested direction is sensible: worthwhile captures create interaction and initiative, while unconditional attacks make an expert exploitable. The patch adds a bounded preference for actual captures, opponent progress lost and a newly earned bonus roll. It discounts exposure of an invested attacking runner. A six receives no duplicate bonus-roll reward. Terminal wins remain above positional scores, safe-square planning remains available, and human timeout/level-zero behavior stays first-legal.

In 256 seeded legal positions selected for an available capture and multiple choices, captures increased from **151 to 215**; the new policy still declined captures in **41** positions. The safe-capture-versus-future-ambush regression now passes, as does a counterexample where protecting an advanced runner is preferable. These are style/correctness checks, not proof of stronger play. All 48 low-budget complete-game smoke simulations finished. See [AI.md](AI.md) and the [measurement file](benchmarks/ai-capture-balance-2026-10-26.json) for budgets and limits.

## Architecture direction

Keep shared rules authoritative and AI a bounded decision service. Extract durable client voice/connection controllers and server room-command/persistence boundaries around tested behavior. Avoid a framework rewrite. SQLite with one writer is reasonable at current scale; horizontal replicas need explicit room ownership/routing and shared durability. Add those only after measured demand.

The actionable backlog is in [TODO.md](TODO.md).

## Validation of the local patch

`npm run check` passed: **68 tests, zero failures**, followed by TypeScript checks, the production client/server build and generated offline cache (33 assets). The added benchmark script reproduced all 256 position choices and completed all 48 smoke games. `git diff --check` passed. The integration suite needed local-server access and a workspace-local temporary directory; the initial restricted-sandbox run could not exercise those tests.

This patch has not been committed, published as a container or deployed to the Pi. No new container, public-host load or physical-device acceptance is claimed. The independently completed security scan applies to the pinned baseline; this review does not imply its reported vulnerability has been fixed.

## Follow-up status

The preceding sections record the review at completion. Subsequently, **v0.1.2** published the bot patch and review documents and was deployed by verified image digest. Public HTTPS readiness, WebSocket clock sync and same-guest reconnect passed after deployment; existing game data and configuration were retained.

The first backlog item now has a separate source fix in `server/transport.ts`: bounded reconstruction, shared ingress budgets and absolute attachment expiry. Seven additional regressions pass, making **75 tests**, and the production build succeeds. An independent review found no concrete bypass or regression; wire controls cover native/base64 WebSocket and polling with maximum-size voice. This follow-up is not part of the immutable v0.1.2 image, and the completed baseline security report remains unchanged. The remaining backlog and original readiness rating have not been reassessed.
