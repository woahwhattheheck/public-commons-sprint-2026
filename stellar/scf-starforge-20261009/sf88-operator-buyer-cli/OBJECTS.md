# Download a complete paid object

The original SF30 S3 merchant sells whole files or independently paid byte
chunks. This workflow selects that merchant's existing object description,
prepares the selected requests in the original SF88 buyer inbox, saves the returned
bytes, continues a download after restart, and assembles the complete file. The original
SF81 approval, SF36 spending ledger, SF31 HTTP buyer and SF82 checkout evidence
remain the execution path for every request.

The object session adds no wallet, payment transport, automatic paid retry or
hosted service. It uses the installed source on the operator's Linux/POSIX host.
Node 22+ and the existing buyer prerequisites apply. See [README.md](README.md)
for native signer/workspace setup and [QUEUE.md](QUEUE.md) for the underlying
durable inbox.

## Operate from the browser

The [object buyer workspace](object-workspace/README.md) joins product selection,
exact byte-plan and cap review, original buyer execution, saved-result recovery,
assembly and browser file download. Launch it with a private state directory and
a trusted profile referencing the existing merchant description and native buyer
configuration. Its sessions remain directly usable by the commands below.

## Select the merchant's original file product

Obtain the merchant's original `objects.json` from its selected S3 release. The
[S3 configure command](../sf30-seller-sdk/s3/README.md) already creates this file
with schema `stellar-forge.s3-description.v1`. It contains public product aliases,
paths, byte counts, chunk limits, content types, filenames and pinned snapshot
IDs. It does not contain S3 credentials, private bucket names or object keys.

Use the existing buyer discovery or captured-challenge preparation to select the
merchant's actual HTTPS route and payment terms, then initialize the original
operator workspace. For this workflow the source configuration must target the
base GET route with no query string or request body. It must not already select
a response destination. The object session retains the selected delivery mode,
stable intent and response destination. A whole-file product makes one GET to
that exact URL with no query. A chunked product derives each exact `offset` and
`length` from its reviewed byte plan.

Create an operator-private parent directory, then select one object by its exact
merchant alias. Use absolute paths. These examples use existing reviewed input
files and intentionally do not supply payment identities or a signing key:

```sh
mkdir -m 700 /absolute/private/downloads

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs init \
  --session /absolute/private/downloads/archive-session \
  --config /absolute/private/archive-operator/operator.json \
  --workspace /absolute/private/archive-operator \
  --description /absolute/private/merchant-objects.json \
  --object archive \
  --max-total-atomic 3000
```

Replace the example paths, alias and limit with the selected product and your
actual authorized budget. The initializer verifies that the chosen descriptor
row is in `chunks` or `whole` mode and its route matches the original buyer
configuration. It takes the byte count, response limit, content type, snapshot
and optional complete-file SHA-256 directly from that row. For chunks,
`--chunk-bytes` can choose a smaller positive size up to the merchant's maximum.
For a whole file, omit that flag: the complete response length is fixed by the
merchant. The saved selection includes the exact original description's SHA-256
and object alias.

| Selected delivery | Native request | Required complete response | Planned requests |
| --- | --- | --- | --- |
| `whole` | GET of the exact base URL; no query or Range header | HTTP 200, no Content-Range, exact selected complete length | One, including a zero-byte file |
| `chunks` | GET with exact `offset` and `length` query | HTTP 206 and the matching Content-Range | Complete byte count divided into the selected bounded chunks |

Select a report or versioned whole-file product with the same command by changing
`--object` and the matching buyer configuration. Its total and daily limits must
cover one original per-request maximum. An empty whole file still has one
original request and its quoted price; a byte count of zero does not make a paid
offer free. Its native writer reserves a one-byte maximum capacity and pins
`expectedBytes: 0`, so an unexpected nonempty response cannot be accepted.

The total limit must cover the complete number of chunks multiplied by the
original per-request `maxAtomic`. For example, 1,843,229 bytes at 921,600 bytes per
chunk requires three requests; a per-request cap of 1,000 atomic units requires
a whole-download limit of at least 3,000. The final request asks for the remaining
byte count. These are maximum allocations, not reported charges. The existing
workspace's total and daily budgets must also support the desired requests; its
live policy and ledger continue to enforce their original limits.

Initialization is offline. It creates a new `0700` session with `0600` state and
chunk configuration files, its own original buyer inbox, and private response
destinations. It shares the configured original evidence directory, signer and
spending ledger. An existing session is never overwritten.

## Review and run

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs status \
  --session /absolute/private/downloads/archive-session

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs report \
  --session /absolute/private/downloads/archive-session \
  --out /absolute/private/downloads/archive-before.html

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs run \
  --session /absolute/private/downloads/archive-session
```

The HTML report is a local, grayscale operations view. It shows the selected
object, download progress, exact byte ranges, original intents, response hashes
and current attempt outcomes. Its search, state filter, pagination and JSON
export run entirely in that file. Copyable commands enter the trusted terminal;
the page has no signing or payment controls and contacts no service.

`run` executes new requests serially through the original inbox. The original
operator approval still reviews each current quote and exact selected URL.
Saving the session or running the command does not replace that per-request
approval. The original queue supplies the saved workspace when it was selected
at initialization. For an existing session created without a workspace, pass
`--workspace /absolute/private/archive-operator` to `run`, or use the original
configured operator environment.

For each completed original response the workflow requires:

- An original execution attempt and complete saved buyer summary for the same
  stable intent, URL, terms and response destination.
- The selected mode's HTTP status and range contract from the table above.
- The selected `X-SF30-Object-Snapshot` and total `X-SF30-Object-Bytes`.
- A matching returned `X-Content-SHA256`, original local writer SHA-256 and
  freshly read file bytes, plus the selected content type when supplied.
- The corresponding original checkout evidence and its outcome semantics.

The original response writer retains these selected headers in
`responseFile.objectMetadata`; the object session validates them. Seller
metadata remains seller-reported metadata. It is not a signature, independent
chain observation, or proof of a payment.

Whole-file requests also pass the selected complete length and optional SHA-256
to the original response writer before execution. A mismatched file remains an
original failed attempt for reconciliation. The original snapshot, returned
digest, actual saved bytes and content type are still checked independently.

## Continue and recover

Run the same session again to continue from its next unattempted chunk. Verified
completed chunks are read from their saved files, rather than requested again.
SIGINT or SIGTERM stops advancement and forwards cancellation to the current
original request.

After an interrupted process, inspect and recover the same session:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs recover \
  --session /absolute/private/downloads/archive-session
```

Recovery is offline. It reopens the original inbox and saved files and can release
this session's proven-dead local process lease. A live process retains its lease.
Immutable numbered claims and generation-specific releases prevent a delayed
recovery from releasing a newer run.
Existing original terminal summaries and evidence determine which chunks are
complete. An attempted chunk with missing or inconsistent delivery records is
reported as `RECONCILIATION_REQUIRED`, with its original intent and file locations.
Recovery never sends that intent again or deletes its attempt marker.

Use the original inbox `show`/`recover` commands and spending ledger for that
intent. A response file alone cannot reconstruct missing object headers, and
payment evidence alone does not establish a saved binary response. The session
retains these distinctions so an interrupted purchase does not cause another
payment. Original evidence, partial files and completed chunks stay available
for the existing operator recovery process.

## Complete the original purchase accounting

The same object session exposes the original inbox finalizer for its retained
attempts. A whole file has one original accounting row; a chunked file has one
per request. Product assembly and accounting can finish independently:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs finalize \
  --session /absolute/private/downloads/archive-session

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs accounting \
  --session /absolute/private/downloads/archive-session
```

`finalize` uses the session's saved workspace, or an explicit matching
`--workspace` for an older config-only session. It invokes the existing inbox
accounting core with the original attempt, complete approved request, workspace
keys, ledger, evidence directory and selected-network RPC. It does not download
a chunk, import a wallet, create an attempt or substitute a new reservation.
Missing product bytes do not prevent the original approved debt from being
accounted for. Current lower spending limits do not erase historical authority.

Both commands return a selected range of at most 100 chunks by default. Use
zero-based `--offset` and `--limit` (1–250), then continue `range.nextOffset` until
null. Each entry retains its original intent and native finalized amount/receipt,
or a specific unresolved condition. Free original responses remain
`NO_PAYMENT_REQUIRED`; unattempted chunks remain `NOT_ATTEMPTED`.
An accounting result does not assert that the product file was delivered.

`accounting` reads the existing inbox views without keys or RPC. After a process
interruption, reopen that same session and read saved receipts. A later source
failure keeps the earlier result in `lastFinalized`; resolve the reported cause
and explicitly run finalization for that same range. Original SF36 receipt reuse
prevents duplicate ledger transitions. Exit code 2 identifies unresolved entries;
`viewStatus: SAVE_FAILED` keeps an actual worker result visible when its display
record could not save. Optional paired `--outbox` and `--merchant-route` arguments
use the existing merchant notification path.

Applications can import `accountObjectSession` from `object-session.mjs` or use
Python's `ObjectSession.finalize_all()` to visit every retained chunk and yield
progress through the [same customer workflow](python/README.md#finish-dataset-and-object-purchase-accounting).

## Assemble and hand over the complete file

When status is `COMPLETE`, assemble into a **new** absolute destination beneath
an existing private directory:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs assemble \
  --session /absolute/private/downloads/archive-session \
  --out /absolute/private/downloads/archive.zip

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs report \
  --session /absolute/private/downloads/archive-session \
  --out /absolute/private/downloads/archive-complete.html

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs export \
  --session /absolute/private/downloads/archive-session \
  --out /absolute/private/downloads/archive-state.json
```

Assembly revalidates the saved responses and streams them in byte order into a
private temporary file. It verifies each chunk and the final length, computes
the complete SHA-256, and checks the merchant's expected whole-file digest when
one was supplied. Publication is create-only; an existing destination stays
unchanged. The source chunks and original inbox remain intact.

The session saves a receipt for each completed destination under `assemblies/`.
The live assembly result marks the output `SAVED` with `fileRevalidated: true`.
Later status and report commands show that receipt as `RECORDED` with
`fileRevalidated: false`: they verify the retained chunks, while the recorded
destination may have been moved or changed after assembly.

An absent merchant whole-file digest does not prevent assembly: the pinned
snapshot, exact ranges and per-chunk hashes still identify the delivered sequence,
and the result reports its measured complete-file SHA-256. That measured hash is
useful for local transfer verification; it is not a substitute for an independently
supplied expected digest.

## Explicit object facts and embedding

For another merchant that implements the same original byte-range response
contract, an operator may supply already-reviewed facts explicitly instead of a
description file. Choose one input method per initialization:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs init \
  --session /absolute/private/downloads/selected-object \
  --config /absolute/private/operator.json \
  --bytes 1843229 --chunk-bytes 921600 \
  --snapshot ACTUAL_SELECTED_64_HEX_SNAPSHOT \
  --sha256 ACTUAL_EXPECTED_64_HEX_DIGEST \
  --content-type application/zip --max-total-atomic 3000
```

The placeholder hashes must be replaced with actual selected values; `--sha256`
and `--content-type` are optional in this explicit form. Explicit facts default
to the nonempty chunk contract. For an original whole-response contract, add
`--delivery-mode whole`, provide the complete `--bytes` count (zero is allowed),
and omit `--chunk-bytes`. The source URL stays query-free and the one request
uses HTTP 200 semantics. A whole product cannot be converted into byte ranges
by changing a client-side size field.

Saved session schema and existing part/queue field names remain compatible.
Sessions predating `deliveryMode` reopen as `chunks` with their original exact
configuration hashes and URLs. New reports expose `deliveryMode` explicitly;
the existing `chunkCount` is one for a whole response. Recovery, accounting,
assembly, HTML/JSON export and the browser's cancellable file transfer use the
same retained intent and do not acquire a completed object again.

Applications can import `createObjectSession`, `inspectObjectSession`,
`runObjectSession`, `recoverObjectSession`, and `assembleObjectSession` from
`object-session.mjs`, `selectObjectDescription` from `object-description.mjs`, and
`renderObjectReport` from `object-report.mjs`. `runObjectSession` accepts an
AbortSignal, an optional original workspace and an `onChunk` progress callback.
It invokes the original queue executor and exposes no replacement signer or
approval callback. The command wrapper is also available as `starforge buyer-object`
in a distribution containing this release.
