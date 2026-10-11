# Download and consume a merchant object from Node

The existing Node `Buyer` selects an original merchant object description,
retains one native whole-file or chunked acquisition, continues its untouched requests, assembles the
verified bytes, and passes the file to application code. Its native session also
opens in the original [object CLI](../OBJECTS.md), browser workspace and Python
application.

Use the same installed import and complete native runtime as the
[Node buyer guide](README.md):

```js
import { Buyer, ObjectDownloadError } from '@tokenjunkielabs/starforge-merchant/buyer/node';
// Standalone local companion package: '@stellar-forge/native-buyer'.

const buyer = new Buyer({
  runtimeDirectory: '/installed/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli',
  stateDirectory: '/private/customer/purchases',
  timeoutMs: 900000, // Includes original terminal prompts and remaining requests.
});
```

The runtime includes `python/object-bridge.mjs`. This is JavaScript: Node calls
that released application directly; the bridge requires no Python interpreter.
The original SF36 operator separately uses its documented Python setup. Keep
the companion and native runtime at the same current distribution.

## Select and retain a download

Obtain the merchant's original `objects.json`, choose its `whole` or `chunks`
product, and prepare the corresponding original buyer configuration or operator
workspace. The initial operation is its base `GET` route without query, body or
response destination. The original engine retains a whole file as one query-free
request or derives each chunk's exact `offset` and `length`; both modes retain
their matching native inbox jobs.

```js
const acquisition = await buyer.createObject({
  id: 'archive-october',
  workspaceDirectory: '/private/operator/archive',
  descriptionFile: '/private/customer/merchant-objects.json',
  objectId: 'archive',
  maxTotalAtomic: '3000',
  chunkBytes: 921600, // Optional smaller size within the advertised chunk cap.
});
console.log(acquisition.lastReport.native);
```

These paths, alias and amounts are illustrative: select the actual merchant's
descriptor, reviewed terms and authorized spending limits. `id` is the customer's
stable application name, separate from the original session UUID and per-request
intent IDs. Preparation is offline.

The descriptor supplies route, byte count, snapshot, content type, chunk cap and
optional whole-file SHA-256. The application retains its exact bytes and selected
alias; the original selector validates them. `maxTotalAtomic` is an integer
string for the entire download and must cover
`ceil(bytes / chunkBytes) × per-request maxAtomic`. A 1,843,229-byte object in
921,600-byte chunks needs three requests; a 1,000-unit per-request ceiling needs
at least `"3000"` total allocation. These are ceilings. Original outcomes and
ledger entries remain the authority for the actual payment state. For a `whole`
descriptor, omit `chunkBytes`: the original engine fixes one request covering the
complete file, and the total allocation must cover one per-request ceiling.
An empty whole file still has one reviewed request and its original payment terms.

```js
const whole = await buyer.createObject({
  id: 'monthly-report',
  workspaceDirectory: '/private/operator/report',
  descriptionFile: '/private/customer/merchant-objects.json',
  objectId: 'report', // Select the actual merchant's whole-file alias.
  maxTotalAtomic: '1000',
});
console.log(whole.lastReport.native.deliveryMode); // 'whole'
const report = await whole.download('/private/customer/files/report.pdf');
await report.verify();
```

The original whole-file engine requires HTTP 200 without a range response,
checks the selected complete length, snapshot and digest, and keeps that one
intent for accounting and restart. The same `ObjectDelivery` supports a valid
zero-byte whole file; an empty chunked product remains invalid. Its verified
empty byte stream yields no chunks, while `verify()` and `saveAs()` still check
the original receipt and empty-file SHA-256. New Node bindings retain the native
delivery mode. Historical bindings without that field continue as chunks and
cannot silently change into a whole-file session.

Use `config: '/private/buyer.json'` or a JSON configuration object for an explicit
original operator configuration. `operatorProfile` can fill its original fields.
Supplying both config and workspace makes the native engine enforce their shared
operator/terms binding. A workspace-only call retains its saved configuration
and ignores the Buyer's global profile; a per-call profile requires config.

For an explicit byte contract, supply `bytes`, `chunkBytes`, `expectedSnapshot`,
and optionally `expectedSha256` and `expectedContentType`, without
`descriptionFile` or `objectId`. This explicit byte plan describes a positive-size
chunked product. Whole-file and empty-file selection use the original merchant
descriptor in the same named `ObjectAcquisition` workflow above.

## Return an application file

Run acquisition from the operator terminal. The original queue, approval and
spending policy remain in charge of each actual request.

```js
const controller = new AbortController();
const download = await acquisition.download('/private/customer/files/archive.zip', {
  signal: controller.signal,
});
console.log(download.path);
console.log(download.assembly); // Original snapshot, chunk-manifest hash and receipt.

for await (const chunk of download.chunks()) {
  // Feed the bytes to this application's temporary import/output destination.
}
// Commit that consumer's result only after iteration completes successfully.
await download.saveAs('/private/customer/export/archive-copy.zip');
```

Create the output parent as a private, caller-owned directory first. The original
command checks a new location before requesting any chunk. It continues untouched
jobs and assembles only a complete acquisition. An existing destination is
reused only when this session has its original assembly receipt. A destination
that appears during acquisition is never overwritten; the completed chunks
remain available for a different path.

Each returned `ObjectDelivery` verifies its current file against the receipt and
extends the existing `VerifiedFile`: `bytes({limit})`, `json()`, `csvRows()`,
`chunks()`, `verify()` and create-only `saveAs()` work as for ordinary responses.
Buffered reads default to 8 MiB. Streaming uses fixed-size buffers and checks the
full digest while reading. Exhaust it before committing external effects: a
concurrent edit can be detected at the final check. `saveAs` publishes only the
complete verified copy.

`download.report.native` retains original progress; `download.report.process`
independently retains subprocess exit/error. `assembly` remains the original
receipt: `SAVED` at creation or `RECORDED` after reopen. The reader checks current
bytes even when the receipt records an earlier assembly. If the native engine
saved the file but could not record the receipt, `receiptRecorded` is false and
`assembly.receiptError` identifies the failure. Preserve that delivery and inspect
the same session; its chunks remain available without a new paid acquisition.

## Restart, cancellation and recovery

```js
const reopened = buyer.object('archive-october');
const progress = await reopened.inspect({chunkOffset: 0, chunkLimit: 50});
console.log(progress.native, progress.process);
await reopened.recover(); // Original saved-result recovery; no chunk request.
const file = await reopened.delivery('/private/customer/files/archive.zip');
await file.verify();

const imported = await buyer.attachObject({
  id: 'existing-archive', directory: '/private/original-object-session',
});
```

Only `run()` and `download()` can acquire new whole-file or chunk requests. `run()` returns progress
without assembly. `assemble(newPath)` assembles retained complete whole-file or
chunk responses offline.
`delivery(path?)` reopens the selected assembly or the latest recorded receipt.
These methods preserve the same original native intents and attempts.

`AbortSignal`, runtime timeout and CLI SIGINT/SIGTERM reach the original process.
`run()` preserves a valid interrupted report when produced. `download()` throws
`ObjectDownloadError` if it has progress without complete delivery:
`error.progress` contains that report and `error.acquisition` is the same handle.
Unavailable subprocess output raises `BuyerError` with its private
`commandDirectory` and acquisition. After the process exits, inspect/recover the
same session. `RECONCILIATION_REQUIRED` exposes the actual stopped chunk and
intent; use the original [queue recovery/finalization](../QUEUE.md) for that
intent. Do not resubmit it through a separate single-response `Operation`.

Named metadata and inputs are published together. After a lost response from
completed native preparation, `buyer.object(id).initialize()` binds and reopens
that same session. Interruption inside the native initializer before its
`session.json` exists retains an incomplete original directory; the API reports
`OBJECT_NATIVE_PREPARATION_INCOMPLETE` with its path. The native initializer owns
that recovery; the application neither deletes that state nor silently creates
another session. Keep absolute session, workspace, evidence and ledger paths in
place. Moving a session does not rebase its original bindings.

## Inspect and export

```js
for await (const acquisition of buyer.listObjects()) console.log(acquisition.id);
const page = await reopened.inspect({chunkOffset: 0, chunkLimit: 100});
console.log(page.chunks, page.chunkPage.nextOffset);
await reopened.exportReport('/private/customer/archive-review.html');
await reopened.exportReport('/private/customer/archive-report.json', {format: 'json'});
```

Results carry original scalar progress, one chunk page (default 50, maximum 250)
and the latest 25 assembly receipts. `chunkPage.nextOffset` pages a report;
`native.nextChunk` identifies the engine's next request. The full HTML or JSON
export includes every chunk and receipt through the original renderer, in a
private create-only file.

Native inspection reads completed object bytes even for a paged report. Reuse a
returned delivery for file consumption; export one full report to review many
chunks. Existing runtime `outputLimit` caps stdout/stderr at 1 MiB by default.
Use a smaller chunk page or a larger explicit runtime limit for unusually large
per-chunk metadata. Native byte, spending and terminal rules remain authoritative.

## Finish the original chunk accounting

File completion and financial state remain separate. The same application can
read or explicitly finish the original chunk reservations through the released
SF36/SF86 continuation:

```js
const accounting = await reopened.accounting({offset: 0, limit: 100});
console.log(accounting.native.entries, accounting.native.range.nextOffset);
const finalized = await reopened.finalize({
  workspaceDirectory: '/private/operator/archive', offset: 0, limit: 100,
});
console.log(finalized.native, finalized.process);
```

`accounting()` reads original retained views without re-reading product bytes.
`finalize()` invokes the original financial worker for these same native intents;
it can query configured providers and update the existing ledger. It never
requests another chunk. The original workspace, independently bound payer,
proof rules and ledger remain authoritative. Use the session's saved workspace,
or supply the matching original workspace when it was created from an explicit
configuration. Optional `outboxDirectory` and `merchantRoute` pass the existing
merchant evidence source to that original worker.

The returned `native` is the unchanged `session-accounting.v1` report, including
exact per-intent outcomes, prior finalization, source paths and native authority.
`range.nextOffset` continues the next explicit page (default 100, maximum 250).
Finalization is explicit and does not run on download. The command retains
process status independently; unresolved native outcomes remain visible for
the same original continuation.

Use `accountingPages()` or `finalizeAll()` to consume each native range through
one async iterator. `recoverAccounting()` reopens a retained command without a
provider request, and `exportAccounting()` writes all original accounting ranges
as a complete private JSONL export. The [shared customer accounting guide](ACCOUNTING.md)
documents cancellation, interrupted-command recovery and the installed commands.

## Installed command

The existing `starforge buyer-node` and `node forge.mjs run buyer-node -- ...`
entry points expose the same workflow. `buyer-node --help` lists required common
paths and exact options. `--object` is the customer name; `--object-id` selects
the merchant's descriptor alias.

| Command | Result |
| --- | --- |
| `object-init` | Prepare from descriptor or explicit byte plan. |
| `object-attach` | Register `--session` under the customer's name. |
| `object-reopen` | Complete the name/session binding after a lost response. |
| `object-status` / `object-list` | Read native progress / list retained names. |
| `object-run` | Acquire untouched chunks without assembly. |
| `object-download --output FILE` | Preflight, continue and assemble/reopen this destination. |
| `object-recover` | Recover saved outcomes without new requests. |
| `object-assemble --output NEW_FILE` | Assemble complete chunks offline. |
| `object-verify [--output RECORDED_FILE]` | Reopen and verify a saved delivery. |
| `object-copy --output RECORDED_FILE --copy NEW_FILE` | Make a verified create-only copy. |
| `object-report --output NEW_FILE [--format html\|json]` | Export the complete original handoff. |
| `object-accounting [--offset N --limit N]` | Read original chunk financial views. |
| `object-finalize [--workspace BUYER_DIR]` | Explicitly finish the same original reservations. |

The command prints original progress/process status or the actual file/receipt.
An unresolved acquisition or process failure returns nonzero status and retains
the same session for continuation.
