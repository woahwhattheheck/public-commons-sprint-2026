# Pre-feasibility recovery: native comparison and selected package

This completes the retained regional pre-feasibility candidate in the existing
Learn2Design source project. Run every command below from
`competitions/learn2design-2026/experiments/exact-hessian-107-20261011/`
in the original carrier checkout, using an existing equipped Python environment.

The 21,232-byte candidate is unchanged:
`d7253236b7cc87e7c2b496fbb2ef6fc3b54b6a2af435ccef588986003b7b479e`.
It derives from the retained regional anchor-state source
`32dfbed94d75b54afe1c34902e689778a3280b5ce20ed43bc75390e971de91a4`.
The original 21-member source package, provider response, supplied cases and six
v7 histories remain in their original source carriers. `SOURCE_MAP.json` gives
every original member's byte length and SHA256. The five public organizer
documents are preserved here alongside the unchanged candidate.

## Three exact treatments

| Frozen source ID | Recovery mode | Change before a usable feasible point |
| --- | --- | --- |
| `099-prefeasible-off-regional` | `off` | Original regional decision path; new diagnostics only |
| `099-prefeasible-restart-regional` | `restart` | End a stalled infeasible restart early |
| `099-prefeasible-restart-penalty-regional` | `restart_penalty` | Same restart recovery; rank two infeasible points by finite public auxiliary penalty, then loss |

All three explicitly use `backtracking_state="anchor"`, recovery fraction 0.10,
streak bounds 12–80, at most four recovery restarts, and recovery only while the
original Objective budget progress is below 0.5. The original five-start
portfolio and all other source defaults are unchanged. Both the requested state
policy and recovery mode must appear in the algorithm's actual diagnostics.
Missing or different diagnostics retain an invocation failure.

The exact recovery guard is `best_feasible_params is None`: no **finite usable
feasible optimizer point** has been retained. An auxiliary feasibility flag with
a nonfinite loss or gradient does not switch recovery off. This clarifies the
original source docstring without changing the candidate. Once a usable feasible
point exists, recovery and penalty-first ranking switch off and the regional
post-feasible policy continues. Missing, nonscalar or nonfinite auxiliary
penalty uses the original loss ordering. Penalty comes from the same logged
Objective evaluation, never from an inferred constraint or another simulator.

These are three arms of one candidate; selecting its bare file with default
options always chooses `restart_penalty`. Use the explicit source selector for
a comparison and the selected packager for a final archive.

## Native phases

`prefeasible-development` contains nine cells: all three modes on public topology
seeds 10, 11 and 12, algorithm seed 42, with 180 seconds of logged Objective time
per cell. `prefeasible-broad-public` contains thirty cells: the same three modes
on seeds 7–16, seed 42, at 600 seconds per cell.

Every cell constructs a fresh original Objective through the unchanged native
runner. It retains size-3 UIFO physics, 50 frequencies, original penalties and
Hessian batch size 1. Each process gets its own empty bounded compilation cache.
The 16,200-second container ceiling includes warmup and all work outside the
logged Objective window. The short screening budgets are explicit local
conditions; the official full budget remains 14,400 seconds after logging.

Plan either phase without importing JAX or running physics:

```sh
python run_phase.py plan --phase prefeasible-development
python run_phase.py plan --phase prefeasible-broad-public
```

Use an existing available GPU allocation and its actual installed interpreter:

```sh
python run_phase.py run --phase prefeasible-development \
  --mode gpu --python /actual/equipped/bin/python \
  --run-dir /actual/output/prefeasible-development

python run_phase.py run --phase prefeasible-broad-public \
  --mode gpu --python /actual/equipped/bin/python \
  --run-dir /actual/output/prefeasible-broad-public
```

Replace the `/actual/` paths with the receiving worker's real paths. The source
integration adds no resource scheduler. The existing worker owns allocation and
execution. CPU comparisons use the same commands with `--mode cpu` and
`--cpu-affinity` set to the actually granted CPUs. CPU and GPU conditions remain
separate, as do different devices, dispatch settings, packages and native
framework source.

Whole topology groups can be divided among existing workers. For example,
two broad-phase workers add `--partition-count 2 --partition-index 0` and
`--partition-count 2 --partition-index 1`, each with a distinct output directory.
Every assigned topology keeps all three modes on the same worker. Retain both
complete original phase directories; the full panel still has thirty cells.

Preserve the checkout at the exact source revision used to launch a phase.
Existing phase fingerprints include their original manifest and run plan, so
resume older phases in their original checkout rather than copying a new
manifest underneath them.

## Read, recover and retain the complete panel

```sh
python run_phase.py status --phase prefeasible-development \
  --run-dir /actual/output/prefeasible-development

python run_phase.py export --phase prefeasible-development \
  --run-dir /actual/output/prefeasible-development \
  --archive /actual/output/prefeasible-development-results.zip

python release_selected.py inspect \
  --phase-dir /actual/output/prefeasible-development \
  --out /actual/output/prefeasible-development-selection.json
```

Use the corresponding broad phase/directory for broader results. Repeat
`--phase-dir` for all actual partitions when inspecting the full panel.
The exported ZIP retains each console, native report, runtime context, attempt,
completion, frozen intent and full comparison. Failed, interrupted,
no-feasible and absent cells remain visible. Repeating the original run command
continues untouched cells, reuses finished ones and preserves interrupted
attempts. It does not silently rerun an already launched cell.

The comparison uses the explicit off arm as baseline. The source, options,
runtime, native problem, topology/algorithm seeds and supplied budgets must match
their retained records. Exact source plus frozen options distinguishes the three
arms even though their submission SHA is identical. All native histories and
feasibility flags remain the measurement source.

Use whole-panel feasibility and the complete paired losses when selecting a
continuation. Inspect `prefeasible_restarts`, `prefeasible_events`,
`penalty_rank_decisions`, `penalty_unavailable_calls`,
`first_feasible_call`, original call timing and restart diagnostics to explain
what actually ran. The original v7 096/099 records motivated the experiment;
they are different sources and are not results for these recovery arms.
The organizer random-search replacement is absent from this local panel, so a
missing feasible loss remains missing rather than receiving an invented score.

## Full-budget continuation

After the existing owners choose two exact sources from actual paired results,
reuse the existing `full-objective-budget` phase. This example retains off versus
restart-plus-penalty as an explicit comparison:

```sh
python run_phase.py plan --phase full-objective-budget \
  --candidate 099-prefeasible-off-regional \
  --candidate 099-prefeasible-restart-penalty-regional \
  --baseline 099-prefeasible-off-regional

python run_phase.py run --phase full-objective-budget \
  --candidate 099-prefeasible-off-regional \
  --candidate 099-prefeasible-restart-penalty-regional \
  --baseline 099-prefeasible-off-regional \
  --mode gpu --python /actual/equipped/bin/python \
  --run-dir /actual/output/prefeasible-full-budget
```

The phase has twenty cells on topology seeds 7–16, seed 42, 14,400 seconds per
Objective, and the original 16,200-second per-process ceiling. The same whole
topology partition options apply. This example chooses a reproducible treatment
comparison; it does not automatically promote a mode to the counted entry.

## Complete prepared source packages

These three complete ZIPs already contain the exact selected entrypoint, retained
candidate, requirements, license and source declaration:

- [Off mode](selected/099-prefeasible-off-regional-selected.zip)
- [Restart mode](selected/099-prefeasible-restart-regional-selected.zip)
- [Restart plus penalty mode](selected/099-prefeasible-restart-penalty-regional-selected.zip)

[The package inventory](selected/PACKAGES.json) retains each archive and member
hash. All five payloads were reopened and compared byte for byte. The receiving
worker applies the current official static validator to these actual ZIPs:

```sh
python official/final-validator-20261013.py prefeasible-recovery-regional/selected/099-prefeasible-off-regional-selected.zip
python official/final-validator-20261013.py prefeasible-recovery-regional/selected/099-prefeasible-restart-regional-selected.zip
python official/final-validator-20261013.py prefeasible-recovery-regional/selected/099-prefeasible-restart-penalty-regional-selected.zip
```

The ZIPs preserve the same entrypoint and member composition as the maintained
packager below. Their ZIP compression container was built with the retained UZIP
encoder; native measurement and official validation are receiving steps.

## Package exactly the selected mode

The maintained selected packager includes the original implementation,
requirements, a single direct-subclass root entrypoint, frozen options, source
declaration and third-party license. It applies the current organizer static
validator to the complete archive before publication.

```sh
python release_selected.py package \
  --source-id 099-prefeasible-restart-penalty-regional \
  --archive /actual/output/prefeasible-restart-penalty-selected.zip \
  --phase-dir /actual/output/prefeasible-broad-public \
  --out /actual/output/prefeasible-restart-penalty-selected-release.json
```

Choose any of the three exact source IDs. Supply all original `--phase-dir`
partitions when attaching a partitioned panel. To prepare the exact source
package before measurement, omit `--phase-dir`; the release then records a null
selected panel. Existing archive names are only reusable when every original
member matches. Use a fresh release-JSON output name for each retained snapshot.

The source is retained as `retained_algorithm.py`; root `submission.py`
forwards the supplied Objective and caller seed/options once, with the frozen
mode and limits. This preserves the measured treatment when the organizer loads
the root class without custom kwargs. The complete ZIP has five members:
`submission.py`, `retained_algorithm.py`, `requirements.txt`,
`RELEASE.json`, and `THIRD_PARTY_LICENSE.txt`. This candidate has no companion modules or
external runtime assets.

Give the actual selected ZIP and release JSON to the existing native receiver
and sole entrant. The native receiver should plan the nine/30-cell phases,
confirm exact selected options and current static archive validation, execute
the original physical comparison in its existing allocation, and return the
full exported phase archive plus selected release. Keep existing live kernels
and their original owners separate.

## Current organizer contract

Organizer main was checked on 14 October 2026 at commit
`9ebce9bfe5c33242c297f84f4c79d088b7b52e70`.

- [Submission and evaluation rules](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/9ebce9bfe5c33242c297f84f4c79d088b7b52e70/docs/submission.md)
- [Objective API](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/9ebce9bfe5c33242c297f84f4c79d088b7b52e70/docs/dfbench/Objective-API-Reference.md)
- [Scoring](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/9ebce9bfe5c33242c297f84f4c79d088b7b52e70/docs/scoring.md)
- [Evaluation environment](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/9ebce9bfe5c33242c297f84f4c79d088b7b52e70/docs/evaluation-environment.md)

Official evaluation uses fresh hidden topologies, the original physical
feasibility flags and four-hour logged wall-clock budget. Result-producing
Objective calls begin after logging; documented Objective warmup and public
pre-run context follow the published lifecycle. The source-bound adapter and
selected wrapper do not evaluate the simulator or change its budget.
