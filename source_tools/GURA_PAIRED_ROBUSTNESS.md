# Gura paired land-cover robustness

This continuation answers whether the modeled benefits and ordering of the **actual selected original Gura land-cover alternatives** persist across native parameter settings, stream-initiation areas and explicitly chosen spatial grids. It consumes the original receiving record and class-contrast plan. The original baseline and selected 5→8 / 5→19 alternatives remain the landscape controls.

## Install and run

Copy these three additive files into the current cumulative Upper Savannah application, preserving their paths:

- model/paired_robustness.py
- source_tools/receive_gura_robustness.py
- source_tools/GURA_PAIRED_ROBUSTNESS.md

Use the same GIS interpreter, actual original Workspace and completed first-case selection as GURA-NATIVE-01. A current application must contain the original parameter_studies, experiments, scenario_decisions, gura_comparison and receive_gura_studies modules. This addition changes none of those modules.

Prepare the original-grid continuation and retain its exact selection:

```bash
"$GIS_PYTHON" -B "$APP/source_tools/receive_gura_robustness.py" \
  --application "$APP" --workspace "$WORKSPACE" \
  --receiving "$RECEIVING" --plan "$CLASS_PLAN"
```

Execute the same saved selection:

```bash
"$GIS_PYTHON" -B "$APP/source_tools/receive_gura_robustness.py" \
  --application "$APP" --workspace "$WORKSPACE" \
  --receiving "$RECEIVING" --plan "$CLASS_PLAN" \
  --execute --output "$RUN/paired-robustness-original-grid"
```

Choose the actual receiving.json and gura-comparison-plan.json emitted by the maintained first-case workflow. Preserve an existing Workspace path with --workspace; restored receiving records may contain an old location. The source collection, native grid, coefficient profile, baseline scenario and plan must still match the retained original record.

For an explicit spatial comparison, retain the original grid and add 30 m and 60 m alternatives:

```bash
"$GIS_PYTHON" -B "$APP/source_tools/receive_gura_robustness.py" \
  --application "$APP" --workspace "$WORKSPACE" \
  --receiving "$RECEIVING" --plan "$CLASS_PLAN" \
  --resolution-m 30 --resolution-m 60 \
  --execute --output "$RUN/paired-robustness-resolution"
```

These are author-selected numerical resolutions. The original Gura release grid is recovered from the actual receiving record; a restored older case keeps its own original resolution. The addition never substitutes an assumed 15 m or 30 m reference.

Optional --buffer-m 1000 adds a separately labeled 1,000 m model-domain buffer at the original resolution. It reuses the actual original input rasters; coverage beyond those inputs is reflected in the native grids and reports. The reporting polygon stays the original selected study area. Repeated resolution and buffer flags create separate variants, rather than an undisclosed Cartesian product.

Use --completed-only to synchronize and analyze completed native cases without starting native model runs. It may prepare missing source grids/profiles and checkpoint their pending reference. It never invents completed cases. Resume unfinished native cases with the identical --execute command. A failed or interrupted family retains its original engine checkpoint, requested profiles and actual error; restarting uses those exact runs.

## Scientific design

The default parameter design comes directly from the maintained receive_gura_studies.axes_for API. For the combined NDR/SDR scope it is the original factorial design:

| Choice | Values | Units |
|---|---|---|
| NDR connectivity shape k | 1, 2 | Dimensionless |
| SDR connectivity shape k | 1, 2 | Dimensionless |
| SDR connectivity midpoint ic0 | 0.5, 2 | Dimensionless |
| Coupled NDR/SDR routing | MFD, D8 | Native categorical algorithms |

The resulting 16 profiles are provided by the original parameter_studies.prepare API, including semantic reuse of profiles already prepared by the existing C8FF suite. The retained original reference profile is included even if a later source edition's reference lies outside the enumerated factorial choices. NDR-only and SDR-only cases use the corresponding maintained scope instead of unselected model parameters.

Two additional controlled profiles vary physical stream-initiation area by factors 0.5 and 2. They change the actual threshold of each active model together while retaining original connectivity parameters. They are separate controlled choices, not multiplied through every factorial case. Use repeated --threshold-factor values to declare a different finite sensitivity set; --threshold-factor 1 selects no additional threshold cases. The exact list is retained. --original-parameters-only omits the factorial design while preserving the baseline landscapes and explicitly selected threshold factors.

For the source combined 16-profile case plus two distinct threshold profiles and two alternatives, the requested roster is 18 profiles × 3 landscapes = 54 native run selections per spatial grid, before exact source/stage reuse. The actual saved count comes from the existing experiment engine; duplicates and already completed runs remain visible.

### Resolution and threshold units

Native threshold_flow_accumulation is a number of upstream pixels. A fixed pixel count would change the physical stream-initiation area when cell size changes. Each new grid therefore uses:

```text
selected initiation area (ha)
    = original threshold (pixels) × original pixel area (ha) × selected factor

new threshold (pixels)
    = selected initiation area (ha) / actual new pixel area (ha)
```

The maintained grid API treats resolution as an assertion about its reference raster. For a different resolution, this continuation first derives an explicit categorical reference through the maintained rasters.align_source API with nearest-neighbor resampling. It retains the original projected metre CRS and upper-left anchor, uses the requested square cell size, and covers the original reference extent. The new reference and its exact original raster/sidecars, alignment record and derivation are imported as an ordinary source collection. Other input rasters and domain/reporting vectors remain exact original bodies. Workspace.prepare_grid then constructs the selected native grid from that declared reference. No shared grid invariant is weakened.

Source editions and completed reference derivations are reopened by their original hashes. The derived TIFF declares its own int32 encoding and NoData; the original declaration is preserved separately in provenance. Nearest-neighbor cell selection can change represented class areas and scenario footprints; those are part of the declared spatial sensitivity.

Pixel area comes from the actual prepared grid's affine geometry, rather than a requested resolution assumption. Both original and new pixel areas, thresholds, selected physical areas and factors are retained in the derived profile. No rounding silently changes this declared area. Native D8 evaluates discrete upstream counts; the retained numerical threshold remains explicit.

Critical lengths remain in metres. NDR/SDR connectivity parameters stay dimensionless. The original coefficient table, original load units and actual model period remain unchanged. Every derived threshold profile starts as working scientific status; the immutable source profile retains its original history.

### Same-profile treatment effects and common support

The maintained model.experiments engine executes every selected profile with:

1. The original baseline landscape.
2. Each explicit land-cover alternative from the source plan.

Every treatment effect pairs an alternative with the baseline under the **same profile and grid**. Source-run lineage and native stage reuse remain with the original experiment engine.

For a grid with completed matched cohorts, model.scenario_decisions builds one report containing **all runs in every included profile/landscape cohort**. Its native raster aggregator determines common finite valid cells across that whole set, separately for each pollutant and original source zone. The paired analysis then subtracts the two actual common masses for each same-profile treatment pair.

```text
avoided export = common-support baseline mass − common-support alternative mass
```

Positive values mean lower modeled export; negative values mean higher export. Relative percentages are undefined when baseline mass is zero. No-common-support cases retain null effects, not zero benefit. Nitrogen and phosphorus use kg/year; sediment uses metric tonnes/year. The original native report converts per-hectare exports once using actual pixel area. This addition reads those already aggregated masses and never applies area a second time.

This shared support makes a finite minimum/maximum benefit range and alternative ranking across the included profiles comparable on that grid. The report retains expected profiles, completed profiles, missing cohorts, failed cases, common valid cells, common valid hectares, valid fraction and unresolved coverage. Adding completed cohorts can reduce common support; the scenario decision report identity and paired result member both change, preserving the prior retained member.

Each profile contributes one ranking observation. “Strict best” means the largest modeled avoided export among the selected alternatives for that pollutant and zone; numerical ties use relative and absolute tolerance 1e-12. These counts have no probability weights. A larger count is sensitivity evidence over this finite design, not a likelihood or calibrated confidence interval.

### Spatial interpretation

Each grid has a separate report, support identity and finite profile envelope. Compare the direction of paired effects, ordering of alternatives and coverage between grids. Do not pool absolute mass ranges from different supports into one uncertainty interval. Reporting-area and whole model-domain zones remain separate; overlapping zones must not be summed.

The profile's runoff normalization choice is retained. If NDR uses its automatic domain mean, changing domain or resolution can alter that mean; the result is total sensitivity to that declared grid/domain choice. The report explicitly records this condition. An explicit original runoff_proxy_av remains an actual saved profile value in its original units.

The original class conversions are source-bound counterfactuals. Their modeled outcomes can guide scientific review of a proposed alternative, but do not establish field implementation feasibility or effectiveness. Observed calibration and physical/economic interpretation require the actual observation/cost workflows.

## Saved results and reopen

Workspace outputs are under:

```text
paired-robustness/<selection-id>/
  selection.json
  state.json
  original-receiving.json
  original-class-plan.json
  software/<source-identity>.json
  paired/<grid-and-decision-identity>.json
  generations/<report-generation>/report.json
  generations/<report-generation>/paired-benefits.csv
  generations/<report-generation>/index.html
  index.html  # convenience redirect to the current complete generation
```

The immutable selection includes the original receiving and plan hashes, Workspace/source collection IDs, original programme ID, scenario IDs, axes, factors, spatial choices and zones. Each execution records exact current source-file hashes, host, interpreter and process identity. Parameter studies, experiments, runs, decision reports and grid/profile objects remain in their original Workspace directories for normal backup/restore.

Each publication writes an immutable generation completely before atomically replacing the state.json file descriptors. Interrupted publication preserves the prior complete generation and can resume through its original state. The top-level HTML redirect is a convenience copy and is never the recovery source. An actual native or storage failure stays the primary reported error even if its failure receipt cannot be written.

Open index.html for a clean gray report, the shared-area benefit envelope and actual pending-case details. paired-benefits.csv carries every same-profile comparison with native run IDs and units; report.json preserves all family selection and interpretation data. --output copies the source-bound report files with export.json inventory. Its destination must lie outside the Workspace and application source trees and their ancestors. The original Workspace portable backup carries the native models and all original sources.

Exit 0 means prepared or complete, exit 2 means a partial completed-result synchronization, and exit 1 reports an actual execution or validation error. Full first-case admission remains the existing GURA-NATIVE-01 operation.

## Native method references and owner composition

- Official InVEST 3.20 NDR guide: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- Official InVEST 3.20 SDR guide: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html
- Original parameter-design owner: maintained source_tools/receive_gura_studies.py and model/parameter_studies.py, including the current PR3263 GIS-export successor.
- Current experiment source-run adoption remains in model/experiments.py.
- Native mass/valid-support aggregation remains in model/scenario_decisions.py.
- Complementary lane and owner ACK: main Eco1791869505.619859 and edited1791869293.563119.

The module creates executable native selections and consumes genuine completed outputs. Its initial publication is source delivery; the actual scientific result is produced by the accepting original native operation.

## End-to-end units check against the exact upstream edition

The source audit retrieved the two original tagged modules and matched the same immutable Git blob identities required by the application's native runtime:

| Upstream source | Exact Git blob | Relevant calculation |
|---|---|---|
| [NDR 3.20.0](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py) | f518b2867d4a327675fcb1c9b4ba56f29b12188d | Raster output spec is kg/ha; original load fields are annual kg/ha/year. _calculate_load maps source rates without multiplying pixel area. Original watershed aggregation multiplies the raster sum by hectares per pixel. |
| [SDR 3.20.0](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py) | 0cac27add172011df367ff8026427dbbdbcda5b2 | _calculate_rkls produces tonnes/(ha·year); sed_export is USLE × delivery ratio. Original watershed reporting multiplies the rate sum by hectares per pixel. |

The existing application has two consistent reporting routes:

1. native.execute_run selects n_total_export, p_surface_export and sed_export from the exact original registry. rasters.rate_to_mass multiplies each native rate by the actual projected affine pixel area once, writes annual mass per pixel, and retains native output identity and conversion tags. experiments and parameter_studies sum those stored mass pixels and label aggregate totals with /pixel removed.
2. scenario_decisions opens the original native stage rates directly, derives native affine pixel area, and multiplies rate sums once. The paired robustness module reads that report's common_mass totals and subtracts matching profile/scenario values; it performs no further area conversion.

Both routes preserve masked/nonfinite values and actual pixel-centre support. Structural stream NoData is reported separately from unresolved support; it is not turned into a zero mass observation. The common-support report excludes cells unavailable in any included cohort and retains their counts. Equal coverage fractions alone are never treated as proof of equal support.

NDR and SDR pass threshold_flow_accumulation to their original stream-extraction algorithms as upstream-pixel thresholds. The explicit hectare-to-pixel adjustment in this continuation preserves the declared physical threshold across grids; stream topology can still change because DEM alignment and native routing change with resolution.

Reviewed current application source identities included native.py 1d982f3b9bf0d5765d85bf0fa097ddfb118ab101, rasters.py 800ffb4fedbd53839683704bf6e8fbd8202774c6, scenario_decisions.py adc1c0152396cef7accbc6496b7c6632c69d5b07, parameter_studies.py cc3826e0a33c022d834560e643c906743d4322b2, and experiments.py 8818df86b579f9abc66d58e98336d6347cefca73. Runtime software records retain the actual installed successors.

The source audit identified and repaired the optional resolution API mismatch described above. The existing rate-to-mass and common-support calculations agreed with the exact upstream units.
