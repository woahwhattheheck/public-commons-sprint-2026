# Multivariate matched-control designs

TokenJunkieLabs scientific engineering for the original Upper Savannah Workspace.
Current workflow: WO-19, ECO-MULTIVARIATE-CONTROLS-20261013. Original scientific method choices and interpretation remain with the prime.

## What the complete workflow does

Select an original baseline native run and an exact retained restoration footprint. Declare source-unit covariate boundaries and, optionally, an acceptance threshold for the prepared runoff proxy. The original exact one-dimensional Monge matcher selects distinct off-treatment control cells within each admitted original-class/covariate stratum. Save the full assessment, inspect remaining balance and missing support, and adopt an accepted design through the original source, scenario, native run and experiment writers.

The original baseline/restoration selections remain immutable. A different design gets its own saved ID, source collection, scenario, run and original experiment. Executing that original experiment reuses completed original cases; the control is the new native case. This module never replaces NDR/SDR, the original experiment queue or an existing control.

### Exact scientific scope

* The treatment population is every actual final baseline-to-restoration changed cell in the selected compiled footprint. A completed restoration must agree, cell for cell and support for support, with its retained native land-cover stage. A current compiler preview cannot silently replace an executed treatment.
* A successful design retains the entire original treatment count and from/to transition roster. Every treatment cell must lie in the original reporting mask and have every selected admission covariate. Missing support produces an unaccepted assessment; it does not shrink the design.
* Candidates are unchanged original cells inside the same reporting mask, of an original treatment class, outside the actual treatment and outside the optional explicit exclusion mask. Unknown exclusion support is excluded. Each control cell is used once.
* This first edition admits one destination code per original class. A treatment that changes one original class to competing destination classes is rejected explicitly before adoption; no independent matcher may reuse their shared candidate pool.
* Native DEM, R_FACTOR, K_FACTOR and PRECIPITATION values are the already-aligned and converted prepared grid. Their original source entries, classifications, source SHA, units, conversion and resampling history remain in input-binding.json. Conversion is not applied a second time.
* Optional SLOPE and CONNECTIVITY are explicitly chosen original single-band rasters on the exact native shape, CRS and affine transform. The analyst supplies real units and a physical definition. An unapplied conversion is rejected; select its original prepared output instead. DEM means elevation, not slope. A connectivity label alone never defines its physical quantity.
* Stratum boundaries are exact analyst-authored values. Bins are lower-inclusive/upper-exclusive, with unbounded outer bins; an exact edge enters the higher bin. An empty boundary list is one unconstrained bin and is labeled that way.
* The unchanged original matcher minimizes total absolute **prepared runoff-proxy** difference within each stratum. Metadata uses the actual source units. No per-stratum runoff normalization is introduced.
* The optional caliper is a post-match acceptance threshold for every selected pair. A failing selected unconstrained optimum gives **threshold_not_met**, which does not prove that no full caliper-feasible assignment exists. No target is removed and no threshold is relaxed.
* Exact class/area equality and stratification do not imply equal continuous covariates, equal slope/routing/connectivity, or a causal treatment effect. Every unstratified dimension remains named. The chosen land-cover transition changes the original corresponding coefficients and retention assumptions together.
* Separate record IDs or titles are not independent spatial placements. Compare the saved mask SHA values and original chosen cell IDs. New analyst-defined sources or boundaries can produce another placement; deterministic renaming supplies no extra simulation evidence.
* The matching preparation computes no pollutant reduction. Annual native N/P kg/year and sediment tonnes/year remain the original model results, with original common-support comparisons. They are modeled delivery to streams, not intake concentrations.

## Saved states

| State | Meaning | Available continuation |
| --- | --- | --- |
| prepared | Every original treatment cell matched, all declared pair thresholds passed | Inspect, download, adopt original scenario/experiment, selected Study transfer |
| infeasible | Exact current support has missing/outside treatment cells or an exact stratum has fewer admissible candidates than targets | Inspect the complete assessment and adjust an explicitly authored new selection |
| threshold_not_met | The selected unconstrained optimum exceeds the declared caliper | Inspect every pair and make an explicit new design choice; no mathematical impossibility claim |
| Interrupted computation | No immutable design.json published yet; progress remains in the owned design directory | Retry the exact original request or author a new resource/selection edition |

Only prepared permits adoption. Failed scientific assessments are successful retained products: their original inputs, unmatched roster, statistics, complete CSV/JSON and HTML remain downloadable and are imported as ordinary OBSERVED_CONTEXT report sources.

## Original command line

Run from the actual application directory with its native GIS interpreter:

```sh
PYTHON -B -m model.multivariate_control_cli catalog --workspace ORIGINAL_WORKSPACE
PYTHON -B -m model.multivariate_control_cli preview --workspace ORIGINAL_WORKSPACE --selection AUTHORED_SELECTION.json
PYTHON -B -m model.multivariate_control_cli prepare --workspace ORIGINAL_WORKSPACE --selection AUTHORED_SELECTION.json
PYTHON -B -m model.multivariate_control_cli inspect --workspace ORIGINAL_WORKSPACE --id RETURNED_DESIGN_ID
PYTHON -B -m model.multivariate_control_cli adopt --workspace ORIGINAL_WORKSPACE --id ACCEPTED_DESIGN_ID
PYTHON -B -m model.multivariate_control_cli execute --workspace ORIGINAL_WORKSPACE --id ADOPTED_DESIGN_ID
```

Execute is explicit; prepare and adopt do not execute native models. The queue uses the same functions through control.prepare, control.adopt and control.execute. Returned adoption identifies the exact original experiment, scenario, run, footprint and source collection. Use those returned IDs in the original Experiment/Programme controls; do not reconstruct native IDs or choose a default completed case.

Selection shape:

```json
{
  "schema": "upstate.multivariate-control-selection/v1",
  "title": "Author's named control design",
  "reason": "Author's scientific purpose and design rationale",
  "baseline_run_id": "ACTUAL_ORIGINAL_64_HEX_ID",
  "restoration_footprint_id": "ACTUAL_RETAINED_64_HEX_ID",
  "strata": [
    {"role": "DEM", "boundaries": [], "units": "m"}
  ],
  "precipitation_caliper": null,
  "exclusion_source": null,
  "max_working_bytes": 1073741824
}
```

This is a shape example, not an authored scientific design: the analyst must select original IDs, justified boundaries and a working-memory budget appropriate to the actual host. The empty boundaries explicitly impose no elevation constraint. No automatic quantiles, default thresholds, fabricated observations or silent optimizer substitutions are supplied.

For an optional source stratum use:

```json
{
  "role": "CONNECTIVITY",
  "boundaries": [],
  "units": "EXACT_ORIGINAL_SOURCE_UNITS",
  "definition": "The source's actual physical connectivity definition",
  "source": {
    "source_collection_id": "ACTUAL_ORIGINAL_64_HEX_ID",
    "source_id": "ACTUAL_SOURCE_ID",
    "source_sha256": "ACTUAL_ORIGINAL_64_HEX_SHA"
  }
}
```

The exclusion_source uses the same three source fields and a binary aligned band. Original source value1 excludes; zero admits; NoData does not admit a candidate. The original reporting mask still applies.

## Files and readable interpretation

The directory multivariate-controls/DESIGN_ID retains normalized selection, exact input binding and original records, original producer implementation, complete matching result, immutable assessment and source manifest. The normal report source contains all companions.

* report.html: directly usable offline complete assessment, with the exact declared boundaries/units/definitions, all strata and balance rows.
* assessment.json: complete source-bound machine-readable design.
* matched-pairs.csv: every proposed pair, exact original row-major cell identities, coordinates, transition and each available physical value/residual.
* unmatched-targets.csv: original targets outside reporting support, missing selected covariates, or in insufficient candidate strata.
* strata.csv: full original-class/covariate roster, target/candidate/pair counts and reasons.
* balance.csv: original target, candidate, selected control and paired residual moments, population SD, extrema and absolute residuals.
* Accepted control-FROM-to-TO.tif: exact original-grid binary scenario masks, with body SHA and counts.
* selection.json/input-binding.json/originals/implementation: actual choices and scientific source/code provenance.

Overall target/candidate moments use each field's finite pre-admission population. Per-stratum moments use fully admitted targets/candidates. Selected controls and paired residuals keep their actual finite count. In a rejected design these populations can differ; a mean must not be read as a matched-support effect.

The report is also an original OBSERVED_CONTEXT choice for the maintained Sources scientific composer. Append that choice to an ordered scientific edition without inventing a saved report ID. Native results, when later completed, are available through the original experiment report and common-support tools.

## Editable selected Study and complete Workspace

The typed root is multivariate-controls. Export through the original Study selector with an exact selected design ID. It carries the full original design assessment, source CAS, native grid/profile, original baseline/restoration runs, compiled footprint completion tree and, when adopted, the original control scenario/run/footprint and experiment plan/progress. It does not execute or reconstruct a design while receiving.

Selecting an original scientific report containing this exact source also follows the same typed design. Same-project sources must match complete native files; foreign original sources remain self-contained scientific documents and do not borrow local IDs. Original archives without this new root/source keep their historical receiving semantics.

Original full Workspace export remains supported. On the recipient, inspect the saved design ID, open all contained report/data/mask attachments, and reopen the same original experiment. Later legitimate native progress is retained by the original experiment/run machinery. Old completed controls and archived workspaces are never overwritten.

## Native and browser receiving

The existing geographic/native receiving owner consumes this complete source family and its optional matched-control chapter. Pass an explicitly authored selection; use the same restored original Workspace and retained native inputs. The native chapter returns actual design/adoption/experiment IDs, source-member identities, original selected-study export/restore result and the first real error if one occurs. Preserve running native handles and completed regional/teaching/38F0 cases; no duplicate original model run or new controller.

The actual outgoing operator must be used at desktop/screenshare and390px: choose original baseline/restoration, inspect source units, edit exact boundaries and optional source dimensions, preview, prepare, inspect every row/download, reopen a saved assessment, adopt only an accepted complete design, navigate its original experiment, then export/restore and reopen. Exercise invalid/missing choices and a scientifically unaccepted assessment as appropriate. The producer must personally open and view the resulting report, CSV, JSON, mask, archive contents and working recipient application. Captured-but-unviewed screenshots do not qualify. Repair concrete usability or receiving failures in this same course.

Source review and V8 controller checks are not native execution or rendered acceptance. This source-engineering seat has not claimed Python/GDAL or visual acceptance. The actual original equipped receiver owns that complete course.

## Current owner direction and attribution

CURRENT_OWNER_DIRECTION.md v2026-10-13.4 and the full rendered-product standing rule accompany this family in source/MULTIVARIATE_CONTROL_OWNER_DIRECTION.md. The post-call44 work orders continue after the historical14UTC cutoff. Bryce's direct meeting-over instruction released the temporary local-browser restriction; retain existing browser owners and tabs. Actual source acquisition, original model ownership, controls and completed outputs remain authoritative.

TokenJunkieLabs attribution remains visible. Do not remove it at a prospect's request. Scientific method/interpretation and client relationship remain with the prime. This feature authorizes no external prospect message, payment, source purchase, contract signature, access-control change, private GitHub repository, hosted Actions or new fleet session.
