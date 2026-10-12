# Connected Systems observations

Discover an approved OGC API Connected Systems endpoint, retain an exact selected JSON observation window, review its schema and mapping, and build a queryable SF30 dataset. The same application exports a complete source-and-edition packet that another installation can reconstruct with the original native engine. A source-specific merchant and buyer bridge use the existing SF30 versioned seller and SF88 buyer operation.

This directory extends the maintained sibling [XML workspace](../xml/workspace.py). It uses the original dataset engine, immutable source and mapping identities, native cursor, edition comparison and independent receiving. It has its own acquisition records and source parser. Read [HTTP_API.md](HTTP_API.md) for the local API and [PROVIDER_CLIENT.md](PROVIDER_CLIENT.md) for the merchant, buyer and MCP connection.

## What an operator receives

The operator follows one workflow:

1. Save a connection to an authorized source and browse its systems, datastreams and original JSON documents.
2. Select the literal datastream, its declared observation schema and an explicit observation query. Review the time window, page/row/byte limits and source rights.
3. Acquire complete response pages. The original requests, returned bodies, safe HTTP headers, timestamps and hashes remain attached to the operation, including provider failures.
4. Review schema fields, units, reference frames, quality values, original times and repeated observation IDs. Choose the columns and coverage policy.
5. Save the mapping and build a native edition. Query its original snapshot and cursor, compare compatible editions, and export the native CSV/configuration with its source lineage.
6. Transfer the complete project packet. The receiver rebuilds the original projection and verifies the native snapshot and files, then queries and reopens it independently.
7. Where applicable, prepare a versioned merchant release and review a live buyer offer through the existing payment workflow.

The application issues read-only provider GETs. Its JSON observation profile covers inline results and retained external-result links; it does not download the linked binary result. It does not issue connected-device commands, open MQTT/WebSocket subscriptions, convert units, infer quality thresholds, interpolate values, or claim general OGC conformance certification. Source/schema constraints remain available for review; the consumer checks its supported JSON shape and the explicitly selected native mapping.

## Runtime and installation

Use a complete source checkout or an installed merchant distribution that declares the `connected-systems` contribution. Keep the directory structure intact. The source depends on the existing sibling `xml/workspace.py`, `xml/xml_source.py` and `xml/native.mjs`, plus that engine's declared SF30 dependency closure.

Python supplies the source parser, SQLite workspace and local HTTP operator. Node runs the original SF30 dataset engine and merchant/MCP modules. Install the dependencies declared by the selected repository/distribution through its existing installer and lockfile; an unrelated global `node_modules` directory is not an equivalent dependency selection.

The supported runtime selectors are:

| Selector | Purpose |
| --- | --- |
| `SF30_CONNECTED_SYSTEMS_PYTHON` | Python executable used by the Node command. |
| `CODEX_PRIMARY_RUNTIME_PYTHON` | Existing runtime Python fallback for that command. |
| `SF30_XML_NODE` | Node executable used by the original native dataset engine. |
| `CODEX_PRIMARY_RUNTIME_NODE` | Existing Node selected by the browser owner. |
| `CODEX_PRIMARY_RUNTIME_NODE_MODULES` | Existing Playwright installation for the browser continuation. |
| `CSAPI_CHROMIUM_EXECUTABLE` | Explicit existing Chromium executable for that continuation. |

The browser continuation needs Playwright and its compatible installed browser. Ordinary source acquisition, native editions and CLI receiving do not need Playwright.

From the repository root:

```sh
CSAPI="$PWD/stellar/scf-starforge-20261009/sf30-seller-sdk/connected-systems"
CSAPI_WORKSPACE="$PWD/private-csapi-workspace"
node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" init
node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" state
```

The maintained distribution also exposes the `connected-systems` command. Its arguments after that command are the same as those after `cli.mjs` above.

## Open the local operator

```sh
node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" serve \
  --host 127.0.0.1 --port 0 --connection-file "$PWD/csapi-startup.private.json"
```

The command returns the actual private local URL. Open that URL to use the Discovery, Sources, Mapping, Editions, Receive and Activity views. Keep the full fragment-bearing URL and startup file private. The server's authenticated `/api/launch` response exposes the instance/workspace identity without the capability.

An open operator owns its workspace. Use the UI or the borrowed HTTP/MCP client while it is running. Stop that owner before opening the same workspace with a separate direct CLI process. Closing an MCP borrower drains that client's requests; it does not stop the original operator.

## Save a provider connection and exact query

The files in `examples/` are configuration templates, not captured public data. Replace the endpoint and literal resource identifiers with an approved source. The template rights fields are deliberately unknown until reviewed.

A connection contains:

```json
{
  "name": "Reviewed environmental source",
  "baseUrl": "https://example.invalid/connected-systems/",
  "allowedOrigins": [],
  "authorizationEnv": null
}
```

Save it through the UI or the CLI:

```sh
node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" connection-save \
  --input ./reviewed-connection.json --out ./saved-connection.json
```

The result's `id` identifies the complete normalized connection. HTTPS is required for remote providers; HTTP is accepted only for loopback. Additional public linked-resource origins must be explicitly declared. Optional provider authentication names an existing host environment variable containing the complete Authorization header value. The value is read only at request time, is never returned or stored, and is never forwarded to another origin.

A saved acquisition query binds the connection ID and these fields:

```json
{
  "schema": "stellar-forge.connected-systems-query.v1",
  "connectionId": "REPLACE_WITH_SAVED_CONNECTION_SHA256",
  "name": "Reviewed observation window",
  "datastreamUrl": "datastreams/REPLACE_WITH_LITERAL_ID",
  "schemaUrl": "datastreams/REPLACE_WITH_LITERAL_ID/schema",
  "observationsUrl": "datastreams/REPLACE_WITH_LITERAL_ID/observations",
  "systemUrl": null,
  "params": [
    {"name": "phenomenonTime", "value": "REPLACE_WITH_REVIEWED_PROVIDER_TIME_INTERVAL"},
    {"name": "limit", "value": "100"}
  ],
  "limits": {"maxPages": 20, "maxRows": 2000, "maxBytes": 16777216},
  "rights": {"license": null, "attribution": null, "usage": null, "sourceUrl": null},
  "obsFormat": "application/json"
}
```

Use the provider's actual supported time filter and format. Query parameters are an ordered array of string pairs so repeated provider parameters and their order remain explicit. The consumer adds `obsFormat=application/json` to the schema URL when absent, and, for a collection, a visible page `limit` when none was selected. Inspect the returned normalized query before acquiring it.

```sh
node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" query-save \
  --input ./reviewed-query.json --out ./saved-query.json

node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" acquire \
  --query QUERY_SHA256 --operation environmental-window-001 \
  --label "Reviewed environmental window"

node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" operation \
  --id environmental-window-001
```

`QUERY_SHA256` is the saved query's actual `id`. Save the operation ID before sending. Reusing that ID with the same query and label resumes or returns the original operation; different input conflicts. A new intended acquisition uses a new explicit operation ID, while the earlier response pages and source remain retained.

Discovery retrieves one full page per browse operation. Follow its actual `nextUrl` with another explicitly named discovery operation. Acquisition follows the selected observation collection's original JSON `links` chain itself.

## Coverage, schemas and original values

An acquisition reports one of two coverage states:

| State | Meaning |
| --- | --- |
| `exhausted` | The selected query's returned page chain ended without a next link. This does not claim all provider history or an atomic database snapshot. |
| `page-limit` | The explicitly selected page bound was reached and the exact next URL remains available. It is a partial window requiring an explicit mapping decision. |

The consistency label is `sequential-pages-not-transactional-snapshot`. Complete pages are retained in their original order. A response that would exceed the selected row or byte capacity fails with its original evidence retained; it is not silently sliced into a successful capture. The schema is fetched before and after the observation pages. Its canonical identity must agree before the source can be published.

The default mapping requires exhausted coverage. For an intentionally bounded sample, explicitly set `coveragePolicy` to `allow-partial` in the mapping and preserve that choice in the receiving/browser command. Changing this choice produces a different mapping identity.

Original JSON number spellings remain lexical tokens in the source parser. Source previews identify this representation explicitly. The full raw response is always authoritative for original JSON types and encoding. The default mapping includes the complete observation as a JSON cell, original ID/result time, explicit optional-value representations and available scalar result fields. It preserves quality flags, units, reference frames, external links and unfamiliar fields in the original source.

Mappings use exact JSON pointers. The three encodings have different meanings:

| Encoding | Meaning |
| --- | --- |
| `plain` | A reviewed scalar projection. A nullable column explicitly represents absent/null values as an empty native cell. |
| `json` | A present JSON value serialized without numeric float conversion. |
| `presence-json` | `{"present":false}` for absent data, or `{"present":true,"value":...}` for a present value, including null. |

The schema inspector walks native SWE DataRecord/Vector components and returned JSON Schema properties. It keeps arrays, choices, references and unfamiliar schema fields as declared source data. It does not fetch arbitrary external schema references.

Every original observation must retain nonempty string `id`, `datastream@id` and `resultTime`, belong to the selected datastream, and contain exactly one of `result` or `result@link`. Optional phenomenon time remains its original string. Missing required source fields are reported; the consumer does not substitute invented timestamps or identifiers.

Repeated and conflicting observation IDs remain in the captured source and projected rows. Default edition keys are selected only when the actual IDs are unique. A keyed comparison requires a reviewed unique key; there is no hidden deduplication.

## Build, query and compare native editions

```sh
node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" mapping \
  --source SOURCE_SHA256 --out ./mapping-proposal.json

# Review the full proposal, including types, keys and coveragePolicy.
node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" mapping-save \
  --input ./reviewed-mapping.json --out ./saved-mapping.json

node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" build \
  --source SOURCE_SHA256 --mapping MAPPING_SHA256 --out ./native-build.json

node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" query \
  --build BUILD_SHA256 --params '{"limit":"100"}'
```

The query returns the original SF30 HTTP result, dataset snapshot, fields, rows and `page.nextCursor`. Follow that cursor with the same immutable build and string-valued query parameters. A server error, incomplete cursor traversal or changed snapshot is not a completed receiving result.

Each build binds the source SHA, normalized mapping SHA, native snapshot and exact file hashes. A revised query produces another retained source; a revised mapping produces another plan. Earlier editions remain queryable. Compatible keyed editions can be compared through `compare --before BUILD --after BUILD`, then paged with `changes --id COMPARISON --offset 0 --limit 50` or exported with `changes-file`.

The Activity view exposes original request recovery and the complete retained inventories. Its eight collections use view-pinned paging:

```sh
node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" records \
  --collection operations --offset 0 --limit 100 --out ./operation-page-0.json

node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" records \
  --collection operations --offset 100 --limit 100 \
  --expected-view-sha256 FIRST_PAGE_VIEW_SHA256
```

Use the returned `nextOffset`, rather than assuming a second page exists. A changed collection returns `CSAPI_COLLECTION_CHANGED`; explicitly reopen offset zero to select the new view. The startup state lists only the latest 200 documents and operations with an explicit coverage marker. The records route pages all retained items.

## Export and independently receive

```sh
node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" export \
  --build BUILD_SHA256 --out ./reviewed-window.project.zip

node "$CSAPI/cli.mjs" --workspace "$CSAPI_WORKSPACE" export-dataset \
  --build BUILD_SHA256 --out ./reviewed-window.dataset

node "$CSAPI/cli.mjs" --workspace ./customer-workspace init
node "$CSAPI/cli.mjs" --workspace ./customer-workspace receive \
  --file ./reviewed-window.project.zip
```

The complete project contains exactly:

- `manifest.json`
- `source.connected-systems` — the complete original source ZIP, with the retained internal source filename
- `plan.json`
- `data.csv`
- `dataset.json`
- `review.json`

Receiving validates all member hashes, the source/schema/mapping relationship and the expected native dataset, then rebuilds through the original engine. Its `source` and `plan` return fields are SHA strings; `build` is the full verified native review. The source is independently available in the new workspace. The packet does not transfer provider credentials, browser storage or the private acquisition journal.

Dataset export creates exactly `data.csv`, `dataset.json` and `connected-systems-lineage.json`. The lineage records the source responses, schema identity, selected query/coverage, repeated-ID policy, mapping, native snapshot and original file identities. A merchant series identity binds endpoint, literal datastream ID, schema identity and mapping. A different reviewed mapping or schema therefore cannot silently replace an existing merchant series.

Packet and dataset exports publish complete files before exposing their final names. Matching retries preserve the original bytes; conflicting destinations are rejected. The original packet cache is tied to the completed build and verified before each download.

## Reproduce one complete native receiving operation

The maintained operation command accepts an existing source ID, exact source packet, or saved acquisition query. It uses one explicit operation identity and preserves its outputs and failure progress across restart.

```sh
python3 -B "$CSAPI/delivery/native-receive.py" \
  --source-root "$CSAPI" --operation-root ./environmental-receiving-operation \
  --operation-id environmental-window-001 --workspace "$CSAPI_WORKSPACE" \
  --query QUERY_SHA256 --coverage-policy require-exhausted
```

For a previously captured source, use `--source SOURCE_SHA256` or repeat `--source-packet PATH` instead of `--query`. Optional repeated `--mapping PATH` inputs select reviewed mappings in the same source order. The command compares complete original and customer cursor traversal, retains both project exports, reopens the customer workspace and saves `native/native-result.json`. It starts no seller, buyer or browser.

Continue that same closed original workspace through the visible operator:

```sh
python3 -B "$CSAPI/delivery/browser-owner.py" \
  --source-root "$CSAPI" --operation-root ./environmental-receiving-operation \
  --workspace "$CSAPI_WORKSPACE" \
  --coverage-policy require-exhausted
```

Use `--coverage-policy allow-partial` on both commands only for the already reviewed partial capture/mapping. The browser owner requires the actual completed native build; it performs no replacement acquisition. It retains the original selection and browser checkpoints, exercises source review, interrupted mapping-save recovery, native cursors, exact downloads and a separate customer workspace, then closes the services and reopens through the CLI.

The native and browser result files record what actually completed. Source availability, receipt completeness and a prepared command do not imply that an operation executed successfully.

## Collection and single-resource queries

The query form offers **Collection** and **Single observation**. A collection remains the default and omits `observationResource` from the normalized query, preserving existing collection identities. It follows the provider's original next-page links and records whether the selected window was exhausted or stopped at an explicit page, row or byte bound.

Use `"observationResource": "single"` only when the selected URL returns one original observation JSON object. This explicit mode keeps that object unchanged, fixes `maxPages` to 1, adds no automatic collection `limit`, and rejects a next-page link. Its coverage includes `"scope": "single-observation-resource"`. Exhausted coverage means that one resource was received; it does not mean that a provider's entire observation collection was read. The source badge, saved query, raw file viewer, project packet and receiving inventory retain that distinction.

The operator does not convert an individual object into a fabricated collection response. Both modes retain the actual HTTP body, original observation values and schema.

### Select the exact schema request

Live CSAPI schema endpoints commonly use `obsFormat=application/json`. The default **Format parameter** policy preserves the existing normalized query behavior. For a publisher's immutable static schema file or an already complete schema URL, select **Exact schema URL** instead. The saved query carries `"schemaUrlPolicy": "exact"` and the consumer adds no format parameter. It still validates that the returned schema describes the selected JSON observation representation.

The default or explicitly selected `format-parameter` policy remains omitted from the normalized query, preserving prior query identities. Exact policy is retained in the capture's selection, query drafts and receiving inventory. Changing this choice creates a distinct reviewed query; it never edits an earlier request or its responses.

## Reproduce the committed OGC example

The publisher's [pinned original examples](https://github.com/opengeospatial/ogcapi-connected-systems/tree/fb858be23aa03e2b824ec50b5a97ac2c2a1d3fec) include one room-temperature observation, its datastream, scalar observation schema and thermometer description. They are illustrative publisher examples, not a field measurement or proof that a live demonstration service is operational.

The maintained recipe fetches those exact public resources through the same acquisition journal as any other selected source. It verifies every received body against the committed byte count and SHA256, retains the exact [publisher license](examples/ogc-connected-systems-LICENSE.txt), and uses explicit single-resource receiving. It then runs the original native edition, row cursor, export, independent customer receive, exact packet re-export and cold-reopen workflow.

```bash
export CSAPI="$PWD/stellar/scf-starforge-20261009/sf30-seller-sdk/connected-systems"
python3 -B "$CSAPI/delivery/publisher-example.py" \
  --source-root "$CSAPI" \
  --operation-root ./ogc-room-temperature-reference \
  --operation-id ogc-room-temperature-reference-v1 \
  --node "$(command -v node)"
```

Continue that same closed workspace through the visible operator:

```bash
python3 -B "$CSAPI/delivery/browser-owner.py" \
  --source-root "$CSAPI" \
  --operation-root ./ogc-room-temperature-reference \
  --workspace ./ogc-room-temperature-reference/workspace \
  --coverage-policy require-exhausted
```

The recipe saves `publisher-reference/publisher-acquisition.json`, the original query/source and `native/native-result.json`; its completed `publisher-reference/publisher-result.json` binds those results to the publisher commit and exact native packet. Rerunning a completed stage verifies and returns its retained result. An incomplete stage keeps its selected query, acquisition operation and receiving history. The committed-example recipe also recognizes its earlier failed query with an automatically appended schema parameter: it proves that only that schema selection changed, retains the failed query and original HTTP step, and records both identities in `publisher-reference/exact-schema-query-selection.json` before using the exact static URL. An already completed original acquisition is reused.

The original datastream uses an indoor-temperature label while the supplied thermometer description uses an outdoor label. The datastream also retains the publisher's original result-time interval. The recipe preserves these source inconsistencies and makes no correction or provenance claim beyond the committed example. Source/license identities and the separately observed public-service errors are documented in [SOURCES.md](SOURCES.md).


### Recorded native reference result

The original operation completed on 12 October 2026. The [complete native result](examples/ogc-room-temperature-native-result.json) records one original publisher observation, its native dataset export, independent project receiving, exact packet re-export and a closed-workspace reopen.

| Identity | Recorded value |
|---|---|
| Source packet | `2bdad5aeac5282f6750afd9e9d3b85d9b6e188464cbcf90f9190ba74224c2541` |
| Native build | `c87829609aeeef2790ac7ac91d283b9e0a7590e628c6a747281c886199d66879` |
| Native snapshot | `682277ab88cf03fc229118faca289c61d1f19e05ca3c41403d72991460edb0e0` |
| Portable project | 6137 bytes; SHA256 `976fbe48b0264411d776bb76469bb9fc1e0fd13d6e175c9251f8f45736a19a1a` |
| Receiving scope | One single observation resource; `require-exhausted` within that explicit scope |
| Original result | `23.5`, with the original observation JSON and schema unit retained |


The exact [portable project](examples/ogc-room-temperature.connected-systems.zip) and [original source packet](examples/ogc-room-temperature.connected-systems) are included. To receive the accepted example without contacting the publisher again:

```sh
node "$CSAPI/cli.mjs" --workspace ./ogc-example-customer init
node "$CSAPI/cli.mjs" --workspace ./ogc-example-customer receive \
  --file "$CSAPI/examples/ogc-room-temperature.connected-systems.zip"
node "$CSAPI/cli.mjs" --workspace ./ogc-example-customer query \
  --build c87829609aeeef2790ac7ac91d283b9e0a7590e628c6a747281c886199d66879 \
  --params '{"limit":"1"}'
```

The receiver recomputes the dataset through the installed native engine and checks the supplied expected review. It does not copy a prebuilt SQLite database or call the original provider.

The producer and independent receiver returned the same ordered-row hash and original values. This result covers the committed illustrative resource; it does not claim a complete live sensor collection. Browser and installed-product receiving have separate result records.

## Selected package and installed receiving

The complete [selected-package guide](../../distribution/selections/CONNECTED_SYSTEMS.md) uses the maintained distribution builder and runtime installer. The committed [selection recipe](../../distribution/selections/connected-systems.json) includes the native engine, private Applications operator, merchant MCP family, receiving commands and the exact public example.

After installation, run `delivery/installed-receive.mjs` as described in that guide. It imports the accepted project through the installed CLI and MCP, verifies original rows and complete source/dataset/packet bytes, closes the operator and reopens the same receiving workspace. The completed result records its installation and source identities. Resuming a completed run checks the retained outputs and returns its original result without repeating the journey.

Merchant terms and a buyer offer are optional explicit operator inputs. The reference project supplies neither a payment account nor a dataset price; those stages remain `NOT_RUN` unless the operator selects the original required inputs.

## Retention and errors

The source acquisition journal retains query/request identity, completed pages, progress, safe provider errors and the actual retry deadline. HTTP 429/503 deadlines are retained per connection; retrying before the deadline is rejected locally. There is no automatic account rotation, background acquisition or endless retry.

A failed HTTP response can be inspected through its retained document ID and exact body. A transport failure may leave an incomplete step; reopen the same operation before deciding to retry. A source/schema change rejects final capture publication with the returned evidence preserved.

Workspace sources and editions remain until the operator manages that private workspace. This module does not silently prune them. Size the selected acquisition and storage for complete raw responses, native files, SQLite indexes and customer exports. Merchant version retention has separate explicit controls described in [PROVIDER_CLIENT.md](PROVIDER_CLIENT.md).

## Source and licensing

See [SOURCES.md](SOURCES.md) for the pinned official schemas, source implementation and observed endpoint evidence. This authored module follows the repository's MIT source terms. Upstream OGC schema/document terms and data-provider rights are separate. Public accessibility and a CSAPI conformance declaration do not establish permission to redistribute observations.

No live-public observation capture is embedded in the configuration templates. Include only the actual approved capture and project produced for the selected operation when delivering customer data.
