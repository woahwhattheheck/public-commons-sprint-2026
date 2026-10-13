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
