# Complete Runtime workspace backup and receiving

The **Workspace backup** view preserves the workspace’s complete included records
and files as one checked archive. It carries the original workspace identity,
source inventory, saved plans, application settings, operation history and retained
outputs that reside under that workspace. The review separately lists external
runtime, managed-home, source and data locations.

The existing **Offline transfers** view continues to move a selected runtime’s
source and public dependency archives. Application setup documents continue to
move their original saved settings. Whole-workspace backup preserves the larger
workspace and its history.

## Back up the current workspace

Open **Workspace backup** in the existing Runtime workspace. **Backup storage**
defaults to the retained receiving storage for a restored workspace, or the
workspace’s absolute path followed by `.backups` for a new workspace. Choose another
absolute private directory when needed. Keep it outside every Runtime workspace,
including containing workspaces. The same directory holds reviews, archives, partial uploads and original
receiving operations; retain it when continuing on the same machine.

1. Enter a backup name and choose **Review complete workspace**.
2. Read the actual workspace location and identity, file/directory/link counts,
   included byte count, inventory digest and external binding list.
3. Resolve any running or unavailable original operation that prevents a stable
   backup through its existing operation controls. The archive implementation
   and maintained lifecycle coordinate the actual workspace writers.
4. Choose **Create this reviewed backup**. The request is retained before the
   archive worker starts.
5. In **Backup and receiving operations**, wait for that original operation to
   complete. **Download complete backup** supplies its full gzip archive. Retain
   the displayed SHA-256 with the file.

A changed source review is checked again by the archive operation. Review the
current source when the previous inventory no longer matches. The resulting
archive is associated with its exact review and manifest.

The storage location is an operator preference for this workspace. Switching
the selected location opens its existing records; it does not move old archives.

## Receive an archive on another host

Run the maintained Runtime workspace tools on the receiving Linux machine. Use
a separate private **control workspace** to perform receiving when the original
workspace location is not yet restored:

```sh
starforge runtime-workspace init \
  --workspace /srv/starforge/receiving-control

starforge runtime-workspace serve \
  --workspace /srv/starforge/receiving-control
```

In that control workspace’s **Workspace backup** view:

1. Select the full archive file, or enter its existing absolute path on that
   operator machine.
2. Enter the supplied complete archive SHA-256.
3. Choose **Receive and inspect complete archive**.
4. Read the inspected original workspace directory, workspace identity, archive
   digest, manifest digest and external bindings.

Browser file uploads stream in chunks. The receiver retains the request UUID,
expected digest, full byte count and actual received length. If the connection
ends, select the same archive and continue. **Retained archive uploads** exposes
every retained upload in the selected backup storage, including those created
in another browser session. A completed upload can be inspected directly
without resending its bytes.

If an upload reaches its full length before final verification finishes, the
same upload request resumes that verification. An altered archive does not
inherit another archive’s receiving identity. To work on a different file,
choose **Keep original and choose another archive**; the old upload remains
available.

An existing operator-host path follows the same complete archive inspection
without a browser upload. Archive inspection preserves the original bytes and
does not launch a restored application.

## Restore to the original directory

The inspected archive shows its original absolute workspace directory.
**Restore original workspace** uses that exact directory. Its original
`workspace.json`, runtime records, installed-source paths and retained operation
inputs refer to that location.

The original destination must be vacant, or belong to the same receiving
operation being continued. Receiving validates its archive and original
destination identity before publishing files. An unrelated existing workspace
is not replaced.

Use **Continue original operation** after an interruption. The retained restore
request binds its archive, manifest digest and original destination. Do not
create a second destination or edit archived paths to work around an interrupted
restore.

A restored workspace is initially marked as requiring external binding review.
Complete archive restoration and current host readiness are separate steps.

### External runtimes and data


The review also shows **Embedded path discovery coverage**. Required runtime-home
and registered runtime bindings are explicit. Generic path discovery reads JSON
files up to 4 MiB and lists larger or unparsed JSON files by path, size and reason.
Those files are still included in the complete archive. Inspect their original
contents for additional external data dependencies when preparing the receiving
host; external trees are declared and are not copied into the archive.

Paths outside the workspace are shown as explicit external bindings. The
archive does not recursively collect unrelated external directories. Preserve
those resources with their own existing product backup and native receiving
procedures, then make them available at their recorded original locations.

For a deliberate runtime move, use the original runtime installer’s recovery
into a new directory, then register that runtime through the maintained
workspace and Applications controls. Do not rewrite retained request hashes,
runtime identities or absolute locations inside an archived workspace.

A receiving workspace can open its read-only recovery view while an external
`runtimeHome` is missing. That home must be restored as the original private real
directory before the reviewed workspace resumes normal mutations. Missing or
mismatched bindings remain visible in the receiving review.

## Review bindings and reopen

When restoration completes, choose **Review restored bindings** on that
operation. The review shows each original path, its purpose and current
availability. Possible states include present, missing, source mismatch and
unavailable. **Refresh binding review** rechecks the same original receiving
case after the external resources have been restored.

When the binding review permits opening, choose **Record review and show
reopening command**. This saves the exact binding review and displays:

```sh
starforge runtime-workspace serve --workspace /the/original/workspace
```

Run that command and open the new private URL it prints. Use the original
runtime, managed-release and Applications views to inspect current native
readiness and explicitly start selected work. Imported operation history is
retained; recording the receiving review starts zero imported workers.

If the general workspace state cannot yet be read during receiving, the
**Workspace backup** view reads its own retained backend state independently.
The original general-state error remains visible. Continue receiving through
that view or the headless commands below.

## Continue an uncertain browser request

The browser retains review, backup-create and restore inputs before posting
them. If their response is lost, **Continue this exact request** sends the
same request UUID and original input. The server’s retained operation remains
the authority.

**Keep original and start another request** only clears the browser’s pending
selection. It leaves any existing original operation in the backend history.
Choose the original operation when the goal is to continue that work.

An interrupted archive download can be requested again from the same completed
operation. Each download URL is short-lived and scoped to the existing private
server. The downloaded archive retains its original digest.

## Headless operation

All commands use the same model and retained records as the browser. Supply
`--storage` consistently when selecting a nondefault backup directory. Commands
that create work take an explicit request UUID. Retain it for continuation.

Review and create a backup:

```sh
starforge runtime-workspace workspace-backup-review \
  --workspace /srv/starforge/runtime-workspace \
  --request-id REVIEW_UUID --label "October workspace backup"

starforge runtime-workspace workspace-backup-create \
  --workspace /srv/starforge/runtime-workspace \
  --request-id BACKUP_UUID \
  --review-id RETURNED_REVIEW_ID \
  --review-sha256 RETURNED_REVIEW_SHA256

starforge runtime-workspace workspace-backups \
  --workspace /srv/starforge/runtime-workspace

starforge runtime-workspace workspace-backup-download \
  --workspace /srv/starforge/runtime-workspace \
  --archive-id RETURNED_ARCHIVE_ID \
  --output /absolute/private/workspace-backup.tgz
```

The download command streams the complete archive, verifies its byte count and
SHA-256, syncs the temporary output, and publishes to a new output filename.
An existing output file is preserved.

Inspect an archive already present on the receiving host:

```sh
starforge runtime-workspace workspace-backup-inspect \
  --workspace /srv/starforge/receiving-control \
  --archive /absolute/private/workspace-backup.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256
```

For a retained upload, use the same explicit request UUID again to resume its
actual received offset:

```sh
starforge runtime-workspace workspace-backup-upload \
  --workspace /srv/starforge/receiving-control \
  --request-id UPLOAD_UUID \
  --archive /absolute/private/workspace-backup.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256

starforge runtime-workspace workspace-backup-inspect \
  --workspace /srv/starforge/receiving-control \
  --upload-id UPLOAD_UUID --sha256 ORIGINAL_ARCHIVE_SHA256
```

Restore, continue, review bindings and record reopening:

```sh
starforge runtime-workspace workspace-backup-restore \
  --workspace /srv/starforge/receiving-control \
  --request-id RESTORE_UUID \
  --archive-id RETURNED_ARCHIVE_ID \
  --manifest-sha256 RETURNED_MANIFEST_SHA256 \
  --directory /the/original/workspace

starforge runtime-workspace workspace-backup-continue \
  --workspace /srv/starforge/receiving-control \
  --operation-id RETURNED_OPERATION_ID

starforge runtime-workspace workspace-backup-bindings \
  --workspace /srv/starforge/receiving-control \
  --receiving-id RETURNED_RECEIVING_ID

starforge runtime-workspace workspace-backup-open \
  --workspace /srv/starforge/receiving-control \
  --receiving-id RETURNED_RECEIVING_ID \
  --review-id RETURNED_BINDING_REVIEW_ID \
  --review-sha256 RETURNED_BINDING_REVIEW_SHA256
```

`workspace-backup-open` records the reviewed binding state and returns the
original directory, workspace identity and zero launched workers. The
subsequent ordinary `serve` command opens the same restored workspace.

## Complete native receiving course

The source includes a manually invoked operating programme at
`receiving/WORKSPACE_BACKUP_RECEIVE.mjs`. Use the complete current selected
Runtime workspace source with its distribution dependencies, the maintained
Node/Python runtime, an existing Chromium executable and an installed Playwright
module directory.

From that Runtime workspace source directory, run:

```sh
node receiving/WORKSPACE_BACKUP_RECEIVE.mjs \
  --source /absolute/selected-source/distribution/runtime-workspace \
  --operation /absolute/private/runtime-backup-receiving-case \
  --chromium /absolute/existing/chromium \
  --playwright-root /absolute/existing/node_modules
```

The first invocation creates one private operating case. Continue with the same
`--operation` and `--source` paths after an interruption. The programme retains
its original request UUIDs and holds the case's native lease, so an existing
operation is continued without creating a second receiving case.
`--playwright-root` may be omitted when
`CODEX_PRIMARY_RUNTIME_NODE_MODULES` already names that installed directory.

This course operates the actual backup, download, archive inspection, original
path restoration, binding review, explicit reopening, retained upload and CLI
interfaces. It preserves the original source cohort, SQLite and binary inputs,
relative link, writer and installation lease observations, and desktop/phone
browser captures. A qualified interruption applies only to this programme's
own original restore child; if that restore finishes first, the recorded result
states that the interruption was not exercised.

Retain the whole private operation directory. `OPERATING_CASE.json` records its
original identities, completed steps and attempts; `operator-output/` retains
downloads and command output, and `screens/` retains the browser captures.
On completion, `operator-output/COMPLETE_RECEIVING_RESULT.json` names the actual
archive, restore and receiving identities. Publish the complete private case
through the existing artifact handoff for the operation; the programme does not
send it to an external service.

## Model and HTTP integration

The existing `openRuntimeWorkspace()` model exposes the complete backup
methods. Each accepts optional `storageDirectory`:

| Model method | Purpose |
| --- | --- |
| `workspaceBackupState` | Read retained reviews, operations, uploads and inspections. |
| `workspaceBackupReview` | Review the current complete workspace and external bindings. |
| `workspaceBackupCreate` | Start or reopen the original reviewed export request. |
| `workspaceBackupUpload` | Stream an archive at the retained original offset. |
| `workspaceBackupInspect` | Verify the complete original archive and manifest. |
| `workspaceBackupRestore` | Restore that archive to its original workspace location. |
| `workspaceBackupContinue` | Continue the same retained export or restore operation. |
| `workspaceBackupDownload` | Open a readable stream of the exact retained archive. |
| `workspaceBackupBindings` | Review current external binding availability and source identity. |
| `workspaceBackupOpen` | Record the exact reviewed receiving state for explicit reopening. |

The private server exposes `GET /api/workspace-backups/state` and corresponding
JSON POST actions under `/api/workspace-backups/`: `review`, `create`,
`inspect`, `restore`, `continue`, `download`, `bindings` and `open`.

`POST /api/workspace-backups/upload` carries an
`application/octet-stream` body with query fields `requestId`, `sha256`,
`bytes`, `offset` and optional `storageDirectory`. It follows the same exact
origin and private capability checks as the original workspace APIs.

The JSON download action issues a short-lived one-use same-origin URL. The
download streams the complete archive and returns its retained digest and byte
count. The server preserves its existing no-store response and loopback-only
access model.
