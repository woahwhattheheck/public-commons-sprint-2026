# Saved native studies in scientific reports

This course publishes an existing native Ensembles design as an ordinary scientific source. It uses the original paired report and the shared Sources composer, PDF/HTML renderer, data exports and Workspace transfer. It starts no model run.

A completed land-cover pair or a completed baseline parameter contrast is sufficient. A partial design keeps its completed physical results, unfinished run counts and original errors visible. An annual observation or calibration is optional for this native-study report.

## Operator course

1. Open **Scenario sensitivity** and select the saved design.
2. Read its retained native state, selected models and physical rows. Continue that same design when more native runs are needed.
3. Choose **Prepare scientific study report**. This original operator action refreshes the scalar summary if needed, freezes its report edition, registers the typed scientific source and prepares PDF, HTML, Markdown, complete report data and a source ZIP.
4. Reopen the design after its task completes. **Scientific study source and figures** shows its original land-cover and parameter row counts, figure count, source state and downloads.
5. Choose **Compose retained study report**. The existing Sources composer appends the actual registered source to the current ordered draft in the same Workspace. Existing source order, title and contact stay with that draft. Preview its selected sections, save its edition, and use the original report exports.
6. When the design advances, its previous source is labeled as an earlier study state. Prepare the scientific study report again to retain a new source edition. The previous saved report remains selectable in Sources.
7. Back up the complete Workspace and application through the existing operator for native model continuation on another host. Restore it into a separate destination, reopen this design and its scientific source, and inspect the original report and native artifact identities.

The saved-calibration **Compose scientific report** action remains separate. It contains original annual-reference predictions, residuals, metrics and linked daily-flow context. Both typed sources can be selected together in the same ordered report.

## Headless commands

Run these from the current application root with its existing Python interpreter and actual saved Workspace:

~~~sh
"$PY" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" study-source \
  --ensemble-id "$ENSEMBLE_ID"
~~~

The returned JSON includes the exact source operation ID, source collection/document binding, original report ID, source state, original native state/progress, figure count and Workspace-relative file descriptors.

To register the complete numeric and graphical source before PDF rendering:

~~~sh
"$PY" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" study-source \
  --ensemble-id "$ENSEMBLE_ID" --source-only
~~~

To compose its actual binding with an existing ordered scientific/delivery selection:

~~~sh
"$PY" -B -m model.ensemble_consumers_cli \
  --workspace "$WORKSPACE" study-selection \
  --ensemble-id "$ENSEMBLE_ID" \
  --selection "$EXISTING_SELECTION_JSON" \
  --output "$NEW_SELECTION_JSON"
~~~

Omit --selection to begin with this source. The output file is immutable: choose a new destination for a different selection. The original primary source remains first; an already present identical source is retained once. This command adds scientific sources and preserves the existing native run selections.

Native driver API:

~~~python
from model.ensemble_study_source import prepare, latest

result = prepare(workspace, actual_saved_ensemble_id, render=True)
current = latest(workspace, actual_saved_ensemble_id, verify=True)
~~~

Both APIs consume the original saved design. Prepare builds the original scalar report through ensemble_report.build, then freezes the actual release and native run signature. A concurrent native state change during selection raises a concrete retry message; the same saved design can be reopened. Latest reads existing metadata without scanning large rasters. Its source_state is current or stale relative to the current native summary and producer source. Each source edition remains usable as its original saved result.

The shared browser also exposes:

~~~js
host.openExtension("ensembles", "studyScientificReport", {
  workspace_key: actualWorkspaceKey,
  ensemble_id: actualSavedEnsembleId
});
~~~

This requires a prepared source and forwards the server-bound original collection/document IDs to host.openScientificReport. Requests that return after the Workspace or controller changes do not navigate the new Workspace.

## Meaning of the physical results

**Land-cover contrasts** pair each alternative with a baseline using the same parameter profile and exact prepared grid. Annual change is alternative minus baseline on the intersection of valid cells. Negative change means reduced modeled export.

**Parameter contrasts** retain the original baseline land cover and compare each varied profile with the first selected reference profile. This is a different question and appears in its own table and figures.

Nitrogen and phosphorus retain kg/year. Sediment retains metric tonnes/year, normalized to the original paired report's t/year spelling. Each constituent and unit stays separate. The source adds no economic weighting or cross-pollutant physical total and does not change the original model units.

The report retains both common-support and full-valid totals. A difference between full-valid totals cannot replace the exact paired contrast when coverage differs. Percent change uses the common-valid baseline; a zero baseline leaves the percent undefined.

Figures and case ranges are separated by scenario, constituent, unit and exact common-valid mask SHA256. Equal cell counts alone do not establish common geography. A figure page contains at most sixteen selected cases. Case numbers are presentation positions; each point retains its original profile/member/scenario/run identity and JSON pointer.

The minimum and maximum describe the completed named parameter set on one exact support mask. They are descriptive case ranges. Failed, pending and other-support cases remain explicit. No bootstrap, fit, uncertainty estimator or native solve is performed by this source adapter.

## Figures and original coordinates

For each retained geographic support group, the source produces two panels:

- original baseline/reference and alternative/varied annual masses on the same common-valid cells;
- original paired annual change, with an explicit zero-change line.

Land-cover and baseline-parameter figures remain distinct. The first profile's reference role is preserved in the parameter figure source records. The complete scientific figure specification and coordinate CSV carry every original plotted quantity and source pointer. The maintained shared renderer draws the same specification in PDF; independent monochrome SVGs travel with it.

If an older retained report has zero common valid cells or lacks an exact common-support hash, its row remains in the original numeric report and is explicitly listed as omitted from the grouped figure. No geographic mask or zero-valued physical result is inferred.

The source copies the original profile references, scientific status, assigned parameters and scenario reasons. An explicitly simulated teaching case retains its source labels and assumptions. Native model completion does not independently establish local calibration.

## Report package and complete model project

The scientific source includes:

- the complete original scalar HTML report, pairs.csv, sensitivity.csv, robustness.csv, report.json and methods;
- exact saved design and native run snapshots, native comparison records, prepared grid metadata and every selected profile/scenario record;
- original biophysical CSV bodies and all their retained companions;
- complete source collection/entry identities, original scenario-mask source bindings, alignment statistics and original/aligned raster descriptors;
- scientific report recipe, all original figure coordinates, full vector specification and standalone SVGs.

Native-input-inventory.json marks which original source bytes are included. The complete numeric and graphical report can be reopened from its scientific source archive. Original model DEM, land cover, climate, R/K, scenario geometry, physical output rasters and native logs stay under their exact paths and hashes in the full Workspace archive. Use that existing complete-project transfer to inspect or rerun the hydrologic model.

All persistent source and export file paths are Workspace-relative. Restored projects retain their original project/design/source IDs; the report reader binds them to the restored root. The adapter does not depend on the old machine's absolute directory.

## Retained paths and recovery

~~~text
ensemble-study-sources/<source-operation-id>/operation.json
ensemble-study-sources/<source-operation-id>/source/sources.json
ensemble-study-sources/<source-operation-id>/source/scientific-report.json
ensemble-study-sources/<source-operation-id>/source/numeric/
ensemble-study-sources/<source-operation-id>/source/original/
ensemble-study-sources/<source-operation-id>/source/coefficient-sources/
ensemble-study-sources/<source-operation-id>/source/study-figure-spec.json
ensemble-study-sources/<source-operation-id>/source/study-figure-coordinates.csv
ensemble-study-sources/<source-operation-id>/reports/<renderer-signature>/
ensemble_results/<ensemble-id>/latest-scientific-study.json
~~~

The source operation identity includes the original report release, summary/run signatures and actual producer/figure-helper code hashes. Report rendering uses the actual formatter, collector and vector renderer hashes. Source preparation and report rendering have separate retained progress: a rendering exception keeps the registered source ready for the existing composer and for a later retry.

Native study action: ensemble.study-source.
Read route: GET /api/ensembles/study-source with the actual workspace and ensemble_id.
Descriptor: the existing ensembles component and its original queue.
Typed source: upstate.observed-report/v1, metadata source_basis saved_native_ensemble.
Composer dependency: existing scientific-report-editions.

## Same demonstration and regional operations

The A73C simulated headwaters case remains one generator, one source edition and one native runtime operation. Its parameter-study owner retains the routing/Lmax design and joint decision calculations; its delivery owner retains the full native maps and project archive. This course accepts that design's actual saved ID after its original contrasts complete, then supplies a typed scientific source to the existing report composer.

Actual Upper Savannah studies use their own regional input grid, coefficient profiles, scenarios and run IDs. Gura remains the original Kenya model commissioning case. A scientific source preserves whichever original design it is given and its full source provenance; it transfers no observations, calibration claims or physical quantities between those studies.
