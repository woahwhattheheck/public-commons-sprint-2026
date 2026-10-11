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

## Method reference

| Work | Python methods |
| --- | --- |
| Select and reopen | `state`, `attach_run` |
| Original request | `request`, `receive_request`, `review_request`, `prepare_request`, `export_request` |
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
