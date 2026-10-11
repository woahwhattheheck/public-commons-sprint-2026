# Acquire a complete dataset with the existing buyer

The SF88 dataset command takes an existing approved-buyer configuration and
acquires the paginated CSV dataset served by the original SF30 CSV handler.
It keeps the original SF88 execution, SF81/SF62 terminal review, SF36 budget
reservation, SF31 payment transport and response-file writer, and SF82
checkout evidence.

An operator can start a purchase, stop between pages, and resume from the last
complete page. Every new page still presents its own actual quote through the
original approval path. The command never signs a page merely because another
page was approved.

## Start and run

Use Node 22+ and the same Python, official signer module, private policy, shared
SF36 ledger, and operator environment already used for the original SF88 buyer.
Start from a working SF88 configuration. Its operation must be a GET to the
original dataset endpoint, with the desired fields, filters, sort and page limit
in the URL. The first URL must not contain a cursor. Use the current original
SF100 exporter that exports checkPage and appendMany (PR #885 or later).

For example, the URL below describes a selection; replace the hostname and query
with the actual merchant dataset before running:

    https://merchant.example/data?fields=id,region,value&where_region=east&limit=100

The acquisition supports the original SF30 field projection, equality and range
filters, single-column sorting and page limits. For a merchant that enables
range filtering and sorting on value, an advanced selection is:

    https://merchant.example/data?fields=id,region,value&where_region=east&gte_value=100&lt_value=500&sort=-value&limit=100

Range operators are gt_, gte_, lt_ and lte_ followed by the declared column name.
Select at most one lower and one upper bound per column. A sort has one declared
column name, optionally prefixed by - for descending order. The original seller
retains CSV order among equal values and places nulls last. Only capabilities
enabled in the merchant's original dataset configuration are accepted. The
seller's existing admission function checks its actual schema before payment.

Initialization rejects malformed fields, repeated or unknown parameters,
conflicting range bounds, invalid sort names and invalid page limits before
creating an attempt. Saved pages are checked with the original SF100 checkPage
function and matched to the exact requested typed query. Equality-only sessions
retain their original query digests and remain resumable after this update.

Keep captureBody false or absent. Omit responseFile: the session creates a
separate destination for every page. Keep the same original SF36 ledger across
sessions so its existing account, service and agent budgets remain shared.

Create a new session under an existing trusted parent directory:

    node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs init \
      --session /private/purchases/east-region \
      --config /private/buyer.json \
      --max-pages 20 \
      --max-total-atomic 20000

The max-pages and max-total-atomic flags are required. Atomic amounts are decimal
strings in the config's exact asset and network, with no floating-point
conversion. The existing operation.expect.maxAtomic remains the per-page cap.
The session lowers the final page's cap to the remaining overall allocation
when necessary; a higher offered price is rejected by the original buyer
before signing.

Optional max-rows defaults to 1,000,000. New sessions allow at most 4,096 pages
and 2 MiB per page, matching the original SF100 import limits. The max-page-bytes
flag defaults to 1 MiB and is applied by the original streaming response writer.
An incompatible configured ceiling is rejected before creating a session or
attempt. Existing session definitions remain readable and recoverable. The
original exporter's aggregate archive/export ceilings still apply to the acquired
selection. If the actual dataset
snapshot is already known, the snapshot flag validates its exact 64-character SHA-256.
Otherwise the first completed native page pins the snapshot for the rest of
the session.

For the original versioned seller, put its advertised `snapshot=SHA256` selector
in the first request URL to choose a retained generation **before** the first
page is bought. Initialization takes that same SHA as the expected snapshot;
a conflicting `--snapshot` is refused before creating the session. Later pages
retain the selector and must agree with the native cursor's snapshot. The
selector is consumed by the original version store and does not alter SF100's
existing semantic query or cursor signatures. The standalone `--snapshot` flag
without a URL selector continues to validate returned pages; it cannot select
a server generation by itself.

The merchant's [publishing workspace](../sf30-seller-sdk/dataset-refresh/WORKSPACE.md)
can produce this URL and the original `prepareReview()` config from its actual
running offer. Review that config and initialize the original private buyer
workspace with its normal payer, signer, Python and budget options. To use its
stored operator keys, replace `--config` at acquisition initialization with:

    --workspace /private/dataset-buyer

Choose exactly one config source. This attaches the original workspace, keeps
its SF36 ledger shared, and records its exact configuration identity in the
session. Each new page reopens that workspace through its original API and
refuses changed configuration before creating an attempt marker. Actual
execution loads operator keys only through `openWorkspace(..., {execute:true})`
and passes that original environment into SF88. Status, recovery, completed
acquisition reuse and SF100 delivery remain offline and do not require keys.
The workspace and the acquisition session are separate private directories.

Initialization is offline. It copies only the original configuration and public
quote/path settings into a private directory. It neither imports the signer nor
issues payment consent. Existing secret keys stay in the operator environment.

Inspect the first page's exact operation, then run from the trusted terminal:

    node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs status \
      --session /private/purchases/east-region
    node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs run \
      --session /private/purchases/east-region

Each new page uses the original execute.mjs function. It prints its existing
buyer summary, followed by the session's final JSON report. Progress goes to
stderr. The normal original operator prompt and original ledger reservation
must succeed before the native signer can run.

## Page and budget behavior

The command derives a stable page intent from the session configuration,
original intent ID, page number and exact URL. It writes a create-only durable
attempt marker before invoking the buyer. Both the page response and original
checkout evidence are private, create-only files.

Completed responses must match the original SF30 dataset-page.v1 contract:

- The dataset name, full column description, snapshot, selected fields and
  typed equality/range filters and selected order remain identical across pages.
- The request's fields, filters, sort and limit must match the response.
- Native cursor version, snapshot, query digest and offset must match exactly.
  Cursor offsets must be contiguous; the final cursor must be null.
- The number and types of returned cells, page counts and total rows must agree.
  Duplicate row values are legitimate data and are not removed.
- The response-file hash, original intent, checkout status and original
  reservation/accepted payment terms must agree. Saved pages are read again
  before another operation starts or a manifest is exported.

The next request always uses the operator's original HTTPS origin and path,
adding only the actual native cursor. A seller cannot supply a replacement URL,
HTTP method, signer, asset, recipient or operator configuration through a page.

The report's capAllocatedAtomic counts the maximum allocated to every attempted
page, including free, declined or uncertain attempts. It is a conservative
session ceiling, not a charge total. It does not release capacity because a
seller reports success or a download fails. The original SF36 ledger continues
to track actual reservations and its own independent reconciliation.

NO_PAYMENT_REQUIRED pages are accepted as free native HTTP responses.
DELIVERED_REPORTED_SETTLED pages retain the original seller-reported status
and independent SF82 outcome separately. Completion means the selected dataset
was acquired with a continuous source snapshot; it does not mean that all
transfers were independently verified or that revenue was earned.

## Finish accounting for the same acquired pages

Use the original session to finalize its existing spending reservations, including
an interrupted purchase whose response file is missing:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs finalize \
  --session /private/purchases/east-region --workspace /private/dataset-buyer

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs accounting \
  --session /private/purchases/east-region
```

The saved workspace is used automatically when initialization attached one.
For a session created from a configuration, select its matching original workspace
explicitly. The original operator keys authorize SF36 reconciliation; no wallet
key, terminal payment approval or new page request is required. The native
finalizer retains the original approved request, payment terms, evidence, ledger
and selected-network RPC. It uses this session's original evidence directory.
A lower current spending cap does not cancel a previously approved reservation.

The result contains up to 100 entries by default. `--offset` is a zero-based
position and `--limit` accepts 1–250. Continue from `range.nextOffset` until it is
null; the dataset's displayed page `index` remains one-based. Each entry shows
the native outcome and actual atomic amount/receipt when finalized. A free
original response remains `NO_PAYMENT_REQUIRED`, with no fabricated ledger
receipt. `NOT_ATTEMPTED` records have no acquisition attempt to finalize.

`accounting` reads the saved per-page views without RPC or operator keys and does
not require the delivered page body. `finalize` returns exit code 2 when an entry
needs attention. Resolve that specific source/provider error, then explicitly
finalize the same range again; the original ledger reuses an existing receipt.
After a later error, `lastFinalized` retains any earlier finalized result.
`viewStatus: SAVE_FAILED` exposes a completed native result whose display record
could not be saved; restore writable private storage and reconcile the same
attempt. Saved views remain recoverable after interruption, while the original
ledger is the financial authority.

The native `accountDatasetSession(directory, options)` export supplies this same
workflow to applications. Python's `DatasetAcquisition.finalize_all()` iterates
every retained range and yields progress; see [the customer guide](python/README.md#finish-dataset-and-object-purchase-accounting).
Optional paired `--outbox` and `--merchant-route` arguments feed the existing
finalizer's original merchant notification path.

## Stop, resume and recover

Ctrl-C reaches the original buyer's cancellation signal. Run the same command
again to continue after complete pages; those pages are never requested again.
The private configuration is immutable for a session. Change the query in a
separate reviewed operation only when you intentionally want a different
purchase.

If a process dies while preparing a page and before its attempt marker, resume
can finish preparing that same page. If it dies after the marker, the command
will not call that page a second time.

Original SF82 evidence and a fully published response file can recover a
completed page even when the process died before writing the session result.
An incomplete result/failure JSON record is reported as a metadata warning;
the durable attempt and operation configuration must still be intact.
No network call, signer or ledger mutation is involved:

    node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs recover \
      --session /private/purchases/east-region

Recovery can remove a lock only when it belongs to this host and its process
is actually gone. A live process retains the lock. If the original files show
an incomplete or uncertain attempt, inspect that exact intent in the original
SF36 ledger and original SF82 evidence. Recovery reports the cause and
retains all files. It never discards the attempt or generates a replacement
intent to retry it.

Status reads take the same local lock as execution. If a run is updating the
session, status reports RUNNING instead of inspecting partially written files.
Recovered pages retain the original native checkout record and validate the
actual saved file's dataset contract. When the orchestration result is absent,
there is no separately retained response-file hash to compare against: the
reported body hash is calculated from that recovered private file. SF82 has
body capture disabled because the original writer consumes the response stream.
This recovery path does not claim a cryptographic receipt binding the body.

The page limit or total allocation ceiling stops further calls and retains
completed pages. These limits are fixed when the session is created; they are
not silently expanded on restart.

## Build the CSV and data room

After status reports COMPLETE, delegate the complete export directly to the
original SF100 delivery tool:

    node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs deliver \
      --session /private/purchases/east-region \
      --out /private/deliveries/east-region

This calls the existing SF100 init and finalize commands and the original
appendMany function using each saved page, native intent, evidence file and
exact preceding cursor. One small child-process adapter passes the remaining
ordered inputs to appendMany in one batch; it implements no archive or exporter.
The native function scans the existing prefix once, accepts each next page and
scans the completed archive once. It avoids launching a process and rescanning
the growing archive separately for every page. CSV/JSONL finalization uses the
original exporter's streaming writer.
SF100 creates dataset.csv, typed dataset.jsonl, review.html and its source
manifest. No merchant request or payment occurs during delivery. Its existing
limits of 4,096 pages, 2 MiB per input page and 256 MiB of combined CSV/JSONL
output and 256 MiB of private page archives still apply. The original capability
limits also apply: at most eight equality, range and sort columns respectively,
within the source's 32-parameter advertised capability budget. The batch adapter
accepts up to 16 MiB of input paths, intents and cursors, without copying page
contents into its input envelope.
The bridge uses the original SF100 executable at its existing repository path
and records its actual Git blob fingerprint. Compatible updates by its owner
still have to satisfy the native archive, status, manifest and output contracts.
The delivery report retains both the initial and current exporter fingerprints.

If local delivery is interrupted after a complete native archive record,
repeat the same deliver command. A private source binding and the complete
original archive prefix must match this exact acquisition before any pages
can be reused. A different purchase cannot be appended to that output directory.

The native appendMany function creates each archive record directly. A process
killed during that write can leave an incomplete final JSON record. In that
case, the next delivery attempt reports a JSON/archive error and retains the
directory. Use a fresh output directory to rebuild from the already acquired
page files without another merchant request. No partial record is silently
discarded or treated as a completed page.

If a process dies during native finalization and leaves incomplete export
files, delivery reports DATASET_DELIVERY_PARTIAL_NATIVE_EXPORT and retains
those files. Run deliver with a fresh output directory to rebuild from the
same acquired pages without making another merchant request. A completed
delivery is reusable after its original archive, manifest and output hashes
match; the command returns the existing package without rewriting it.

### Export only the acquisition manifest

After status reports COMPLETE, export a new manifest:

    node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs export \
      --session /private/purchases/east-region \
      --out /private/purchases/east-region-manifest.json

The manifest's ordered pageFiles list contains the unmodified native response
files. Each page retains its exact source URL, stable intent, SHA-256,
native buyer classification and original checkout evidence path/digest.
The deliver command performs that original SF100 handoff automatically. The
manifest is also available for a separately controlled downstream workflow;
the acquisition command does not implement another CSV exporter.

The source writes local files and uses the original buyer when run is
invoked. It starts no service or scheduler and does not configure GitHub Actions.

## Focused implementation exercise

The single source-native exercise is:

    node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/test/dataset-session.exercise.mjs

It serves the original SF30 CSV handler over real loopback HTTP and consumes
those pages through the original SF31 buyer, response-file writer, SF82 evidence
and this session runner. It covers interrupted acquisition, byte-preserving
resume, completed-file recovery, uncertain-attempt refusal, cap exhaustion and
source cursor continuity. The HTTP resource is free, so no wallet,
Stellar signature, network settlement or live merchant payment is represented
by the exercise.

The original SF100 owner's merged PR #885 also includes the source-native
range/sort and legacy-page workflow in test/dataset-delivery.test.mjs. That run
already used the original CSV loader, SF81/SF31 response path, SF82 records and
SF100 export. This acquisition extension reuses its exact checkPage and
appendMany implementation. Its request mapping and batch process boundary were
reviewed against those current native contracts; that prior run is not a claim
that a new paid acquisition or this new boundary has been executed.
