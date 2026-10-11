# Sheet Best source and publisher

Turn a selected Sheet Best connection and tab into a retained, reviewed dataset
using the original Stellar Forge seller publisher. This adapter supplies source
intake, explicit scalar projection and response retention. The original
publisher supplies its browser, SQLite history, saved plans, extraction
operations, candidate review, versioned publication, schedules and buyer
preparation. It creates no second publisher database or payment path.

## Existing connection and private setup

Use the full maintained source or installed distribution on Linux with Node
22.16 or later and util-linux `flock`. The adapter adds no npm dependency. Its
publisher uses the existing seller modules and dependencies; copying this
directory alone does not install the full product.

Installed entries are `starforge sheetbest-source` and
`starforge sheetbest-publisher`. The source checkout equivalent is:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sheetbest/cli.mjs --help
```

Create a private operator directory (0700). Copy
[example-source.json](example-source.json) into it as a private file (0600).
Replace the placeholder UUID with the UUID from an existing Sheet Best
connection. Choose the exact tab name, or `tab: null` for the connection's
default tab. Null omits the tab path; it is not a tab name.

```json
{
  "schema": "stellar-forge.sheetbest-source.v1",
  "connectionId": "00000000-0000-0000-0000-000000000000",
  "tab": "Catalog",
  "valueMode": "strings",
  "connection": {
    "kind": "rest",
    "apiKeyEnv": "SHEETBEST_API_KEY",
    "maxResponseBytes": 67108864,
    "timeoutMs": 30000
  },
  "queries": {
    "catalog": {
      "columns": {
        "id": { "source": "ID", "type": "string" },
        "name": { "source": "Name", "type": "string" },
        "price": { "source": "Price", "type": "number" },
        "available": { "source": "Available", "type": "boolean" }
      }
    }
  }
}
```

The UUID above is a placeholder, not a working connection or supplied account.
Put the existing connection's key in the configured host environment variable
using the normal secret-delivery mechanism. Only the variable name is saved.
Omit `apiKeyEnv` only when that connection requires no key. Declarations and
captured records remain private even for a publicly readable connection.

## Public projection and exact values

Each named query maps public aliases to exact response keys. Only selected
aliases enter the public dataset. Other fields remain in the private captured
response and never enter the published CSV or schema. A declaration allows up
to 32 named queries, each with up to 64 unique fields.

| Choice | Meaning |
| --- | --- |
| `valueMode: "strings"` | Request normal parsed string values; this is the default. |
| `valueMode: "raw"` | Explicitly request `_raw=1`; JSON scalar types must match the declaration. |
| `type: "string"` | Preserve text, including leading zeros, long IDs and exact decimal text. |
| `type: "integer"` | Require a safe integer; string mode requires plain canonical integer text. |
| `type: "number"` | Require finite numeric text or a raw JSON number. Use text when original decimal digits or scale must remain exact. |
| `type: "boolean"` | Require exact `"true"` or `"false"` in string mode, or a JSON Boolean in raw mode. |
| `nullable: true` | Accept JSON null. The default rejects null. |
| `empty: "null"` | Convert empty text to null; requires `nullable: true`. |
| `empty: "preserve"` | Preserve empty text in a non-nullable string column. The original CSV format uses an empty field for null. |

A missing response key is an error, including for nullable columns. A renamed
header therefore requires a reviewed mapping change. Currency symbols, localized
thousands separators, dates and arbitrary words are not silently coerced.
`00017` and `9007199254740993` remain exact as strings. Numeric declarations
intentionally convert values; keep exact financial decimal text as strings.

Source queries accept no arbitrary URL, SQL or provider filter. Their original
publication plans select public columns, buyer filters, ranges and sorts.
Extraction order is explicit, with nulls last and the original record order as a
stable tie breaker.

## Capture and retain once

Inspect a REST declaration without contacting the provider:

```sh
starforge sheetbest-source inspect --source /private/sheetbest/source.json
```

Capture the selected tab in one read:

```sh
starforge sheetbest-source capture \
  --source /private/sheetbest/source.json \
  --out /private/sheetbest/capture-001
```

The output directory must be new and its parent private. The command makes one
GET to `https://api.sheetbest.com/sheets/{connectionId}`, optionally followed by
`/tabs/{tab}`, with `_format=records` and optional `_raw=1`. It sends
`X-Api-Key` only for the declared environment reference. It does not follow
redirects, write to the sheet, retry automatically or buy quota.

A successful capture saves the original bytes as `records.json` and a private
`capture.json` with the exact binding, capture time, row count, byte count,
SHA-256, format and transport. A short allowlist retains observed response
headers, including sheet-size and rate-limit metadata. Those headers do not
establish database isolation or prove the sheet did not change while being read.

This driver accepts one complete records array up to 64 MiB and one million
records. A smaller response limit may be declared. It does not assemble
independent paginated requests into a claimed single observation. Oversized or
invalid responses fail rather than publishing the first page.

Bind the saved response into a reviewed source without another GET:

```sh
starforge sheetbest-source freeze \
  --source /private/sheetbest/source.json \
  --capture /private/sheetbest/capture-001/capture.json \
  --out /private/sheetbest/frozen-source.json
```

Opening the frozen source checks its manifest hash, records hash and size,
record count, connection UUID, exact tab and value mode. Saving a publication
plan copies the complete capture into that plan's private directory. That saved
plan no longer depends on the original capture's path and makes no provider GET.

An operator who already obtained the original response bytes can import them:

```sh
starforge sheetbest-source import \
  --source /private/sheetbest/source.json \
  --response /private/sheetbest/original-records.json \
  --out /private/sheetbest/import-001
```

Imports retain `transport: "operator-import"` and `method: "IMPORT"`. Their
timestamp describes intake, not an observed live provider request. The operator
must bind the actual file to its correct connection, tab and value mode. They
use the same frozen source and publisher workflow.

## Original browser and CLI publication

Create a publisher with a REST declaration or frozen source:

```sh
starforge sheetbest-publisher serve \
  --workspace /private/sheetbest/publications --create \
  --source /private/sheetbest/frozen-source.json \
  --state /private/sheetbest/dataset --port 8458
```

Open the printed loopback URL and complete the existing workflow:

1. Inspect the source hash and named projection.
2. Save a plan with matching column types, public fields, filter/range/sort
   choices, explicit row order and extraction limits.
3. Extract the saved plan and inspect the typed candidate.
4. Record the responsible reviewer and a useful note for that exact candidate.
   Initialize only an absent target; bind a refresh to the actual snapshot and
   revision of a running target.
5. Publish with the returned review UUID. The original version store governs
   retained generations, revision checks and recovery.

The existing local operator browser retains its local-origin/write checks and
kernel workspace lease. Stop it before opening the same workspace in another
CLI or MCP process. Reopen without `--create`; the saved source and target
bindings remain unchanged.

The source command also delegates the complete publisher CLI:

```sh
starforge sheetbest-source publisher --help
starforge sheetbest-publisher status --workspace /private/sheetbest/publications
starforge sheetbest-publisher source --workspace /private/sheetbest/publications
starforge sheetbest-publisher template --workspace /private/sheetbest/publications \
  --query catalog --out /private/sheetbest/plan.json
```

The original generic template begins with string columns. Edit them to match
the reviewed declaration and choose the dataset name, public query fields and
extraction order. Use its native `save`, `extract`, `inspect`, `review` and
`publish` commands; `--help` lists their exact required arguments.

See the original [publisher guide](../postgres/publisher/README.md) for shared
candidate, version, target control, buyer and lifecycle behavior. This source's
display name and workspace schema are Sheet Best; the engine remains the
original publisher.

## Refresh, interruption and recovery

A REST declaration is suitable for future scheduled reads. Each successful
extraction retains its full response before creating a candidate. A frozen
declaration deliberately reuses the saved capture; enabling a schedule does not
turn it into a live source.

The original [schedule workflow](../postgres/publisher/SCHEDULES.md) binds a
reviewed plan, reference run, row-count policy and exact target snapshot/revision.
Its reads use this driver's explicit source binding, types and provider limits.
Select the interval using the existing account's quota.

| Result | Action |
| --- | --- |
| HTTP 401 / `SHEETBEST_AUTH_REQUIRED` | Check the existing connection and current key environment reference. |
| HTTP 402 / `SHEETBEST_PROVIDER_QUOTA_EXHAUSTED` | Review actual quota or wait for its normal reset; no quota is purchased. |
| HTTP 429 / `SHEETBEST_RATE_LIMITED` | Follow the observed Retry-After and actual provider limits. |
| Interrupted, oversized or non-JSON response | Inspect the failed native run. No successful partial candidate is published and no automatic retry is sent. |
| Missing header or changed scalar type | Review the source/mapping and save a new plan; old plans remain immutable. |
| Lost extraction reply | Read the original run ID. MCP replays the same UUID/plan without another source request. |
| Lost publication reply | Run the original `recover` for that run against the actual target before another publication. |
| Target revision changed | Inspect its current snapshot/revision and review the candidate again. |
| Workspace already open | Continue through that running owner or stop it before opening the same directory. |

Publication writes only through the original local seller version controller.
This adapter never writes to Sheet Best or its spreadsheet.

## Original merchant MCP integration

Create and save the publisher once, then close its browser. Declare it in the
existing private merchant publisher connection:

```json
{
  "schema": "stellar-forge.merchant-publisher-connection.v1",
  "workspaces": {
    "catalog": {
      "label": "Sheet Best catalog",
      "kind": "sheetbest",
      "directory": "/private/sheetbest/publications"
    }
  }
}
```

Use the original merchant MCP initializer and `publisherConnection` setting.
Its existing list/open/source, plan/extract/inspect/review/publish/recover,
schedule and buyer operations then use this same native workspace. Host paths
and credentials stay host configuration. No parallel store or scheduler is added.

The optional original publisher `--seller` and `--resource` select an existing
running seller for buyer offers. Review the actual offer before preparing the
original buyer configuration. Preparation is not signing, payment or customer
acceptance.

## Module API and provider contract

Installed exports are
`@tokenjunkielabs/starforge-merchant/seller/sheetbest`,
`/seller/sheetbest/capture`, `/seller/sheetbest/declaration` and
`/seller/sheetbest/publisher`.

- `readSheetBestSourceFile`, `inspectSheetBestSource` and
  `openSheetBestSourceFile` handle declarations and typed extraction.
- `fetchSheetBestRecords`, `retainSheetBestCapture`,
  `importSheetBestCapture` and `readSheetBestCapture` handle response custody.
- `openSheetBestPublisher` opens the original publisher model.

Programmatic extraction needs an `onRow` consumer and explicit order. It checks
the full response and projection before yielding rows, then returns the selected
capture identity. Closing a source aborts its work. Closing the publisher drains
or cancels its original active operation and releases its lease.

Primary provider documentation:

- [GET records and tabs](https://docs.sheetbest.com/docs/guides/crud-get/)
- [API-key authentication](https://docs.sheetbest.com/docs/guides/auth-api-keys/)
- [Formats and raw values](https://docs.sheetbest.com/docs/reference/formats/)
- [Headers and quota](https://docs.sheetbest.com/docs/reference/headers/)
- [Pagination](https://docs.sheetbest.com/docs/guides/pagination/)

The observation is one retained REST records response. Database transactions and
Google CellData remain the distinct source contracts of their original drivers.
