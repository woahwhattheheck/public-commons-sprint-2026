# Commissioning archive intake through the original Source Desk

The Source Desk accepts a complete saved merchant commissioning `handover.tar` and carries its original reports into an existing Workshare-linked Installation. The browser and terminal use the same SF47 workspace, Source Desk draft, native archive parser, review and request journal.

The archive is a **private complete capture**. It can include the full original receivables account snapshot and customer identities. Keep the archive, prepared operation files and exported receipts in a private directory. The archive review distinguishes all retained members from the subset selected for the Installation. Its suggested receiving selection includes the original capture, manifest, source, review and project reports. The complete account snapshot is an explicit additional selection.

## Runtime and installed command

Use Python 3.10 or newer with the original installed SF47 modules. The existing Node command launches the same Python CLI; select an actual Python executable using `--python /absolute/path` immediately before the command arguments or `SF47_PYTHON`.

The installed command is `starforge grant-installation-source-desk`. Check the actual installed command manifest if the distribution has been renamed. Source-direct use is also available:

```sh
python3 -B stellar/scf_2026/sf47_budget_model/workspace/installation-source-desk.py --help
```

The CLI opens the existing canonical SF47 directory containing `planning.sqlite3`. Close that workspace's local server before opening this native terminal owner; use the browser workflow when the existing server owns the workspace. Each command acquires and closes the original workspace lease. It does not create a replacement workspace or financial store.

All global options come before the verb:

```sh
starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 \
  --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/output.json \
  VERB --draft source-desk-ORIGINAL_DRAFT_ID OTHER_OPTIONS
```

Replace the example identifiers with the exact retained case and draft IDs. The original `list`, `read`, `profiles`, `command`, `status`, file and preparation-export commands remain available. Use a distinct output filename for each different observation. Outputs are complete create-only files, written with private permissions, flushed and reopened byte-for-byte. An identical existing output can be reused.

## The complete workflow

### 1. Open the current original draft

The native case already contains the Workshare and Installation to which the captured evidence belongs. Read its current Source Desk draft and retain that response:

```sh
starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/draft-before.json \
  read --draft source-desk-ORIGINAL_DRAFT_ID
```

The returned draft revision is the revision to use for the next source mutation. A new draft can still be created through the original `create` command with revision zero, its original title, operator and stable request ID. Existing draft history stays available.

### 2. Prepare and retain the complete archive upload

`prepare-upload` reads one complete regular file, checks that its identity and size did not change during the read, and saves the complete original `file.add` command. It retains the exact bytes as base64 with byte count, SHA-256, original source URL and actual observation time. The original upload limit is 8 MiB; the command never truncates an archive to fit it.

```sh
starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/upload-operation.json \
  prepare-upload --draft source-desk-ORIGINAL_DRAFT_ID \
  --file /absolute/private/merchant/handover.tar \
  --filename merchant-capture-edition-1.tar \
  --source-url https://ORIGINAL-SOURCE-REFERENCE \
  --observed-at 2026-10-13T06:00:00Z \
  --revision ORIGINAL_DRAFT_REVISION \
  --actor ORIGINAL_OPERATOR --request-id commissioning-upload-001 \
  --note "Original saved commissioning capture, first selected edition."
```

Use the real original source reference and observation timestamp. The archive filename is its receiving name; it must be unique in the current selected draft. For a later edition, retain its archive under a distinct receiving name so both complete original archives survive. The selected receiving filename remains part of the immutable upload identity.

Execute the saved operation exactly once:

```sh
starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/upload-receipt.json \
  execute-prepared --draft source-desk-ORIGINAL_DRAFT_ID \
  --operation /absolute/private/receiving/upload-operation.json
```

The receipt's `result.file.id` selects the retained archive. Its `draft.revision` is the new current Source Desk revision. Save both from this native receipt rather than inferring them.

### 3. Inspect the whole archive and select any edition replacements

```sh
starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/archive-review.json \
  archive-inspect --draft source-desk-ORIGINAL_DRAFT_ID \
  --archive-file-id input-ORIGINAL_ARCHIVE_ID \
  --revision UPLOAD_RECEIPT_DRAFT_REVISION
```

The review retains the complete capture identity, original member names, byte identities, materialized receiving names, reusable members, empty members retained in the archive, filename conflicts, selected removals and the resulting selected/stored capacity. Nested original names map deterministically to safe flat receiving filenames while `originalMemberName` preserves the original member identity.

For a repeated capture, examine each conflict's complete `existing` and `incoming` file records. Run the inspection again with one `--replace-file-id` for each **explicitly selected conflicting current file**:

```sh
starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/archive-review-selected.json \
  archive-inspect --draft source-desk-ORIGINAL_DRAFT_ID \
  --archive-file-id input-ORIGINAL_ARCHIVE_ID \
  --revision UPLOAD_RECEIPT_DRAFT_REVISION \
  --replace-file-id input-EXACT_CONFLICTING_FILE_ID
```

Repeat the final flag for every reviewed replacement. The native review permits only the exact current conflicts; it returns the sorted normalized selection. Receiving removes those old files from the current selection atomically and retains their original blobs and draft revisions. Unresolved conflicts or native capacity limits keep `ready` false. The complete archive and member inventories remain reviewable.

Original limits are 8 MiB for each uploaded archive/member, 64 MiB for current selected inputs and 256 MiB of retained draft blobs. The original case source limit later applies to the explicitly selected attachment files.

### 4. Prepare and execute the reviewed receive operation

```sh
starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/archive-receive-operation.json \
  archive-receive-prepare --draft source-desk-ORIGINAL_DRAFT_ID \
  --preview /absolute/private/receiving/archive-review-selected.json \
  --actor ORIGINAL_OPERATOR --request-id commissioning-receive-001 \
  --note "Reviewed complete original member identities and selected edition replacements."

starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/archive-receive-receipt.json \
  execute-prepared --draft source-desk-ORIGINAL_DRAFT_ID \
  --operation /absolute/private/receiving/archive-receive-operation.json
```

For a first edition without conflicts, use `archive-review.json` instead. Preparation verifies the complete native preview seal and `ready:true`, then retains its normalized selection unchanged. It binds the command to the preview's exact draft revision, original archive SHA, selected replacements and preview SHA. Execute asks the original request journal first and makes at most one original mutation when the request is absent.

The result is `RECEIVED_COMMISSIONING_ARCHIVE`. It includes the original complete member inventory, materialized files, removed current selections and a native `receivingSelection`. This saves the source edition; attaching its evidence to Installation phases is the next explicit reviewed operation.

### 5. Inspect the native projects and existing Installation phases

The complete receive receipt already carries the correct source file IDs and current draft revision:

```sh
starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/commissioning-inventory.json \
  commissioning-inspect --draft source-desk-ORIGINAL_DRAFT_ID \
  --receiving-receipt /absolute/private/receiving/archive-receive-receipt.json
```

This read presents the captured projects, milestones and totals together with the original Workshare-linked Installations, checks, receiving references and case version. To make another complete source selection, use `--selection` with an original JSON object containing `expectedRevision`, `captureFileId` and `fileIds`.

Prepare a mapping JSON file from that actual inventory. Its full shape is:

```json
{
  "expectedRevision": 3,
  "captureFileId": "input-ORIGINAL_CAPTURE_ID",
  "fileIds": ["input-EXACT_SELECTED_ORIGINAL_FILE_ID"],
  "expectedVersion": 7,
  "projectId": "ORIGINAL_WORKSHARE_PROJECT_ID",
  "installationId": "ORIGINAL_INSTALLATION_ID",
  "expectedInstallationRevision": 2,
  "milestonePhases": [
    {"milestoneIndex": 0, "phaseId": "ORIGINAL_WORKSHARE_PHASE_ID"}
  ],
  "includeAccountSnapshot": false
}
```

The numbers above illustrate the fields; use the actual native draft, case and Installation revisions. Retain every required capture/source file from the native receiving selection and every complete report chosen for the attachment. Choose the project and phase associations from the actual original inventory. One milestone can refer to multiple original phases when those exact associations are intended.

The project must belong to the Installation's original Workshare case. Selecting the complete account snapshot requires its exact file ID and `includeAccountSnapshot:true`. The native review discloses that full account scope. Without that explicit selection, the original private archive remains retained in the Source Desk while the chosen capture/report files travel to the case.

### 6. Review and attach the complete phase references

```sh
starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/phase-review.json \
  commissioning-preview --draft source-desk-ORIGINAL_DRAFT_ID \
  --selection /absolute/private/receiving/phase-selection.json

starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/phase-attach-operation.json \
  commissioning-attach-prepare --draft source-desk-ORIGINAL_DRAFT_ID \
  --preview /absolute/private/receiving/phase-review.json \
  --actor ORIGINAL_OPERATOR --request-id commissioning-attach-001 \
  --note "Reviewed captured milestone evidence against the original Installation phases."

starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/phase-attach-receipt.json \
  execute-prepared --draft source-desk-ORIGINAL_DRAFT_ID \
  --operation /absolute/private/receiving/phase-attach-operation.json
```

The original review returns the normalized sorted file and milestone selection, original case/Installation revisions, complete source identities, reuse/new-source capacity, retained original findings and the generated capture-to-phase association. Preparation saves that exact returned selection; it does not rebuild the mapping from a summary.

The native result `ATTACHED_COMMISSIONING` records the original source IDs and new Installation edition. The original commercial Workshare, payment selections and acceptance observations remain preserved. The original case and Installation exports carry the reviewed association and complete selected source files.

## Recover the exact original request

Keep each prepared operation file until its corresponding native receipt is retained. Preparation fixes its request ID once, even when the ID was generated automatically. A prepared operation binds the original schema, case, draft, entire command body, original native request SHA and workspace directory. Reviewed commands also retain their complete original preview.

After an interrupted command or an output-write failure:

```sh
starforge grant-installation-source-desk \
  --workspace /absolute/private/sf47 --case operation-ORIGINAL_CASE_ID \
  --out /absolute/private/receiving/phase-reconciliation.json \
  reconcile-prepared --draft source-desk-ORIGINAL_DRAFT_ID \
  --operation /absolute/private/receiving/phase-attach-operation.json
```

`RECORDED` includes the original complete receipt after its native file identities have been checked. The client additionally compares the exact `requestSha256` against the retained command, so another command using the same request ID cannot be treated as this operation. `NOT_RECORDED` is the original journal's actual result. A subsequent explicit `execute-prepared` again reconciles first and submits the same command only when absent.

A changed draft/case/Installation causes the original version conflict. Retain the old operation and its reconciliation, inspect the current state, and prepare a newly reviewed operation with a new request ID. Never edit the saved request's revision or selection to force its original seal to match.

If the native owner reports an uncertain durable commit, close and reopen that original workspace before reconciliation as directed by its error. The prepared operation supplies the stable identity for the original journal.

## Reusable native client

The additive `installation_source_desk_client.py` imports the original `model.digest` and accepts an already-open `SourceDesk`. It opens no lease, database, server or child process:

```python
from installation_source_desk_client import InstallationSourceDeskClient

client = InstallationSourceDeskClient(
    original_desk, case_id, draft_id,
    workspace_directory=str(original_workspace_directory),
)
review = client.archive_inspect(archive_file_id, draft_revision, replacement_file_ids)
operation = client.prepare_review(
    review, "commissioning.archive.receive",
    actor=operator, request_id=stable_request_id, note=operator_note,
)
# Persist the complete operation using the caller's original private-file writer.
receipt = client.execute(operation)
reconciled = client.reconcile(operation)
```

The module also exports `prepare_upload`, `prepare_command`, `prepare_review`, `validate_operation`, `native_request_sha256` and `receiving_selection`. Client reads expose `read`, `archive_inspect`, `commissioning_inspect`, `commissioning_preview`, `lookup` and byte/SHA-bound `file`. Caller-owned workspace shutdown remains with that caller.

## Source and installed package

The selected grant workspace includes the original Node launcher and Python CLI plus `installation_source_desk_client.py`, the native `operations_installation_commissioning_archive.py`, original commissioning/source modules and this guide. The source descriptor and application lifecycle continue to select the original installed workspace.

The single existing Source Desk receiving programme can consume the complete original archive and explicit project/phase descriptor. Its archive mode follows the same inspect, exact selection, receive, replay, phase attachment and backup/reopen lifecycle. Accepted outputs identify the actual source and input pins; programme source alone is a prepared receiving path.
