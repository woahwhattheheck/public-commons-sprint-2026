# Transfer an editable scientific study

TokenJunkieLabs · Upper Savannah application · Study transfer 1

The Study transfer desk exports a chosen scientific analysis, experiment programme or native run with the original inputs and saved results needed to continue it. Several selections share one dependency capture and one original portable archive. The receiving scientist can reopen the studies, inspect the same model cases and continue work in the included application.

## Use the desk

Open the scientific workspace, then choose **Study transfer**. Search or filter the saved scientific analyses, experiment programmes and native runs. Select individual studies or the current page; selections remain selected while you page, search or move between study types. **Show selected studies** provides a focused review of the accumulated selection.

Give the archive a useful title. **Include saved comparisons for the selected cohort** includes native comparisons whose runs are all in the captured cohort, and saved observation comparisons for captured runs. An analysis's explicit observation dependencies are always retained when its saved results use them.

Choose **Preview contents** to see the original data size, file count, scientific records and dependency groups. The preview lists included records and why they belong to the selection. It also distinguishes planned cases and original records that have not yet been materialized. These remain part of the experiment or analysis plan.

Choose **Export editable study**. The original operator queue prepares, writes and verifies the archive. The desk reports the current phase and makes the completed archive available through the application's original authenticated file download. **Open export task** uses the existing task view and its retry controls. A network interruption during submission keeps the original operation identity in the browser session, so a repeated submission for that selection rejoins the same queued operation.

Use **Receive study archive** to open the application's existing receiving form. Receive into a new workspace and reopen the saved studies there. The application, project identity, source editions, profiles, scenarios, prepared grids and native results retain their original paths and identities.

## What the selection carries

| Selected record | Original dependencies retained |
| --- | --- |
| Scientific analysis | Its manifest, state, saved JSON/CSV/HTML reports, declared native runs, grids, expected profile and scenario editions, completed observation calls, observation editions and catchment sources used by saved comparisons |
| Experiment programme | Original plan, state and case records; baseline and materialized profiles/scenarios; materialized native runs; saved native comparison; planned case descriptions |
| Native run | Original run metadata and complete native run directory, including model arguments, outputs, sidecars and intermediates; original profile, scenario, prepared grid and source collection |
| Source collection | The unchanged collection record, original manifest object, original source objects and declared companion objects |
| Saved comparison | Original comparison record and files, paired native runs, or original observation edition and catchment source as appropriate |

Original content-addressed source collections are indivisible: all objects in a referenced collection accompany that edition. The export includes a collection or native run once even when many selected studies depend on it. It preserves selected NDR-only, SDR-only and paired-model runs under the original model-selection contract.

An unfinished experiment retains its existing cases and plan, so it can continue on the receiving host. For a partial observation analysis, a missing observation edition is required only where a committed comparison used it. Unavailable or unprocessed requests remain described by the original analysis state. Selecting a run alone also retains that run's saved observation comparisons when related results are enabled.

## Install with the existing extension host

Receive these complete files into the same maintained application directory:

- model/study_transfer.py
- model/study_transfer_cli.py
- operator/study_transfer.py
- operator/extensions/study-transfer.json
- operator/web/extensions/study_transfer.mjs
- operator/web/extensions/study_transfer.css
- operator/STUDY_TRANSFER.md

The installed extension host reads the new manifest when the operator starts. It registers the Study transfer navigation entry, original queue action, exact read/preview routes, task downloads and receiving verifier. The manifest requires the existing workspace.restore action. The current maintained application already has ExtensionRegistry and the browser extension host.

For an older receiving application, install the authored extension host using its existing install_extensions.py and operator/EXTENSIONS.md before restarting the operator. Compose with the current application source and existing host lifecycle changes. The study extension itself adds only the seven files above.

The maintained portable application inventory must carry its runtime packages, including model, operator, ecsa_runs and any separately installed investigation package. The existing portable writer supplies the application source and archive manifest.

## Original queue and API contract

The extension provider is StudyTransfer(operator, fault). The registered action is study.export. Its payload is the selection object below, optionally with the preview_token returned by the preview. POST /api/actions keeps the original workspace key, payload and operation_id.

| Operation | Existing authenticated endpoint | Input |
| --- | --- | --- |
| List saved roots | GET /api/study-transfer/catalog | workspace, kind, query, offset, limit |
| Preview dependency capture | POST /api/study-transfer/preview | workspace and selection |
| List export tasks | GET /api/study-transfer/exports | workspace, offset, limit |
| Read one export's phase | GET /api/study-transfer/progress | workspace and task_id |

Catalog pages default to 200 records and export pages default to 100; the browser uses 50 exports per page. The read APIs return total, offset and next_offset. The maximum requested page size is 1,000. A preview reads metadata and file sizes; it does not rehash the native raster corpus.

The worker recomputes the selected dependency capture under the original workspace, native batch and selected record locks. A saved study may progress between preview and queue execution; the archive captures the current saved state of those same selected identities and records whether it differs from the preview.

The worker stages original regular files using local hard links when supported, with a streaming copy across filesystems. It keeps original byte identities stable through the existing portable writer's full manifest verification. Staging directories are private to the operation and cleaned after completion. Publication retains the original archive format and creates a new destination without overwriting an existing archive. Retrying a completed task reopens and verifies its existing archive.

## Command line

Run from the maintained application directory in its existing GIS/Python environment. List real saved root identities:

    python -m model.study_transfer_cli catalog --workspace /path/to/workspace --kind experiment-diagnostics
    python -m model.study_transfer_cli catalog --workspace /path/to/workspace --kind experiments
    python -m model.study_transfer_cli catalog --workspace /path/to/workspace --kind runs

Create a selection.json using identities returned by the catalog:

    {
      "schema": "upstate.study-selection/v1",
      "title": "Selected watershed experiment and interpretation",
      "roots": [
        {"kind": "experiment-diagnostics", "id": "<original 64-character analysis id>"},
        {"kind": "experiments", "id": "<original 64-character programme id>"}
      ],
      "include_related_results": true
    }

Preview, export and inspect that selection:

    python -m model.study_transfer_cli preview --workspace /path/to/workspace --selection selection.json
    python -m model.study_transfer_cli export --workspace /path/to/workspace --selection selection.json --destination /path/to/new-study.zip
    python -m model.study_transfer_cli inspect --archive /path/to/new-study.zip

Receive through the original command:

    python -m model.cli restore /path/to/new-study.zip /path/to/new-receiving-directory

Use the workspace and application paths returned by restore. Reopen that received workspace with the original operator or model commands.

The study receipt is retained under workspace/study-transfers/<study-id>.json. The original operator receiving flow calls verify_received_studies before workspace registration. It validates the original project and study identities and resolves the selected dependency capture again in the received workspace. Later additional cases and results can extend the received study normally.

## Saved investigations and report revisions

A selected study can carry the original scientific investigation history together with its native model results. The installed investigation integration takes a consistent snapshot of its existing SQLite database while the selected scientific files are frozen. The captured database retains the original project identity and the selected sessions, evidence, plans and native-task records. The exporter first freezes the sessions associated with the selected study, then follows their typed references through the original scientific dependency collector. Runs, saved experiments, source collections, observations and other records needed to reopen those histories join the same locked export. Additional scientific dependencies retain that original conversation cohort. The received project opens those histories in the same investigation interface and can continue them normally.

A report can gain results as its original experiment programme finishes. Conversations therefore retain the exact report revision used when a question was asked. The captured revision includes the original report JSON, its SHA-256 identity and the native evidence link. Reopening an older session displays that retained revision; opening the current analysis can create or reuse the session for its current report.

For command-line exports, the standard investigation database is `intelligence/investigations.sqlite3` under the original Workspace. The operator also supports the database configured by its installed investigation integration. The integration binds the existing project before the scientific export takes its workspace guard, then supplies its native snapshot callback. This keeps the export and original investigation writer on the same project synchronization mechanism.

The study receipt records the captured investigation members and retained identifiers. The original archive verifies every captured member before publication. Receiving validates the original project, retained history and immutable report revisions while allowing new questions, evidence and completed tasks to be added to the received project.

## Connect the existing transfer desk

The complete study archive is the input to the existing project transfer transport. Its model/PROJECT_TRANSFER.md, model.project_transfer_cli and model.project_transfer_install retain the existing SHA256 block inventory, changed-edition reuse, interrupted-upload continuation, reconstruction and independent receiving workflow.

Completed study exports show **Transfer archive** in the registered application. The study controller opens the original project-transfer desk through `openExtension('project-transfer', 'openForStudy', selection)`. The receiving desk resolves the completed study task and verifies its original archive before preparing the existing block transfer. Integrations can also supply `setTransferHandler(callback)`; the callback receives:

    {
      workspace_key,
      task_id,
      study_id,
      title,
      archive: {id, filename, label, bytes, sha256, url}
    }

archive is the same verified original file ticket used for download. The server resolves the archive from the completed `study.export` task in the same original Workspace. The file ticket describes the export for the browser; the original server-owned task determines the file to capture. The project-transfer desk then provides its existing manifest, missing-block request, transfer parts, archive reconstruction and independent receiving workflow.

Other scientific desks can use the installed extension host to preselect roots:

    await extensions.openExtension('study-transfer', 'openForStudies', [
      {kind: 'experiment-diagnostics', id: savedAnalysisId, title: savedAnalysisTitle}
    ]);

The controller preserves the selected roots when the registered host then mounts the view. It detaches listeners and outstanding requests when leaving a workspace, and it polls active exports only while the desk is mounted.

## Receiving exercise for the existing scientific workspace

Use an actual saved analysis and its programme, including a completed native run and a saved observation comparison when available. Preview the selection, export it through the original queue, receive it into a new directory and reopen the same selected identities. Inspect one original native output, its saved observation comparison and its scientific report; then continue an existing programme or create a further analysis from the received runs.

For the browser, exercise selection across two catalog pages, search, the selected-only view, queued export progress, the original download and the existing receiving form. Check the desk in the actual 390-pixel application viewport. Use the existing project transfer continuation route for the resulting archive when joining transport.

Source references: original model/workspace.py, model/portable.py, model/model_selection.py, model/experiments.py, model/experiment_diagnostics.py and operator/extension_registry.py in opportunities/upstate_forever_2026; existing project transfer source at commit a4be1cce327bbf648d5a2652df2c49c929800d5a.


## Transfer a Decision study with its original scientific work

Choose **Decision studies** in the Study transfer selector, or choose **Transfer editable study** from a saved Decision study. Several selected decisions can share one capture with diagnostic analyses, experiment programmes and native runs.

For a decision prepared from this scientific workspace, the dependency preview follows every saved revision. It retains the original experiment programme, prepared grid, physical parameter profiles, land-cover scenarios, baseline and alternative runs, comparisons and their original inputs and outputs. It uses the native bridge's declared references; arbitrary source notes remain ordinary retained data. Historical experiment-summary hashes remain creation-time provenance while the original programme can continue accumulating completed cases.

The archive captures a single consistent SQLite generation before resolving the decision dependencies, then retains only the selected studies and their complete revision, calculation, import-provenance and operation histories. Original study and calculation IDs remain unchanged. Retained operation receipts, HTML/CSV reports, implementation selections and decision-project exports travel with the selected study. The receiving Decision studies desk can reopen these downloads through its normal authenticated transport after restart or restore.

The contents preview reports the retained scientific files and lists the selected decision-history counts. The selected database's exact captured size is added to the completed archive. Its frozen bytes are passed to the original portable writer unchanged; ordinary full-workspace backups capture the live decision database through SQLite online backup.

After restore, the original study can gain revisions and calculations. Immutable input revisions and completed answers retain their captured identities. A captured running calculation can enter the original completion or interruption states. A retry can bind its original operation to a new matching calculation attempt after the old attempt fails or is interrupted. Earlier attempts remain in history.

A decision received independently through **Receive project JSON** keeps the donor workspace's scientific references and retained numerical gains. The preview lists those original-workspace references separately. Its complete decision history remains editable and recalculable using the saved gains; open the original scientific workspace for ecological model runs associated with those references. Whole-workspace restore retains the original project identity and provides the full local scientific dependency closure.

The existing **Complete project JSON** export and receive workflow remains available for an independent decision study. **Transfer editable study** uses the original workspace archive and preserves the selected study's original identities.

## Transfer a Decision study prepared from saved common-support diagnostics

A decision prepared from a saved diagnostic keeps its original report revision under `robust_decisions/diagnostic-revisions/<diagnostic-id>/<report-sha256>/`. Both `report.json` and `manifest.json` are included in selected-study transfer, even when the decision has no Investigation conversation. Their paths, sizes and SHA256 identities remain bound to the saved Decision revision.

Every selected Decision revision follows the declared `ES26/diagnostic-common-support/v1` source contract. The transfer includes its original diagnostic selection and the complete native run roster that established common support, as well as the selected grid, profiles, scenarios, baseline and alternative runs. This preserves the shared support used for the saved numerical gains when it is larger than the chosen Decision matrix.

The current diagnostic object may have a newer report. Its current state travels as part of the editable scientific workspace; the Decision's retained report revision remains the source of its saved numbers. Reopening and receiving the Decision verifies that pinned report and manifest. Revisions prepared from a donor workspace stay explicit external scientific references when imported through standalone project JSON; restoring the original whole or selected scientific workspace keeps the local source closure.

After receiving, open the saved Decision, inspect its diagnostic source revision and calculate using its original gains. Then revise costs, constraints or objectives through the normal Decision workbench, preserving the earlier input and calculation history. Prepare a further Decision study explicitly when a new ecological analysis changes the physical gains. The saved earlier study continues to use its own report revision.


## Completed Decision map releases and adopted native runs

With **Include related results** enabled, selecting a saved Decision study now
retains every completed original map/client release bound to that study's saved
calculation history. The transfer matches the original study ID, calculation ID,
revision and result hashes, explicit mapped profile, chosen whole candidate, and
frontier point where applicable. A release of an earlier revision remains bound
to that revision; a newer study head does not replace its scientific context.

The original release directory travels intact: atlas, GIS layers and metadata,
client/scientific reports, original Decision HTML/CSV/selection/project exports,
and retained report bindings. Its existing complete working archive is included
when it is part of that original release. The preview lists these bytes under
**Completed map and client releases**, so an archive already present inside a
release contributes its actual size.

Typed dependencies follow the producer's saved fields. Linked watershed reports,
scenario analyses, Economic desk editions, receiving-water plans and analyses,
water designations, and saved-map reviews/exports retain their original records,
native run cohorts, and complete source collections. Map reviews preserve their
earlier review IDs and original atlas origins. No renderer, model or solver runs
during selection, capture, or receiving.

The transfer receipt pins each completed release's record, selection, Decision
binding and file descriptors. Original receiving checks the same inventory and
binding after restore. Reopen the received workspace's original atlas or Decision
desk to continue; the mapped profile remains a display choice and the saved
across-profile decision remains unchanged.

An experiment's explicit `selection.source_run_ids` are retained even before its
case files are materialized. These are the actual original run IDs adopted by the
native experiment engine after its grid/profile/scenario/model and producing-stage
checks. Their run selections, producing stages, outputs, grids, profiles,
scenarios and original sources all travel through the existing run dependency
path. The original Scenario experiments designer preserves these choices during
**Revise design** and offers completed runs from the chosen baseline's grid/model
scope. Retained choices remain visible when absent from the current catalogue;
remove one explicitly or restore its source record.

The original CLI passes the same JSON selection through unchanged:

```sh
python -B -m model.experiment_cli --workspace /owned/project preview selection.json
python -B -m model.experiment_cli --workspace /owned/project prepare selection.json
python -B -m model.experiment_cli --workspace /owned/project sync EXPERIMENT_ID
```

Place exact original IDs in the optional `source_run_ids` JSON list. The engine
omits canonical-only entries from its normalized selection to preserve existing
plan identities; completed noncanonical sources remain explicit and frozen.
`sync` uses retained completed runs; `run` retains the original native execution
behavior for unfinished cases.


## Editable Monitoring study transfer

The original selected-study workflow also accepts saved Monitoring networks, designs, budget comparisons, campaigns and observational contexts. Monitoring’s **Transfer editable study** action opens this desk with the original workspace and saved roots. Full campaign parent history, native field events, replay operations and source companions remain editable after restore. See [Monitoring study transfer](../model/MONITORING_STUDY_TRANSFER.md) for exact dependency and continuation behavior.


## Transfer one saved scientific report edition

Open a completed edition in **Sources → Saved scientific reports** and choose **Transfer this report and its studies**. The original Study transfer desk selects that exact edition in its original Workspace. You can also choose **Saved scientific reports** in the study type filter, combine editions with other saved studies, preview the dependency list, and export through the normal queue.

The archive retains the original `scientific-report-editions/<id>/edition.json`, render selection, completed operation, PDF, HTML, Markdown, structured data, figures and every declared output. A report ZIP already prepared for that edition is retained too. Source choices keep their original order. Shared full source collections and original CAS companions are included once.

The source lineage is specific to the original producer. A same-project Diagnostic report brings its original saved analysis and native cohort, with the exact historical report capture. An original Monitoring report brings its producer record, selected design and complete editable campaign history. An original calibration review brings its plan, fitted result, selected native run, uncertainty/map/review records and completed report exports. Missing declared same-project records stop the preview; they are not silently replaced with a smaller history. A report imported from another project keeps its contained source files and original provenance without claiming that the donor's editable Workspace is present. The preview identifies the actual retained dependencies.

After receiving through the original archive restore, open **Sources → Saved scientific reports**. The edition keeps the same full identity, original Workspace path inside its render identity, ordered sources and output checksums. It does not rerender or substitute the new receiver path. **Use these studies in another report** starts a separate edition with the original source choices. Existing Diagnostic, Monitoring and calibration views reopen their retained records. Full Workspace backup remains available when the entire project is required.

The new typed root is `{"kind":"scientific-report-editions","id":"<full-original-edition-id>"}`. It uses the existing study selection, preview, export, receipt, download and receive contracts. Report-file ZIP downloads remain a convenient document handoff; editable Study transfer additionally carries the selected original scientific context.

## Open the received Monitoring study

After receiving the selected archive into an independent Workspace, refresh **Study transfer** and choose **Open in Monitoring** on the retained network, design, campaign or observational-context row. This opens the existing Monitoring desk with that exact record. Unreadable catalogue entries retain their error and do not offer the opening action.

For a source-only study, open the saved observational context. The network is selected and the context's original station rows, observation filters and package download are available without creating a sampling design. Historical context calendars remain frozen in the saved context even when a current campaign has advanced. A new preview uses the design or campaign that the operator explicitly selects above it.

The opening route uses the original read endpoints and authenticated extension host. It does not enqueue a model run, rewrite the received records or select another Workspace. If the Workspace changes during a read, open the desired record again in that Workspace.
