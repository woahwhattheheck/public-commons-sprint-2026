# Receive acquired datasets into PostgreSQL

Use an original completed SF88 acquisition and its SF100 delivery in a customer
application's PostgreSQL database. The receiver loads all rows as one retained
edition, keeps the original manifest and source-row JSON, and lets the customer
select which edition a stable SQL view exposes. Customer code can join that
view with its existing application tables.

The Python entry points are `Column`, `DatasetMapping`, `PostgresWarehouse`
and `review_delivery` from `stellar_forge_buyer.postgres_delivery`. The
installed command is `stellar-forge-postgres`. Acquisition and delivery use the
existing [dataset workflow](DATASETS.md).

## Install and connect

Install the original Python package with its optional PostgreSQL driver:

```sh
python -m pip install './stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[postgres]'
```

The extra supplies Psycopg 3.3.6 and its native libpq distribution. An application
that already supplies that Psycopg version can install the base package and use
its existing driver. This receiver uses PostgreSQL COPY, transactions, native
constraints and views; it does not install a database server.

Use the receiving host's existing libpq service or connection settings through
an environment variable. For example, when the host already has a configured
`customer_warehouse` libpq service:

```sh
export SF_BUYER_POSTGRES_DSN='service=customer_warehouse'
stellar-forge-postgres --schema sf_received init
```

The host's existing service configuration supplies its actual database, role,
TLS and credential settings. The command accepts the environment variable's
name through `--connection-env`; it never prints its value. Database failures
return a stable receiving code and, when available, PostgreSQL's SQLSTATE.

`init` creates an empty dedicated schema and its original warehouse identity.
It can reopen a schema this receiver already initialized. Existing unrelated
relations are kept intact: choose an empty receiving schema when initializing
the product in an existing database. The database role needs permission to
create that schema, or an existing empty schema with the required creation
privileges. Later receiving operations need the original schema and its tables.

Record the returned `warehouse_id`. Pass it through `--expect-warehouse` or
`expected_warehouse=` when a receiving operation must address that exact
warehouse. A Python instance checks its original warehouse identity on every
new database connection.

## Review the full delivery and its mapping

Reopen the original complete acquisition and its data room:

```python
from stellar_forge_buyer import DatasetAcquisition
from stellar_forge_buyer.postgres_delivery import (
    Column, DatasetMapping, PostgresWarehouse, review_delivery,
)

acquisition = DatasetAcquisition(
    checkout="/srv/stellar-forge",
    session="/srv/private/customer/acquisition",
)
delivery = acquisition.deliver("/srv/private/customer/data-room")

# These fields match the original inventory selection. Use the actual fields
# in your delivery's dataset.projectedFields for another product.
mapping = DatasetMapping(
    columns=(
        Column("sku", "sku", "text", nullable=False),
        Column("description", "description", "text", nullable=False),
        Column("units", "units", "bigint", nullable=False),
        Column("available", "available", "boolean", nullable=False),
        Column("rating", "rating", "numeric", nullable=True),
    ),
    keys=("sku",),
)
review = review_delivery(delivery, mapping)
print(review["version_id"], review["row_count"], review["columns"])
```

Review uses the original verified file reader and consumes the whole original
JSONL file. It validates every row, every selected conversion, the final byte
count, digest and row count. It returns the observed JSON types and null count
for each column. It opens no PostgreSQL connection and requires no Psycopg
installation.

Map every projected field exactly once. Each column selects its source name,
SQL name, PostgreSQL type and nullability. Keys use source field names and must
refer to nonnullable columns. PostgreSQL enforces the selected composite key
during the transaction; review records that key validation remains a database
operation. With no declared business key, the preserved one-based row ordinal
is the table's primary key.

The equivalent mapping file is:

```json
{
  "schema": "stellar-forge.postgres-dataset-mapping.v1",
  "columns": [
    {"source":"sku","column":"sku","type":"text","nullable":false},
    {"source":"description","column":"description","type":"text","nullable":false},
    {"source":"units","column":"units","type":"bigint","nullable":false},
    {"source":"available","column":"available","type":"boolean","nullable":false},
    {"source":"rating","column":"rating","type":"numeric","nullable":true}
  ],
  "keys": ["sku"]
}
```

From a complete existing acquisition:

```sh
stellar-forge-postgres --out /srv/private/customer/pg-review.json review \
  --session /srv/private/customer/acquisition \
  --checkout /srv/stellar-forge \
  --delivery /srv/private/customer/data-room \
  --mapping /srv/private/customer/pg-mapping.json
```

Alternatively, supply `--report /srv/private/original-delivery-report.json`
instead of the three session options. That file is the original SF88
dataset-delivery report or its original `{"report": ...}` command envelope.
The report points at the existing SF100 data room. All original file and
manifest checks still run; no source paths are silently relocated.

## Commit the complete edition

```python
warehouse = PostgresWarehouse.from_environment(schema="sf_received")
edition = warehouse.import_delivery(
    delivery, mapping, expected_version=review["version_id"],
)
print(edition["import_status"], edition["qualified_table"])
```

The constructor creates or reopens the dedicated warehouse by default. Use
`create=False` for an application that only receives into an already initialized
warehouse. The command-line interface uses explicit `init` for creation:

```sh
stellar-forge-postgres --schema sf_received import \
  --session /srv/private/customer/acquisition \
  --checkout /srv/stellar-forge \
  --delivery /srv/private/customer/data-room \
  --mapping /srv/private/customer/pg-mapping.json \
  --expect-version THE_REVIEWED_VERSION_ID
```

A new edition receives a private-to-the-transaction table. COPY streams the
original verified rows into that table using Psycopg's native adapters. The
same transaction commits the complete rows, key constraints, source manifest
bytes and edition metadata. Type, key, I/O, cancellation or digest failures
roll back that transaction. Previously committed editions and views remain
usable.

The edition identity binds the exact original manifest digest, original
`sourceBindingSha256` and complete mapping. Reimporting that identity returns
`UNCHANGED`. It reuses the committed table and preserves the original source
and payment classification. A new mapping or source manifest produces another
edition without changing the customer's current view.

Each table retains `_sf_row_number` and `_sf_source_row`. The latter is the
original delivered JSON row as PostgreSQL JSON, including its original field
names and number text. The exact original manifest is retained as bytes.
Customer-facing views expose the mapped columns plus the ordinal; the retained
source remains available through edition inspection.

## Select a stable application view

```python
current = warehouse.current("inventory")
selection = warehouse.activate(
    "inventory", edition["version_id"],
    expected_revision=current["revision"],
)
```

A new view has revision zero. An intervening selection raises
`DATASET_PG_VIEW_CHANGED`; read that view again and make the intended selection
against its current revision. Selecting the already current edition at its
current revision returns `UNCHANGED`.

The receiver uses PostgreSQL `CREATE OR REPLACE VIEW`, preserving the view's
existing grants and downstream dependencies. An edition must keep the view's
ordered column names and types. Use another explicit view name when the schema
changes. The receiver does not drop a dependent view or replace a relation it
did not create.

A customer application uses the resulting ordinary SQL view:

```python
import psycopg

with psycopg.connect("service=customer_application") as connection:
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT line.order_id, line.sku, inventory.units,
                   inventory.available, inventory.rating
            FROM application.order_lines AS line
            JOIN sf_received.inventory AS inventory ON inventory.sku = line.sku
            WHERE line.order_id = %s
            ORDER BY line.line_number
        """, ("the-customer-order-id",))
        rows = cursor.fetchall()
```

Use the customer's actual application relations and existing database role.
Grant that role schema usage and SELECT on the reviewed view through the normal
database administration workflow. The application's data and transaction remain
its own. A later view selection changes which complete supplier edition a new
statement sees.

## Preserve exact values

| Selected PostgreSQL type | Receiving behavior |
| --- | --- |
| `text` | Requires an original JSON string. Leading zeros, decimal text, whitespace and Unicode remain text. Text columns use PostgreSQL's C collation for exact key comparisons. |
| `boolean` | Requires a JSON boolean. Strings such as `"false"` remain strings until an explicit upstream mapping handles them. |
| `bigint` | Accepts a JSON integer or canonical integer string in the signed 64-bit range. Leading-zero identifiers should stay text. |
| `numeric` | Accepts original JSON numbers, integers or exact decimal strings. JSON number text is parsed directly as Decimal, avoiding a binary-float conversion. The PostgreSQL column has no rounding precision/scale declaration. |
| `double precision` | Explicitly selects native binary floating point. Values must be finite and in range; large integral identifiers require bigint/numeric or text. |
| `date` | Requires an actual ISO calendar date in `YYYY-MM-DD` form. |
| `timestamp with time zone` | Requires an ISO timestamp with an explicit offset or Z and at most six fractional digits. PostgreSQL stores the instant; reads use UTC and the original source row retains its original text. |
| `json` | Retains the original JSON scalar type in an explicit JSON column. Native JSON numbers remain exact during Python reads. |

A source null becomes SQL NULL only when the column is nullable. A missing field
is different from an explicit null and fails the original field-set check.
Keys are nonnullable. Numeric strings are converted only when the mapping
explicitly selects a numeric type. Compound source values must first use the
merchant's original explicit projection; SF100's dataset-row contract is scalar.

Python database reads return native `Decimal`, `date` and aware `datetime`
values. Command JSON renders Decimal as exact text and date/time values as ISO
text. The mapping accompanies each edition so downstream software can interpret
those command representations. Source row JSON can always be requested with
`rows --include-original`.

## Compare editions and recover selections

Import a later original complete delivery using the same mapping. Compare the
entire two editions by the declared keys:

```python
comparison = warehouse.compare(previous_version_id, following_version_id)
print(comparison["totals"])
for change in comparison["changes"]:
    print(change["kind"], change["before"], change["after"])
```

PostgreSQL computes ADDED, REMOVED, CHANGED and UNCHANGED totals over the complete
join. The returned change rows are paged with `next_offset`. Compare requires
the same explicit mapping and business keys. Numeric/date/boolean columns use
native PostgreSQL equality; explicit JSON columns compare their retained JSON
text. A source formatting change can therefore be inspected separately from a
typed numeric change using the original row field.

Inspect and select any retained edition again:

```sh
stellar-forge-postgres versions --limit 100
stellar-forge-postgres current inventory
stellar-forge-postgres compare PREVIOUS_VERSION FOLLOWING_VERSION --limit 100
stellar-forge-postgres activate inventory FOLLOWING_VERSION --expected-revision 1
stellar-forge-postgres history inventory --limit 100
stellar-forge-postgres rows FOLLOWING_VERSION --after 0 --limit 100 --include-original
```

A changed view selection and its history commit together. Historical edition
tables remain present. To restore a former selection, use `activate` with the
former version and the current displayed revision.

After interruption, reopen the same warehouse and inspect the original version:

```python
reopened = PostgresWarehouse.from_environment(
    schema="sf_received", create=False,
    expected_warehouse=warehouse_id,
)
print(reopened.version(reviewed_version_id))
print(reopened.current("inventory"))
```

If a connection was lost while commit's result was returning, an edition may
already be present. Repeating `import_delivery` with the same original data room
and mapping recovers that committed identity or performs the full previously
uncommitted transaction. It does not select another buyer intent.

## Receiving handover

The handover consists of the exact original delivery report/data room, selected
mapping, returned warehouse identity, edition IDs and the application view's
current revision. Save any command output with the top-level `--out` option;
outputs are create-only private files. Export a retained original manifest:

```sh
stellar-forge-postgres manifest VERSION_ID \
  --destination /srv/private/customer/original-manifest.json
```

The receiving schema is ordinary PostgreSQL state. The customer's existing
database backup/restore process can retain the edition tables, full original
manifest bytes, view selection and history together. Reopen the restored schema
with its same `warehouse_id`. Application readers should use SELECT privileges;
the receiver's API preserves retained editions and does not offer row editing.

For an existing application's connection lifecycle, pass a factory:

```python
warehouse = PostgresWarehouse(
    lambda: psycopg.connect("service=customer_warehouse", autocommit=True),
    schema="sf_received", create=False,
)
```

Each factory call must return a new idle Psycopg 3 connection. The receiver owns
and closes that connection after its complete transaction. An already active
transaction is rejected without being closed. Statement and lock deadlines
default to 300000 and 30000 milliseconds and can be configured on the instance
or through the command's corresponding top-level flags.

### Native interfaces

| Operation | Useful result |
| --- | --- |
| `review_delivery(delivery, mapping)` | Whole-file mapping review and stable version identity, offline |
| `import_delivery(delivery, mapping)` | Complete retained edition, `IMPORTED` or `UNCHANGED` |
| `status()`, `version(id)`, `versions(before=..., limit=...)` | Warehouse, exact edition and paged history |
| `current(name)`, `activate(name, id, expected_revision=...)` | Current application contract and atomic selection |
| `history(name, before=..., limit=...)` | Original sequence of view selections |
| `rows(id, after=..., limit=..., include_original=True)` | Rows in retained original order |
| `compare(previous, current, offset=..., limit=...)` | Complete key-join totals and paged changes |
| `manifest_bytes(id)` | Exact original manifest verified against the edition identity |

Primary implementation contracts: [Psycopg COPY](https://www.psycopg.org/psycopg3/docs/basic/copy.html),
[Psycopg transactions](https://www.psycopg.org/psycopg3/docs/basic/transactions.html),
[PostgreSQL numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html)
and [PostgreSQL view replacement](https://www.postgresql.org/docs/current/sql-createview.html).

