# Use an acquired dataset in a durable SQLite application

The original Python buyer can retain a completed SF88 acquisition and deliver
its SF100 data room. `DatasetDatabase` takes that verified delivery into a local
SQL database so an analytical application can query it, retain successive
versions, choose which version a named view exposes, and reopen the same data
after the buyer process exits.

Install the current original Python package from this checkout as described in
[README.md](README.md). The consumer uses Python's standard `sqlite3` module and
adds no service or dependency. Its public imports are:

```python
from stellar_forge_buyer import DatasetAcquisition
from stellar_forge_buyer.sqlite_dataset import DatasetDatabase, QueryResult
```

## Complete customer workflow

First acquire the desired merchant snapshot using the existing
[dataset workflow](DATASETS.md). That original process owns page approval,
attempts, spending limits, interruption recovery and delivery. The following
code reopens its completed session and data room; it does not call `run()`:

```python
from pathlib import Path
from stellar_forge_buyer import DatasetAcquisition
from stellar_forge_buyer.sqlite_dataset import DatasetDatabase

acquisition = DatasetAcquisition(
    checkout=Path("/opt/stellar-forge"),
    session=Path("/private/customer/acquisition"),
)
delivery = acquisition.deliver(Path("/private/customer/data-room"))
database = DatasetDatabase(Path("/private/customer/analysis"))
version = database.import_delivery(delivery)

# Inspect the dataset, filters, query hashes, columns and original payment
# classification in version before selecting it for your application.
current = database.current("inventory")
selected = database.activate(
    "inventory", version["version_id"],
    expected_revision=current["revision"],
)
result = database.query(
    'SELECT sku, units FROM inventory WHERE available = ? '
    'ORDER BY "_sf_row_number"',
    (1,),
)
print(result.dictionaries())
```

The SQL fields in this example match the original inventory example. Use the
selected delivery's `dataset.projectedFields` and returned `column_types` for
another merchant. Named parameters are also supported. The example application
[examples/query_dataset.py](examples/query_dataset.py) provides `import`,
`status`, `activate`, `query` and `backup` commands with the same APIs:

```sh
python examples/query_dataset.py import \
  --checkout /opt/stellar-forge \
  --session /private/customer/acquisition \
  --delivery /private/customer/data-room \
  --database /private/customer/analysis

python examples/query_dataset.py status \
  --database /private/customer/analysis --view inventory

# Use the import's version_id and the displayed current revision.
python examples/query_dataset.py activate \
  --database /private/customer/analysis \
  --view inventory --version VERSION_ID --expected-revision 0

python examples/query_dataset.py query \
  --database /private/customer/analysis \
  --sql 'SELECT SUM(units) AS available_units FROM inventory WHERE available = ?' \
  --parameters '[1]'
```

## Transactions, identity and version selection

`import_delivery()` verifies the original manifest and JSONL through the
existing `DatasetDelivery` file interface. It streams the same verified JSONL
descriptor into one SQLite transaction, checks every row against the original
projected fields, and verifies the final byte count, row count and digest
before commit. A failure or interruption rolls back that table and its
metadata; previously imported versions and named views stay usable.

Each immutable version is identified by the original manifest digest,
SF88 `sourceBindingSha256` and explicit SQL column mapping. The database retains
the exact original manifest, including its dataset snapshot, filters, range
selection, original query hashes, source-page identities and output digests.
Reimporting that same delivery and mapping returns `import_status="UNCHANGED"`
without inserting rows again. Importing a different delivery or mapping creates
another table and leaves current views alone.

`activate(name, version_id, expected_revision=...)` changes the view and records
its selection in one transaction. A first view has revision zero before
selection. A stale revision raises `DATASET_SQL_VIEW_CHANGED`; inspect
`current(name)` and make the selection against that displayed state. Selecting
the already current version at its current revision returns `UNCHANGED` without
incrementing the revision. Any retained version can be selected again with the
same operation. The current version, older tables and activation history remain
in the database across process restarts.

Use `versions(before=..., limit=...)` to page through retained versions, and
`version(version_id)` or `manifest(version_id)` to inspect a particular one.
`next_before` is the stable sequence cursor for the next history page. The
`sf_dataset_activations` table is available to ordinary SQL queries for selection
history. This history records local data selection; original settlement
records continue to belong to the native buyer and accounting engines.

## Value and query behavior

The importer binds the original JSON scalars without column affinity conversion.
Strings remain text, including leading zeros and precise decimal strings;
integers remain signed 64-bit integers, finite JSON numbers remain SQLite numeric
values, and null remains null. Booleans use SQLite's conventional zero/one
representation. Each column's observed JSON types are retained beside the
source-to-SQL name mapping. JSON integers outside SQLite's signed 64-bit range,
non-finite numbers and compound values are rejected without changing the database.
This follows SQLite's documented [storage classes and affinity rules](https://www.sqlite.org/datatype3.html).

Column names are quoted. If original names collide under SQLite's identifier
comparison or use `_sf_row_number`, supply an explicit mapping:

```python
version = database.import_delivery(
    delivery,
    columns={"Units": "reported_units", "units": "available_units"},
)
```

`_sf_row_number` retains acquired row order and starts at one. Use an explicit
`ORDER BY` when row order matters. Each version reports its physical table name,
so SQL can join or compare retained versions while the application continues to
use a stable named view. The source manifest remains unchanged by SQL naming.

`query()` uses a read-only connection, bound parameters and a SQLite authorizer
that excludes writes, attachment of other databases and extension loading. It
returns `QueryResult(columns, rows, truncated)`. Default limits are 1,000 result
rows, 16 MiB of returned scalar data and ten seconds; callers can select up to
100,000 rows, 256 MiB (`max_result_bytes`) and 300 seconds. Results are collected
incrementally. The `truncated` flag is true if another row would exceed the
selected row or byte limit. SQLite's per-value/row length limit is 16 MiB.
`dictionaries()` requires unique result names;
use SQL aliases for otherwise duplicate names. The original ordered tuple rows
are always available. SQL is evaluated by the same native engine documented by
[Python's sqlite3 interface](https://docs.python.org/3/library/sqlite3.html).

## Reopen and transport the working database

A new process needs only the private database to continue analysis:

```python
database = DatasetDatabase("/private/customer/analysis", create=False)
current = database.current("inventory")
rows = database.query('SELECT * FROM inventory ORDER BY "_sf_row_number"')
original_manifest = database.manifest(current["version"]["version_id"])
```

It does not need the buyer process, wallet environment or source network.
`backup("/private/customer/analysis-copy")` uses SQLite's native backup API to
publish a consistent copy containing rows, manifests, retained versions and
current selections. The destination database is create-only. Reopen that
directory with the same constructor. Both the directory and database must be
private; the module does not make an existing public file private implicitly.

The file is an ordinary `datasets.sqlite3` database. Other SQLite applications
can inspect its named views and retained tables. Keep the maintained database
read-only in those applications so its recorded versions continue to describe
the imported rows. Use native backup for a consistent copy during active work.
Dataset import and SQL availability do not change the original delivery's
payment classification, which is retained verbatim as `originalPaymentStatus`.
