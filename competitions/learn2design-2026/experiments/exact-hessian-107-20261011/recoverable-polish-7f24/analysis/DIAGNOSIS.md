# L2D current14: complete feasible-retention diagnosis

## Decision from the measured panel

Keep the measured 096 incumbent as the comparison baseline. Reviewed FALQN127 loses on all three matched public topologies and fails its own predeclared T8/T9 improvement and two-of-three incumbent checks. The original FFR130 saved-v12 result also loses to 096 on all three, according to its completed source-bound return. Those findings are useful inputs for the next optimizer revision; the existing entrant retains final selection.

| Public topology | 096 v10 | FARA122 v11 | FFR130 saved v12 | FALQN127 current14 | FALQN minus 096 |
| --- | ---: | ---: | ---: | ---: | ---: |
| T7 | 5.058706511 | 4.677038870 | 5.159158193 | 5.136891730 | +0.078185219 |
| T8 | 4.977319537 | 5.266266681 | 5.632005214 | 5.654955433 | +0.677635896 |
| T9 | 4.972151717 | 5.142631293 | 5.082928788 | 5.741802206 | +0.769650488 |

Lower feasible Objective loss is better. The table's 096 and FFR numbers retain the precision supplied in their original completed receipts; FALQN is recomputed from all original raw arrays and FARA rows are embedded in that full panel. Full v10 and FFR raw-history pickup is in the same original operation. Current14's candidate is FALQN, even though the cell filenames still say ffr130.

## Complete measured trajectory

| Topology | First feasible call / seconds | Best feasible call / seconds | Feasible / all calls | SEEK / QN calls | Feasible QN endpoints |
| --- | --- | --- | --- | --- | --- |
| T7 | 4 / 7.716 | 89 / 176.480 | 25 / 90 | 52 / 38 | 16 / 38 |
| T8 | 20 / 37.020 | 96 / 175.188 | 6 / 97 | 85 / 12 | 4 / 12 |
| T9 | 28 / 55.074 | 28 / 55.074 | 2 / 91 | 86 / 5 | 0 / 5 |

T7 improves late, from 5.660524 at call37 to 5.136892 at call89. The run spends substantial time revisiting feasibility between those points. Its longest infeasible sequence is calls21–36. The incumbent comparison remains adverse by about1.55%.

T8 first reaches feasibility at call20 (37.020s), then records a worse feasible point at25. Calls26–89 are all infeasible:64 calls across48.065–162.477s. Improvement resumes at90, with the final best at96 (175.188s). SEEK consumes85 of97 calls; QN gets12. The loss is about13.61% above096 despite finding feasibility much earlier than096's recorded first-feasible call74.

T9 reaches its best at its first feasible point, call28 (55.074s). Only call68 is subsequently feasible, and it is worse. Calls29–67 form a39-call infeasible sequence;69–91 are another23-call sequence. All five QN trials are infeasible, no curvature pair is stored, and86 of91 calls are SEEK. The lower raw loss5.671425931610564 is infeasible; the scored feasible minimum remains5.741802205549759. The regression against096 is about15.48%.

All current14 cells have known feasibility for every recorded point, complete matching call-width/loss/feasibility/time arrays and unchanged candidate-before/after hashes. Each returns through predictive stopping, with Objective elapsed178.510–179.433s and no over-budget result. The counts above are complete, not samples.

## What the actual source explains

The first feasible calls4/20/28 agree with the original FARA design expectation. Full raw FARA prefix equality still requires its original arrays; matching first-feasible indices alone does not establish numerical equality.

FALQN stops SEEK immediately on a feasible evaluation. It discards that local Adam instance and changes to a feasible-anchor QN phase. If the QN radius contracts below0.01, the code clears memory and resets to0.30 up to two times, then returns the label stationary. This label means the configured radius/reset policy was exhausted; it is not a mathematical convergence certificate.

After that outcome, the outer loop begins another SEEK episode with fresh Adam state at the next start. The original exploration state is not resumed. Later episodes select the globally best cached feasible point if it is better than the newly found point. This can select the same previously exhausted anchor while creating a new QN object and clearing its memory.

Current14 diagnostics are consistent with that mechanism: T7 records8 completed stationary episodes,16 resets and100 repeat skips; T8 records1 completed stationary episode,2 resets and10 skips; T9 records2 completed stationary episodes,4 resets and25 skips. A skipped exact repeat consumes no Objective evaluation. These aggregate counters cannot assign a specific mode to every raw call; the trace does not retain each trial's parameter vector or mode event.

The feasible-only pair gate works as written. It excludes22/8/5 infeasible endpoints for T7/8/9. Stored pair counts14/3/0 do not support the hypothesis that curvature information reliably carries these short runs to a better feasible solution. On T9 there is no learned curvature at all.

## Revision being implemented in the same programme

Retain the original096 JAX/Optax update, RNG, trust/noise path and complete optimizer state. Add a separately identified recoverable-polishing candidate: exploration can be paused for logged feasible local trials late in the available budget, then resumed with its original moments, pending parameters, restart position and random key. Polishing failure will not consume a fresh random restart or erase exploration state.

Track actual anchor identity and the outcome of a polishing episode. An unchanged exhausted point will not become a new episode merely because a later worse feasible point is discovered. Keep a numerical step-size floor distinct from a convergence claim. All trials use public Objective calls and its true elapsed budget; the original control and its measured histories remain unchanged.

The late-budget start, trial quantum and budget allocation are experimental configuration, not fitted performance claims. They must be compared through the existing native runner on fresh public topologies and the established broader phases. T8 is specifically why a large fixed allocation to polishing before the original search reaches feasibility would be a poor default.

## Exact measured source and run identities

- Original kernel138189542; current numeric version14, bracketed before and after the one official output retrieval.
- Complete untouched current panel:49,538 bytes, SHA25616793aa3838c04aacaebecb55fb3f3187445851fe452be131111a6b0d7f5ac65, Slack F0C95LSNJ2W.
- Reviewed FALQN source:24,694 bytes, SHA256e2eeb6a03d4082579002e0204df6e8bb1890ee2d92997fb3cdf7a182d61cf71b.
- Original096 source:6,722 bytes, SHA25697cbe70ec309629be60c78facf903e110aace074111715e58fde57afc01c8077; reused v10 panel18d39e9f14304367a9d02258d4b73c269b58b48b6d680aad605a382d1890bf87.
- FFR source:20,780 bytes, SHA25648edc90b09dd2453163c71f893918fa6cbf66f164a0dd9cc705dd85081216b7b; separate original saved-v12 six-artifact ZIP F0C97HSJL2V.
- Native runner:18,510 bytes, SHA256c03063343ac218112c27f3463781fee4be654004b4f3520a86085d9a09655a08.
- Actual settings: public UIFO T7/T8/T9, seed42,180s per Objective, default squashed-ReLU penalty and original physical feasibility, two visible TeslaT4 devices, Python3.13.15, JAX/JAXlib0.9.0.1, NumPy2.1.3, dfbench0.3.3, Differometor0.0.5, x64 enabled.
- Current official repository head freshly read at9ebce9bfe5c33242c297f84f4c79d088b7b52e70. Final rules use H10080GB, four-hour Objective/4.5-hour container and mean minimum feasible loss over ten hidden topologies; the final deadline is16October11:59:59UTC. These T4 development cells guide the experiment and do not substitute for that evaluation.

Full original sources and selected packages are merged at:
https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/693

Current official rules:
https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/9ebce9bfe5c33242c297f84f4c79d088b7b52e70/docs/submission.md

Original source/array receiving:
https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791979728206859?thread_ts=1791736325.457109
