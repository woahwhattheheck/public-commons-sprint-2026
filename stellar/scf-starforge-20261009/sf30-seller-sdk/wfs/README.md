# WFS feature desk

The WFS feature desk takes an advertised WFS 2.0 service through source review, a saved feature selection, complete acquisition, comparison, publication and customer receiving. The installed command is `starforge wfs`. The same project is available in the industrial browser, Applications and the original merchant MCP host.

Every order retains its actual GetCapabilities document, DescribeFeatureType schema, request selection, raw response pages and acquisition history. A publication contains the complete selected dataset and its original source copies. Customers can receive the feature rows, the full source edition, or a portable project that reopens offline with the original IDs and history.

## Open a project

Use a private directory for the project and a separate private directory for exported files. The existing installed package supplies the command and original source engines. XML parsing and source receiving use Python 3.11 or later; `--python` selects an existing executable.

```sh
starforge wfs init --project /srv/wfs/parcels --name "Regional parcels"
starforge wfs show --project /srv/wfs/parcels
starforge wfs serve --project /srv/wfs/parcels \
  --connection-file /srv/wfs/operator/parcels-connection.json
```

The browser command prints one compact startup record containing the actual loopback URL, project binding and instance ID. It remains in the foreground. Closing the command drains its owned source work, customer operations and browser listeners. The connection file is bound to the selected project and operator configuration; restarting that same selection records the new instance while retaining the previous one.

Applications registers **WFS feature workspaces** through the original `wfs-geoserver` provider, order 366. Select the existing project directory, optional source-auth and Buyer configuration, existing Python and any merchant/facilitator settings. The provider verifies the actual startup and original `/api/launch` response before accepting the window.

`starforge wfs binding` prints the same launch binding without starting the browser. Its options match `serve`: source-auth file, Buyer file, facilitator, merchant port and explicit local-facilitator choice. `--expected-binding-sha256` checks the exact retained selection.

## Discover and review the original service

The following endpoint and feature names are examples. Replace them with the customer's published endpoint and names from the returned source records.

```sh
starforge wfs discover --project /srv/wfs/parcels \
  --id discover-service-1 --revision 0 \
  --endpoint https://geo.example.org/geoserver/wfs --name "Customer feature service"

starforge wfs catalog --project /srv/wfs/parcels \
  --source SOURCE_SHA --offset 0 --limit 100

starforge wfs capabilities-file --project /srv/wfs/parcels \
  --source SOURCE_SHA --out /srv/wfs/exports/GetCapabilities.xml

starforge wfs describe --project /srv/wfs/parcels \
  --id describe-parcels-1 --revision 1 \
  --source SOURCE_SHA --type-name customer:parcels

starforge wfs schema --project /srv/wfs/parcels --schema SCHEMA_SHA
starforge wfs schema-file --project /srv/wfs/parcels \
  --schema SCHEMA_SHA --out /srv/wfs/exports/DescribeFeatureType.xsd
```

Use the returned source and schema IDs in later commands. Catalog pages include their total and next offset. The schema must describe the qualified feature type and namespace selected from those retained capabilities. The service must advertise a supported JSON feature representation and the chosen coordinate system.

A source endpoint is an HTTPS URL without a query, credentials or fragment. The provider builds the actual WFS request. An explicit `--allow-loopback` discovery permits the supported local source route when an operator is commissioning an existing local service.

`--terms-file` records the supplied source terms beside the discovery. Keep customer source permissions and published license information with that original source review.

### Source access

`--source-auth /srv/wfs/operator/source-auth.json` selects the original environment-backed source authorization interface. It supports one explicit binding per origin:

```json
{
  "schema": "stellar-forge.wfs-source-auth.v1",
  "bindings": [
    {
      "origin": "https://geo.example.org",
      "scheme": "Bearer",
      "tokenEnv": "CUSTOMER_WFS_TOKEN"
    }
  ]
}
```

For an API key use `scheme: "ApiKey"` with `apiKeyEnv`. For Basic authorization use `scheme: "Basic"` with `authorizationEnv`; that environment value is the complete existing Basic authorization header. Keep those values in the operator's environment and select the private configuration when running discovery, schema capture, orders, resume or the browser. The original source interface checks the selected origin for every authorized request.

## Save the complete feature selection

A query binds the source, schema, qualified type, exact coordinate representation, stable sort and any bounding box or source filter. Save this JSON as a private operator input:

```json
{
  "version": "2.0.0",
  "typeName": "customer:parcels",
  "srsName": "urn:ogc:def:crs:EPSG::4326",
  "pageSize": 1000,
  "sortBy": [
    {"property": "parcel_id", "direction": "A"}
  ]
}
```

The feature type, sort property and coordinate system must come from the actual service. Include its unique key in the sort when available. A bounding box uses four or six original numeric strings together with an explicit `bboxCrs`. The optional `cqlFilter` is the selected source filter text.

```sh
starforge wfs query --project /srv/wfs/parcels \
  --id select-parcels-1 --revision 2 \
  --source SOURCE_SHA --schema SCHEMA_SHA --name "Parcels edition" \
  --selection /srv/wfs/operator/parcels-selection.json

starforge wfs queries --project /srv/wfs/parcels
starforge wfs order --project /srv/wfs/parcels \
  --id acquire-parcels-1 --revision 3 --query QUERY_SHA --name "First acquisition"
```

Every mutation requires a stable operation ID and the current project revision. Read `show` to obtain the current revision when joining an existing project. IDs contain 1–96 ASCII letters, digits, underscores or hyphens, beginning with a letter or digit. Reusing the same ID with different inputs is a conflict.

An optional `--limits` JSON sets the original acquisition's `pageBytes`, `totalBytes`, `maxPages` and `requestTimeoutMs`. Acquisition retains the accepted prefix and its next request if a provider error, capacity limit or cancellation interrupts it.

### Resume the same order

```sh
starforge wfs show --project /srv/wfs/parcels
starforge wfs resume --project /srv/wfs/parcels --id acquire-parcels-1
```

`resume` reads the saved pending operation, including its action, complete original inputs and expected revision. It invokes that same action. When the original result already committed, it returns that completed result and current revision. A lost reply therefore preserves the same order.

For an order stopped by its declared capacity, pass a reviewed `--limits` file to the same resume command. The saved source selection remains unchanged. Other operation kinds use their retained inputs; a changed selection belongs in a new query and operation.

An operator can explicitly abandon a pending operation using `abandon --id NEW_ID --revision CURRENT_N --pending ORIGINAL_ID --note TEXTFILE`. The short note and original pending progress remain in project history. This allows a deliberate new operation while preserving the old source material.

### Read acquisition coverage and original values

```sh
starforge wfs order-show --project /srv/wfs/parcels --order ORDER_SHA
starforge wfs features --project /srv/wfs/parcels --order ORDER_SHA --offset 0 --limit 100
starforge wfs inspect --project /srv/wfs/parcels --order ORDER_SHA
starforge wfs raw-page --project /srv/wfs/parcels --order ORDER_SHA --index 0 \
  --out /srv/wfs/exports/features-page-000.json
starforge wfs features-file --project /srv/wfs/parcels --order ORDER_SHA \
  --out /srv/wfs/exports/features-complete.geojson
```

The order view reports accepted rows, pages, bytes, next request, completeness, coordinate description and first/last retrieval times. Paging validates explicit WFS 2.0 start indexes and known-total continuity. An unknown total advances to the actual terminal response under the original coverage rules. A failed or rejected response remains part of retained source history.

The read interface displays original numeric lexemes as text; each feature's `featureJson` and the full raw files preserve the original JSON number tokens. The feature download writes the complete GeoJSON with the retained source and coordinate description.

Coordinate representations remain literal. The project keeps the requested `srsName`, returned coordinate metadata and original geometry. Choose the source's advertised axis convention when specifying a bounding box. The desk preserves that representation throughout comparison and delivery.

## Compare editions and publish a dataset

Acquire a later order with a new operation ID. Comparing two complete orders requires the same service endpoint, qualified feature type and literal coordinate representation. Select the actual stable feature key with a JSON pointer.

```sh
starforge wfs compare --project /srv/wfs/parcels \
  --id compare-parcels-1 --revision CURRENT_N \
  --before FIRST_ORDER_SHA --after SECOND_ORDER_SHA --key-pointer /id

starforge wfs comparison --project /srv/wfs/parcels \
  --comparison COMPARISON_SHA --group changed --offset 0 --limit 100

starforge wfs comparison-file --project /srv/wfs/parcels \
  --comparison COMPARISON_SHA --out /srv/wfs/exports/comparison.json

starforge wfs plan --project /srv/wfs/parcels --order SECOND_ORDER_SHA \
  --out /srv/wfs/operator/dataset-plan.json

starforge wfs publish --project /srv/wfs/parcels \
  --id publish-parcels-1 --revision CURRENT_N --order SECOND_ORDER_SHA \
  --plan /srv/wfs/operator/dataset-plan.json
```

The comparison retains added, removed and changed features, duplicate-key groups and missing keys. It also records both selections and retrieval windows so an operator can interpret changes against the actual acquisitions.

The default dataset plan retains feature ID, complete properties and geometry JSON, plus eligible scalar property columns. Review the generated plan before changing its column, filter and sort choices. The original dataset publisher validates the plan and writes the complete dataset, source copies, configuration and export manifest.

`publication --publication PUBLICATION_SHA` inspects the original edition. `publication-open` opens that edition in the original dataset browser and keeps the command alive. Add `--payment PRIVATE_JSON --origin HTTPS --path /features` when publishing with the customer's actual original merchant payment/origin configuration. The selected seller configuration is retained in the publication.

## Serve and receive through the original merchant

```sh
starforge wfs merchant --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --merchant-port 0 --facilitator FACILITATOR_URL
```

The merchant stages the selected edition and serves the existing feature dataset plus a full-project source product. It uses the original SF30 merchant, facilitator and SF88 Buyer contracts. The output identifies the actual URLs, edition and immutable snapshots. The process remains in the foreground until closed.

The source product freezes the complete chosen project at staging time. Its portable bundle contains the original documents, pages, orders, comparisons, publications and full dataset/source files. Source staging admits a complete compact project bundle up to 128 MiB. Larger complete portable handovers can use the separate export/receive interface below.

Inspect the actual offer before creating a purchase:

```sh
starforge wfs preview --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --kind rows --query "limit=10"

starforge wfs prepare --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --intent customer-request-1 \
  --kind rows --query "limit=10"

starforge wfs buy --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --intent customer-request-1 \
  --buyer-config /srv/wfs/operator/buyer.json

starforge wfs recover --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --intent customer-request-1 \
  --buyer-config /srv/wfs/operator/buyer.json

starforge wfs customer-file --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --intent customer-request-1 \
  --buyer-config /srv/wfs/operator/buyer.json \
  --out /srv/wfs/exports/customer-response.json
```

The Buyer file is the customer's existing private configuration. The intent retains the selected request, snapshot and accepted payment alternative. `recover` reconciles that same request through the original engine. An intentional additional purchase uses another intent.

For a complete multi-page dataset, save explicit page, atomic-cost and row budgets:

```sh
starforge wfs dataset-prepare --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --id customer-sources-1 --kind sources \
  --max-pages 100 --max-total-atomic ATOMIC_BUDGET --max-rows 1000000

starforge wfs dataset-create --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --id customer-sources-1 \
  --buyer-config /srv/wfs/operator/buyer.json
starforge wfs dataset-run --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --id customer-sources-1 \
  --buyer-config /srv/wfs/operator/buyer.json
starforge wfs dataset-deliver --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --id customer-sources-1 \
  --buyer-config /srv/wfs/operator/buyer.json
starforge wfs dataset-receive --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --id customer-sources-1 \
  --buyer-config /srv/wfs/operator/buyer.json
starforge wfs customer-reopen --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --id customer-sources-1
starforge wfs customer-open --project /srv/wfs/parcels \
  --publication PUBLICATION_SHA --id customer-sources-1
```

Use the selected offer's actual budget as integer text. The original Dataset engine owns acquisition, accounting, recovery and delivery. `dataset-inspect`, `dataset-recover`, `dataset-accounting` and `dataset-finalize` operate that same saved dataset ID.

`dataset-receive` reconstructs complete source files through the original SF100 delivery projection. `customer-reopen` verifies the original source manifest, every source member and the portable project, then reopens it under the original customer directory. It works from the delivered files. `customer-open` opens that received project in the original browser.

Use `dataset-file` to retain any of the actual delivered `dataset.csv`, `dataset.jsonl`, `review.html`, `manifest.json` or `semantics.json` files. Each full-file read stays bound to the original selected dataset and export.

## Portable project handover

```sh
starforge wfs export --project /srv/wfs/parcels \
  --out /srv/wfs/exports/parcels-project.json

starforge wfs inspect-bundle --source /srv/wfs/exports/parcels-project.json

starforge wfs receive --project /srv/wfs/received-parcels \
  --source /srv/wfs/exports/parcels-project.json --id receive-parcels-1

starforge wfs serve --project /srv/wfs/received-parcels
```

The complete JSON carrier uses `stellar-forge.wfs-project-bundle.v1`. It binds the original project ID, name, revision and exact index bytes; a sorted file inventory retains every selected path, size, SHA256 and complete Base64 payload. Its final bundle hash covers the complete canonical body. An unchanged project and source closure produce the same bundle identity across a process restart.

The default portable capacity is 256 MiB of compact JSON. `--max-bytes` selects an explicit capacity below 512 MiB, with a small encoding reserve. An export exceeding the selected capacity returns an error and retains the original project. The independent source product described above uses its own 128 MiB complete-bundle allowance. The inventory admits at most 100,000 selected files; the source project index is limited to 8 MiB.

Receiving records one private intent, verifies every exact payload and original source binding, and writes the completed receiving record before exposing the original project index. Interrupted extraction or index publication resumes with the same bundle, operation ID and target. A different existing target is preserved.

Replaying a completed receive verifies the retained immutable files and original source readers. Later legitimate customer project revisions and continued partial orders remain intact. The result reports both the bundle's original revision and the current receiving project revision.

The handover includes complete selected publication files and their original seller terms. Keep live Buyer configuration, source authorization and runtime launch settings in the receiving operator's private configuration. The project selects persistent business and source records; merchant working files and earlier nested project bundles remain outside that portable selection.

`project-import --project HOST_PROJECT --source BUNDLE` receives a bundle under the current host project's original received-project directory. `project-open --project HOST_PROJECT --bundle-sha SHA` opens that same received edition.

### Receive an existing source delivery

A customer that already has an original SF100 delivery report or native scan can use the full source receiver directly:

```sh
starforge wfs source-receive --project /srv/wfs/customer-sources \
  --source /srv/wfs/customer-delivery/report.json \
  --capture-manifest MANIFEST_SHA --source-set BUNDLE_SHA

starforge wfs sources-open --project /srv/wfs/customer-project \
  --source /srv/wfs/customer-sources --id receive-customer-1

starforge wfs source-file --source /srv/wfs/customer-sources \
  --file project-bundle.json --out /srv/wfs/exports/customer-project-original.json
```

`--native-scan` accepts the original scan JSON instead of a report. The Python receiver validates source-set identity, the selected publication, exact manifest and all reconstructed file bytes. The original JavaScript portable inspector then validates the full project before reopening. `source-file` also accepts an exact member from the retained project inventory, such as its original capabilities or raw page path.

## Installed API and MCP

The package exposes `@tokenjunkielabs/starforge-merchant/seller/wfs` as the complete public entry point. Individual source, project, portable, merchant, customer, application, workspace, auth and launch modules are also available through their corresponding `/seller/wfs/...` exports.

```js
import {
  exportWfsProject, inspectWfsProjectBundle, receiveWfsProject,
  openWfsApplication
} from '@tokenjunkielabs/starforge-merchant/seller/wfs';

const bundle = await exportWfsProject({ directory: producerDirectory });
const inspected = inspectWfsProjectBundle(bundle);
const received = await receiveWfsProject({
  directory: receivingDirectory,
  bundle,
  id: 'receive-original-1',
  signal
});

const application = await openWfsApplication({ directory: received.directory });
try {
  const state = await application.query('state');
  // Call the original declared action or read against this retained project.
} finally {
  await application.close();
}
```

`inspectWfsProjectBundle` is synchronous. Export and receive are asynchronous. The receiver returns `bundleSha256`, `projectId`, original `revision`, `currentRevision`, `directory` and `reused` along with its original receiving receipt.

`openWfsApplication` provides `query`, `action`, `download`, `cancel` and `close`. Its exported `QUERY_FIELDS`, `ACTION_FIELDS` and `DOWNLOAD_FIELDS` define the exact operator interface. The CLI and browser delegate to those same functions.

The original merchant MCP provider is `wfs-workspaces`, family `wfsWorkspaces`, order 366. It uses the existing private WFS workspace connection configuration and original retained-file reader. The source reader's returned read ID belongs to that host session: continue subsequent chunks with the same current ID, and use the original expected content hash and offset when reconnecting.

Initialize a new native merchant host using an existing private connection selection:

```sh
starforge wfs mcp-init --directory /srv/wfs/native-host \
  --connection /srv/wfs/operator/wfs-workspaces.json
```

The maintained initializer creates the original release store and merchant configuration, or accepts an explicitly selected existing release store through `--release-store`. Repeating the same setup preserves the original configuration and release history.

The complete entry points are defined in [index.mjs](./index.mjs), command arguments in [cli.mjs](./cli.mjs), source rules in [protocol.mjs](./protocol.mjs), and the portable receiving contract in [portable.mjs](./portable.mjs). The [distribution contribution](../../distribution/contributions/wfs-geoserver.json) registers the command, public exports and original providers together.
