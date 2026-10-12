# ArcGIS source to a retained merchant dataset

The ArcGIS adapter imports a selected FeatureServer or MapServer layer into the existing SF30 data publisher. The same publisher owns saved plans, extraction, typed review, dataset versions, schedules, local operator UI and SF88 buyer preparation. The adapter supplies source capture and projection; public queries and payment handling use the existing implementations.

## Start with a live layer

Use Linux, Node 22.16 or later and util-linux `flock`. From the repository or extracted source root:

```sh
export STARFORGE_SOURCE="$(pwd)"
export ARCGIS_JOB="$STARFORGE_SOURCE/arcgis-work"
umask 077
mkdir "$ARCGIS_JOB"
```

Copy the included `example-connection.json` into that private working directory and review its layer and selection. It selects the published UConn Long Island block groups. Run:

```sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  capture --capture "$ARCGIS_JOB/capture" --input "$ARCGIS_JOB/connection.json"
```

The command creates one capture identity before network access. It then retains layer metadata, the selected object-ID response and complete feature pages. If an HTTP request fails or the process stops, keep the same directory and continue it:

```sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  capture-continue --capture "$ARCGIS_JOB/capture"
```

`capture-status` shows retained and pending pages. `--max-pages N` on continuation stops after N complete feature pages, preserving the original selection for the next call. `capture --prepare-only` creates the declaration without making a source request.

The live source uses the original `returnIdsOnly` selection and exact `objectIds` batches. A page reporting `exceededTransferLimit` is split and fetched again; it is never treated as complete merely because the server returned fewer records. Missing selected IDs, duplicates, changed field types, changed coordinate reference or a single truncated feature stop the capture. A completed capture covers its retained object-ID set. Ordinary live requests observe values across responses; they do not assert a database transaction or a historical snapshot.

For a protected service, set `tokenEnv` to an environment variable name in the connection JSON. The token value is read only at request time and sent in the `X-Esri-Authorization: Bearer` header. It is absent from saved source configuration and URLs. The configured layer is fixed, redirects are rejected, and response bytes and deadlines are bounded. Header-token authentication requires an ArcGIS Server version that supports it.

## Use already retained source files

`capture-import` accepts original layer metadata and feature-set JSON files. A saved browser extraction that parsed and serialized JSON should declare `representation: "parsed-json"`; an original HTTP entity body can declare `"wire-json"`. Exact input bytes are retained in the capture, with relative file references and SHA-256 identities. Moving the original input directory afterward does not affect the capture.

For separate full attribute and geometry responses, use the explicit join:

```json
{
  "layerUrl": "https://clear-gis.uconn.edu/arcgis/rest/services/LISS_Fertilizer/Fertilizer_by_BlockGrps/MapServer/0",
  "metadataFile": "layer-metadata.json",
  "pageFiles": ["long-island-attributes.json"],
  "representation": "parsed-json",
  "query": {
    "where": "State = 'New York' AND County IN ('Nassau County', 'Suffolk County')",
    "returnGeometry": true
  },
  "geometryJoin": {
    "field": "GEOID",
    "pageFiles": ["nassau-geometry.json", "suffolk-geometry.json"]
  }
}
```

Paths resolve against the import configuration file. The join preserves all original attributes from the attribute response and takes geometry from the matched geometry response. Join values retain their original text/integer type. Duplicate, missing or extra join keys reject the capture; every overlapping attribute, including OBJECTID when supplied, must agree. The example has one full attribute response and two geometry responses, so neither response is misrepresented as containing the other's fields.

```sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  capture-import --capture "$ARCGIS_JOB/capture" --input "$ARCGIS_JOB/import.json" --prepare-only
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  capture-continue --capture "$ARCGIS_JOB/capture"
```

An imported capture's selection kind is `IMPORTED_FEATURE_SETS`: it covers the exact supplied files and their observed records. The declared source `where` remains lineage; the import does not independently prove a server-wide query census. Imported pages that report a transfer limit are rejected.

## Select the public columns

Use `example-columns.json` to select the native object ID, GEOID, county, town, published model class and original annual nitrogen delivery/reduction fields, plus the complete captured attributes and geometry:

```sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  source-create --capture "$ARCGIS_JOB/capture" --query blocks \
  --columns "$ARCGIS_JOB/columns.json" --out "$ARCGIS_JOB/source.json"
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  serve --workspace "$ARCGIS_JOB/publisher" --create \
  --source "$ARCGIS_JOB/source.json" --state "$ARCGIS_JOB/dataset"
```

Open the printed loopback address. The existing UI displays the source selection, native column types and geometry reference. Select exposed columns and allowed filters/ranges/sorts, save the plan, extract, inspect the candidate, record the review, and publish. The first publication initializes the existing dataset version store. Later publications use the displayed current snapshot and revision.

Each saved plan pins both the original source configuration and complete capture digest. The source capture is immutable after completion. For a refreshed service observation, create a new capture and source declaration, then save a new reviewed plan through the same publisher. Schedules reuse the saved capture; they do not silently replace its source with a fresh network result.

The first projection must explicitly map the native object-ID field. Extraction preserves ascending object-ID order. Public sorting and filtering still use the existing dataset engine. Native OID/integer/date values must fit JavaScript's exact integer range; strings remain strings, including leading zeros. Native floating point values remain numbers. Epoch dates are not converted or given an inferred time zone. Unsupported field types can be preserved in the explicit attributes JSON column.

`attributes_json`, `geometry_json` and `spatial_reference_json` are JSON text columns. The attributes object contains exactly the approved capture `outFields`; extra fields in an imported page are not added to the public dataset. These columns retain original Esri JSON values, including polygon rings/curves, native coordinates, null geometry and spatial reference. They are not silently relabeled as GeoJSON. Attribute aliases and units come from the publisher metadata; the adapter does not invent a unit conversion. The original CSV format uses an empty nullable cell for null, so a real empty string in a nullable scalar column requires an explicit mapping decision. The attributes JSON column preserves that distinction.

For CLI operation, `template --workspace ... --query blocks --out ...` produces a correctly typed native publication plan. Then use the original `save`, `extract`, `inspect`, `review`, `publish`, `recover` and scheduling commands. See the [maintained publisher guide](../postgres/publisher/README.md) and [scheduling guide](../postgres/publisher/SCHEDULES.md).

## Publish the merchant and prepare the customer

After the dataset has been published, close the operator UI process and configure the original versioned seller with your selected public payment terms:

```sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs" \
  configure --state "$ARCGIS_JOB/dataset" --payment "$ARCGIS_JOB/payment.json" \
  --origin https://merchant.example --path /blocks --snapshot-selection \
  --out "$ARCGIS_JOB/merchant.json"
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs" \
  serve --state "$ARCGIS_JOB/dataset" --seller "$ARCGIS_JOB/merchant.json"
```

That original seller supports challenge-only discovery until a supported facilitator is configured through its existing `--facilitator` path. In another terminal, reopen the same publisher with the actual local seller address and exact advertised resource:

```sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  serve --workspace "$ARCGIS_JOB/publisher" \
  --seller http://127.0.0.1:8423 --resource https://merchant.example/blocks
```

Choose the retained published run, preview the desired first-page query and use its existing Buyer panel. This reads the actual seller health and payment alternatives, pins the selected dataset snapshot, and prepares an original SF88 configuration after the selected offer digest is checked. Keep that prepared configuration with the original SF88 buyer's saved delivery. The adapter does not create a signer, replace payment terms, or execute a purchase during capture or publication. Follow the [original dataset buyer workflow](../dataset-refresh/README.md) and [SF88 operator guide](../../sf88-operator-buyer-cli/README.md) for the configured account and retained delivery.

## Receive a usable Esri FeatureSet

After reviewing the retained candidate, close its current CLI/UI process and prepare a small public receiving declaration from that exact run:

```sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  receiving-plan --workspace "$ARCGIS_JOB/publisher" --run RETAINED_RUN_ID \
  --out "$ARCGIS_JOB/arcgis-receiving.json"
```

The declaration retains the original selected field definitions, object-ID name, geometry type, spatial reference, source identities and immutable dataset snapshot. The reviewed dataset must expose the native object-ID and attributes JSON columns; spatial datasets must also expose geometry and spatial-reference JSON. Send this public declaration with the existing merchant/buyer handoff. It contains no local source filenames or source credentials.

Use the original SF88 dataset acquisition and SF100 finalization to receive every page of the selected query. Request all fields named in the declaration's `columns` object and keep the same filter/sort/projection through the original cursor chain. On the receiving machine, with a private output directory:

```sh
export ARCGIS_RECEIVING="$(pwd)/arcgis-receiving"
umask 077
mkdir "$ARCGIS_RECEIVING"
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  receive --delivery /absolute/path/to/original-sf100-delivery \
  --plan /absolute/path/to/arcgis-receiving.json \
  --out "$ARCGIS_RECEIVING/features.esri.json" > "$ARCGIS_RECEIVING/received.json"
```

This command reads the original finalized SF100 archives and its actual `dataset.jsonl`. It checks the page chain, manifest, exact JSONL rows and dataset snapshot before publishing the GIS file. It retains native field definitions, scalar attribute values, object IDs and Esri geometry without transforming coordinates or rings. A filtered delivery produces precisely those selected features. Repeating the conversion accepts only an identical existing output; a different file at that name is preserved and rejected.

Conversion is streamed under the existing 256 MiB delivery-output ceiling; each row follows the original SF100 page limit. The output is published only after complete input verification and file synchronization. It performs no purchase or network request. Payment state remains with the original buyer intent and its saved result.

A custom GIS consumer can also read the JSON text columns directly:

```js
const feature = {
  attributes: JSON.parse(row.attributes_json),
  geometry: JSON.parse(row.geometry_json)
};
const spatialReference = JSON.parse(row.spatial_reference_json);
```

Retain the returned snapshot, field selection, source identifier and original `page.nextCursor`. Continue with the same filters, sort and fields through the existing dataset buyer. An Esri feature-set consumer can reuse the original geometry and spatial reference directly.

The installed package exposes `starforge arcgis` (and `arcgis-publisher`) for these same CLI commands. JavaScript consumers use `@tokenjunkielabs/starforge-merchant/seller/arcgis`, `/seller/arcgis/publisher` and `/buyer/arcgis`. The existing merchant MCP accepts a host-declared `kind: "arcgis"` and opens this original publisher; see [the maintained MCP guide](../../../../stellar-forge/mcp-merchant-operator/PUBLISHERS.md).

## Managed merchant deployment

[DEPLOYMENT.md](DEPLOYMENT.md) continues a reviewed, published ArcGIS extraction into the original SF82 release console: export the exact candidate and merchant, stage against the same dataset version store, select/start/drain/rollback/reopen, then recover the public GIS declaration from the retained release for the original buyer delivery. Use `deployment-export`, `deployment-stage`, `deployment-status` and `deployment-receiving` through the existing ArcGIS command.

## Completed native customer workflow

On 2026-10-11, the original Node 24.19 runtime imported and independently
retained the published UConn responses, moved the capture before continuation,
and joined all 325 block groups. The existing publisher reopened its original
saved plan and extraction, reviewed and published the 1,945,448-byte CSV, then
reopened the same current version. Its immutable snapshot remained
`5247913debf82f89397c07b2e609e33eb7bc92cf9d9d38b8605edbeb411e808a`.

The same operation read the actual publisher source panel, seller health and
payment offers, received an HTTP 402 challenge and prepared the original SF88
buyer configuration. Two original private operator-preview pages selected the
four Suffolk County records whose publisher class is `Not Predicted`. Original
SF100 finalization and this receiving command produced a 26,751-byte Esri
FeatureSet, SHA-256
`b251023c6420dbf67186d1501e18036aea1e9db41f1732022d9738b5c7a551e8`.
Every delivered attribute and polygon ring equaled the retained source; GEOIDs
remained strings and spatial reference remained WKID 102100/latestWKID 3857.
This execution covered the original challenge/preparation and private preview
delivery paths; it did not sign or submit a payment.

The native CSV parser now joins bounded character chunks when each field
completes. This avoids retaining long per-character string chains for geometry
and attributes. Its UTF-16 cell limits and original CSV grammar stay unchanged;
the same complete continuation succeeded under a 96 MiB V8 heap and retained
the original snapshot above.

## Source scope and receiving

The UConn example is the publisher's illustrative child/pet-exposure scenario: original annual modeled pounds of nitrogen, original New York-relative class labels and original block-group geometry. `Not Predicted` stays that label with its published values. It is not converted to Low or zero. Household/population fields are source attributes and are not campaign-contact counts. No policy, fee, water-quality outcome or area apportionment is inferred.

The completed capture is self-contained and its internal response files are immutable. To relocate a capture, keep its whole directory and create a new source declaration pointing at its new absolute path; the capture digest remains the same. A saved publisher plan retains its original absolute runtime capture path, so preserving that path or reviewing a new plan is intentional. The original publisher's version store and run files remain the authority for publication and recovery.

Capture source buffers and the original dataset loader are bounded by the configured byte/row limits. The operator chooses limits suitable for the host; a completed capture is validated before extraction. Runtime output files and local source credentials belong in the operator workspace, outside the public source repository.

## First-party protocol and data references

- [Esri MapServer layer query](https://developers.arcgis.com/rest/services-reference/enterprise/query-map-service-layer/): returnIdsOnly, objectIds, transfer-limit behavior and original geometry responses.
- [Esri FeatureServer layer query](https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/).
- [Esri geometry JSON](https://developers.arcgis.com/rest/services-reference/enterprise/geometry-objects/).
- [Esri authorization headers](https://developers.arcgis.com/documentation/security-and-authentication/reference/http-authorization-headers/).
- [Original UConn layer](https://clear-gis.uconn.edu/arcgis/rest/services/LISS_Fertilizer/Fertilizer_by_BlockGrps/MapServer/0).
- [UConn source methods](https://clear.uconn.edu/projects/fertilizer/methods/).
