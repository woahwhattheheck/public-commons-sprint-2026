# L2D current14 — complete native time and feasibility analysis

## Recovered v7 paired controls and combined full history

[The complete v7/current14 collection](v7-current14/README.md) adds all six original 096/099 T10–T12 cells to these three current14 cells: nine trajectories and 835 logged points, all original metadata, standalone plots and a full offline explorer. [Read the findings](v7-current14/FINDINGS.md) before interpreting the original finite-pair win count. The protected 096 control has a long early T11 plateau and substantial final-window gains on T10/T12; the current adaptive schedule remains a hypothesis for the existing paired native run.

This edition analyzes the exact original current14 panel returned by the original Kaggle receiver. It retains all 278 logged points, every feasibility flag/time, complete environment/source bindings and the earlier diagnosis. The new analysis adds dated budget windows, complete loss/feasible-incumbent figures, measured inter-log intervals, explicit stagnation intervals, full CSV and a portable explorer that accepts later original native panels.

Original run: kernel138189542, current version14, algorithm FALQN127 / source e2eeb6a03d4082579002e0204df6e8bb1890ee2d92997fb3cdf7a182d61cf71b, runner c03063343ac218112c27f3463781fee4be654004b4f3520a86085d9a09655a08. T7/T8/T9, algorithm seed42, 180seconds/Objective, actual T4/Python3.13.15/JAX0.9.0.1/dfbench0.3.3. Source-native metadata reports the original12October executions; the complete output was received14October. Original environment is preserved, rather than relabelled as the final H100/Python3.12.3 environment.

## Findings that affect the next native decision

|Topology|Calls / feasible|First feasible|Best feasible|Longest post-feasible plateau|Median logged interval|
|---|---:|---:|---:|---:|---:|
|T7|90 /25|7.716s, call4|5.136891730445946 at176.480s|39calls /77.591s|1.986550s|
|T8|97 /6|37.020s, call20|5.654955433152016 at175.188s|69calls /125.456s|1.816779s|
|T9|91 /2|55.074s, call28|5.741802205549759 at55.074s|63calls /122.519s|1.947413s|

A plateau here means that no logged call after first feasibility establishes a strictly lower finite feasible loss. It can contain worse feasible points and can represent useful exploration; the retained data do not show its unobserved future value. The timing interval includes elapsed algorithm and Objective work between logged calls. It is not an isolated physical-kernel timing.

1. **The stopping margin is not the dominant observed loss.** Actual Objective elapsed is179.433/178.510/178.589s, leaving0.567/1.490/1.411s of180. Each unused tail is below one median logged interval. These results do not support weakening the existing physical-budget guard to recover tens of lost calls.
2. **The feasible-incumbent schedule deserves the next experiment.** T9 reaches its final best at55.074s and never improves across the remaining63calls. T8 retains6.391626589 through162.477s despite two early feasible points, then improves four times in the final window. A fixed late-only schedule can wait through a long observed plateau; blindly committing the entire remainder to early polishing could also remove the late exploration that helped T7/T8.
3. **Late improvements matter.** In144–180s, T7 logs12 feasible points/18calls and8 new bests; T8 logs4/19 and4 new bests. T9 logs0/18. The data support retaining a late refinement fallback and interleaved exploration, rather than applying one topology's final-window behavior to every topology.
4. **True small feasible steps remain important.** The original FALQN source normalizes the empty-memory gradient to its radius, repeatedly resets the same fixed radius grid, and discards the current exploration state on reopening an anchor. The original complete source review established those mechanisms. Our already-published RecoverablePolish096 retains Optax/RNG/pending proposal, cached logged feasible gradients and exhausted-anchor identities, and permits genuinely smaller distinct trials. This analysis does not infer exact SEEK/QN labels for individual current14 calls: its diagnostics contain aggregate counts, not a per-call mode trace.
5. **Do not project short-panel setup cost into final-score estimates.** Problem construction is about36.4–36.9s and optimize-wall minus logged Objective elapsed is72.1–77.5s. These are actual fields of the current run. They help budget real experiment throughput, but neither a four-hour call rate nor an H100 gain follows from this three-minute T4 sample.

## Observed final controls

The earlier complete panel carries source-bound final receipts for096 and FARA. The saved-v12 FFR130 result was separately returned. Keep their actual source/version/environment attribution and original reported precision. Missing raw control trajectories have already been requested from the original holder; they are not interpolated by this viewer.

|Topology|096 retained final|FARA122 retained final|FFR130 saved-v12 retained final|Current14 FALQN127|
|---|---:|---:|---:|---:|
|T7|5.0587065114|4.677038870230093|5.159158193|5.136891730445946|
|T8|4.9773195370|5.266266680743341|5.632005214|5.654955433152016|
|T9|4.9721517172|5.142631293378685|5.082928788|5.741802205549759|

Original096 remains the selected incumbent. FALQN does not win any of these three096 comparisons. The final entrant still owns official submission selection.

## Complete additive schedule for the original native course

The next additive candidate reuses the complete existing RecoverablePolish096 engine. It retains its original off/fixed-late arms and adds a separately identified stagnation policy:

- Require an actual finite logged feasible incumbent and at least eight further exploration calls without a lower feasible best.
- Require elapsed stagnation of at least12% of the physical budget that remained when that incumbent was found.
- Before the original80%-elapsed fallback, admit polishing against a25% earned physical-time allowance using the predicted next call cost. A slower actual call may overshoot that allowance once; its full actual elapsed time is charged, and further early polishing pauses until exploration earns more allowance. The minimum remaining-call safeguard is also predictive. Preserve four-call polishing/four-call exploration quanta and the suspended exploration frame.
- Finish an already started short polishing quantum when feasible improvements arrive, rather than repeatedly abandoning its cached curvature after one successful call.
- Continue the exact fixed-late schedule for the original80%-elapsed fallback. Exhausted anchor identities still prevent reopening the same failed radius grid.
- Preserve the unchanged original096 and original fixed-late source as independent native treatments. Any new improvement remains an experimental hypothesis until the original matched native course returns it.

The8-call/12%/25% constants are explicit proposed settings, not fitted optima. They use only public current-run observations and timer fields. They are not retrospective claims about what an alternate optimizer would have produced on these recorded points.

## Complete files and use

Open current14-history.html for the actual retained panel. Select a topology, vary the elapsed cutoff, inspect every point in100-row pages, download full CSV/JSON or a complete SVG, and expand the full original source/environment/diagnostic record. Original panel, original binding and original receiving note are directly downloadable from the same file. Adding later complete native JSON keeps every original body in the portable downloaded report.

analysis.mjs supplies createHistoryAnalysis. It checks aligned original arrays, call widths, explicit known feasibility, source-before/source-after identity and original Objective counts. It recalculates the reported best/counts and rejects a mismatch. Batch calls are supported only with matching per-call timestamps. Missing or incomplete cells remain in the unavailable list with their exact input retained. Diagnostic modes are joined only where actual call/loss/feasibility agree. It performs no physics and does not manufacture raw histories.

plots.mjs emits standalone SVG with every finite logged point, feasible markers, the exact feasible step curve and a feasibility rug. report.mjs embeds the complete originals and current analysis; no network, font or chart service is needed.

Use the maintained compare_native.py for paired source/runtime comparisons. Its merged explicit --historical-sources option binds an old whole source manifest before permitting the same exact selected treatment. The explorer itself does not relax those pairing rules.

## Original sources and receiving course

- Original current14 return: https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791979728206859?thread_ts=1791736325.457109
- Complete earlier source/diagnosis: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8QL7QL87
- Existing RecoverablePolish096 integration: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/5022
- Existing FFR130EB/current exact historical comparator integration: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/5084
- Current official rules: https://github.com/artificial-scientist-lab/Learn2Design-2026/tree/9ebce9bfe5c33242c297f84f4c79d088b7b52e70

The original Muse/native receiving operation continues. The already-issued FFR130EB five fixtures and T7–9 actual run, and original control-output pickup, retain their owners. New native comparisons join that same operation at its next unissued boundary. AccountChad retains the two counted submissions and actual final decision.

## Reproduce the full analysis from actual native files

From this history directory, use the existing Node runtime:

```bash
node analyze-native.mjs --out /existing/owned/allocation/current14-analysis retained/current14/panel-result.json
node analyze-native.mjs --out /existing/owned/allocation/returned-native-analysis /original/returned/t7.json /original/returned/t8.json /original/returned/t9.json
```

The output directory must be new. The command preserves every complete input body, analyzes every accepted cell, retains incomplete-cell reasons, and writes all-point CSV, standalone SVGs, full JSON, an offline HTML reader and a complete file index. It executes no Objective and changes no original input. Each panel keeps its own original context. Open the complete HTML at desktop and narrow width in the existing native operator, operate topology/cutoff/paging/add-original/download controls, and reopen the downloaded whole report; inspect the actual full SVG and CSV outputs. All quantities come from original logged histories. The source application itself is independently usable without a Python or chart dependency.
