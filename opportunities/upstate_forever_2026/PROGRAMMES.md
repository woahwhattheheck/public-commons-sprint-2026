# Native run programmes

This component adds a reusable execution and recovery service to the existing Upper Savannah Scientific Workbench. It accepts expanded scientific cases from the experiment planner and runs them through the retained Workspace and native InVEST engine.

Open **Native model runs → Run programmes** in the current operator, or use its existing authenticated address followed by **#programmes**. The application keeps the current workspace, original data selectors, model grids, profiles, spatial review, customer review and backup workflow.

## Complete operator workflow

1. Prepare or select a completed model grid, saved parameter profiles and land-cover scenarios in the existing workbench.
2. Open **Run programmes**. Choose **Create programme** to group prepared cases, **Use saved experiment** to materialize a prepared design, or **Import selections** to receive an existing expanded case list.
3. Review the named cases and distinct native selections. Save the programme. Its identity binds the complete selected grid, profiles, scenarios, case labels and source reference.
4. Open the saved programme and choose **Continue unfinished runs**. Each case appears with its original native run ID, state, completed stages and error, when present. **Run selected cases** operates on a selected subset while retaining the entire programme.
5. Use **Pause after current run** to request a checkpoint between native calculations. The request is delivered immediately to the programme controller, independently of the single native worker queue. The current native run finishes before the next one starts.
6. Reopen the programme after an interruption and continue it. Completed native stages are reused under their original identities; failed cases keep their causes. Original logs and output artifacts remain available through **Inspect run** and **Log**.
7. Build the result catalogue. Download its original JSON, CSV and method notes, inspect physical units and valid coverage, and pass exact run IDs to the watershed decision-report and map-release workflows.
8. Save the ordinary complete Workspace backup and restore it with the current operator. Programme selections, progress, pause state and generated reports travel in that same working archive.

The **Copy selections** action creates another selected programme while retaining the original. Changes to an experiment's coefficients happen in the experiment/profile workflow before its expanded rows enter this controller.

## Install into the maintained application

The source edition includes the programme engine and CLI, saved-experiment adapter, operator integration, browser controls, original Gura input receiver and operating guide. The public application source includes the original scientific core and its current interface dependencies. Use the installer when joining programme controls into an existing application.

    python -B install_programmes.py --application /absolute/path/to/current/application

The installer reads the current shared operator and browser files, inserts the programme registrations, and preserves the other registered modules and static assets. It validates the Python source before replacement and checks each current file again at its replacement boundary. An already-installed identical edition is reusable, and the installer can upgrade the exact previously published programme edition. Concurrent or other authored edits are retained for composition.

The existing operator must be restarted after source installation so it imports the new backend. Use the same original workspace and operator state directory. The normal startup command and capability URL remain the opening route.

## Expanded selection contract

    {
      "schema": "upstate.compute-programme-selection/v1",
      "title": "Selected Upper Savannah calculations",
      "grid_id": "EXISTING_GRID_ID",
      "baseline_run": "baseline",
      "runs": [
        {
          "key": "baseline",
          "title": "Current land cover / selected profile",
          "profile_id": "EXISTING_PROFILE_ID",
          "scenario_id": "EXISTING_BASELINE_SCENARIO_ID"
        }
      ],
      "source_reference": "Original experiment or scientific source reference"
    }

Replace the ID labels with the complete identifiers returned by the actual Workspace. The programme accepts one or more explicit named cases. Additional rows use their actual retained profile and scenario IDs. Optional **reason**, **experiment_key** and **changes** fields preserve the experiment designer's explanations. All cases refer to the selected real grid.

Parameter planners can construct this selection directly. The service validates existing selections and native compatibility; source acquisition and scientific parameter generation retain their existing owners.

## Reuse completed native models

A full NDR/SDR result can use the completed NDR stage from one original run and the completed SDR stage from another. In **Create programme** or **Copy selections**, choose the target full grid, parameter profile and land-cover scenario, select **NDR + SDR** (or inherit both grid models), and choose **Reuse completed NDR and SDR**.

Select **Completed NDR source** and **Completed SDR source** by their original run IDs. Each choice displays the original profile, land-cover case and stage completion time. A completed stage remains selectable when another stage or the reporting step caused its enclosing run to fail. The catalogue reads retained metadata; actual input compatibility is resolved by the native assembler when the programme runs.

Source and target grid/profile identifiers may differ when they represent separate partial-model and combined selections. The assembler compares the actual selected native inputs, parameters, runtime and source outputs. It copies the completed model stages into the ordinary target run, then finishes the target's reporting outputs. The target keeps its normal native selection identity. Execution checkpoints each assembly stage, so an interruption can continue the same target and source stages.

An explicit selection row uses:

    {
      "key": "combined-baseline",
      "title": "Combined completed baseline models",
      "profile_id": "TARGET_FULL_PROFILE_ID",
      "scenario_id": "TARGET_SCENARIO_ID",
      "models": ["ndr", "sdr"],
      "source_runs": {
        "ndr": "ORIGINAL_COMPLETED_NDR_RUN_ID",
        "sdr": "ORIGINAL_COMPLETED_SDR_RUN_ID"
      }
    }

**Review planned runs** shows the selected models, calculation method and original source IDs for each case. The saved programme links to those source runs beside its target run. The result catalogue's **Original native run** field identifies the actual source of each reported quantity; a target already completed before the request retains its existing scientific lineage.

The catalogue includes `model_selection_available`, `completed_model_assembly_available`, and separate `completed_model_runs.ndr` and `completed_model_runs.sdr` arrays. Each source record retains its selection, completion time, stage hash and runtime hash. These are the same selections supported by the browser and native CLI. The browser requests completed sources only when opening the creation/copy form; ordinary status refreshes read the lighter programme catalogue.

**Copy selections** retains explicit NDR/SDR choices, source runs, purpose and source reference. Experiment annotations remain attached while their grid, profile, land-cover case and model scope are unchanged.

## Shared Python service

Import **ComputeProgrammes** from **model.compute_programme** and construct it with the current **Workspace** instance.

| Method | Result |
| --- | --- |
| catalog() | Lightweight programmes and current grid/profile/scenario choices |
| preview(selection) | Validated expanded named selections and native identities |
| create(selection, source_reference=None) | Persisted programme |
| status(programme_id) | Saved selections, live native states, stages, errors and counts |
| execute(programme_id, only_runs=None) | Execute the saved selection while respecting an existing pause signal |
| pause(programme_id) | Immediate request to pause between native runs |
| resume(programme_id, only_runs=None) | Continued original execution |
| report(programme_id) | Saved metadata-based result catalogue |
| read_report(programme_id) | Previously saved catalogue, without a raster calculation |
| delivery_preview(programme_id, selection) | Required later release selections and compatibility |
| prepare_delivery(programme_id, selection) | Complete native release using the selected finished runs |

The native CLI is **python -B -m model.compute_programme_cli --help**. Its subcommand help gives the exact current arguments. Use that same application and Python environment as the original Workspace.

## Operator API

The current operator's authentication, request identities and task queue apply to every route.

| Route | Request / behaviour |
| --- | --- |
| GET /api/programmes/catalog?workspace=… | Programme and prepared-input catalogue; add include_sources=1 to include completed native source stages |
| GET /api/programmes/detail?workspace=…&programme_id=… | Saved programme and authenticated output links |
| GET /api/programmes/report?workspace=…&programme_id=… | Saved result catalogue |
| POST /api/programmes/preview | {workspace, selection} |
| POST /api/programmes/experiment-preview | {workspace, experiment_id, offset?, limit?}; inspect the prepared design |
| POST /api/programmes/pause | {workspace, programme_id}; immediate checkpoint signal |
| POST /api/programmes/delivery-preview | {workspace, programme_id, selection} |
| POST /api/actions | Existing retained task protocol with one of the actions below |

Task actions:

- **compute.programme.save** with **{selection, source_reference?}**
- **compute.programme.experiment** with **{experiment_id}**
- **compute.programme.run** with **{programme_id, only_runs?}**
- **compute.programme.report** with **{programme_id}**
- **compute.programme.delivery** with **{programme_id, selection}**

Supply the existing task protocol's workspace, action, payload and stable operation_id fields. A failed or interrupted original task can be continued through **/api/task/resume**. The browser retains a request identity across an uncertain response and reuses a matching failed task on retry.

External operator modules can import **attachProgrammes** from **operator/web/programmes.mjs**, using the existing workbench API/context helpers. Its **mount**, **open**, **refresh**, **detach**, **create**, **fromExperiment** and **importSelections** methods provide the same execution controls inside an experiment or native-run desk.

## Calculation and release dependencies

A completed native model grid, scientific profile and selected land-cover case are the calculation inputs. A programme can run a baseline alone and retain useful output before the final release selections are complete.

The later full release still supplies its required source roles, overlays, named baseline and alternatives, observation links, cartography choices and contact metadata through the existing native delivery service. Profiles, grids and runs explicitly select NDR, SDR, or both. Missing model selections retain the original combined behaviour. NDR requires DEM, NLCD and precipitation/runoff-proxy rasters; SDR requires DEM, NLCD, rainfall erosivity and soil erodibility. Programme rows inherit the grid's selected models unless their supported subset is explicitly supplied. Comparisons use the actual shared model outputs on the same grid, while the full seven-map release requires both selected models.

## Interpreting retained quantities

The result catalogue carries each artifact's recorded physical unit, valid pixel count and supported area. Whole-run totals use each run's actual valid coverage. Pairwise changes refer to the original comparison's common valid support. The full watershed decision-report producer owns catchment aggregation, paired denominators and the detailed scientific interpretation.

The programme preserves parameter designs and source references chosen by the experiment builder. InVEST's version-specific calibration guidance describes explicit sensitivity runs and subsequent comparison with compatible observations. Observation comparisons require the relevant measurement, units, time period and catchment.

Primary method sources:

- [InVEST 3.20.0 freshwater calibration and sensitivity](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html)
- [InVEST 3.20.0 Nutrient Delivery Ratio](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html)
- [InVEST 3.20.0 Sediment Delivery Ratio](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html)


## Saved experiment handoff

**Use saved experiment** reads the retained plan and displays the first page of its prepared cases with the complete case count. Saving includes every case. It saves the exact derived profiles produced by the experiment planner and binds every case to its canonical native selection, including the selected models. Original planner IDs are retained as context when an older saved planner omitted a partial model selection.

The programme keeps one overall reference case. Each experiment case also retains its own native paired baseline in **selection.runs[].changes.pairing**. A land-cover comparison under a changed parameter profile can therefore use the experiment's matching profile baseline; the programme result catalogue continues to show its declared overall reference. The operator displays actual parameter, biophysical-table and land-cover change flags beside each run.

Other screens can open this workflow with **programmes.fromExperiment(experiment_id)**. The existing native run desk passes prepared selections with **programmes.create({selection})**, and reopens a saved programme with **programmes.open(programme_id)**. These calls use the same workspace, authentication, original tasks and result downloads.

A completed programme created from a saved experiment collects its paired experiment results after the programme's execution locks are released. The operator and the programme CLI use the same continuation service. Reopen the saved experiment to inspect its completed cases, compare same-profile alternatives, download the experiment report, and build paired ensemble maps. See **model/EXPERIMENT_PROGRAMME_CONTINUATION.md** for the complete retained-case and recovery workflow.

## Continuation and source updates

The browser's **Continue unfinished runs** and **Run selected cases** clear an earlier pause before resuming. A paused programme keeps its original cases. If the process ended during coordination, resumption records the interrupted attempt and the native stages already present, then verifies and reuses those outputs.

Programme control and report repairs can be installed while retaining saved programmes. Execution keeps the original source inventory and records the current coordinator source for each attempt. Scientific engine files and the selected grid/profile/scenario identities continue to be checked against the original programme. A changed scientific engine is selected through a new programme using **Copy selections**.

The complete delivery builder shares the workspace's native execution lock with command-line and operator calculations, so its captured working archive is assembled from a stable run set.

## Receive the original Gura example

The optional **source_tools/receive_gura.py** intake uses the original per-model Gura NDR and SDR sample archives referenced by the tagged InVEST 3.20.0 datastacks. It preserves each archive and selected original source member, joins the nutrient and sediment tables by their original land-cover code, checks the common terrain and land-cover cells, and prepares the existing Workspace plus a baseline programme.

Run its command-line help from the full application:

    python -B -m source_tools.receive_gura --help

Supply the actual retained archive paths with **--ndr-archive** and **--sdr-archive**, the separate current original CSV paths with **--ndr-table** and **--sdr-table**, separate workspace and source directories, the installed source reference, and an explicit model-context buffer. The receiver reads and preserves the selected raster's actual native cell size. The pinned official InVEST 3.20.0 archives contain 15-metre cells, each covering 0.0225 hectare; a separately retained 300-metre case preserves its recorded 9-hectare grid cells. Optional **--expected-resolution-m** asserts that actual source resolution. **--upstream-buffer-m** independently selects added model context, with zero added context for new intake and the retained original value on continuation. Each table's original source URI, complete bytes and row lineage are retained independently of the archive's older sample tables. The receiver reads the scientific coefficients and load semantics from the original tables. Use the original regional workspace for the Upper Savannah study; the Gura workspace is named for its source study and exercises the same native application path.

The full source now includes both original 3.20 biophysical CSVs under **source/gura-original-tables-3.20/**. Their exact publisher revision, source paths, hashes and original URLs are in **source/gura-original-tables-3.20/source.json**. Pass these retained files directly to **--ndr-table** and **--sdr-table**. The intake streams and verifies an existing extracted member against its original ZIP entry before reuse, avoiding another member-sized temporary copy on a retry.

The pinned 3.20 native NDR exports are annual kilograms per hectare; native SDR sediment export is annual metric tonnes per hectare. The reporting conversion multiplies each native raster by its actual affine pixel area in hectares. Thus a 30-metre square regional cell uses 0.09 hectare, the official 15-metre Gura source cell uses 0.0225 hectare, and a separately retained 300-metre square grid cell uses 9 hectares. Original native output files and reported mass-per-cell outputs remain separate in the retained run. The version-specific model guides linked above document these quantities.

## Source operation

**UPSTATE-SCIENTIFIC-PROGRAMMES-A73C-20261012**, part of **UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012**.

Implementation: TokenJunkieLabs. Existing application and third-party license notices remain with their source.

## Paired scenario maps from completed programmes

Open a completed programme and use **Build paired maps** beside an available alternative. The selector matches original baseline and alternative runs by the same parameter profile, grid and native model version. NDR-only, SDR-only and combined profiles retain their actual model scope. Each candidate shows its original pairs and available quantities before calculation; select the member percentiles and review the original inputs to build the maps. The complete paired result, downloads and map viewer use the shared paired-ensemble service.

The catalogue lists missing or incomplete matching baselines with their actual saved profile and scenario selections. Programme status and reports include **ensemble_candidates**, **ensemble_candidate_issues** and **ensemble_pairing**. Each saved report includes the direct paired-service selection JSON for every available candidate. The CLI exposes the same selections:

    python -B -m model.compute_programme_cli --workspace WORKSPACE ensemble-candidates PROGRAMME_ID
    python -B -m model.compute_programme_cli --workspace WORKSPACE ensemble-selection PROGRAMME_ID CANDIDATE_ID

Ordinary catalogue refreshes read retained programme metadata. The create/copy form explicitly requests completed-model sources when it opens, so the native source scan occurs when those source choices are needed. Command-line callers can use **catalog --without-completed-sources** for the metadata catalogue.

## Original daily flow and calibration context

**source_tools/usgs_flow.py** receives original USGS daily mean discharge for stations intersecting the retained watershed domain. It accepts the original Esri JSON, gzip or ZIP domain source, retains paginated response bodies and station metadata, and writes daily values plus monthly and annual coverage. Units, approval flags, station identifiers and source URLs travel with the retained observations. It imports ordinary Workspace sources with the original domain and response companions. See **source_tools/USGS_FLOW.md** for the receiving commands and the published station context under **source_data/**.

## Complete missing matching calculations

Use **Prepare matching calculations** in a programme’s paired-map section to review the exact missing or unfinished baseline/alternative calculations. The preview lists the retained profiles, scenarios, selected models and native IDs. Saving retains a derived programme containing every original named case and completed model source, and adds only the missing selections. The selected **Continue these native calculations after saving** option runs that complete programme through the ordinary native worker. Both programmes retain links to reopen the other after a restart.

The retained preview identity prevents a changed set of requirements from being silently executed. Completed maps use the same paired-map workflow above. See **model/PAIR_COMPLETION.md** for the API, CLI, recovery and original-selection details.

The complete continuation request is saved before its derived programme is prepared. Repeating a saved request after an interrupted preparation reopens that same selection. If native calculation fails, the task opens the derived programme containing the completed and unfinished runs; its normal controls continue the retained work.

The standalone paired-results panel remembers input selections, excluded profiles and the latest calculation request separately for each Workspace. Switching Workspaces while a request is pending keeps that request attached to its original Workspace. **Resume** uses the retained calculation selection; changing form fields and choosing **Build** creates the newly selected calculation. The panel lists selected, excluded and missing pairs separately. Programme report changes are **alternative minus baseline**, so negative values mean lower export. Paired raster maps show **baseline minus alternative**, so positive values mean lower export.


## Paired programmes from prepared source-water areas

The **Source-water areas** desk now prepares a complete native cohort directly from saved original polygon areas and their explicit land-cover alternatives. **Prepare paired programme** selects an actual matching model-domain grid, the original baseline, retained parameter profiles and native model families. Its preview displays every run and the matching baseline for that profile before creation.

The desk uses `experiments.prepare` and `programme_experiments.create`, so the programme retains the same canonical case iterator, per-profile baseline identities and completed-result synchronization described above. Its **Open programme and continue runs** control opens this maintained programme controller. Use the original pause/resume, selected-case execution, logs and paired maps here; the source-water plan reopens the corresponding receiving-area reports after completion.

The source-water plan, native programme and experiment have separate saved IDs. Their original source and selection relationships are retained in `receptor-programmes/<id>/result.json`. Complete Workspace archives carry all three collections together with actual original sources and native outputs. `model/RECEPTOR_PROGRAMMES.md` documents the full selection, command-line workflow and authenticated result navigation.

## Keep pending forms with their original selections

Programme forms retain their original Workspace and editor from opening through preview and submission. This applies to creation and copying, saved experiment and conservation-study intake, attribution attachment, matching-calculation preparation, paired maps and native-study export. A delayed catalogue cannot replace a newer form or open over another desk. Closing a form releases its listeners; a late preview or JSON file read cannot submit work from that dismissed form. Reopening begins a new selection. Ordinary desk refreshes preserve a still-open form.

Use the current form to review changed selections before saving. The original scientific selection, run IDs, preview identity, case ordering and accepted task operation stay on the maintained APIs. Copying continues to retain the original case reasons and changes when its grid, model, profile and scenario still agree. Export continues to use the selected completed baseline and alternatives.

### Inspect the outgoing Programme interface

For the actual receiving application, inspect the exact outgoing version at a desktop or screenshare width and a narrow width. Use a populated Workspace with retained native results, original studies and saved programmes. Open the actual screens or screenshots and look for legible text, useful column widths, clipping, overflow, cramped controls and unclear state labels; preserve the plain industrial design and original scientific work.

Operate creation, copying, experiment and conservation intake, matching calculations, paired maps and native-study export. Reopen the saved programme and exported report or package through their original links. Include empty, loading and error states as well as populated results. During a delayed catalogue or preview, close or replace the form, then confirm that its late response cannot replace the current form or submit an obsolete selection. Confirm that ordinary refreshes keep a valid open form usable and that paging and the native-case console retain their current behavior.

Record the inspected source revision, actual application opening route, populated Workspace, screen widths, viewed screenshots, control outcomes and saved/exported identities with the existing receiving operation. A controller exercise establishes request and selection behavior; actual rendered-product readiness also requires this populated-screen and control inspection. Keep the existing scientific execution course and the 14:00 UTC sprint cutoff.
