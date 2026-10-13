# Original map layers

## Product behavior

The installed **Original map layers** view opens registered original JSON sources,
discovers their embedded polygon feature collections, and lets the operator select
the layers to admit. The original Operations queue retains a stable admission
operation. The same view reopens completed admissions and recreates native download
tickets after reload or application restart.

Each selected polygon layer becomes a native registered GeoJSON vector and an
original-attribute CSV. The vector carries the exact original Web Map bytes, original flat Esri feature set
and detailed lineage JSON as declared source companions. The full parent's SHA-256
matches the original registered body; native CAS storage reuses that same retained
object. A selected vector export therefore includes its independently verifiable
original parent and exact feature pointer. All original feature order,
IDs, attributes, field declarations, ring coordinates and CRS declarations remain
available. The existing OriginalEsriFeatures parser performs polygon interpretation;
the derived standard GeoJSON is transformed to EPSG:4326 using its declared CRS.
Original parser repairs and transformation/runtime identities are recorded. Both
native and transformed geometries must be valid, nonempty Polygon or MultiPolygon;
a failure identifies the original feature and resulting geometry type.

The result supplies the existing reporting-region selector and scenario-zone
selections. Existing native source catalogs see the admitted collection immediately.
The original Fiona reporting reader accepts the GeoJSON without a new model
calculation or replacement geometry. URL-only remote Web Map layers remain visible
as source context; their bytes are not silently captured.

For the exact retained Upstate ten-county source edition, the operator can include
Census Vintage 2025 context. The dated CSV, precise per-column metadata, official
county reference, original-feature/GEOID join and readable HTML report are retained
together. Original historical population fields stay unchanged. The context reports
whole counties, with 2025 estimates and the same-vintage 2020 estimates base; 2010
and 2020 decennial counts remain separately labeled.


## Open and use the desk

In the scientific Operator, open **Sources → Original map layers**. Select a retained JSON source and inspect its embedded polygon layers. Select the original layer pointers to admit, and optionally choose the available dated county context. **Admit selected layers** queues the work through Operations. The completed admission provides native downloads and **Use these regions in scenario analysis** on each admitted vector.

That continuation opens the existing scenario editor with the original per-feature source, collection and typed attribute selectors. The editor refreshes the selected Workspace's native state when a just-admitted vector is absent from its cached source list. Its run and source snapshot remains with the form through submission; changing Workspace prevents the old form from submitting. Current native execution-version checks, source-plan metadata, stable sensitivity-weight IDs, saved analysis reopening and GIS delivery controls remain available.

The scenario analysis itself uses completed native model outputs. Source admission and catalogue browsing remain independent of a model calculation.

## Install from the maintained application

This feature is included in the complete application source. Receive the current application checkout with its Python/GIS environment, restart the original Operator process to discover `operator/extensions/webmap_sources.json`, and reload its browser. The existing dynamic extension registry supplies the desk, API route and queued action; the feature does not require a second server.

The application includes:

- `model/webmap_sources.py`: original source discovery, polygon conversion, lineage, deterministic source admission and optional county context.
- `operator/webmap_sources.py`: catalogue, queue, restart and native download binding.
- `operator/web/webmap_sources.mjs` and `.css`: source selection, admission recovery, download controls and scenario continuation.
- `operator/extensions/webmap_sources.json`: the native extension descriptor.
- `source/webmap_county_context/`: the dated Census CSV, column metadata, string county identifiers, operating guides and native-owned scenario descriptor.
- `source_tools/install_webmap_sources.py`: a complete source-bank receiver for an existing compatible application.
- `source_tools/receive_webmap_sources.py`: the original ten-county source journey, including native reporting reads, download replay and restart.

The current Scenario analysis controller, bridge, backend, model, styles and shared extension host remain the maintained application components. Current portable source inventories include `model`, `operator`, `source` and `source_tools`, so these application files travel with the retained Workspace.

### Receive a portable source bank

A `commons.source-bank/v1` bank retains all complete source bodies, byte lengths and SHA-256 values. If it is carried in an `upstate.application-source-part/v1` envelope, join its `data` parts in numbered order, Base64-decode, decompress gzip and verify the resulting JSON against the envelope's exact length and hash. Each `files[]` row contains `path`, `bytes`, `sha256` and `content_base64`.

Bootstrap the installer from its verified source row, then run:

```sh
"$ECO_GIS_PYTHON" install_webmap_sources.py \
  --source-bank WEBMAP_SOURCE_BANK.json \
  --application "$ECO_APPLICATION"
```

Use the actual GIS interpreter and application directory. The installer validates the complete bank, Python/JSON syntax and native dependencies before writing files. It preserves replaced original bodies under `source_tools/webmap-source-history`. A differing shared file must match a declared predecessor; otherwise compose the latest application source first. `--replace-existing` applies only to inspected differing members without a declared predecessor requirement.

The installer selects scenario ownership from the actual server's declared actions and result kinds. An older native-owned scenario service receives a client-only descriptor; an extension-owned service receives the complete native descriptor. Mixed action/result ownership is rejected before writes. The selected-native-model module must expose the original completed-output and comparison functions.

For the known older application with both direct and extension scenario controllers, the installer migrates its seven original direct-controller joins to the extension host. It preserves the original navigation, existing extension dispatch and previous app body. Already migrated applications remain unchanged. A changed legacy join requires composition with its actual source.

## Run the complete retained-source journey

Restore the original publisher Workspace with its supplied archive through `model.portable.restore` when it is not already retained. The receiving driver selects the exact original `UF-DRINKING-WATER-DATA` source edition and verifies the original parent hash before admitting it. Set the paths to that retained Workspace and an owned receiving output directory:

```sh
"$ECO_GIS_PYTHON" -B \
  "$ECO_APPLICATION/source_tools/receive_webmap_sources.py" \
  --application "$ECO_APPLICATION" \
  --workspace "$ECO_ORIGINAL_WORKSPACE" \
  --state-directory "$ECO_ADMISSION_STATE"
```

The driver uses the original Operator queue, native region reader and native download tickets. It checks all ten original county attributes and ordering, fixed-width string GEOIDs, the dated Census total, the full original parent Web Map companion, declared source hashes, immutable admission replay, saved admission reopening and application restart. It writes `original-county-admission-result.json` in the selected state directory.

For the full scientific source-collection transfer, use the companion-aware collection receiver included in the current Investigations source:

```sh
"$ECO_GIS_PYTHON" -B \
  "$ECO_APPLICATION/source_tools/receive_webmap_sources.py" \
  --application "$ECO_APPLICATION" \
  --workspace "$ECO_ORIGINAL_WORKSPACE" \
  --state-directory "$ECO_ADMISSION_STATE" \
  --collection-receiver "$ECO_APPLICATION/receiving/eco_intelligence/receive_original_collection.py" \
  --collection-state-directory "$ECO_COLLECTION_STATE"
```

The driver resolves each selected vector and dated table from actual current source-browser metadata: `native_kind=retained_source`, its original collection/source binding and `role=primary`. It requires exactly one dataset for each selected source and writes `selected-original-collection-refs.json` using the original dataset IDs.

After closing the native Operator, it calls the declared-companion receiver with those references and `require_declared_companions=True`. That stage exports primaries and original companions, checks their hashes, reopens the source bindings, downloads and portable export, and records `collection-receiving-result.json`. The admission result is written before the collection phase so an interruption preserves the completed source identity and selected dataset references.

## Source and API contract

Factory: WebmapSources(operator, fault). Catalog reads use the original immutable
source/ticket services without taking the long-running native task write gate.
Admission writes remain serialized by the original Operations queue gate, so source
browsing stays available while a scientific simulation runs.

GET /api/webmap-sources/catalog?workspace=KEY lists retained original JSON sources,
available contexts and full saved admissions. Adding source_collection_id and
source_id selects the actual retained original and returns layers, remote_layers,
contexts and that source's saved admissions.

Queued action: webmap.source.admit.

Payload:

    {
      "source_collection_id": "<original immutable source collection>",
      "source_id": "<original source>",
      "layer_paths": ["<actual discovered RFC6901 layer pointer>"],
      "context_id": "upstate_sc_population_v2025"
    }

context_id is optional. Selection pointers come from the actual original bytes;
the backend validates original eligibility again. The current Census context
requires the retained exact original ten-county geometry source and exact name
crosswalk. Feature-set additions reference their precise original JSON locations.

The result and each admissions[] row contain admission_id, source_collection_id,
parent_source_collection_id, parent_source_id, title, admitted_sources, context,
and current native files tickets. task_id is supplied when the current Operator
has the original task. Vector rows include region_selector and scenario_zones.
Related original attribute/context source IDs are exposed through related_source_ids.

The source collection's immutable scope.webmap_admission retains its admission
identity and runtime lineage. Repeating the same original source/layers/context
reuses that collection, including after directory-changing restore. Original task
identity remains in the existing queue.


## Interpretation and portability

The Census table represents complete counties. It remains a generic scientific table with `geography_basis=whole_county`. Watershed results retain their own spatial support and units; county-boundary overlap does not allocate people to a watershed. Original historical population attributes, contemporary estimates, revised estimates base and decennial counts retain their separate source labels.

The intelligence source browser exports admitted vectors and context tables together with every declared original companion. The lineage retains original source IDs, hashes, feature pointers, field vintages, native parser information and context sources. Current native CAS storage retains each original object; restored source views use `Workspace.source_file`.

Catalogue and ticket reads use the original immutable services without taking the long-running native task write gate. Admission writes remain serialized through Operations. Repeating the same original source/layers/context reopens the same immutable collection, including after a directory-changing restore.
