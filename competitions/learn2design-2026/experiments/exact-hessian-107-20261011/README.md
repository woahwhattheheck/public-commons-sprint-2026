# Native exact-Hessian comparison for Learn2Design

This experiment runs the original `MeasuredPortfolio099`, `BudgetLBFGS100` and `ExactHessianTR104` methods alongside `MeasuredExactHessian6966`. It includes the frozen candidate sources, unchanged native UIFO runner, effective-runtime capture, serial comparison operator and raw-output export. The measured variant corrects two scheduling decisions while retaining the original spectral trust-region algorithm and native Objective.

The original restart/fused experiment remains in the sibling `sol-budgeted-restarts-20261011` directory. Its separate five-lane method also numbered 107 is a different source from `ExactHessianTR104`; names and hashes in this directory identify the four methods precisely.

## Method changes

`candidate/submission.py` makes two changes to the retained `original/107/submission.py`:

1. **Estimate Hessian cost from a completed logged call.** Warmup includes compilation and can return before queued device work has completed. The default scheduling prior therefore comes from the first completed logged Hessian call. Warmup remains part of the container duration; later calls retain the measured predictive budget check and gradient fallback. The original warmup-prior option remains explicitly available.
2. **Refresh the accepted center after a stale-model rejection.** A rejected step produced with an old Hessian requests a new Hessian at the current accepted point before another trial. Ordinary cost-based Hessian-at-trial updates remain available.

The implementation retains one native logged Objective call per trial, original feasibility handling, Hessian shape/finiteness checks, negative-curvature steps, spectral trust-region solves, trust ratios, damping and restart logic. It does not access private Objective state or replace the problem.

## Sources and original budget

`SOURCES.json` binds each source, requirements file and two-file submission archive to an exact SHA-256. It also records the native runner, CPU bootstrap, runtime-capture source and observed framework module hashes. `PACKAGE-MANIFEST.json` inventories the complete source projection.

The organizer source is pinned to [Learn2Design-2026 at 1dc4d6e](https://github.com/artificial-scientist-lab/Learn2Design-2026/tree/1dc4d6e7d0ff656555f48bcf3c22a4d284779386). Its original [submission rules](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/1dc4d6e7d0ff656555f48bcf3c22a4d284779386/docs/submission.md), validator and MIT license are preserved in `official/`.

The pinned rules specify a four-hour Objective budget after `start_logging()`, permitted pre-logging warmup, and a four-hour-thirty-minute container limit. Official evaluation uses ten hidden topologies. These experiments use native public UIFO topologies with explicit screening or full budgets. Each fresh Objective keeps the supplied size-3, 50-frequency physics and native `hessian_batch_size=1`; its logged loss, feasibility and timestamps remain the scoring source.

The observed runtime is `dfbench 0.3.3`; its Objective file matched its wheel record. Exact package versions and framework source hashes are in `SOURCES.json`. Use an equipped environment satisfying the selected method's own `requirements.txt`. Framework and accelerator installation remains with that environment; each actual run captures its effective configuration rather than assuming that package names establish comparable execution.

## Run one native cell

From this experiment directory, run the unchanged native runner through the same-process context capture:

```bash
python runner/run_recorded.py -- --candidate candidate/submission.py --topology-seed 7 --algorithm-seed 42 --seconds 180 --out measured-t7-s42-180.json
```

Choose an original comparator with `--candidate original/099/submission.py`, `original/101/submission.py` or `original/107/submission.py`, keeping the remaining conditions identical. The output and adjacent `*.json.runtime.json` are create-only. Retain both files: the original report includes native histories/outcome, while the context records effective CPU affinity, JAX dispatch/configuration, relevant thread/XLA/allocator settings and native module hashes bound to the exact report bytes. Runtime capture makes no Objective evaluation and does not change the original clocks.

For CPU execution, select real granted CPUs, an existing Python environment, and a private compilation cache:

```bash
L2D_CPUS=0,1 L2D_PYTHON=/absolute/venv/bin/python L2D_CPU_CACHE_DIR=/absolute/private/cache bash runner/run_recorded_cpu.sh --candidate candidate/submission.py --topology-seed 7 --algorithm-seed 42 --seconds 180 --out measured-t7-s42-180-cpu.json
```

The retained CPU bootstrap applies JAX's public synchronous-dispatch configuration before backend, Objective or candidate construction. CPU and GPU records remain separate comparison conditions. Allocate enough real memory for the original UIFO signal/noise banks, differentiation and compiler state, then run one numerical process within that allocation.

## Execute a complete comparison phase

`run_phase.py` runs cells serially inside one existing allocation. Its standard-library planning command does not import JAX or construct an Objective:

```bash
python run_phase.py plan
```

The development phase interleaves all four sources within each public topology: seeds 7, 8 and 9, algorithm seed 42, and 180 seconds of Objective time, for twelve cells.

```bash
python run_phase.py run --mode gpu --python /absolute/venv/bin/python --run-dir /absolute/output/hessian-development
```

Use `--mode cpu --cpu-affinity 0,1` on a separately allocated CPU runtime. The original CPU launcher retains its dispatch/thread settings. The phase command creates no additional resource scheduler; place the whole serial command within the environment's existing allocation mechanism.

Before dispatch, `phase.json` pins candidate/operator/runner/capture sources, method selection, executable bytes, relevant environment, mode and cache policy. Each native child keeps the original 16,200-second container ceiling, including permitted pre-logging warmups. Each cell begins with its own empty compilation cache, capped at 128 MiB, preventing later methods from consuming earlier methods' compiled artifacts. After the child exits and completion is committed, the operator removes only that newly created cache. Interrupted attempts retain their files and cache.

The original child inherits the phase lock. If its controller disappears, another invocation cannot overlap that still-running numerical process. Repeating the original command reuses completed records and continues untouched cells. A launched attempt without completion remains an interrupted attempt and is never silently replayed. Native exceptions, invalid/no-feasible outcomes, process exits, missing output and container-limit events remain visible.

Inspect progress through the original output directory:

```bash
python run_phase.py status --run-dir /absolute/output/hessian-development
```

For broader work, explicitly select and pin two source IDs and the baseline:

```bash
python run_phase.py run --phase broad-public --candidate 099 --candidate 107-measured6966 --baseline 099 --mode gpu --python /absolute/venv/bin/python --run-dir /absolute/output/hessian-broad
```

This example identifies sources; it does not assert that either method has won. `broad-public` runs twenty cells over topology seeds 7–16 at 600 seconds. `full-objective-budget` runs the same two-source public cohort at 14,400 seconds. Select the continuation using actual matched development results. The operator does not submit or replace a competition entry.

## Compare and export original outcomes

The phase operator writes the comparison from retained original reports and matching runtime contexts. Standalone comparison is also available:

```bash
python compare_native.py reports/099-t7.json reports/measured-t7.json --baseline 099 --out comparison.json
```

Only exact source, runner, effective runtime, native physics, topology/algorithm seeds and budget matches enter paired numerical deltas. A negative loss delta improves on the selected baseline. Every failure and no-feasible result remains retained. Duplicate candidate/condition inputs are rejected rather than choosing the best attempt. Missing organizer random-search fallback records are not synthesized. Older reports without effective runtime settings remain visible in separate conditions. Summary cohorts keep hardware, runtime, physics and budgets separate while aggregating topology/algorithm seeds.

Export a completed or partial phase to a new archive path:

```bash
python run_phase.py export --run-dir /absolute/output/hessian-development --archive /absolute/output/hessian-development-results.zip
```

The archive retains every original console, attempt, completion, native report, runtime context, source-pinned intent and comparison with file hashes. Compilation caches are excluded. Retain this output alongside the exact source revision used for execution.

## Validation status

The three source-pinned plans produce twelve development cells, twenty broader cells and twenty full-budget cells. The four supplied archives contain exactly `submission.py` and `requirements.txt` and passed the retained organizer's static validator. Source review checked original native return/logging semantics, interrupted-process handling, source identity, effective-runtime condition separation and per-cell cache isolation. No new test suite or hosted workflow is introduced.

This source release contains no completed numerical comparison. Physical performance, feasibility across the public cohort and any final method selection must come from the retained native results.
