# Adaptive recoverable polishing: complete native continuation

The exact original current14 result contains 278 logged points across T7/T8/T9, with long post-feasible plateaus and useful late improvements on T7/T8. This additive experiment retains the complete RecoverablePolish096 engine and adds a separately selected stagnation schedule. All23 previous candidate declarations,19 previous phases and complete original datasets remain unchanged. The new selector is **096-adaptive-stagnation-7f24**; the two added phases bring the maintained totals to24arms and21phases.

The original operation and simulation owner continue at:
https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791736325457109
AccountChad retains official entry selection and the two counted submissions. Reconcile the existing allocation, original FFR130EB request and returned files before issuing a new run. This source adds a treatment and useful analysis to that course.

## Measured motivation and full original histories

Open [the complete native-history analysis](history/README.md) and [offline explorer](history/current14-history.html). Both retain the exact source/environment and all278points. Standalone figures and all-point CSV are under history/. The unchanged original current14 panel SHA256 is16793aa3838c04aacaebecb55fb3f3187445851fe452be131111a6b0d7f5ac65.

T9 finds its best at55.074s and never improves in the remaining63calls. T8 has a125.456s post-feasible plateau but improves four times in the final36seconds. T7 makes eight new bests during that final window. The unused physical-budget tails are below one median logged interval, so weakening the stop guard is not the evidence-supported experiment.

These are FALQN127 observations on the original T4/180s course. They motivate testing a schedule; they do not measure this new096-based candidate or predict its performance on the official H100/four-hour task.

## Exact algorithm change

Class AdaptiveRecoverablePolish096 retains its predecessor's entire exploration generator, JAX/Optax state and RNG. Polishing suspends that generator and never sends polish observations into its update sequence. Cached finite feasible gradients, actual-evaluated-dtype duplicate identities, feasible curvature updates, smaller distinct trial steps and exhausted-anchor memory remain unchanged.

The explicit selected policy is:

1. Retain a finite logged feasible incumbent.
2. Before80% of elapsed physical budget, require at least eight exploration calls since its last strict improvement and stagnation lasting at least12% of the physical time that remained at that improvement.
3. Admit early polishing only if actual polishing elapsed plus the predicted next call cost fits25% of elapsed time including that predicted call. Use the larger of current EWMA and last measured call cost. A slower real call may overshoot this earned allowance once; its full elapsed is charged and later early calls pause until more allowance is earned. The requirement for two remaining calls is also a prediction, not a runtime guarantee.
4. Keep the existing four-call polishing quantum and at least four exploration calls before starting another one. A successful polish can finish its already admitted short quantum instead of being abandoned after every improved point.
5. At80% elapsed, retain the original fixed-late fallback and budget guard. Every actual Objective call still counts against the same true elapsed budget.

The8/.12/.25 settings are explicit experimental constants, not claimed optima. The source also accepts polish_schedule="late" and polish_enabled=false for focused original-owner diagnosis, but this release adds only one declared new treatment. The independent controls remain the **unchanged original096** and **unchanged original fixed-late RecoverablePolish096**, with their original requirements.

The public scalar eval_count admission contract is pinned to the full original dfbench0.3.3 source already retained at ../episode-budget-ffr130eb/official/objective-0.3.3.py. A logged final scalar call can set budget_exceeded and still supplies a valid incumbent; an unlogged time-rejected call does not update the incumbent, curvature, recent keys or exploration. The algorithm uses public counters only and does not replace the evaluator. Trace records expose actual policy and public counter admission.

## Original native execution

From the maintained experiment root, use the same actual environment/allocation:

```bash
python run_phase.py plan --phase adaptive-recoverable-changed-development
python run_phase.py run --phase adaptive-recoverable-changed-development \
  --mode gpu --run-dir /existing/owned/allocation/adaptive096-changed-t7-9
python run_phase.py status --run-dir /existing/owned/allocation/adaptive096-changed-t7-9
python run_phase.py export --run-dir /existing/owned/allocation/adaptive096-changed-t7-9 \
  --archive /existing/owned/allocation/adaptive096-changed-t7-9-complete.zip
```

This is three changed-arm cells, T7–9/seed42/180s. Its schema baseline is the sole new arm and establishes no paired gain. Each cell gets a fresh original Objective with existing size3 UIFO/50frequencies/default penalties/hessian-batch1 semantics. CPU mode retains the existing explicitly granted CPU affinity and remains a separate measured runtime.

The optional adaptive-recoverable-broad-public phase has30cells: original096, original fixed-late recoverable and adaptive stagnation, each on public T7–16/seed42/600s. Preserve all outcomes and complete topology groups on each worker. Existing full-objective-budget supports the eventual selected two-arm20cell comparison at14400s each; select that only from actual returned evidence.

Use compare_native.py and exact original .runtime.json sidecars. The immediate prior whole manifest is retained as retained-sources-before-integration.json. Other older outputs require their own original manifest through repeated --historical-sources; its complete raw and canonical identities and selected treatment must match. Preserve original reports unchanged. Missing runtime bindings or different hardware/settings remain distinct conditions.

## Complete selected archives

selected/ contains three whole5member archives: original096, original fixed-late recoverable and the new adaptive arm. Every archive includes a single selected wrapper, original implementation, original requirements, full RELEASE declaration and original license. Their selected options and current complete source-manifest identity are explicit. Existing historical archives remain retained.

Regenerate with the existing production packager and validate in the original receiver:

```bash
python release_selected.py package --source-id 096-adaptive-stagnation-7f24 \
  --archive /existing/owned/allocation/adaptive096-selected.zip \
  --out /existing/owned/allocation/adaptive096-selected-package.json
python official/final-validator-20261013.py /existing/owned/allocation/adaptive096-selected.zip
node adaptive-recoverable-7f24/history/analyze-native.mjs \
  --out /existing/owned/allocation/adaptive096-history \
  /original/returned/adaptive096-t7.json /original/returned/adaptive096-t8.json /original/returned/adaptive096-t9.json
```

Compare all five uncompressed member identities and declaration; ZIP metadata may differ. The Node reader writes complete original bytes, all-point CSV, full analysis JSON, standalone SVGs and an offline HTML explorer. Each native cell retains its own source and runtime. It changes no input, executes no physics and requires no new service.

Return complete trajectories, actual executed source/requirements, all runtime sidecars, installed module versions, original kernel/allocation identity and remaining real time/evaluation budgets. Compare logged feasible loss, first/best time, mode chronology, actual polish elapsed and exploration throughput. Preserve late improvements and no-feasible/failed outcomes. A favorable first topology alone does not establish a winning complete panel.

## Current official constraints

Current official commit9ebce9bfe5c33242c297f84f4c79d088b7b52e70 and full rules/environment/API remain retained under ../episode-budget-ffr130eb/official/. Deadline is October16,2026 11:59:59UTC (end of October15 Anywhere on Earth). The reference environment is H100SXM5/80GB,16vCPU/128GiB, Ubuntu24.04.3,Python3.12.3,CUDA13, with dfbench0.3.3/differometor0.0.5/JAX0.9.0.1 fixed. Official scoring uses best logged feasible loss across ten hidden topologies, four hours after start_logging and a4h30 whole-run cap. Current T4 histories retain their actual environment; no hardware-equivalence claim is made.

## Operate the actual report in the existing receiver

The following is Bryce's standing rendered-product instruction, carried into this source-native delivery. It applies to the report and every outgoing attachment, without creating another controller or approval queue.

<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->

