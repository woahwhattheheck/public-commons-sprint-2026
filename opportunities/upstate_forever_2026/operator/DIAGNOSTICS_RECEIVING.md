# Scientific interpretation — receiving and integration

TokenJunkieLabs · ES26 · Upper Savannah / Ecosystem Sciences

This source adds scientific interpretation to the existing Python Workspace and
vanilla JavaScript operator. It consumes the original InVEST 3.20.0 NDR/SDR
run records. Keep it in the same cumulative application assembled by ECD1.

The native sediment spellings metric_tonnes/pixel/year and metric_tonnes/year
are accepted at identity scale 1 and displayed as t/pixel/year and t/year.
Original raster and observation unit strings remain attached to the retained
source values. Computation module and GIS dependency changes produce a new
analysis identity, so a changed observation method cannot reuse a prior report.

## Install the complete source

Decode the numbered base64 source-map blocks into a separate directory, preserving
all file paths, UTF-8 bytes, and one final newline where supplied. Check each
file against its source-map byte length and SHA-256.

Run the included installer using the existing application interpreter:

    python /path/to/decoded-source/operator/install_diagnostics.py --application /path/to/current-application

The installer copies the seven component files and adds twenty narrow registrations
to the current server, app module, and index. It checks each current anchor before
editing, retains the previous shared source outside the application, and checks
Python and JavaScript syntax. Existing native run data stays in the selected
Workspace. Reopen the same operator with its original workspace and state paths.

## Operator use

Open Scientific interpretation → Select cohort. Choose an existing experiment
programme and Use programme cases, or select retained native runs directly.
Choose the reference profile and baseline. Add retained observations when relevant.
Analyze uses the original operation queue and stable request IDs.

The view includes shared-support totals, matched scenario effects, parameter
responses and interactions, ranking stability, fixed-cohort annual-load fit,
source records and missing members. Export offers the complete analysis archive
and individual files. Create complete backup and Restore an archive include the
analysis in the existing portable application.

The complete operator guide is operator/DIAGNOSTICS.md.

The current selected-model core pins inherited single-model choices into each
run's selection.models. Diagnostics follows that retained declaration; omission
means both original models. Intentional model exclusions appear separately from
missing selected outputs in effects, rankings and observation coverage. Large
native cohorts support filtering and pages while retaining every selected run.

## Programme and decision-workbench integration

With ES-EXP-2319 installed, GET /api/diagnostics/catalog includes its programmes.
GET /api/diagnostics/experiment?experiment_id=... enumerates every case page,
retains the programme's expected profile/scenario matrix, and returns only actual
retained native run IDs as analysis inputs. It performs no model calculation.

A button in any original operator panel can open that exact programme:

    <button type="button" data-action="diagnostic-programme" data-id="EXPERIMENT_ID">Interpret scientific results</button>

The main dispatcher routes that action to the diagnostics module. The analysis
remains a selected, reviewable operation in the original form and queue.

Model API:

    from model import experiment_diagnostics
    report = experiment_diagnostics.analyze(workspace, selection)
    report = experiment_diagnostics.inspect(workspace, report["id"])
    records = experiment_diagnostics.listing(workspace)

Selection fields are run_ids, baseline_scenario_id, reference_profile_id,
expected_profile_ids, scenario_ids, title, purpose, design, campaign_id,
observations, tolerances, and top_k. The operator creates this object; the CLI
accepts the same JSON for native batch operation. Analyze writes
experiment-diagnostics/<id>/diagnostics_bundle.zip before completion. Its verified
descriptor is returned in artifacts.analysis_zip. Inspect returns retained report,
archive and processing state; it performs no scientific calculation.

    python -m model.diagnostics_cli analyze --workspace /path/to/workspace --selection /path/to/selection.json
    python -m model.diagnostics_cli inspect --workspace /path/to/workspace --id DIAGNOSTIC_ID
    python -m model.diagnostics_cli list --workspace /path/to/workspace

Use existing original runs from the retained regional or official Gura receiving
workspace. Keep its actual dataset identity in the project and title. An analysis
requires at least the selected baseline/reference native run; comparisons expand
when additional original profiles and alternatives complete.

## Native receiving

The meaningful receiving journey is: open the cumulative operator; select an
existing experiment or native run cohort; analyze actual completed outputs;
inspect one matched effect and the observation membership; export and open the
HTML/CSV files; back up and restore the same analysis. Record actual application,
Workspace, run, diagnostic and archive identities for the delivery desk.

The engine reads metric rasters block by block and limits simultaneously open
rasters to two. Reopening an analysis reads saved results. Changed run completion,
source or artifact metadata creates a new analysis snapshot; interrupted processing
can resume the same snapshot.

## Source composition

Original product carrier F0C8F3MKR3M:
source_ref 7c4223a111581935b494d5ac4b9357ef86992d67.
Current operator/customer-review receiving carrier F0C8GLD74CT.
Scientific engine original implementation: ES26 experiment_engine.
Operator integration, cohort selection and presentation: ES26 root.
Scientific method review and operator guide: ES26 ecosystem_research.
Source/claim discovery and receiving coordination: ES26 sprint_scout.

Keep original third-party notices when building the cumulative application.

## Attach scientific investigations

The diagnostic view exports setInvestigationHandler(callback). After constructing
both original feature adapters, connect the installed investigation interface:

    experimentDiagnostics.setInvestigationHandler(selection => investigations.openForDiagnostic(selection));

The callback receives workspace_key, diagnostic_id, title, and the retained
report_json dataset_id. The button appears only for a saved report while the
handler is connected. The investigation feature retains its own provider,
question composer, workspace resolution, and source inspection. Pass null to
remove the handler. The cohort picker also exposes original model scopes and
resolves duplicate profile/case selections before submitting the analysis.

## Current cumulative workspace switch

The E7A1 receiving repair composes the diagnostics detach handler at the unique `workspace=id;state=null;` assignment. It preserves the assembled application's Scenario Analysis controller and its existing draft guard. This edition includes that complete 13,932-byte installer; use it with the current cumulative application.
