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
original dataset endpoint, with the desired fields, equality filters and page
limit in the URL. The first URL must not contain a cursor.

For example, the URL below describes a selection; replace the hostname and query
with the actual merchant dataset before running:

    https://merchant.example/data?fields=id,region,value&where_region=east&limit=100

This acquisition path supports native field projection, equality filters and
page limits. The current SF30 seller also offers range filters and sorting;
those use a different query digest that the reviewed SF100 exporter does not
yet consume. Initialization rejects sort, range and other unsupported query
keys before creating an attempt or reaching payment approval. Native datasets
that advertise those capabilities remain usable with equality queries here.

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

Optional max-rows defaults to 1,000,000. The max-page-bytes flag defaults to 1 MiB
and is applied by the original streaming response writer. If the actual dataset
snapshot is already known, the snapshot flag pins its exact 64-character SHA-256.
Otherwise the first completed native page pins the snapshot for the rest of
the session.

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
  typed filter values remain identical across pages.
- The request's fields, filters and limit must match the response.
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

This calls the existing SF100 init, append and finalize commands using the
original saved page, native intent, evidence file and exact preceding cursor.
SF100 creates dataset.csv, typed dataset.jsonl, review.html and its source
manifest. No merchant request or payment occurs during delivery. Its existing
limits of 4,096 pages, 2 MiB per input page and 256 MiB of combined CSV/JSONL
output still apply. The native exporter accepts at most eight filter fields.
The bridge uses the original SF100 executable at its existing repository path
and records its actual Git blob fingerprint. Compatible updates by its owner
still have to satisfy the native archive, status, manifest and output contracts.
The delivery report retains both the initial and current exporter fingerprints.

If local delivery is interrupted, repeat the same deliver command. A private
source binding and the original archive prefix must match this exact
acquisition before any pages can be reused. A different purchase cannot be
appended to that output directory.

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
