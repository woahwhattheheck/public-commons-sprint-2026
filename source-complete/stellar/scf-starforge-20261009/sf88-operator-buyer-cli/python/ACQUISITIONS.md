# Complete buyer acquisitions in Python

`AcquisitionWorkspace` connects Python applications to the maintained original
buyer-runbook, request intake, accounting and multi-operator recovery engines.
It supports the complete workflow through the same original Node bridge used by
the Node SDK. It adds no Python dependency and no second payment implementation.

Install `stellar-forge-buyer` with its matching complete original Node checkout.
The Python wheel alone does not contain that runtime. The complete distribution
includes this module and the original buyer-runbook bridge.

## Select the receiver's original workspace

```python
from stellar_forge_buyer import AcquisitionWorkspace, AcquisitionError

acquisitions = AcquisitionWorkspace(
    checkout="/opt/stellar-forge",
    directory="/srv/customer/state/acquisitions",
    configs_directory="/srv/customer/state/configs",
    operator_settings="/srv/customer/state/operator-settings.json",
)
```

Paths must be absolute and canonical. Use private directories. The original
workspace fixes its configuration directory at creation; reopen it with
`directory` alone. Its original
[`stellar-forge.buyer-runbook-operator.v1` preset](../../buyer-runbook/WORKSPACE.md)
selects the customer's actual payer, actor, service, Python interpreter, signer
reference and budget limits. A received packet cannot select those authorities.

Construction creates no Buyer, workspace, ledger or restore target. Each call
starts one original native command, waits for it and returns its native result.
An existing `Buyer` can reuse its runtime with
`buyer.acquisitions(directory=..., configs_directory=..., operator_settings=...)`;
its separate operation store is not copied into the acquisition.

## Receive, review and prepare the merchant request

```python
received = acquisitions.receive_request(
    "/srv/customer/incoming/order.handoff.json"
).native

reviewed = acquisitions.review_request(
    received["id"], accept_index=0,
    total_atomic="30000", daily_atomic="20000",
).native

# Present reviewed["review"] and use the exact selection the customer reviewed.
ready = acquisitions.prepare_request(
    received["id"], review_sha256=reviewed["review"]["reviewSha256"],
).native
```

The accept index selects a real advertised offer. Set budgets for that offer and
the receiver's actual limits; the amounts above are examples. The original
importer retains the exact body, discovery, ordinary headers and operation
ticket. It supports opaque multipart bytes and the original absent-body form.

Preparation initializes the receiver's original operator and publishes its
ordinary SF88 configuration in the selected local directory. It is idempotent
for the exact prepared review. The original engine rejects changed settings or
inputs. Preparation does not authorize a payment.

## Compose an immutable acquisition

```python
draft = acquisitions.save({
    "schema": "stellar-forge.buyer-runbook.v1",
    "id": "monthly-orders",
    "title": "Monthly order acquisition",
    "operations": [{
        "id": "order", "label": "Merchant order",
        "config": ready["configName"], "saveAs": "order.json",
    }],
}).native

# Present draft["plan"] before accepting this exact immutable revision.
initialized = acquisitions.initialize(
    draft["id"], expected_revision=draft["revision"],
    review_sha256=draft["reviewSha256"],
).native
acquisition_id = initialized["id"]
```

Prepare further requests and add their returned `configName` values to the same
original manifest. The existing 1–64 operation limit, unique intent rules,
canonical configuration selection and immutable revisions remain in force.
Update an existing draft with `save(manifest, acquisition_id=id,
expected_revision=revision)`. Read a retained revision with
`draft(id, revision=revision)`. Use `attach_run(path)` to register an existing
original run without moving its configurations, evidence or journals.

## Execute through the original buyer and inspect its accounting

```python
inspected = acquisitions.inspect(acquisition_id).native
completed = acquisitions.execute(
    acquisition_id, expected_plan_sha256=inspected["planSha256"],
    # only="order",
)
accounting = acquisitions.finalize(acquisition_id)
```

Execution requires the exact inspected plan digest and the original controlling
terminal approval. Python does not answer that approval. A headless application
can prepare, inspect, account and recover; an operator performs an explicit
purchase through the original terminal. Every operation retains its original
attempt identity.

`finalize` observes the original reservations and receipts through SF88 and SF36.
It can query the original provider but does not sign or submit another purchase.
Read each returned accounting outcome; command completion alone does not mean a
request settled. The original successful finality remains available after a
later observation failure. For an imported run, `bind_accounting(id, only=...,
workspace=...)` selects its matching original operator workspace explicitly.

## Consume complete saved resources

```python
preview = acquisitions.preview(acquisition_id, "order").native
download = acquisitions.download(
    acquisition_id, "order", "/srv/customer/exports/order.json",
).native
report = acquisitions.export(
    acquisition_id, format="csv",
    destination="/srv/customer/exports/accounting.csv",
).native
```

The original model requires a saved runbook resource and validates its full byte
count and SHA-256 before returning the original bounded text preview or complete
download. Destination parents must already be private directories. A download
or JSON, HTML or CSV report creates a new mode-0600 file and refuses an existing
destination. Its result retains publication metadata if later synchronization
or cleanup fails. `export_request(id, kind="body" | "handoff", destination=...)`
exports exact retained request inputs; an absent body remains absent.

## Cancellation, errors and interrupted acquisitions

Pass a `threading.Event` as `cancel_event` to any method. Setting it requests the
original owned child to stop and allows native cleanup to complete. The existing
KeyboardInterrupt path uses the same cleanup. A set event before launch does
not start the command.

```python
import threading

cancel = threading.Event()
try:
    result = acquisitions.execute(
        acquisition_id, expected_plan_sha256=inspected["planSha256"],
        cancel_event=cancel,
    )
except AcquisitionError as error:
    print(error.code, error.result.process)
    # error.result.native can retain an already completed original publication.
```

A successful `AcquisitionResult` contains `native`, `completion_reported`,
`process` and `ok`. An `AcquisitionError.result` retains the same structure.
The process view distinguishes native errors, caller cancellation and cleanup.
The bridge preserves a held terminal execution result even if its final state
refresh fails; that result includes `stateRefreshError`, the inspected plan
digest, and a null refreshed state. A process error is not evidence that no
state changed. Inspect the original state before an explicit continuation.

`recover(id)` uses the original interrupted-run recovery. `unlock(id,
owner_pid=...)` requires the exact observed stopped owner and the original lease
rules. Neither operation authorizes another purchase.

## Recover all original operators together

Use the original [complete recovery contract](../../buyer-runbook/RECOVERY.md).
The selected canonical state root must contain the workspace, every imported
run, all configuration and input paths, and all original operator generations.
Stop external writers, inspect the full selection, then capture the exact review.

```python
review = acquisitions.backup_review(
    state_root="/srv/customer/state",
).native

backup = acquisitions.backup(
    state_root="/srv/customer/state",
    output="/srv/customer/backups/acquisition-2026-10-11",
    review_sha256=review["profile"]["reviewSha256"],
    quiesced=True,
    passphrase_env="SF88_BACKUP_PASSPHRASE",
).native
```

Supply the passphrase privately in that named environment variable; its value
does not enter a command or result. The encrypted archive retains the original
operator authentication material, so keep both archive and passphrase private.
The explicit `quiesced=True` asserts external writers were stopped. Capture also
holds the original metadata, execution and ledger locks and verifies every
staged authenticated checkpoint.

Verify and restore without opening the missing live workspace:

```python
recovery = AcquisitionWorkspace(checkout="/opt/stellar-forge")
options = {
    "bundle": backup["bundle"],
    "expected_record_sha256": backup["recordSha256"],
    "passphrase_env": "SF88_BACKUP_PASSPHRASE",
}
verified = recovery.verify(**options)
restored = recovery.restore(**options)
reopened = acquisitions.state()
```

Restore uses the exact original canonical root retained by the archive and
refuses a populated target. It restores original plans, keys, journals and
execution identities and reopens the original workspace. It does not execute,
finalize or relocate the acquisition. A post-publication reopen failure remains
attached to the published result. History is available at
`acquisitions.state().native["recovery"]["history"]`.

## Receive and deliver the original remote file order

The paid-file interface consumes the original
`stellar-forge.sf101.purchase-handoff.v1` merchant document and the
[existing receiving model](../../buyer-runbook/PAID_FILES.md). Keep operation
tickets on `receive_request`; remote file orders use `receive_paid_file`.

On the first workspace call, declare the host's available claim environment
names with `paid_file_claim_envs=["SF101_CLAIM_TOKEN", "REPORT_CLAIM_TOKEN"]`.
The default is `SF101_CLAIM_TOKEN`; omit the constructor option on reopening
to retain the saved list. Token values belong in the selected environment
variable of the native runtime, not in command JSON, source files or reviews.
Only the local operator selects the preset, signer, budget limits and names.

```python
order = acquisitions.receive_paid_file(
    "/srv/customer/incoming/file-order.json",
).native

# Present the exact merchant order, price, promised bytes and SHA-256.
# These one-purchase limits must fit the customer's local preset.
order_review = acquisitions.review_paid_file(
    order["id"],
    expected_revision=order["review"]["revision"] if order["review"] else 0,
    total_atomic=order["handoff"]["payment"]["amount"],
    daily_atomic=order["handoff"]["payment"]["amount"],
    filename="purchased-report.bin",
    claim_env="SF101_CLAIM_TOKEN",
).native
file_buyer = acquisitions.prepare_paid_file(
    order["id"], review_sha256=order_review["review"]["reviewSha256"],
).native
file_draft = acquisitions.save({
    "schema": "stellar-forge.buyer-runbook.v1",
    "id": "customer-file-order",
    "title": "Reviewed customer file",
    "operations": [{
        "id": "file-order", "label": "Purchase the reviewed file",
        "config": file_buyer["configName"], "saveAs": "checkout-response.json",
    }],
}).native

# Present the frozen plan, then accept this exact review.
file_run = acquisitions.initialize(
    file_draft["id"], expected_revision=file_draft["revision"],
    review_sha256=file_draft["reviewSha256"],
).native
```

One merchant origin/order reference retains one native buyer identity. Receiving
it again reopens the same order; changed payment/file promises conflict.
Preparation can be resumed with the same saved review, preserving the original
keys, policy and spending ledger. The review becomes fixed when setup begins.

Use the existing `execute` method with this acquisition's exact plan hash and
the original operator terminal. The attempt, checkout response, recovery and
accounting remain the same original runbook records. Product delivery begins
after the merchant has granted that order's entitlement:

```python
import threading

selected = acquisitions.inspect(file_run["id"]).native
operation = next(row for row in selected["state"]["operations"]
                 if row["id"] == "file-order")
if not operation.get("paidFile") or operation["paidFile"].get("error"):
    raise RuntimeError("Select the original prepared paid-file operation")
transfer = {
    "only": operation["id"],
    "config_sha256": operation["config"]["sha256"],
    "handoff_sha256": operation["paidFile"]["handoffSha256"],
}
cancel = threading.Event()
try:
    delivered = acquisitions.retrieve_paid_file(
        file_run["id"], **transfer, cancel_event=cancel,
    )
    print(delivered.native["execution"]["result"])
except AcquisitionError as error:
    # Retained native state shows the original partial/cancelled/failed transfer
    # when available; a failed caller does not imply an absent native result.
    print(error.result)
```

A customer control can call `cancel.set()` to pause the owned transfer. Reopen
with `inspect`, use the same original hashes and a new unset event, then call
`retrieve_paid_file` again to resume. The native engine checks entitlement,
ranges, validators and the final digest. An already completed local product
is verified and reused without HTTP. Transfer actions do not replay purchases.
The customer's explicit partial-discard action uses
`reset_paid_file(file_run["id"], **transfer)`.

```python
acquisitions.download_paid_file(
    file_run["id"], "file-order", "/srv/customer/exports/purchased-report.bin",
)
acquisitions.export_paid_file(
    order["id"], destination="/srv/customer/exports/original-file-order.json",
)
```

Product export reads the original verified descriptor, checks the complete
bytes/digest across copying and creates a private destination exclusively.
`download` still exports the checkout response. The handoff export preserves
the merchant's exact original bytes. Existing destination files are protected.

The existing whole-acquisition recovery includes the received order, every
original operator and retained transfer artifacts. Capture, source-absent
verification and original-root restoration preserve their original identity,
paths and claim environment names. Restore does not execute, retrieve or reset
a file automatically. The receiving host supplies its own claim token before
continuing an unfinished network delivery.

The executable example accepts the same eight paid-file command names and
camelCase command JSON fields as the Node example. SDK methods use snake_case.
For transfers the JSON fields are `id`, `only`, `configSha256` and
`handoffSha256`; product downloads take `id`, `operationId` and
`destination`. Both examples use their original signal-driven cancellation
and retain native output separately from process errors.

## Method reference

| Work | Python methods |
| --- | --- |
| Select and reopen | `state`, `attach_run` |
| Original request | `request`, `receive_request`, `review_request`, `prepare_request`, `export_request` |
| Remote file order | `paid_file`, `receive_paid_file`, `review_paid_file`, `prepare_paid_file`, `export_paid_file` |
| Entitled product | `retrieve_paid_file`, `reset_paid_file`, `download_paid_file` |
| Immutable acquisition | `draft`, `save`, `initialize`, `inspect` |
| Original execution | `execute`, `recover`, `unlock` |
| Original accounting | `finalize`, `bind_accounting` |
| Saved resources | `preview`, `download`, `export` |
| Complete recovery | `backup_review`, `backup`, `verify`, `restore` |

[The executable example](examples/acquisitions.py) takes a private Python SDK
settings JSON file and one explicit command JSON file. Its commands use the
same names and parameter fields as the Node example. It prints the complete
native result with the separate process diagnostics. The existing
single-operator `WorkspaceRecovery` API remains available and unchanged.
