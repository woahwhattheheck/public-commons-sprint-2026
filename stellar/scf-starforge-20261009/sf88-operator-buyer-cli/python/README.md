# Python applications for the Stellar Forge buyer

The complete [acquisition workflow](ACQUISITIONS.md) joins private request intake,
receiver-owned preparation, immutable runbooks, original execution/accounting,
verified downloads and multi-operator recovery through `AcquisitionWorkspace`
or `buyer.acquisitions(...)`. It shares the original bridge with the Node SDK.

Version 0.5.0 completes original reservation accounting and retained receipt views
for the paginated dataset and resumable object applications joined in 0.4.0.
It retains 0.3.0's original single-operation reservation accounting
and history, and 0.2.0's native-workspace execution and approved-file applications.
Upgrade the Python package and its matching original Node checkout together.

Installable Python 3.11+ package for Linux and macOS. A Python application can discover an existing catalog, select one exact advertised offer, review its native payment terms, execute through the original SF88 buyer, and consume the saved JSON, CSV or binary response. The original SF31 wire client, SF81/SF62 operator approval, SF36 reservation ledger, signer and SF82 outcome handling all remain the execution path.

This package adds durable application operations and result recovery around those existing components. It has no Python dependencies and does not embed a second Stellar/payment implementation. Supply a complete current repository checkout and its existing Node runtime/dependencies. SF46 distribution should include this directory with the original runtime closure; the Python wheel alone does not contain the Node source.

## Choose the customer's product workflow

[Uploads, typed stream records and resumable file delivery](CUSTOMER_WORKFLOWS.md)
joins the original native 16 MiB multipart authoring, SSE/NDJSON reader and paid-file
continuation in one Python customer workflow. `MultipartRequest` and `UploadFile`
retain exact request bytes; `BuyerResult.events()`, `ndjson()` and `export_stream()`
consume and reopen the original saved response through the native parser.

| Product | Python entry point | Durable source and recovery |
| --- | --- | --- |
| One HTTP response | `Buyer.from_workspace` or `Buyer.from_config` | The original request and permanent attempt; `Operation.recover`, `finalize` and local accounting/history |
| Multipart upload or finite stream | `MultipartRequest`, `BuyerResult.events` / `ndjson` | Original encoded body pins and stream capture; reusable typed exports, complete-prefix inspection and record-index continuation |
| An approved private file | `Buyer.from_paid_file` | The original order handoff, native purchase and separate merchant entitlement; `retrieve_file` and local `recover_file` |
| A paginated dataset | `DatasetAcquisition.create` | The original dataset session, selected snapshot, per-page attempts and SF100 data room; `recover`, explicit continuation, verified typed rows and original accounting |
| An acquired dataset in PostgreSQL | `PostgresWarehouse` and `DatasetMapping` | Complete transactional COPY, exact types and keys, retained source editions, stable application views, edition comparison and database reopening; [receiving guide](POSTGRESQL.md) |
| A local analytical workspace for delivered datasets | `DuckDBWorkspace` and `stellar-forge-duckdb` | Retained source editions, reviewed mappings, versioned views, saved SQL, Parquet/CSV exports and portable receiving; [DuckDB guide](DUCKDB.md) |
| A large object | `ObjectBuyer.prepare` | The original object descriptor, chunk queue and assembly receipts; reopen, recover, continue, consume verified streamed files and finalize original reservations |

Each entry point keeps the original source of its state. Dataset and object
sessions can reopen directories created by the corresponding native tools;
they do not create ordinary Python `Operation` records or a second purchase
journal. Use the session's native report for those products. `Buyer.history`
describes the ordinary and approved-file operations retained in that buyer's
application directory.

All acquisition limits are explicit atomic-unit ceilings for the selected
asset. Preparation and inspection do not buy a product. The operator explicitly
calls `execute`, dataset `run`, or object `run`/`download` from its controlling
terminal; original approval and spending rules apply to each paid request.
Retain the same session after interruption and recover its existing work before
explicitly continuing. Completed files and local history are available to an
application without another purchase.

The fixed `application`, `dataset` and `object` Runtime targets all use the same
bounded process execution, cancellation and structured output handling. A
missing matching Node bridge fails before starting a process. Upgrading only a
wheel while retaining an older Node checkout cannot enable the new native
workflow.

## Acquire a dataset for a Python data application

The existing native publisher/customer setup supplies the selected query,
snapshot and payment terms. Initialize one original acquisition session from
that reviewed configuration or its operator workspace:

```python
from stellar_forge_buyer import DatasetAcquisition, DatasetError

acquisition = DatasetAcquisition.create(
    checkout="/work/public-commons-sprint-2026",
    session="/private/customer/weekly-inventory",
    workspace="/private/operator/inventory",
    max_pages=20,
    max_total_atomic="20000",
    max_rows=100_000,
)
print(acquisition.inspect())
report = acquisition.run()  # original approval for each remaining paid page
if report["status"] == "COMPLETE":
    delivery = acquisition.deliver("/private/customer/inventory-data-room")
    print(delivery.payment_status)
    for row in delivery.jsonl_rows():
        print(row)  # replace with the application's own typed-row consumer
```

`DatasetError` retains native progress when available. Reopen the same session,
call `recover`, inspect its status and explicitly continue remaining pages. The
complete native guide covers partial statuses, immutable page/total limits,
snapshot retention, original report export, JSONL/CSV consumption and delivery
recovery: [DATASETS.md](DATASETS.md). The installed source includes the executable
`examples/acquire_dataset.py` customer workflow.

## Download a large object for a Python file application

Select an actual row from the merchant's original `objects.json` description,
using the reviewed buyer configuration or matching operator workspace. Native
preparation retains the expected snapshot, exact bytes, chunk plan and total
budget in the same original object session:

```python
from stellar_forge_buyer import ObjectBuyer, ObjectDownloadError

objects = ObjectBuyer(checkout="/work/public-commons-sprint-2026")
session = objects.prepare(
    "/private/customer/model-download",
    description_file="/private/customer/objects.json",
    object_id="model",
    workspace="/private/operator/model",
    max_total_atomic="20000",
)
print(session.inspect().native)
delivery = session.download("/private/customer/model.bin")
with delivery.open() as source:
    for block in iter(lambda: source.read(1_048_576), b""):
        print(len(block))  # replace with the application's streamed consumer
```

`ObjectDownloadError.progress` carries the native report. Reopen with
`objects.open` and inspect or recover the same chunk queue before explicitly
continuing. `session.delivery` reopens an existing assembly receipt, and the
file reader verifies its current bytes before yielding the same descriptor.
Payment classification remains in each original chunk outcome; a local assembly
does not replace those financial records. [OBJECTS.md](OBJECTS.md) and
`examples/download_object.py` cover exact descriptor selection, interrupted
recovery, report export and application file consumption.

## Finish dataset and object purchase accounting

The same customer session can now complete its original spending reservations
and reopen their receipts. `DatasetAcquisition` and `ObjectSession` provide the
same accounting methods, preserving their original native page or chunk state:

```python
from stellar_forge_buyer import DatasetAcquisition

acquisition = DatasetAcquisition(
    checkout="/work/public-commons-sprint-2026",
    session="/private/customer/weekly-inventory",
)
for view in acquisition.finalize_all():
    # One bounded progress range; the iterator visits every existing page.
    print(view.native["range"], view.recorded_actual_atomic_units)
    for entry in view.entries:
        print(entry["index"], entry["outcome"], entry.get("receipt"))
    for entry in view.attention:
        print("Resolve this original attempt:", entry)

# A fresh process reads retained views without wallet, operator keys or RPC.
saved = acquisition.accounting(offset=0, limit=100)
print(saved.entries)
```

For an object, call the same methods on
`objects.open(existing_session, inspect=False)` to skip reading product bytes.
The existing `examples/acquire_dataset.py` and `examples/download_object.py`
commands now include `accounting` and `finalize`; their explicit `finalize`
action visits every retained range and prints original progress as JSON lines.
The saved workspace is selected automatically. Pass `workspace` to `finalize`
or `finalize_all` for a session originally created from a configuration; it must
match the same original operator, ledger, signer and payment terms. The shared
native finalizer loads the original accounting keys and observes the selected
Stellar network, with no signer import, terminal approval or new purchase.
Optional paired `outbox` and `merchant_route` arguments retain the existing
merchant-notification workflow.

`finalize_all(page_size=25)` visits all existing page/chunk positions and yields
each `SessionAccountingResult`, including unsuccessful entries so other original
reservations can finish. `finalize(offset=0, limit=100)` reconciles one selected
range; `accounting` reads the equivalent saved views. Limits are 1–250 and range
offsets are zero-based; dataset entry indices retain their native one-based
page numbers, while object indices remain zero-based. `next_offset` identifies
the next range. `window_complete` and `recorded_actual_atomic_units` describe only
that returned range. The amount sums actual current native finalizations in the
selected asset; configured caps are not charges.

Inspect `attention` for original source/provider errors, interruption or a display
save failure. `raise_for_status()` raises when that returned range needs attention.
Resolve the cause and explicitly finalize the same original range; SF36 reuses an
existing receipt. `lastFinalized` within an entry retains an earlier successful
result after a later source failure. When a native worker finishes before the
calling Python process stops, reopening `accounting` reads the view saved beside
the original attempt. Keep the same session after a timeout; do not initialize a
replacement purchase. The Runtime timeout remains configurable for the selected
operator/RPC workload.

Accounting does not depend on the response files remaining present. Missing
product bytes therefore do not cancel a previously approved debt, and a financial
receipt does not establish product delivery. Free original responses report
`NO_PAYMENT_REQUIRED` without a fabricated ledger receipt. Unattempted positions
remain `NOT_ATTEMPTED`. The original SF36 ledger remains the financial authority;
these session files are recoverable views of its original results.

## Install and buy from an existing configuration

```sh
python -m pip install ./stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python
```

For a published companion wheel, activate the matching maintained Node release
and install the wheel into the application's existing Python environment:

```sh
python -m pip install --upgrade /path/to/stellar_forge_buyer-0.5.0-py3-none-any.whl
export STELLAR_FORGE_CHECKOUT=/path/to/matching-release
```

`STELLAR_FORGE_CHECKOUT` supplies the installed command's default checkout. Python
APIs take the explicit `checkout` argument shown below. Existing 0.3.0 operation
directories and original dataset/object sessions remain the same durable state;
upgrading the package does not move them or create a new economic attempt.

```python
from stellar_forge_buyer import Buyer

buyer = Buyer(
    checkout="/work/public-commons-sprint-2026",
    state_dir="/private/data-buyer",  # created with mode 0700
)
operation = buyer.from_config("/private/merchant-order.json")
review = operation.review()
print(review.native)                 # same original offline SF88 review
result = operation.execute(review=review)
print(result.status)                 # original native payment classification
print(result.delivery)               # independent saved-file outcome
result.raise_for_status()
dataset = result.json()
```

The operator-provided configuration is the original SF88 JSON format. It contains a stable `operation.intentId`, exact HTTPS request and atomic-unit limits, trusted operator policy/ledger/Python paths, and the existing signer module path. Preserve original SF36 keys and signer configuration in the process environment. The package inherits that environment by default; `environment=` replaces it explicitly when the host supplies one. It never serializes environment values or accepts credentials from catalog rows.

`from_config` snapshots the configuration and any request body into a new private operation directory. Evidence is directed to that operation's private `evidence/` directory; `captureBody` is false because the original response writer owns body consumption. An existing explicit `responseFile` destination/limits is preserved. Otherwise the native result is saved as `response.bin` with a 64 MiB cap and a 30 second body timeout. The configured parent must exist and the destination must be new, as required by the original SF31 writer.

Execution uses the original terminal approval. Run a purchase from an operator terminal with the existing trusted runtime. The wrapper does not answer prompts, load wallet secrets itself, or turn a saved offer into permission to pay. Python notebooks/services can prepare/review configurations and consume results produced by an operator-run process. Native signer setup and environment support land in the original SF88 files and are inherited without a separate Python signer.

## Use the existing native operator workspace

An operator who already completed the original SF88 `--init-workspace` setup can
use that private workspace directly. This is the same selected-network workspace, policy,
ledger, payer, environment or trusted wallet provider, and generated native
signer used by the original command line and durable inbox.

```python
operation = buyer.from_workspace(
    "/private/operator/workspace",
    intent_id="weekly-data-2026-10-11",  # one explicitly selected economic attempt
)
review = operation.review()
result = operation.execute(review=review)
```

Omit `intent_id` to retain the workspace operation's existing intent. Reopen an
existing operation with `buyer.operation(intent)`; initialization never reuses
or resets an attempted operation. Keep one execution owner for an economic
request. Do not enqueue or execute the same request separately in another
application directory or native inbox.

Initialization calls original `openWorkspace` in its read-only mode. Python
stores the original workspace path and a private configuration snapshot. It
preserves the native evidence directory instead of substituting its own, and
keeps original signer, operator, ledger, payment terms and optional transport
configuration. The saved response can still use its separate application path.

Before recording a permanent Python attempt, the original exported
`workspaceEnvironment` helper checks the same operator, evidence, signer, payer,
payment rail and current caps as the native inbox, including native signer
prerequisites. Missing local runtime or wallet setup therefore leaves the
operation unattempted. Correct the existing workspace/environment and review the
same operation again. The native execution repeats that check immediately before
calling the existing `execute.mjs` path.

Original Node components load the three journal keys and pass them to the
existing approval bridge. They never return the key values to Python. The
environment or wallet provider still handles the actual native signer. Offline
Python review and result consumption do not read the workspace key file.

For a workspace or existing configuration using a merchant operation ticket,
native review supplies the ticket fingerprint without its bearer value. Python
passes that reviewed fingerprint to the original ticket validator before its
permanent attempt and to original execution. Replacing or expiring the private
ticket cannot silently change the reviewed operation. Configuration import
retains a validated private ticket copy inside the operation directory, so the
received source file can be archived. The original loader and request assembly
continue to own its bytes and header. The paid-file GET flow uses its separate
order reference and does not require a merchant POST ticket.

## Purchase and use a merchant's approved private file

The merchant uses original `sf101-merchant-receiver/checkout.mjs` to enroll the
actual file and supplies its nonsecret purchase handoff. The merchant separately
provisions its claim token through the existing private channel. The complete
merchant process, services and recovery commands are in that directory's
`CHECKOUT.md`.

```python
operation = buyer.from_paid_file(
    "/private/customer/approved-order-482.json",
    workspace="/private/operator/workspace",
    intent_id="approved-file-482",
)
review = operation.review()
print(review.native)        # original URL, header, terms and spending cap
print(review.file_promise)  # exact order, delivery URL, file size and SHA-256
result = operation.execute(review=review)
print(result.status)        # original financial outcome
```

This delegates preparation to the shipped original `purchase.mjs` function. The
merchant/path and payment terms must fit the selected workspace. The original
order-bearing URL and derived `X-SF98-Order-ID` remain bound by native approval.
The private handoff snapshot and workspace path are also included in the Python
review binding. Changed handoff bytes or a mismatched order are refused; the
operation keeps the original handoff that the application reviewed.

The immediate paid response is the merchant's small order descriptor. After the
merchant's original signed notification unlocks the file, explicitly download
the separate product. Put the separately provided token in the private
`SF101_CLAIM_TOKEN` environment value before this action:

```python
delivery = operation.retrieve_file(destination="/private/customer/report-482.csv")
for row in delivery.csv_rows():
    import_row(row)

# Other product formats use the same verified file methods:
# document = delivery.json()
# with delivery.open() as stream:
#     consume(stream)
```

`retrieve_file` calls the original SF101 retrieval function, which reads the named
token in Node and verifies promised bytes before the original streamed file writer
publishes the final path. On Linux, an interrupted transfer retains its private
prefix and the next explicit call requests the remaining bytes from the same
entitlement. A matching completed local file requires zero HTTP requests. The Python
file readers reuse the same verified-descriptor implementation as ordinary
buyer responses. `FileDelivery` describes completed product bytes separately
from the original `BuyerResult` financial outcome; a local file is not payment
confirmation.

The default product destination is `product.bin` in the private operation
directory. `claim_env="NAME"` selects a different existing private variable. The
canonical destination is durably selected before Node starts, so a fresh Python
process keeps the same output even if its predecessor was killed. Use
`delivery.save_as(...)` for a second local copy. `timeout_ms` accepts 1–300000
milliseconds and defaults to 30000; it includes connection and body transfer.
`resume=None` follows the original Linux default. `resume=False` explicitly uses
the original full-download route. The enclosing `Buyer(timeout=...)` is the
separate Python subprocess deadline, in seconds.

```python
from stellar_forge_buyer import DeliveryError

try:
    delivery = operation.retrieve_file(
        destination="/private/customer/report-482.csv", timeout_ms=120000,
    )
except DeliveryError as error:
    print(error.code, error.retained_bytes, error.resumable)
    print(error.partial_path, error.transfer_state_path)
    transfer = operation.inspect_file_transfer()
    print(transfer.status, transfer.retained_bytes, transfer.expected_bytes)
else:
    print(delivery.http_requests, delivery.resumed_bytes, delivery.transfer)
```

`inspect_file_transfer()` opens the original local transfer record, validates its
handoff and saved prefix, and recovers a stopped process's original writer
reservation. It requires Linux with `flock`. Its `FileTransfer` result exposes
`status`, `destination`, `retained_bytes`, `expected_bytes`, `resumable`, and
`partial_path`. These operations use local files and the retained operation.

| Original transfer state | Operator action |
| --- | --- |
| `NEW` | Retrieve the original entitlement when ready. |
| `INTERRUPTED` | Repair the reported source, access or connection condition, then call `retrieve_file()` again. |
| `REJECTED` | Correct the original file condition, then explicitly call `reset_file_transfer()` and retrieve again. |
| `COMPLETE` | Consume `recover_file()` or retrieve locally to repair its receipt. |
| A live operation owns the transfer | Let that operation finish or interrupt it before inspecting the checkpoint. |

`reset_file_transfer()` calls the original reset operation and returns a
`FileTransfer` with `removed_partial_bytes`. It removes only the retained
original partial and preserves the selected destination; an existing final file
is refused. The same payment, order handoff and access policy continue to apply.
For the protocol and retained-state details, see
[`RESUMABLE_TRANSFERS.md`](../../sf101-merchant-receiver/RESUMABLE_TRANSFERS.md).

The original failure and transfer metadata are also retained in
`operation.inspect()["fileDelivery"]`. Python interruption and subprocess
timeout signal Node to checkpoint its original transfer before it exits.

```python
reopened = Buyer(checkout="/work/public-commons-sprint-2026",
                 state_dir="/private/data-buyer").operation("approved-file-482")
delivery = reopened.recover_file()    # Python local reads; no process or HTTP
if delivery is not None:
    for row in delivery.csv_rows():
        import_row(row)
```

Each retrieval retains its original child output in the private operation's
`file-runs` directory. If Node completed before Python could save its view,
`recover_file()` reads that exact run and returns its completed result locally.
A recovered stdout record preserves an unknown child exit status in
`runtimeError`; its product can still be consumed through the verified file
methods. If a complete child result is unavailable, call `retrieve_file()` with
the same destination to reconstruct the original matching local receipt with
zero HTTP requests. The same operation's existing `recover()` retains its
separate original buyer outcome.

The installed CLI exposes the same lifecycle:

```bash
stellar-forge-buyer --state /private/data-buyer retrieve-file approved-file-482 --timeout-ms 120000
stellar-forge-buyer --state /private/data-buyer inspect-file-transfer approved-file-482
stellar-forge-buyer --state /private/data-buyer reset-file-transfer approved-file-482
stellar-forge-buyer --state /private/data-buyer recover-file approved-file-482
```

`--resume` and `--no-resume` select the retrieval mode explicitly. Failed
retrieval JSON includes `retainedBytes`, `resumable`, and the original private
partial/state paths when available.

`examples/buy_file.py` provides explicit prepare, review, purchase, download and
local CSV-consumption actions, followed by original accounting and history.

## Finish the original purchase's accounting

A completed payment attempt can leave its original spending reservation awaiting
the existing native transfer observer. The Python application now finishes that
same operation from its retained workspace, attempt and evidence:

```python
operation = buyer.operation("approved-file-482")
accounting = operation.finalize()
print(accounting.status)               # original SF36 outcome
print(accounting.actual_atomic_units)  # original integer token units
print(accounting.receipt)              # original network/transaction reference
print(accounting.merchant)             # separate native merchant-event state
```

This calls the **same original validated finalizer as the private inbox**. It
checks the saved configuration and request body against the permanent Python
attempt, then matches the complete approved request, workspace, evidence and
authenticated SF36 reservation. Original Node components open the workspace in
accounting mode; wallet prerequisites and signing are not invoked. The three
accounting keys enter only the original worker environment, never Python API
results, history files or the separate observer.

Original SF86 chooses the explicitly configured supported RPC and the
workspace's original transport. Its official decoder and exact transfer checks
remain in use. The observer's result finalizes the existing SF36 ledger; a saved
Python view does not replace it. The [original finalization guide](../FINALIZATION.md)
describes supported networks, RPC custody and outcomes. This application does not
choose a new provider or reinterpret a local file as payment.

`finalize` requires an existing attempted operation imported from a native
workspace. It can run after the wallet environment is removed and after the
workspace's new-spending cap has been reduced. It never clears the permanent
purchase attempt, opens a wallet, signs, pays or retries the merchant request.
Configurations imported through the earlier `from_config` interface retain the
original [SF36 worker](../../sf36-spend-governor/FINALIZATION.md) route; they do not
gain an inferred workspace association.

| Accounting status | Application action |
| --- | --- |
| `FINALIZED` | Use the original actual units and canonical receipt in the purchase history. |
| `IDEMPOTENT_FINALIZED` | The original ledger already finalized this same request and reused its receipt. |
| `NOT_FINALIZED` | Inspect the native reason and original evidence; run the same accounting action after fixing the cause. |
| `WORKER_ERROR` or `NATIVE_ACCOUNTING_RESULT_UNAVAILABLE` | Inspect the retained run and original ledger, then rerun this accounting action to recover its result. |

Each explicit accounting run keeps bounded original stdout/stderr under a private
`accounting-runs` directory, separate from the purchase output. The latest
`accounting.json` is a replaceable display record. A failed later observation
retains `last_finalized` explicitly; it never downgrades the original ledger.
If saving the view fails after accounting succeeds, the returned record reports
`viewStatus: SAVE_FAILED` and retains the actual original result. Repeating the
same command reconstructs the view through the original idempotent ledger path.

If the buyer host also holds the merchant's actual original SF98 outbox, pass
`outbox="/private/merchant/outbox"` and `merchant_route="original-route-id"`
together. Remote merchant events remain on the merchant's host. Financial
finalization and completed product bytes retain their own outcomes.

```python
# These are local reads: no Node subprocess, keys, wallet, RPC or merchant call.
accounting = operation.recover_finalization()
history = buyer.history(destination="/private/customer/purchase-history.json")
```

Recovery also reads complete native output left by an interrupted Python parent,
retaining `PROCESS_EXIT_NOT_RECORDED`. It never turns a missing or partial result
into a finalized purchase. History joins the exact request and native purchase
outcome, original accounting view, and separate delivered product. The exported
JSON is private and create-only; choose a new destination for a later export.

## Discover and select without copying payment terms by hand

```python
buyer.discover(
    {"origin": "https://catalog.example", "limit": 20,
     "filters": {"network": "stellar:testnet"}},
    destination="/private/catalog.json",
)
operation = buyer.prepare(
    "/private/catalog.json", row=0, accept=0,
    intent_id="weekly-data-2026-10-11",
    url="https://seller.example/data?region=west", method="GET",
)
operation.configure("/private/operator-profile.json", max_response_bytes=16_777_216)
review = operation.review()
```

The catalog and seller URLs above are configuration examples, not a deployed merchant. Discovery delegates catalog options directly to original SF88, including its supported explicit transport options. Preparation preserves the actual source bytes, source digest, selected listing and alternative index. SF88 still enforces exact host/path/method and Stellar terms; the Python layer never invents an amount or chooses a cheaper alternative automatically.

An operator profile contains only the following original execution settings:

```json
{
  "operator": {
    "python": "/private/runtime/bin/python3",
    "actor": "operator-1",
    "service": "data-purchases",
    "policy": "/private/operator/policy.json",
    "ledger": "/private/operator/reservations.sqlite"
  },
  "signerModule": "/private/operator/native-signer.mjs"
}
```

Optional `trustedPayer` and `bodyCaptureTimeoutMs` are passed through. For POST/PUT/PATCH data APIs, supply exact `body=b'{"region":"west"}'` bytes and ordinary `headers={"Content-Type":"application/json", "accept-language":"en-US", "x-region":"west"}` to `prepare` or `configure`. Preparation saves a private headers file and sends it through the matching original SF88 `--headers-file` command. Native review canonicalizes names, retains exact values and rejects duplicate, reserved or whitespace-changing fields. Request bytes and headers stay in the private reviewed configuration. Calling `configure` after a review invalidates that review whenever the configuration or body changes.

For an issued merchant POST, `from_config` accepts the merchant workspace's
prepared review with its original `ticketFile`, exact body and headers. The
original ticket reader and request assembly remain responsible for the bearer;
ordinary request headers never carry it in the Python review. Original SF98
order references and authentication/payment header handling are retained.

To import the merchant's complete private request on another host:

```python
operation = buyer.from_operation_handoff(
    "/private/merchant-operation.handoff.json", accept=0
)
operation.configure("/private/operator-profile.json")
review = operation.review()
result = operation.execute(review=review)
```

Choose the actual offered payment option and use the matching native SF88
runtime. The original importer supplies the reviewed local request; Python keeps
its own body and validated ticket copies after temporary import files are removed.
The original stable intent remains unchanged. The packet contains no operator
or signer settings; configure yours separately. Keep the received packet `0600`
at a canonical absolute path, and reopen an existing operation with
`buyer.operation(intent)` instead of importing it again.

## Restart and consume a completed purchase

```python
operation = buyer.operation("weekly-data-2026-10-11")
result = operation.recover()          # local reads only; does not call a seller
if result is not None:
    data = result.json()
else:
    print(operation.inspect())        # retained attempt / original evidence path
```

Every intent maps to one private directory. A create-only attempt record is fsynced before the subprocess starts, and a per-operation lock prevents two application processes from launching it together. An existing intent must be reopened with `operation`; `from_config` and `prepare` never silently reuse it. Once an attempt has been recorded, `execute` refuses another launch. Use original SF36 ledger and SF82 evidence when an attempt has an uncertain outcome; giving the same economic request a new intent is not recovery.

The runner captures bounded native stdout/stderr in private files, keeps original cancellation handling, and persists the native result plus process exit code. A timeout or keyboard interruption requests native cleanup before a last-resort process termination. If the parent died after a complete native summary reached disk, `recover()` can consume its saved response while retaining `PROCESS_EXIT_NOT_RECORDED` and an unknown exit code. It does not mark a payment confirmed from a local file or guess that an absent summary means nothing was sent. `recover`, `inspect`, `list_operations`, and all response readers never launch a subprocess or send a request.

## JSON, CSV and binary data

The original file's recorded path, byte count and SHA-256 are checked before its file descriptor is exposed. `json()` and `read_bytes()` default to an 8 MiB in-memory limit; `open()` and `csv_rows()` stream verified data without reading the entire payload into memory. The file remains under the operator's control: do not modify a saved payload while another process consumes it.

```python
for row in result.csv_rows():
    process_row(row)

with result.open() as data:
    frame = pandas.read_csv(data)       # optional application dependency

result.save_as("/private/delivery/new-dataset.csv")  # fails if already present
```

This also works for SF30's paid object delivery: an original 200 object or 206 bounded chunk is saved as bytes; native SF31/SF88 remain responsible for the HTTPS request, payment and response stream. S3 chunk offsets/lengths belong in the exact reviewed URL. Each paid page/chunk remains its own native operation; the SF88 dataset-session owner supplies multi-page acquisition and cumulative budgets. This package does not duplicate that scheduler.

`result.ok` reports a clean recorded process and successful HTTP response. Inspect `result.status`, `result.native["originalOutcomeReport"]`, and the original ledger for the separate payment/settlement classification. A saved payload can remain useful even if subsequent evidence collection or cleanup failed; `result.open()` preserves that recovery path.

## Command line

```sh
export STELLAR_FORGE_CHECKOUT=/work/public-commons-sprint-2026
stellar-forge-buyer --state /private/data-buyer import /private/merchant-order.json
stellar-forge-buyer --state /private/data-buyer review weekly-data-2026-10-11
stellar-forge-buyer --state /private/data-buyer execute weekly-data-2026-10-11
stellar-forge-buyer --state /private/data-buyer recover weekly-data-2026-10-11
stellar-forge-buyer --state /private/data-buyer list
stellar-forge-buyer --state /private/data-buyer import-workspace /private/operator/workspace --intent next-report
stellar-forge-buyer --state /private/data-buyer paid-file /private/customer/order.json --workspace /private/operator/workspace --intent approved-file-482
stellar-forge-buyer --state /private/data-buyer review approved-file-482
stellar-forge-buyer --state /private/data-buyer execute approved-file-482
stellar-forge-buyer --state /private/data-buyer retrieve-file approved-file-482 --out /private/customer/report-482.csv
stellar-forge-buyer --state /private/data-buyer recover-file approved-file-482
stellar-forge-buyer --state /private/data-buyer finalize approved-file-482
stellar-forge-buyer --state /private/data-buyer recover-finalization approved-file-482
stellar-forge-buyer --state /private/data-buyer history --out /private/customer/purchase-history.json
```

`prepare`, `configure` and `inspect` are also available via `--help`. The `execute` command prints the original review and enters original terminal approval; it is the sole payment-execution command. `retrieve-file` performs only the separately requested entitlement download. `finalize` reconciles the existing reservation through the original workspace and worker. `recover-finalization` and `history` read retained local results. `examples/buy_dataset.py` demonstrates the ordinary response application and separate restart recovery.

## Operational contract

- Dependencies: Python 3.11+, POSIX file locking, Node version required by the original checkout, and existing native seller/buyer dependencies. No hosted workflow is started by installation or execution.
- Stable application errors are `BuyerError.code`; exceptions expose neither raw signer output nor environment values. `NativeError.operation` identifies retained recovery state.
- Original runtime source is required at `stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs`. API calls use an argument array with `shell=False`; no shell interpolation is involved.
- Workspace and approved-file applications additionally require the original `python/bridge.mjs`, its shared queue/workspace source, and original `sf101-merchant-receiver/` checkout/retrieval source. Accounting consumes the same original `finalization.mjs`, SF36 worker and SF86 observer as the inbox. The current complete source distribution supplies these; the Python wheel still does not bundle Node or a signer.
- Local state includes source/configuration, request body, original evidence and downloaded data. Store it outside public repositories and supply the existing operator's policy/signer configuration.
- Original settlement and merchant limits are preserved. This integration performs no grant submission, production-wallet provisioning, outbound customer contact or new remote hosting.

## Whole customer workspace recovery

`buyer.workspace_recovery()` captures the existing Python application state with
its explicitly selected original operator, inboxes and other application roots.
The standalone `WorkspaceRecovery(checkout=...)` constructor creates no state;
use it before constructing a Buyer when restoring an absent canonical root.

```python
from stellar_forge_buyer import WorkspaceRecovery

recovery = WorkspaceRecovery(checkout="/srv/forge")
verified = recovery.verify(
    bundle="/private/backups/customer-2026-10-11",
    expected_record_sha256=selected_digest_from_your_backup_inventory,
    python="/usr/bin/python3",
)
# Only after the original canonical root is absent or empty and writers stopped:
restored = recovery.restore(
    bundle="/private/backups/customer-2026-10-11",
    expected_record_sha256=verified.record_sha256,
    python="/usr/bin/python3",
)
```

The passphrase is supplied through the selected environment variable name
`passphrase_env` (default `SF88_BACKUP_PASSPHRASE`), never as a value argument.
The original SF88/SF101 encryption and SF36 authenticated checkpoint remain the
implementations. `inspect`, `snapshot(quiesced=True)`, `verify` and `restore`
return typed recovery/process results; `WorkspaceRecoveryError.result` retains
completion metadata and interruption outcomes without raw stderr. No restore
exception deletes state or retries a purchase. See [RECOVERY.md](RECOVERY.md) for
the full capture, selected-checkpoint and same-application reopen workflow.

## LangChain and LangGraph customer applications

The optional `agents` extra provides native typed LangChain tools and a persistent
LangGraph customer workflow over the original Buyer intents, reviews, attempt
recovery and response readers. It retains JSON/CSV/SSE/NDJSON or paid-file data,
resumes the same application checkpoints, and exports a portable customer package.
See [AGENT_CUSTOMERS.md](AGENT_CUSTOMERS.md) for setup, the installed
`stellar-forge-agent` command and the complete original customer example.

