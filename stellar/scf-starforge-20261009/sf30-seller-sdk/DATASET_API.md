# Queryable CSV data in the existing SF30 seller

Expose selected columns from an operator-owned CSV as a paid, filtered JSON API.
No merchant backend or database service is needed. This is a new application
handler for **the existing SF30 server**, not another payment implementation.
It uses Node 22 built-ins and adds no package dependency or hosted workflow.

## Run the example, then use your data

From `stellar/scf-starforge-20261009/sf30-seller-sdk`:

```sh
node dataset-cli.mjs --dataset examples/inventory-dataset.json
```

This parses the entire example before returning its six-record count, column
schema and snapshot ID. It does not print the source records or internal column.
`inventory-dataset.csv` is fictional demonstration data.

Create your own dataset specification following `examples/inventory-dataset.json`.
`file` resolves beside that specification, not the current working directory.
Only columns explicitly listed in `columns` are exposed. Do not list sensitive
columns. Choose up to eight exact-match filter columns in `filters`.

Prepare a JSON file containing your **existing public SF30 payment terms**:
`scheme`, `network`, `amount`, `asset`, `payTo`, `maxTimeoutSeconds`.
Use `scheme: "exact"`, an explicit supported network, the real asset contract and
recipient, and a positive **atomic-unit string** for the price per request.
Do not include a seed, secret key or other wallet credential. The command checks
these terms through the original SF30 offer compiler; it does not prove account
ownership, contract validity or network settlement.

```sh
export SF30_DATASET_CONFIG="$(pwd)/examples/inventory-dataset.json"
node dataset-cli.mjs --dataset "$SF30_DATASET_CONFIG" \
  --payment /private/public-payment-terms.json \
  --origin https://your-api.example --path /data --out seller-dataset.json

# Inspect the original 402 challenge without a facilitator or wallet call.
node serve.mjs --config seller-dataset.json \
  --handlers examples/dataset-application.mjs
```

Generated configuration is create-only: choose a new output name instead of
silently overwriting a running configuration. It contains schema examples, not
CSV records. Replace the example origin with your operator-managed public HTTPS
origin and reverse proxy; the original server listens on `127.0.0.1:8423`.

For the paid route, restart that **same original command** with the original
`--facilitator YOUR_EXISTING_HTTPS_FACILITATOR` option. The existing SF30 native
factory and operator-managed SDK installation remain responsible for payment
verification and settlement. No facilitator is selected or contacted by this
package. Keep `SF30_DATASET_CONFIG` set to the spec used when generating config.

Inspect `/_seller/health` and `/_seller/offers` as with any other SF30 seller.
Point an existing SF31/SF81 buyer at the public `/data` URL and use its normal
signing flow. Without native verification, the application data is not served.

## Query interface

```text
/data?where_category=widget&where_available=true&fields=sku,description,units&limit=1
```

This asks for the first available widget, with only the three selected columns.
`where_COLUMN` performs typed equality. Multiple filters are ANDed, and only
operator-enabled filter columns are accepted. Values are case-sensitive; strings
are not trimmed or case-folded. There is no SQL, regex execution, arbitrary sort,
remote fetch, request-supplied path or filesystem traversal.

`fields` is an ordered, comma-separated subset of exposed columns. Omit it for
all exposed columns. `limit` defaults to the configured value and cannot exceed
`maxLimit`. Unknown, duplicate or array-valued query parameters are errors.

Responses contain `dataset` (name, snapshot, schema, record count), `fields`,
`filters`, projected `rows`, and `page` (`total`, `returned`, `limit`, `nextCursor`).
The result order is always the original CSV record order. An empty match is a
normal successful result with `rows: []` and `total: 0`; it is still a paid API
request, not an automatic credit or refund.

To continue, copy `page.nextCursor` into `cursor` and keep the exact same filters
and field selection. A caller may change `limit` between pages. A changed dataset
returns `409 DATASET_SNAPSHOT_CHANGED`, instructing the caller to start a new query.
A cursor is a plain encoded position bound to the snapshot and query, **not an
access credential**. It can be inspected or edited; it grants no extra columns
or filter capabilities. Each page is a distinct paid request under original SF30.

## Types, snapshots and resource use

Supported column types are `string`, `integer`, `number`, and `boolean`.
Booleans are exactly `true` or `false`; integers must be JavaScript-safe integers.
`number` uses finite IEEE-754 values. Keep exact decimal money, very large
integers, identifiers with leading zeros and timestamps as **strings** rather
than losing their original representation. No automatic type inference occurs.

A declaration such as `{ "type": "number", "nullable": true }` maps an empty
CSV cell to JSON null. For a nullable filter, an empty URL value also matches
null. A nullable string therefore does not distinguish null from an empty string.
Unlisted CSV columns are parsed for valid structure but not retained in results.
Malformed records, missing/duplicate headers, invalid UTF-8 or type mismatches
fail startup instead of silently dropping rows.

The loader supports UTF-8 BOM, quoted commas and newlines, doubled quotes,
CRLF/LF/CR record separators, and a final record without a newline. It reads the
CSV incrementally, builds in-memory equality indexes and retains one immutable
snapshot. Replace the source **atomically**, then restart the seller to publish a
new snapshot. Do not edit a file in place while it is being loaded. No implicit
reload changes data between a reviewed request and its response.

Default bounds are 64 MiB of CSV, 250,000 records, 65,536 characters per cell,
50 rows per page and a maximum page limit of 250. The operator can configure
these in the dataset spec; hard ceilings are 256 MiB, one million records,
1,048,576 characters per cell, 1,000 rows per page, and a 900 KiB response.
Returned metadata counts toward that response size. When a page is too large,
request fewer rows or columns. Equality queries start from the smallest matching
index; counting conjunctions still scans that candidate list. Memory depends on
data and the number of indexes. This is an in-memory snapshot API, not a database
for arbitrary joins, changing records or unbounded datasets.

## Composition and payment behavior

`loadDatasetConfig(path)` returns `describe()`, `admit(context)` and
`handle(context)`. The example exports them as `admitDataset` and `queryDataset`
for the original `--handlers` mechanism. Existing applications can import the
loader and expose the same functions without adopting the example launcher.

The original SF30 admission hook validates the query and prepares its page before
native verification. The same original context object carries that prepared page
to the handler; no request body or payment token is retained in a global log.
Validation errors return ordinary 400/409/413 responses before payment processing
in native mode. The original challenge-only mode returns its normal 402 without
executing the admission or application. No new consent gate is introduced.

The application never sets payment headers. The original resource server controls
verification, cancellation, settlement and whether the data is delivered after
settlement. This feature does not assert live settlement or customer revenue.

## One focused acceptance command

```sh
node test/dataset-acceptance.mjs
```

Exercises the original `serve.mjs` HTTP lifecycle with a clearly labelled local
payment-adapter fixture: invalid query before verification, unpaid body withheld,
verified dataset delivery, failed settlement body withheld. It also covers the
actual loader, typed projections, indexed equality, pagination and original offer
compiler. It does not use a wallet or external network. `--core-only` runs the
loader/compiler portion where the rest of the repository is not installed.
