# Complete, incremental project handover

TokenJunkieLabs · Upper Savannah · 2026-10-14

The transfer service moves a **complete original scientific Workspace** without
repeatedly sending all of its large source and result files. It retains original
application files, source editions, model inputs, runs, maps, reports, review
history and the original `ARCHIVE.json`. A receiver can stop, reopen, ask for only
its missing blocks, and receive a new independently editable working copy.

## Windows and Mac workbench

Open the packaged collection with `Open_Workbench.cmd` on Windows or
`Open_Workbench.command` on Mac, then choose **Transfer and restore** in the
workbench. This uses the existing scientific workspace, queue and downloads.
The standalone desk below is an optional file-transfer surface, not a replacement
for the collection launcher. Use the application's selected interpreter for CLI
commands; the packaged workbench does not require installing another Python.

The sender's snapshot and block identities are the same on all three platforms.
Original member names, bytes, executable modes and scientific metadata remain
intact. Receiving into an independent directory checks Windows reserved names
and destination aliases before writing. Mac receiving also detects case and
Unicode aliases. Archives can still retain every original member unchanged.

Cache records, range uploads, part archives and report downloads use the shared
native file-handle and locking layer. A filesystem without hard links uses a
verified, flushed copy and create-only publication instead. Windows I/O uses its
long-path namespace, while saved operation paths retain their original readable
form. Keep `model/portable_fs.py` and `model/windows_fs.py` with this source when
receiving a developer installation; both are bundled in the complete release.

## Start the handover desk

Extract this source into the existing application, preserving unrelated files.
Python 3.10 or later is sufficient for the transfer engine, CLI and HTTP desk;
no GIS package, cloud account or new paid service is needed to move files.
The original application retains its own scientific runtime requirements.

From the application directory:

```sh
python -m model.project_transfer_cli --store ../handover-cache serve --port 8876
```

Open `http://127.0.0.1:8876` on that computer. The desk binds to loopback only.
Run the same command on the receiving computer with its own cache. Two desks on
one computer must use separate stores and ports. Receiving copies are saved
**outside** the cache, by default in its sibling `handover-cache-received/`.
Use `--receive-directory /your/projects` to choose another destination root.
Do not put a cache inside the scientific Workspace or an application source tree.

The CLI has no Python package dependencies. The browser uses only bundled HTML,
JavaScript and CSS, with no CDN, external font or telemetry. Closing a tab does
not remove the server's saved tasks. Stop the foreground server with Ctrl+C;
restart the same command to reopen its queue and retained transfer progress.

## Bryce's operating path

| Step | What to do | What appears | What it means / what to say |
|---|---|---|---|
| 1. Select the original files | On the sender choose **Scientific workspace ZIP** and the completed original backup. Press **Receive selected files**. | Actual upload bytes, a retained capture task, then a saved project edition. | “This is the complete working project, including its original inputs and results.” |
| 2. Choose the saved edition | Select its title; inspect files, byte counts and **Export file inventory**. | Exact relative filenames, sizes, hashes and original project identity. | “You can inspect exactly which files this edition contains.” |
| 3. Begin receiving | Download **Save manifest**. On the receiver choose **Transfer manifest**, upload it, then **Save missing-block request**. | The receiver's real missing-block count and remaining bytes. | “The receiving computer tells us what it already has and what it still needs.” |
| 4. Send only missing data | On the sender select that request and **Create transfer parts**. Transfer the resulting `.uptransfer.zip` files through the existing approved file-sharing route. | Downloadable parts bound to this exact edition. | “We only send the required data. Parts can arrive in any order.” |
| 5. Receive and reopen | On the receiver choose **Transfer parts**, select them, then **Receive independent copy** with a new folder name. | A completed receiving task and actual application/workspace directories. | “This copy is independently editable. Changes here do not change the sender.” |
| 6. Deliver an update | Capture a later original backup in the same sender cache. Repeat the manifest/request exchange using the existing receiver cache. | Earlier/current file differences and unchanged-block reuse. | “This is the updated edition; the earlier working copy remains intact.” |

The part-size field controls **raw block payload**, not the final ZIP size. Each
part also carries the complete manifest and ZIP metadata; allow headroom beneath
a file-sharing service's upload limit. A fixed block is never split across parts.
The default block is 4 MiB. The allowance must be at least the largest selected block.

An interrupted **browser upload** resumes when the same original file is selected
again. Completed transfer parts can be replayed without downloading their good
blocks into the cache again. CLI range receiving also retains a partial block's
byte offset. ZIP parts contain whole blocks; a request for a partly received
block may therefore require that whole block in a ZIP part. The request reports
both remaining range bytes and whole-block pack bytes explicitly.

## Complete CLI workflow

Arguments are shown as shell variables so every command refers to an actual
returned snapshot ID and chosen path. Use `--quiet` to suppress progress on stderr;
JSON results are written to stdout. A nonzero exit indicates a real failure.

Sender:

```sh
python -m model.project_transfer_cli --store /sender/cache capture /source/workspace.zip
# Set ID to the actual id in that command's JSON result.
python -m model.project_transfer_cli --store /sender/cache manifest "$ID" --output transfer.json
```

Receiver:

```sh
python -m model.project_transfer_cli --store /receiver/cache accept transfer.json
python -m model.project_transfer_cli --store /receiver/cache needs "$ID" --output missing.json
```

Return `missing.json` to the sender. Produce appropriately sized parts, retaining
the same cache and snapshot:

```sh
python -m model.project_transfer_cli --store /sender/cache parts "$ID" /out/edition-parts \
  --request missing.json --payload-bytes 67108864
```

Receive any order of those parts, including previously completed parts:

```sh
python -m model.project_transfer_cli --store /receiver/cache receive /incoming/*.uptransfer.zip
python -m model.project_transfer_cli --store /receiver/cache needs "$ID"
python -m model.project_transfer_cli --store /receiver/cache open-copy "$ID" /projects/received-edition
python -m model.project_transfer_cli --store /receiver/cache verify-copy "$ID" /projects/received-edition
```

The received folder contains `application/`, `workspace/` and `ARCHIVE.json`.
Use the received application's normal dependencies and entry point. With a full
original application, this known native API opens its retained identity:

```sh
cd /projects/received-edition/application
python -c "import json; from model.workspace import Workspace; print(json.dumps(Workspace('../workspace').overview(), indent=2))"
```

For consumers that already receive the original ZIP format:

```sh
python -m model.project_transfer_cli --store /receiver/cache assemble "$ID" /out/workspace.zip
```

This reconstructed ZIP has identical member bytes and the **exact original
ARCHIVE.json bytes**. Its compression, ZIP container metadata and whole-ZIP hash
can differ from the sender's ZIP. The original member hashes remain authoritative.

Complete file changes and inventories:

```sh
python -m model.project_transfer_cli --store /sender/cache diff "$BEFORE_ID" "$AFTER_ID"
python -m model.project_transfer_cli --store /receiver/cache report "$ID" --directory /out/inventory
```

The report contains HTML, CSV and JSON for every member. Removed members are
absent only from a new receiving copy; no earlier copy is deleted or rewritten.
The current implementation does not merge independent edits into a recipient's
existing directory. A new edition always receives into a new directory.

## Native Workspace and original operator integration

`model.project_transfer_workspace.NativeProjectTransfer` calls the maintained
`model.portable.backup` and `model.portable.restore`. It does not reimplement the
scientific model or automatically import code from an untrusted received archive.
A native restore uses the **already installed** original application to perform
its original source, grid, run, spatial-export, community and review validations.

```python
from model.workspace import Workspace
from model.project_transfer_workspace import NativeProjectTransfer

ws = Workspace('/projects/original-workspace')
transfer = NativeProjectTransfer(ws, '/projects/transfer-cache')
result = transfer.capture('unique-retained-operation-id')
snapshot_id = result['snapshot_id']
# Later, after required blocks have reached the receiver's corresponding store:
# transfer.restore(snapshot_id, '/projects/new-native-receiving')
```

The original operator adapter is `operator/project_transfer.py`. Install it
without replacing any colleague's server postimage:

```sh
python -m model.project_transfer_install /path/current/application --dry-run
python -m model.project_transfer_install /path/current/application
```

The installer reads the **current** `operator/server.py`, composes the action
registration, constructor, original `_invoke(task)` dispatcher and original
customer-review task-decoration hook. It preserves all other methods and panels,
keeps an original source backup outside the application, and refuses a source
that changed while it was being joined. Repeating an installed join is a no-op.
A missing original hook is reported without replacing the server.

The following actions use the original `Operator.submit(workspace, action,
payload, operation_id)` queue and its retained task IDs:

| Action | Payload |
|---|---|
| `project.transfer.capture` | `include_intermediates?`, `include_deliveries?`, `chunk_bytes?` |
| `project.transfer.accept` | `upload_id` of a complete transfer manifest |
| `project.transfer.receive` | `upload_id` of one complete transfer part |
| `project.transfer.parts` | `snapshot_id`, optional `request_upload_id` or `request`, `payload_bytes?` |
| `project.transfer.archive` | `snapshot_id` |
| `project.transfer.restore` | `snapshot_id`; new directory is owned by the original task |
| `project.transfer.report` | `snapshot_id` |
| `project.transfer.inspect` | optional `snapshot_id` |
| `project.transfer.diff` | `before_id`, `after_id` |

The adapter returns downloads through the original `_ticket` method and registers
native received Workspaces through the original `register` method. It adds no
scientific run scheduler. The standalone desk provides the full browser handover
immediately; the adapter provides the existing operator's queue/download seam for
its cumulative application owners. Existing map, experiment, source and training
panels remain unchanged.

## Retention, integrity and recovery

A snapshot is published only after all original members and their native manifest
have been checked. Files are divided into fixed SHA-256 blocks and deduplicated
across members and editions. Snapshot IDs bind filenames, ordering, sizes and block
identities. A receiver rejects changed bytes, unsafe paths, duplicate members,
symlinks, unsupported workspace identities and conflicting destinations.

Each partial block is flushed before its offset is acknowledged. Verified blocks
are atomically published; interrupted copies retain completed files. New receiving
directories use no-replace publication, and lost final replies are reconciled from
the retained operation. Subsequent recipient edits are preserved. Cache entries
are reused after checking their file identity, and bytes actually consumed during
assembly are hashed. A corrupt cached block becomes missing and can be received
again; the original project and unaffected blocks remain intact.

Use a local filesystem with normal durable writes and atomic file operations.
Receiving publication uses the shared Linux, macOS and Windows native
create-only directory publication. On another platform,
assemble the native ZIP and use the original receiving method. Transfer integrity
is not encryption or a sender signature: continue using approved private transport
for nonpublic project data. The local HTTP desk is intentionally not an
Internet-facing file server.

Disk planning: the sender may retain the original backup plus unique cached
blocks; a receiver retains cached blocks plus its complete received copy. A rebuilt
native ZIP consumes additional disk. No automatic pruning removes scientific files
or earlier copies. Delete transport cache only after preserving the completed
working copy and any snapshots needed for later incremental updates.

## Windows command-line paths

The examples above use POSIX shell paths. With PowerShell, keep paths quoted,
use the bundled interpreter in `$Python`, and pass selected part files as an array
rather than relying on the shell to expand a wildcard:

```powershell
$Parts = @(Get-ChildItem -LiteralPath $Incoming -Filter '*.uptransfer.zip' -File |
    Select-Object -ExpandProperty FullName)
& $Python -m model.project_transfer_cli --store $Store receive @Parts
& $Python -m model.project_transfer_cli --store $Store needs $ID
& $Python -m model.project_transfer_cli --store $Store open-copy $ID $NewProject
```

Use the same cache and snapshot after interruption. Reopening a completed receive
returns its existing operation without replacing subsequent recipient edits.
A physically moved completed copy can be opened normally and checked against its
original snapshot using `verify-copy` at the new location. These actions operate
the retained original files; they do not restart scientific calculations.

Original integration references: `model/portable.py` Git blob
`720dd74b35352c09e0248e87ce2c604052d0f476`, original Workspace/common schema
`upstate.scientific-workbench/v1`, and the existing operator's
`Operator.submit`, `_invoke`, `_ticket`, `register` and customer-review decoration.


## Original file modes in a received edition

A current scientific archive records each member's original mode as `100644` or `100755`. Incremental reconstruction now writes those exact modes into the ZIP member metadata, and native archive verification compares them with the retained manifest. The direct directory receiver applies the same modes and verifies them on POSIX systems, so executable application entry files remain executable after receiving.

Original snapshot and block IDs still bind the same source bytes and metadata. Archives from the earlier format that did not declare a mode remain supported. No original Workspace member is excluded by file type or by a calibration-specific directory list.

The native adapter uses `<snapshot_id>.received-modes-v2.zip` for its owned reconstructed archive cache. This lets the same retained restore operation resume after an earlier reconstruction omitted modes, while keeping that earlier cache file intact. A manually selected existing reconstruction with mismatched modes is rejected with a request to choose a new archive path; an unrelated existing output is never overwritten.

Full project captures include complete saved calibration review records and `calibration-review-exports` members. A new review in a later edition adds its original files to the snapshot and reuses only receiver blocks with matching bytes. Both `project.transfer.restore` and Project continuity's receiving path invoke the installed extension validators before the received workspace is registered.
