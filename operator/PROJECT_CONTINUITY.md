# Project continuity

TokenJunkieLabs · Upper Savannah scientific application

## Carry a complete project forward

The Project continuity panel carries the existing scientific workspace together with its operator history and the original inputs needed by unfinished work. It uses the application's original action queue and scientific archive, with an integrated option to deliver the same project through the maintained incremental handover engine. The project, source editions, selected model runs, comparisons and maps retain their scientific identities.

Use this route when moving work to another computer, taking a complete recovery copy, or continuing a received project after an interrupted session.

## Ordinary archive journey

| Step | Work in the application | Result |
| --- | --- | --- |
| 1 | Open the intended workspace. In Guided journey, choose **Save view and transfer project**, or open Project continuity directly. | The current guided analysis and notes are saved before the handoff; saved transfers and previously received work appear for this project. |
| 2 | Choose **Create complete project**. | The application reads the original task history and identifies unfinished work that needs retained uploads or source previews. |
| 3 | Give the transfer a useful title and select the operations to carry. Keep native intermediate files selected when model stages need to continue. | The archive selection describes the actual project and chosen operation history. |
| 4 | Choose **Create project** and open its transfer operation. | The original archive operation saves the complete scientific workspace, original application source, transfer guide and outstanding input bytes. |
| 5 | Download the complete scientific-workspace ZIP from the completed operation. | One original package carries the project and its selected work. |
| 6 | In the receiving application, choose **Receive a project** and select that ZIP. | The original restore operation creates a new workspace and verifies its archived members. The transfer service restores uploads and source previews and reconciles retained native results. |
| 7 | Choose **Open received project** in the completed receiving operation row and inspect the received transfer. Use **Save or continue the selected analysis** to open its guide. | Original request identities, task states, attempt history and required inputs remain visible. Complete native outputs reopen from the restored scientific workspace. |
| 8 | Choose **Resume unfinished work**, review the selected operations, and continue them. | The original action queue executes the retained selections. A native run or comparison already completed before a lost response is reused. |

The task panel remains the place to follow progress and open outputs. When a transfer operation resumes after a lost response, its existing archive is reused through the original backup operation. The original task identity keeps the request attached to the same selection.

## Saved view, close and reopen

The complete-project form identifies the saved analysis and notes it will carry.
Use **Save or continue the selected analysis** to edit them in the existing
guide, then **Save view and transfer project** to save and return. The plan and
submitted request retain the saved journey and revision alongside the selected
task history. Command-line captures retain the current saved view when their
original transfer record is first created.

Both transport routes save that frozen view under the existing session lock
while making the original native archive. A changed view in another browser
produces the existing revision conflict before the archive is created. Refresh,
review the intended view and create a new transfer selection. Resuming a
capture whose original archive is already complete reuses that archive and
keeps any newer local notes untouched.

After receiving, open the separate workspace and inspect its history. Close
the operator normally and reopen it with that same receiving workspace and
operator-state directory. Completed results and the saved guide reopen;
**Resume unfinished work** explicitly queues the selected retained operations.

## What travels with the project

The scientific archive retains the original project workspace and application source. Project continuity adds its own immutable transfer record and printable HTML guide under `project-transfers/` inside that workspace.

Each selected operation includes its original operation ID, task ID, action, payload, request digest, captured state and attempt history. Completed operations carry their history and already retained native outputs. For unfinished operations, the service also retains original uploads referenced by `upload_id` or another `*_upload_id`, and original source previews referenced by `preview_id`.

Registered source previews carry their manifest and each original source member or companion file. Uploaded file and archive previews carry their original upload. All retained bytes use the same content-addressed source store as the existing scientific workspace.

Receiving recreates original uploaded filenames, media types, byte lengths and identities. When the receiving operator already retains an upload, its native reader verifies the full object and the transfer service reuses that exact record. Reopening or resuming the same transfer therefore keeps the existing uploaded bytes without streaming them into another temporary copy. Registered preview paths change to their receiving location, and the receiving task refers to that reconstructed preview. Scientific selection IDs remain attached to the original source edition, grid, parameter profile and scenario.

## Completed, unfinished and cancelled work

Receiving first checks whether an unfinished operation's exact result is already retained. This covers native run preparation, completed native runs, completed comparisons and source imports whose original manifest is already retained. A recognized result becomes a completed receiving task without repeating that native operation.

Other unfinished operations become resumable receiving tasks. Selecting **Resume unfinished work** sends them to the original operator queue. The queue's existing task identity, workspace gate and action implementation continue to govern execution.

Cancelled operations remain cancelled. They can be explicitly selected in the receiving panel when continuation is intended. If a received operation belongs to an additional application component, its original action and selection stay present; the panel enables it once that component is installed and its action is available.

The received task links to its previous workspace, task and request digest. A project transferred more than once carries that chain of origin. Reopening or receiving the same transfer preserves the receiving task's subsequent progress.

## Direct command-line route

The command-line component uses the same source `Operator`, action queue, native archive and transfer service. Run it when the local browser operator for that state directory is closed so its existing single-owner lock can be acquired.

List the original work before creating the transfer:

```bash
python operator/project_continuity_cli.py \
  --workspace /path/to/scientific-workspace \
  --operator-state /path/to/operator-state plan
```

Create a complete project:

```bash
python operator/project_continuity_cli.py \
  --workspace /path/to/scientific-workspace \
  --operator-state /path/to/operator-state \
  snapshot --title "Upper Savannah — working project" \
  --operation-id transfer-upper-savannah-20261012
```

The completed JSON result contains the native ZIP path, its byte length, SHA256, transfer ID and task record. Progress and the request ID are printed separately to standard error. Reuse the same operation ID with the same selection to recover a lost response.

Receive that package in another operator:

```bash
python operator/project_continuity_cli.py \
  --workspace /path/to/receiving-start-workspace \
  --operator-state /path/to/receiving-operator-state --create \
  receive /path/to/complete-project.zip \
  --operation-id receive-upper-savannah-20261012
```

The receiving result identifies the restored workspace directory, workspace key and recovered transfer. Use that restored workspace directory for continuation:

```bash
python operator/project_continuity_cli.py \
  --workspace /path/from/receiving-result/workspace \
  --operator-state /path/to/receiving-operator-state \
  resume TRANSFER_ID_FROM_RESULT \
  --operation-id resume-upper-savannah-20261012
```

The resume command waits for the selected resumed operations and reports their actual terminal states. Its exit status is nonzero when an operation fails or its original component is unavailable.

Use repeated `--task-id` selections with `snapshot` to choose original tasks, or with `resume` to choose received tasks. Without those options, a snapshot includes all ordinary project operations and resume continues unfinished noncancelled work. `list` shows retained transfers; `inspect TRANSFER_ID` prints a complete record. `--without-intermediates` selects the existing compact scientific archive mode.

## Application integration

The maintained host is `operator/extension_registry.py` with `operator/web/extension_host.mjs`. Its installed descriptor directory is `operator/extensions/`. Copy all seven supplied source files into the current application, preserving their relative paths. The current manifest is `operator/extensions/project-continuity.json`; revision 6 preserves the maintained descriptor directory and gives the continuity implementation distinct filenames beside the original incremental transport adapter.

The descriptor imports `extension_modules.project_continuity` and calls `create(operator, fault)` through the host's explicit factory binding. The original operator assigns its fully loaded `ExtensionRegistry` to `operator.extensions`. The provider reads that registry's native and extension action union at each invocation, so unfinished operations from later installed scientific desks remain eligible for continuation. Factory creation itself needs no completed action union.

The service lives in `operator/project_continuity.py`. Its explicit service API is `ProjectContinuity(operator, Fault, supported_actions=all_registered_actions)`. The action names are `workspace.snapshot`, `workspace.receive` and `workspace.recovery.resume`; the installed provider dispatches each through the same `service.invoke(task)`.

The registry supplies `data.project_continuity` with `transfers` and `accepted_actions` fields in the original state response. The service's `read(workspace_key, operation, query)` serves `plan`, `list` and `inspect` at the three exact `/api/extensions/project-continuity/` routes. Inspection takes the query's `transfer_id`. The task-decoration binding exposes the native archive and printable guide downloads. The restore-verification binding verifies every retained transfer record and its original input bytes against the actual receiving Workspace before registration.

The browser module `operator/web/project_continuity.mjs` exports `attachProjectTransfers(context)`. Context uses the original `getState`, `api`, `endpoint`, `openForm`, `submitAction`, `detail`, `fileList`, `uploadFile` and `showTask` functions. Its returned panel exposes `mount(container, state)`, `update(state)`, `detach()` and `dispatch(button)`. The maintained host calls update on accepted state refreshes, including task-only refreshes. The view is `project-continuity`, its navigation title is **Project continuity**, and its declared global action prefix is `transfer-`.

The standalone command-line route uses its thin `TransferOperator` subclass with both the original scientific operator and the maintained extension-enabled operator. It initializes the existing operator and installed registry before adding its direct action fallback, then refreshes the full available action set for each transfer invocation.

## Receiving check

Use the original application's retained scientific workspace for the receiving check. Include one actual completed run or comparison and an actual unfinished operation with an original upload or registered source preview. Create the complete project, receive its ZIP through the original restore action, inspect that receiving history, and resume the selected unfinished operation through the original queue.

The useful outcome is a restored project whose completed native result is available and whose selected unfinished work actually continues from its retained original input. The full native model does not need to rerun merely to check transfer behavior.

## Incremental handover with saved work

For a large project or a later edition, choose **Incremental handover with resumable parts** in the Create complete project form. Project continuity first saves the original operation history and required unfinished inputs in the scientific Workspace. It then invokes the installed original `project.transfer.capture` action with that same task identity. The maintained transport performs the original native backup and indexes its complete members into reusable blocks.

The completed operation provides the original transfer manifest and this project’s operation guide. In the receiving operator, use **Receive a manifest or part** and select the manifest. Open **Retained handover editions**, inspect that edition, and save its missing-block request. Return the request to the sender and use **Create transfer parts**. Receive each original part on the destination; the same maintained cache preserves completed blocks between parts and sessions.

The edition inspector shows the actual original file count, logical bytes, verified blocks, remaining range bytes and whole-block part bytes. Once every required block is present, choose **Receive independent project**. The original transport restores a new native working copy. Project continuity then verifies its saved transfer inputs, restores unimported uploads and source previews, reconciles already retained results, and rejoins its original requests to this operator. Switch to that received workspace and choose **Resume unfinished work**.

The installed transport owns block capture, missing-byte requests, part creation, part receiving and native archive reconstruction. Project continuity owns the selected scientific operation history and receiving task reconciliation. Both use the original operator queue and authenticated file tickets. Transfer-control tasks stay with the operator that executed them; their nested archives and caches are not treated as outstanding scientific inputs.

### Command-line handover

Use the exact snapshot identity returned by the sender’s completed task in place of `SNAPSHOT_ID`. Use each computer’s own existing workspace and operator state directories.

```sh
python operator/project_continuity_cli.py --workspace /sender/project --operator-state /sender/operator snapshot --transport incremental
python operator/project_continuity_cli.py --workspace /receiver/project --operator-state /receiver/operator accept-manifest /incoming/project.transfer.json
python operator/project_continuity_cli.py --workspace /receiver/project --operator-state /receiver/operator inspect-handover SNAPSHOT_ID
python operator/project_continuity_cli.py --workspace /sender/project --operator-state /sender/operator create-parts SNAPSHOT_ID --request /incoming/receiver.missing.json --payload-mib 64
python operator/project_continuity_cli.py --workspace /receiver/project --operator-state /receiver/operator receive-part /incoming/edition.uptransfer.zip
python operator/project_continuity_cli.py --workspace /receiver/project --operator-state /receiver/operator transport SNAPSHOT_ID
python operator/project_continuity_cli.py --workspace /receiver/project --operator-state /receiver/operator receive --snapshot-id SNAPSHOT_ID
```

Each receiving part is an ordinary retained native operation. Repeat the `receive-part` command for all original part files. `inventory SNAPSHOT_ID` exports the maintained full HTML/CSV/JSON inventory; `assemble SNAPSHOT_ID` reconstructs an ordinary native ZIP when another consumer needs that format. Every mutating command accepts `--operation-id` to resume the same request after a lost response.

### Installation alongside the maintained transport

The original incremental source is published at [commit a4be1cce327bbf648d5a2652df2c49c929800d5a](https://github.com/woahwhattheheck/public-commons-sprint-2026/commit/a4be1cce327bbf648d5a2652df2c49c929800d5a), including `model/project_transfer.py`, `model/project_transfer_workspace.py` and `operator/project_transfer.py`. The maintained `project-transfer.json` descriptor owns those actions and its provider exposes the same instance through `operator.project_transfers`. The continuity service uses that instance. Current registered hosts use this single descriptor path; the standalone legacy installer is for older hosts.

Copy these seven continuity files at their supplied paths. For an earlier ES-9960 revision, first preserve or remove the exact superseded continuity copies of `operator/project_transfer.py` and `operator/project_transfer_cli.py` from that older source map; the former path belongs to the maintained transport adapter in the combined application. The current continuity descriptor binds `extension_modules.project_continuity`, and its browser asset is `project_continuity.mjs`. The source map lists the precise superseded paths and body hashes so the cumulative installer can migrate only those known copies.

The additive read route `GET /api/extensions/project-continuity/transport` lists the original cached editions. With `snapshot_id`, it returns the original transport’s receiving report without the complete per-member array; the maintained inventory export carries that array in full. The `workspace.snapshot` payload accepts `transport: "archive" | "incremental"`. `workspace.receive` selects exactly one `upload_id` or `snapshot_id`. Existing saved transfer records continue to reopen.


## Preserve the current application when moving the project

After composing the current application, apply the included native archive-scope join:

```sh
python source_tools/install_project_continuity.py /path/current/application
```

The current original operator’s `run.start` path imports `ecsa_runs.upstate`. The earlier portable archive scope predates that package. The installer adds the existing `ecsa_runs` directory and the other observed cumulative source/support directories to the original archive’s explicit application scope. It also retains the currently installed root entry scripts, runtime requirement file and operating guides. Only those named members actually present in the selected application are added.

The installer edits the original scope tuples while preserving surrounding source. It keeps the exact prior portable module outside the application tree, checks for concurrent changes before replacing the file, and can be repeated without changing an already joined scope. The same native backup and restore implementation still retains and verifies the complete original archive members.

Received unfinished `run.prepare` operations use the installed native `model.model_selection.normalize_selection` and `grid_models` helpers when reconciling an already retained run. A selected NDR-only or SDR-only run therefore keeps its actual current native identity, as does the historical combined-model selection.
