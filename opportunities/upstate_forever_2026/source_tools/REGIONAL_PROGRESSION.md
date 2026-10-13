# One retained regional receiving operation

`source_tools/receive_regional_progression.py` carries one actual Upper Savannah Workspace through the original regional opening, working coefficient revision, full native baseline and source update, saved view, complete archive and separately reopened receiving project. It runs the existing desks and native queue in sequence.

## Run on the existing scientific worker

Use current public main containing Profile workbench, native regional saved views, Source updates Integration 8 or its maintained successor, the scoped-auth browser corrections, and the native worker supervision module. Use the original Python environment with its scientific libraries, Node with Playwright, and its installed browser.

The continuation takes ownership of the original operator state for the duration of this one operation. Close that operator normally before starting; the original `.operator.lock` prevents a second server from opening the same state. The continuation starts the maintained server itself and closes it after its final result. Native models still run through the original queue and supervised worker.

When the regional opening is already retained:

```sh
python -B source_tools/receive_regional_progression.py \
  --workspace /actual/retained/workspace \
  --operator-state /actual/retained/operator-state \
  --opening /actual/retained/workspace/regional-workflow-opening.json \
  --run-selection /actual/retained/native-run-selection.json \
  --output /actual/receiving/regional-progression --video
```

The run selection is an existing native selection containing `grid_id`, `scenario_id` and, when explicitly selected, `models`. Read it from the selected original run or its saved view. An explicit selection retains its supplied `profile_id`; when that field is absent, it uses the regional opening's profile. All grid, scenario, profile and model compatibility checks remain in native `run.prepare`. If the opening names a completed baseline, omit `--run-selection` to reopen that exact run, including its original profile and selected models. A retained alternative remains an alternative. After the source update, both selected runs reopen through the original plan's mappings, preserving their scenario pair and model scope. The original pair and source-update lineage remain in the refreshed opening; old/new-source comparisons remain in the plan's own reports.

For a regional source that has not yet been opened, pass the existing regional launcher's arguments after `--`:

```sh
python -B source_tools/receive_regional_progression.py \
  --workspace /actual/retained/workspace \
  --operator-state /actual/retained/operator-state \
  --run-selection /actual/retained/native-run-selection.json \
  --output /actual/receiving/regional-progression --video -- \
  --source-manifest source/water_context/20261013/complete-native-sources.json \
  --source-id upper-savannah-water-context-domain217-20261013 \
  --huc12 030601010703 --huc12 030601010704 \
  --huc12 030601020502 --huc12 030601020507
```

A retained `--report REPORT_ID` can replace the source manifest/source-id pair. Other source, profile and original scientific selection arguments retain the original regional launcher's syntax. Workspace, state, output, server and transfer arguments belong to the continuation.

## What executes

1. The original regional launcher prepares or reopens its report and exact saved HUC selection. Its original project identity and saved notes remain native records.
2. The Profile browser opens the retained 15-class reference table and saves the existing sourced code-82 USLE C=0.25 working alternative to its original C=0.20. It uses the source reference and scientific qualification already present in that driver. The continuation reopens both native profile records and checks their actual table hashes.
3. Native `run.prepare` selects the actual model grid/scenario and original reference profile. Native `run.start` executes that baseline through the existing worker; an already-complete identical run is reused.
4. The continuation resolves the original and saved profiles' real source collection IDs and named biophysical source IDs. It writes their exact explicit mapping and invokes the original source preview. That preview must contain the selected baseline as a physically affected full-domain run.
5. The existing Source updates browser saves the immutable dependency plan, prepares its original native profiles/grids/scenarios/runs, executes the requested source update, and opens the actual plan and reports in a fresh browser. The continuation checks the original plan's completed mapping back to the selected baseline.
6. The refreshed opening binds the actual mapped profile, source table and completed native run. When the original opening selected a baseline and land-cover alternative, both selected runs are carried through the plan's mappings and remain that scenario comparison. A single selected run continues to expose its old/new-source pair. Original selections and mapped run identities are retained explicitly. The original saved-view service records the selection with existing notes. The saved-view browser opens the original desks, exports/reopens its choices, and reopens the view in a fresh browser.
7. The original regional transfer captures the complete Workspace through its existing backup task, streams its archive into the original upload service, restores an independent receiving project, and checks the original saved view and source identities. The source-update selection and execution state must reopen exactly.
8. The existing saved-view browser opens that receiving Workspace through the same server and reopens its retained scientific desks. The receiving copy remains independently editable.

`--prepare-only` is an explicit operating choice for preparing source dependencies without native model execution. The normal command executes the native baseline and physically affected source-update runs. The source-refresh engine retains its full original dependency scope, including any other original runs affected by the selected source collection.

## Include measured chemistry and monitoring work

The same retained continuation accepts `--chemistry-selection ACTUAL_SELECTION.json` after the maintained Chemistry browser contribution is present. The selection uses its exact original CLI fields: one `case-id`, or `source-collection` plus `source-id`; optional `edited-project`, `reason`, `request` and boolean `receive`. Request/project file paths resolve relative to this selection file. Their original bytes and the selection JSON are fingerprinted and frozen under the receiving output before the browser consumes them. The complete original chemistry workflow runs before the final Workspace archive, so its retained cases, sources and analyses travel with the project.

Use `--monitoring-selection ACTUAL_SELECTION.json` to run the original `operator/monitoring_receiving.py` in the same retained Workspace. Its `network` names the actual original domain/station sources, and its `configuration` states the planning costs and calendar. The original Monitoring engine owns design, campaign, field export, native receiving and continuation. Its separate received campaign and original progress file remain in the continuation's `monitoring/` directory. A native nonfeasible or solver design result remains an explicit `design_diagnostic` with its original status and `campaign_created: false`; the complete project archive still proceeds. Only the receiver's completed campaign, independent receiving record and revision produce `campaign_received`. The final progression result carries `monitoring_outcome`. Actual regional data and a named planning configuration should be supplied for this regional operation.


## Adopt one prepared regional Monitoring campaign

Prepare the original regional domain and station editions once in the same scientific Workspace:

```bash
python -B source_tools/prepare_regional_monitoring.py \
  --workspace ACTUAL_WORKSPACE \
  --output MONITORING_OUTPUT \
  --domain-manifest ORIGINAL_DOMAIN/sources.json \
  --context-manifest observations/eighteenmile_2023/npdes/model-sources.json \
  --frontier
```

The default original station manifest contains the 67 WGS84, six NAD83 and 14 UTM17N source stations, with their original companions. The selected winter scenario states its engineer-authored costs and three-round calendar. Native geometric assignment, optimization, campaign creation, field export and independent receiving use the original Monitoring implementation. The optional frontier retains the USD 4,800, 9,000 and 13,200 budget alternatives in a further complete receiving archive. See [Regional Monitoring](../source/REGIONAL_MONITORING.md) for exact source intake and replaceable planning assumptions.

Add these three arguments to the existing regional continuation:

```text
--monitoring-selection MONITORING_OUTPUT/monitoring-selection.json
--monitoring-opening MONITORING_OUTPUT/monitoring-opening.json
--monitoring-receiving MONITORING_OUTPUT/receiving/receiving.json
```

The continuation verifies the completed receiver's original Workspace directory, project, source bindings, configuration and independent campaign revision, then adopts its exact network, plan and campaign. It creates no second design. The browser opens those actual saved records, operates the native campaign/calendar controls, downloads the original reports and field package, restores a complete editable Workspace, and reopens the same campaign there. These records are also included in the regional continuation's final complete scientific transfer.

Omitting `--monitoring-receiving` retains the original selection-only receiver operation. Omitting both new arguments preserves the existing operation fingerprint. An original infeasible design remains the explicit retained design diagnostic; its nonexistent campaign is not sent to the campaign browser.

The Monitoring browser's original action bodies and task identities remain in its private `request-state.json`. Interrupted runs use `--resume` only when that original state exists. A finished child journal is adopted only after its exact opening/receiver hashes and original project, workspace, network, plan and campaign identities match.

## Continue a campaign from a received full Workspace

A complete editable Workspace carries the original Monitoring network, plans, campaign revisions, calendars and source editions. A receiving operator registers its actual local Workspace directory under a new operator key. Use the retained scientific IDs directly when the earlier host's sibling preparation journals are unavailable.

Create a selection JSON outside the scientific Workspace. This is the exact completed Upper Savannah campaign included in the frontier archive:

```json
{
  "schema": "upstate.monitoring-browser-selection/v1",
  "project_id": "b9d5d257-c6bb-4f07-b975-8e8c63705db3",
  "network_id": "c0a17fe2d060fba0eb650779ee1d2297f25277d8416ac20f7e8fbb58440e01eb",
  "plan_id": "a3df4ded1ad5c71a062f03cdf6801b9fe8fa6800c4001ea058b812b65cd52b73",
  "campaign_id": "237d5dd35b7811a9f2d1d069760953e163effa8c8c8ba29f0be3d6a6df7cf1df"
}
```

The retained full Workspace archive is `upper-savannah-regional-monitoring-frontier-20261013.zip`, 45,027,826 bytes, SHA256 `be799c9f0db7cd8d15c1aa912ea21207b537e212a63f796307611da8ac0a2ece`. Its campaign selects six source catchments and schedules 18 visits under the named USD 4,800 planning scenario. Its original frontier also retains the USD 9,000 and 13,200 alternatives. Restore that original archive with the existing native receiving service before continuing the received Workspace.

Add this argument to the regional progression's original command, using a new progression output directory for this receiving host:

```text
--monitoring-restored-selection ACTUAL_SELECTION.json
```

This mode is mutually exclusive with `--monitoring-selection`, `--monitoring-opening` and `--monitoring-receiving`. The progression freezes the selected file, verifies the actual project and native network/plan/campaign relationships, checks the original retained source bytes, and records the campaign revision and complete native record fingerprints. Its outcome is `retained_campaign` with `campaign_created: false`. The same existing network and campaign continue through the browser; no design or campaign creation is queued by this adoption.

The Monitoring browser receives the actual registered Workspace key from this progression. Its new `restored-native` input pins the selected file SHA, actual operator key, native project/network/plan/campaign IDs and optional `context_id`. It uses the original source catalogue and full native record fingerprints, operates the report/field/full-Workspace exports, and restores the same scientific campaign independently. A finished child journey is reusable only when all those input fields match. Later resumes reject an advanced campaign revision in that same output directory; a deliberately updated revision starts a new receiving operation.

For a direct campaign browser continuation on an already running original operator, use the same selection file with the maintained browser driver:

```bash
node source/run_monitoring_browser.mjs \
  --url-file PRIVATE_URL_FILE \
  --workspace ACTUAL_RECEIVING_OPERATOR_KEY \
  --restored-selection ACTUAL_SELECTION.json \
  --output ACTUAL_BROWSER_OUTPUT \
  --browser-executable /tmp/chromium \
  --browser-renderer-limit 2
```

Use `--resume` on this direct browser command only when that same output retains its original `request-state.json`. The earlier host's browser journal remains attached to its original operator key. This receiving operation starts with the actual received directory and keeps the original scientific IDs.

## Reopen completed Chemistry analyses from the received project

The same full native Workspace retains the original chemical case and its completed analyses. Use `--chemistry-restored-selection` when the intended receiving course is to inspect, download and transfer those existing results.

The completed four-reach authored reference case in the Upper Savannah receiving archive uses this exact selection:

```json
{
  "schema": "upstate.chemistry-browser-selection/v1",
  "project_id": "b9d5d257-c6bb-4f07-b975-8e8c63705db3",
  "case_id": "ddd984b567d881798f214530ebf0aef4601ab0744df7af7831bcb17e4e302abb",
  "run_ids": [
    "59d4b738620b469249bb297fa05626012de72a1cdd4e5135a9f6dc4b7f9c8a53",
    "6742a178dfe5c7dc69ea3c7b9cebfb1477bb3074db98f1c8990c5686569bc58d",
    "2296638a0531acf18d172955d3da5e7845dc71ccaf76189b36b0217565c40a5a",
    "9e2e96abc6dcdbb799c00a106e50fb93c98298ea8c44fccd2282e12ac202a044"
  ]
}
```

Those original runs are simulation, calibration, uncertainty and monitoring analysis, respectively. Their original reference inputs and source collection `73e15c1f654b2943e437a5abe173b1d00ed58cbb9f1abab37ce6ac71308a1443` remain separate from the project's actual regional observations and Monitoring geometry. Select other completed analyses by their own retained case and run IDs.

Add the following argument to the same regional progression command:

```text
--chemistry-restored-selection ACTUAL_CHEMISTRY_SELECTION.json
```

This mode is mutually exclusive with `--chemistry-selection`. The progression freezes the exact selection file, validates the actual scientific project, reopens the original case through its native source/project verification, checks every selected completed run's case and project fingerprint, and verifies all original result artifact bytes. It pins full case/run record hashes in an immutable adoption record before the browser opens the retained results.

The browser reopens each selected analysis, operates its native result paging, downloads every retained result file, and exports the original editable chemical project with the selected completed analyses. The progression requests the original editable-project receive by default; add `"receive": false` to the selection JSON to inspect/export without that case receive. The regional progression owns the final complete Workspace transfer, so it does not ask the Chemistry child browser to make a second full-project archive.

This mode keeps the original case and run identities. It queues neither case editing nor new scientific calculation. The existing `--chemistry-selection` mode continues to perform its explicit edit/calculation course. Each mode has its own exact request identity; the original mode's fingerprint remains unchanged when the new option is omitted.

On resume, the adoption record checks the same native full records and original artifacts again. A completed child browser is reused only when its exact selected-file hash, receiving operator key, project, case, ordered run IDs and receive/transfer choices match. Keep the same output to continue the original native requests. Select a new output directory for a deliberately different receiving selection.

## Use an installed browser

`--browser-executable /absolute/path/to/chromium` selects an existing Chromium executable for the original Profile, Source updates, Chemistry, Monitoring and saved-view browser drivers. Use the current application containing the matching option in each driver. It is an execution setting and does not change the retained scientific request or selection fingerprint. The existing `--browser-channel`, `--headed` and `--video` options remain available.

For an actual cloud worker with the installed runtime used in this sprint:

```text
--browser-executable /tmp/chromium
```

The complete original Chemistry functional case can be prepared alongside the real regional data with `source_tools/prepare_chemistry_reference.py`; its emitted `chemistry-selection.json` supplies the existing `--chemistry-selection`. Its unchanged authored reference inputs and measured regional sources retain their separate source identities.

## Continue after a process interruption

Rerun the same command with the same output directory. The output's `.progression.lock` allows one owner. `progression.json` retains the original selection, current stage, native task IDs, browser output identities and completed transfer.

The original regional opening is frozen as `original-opening.json`. The final refreshed opening becomes the Workspace's current opening and `refreshed-opening.json`. When the source `--opening` path is that current Workspace file, the continuation still resumes from its frozen original selection.

Queue requests have deterministic operation IDs derived from this retained operation and exact payload. The same original failed/interrupted task is resumed. Each browser request is frozen before launch. Completed browser stages reuse their retained journals after a byte/hash check. A complete matching browser journal is adopted after a parent-process interruption between browser exit and the parent's checkpoint; its native workspace, request and opening identities are checked first. A browser interrupted after recording a queue task first resumes that task before operating its original controls again. The maintained Profile driver reopens its retained save request automatically; the Chemistry driver receives --resume only when this same output has its original request-state.json. A completed native child scenario is reopened under its original request. The source update's own immutable plans and checkpoint mappings retain native scientific work across re-entry.

The saved view selected for the final archive is frozen before transfer. A concurrent view edit is reported at that concrete transfer boundary so its original tasks can be reconciled. Completed receiving steps reuse their already-registered independent Workspace. When restore completed before the parent checkpoint, the continuation verifies its retained receipt, original backup and restore operation IDs, archive identity, current watershed/profile records, saved view and source plan, then reopens the same receiving project without staging the archive again.

## Read the original outcome

The last JSON line identifies the operation, original/receiving Workspace keys, source-update plan and `progression.json`. The journal records the exact failing stage and original traceback when a native command or browser step fails. Each subprocess keeps its original log and browser journey beside screenshots/video. Send that stage, task ID and traceback back to the same original receiving thread so its existing authors can repair the concrete exception.

The temporary private operator URL is written only beneath the local receiving directory with owner permissions and removed on normal closure. It is excluded from the scientific Workspace archive. The guide and public output use native record identities and local paths.

The continuation adds an operator of existing components. Scientific equations, raster preparation, source comparison, optimization, chemistry and native transfer formats remain in their original maintained implementations.


## Complete application source

The maintained application component catalogue explicitly includes this continuation, its original browser drivers and launcher, and supervised native worker modules in the guided journey closure. Build the current complete application through that catalogue. The original portable Workspace capture includes installed source families and verifies every retained member when restored; a profile-only source packet remains scoped to its published profile check.


## Include the original saved budget comparison

Add `--monitoring-comparison-selection BUDGET_SELECTION.json` when this complete receiving course already includes either the original Monitoring opening or a restored native Monitoring selection. The option forwards the exact frozen file to the maintained browser's `--comparison-selection` option.

For the original completed b9d5 scientific project, use the actual saved frontier:

```json
{
  "schema": "upstate.monitoring-budget-browser-selection/v1",
  "frontier_id": "2c1c770ffb1b00c85995a58ad93823407a628052b7b2b01d58aeced5387d12e5",
  "context_ids": [],
  "title": "Regional 217-catchment monitoring budget choices"
}
```

Omit `baseline_plan_id` to select that frontier's first original plan, or supply an exact member of its ordered plan inventory. The separately created six-search-area campaign can have a different native plan ID. It remains the selected campaign for the original course. Optional `context_ids` attach at most one saved observed context per exact frontier plan.

The progression retains the input's original path and byte hash in its request document and freezes it under the receiving output before browser dispatch. The maintained browser operates the saved frontier, previews and saves the comparison through its existing queue, downloads the original source/report packet, and reopens the exact comparison in a fresh browser and independently restored Workspace. It returns to the original campaign before the original campaign export stages.

Completed-browser adoption now checks the exact optional input hash and parsed selection, then opens the actual saved comparison through the native verifier. Its original network, frontier, baseline, title and selected source contexts must match the receiving request. Existing operation/task resumes remain on the original records.

Commands that omit this option preserve their earlier request documents, browser arguments and input identity. Adding a comparison to an already completed or running course changes the requested work: use a new receiving output for that expanded intent. Do not rewrite an in-flight original request.

The original Monitoring source feature and optional browser continuation are required in the receiving application (PR3521 and PR3561). The standalone direct Monitoring browser remains suitable when only the saved campaign/comparison course is requested; this option is for an already selected complete regional progression.


## Complete the Monitoring comparison's scientific report

The existing optional Monitoring browser can now continue from its selected saved comparison into the original scientific report composer. Add:

```sh
--monitoring-comparison-selection ACTUAL_BUDGET_SELECTION.json \
--monitoring-comparison-report-title "Regional monitoring budget choices — scientific report"
```

These flags work with either the existing original opening/receiving input or `--monitoring-restored-selection`. The report title requires the comparison selection. It must contain 1–300 browser characters after surrounding whitespace is removed. An optional `--monitoring-comparison-report-delivery ACTUAL_SAVED_DELIVERY_ID` carries the selected original delivery's ordered scientific study choices into the composer.

This forwards to the same maintained `source/run_monitoring_browser.mjs` using `--comparison-report-title` and optional `--comparison-report-delivery`. The original queue prepares the comparison's source family, previews the ordered source selection, renders or reopens its full scientific edition, and exports the complete report ZIP. The browser downloads every source/report member, then reopens the same source and edition in a fresh browser and through its existing complete Workspace restore. It returns to the original campaign before capturing that archive.

The original direct scientific composer retains Monitoring reports independently of physical model runs. This option adds no model calculation. The complete regional progression still performs its previously selected profile/source/native steps; use the direct maintained Monitoring browser command when only the report and campaign receiving course is needed.

The normalized report title and optional delivery ID enter `progression.json.request.monitoring_comparison_report` only when requested. The child invocation and `journal.input.comparison_report` carry that exact object. Previous commands keep their original request/input shape. Expanded report work gets a new receiving output directory; interrupted report work resumes from the same original command and durable child requests.

Completed-child adoption verifies the exact report option and the original immutable comparison source with `model.monitoring_report_source.inspect(..., verify=True)`. It then reopens the full scientific edition through the original native inspector and confirms that every requested report source remains in the edition's retained ordered-source selection. The existing native task checks still require all captured operations to be complete in the correct Workspace.

Use the merged direct Monitoring-to-scientific-composer join and the maintained report browser continuation together. The browser runtime must be permitted to navigate to the operator's actual local address. Keep this expansion on the same authorized receiving course and preserve any already-running invocation's original intent.
