# Python customer application

This directory is a complete customer package for one saved seller contract.
The original `seller-client.mjs` builds all request URLs, bodies and selected
payment terms. `seller_client.py` makes that implementation available to Python
and hands the exact request to the existing `stellar_forge_buyer.Buyer`.
The two completion manifests retain the original source and every delivered file.

## Export and receive

Use the maintained Starforge command with the seller's original developer
OpenAPI export, not an unrelated provider specification:

```sh
starforge client python export --openapi seller-openapi.json --out ./customer
starforge client python status --dir ./customer
starforge client python copy --dir ./customer --out ./receiving-copy
```

`export` creates a new directory. `resume --dir ./customer` completes an
interrupted Python addition to an already completed original JavaScript export.
It also adds Python to an existing completed JavaScript export. Existing files
are reused only when identical; edited files are preserved and reported as a
conflict. An interrupted original JavaScript export is inspected using the
existing `starforge client status` and original recovery instructions first.
`copy` carries the exact source package, rather than regenerating against a newer
compiler. Copying to an existing destination is refused unless the explicit
`copy-resume --dir ./customer --out ./interrupted-copy` command is used. That
command completes missing files using the same retained source package and
accepts existing files only when byte-identical. It does not regenerate an old
customer package with a newer generator.

The Python adapter needs Python 3.10 or later and the existing Node executable.
No Python dependency is needed to inspect the package, build a request, or save
and reopen a request plan. To prepare, execute or recover purchases, install the
matching original `stellar_forge_buyer` companion supplied with your maintained
Starforge release (the original 0.5.0 companion requires Python 3.11 or later).
The existing Python buyer guide owns its installation and
operator setup. Keep the matching native Node source available; `Buyer(checkout=)`
selects the directory **containing** `stellar/scf-starforge-20261009/`.
For an installed npm merchant package, this is its `source/` directory.

## Prepare a source-bound request

Run from this customer directory, or import its module from your application:

```python
from pathlib import Path
from seller_client import SellerClient
from stellar_forge_buyer import Buyer

api = SellerClient()  # Uses the package beside seller_client.py.
print(api.source)
for operation in api.operations:
    print(operation['id'], operation['method'], operation['path'])

request = api.build_request(
    operation_id=selected_operation_id,  # An actual ID printed above.
    inputs=reviewed_inputs,
    intent_id='customer-report-2026-10-11',
    accept_index=0,                     # An explicit original payment choice.
    max_atomic='25000',                 # Your explicit ceiling, not auto-price.
)
request.save(Path('./private-request'))
print(request.describe())               # Complete terms and body digest.
```

Inputs follow the original JavaScript client's contract: `path`, `query`, and a
JSON `body` where the operation requires it. Query values are strings or lists of
strings. Use `omitBody: True` only for a declared optional body. A retained
multipart body is `{'multipart': {'body': exact_bytes, 'contentType': exact_type}}`;
keep the original multipart boundary. Python rejects non-finite numbers, cycles,
non-string dictionary keys and integers outside JavaScript's exact integer range
rather than silently rounding them. Atomic payment amounts stay decimal strings,
including values above 2**53. Actual seller validation remains authoritative.

The default payment flow is `authorization`. Only for a selected original offer
that explicitly advertises it, pass `payment_flow='upfront'`. Upfront settlement
can precede application generation; delivery failure may still leave a charge.
URL, method, network, asset, recipient and timeout cannot be overridden by this
adapter. Multiple advertised payment options require an explicit selection.

## Use the original buyer operation

```python
buyer = Buyer(
    checkout=Path('/installed/starforge-merchant/source'),
    state_dir=Path('/private/customer-purchases'),
)
request = api.load_request('./private-request')
operation = api.prepare(buyer, request)

# Existing trusted host paths and settings, using the ORIGINAL operator API:
operation.configure('/private/existing-operator-profile.json')
review = operation.review()
print(review.native)

# After reviewing that exact configuration, an explicit call uses the original
# approval, signer, spend governor, native buyer and retained outcome:
result = operation.execute(review=review)
```

`prepare` creates an original native operation and calls its normal offline
review. It does not execute a purchase. The returned object is the original
`Operation`; its configuration, response-stream options, execution, dataset/file
results, accounting, recovery and export APIs remain available unchanged.
This adapter does not create an alternate ledger, signer, HTTP client or retry.
A saved source price never authorizes a purchase by itself. Native SF88 requires
its supported public HTTPS resources even when an exported development client
can build an original loopback request.

## Reopen without repeating a purchase

```python
api = SellerClient('./receiving-copy')
buyer = Buyer(checkout=native_source, state_dir=original_state_directory)
operation = api.reopen(buyer, 'customer-report-2026-10-11')
result = operation.recover()  # Original recorded outcome; does not purchase again.
```

The client checks the same source, operation ID, exact request and body before
returning the original operation. Configure changes to trusted operator paths
and response settings remain usable. Changing the operation URL, body, headers
or spend terms requires preparing and reviewing the intended new request.

For a process interruption or lost reply **during preparation**, reload the
saved request and explicitly call `api.resume_preparation(buyer, request)`.
This inspects the already existing operation, verifies its full request and body
and repeats only the original offline review. It does not create or execute an
operation. It completes a missing source sidecar only for an unattempted matching
preparation. An attempted operation without that sidecar stays with the original
buyer's recovery tools rather than being assigned to a new client source.

A request-plan save interrupted partway through can be completed by saving the
same `BoundRequest` to the same directory. Completed files must match exactly.
Loading a plan verifies its files and reconstructs the request with the original
builder, so a consistently edited metadata file cannot redirect a saved request.
Keep request plans and buyer state private: they may contain customer payloads.

## Command-line request and review

```sh
python seller_client.py inspect
python seller_client.py request --operation ACTUAL_OPERATION_ID \
  --inputs reviewed-inputs.json --authorization authorization.json \
  --out ./private-request
python seller_client.py review --plan ./private-request \
  --checkout /installed/starforge-merchant/source \
  --state-dir /private/customer-purchases
```

`authorization.json` uses Python names: `intent_id`, `max_atomic`, optional
`accept_index` and `payment_flow`. CLI multipart inputs use `body_file` and
`contentType`; a relative body file is resolved beside the input JSON. Add
`--resume` to `review` only to reopen the same already prepared operation. The
CLI prints its original native review. Explicit execution remains the original
Python operation shown above, with the normal operator approval behavior.

`SellerClient` verifies the completed customer files before each native request
build. The files are editable source, not a package signature or seller identity
credential; retain and review the version obtained through your normal trusted
merchant delivery. Imports are inert. Building requests starts one finite local
Node process with no network operation; construction errors never trigger a
buyer call. `seller_client.pyi` lists the actual operation IDs for autocomplete;
response types remain the original buyer's returned types, not example guesses.

## Maintained native exercise

From the maintained source, run
`node stellar/scf-starforge-20261009/sf30-seller-sdk/developer/python-client/acceptance.mjs`.
The single joined journey uses the original importer and compiled developer
OpenAPI, all six HTTP methods, retained binary multipart data, two original
payment choices, exact atomic strings, native review, source-copy recovery and
fresh-process operation reopening. Its temporary customer files are removed
after the run.
