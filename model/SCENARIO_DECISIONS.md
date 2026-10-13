# Watershed and scenario decision reports

The producer reads completed native InVEST 3.20.0 runs from the maintained scientific Workspace and creates a complete, reopenable watershed comparison. It uses the original native output registries and retained polygon sources. It adds one report to the existing project; it does not launch another model or change any run.

## Run the producer

Place model/scenario_decisions.py and operator/web/scenario_decisions.html in the matching application directories. Use the existing equipped Python environment.

    python -B -m model.scenario_decisions \
      --workspace /absolute/upper-savannah-study \
      --selection /absolute/decision-selection.json

The selection document has schema upstate.scenario-decision-selection/v1, a title, one or more run_ids in reference-then-alternative order, optional zones, and optional pollutants selected from nitrogen, phosphorus and sediment. Select real, completed run IDs from the decision catalog. Every run must use the same retained grid. If pollutants are omitted, the report uses the completed native outputs shared by every selected run. An NDR-only cohort produces nitrogen and phosphorus; an SDR-only cohort produces sediment. The report and tradeoff table identify their actual objectives.

A zone source selects the existing source_collection_id and source_id, the original id_field, optional layer and exact where filter, an optional label_field, and optional complete string feature_ids. The source group also needs its own id and title. scope is whole by default or reporting_intersection when the question explicitly concerns only the reporting-basin part of a source polygon.

The actual four utility focus HUC12 identifiers in the retained source methods are:

- 030601010703
- 030601010704
- 030601020507
- 030601020502

Use those exact strings against the original HUC identity field in the chosen source edition. Do not substitute numeric codes that lose leading zeroes.

The reporting_area and model_domain are included automatically from the grid's retained polygon files. Additional whole-source watersheds remain independent even where they overlap these two zones or each other. The retained model_domain file includes the original declared preparation buffer; the native source selection in the grid remains available alongside it.


### Select and reopen runs without hand-authoring run IDs

List the original completed cohorts, saved reports and retained polygon sources:

    python -B -m model.scenario_decisions --workspace /absolute/study --catalog

With an actual baseline ID returned by that catalog, include all completed land-cover alternatives under the same grid, profile and available model outputs:

    python -B -m model.scenario_decisions --workspace /absolute/study \
      --baseline-run ACTUAL_BASELINE_ID --title "Upper Savannah alternatives"

Use repeated --alternative-run ACTUAL_RUN_ID to select particular alternatives, repeated --pollutant nitrogen / --pollutant phosphorus / --pollutant sediment to name available objectives, and --zones ACTUAL_ZONE_SELECTIONS.json for retained watershed choices. Omit these switches to use the matched native cohort and the two retained reporting/model zones. Parameter-change alternatives are allowed when explicitly selected and retain their separate comparison kind.

A single completed reference run can produce its original annual watershed totals immediately. Use an explicit empty alternative_run_ids list through select_cohort, select no alternatives in the operator, or use --baseline-run ACTUAL_BASELINE_ID --reference-only on the CLI. The report retains the same native provenance and coverage contract. Its viewer emphasizes native totals; scenario change and tradeoff controls appear once alternatives are included. The automatic cohort also permits a single reference when no matched alternative has completed.

Reporting-zone labels derive from the actual retained project title. Original reporting_area and model_domain role IDs stay stable across Upper Savannah and other native receiving cases.

Reopen a saved report and verify its retained products:

    python -B -m model.scenario_decisions --workspace /absolute/study --report-id ACTUAL_REPORT_ID

The underlying functions are catalog(workspace), select_cohort(workspace, baseline_run_id, alternative_run_ids=None, title=None, pollutants=None, zones=None), and inspect(workspace, report_id, include_report=True). Catalog reads metadata without repeatedly rehashing large rasters; build verifies every selected original file.

## Products

The command prints the completed decision.json and writes its products under:

    WORKSPACE/scenario-decisions/REPORT_ID/

| Product | Use |
| --- | --- |
| report.json | Complete quantitative data, source selections, coverage, scenario choices and run identities |
| comparisons.csv | One row per zone, pollutant and alternative, using all-scenario common support; header-only for a reference totals report |
| annual-totals.csv | One row per zone, pollutant and selected native run, with original annual totals, common-footprint totals and coverage |
| zones.geojson | The actual selected zone polygons in WGS84 with scope and area metadata |
| index.html | Complete offline report with embedded data, watershed and pollutant selectors, support choice, sort, CSV/JSON downloads and print output |
| decision.json | Original selection and exact product paths, byte counts and SHA-256 hashes |
| completed-zones/ | Retained completed pollutant/zone outcomes used by ordinary resume |

Interrupted generation restarts with the same command. Completed zone outcomes are reused under the same selection, run-source and implementation identity. A finished report is reopened without rerunning models. A new selection or changed producer/viewer gets a different report ID. The existing whole-Workspace backup includes these reports and the application source.

## Quantities and coverage

Native NDR n_total_export and p_surface_export are kg/ha/year. Native SDR sed_export is metric tonnes/ha/year. The producer multiplies valid raster rates by the determinant of the projected affine transform divided by 10,000 exactly once. It uses the native rates, not the already-converted reporting-mask mass rasters.

Every zone and pollutant contains:

- Per-run totals on that run's full valid footprint.
- A single common footprint shared by every selected run.
- Baseline and alternative masses on that common footprint.
- Alternative-minus-baseline change and baseline-minus-alternative avoided export.
- Separate baseline/alternative paired support for two-run questions, including baseline-only and alternative-only areas.
- Valid area, full polygon area, native-extent coverage, shared structural stream omissions, and other missing support.

NoData remains missing. An all-NoData selection yields null mass. A zero baseline produces an undefined percentage with either unchanged_zero or new_export_from_zero. Structural stream omissions require the original export NoData and original same-stage stream classification. SDR uses stream_and_drainage when the retained stage arguments selected a drainage input. Hydrologically disconnected terrain remains separately visible in missing-support quantities; it is not assigned a zero pollutant contribution.

The default comparison is on all-run common support, enabling like-for-like ordering across alternatives. The offline report also exposes pairwise support. Adding a scenario can change the common footprint, so the report retains its full run cohort and own immutable ID.

Annual exports describe modeled hillslope/nonpoint contributions reaching streams. They are not measured reservoir-intake loads or concentrations. Reporting and hydrologic-domain totals are different quantities. Overlapping utilities can legitimately share upstream benefits, and their rows must not be summed into a regional physical mass total.

## Composition with the operator and other modules

The maintained operator discovers this feature from operator/extensions/scenario_reports.json. Its backend uses the existing serial task queue, JSON routes, workspace state, verified download tickets and restore verification. The browser factory attachScenarioReports({getState, api, endpoint, toast}) uses the shared extension host lifecycle and adds a Watershed reports view.

Install the current joined extension host and source, then reconcile the report preview against that installed host:

    python -B install_extensions.py \
      --application /absolute/application --source-root /absolute/received-project-root
    python -B operator/scenario_decision_install.py --application /absolute/application

The current shared host supplies the action, JSON reads, metadata, item view, task completion and typed retained-file responses. The descriptor binds its file preview to the module-level preview(operator, workspace_key, report_id, fault) function. The host performs the existing file-cookie authorization and sends the returned verified ticket with its original content policy. The second command removes exact older authored preview joins when the typed host is installed, or installs the compatible one-route preview for an older host. It reads current source, preserves other adapters, compiles the resulting Python syntax and writes once under an unchanged-source check. Repeat installation is idempotent. The shared host's [extension contract](../operator/EXTENSIONS.md) and [installer](../install_extensions.py) describe the current registry and composition entrypoint.

The operator controls list original completed reference runs and alternatives on the same grid. Same-profile land-cover alternatives with the reference outputs are selected by default. Parameter-change alternatives are available through an explicit switch and keep their comparison labels. Pollutant choices reflect the completed native outputs shared by the selected cohort.

The retained reporting area and hydrologic model domain are included in every report. Additional zone selection opens the original vector layer metadata, then allows the original identity and name fields, all features, exact feature IDs, or the four utility focus HUC12 identifiers. Whole-watershed and reporting-area-intersection scopes remain distinct. The original geometry schema must describe polygon features.

A report build enters the existing task queue. The same submitted draft retains its operation ID for request retries; browser drafts survive navigation and reconnects. Completed tasks and saved reports reopen the retained product without rerunning the model. The preview provides watershed and pollutant navigation, common/pairwise support, portable CSV/JSON/HTML products, and printing. The ECSA Scenario decisions view consumes the same saved common-support report.

| Route or action | Result |
| --- | --- |
| GET /api/scenario-reports/catalog?workspace=KEY | Real completed cohorts, original run/profile/scenario identities, retained zone sources and saved reports |
| GET /api/scenario-reports/selection?workspace=KEY&baseline_run_id=RUN | Selection of the baseline and matched completed land-cover alternatives |
| GET /api/scenario-reports/report?workspace=KEY&report_id=REPORT | Report data, product metadata, verified download tickets and preview URL |
| Queued action scenario.decision.build | Build the payload selection through the existing operator task; returns complete saved product metadata |
| GET /api/file/scenario-report/KEY/REPORT | Interactive retained HTML report with scripts confined to an opaque browser sandbox |

The selection route accepts alternative_run_ids and pollutants as comma-separated values and an optional title. Rich polygon selections remain in the queued JSON payload. The build action accepts either the selection directly or {"selection": selection}. Complete task views expose _downloads and _scenario_report_url. HTML preview uses the original verified report file; ordinary downloads remain available for reopening offline. The preview allows its own display, local exports and print dialog, with network connections disabled.

Import build(workspace, selection, progress=None) from model.scenario_decisions for programme and ensemble integration. progress receives completed pollutant/zone progress records; the result is decision.json. Feed its report.json to the ECSA decision panel and ES26 diagnostics. The operator adapter also exposes the full packet through its report read.

Saved reports live in WORKSPACE/scenario-decisions/*/decision.json. The complete Workspace archive already walks these directories and includes model/ and operator/ source, carrying saved outputs and the executable producer.

### Saved controls and changing projects

The operator restores saved form selections using the complete matching control collection. A polygon choice is retained by its original source collection and source-entry identities, so importing another dataset or refreshing the catalog cannot change the selected source. Existing saved drafts continue to resolve those original identities when reopened. If the saved reference is no longer available, the reference picker asks for a completed run instead of substituting a different run. Unavailable pollutant controls remain unchecked; a changed cohort asks the operator to review its available native outputs.

Source-schema requests and draft restoration belong to the project and form that started them. Closing the controls, opening another report form, or changing projects invalidates an older pending restoration. The same ownership checks apply to failed source requests and completion callbacks, so a previous project cannot replace the current project's status. Closing the current project clears its report display and disables report creation until a project is open. An in-flight submission in one project does not disable report controls in another project; retries within the same selected report keep their original operation identity.

The current ECSA registry, typed authenticated preview and selected-native-model producer remain the receiving interfaces. The report schema, native aggregation, original run selections and opened-report event are unchanged.

### Data contract

Top-level schema: upstate.scenario-decisions/v1.

- id, title, project, grid_id, selection, baseline_run_id, created_at and implementation identify the product. report_kind is reference_totals or scenario_comparison.
- runs contains each id, original selection, scenario and profile titles, scenario specification, comparison_kind, actual landcover_edits, runtime and completion time.
- outputs maps nitrogen, phosphorus and sediment to native registry IDs, physical annual units and titles.
- zones contains id, title, scope, area_ha, original_area_ha, original source and pollutants.
- Each pollutants entry contains coverage, runs keyed by original run ID, and alternatives.
- Per-run quantities include all_valid_mass, common_mass, valid_area_ha, common_yield_per_ha_year and coverage counts.
- Each alternative includes baseline_common_mass, alternative_common_mass, change_mass, avoided_export_mass, change_percent, avoided_export_percent, percent_status and pairwise.
- pairwise contains baseline_mass, alternative_mass, change_mass, avoided_export_mass, change_percent, valid_area_ha, baseline_only_area_ha and alternative_only_area_ha.
- scenario_tradeoffs identifies nondominated same-profile land-cover alternatives using each selected common-footprint pollutant benefit; objectives names the actual available pollutants. Parameter changes are retained as their own comparison kind.

Tradeoff outcomes concern the displayed common modeled footprint. They do not create an economic ranking or add kilograms to tonnes. A portfolio of interventions requires its own combined native scenario because watershed responses can interact.

## Adopt current scientific interpretation

The companion model/invest320_output_semantics.json and model/OUTPUT_INTERPRETATION.md retain the pinned original engine outputs and distinguish source loads, exports, local erosion protection, downslope retention and receiving-cell deposition. The native source registry for version 3.20.0 is authoritative:

- https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py
- https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py

Official model interpretation:

- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html
- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html

The original regional requirement source is the Upstate Forever Emerging Contaminants in Small or Disadvantaged Communities Grant Program — GIS Mapping & Modeling Services RFP and appendices:

https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf

## Public source credit and review

Prepared by TokenJunkieLabs from the original ES-20261012-ASTRA-S1 watershed report delivery. This application source inherits the repository's MIT license; retain its LICENSE with redistributed source.

**Needs expert review.** Native modeled exports, original source-area interpretation and planning decisions require appropriate scientific review. The report retains its actual study title, native model edition, annual units and common-support basis.

