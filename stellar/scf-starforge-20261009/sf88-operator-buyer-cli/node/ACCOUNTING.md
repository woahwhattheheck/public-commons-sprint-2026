# Complete dataset and object purchase accounting

The same named Node dataset or object can read its original financial records,
finish existing reservations, stop between ranges and reopen the native result
after a lost application response. Delivery files and financial records have
independent lifecycles. Reading an account does not require the purchased rows,
assembled object or signing keys.

The application calls the original `accountDatasetSession` and
`accountObjectSession` APIs. Explicit finalization uses the existing SF36/SF86
worker, selected original workspace, original intent and ledger. The customer
methods do not acquire another dataset page or object chunk.

## Open the existing customer name

```js
import { Buyer } from '@tokenjunkielabs/starforge-merchant/buyer/node';

const buyer = new Buyer({
  runtimeDirectory: '/srv/starforge/sf88-operator-buyer-cli',
  stateDirectory: '/private/customer',
});
const purchase = buyer.dataset('monthly-orders');
// Or: const purchase = buyer.object('monthly-archive');
```

Standalone source users import the same `Buyer` from `@stellar-forge/native-buyer`.
The named entry already exists from `createDataset`/`attachDataset` or
`createObject`/`attachObject`; reopening it retains the original immutable session
and configuration binding. A dataset accounting request checks the saved session
definition directly before entering the native accounting API. It does not run
the product-file inspection path.

To attach an account that already exists in the original native runtime, including
one whose delivered product files have been removed, use an explicit financial
attachment:

```js
const purchase = await buyer.attachDataset({
  id: 'retained-orders', directory: '/private/native-dataset-session', accountingOnly: true,
});
// buyer.attachObject({id: 'retained-archive', directory: '/private/native-object-session', accountingOnly: true})
```

This binds the named entry only after the original native VIEW validates its
session and configuration. It neither restores product files nor creates a new
attempt. If the creating process loses its response before the binding is saved,
reopen the same name and call `initializeAccounting()`. Standard attachment and
acquisition methods keep their original product inspection behavior.

## Read one range or the complete account

```js
const page = await purchase.accounting({offset: 0, limit: 100});
console.log(page.native.terms, page.native.range, page.native.entries);

for await (const range of purchase.accountingPages({limit: 100})) {
  for (const entry of range.native.entries) {
    console.log(entry.index, entry.intentId, entry.outcome,
      entry.actualAtomicUnits, entry.receipt, entry.lastFinalized);
  }
}
```

`native` is the unchanged `stellar-forge.sf88.session-accounting.v1` report.
`process` records the native command's exit code, signal and transport error
separately. Dataset entry indices begin at1; object indices begin at0. The
accounting `offset` is always a zero-based range position. A range contains at
most `limit` entries: default100, minimum1, maximum250.

Original outcomes remain distinct. `FINALIZED` and `IDEMPOTENT_FINALIZED` retain
their actual amount and receipt. `NO_PAYMENT_REQUIRED` is the original unsigned
response. `NOT_ATTEMPTED` describes a part that has no original attempt. A later
read or continuation failure may carry `lastFinalized`; retain that earlier
receipt alongside the current result. Allocation ceilings describe authorization
limits and are not reported as charges.

The async iterator follows each original `range.nextOffset`. It fixes the selected
session and initial part count for that scan. If another acquisition changes the
part count between ranges, it returns the observed range and then raises
`ACCOUNTING_SESSION_LENGTH_CHANGED` with that result. Reopen the account to review
the new complete set.

## Finish the remaining original reservations

```js
const stop = new AbortController();
// Connect an operator's Stop action to stop.abort().

for await (const range of purchase.finalizeAll({
  workspaceDirectory: '/private/original-buyer-workspace',
  limit: 100,
  signal: stop.signal,
})) {
  console.log({
    commandId: range.commandId,
    nextOffset: range.native.range.nextOffset,
    outcomes: range.native.entries,
    interrupted: range.native.interrupted,
    process: range.process,
  });
}
```

`finalize()` handles one range. `finalizeAll()` is an async iterator that visits
the remaining ranges from `offset`, preserving each original response. Both are
explicit financial continuations: the original worker can query configured
providers and update the existing ledger. Use the session's saved workspace, or
provide the matching original workspace when the session came from an explicit
configuration. The original core validates the payer, request, evidence and
ledger binding. Optional `outboxDirectory` and `merchantRoute` must be supplied
together and are passed to that same native worker.

An unsuccessful per-entry finalization remains in the report. Native exit2 with
a complete report does not prevent later ranges from being visited. Cancellation,
an interrupted native report or an uncertain process result stops the iterator.
A caller `break` after a yielded range starts no further native command. No failed
part is automatically acquired or re-executed.

When the original response supplies a non-null `range.nextOffset`, that is the
next unvisited position for a deliberate continuation. After a complete scan,
review the original entry outcomes; range coverage alone does not mean every
reservation was finalized.

## Recover a lost command response

Every accounting command first saves a private immutable context containing its
original session/configuration identity, action and selected range. Native output
is written to private command files independently of the calling process. A
complete original result survives an application response or convenience-view
save failure.

```js
const reopened = buyer.dataset('monthly-orders');
const recovered = await reopened.recoverAccounting();
if (recovered) {
  console.log(recovered.commandId, recovered.status, recovered.process);
  console.log(recovered.result?.native);
  console.log(recovered.lastComplete?.native);
}

// An error or a previous result supplies the exact commandId.
const selected = await reopened.recoverAccounting({commandId: 'finalize-Ab12Cd'});
```

Recovery reads local application files only. It never starts a process, provider
request, finalizer or buyer. `RECORDED` means the application retained the complete
native response and process result. `OUTPUT_RECOVERED` means a complete matching
native output was recovered from the command files. An already-recorded process
error stays attached to it; when no process result was recorded, the exit status
remains `PROCESS_EXIT_NOT_RECORDED`.
`NO_COMPLETE_OUTPUT` keeps the command and process uncertainty visible.

Without a command ID, recovery selects the latest retained command and also
returns `lastComplete`, the most recent complete range. A later failed command
does not erase an earlier original response. A selected command ID recovers that
specific command. These are saved views of native results, not a replacement
ledger. Use `accounting()` to refresh the original financial view before choosing
another explicit finalization when no complete response was recorded.

Results include `commandId`, `commandDirectory`, `startedAt` and `viewStatus`.
`SAVE_FAILED` preserves the returned native outcome even when a convenience record
could not be saved. Command context and output remain private under the existing
customer entry. The native ledger and native per-attempt views remain the sources
for financial state.

## Export the full original view

```js
const exported = await purchase.exportAccounting('/private/exports/account.jsonl', {
  limit: 100,
});
console.log(exported.path, exported.entries, exported.ranges, exported.sha256);
```

The export streams one unchanged native VIEW report per JSONL line, including
original terms, range, per-intent outcomes and receipts. It does not finalize.
The parent directory must already be private and caller-owned. The final path is
created only after every range has been written and synced; an existing file is
never replaced. The returned byte count and SHA256 cover the actual exported file.

Cancellation or a read/write failure retains a private `partialPath` in the error.
That partial export is not published under the selected final name. If final
publication succeeded but a later filesystem sync/cleanup failed,
`destinationPublished` identifies the existing destination. Keep the original
result and path while resolving that local storage error.

Native financial reports are bounded per range. The original object bridge uses
the configured runtime stdout limit (default1MiB); select a smaller range or an
explicit larger `outputLimit` for unusually large source metadata. Dataset
reports use the existing separate `datasetReportLimit` (default32MiB). Recovery
reads the latest complete native output without loading every historical report.

## Installed commands

The existing `starforge buyer-node` command exposes both kinds. Replace `KIND`
with `dataset` or `object`, and use the matching `--dataset` or `--object` name.
All commands retain the existing `--runtime SF88_DIR --state PRIVATE_DIR` inputs.

| Command | Customer action |
| --- | --- |
| `KIND-accounting-attach --KIND NAME --session DIR` | Attach an existing native financial account independently of product files. |
| `KIND-accounting-reopen --KIND NAME` | Finish that same financial attachment after a lost response. |
| `KIND-accounting --KIND NAME --offset 0 --limit 100` | Read one original range. |
| `KIND-accounting-all --KIND NAME --limit 100` | Stream every original range to stdout. |
| `KIND-finalize --KIND NAME --workspace BUYER_DIR` | Explicitly finalize one range. |
| `KIND-finalize-all --KIND NAME --workspace BUYER_DIR` | Visit every remaining original range; add `--offset` to continue. |
| `KIND-accounting-recover --KIND NAME` | Reopen the latest command and last complete response locally. |
| `KIND-accounting-recover --KIND NAME --command-id ID` | Reopen that exact retained command. |
| `KIND-accounting-export --KIND NAME --output NEW_JSONL` | Save the complete original VIEW to a new private file. |

Whole-account stdout is JSONL, one full native command result per line. Single
range and recovery output are formatted JSON. Ctrl-C cancels the current native
continuation and starts no next range. Each output retains its process result;
the CLI returns nonzero for interruption, an uncertain process or an unsuccessful
native finalization. Earlier completed ranges remain available through their
original native records and saved command IDs.
