# Saved merchant workflows

Use **Workflows** in the original merchant operator console to turn saved native requests into a complete, reusable operation. A workflow keeps its exact request revisions, input mappings, required native results and ordered progress in the same private SQLite workspace as **Requests** and **Customers**.

Open the console through [Applications](APPLICATIONS.md) or the existing [merchant host](README.md). Select an operator profile bound to the displayed host, save the native requests in **Tools**, then arrange those saved revisions in **Workflows**. Each run keeps its original inputs and native call IDs across browser reconnects, host restarts and an explicit handover to another console workspace.

## Complete a merchant delivery

The maintained merchant workflow has seven steps:

| Step | Original native tool | Input and resulting work |
| --- | --- | --- |
| Stage | `merchant_stage` | Select a configured source alias and release ID. Retain the original immutable release and its digest. |
| Activate | `merchant_activate` | Use the staged release ID and digest with the reviewed current selection generation and reason. Retain the original selection result. |
| Start | `merchant_start` | Bind the selected generation and release digest. Retain the actual seller instance and require its native runtime to be running. |
| Generate customer | `merchant_client_export` | Use the returned seller instance and a selected customer export ID. Generate the original client files in the configured private export store. |
| Read manifest | `merchant_client_export_manifest` | Open that exact customer export and retain the completion manifest and its file identity. |
| Stop | `merchant_stop` | Stop the original seller instance returned by Start through its owning merchant process. |
| Inspect status | `merchant_status` | Read the final native selection, history and ownership state. Require the final state appropriate to this operation. |

The result is a retained merchant release, original seller history, complete customer export and final ownership observation. The existing **Customers** page receives the generated export using its actual export ID and manifest SHA-256. It preserves the native files, partial transfer checkpoints and original customer archive described in the [console guide](README.md#receive-an-original-customer).

Use each tool's configured schema and actual returned values when saving the requests. Selection generation, source digest, seller instance, provider request IDs and workspace aliases keep their original meanings. A workflow can pass these values from inputs or an earlier result; it does not calculate a new native generation or interpret a status message as a completed operation.

For a portable run, choose checkpoints that fit the native provider's lifecycle. The receiving workflow pauses after staging, transfers to the named receiver, starts and stops the seller there, pauses again, then returns to the source console for the final status. The process that starts a seller remains its native stop owner.

## Save a workflow edition

1. In **Tools**, choose the configured tool and save a named request revision with its complete native argument object. Repeat for the requests needed by the operation.
2. Open **Workflows** and choose **New workflow**.
3. Add each saved request in execution order. Give each step a useful name. Its stable step identifier appears below the original draft ID and revision.
4. Enter any input mappings and required result values as JSON arrays. Select **Pause after this step** where an operator or receiving workspace should take over.
5. Choose **Save revision**. Review the resulting workflow revision and SHA-256.
6. Supply one complete JSON object in **Workflow inputs**, then choose **Run saved workflow**.

A workflow references immutable draft revisions. Editing the underlying request later leaves the saved workflow unchanged. To use an updated request, save a new workflow edition that selects the intended request revision. Running an existing workflow always selects its exact edition, even when a newer one exists.

**Save as new workflow** creates another workflow identity. A changed existing edition requires its current `expectedRevision`; conflicting concurrent edits return `CONSOLE_WORKFLOW_REVISION_CONFLICT`. Saving the same normalized steps and name returns the existing edition as unchanged.

The editor supports 1–128 sequential steps. Each step can have up to 256 separate input mappings and 64 required result conditions. Names are limited to 160 characters. These limits are enforced by the original record parser as well as the native request capacity at dispatch.

## Bind actual inputs and earlier results

Each mapping has an argument `target`, a `from` source and a source `pointer`. An earlier-step mapping also names that earlier `stepId`.

| Source | Available value |
| --- | --- |
| `inputs` | The complete JSON input object retained for this run. |
| `step` | The complete retained native result of the named earlier completed or recovered step. |
| `run` | The current run's `id`, `profileId`, `stepId` and original native `requestId`. |

For example, a request can select a configured source and release ID from the run's input object:

```json
[
  {"target":"/source","from":"inputs","pointer":"/source"},
  {"target":"/id","from":"inputs","pointer":"/releaseId"}
]
```

A later activation request can use the digest returned by the saved Stage step:

```json
[
  {"target":"/expectedDigest","from":"step","stepId":"stage","pointer":"/release/digest"},
  {"target":"/expectedGeneration","from":"inputs","pointer":"/expectedGeneration"}
]
```

Use the actual displayed step identifier in place of `stage`. The remaining activation arguments stay in its saved native request unless another mapping explicitly supplies them.

Pointers use JSON Pointer syntax. An empty pointer selects the complete source value; `/name` selects a property; `/items/0` selects an existing array position. Encode a slash in a property name as `~1` and a tilde as `~0`. An empty target replaces the complete native argument object and therefore requires an object-valued source.

The saved argument object must already contain each intermediate target container. An object mapping can set a leaf property, while an array mapping must select an existing array position. Two mappings cannot overlap at the same target or at an ancestor and descendant target. An earlier-result mapping can only refer to a preceding step.

Values are copied as their original JSON types. A missing value, invalid target or unfinished source step leaves the run waiting with an actionable error. Open the exact saved inputs or native return, correct the intended reusable request in a new workflow edition when necessary, and preserve any original operation that has already been accepted.

## Require the native result needed by the next step

A step completes only after its original call has a retained `COMPLETE` result whose `isError` is not true and all saved result conditions pass. A condition chooses either one exact JSON value with `equals` or a nonempty set with `oneOf`:

```json
[
  {"pointer":"/runtime/state","equals":"RUNNING"}
]
```

For a provider that returns one of several acceptable final states:

```json
[
  {"pointer":"/state","oneOf":["COMPLETE","UNCHANGED"]}
]
```

Use fields and states supplied by the actual selected native provider. A missing field fails the condition. Equality compares JSON values, including their types and object contents.

A successful HTTP response or a returned job identifier can still describe unfinished provider work. Save the needed result condition or use the provider's original status/recovery operation. The workflow driver preserves the original return and waits when the selected native state is not ready for the following step.

## Operate the saved run

The run view displays its original source workspace, current owner, execution host fingerprint, workflow edition, request digest, input digest, progress and ordered events. **Open original workflow revision** shows the immutable definition used by that run. **Open request** opens each prepared original call and its retained native return.

| Run state | Meaning and control |
| --- | --- |
| `READY` | The run has been durably accepted or explicitly continued. Its owner can prepare the next original request. |
| `RUNNING` | The driver is progressing through its saved steps or retaining an accepted native call. |
| `PAUSED` | The run is held at its selected checkpoint. **Continue same run** resumes the same run and inputs. |
| `WAITING` | The run needs its current native result, an original recovery, a current host binding or another displayed correction. |
| `COMPLETE` | Every step has its required native result or an explicitly linked successful recovery. |

**Pause after current request** records a request to stop after the current native call returns. It leaves that accepted native call under its original owner. **Pause after this step** is part of the immutable workflow edition and records the same checkpoint automatically once that step completes.

**Continue same run** is a separate action on the selected current run revision. It does not create a new run or change the retained inputs. A repeated Start with the same original ID only reopens the saved run; it does not implicitly continue a paused run.

The original host's **Stop** path refuses new work, asks workflow drivers to pause, and drains accepted calls through the existing provider lifecycle. Reopen the same saved console directory to inspect its retained run and choose **Continue same run**. The new listener can use a different port while the console workspace identity remains unchanged.

## Recover a lost browser response

Before sending Start or Handover, the browser retains the complete original action in IndexedDB, keyed by console workspace, profile and action kind. The pending panel displays the original action and its target. The access token remains in the active browser session.

Use **Recover original start** or **Recover original handover** to reconcile that displayed action. These controls carry the exact retained request, even after changing tabs, reopening the page or choosing another workflow. Starting another action requires resolving the existing pending action for that workspace and profile.

The server reserves a Start by its original run ID and exact request digest. Repeating that request returns the saved run with `reused:true`. A conflicting body under that ID is rejected. A Handover uses a separate `handoverId`; replay checks the same destination workspace, destination host, source revision and note against its original handover event.

A browser interruption can happen after the server has accepted the request. The original readback uses the exact run ID or handover event. If authentication has expired, reconnect with the original host authorization and recover the displayed pending action. The retained action belongs to the earlier attempt until that original outcome is resolved.

IndexedDB belongs to the browser's origin and profile. After moving to a different host address or browser, reopen the retained run from the server's **Workflows** history. The private SQLite store and exported profile preserve accepted work independently of the browser.

## Resolve an unfinished native request

An ended listener may retain the original call but lack its native return. The workflow reports `CONSOLE_WORKFLOW_NATIVE_PENDING` or `CONSOLE_WORKFLOW_RETURN_UNRETAINED` and keeps the original step open. Continuing that run reopens the existing call; it does not dispatch the original mutation again.

1. Choose **Open original request and recovery** in the run or open its step in **Requests**.
2. Inspect the exact native arguments and original operation identifiers.
3. Use the existing recovery picker to prepare the provider's original read or recovery control. Save it as a request linked through `recoveryOf` to the unfinished call.
4. Run that native recovery and inspect its complete retained result.
5. Return to **Workflows**. Select the completed linked recovery, describe how it resolves the original step, and choose **Use recovered result**.
6. Review the run's paused state and choose **Continue same run** when the next saved step is appropriate.

The receiver accepts a recovery only for the current unfinished step, in the same operator profile, with a completed successful original call and the exact `recoveryOf` link. Its result must satisfy that step's saved conditions. The original uncertain call remains in history; the step records the selected recovery call, its native result digest and the operator's explanation.

The resolver waits for a currently active original dispatcher to finish. It checks the durable dispatcher identity and actual activity rather than treating the continued existence of the Node process as an active native call. After a transfer, the named receiver can reconcile an orphaned original request through the same native recovery path.

## Hand over a paused run and return it

A profile archive carries a complete history copy. An explicit handover names the workspace that may perform the run's remaining native calls. The receiving host must expose the required original tools and have the actual provider state needed by the unfinished operation.

### Prepare the receiver

Open the destination console through its own saved Applications selection. On **Host**, record its console `workspaceId` and `configurationFingerprint`. Import the source profile for review. Bind that profile to the destination's reviewed host configuration using the original profile binding control.

A review copy displays `RECEIVED_COPY` custody until its workspace is the run's named owner. Reading and importing a profile leaves native calls under their current owner.

### Release the original owner

On the current owner:

1. Open the unfinished run and choose **Pause after current request**.
2. Let its accepted native call return. Reopen the current run revision.
3. Enter the destination workspace ID, configuration fingerprint and a concrete handover note.
4. Choose **Hand over and export profile**. Retain the resulting original profile export.

The handover transaction checks the current run revision, ownership and durable native dispatcher activity. It records an owner-release event before the source exports the profile. The original run's source workspace, start request and initial host fingerprint remain immutable; `ownerWorkspaceId` and `executionHostFingerprint` record the authorized receiving location.

Import that complete post-handover archive into the already reviewed destination profile. The original archive receiver extends its verified history, preserves the destination's local profile binding and shows the same run as owned. Choose **Continue same run** there.

### Return accumulated work

Pause and drain on the receiving owner. Hand over the same unfinished run to the original source's actual workspace ID and current host fingerprint, then import the resulting complete profile on the source. The receiver combines matching immutable definitions and requests with the later contiguous run-event history. Already accepted and completed steps retain their original calls; the source continues only the remaining steps.

Same-profile receiving accepts an append-only history extension. It rejects conflicting immutable request editions, different original run requests, conflicting finalized native returns and divergent event branches. Compatible repeated imports return the original received state. Local customer files already verified by the receiving console remain in its custody.

Transfer provider state through that provider's existing backup, release or receiving operation when the selected native operation requires it. A console profile carries workflow/request history and customer identities; the original provider and customer archives carry their actual private files.

## HTTP API

All routes below are under `/operator/api/` on the original loopback merchant listener. Use its existing bearer or OAuth resource authorization. POST bodies use `application/json`. The handler applies the existing Host/origin checks and native tool authorization; definitions, runs, histories and exports are filtered or checked through those original permissions.

| Method and route | Request or query | Return |
| --- | --- | --- |
| `GET workflows?profile=PROFILE_ID` | Original profile ID. | `{workflows,runs}`; latest definitions and saved run summaries. |
| `GET workflow/WORKFLOW_ID?revision=N` | Optional exact positive revision; omitted selects latest. | `{definition}`, including each original request's tool, revision and digests. |
| `GET workflow-run/RUN_ID` | Exact original run ID. | `{run}`, complete inputs/events and eligible completed recovery calls. |
| `POST workflows` | `{id?,profileId,name,expectedRevision?,steps}`. | `{definition,unchanged}`. |
| `POST workflow-runs` | Exact Start body below. | HTTP 202, `{run,reused}`. |
| `POST workflow-resume` | `{id,expectedRevision}`. | HTTP 202, `{run}`. |
| `POST workflow-pause` | `{id,expectedRevision}`. | `{run}`. |
| `POST workflow-resolve` | `{id,expectedRevision,stepId,callId,note}`. | `{run}` with the linked recovery retained. |
| `POST workflow-handover` | `{id,expectedRevision,handoverId,workspaceId,hostFingerprint,note}`. | `{run,reused}`. |
| `GET export/PROFILE_ID` | Original complete profile. | Downloadable profile JSON including workflow definitions, runs and events. |
| `POST import` | `{archive,expectedContentSha256}`. | Original atomic profile import result. |

A saved step has this shape:

```json
{
  "id": "stage",
  "name": "Stage selected merchant",
  "draftId": "original-stage-draft",
  "draftRevision": 1,
  "bindings": [
    {"target":"/source","from":"inputs","pointer":"/source"},
    {"target":"/id","from":"inputs","pointer":"/releaseId"}
  ],
  "expect": [],
  "pauseAfter": true
}
```

A Start body contains:

```json
{
  "id": "original-workflow-run",
  "profileId": "original-operator-profile",
  "workflowId": "merchant-delivery",
  "workflowRevision": 1,
  "expectedWorkflowSha256": "DISPLAYED_WORKFLOW_SHA256",
  "expectedHostFingerprint": "DISPLAYED_HOST_FINGERPRINT",
  "inputs": {
    "source": "configured-source-alias",
    "releaseId": "selected-release",
    "customerExportId": "selected-customer",
    "expectedGeneration": 0
  }
}
```

Replace the displayed SHA placeholders with actual lowercase 64-character hex digests and inspect the native generation before selecting its value. Preserve the complete JSON body and ID before sending. Run, workflow, step and handover IDs allow 1–128 ASCII letters, digits, underscores or hyphens, beginning with a letter or digit. Native identifiers used inside tool arguments continue to follow their own schemas.

An API client should retain Start and Handover request bodies durably, resolve their exact IDs after a response loss, then use explicit Resume for an accepted paused run. Other controls require the latest positive run revision. Use the returned error code and current readback to reconcile a stale revision or changed host before creating another operation.

## Persistence, receiving and installed source

The existing console database adds `workflow_definitions`, `workflow_runs` and `workflow_call_refs` with `CREATE TABLE IF NOT EXISTS` on open. Existing profiles, draft revisions, calls and customer deliveries remain in their original tables.

Workflow editions use `stellar-forge.merchant-workflow.v1`; runs use `stellar-forge.merchant-workflow-run.v1`. They travel inside the original `stellar-forge.merchant-operator-profile.v1` archive under optional `workflowData`. Archives without workflow data still import through the original reader.

Export takes one SQLite transaction snapshot across profile, drafts, calls, customers and workflows. Import validates the complete canonical content digest, immutable source references, exact JSON hashes, ordered event history and owner-release chain before the original transaction commits. Upgrade both receiving consoles to a source edition with workflow support before exchanging unfinished runs.

The existing `stellar-forge/mcp-merchant-operator` distribution component recursively includes the new console modules, browser module and receiving executable. Source installation uses the maintained distribution producer and original Applications registration. Select the updated READY runtime, review the original configuration and private console directory, then use the existing managed Start/Open/Stop controls.

| Source | Responsibility |
| --- | --- |
| `records.mjs` | Shared canonical JSON, hashes and original record validation. |
| `workflow-records.mjs` | Immutable workflow editions, run/event storage, original call reservation guard and archive merge. |
| `workflows.mjs` | Sequential native driver, required results, pause, recovery and receiving ownership. |
| `service.mjs` | Original authenticated routes, native calls and close/drain. |
| `public/workflows.mjs` | Saved workflow editor, run controls and durable browser actions. |
| `../receiving/workflow-journey.mjs` | Complete native merchant workflow and receiving operation. |

## Run the complete native receiving workflow

Run the original maintained receiving executable with Node 24 and the existing Chromium and Playwright installation:

```sh
node stellar-forge/mcp-merchant-operator/receiving/workflow-journey.mjs \
  --directory /private/receiving/merchant-workflow \
  --chromium /absolute/path/to/chromium \
  --playwright-module /absolute/path/to/playwright \
  --source-commit SELECTED_40_CHARACTER_GIT_COMMIT
```

`--directory` selects the original private receiving operation. `--source-commit` is its actual selected 40-character Git commit. Supply the real browser executable and installed Playwright module through the corresponding flags or the original `STARFORGE_CHROMIUM` and `STARFORGE_PLAYWRIGHT_MODULE` environment variables.

The executable operates the seven saved native steps through the original merchant host. It retains the Stage checkpoint, moves the run to the named receiver, completes activation, seller start, customer generation, manifest and owned Stop, then returns the run to the source for its final status. It exercises the actual browser's retained Start/Handover actions, reads the original native returns and receives the complete customer and profile archives.

The receiving directory preserves the persistent browser, original source and receiver SQLite workspaces, selected ports, exact UI requests retained before dispatch, native checkpoints and report, and complete original archives. Rerun the same directory to continue that operation from its retained state. Read its returned phase and native outcome before choosing a following source or receiving action.

