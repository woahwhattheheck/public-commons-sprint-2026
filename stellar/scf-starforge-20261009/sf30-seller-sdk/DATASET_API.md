# Queryable CSV data and the operator workspace

Expose selected columns of an operator-owned CSV as a paid JSON API through the
**existing SF30 seller**. Prepare queries locally with the same immutable dataset
engine before giving a buyer a public request example. Node 22 built-ins only;
no database service, package installation, new payment implementation or hosted CI.

## Prepare and inspect a dataset

From `stellar/scf-starforge-20261009/sf30-seller-sdk`:

```sh
node dataset-cli.mjs --dataset examples/inventory-dataset.json
node dataset-cli.mjs --dataset examples/query-workspace-dataset.json
```

Both examples are fictional. The first is the original equality-only example;
the second demonstrates ranges, nullable values and stable sorting. Inspection
parses the entire CSV and prints schema, record count and snapshot ID, not rows.

The CSV `file` resolves beside its JSON specification. Declare only columns you
intend to expose. Extra CSV columns are parsed for structural validity but never
retained in results. Column types are explicit; there is no automatic inference.

```json
{
  "schema": "stellar-forge.csv-dataset.v1",
  "file": "inventory.csv",
  "name": "Published inventory",
  "columns": {
    "sku": "string",
    "category": "string",
    "units": {"type": "integer", "nullable": true},
    "updated_at": "string"
  },
  "filters": ["category", "units"],
  "ranges": ["units", "updated_at"],
  "sorts": ["sku", "units", "updated_at"],
  "defaultLimit": 50,
  "maxLimit": 250
}
```

`filters`, `ranges` and `sorts` each name up to eight unique exposed columns.
Ranges accept strings, integers and numbers, not booleans. All capabilities are
opt-in. The native seller advertises at most 32 query parameters, so the loader
also enforces `3 + filters.length + 4*ranges.length + (sorts.length ? 1 : 0) <= 32`.
This avoids preparing a dataset that its original offer compiler cannot advertise.

## Use the local query workspace

```sh
node dataset-workspace.mjs \
  --dataset examples/query-workspace-dataset.json \
  --resource https://your-api.example/data
```

Open the printed private session URL on the same computer. The process binds
`127.0.0.1:8430`; use `--port 0` for an available port. It reads the CSV once and
provides a neutral desktop/mobile interface to select columns, combine equality
and lower/upper bounds, choose order, page backward/forward, save the exact query
recipe and export the current result page. Tables scroll horizontally on narrow
screens rather than hiding controls or columns.

The workspace is an **operator preview**, not a paid buyer or public seller. It
uses the original `loadDatasetConfig`, `admit` and `handle` methods. It does not
contact `--resource`, start a facilitator, sign, verify or settle a payment, or
modify the CSV. `--resource` is optional and adds an exact public URL and unpaid
curl recipe to successful results; without it, query preparation and exports still
work. Every public paid page remains a separate original SF30 request.

APIs require the per-process session token; the browser removes it from the URL
fragment and retains it only in session storage for that origin. Host/Origin
checks, no-store responses and a restrictive content policy protect the local
interface. These are local application boundaries, not protection from a hostile
OS user, browser extension or other process able to inspect the operator's session.
The command accepts a dataset path only at startup, never through HTTP input.
Close the process with Ctrl+C when finished. Keep exports private as appropriate
for the columns you chose to expose.

## Attach the workspace to live dataset versions

Start the existing [versioned dataset seller](dataset-refresh/README.md), then
open the same workspace against its private state directory:

~~~sh
node dataset-workspace.mjs --state /srv/dataset-state --port 8430
~~~

This attaches to the running service through its existing private control client;
it does not reopen the store or acquire a second writer lock. Choose exactly one
of `--dataset FILE` and `--state DIR`. The file mode above keeps its original
immutable snapshot behavior.

The live workspace shows the current native schema, current snapshot, durable
revision, retained generations, expiry, row counts, active readers/loading, and
parsed-cache occupancy. Select **Current at request admission** to omit the
snapshot parameter, or select a stored snapshot to preview that exact version.
Cold generations use the service's same bounded cache. Previewing a page does
not extend retention, and the original cursor is copied unchanged for subsequent
pages. An expired generation cannot start a new preview.

To roll back, select a retained generation and choose **Make selected snapshot
current**. The request carries the current snapshot and revision actually shown
in the workspace. An intervening update is rejected; the screen refreshes live
state and lets the operator decide again. It never silently retries a stale
activation. A still-stored expired generation can be explicitly reactivated
before collection removes it. Closing the workspace leaves the seller running.

The public resource comes from the running seller's actual compiled routes.
With multiple dataset routes, the first is selected by default; `--resource` can
select another exact advertised HTTPS resource. An explicitly selected first
page receives a public request example only when that route was configured with
`--snapshot-selection`. Otherwise its exact query and page remain available as
a private preview with an explanation, without an unsupported public URL.
Routes with the original full 32 query parameters remain usable in this mode.

Optionally show the existing live catalog operator on the same merchant screen:

~~~sh
node dataset-workspace.mjs --state /srv/dataset-state \
  --catalog /srv/starforge/catalog
~~~

This uses the original SF60 private status client to show journal head, committed
operations, active resource count and discovery origin. It is catalog-wide
status, not a claim that a particular dataset is listed. The workspace does not
edit that catalog, fetch its discovery URL, or change seller admission policy.
Catalog unavailability does not disable dataset preview or version controls.

All workspace data and activation APIs retain the private browser session
capability and Host/Origin checks. The underlying schema and preview reads use
the same private dataset control transport as version management. Neither
merchant public routes nor browser callers receive its control token or source
paths. Paths, including the catalog directory, are accepted only at process
startup. Do not include the workspace in a public reverse proxy.

## Publish through the original seller

Prepare your existing **public payment terms** JSON: `scheme`, `network`, `asset`,
`amount`, `payTo`, `maxTimeoutSeconds`. Use `scheme: "exact"`, an explicit supported
Stellar network and a positive atomic-unit amount string. Never include a wallet
seed or secret key. The original compiler checks structural terms; it does not
establish recipient ownership or deployed asset validity.

```sh
export SF30_DATASET_CONFIG="$(pwd)/examples/query-workspace-dataset.json"
node dataset-cli.mjs --dataset "$SF30_DATASET_CONFIG" \
  --payment /private/public-payment-terms.json \
  --origin https://your-api.example --path /data --out seller-dataset.json

node serve.mjs --config seller-dataset.json \
  --handlers examples/dataset-application.mjs
```

Seller configuration is create-only. The existing server binds `127.0.0.1:8423`;
use the operator's existing HTTPS reverse proxy for public access. This command
starts original challenge-only mode, not payment or data delivery. For native
paid operation, use the same original command with
`--facilitator YOUR_EXISTING_HTTPS_FACILITATOR`, keeping `SF30_DATASET_CONFIG` set.
The original native factory and operator-managed SDK remain responsible for
verification and settlement. No facilitator is chosen or contacted by these tools.

Inspect `/_seller/health`, `/_seller/offers`, `/_seller/docs` and
`/_seller/openapi.json` on that same seller. Generated query metadata now includes
only its configured equality, range and sort capabilities, so the existing seller
docs inherit the new interface without a parallel documentation server.

## Query semantics

```text
/data?where_category=widget&gte_units=10&lt_units=50&sort=-units&fields=sku,units&limit=25
```

`where_COLUMN` performs typed equality. `gt_`, `gte_`, `lt_` and `lte_` perform
strict/inclusive lower and upper comparisons. All supplied conditions are ANDed.
Use at most one lower and one upper bound per column. An impossible interval
returns an empty successful page; malformed, repeated or unsupported parameters
return an error. Null values never match ranges. Empty equality matches null
only on a nullable column. Strings are case-sensitive and are not trimmed.

`sort=COLUMN` is ascending, `sort=-COLUMN` descending. Only configured sort columns
are accepted. Nulls come last in both directions; equal values retain original
CSV record order, so page boundaries do not shuffle ties. With no sort parameter,
results retain original CSV record order even when using range indexes.

String ranges and sorting use JavaScript UTF-16 code-unit order, **not locale
collation or date parsing**. Uniform `YYYY-MM-DD` dates can be compared as strings;
do not mix date formats or UTC offsets and assume chronological sorting. Numeric
sort/range follows the declared type. Integers must be JavaScript-safe integers;
`number` is finite IEEE-754. Keep exact decimal money, larger identifiers and
leading-zero codes as strings instead of silently losing precision. String money
will sort lexicographically, not numerically.

`fields` is an ordered, unique comma-separated subset of exposed columns. Omit it
for all. `limit` must be within the configured maximum. There is no arbitrary SQL,
regular-expression execution, remote fetch, request-supplied file or schema change.

Results retain the original `dataset`, `fields`, `filters`, `rows` and `page`
structure. Range requests add explicit typed `ranges`; sorted requests add `order`
with direction, null and tie behavior. `page` contains `total`, `returned`, `limit`
and `nextCursor`. Empty matches are successful paid requests, not automatic refunds.

For continuation, copy `nextCursor` unchanged into `cursor` and keep the same
fields, equality/range conditions and ordering. `limit` may change between pages.
A different query yields 400; a changed snapshot yields
`409 DATASET_SNAPSHOT_CHANGED`. A cursor is an encoded position, not an access
credential. Enabling or changing range/sort capabilities changes snapshot identity.
Configurations that omit both new capabilities retain the previous snapshot,
description and equality-only cursor format.

## Storage, indexes and application integration

The loader accepts UTF-8 BOM, quoted delimiters/newlines, escaped quotes, LF/CRLF/CR
records and a final line without a newline. It rejects malformed structure,
missing/duplicate headers, invalid UTF-8 and type errors at startup. Nullable
columns map empty CSV cells to null; a nullable string does not distinguish null
from an empty string.

The CSV is streamed into one immutable in-memory snapshot. Equality uses the
original indexes. Each range/sort column adds one ordered record-ID index, shared
when a column enables both capabilities. Range bounds use binary search. Selective
queries sort only candidate IDs; dense ordered queries walk a prebuilt index,
not a full sort on every page. Counting results can still scan many records, and
index memory grows with row count and the number of indexed columns. This is not
a database for arbitrary joins, live mutations or unbounded data.

Defaults: 64 MiB CSV, 250,000 rows, 65,536 characters per cell, 50 rows/page,
250 maximum page size. Hard ceilings: 256 MiB CSV, one million rows, 1,048,576
characters/cell, 1,000 rows/page and 900 KiB response including metadata. Reduce
fields or page size on `413 DATASET_PAGE_TOO_LARGE`.

Replace the source file atomically and restart to publish a new snapshot. Do not
edit the CSV in place while it loads. No implicit reload changes data between
query review and delivery.

`loadDatasetConfig(path)` still returns `describe()`, `admit(context)` and
`handle(context)`. Original native admission prepares the page before verification;
the same context object carries it to the handler. Validation errors return
400/409/413 before native payment processing. Original challenge-only mode returns
its ordinary 402 without running admission or the application. No payment headers
or settlement state are produced by the dataset engine or preview workspace.

## Focused checks

```sh
node test/dataset-query-workspace.mjs
node test/dataset-acceptance.mjs
```

The first exercises typed ranges, stable/null ordering, continuation, source and
query changes, original offer generation and a real authenticated loopback
workspace request. Its public payment identifiers are explicitly fictional;
no wallet, external request or settlement is performed. The second is the existing
SF30 dataset/seller acceptance journey, unchanged, including its labelled local
payment-adapter fixture and `--core-only` option. Browser navigation can be checked
with the normal workspace command; do not equate an offline renderer exercise
with a full browser-to-server run.

## SDMX sources, retained editions and customer receiving

`starforge sdmx` and `starforge dataset sdmx` open the same maintained SDMX workflow. It retains the original dataflow, data structure, codelists and observation sources; projects their exact string values through this dataset engine; compares saved editions; and transfers complete source-backed projects to another workspace. Its merchant release binds the native snapshot and lineage to explicit original SF30 public terms. Publication uses the original version store's current snapshot and revision, and customer acquisition uses the original SF88 paginated buyer and delivery.

See [the SDMX operator guide](sdmx/README.md) for the captured ECB input, source acquisition receipts, native CLI, public imports and complete merchant/customer commands.
