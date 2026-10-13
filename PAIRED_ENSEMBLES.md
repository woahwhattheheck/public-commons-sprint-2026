# Paired raster ensembles

Complete original-Workspace analysis, operator controls and offline result receiving.
Authored by TokenJunkieLabs for the Upper Savannah scientific application.

## What this adds

The existing experiment/programme layer owns profiles, scenarios and native NDR/SDR execution. This extension consumes its **completed original run pairs**. Every pair uses one parameter profile, the same grid and model version, and the same baseline/alternative scenario contrast. Duplicate profiles are rejected so a repeated row cannot silently change the ensemble weighting. Analyse a different alternative as a separate ensemble.

For each selected pollutant, the extension writes full-resolution GeoTIFFs containing valid-pair count, improvement count, common support, fraction of valid pairs showing improvement, mean/minimum/maximum reduction, and every requested exact quantile. Reduction is **baseline minus alternative**. Native `kg/pixel/year` and `metric_tonnes/pixel/year` stay separate. An areal-rate raster is rejected rather than converted again.

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

The improvement fraction at each displayed pixel is `improved_pairs / valid_pairs`. For `available_pairs`, the denominator can vary across pixels and is retained in the valid-pair raster. With complete support, it equals the selected member count. Quantiles are descriptive order statistics, with linear interpolation at `(n-1)*q`; parameter choices have no inferred probability distribution.

## Shared operator integration

The current application uses its installed extension registry. Receive the full paired source, then compose it into the same application:

```sh
python operator/integrate_paired_ensemble.py --apply
# The existing receiving command delegates to the same shared-host installer:
python operator/install_paired_ensemble.py --operator operator
```

The installer parses the complete Python source, uses the current shared host's server/browser joins, and removes only this paired component's exact earlier standalone activation and navigation link. Start the original operator with its existing configuration after applying the source. The installed catalogue contains one **paired-ensemble** extension and one owner for each original action. Its shared view is **Paired raster analysis**, following Scenario sensitivity.

The original CLI, quantitative kernel, analysis IDs and `ensemble-products/` directory are preserved. The earlier `/web/paired_ensemble.html` entry remains an installed compatibility asset served by the current registered routes. Its old installer delegates to the shared installer whenever the descriptor is present.

The desk selects original grid/scenario/model-version combinations and exposes each completed baseline/alternative run choice for each profile. Several native scopes may exist for the same profile; their available pollutants remain visible, and the operator chooses the original runs explicitly. Physical-output controls use the intersection actually present in every selected pair.

A saved scenario design can populate those original pairs directly. The same shared `model.paired_ensemble.designs.design_cohort` function supplies both the browser and the headless study workflow. It retains the full planned profile count, the complete selected member subset, any unfinished members with their native states, and the available physical outputs within the design's declared model scope. Each land-cover alternative produces its own cohort.

The original task queue owns build, resume, export and receiving. The desk retains ambiguous-submission operation IDs, follows task and tile progress, pauses after a durable tile, and resumes the exact submitted selection. A retained analysis also supplies its original native pairs after browser state has been lost. Whole-workspace receiving retains those original runs; a standalone result ZIP supplies its quantitative results and report.

State updates read JSON metadata. The form and checked profiles remain mounted across task refreshes. Raster hash checks occur during explicit source preview, build, export and file access. An active desk stops its own polling and outstanding reads when its workspace or view changes.

### Registered contracts

| Surface | Current identity |
| --- | --- |
| Manifest | `operator/extensions/paired-ensemble.json` |
| Backend | `paired_ensemble_service.PairedEnsembleService` |
| Browser | `attachPairedEnsembles` from `paired_ensemble_desk.mjs` |
| Extension/view | `paired-ensemble` |
| Original item/state kind | `paired_ensemble_products` |
| Queue actions | `paired_ensemble.build`, `paired_ensemble.resume`, `paired_ensemble.export`, `paired_ensemble.receive` |
| GET routes | `/api/paired-ensemble/catalog`, `/edition`, `/inspect`, `/cohort`, `/selection`, `/progress` |
| Immediate POST controls | `/api/paired-ensemble/preview`, `/pause` |
| Retained member route | `/api/file/paired-ensemble/{workspace_key}/{ensemble_id}/{member_path...}` |

The member route uses the shared host's typed nested-file registration and original authorized file tickets. It serves only an actual quantitative/report inventory member. Its HTML uses the paired component's existing report content policy. Downloads, uploads and portable result receiving use the original operator transport.

The recovered original `paired_ensemble_provider.py` and host browser assets remain installed. The current shared service reuses its cached catalogue and preserves the `/api/paired-ensemble/edition` reader, including its verified embedded report document, `editions` catalogue field and original task-result marker. The typed member route supplies the current desk. One singular descriptor owns the original four queue actions. The installer backs up and removes the exact earlier A74F plural descriptor on installed copies; changed unrelated registrations remain available for source composition.

The backend's `catalog` response includes actual native run IDs, run states, retained selections and present physical outputs. `cohort` accepts `design_id` and one `scenario_id`. `selection` accepts an existing `ensemble_id` and recovers a native selection from the durable analysis. `progress` accepts an original analysis `task_id` or `selection_id`. Pause accepts the original `task_id`, or the existing selection form for compatibility.

### Shared native-design selection

```python
from model.paired_ensemble.designs import design_cohort
from model.paired_ensemble import EnsembleWorkspace

cohort = design_cohort(ws, saved_design_id, saved_alternative_scenario_id)
if cohort["ready"]:
    result = EnsembleWorkspace(ws).build(cohort["selection"])
```

The result has schema `upstate.paired-design-cohort/v1` and includes `design_id`, `design_state`, `grid_id`, `baseline_scenario_id`, `scenario_id`, `selection`, `selected_member_count`, `planned_member_count`, `available_pollutants`, `pending_members`, `ready`, and `effect_direction`. The selection contains the exact original run pairs. Cross-profile baseline sensitivity is retained in the separate scalar sensitivity report.

The browser controller preserves the recovered original `prepare(selection)` and `openEdition(ensemble_id)` methods, alongside `mount`, `update`, `detach`, `fromDesign({design_id, scenario_id})`, `create({selection})`, and `open(ensemble_id)`. Existing experiment handoffs use `host.openExtension('paired-ensemble', 'prepare', selection)`. It uses local scoped event listeners, so it has no overlapping global action prefix.

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

The following numerical and browser measurements were retained by the original ASTRA-ECO12-2651 author on host `f5dd7c7e9cd6`. They describe the original numerical component and report, before the shared desk added in this edition. Shared-host receiving and native-study execution continue in the existing application operation.

`PYTHONPATH=. python checks/paired_ensemble_journey.py --out NEW_DIRECTORY` runs one complete authored numerical journey: three support modes, exact NumPy comparison, distinct missing masks, negative and zero inputs, durable pause/resume, missing-derived-file repair, completed-native-record binding, full report export, receiving, reopening and re-export. It checked 448,614 scalar outputs across three pollutants, with all 36 quantitative rasters and 51 portable files retained. These are labelled numerical fixtures, not regional model results.

A separate fresh-process 96-profile / 576-input-raster / 257×254-pixel / three-pollutant run completed computation and reporting in **11.65 seconds**, with **201,900 KiB maximum RSS**, four durable tiles and 36 quantitative raster outputs. Tile-array budget was 128 MiB. These measurements describe that original cloud host and workload; regional execution records retain their own timings.

The complete report was rendered as owned HTML in Chromium at desktop and 390-pixel phone widths: six raster previews loaded, no horizontal page overflow, and all seven member rows opened. File-URL navigation returned `ERR_BLOCKED_BY_ADMINISTRATOR`; the visual check used the authored DOM with embedded copies of its actual preview PNGs. The original full regional application receiving/run belongs to its existing source/runtime operation.

## Scientific references

The consumer preserves the original application's explicit InVEST 3.20.0 output-unit conversion and original mass-artifact contracts. Relevant primary guides:

- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html

No additional calibration, causal certainty or probabilistic interpretation is introduced by the ensemble statistics.

## Cumulative source coexistence

Stable contribution identity: **ASTRA-ECO12-2651**, originally merged in PR2651. A different active seat used the same ASTRA-ECO12 label and generic ensemble module paths. This complete edition places the six computation modules in `model/paired_ensemble/`, with independent `paired_ensemble.*` operator actions, the `paired_ensemble_products` catalogue and the shared `paired-ensemble` view. The earlier `/web/paired_ensemble.html` asset remains for compatibility. The separate single-artifact `run_workspace` contribution is a distinct source component; its generic module paths are not supplied by this package. This feature adds complete multi-pollutant/shared-support computation and its report to the maintained operator.

`operator/install_paired_ensemble.py` migrates this contribution's exact earlier server/navigation registrations, and removes earlier generic files **only when their SHA-256 equals the original PR2651 source**. Differing peer files are preserved. The scientific kernel bytes and result schema remain unchanged by this namespace move, so already-produced result projects keep their original identities and receiving compatibility.

## Selected native model scope

For an NDR-only retained grid and profile, pass `pollutants: ["nitrogen_export", "phosphorus_export"]`. For SDR-only, pass `pollutants: ["sediment_export"]`. A combined study can request all three exports. Each requested artifact is checked against the original completed run, and the retained profile must contain the parameters for every requested native model. Source records preserve the profile's actual available parameter groups, requested pollutant list and original native run identities. Complete historical two-model profiles retain the same source values and analysis identity.

The paired-design service uses `model.ensembles`, `model.ensemble_cli` and `model.ensemble_report`. This raster consumer uses `model.paired_ensemble` throughout, including its CLI and report functions. The current complete application invokes this namespaced consumer for saved native study cohorts. Use `operator/integrate_paired_ensemble.py --apply` when updating an earlier installed application, retaining its existing `ensemble-products` results. The original installer command delegates to that migration when the shared descriptor is present.


## Resume a retained analysis after moving or reopening the Workspace

The saved native analysis now retains its accepted execution controls separately
from its scientific selection. **Resume from retained native pairs** uses those
controls, including the original tile-array memory budget. Earlier analyses use
the memory and actual tile edge already recorded in `execution.json`; the
operator no longer replaces that memory budget with 256 MiB. Its result view
shows the controls that the resume action will use.

The original tile grid stays in place, so completed tiles continue to be reused.
Changing the memory budget does not create a different scientific selection.
If a resumed computation requests a smaller budget than its saved tile grid
needs, the native kernel keeps its existing explanatory error. Loading the last
submitted selection exposes the editable controls for a deliberate adjustment.

The same continuation is available without the original selection JSON or
browser task record:

```sh
python -B -m model.paired_ensemble.ensemble_cli resume \
  --workspace "$WORKSPACE" --ensemble-id "$ENSEMBLE_ID"
```

The CLI also accepts `--ensemble-id` for `preview` and `build`.
Select either `--ensemble-id` or the existing `--selection` JSON argument.
Recovery reads the retained native pair IDs and available original runs; it
does not start another InVEST calculation.

New result ZIPs retain the small execution records when present, together with
the original quantitative products and reports. Full scientific Workspace
backups continue to retain native inputs, completed runs and partial analysis
tiles. Reopening an already completed result preserves its previous execution
settings when the kernel reuses its finished products.
