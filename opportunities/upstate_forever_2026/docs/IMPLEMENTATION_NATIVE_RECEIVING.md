# Receive the original Greenwood Implementation project

The maintained receiver carries the original Greenwood parcel/source-review plan through the installed application. It imports the supplied plan, attaches both original source files, retains a complete dated native report, captures the entire existing scientific Workspace and installed application through Project transfers, and opens a new received Workspace. The received plan keeps its exact revision, original source bytes, report edition and revision history.

## Run in the existing operation

Use a fixed cumulative application checkout containing PR3091, PR3202 and PR3193 plus this receiver. The existing scientific Workspace supplies its real project identity and all already-retained source/model work.

From `opportunities/upstate_forever_2026`:

```sh
python -B source_tools/receive_implementation.py \
  --workspace /absolute/path/to/existing-eco-workspace \
  --operation /absolute/path/to/existing-eco-operation/field12-receiving
```

The operation output tree must be outside both the Workspace and application. Ordinary Python 3.10+ can receive a source/profile/Implementation Workspace. When an existing Workspace contains records requiring scientific dependencies during its original native validation, use that Workspace's current equipped interpreter. The receiver keeps those records in the complete archive.

The default report date is `2026-10-13`. Supply `--as-of YYYY-MM-DD` when intentionally selecting another reporting date; use a new operation for a different immutable selection.

## Standalone fieldwork installation

The current `install_implementation.py` receives the report-retention helper, this native receiver and all three original Greenwood inputs as required source members. It also receives the portable/native operating guides when they are supplied. Existing economics and observation integrations remain in the same package.

```sh
python -B install_implementation.py \
  --application /absolute/current/application \
  --source-root /absolute/pinned/full-source/opportunities/upstate_forever_2026
```

Use the current complete scientific application for its shared Workspace, Project transfers and portable core. The fieldwork installer keeps its original source-composition/preimage checks, staged writes and backups; it does not replace those shared core modules. The cumulative installation supplies those maintained core dependencies.

## Original source

The exact original plan is `source/implementation/20261013/greenwood-review-plan.json`. Its original parcel is Greenwood County PIN `6913-674-230`, OBJECTID `1`, CRS EPSG:3361. The plan contains the existing source-review tasks and unresolved observations; native receiving preserves the original scientific statements and does not complete tasks or add field measurements.

The receiver verifies the following original source bytes before import:

| Source | Bytes | SHA256 |
|---|---:|---|
| Prepared Greenwood plan | 89,214 | 28ace942d3dcf9f32b10e3f51fcc5a90e31cb371dd0e6712c97992e9382583a8 |
| Original county parcel response | 1,709 | e4fd893f7ab655d1a9fd8e2944d9122a7786abb26d55ec85310b04ed39f49fab |
| Original published-method source-interval result | 60,852 | 864d7d51bf0893d1c26d159ca55417432422bc8ddffd897dc2df87003e080bb4 |

The two original response/result files are attached through `ImplementationStore.attach_file`. Each attachment is a normal native revision with a retained original file. An already-imported source plan or already-attached body is reused through its native API. Existing later human or operator edits remain preserved.

## Complete native course

1. Open the existing Workspace and retain the immutable receiving selection.
2. Import the original plan and attach both verified source files.
3. Select and retain the exact native plan revision. Create its complete HTML, summary, plan JSON and seven field tables; retain the original report edition in the plan bank.
4. Call `NativeProjectTransfer.capture`, which uses the original whole-Workspace/application `portable.backup`, original locks, archive validation and content-addressed transfer store.
5. Call `NativeProjectTransfer.restore` into a fresh `received/` directory. Reopen the exact plan revision, native event history, retained report and both attached original bodies.
6. Write `receiving.json` with the actual restored Workspace/application paths, snapshot identity, plan revision, report files and Implementation receiving summary.

The receiver compares original event values while allowing the local `revision_ref` path to change when the project moves. The native restore validates all archived file bodies and semantic source records. The ordinary `model.implementation_cli report` action also retains its complete report edition in the saved plan bank and returns `retained_report`, matching the existing operator behavior.

## Reopen and continue

`receiving.json` is the completed result. Its `report_files` map gives usable paths to the actual received HTML, plan, summary and CSV files. Its `receiving.workspace` and `receiving.application` identify the independent received project.

In the installed operator, the Project transfers snapshot detail and completed receiving task show **Implementation plans**. Choose **Open saved plan** to open the received Workspace and exact revision in **Implementation & fieldwork → Handover**. **Retained original files** and **Saved native report editions** create current native download tickets. The existing browser draft remains retained.

For an ordinary CLI reopen:

```sh
python -B -m model.implementation_cli \
  --workspace /absolute/path/to/field12-receiving/received/workspace \
  show greenwood-original-parcel-source-review-20261013
```

Read the selected revision from `receiving.json` when inspecting a specific historical edition; later fieldwork can add normal immutable revisions.

## Resume the same operation

Repeat the exact original command. The immutable source/Workspace/report-date selection prevents a different project from silently taking over the directory. The exclusive operation lock rejects simultaneous receiving processes.

Native imports and attachments are idempotent. A complete selected report is reused; an interrupted partial report remains retained and a new report attempt is recorded. The native transfer store reuses the exact completed snapshot and handles a restore whose last reply was lost. An interrupted original ZIP staging file remains retained; this course records a separate native capture attempt under the same receiving operation.

The small `state.json` contains actual progress, attempts and the last concrete exception. `code_editions` records the installed receiver/native source identities used by each continuation. Keep the application checkout unchanged during an active capture so the original archive guard can finish. A completed course can be reopened without recapturing later recipient edits.

## Existing swarm receiving

This is one continuation of the existing Ecosystem profile/Community/utility operation. Bind the command to the accepting host's actual Workspace and output path, then return its stdout or first exception and `receiving.json`. The receiver requires no new original county download, parcel inference or native NDR/SDR run.

## Receive an existing fieldwork plan

The same full report and Workspace receiving course accepts an original saved plan:

```sh
python -B source_tools/receive_implementation.py \
  --workspace ACTUAL_WORKSPACE \
  --operation ACTUAL_OPERATION/existing-fieldwork \
  --plan-id ACTUAL_PLAN_ID --revision ACTUAL_REVISION
```

The explicit revision stays selected across interruptions. Omitting `--revision` selects the current saved revision on the first attempt. All local-file sources of that selected plan travel with its history and retained report. The original Greenwood course remains the default when `--plan-id` is omitted.

## Continue an actual Monitoring campaign

Use the campaign and revision displayed in the original Monitoring workspace. This course runs the maintained handoff, checks every member of its original source ZIP, retains the exact Implementation report, captures the complete Workspace, restores it into a fresh directory and reopens the same fieldwork revision and source package.

```sh
python -B source_tools/receive_monitoring_fieldwork.py \
  --workspace ACTUAL_WORKSPACE \
  --operation ACTUAL_OPERATION/monitoring-fieldwork \
  --campaign-id ACTUAL_CAMPAIGN_ID \
  --revision-id ACTUAL_SAVED_REVISION_ID
```

The operation directory holds the immutable selection and handoff, native state/progress and final `receiving.json`. Its `fieldwork` directory holds the complete original report/capture/restore course. Repeat the exact command to continue an interrupted operation. A saved handoff keeps its original fieldwork revision even when later edits have advanced the live plan. The original scientific scenario, model parameters and campaign events remain those selected in the actual workspace.
