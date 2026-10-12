# Ocean and environmental data

This workbench turns an explicit ERDDAP grid or station-table selection into a saved native dataset, a versioned merchant release and a complete customer receiving packet. It keeps the provider's original responses, reviewed mapping and useful output together.

The operator searches a provider catalogue, selects fields and fixed bounds, reviews the actual values, units, quality flags and license, then saves an edition. A later source can be compared through the same mapping. The customer imports the complete original packet and rebuilds the same dataset with the existing SF30 engine.

## Open the workbench

The maintained merchant distribution supplies the command:

~~~sh
starforge erddap --workspace /private/ocean-workspace init
starforge erddap --workspace /private/ocean-workspace serve \
  --connection-file /private/ocean-connection/startup.json
~~~

The selected workspace and connection-file parent are private directories owned by the operator. The server prints its current local URL. Open that URL in the browser; its fragment is the private capability for this running workspace. The server binds loopback and checks the current origin and capability on API requests. Restarting the same workspace refreshes only a startup record already belonging to it.

For a source checkout, set ERDDAP to the absolute directory containing this README and use the original entrypoint:

~~~sh
node "$ERDDAP/cli.mjs" --workspace /private/ocean-workspace init
node "$ERDDAP/cli.mjs" --workspace /private/ocean-workspace serve \
  --connection-file /private/ocean-connection/startup.json
~~~

The installed package retains the surrounding original SF30 runtime and Python XML workspace. Python 3.10 or later, SQLite and the package's supported Node runtime are required. The Python adapter uses the standard library. The Node engine uses the installed merchant package's declared dependencies. Set SF30_ERDDAP_PYTHON or CODEX_PRIMARY_RUNTIME_PYTHON when selecting a particular Python executable; the Node entrypoint passes its actual executable to the original engine.

In Managed Applications, choose **Ocean and environmental data**, select that same initialized workspace and optionally its private connection file, then use the existing Start/Open/Stop controls. Startup is checked against the actual listener's workspace, instance and start time. The Applications host owns its normal lifecycle.

## Receive a source or choose a provider request

The workbench accepts a complete .erddap.zip source capture. It also makes actual requests to a selected ERDDAP provider:

1. Open the catalogue and enter the provider's HTTPS /erddap URL.
2. Search or enter an exact dataset route. Inspect its original info JSON, DDS and DAS before selecting data.
3. For a grid, select variables and every DDS axis in original dimension order. Choose fixed values or fixed indices and an explicit stride. Descending coordinate values are valid when that is the provider's original index order.
4. For a station table, select exact variables and explicit constraints. String and time constraints remain distinguishable. Any requested orderBy uses selected original fields.
5. Review the decoded request, save it, then acquire the selection. The browser retains the acquisition operation ID and request before sending.
6. Inspect the completed original JSON/CSV pair, row count, actual coordinates, missing values, quality attributes and source license.

A griddap value selector asks ERDDAP for its nearest available coordinate. The workbench displays the coordinates actually returned; a requested value does not replace the original coordinate. Fixed timestamps and bounds make later source comparisons intelligible. No moving last/now selector, hidden observation cap, interpolation or implicit quality filter is added.

The provider route and publisher identifier are distinct. For example, NOAA's route jplMURSST41 carries the publisher identifier MUR-JPL-L4-GLOB-v04.1. Source inspection retains both.

### Complete public NOAA source acquisition

The maintained source collector captures two useful original selections from CoastWatch:

| Selection | Original source | Explicit request |
|---|---|---|
| MUR sea-surface temperature grid | griddap/jplMURSST41 | analysed_sst, analysis_error, mask and sea_ice_fraction; June 1–3, 2025 at 09:00 UTC; the stated latitude/longitude grid with stride 2 |
| NDBC station observations | tabledap/cwwcNDBCMet | station 46042, June 1, 2025 UTC; station, coordinates, time, WD, WSPD, WVHT, ATMP and WTMP |

Run the collector once on the selected HTTP-capable host and retain that output directory:

~~~sh
python3 -B "$ERDDAP/delivery/acquire_noaa.py" --out /private/noaa-capture
~~~

It produces mur-sst-june-2025.erddap.zip, ndbc-46042-june-2025.erddap.zip and capture-result.json after the actual responses complete. It retains partial responses and their original receipts. Repeating the same command reuses byte-verified completed responses and continues the same selected requests.

Each source ZIP contains exactly six root members: manifest.json, metadata.json, dataset.dds, dataset.das, data.json and data.csv. The manifest records the complete selection, exact request URLs and each response's actual status, receipt, byte count and SHA256. Publication or customer use should carry the complete file and its current source/license records.

The concrete request URLs and upstream serialization contract are listed in [PRIMARY_SOURCES.md](PRIMARY_SOURCES.md). The collector reports actual returned counts; this guide does not substitute an expected grid size for an executed provider response.

### Recover an interrupted acquisition

Use the original operation, including an overridden label:

~~~sh
starforge erddap --workspace /private/ocean-workspace operation --id ORIGINAL_OPERATION_ID
starforge erddap --workspace /private/ocean-workspace acquire \
  --query ORIGINAL_QUERY_ID --operation ORIGINAL_OPERATION_ID --label "Original saved label"
~~~

The operation read validates its retained request.json and exposes request.queryId and request.label. Use those values after a lost response or loss of browser storage. An original request can precede its SQLite index after a crash; the same read exposes that request-only checkpoint. A different request cannot reuse the operation ID. A provider error retains its actual status and Retry-After for the operator's continuation.

## Review the scientific values and save an edition

Every source keeps the complete original number tokens, strings, nulls, types, units, attributes, flag masks/values/meanings, fill/missing metadata and source history. NOAA ERDDAP already serializes destination values; this adapter does not apply a second scale/offset conversion.

The default mapping uses native strings for numeric tokens. This preserves a decimal such as 0.10000000000000001 instead of rounding it through a binary floating-point conversion. Selecting native number/integer is an explicit reviewed conversion through the original native parser. Nullable source text uses JSON-cell encoding so null and an empty string remain distinct.

The source review compares JSON and CSV according to the actual upstream writers: UTF-8 JSON, ERDDAP's original numeric/null behavior, ISO-8859-1 separated values, original names/units rows and source string escaping. The default csvPolicy requires an equivalent pair. A deliberate canonical-json mapping retains an unequal original CSV response and makes that difference visible while selecting JSON as the data basis.

A mapping binds provider, dataset route, protocol, selected columns, native aliases/types, keys, filters, ranges, sorts and limits. It is immutable once saved. Edition comparisons use explicit unique keys and exact projected cells. The grid's original coordinate tuple is the proposed key. For tables, station/time is proposed only when those original fields are present and suitable; duplicates require an operator decision.

CLI equivalents:

~~~sh
starforge erddap --workspace /private/ocean-workspace source-add \
  --file /private/noaa-capture/mur-sst-june-2025.erddap.zip --label "MUR June 2025"
starforge erddap --workspace /private/ocean-workspace mapping \
  --source SOURCE_ID --out /private/mur-mapping.json
starforge erddap --workspace /private/ocean-workspace save-mapping \
  --input /private/mur-mapping.json
starforge erddap --workspace /private/ocean-workspace build \
  --source SOURCE_ID --mapping MAPPING_ID
starforge erddap --workspace /private/ocean-workspace native-query \
  --build BUILD_ID --params '{"limit":"50"}'
~~~

The original engine supplies field selection, configured filters/ranges/sorts and cursor pages. Pass native parameters as strings. The complete build retains the actual projected data.csv, dataset.json, original rows index, source, mapping, native snapshot and review.

To compare a later complete capture, build it with the same reviewed mapping, then:

~~~sh
starforge erddap --workspace /private/ocean-workspace compare \
  --before ORIGINAL_BUILD_ID --after LATER_BUILD_ID
starforge erddap --workspace /private/ocean-workspace changes \
  --id COMPARISON_ID --offset 0 --limit 100
~~~

Follow nextOffset through the original change pages. A source refresh may change values, add/remove observations or leave them unchanged. Original response preparation times alone do not constitute a changed scientific value. Distinct providers or incompatible mappings remain separate products.

## Give a customer the complete source and edition

Export the selected full packet and import it in an independent saved workspace:

~~~sh
starforge erddap --workspace /private/ocean-workspace export \
  --build BUILD_ID --out /private/delivery/mur-edition.erddap.zip

starforge erddap --workspace /private/customer-ocean init
starforge erddap --workspace /private/customer-ocean receive \
  --file /private/delivery/mur-edition.erddap.zip
starforge erddap --workspace /private/customer-ocean native-query \
  --build BUILD_ID --params '{"limit":"50"}'
~~~

The packet contains the complete original ERDDAP capture, reviewed mapping, data.csv, dataset.json, review.json and manifest.json. Receiving validates the exact members and original source/mapping identities, then rebuilds through the same SF30 native engine. The reconstructed dataset, snapshot and output files must match the selected edition.

Repeated export from the same workspace uses its retained exact packet bytes. An interrupted original ZIP publication is adopted only after every current source/mapping/native member matches. The standalone native receiving entrypoint below checks complete cursor output and closes/reopens the receiving workspace.

## Publish and maintain a native merchant

Export the complete native dataset first:

~~~sh
starforge erddap --workspace /private/ocean-workspace export-dataset \
  --build BUILD_ID --out /private/mur-native-dataset
~~~

This directory contains data.csv, dataset.json and erddap-lineage.json. Lineage binds the provider route, publisher metadata, selected request, complete source response identities, exact mapping, original engine and snapshot.

Use the original merchant public-terms JSON for the actual selected Stellar payment asset, amount and receiver. The adapter passes it unchanged to the original seller compiler.

~~~sh
starforge erddap merchant prepare \
  --dataset /private/mur-native-dataset \
  --payment /private/original-public-terms.json \
  --origin https://data.example.org --path /ocean/mur \
  --out /private/mur-release

starforge erddap merchant inspect --release /private/mur-release
starforge erddap merchant serve --release /private/mur-release \
  --state /private/mur-seller-state --port 8423 \
  --facilitator https://your-original-facilitator.example
~~~

Use the existing TLS/reverse-proxy deployment for the declared public origin. An explicitly selected loopback facilitator uses --allow-local-facilitator. The original seller reports its actual mode and retains payment/admission/control behavior.

A later edition uses the same project mapping, public route and payment terms. Prepare its release, inspect the actual seller status, then publish with both original concurrency checks:

~~~sh
starforge erddap merchant status --state /private/mur-seller-state
starforge erddap merchant publish --release /private/mur-later-release \
  --state /private/mur-seller-state \
  --expect CURRENT_SNAPSHOT --expect-revision CURRENT_REVISION
~~~

The original version store serializes publication. Retention limits, cached versions, memory/row limits, request admission and drain grace remain original seller controls. A stale snapshot/revision returns the native conflict for review. Selecting a retained previous edition uses merchant activate with the same expected snapshot/revision. merchant collect performs the original retention collection.

## Original SF88 customer offer, acquisition and accounting

Read the actual live fixed-edition offer:

~~~sh
starforge erddap buyer offer --release /private/mur-release \
  --seller https://data.example.org --query '{"limit":"50"}'
~~~

Review the returned actual offer and accepted payment option, then save its exact native buyer configuration:

~~~sh
starforge erddap buyer prepare --release /private/mur-release \
  --seller https://data.example.org --query '{"limit":"50"}' \
  --intent ORIGINAL_INTENT_ID --accept-index ACCEPTED_OPTION_INDEX \
  --offer-sha ACTUAL_OFFER_SHA256 --out /private/mur-buyer.json
~~~

The preparation rereads the original live offer, pins the selected snapshot and verifies its exact hash. Identical configuration retries reuse the same complete file. Existing buyer setup supplies the operator account and approved reservation policy.

The buyer subcommands init/status/run/recover/export/deliver/accounting/finalize call the original SF88 dataset CLI unchanged. For example:

~~~sh
starforge erddap buyer init --session /private/mur-customer-session \
  --config /private/mur-buyer.json --max-pages 20 \
  --max-total-atomic APPROVED_TOTAL --max-rows APPROVED_ROW_COUNT
starforge erddap buyer run --session /private/mur-customer-session
starforge erddap buyer status --session /private/mur-customer-session
starforge erddap buyer deliver --session /private/mur-customer-session \
  --out /private/customer-delivery
~~~

Continue an interrupted paid page using the same original session and recover. Its original quote review, approval, reservation, signing custody, receipts, accounting and final delivery retain authority. The ERDDAP adapter does not create another financial controller.

## Connect the existing merchant MCP host

The source-owned erddap-workspaces provider adds 36 tools for existing operator aliases, complete catalogue/metadata/query/acquisition/source review, mappings, native builds/queries, edition comparisons and exact file receiving. It borrows the original running HTTP workspace.

Create a private connection JSON using the actual absolute workspace/startup paths and original source-file hashes:

~~~json
{
  "schema": "stellar-forge.erddap-workspace-connection.v1",
  "workspaces": {
    "ocean": {
      "label": "Ocean data",
      "workspace": "/private/ocean-workspace",
      "connectionFile": "/private/ocean-connection/startup.json",
      "inputs": {
        "mur-june": {
          "path": "/private/noaa-capture/mur-sst-june-2025.erddap.zip",
          "kind": "source",
          "label": "MUR June 2025",
          "sha256": "REPLACE_WITH_THE_ACTUAL_COMPLETE_FILE_SHA256"
        }
      }
    }
  }
}
~~~

The placeholder must be replaced with the real 64-character hash before initialization. A customer packet input uses kind packet; a complete provider intake bundle uses kind handoff. Input aliases are selected by the host; a tool caller cannot substitute an arbitrary filesystem path.

In the complete merchant configuration, set erddapWorkspaceConnection to this private file. The original provider registry reads the source-owned distribution contribution automatically. A programmatic original setup helper is also available:

~~~js
import { initializeErddapMerchant } from './mcp-setup.mjs';
await initializeErddapMerchant({
  directory: '/private/ocean-merchant',
  connection: '/private/ocean-connection/workspaces.json',
  name: 'Ocean observations'
});
~~~

Before each request, the client checks the actual listener's instance and workspace through /api/launch. Source pages preserve original numeric lexemes. Collection continuations bind the exact current view. Mutations retain original query/operation/source/build identities.

Large file receiving uses the existing RetainedFileReads interface, complete SHA256 and byte counts, and original offset continuation. Downloaded source, dataset and customer packets remain in the merchant's private exports directory. Closing the borrowed MCP owner drains its accepted calls and readers; the original Application remains under its own lifecycle.

The typed client export is ./client/erddap; merchant/buyer exports are ./seller/erddap and ./buyer/erddap. See [HTTP_API.md](HTTP_API.md) for the full native operator ABI.

## Complete provider intake and receiving

The same saved source now supplies an explicit provider profile, immutable reviewed revisions, readiness findings and complete review/ready bundles. Source-derived fields preserve their original descriptions, units, time representations, station identifiers, masks and license text. The operator reviews contacts, attribution, station context, time conventions and quality definitions before marking a ready bundle. Customer receiving independently verifies the complete retained source and original review; it keeps that handoff separate from the local source/build catalogue.

Use `starforge-merchant erddap provider-handoff --help` or the installed `erddap-provider-handoff` command for the original standalone CLI. The typed `./provider/erddap` client and ten provider MCP methods use the same running ERDDAP HTTP owner. [PROVIDER_CLIENT.md](PROVIDER_CLIENT.md) gives complete original CLI, SDK, MCP and file-receiving instructions. [PROVIDER_HANDOFF.md](PROVIDER_HANDOFF.md) describes the complete station, time, quality, source and readiness rules.

## Whole native and browser receiving

The complete source includes reusable native dataset, provider handoff and browser receiving entrypoints. They consume actual captured source ZIPs and keep their original workspaces and checkpoints through failure.

First, the original native source-to-customer operation:

~~~sh
python3 -B "$ERDDAP/delivery/native-receive.py" \
  --source-root "$ERDDAP" --operation-root /private/erddap-operation \
  --source-packet /private/noaa-capture/mur-sst-june-2025.erddap.zip \
  --source-packet /private/noaa-capture/ndbc-46042-june-2025.erddap.zip
~~~

It imports complete originals, proposes the explicit lexical mapping, builds through the original engine, reads every native cursor page, exports seller datasets and complete customer packets, then independently reconstructs and closes/reopens each received edition. Actual same-mapping source pairs also produce the full original comparison. native/native-result.json records the actual results and source/engine identities.

Then run the existing browser owner on that same now-closed workspace:

~~~sh
python3 -B "$ERDDAP/delivery/browser-owner.py" \
  --source-root "$ERDDAP" --operation-root /private/erddap-operation \
  --workspace /private/erddap-operation/workspace
~~~

The browser owner uses the selected Node/Playwright/Chromium environment. It owns one page/context, the original operator and one independent customer receiver. It operates real source upload, reviewed mapping, build/native cursor query, preserved drafts, edition comparison, source/native/project downloads and customer receiving, then reopens the closed receiving workspace.

Set CODEX_PRIMARY_RUNTIME_NODE and CODEX_PRIMARY_RUNTIME_NODE_MODULES to the existing installed runtime. ERDDAP_CHROMIUM_EXECUTABLE selects the existing Chromium binary. A selected --temporary-root moves only this invocation's transient native/browser scratch to that volume; all input packets, original workspaces, outputs and checkpoints remain under the retained operation root. --screenshots records optional browser views in the private operation.

Continue the same command and operation directory after a concrete failure. Original completed output identities are checked before reuse. The drivers do not repeat provider acquisition or issue a paid customer request.

### Complete retained NDBC provider receiving

For the exact retained NOAA NDBC station 46042 selection on 1 June 2023, the provider entrypoint runs the original dataset receiving operation and continues through the complete saved provider review:

~~~sh
python3 -B "$ERDDAP/delivery/provider-native-receive.py" \
  --source-root "$ERDDAP" --operation-root "$PROVIDER_OPERATION" \
  --capture "$NDBC_2023_CAPTURE" --ndbc-2023-reference
~~~

Select NDBC_2023_CAPTURE as the complete original five-response capture ZIP. The reference recipe verifies all five original response hashes, the 144 selected rows, the nine original columns and station/time selection before preparing its profile. It retains the exact public technical contact, source licensing and processing history. It leaves the separately appointed scientific contact for the provider to supply.

The same entrypoint first completes the original native dataset build, full cursor read and independent customer reconstruction. It then saves two source-bound provider review revisions, recovers the exact saved request, exercises the original stale-parent conflict, exports both complete review bundles and independently receives and reopens their original bytes. A ready export follows the actual core review. The direct profile is retained as handoff-profile.json; provider-native/provider-result.json records the returned disposition and complete original artifacts.

The browser continues that same closed workspace and profile:

~~~sh
python3 -B "$ERDDAP/delivery/browser-owner.py" \
  --source-root "$ERDDAP" --operation-root "$PROVIDER_OPERATION" \
  --workspace "$PROVIDER_OPERATION/workspace" \
  --handoff-profile "$PROVIDER_OPERATION/handoff-profile.json"
~~~

Use Playwright 1.51 or later for the original IndexedDB draft-recovery phase. For another actual source, supply its complete reviewed direct profile with --profile instead of selecting the NDBC reference recipe. Keep the original operation directory across interruption: the helper retains its source, request, native workspaces, profile and accepted export/receiving checkpoints.

## Source, rights and operating limits

[PRIMARY_SOURCES.md](PRIMARY_SOURCES.md) records the original NOAA endpoints, ERDDAP writer/version identities and scientific semantics used by this adapter. Read the actual retained source license, attribution, restrictions and history for the selected dataset. NOAA hosting does not erase third-party notices carried by the dataset.

Retained source ZIPs are limited to 256 MiB, and customer packets to the original 512 MiB cap. Mapping limits constrain projected bytes, rows and cell size. Full source parsing retains the selected table in memory; choose source bounds that fit the actual host. The UI exposes limits and all original rows rather than silently truncating the scientific dataset.

Keep private workspace/startup files, MCP connection files, source-access credentials and buyer accounting custody outside customer source exports. The portable customer packet contains the selected original scientific data and its full source/mapping/native lineage.
