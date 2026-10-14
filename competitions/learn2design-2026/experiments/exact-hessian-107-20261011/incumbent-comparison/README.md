# Compare recovery modes with the original 096 incumbent

This course joins the exact measured incumbent to the maintained native source
selector, complete paired phases and selected-source packaging. Work from
`competitions/learn2design-2026/experiments/exact-hessian-107-20261011/`
in this source revision, inside the existing equipped allocation.

## Exact incumbent and measured configuration

Source ID `096` selects the unchanged `StagedTrustPortfolio096`:
6,722 bytes, SHA256
`97cbe70ec309629be60c78facf903e110aace074111715e58fde57afc01c8077`.
Its unchanged 42-byte requirements have SHA256
`bbbc1e3cbecf807974d0d51d1892ad68c4bf053f9eb637413cdc7d4cd8139f80`:

```text
dfbench==0.3.3
jax>=0.4.35,<1
numpy>=1.24
```

Both bodies come from the original sibling
`sol-budgeted-restarts-20261011` carrier and match the actual v7
`materialized-sources.json`. The source and requirements are copied unchanged
to `original/096/`. Its full three original native histories, materialized
source declarations and runtime environment are retained there; `SOURCE_MAP.json`
connects every retained body to the original 47,238-byte result archive.

The selected incumbent uses its original optimize defaults with an empty
treatment-options dictionary. Native seed 42 and no population override match the
retained v7 cell configuration. The source-bound adapter requires the original
`algorithm_str="tjlabs_staged_trust_portfolio_096"` diagnostic. Native Objective
histories determine feasibility and loss independently of the optimizer's own
internal best-point bookkeeping.

The original dependency declaration stays intact. Actual Optax, JAX, dfbench,
device and dispatch configuration are captured by the unchanged native runner
and runtime wrapper. The original v7 environment recorded Optax 0.2.8. Run the
new comparisons in one compatible equipped environment; installing or changing
packages is not part of the phase command. Official evaluation applies its own
published fixed-core policy.

## Four-arm paired campaign

| Source ID | Original implementation | Selected treatment |
| --- | --- | --- |
| `096` | Original measured incumbent | Original defaults |
| `099-prefeasible-off-regional` | Exact d7253236 regional successor | Recovery off, anchor state |
| `099-prefeasible-restart-regional` | Same successor | Bounded early restarts, anchor state |
| `099-prefeasible-restart-penalty-regional` | Same successor | Early restarts and public penalty ranking, anchor state |

The three recovery arms retain their exact prior source, options and arm hashes.
The new incumbent baseline makes the direct comparison explicit. The original
same-source recovery phases remain available for their existing work.

- `prefeasible-incumbent-development`: twelve cells, public topology seeds
  10/11/12, algorithm seed 42, 180 logged Objective seconds each.
- `prefeasible-incumbent-broad-public`: forty cells, public topology seeds
  7–16, seed 42, 600 logged Objective seconds each.

Every topology group contains all four methods on the same worker. Each cell
constructs a fresh original Objective with size-3 UIFO, 50 frequencies, original
penalties and Hessian batch size 1. The original 16,200-second process ceiling,
fresh bounded compilation cache, source checks and complete raw result retention
apply to every cell.

```sh
python run_phase.py plan --phase prefeasible-incumbent-development
python run_phase.py plan --phase prefeasible-incumbent-broad-public

python run_phase.py run --phase prefeasible-incumbent-development \
  --mode gpu --python /actual/equipped/bin/python \
  --run-dir /actual/output/prefeasible-incumbent-development

python run_phase.py run --phase prefeasible-incumbent-broad-public \
  --mode gpu --python /actual/equipped/bin/python \
  --run-dir /actual/output/prefeasible-incumbent-broad-public
```

Use real receiving-worker paths. Existing CPU allocations use `--mode cpu`
and their actually granted `--cpu-affinity`; they form a separate runtime
condition. To partition the broad campaign across two existing workers, add
`--partition-count 2 --partition-index 0` or `--partition-index 1`, with distinct
run directories. Each receives five complete topologies and twenty cells.
Additional partitions use the same original operator and retain whole groups.

Before admitting work, the native owner reconciles existing original phases and
the actual FFR130 provider state. Choose this incumbent campaign for work that has
not yet started. An already admitted three-mode phase keeps its own checkout,
manifest, cells and ownership. Finish and return its existing outputs before
composing a continuation; do not replace it or launch a duplicate condition.
Previously accepted v7 controls remain their original records. Their older
runtime and source-manifest context cannot be relabelled as cells of this phase.

## Read and retain all original outcomes

```sh
python run_phase.py status --phase prefeasible-incumbent-broad-public \
  --run-dir /actual/output/prefeasible-incumbent-broad-public

python run_phase.py export --phase prefeasible-incumbent-broad-public \
  --run-dir /actual/output/prefeasible-incumbent-broad-public \
  --archive /actual/output/prefeasible-incumbent-broad-public-results.zip

python release_selected.py inspect \
  --phase-dir /actual/output/prefeasible-incumbent-broad-public \
  --out /actual/output/prefeasible-incumbent-selection.json
```

Repeat `--phase-dir` for every actual partition when collecting a divided
campaign. The complete denominator remains forty cells. Native failures,
no-feasible results, interrupted attempts, missing partitions and actual
feasibility counts remain visible. Repeating the original run command continues
untouched cells and preserves finished or interrupted attempts.

The comparison baseline is the actual `096` arm. Each recovery arm gets its own
matched incumbent pairs. A whole paired mean requires all expected pairs,
finite feasible losses, normal completed processes and one recorded runtime
cohort. Partial finite means remain descriptive. The official random-search
replacement is unavailable locally and is not filled in. The original v7
096/099 outcomes explain why096 is retained as incumbent; they do not predict
the new recovery arms.

## Full-budget incumbent pair

The existing numerical owner chooses a promising exact recovery source after
reading the complete native outcomes. The existing full-budget phase can now
select `096` directly:

```sh
python run_phase.py plan --phase full-objective-budget \
  --candidate 096 \
  --candidate 099-prefeasible-restart-penalty-regional \
  --baseline 096

python run_phase.py run --phase full-objective-budget \
  --candidate 096 \
  --candidate 099-prefeasible-restart-penalty-regional \
  --baseline 096 \
  --mode gpu --python /actual/equipped/bin/python \
  --run-dir /actual/output/incumbent-selected-full-budget
```

This explicit example has twenty cells on seeds 7–16, seed42, 14,400 logged
Objective seconds per cell and the 16,200-second container ceiling. Substitute
the actually selected recovery ID. Whole topology partitions, current allocation
limits and the original entrant's account route continue to apply.

## Four complete source packages

Each prepared ZIP uses this source revision's manifest and contains five complete
members: root selected entrypoint, exact retained optimizer, original
requirements, source declaration and license.

- [Original096 selected ZIP](selected/096-selected.zip)
- [Recovery off selected ZIP](selected/099-prefeasible-off-regional-selected.zip)
- [Restart selected ZIP](selected/099-prefeasible-restart-regional-selected.zip)
- [Restart and penalty selected ZIP](selected/099-prefeasible-restart-penalty-regional-selected.zip)
- [Complete package/member inventory](selected/PACKAGES.json)

The three earlier ZIPs under `prefeasible-recovery-regional/selected/` remain
unchanged and retain their original manifest revision. Use these current four
packages for this incumbent campaign. All four were reopened and every original
member compared byte for byte. The UZIP encoder supplies their ZIP containers;
their entrypoints and declarations follow the unchanged maintained packager.

The existing native receiver applies the current official static validator to
the actual files:

```sh
python official/final-validator-20261013.py incumbent-comparison/selected/096-selected.zip
python official/final-validator-20261013.py incumbent-comparison/selected/099-prefeasible-off-regional-selected.zip
python official/final-validator-20261013.py incumbent-comparison/selected/099-prefeasible-restart-regional-selected.zip
python official/final-validator-20261013.py incumbent-comparison/selected/099-prefeasible-restart-penalty-regional-selected.zip
```

After actual phase results return, the maintained packager can attach the full
original panel to its external release report:

```sh
python release_selected.py package \
  --source-id 099-prefeasible-restart-penalty-regional \
  --phase-dir /actual/output/prefeasible-incumbent-broad-public \
  --archive /actual/output/incumbent-comparison-selected.zip \
  --out /actual/output/incumbent-comparison-selected-release.json
```

Select the genuine winning source ID, including096 if it remains preferred, and
provide every original phase partition. The wrapper passes the original
Objective and caller options once to the exact implementation; it does not
change clocks, evaluation methods, warmup, physics or source defaults. Full
official rules and API source are linked in the
[recovery guide](../prefeasible-recovery-regional/README.md#current-organizer-contract).

The original native owner returns actual validation output, full phase archives
and the selected-release report in the existing simulation thread. The original
entrant then carries the eligible selected package through the established
competition account.
