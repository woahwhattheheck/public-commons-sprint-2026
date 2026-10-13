# Paired raster ensembles

Complete original-Workspace analysis, operator controls and offline result receiving.
Authored by TokenJunkieLabs for the Upper Savannah scientific application.

## What this adds

The existing experiment/programme layer owns profiles, scenarios and native NDR/SDR execution. This extension consumes its **completed original run pairs**. Every pair uses one parameter profile, the same grid and model version, and the same baseline/alternative scenario contrast. Duplicate profiles are rejected so a repeated row cannot silently change the ensemble weighting. Analyse a different alternative as a separate ensemble.

For each selected pollutant, the extension writes full-resolution GeoTIFFs containing valid-pair count, improvement count, common support, fraction of selected pairs showing improvement, mean/minimum/maximum reduction, and every requested exact quantile. Reduction is **baseline minus alternative**. Native `kg/pixel/year` and `metric_tonnes/pixel/year` stay separate. An areal-rate raster is rejected rather than converted again.

The complete report supplies original profile/run/source identities, all member totals, common/partial/missing coverage, basin quantiles, readable HTML, grayscale raster overviews, CSV and JSON. Basin quantiles come from member totals on the same cells, not sums of pixel quantiles. Missing support and zero denominators remain distinguishable from zero results. Negative original values are retained and counted. Projected grid area is labelled as such.

## Native Python and CLI

Use the existing GIS Python. The CLI's completed-Workspace reader does not require another InVEST installation or launch a second model.

```python
from model.paired_ensemble.ensemble_workspace import EnsembleWorkspace
from model.workspace import Workspace

service = EnsembleWorkspace(Workspace('/existing/scientific-workspace'))
result = service.build(selection)
```

`selection` is a JSON object:

```json
{
  "title": "Management alternative across retained profiles",
  "purpose": "Compare physical reductions and the tested-profile spread",
  "pairs": [
    {
      "profile_id": "ORIGINAL_PROFILE_ID",
      "baseline_run_id": "ORIGINAL_COMPLETE_BASELINE_RUN_ID",
      "alternative_run_id": "ORIGINAL_COMPLETE_ALTERNATIVE_RUN_ID",
      "scenario_id": "ORIGINAL_ALTERNATIVE_SCENARIO_ID"
    }
  ],
  "pollutants": ["nitrogen_export", "phosphorus_export", "sediment_export"],
  "quantiles": [0.1, 0.5, 0.9],
  "support": "all_pairs",
  "planned_member_count": 1,
  "memory_mb": 256,
  "tile_size": 256,
  "max_open_datasets": 48
}
```

The capitalized values above denote the original 64-character IDs; the browser builds these rows from the current run catalogue. `planned_member_count` describes the intended design, not just the available subset. Optional `improvement_thresholds` maps each pollutant to a finite nonnegative threshold in its pixel-mass units. Fraction improved uses a strict `reduction > threshold` comparison.

```sh
# From the maintained application root:
python -m model.paired_ensemble.ensemble_cli preview --workspace "$WORKSPACE" --selection selection.json
python -m model.paired_ensemble.ensemble_cli build --workspace "$WORKSPACE" --selection selection.json
python -m model.paired_ensemble.ensemble_cli list --workspace "$WORKSPACE"
python -m model.paired_ensemble.ensemble_cli pause --workspace "$WORKSPACE" --selection selection.json
python -m model.paired_ensemble.ensemble_cli resume --workspace "$WORKSPACE" --selection selection.json
```

The output is `WORKSPACE/ensemble-products/ANALYSIS_ID/`. Exact source-file hashes, grid, profiles, scenario contrast, requested statistics, thresholds and computation-source hash bind the analysis ID. Caller permutations of native pairs resolve to the same sorted cohort. Task progress is retained in `ensemble-products/controls/`.

## Three explicit support choices

| Selection | Quantitative raster support | Basin member comparisons |
|---|---|---|
| `all_pairs` | Every selected pair, separately per pollutant | Same common pixels for every member |
| `all_pairs_all_pollutants` | Every pair and every selected pollutant | Same common geography across pollutants and members |
| `available_pairs` | At least one valid pair; counts vary spatially | Still the strict common pixels, separately per pollutant |

The improvement fraction is the fraction of explicitly selected pairs, not an estimated success probability. Quantiles are descriptive order statistics, with linear interpolation at `(n-1)*q`; parameter choices have no inferred probability distribution.

## Existing operator integration

Copy the complete source into the maintained application, preserving other teams' files. Then:

```sh
python operator/install_paired_ensemble.py --operator operator
# Start the existing operator with its normal command and existing state.
```

The installer adds one idempotent `paired_ensemble.install` call after the original `Operator` and `Handler` definitions and before `main()`, and a navigation link. It preserves the existing server and browser modules rather than replacing them. The panel opens at `/web/paired_ensemble.html` under the **same original operator origin**, using its existing session capability and selected workspace.

The panel discovers complete profile-matched runs, shows incomplete contrast profiles, selects quantities/support, previews the source binding, submits the original durable action queue, pauses immediately after the current tile, resumes the exact saved request, opens complete reports, exports result projects and receives them. Progress polling reads one retained task and its small control file rather than repeatedly hashing all inputs or reloading the full workspace.

Actions: `paired_ensemble.build`, `paired_ensemble.resume`, `paired_ensemble.export`, `paired_ensemble.receive`. Reads: the existing `/api/state`, `/api/item?kind=paired_ensemble_products`, `/api/task`, plus `/api/paired-ensemble/progress?task_id=...`. Immediate preview/pause use `/api/paired-ensemble/preview` and `/api/paired-ensemble/pause`. All use the original authorization boundary and native queue; the extension creates no independent model scheduler.

The registration was composed against original operator blob `8434eba9cf0243fe2d50ec879a993c7ffbbc86a9` and original Workspace blob `4785867daaa959ad69a2ca955a3abc3f5ef324a7`. Newer cumulative operator editions should retain these methods; the wrapper delegates every unrelated route and action to the current implementation.

## Exact consumer contract

`analysis.json` has schema `upstate.paired-raster-ensemble/v1`. `selection.members` preserves each `profile_id`, `baseline_run_id`, `alternative_run_id`, `scenario_id` and physical file identity. `summary[POLLUTANT]` includes `units`, `reporting_cells`, `common_cells`, `common_coverage_fraction`, `any_pair_cells`, `partial_pair_cells` and complete `members`.

Each summary member retains:

- Original member/profile/scenario/run IDs and `common_cells`.
- `baseline_total_common_support`, `alternative_total_common_support`, `reduction_total_common_support`, `reduction_percent_common_support`.
- Separate own-support and pair-support totals/counts, negative-input counts and improved/worsened common cells.

`basin_reduction_distribution_common_support` contains member count, minimum, maximum, mean and the requested quantiles of common-support basin totals. `artifacts[POLLUTANT--STATISTIC]` contains relative path, bytes, SHA-256, pollutant, statistic and units. The SHA-256 of the exported `common_support` GeoTIFF is an exact support-artifact identity for downstream diagnostics. Different byte encodings need an explicit mask-content comparison rather than assuming identical geometry from different file hashes.

## Recovery, receiving and capacity

Processing retains two tile-local member arrays; it does not stack a whole region in memory. Each complete tile and its summaries are durably written before advancing. A reopened process verifies and reuses those tiles, including after interrupted final GeoTIFF writing. A missing or changed derived output is rebuilt from verified tiles. The `memory_mb` option budgets tile arrays; Python, GDAL caches, file handles and reporting have additional process overhead. Exact quantiles retain the complete selected member population without sampling it down.

```sh
python -m model.paired_ensemble.ensemble_cli report --project "$ANALYSIS_DIRECTORY"
python -m model.paired_ensemble.ensemble_cli export --project "$ANALYSIS_DIRECTORY" --out result.zip
python -m model.paired_ensemble.ensemble_cli receive --archive result.zip --out received-result
python -m model.paired_ensemble.ensemble_cli inspect --project received-result
```

Receiving is create-only and streamed; every original result member is hash-checked. The complete HTML/CSV/JSON/GeoTIFF result opens offline and can be re-exported. The original scientific Workspace backup remains the route for transferring all model inputs, original native intermediates and editable run selections.

## Executed operating checks

`PYTHONPATH=. python checks/paired_ensemble_journey.py --out NEW_DIRECTORY` runs one complete authored numerical journey: three support modes, exact NumPy comparison, distinct missing masks, negative and zero inputs, durable pause/resume, missing-derived-file repair, completed-native-record binding, full report export, receiving, reopening and re-export. It checked 448,614 scalar outputs across three pollutants, with all 36 quantitative rasters and 51 portable files retained. These are labelled numerical fixtures, not regional model results.

A separate fresh-process 96-profile / 576-input-raster / 257×254-pixel / three-pollutant run completed computation and reporting in **11.65 seconds**, with **201,900 KiB maximum RSS**, four durable tiles and 36 quantitative raster outputs. Tile-array budget was 128 MiB. These are measurements of this cloud container and workload, not extrapolated regional timings.

The complete report was rendered as owned HTML in Chromium at desktop and 390-pixel phone widths: six raster previews loaded, no horizontal page overflow, and all seven member rows opened. File-URL navigation returned `ERR_BLOCKED_BY_ADMINISTRATOR`; the visual check used the authored DOM with embedded copies of its actual preview PNGs. The original full regional application receiving/run belongs to its existing source/runtime operation.

## Scientific references

The consumer preserves the original application's explicit InVEST 3.20.0 output-unit conversion and original mass-artifact contracts. Relevant primary guides:

- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html

No additional calibration, causal certainty or probabilistic interpretation is introduced by the ensemble statistics.

## Cumulative source coexistence

Stable contribution identity: **ASTRA-ECO12-2651**, originally merged in PR2651. A different active seat used the same ASTRA-ECO12 label and generic ensemble module paths. This complete edition places the six computation modules in `model/paired_ensemble/`, with independent `paired_ensemble.*` operator actions, `paired_ensemble_products` catalogue and `/web/paired_ensemble.html`. The other seat's `model.ensemble_workspace.run_workspace` and single-artifact model files remain intact. This feature adds complete multi-pollutant/shared-support computation and its report to the same maintained operator.

`operator/install_paired_ensemble.py` migrates this contribution's exact earlier server/navigation registrations, and removes earlier generic files **only when their SHA-256 equals the original PR2651 source**. Differing peer files are preserved. The scientific kernel bytes and result schema remain unchanged by this namespace move, so already-produced result projects keep their original identities and receiving compatibility.

## Selected native model scope

For an NDR-only retained grid and profile, pass `pollutants: ["nitrogen_export", "phosphorus_export"]`. For SDR-only, pass `pollutants: ["sediment_export"]`. A combined study can request all three exports. Each requested artifact is checked against the original completed run, and the retained profile must contain the parameters for every requested native model. Source records preserve the profile's actual available parameter groups, requested pollutant list and original native run identities. Complete historical two-model profiles retain the same source values and analysis identity.

The paired-design service uses `model.ensembles`, `model.ensemble_cli` and `model.ensemble_report`. This raster consumer uses `model.paired_ensemble` throughout, including its CLI and report functions. The separate single-artifact `model.ensemble_workspace.run_workspace` contribution and its `ensemble_raster_cli` keep their own namespace. Use `operator/install_paired_ensemble.py --operator operator` after receiving this complete component to migrate the earlier PR2651 registration while retaining the same `ensemble-products` results.
