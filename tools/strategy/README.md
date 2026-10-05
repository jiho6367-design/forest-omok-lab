# Frozen strategy comparison

`manifest.json` and its SHA-256 were frozen before engine edits. They contain 12 new development and 12 separate holdout positions, two per A–F category, six historical replays outside those counts, and six opening families with 36 paired games. Rotations, reflections and color swaps are metamorphic checks, not extra independent samples.

Run from the repository root with Node 20+. Browser execution uses Edge and the bundled Playwright runtime, overridable with `OMOK_BROWSER` and `OMOK_PLAYWRIGHT`. The immutable `../baseline` checkout and `../baseline-source.zip` are required for experiments, but ordinary manifest regression tests work in a fresh checkout without those files.

```sh
node test/strategy-manifest.cjs
node test/strategy-proof.cjs
node tools/strategy/run.cjs smoke --label smoke-final --minutes 0.5
node tools/strategy/compare.cjs --label dev-final --split development --repeats 2 --minutes 60
node tools/strategy/compare.cjs --label holdout-final --split holdout --repeats 2 --minutes 60
node tools/strategy/compare.cjs --label known-final --split known --cases known-second,known-fourth,known-sixth --modes fast --repeats 1 --minutes 10
node tools/strategy/arena.cjs --label arena-final --stage 1 --minutes 60
```

Each fixed split schedules 144 analysis jobs: 12 positions × three modes × two versions × two repetitions. `--modes fast,auto,deep25`, `--cases dev-A1,dev-C1`, `--reply-ms 900|3000` and `--compute gpu|optimized|cpu` restrict an explicitly labeled experiment. Reports retain scheduled IDs and incomplete work. Do not describe a restricted sample as the complete evaluation.

The `known` split keeps the six historical prefixes separate from new cases. It additionally derives `known-second` and `known-fourth` from the frozen `known-sixth` prefix for the 2nd/4th/6th move comparison. These related prefixes belong to the same historical family and are not independent samples.

Every invocation stops within its requested stage, capped at 60 minutes, and does not launch a further stage. CPU/browser suspension can delay a JavaScript timer; elapsed time and the stop reason remain recorded. Resume the same command and label to skip completed fixed jobs or continue unfinished arena boards. Source, harness, manifest and computation-mode identity must match; otherwise start a new label. No stage starts automatically after a result review.

The three external analysis budgets are 900 ms, the frozen baseline's common automatic plan capped at 15 seconds, and 25 seconds. Both versions receive the same position, first player, current player, budget and verified prepared pattern table. The actual application's `spawnAnalysis` function is extracted from each version, retaining its 6% return/startup reserve. Each request starts a fresh Worker; pondering, game clocks and cross-request search caches are absent. GPU preparation and fallback reasons are reported separately from timed requests.

Fixed reports preserve both baseline and improved opponent responses at the same bounded reply budget. Both branches then use the same frozen baseline followup engine and budget. These sampled replies are not claimed to be strongest among every legal response. Reports include legal played lines, before/after exact-five points, forced-block constraints, geometric three/four moves, and individually checked extension witnesses for the initial move. Shapes and engine scores do not establish strategic validity or improvement. Non-immediate production proofs remain marked `full-certificate-not-audited` until separately verified.

Production statuses remain distinguishable through `proofStatus`, `analysisStatus`, `unverifiedDefense`, `analysisIncomplete`, `timedOut`, `proven`, and `lossProven`. The report separates tactical acceptance failures, invalid results, incomplete audits and proofs still needing independent verification.

Arena stage N selects opening ON and plays each mode twice with engine first/second roles exchanged. Per-game invocation slices are 90 seconds, 360 seconds and 900 seconds respectively. At a slice or stage boundary, the legal board, moves, current player, interruptions and elapsed time persist. A later invocation resumes that game; a cutoff never counts as a win, loss or draw. All 36 scheduled games stay in the ledger, including games not yet started. Completed wins require an actually played legal exact-five; a full board is a draw. No-legal-move positions are unresolved interruptions under the unchanged application rules. Scores, PVs and production proof flags never adjudicate arena results.

The prescribed-tree verifier now accepts `firstPlayer`, `moves` containing `PASS`, or an explicit `board` with `p`. Legacy black-first `prefix` certificates remain compatible. A failed or timed-out proof remains unverified; later work can resume verified branches within an existing verification session.
