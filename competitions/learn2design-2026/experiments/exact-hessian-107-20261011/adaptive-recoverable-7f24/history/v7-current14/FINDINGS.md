# Complete native history: v7 controls and current14 FALQN

14 October 2026 · Original simulation case C0C1F274SGH/1791736325.457109

## Decision supported by the recovered runs

Keep the original 096 candidate as the protected control. The recovered v7 cohort shows a long early plateau on T11, but valuable late exploration on T10 and T12. This supports running the already published adaptive 096 schedule as a paired hypothesis: a small earned early-polish allowance, suspension and exact resumption of the exploration generator, and a late fallback. It does not establish an improvement for that new candidate. The current fixed/adaptive/FFR130EB run request remains the original native operation.

The complete report contains nine cells and 835 logged points. Six are original v7 096/099 cells at T10–T12; three are the already retained current14 FALQN127 cells at T7–T9. All original JSON, source-binding records and metadata are included. No physics simulation was rerun to make these artifacts.

## Within-v7 paired results

All six cells use algorithm seed 42 and a 180-second logging budget. The recorded order was 096 then 099 at T10, 099 then 096 at T11, and 096 then 099 at T12.

| Topology | 096 calls / feasible | 096 first feasible, seconds | 096 best feasible loss | 096 best time, seconds | 099 calls / feasible | 099 best feasible loss |
|---|---:|---:|---:|---:|---:|---:|
| T10 | 98 / 63 | 12.362 | 4.8852516921942515 | 171.633 | 99 / 0 | No feasible logged point |
| T11 | 92 / 32 | 25.186 | 5.246330569811976 | 42.698 | 93 / 13 | 5.236289810660033 |
| T12 | 87 / 32 | 44.987 | 4.891589786110237 | 164.188 | 88 / 0 | No feasible logged point |

The only finite 099-versus-096 pair is T11, with a loss difference of −0.010040759151943135. The two other 099 cells failed to log a feasible point. The original summary's one finite-pair win cannot be read as an overall win. Official evaluation falls back to random search for an infeasible run; those fallback losses are absent here, so an official aggregate for 099 cannot be computed from these files.

## Where an adaptive schedule can help, and what it must preserve

096 T11 reaches its final best at call 21 and 42.698 seconds, followed by 71 calls and 135.706 seconds without another best. That is a concrete candidate for bounded early feasible polishing. T10 and T12 make three and four new bests respectively in the final 36 seconds. Their gains after 144 seconds are 0.30582541480908176 and 0.4563667733833352. Replacing the rest of exploration with an irreversible early polishing phase risks losing those improvements.

Across these three 096 cells, the mean final finite loss is 5.0077240160388214 versus 5.2617880787696265 at 144 seconds. This is a descriptive mean for these three public cells, not the official hidden-ten score. Current14 also shows late FALQN improvements at T7/T8 and stagnation after first feasibility at T9. Its prior source diagnosis remains in the maintained history directory; the v7 expansion supplies independent baseline trajectory evidence rather than a cross-runtime ranking.

096 median inter-log intervals are approximately 1.79, 1.91 and 2.02 seconds for T10, T11 and T12. Unused logging budget is approximately 1.49, 0.61 and 0.66 seconds, below one typical call. The original baseline is already using nearly all its budget. An optimization should improve the use of admitted calls; reducing its safety reserve alone does not address the observed plateaus. The logging timestamps include algorithm time between evaluations, so intervals are measured complete call cycles, not isolated simulator timings.

## Runtime and source boundaries

The v7 records report Python 3.13.15, JAX/JAXlib 0.9.0.1, dfbench 0.3.3, Differometor 0.0.5, Optax 0.2.8 and NumPy 2.5.4, with two visible T4 GPUs and four CPUs. The current14 record reports NumPy 2.1.3 and a different kernel. Keep these runtime cohorts distinct. The analyzer retains each complete runtime object and a runtime-group digest. It does not convert them into matched current-treatment evidence.

v7 096 source SHA256: 97cbe70ec309629be60c78facf903e110aace074111715e58fde57afc01c8077.

v7 099 source SHA256: 144216f254636979e1878df1f80afeae04240f8bf2e86d6f06d640d570e27b96.

v7 runner SHA256: c03063343ac218112c27f3463781fee4be654004b4f3520a86085d9a09655a08.

v7 original archive: 47,238 bytes, SHA256 11214c66481a4a4bcf6c4a25804b094855c01378b6e78c23cb06b5864c5ef8eb, original kernel 138115140 / tokenjunkielabs/l2d084-pilot-b8 / version 7. The retained job-start says cap_s=1200 while pilot-summary says job_cap_s=3600. Both original values are retained; no explanation is inferred.

## Original native continuation

The current integration is PR 5086, merged 7c59b9ab248fe872058c190117d2ef975ede2728, with 24 arms and 21 phases. Keep the existing accepted run/session. Return actual fixed/adaptive/FFR130EB full cells, histories, elapsed logging times, environment, source declarations and complete diagnostic traces. The already declared broad T7–T16 comparison includes T11 and the late-gain T10/T12 cases. Select those existing matched groups at an available allocation boundary; do not interrupt an admitted run or replace the protected 096 control.

The original simulation follow-up is https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1792014917887169?thread_ts=1791736325.457109. AccountChad retains counted submission ownership.

## Official competition contract, checked 14 October

The submission deadline is 16 October 2026 at 11:59:59 UTC (15 October AoE). Official evaluation uses ten hidden problems, four hours after start_logging and a four-hour-thirty-minute total container limit, with the minimum logged feasible loss per problem. The current evaluator specification lists H100 SXM5, 80 GB VRAM, 16 vCPU, 128 GiB RAM, Ubuntu 24.04.3 and Python 3.12.3. These public 180-second T4 runs support development decisions; the original matched native continuation and final evaluator determine performance.

Official primary sources: https://github.com/artificial-scientist-lab/Learn2Design-2026/tree/9ebce9bfe5c33242c297f84f4c79d088b7b52e70 and https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/9ebce9bfe5c33242c297f84f4c79d088b7b52e70/docs/submission.md. The exact Objective 0.3.3 source at commit 25d7f7867938a288927c071442092f9972ac99e0 was retained with the previous FFR integration; scalar eval_count admission semantics remain unchanged.
