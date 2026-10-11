# Python applications for the Stellar Forge buyer

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
```

`prepare`, `configure` and `inspect` are also available via `--help`. The `execute` command prints the original review and enters original terminal approval; it is the sole effectful buyer command. `examples/buy_dataset.py` demonstrates a complete application flow and separate restart recovery.

## Operational contract

- Dependencies: Python 3.11+, POSIX file locking, Node version required by the original checkout, and existing native seller/buyer dependencies. No hosted workflow is started by installation or execution.
- Stable application errors are `BuyerError.code`; exceptions expose neither raw signer output nor environment values. `NativeError.operation` identifies retained recovery state.
- Original runtime source is required at `stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs`. API calls use an argument array with `shell=False`; no shell interpolation is involved.
- Local state includes source/configuration, request body, original evidence and downloaded data. Store it outside public repositories and supply the existing operator's policy/signer configuration.
- Original settlement and merchant limits are preserved. This integration performs no grant submission, production-wallet provisioning, outbound customer contact or new remote hosting.
