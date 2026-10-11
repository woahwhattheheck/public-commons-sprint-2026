# Python applications for the Stellar Forge buyer

Version 0.2.0 adds original native-workspace execution and approved-file customer
applications. Existing 0.1.0 installations can upgrade to this version normally.

Installable Python 3.11+ package for Linux and macOS. A Python application can discover an existing catalog, select one exact advertised offer, review its native payment terms, execute through the original SF88 buyer, and consume the saved JSON, CSV or binary response. The original SF31 wire client, SF81/SF62 operator approval, SF36 reservation ledger, signer and SF82 outcome handling all remain the execution path.

This package adds durable application operations and result recovery around those existing components. It has no Python dependencies and does not embed a second Stellar/payment implementation. Supply a complete current repository checkout and its existing Node runtime/dependencies. SF46 distribution should include this directory with the original runtime closure; the Python wheel alone does not contain the Node source.

## Install and buy from an existing configuration

```sh
python -m pip install ./stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python
```

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
use that private workspace directly. This is the same testnet workspace, policy,
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
ticket cannot silently change the reviewed operation. Keep the referenced
private ticket file for the operation; the original loader and request assembly
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
token in Node, sends one exact merchant HTTPS GET, and verifies promised bytes
before the original streamed file writer publishes the final path. The Python
file readers reuse the same verified-descriptor implementation as ordinary
buyer responses. `FileDelivery` describes completed product bytes separately
from the original `BuyerResult` financial outcome; a local file is not payment
confirmation.

The default product destination is `product.bin` in the private operation
directory. `claim_env="NAME"` selects a different existing private variable. Once
a destination is selected, later calls retain it; use `delivery.save_as(...)`
for a second local copy. An error retains the original failure and any private
partial-file path in `operation.inspect()["fileDelivery"]`. Notification pending,
wrong token, changed bytes or interrupted download never trigger a payment.
Repair the cause, then explicitly call `retrieve_file` for the same operation.

```python
reopened = Buyer(checkout="/work/public-commons-sprint-2026",
                 state_dir="/private/data-buyer").operation("approved-file-482")
delivery = reopened.recover_file()    # Python local reads; no process or HTTP
if delivery is not None:
    for row in delivery.csv_rows():
        import_row(row)
```

If the native download completed before Python could save its result, call
`retrieve_file` with the same destination. Original matching local bytes recover
the receipt without an HTTP request or claim token. This also works after
application restart. `recover_file` only consumes a retained completed result;
it does not guess that a partial file is complete. The same operation's existing
`recover()` retains the separate original buyer outcome.

`examples/buy_file.py` provides explicit prepare, review, purchase, download and
local CSV-consumption actions against this complete application workflow.

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

Optional `trustedPayer` and `bodyCaptureTimeoutMs` are passed through. For POST/PUT/PATCH data APIs, supply exact `body=b'{"region":"west"}'` bytes and `headers={"Content-Type":"application/json"}` to `prepare` or `configure`. Request bytes are copied privately and bound into the offline review; body size and permitted methods/headers are validated by original SF88. Calling `configure` after a review invalidates that review whenever the configuration or body changes.

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
```

`prepare`, `configure` and `inspect` are also available via `--help`. The `execute` command prints the original review and enters original terminal approval; it is the sole payment-execution command. `retrieve-file` performs only the separately requested entitlement download. `examples/buy_dataset.py` demonstrates the ordinary response application and separate restart recovery.

## Operational contract

- Dependencies: Python 3.11+, POSIX file locking, Node version required by the original checkout, and existing native seller/buyer dependencies. No hosted workflow is started by installation or execution.
- Stable application errors are `BuyerError.code`; exceptions expose neither raw signer output nor environment values. `NativeError.operation` identifies retained recovery state.
- Original runtime source is required at `stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs`. API calls use an argument array with `shell=False`; no shell interpolation is involved.
- Workspace and approved-file applications additionally require the original `python/bridge.mjs`, its shared queue/workspace source, and original `sf101-merchant-receiver/` checkout/retrieval source. The current complete source distribution supplies these; the Python wheel still does not bundle Node or a signer.
- Local state includes source/configuration, request body, original evidence and downloaded data. Store it outside public repositories and supply the existing operator's policy/signer configuration.
- Original settlement and merchant limits are preserved. This integration performs no grant submission, production-wallet provisioning, outbound customer contact or new remote hosting.
