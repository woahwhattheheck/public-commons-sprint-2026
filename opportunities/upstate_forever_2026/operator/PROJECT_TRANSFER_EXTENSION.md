# Original project transfer desk

The registered **Transfer and restore** view connects selected study exports and current Workspace backups to the existing incremental transfer protocol. It uses the original operator task queue, original TransferStore, original authenticated file tickets, and original portable restoration.

The maintained application already includes the transfer core. Install these complete successor files together:

- `operator/project_transfer.py`
- `operator/extensions/project-transfer.json`
- `operator/web/project_transfer_desk.mjs`
- `operator/web/project_transfer.css`
- `operator/PROJECT_TRANSFER_EXTENSION.md`

The installed extension registry discovers the same `project-transfer` descriptor. Its original backend factory remains `ProjectTransfers(operator, fault)`; the client factory is `createProjectTransferDesk(host)`. The existing extension host supplies the operator capabilities and navigation. Restart the original operator after changing Python source, then refresh the browser to load the updated descriptor and assets.

## Send a completed scientific study

1. Export the selected runs, experiment programmes, or saved scientific analyses in the original selected-study desk.
2. Open the completed export in **Transfer and restore**, or choose it in this desk's **Completed study export** selector.
3. Choose **Prepare selected study transfer**. The original queue captures that exact completed archive into the existing transfer store and publishes its manifest.
4. Select the retained transfer and choose **Download manifest and receiver request**. Send the original manifest to the receiving operator.
5. Generate transfer parts for all blocks, or upload the receiver's original missing-block request and generate only what it needs.
6. Download each resulting part from the original task's retained file tickets.

The selected-study desk's callback remains:

```javascript
selection => host.openExtension('project-transfer', 'openForStudy', selection)
```

The controller receives:

```json
{
  "workspace_key": "<current registered workspace>",
  "task_id": "<completed original study.export task>",
  "study_id": "<original selected-study content ID>",
  "title": "Selected scientific study",
  "archive": {"id": "<original download ticket>", "bytes": 0, "sha256": "<original SHA-256>"}
}
```

`openForStudy` checks the current workspace, retains that source selection, navigates to the registered desk, and loads its current exports. The server resolves the completed task and its owned archive; the callback's download metadata is used for display.

## Capture the current workspace

Choose **Current workspace**, select whether to retain native intermediates and deliveries, then choose **Capture current workspace**. The original NativeProjectTransfer calls the original portable writer before it indexes the complete archive.

The default transfer block size is 4 MiB. Keep the same block size for later editions to reuse unchanged blocks. Supported block sizes are 64 KiB through 64 MiB, matching the original transport core.

A new capture after a completed task creates a new original operation. A submission whose reply was interrupted reuses its retained operation identity. Failed or interrupted tasks have an explicit **Resume original task** action.

## Receive, reconstruct and restore

Choose **Receive** in the receiving operator:

1. Retain the sender's original transfer manifest.
2. Select one or more original part ZIPs and choose **Receive selected parts**. Each file uses the existing upload service and the original serial task queue. Parts can arrive in any order; repeated blocks reuse the retained checked data.
3. Open the retained transfer and refresh its receiving coverage. The original store verifies retained block identities and reports available and missing bytes.
4. If data is still missing, download the original missing-block request and return it to the sender.
5. Once all blocks are available, choose **Build original archive** to obtain a complete original portable ZIP, or **Restore editable copy** to restore and register a new Workspace through the original native restoration.
6. Choose **Open restored workspace** to select that registered copy and continue its saved studies.

The transfer cache belongs to the workspace selected when receiving. Its verified blocks remain there for subsequent editions. A restored editable copy has its own registered workspace key. Return to the original receiving workspace's transfer desk when accepting a later edition intended to reuse that cache.

Receiving and restoration retain the original project identity. Before registration, the restored Workspace passes the same installed extension verifiers as the original Workspace restore action, including retained study and investigation context checks. The original restore implementation creates a receiving directory and preserves completed recipient edits on a replay of the same restoration task.

## Retained soil and floodplain acquisitions

The transfer inventory and completed capture or restore task show the original acquisition operations. Each row identifies its original request, retained processing state, soil/floodplain families, predecessor, imported source editions and saved result files. Preparation interrupted before a committed selection remains visible as retained preparation.

After **Restore editable copy**, expand **Retained soil and floodplain acquisitions** in the completed task and choose **Open acquisition**. The operator selects that restored workspace, mounts the existing Conservation desk, and opens the exact retained operation. Use its current **Resume** or **Continue with current application** control to process the retained requests and responses. The original operation and its predecessor history remain available.

The summary also accompanies current-workspace captures and completed study captures when the original portable archive carries acquisition metadata. A sender can open the original retained acquisition from its capture task. A manifest received before restoration displays the sender's inventory; its acquisition controls become available in the completed editable restoration.

A restore interrupted after writing the destination but before returning its final reply reconstructs the same acquisition summary from the verified original destination files. It compares the retained lineage with the original archive and retains the recovered result on the existing transfer operation.

This receiving integration uses the current `model/portable_acquisitions.py` and portable backup/restore source together with the complete installed application. Older archives without an acquisition summary remain readable.

## Saved implementation and fieldwork

The retained transfer and completed capture or restore task include **Implementation and fieldwork**. Expand it to inspect the exact saved plan revisions, task/site/visit/monitoring record counts, attached original files, external source references and report editions.

After **Restore editable copy**, choose **Open saved revision**. The registered Implementation desk opens that exact native plan edition in the restored workspace and retains existing browser drafts. Its Handover view provides the retained report packages. Source paths and report member paths remain part of the original archive; downloads use the operator's normal file service.

Attached originals are carried as their original files. Imported external source references remain identified separately. Reopening a plan uses its recorded revision even if later revisions have since been saved in the receiving workspace.

The native backup locks the saved plan bank with the existing plan locks. Receiving verifies its original revision history, attached originals and retained report editions, then includes the summary in the completed restore. A replay after a lost final reply rebuilds that same summary from the already verified destination files.

Use the complete current application, including `model/portable_implementation.py`, the existing native Implementation provider and its registered `openSavedPlan` browser method.

## Part sizing and inventories

The **Raw payload per part** value limits block payload. Every part also contains the complete original manifest and ZIP metadata, so the downloaded file can be larger. The desk displays this operator's upload capacity. Choose a payload size that leaves room for that overhead and is at least as large as the selected transfer block size.

The inventory view pages original members with sizes and SHA-256 identities. **Export file inventory** retains the original complete HTML, CSV and JSON report ZIP. **Compare editions** uses the original TransferStore difference operation to show added, changed, unchanged and removed member names and reusable block bytes.

A transfer manifest declares the entire edition. Removed members apply to the new reconstructed copy; prior received copies remain independent.

## Original operator API

All writes use the existing `POST /api/actions` queue envelope:

```json
{
  "workspace": "<registered workspace key>",
  "action": "project.transfer.capture-study",
  "payload": {
    "source_task_id": "<completed original study.export task>",
    "study_id": "<selected study content ID>",
    "chunk_bytes": 4194304
  },
  "operation_id": "<original stable client operation ID>"
}
```

The capture action requires a completed `study.export` task from that same registered workspace and original project. It resolves `outputs/<source-task-id>.study.zip` from the server's retained task result, verifies the original byte count and SHA through the existing ticket/open_download mechanism, indexes through `TransferStore.capture_archive`, and verifies that the selected-study receipt is present. It returns the original snapshot identity, source task/study identity and archive provenance.

The original nine operations remain available:

| Action | Purpose |
| --- | --- |
| `project.transfer.capture` | Original current Workspace backup and capture |
| `project.transfer.accept` | Accept an uploaded original transfer manifest |
| `project.transfer.receive` | Receive an uploaded original part |
| `project.transfer.parts` | Write original deterministic transfer parts |
| `project.transfer.archive` | Reconstruct a complete original portable archive |
| `project.transfer.restore` | Original portable restoration and Workspace registration |
| `project.transfer.report` | Complete original file inventory exports |
| `project.transfer.inspect` | Retained manifest and missing-block request downloads |
| `project.transfer.diff` | Compare original member editions |

The descriptor registers read-only GET/POST routes, scoped to the registered workspace:

| Route | Payload / result |
| --- | --- |
| `/api/project-transfers/catalog` | Paged completed study exports plus original snapshot summaries |
| `/api/project-transfers/snapshot` | `snapshot_id`, offset and limit; checked receiving coverage and paged members |
| `/api/project-transfers/progress` | `task_id`; original task state plus retained transfer progress |
| `/api/project-transfers/tasks` | `task_ids`; original transfer tasks decorated with retained progress and authenticated file tickets |

The original global state carries raw task rows. The desk explicitly reads decorated transfer task rows for its downloads and progress. It refreshes active tasks while mounted, stops its own polling when detached, and keeps source selections and pending request identities under the current workspace's browser storage key. Switching workspaces ends further queued writes from a pending multipart upload flow.

Progress is retained in each original task output directory and throttled during block callbacks. The original queue remains responsible for task state, retries and serial Workspace work.

## Runtime integration check

Use the actual current original Workspace and a completed original `study.export` task:

- Confirm the authenticated extension catalogue includes the `project-transfer` client, and that its navigation opens the installed module.
- Capture the completed study through the desk and inspect its original source task, snapshot and archive hashes.
- Generate a manifest and original parts, receive them into the existing receiver store, reconstruct the archive, and restore through the original queue.
- Reopen the restored Workspace and its saved study. Retain the actual source/destination workspace and task IDs in the existing native operation.
- Use the same desk at 390 px width to check source selection, upload controls, task downloads, receiving coverage and restored-workspace navigation.

The maintained standalone transport entry point continues to work with the same original store and protocol:

```bash
python -m model.project_transfer_cli --store ../handover-cache serve --port 8876
```

The integrated desk uses the original operator's authentication, task queue and download tickets. It requires no additional transfer server.
