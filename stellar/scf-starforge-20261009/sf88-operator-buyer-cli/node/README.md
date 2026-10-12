# Native buyer for Node applications

Go applications can use the complete [native Go buyer](../go/README.md) and
`starforge-buyer` executable against this same selected runtime and original
application state. Its customer workflow covers operations, Inbox commerce,
whole and chunked objects, typed datasets, and retained SSE/NDJSON responses.

The complete [acquisition workflow](ACQUISITIONS.md) joins private merchant
requests, explicit receiver review, original operator preparation, immutable
runbooks, native execution/accounting, verified downloads and recovery of every
original operator journal. Use `AcquisitionWorkspace` directly or
`buyer.acquisitions(...)`; Node and Python share the same original bridge.

This package connects an application to the **existing SF88 operator buyer**. It
also fits the original SF30 generated client's `createSellerClient({ buyer })`
interface. It does not implement a signer, approve payments, decide settlement,
replace the SF36 ledger, or automatically retry a purchase.

The complete path is: saved catalog or generated API request -> private immutable
operation -> original offline review -> one original native attempt -> durable
output -> verified application data. Cancellation and restart recovery retain the
original intent. A process crash does not authorize another attempt.

The same Buyer also handles persistent dataset acquisition and verified SF100
rows, described below, and the complete [large-file object workflow](OBJECTS.md).
`createObject`/`attachObject` retain a native chunk acquisition; `download`,
`recover`, `assemble` and `delivery` return the original progress and verified
file to the customer application. The existing `buyer-node` command includes
the matching `object-*` lifecycle, without a new package or payment engine.
`accounting` and explicit `finalize` invoke the original chunk reservation
continuation and return its native report separately from file completion.

The complete [dataset and object accounting workflow](ACCOUNTING.md) reads or
finalizes every original page/chunk range, reports progress to an async consumer,
stops on cancellation, reopens saved native command output after a process loss,
and streams the complete financial view to a new private JSONL file. These methods
use the same native sessions and are usable independently of delivered data files.

Finite SSE and NDJSON responses use the same native operation and retained file.
Select `responseFile.stream` before review, then consume verified records with
`result.events()` or `result.ndjson()`. Reopen them after a restart with
`operation.recover()`. The [streaming application guide](STREAMS.md) covers both
completed responses and retained complete records from an interrupted transfer.

The complete [customer inbox workflow](INBOX.md) joins merchant packet or
generated-client intake to the original private SF88 queue. Review several
saved requests, execute one selected intent through native terminal approval,
cancel an unattempted job, recover after interruption, consume its verified
file or stream, and finalize/export the original history. A transferred Node
operation stays bound to that one inbox. The same `buyer-node` command exposes
the entire `inbox-*` workflow, with complete private handover and reopening.

## Install and runtime

Node 22 or later is required. There are no npm dependencies or install scripts.
Use the package directly from this checkout, or install it into an application:

```sh
npm install --ignore-scripts /absolute/checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node
```

This is a source/local package; this change does not claim an npm registry release.
The **original complete Stellar Forge runtime** must remain installed separately.
`runtimeDirectory` is the absolute path to `sf88-operator-buyer-cli`, not the
repository root. Original native dependencies, Python policy/ledger, operator
configuration and signing setup remain as documented in the parent README and
NATIVE_SIGNER.md. No credentials are downloaded or embedded by this package.

Use a private caller-owned state directory (0700 on POSIX). Do not share it between
untrusted OS users. Windows requires an appropriately restricted directory ACL;
the package does not configure Windows ACLs. Linux is the exercised platform.

## Existing private SF88 config

```js
import { Buyer } from '@stellar-forge/native-buyer';

const buyer = new Buyer({
  runtimeDirectory: '/srv/forge/sf88-operator-buyer-cli',
  stateDirectory: '/srv/private/customer-purchases',
});
const operation = await buyer.fromConfig('/srv/private/operator.json');
const review = await operation.review();
console.log(review.native); // Offline terms and request/body fingerprint only.
const result = await operation.execute({ review });
result.raiseForStatus();
const data = await result.json();
```

`fromConfig` copies request bytes and records their hash. The native evidence and
saved response paths are relocated into the new operation's private directory;
response limits, content pins and selected stream format are retained. Original operator/policy/ledger/signer
paths are not copied or reimplemented. To export a completed download use
`result.saveAs('/absolute/new-file')`, which never overwrites an existing file.
Merchant `ticketFile` bytes are validated by original SF88, copied privately and
pinned by hash; no ticket bearer enters the review/attempt metadata. Original
expiry and merchant verification remain authoritative. An operation's configuration
cannot be edited through this API after creation.
A changed config/body is detected before execution and during recovery.

No JavaScript callback is substituted for native approval: `execute` still enters
original SF62/SF81 and SF36 policy. The same interactive/noninteractive rules of
the original runtime apply, including stdin inheritance. There is no newly
invented approval service or permission bypass.

## Original generated customer client

Download the seller's original generated `seller-client.mjs` from the existing
merchant developer portal, or use the original SF30 `developer/client-export.mjs`.
Inspect/trust that local code before importing it; never import an arbitrary URL.

```js
import { Buyer } from '@stellar-forge/native-buyer';
import { createSellerClient } from './seller-client.mjs';

const buyer = new Buyer({
  runtimeDirectory: '/srv/forge/sf88-operator-buyer-cli',
  stateDirectory: '/srv/private/customer-purchases',
  operatorProfile: '/srv/private/operator-profile.json',
});
const api = createSellerClient({ buyer });
const result = await api.call('the_actual_exported_operation_id',
  { path: {}, query: { limit: '20' } },
  { intentId: 'customer-report-2026-10-11', maxAtomic: '1000', acceptIndex: 0 });
const data = await result.json();
```

Use the actual operation ID and inputs declared by your generated client.
`acceptIndex` selects an original offered tuple; it is not a price override.
The existing generator still constructs path/query/body and accepted terms.
An operator profile accepts `operator`, `signerModule`, `trustedPayer`,
`bodyCaptureTimeoutMs`, `buyerTransport`, and `requestTimeoutMs`. Original SF31 validates explicit
proxy profiles and pins their origin; this adapter does not infer a proxy. Signer secrets stay in the provided process environment.
`approve`/`sign` function arguments are explicitly rejected at this process
boundary rather than silently ignored. Configure the original signer module.

For review before execution, call `buyer.fromRequest(api.request(...))`, then
`operation.review()` and `operation.execute({ review })`. TypeScript declarations
are included; no `@types/node` dependency is required to consume the public API.

## Runnable customer application

`examples/customer.mjs` is a complete command-line application, not pseudocode.
Run `node examples/customer.mjs --help` for the exact flags. Its `review` command
imports a trusted generated client and records a native offline-reviewed operation.
`execute` uses that saved operation, not newly entered request fields. `recover`
reads output without buying. `list` shows all local operations. `--output` exports
a completely verified saved file with exclusive publication.

The review and execute commands deliberately share `--state` and `--intent`:

```sh
node examples/customer.mjs review --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --profile /srv/private/operator-profile.json \
  --client /srv/app/seller-client.mjs --operation actual_operation \
  --inputs /srv/private/request-inputs.json --intent report-001 --max-atomic 1000 --accept 0
node examples/customer.mjs execute --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --intent report-001 --output /srv/private/report.json
```

For saved discovery instead of generated clients, `buyer.discover(catalog)` calls
original unsigned `--discover`; `buyer.prepare({ discoveryFile, row, accept,
intentId, url, method, body, headers, operatorProfile })` calls original
`--prepare` and snapshots the resulting exact operation. These APIs do not replace
the existing dataset/object multi-page acquisition sessions.

Ordinary headers such as `{'Content-Type':'application/json',
'accept-language':'en-US','x-region':'eu'}` are accepted by both `prepare` and
`fromRequest`. Preparation writes a private headers file and passes it to the
original runtime's `--headers-file`; generated requests pass through the same
original native review before an operation is returned. There is no separate
Node allowlist. The original runtime canonicalizes names and rejects duplicate,
reserved or whitespace-changing values. This requires the matching current SF88
runtime. Stream readers load the original SF31 parser from that selected runtime,
so native capture and retained application consumption use the same framing rules.

For a merchant-issued POST, retain the exact body and ordinary headers and pass
`ticketFile` with its optional `ticketHeader` to `prepare`, or import the
merchant's prepared configuration with `fromConfig`. Review shows the ordinary
values and private ticket fingerprint; the original ticket bearer stays in its
private file. The immutable configuration and existing inbox preserve these
values across restart. Authentication and payment headers stay with the native
operator and signer; SF98 order headers retain their original URL-bound check.

For a complete merchant download from another host, use the matching native
runtime and import directly:

```js
const operation = await buyer.fromOperationHandoff(
  '/private/merchant-operation.handoff.json', { accept: 0 }
);
const review = await operation.review();
// Execute the reviewed operation with this buyer's own configured profile.
const result = await operation.execute({ review });
```

Choose the actual offered payment option. The native importer validates the
original ticket and creates local input paths; this package retains the body and
ticket in its operation directory before removing temporary import files. The
merchant's stable intent remains unchanged, and the packet contributes no
operator or signer settings. Reopen an existing intent with `buyer.operation`.
Keep the received file private (`0600`) at a canonical absolute path.

## Dataset acquisition inside a Node application

The same `Buyer` now exposes the original SF88 dataset session and original SF100
local delivery. A named acquisition can be created from a private original buyer
configuration, or attached to the original operator workspace produced by the
merchant's dataset publisher. It keeps that workspace's keys, shared ledger,
selected snapshot, native query, per-page approval and total allocation limits.

```js
import { Buyer } from '@stellar-forge/native-buyer';
// In the complete merchant distribution, import the same exports from:
// '@tokenjunkielabs/starforge-merchant/buyer/node'.

const buyer = new Buyer({
  runtimeDirectory: '/srv/forge/sf88-operator-buyer-cli',
  stateDirectory: '/srv/private/customer-purchases',
});
const dataset = await buyer.createDataset({
  id: 'inventory-2026-10-11',
  workspaceDirectory: '/srv/private/inventory-buyer',
  maxPages: 20,
  maxTotalAtomic: '20000',
  maxRows: 100000,
  maxPageBytes: 1048576,
});
console.log((await dataset.inspect()).native);

// This is the only dataset method that can acquire new pages.
const acquisition = await dataset.run();
console.log(acquisition.native.status, acquisition.process);
if (acquisition.native.status !== 'COMPLETE') {
  // Display the original limits, stoppedPage and next guidance to the operator.
  // A RECONCILIATION_REQUIRED page has already been attempted; do not create a
  // replacement acquisition to repeat that purchase.
  throw new Error('The original acquisition has not completed');
}

// This is an offline original SF100 export; it makes no buyer or signer calls.
const delivery = await dataset.deliver();
const rows = await delivery.readRows(); // fully verified before returning
console.log(delivery.manifest.dataset, rows);
await delivery.file('dataset.csv').saveAs('/srv/private/inventory.csv');
```

`id` is the stable application name; the original config's `operation.intentId`
remains the native session identity. Reusing an application name gives
`DATASET_ALREADY_EXISTS_USE_OPEN`. Use `buyer.dataset(id)` to reopen it. New
acquisitions have an original session inside the named application directory;
the private mapping never relocates or changes the original session files.

For a standalone buyer configuration, replace `workspaceDirectory` with
`config: '/srv/private/dataset-buyer.json'`, or pass that configuration as a JSON
object. The original dataset engine requires a GET operation without a body or
single-response capture path. Supply the actual seller query and original
accepted terms. An optional original operator profile is applied only to this
configuration source. A workspace always supplies its own original configuration
and keys; application profiles do not override it.

The `expectedSnapshot` option binds an explicitly selected native snapshot. When
it is omitted, an existing `snapshot` URL parameter is preserved. New acquisitions
use the original shared SF88/SF100 limits: 1–4,096 pages, 1–1,000,000 rows,
1,024–2,097,152 bytes per page, and a positive decimal atomic-unit allocation
ceiling. The original runtime validates these values before creating a native
session; this SDK does not maintain a separate policy. Existing native sessions
retain their original read/recovery compatibility. Total allocations and actual
charges are separate values; the original ledger and evidence retain financial
authority. The original SF100 exporter also limits combined CSV/JSONL output to
256 MiB.

### Reopen, resume and attach an existing acquisition

```js
const existing = buyer.dataset('inventory-2026-10-11');
const state = await existing.recover();
console.log(state.native); // original recovery: no HTTP, signing or purchase
if (state.native.status === 'READY') {
  // Explicit continuation: acquire only pages the original engine has not tried.
  await existing.run();
}
const delivery = await existing.deliver(); // same default destination resumes
console.log(delivery.report.resumed, delivery.report.appendedPages);

// Adopt an acquisition made by the original CLI or publisher-to-buyer workflow.
const adopted = await buyer.attachDataset({
  id: 'existing-inventory',
  directory: '/srv/private/original-acquisition',
});
console.log((await adopted.inspect()).native);
for await (const item of buyer.listDatasets()) console.log(item.id);
```

`attachDataset` verifies and binds the original session at its existing absolute
path. It does not clone the session, issue pages or replace its ledger. A running
session must finish before attachment because the original status contract then
returns only `RUNNING`, without its immutable identity. Recovery uses the original
same-host lock policy; this adapter does not clear unknown/live locks or invent a
new page controller. Do not move a native session after creation.

`initialize()` is an offline continuation after a lost creation/attachment
response. It checks the original source binding and reuses a complete original
session. The application entry is staged with complete private metadata before
its stable name is published; leftover `.dataset-stage-*` directories are private
preparation remnants and are ignored by the acquisition list. If the original
creation itself was interrupted before publishing a
valid `session.json`, the native error and private files remain available; no
purchase could have started through this initialization command. Run and recover
never silently change the saved configuration, expected snapshot or limits.

Pass `{signal}` to `run`, `inspect`, `recover`, `initialize`, `exportManifest`, or
as the second argument of `deliver`. Dataset commands use the original Node
SDK's native child, environment, timeout, output limit and cleanup grace.
The original `emitPageSummaries:false` option suppresses repeated page stdout;
the default 1 MiB stdout/stderr budget is separate from `datasetReportLimit`,
which defaults to 32 MiB and accepts 1–256 MiB. A report exceeding that limit
returns `DATASET_REPORT_LIMIT_EXCEEDED` after retaining the original session;
reopen with a larger report limit to inspect the saved outcome. The native page
and total acquisition limits still apply. A stop
reaches the original acquisition's AbortSignal. Its current native page may need
original reconciliation after interruption; a new `run()` never repeats a marked
page. An application crash does not destroy the separate original session.

Each completed command returns `{native, process}`. `native` is the original
report; `process` contains `exitCode`, `exitSignal` and `errorCode`. A clean stop
can return a useful partial original report alongside an abort error. If no
complete result was published, the error identifies `commandDirectory`; its
private native logs are retained. Successful commands retain the latest complete
command receipt and remove their temporary logs. Native stdout can include
per-page summaries, so it is not parsed as one artificial acquisition object.
The separate atomic report contains the original API return value.

### Consume exact typed data and exports

`DatasetDelivery.report` is the unchanged native delivery result;
`DatasetDelivery.manifest` is the verified original SF100 manifest. The existing
source-page hashes, query signature, snapshot, row count and payment-status
classification are retained. No purchase or settlement summary is manufactured
for a local export.

`readRows({limit, maxRows, signal})` verifies the complete JSONL output before
returning an array. Its defaults are 8 MiB and 100,000 rows. `rows({signal})`
streams larger datasets with a full preflight hash and a second hash while
reading, preserving the original JSON string/number/boolean/null values. It also
checks the original projected fields and row count. Strings representing exact
large numbers remain strings; the SDK does not coerce dates or numbers. As with
`BuyerResult.chunks`, exhaust a streaming iterator before committing external
side effects, because a final concurrent-file-change check can still fail.

Use `delivery.file('dataset.csv').csvRows({headers:true})` for the SDK's original
CSV reader. `file()` also accepts `dataset.jsonl`, `review.html` and
`manifest.json`; each file exposes `verify`, `chunks`, `bytes`, `json`, `csvRows`
and exclusive `saveAs`. Select the method that matches that file's actual format.
The shared `VerifiedFile` implementation backs both ordinary `BuyerResult` and
`DatasetFile`; byte limits, no-follow reads, digest verification and atomic export
have one implementation.

`deliver('/absolute/data-room')` resumes the original data room at that path.
Unrelated existing destinations are refused by the native exporter.
`exportManifest('/absolute/new-manifest.json')` publishes the original acquisition
manifest without a data room. Neither operation acquires pages.

### Runnable installed dataset customer

The existing `buyer-node` command includes the whole continuation. Use the same
`--runtime`, `--state` and `--dataset` arguments across invocations:

```sh
starforge buyer-node dataset-init --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --dataset inventory-2026-10-11 \
  --workspace /srv/private/inventory-buyer --max-pages 20 --max-total-atomic 20000
starforge buyer-node dataset-run --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --dataset inventory-2026-10-11
starforge buyer-node dataset-recover --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --dataset inventory-2026-10-11
starforge buyer-node dataset-rows --runtime /srv/forge/sf88-operator-buyer-cli \
  --state /srv/private/customer-purchases --dataset inventory-2026-10-11 \
  --output /srv/private/inventory.jsonl
```

`dataset-status`, `dataset-list`, `dataset-attach --session ORIGINAL_SESSION` and
`dataset-deliver --output DATA_ROOM` complete the same operator workflow. From a
source checkout, substitute `node examples/customer.mjs` for `starforge buyer-node`.
The original single-operation `review`, `execute`, `recover` and `list` commands
remain available. There is no additional package, dependency or application server.

## Recovery, concurrency and cancellation

```js
const existing = buyer.operation('report-001');
const saved = await existing.recover(); // No spawn, signer or HTTP call.
if (saved) await saved.saveAs('/srv/private/recovered-report.json');
console.log(await existing.inspect());
```

Every intent has a SHA-256-named directory. Creation is exclusive. Immediately
before launch, an fsynced atomic exclusive `attempt.json` records that the attempt
has started. Concurrent processes cannot both publish this marker. It does not
expire, and failed/timed-out/interrupted attempts are never automatically rerun.
Repeated `call()` with the same intent returns an explicit error pointing to
recovery; it does not silently issue a second request or assume an equivalent
request. Recovery also refuses changed configuration and body bytes.

Native stdout/stderr go directly to private files so a still-running native child
can finish recording its summary after an application-parent crash. If a complete
summary exists without a durably recorded process exit, recovery preserves
`PROCESS_EXIT_NOT_RECORDED` and `exitCode: null`. A valid saved file may still be
consumed. This is not a claim that settlement or process success was proven.
Partial/missing output remains recoverable only when the original native process
actually finishes; `recover()` does not fabricate a result.

Use one `AbortController` for the whole application task:

```js
const controller = new AbortController();
const { signal } = controller;
const operation = await buyer.fromRequest(request, { signal });
const review = await operation.review({ signal });
const result = await operation.execute({ review, signal });
// A Stop action calls controller.abort(); await the task before closing its workspace.
```

Preparation accepts `{signal}` in `fromConfig`, `fromWorkspace`,
`fromOperationHandoff`, and `prepare`. A generated `fromRequest` or `call`
accepts either `request.signal` or `options.signal`; when both are supplied,
aborting either stops the task. `call` carries the same combined signal through
preparation, offline review, and its original execution. A signal that is already
aborted is rejected before creating an operation or launching a review child.
The signal is an in-memory task control and is never written into the operation.

When preparation is cancelled, the creating call drains its native review and
removes its own unpublished operation. The same intent can then be prepared
again. Cancelling `operation.review({signal})` retains the already prepared
operation, so the application can review it again using a fresh signal.
Cancelling execution retains its original attempt and uses the recovery workflow
above. A workspace Stop/close handler should abort and await the active task
before releasing its lease.

On abort/timeout the SDK sends SIGTERM to its own tracked native child, waits for
`close`, and allows the
configured cleanup grace (default 15 seconds). If the native child does not exit,
it sends SIGKILL and records `NATIVE_CLEANUP_DEADLINE_EXCEEDED`. It does not promise
that forced termination reconciles payment or kills arbitrary grandchildren.
Original durable ledger/evidence remains authoritative. No stale PID is killed
by a later recovery call. On Windows process signals are forceful, so graceful
POSIX cleanup guarantees do not apply.

Default native timeout is 360 seconds and per-stream retained output budget is 1 MiB (100 ms sampling during execution).
Oversized logs are truncated after child exit and invalidate the result.
Private native logs are never embedded in application error messages. Configure
`environment` explicitly when the application should pass a reduced environment.
The default preserves the caller's original signer/operator environment.

`BuyerError` and its subclasses format as an error code, stack, and the public
`exitCode` and `destinationPublished` fields when available. `JSON.stringify`
uses the same public fields through `error.toJSON()`. Recovery objects, saved
results, paths and other private details remain directly accessible through
`error.operation`, `error.dataset`, `error.acquisition` and their existing
properties, but are non-enumerable and excluded from default diagnostic output.
Use those handles to reopen the existing operation after handling the error.

## Data consumption and integrity

A `BuyerResult` preserves the native summary, exit status, recovery marker and
response-file metadata separately. `ok` is native process/HTTP success, **not an
independent on-chain finality certificate**. `raiseForStatus()` is optional when
recovering useful saved data after an evidence/cleanup failure. Inspect the
original outcome report for its authoritative classification.

`bytes()` and `json()` verify size/SHA-256 completely before returning data; the
default memory limit is 8 MiB. `verify()` hashes without buffering. `chunks()` and
`csvRows()` first verify the saved file and verify again while streaming, using
no-follow file opens and size/time checks. Exhaust the iterator before committing
external side effects; concurrent same-user mutation can still cause a final
integrity error after earlier chunks/rows were consumed. Early iterator return
closes its descriptor but is not a full-stream verification.

`csvRows({ headers: true })` handles UTF-8/BOM, quoted commas/newlines, escaped
quotes, CRLF and chunk boundaries. Duplicate/empty headers, differing column
counts, invalid UTF-8 and malformed quoted fields are rejected. It yields string
records without numeric coercion; plain `csvRows()` yields arrays. Field length
is limited to 1 MiB of characters by default. `saveAs` streams to a private
partial file and publishes the destination only after complete digest validation.

The state format is `stellar-forge.node-buyer.v1`; it is intentionally separate
from the Python package's format. Both use the same original native financial
ledger when configured to do so, but their application state directories and
attempt markers must not be interchanged. Filesystem durability assumes a local
filesystem supporting atomic hard links and fsync; network/distributed filesystems
require their own validation.

## Use an existing native operator workspace

`buyer.fromWorkspace(directory, { configuration, intentId, responseFile, requestTimeoutMs })`
adopts the original SF88 workspace directly. Its operator, private evidence, signer,
transport and payment limits remain bound by the original inbox checks; workspace
keys are loaded only inside the original native child. An optional authored
configuration selects another explicit request under that same operator and budget.
The default Buyer profile does not replace workspace authority.

Preparation and review remain offline. Execute checks current native setup and the
controlling terminal before recording an attempt, then uses the original workspace
execution and manifest-selected evidence RPC. Recovery only reads the retained
result, including when the workspace is temporarily absent. For full setup, request
adoption, inbox/accounting handoff and original recovery, see [WORKSPACE.md](WORKSPACE.md)
and [examples/workspace_customer.mjs](examples/workspace_customer.mjs).

## Whole customer workspace backup and restore

`buyer.workspaceRecovery()` includes the existing Node application state alongside
an explicitly selected original operator, inbox and other application/session
roots. `WorkspaceRecovery` also works before a Buyer exists, so a missing root
can be restored before application initialization recreates it. Inspect, encrypted
snapshot, independent verification and original-root restore all invoke the
existing SF88/SF101/SF36 implementation through the same native Runtime.

See [the complete customer recovery workflow](RECOVERY.md) for passphrase-variable
selection, quiescing writers, expected-record binding, typed interruption results
and reopening the same Node and Python applications without repeating purchases.

## LangGraph and LangChain applications

[FRAMEWORKS.md](FRAMEWORKS.md) provides the optional persistent graph, standard LangChain tools, TypeScript customer program, and executable operator CLI. Select one existing `buyer.operation(intentId)` and retain its original state. Graph checkpoints and ToolMessages refer to that same operation, native attempt, and verified response. The base package remains dependency-free; install the optional frameworks only for their corresponding subpath imports.

## Explicit continuation after an unpaid transport failure

When the original native buyer records `INITIAL_TRANSPORT_FAILED` before any
signature, the application can preserve that result and prepare one explicit
successor after correcting the connection. For example, a merchant's existing
CA bundle may need to be included in the native child environment. Continue to
verify the merchant hostname and certificate chain, and retain the original
operator, ledger, signer, URL, request bytes and accepted terms.

`operation.recover()` always returns the original operation's saved outcome.
Use the following separate preparation call when the application operator has
selected a continuation:

```js
const original = buyer.operation('customer-report-2026-10-11');
const status = await original.inspectUnpaidContinuation();
if (!status.eligible) throw new Error(status.reason);

const successor = await original.prepareUnpaidContinuation({
  intentId: 'customer-report-2026-10-11-transport-repaired',
  expectedResultSha256: status.resultSha256,
  reason: 'Included the existing merchant CA and verified the unchanged HTTPS endpoint.',
  signal,
});

// Existing terminal approval, original policy and native attempt gate all apply.
const result = await successor.execute({
  review: await successor.review({ signal }),
  signal,
});
const data = await result.json();
```

Preparation requires the exact final result digest, the chosen successor ID and
a recorded remediation reason. It checks the original recorded process exit,
native stdout, original checkout evidence and outcome report together. Eligibility
requires the native initial-transport failure, explicit `paymentSent: false`,
zero signature/transfer/uncertain outcomes and no operator reservation or response
file. The request, body, operation ticket, operator configuration and native
workspace remain bound to their original bytes and settings.

One immutable `unpaid-continuation.json` chooses the successor under the original
private descriptor/flock serialization pattern. Its ready record binds the
successor's prepared configuration and metadata before that successor can execute.
Repeating preparation with the same ID, result digest and reason returns that
same operation. Selecting a different successor for that parent fails with
`UNPAID_CONTINUATION_ALREADY_SELECTED`. A process interruption during preparation
retains the partial private files and resumes the same chosen ID; a completed
preparation or native attempt is reopened. Linux util-linux `flock` is required
for this explicit feature.

To resume an application, follow an already prepared lineage and recover its
actual selected operation:

```js
const active = await buyer.operation('customer-report-2026-10-11')
  .followUnpaidContinuation();
let result = await active.recover();
if (result === null && (await active.inspect()).state === 'PREPARED') {
  result = await active.execute({ review: await active.review({ signal }), signal });
}
```

`followUnpaidContinuation()` is read-only. It validates each existing parent and
successor binding; it does not select a successor, prepare an operation, authorize
a payment or execute a buyer. The research page fetcher uses this same following
method before its normal recovery and execution path, so the saved logical page
request and edition cursor survive a corrected transport. Every successor still
has its own nonreplaceable native attempt marker. A further continuation requires
another explicit call against an eligible final outcome.

The original failed result, attempt, evidence and configuration remain available
under their original ID. Errors with a missing final process outcome, possible
signature, reservation, response or uncertain transfer must use their existing
native recovery/accounting path.
