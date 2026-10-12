# NocoDB source, publication and customer delivery

Publish an explicitly selected NocoDB v3 table or view as a reviewed, versioned
dataset through the original Stellar Forge publisher. The product connects
source discovery and complete retained captures to the existing browser, CLI,
merchant MCP, dataset version controller, SF82 release console and customer
client exports.

The adapter reads an existing authorized NocoDB service. It does not create a
NocoDB account, copy an entire base, write source records, provision compute or
purchase a plan. Operators choose the public fields and seller terms. Captures,
tokens, source declarations and internal source metadata stay in private host
storage; the prepared seller contains only the reviewed dataset and its public
contract.

## Install and select the source

Use the complete maintained source or installed distribution on Linux with its
supported Node.js runtime and util-linux flock. Node 24.19 is the runtime used
for the adapter's syntax and numeric/pagination contract checks. JSON.parse
source context is required to preserve the original provider number tokens.
There is no additional npm dependency for NocoDB.

Installed commands:

- `starforge nocodb-source` — discovery, capture, import, freeze and deployment.
- `starforge nocodb-publisher` — the existing publisher CLI and browser.
- `starforge nocodb-deployment` — the retained release bridge and original console.

The checkout equivalent starts at
[cli.mjs](cli.mjs). Use the full distribution; this directory alone does not
supply the original seller, publisher, release or payment dependencies.

Create an operator directory with mode 0700. Save
[example-source.json](example-source.json) there with mode 0600. Replace its
placeholders with IDs from the existing provider. The server is its original
HTTPS origin, optionally including a fixed reverse-proxy prefix. Local
loopback HTTP is supported; another private HTTP server requires the explicit
`connection.allowHttp: true` choice.

The saved token reference is an environment variable name, such as
`NOCODB_READ_TOKEN`. Supply the existing token through the normal host secret
mechanism. It needs access to the selected base and read access to records,
tables and fields. Full view enumeration can be unavailable in some editions;
an existing view ID is an explicit source selection. A table-only source uses
`viewId: null`. There is no automatic fallback to a broader table when a
selected view or credential is unavailable.

Discover actual IDs and native types without reading records:

```sh
starforge nocodb-source discover --source /private/nocodb/source.json
```

For discovery, `queries` may be an empty object, and the source order may
still contain its placeholder field ID. The result lists the selected table,
field IDs, titles, native types and available view summaries. Replace the
order with actual stable unique identity field IDs before capture. The generated-ID
hint in discovery does not identify external primary keys. Actual returned
id_fields supplies those keys; capture requires every observed native primary-key
field in sourceOrder and directs public primary-key selections to $recordId. Data reads
use explicit ascending/descending source order, even when a view has its own
display order.

## Define the public contract

Each named query maps public aliases to exact provider field IDs. Field
titles can change without silently redirecting the mapping to another column.
The `providerType` is the actual native field type from discovery, not a
requested conversion. The dataset type and encoding must also match every
observed value.

```json
{
  "queries": {
    "catalog": {
      "columns": {
        "record_id": {
          "source": "$recordId",
          "type": "string",
          "encoding": "identity-text"
        },
        "title": {
          "source": "ACTUAL_TITLE_FIELD_ID",
          "providerType": "SingleLineText",
          "type": "string"
        },
        "price_text": {
          "source": "ACTUAL_PRICE_FIELD_ID",
          "providerType": "Decimal",
          "type": "string",
          "encoding": "number-text",
          "nullable": true
        }
      }
    }
  }
}
```

The IDs above are placeholders. Do not use them as a source fixture or claim
they identify a real provider table.

| Declaration | Result |
| --- | --- |
| `source: "$recordId"` | Reads the v3 root record identity. Primary keys are separate from `fields`; a compound identity remains the provider's exact escaped string. |
| `type: "string", encoding: "native"` | Requires actual JSON text. Leading zeros, date strings, timezone notation and numeric-looking text remain unchanged. |
| `type: "integer"` | Requires a safe integer whose original numeric value survives conversion exactly. |
| `type: "number"` | Requires a finite, exactly round-trippable JSON number. |
| `type: "string", encoding: "number-text"` | Preserves the original JSON number token, including long decimal digits, exponent and scale, as dataset text. It does not accept a numeric-looking string. |
| `encoding: "identity-text"` | Preserves a root string identity or the exact root number token as text. |
| `type: "boolean"` | Requires an actual JSON boolean. |
| `nullable: true` | Accepts an explicit JSON null; the default rejects null. |
| `empty: "null"` | Converts an actual empty string to null and requires nullable:true. |
| Default `empty: "preserve"` | Keeps empty text. Use a non-nullable text dataset column when empty and null must remain distinct in the original CSV format. |

A missing field always fails, even when nullable. This matters for views,
which can hide selected fields. An absent field is not evidence that its
underlying value is null.

Text, numeric, boolean and temporal native fields can be explicitly selected.
Derived Formula/Lookup/Rollup/Barcode/QrCode fields require the same declared
scalar type and value-by-value validation; their display settings do not
authorize coercion. Structured fields such as JSON, MultiSelect, Attachment,
Geometry and user objects are not accepted by this scalar adapter. Link and
LinkToAnotherRecord fields are also excluded: the provider can truncate their
nested records without a continuation. Their partial contents must not become
a supposedly complete paid dataset.

Every capture requests the union of explicitly selected source fields.
Unselected source values are not fetched into the data pages. Full private
table metadata is retained to bind the source schema. Public aliases, buyer
filters, ranges and sorts are selected again in the original publication plan.
At least one actual public field is required in addition to any record identity.

## Complete original capture

Inspect the local declaration without a provider request:

```sh
starforge nocodb-source inspect --source /private/nocodb/source.json
```

Capture the selected real table/view/filter:

```sh
starforge nocodb-source capture \
  --source /private/nocodb/source.json \
  --out /private/nocodb/capture-001
```

The output directory must be new; its parent must already be private. The
operation reads:

1. The actual v3 table metadata.
2. The actual count for the same view and explicit filter.
3. Every page from the original records endpoint, following its actual next URL.
4. The closing count with the same selection.
5. The closing table metadata.

It retains each original response byte-for-byte. A complete manifest appears
only after the original counts equal the number of unique captured native
identities, the final page has no continuation, the selected schema is stable,
and every declared projection passes value checks. Duplicate record identities,
missing fields, changed native types, changed continuation selection, partial
pages, incomplete reads and count changes fail the capture.

The source is an observed paginated read, not a database transaction. Equal
counts and stable metadata cannot prove that no row was updated during the read.
The manifest records its actual observation interval and
`atomicSourceSnapshot: false`. Publication then freezes the retained result
as an immutable buyer snapshot.

Pagination preserves the reviewed origin, reverse-proxy path, base, table,
view, filter, field IDs, field-ID result mode and JSON sort. The current original
paginator carries the resolved page size and can serialize fields as repeated
query keys; those forms are handled. The final response may omit next or set it
to null. The adapter does not guess the end from a short page, make a past-end
probe, accept a foreign URL, or silently remove a view/filter.

The default request interval is 250 ms. Requests are sequential; redirects and
automatic retries are disabled. The source declares page, row, byte and timeout
limits. The maximum aggregate retained source is 256 MiB, with a 16 MiB limit
per response. Choose sufficient full-job resources and source limits for the
actual table. An exceeded limit fails the complete capture instead of publishing
a truncated result.

A failed capture keeps already received original files and a private
`incomplete.json` with its request/error state. It has no complete capture
manifest and cannot be imported or frozen as a finished observation. Review the
failure and make a new complete observation; do not splice pages from separate
observation windows into the original one.

## Freeze or receive a capture

Bind a complete original capture to a private source:

```sh
starforge nocodb-source freeze \
  --source /private/nocodb/source.json \
  --capture /private/nocodb/capture-001/capture.json \
  --out /private/nocodb/frozen-source.json
```

This makes no provider request. Reopening verifies the capture manifest,
every original response hash and byte count, source selection, page sequence,
counts, schema and record identities.

An authorized existing provider host can run the same capture implementation
and transfer its complete private capture directory through the established
custody path. Import that exact capture without changing its provenance:

```sh
starforge nocodb-source import \
  --source /private/nocodb/source.json \
  --capture /private/received/capture.json \
  --out /private/nocodb/import-001
```

Import retains the original provider manifest and response files unchanged.
It is a receiving operation, not a new GET or a claim about when that receiving
host contacted the provider. There is no raw-row shortcut that invents metadata,
provider URLs, counts or capture history.

## Publish through the original browser and CLI

```sh
starforge nocodb-publisher serve \
  --workspace /private/nocodb/publications --create \
  --source /private/nocodb/frozen-source.json \
  --state /private/nocodb/dataset --port 8462
```

Open the printed local URL. Inspect the named query and source hash, save the
public dataset plan, choose explicit extraction order, extract and inspect the
candidate, record its responsible reviewer, then publish with that exact review
identity. The original SQLite history, workspace lease, target revision checks
and dataset version writer remain authoritative.

A saved plan copies all original capture files into its own private directory,
so the completed plan can reopen after the original intake directory moves.
The runtime source hash, plan digest and source/capture identity remain bound.
Only public projected scalar values enter the candidate CSV.

The complete existing CLI is also available:

```sh
starforge nocodb-publisher --help
starforge nocodb-publisher status --workspace /private/nocodb/publications
starforge nocodb-publisher template --workspace /private/nocodb/publications \
  --query catalog --out /private/nocodb/plan.json
```

Edit the original template's default string types to the reviewed declaration.
The native save/extract/inspect/review/publish/recover commands retain their
existing argument forms. See the original
[publisher guide](../postgres/publisher/README.md) and
[schedule guide](../postgres/publisher/SCHEDULES.md).

The source order governs provider pagination. The publication order governs the
retained CSV, with nulls last and original capture order as the tie breaker.
These are separate explicit choices. Date strings and text-encoded decimals
retain the original dataset's text comparison behavior; a numeric range requires
a numeric dataset column.

A REST-backed plan makes a new full capture for a new scheduled extraction.
A frozen-source plan deliberately reuses its saved capture. Scheduling a frozen
plan does not convert it into a live source. Set the extraction timeout to cover
all real pages; the shared plan allows up to 300,000 ms.

## Merchant MCP and customer deployment

Bind the existing publisher in the original private connection:

```json
{
  "schema": "stellar-forge.merchant-publisher-connection.v1",
  "workspaces": {
    "catalog": {
      "label": "NocoDB catalog",
      "kind": "nocodb",
      "directory": "/private/nocodb/publications"
    }
  }
}
```

The original merchant publisher tools list/open/source, save/extract/inspect,
review/publish/recover, schedule, buyer preparation and close now select this
driver. A host configuration selects the source kind and paths; MCP arguments
cannot choose a provider URL, executable module or token.

After a lost extraction reply, use the same original run UUID and plan.
After a lost publication reply, inspect and recover that original publication.
Close the existing browser or MCP owner before reopening the same workspace
from another process; there is one native workspace lease.

Continue a reviewed publication with the complete
[deployment and customer guide](DEPLOYMENT.md). It prepares the existing
five-file SF82 dataset package, stages through the original release store,
and opens the original release console with retained client exports.
The original buyer offer, request cursor and snapshot pinning remain in force.

## Failure recovery

| Observed result | Continue through the original operation |
| --- | --- |
| 401 | Check the existing token, expiry, project scope and selected base. |
| 403 | Check current role and required read scopes. |
| 404 / 422 | Review actual base/table/view/field IDs and provider version. Do not erase the view/filter to make the request succeed. |
| 429 | Follow actual Retry-After and provider guidance before a new capture; no automatic quota purchase or repeated request loop. |
| Count or schema change | Preserve the failed capture; review stable ordering and concurrent source changes, then capture a new observation. |
| Unsafe number | Select explicit number-text and a Text dataset column if exact digits must be retained. |
| Missing projected field | Review view visibility and source selection. Nullability does not convert absence to null. |
| Lost plan/extraction reply | Inspect the original plan/run; the existing MCP extraction replay uses the same UUID without a new provider call. |
| Lost publish reply | Recover the original candidate and actual target revision. |
| Lost package/stage reply | Inspect the same package/release ID; identical-input recovery completes the original retained work. |

## Primary provider contract

The implementation was based on the current published
[v3 OpenAPI specification](https://nocodb.com/apis/v3/swagger-v3.json),
[REST API guide](https://nocodb.com/docs/product-docs/developer-resources/rest-apis),
and the original
[upstream paginator](https://github.com/nocodb/nocodb/blob/ba068da3/packages/nocodb/src/helpers/PagedResponse.ts)
and
[v3 record serializer](https://github.com/nocodb/nocodb/blob/ba068da3/packages/nocodb-sdk/src/lib/v3/record-transform.ts).

The retained specification observed on 2026-10-12 was 669,984 bytes with
SHA-256 ac144bee5a391326598e9e1a0b18833d18c87b04dff196db07d07dfa4bd65681.
That is the API contract reference, not a running-service version or a completed
customer capture. An actual provider installation and its returned responses
remain the source of each native observation.
