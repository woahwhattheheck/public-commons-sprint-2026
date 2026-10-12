# NDJSON source workspace

Operate JSON Lines exports through the original Stellar Forge dataset, merchant and customer SDK. The complete local workflow retains source bytes, inventories every record, saves an explicit exposure policy, builds native datasets, compares keyed editions, and exports a complete merchant.

The source console, CLI and merchant MCP operate the same retained workspace. The NDJSON adapter uses the existing XML workspace's lock, database, immutable build machinery, packet reconstruction and native engine process. XML defaults, file names, schemas and build identities remain unchanged.

## Open the source console

With the installed distribution:

~~~sh
starforge dataset-ndjson --workspace /absolute/private/inventory init
starforge dataset-ndjson --workspace /absolute/private/inventory serve \
  --connection-file /absolute/private/inventory-console.url
~~~

From this source directory, the equivalent entry point is:

~~~sh
node cli.mjs --workspace /absolute/private/inventory init
node cli.mjs --workspace /absolute/private/inventory serve
~~~

Use a new directory for initialization. The workspace is private to its operator and allows one owning process. The console listens on loopback and prints its private URL. Open that URL to authorize the browser. API clients use the same process and lease through its local HTTP interface.

The optional connection file contains the original private URL, including its fragment token. It is created atomically with mode 0600 and never replaces an existing file. Graceful shutdown removes the file only if its bytes still match that process. A restarted console can create the same path; the merchant MCP rereads it when making a request. After an interrupted process, inspect or remove its stale connection file or select a fresh path.

The normal workflow has five stages:

1. **Retain a complete export.** Add an NDJSON or JSONL file and inspect all field paths, type counts, record counts and selected samples.
2. **Choose the exposure policy.** Select the object within each line and exact field paths, representation, null policy and native query capabilities.
3. **Build and query an edition.** The complete projection passes through the original dataset loader. Query its selected fields, equality and range filters, ordering and native cursors.
4. **Review a new edition.** Retain the new export, reuse the same mapping, build, and compare by the explicitly selected unique keys.
5. **Prepare the merchant.** Supply real public payment terms and the public origin. Download the complete prepared merchant and original generated customer SDK, or move the source project to another workspace and reconstruct it.

The interface uses local assets and makes its source operations against its own authenticated loopback server.

## Source format and exact values

Each nonblank physical line must contain one JSON object. A line may end with LF or CRLF; the final line may omit its terminator. UTF-8 is required. One UTF-8 BOM at the start of the file is accepted and inventoried. Blank lines and a BOM remain in the retained original bytes.

The adapter rejects malformed JSON, duplicate object members, non-finite numbers, invalid Unicode scalar values and a non-object top-level record. An actionable error includes the physical line number. Limits are 256 MiB per source, 16 MiB per physical record, 64 levels of nesting, 4,096 distinct inventoried paths and 8 MiB of inventory metadata. Projection has its own explicit byte, row and cell limits. Inventory reads the whole source rather than inferring a schema from a prefix.

JSON numeric tokens are parsed as exact strings before any projection. Thus an identifier such as 9007199254740993 and a decimal such as 0.123456789012345678901 retain every digit when exposed as string columns. JSON mode also preserves numeric token spelling inside nested objects and arrays, including exponent notation and trailing zeros. Retained source files preserve the original whitespace and object representation byte for byte.

An explicit integer column uses the original JavaScript safe integer range. An explicit number column requires a finite number whose decimal value survives conversion through the original engine. If it would change the value, the build reports the field and asks for a string representation. Choose a string type whenever identifiers, monetary precision, significant zeros or exact numerical spelling matter.

## Mapping fields

A mapping is immutable and identified by the SHA-256 of its normalized JSON. Download an editable mapping from the console, or begin with [the inventory mapping](examples/inventory-mapping.json).

| Field | Meaning |
| --- | --- |
| schema | Exactly stellar-forge.ndjson-mapping.v1. |
| name | Human-readable dataset name, up to 128 UTF-16 code units. |
| recordPath | Exact object keys and array indexes selecting one object inside each source line. An empty array selects the root object. |
| columns | One to 64 exposed columns; columns are emitted in this order. |
| filters | Up to eight exposed columns with native exact-equality filtering. |
| ranges | Up to eight string, integer or number columns with native range filtering. |
| sorts | Up to eight columns that customers may order by. |
| keys | Up to eight columns forming the edition comparison key; use nonnullable string, integer or boolean columns, with nonempty unique projected keys. |
| allowEmpty | Explicitly permit a zero-record edition; defaults to false. |
| maxRows | Projection record ceiling, up to 1,000,000; default 250,000. |
| maxBytes | Projected CSV byte ceiling, up to 268,435,456. |
| maxCellChars | Per-cell UTF-16 code unit ceiling, up to 1,048,576; default 65,536. |
| defaultLimit / maxLimit | Original dataset page limits; defaults 50 and 250, with a maximum of 1,000. |

Original native query capabilities share the 32-parameter budget. Each range column exposes four parameters, each equality column exposes one, and any enabled sorting exposes one. The adapter checks that budget before saving a mapping.

Every column has these fields:

| Column field | Meaning |
| --- | --- |
| name | Unique original SF30 identifier; a leading letter and up to 48 letters, digits or underscores. |
| path | Exact keys and nonnegative array indexes relative to recordPath. |
| mode | scalar, json or state; default scalar. |
| type | Original string, integer, number or boolean type; default string. |
| nullable | Whether a scalar column accepts null; default false. JSON and state modes require a nonnullable string. |
| missing | error or null; default error. Missing-to-null mapping requires a matching state column. |

Paths never interpret dots, slashes or stars as expressions. For example, ["data.value"] selects a literal member named data.value, while ["data","value"] descends into two objects. ["items",0,"sku"] selects the first array item's sku. Inventory uses a null path segment to summarize all array members; choose a concrete integer index in a mapping. Selecting a nested object does not flatten or multiply source records.

**Scalar mode** exposes one primitive value. Numbers default to their original token strings; booleans become true/false text unless explicitly mapped to native boolean. Object and array values require JSON mode.

**JSON mode** exposes the complete selected JSON value as a nonnullable string, preserving nested numeric tokens. A JSON null becomes the string null. An empty JSON string becomes the string "". This mode keeps the full selected value's JSON type and is useful for heterogeneous fields.

**State mode** exposes one of missing, null or value for the same exact field path. Use a state column beside any scalar or JSON column that permits a missing field.

The native nullable CSV representation uses an empty cell for null. A nullable scalar string containing an empty source string therefore requires its matching state column. The tuple of value and state preserves all three source states:

| Source | Nullable scalar value | State |
| --- | --- | --- |
| Member absent | null | missing |
| JSON null | null | null |
| Empty JSON string | null | value |
| Other string | Exact string | value |

A nonnullable string preserves an empty source string directly. JSON mode is another useful choice when the exact source type should remain visible in one column.

## Complete CLI workflow

Use [the first example](examples/inventory-first.ndjson), [the next edition](examples/inventory-next.ndjson) and [the mapping](examples/inventory-mapping.json) for a small complete inventory workflow. They include identifiers above the JavaScript integer range, long decimal values, nested JSON, typed quantities and missing/null/empty notes.

Run commands against the same private workspace. Replace SOURCE_ID, PLAN_ID and BUILD_ID with the exact IDs returned by the preceding operations:

~~~sh
starforge dataset-ndjson --workspace /absolute/private/inventory source \
  --file /absolute/inventory-first.ndjson --label "First inventory"

starforge dataset-ndjson --workspace /absolute/private/inventory inspect \
  --source SOURCE_ID

starforge dataset-ndjson --workspace /absolute/private/inventory plan \
  --file /absolute/inventory-mapping.json

starforge dataset-ndjson --workspace /absolute/private/inventory build \
  --source SOURCE_ID --plan PLAN_ID

starforge dataset-ndjson --workspace /absolute/private/inventory query \
  --build BUILD_ID \
  --params '{"where_active":"true","sort":"-quantity","limit":"1"}'
~~~

A CLI command owns the workspace lease for its duration. Stop the browser console before opening the same workspace through a separate CLI process, or use the console's HTTP connection through the merchant MCP to share its live process.

The query result includes the original response status, response body, dataset description and native engine blob identity. Query parameters are scalar strings. Use response.body.page.nextCursor unchanged to read the next page with the same selected fields, filters and order. Native response errors retain their original status and error codes.

Retain the next source, build it with the same mapping, and compare both completed editions:

~~~sh
starforge dataset-ndjson --workspace /absolute/private/inventory source \
  --file /absolute/inventory-next.ndjson --label "Next inventory"

starforge dataset-ndjson --workspace /absolute/private/inventory build \
  --source NEXT_SOURCE_ID --plan PLAN_ID

starforge dataset-ndjson --workspace /absolute/private/inventory compare \
  --before FIRST_BUILD_ID --after NEXT_BUILD_ID

starforge dataset-ndjson --workspace /absolute/private/inventory changes \
  --comparison COMPARISON_ID --offset 0 --limit 50
~~~

The examples produce one added, one removed, one changed and one unchanged record. The reordered unchanged record remains unchanged. Comparison measures exact projected CSV cells, so a change in an exact numeric token remains visible even if a rounded numerical approximation would hide it. A different mapping requires building both editions with that mapping before comparing them.

## Prepare the original merchant and customer SDK

Save the operator's real public payment terms in payment.json. They use the original native seller contract: scheme, network, asset, amount as an exact atomic-unit string, payTo, and maxTimeoutSeconds. The dataset generator and original seller compiler validate these inputs. Use the actual intended origin and route.

~~~sh
starforge dataset-ndjson --workspace /absolute/private/inventory merchant \
  --build BUILD_ID \
  --payment /absolute/private/payment.json \
  --origin https://data.example.com \
  --path /inventory \
  --out /absolute/private/inventory-merchant

starforge dataset-ndjson-merchant status \
  --prepared /absolute/private/inventory-merchant

starforge dataset-ndjson-merchant serve \
  --prepared /absolute/private/inventory-merchant --port 8423
~~~

The output directory must be new. Preparation uses the original buildDatasetSellerConfig, compileSellerRoutes, compileSellerOpenApi and exportSellerClient implementations. The launch command delegates to the original serve.mjs and examples/dataset-application.mjs with that package's dataset config.

A prepared merchant contains:

| Files | Purpose |
| --- | --- |
| source.ndjson / plan.json | Exact original source bytes and immutable normalized exposure policy. |
| data.csv / dataset.json / ndjson-lineage.json | Complete original native dataset and retained build review. |
| payment.json / seller.json | Selected public terms and original seller configuration. |
| openapi.json | Original generated OpenAPI describing the prepared challenge-only configuration. |
| customer/ | Original generated JavaScript client, type declarations, OpenAPI, package metadata, guide and SDK completion manifest. |
| OPERATING.md | Selected source, launch commands, native mode configuration and recovery directions. |
| merchant.json | Complete prepared-file identities, source/build/native snapshot and customer manifest identity. |

The status command checks every declared file and reloads the dataset through the original loader. The serve command performs that inspection before starting the original seller. Original seller controls such as --facilitator, --allow-local-facilitator, --max-in-flight, --drain-grace-ms and --availability-dir remain available. Its config and handler paths come from the prepared package.

The basic launch opens the original challenge-only seller and developer page. Install the original native x402 dependencies and supply the actual configured facilitator to operate native settlement. The running service's /_seller/openapi.json reports its actual mode. Each original paid dataset request returns one page; the customer SDK and original native buyer keep the existing request and settlement behavior.

Keep the full merchant package private. Publish the intended dataset route and original seller metadata through the chosen ingress. Share the generated customer directory when handing the integration to a buyer. Source editions and recovery bundles contain the complete original export, including fields that the exposure policy does not publish.

## Move and recover a retained edition

Export a complete source project ZIP for one-command reconstruction:

~~~sh
starforge dataset-ndjson --workspace /absolute/private/inventory export \
  --build BUILD_ID --out /absolute/private/inventory-project.zip

starforge dataset-ndjson --workspace /absolute/private/restored init
starforge dataset-ndjson --workspace /absolute/private/restored import \
  --file /absolute/private/inventory-project.zip
~~~

The packet contains exactly six root files: source.ndjson, plan.json, data.csv, dataset.json, review.json and manifest.json. Import validates member identities, reconstructs the full projection through the original engine, and requires the same CSV/config hashes and native snapshot as the exported build.

For an existing original seller integration that only needs the native dataset:

~~~sh
starforge dataset-ndjson --workspace /absolute/private/inventory dataset \
  --build BUILD_ID --out /absolute/private/native-dataset
~~~

That directory contains data.csv, dataset.json and ndjson-lineage.json. The complete merchant package also includes source.ndjson and plan.json, so its original source and selected mapping can be re-added to a fresh workspace when the project ZIP is unavailable.

## Local HTTP and merchant MCP contract

The private console origin is printed by serve. It binds to 127.0.0.1. Every API request requires Authorization: Bearer TOKEN from that URL's fragment, an exact local Host, and either no Origin or that process's own origin. POST bodies require one declared Content-Length. The source workspace is never opened by a second MCP process.

| Method | Route | Input / result |
| --- | --- | --- |
| GET | /api/state | Retained source, mapping, build and comparison summaries. |
| GET | /api/source?id=SOURCE_ID | Full retained source inventory and identity. |
| GET | /api/plan?id=PLAN_ID | Normalized immutable mapping. |
| POST | /api/source | Raw source bytes; optional URI-encoded X-NDJSON-Name and X-NDJSON-Label headers. |
| POST | /api/plan | Mapping JSON object. |
| POST | /api/build | JSON object containing source and plan IDs. |
| POST | /api/query | JSON object containing build and a scalar-string query object. |
| POST | /api/compare | JSON object containing before and after build IDs. |
| GET | /api/changes?id=ID&offset=0&limit=50 | Retained comparison page and nextOffset. |
| GET | /api/changes/download?id=ID | Complete changes as JSON Lines. |
| GET | /api/export?build=BUILD_ID | Complete source project ZIP. |
| GET | /api/dataset-export?build=BUILD_ID | Native CSV/config/lineage ZIP. |
| POST | /api/import | Raw complete source project ZIP; reconstructs source, plan and native build. |
| POST | /api/merchant | JSON object containing build, payment, origin and path; downloads the complete prepared merchant ZIP. |

The maintained merchant MCP attaches using a host-configured private console URL or connection file and declared source/packet handles. It composes these same original routes for retained intake, policy review, complete builds, query, comparison, exports and recovery.

## Runtime and source ownership

The launcher selects Python using SF30_NDJSON_PYTHON when supplied, otherwise the original Python discovery. Python 3.11+ and Node 20+ are required. It passes the selected Node executable to the unchanged original native query pipe.

NDJSON parsing has no new package dependencies. It uses Python's standard JSON, decimal, CSV and SQLite facilities through the existing workspace. Merchant generation and launch require the original seller dependency closure delivered by the maintained distribution. The source adapter never fetches external datasets or decides which fields should be published; the selected local export and explicit mapping define the dataset.

## Managed releases and customer receiving

The original retained merchant can now prepare an SF82 dataset release with the complete source, mapping, lineage and matching versioned customer SDK. The original version controller owns initialization, later edition publication, historical activation and restart recovery. Customers receive their original SF88 acquisition and restore the same reviewed source edition into the original NDJSON workspace, with native queries, keyed comparison and original project export. See [release and receiving guide](consumer/README.md) for the complete workflow, APIs and commands.
