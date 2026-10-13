# Investigations in the Upper Savannah workbench

Operation: ECO-INTELLIGENCE-HOST-A66A-20261013. This is the shared HTTP/operator desk for ASTRA-ECO-INTEL13, joined to E258's original Workspace/native gateway and ES26's scientific diagnostic datasets.

## Open and use the complete desk

Start the maintained operator with the existing scientific Workspace and operator-state directory. Open its printed authenticated URL. Select the retained Workspace in the existing top bar and choose **Investigations**.

Create a named investigation, or select a saved investigation to reopen it. The desk lists the original registered data, model runs and ensembles. Selecting a resource changes the current selection; **Inspect selected** submits a complete-source analysis to the original Operations queue. Once the original task completes, the result opens with its full source identities, coverage and scientific units. A model-run inspection adds its registered artifact members to the comparison selectors.

The comparison form accepts two original files. Raster comparison uses the aligned original grids. Table comparison uses explicit pairing columns and observed/predicted value columns. These are the maintained INTEL13 calculations. The scientific interpretation already retained in each result remains part of the complete JSON and readable report.

The **Assistant** uses the existing server-configured provider and the same investigation engine. Its original tool loop reads registered sources, retains the source analyses, and prepares typed actions. The browser sends a question through the original queue; provider credentials remain in the original server configuration. Local source analysis and guided operations remain useful independently of that optional provider.

**Guided actions** lists only the native methods actually connected by E258's gateway. Select source files for collection analysis, a prepared original run for native execution, or the exact connected calibration/ensemble method. Each saved plan retains its source-bound selection. Executing a plan returns the original submission or result; the native task's current status and native run outputs are available from the same plan. The original queue runs admitted native work after the intelligence action returns its admission receipt.

**History and export** creates both a complete JSON snapshot and a self-contained HTML report from the same saved investigation. The snapshot, report and export manifest stay within the scientific Workspace. Downloads use the existing operator's verified file tickets, including its original authentication, content hash and byte-range handling. An export interrupted after the JSON snapshot was written resumes from that same snapshot.

## Export selected original scientific files

Open **Source collections** within the same investigation. The list contains current registered datasets and individual native job artifacts, with the declared units and byte identities available from their original descriptors. Use the filter and checkboxes, **Select visible files**, or **Add resource files to collection** from the resource panel. Selected references, the collection title and navigation remain in the browser's existing per-workspace recovery storage.

Choose **Export selected original files**. This submits `intelligence.collection.export` to the original Operations queue with the exact selected references and stable operation ID. The server resolves only the selected original references through the current native repository, materializing their typed source views and companions before freezing the selection. It then copies each original with its required GDAL/shapefile companions and creates one ZIP. The original investigation JSON/HTML export remains in **History and export**.

The completed collection includes original files under `data/`, the portable `catalog.json`, complete JSON/CSV/HTML inventories, the byte-transfer receipt and the saved collection selection. After downloading, extract the ZIP and open **START.html**. This page opens the full scientific inventory and links to each retained original file.

Saved source collections remain listed in their original investigation. **Reopen source collection** recreates authenticated download tickets for the same ZIP, inventory and selected copied files. The archive and its recorded source identities remain useful after the original source path moves; reopening reads the retained copies. Restoring the original scientific Workspace keeps these paths relative to that Workspace and authorizes the same retained project/session.

The browser's existing **Retry this original request** and original-task controls also apply to collection export. An unfinished copy must still match the source edition frozen by that task. If an original changes, retain the original task and select the current edition for a new export. Completed copied files, selection and archive stay under `intelligence/source-collections/<original-task-id>/`.

The archive writer uses ZIP64 when needed, streams file bytes in 1 MiB buffers and computes the archive SHA256 through the end of the ZIP central directory. Each source member is checked against its recorded content identity while writing. Reopening checks the collection's manifest, operation-bound member paths, portable catalog and exact selected references. The original operator supplies authentication, download cookies, SHA ETags and byte-range delivery.

## Browser continuation

The client saves the original action body and operation ID before submitting. If the response is interrupted, **Retry this original request** submits those same bytes and ID to the existing /api/actions endpoint. Native admission returns the original retained task. Once its ID is known, **Refresh retained status** reads that original task instead of creating another one.

A browser reload restores the pending request, selected investigation, last export reference and full form draft for the same registered Workspace. Question text, original comparison selections/columns, calibration fields, parameter grids, collection choices, selected resource and active desk tab also survive leaving the desk and returning. Each registered Workspace keeps its own draft. Out-of-order session reads retain the current selection. A late response from a previous Workspace updates that Workspace's retained context; it cannot replace the currently selected Workspace's investigation. Failed/interrupted tasks stay available through **Open original operation**, where the existing native resume/cancel controls remain authoritative.

Saved plans and questions keep their original INTEL13 identities. Re-executing a completed plan opens its original retained result. A queued question uses its original operation ID as the provider request identity, so a completed original response reopens from the Store.

## Installed source and shared interfaces

| Source | Owner and purpose |
| --- | --- |
| eco_intelligence/* | INTEL13's maintained analysis, Store, schemas and provider loop |
| Original Workspace repository/native bridge | E258, including complete source/artifact enumeration, exact native task correlation, saved scenario experiments and portable project namespace |
| Diagnostic dataset provider | ES26, exposing the complete saved scientific reports and source originals |
| operator/intelligence.py | A66A HTTP reads, queued operations, deterministic session/plan creation, operation receipts and verified exports; selected-source export registration |
| operator/intelligence_collections.py | ECO-264B selected-source snapshot, resumed transfer, streamed ZIP and reopened collection tickets |
| science_catalog_delivery.py | ECO-264B portable source projection, companion preservation and complete byte-transfer receipt |
| operator/web/investigations.mjs | A66A complete desk and request/reopen lifecycle |
| operator/web/investigations.css | A66A scoped industrial desktop and phone layout |
| operator/extensions/investigations.json | ECSA shared extension-registry registration |
| install_intelligence_operator.py | Complete operator/provider source installation and the original portable-source inventory join |

The feature constructor is IntelligenceFeature(operator, fault, integration). The joined backend supplies engine(workspace_key) and assistant(workspace_key), returning the same actual INTEL13 Engine and Assistant instances. The constructor reuses the integration already attached as operator.science_investigations. Otherwise the registry mount constructs eco_intelligence.upstate.UpstateInvestigations(operator, dataset_providers=...). This is E258's published native factory. If operator/intelligence_diagnostics.py is installed, it registers ES26's DiagnosticsDatasets(operator).records(workspace_key, 'dataset') through the exact (workspace_key, original_workspace) provider callback. The installed WorkspaceScienceCatalog adds prepared grids and original scientific lineage. When the original ExperimentOperator is installed, native_experiments=True joins saved Scenario experiments to the same factory and original experiment.run action. A native integration preconfigured with ensemble/calibration action builders stays authoritative through the existing attachment. Every route resolves the selected key through the original Operator.ws before reading data.

The original Operator owns authentication and action admission. The registry supplies exact installed routes and passes the original workspace_key, operation and payload. Source paths and Python modules are installed application configuration; the browser cannot choose a host path, import module or provider endpoint.

### HTTP reads

All requests use the original Bearer-authenticated api function and explicit workspace query:

| Route | Inputs | Full result |
| --- | --- | --- |
| GET /api/intelligence/catalog | workspace | Current original inventory, saved sessions, connected methods and provider availability |
| GET /api/intelligence/session | workspace, session_id | Complete session, original analyses/plans/events, saved exports and native task pointers |
| GET /api/intelligence/evidence | workspace, session_id, evidence_id | One complete retained source analysis |
| GET /api/intelligence/plan | workspace, plan_id | Original source-bound plan and current native task pointers |
| GET /api/intelligence/export | workspace, session_id, export_id | The same saved export with newly registered verified download links |
| GET /api/intelligence/diagnostic | workspace, diagnostic_id | Original complete saved scientific report/downloads and matching retained investigation analyses |
| GET /api/intelligence/native-task | workspace, task_id | Full plan-bound original task or its portable captured record, current Workspace, and native run/experiment link |
| GET /api/intelligence/experiment | workspace, experiment_id, offset, limit | Original full experiment result page, total_cases, next_offset and registered downloads |
| GET /api/intelligence/collection_sources | workspace | Metadata-only current dataset/artifact choices |
| GET /api/intelligence/collection | workspace, session_id, collection_id | Retained source collection, original copied files and verified download links |

### Original queued operations

Submit {workspace, action, payload, operation_id} to the unchanged POST /api/actions endpoint.

| Action | Payload |
| --- | --- |
| intelligence.session.create | {title} |
| intelligence.diagnostic.open | {diagnostic_id}; reopen matching original evidence or create the retained session and inspect the saved report |
| intelligence.inspect | {session_id, request: original Inspect schema} |
| intelligence.prepare | {session_id, action: original Action schema} |
| intelligence.execute | {plan_id} |
| intelligence.continue | {plan_id}; explicit continuation of the same interrupted native admission |
| intelligence.ask | {session_id, question} |
| intelligence.export | {session_id} |
| intelligence.collection.export | {session_id, title, refs: [{kind, id, member?}]} |

Each complete original queue result contains kind and session_id, plus evidence_id, plan_id or export_id as appropriate. Full analysis data remains in the original Store; the task result carries a useful pointer. Original task decoration joins verified export downloads to the Operations desk.

Session and plan creation use deterministic IDs bound to the original task identity. Direct intelligence.prepare binds its one plan to the original task and session, and reopens that retained plan before rereading mutable source/job context. If a native job advances or a source catalog changes after the plan was saved but before the queue receipt was written, resuming the original prepare still returns the same complete plan. The saved direct plan also keeps its original submitted Action under body.operator_request. Native Scenario experiments enrich the reviewed action with their original baseline, full parameter selection and complete case count; recovery compares the frozen submitted selection and reopens that same enriched plan. Earlier ordinary direct plans remain readable. Assistant tasks keep body-specific plan identities because one original question may prepare several distinct actions. OperationStore delegates all other Store behavior. A Workspace Store that maps the host's directory-derived workspace key to a portable original project namespace exposes storage_tenant(workspace_key); this preserves the exact native namespace for these two atomic SQL inserts. The same original Store's authorize/session/plan methods still enforce that mapping.


## Saved reports, native programmes and portable history

A saved Scientific interpretation carries its original diagnostic ID and report_json dataset. The diagnostic read returns its complete original report and authenticated downloads. Its _investigation field adds the current Workspace key, exact dataset ID, source SHA-256 and all matching saved session/evidence references, ordered newest first. This is a single same-project Store join; each result must match both the original dataset reference and report digest. The queued intelligence.diagnostic.open action accepts only the original diagnostic_id selection. It reopens a matching saved analysis or creates its deterministic task-bound session and calls the same Engine.inspect on the original report_json dataset. Its ordinary kind:evidence result contains session_id, evidence_id, diagnostic_id, dataset_id and source_sha256. Retrying the same request first receives any committed matching evidence; a session saved immediately before interruption keeps the original task-derived ID. The browser can reopen an existing matching analysis without reading every saved session.

A saved native Scenario experiment is selected from catalog.inventory.ensembles. Its original title, selection, baseline, profile/case counts and progress remain visible. The guided action is {kind: "ensemble", native_experiment_id: <original saved ID>}. The original Scenario experiments desk edits that design. The native binding retains the entire selection and submits experiment.run through the same queue. Complete case counts are preserved, including programmes larger than the generic form's former default. Read result pages with the returned next_offset until it is null; the original summary, CSV and HTML downloads remain the same programme outputs.

A plan's _native_bindings identify its exact admission and original task. _native_tasks include observed task state, source origin and current native run/experiment links. When admission was interrupted before an original task record existed, intelligence.continue invokes the binding's retained continuation and reconciles the same plan. Existing admitted work reopens with its original task identity.

After a whole Workspace restore, the newly registered directory has a new transport key while the original project UUID, sessions, evidence, plans and native bindings stay the same. Native task reads return the original operator record where available or its captured original SQLite record. The response explicitly identifies that origin. Open the linked native run or experiment under the currently registered Workspace to continue its original results.

E258's ProjectStore holds a shared original Workspace lock through every SQLite connection's commit and close. The existing whole-workspace backup takes that same lock exclusively, receiving a quiescent database with the complete source and investigation files. The optional host-selected snapshot_state destination supports the original delivery assembly's online SQLite snapshot. The browser never chooses a database path.

## Install and compose

Use the existing ECSA registry installation in the current cumulative application. Receive this source overlay and the original INTEL13 package. Receive E258's current eco_intelligence/upstate.py native binding alongside its current portable Store/source changes. The feature instantiates its named UpstateInvestigations factory, installed ES26 and scientific catalog providers automatically; an existing preconfigured native integration is reused. The shared HTML report comes from eco_intelligence.report, so the original stdlib HTTP host does not import the optional ASGI server. Install the current original Scenario experiment feature before creating the investigation factory to expose complete saved programmes. Run the native component installer first; this receives the complete current eco_intelligence package, including the corrected Action schema and scientific raster-unit reader. Then install the composed operator and original provider files:

    /opt/pyvenv/bin/python -B /path/to/this/source/eco_intelligence/install_upstate.py \
      --application /mnt/data/eco12-integrated-20261012 \
      --source-root /path/to/this/source

    /opt/pyvenv/bin/python -B /path/to/this/source/install_intelligence_operator.py \
      --application /mnt/data/eco12-integrated-20261012 \
      --source-root /path/to/this/source

The operator installer prepares all thirteen complete HTTP/browser/provider/guide files and composes the current portable inventory in memory before publication. It parses Python and JSON, checks JavaScript when Node is present, accepts the exact current source or published predecessors, retains earlier source bytes, and compares fresh bytes again before each replacement. The original model/portable.py body remains intact with additive source inventory declarations. It preserves the original engine/core modules installed through E258's native installer. Use --dry-run to view the exact source changes. Install the registry through the current install_extensions.py if the cumulative app has not yet received it.

Open /api/extensions through the original authenticated client and confirm the Investigations registration. Its errors identify a concrete missing joined module, static asset or original action. The rest of the operator keeps its current registration and source.

## Original receiving continuation

Use ECD1's current application and retained Workspace on the existing /opt/pyvenv/bin/python / Chromium host. Join the original Gura/Upper Savannah native operation rather than creating another model run.

Carry the complete operator journey:

1. Open the existing authenticated operator, select the current original Workspace and create an investigation.
2. Inspect one retained original dataset and an existing native run; compare the selected compatible original artifacts or observation/prediction files.
3. Prepare and execute the selected original native action through E258's connected gateway. Retain its actual task/run IDs, reopen the submission and then the completed original outputs.
4. Export the complete investigation, restart the same operator, and reopen the same session, plans and export members.
5. Use the current original Workspace backup/restore path; confirm the same investigations remain available under the restored directory's new operator workspace key.
6. Capture the changed Investigations desk at desktop width and 390-pixel phone width. Reuse existing map, training, native model and scientific diagnostics journeys.

The original application's archive inventory must include eco_intelligence, ecsa_runs, integration and integrations, preserving the current source/receiving packages. Retain ES12's existing root installers plus install_intelligence_operator.py, requirements-intelligence.txt, science_catalog_delivery.py and SCIENTIFIC_CATALOG.md. The Workspace-local SQLite Store must be checkpointed/quiescent or consistently snapshotted during that original archive operation. E258 owns those direct native assembly joins. The standalone investigation JSON/HTML exports are frozen, regular files in the original Workspace. Reopening a complete export verifies and returns its original manifest and members. An interrupted export resumes from its frozen JSON and any already committed HTML; a later report-template edition or project-title change does not replace those original files.

## Validation scope retained with this source

The complete browser controller was executed in the available JavaScript runtime against native-shaped original queue/read APIs. It covered accepted creation with a lost response and reload, one original request/session on replay, full source inspection and reopening, an interrupted export read recovered from the same saved files, and workspace switching while an earlier acceptance returned. Four retained tasks produced two sessions and one export across five admission calls; replay reused the original task.

A second complete desk lifecycle exercise ran the actual module against a minimal DOM and the same original API shapes. It covered source inspection, paired comparison, newly discovered native artifacts, prepared-action execution and the original task pointer; it also reopened question/comparison/calibration/collection drafts through a workspace round trip, checked both original verified export controls, and returned out-of-order session reads without replacing the current selection. These are JavaScript/DOM source exercises; the native receiver supplies the actual browser rendering and Python host run.

INTEL13's original five integration journeys, complete million-row/raster capacity exercise and Chromium/API journey remain in its original validation.json. The joined Python import, original native queue operation, full Workspace transfer and changed-screen browser capture run on E258/ECD1's current receiving host against this same cumulative source.


## Selected-source overlay receiving

The collection overlay is composed onto A66A's current five-file native host, Canvas F0C8NFSFFV4, preserving saved diagnostic intake, native programme continuation, the prepared-grid provider, shared report rendering and source-preserving installation. Its browser postimage is based on F0C88SPMV0F; compose runtime_integrity's current diagnostic/programme browser arm against the recorded original base before installing the cumulative client.

The owned installer also installs `operator/intelligence_collections.py` and the current `science_catalog_delivery.py`. Keep the existing E258 native gateway and current `eco_intelligence` engine package in place. The collection helper receives only the existing engine repository, original task and operator workspace; HTTP clients submit registered references.

For the focused receiving journey, select current original datasets and include an existing registered artifact when the Workspace contains native outputs. Complete the queued export, download and extract its ZIP, read START.html, verify the delivered catalog against the copied bytes and reopen the same saved collection. Replaying the original operation must return that collection's original ID. The current integration-owner source and its broader existing receiving sequence remain the surrounding application validation.

