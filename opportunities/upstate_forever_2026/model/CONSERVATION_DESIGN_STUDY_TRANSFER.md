# Keep saved Scenario design history in a selected study

A selected Conservation transfer carries the original Scenario design projects bound to the selected local portfolio. Each captured editor reference also carries its required original native preparation packet, so the normal editor reopen path works when optional related-result discovery is disabled. Reopening the received Workspace preserves each original editor UUID, the current saved alternatives, the original baseline and every revision through the captured save.

This extends the existing Study transfer and Workspace receiving workflow. The original editor Store remains the only project store. The whole-Workspace archive continues to use its existing online SQLite backup.

## Operator course

1. In Scenario design, save the current alternative in the original embedded editor. Wait for its saved revision.
2. Open Study transfer, choose the original Conservation portfolio, review the dependency closure, and export the selected study. **Include related results** controls discovery of other saved results; required parent packets for the captured editor projects travel with their history. A Scientific Report rooted in the same local portfolio may reach that portfolio through the existing report dependency closure.
3. Download the completed original study archive and receive it through Workspace restore.
4. Open the received Conservation portfolio and its original Scenario design preparation. The embedded editor reopens the same project UUID and captured current revision. Saved alternatives and revision history remain available.
5. Continue editing normally. New valid saves extend the original history; receiving verification continues to check the frozen captured prefix.

Only committed saves enter the snapshot. An unsaved browser draft remains the editor's existing local recovery responsibility. Projects from another source Workspace are not converted into local editable portfolios. Existing foreign contained-report behavior stays with the original Scientific Reports transfer resolver.

## Exact native source and selection

The original embedded Store path is:

```text
conservation-design/editor/projects.sqlite
```

Its schema remains the original two tables:

```sql
projects(id TEXT PRIMARY KEY, title TEXT NOT NULL,
         revision INTEGER NOT NULL, updated TEXT NOT NULL, body BLOB NOT NULL)
revisions(project_id TEXT NOT NULL, revision INTEGER NOT NULL,
          saved TEXT NOT NULL, body BLOB NOT NULL,
          PRIMARY KEY(project_id, revision))
```

The adapter reads the original private editor modules through `conservation_design_editor._modules()`. It uses the original engine's project-key and project-validation functions and the original Conservation binding decoder. Editor UUIDs are preserved. Workspace task identifiers remain their separate original 64-character identifiers.

The closure's original Conservation plans and studies supply the exact `upstate.conservation-plan-reference/v1`. A project is included only when its bound Workspace identity is local, its original plan belongs to that selected closure, and its decoded original binding equals the current immutable plan/study reference. All original projects satisfying that rule are included, including explicitly recovered independent editor copies already bound to the same plan.

The output Store contains only those selected projects and their original revision rows. It retains the SQLite storage type of each raw body, its exact bytes, title, revision and timestamps. The source Store and its unrelated project bodies stay outside the selected archive. The receipt retains a digest of the whole frozen source snapshot as capture provenance, without including that source snapshot's unselected rows.

## Integration into the original transfer writer

The additive module is `model/conservation_design_study_transfer.py`. The shared writer remains `model/study_transfer.py`, maintained by the original transfer owner.

| Call | Result and responsibility |
| --- | --- |
| `source_snapshot(workspace, directory=...)` | Context manager returning a private, original online-backup snapshot descriptor, or `None` when no editor Store exists. Enter before resolving the selected closure and retain the context through archive publication. |
| `capture(workspace, staged, closure, database=snapshot)` | Returns `(history, members)` after ordinary immutable closure files have been staged. With no selected original editor projects, returns `(None, {})`. |
| `verify(workspace, history)` | Validates original captured project/history identity after receiving. `None` preserves historical transfers. Returns a copy of the verified receipt metadata. |

The shared writer adds `history` to `receipt.identity.conservation_design_history`. That identity remains covered by the original study-transfer digest. It merges the returned members into its existing snapshot inventory and source byte/count calculations.

The writer must pass the exact staged database descriptor to the existing portable `frozen_databases` map under:

```text
workspace/conservation-design/editor/projects.sqlite
```

The staged database has already been closed and converted to a self-contained journal. Re-snapshotting it would change the exact bytes named by the history receipt. Existing portable handling preserves this exact frozen member and verifies it against the archive inventory. No WAL, SHM or rollback-journal sidecar is delivered.

The original related-result resolver retains native Design preparation and receiving continuations when that option is enabled. Independently, every captured editor preparation reference retains its own required original native parent packet. The adapter validates the parent's schema, selection digest, Workspace/project/plan/study identities, original geometry role and binding; it then checks the original project baseline and binding and copies the exact preparation JSON plus all declared files, including the editable ZIP. These verified members join the existing snapshot inventory. This keeps the normal `open_preparation()` path complete even with optional related results disabled, without discovering unrelated scenarios or runs.

The original live database is not an ordinary closure file. Do not stage the whole live editor directory or add it to a closure tree before capture. The adapter rejects an existing staged database rather than mixing an entire Store with the selected subset.

The complete guarded core proposal accompanies this source family. Its eight narrow joins were composed by the original ES26 shared-core owner onto the current Receptor, Review, Chemistry and Implementation source. The complete owner bank is `page_c590ce6891248191b1bd32f96a11b7f6`; its original reviewed helper is 22,082 bytes with SHA256 `45f22cfb4dd240b3eafa2707d1ab545eda38ef50da7c01acc59decc513fa67d6`. Subsequent shared-core updates must preserve those existing peer hooks and the same frozen-database contract.

## Snapshot and concurrency behavior

The source snapshot uses the maintained `portable_databases.snapshot_databases` online-backup API. This captures a consistent committed view, including committed WAL contents, without modifying the source Store. The source file must remain the same original inode during that capture context; later valid database writes are allowed.

Selection and all project/history reads use that private snapshot. A completed editor operation written after the snapshot's captured project revision is outside the captured history and is excluded. Matching original preparation references and completed operations through the captured revision are retained, including their original file descriptors.

These additional immutable companions are streamed into private temporary files, fsynced and verified before publication into the stage. They do not create new hardlinks to original CAS files and therefore do not change source inode ctime while the original transfer closure verifies it. Existing matching staged companions are reused only after exact byte and SHA verification.

The original Store schema creates the selected receiving database. Exact original current rows and revisions are inserted transactionally. The adapter checkpoints and closes that private database, retains its descriptor, and verifies the staged result before returning it to the existing writer.

## Receipt shape

```json
{
  "schema": "upstate.conservation-design-study-history/v1",
  "project_id": "original Workspace UUID",
  "method": "sqlite-online-backup-selected-original-projects",
  "source_snapshot": {
    "method": "sqlite-online-backup",
    "journal": "self-contained"
  },
  "source_snapshot_file": {"bytes": 0, "sha256": "original frozen source digest"},
  "selected_plan_ids": ["original plan ID"],
  "editor_project_ids": ["original editor UUID"],
  "projects": [{
    "id": "original editor UUID",
    "title": "original title",
    "revision": 1,
    "updated": "original saved timestamp",
    "body_bytes": 0,
    "body_sha256": "captured raw body digest",
    "body_storage": "blob",
    "baseline_sha256": "original canonical baseline digest",
    "binding_id": "original binding ID",
    "source_reference": {},
    "geometry_role": "original role",
    "alternative_ids": ["original alternative ID"],
    "history": [{
      "revision": 1,
      "saved": "original saved timestamp",
      "body_bytes": 0,
      "body_sha256": "original raw body digest",
      "body_storage": "blob"
    }]
  }],
  "database": {
    "path": "conservation-design/editor/projects.sqlite",
    "bytes": 0,
    "sha256": "selected frozen database digest"
  },
  "members": []
}
```

The example describes the fields; actual IDs, byte counts and digests come from the retained source. Members contain original path, bytes, SHA and a `mutable` flag. Only the selected Store database is mutable. Original operation and preparation companions remain immutable.

## Receiving and later edits

The original archive reader verifies the frozen database bytes and all retained members. The adapter then verifies:

- the original Workspace identity, project UUIDs, selected binding and unchanged baseline;
- the captured current body, timestamp, storage type and complete revision sequence;
- the exact saved body and timestamp of every captured revision;
- the captured alternative IDs;
- the current project with the original engine validator;
- current title consistency and the exact current row's body/timestamp match with its current revision row.

If the received Workspace later saves additional revisions, verification keeps the captured prefix fixed while accepting a valid newer tip. It does not require the mutable database file to retain its old whole-file digest after legitimate editing. New unrelated projects may coexist after receiving.

Historical study receipts without `conservation_design_history` remain accepted by the adapter and original receiving path.

## Application component and publication

The separate `conservation-design-study-transfer` component requires the existing `conservation-design` and `study-transfer` components. Its helper, guide and composition are explicit application members.

The original `study-transfer` component also includes the small additive helper source for its unconditional import. The helper's editor-package imports stay lazy. Do not add a dependency from `study-transfer` back to `conservation` or `conservation-design`: the existing Conservation fragment already depends on `study-transfer`, so that reverse edge would create a cycle.

The original core, queue, Study desk, upload/download tickets and Workspace restore retain their existing contracts.

## Native receiving continuation

The existing `operator/conservation_design_browser_receiving.py` companion can continue the same original plan/editor course with its optional `--selected-study` stage. That stage uses the existing Study desk and `study.export` operation, inspects the exact frozen SQLite member and history receipt, restores through the existing Workspace action, then reopens the same project, captured revision, alternative and native scenario.

The receiving result should retain the actual original task IDs, archive descriptor, captured project cohort and revision evidence. It must compare the receiving state against the frozen snapshot, allowing the source Workspace to have saved later revisions. This continuation performs no native model execution.

Source review and guarded composition are recorded separately from the equipped session's actual receiving result.
