# Bounded performance experiment — 2026-09-29

Baseline commit: `26e0fd9de15c1b8e297bf8da65a0f85e31f9f284` (clean working tree).

## Measurement method

`tools/performance/positions.cjs` fixes ten positions before production changes. Each of six modes is measured three times, in a fresh real browser Worker per request. `browser-bench.cjs` extracts the application's actual `spawnAnalysis` function. It records elapsed time, completed depth, nodes, nodes/sec, candidates, alpha-beta TT hits, move, score, available candidate list, PV, proof flags, cancellation observations, and main-thread scheduling lag.

Machine: Intel Core i5-4460, four logical processors. Browser: headless Edge 154.0.4258.37. One analysis Worker. No external game load is synthesized; these results do not establish responsiveness on all machines or under all competing loads. The heartbeat exercises a small browser page, not a full game rendering workload.

Baseline `정밀` was actually 8 seconds; the requested new mode is 7 seconds. Baseline automatic label said 8 seconds, but its position planner could already select 15 seconds. Reports retain actual requested/planned budgets.

Nodes/sec is reported engine nodes divided by end-to-end wall time. It is not a count of every pattern or legality operation. TT telemetry covers alpha-beta tables only. Some deep engine results expose only one candidate, so their reported top-three list cannot establish stability of unavailable second/third candidates.

Cancellation measures the synchronous `Worker.terminate()` API duration and messages observed for 150 ms afterwards. It does not measure the OS thread's exact exit time. Browser timer scheduling cannot provide a real-time guarantee if the main thread or OS is suspended.

CPU profiles are separate from Worker benchmarks. They execute the same engine on the profiled browser thread. The leading categories were pattern/winning scans, evaluation, and candidate generation; GC was also significant. Serialization took 0.1–0.3 ms in the sampled deep positions and was not selected for optimization.

## Reproduction

Use Node 20+ and Playwright with `OMOK_BROWSER` pointing at a Chromium-compatible executable if Edge is not at its default location.

```
npm test
node test/performance-cache.cjs
node tools/performance/browser-bench.cjs LABEL 3
node tools/performance/summarize.cjs reports/performance/LABEL.json
node tools/performance/profile.cjs
```

The label names a new report; do not overwrite the retained baseline. In this workspace Playwright is provided by the bundled runtime's `node_modules` via `NODE_PATH`.

## Evidence boundaries

This experiment is not a new proof of F7, J4, or any other unresolved opening. Existing verified refutations remain hard constraints. Different bounded search arrangements can rank moves differently. A deeper completed iteration, a larger node count, or a negative evaluation alone establishes neither a win nor a loss.

## Changes and attribution

Cycle 1 memoizes pure candidate, winning-point, and evaluation results in three bounded, color-keyed position caches (2,048 entries each). Cached arrays are copied at the boundary. No incomplete search verdict or proof result is stored in these caches. The monotonic clock is supplied to the Node VM as well as browser engines. The UI request reserves 6% (minimum 60 ms, maximum 1,500 ms) for returning a result and includes Worker startup in its watchdog deadline.

In the sixth-move position, cycle 1 retained depth 6, F7, and score -426 for deep25 while median elapsed time fell from 18,327.9 to 17,237.9 ms and observed nodes/sec rose from 3,939.6 to 4,678.4. The change is a combined measurement of caching and deadline allocation, not an isolated causal estimate for either component.

Cycle 1 automatic/deep15 results changed from depth 5/G8 to depth 6/F7. The reduced internal budget crosses an existing Forest profile threshold, changing both search breadth and reserved validation time. This result must not be described as pure cache-driven depth improvement or as proof that F7 is superior to J4.

Cycle 2 gives deep25 a comparison phase capped at 15 seconds (60% of the available search budget), then applies the existing forcing/reply-trap/quiet-trap checks to at most three candidates. The completed deep comparison remains primary; other candidates come from completed comparison reports. An incomplete check does not reject a candidate. Refuting these candidates does not prove global loss. Timing and per-candidate completion are exposed as `candidateChecks` and captured by the benchmark.

The browser uses one analysis Worker; no unmeasured speedup from additional Workers is assumed. A scheduling delay above 120 ms pauses background pondering for at least ten seconds and requires two seconds of healthy observations before reuse. Foreground analysis is retained. Cancellation clears the request's watchdog and heartbeat; stale Worker messages cannot complete a cancelled request. System-wide CPU utilization is not inferred. Multi-worker calibration was not implemented in this bounded experiment.
