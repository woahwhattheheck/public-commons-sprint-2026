# Recoverable polishing around original096

## Measured reason for this revision

The complete current14 FALQN panel reaches feasible designs early, then loses the matched comparison against retained096 on T7, T8 and T9. T8 has 64 consecutive infeasible calls after call25; T9's best feasible design remains its first feasible call28. The original FALQN code discards its exploration Adam state when entering polishing, then starts exploration again after its fixed-radius policy is exhausted. A later worse feasible point can select the same already-exhausted incumbent with a fresh polishing state.

[The full diagnosis](analysis/DIAGNOSIS.md) retains all actual results and the limits of that causal interpretation. [The original current14 panel](current14/panel-result.json), its complete source binding and the derived trajectories are included unchanged. The v10 incumbent and saved-v12 FFR receipt values remain attributed to their original returns; the original retained-output holder is returning their complete histories in the same Slack operation.

This revision is a new experiment. Its schedule and its benefit are unmeasured. The original096 remains a separate complete control.

## What the implementation preserves and changes

The `exploration()` generator preserves096's original initial points, JAX key, clipped Adam moments, trust-radius updates, Gaussian-noise draws, restart patience, best-point pull and update order. After an exploration observation it advances to the next pending proposal. A polishing episode suspends that frame and proposal. Polishing gradients never enter its optimizer or random stream.

The default treatment begins only after 80% of the actual Objective time budget has elapsed and a finite-gradient feasible incumbent exists. It alternates up to four actual polishing evaluations with at least four resumed exploration evaluations. A paused polishing episode keeps its accepted anchor and curvature memory. A better exploration incumbent may replace that anchor. All work, including Python/JAX bookkeeping and rejected trials, consumes the same original elapsed budget.

The feasible-anchored quasi-Newton helper comes from the retained reviewed FALQN source. The new treatment starts at radius 0.08, contracts to 1e-6 and stops that episode when its policy is exhausted. It records the outcome as `radius_floor`, rather than describing the point as mathematically stationary. No reset reopens the same exhausted anchor. A bounded cache retains evaluated point identities; the duplicate check uses the actual JAX dtype passed to the Objective.

The true Objective clock, original physical penalty, power thresholds and logged feasibility remain unchanged. Calls use the public `value_and_grad_aux` interface when power thresholds are available, with matching warmup before logging. A predictive guard uses both EWMA and the last actual call duration; an over-budget return never updates either optimizer state. The Objective's own logged histories remain authoritative.

The off treatment uses this same generator, feasibility observation and diagnostic machinery with polishing disabled. It is an ablation of the new implementation. It is not substituted for the untouched096 control. Different diagnostic overhead can change elapsed-time call counts even when a common exploration prefix agrees.

## Complete source selections

| ID | Retained implementation | Frozen treatment |
| --- | --- | --- |
| `096` | `../original/096/submission.py` | Original defaults and original 42-byte requirements |
| `096-recoverable-off-7f24` | `submission.py` | `polish_enabled=False` |
| `096-recoverable-polish-7f24` | `submission.py` | `polish_enabled=True` |

Both new treatments explicitly retain the same late fraction 0.8, quantum 4, resumed exploration 4, memory 8, curvature threshold 1e-8, radii 0.08/1e-6/0.3, grow 2, shrink 0.5, Armijo 1e-4 and trace limit 4096. Original096 optimization defaults remain the new class's exploration defaults. The frozen invocation adapter binds options and diagnostic expectations separately from source bytes.

[Source map](SOURCE_MAP.json) connects the source, original implementations, actual current14 data and unchanged native modules. All20 previous source declarations and 15 original phases remain intact. The two new phases are additive.

The new requirements retain the original096 declarations and explicitly include its already-imported Optax dependency. Use one compatible existing environment for all three arms and retain the actual Optax version, JAX/JAXlib, NumPy, dfbench, Differometor, x64 mode and allocator settings in the original runtime receipt. The organizer fixes its core environment; the complete current official environment and Objective documentation are retained under `official/`.

## Actual rules and interpretation

Current official source is `9ebce9bfe5c33242c297f84f4c79d088b7b52e70`:
- [Submission and deadline](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/9ebce9bfe5c33242c297f84f4c79d088b7b52e70/docs/submission.md)
- [Evaluation environment](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/9ebce9bfe5c33242c297f84f4c79d088b7b52e70/docs/evaluation-environment.md)
- [Objective API](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/9ebce9bfe5c33242c297f84f4c79d088b7b52e70/docs/dfbench/Objective-API-Reference.md)

The submission deadline is 15 October Anywhere on Earth, equivalent to 16 October 2026 11:59:59UTC. The official evaluation uses an H100 80GB, 16 vCPU, 128GiB, Ubuntu 24.04.3, Python 3.12.3 and the organizer's pinned JAX/dfbench environment. Each Objective allows four hours after `start_logging()`, with a 4.5-hour total container cap. The score uses each task's minimum logged feasible loss and the mean across ten hidden tasks.

The retained current14 T4/180-second panel is a development measurement with its own runtime identity. Public topology development and broad phases below remain separate from the hidden official tasks.

## Run the complete existing native course

Run from the maintained experiment root, one directory above this guide. Reuse the existing equipped allocation and original competition owner. A new source/option pair receives a new run directory. All previous admitted runs keep their original source and directories.

First materialize the complete repository selection, then validate the three exact supplied archives with the retained current official validator:

```bash
python official/final-validator-20261013.py recoverable-polish-7f24/selected/096-selected.zip
python official/final-validator-20261013.py recoverable-polish-7f24/selected/096-recoverable-off-7f24-selected.zip
python official/final-validator-20261013.py recoverable-polish-7f24/selected/096-recoverable-polish-7f24-selected.zip
python run_phase.py plan --phase recoverable-polish-development
python run_phase.py run --phase recoverable-polish-development --mode gpu --run-dir runs/recoverable-polish-development --archive runs/recoverable-polish-development.zip
```

This is nine fresh real UIFO cells: T10/T11/T12, seed 42, 180 seconds, all three arms on each topology. The existing runner retains the original loss, feasibility and time histories, actual diagnostic trace, source/options identity, runtime sidecars, failures and subprocess output.

Inspect the off treatment against unchanged096 using the common observed exploration prefix, not total elapsed call count alone. Compare raw loss/feasibility arrays and actual parameter/update order where the original equipped course already records it. If parameter vectors are absent, record that limit and use the original public Objective's parameter-history capture in the same native receiving course for the focused prefix comparison; do not infer byte-identical proposals from a rounded score. Preserve that receiving source and its actual capture. Its observations stay separate from the unchanged performance runner.

For the on treatment, inspect actual `trace` mode transitions, `explore_resumes`, `polish_resumes`, `repeat_skips`, `exhausted_anchor_identities`, pair status, QN outcomes and the Objective's feasible minimum. Confirm a rejected polishing observation is followed by the retained exploration proposal and that side-trial gradients do not enter the exploration moments. The true Objective clock remains authoritative throughout.

Run the complete broad comparison on the existing available compute:

```bash
python run_phase.py plan --phase recoverable-polish-broad-public
python run_phase.py run --phase recoverable-polish-broad-public --mode gpu --run-dir runs/recoverable-polish-broad-public --archive runs/recoverable-polish-broad-public.zip
```

This is 30 cells over T7–T16 at 600 seconds and seed 42. The existing `--partition-count N --partition-index I` options distribute whole topology groups across existing allocations. Each worker retains all three arms for its topology; combine every partition's original reports and full denominator. Hardware/runtime groups stay distinct.

The already-maintained four-hour phase supports the selected original096/new-on pair:

```bash
python run_phase.py plan --phase full-objective-budget --candidate 096 --candidate 096-recoverable-polish-7f24 --baseline 096
python run_phase.py run --phase full-objective-budget --candidate 096 --candidate 096-recoverable-polish-7f24 --baseline 096 --mode gpu --run-dir runs/recoverable-polish-full-budget --archive runs/recoverable-polish-full-budget.zip
```

This declares 20 public cells with 14400 seconds per Objective and 16200 seconds per cell container. Select the actual continuation using returned broad results and the original owner's existing allocations. Account Chad retains the final competition-entry role.

## Recovery and selected archives

An interrupted original phase resumes with the same checkout, exact command and run directory. The existing phase controller preserves completed cells and live-child ownership. Use its actual status/export operations to return every report and error:

```bash
python run_phase.py status --run-dir runs/recoverable-polish-development
python run_phase.py export --run-dir runs/recoverable-polish-development --archive runs/recoverable-polish-development-final.zip
python release_selected.py inspect --phase-dir runs/recoverable-polish-development --out runs/recoverable-polish-development-inspection.json
python release_selected.py package --source-id 096-recoverable-polish-7f24 --archive runs/recoverable-polish-measured-selected.zip --phase-dir runs/recoverable-polish-development --out runs/recoverable-polish-measured-selected.json
```

The supplied `selected/` archives contain the exact retained algorithm, one direct forwarding subclass, original requirements, original license and complete RELEASE declaration. Their manifest binds the current 22-arm source selection and canonical treatment. The existing native publisher and static validator verify these same complete members. A later manifest revision produces a successor release declaration; preserve each original archive alongside its originating manifest.

Return the complete original output archive in the original simulation thread `C0C1F274SGH/1791736325.457109`. The existing current14 raw-history pickup remains `1791980608.567539`. Join the actual new result to its candidate, invocation, runtime and true Objective budget so the final entrant can select using the complete comparison.
