# Receive acquired datasets into PostgreSQL

Use an original completed SF88 acquisition and its SF100 delivery in a customer
application's PostgreSQL database. The receiver loads all rows as one retained
edition, keeps the original dictionary, manifest and source-row JSON, and lets the customer
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

For a complete receiving operation on an isolated development host, the
[PostgreSQL runtimes guide](../runtime/postgres/README.md) provides pinned
native-server and streaming PGlite launchers, exact driver dependencies, and
an orderly database restart with the same receiving commands.

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

## Open the receiving workspace in a browser

The local receiving workspace uses the same warehouse, delivery reader and
transactions as the Python API and CLI. It adds saved mapping reviews, an
operation journal and a browser for receiving, reading and selecting complete
editions.

With the existing PostgreSQL connection environment configured, start it with:

```sh
stellar-forge-postgres \
  --connection-env SF_BUYER_POSTGRES_DSN \
  --schema sf_received \
  serve --workspace /srv/private/customer/postgres-receiving --port 0 --open
```

The global connection and schema options go before `serve`; its private
workspace and local port follow it. The first launch creates or reopens the
dedicated receiving schema. A later launch reads the saved operator identity
before opening PostgreSQL and requires the same warehouse UUID and schema.
The same command also runs through the installed module:

```sh
python -m stellar_forge_buyer.postgres_cli \
  --schema sf_received serve \
  --workspace /srv/private/customer/postgres-receiving --port 0 --open
```

The browser listens on an available IPv4 loopback port. Its private launch URL
is saved in `postgres-launch.json` inside that operator directory; `--open`
opens it on the receiving host. Standard output announces the address, private
launch file and warehouse identity. Use the complete saved URL when reopening
a tab. A new server process creates a new browser capability, while the
operator identity, reviews, requests and database editions remain the same.
One receiving process owns an operator directory at a time.

### Launch from the installed Python and Applications screens

Use a source release containing the PostgreSQL receiving implementation, then
open the existing **Python and workbooks** screen:

1. Select the retained runtime and Python interpreter, enable **PostgreSQL
   receiving · psycopg 3.3.6**, and complete the original installation review.
   Reopen that retained installation when configuring the application.
2. Select **PostgreSQL receiving workspace** under the installed Python
   commands. Its prepared `serve` command selects the private operator
   directory, the database schema, connection environment variable name and
   local port. Choose **Configure in Applications**.
3. In Applications, select the installed Python environment and the receiving
   operator directory. Set **Connection environment variable** to
   `SF_BUYER_POSTGRES_DSN`, or the existing name used on that host. Set
   **Receiving database schema** to the dedicated schema and **Local port** to
   `0` for an available port.
4. Select the existing private environment JSON containing that variable, then
   complete the application's configuration and start review. For a configured
   libpq service, the file's relevant entry is:

   ```json
   {"SF_BUYER_POSTGRES_DSN":"service=customer_warehouse"}
   ```

5. Start the application and use its retained local browser link. Applications
   matches the original private launch file, process ID, operator UUID,
   warehouse UUID, selected schema and loopback address before exposing that
   link. Stop and reopen it through the same retained application.

The environment file supplies the connection value to the process; the managed
command records its variable name. The installed `postgres` extra supplies
the driver, and the selected PostgreSQL server or development runtime supplies
the database. Its connection and credential configuration remains the receiving
host's existing configuration.

### Review, import and read

In **Source review**, enter the absolute path of the original SF88
dataset-delivery report, its original command envelope, the original SF100
native delivery report, or a finalized SF100 scan. **Inspect delivery** reads
every original row and checks the complete source binding. The table shows
every source field, observed JSON types and null count. The first five rows are
an additional preview of that complete inspection.

Review each database column name, selected PostgreSQL type, null setting and
business key. Suggested types use the complete input: original integer
overflow selects exact `numeric`, decimal numbers retain exact `numeric`,
strings remain `text`, booleans remain `boolean`, and mixed scalar types use
explicit `json`. Date or timestamp conversion is an explicit reviewed choice.
All fields remain in the mapping. Key fields must be nonnullable and comparable;
PostgreSQL checks their uniqueness during the transaction.

Enter the reviewer and any useful mapping note, then choose **Save complete
mapping review**. That record retains the original report bytes, report digest,
complete mapping and reviewed edition identity. **Import reviewed edition**
uses that saved review. An already committed identical edition returns
`UNCHANGED`; a new source or mapping produces a separately retained edition.
The import leaves existing application view selections intact.

**Retained editions** shows each original source binding, row count, schema and
mapping. Row navigation reads the complete retained table in original ordinal
order, fifty rows at a time. Each row can show its original source JSON beside
the typed database values. Exact decimal values and integers outside
JavaScript's safe integer range are displayed as text. The retained mapping
identifies their database types.

The selected edition provides these complete downloads:

| Download | Complete retained content |
| --- | --- |
| **Original dictionary** | Exact original semantics.json bytes, when the delivery includes field meanings |
| **Original manifest** | The exact original source manifest bytes, checked against the edition digest |
| **Column mapping** | Every source field, database column, selected type, null setting and business key |
| **Receiving record** | The original warehouse and edition metadata, mapping, row count and source identity |

### Select, compare and restore

Use **Use in application view** from an edition, or open **Application views**.
Select the intended view name and retained edition, then **Review current view
and selection**. The review shows the warehouse's current view revision and
selected edition. **Select this edition** passes that exact revision into the
original PostgreSQL transaction.

A concurrent view change leaves the new selection available for review and
returns `DATASET_PG_VIEW_CHANGED`. Refresh the displayed current selection and
review the desired change again. A different column signature requires a new
view name. Existing application readers keep their ordinary SQL view contract
and grants.

The view's retained history includes each committed selection and its previous
edition. Choose a historical edition to prepare a restore, review the current
revision, and select it through the same operation. Restoring creates the next
selection revision and keeps the later edition available.

In **Compare editions**, select two editions with the same explicit mapping
and business keys, then **Compare all rows**. PostgreSQL computes complete
added, removed, changed and unchanged totals. The browser pages through the
actual changed records; the displayed totals cover the whole key join.
Inspect the retained original JSON when a source formatting change needs to
be distinguished from its mapped typed value.

### Recover the original operation

An import or view selection receives its original request ID before the browser
sends it. The operator saves that request and its exact body before running SQL.
The **Operations** screen reopens saved results and lets an interrupted request
resume under the same ID.

For an import, recovery reads the reviewed deterministic edition identity. If
that edition already committed, it returns the original retained edition. If
it did not commit, the receiver uses the same retained review and original
delivery to perform the transaction.

For a view selection, the request retains the exact reviewed current revision
and prior edition. Recovery first reads PostgreSQL's current state. If the
original change committed and another operator subsequently selected a newer
edition, it finds the original committed history entry and returns
`RECOVERED` with the currently observed selection. It keeps that newer
selection in place. A request that lost the original revision race returns
`DATASET_PG_VIEW_CHANGED`; the user can review the new current state and
create a new intended selection.

The private operator directory contains `postgres-workspace.json`,
`reviews/`, `reviewed-sources/` and `requests/`. Preserve that directory
with the same database's receiving schema. Stop its process before taking the
coordinated backup, retain the complete PostgreSQL schema through the database
owner's backup procedure, then reopen the restored schema and operator
directory together. The original source report and its data room remain
necessary for a reviewed import that has not committed. A committed edition
retains its rows, dictionary, manifest and metadata inside PostgreSQL.

## Keep field meanings with the imported data

When the original delivery includes `semantics.json`, **Source review** shows
its delivered field names, original source fields, descriptions, datatypes,
units when declared, and your chosen database aliases. Expand a field to read
its full definition. The dictionary's issues, virtual columns, source capture,
primary key and original templates remain available. Changing a database alias
updates the displayed receiving mapping; it leaves the original source
definition intact.

The receiver uses the common [semantic dictionary reader](SEMANTICS.md) for
CKAN and OData deliveries. It verifies the original dictionary file against the
native delivery and source manifest before accepting a mapping review. The
immutable edition identity remains the original manifest, acquisition binding
and complete mapping; the manifest already binds the dictionary. Every new
import stores its exact bytes in the same PostgreSQL transaction as the rows.
Reopened editions verify the dictionary against that retained manifest and
reviewed mapping.

Three independent identities describe the source: its complete semantic
identity, its field-definition identity, and its source-capture identity.
The retained file also has its own exact byte digest. A new capture can
preserve all definitions; a reviewed SQL alias can change while the source
dictionary stays byte-for-byte identical. **Compare source meanings** reports
these differences independently and exports the complete comparison.

### Primary keys and editable aliases

The source dictionary's primary key is metadata from the original supplier.
The receiving mapping selects which source fields PostgreSQL will enforce as
the imported table's primary key. Source review shows that enforcement is
pending until import completes. A retained edition reports the source key as
enforced only when the complete declared source key is exactly the key that
PostgreSQL enforced. A different receiving key, or the original row ordinal,
does not enforce the supplier's declared key.

Database aliases accompanying a dictionary must be distinct even when
capitalization differs. The inspection form suggests distinct aliases and
still lets the operator choose each one. The dictionary's original URLs and
templates keep their original field names; the explicit source-to-SQL mapping
provides the receiving aliases.

### Compare and reopen meanings

**Retained editions** shows the complete original dictionary beside the typed
rows. **Original dictionary** downloads its exact source bytes. The same
meanings appear when reviewing an **Application views** selection, along with
the definition, capture and mapping changes from the currently selected
edition.

**Compare source meanings** works across different mappings and editions
without business keys. It lists added, removed or changed field definitions and
aliases, includes both complete dictionaries, and supports a named JSON
download. **Compare all rows** also opens that meaning comparison and then
uses the existing PostgreSQL keyed-row comparison. Row comparison continues
to require matching mappings and receiving keys.

The native API exposes the same original data:

```python
context = warehouse.semantics(version_id)
original_bytes = warehouse.semantics_bytes(version_id)
meaning_changes = warehouse.compare_semantics(previous_id, following_id)
```

A dictionary context contains the reviewed SQL aliases and original document.
The byte export is the original file, including its formatting. A genuine
legacy delivery returns `None` from the two dictionary methods. The CLI exposes
each operation:

```sh
stellar-forge-postgres semantics VERSION_ID
stellar-forge-postgres semantics-file VERSION_ID \
  --destination /srv/private/customer/semantics.json
stellar-forge-postgres --out /srv/private/customer/meaning-comparison.json \
  compare-semantics PREVIOUS_VERSION FOLLOWING_VERSION
```

The existing authenticated browser API adds
`GET /api/semantics?version_id=...`,
`GET /api/semantics-file?version_id=...` and
`GET /api/semantic-compare?previous=...&current=...`.
The file response includes its complete byte length and SHA256 header.

### Receive dictionaries for earlier imports

An earlier warehouse may already contain an edition whose original manifest
declares a dictionary. If its exact dictionary bytes have not yet been stored,
edition inspection reports `semantics_status: SOURCE_REQUIRED`.
**Open original receiving review** finds that edition's original saved review.
Import it again to attach its bound dictionary through the original import
transaction. If the review belongs to another operator directory, reopen the
original report and save its same complete mapping before importing.

The result keeps the original edition ID, table, row count and application
view revisions. It returns `import_status: UNCHANGED` with
`semantics_received: true` when the missing dictionary is received. A following
retry returns the already retained edition. The original source must still
supply the dictionary matching the committed manifest.

An original delivery with no dictionary is shown as `NONE`; all legacy
receiving operations continue. Earlier imports whose dictionaries still need
receiving can continue to serve rows and application views. Their dictionary
export and meaning comparison identify the missing original input.

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
instead of the three session options. That file can be the original SF88
dataset-delivery report or its original `{"report": ...}` command envelope,
an original SF100 native delivery report, or a finalized SF100 scan. The shared
loader reopens the existing original data room and checks the complete native
report when supplied. All original file and manifest checks still run.

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
warehouse. The command-line receiving commands use explicit `init` for creation;
the interactive `serve` command creates or reopens its dedicated receiving
schema on launch:

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
same transaction commits the complete rows, key constraints, original dictionary,
source manifest bytes and edition metadata. Type, key, I/O, cancellation or digest failures
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
dictionary and manifest bytes, view selection and history together. Reopen the restored schema
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

### Run the complete original-dictionary receiving example

The two source files in `examples/postgres_semantic_receiving.py` and
`examples/postgres_semantic_browser.mjs` provide an executable customer
receiving journey for an existing semantic delivery and PostgreSQL connection.
Use the original finalized scan or completed delivery report. The example
retains every original row and receives the same input using two explicit SQL
mappings, with one changed alias. It compares those mappings while verifying
that the source definitions and capture remain unchanged.

Select the receiving host's existing Playwright installation and Chromium:

```sh
python examples/postgres_semantic_receiving.py \
  --report /srv/private/customer/finalized-scan.json \
  --directory /srv/private/customer/postgres-meanings \
  --schema sf_semantic_receiving \
  --node-modules /opt/customer-tools/node_modules \
  --chromium /opt/customer-tools/chrome-headless-shell
```

The program operates the original HTTP review/import journal, streams both
complete imports, follows every original row page, selects the first edition,
downloads both complete dictionaries/manifests/mappings/receiving records, runs
the dictionary CLI and opens source, edition, application-view, comparison and
recovery screens at desktop and 390-pixel width. Browser downloads and
screenshots remain in the selected directory. The original source bytes and
supplier definitions are unchanged.

The receiving record ends in `RECEIVED` after that first phase. Use the
selected isolated runtime's existing restart operation, then reopen the same
database and operation:

```sh
python examples/postgres_semantic_receiving.py \
  --report /srv/private/customer/finalized-scan.json \
  --directory /srv/private/customer/postgres-meanings \
  --schema sf_semantic_receiving --phase reopen
```

Reopen verifies both dictionaries, every original row, the saved import
requests, original warehouse identity and selected view revision before
recording `COMPLETE`. The same private operation directory retains the
original reviews and request IDs across retries. Use the [original runtime
launchers](../runtime/postgres/README.md) for an isolated PostgreSQL or PGlite
database with the matching Psycopg installation.

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
| `semantics(id)`, `semantics_bytes(id)` | Verified original meaning document and exact dictionary bytes |
| `compare_semantics(previous, current)` | Complete source-definition, capture and SQL-mapping comparison |

Primary implementation contracts: [Psycopg COPY](https://www.psycopg.org/psycopg3/docs/basic/copy.html),
[Psycopg transactions](https://www.psycopg.org/psycopg3/docs/basic/transactions.html),
[PostgreSQL numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html)
and [PostgreSQL view replacement](https://www.postgresql.org/docs/current/sql-createview.html).

