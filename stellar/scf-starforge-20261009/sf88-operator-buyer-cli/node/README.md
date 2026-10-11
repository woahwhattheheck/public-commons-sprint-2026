# Native buyer for Node applications

This package connects an application to the **existing SF88 operator buyer**. It
also fits the original SF30 generated client's `createSellerClient({ buyer })`
interface. It does not implement a signer, approve payments, decide settlement,
replace the SF36 ledger, or automatically retry a purchase.

The complete path is: saved catalog or generated API request -> private immutable
operation -> original offline review -> one original native attempt -> durable
output -> verified application data. Cancellation and restart recovery retain the
original intent. A process crash does not authorize another attempt.

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
response size/time limits are retained. Original operator/policy/ledger/signer
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
An operator profile accepts only `operator`, `signerModule`, `trustedPayer` and
`bodyCaptureTimeoutMs` and `buyerTransport`. Original SF31 validates explicit
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

Pass an `AbortSignal` to `execute` or generated `call`. On abort/timeout the SDK
sends SIGTERM to its own tracked native child, waits for `close`, and allows the
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
