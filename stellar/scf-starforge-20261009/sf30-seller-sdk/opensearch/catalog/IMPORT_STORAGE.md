# Receiving-stage storage

Completed material catalog imports keep the original bundle, original source files, catalog editions, supplier reviews and customer decisions. Their temporary receiving database and copied source inputs can be released once the import has committed and its reader has closed. New imports do this automatically. The same operation can inspect and retire stages left by an earlier installed version or an interrupted retirement.

## Use the installed workspace

Open **Material catalog → Search and handover → Receiving-stage storage**. Refresh the import list, inspect the original import, and choose **Verify originals and release selected stage** when it is eligible. The view pages through original imports and shows the retained result, current stage size, retirement receipt and any condition preventing release.

Successful catalog receiving remains successful if retirement encounters a storage or custody problem. Its original `COMPLETE` result is unchanged; the storage view records the retained stage separately. Resolve the reported condition, refresh the original import and use the same action again. A lost response also uses that same import and checksum.

## Use the installed CLI

The commands open the same original workspace with its existing source and optional merchant plan. Use the actual source file that belongs to that workspace.

```bash
starforge opensearch-catalog catalog-import-storage \
  --source SOURCE.json --workspace PRIVATE_WORKSPACE \
  --offset 0 --limit 25

starforge opensearch-catalog catalog-import-storage \
  --source SOURCE.json --workspace PRIVATE_WORKSPACE \
  --import-request-id ORIGINAL_IMPORT_ID
```

Copy `importRequestId` and `requestSha256` from that inspection into `RETIREMENT.json`:

```json
{
  "importRequestId": "ORIGINAL_IMPORT_ID",
  "expectedRequestSha256": "ORIGINAL_REQUEST_SHA256"
}
```

`ORIGINAL_REQUEST_SHA256` is the original operation's 64-character checksum. It is distinct from the bundle's checksum. The retirement selection carries no new business request ID.

```bash
starforge opensearch-catalog catalog-retire-import-stage \
  --source SOURCE.json --workspace PRIVATE_WORKSPACE \
  --request RETIREMENT.json
```

Add `--plan PLAN.json` to either command when this workspace uses that original plan. `--request -` reads the same JSON selection from standard input. Successful retirement returns a `COMPLETE` storage receipt; errors return the original actionable code. The command waits for its complete work and closes the original workspace before emitting its final JSON.

Read the unchanged business receipt with the existing command:

```bash
starforge opensearch-catalog catalog-operation \
  --source SOURCE.json --workspace PRIVATE_WORKSPACE \
  --request-id ORIGINAL_IMPORT_ID
```

## Read the outcome

| Inspection or receipt | Meaning and next action |
| --- | --- |
| `READY_TO_VERIFY` | The original import is complete and its stage is closed. Select it to verify all retained originals and retire the stage. |
| `READY_TO_RECONCILE` | The stage was removed but its original retirement receipt is unfinished. Use the same action to verify the saved plan and finish that receipt. |
| `IMPORT_OWNER_ACTIVE` | The original import may still hold its stage database. Let that original import finish or close its workspace; then refresh. |
| `IMPORT_RETAINED` | The original import is incomplete. Continue that import through its existing recovery path. |
| `RETIREMENT_ACTIVE` | Another live owner holds the retirement claim for this import. Use its original continuation. |
| `INSPECTION_REQUIRED` | An unexpected member or file identity requires inspection. The reported member is retained. |
| `ABSENT` | There is no receiving stage at this original path. The business result and retained bundle remain available. |
| `STAGE_REAPPEARED` | A new directory exists after completed retirement. It is retained for inspection and is not adopted into the old receipt. |
| Receipt `RETAINED` | Verification or removal stopped. The error and any sealed per-file plan remain in the original database for the same selection to resume. |
| Receipt `COMPLETE` | The original stage is gone. `summary.outcome` distinguishes a completed retirement from a stage already absent when verified. |

`stage.bytes` is the logical size of currently present temporary files. `stage.allocatedBytes` comes from their filesystem block counts. `estimatedReclaimableBytes` excludes files with multiple hard links and is an estimate before verification. The list totals apply only to the displayed page.

The completed receipt separately records `removedBytes`, `removedAllocatedBytes`, `removedFiles` and `alreadyAbsentFiles`. Removed allocated bytes count only a verified unlink of a file with one remaining link whose progress was recorded. A file that disappeared before a saved progress update is reported as already absent; the receipt does not attribute those blocks to this continuation. Filesystem-wide free space can also change because of other work.

## What is checked and retained

Retirement is scoped to `catalog/transfers/<original-import-id>.stage` beneath the selected workspace. It accepts only that import's `catalog.sqlite3`, its original SQLite WAL/SHM sidecars and named `source-<source-id>.bin` copies. Unknown names, directories, symlinks and non-regular members stop the operation.

Before removal, the original database operation must still be `catalog-import`/`COMPLETE` with its exact request checksum, result checksum, bundle length and bundle SHA-256. The staged catalog and row counts must match the completed receiving result. Every staged source must match its original source record and the full canonical source file. The canonical workspace database is excluded by its physical file identity.

The entire original JSONL bundle remains at `catalog/transfers/<original-import-id>.jsonl`. Canonical `catalog/sources/*.bin` files, workspace SQLite records, catalog/supplier histories, customer decisions and completed operation results are preserved. Retirement receipts live alongside them in the original workspace database; they are local storage bookkeeping and are not added to a portable catalog's business records.

## Interrupted retirement and workspace close

The original operation's owner identity must have ended, or that same live workspace must have recorded a successful stage close. Merely losing an active-task entry does not establish that the stage closed. A failed database close keeps its exact handle in the catalog; closing the workspace retries those handles before closing the original store or releasing its owner identity. The retirement's own temporary inspection reader follows the same rule: a failed close keeps its exact handle and claim, so another live owner cannot unlink its database.

A retirement first claims the original import in the same SQLite database. It verifies and saves the complete per-file plan before unlinking anything. The plan pins the stage directory, original bundle and each allowed file's physical identity and complete checksum. Each removal rechecks the retained originals and claim, synchronizes its containing directory and saves progress. The database and its sidecars are removed after copied inputs.

After interruption, the same `{importRequestId, expectedRequestSha256}` resumes the saved plan. Already absent planned files and an already removed empty stage are reconciled without changing the business import. Another live owner is respected. A changed bundle, canonical source, completed result, unexpected member or replaced stage remains an explicit error. An unsealed attempt may verify again because it has not begun deleting stage files.

Cleanup needs enough writable space for its claim and progress metadata in the original SQLite database. If the initial claim cannot be recorded, removal does not start. If a later progress or completion write fails, the saved plan and remaining files support the same original selection's continuation. Resolve the original capacity issue through the existing workspace owner; this action is deliberately limited to the selected completed receiving stage.

## Original HTTP and JavaScript APIs

These routes use the existing workspace's operator origin/token gate and request lifecycle:

```text
GET  /api/catalog/import-storage?offset=0&limit=25
GET  /api/catalog/import-storage?importRequestId=ORIGINAL_IMPORT_ID
POST /api/catalog/import-storage/retire
```

The POST body is the same two-field retirement selection shown above. Inspection accepts page sizes from 1 to 100 and returns `{schema, workspaceId, rows, total, nextOffset, pageTotals}`. Retirement returns the complete original storage receipt. Existing `catalog-import` callers receive their original business operation unchanged after automatic retirement has settled.

```javascript
const page = await workspace.catalog.importStorage({ offset: 0, limit: 25 });
const selected = page.rows.find(row => row.eligible);
if (selected) {
  const receipt = await workspace.catalog.retireImportStage({
    importRequestId: selected.importRequestId,
    expectedRequestSha256: selected.requestSha256
  });
}
await workspace.close();
```

Use `try/finally` around the owning application's workspace lifetime. The installed CLI and HTTP workspace already own that lifecycle. The lower-level module is available as `seller/opensearch/catalog/import-storage`; applications normally use the methods on their existing catalog.
