# Macrobond catalog and series provider

Build a customer-facing economic-data catalog from retained SDMX projects. The operator chooses exact project revisions and series, reviews a candidate edition, saves it, and selects the edition served to customers. The browser, command line, and Macrobond read routes use the same Catalog, source workspace, publication revision, and exact-number serializer.

The included ECB example carries eight reference-rate series and 544 observations for 2025. Its original annual GBP observation remains 0.8567923137255. The saved source packets, metadata, and project revisions remain available alongside the customer-facing series. Original capture identities, coverage and reuse terms are in [the ECB source notes](../examples/ecb-2025/SOURCE-NOTES.md).

## Open the operator

The installed command is:

~~~sh
starforge sdmx macrobond --catalog /absolute/path/economic-catalog init
starforge sdmx macrobond --catalog /absolute/path/economic-catalog serve --port 8844
~~~

For a source checkout, replace the installed prefix with:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sdmx/macrobond/cli.mjs
~~~

The command requires Python 3.11 or later. Set SF30_SDMX_PYTHON to the chosen Python executable when necessary. The Node wrapper supplies the current Node executable to the original SDMX engine and preserves an explicit SF30_XML_NODE selection. Direct Python invocation also accepts SF30_XML_NODE, SF30_SDMX_NODE, or CODEX_PRIMARY_RUNTIME_NODE.

The serve command prints the private operator URL, including its fragment capability. Open that exact URL in the host's browser. To retain the URL privately and print only the listener location, select a ready file:

~~~sh
umask 077
starforge sdmx macrobond --catalog /absolute/path/economic-catalog serve \
  --port 8844 \
  --ready-file /absolute/path/private/macrobond-ready.json
~~~

The ready file identifies the catalog, process, origin, private URL and provider URL. It can be replaced on a later launch only when it is a private ready record for that same catalog. The provider URL is the origin, with a trailing slash; the customer connection XML normalizes this to the origin Host.

For customer Basic authentication, provision the two values through the host's existing secret configuration, then name their environment variables:

~~~sh
starforge sdmx macrobond --catalog /absolute/path/economic-catalog serve \
  --port 8844 \
  --provider-username-env MACROBOND_PROVIDER_USERNAME \
  --provider-password-env MACROBOND_PROVIDER_PASSWORD \
  --ready-file /absolute/path/private/macrobond-ready.json
~~~

Both environment names are required together. Credentials remain in the server process and the customer's Macrobond connection settings. The XML and catalog packets carry no Basic credential values.

## Import an original project and review an edition

The normal input is an original SDMX project packet produced by the neighboring SDMX workspace. The distribution includes the complete retained example at sdmx/examples/ecb-reference-rates.sdmx.zip:

~~~sh
starforge sdmx macrobond --catalog /absolute/path/economic-catalog import-sdmx \
  --file /absolute/path/sdmx/examples/ecb-reference-rates.sdmx.zip

starforge sdmx macrobond --catalog /absolute/path/economic-catalog state
~~~

Read the actual returned project ID and revisions. For the included ECB packet, the retained project is d560804b1f7bc5c59c8cd3f71483247a, revision 2. Its original dataset snapshot is ccd69f17ba77befe3ba5a1f8c6b6460352fb450098469868a17cee0427ee2386.

Create an edition-selection JSON file. A stable operation_id identifies this exact save request. An empty series_keys array selects all series in that explicitly pinned project revision:

~~~json
{
  "operation_id": "ecb-reference-rates-2025-edition-1",
  "title": "ECB reference exchange rates — 2025",
  "notes": "GBP and USD reference rates against EUR; original 2025 published observations.",
  "members": [
    {
      "project_id": "d560804b1f7bc5c59c8cd3f71483247a",
      "revision": 2,
      "series_keys": []
    }
  ]
}
~~~

Use a different operation ID for a materially different selection. Keep the exact same file and operation ID when recovering an uncertain save response.

~~~sh
starforge sdmx macrobond --catalog /absolute/path/economic-catalog preview \
  --file /absolute/path/ecb-edition.json

starforge sdmx macrobond --catalog /absolute/path/economic-catalog save \
  --file /absolute/path/ecb-edition.json
~~~

Preview returns the selected original projects and builds, proposed series, source lineage, observation count and issues. Resolve the displayed issues in the selection or source workspace, then preview that exact selection again. Save returns the retained edition and its series. The edition ID from that response is used for later inspection, publication and export.

Several project revisions can be selected in one edition. Each member remains pinned to its own project ID and revision. For a smaller product, put the exact original series keys into the member's series_keys array before preview.

## Inspect and publish the selected edition

~~~sh
starforge sdmx macrobond --catalog /absolute/path/economic-catalog edition \
  --id EDITION_ID

starforge sdmx macrobond --catalog /absolute/path/economic-catalog series \
  --edition EDITION_ID --query GBP --offset 0 --limit 50

starforge sdmx macrobond --catalog /absolute/path/economic-catalog observations \
  --edition EDITION_ID --series SERIES_ID --offset 0 --limit 50
~~~

The series command returns customer series IDs. Use those IDs for observations and provider queries. The original source series key remains part of the edition's retained selection and lineage.

Publication uses the Catalog's current revision and current edition as an explicit compare-and-swap. Read state immediately before choosing the publication. On a new catalog whose state reports revision 0 and current null:

~~~sh
starforge sdmx macrobond --catalog /absolute/path/economic-catalog activate \
  --edition EDITION_ID --expect-revision 0 --expect-current none
~~~

For later changes, use the actual revision and current ID from state. If another operator has changed the publication, inspect the updated state and choose the intended edition again. The CLI keeps the supplied expectations intact.

Customer read requests resolve through the currently selected edition. Saving a new edition retains it for review; the activate operation selects its customer-facing publication.

To compare retained editions:

~~~sh
starforge sdmx macrobond --catalog /absolute/path/economic-catalog compare \
  --before EARLIER_EDITION_ID --after LATER_EDITION_ID
~~~

## Connect the Macrobond client

Generate the configuration file using the customer-visible provider origin:

~~~sh
starforge sdmx macrobond connection \
  --host https://economics.example.org \
  --out /absolute/path/macrobond-provider.xml
~~~

This command does not open a Catalog. The same XML can be downloaded from the original operator's connection screen. An identical existing output is recovered; different existing content is preserved and reported as a conflict. Use a new path when intentionally producing a different connection.

The emitted document follows the original provider namespace and Host element:

~~~xml
<?xml version="1.0" encoding="utf-8"?>
<web:WebApiSeriesProvider xmlns:web="http://schemas.mbnd.eu/2019/webapiseriesprovider">
  <web:Host>https://economics.example.org</web:Host>
</web:WebApiSeriesProvider>
~~~

In Macrobond, open Configure → Settings → My series and add a database of type Web API. Enter its Name, Prefix and configuration-file path. When the provider uses Basic authentication, enter the corresponding Username and Password in these client settings. Save the settings, then find the database through Analytics → Browse and the database selector. Later edits to the XML require restarting the client. These are the original client's setup steps documented in the [official provider guide](https://help.macrobond.com/apis-feeds-connectors/web-api-series-provider/) and the [maintained sample](https://github.com/macrobond/client-webapi-sample/tree/9ee0f59a36b8c1224e0e9af3414cf1f982a1b761).

The Host should be the provider origin for this server, such as https://economics.example.org. The server exposes the original named read methods at that origin. The local /provider/ paths remain equivalent aliases for existing direct callers.

## Serve customer reads over HTTPS

Run the original operator server on its loopback listener and put a TLS reverse proxy in front of the customer methods. Macrobond's official guide recommends HTTPS when using Basic authentication. Preserve the customer's query string and Authorization header, and use the original upstream Host expected by the local server, for example 127.0.0.1:8844.

The public proxy allowlist is exactly these GET paths:

| Public path | Catalog read |
| --- | --- |
| /getcapabilities | Advertised provider features |
| /loadseries | Selected series and exact observations |
| /loadmeta | Series metadata |
| /searchseries | Search the published series |
| /loadtree | Browse the published catalog |
| /listseries | List series for a selected browse location |

All six routes pass through the same configured Basic authentication boundary. Keep the private operator page, assets and /api routes on the host's private listener. The selected publication can then be reviewed and changed locally while customers use the stable HTTPS origin.

A reverse proxy must preserve repeated query fields. In particular, multiple requested series use repeated n fields. The Catalog determines the advertised read capabilities, and the public method set is shared with the server's root-route allowlist.

## Read the original wire response from the CLI

The provider command runs the same Catalog method and exact-number JSON serializer used by HTTP. It is useful for inspecting the current published catalog while preparing a customer connection:

~~~sh
starforge sdmx macrobond --catalog /absolute/path/economic-catalog provider \
  --command getcapabilities

starforge sdmx macrobond --catalog /absolute/path/economic-catalog provider \
  --command searchseries --params '{"query":"GBP"}'

starforge sdmx macrobond --catalog /absolute/path/economic-catalog provider \
  --command loadseries --params '{"n":["SERIES_ID"]}'
~~~

Use a JSON array for repeated n values; use scalar values for query and reference. The serializer writes finite Decimal values as JSON numbers. The underlying source retains the exact original decimal strings and the saved editions retain their source selections, so a customer's read can be traced back through the same project revision.

## Export an edition and reopen it on another host

~~~sh
starforge sdmx macrobond --catalog /absolute/path/economic-catalog export \
  --edition EDITION_ID \
  --out /absolute/path/ecb-macrobond-catalog.zip

starforge sdmx macrobond --catalog /absolute/path/receiving-catalog init

starforge sdmx macrobond --catalog /absolute/path/receiving-catalog import \
  --file /absolute/path/ecb-macrobond-catalog.zip

starforge sdmx macrobond --catalog /absolute/path/receiving-catalog state
~~~

Export returns the packet path, byte count, SHA-256 and edition identity. Retain that result with the delivered packet. Import uses the original retained source closure and edition records. Inspect the receiving state and use its actual current ID and revision when selecting the customer publication.

Original SDMX receiving binds the exact CSV, schema, native snapshot and semantic observations. Its SQLite query index is rebuilt on the receiving host. Local ready files, private operator capability URLs and provider credentials remain host settings.

## Continue the native browser receiving operation

The maintained receiving owner runs the original server and browser together in one process tree. Use an existing closed Catalog and its original SDMX project packet:

~~~sh
python3 -B "$MACROBOND_SOURCE/delivery/browser-owner.py" \
  --source-root "$MACROBOND_SOURCE" \
  --operation-root "$NATIVE_OPERATION" \
  --catalog "$ORIGINAL_CATALOG" \
  --project-packet "$ORIGINAL_ECB_PACKET"
~~~

MACROBOND_SOURCE is this macrobond source directory. NATIVE_OPERATION is the private directory retaining the same native operation; ORIGINAL_CATALOG is its already-created Catalog; ORIGINAL_ECB_PACKET is the original retained SDMX packet. Close the ordinary operator serving invocation before this receiving command opens that Catalog.

Select the existing Node executable with CODEX_PRIMARY_RUNTIME_NODE, the directory containing the installed playwright package with CODEX_PRIMARY_RUNTIME_NODE_MODULES, and Chromium with MACROBOND_CHROMIUM_EXECUTABLE or SDMX_CHROMIUM_EXECUTABLE. The owner preserves an explicit SF30_XML_NODE or uses the selected Node. Optional paired --provider-username-env and --provider-password-env selects existing reader credentials; otherwise the owner configures a private reader for this operation. Optional --screenshots retains the desktop and narrow-screen inspection images.

Optional --temporary-root EXISTING_VOLUME places the owner's private Chromium and service scratch on that writable volume. The owner creates and removes its own temporary directory there; saved Catalogs, exports, results and continuation state stay under the persistent operation root. For a host with persistent /dev/shm and process-private /dev, use --operation-root /dev/shm/f1cb-macrobond-operation with --temporary-root /dev. Keep the Catalog on the persistent path so the next executor invocation can reopen it.

The browser uses the actual original operator to import the source, save and recover exact edition requests, move from all eight series and 544 observations to the four USD series and 272 observations and back, inspect provider responses, export the catalog, and receive the exported edition through the second operator UI. It adds two UI editions and three publication events to the original Catalog, with the starting and ending publication revisions retained in its result.

The command writes its public outcome and completed-phase checkpoints under NATIVE_OPERATION/browser. The adjacent ready.private.json contains the private capability URLs. Reuse the same operation directory and Catalog when continuing an interrupted run; completed phases are recovered from those original records. One browser lifetime owns the two serving processes, and each server is closed before its Catalog.

## Command reference

Put --catalog before the command for every operation that opens a Catalog.

| Command | Required arguments | Result |
| --- | --- | --- |
| init | --catalog | Catalog and original source workspace |
| state | --catalog | Sources, projects, editions and current publication |
| import-sdmx | --file | Original retained SDMX project |
| preview | --file | Selected project revisions, series and review issues |
| save | --file | Retained edition under its stable operation_id |
| edition | --id | One saved edition |
| series | --edition | Paged customer series; optional query, offset and limit |
| observations | --edition, --series | Paged original observations |
| activate | --edition, --expect-revision, --expect-current | Reviewed current publication |
| compare | --before, --after | Retained edition comparison |
| export | --edition, --out | Catalog packet identity and source closure |
| import | --file | Receiving Catalog state |
| provider | --command | Original provider wire JSON; optional --params |
| serve | Optional port, paired credential-env names, ready-file | Original operator and provider listener |
| connection | --host, --out | Exact XML; use --out - for stdout |

A CLI invocation owns one Catalog. The serving invocation drains accepted server requests before closing that Catalog; SIGINT and SIGTERM follow the same shutdown path. Temporary native stderr and SQLite spill use an explicitly selected private writable runtime directory or the catalog's own private tmp directory. Stable save IDs, explicit publication expectations and retained output hashes make interrupted operations recoverable through their original records.

