# Receive a complete Analysis workspace

An Analysis workspace archive contains the original consistent SQLite snapshot
and its complete retained query exports, report files, change outputs and
workbook editions. Receiving restores those files together into a new private
directory. The original workspace identity, dataset versions, jobs, saved
definitions and producer provenance remain in the copied database.

The receiver is part of the installed `stellar_forge_buyer` Python package. It
uses the existing public workbook receiver's private-file and atomic directory
publication helpers. Linux and macOS are supported when their native
no-replace directory rename is available.

## Review the selected archive

Keep the archive in a private directory with file permissions `0600`. Pass its
recorded SHA-256 when it is available:

```bash
python -m stellar_forge_buyer.workspace_archive_receive inspect \
  /private/customer/analysis-workspace.zip \
  --sha256 ARCHIVE_SHA256
```

The command streams and validates the exact archive through the maintained
`workspace_archive.inspect_archive` function. Its JSON result includes the
archive path, compressed byte count and digest, manifest digest, original
workspace ID, export job ID, complete file inventory and recorded table counts.
Review the original workspace identity and available payloads before selecting
the receiving destination.

`archive-manifest.json` is the root manifest. Each customer payload appears
under `workspace/` in the ZIP. Manifest `files` includes `datasets.sqlite3`
exactly once; `database` repeats that same path, byte count and digest. Prior
portable archives are recorded as provenance without nesting their contents.
The exporter retains the complete selected output trees and excludes process
launch capabilities, provider session directories, locks and temporary parts.

## Receive, then open the original application

Choose an absent destination below a private directory. The command can create
missing private parent directories. An existing destination remains intact.

```bash
python -m stellar_forge_buyer.workspace_archive_receive receive \
  /private/customer/analysis-workspace.zip \
  /private/customer/analysis-restored \
  --sha256 ARCHIVE_SHA256
```

The successful command prints one JSON receipt and exits with status `0`.
`target` identifies the new workspace directory and `database_path` identifies
its original `datasets.sqlite3`. Open that directory through the normal
application:

```bash
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis-restored status

python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis-restored serve --open
```

The normal application creates its current local serving capability and
performs its original interrupted-job reconciliation. An administrative export
job that was RUNNING in the consistent snapshot can therefore become
INTERRUPTED on first open. Existing business rows, complete output jobs,
workbook revisions and source identities retain their original history.
Existing source registrations preserve their producer provenance; additional
acquisition uses the application's normal explicit source configuration.

## Continue after an interruption

Repeat the same receive command with the same archive and destination. A
private journal beside the destination owns the operation and its staging.
Complete staged payloads are verified and reused. Incomplete members are
re-extracted from the original ZIP. The final directory appears atomically
after all members and the database pass validation.

| Retained phase | Continuation |
| --- | --- |
| `extracting` | Verify complete staged files, re-extract remaining members and inspect the immutable original database. |
| `prepared` | Verify the prepared directory and its receipt, then publish it with a native no-replace rename. |
| Rename completed before the journal update | Match the existing destination's retained directory identity and receipt, sync its parent directory and finish the original journal. |
| `complete` | Return the original receipt with `reused: true`, preserving later live database and application changes. |

The receiver validates the database with SQLite's immutable read-only mode,
its original application ID and schema version, the original Analysis
workspace ID, a full `quick_check`, required tables and recorded table counts.
It does not construct the application during extraction. Normal first open is
the application owner's existing recovery boundary.

An orchestrator can allocate and retain its operation UUID before dispatch:

```bash
python -m stellar_forge_buyer.workspace_archive_receive receive \
  /private/customer/analysis-workspace.zip \
  /private/customer/analysis-restored \
  --operation 1234567890abcdef1234567890abcdef \
  --sha256 ARCHIVE_SHA256
```

Use that same UUID, archive and destination for every continuation of this
operation. Without `--operation`, the durable journal allocates a UUID once.
Keep the original ZIP and private journal available for subsequent receipt
readback. `workspace-archive-receipt.json` in the restored directory binds the
published workspace to that journal; the next exporter excludes this
receiver-generated metadata from its customer payload selection.

## Python interface and receipt

```python
from stellar_forge_buyer.workspace_archive import inspect_archive
from stellar_forge_buyer.workspace_archive_receive import restore_archive

review = inspect_archive(archive_path, expected_sha256=recorded_digest)
receipt = restore_archive(
    archive_path,
    new_directory,
    operation=retained_operation_id,
    expected_sha256=review["archive"]["sha256"],
)
```

`operation` and `expected_sha256` are optional. Operation IDs contain exactly
32 lowercase hexadecimal characters. Digests contain 64 lowercase hexadecimal
characters. The receiving result uses
`stellar-forge.analysis-workspace-receipt.v1` and contains:

| Field | Meaning |
| --- | --- |
| `state`, `operation_id` | Completed receiving operation and its durable identity. |
| `archive_id`, `workspace_id` | Original export job and original customer workspace. |
| `archive_sha256`, `archive_bytes`, `manifest_sha256` | Exact selected source. |
| `target`, `database_path` | The selected receiving directory and its database. |
| `files`, `bytes` | Number of restored customer payloads and their total uncompressed size. |
| `created_at`, `prepared_at`, `completed_at` | Original receiving lifecycle timestamps. |
| `reused_staged_files` | Complete members retained at the successful preparation step. |
| `reused` | Whether this invocation continued or read back the retained operation. |

The saved receipt is stable across completed replay; the per-invocation
`reused` flag becomes `true`. The receiver checks its original archive and
publication identity during replay and preserves current customer file bytes.

## Operator errors

Successful CLI responses are JSON on stdout. Controlled failures are JSON on
stderr with exit status `2`; interruption exits `130`. A supplied operation
and the same destination allow the existing receiving to continue.

| Error suffix | Action |
| --- | --- |
| `TARGET_EXISTS` | Select an absent destination, or use the original archive and operation for that destination's completed receipt. |
| `OPERATION_CHANGED` | Reconcile the archive, destination and retained UUID against the original receiving request. |
| `STORAGE_REQUIRED` or `STORAGE_FULL` | Release space from completed owned work or provide capacity on the selected filesystem, then repeat the same command. |
| `ARCHIVE_CHANGED` or `MEMBER_CHANGED` | Recover the exact originally reviewed archive and repeat with its recorded digest. |
| `DATABASE_INVALID`, `DATABASE_IDENTITY_CHANGED` or `DATABASE_ROWS_CHANGED` | Return the exact source finding to the original exporter and correct the source archive before choosing a new receiving operation. |
| `STAGING_CHANGED` or `PUBLISHED_DIRECTORY_MISSING` | Inspect the original journal and selected directory; preserve their current contents while reconciling the changed local state. |
| `ATOMIC_PUBLICATION_UNAVAILABLE` | Use a supported Linux or macOS filesystem/runtime for the same source archive. |

Original private-storage, archive-inspection and operation-lock errors retain
their stable application codes. A busy receive can be read back by repeating
the same command after its original writer finishes.
