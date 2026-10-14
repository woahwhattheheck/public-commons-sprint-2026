# FFR130EB: complete episode-budget experiment

This adds the original complete FeasibleFilterRetention130EB source and its five original authored fixtures to the maintained native Learn2Design experiment. It retains all 22 existing candidate definitions, all 17 previous phase definitions, the incumbent096 source, original FFR130, actual current14/v7 data and every existing selected archive. The new source ID is `ffr130eb`.

The original simulation owner keeps the existing execution and allocation. Before launching, reconcile the existing kernel/process and its retained outputs in the original simulation thread:
https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791736325457109
The source handoff is reply1792006883.007749, fileF0C9DT34D0U. This integration is additive; AccountChad retains counted competition submissions and the incumbent selection.

## Exact algorithm and question

The complete candidate is unchanged from source30975B/SHA256 b674c27ab897c19b57e7aca73134fa2410813cda4c4a8975af282f28ca007271. The original five-fixture source is unchanged14519B/2342cf7d2568043b65e3d6026ce7f74a4d766a18805b4c6915ba9fdb2998c214. Requirements are the actual 25-byte original FFR130 requirements, not reconstructed dependency guesses.

The candidate changes FFR130 episode scheduling using public remaining budget and measured call cost. Patience uses calls spent in the episode plus estimated calls remaining, with explicit floors and the original configured patience as the ceiling. Continued improvements reset no-improvement streaks. The steady cost estimate excludes the cold first call after later observations exist and includes optimizer overhead through call-start cycles. Small remaining budgets substitute incumbent polishing for scheduled exploration. These are uncalibrated algorithm choices; the original native histories determine their effect.

The comparator's logged finite feasible minimum, time to first/best feasible and complete trajectory are the relevant results. Candidate `feasible_calls` counts **returned feasible calls**, which can include an unlogged terminal return. Keep that diagnostic under its original name inside the complete diagnostics and describe it as returned-feasible when presenting it; use Objective's aligned logged histories for the scored feasible count and best loss.

## Current official source and admission semantics

Official competition commit9ebce9bfe5c33242c297f84f4c79d088b7b52e70 was read on October14. Complete rules, environment, API and README are retained under `official/`, with their license. Final deadline is October15,2026 Anywhere on Earth (end of day: October16 11:59:59UTC). The original entrant owns actual submissions.

The current reference is H100SXM5 80GB,16vCPUs,128GiBRAM, Ubuntu24.04.3LTS, Python3.12.3 and CUDA13. Simulator/JAX core is fixed, including dfbench0.3.3, differometor0.0.5 and JAX/JAXlib0.9.0.1. Requirements for organizer-fixed core are ignored by the evaluator; other compatible packages follow the current dependency policy. Runtime capture records the environment actually used locally; a matching version label does not turn a CPU/T4 development run into an official H100 result.

Each official topology receives four hours after `start_logging()`, with a4h30min whole-run cap. Only public Objective methods evaluate the simulator; Objective warmups and public context inspection precede logging, and all later search/diagnostics count against elapsed time. The score uses best logged feasible loss across ten hidden topologies, with the organizer's actual fallback only when it supplies one. Our development reports never invent that fallback.

The full exact native Objective is retained as `official/objective-0.3.3.py` with its own license:
https://github.com/artificial-scientist-lab/Differometor-Benchmark/blob/25d7f7867938a288927c071442092f9972ac99e0/src/dfbench/core/objective.py
Its116097bytes/SHA2569e2c2bb54517f59efacf4c2a59908ffd55c7fb2e15089d53263ece796e71daa2 match the original native runtime module. Reading that source resolves the candidate's admission check:

- `_log` snapshots elapsed time before calling `_log_evals`.
- `_log_evals` rejects a time-exceeded call before incrementing `eval_count`.
- A partial **batch** can increment the counter without recording history when the batch is larger than remaining evaluations. FFR130EB uses one scalar call, after checking at least one evaluation remains; this branch is unreachable here.
- A final allowed scalar evaluation is logged, increments the counter and sets the evaluation budget exhausted. The candidate correctly offers that admitted result before stopping. Moving the offer after a blanket budget check would discard a valid final best.
- A call whose logging admission snapshot is within time remains recorded even if returning control or reading the public budget happens after the deadline.

The candidate accesses only public fields; the retained Objective body is source context, never an imported replacement or modified evaluator.

## Operate the original course

Use the existing equipped Python/environment and the same original simulation operation. From this experiment directory, run the five supplied fixtures once if they have no actual completion:

```bash
python episode-budget-ffr130eb/fixtures_ffr130eb.py
```

They exercise scheduling with scripted public inputs and the actual OptimizationAlgorithm.prepare. They do not produce physics or competition scores. Preserve their complete stdout/exit status. For an actual native attempt use the original wrapper, which records exact optimizer, runner, invocation and runtime identities:

```bash
python run_phase.py plan --phase episode-budget-changed-development
python run_phase.py run --phase episode-budget-changed-development \
  --mode gpu --run-dir /existing/owned/allocation/ffr130eb-changed-t7-9
python run_phase.py status --run-dir /existing/owned/allocation/ffr130eb-changed-t7-9
python run_phase.py export --run-dir /existing/owned/allocation/ffr130eb-changed-t7-9 \
  --archive /existing/owned/allocation/ffr130eb-changed-t7-9-complete.zip
```

The changed-only phase has exactly three cells: topology7,8,9, seed42,180seconds, native size3 UIFO/50frequencies/default penalties/hessian batch1. Its schema baseline is its sole arm `ffr130eb`; it does not assert an incumbent delta. The existing runner constructs a fresh real Objective for each cell, retains whole reports and sidecars, and never restarts a retained interrupted attempt silently. CPU mode uses the same command with `--mode cpu --cpu-affinity <actual-granted-CPU-list>` and the existing launcher. Preserve CPU/GPU cohorts separately.

If the original owner has already launched this exact candidate, return that execution and its files rather than starting the phase a second time. The original requested changed arm can also be selected directly without changing the native runner:

```bash
python runner/run_recorded.py --source-manifest SOURCES.json --source-id ffr130eb -- \
  --candidate episode-budget-ffr130eb/submission.py --topology-seed 7 \
  --algorithm-seed 42 --seconds 180 --out /existing/owned/allocation/ffr130eb-t7.json
```

## Reuse complete measured controls without rewriting them

Adding a source arm changes the whole SOURCES manifest even though original096/FFR130 treatment identities remain exact. `compare_native.py` now accepts repeated `--historical-sources` inputs so an older report can keep the exact complete manifest named by its original invocation.

For a historical report, the complete original manifest's raw SHA256 **and** canonical content hash must match its retained invocation. Its unique selected source and all requirements/companions/assets/options/diagnostic expectations must equal the current treatment. Original runner, runtime capture, invocation adapter, report hash and source-after checks remain enforced. Runtime differences remain different comparison conditions. No report is edited or rebound to a new manifest.

`retained-sources-before-integration.json` is the complete immediate predecessor. Earlier reports need their own actual source manifest from their original run; this predecessor is not a universal substitute.

```bash
python compare_native.py /original/control/native.json /original/parent/native.json \
  /existing/owned/allocation/ffr130eb-t7.json --sources SOURCES.json --baseline 096 \
  --historical-sources /original/control/SOURCES.json \
  --historical-sources /original/parent/SOURCES.json \
  --out /existing/owned/allocation/ffr130eb-matched-original-comparison.json
```

Retain all `.runtime.json` files beside their exact reports. Missing effective runtime stays individually visible and cannot supply an inferred matched pair. Source panels from a different original reporting format remain under their original analysis path; this interface does not manufacture source-bound sidecars for them.

Inspect each topology's logged calls, feasible count, first/best time, episode decisions, returned-feasible diagnostics and complete source/runtime. Preserve no-feasible/error outcomes. Do not compare a partial mean to a complete panel as if it were the same experiment.

## Broader comparison and complete selected archives

The optional `episode-budget-broad-public` phase compares original096, originalFFR130 and FFR130EB on topologies7–16, seed42,600seconds:30nativecells. It is a complete next experiment when the original owner selects it after the initial result; it does not require replaying already accepted matching work. Existing `full-objective-budget` supports a selected two-arm20-cell comparison at14400seconds percell. Keep whole topology groups on one existing allocation and preserve runtime identities.

The three complete archives in `selected/` bind the current exact manifest: `096-selected.zip`, `ffr130-selected.zip` and `ffr130eb-selected.zip`. Each has root submission.py, unchanged retained_algorithm.py, exact requirements.txt, RELEASE.json and original competition license. The wrapper defines one direct subclass and forwards the original Objective and caller arguments once to the exact selected class with frozen options. These archives are prepared source artifacts; the incumbent is not changed by their existence.

Regenerate through the maintained production packager in the original environment and run the current official static validator as part of the existing receiver:

```bash
python release_selected.py package --source-id ffr130eb \
  --archive /existing/owned/allocation/ffr130eb-selected.zip \
  --out /existing/owned/allocation/ffr130eb-selected-package.json
python official/final-validator-20261013.py /existing/owned/allocation/ffr130eb-selected.zip
```

Whole archive bytes may differ with ZIP metadata; all five uncompressed member identities and full declaration must agree. Existing historical selected archives remain exact and retained. AccountChad chooses any counted entry using actual results.

## Return to the existing owner

Return the existing execution identity, fixture stdout/exit status, full three native reports and runtime sidecars, all available trajectory arrays/checkpoints, exact executed source/requirements, current installed modules and the original kernel/allocation identity. Join complete actual outputs to this same simulation thread. Report discoveries that change optimization decisions, especially episode count/duration, cold-call fraction, successful polish versus stalled exploration and source-matched feasible minima.
