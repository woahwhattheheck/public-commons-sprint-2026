# Native implementation and fieldwork operator

This package installs the implementation workbench in the existing Upper Savannah operator. The original operator supplies session authentication, workspace selection, operation identities, task queuing, resume behavior and verified file downloads. Native implementation records stay under each selected workspace. Scientific source selections remain frozen in the implementation plan.

## Install the complete received package

Use the current complete application and the cumulative received source directory. The source directory must contain the six implementation model modules, including model/implementation_economics.py, the native operator adapter, the implementation extension descriptor and the browser modules, stylesheet and catalog listed in install_implementation.py. The guide files are optional installation members. Include build_implementation_offline.py or a complete prebuilt operator/web/implementation_workbench.html. When the HTML file is absent, installation calls the received builder's build(source_root, temporary_output_path) during preparation, verifies the actual generated file against its returned byte count and SHA-256, and publishes those bytes with the other guarded file changes. A received builder is also installed for later regeneration. The generator uses the same received core, forms, UI, stylesheet and methods catalog as the native desk.

Run with the receiving application's Python environment:

    python install_implementation.py \
      --application /path/to/current/upstate_forever_2026 \
      --source-root /path/to/received/upstate_forever_2026

A preflight is available with --dry-run. Installation prepares all replacements before writing, parses Python source, validates JSON members, keeps exact backups of replaced files, uses the shared extension-install lock and checks current bytes at every publication boundary. New files publish exclusively. An interrupted installation can be repeated; files that already match the received edition remain in place.

If the current application already contains the complete shared extension host, this installer uses it. Otherwise receive the official host package from public-commons-sprint-2026 commit f293e68f7f490346280419ae447748ef95ec76a3 in the same source directory. Its installer exports patch_server and patch_app; this installer uses those transforms in the same prepared source change set. Required host files are:

- install_extensions.py
- operator/extension_registry.py
- operator/web/extension_host.mjs
- operator/web/extension_host.check.mjs
- operator/extensions/source-preparation.json
- operator/extensions/native-run-desk.json
- operator/EXTENSIONS.md

The host's decisions descriptor is included when present. The existing scientific engines and additional desks continue through their original actions and handlers.

A previous native installation's .implementation-install.json records exact installed hashes. A later received edition can replace a file when its current bytes still match that recorded edition. If an agent has edited it since installation, compose the source with those edits. For an explicitly reviewed existing edition, --expected-preimages accepts a JSON object mapping relative paths to their exact current SHA-256 values. It authorizes replacement only when the current file still matches that specific reviewed value.

Restart the existing operator after source installation, using its existing workspace and state-directory arguments. Open Implementation & fieldwork in the sidebar. GET /api/extensions includes extension id implementation and its declared reads/actions. The receiving application keeps its original authentication and file-ticket behavior.

The native Python CLI remains available independently:

    python -m model.implementation_cli --help

## Shared-file composition

The implementation descriptor registers the factory, actions, HTTP reads, queue aliases, state contribution, retained-item kind, task downloads and workspace restore verification. The native adapter has no HTTP framework dependency.

The single desk-specific shared-server addition imports implementation_error and consults it at the start of the existing summary_error function:

    from implementation_operator import implementation_error

    def summary_error(error):
        implementation_detail = implementation_error(error)
        if implementation_detail is not None:
            return implementation_detail
        # Existing error cases continue here.

The installer locates the actual function using the Python AST, preserves its body and verifies the current unique import anchor. It does not replace a historical server postimage.

The exact original server contract was read from private Commons blob 8434eba9cf0243fe2d50ec879a993c7ffbbc86a9. The registry contract was read from merged public host commit f293e68f7f490346280419ae447748ef95ec76a3. These source references identify the integration contracts; installation composes the actual receiving source.

## Browser extension contract

The installed descriptor loads /web/implementation.mjs and calls attachImplementationWorkbench(host). The host supplies getState, api, endpoint and refresh; showTask, toast and getWorkspace are available when provided by the original application.

The controller implements mount(node,state), update(state), detach() and dispatch(button). It owns its local event listeners. The descriptor declares no global action prefixes. Native plan data enters state.data.implementation_plans through the registry state hook. The view id is implementation, titled Implementation & fieldwork, placed after communities.

Static assets are implementation.mjs, implementation_core.mjs, implementation_forms.mjs, implementation.css and implementation_workbench.html. The extension host accepts module, stylesheet and HTML assets. The exact installed implementation_catalog.json is served through authenticated GET /api/implementation/catalog.

The standalone implementation_workbench.html remains a self-contained offline companion. Portable JSON retains the same upstate.implementation-plan/v1 schema across native and offline use.

## Read API

All paths use the existing /api authentication. Include the selected workspace key using the original endpoint helper.

| GET path | Parameters | Result |
| --- | --- | --- |
| /api/implementation/list | workspace | workspace_key and plans list |
| /api/implementation/detail | workspace, id or plan_id; optional revision and as_of | plan, summary, complete history and actual _downloads |
| /api/implementation/history | workspace, id or plan_id | immutable revision events with actual revision_ref values |
| /api/implementation/schedule | workspace, id or plan_id; optional revision and as_of | selected revision and calculated schedule |
| /api/implementation/summary | workspace, id or plan_id; optional revision and as_of | selected revision and operational summary |
| /api/implementation/catalog | workspace | exact installed methods catalog object |
| /api/implementation/selections | workspace | community_plans and conservation_portfolios choices, each containing original id and title |
| /api/item | workspace, kind=implementation_plans, id | retained plan with _implementation_summary and actual _downloads |
| /api/state | workspace | original state plus data.implementation_plans |

The source chooser reads the selected workspace's original community_plans overview and conservation.overview plans. Conservation choices include complete saved plans. Titles help the operator select a source; the original ID remains the import identity. Opening this chooser leaves the original source documents untouched. Import reads the complete original saved document and, for conservation, its verified portfolio and selection artifacts.

Revision is a positive retained revision. Omitting it selects the current native revision. Dates use YYYY-MM-DD. A selected as_of controls schedule and visit overdue labels; changing it does not change the underlying plan.

Plan detail downloads include a portable JSON snapshot of the exact selected revision and available native attached source files. A snapshot is written once into the plan's exports directory, with its original revision and byte hash in the filename. Tickets use the original operator's download mechanism and original file hashes.

## Queued write API

Submit writes to the original POST /api/actions with:

    {
      "workspace": "<selected workspace key>",
      "action": "<action name from the table>",
      "payload": { "...": "action fields" },
      "operation_id": "<fresh stable identity for this user operation>"
    }

Operation IDs use the original operator rule: 16–100 ASCII letters, digits, underscores or hyphens. Reuse the same identity to retry the same payload. A new user operation receives a new identity. The host retains the original request digest and rejects reuse for a different request.

The initial response is HTTP 202 with the queued task. Use the existing task display or GET /api/task?id=TASK_ID, and the original task-resume endpoint for an interrupted task.

| Action | Payload |
| --- | --- |
| implementation.plan.create | document or upload_id; alternatively title, start_date, optional id/plan_id, description, target_date, working_days, holidays |
| implementation.plan.import | document or upload_id; optional expected_revision |
| implementation.plan.save | document or upload_id, expected_revision |
| implementation.records.append | plan_id, collection, records, expected_revision |
| implementation.source.attach | plan_id, upload_id, expected_revision; optional label |
| implementation.source.import | plan_id, source_id, kind, expected_revision; optional selected_ids, field_mapping, method_mapping and source inputs below |
| implementation.selection.import | Same source-import action contract; alias for browser selection import |
| implementation.plan.report | plan_id; optional revision or expected_revision, as_of |

All write actions accept an optional actor label. The adapter retains that label and the original operator task identity on native revision events. A task resumed after its revision committed locates that exact event and returns the committed plan. It does not create another edit merely because the task receipt was interrupted.

The direct POST aliases /api/implementation/create, /import, /save, /report, /append, /attach, /source-import and /selection-import queue the same actions. Supply workspace, operation_id and payload, or top-level action fields. The shared registry's POST aliases return HTTP 200 with the queued task; the task's later completion semantics are identical. The browser workbench uses the original /api/actions route.

### Plan creation, editing and portable imports

Creation can consume the complete portable document or generate an empty native plan from title and start_date. The native store assigns the first committed revision. A new automatic plan ID derives from the original retained operator task, so a retried create retains its identity.

Saving a native edit requires both document.revision and expected_revision to equal the revision being edited. The store atomically publishes the next revision. Full JSON imports preserve unknown fields, all original record IDs and the incoming document digest/revision used for replay detection.

An unchanged portable import is idempotent. A prior imported event is recognized even after later native edits. A changed import based on an older revision is preserved as a conflict JSON file and returned for reconciliation. Candidate source snapshots, modeled benefit records and selected areas remain immutable under an existing candidate ID. Source-link snapshots and original binding fields retain their meaning under existing and historical IDs; declared candidate source-link references must resolve to the same original source identity. A changed scientific selection produces new candidate identities through the source importer.

### Original source selections

For kind community_plan or community_plans, source_id identifies an existing native community plan. The adapter reads the original /api/item community_plans record and retains the actual workspace/community-plans/ID.json reference. The importer follows the original interventions schema.

Default selected statuses are selected, in_progress and complete. Explicit selected_ids chooses exact original intervention IDs, including a proposed intervention if the operator selected it. All source rows must have valid original IDs and native status/strategy values.

The whole source document is frozen once on its source link, including original model context and reporting-area physical totals. Each selected candidate retains its original row snapshot and original row pointer. Reporting-area totals stay with the whole source; the importer does not attribute those totals to each intervention.

For kind conservation_portfolio, source_id can identify a completed native conservation plan. The adapter verifies and reads its original portfolio and selection file descriptors, retaining those complete documents together with the saved plan in an upstate.implementation-conservation-source/v1 envelope. The importer validates matching identities and selections. Whole-unit area_ha stays separate from reporting_area_ha; original pollutant records stay in their row snapshot. The same kind accepts an original portable portfolio or that envelope through source_document or upload_id.

For conservation_selection, portfolio_selection or mapped_selection, supply source_document or upload_id and an explicit field_mapping. JSON pointers identify the actual rows, original ID, label and any original area/benefit/owner fields. Selection must use selected_ids, a declared selector or explicit all_rows. The source-import guide gives the complete mapping contract.

Optional method_mapping associates original strategy/method keys with exact catalog IDs. The result includes proposed_task_inputs for deliberate scheduling. Original source estimates remain original planning metadata. Operators enter the actual task durations, costs, commitments and expenditures.

### Chosen economic scenario

From a saved Economic desk edition, choose one actual modeled alternative and open its implementation handoff. The planner shows the original scenario, reporting zone, signed physical changes, screening and source estimate before import. Choose an existing saved plan, or use **Create a new plan for this scenario**. **Save this plan and import scenario** commits the current draft through the original native queue before attaching the selected source.

The handoff binds the workspace, economic edition, alternative run, native report ID and SHA-256, and reporting zone. The provider reopens the verified original edition and retained native report; the browser sends these identities. One jointly modeled alternative becomes one source-linked candidate. Its reporting area remains reporting support, and its original cost footprint, assumptions, source and currency remain planning context. Enter task durations, methods, implementation budgets, commitments and actual spending deliberately in the plan. Native money records use USD integer cents.

The complete source snapshot preserves the economic report, its frozen selection and costs, original member manifest, the selected native zone, the original run roster and signed modeled outputs. Reopening a retained import resumes its original operation and source-linked plan revision. Local edits and open record dialogs stay available during the handoff; a different workspace rejects the selection. The imported source and final plan each use the existing 16 MiB JSON limits.

Install the current Economic desk and its browser helper `operator/web/economic_implementation.mjs` together with this FIELD12 edition. The required FIELD12 file list includes `model/implementation_economics.py`, so its syntax, exact bytes and installation receipt follow the same guarded preparation as the existing modules. The portable companion can reopen the resulting exported plan and retains its frozen source and field records.

The extension-host entry is:

    host.openExtension('implementation', 'openEconomicScenario', {
      workspace_key, edition_id, run_id, report_id, report_sha256, zone_id
    })

The controller keeps that request through desk navigation and asynchronous startup, then reviews it in the original planner. The native import uses the existing `implementation.source.import` action with `kind: "economic_scenario"`, the same binding, `source_id: edition_id`, `selected_ids: [run_id]`, `plan_id` and `expected_revision`. The provider resolves the source from that workspace and feeds the existing mapped-selection importer. The ordinary source-import action and plan schema continue to carry the resulting candidate.

### Original uploads and field records

Use the existing upload flow to retain the file bytes before calling implementation.source.attach. The adapter verifies the original upload, retains its original filename through staging and invokes the native attachment copy. The plan receives a local_file source link with actual byte count, SHA-256 and copied reference.

Records append uses the canonical collection name and original row objects. Identical existing IDs and content are idempotent; a different record under an existing ID requires an intentional edit of the current plan. Referential integrity is validated on the complete saved plan.

The field chain is sites and monitoring plans, then visits, activities and observations. Actual field costs and measured observations are entered by the operator from the real record. Method templates carry empty collection forms and unestimated durations. They do not carry invented measured results.

Completed visits retain their original timezone-aware visited_at value. Sample activities retain the original sample_id. Observations retain parameter, result_type, value, original_text, unit and the original basis, fraction, qualifier, limits, method and QA metadata where supplied. Censored, text and missing results keep value null. Reports preserve observations individually.

## Revision conflict response

The native error formatter maps RevisionConflict to code IMPLEMENTATION_REVISION_CONFLICT and status 409. Its fields are message, plan_id, expected_revision, current_revision and conflict_ref. Preserved stale-import files also receive conflict_download through the original file-ticket mechanism.

Write actions execute asynchronously. A queued write that encounters this conflict appears as state failed with the structured fields under task.error. Reading the retained task still returns the original task-read HTTP status. The workbench must inspect task.error.code rather than interpreting the earlier queue-admission response as a completed save.

Reload current detail, compare the preserved incoming document, apply the intended edits to that current revision and save with its expected_revision. The current record and the original incoming conflict remain available throughout reconciliation. A validation failure uses IMPLEMENTATION_INVALID with an issues array; other core input errors use IMPLEMENTATION_INPUT. Invalid source selections use IMPLEMENTATION_SOURCE_INVALID.

## Report generation and recovery

A report action pins plan_id, selected revision and as_of into an immutable per-task selection file before generating report members. With no explicit revision, the current revision at the task's first execution becomes the retained selection. Later edits cannot alter the report chosen by a resumed task.

Reports contain plan.json, summary.json, report.html and CSV tables for tasks, budget lines, visits, observations, sites, monitoring plans and activities. manifest.json identifies the selected plan digest and each actual output file's byte count and SHA-256. Its final publication marks a complete package.

An interrupted report directory without a final manifest is moved to a uniquely named incomplete directory and preserved. The same task regenerates its originally selected report. A complete existing package is reused after its recorded member hashes are checked. Task downloads are refreshed through original file tickets when the operator reopens the task.

The native store report API is:

    store.report(plan_id, output_directory, as_of="YYYY-MM-DD", revision=selected_revision)

The output directory must be new. The adapter owns recovery for its task-scoped output directories. Native report files use actual committed records, separate budget/commitment/actual totals, current schedule issues, visit completion and original observations.

## Receiving exercise

Use the real receiving application and an existing retained community selection. Open the new desk, create an empty implementation plan, import selected original intervention IDs, then save the deliberate implementation task inputs. Leave unknown durations null until the operator supplies them.

Export that native plan, make a clearly identified operational edit in the offline companion, and import it against the retained base revision. Open the resulting exact native snapshot and report. Check that the original scientific source digest and selected row IDs are carried through and the operator's field records survive the portable cycle.

For the conflict path, retain an exported revision, make a later native operational edit, then import a different edit based on the earlier export. The task should expose the current revision and a download of the preserved incoming JSON. Reconcile the intended edit into the current document and save with its current revision. This exercise uses the actual native source and task/download flows.

Source-bank byte reconstruction and hash comparison can be performed before materialization. The receiving exercise establishes the installed application's actual behavior with its own workspace and environment.
