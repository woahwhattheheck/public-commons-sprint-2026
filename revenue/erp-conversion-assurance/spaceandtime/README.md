# Native ledger acquisition and retained finance delivery

This component connects installed MakeInfinite tables and retained native ledger
responses to the existing [ERP reconciliation service](../service/README.md).
It discovers the actual schema, captures the selected complete window, prepares
the original source/target CSV and mapping inputs, and carries the acquisition
through the same retained job, reviewer decision and complete replay delivery.

Use Python 3.11 or newer for acquisition, and Linux with Node.js 22 or newer and
`flock` for the original finance service. These components use their standard
libraries. Keep the complete source checkout so the original engine, service
worker and state lease are available. The
[finance operating guide](FINANCE.md) covers service initialization, execution,
review, reconnect and combined delivery.

## Discover the installed source

Run commands below from this directory. Choose private directories outside the
source checkout. Install an existing customer account credential in an owned
`0600` JSON file using either `api_key` or `access_token`. Optional fields are
`access_token_expires` in Unix milliseconds and existing authorization
`biscuits`. Credential values stay outside plans, request records and exports.

```sh
umask 077
python3 acquisition.py --workspace /private/ledger-acquisition discover \
  --id installed-public-schemas \
  --credentials /private/makeinfinite-credentials.json

python3 acquisition.py --workspace /private/ledger-acquisition discover \
  --id installed-selected-table \
  --credentials /private/makeinfinite-credentials.json \
  --scope PUBLIC --schema ACTUAL_SCHEMA --table ACTUAL_TABLE
```

Discovery retains the original schema, table, column and primary-key response
arrays. It exposes native column names, type, size, nullability and key sequence.
`PUBLIC` selects indexed public resources; `SUBSCRIPTION` selects resources
owned by the account's subscription. This connector targets the documented
MakeInfinite **MANAGED** database. Select the actual installed Stellar table
and key from that discovery.

An API key supplies native proxy SQL authorization. Discovery obtains the
corresponding access token through the original API-key authentication route.
An installed access token instead uses the direct SQL API with its existing
authorization biscuits. Expiring API-key-derived access tokens renew in memory;
tokens and authentication response bodies are excluded from acquisition data.

## Capture a complete agreed window

Save a public capture plan with the actual names selected above. This example's
capitalized names are replacement fields; the ledger sequence illustrates the
inclusive/exclusive window used in the native operation described below.

```json
{
  "label": "Agreed Stellar payment workflow",
  "schema": "ACTUAL_INSTALLED_SCHEMA",
  "table": "ACTUAL_INSTALLED_TABLE",
  "scope": "PUBLIC",
  "columns": [
    "ACTUAL_OPERATION_ID_COLUMN",
    "ACTUAL_ASSET_COLUMN",
    "ACTUAL_AMOUNT_COLUMN"
  ],
  "window": {
    "column": "ACTUAL_LEDGER_SEQUENCE_COLUMN",
    "from": "64890748",
    "through": "64890749"
  },
  "page_size": 1000,
  "max_rows": 1000000,
  "max_capture_bytes": 1073741824
}
```

The complete discovered primary key supplies the default `ORDER BY`. Optional
`order_by` names may change that order while retaining every primary-key
component. The selected CSV columns automatically include the ordered key and
window column. Optional `filters` contain explicit
`{column, operator, value}` comparisons; supported operators are `eq`, `ne`,
`gt`, `ge`, `lt`, `le` and `in`. Numeric filter values should be exact decimal
strings. An `in` comparison accepts 1–100 values. This interface constructs
read-only `SELECT` statements from discovered names and typed values.

```sh
python3 acquisition.py --workspace /private/ledger-acquisition capture \
  --id agreed-ledger-window-001 --plan /private/capture-plan.json \
  --credentials /private/makeinfinite-credentials.json

python3 acquisition.py --workspace /private/ledger-acquisition show \
  --id agreed-ledger-window-001

python3 acquisition.py --workspace /private/ledger-acquisition resume \
  --id agreed-ledger-window-001 \
  --credentials /private/makeinfinite-credentials.json
```

The immutable capture ID binds the exact plan. Repeating it returns the existing
selection; a changed plan needs a new ID. Each capture has its own native process
lease, so independent captures can progress in the same workspace. SQLite
commits accepted responses, original-key observations and the next cursor
together. A successful response retained just before an interruption is parsed
from its original bytes when resumed.

The native SQL API returns arrays without a continuation token. Acquisition
therefore retains its generated SQL and advances through a lexicographic
keyset predicate on the discovered complete key. It continues to an empty
response, including when a nonempty page contains fewer rows than the requested
`LIMIT`. Original count observations before and after acquisition must both
match the acquired row count. Repeated native primary keys and incomplete or
changed counts retain their original responses for a new, explicit capture.

The API contract publishes no row-cap field. `page_size` is the selected SQL
`LIMIT`, not a claim about a platform allowance. The default is 1,000; supported
configured values are 1–100,000. A single response is limited to 64 MiB, and the
plan declares whole-capture row and byte capacity. Exceeding a capacity keeps
the original accepted data and produces an explicit error; it never samples
the comparison. Adjust the complete window or capacity for the actual workload.

Both native HTTP 429 responses and retryable server responses preserve the
pending read and honor `Retry-After`. `resume` before the recorded retry time
returns the paused state. The transport uses the operating environment's HTTPS
proxy and CA settings and preserves the original response status and bytes.
Redirect responses remain explicit provider outcomes.

## Exact values and native time semantics

Original JSON response bytes are stored by SHA-256. JSON integers use exact
Python integers and decimal numbers use `Decimal`; conversion to CSV emits
fixed decimal text without binary floating point or rounding. The original
comparison engine applies the selected scale and tolerance. Excess monetary
precision remains an original-engine input error.

The vendor documents a Spark-based Managed DB. Delimited identifiers use native
backticks. Arbitrary text values use `decode(X'UTF8_HEX', 'UTF-8')` so quotes,
backslashes and Unicode do not depend on string-escape session settings. The
same count queries include an exact encoding observation; it must preserve
the known quote/backslash/Unicode value before any keyset rows are accepted.
This binds the documented Spark expression to the selected installed service.

Operator timestamp windows require an explicit offset and retain up to nine
fractional digits while normalizing the instant to an explicit UTC literal.
A returned key with an offset keeps that instant. A returned native timestamp
without a zone stays a wall-clock timestamp in subsequent predicates; the
client does not invent an offset for it. Date windows use `YYYY-MM-DD`.
All windows include `from` and exclude `through`.

Complete keyset acquisition records the two count observations and selected
window. It does not create a transaction spanning the provider's requests.
Choose the agreed finalized ledger or settled source window for the workflow;
each later refresh has its own capture and retained input identity.

## Import original retained native responses

The same preparation supports existing native exports without another network
call. Retain an input manifest beside the original response files:

```json
{
  "schema": "tjl.native-acquisition-input.v1",
  "provider": "stellar-horizon",
  "label": "Agreed finalized ledger payments",
  "window": {"ledger_sequence": 64890748},
  "complete": true,
  "expected_records": 168,
  "filters": [{"path": "/type", "operator": "eq", "value": "payment"}],
  "unique_columns": ["/id"],
  "responses": [
    {
      "file": "page-0001.json",
      "url": "https://horizon.stellar.org/ledgers/64890748/payments?order=asc&limit=200",
      "method": "GET",
      "status": 200,
      "records_path": ["_embedded", "records"],
      "role": "records"
    }
  ]
}
```

Include every actual page, the terminal response and original ledger metadata
in the manifest for the completed selection. Each entry can retain its original
`at`, safe response `headers` and expected `sha256`. Metadata entries use
`role: "metadata"`. File paths resolve relative to the input manifest; original
absolute local file paths are also accepted. Inputs must be complete regular
files. `expected_records` describes the native records before filtering.

The documented native records path may be an array of keys or a JSON pointer.
Selection supports original-value `eq`, `ne` and `in` filters. Counts of
observed, selected and excluded records remain separate, and unique-key
checks apply to the original records before selection. Every original page
stays intact regardless of which records are selected for the finance input.

```sh
python3 acquisition.py --workspace /private/ledger-acquisition import \
  --id stellar-payments --manifest /private/payments/native-import.json

python3 acquisition.py --workspace /private/ledger-acquisition import \
  --id stellar-operations --manifest /private/operations/native-import.json
```

## Prepare the original finance inputs

Use the [original version 1 mapping specification](../README.md). Its
`source_columns` selects the agreed ledger CSV headers and `target_columns`
selects the acquired native CSV headers. Keys, exact amount scales/tolerances,
optional text attributes and group fields keep their original engine semantics.

A projection maps each output CSV header to an original JSON pointer. An
explicit tuple produces unambiguous JSON text for a composite native identity:

```json
{
  "operation_id": "/id",
  "asset_identity": {"tuple": ["/asset_type", "/asset_code", "/asset_issuer"]},
  "amount": "/amount",
  "transaction": "/transaction_hash",
  "from": "/from",
  "to": "/to"
}
```

An omitted asset code or issuer remains `null` in that identity tuple. A missing
ordinary projected field becomes an empty CSV cell, which the original engine
validates according to its selected role. No amounts are filled or rounded.
Without a projection file, each mapped header selects the identically named
original JSON property. Original nested objects remain in response storage;
select the relevant scalar field explicitly.

```sh
python3 acquisition.py --workspace /private/ledger-acquisition prepare \
  --id agreed-ledger-window-001 \
  --ledger /private/original-finance-ledger.csv \
  --spec /private/agreed-spec.json --projection /private/projection.json \
  --out /private/prepared-window-001
```

Two original native views can also supply both sides, as in the executed Stellar
operation:

```sh
python3 acquisition.py --workspace /private/ledger-acquisition prepare \
  --id stellar-payments --ledger-capture stellar-operations \
  --spec /private/agreed-spec.json \
  --projection /private/projection.json \
  --ledger-projection /private/projection.json \
  --out /private/prepared-stellar-window
```

`csv --id ID --projection FILE --out NEW_FILE` exports just a selected native
CSV when the existing operator needs that intermediate input. `list` and
`show --id ID` reopen retained progress and complete request/response lineage.
Completed preparation repeats verify and return the same exact inventory.

### Preparation and service contract

| File | Contents |
| --- | --- |
| `source.csv` | Exact supplied ledger bytes, or selected second native view |
| `target.csv` | Lossless native acquisition projection |
| `spec.json` | Original finance mapping plus acquisition reference |
| `acquisition.json` | Exact plan, selected window, capture state, original requests and response lineage |
| `originals/` | Original response bytes, credential-free request records, retained input manifests and original supplied spec |
| `manifest.json` | `tjl.spaceandtime.prepared.v1` inventory with normalized relative paths, bytes and SHA-256 |

The manifest records `preparation_id`, `capture_id`, optional
`ledger_capture_id`, and canonical acquisition/source/target/spec hashes.
Its `files` array inventories every retained file except the manifest itself.
Original authentication headers and authorization biscuits are excluded from
the public request representation; its SQL text and ordinary request parameters
remain exact. Credential files are never part of the package.

`spec.workspace.spaceandtime_acquisition` adds the preparation identity,
acquisition digest, source/target digests, participating capture IDs and exact
window under schema `tjl.spaceandtime.acquisition-ref.v1`. All other original
`spec.workspace` metadata is preserved. The finance adapter validates and
retains the full preparation before staging its canonical source/target/spec
files through the original service. Its combined delivery carries the native
acquisition and original service replay together; see [FINANCE.md](FINANCE.md).

## Existing finance workspace

[workspace-profile.json](workspace-profile.json) supplies the original shared
conversion workspace with payment-operation and ledger identity/status cohorts.
It uses the published `startConversionWorkspace` profile shape. Launch the
existing `scap-workspace/cli.mjs` with its private `--directory` and this
`--profile`. The operator maps actual headers, uses the existing correction and
review tools, and preserves the original bundle/job relationships. Payment
operations use seven-decimal amount scale and the explicit native asset tuple.

For scheduled operation, use the host's existing scheduler to invoke acquisition
and [finance operate](FINANCE.md) for the agreed plan/window and ledger export.
The capture and job IDs are explicit scheduling inputs. Reconnection to the same
inputs retains the original job; a new window or corrected input uses a new
capture/preparation/job identity. The service's original reviewer decisions
remain bound to the exact report digest.

## Executed native source operation

The implementation consumed finalized public Stellar ledger **64890748**, closed
at **2026-10-11T17:25:22Z**, hash
`c95b52ff65096a0fcd9125557415935cb146c0f23535479815447cc0d915b02e`.
The independently acquired Horizon payments route retained 168 original records
and its empty terminal page. The operations route retained all 490 records,
matching the original ledger's operation count, plus its empty terminal page.
Both original ledger metadata responses were retained.

Selecting native `type: payment` produced **97 records on each side**. The
complete 23-file preparation retained all eight original responses and both
original input manifests. Each independently derived CSV had SHA-256
`b0da8fdac0c22f7bb11ebb9105bd3be23715bf90c3007aa5f2035e689a5c9d9a`.
The original retained service completed **PASS** with 97 source and 97 target
records, with no key, amount, group or attribute differences. It used operation
ID plus the original asset identity tuple, seven-decimal amounts,
transaction/from/to attributes and totals by asset. Its complete 1,245-byte
report has SHA-256
`07295d9a9758955937b97920ca44d90add8e7e8a837d4d53f3aaf5897520fecf`.
An explicit internal review was retained, the complete 41-file acquisition and
original-replay delivery succeeded, and standalone replay reported
`matchesDeliveredReport: true`. Reopening returned the same original bundle
and report with `reused: true`.

Those sources are actual Horizon views of the same finalized ledger. The native
MakeInfinite client uses the published discovery/auth/SQL contracts above and
the selected existing account for its installed table capture.

## Native references

- [Space and Time Stellar indexing](https://www.spaceandtime.io/blog/space-and-time-enables-new-sophisticated-financial-apps-for-the-stellar-ecosystem)
- [API-key authentication](https://docs.makeinfinite.com/reference/apikey-authn)
- [Schema discovery](https://docs.makeinfinite.com/reference/discover-schema)
- [Table discovery](https://docs.makeinfinite.com/reference/discover-table)
- [Column discovery](https://docs.makeinfinite.com/reference/discover-table-column)
- [Primary-key discovery](https://docs.makeinfinite.com/reference/discover-table-primarykey)
- [Native proxy SQL](https://docs.makeinfinite.com/reference/execute-proxy-sql-generic)
- [Native direct SQL](https://docs.makeinfinite.com/reference/execute-sql-generic)
- [Supported SQL syntax](https://docs.makeinfinite.com/docs/supported-sql-syntax)
- [Native data types](https://docs.makeinfinite.com/docs/data-types)
- [Documented Spark-based Managed DB](https://docs.makeinfinite.com/docs/running-queries)
- [Spark identifiers](https://spark.apache.org/docs/latest/sql-ref-identifier.html)
- [Spark literals](https://spark.apache.org/docs/latest/sql-ref-literals.html)
- [Spark UTF-8 decode](https://spark.apache.org/docs/latest/api/sql/string-functions/#decode)

MIT licensed. Customer records and credentials belong in the operator's private
workspace; the maintained repository contains the reusable implementation.
