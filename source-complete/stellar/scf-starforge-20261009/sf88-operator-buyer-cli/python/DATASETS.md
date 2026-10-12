# Acquire and consume a dataset from Python

`DatasetAcquisition` uses the original SF88 paginated session and SF100 delivery
tool. A Python application can create a session from the publisher's reviewed
configuration or an existing native operator workspace, run the remaining pages,
recover retained work, and consume the resulting typed rows. The session's
original immutable configuration, page attempts, evidence and response files are
the durable record. Reopening uses that same directory.

Install the original Python buyer package as described in [README.md](README.md)
and supply its complete current Node checkout. Python 3.11+ and the existing
Node/Python native dependencies are required; this module adds no dependencies.
The original terminal approval remains interactive for each paid page. Run from
a controlling operator terminal; preparation, status, recovery, delivery and
consumption work offline without wallet keys. The existing `script` utility can
provide a controlling terminal in an environment whose allocated TTY does not.

## Create, run and deliver

First review the merchant's actual terms in the original publisher/buyer flow.
The publisher's prepared configuration includes its selected snapshot, query and
payment rail. An existing native workspace holds the trusted operator policy,
ledger, signer and keys. Choose **one** configuration source below.

```python
from stellar_forge_buyer.datasets import DatasetAcquisition, DatasetError

acquisition = DatasetAcquisition.create(
    checkout="/work/public-commons-sprint-2026",
    session="/private/customer/weekly-inventory",
    workspace="/private/operator/inventory",   # existing native workspace
    # config="/private/customer/reviewed-buyer.json",  # alternative source
    max_pages=20,
    max_total_atomic="20000",
    max_rows=100_000,
    max_page_bytes=1_048_576,
)
print(acquisition.last_report)  # native READY status; no HTTP request

try:
    report = acquisition.run()
except DatasetError as error:
    print(error.code, error.report)  # retained native result when available
    report = acquisition.recover()  # offline; does not automatically resume

if report["status"] == "COMPLETE":
    delivery = acquisition.deliver("/private/customer/inventory-data-room")
    print(delivery.payment_status)  # original accounting classification
    for row in delivery.jsonl_rows():
        import_inventory_row(row)  # application's own consumer
```

The new session directory must not already exist; its parent must exist without
symlink aliases. Native code creates the session, page and evidence directories
with private permissions. `max_total_atomic` is a decimal string in the exact
advertised asset's atomic units. The per-page cap remains in the reviewed buyer
configuration. Native acquisition allocates those caps conservatively; an
allocated cap is not a payment or revenue amount. All real reservations and
financial classification remain in the original SF36/SF82 path.

New sessions accept `max_pages` from 1 through 4,096 and `max_page_bytes` from
1,024 through 2,097,152, matching the original SF100 import limits. Native
initialization rejects incompatible configured ceilings before creating a
session or attempt. The original aggregate archive/export limits still apply;
choose a selection and row ceiling that fit the native delivery workflow.
Existing session definitions remain available to original status and recovery.

The selected `snapshot` query parameter binds the native session automatically.
An optional `snapshot="64-character-sha256"` also pins a reviewed version; a
conflicting selection is refused. Subsequent pages retain the same query and
snapshot even when the publisher changes the current version. Expired retained
versions use the original merchant's admission behavior.

An attached workspace is reopened before every new page. Changed configuration
requires a new review. The original Node workspace loads operator keys only for
execution; they are not returned to Python. The original terminal prerequisite
is checked before a durable dataset attempt is recorded. The `run()` process
keeps the default native executor and per-page approval; only its console
summary is suppressed to produce one structured Python result.

## Resume the same work

```python
reopened = DatasetAcquisition(
    checkout="/work/public-commons-sprint-2026",
    session="/private/customer/weekly-inventory",
    timeout=900,  # maximum time for one original subprocess invocation
)
report = reopened.recover()
if report["status"] == "READY":
    report = reopened.run()  # explicit continuation of remaining pages
if report["status"] == "COMPLETE":
    delivery = reopened.deliver("/private/customer/inventory-data-room")
```

`run()` returns the original report, including `RECONCILIATION_REQUIRED`,
`PAGE_LIMIT_REACHED` or `TOTAL_CAP_REACHED`. Inspect the native `pages`, `nextPage`
and limits instead of interpreting subprocess exit alone as acquisition success.
An attempted page with incomplete original evidence is never sent again by
recovery. Resolve it through the original buyer accounting tools. A completed
session is reused without additional merchant requests. Limits and original
configuration remain immutable; do not recreate a session merely to retry an
uncertain economic attempt.

Timeout or Ctrl-C uses the original Runtime's native cancellation and raises
`DatasetError`. Its `native`/`report` fields retain any complete structured result
received before exit. `recover()` reads the original files after that process
has exited. A still-running owner retains its lock. The Python object does not
save a second operation journal or reset a native marker.

`deliver()` is offline and requires a complete acquisition. It delegates to the
original SF100 exporter, which verifies the native source chain, appends any
remaining archived pages, and produces `dataset.jsonl`, `dataset.csv`,
`review.html` and `manifest.json`. Repeating the same destination reopens the
original finalized room. The same native error exposes preserved partial-work
metadata through `DatasetError.native`; keep that directory for native recovery.

## Consume verified files

```python
for row in delivery.jsonl_rows():
    use_typed_values(row)             # native numbers, booleans and nulls
for row in delivery.csv_rows():
    use_csv_strings(row)              # original CSV interpretation
manifest = delivery.file("manifest.json").json()
with delivery.file("dataset.jsonl").open() as source:
    stream_into_application(source)
delivery.file("dataset.csv").save_as("/private/customer/export.csv")
```

These methods use the original Python file reader's byte-count and SHA-256
verification before yielding the same open file descriptor. Dataset outputs
also retain native private-directory/file permissions and reject symlink files
or hard-linked outputs. JSONL row iteration preserves native order and types;
CSV values are strings. `save_as` creates a new private file and refuses an
existing destination. Application imports may have their own idempotency needs:
use the native source binding/snapshot and your application's transaction model
when consuming the same room again.

`examples/acquire_dataset.py` provides `init`, `status`, `run`, `recover`,
`deliver` and `consume` commands. For example, after initialization:

```sh
python examples/acquire_dataset.py --checkout /work/public-commons-sprint-2026 \
  --session /private/customer/weekly-inventory run
python examples/acquire_dataset.py --checkout /work/public-commons-sprint-2026 \
  --session /private/customer/weekly-inventory consume \
  --out /private/customer/inventory-data-room
```
