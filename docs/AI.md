# Bot AI

The bot subsystem follows the supplied AI architecture. The existing game rules, authoritative dice, multiplayer transport and persistence remain the source of truth.

## Boundaries

`shared/ai/index.ts` exposes `chooseBotMove(game, { difficulty, rng, searchBudget, clock })`. It returns a legal token, difficulty, reason codes, estimated utility and search statistics. It performs no network, storage, room-statistic or broadcasting operations. Simulations call the same `roll()`, `move()` and `legalMoves()` functions as real games. Rule-state cloning is optimized, without changing movement/capture rules.

`analyzer.ts` and `features.ts` inspect progress, completion, vulnerable tokens, safe squares, protected staging positions, exact-finish distances and threatening rivals. Home-lane and safe enemy tokens are excluded from capture/chase targets. A protected staging square earns value when fair future dice can reach a capturable rival; duplicate own tokens do not multiply that opportunity. Turn order discounts opportunities when the target can act first. These analytic threat estimates are approximations; search simulates actual moves and bonus rolls.

`evaluator.ts` normalizes strategic utilities. These values are not calibrated win probabilities. Terminal wins dominate positional heuristics. `tactics.ts` provides interpretable reasons including IMMEDIATE_WIN, STOP_LEADER, CAPTURE, ESCAPE_THREAT, SAFE_POSITION, SAFE_AMBUSH, RELEASE_TOKEN and ADVANCE.

`policy.ts`, `search.ts`, `simulator.ts` and `rng.ts` implement difficulty, look-ahead, stochastic MCTS and independent seedable search randomness. Production dice use the existing cryptographic generator and are never supplied to the search as future knowledge.

## Difficulty

| Levels | Policy                                                                         |
| ------ | ------------------------------------------------------------------------------ |
| 0      | Always the first legal token, exactly matching human timeout behavior          |
| 1–2    | Random or mostly random legal choices                                          |
| 3–6    | Increasing tactical/safety evaluation with decreasing exploration              |
| 7–8    | Shallow probability-aware look-ahead using all six possible dice               |
| 9–10   | Heuristic-guided stochastic MCTS with UCT exploration and fair chance sampling |

MCTS keeps a separate reward for each player. At rival decision nodes it evaluates that rival's own interests, not coordinated worst-case collusion against the root player. Rollouts use a reasonable tactical policy. Heuristic priors stabilize bounded searches; outcomes and useful positions contribute to estimated utility. Level 10 searches more samples and a larger horizon than level 9. More computation does not guarantee a better choice in every position or a strict win-rate ranking between adjacent levels.

## Integration and budgets

Node uses a single lazy worker through `server/ai/scheduler.ts`. A bounded queue tracks room, revision and actor; snapshots are cloned, obsolete jobs are cancelled, and results are revalidated for revision, actor, attendance, phase and legality before one durable commit. Workers never publish speculative states. A timeout or worker failure returns a lightweight legal tactical fallback. Shutdown cancels outstanding jobs.

Offline play uses `src/workers/ai.worker.ts`; cancellation on state changes and snapshot identity checks prevent old replies moving a new game. A lightweight fallback keeps offline play usable if a worker cannot start. Worker bundles are included in the PWA static cache.

Defaults in `.env`:

```dotenv
BOT_DIFFICULTY=10
AI_SEARCH_ITERATIONS=96
AI_SEARCH_DEPTH=24
AI_SEARCH_MS=120
```

These are maxima for level 10. The server halves the iteration cap and limits depth to 16 at level 9. The scheduler's 1.5-second total deadline includes queueing/startup and can terminate a stuck worker. Search checks its elapsed budget between simulation steps; an individual rule/evaluation step may finish slightly beyond the soft time limit. Fixed iteration limits remain the primary reproducible budget.

Hosts set a default for new bots and can override each bot in the lobby. Offline setup supports individual levels as well. Settings persist in room/game/seat snapshots through SQLite, archives, reconnects, and offline saves. Older seats with no difficulty inherit the saved room/game default, or BOT_DIFFICULTY (10 by default). Changes are host-only, validated, and disallowed during an active match.

Human timeouts always use the first legal move. Temporary disconnection does not grant expert decisions. Explicit Quit replaces the departed seat with a bot using the room default.

## Validation and measurements

Deterministic tests cover strategic captures, stopping the final rival runner, safe squares, staged ambushes, home-lane exclusion, exact finishes, fair dice sampling, immutable simulation, fixed-seed replay, worker cancellation, stale result rejection, timeout fallback, host permissions and difficulty recovery.

The [6,000-game report](benchmarks/ai-tournament-2026-10-26.json) compares levels 0, 3, 5, 7, 9 and 10 against the previous greedy implementation. It rotates colours and player counts, uses legal midgame warmups for half the seed groups, and separates dice and search RNG. Each level plays 1,000 games; uncertainty is reported with Wilson 95% intervals. Fixed iteration limits disable the elapsed cutoff for reproducibility in this benchmark. Runtime workers retain the elapsed cutoff.

Level 10 results:

| Players | Wins / games | Win rate | Wilson 95% interval |
| ------- | ------------ | -------- | ------------------- |
| 2       | 213 / 334    | 63.77%   | 58.49–68.74%        |
| 3       | 153 / 333    | 45.95%   | 40.67–51.31%        |
| 4       | 101 / 333    | 30.33%   | 25.64–35.47%        |

An equal greedy field has a symmetric reference win rate of 50%, 33.33%, or 25%, respectively, with player positions rotated. These results support improvement over that baseline and weak first-legal play. They do not prove optimality or a universal ordering among stronger levels; level 9 was competitive with level 10 on this sample. The 6,000-game run took 580.14 seconds in four local benchmark workers, used 2,139.875 CPU seconds in that process, and peaked at 640.4 MiB sampled RSS. Local level-10 decision p95 ranged from 35.225 to 57.381 ms under benchmark contention. These are not Pi latency claims.

Reproduce after `npm run build`:

```sh
AI_TOURNAMENT_GAMES=6000 AI_TOURNAMENT_ITERATIONS=96 node scripts/ai-tournament.mjs
node scripts/ai-worker-benchmark.mjs
```

The worker benchmark separately measures the actual deployment-style time cap, fallback count, CPU and memory. Real-device gameplay, storage stalls, and other Pi services remain relevant acceptance limits. Do not interpret a simulated game result as proof of audible voice or maximum server capacity.

## Pi worker verification

The deployed image completed 72 four-player decisions in one isolated worker with one CPU and a 384-MiB container cap. The actual 96-iteration / 24-transition / 120-ms search budget was enabled. Response p95 was **108.47 ms**, maximum **208.56 ms** including worker startup; search p95 was **107.76 ms**, mean iterations **95.3**. Sampled RSS peaked at **113.8 MiB** and process CPU use was **4,560.234 ms**. All 72 decisions completed with zero worker failures, timeouts or fallbacks. These figures measure this workload on the Pi; they are not a global server capacity claim.

## Mixed expert-bot workload on the Pi

A separate instance of the deployed image ran for 181.2 seconds with eight rooms, 16 human sockets, 16 computer seats, 397 human game actions, 40 synthetic audio transfers (5 MiB downloaded) and eight reconnects. The AI worker completed 163 decisions with zero cancellations, fallbacks, timeouts or failures. No server errors occurred. Acknowledgement p95 was 121 ms, sampled RSS peaked at 178.5 MiB and event-loop p95 at 23.48 ms. However, three game-roll acknowledgements took approximately 9.1 seconds and the event-loop maximum reached 10.2 seconds. Those shared-host stalls remain an operational investigation gate; this workload does not establish production capacity or a guaranteed latency bound. All load-test data was isolated from real homepage counters.
