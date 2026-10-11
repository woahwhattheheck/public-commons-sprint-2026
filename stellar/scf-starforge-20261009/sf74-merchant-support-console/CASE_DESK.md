# Merchant case desk

SF74 keeps a queue of merchant cases inside its existing local workspace. A case joins the exact route settings, original capture files, original runtime support packets and delivery records, unfinished owner terms, follow-up owner, work status, next action, notes and saved versions. It uses the existing SF70 diagnosis, SF72 preflight, SF76 comparison, SF77 workorder, SF93 support packet, SF97 native reconciler and SF74 workspace codec.

## Start with private case storage

From the complete public sprint checkout, using Node 22 or newer:

```sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs \
  --cases-dir "$HOME/.local/share/stellar-forge/merchant-cases" --port 8784
```

Open `http://127.0.0.1:8784/`. Choose an absolute directory outside the checkout. The directory is created when missing. On Linux its mode must be 0700 and saved files use 0600. Reusing a shared directory is rejected without changing its permissions. The original no-argument launch still works in temporary session mode; it offers portable workspace files instead of a retained queue.

The case list reads only local files. Opening, saving, searching, archiving and restoring cases do not request seller endpoints. Diagnosis and POST browser checks remain the original explicit actions.

## One working merchant flow

1. Enter a case name and merchant. Keep separate cases for different routes, methods, buyer origins or payment settings, even when the company is the same.
2. Enter the actual route in **Diagnose**. An incomplete route or terms draft can be saved before a diagnosis exists.
3. Set the follow-up owner, date, next action and notes. Choose a work status: New, In progress, Awaiting input, Ready for review, Closed or Archived. These are team workflow states; they do not change source findings, seller acceptance, price approval or payment records.
4. Choose **Save case**. The source selections, input fields and raw terms are saved together. Saving is explicit; the page shows subsequent edits as **Unsaved changes**.
5. Diagnose when appropriate, retain the before capture, do the actual repair, capture after, compare and prepare the original workorder. Save the case again at the point you want to retain. Reopened cases keep source bytes and drafts; derived comparison and workorder views are regenerated with the original engines.
6. Search by case name, merchant, owner, next action or route. Use **Due today or earlier** to see dated follow-ups for open work. The browser uses its local calendar date; stored dates remain `YYYY-MM-DD`, without a guessed appointment time.
7. Reopen another case. If the editor has unsaved changes, keep editing, save first, or explicitly discard those draft changes. An imported portable workspace uses the same replacement choice.

Archived cases are hidden in the default queue. Select **Archived** to reopen one and change its status. Closing or archiving a case never deletes source files or versions.

## Concurrent tabs and saved versions

Each case has a stable UUID and a revision token. A save names the revision the editor opened. If another tab saves first, the old tab receives a conflict and retains its draft. **Open latest saved version** loads the other tab's work; **Save as separate case** preserves the draft under a new case identity. There is no force-overwrite option.

An identical retry after a lost HTTP response returns the already-created revision. The browser retains the attempted case ID and payload for that retry. Changing the draft after an uncertain save can require reviewing the saved case before continuing.

**Saved versions** lists the retained versions, newest first. Opening an earlier version loads it as a draft against the current revision. Saving creates a new version; it does not erase the versions made after the selected one. A change made while a case is loading cancels replacement instead of overwriting newer editor input.

## Transfer, backup and storage

The existing `.merchant-workspace.json` format transfers the original intake fields, source captures and raw terms. It remains compatible with existing SF74 exports. It does **not** include case-desk ownership, notes, follow-up dates or version history. Importing that file creates a new unsaved case draft.

For a complete case-desk backup, stop the server and copy the entire private case directory. Start the same server with the copied directory to restore it. No directory data belongs in the public source repository.

Each case contains an atomic `head.json` pointer, immutable version metadata under `versions/`, and deduplicated, byte-exact original workspace files under `workspaces/`. Metadata and workspace files are completely written and synced before a new head is selected. Saving one new case does not load other cases' capture bodies. Listing reads their compact metadata.

Attached runtime sources are content-addressed in the same case's `runtime/` directory, completely written and synced before the same head publication. Each version records its runtime file's hash, size and compact summary. Reopening or restoring a version validates its exact runtime bytes and reuses the original reconciler. Existing cases without runtime sources open normally. An older API caller omitting `supportText` preserves a current attachment; an explicit `null` removes it from the new version while retaining previous versions.

The complete `.merchant-support.json` transfer includes the current workspace, runtime files and follow-up metadata. Import opens a new case draft; it does not overwrite an existing case or import history. [Runtime support operations](RUNTIME_SUPPORT.md) explains the capture mapping and handoff.

### Recover a stopped local writer

A save briefly owns an exclusive writer record. If that process stops abruptly, later saves retain their drafts and report `CASE_STORE_BUSY`. Inspect the recorded process from the same host and PID namespace:

```sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs \
  --cases-dir "$HOME/.local/share/stellar-forge/merchant-cases" --inspect-case-writer
```

When the recorded process has stopped, recover its writer generation explicitly:

```sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs \
  --cases-dir "$HOME/.local/share/stellar-forge/merchant-cases" --recover-case-writer
```

Both commands exit without starting a server. Recovery refuses a live process or an owner whose host/process namespace cannot be checked locally. It preserves the old ownership bytes and publishes a new writer generation; concurrent recovery attempts cannot remove a later writer's lock. Retry the original save afterward. An interrupted staging file cannot replace a complete saved object, and the prior head remains readable until a complete new version is selected.

The existing workspace limit is 16,100,000 bytes, with at most six original source slots and 2,000,000 bytes per source. A private directory supports 2,000 cases. List pages return up to 200 rows (the UI uses 30); version pages return up to 100 entries (the UI uses 20). A damaged individual case is reported as needing local recovery while the remaining queue stays available.

## Local API

All endpoints retain the original literal-loopback Host restriction and no-store response headers. Mutation requests require the exact local Origin. No API accepts a filesystem path from the browser; the process owner selects the directory at launch.

| Operation | Endpoint | Input |
| --- | --- | --- |
| List/search | `GET /api/cases` | `q`, `status`, `dueOn`, `offset`, `limit` |
| Open current | `GET /api/cases/{id}` | None |
| Open saved version | `GET /api/cases/{id}?revision={revision}` | Saved revision token |
| Version history | `GET /api/cases/{id}/history` | Optional `before` and `limit` |
| Create/save | `POST /api/cases` | `id`, `expectedRevision`, `workspaceText`, `metadata`, optional `supportText` |

For creation, `id` is a new UUID v4 and `expectedRevision` is `null`. For updates use the exact current token. `workspaceText` is the original v1 codec output as a string, retaining its source bytes. `metadata` has `merchant`, `owner`, `status`, `followUpOn`, `nextAction` and `notes`. `CASE_CONFLICT` and `CASE_STORE_BUSY` return HTTP 409 without discarding the browser draft.

No new service, database, wallet, telemetry, hosted CI or recurring task is installed by this feature.
