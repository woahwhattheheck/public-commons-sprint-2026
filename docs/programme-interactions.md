# Native conservation studies in run programmes

This component connects saved conservation coalition studies to the existing Upper Savannah run programme. A programme can adopt every original coalition run, continue those same native calculations, synchronize completed attribution, and include completed studies in its existing report and GIS receiving handoff.

## Existing work is retained

The programme uses the same native run IDs, grids, profiles, scenarios, selected NDR or SDR models, and native execution locks. It does not create a second model executor. The programme's execution ledger and the conservation study's dispatcher can both observe the same original completed runs. Their native runner remains responsible for actual execution and stage reuse.

A conservation programme selection has source_reference upstate.native-interactions:PLAN_ID. Each named run retains its original coalition key, mask, ordered action IDs, original run ID and baseline ID in changes.interaction. The adapter checks every generated scenario against the immutable plan's exact baseline edits, action order and original mask-source descriptors. Repeated adoption reopens an existing matching programme even if only coordinator source has changed.

Creating a programme prepares missing conservation cases but never launches native models. If the study already has a completed result, the programme receives that result without clearing the original completed study.

## Operator and CLI workflow

Use the existing Programmes desk to preview a conservation study and adopt it. Run or resume it through the existing programme task. Completion synchronizes the original interaction analysis using completed native runs only, then attaches the resulting common-support report.

The existing CLI also exposes:

    python -m model.compute_programme_cli --workspace WORKSPACE interaction-preview PLAN_ID
    python -m model.compute_programme_cli --workspace WORKSPACE interaction-create PLAN_ID
    python -m model.compute_programme_cli --workspace WORKSPACE resume PROGRAMME_ID
    python -m model.compute_programme_cli --workspace WORKSPACE sync-interaction PROGRAMME_ID
    python -m model.compute_programme_cli --workspace WORKSPACE attach-interaction PROGRAMME_ID RESULT_ID
    python -m model.compute_programme_cli --workspace WORKSPACE report PROGRAMME_ID

An existing programme can attach a completed study when its named baseline is the exact same retained native run. This preserves the exact baseline grid, profile, model scope, scenario and original requested version; completed scientific comparisons separately validate actual executed stage versions. The report explicitly records which coalition cases also appear among that programme's named runs. A study may contain supplementary cases outside the programme's original named selection; their original IDs remain visible.

## Quantities and support

The programme's existing annual totals and native pairwise differences keep their original meanings. Pairwise differences use alternative minus baseline over that pair's common finite cells.

The conservation study section uses the finite reporting support shared by every coalition and every selected pollutant. Positive benefit is baseline annual export minus coalition annual export on that common support. It includes baseline and combined annual export, combined benefit, sum of standalone benefits, nonadditivity, pair effects, Shapley allocations, and the allocation efficiency residual. Original units and signed values are preserved. Permutation sampling standard errors describe the allocation estimator, rather than physical model uncertainty.

The current native-version record is retained when supplied by the maintained interaction engine. The full original result JSON and all original CSV, GeoPackage, support raster, zone raster and native-run index descriptors remain downloadable.

The programme JSON report includes interactions.studies. Its Markdown includes the shared-support summary, action and pair tables. Programme-level CSV files carry each original plan and result ID; string cells are protected against spreadsheet formula interpretation while negative numeric values remain numeric. The programme's top-level files list contains the original study artifacts and the consolidated tables, so existing authenticated download tickets work directly.

## Immutable attachment history

Each attachment is a content-addressed link beneath compute-programmes/PROGRAMME_ID/interaction-links. The link records the full original result JSON hash, all original artifact descriptors, exact baseline binding, report quantities and native run matches. active.json selects the latest attached result for each plan; prior links and prior programme reports remain available. An exact repeat preserves the original attachment timestamp and report identity.

Reports read retained attachment summaries rather than reopening every source raster on routine operator requests. Attachment creation verifies the completed native exports and study artifacts. Actual downloads retain the original file-ticket verification. Portable receiving verifies the original retained bytes and all link identities again.

## Existing GIS receiving and portable project transfer

The original seven-map delivery keeps its selected native baseline and future maps. When it includes attached conservation studies, the receiving record adds their complete retained study context and marks each coalition's inclusion in the selected GIS maps. The receiving-record identity incorporates the active attachment links so a later study attachment creates a new receiving record without replacing an older one.

Original Workspace backup recursively captures interaction plans, interaction state, result folders and programme attachment history. Additional original programme, interaction and analysis locks prevent capture midway through their publication. No new archive format is introduced. The existing incremental Project Continuity service continues to use original portable.backup and portable.restore.

Receiving checks every historical attachment against the restored programme, original plan, generated scenarios, native selections and exports, result JSON and artifact hashes. It also checks the active attachment index. When original archive extraction already verified the member bytes, the validator consumes that member inventory rather than rehashing every raster.

## Integration boundaries

The additive source module is model/programme_interactions.py. Guarded edits add report and GIS receiving context to model/compute_programme.py, commands and completion synchronization to its existing CLI, and family locks plus link validation to model/portable.py. The operator/provider and installer join the existing queue, routes, programme UI and signed downloads.

Source baseline: woahwhattheheck/public-commons-sprint-2026 at b39554bf4ead42d1fb42af7c21a9e241f384fd41, opportunities/upstate_forever_2026. The packet includes exact full postimages and individually guarded source replacements so other maintained additions can be composed without dropping them.

## Exact original native-run adoption

The existing upstate.compute-programme-selection/v1 run rows accept the optional
native_run_id field. It is a full original 64-character run ID, mutually exclusive
with source_runs (completed-stage assembly). The row still selects its actual
profile_id, scenario_id and model scope; the programme's grid_id remains explicit.

The programme inspects that original run, verifies its selection digest, grid,
profile, scenario and resolved models, and retains the complete original
selection verbatim. This includes the version originally requested. It reuses
the saved run during programme creation instead of synthesizing a new selection
under the currently installed version.

Prepared, interrupted, partially completed and complete original runs are all
eligible. Programme execution still calls the original Workspace.run on the same
ID, under the same run and batch locks. Existing completed-stage checks, original
artifacts, actual native runtime validation, cache reuse and recovery journals
remain with that runner. Adopting a run does not assert that it has completed or
that its outputs are compatible with another run.

Conservation-study adoption supplies native_run_id for every exact retained
coalition. Nonempty coalition selections may differ from the original baseline
only in their exact generated scenario and requested invest_version declaration.
The original baseline ID/selection, composed mask sources, action order,
grid/profile, model scope and saved case selection/digest remain exact. Completed
comparisons and attribution continue to validate actual executed native-stage
versions with the maintained native version/cohort service.

Repeated adoption also recognizes an earlier programme whose exact selection
differs only by omission of native_run_id from every row, provided all original
coalition run bindings still match. It reopens that immutable programme and its
existing queue/history. The same predicate applies when synchronizing completed
attribution; no legacy programme record is rewritten.

