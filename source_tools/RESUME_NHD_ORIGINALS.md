# Receive and finish the retained NHDPlus HR originals

The receiver continues the existing ECO13-AE11 source operation from its retained original HTTP responses. It preserves the selected bank's complete native inventories and geometry batches, acquires the remaining candidate IDs, selects whole original flowlines intersecting the retained 217-HUC polygon union, assembles a transferable source edition and imports it into the existing Workspace. A retained Water and Habitat Context boundary selection can run that analysis immediately after import.

The maintained original-HUC mode queries the actual watershed envelopes instead of requiring completion of the entire rectangular domain grid. Existing broad queries and their native IDs remain part of the acquisition. The final original polygon selection determines which whole flowlines enter the scientific source.

## Select the original source edition

The following verified source example uses revision 10, [F0C8TFT58P3](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8TFT58P3). Its decoded source-bank JSON has:

- **2,797,473 bytes**
- **SHA256 `0816e8b4749c1e1d383dcd0e9c5c079a03a6e98951595890b6074d44d46b3aaa`**
- 61 retained original geometry responses, covering 26,414 native IDs and 91,009,987 original response bytes.
- Six retained inventory scopes and their 26,414 candidate IDs.

Follow that carrier's stated part order and encoding to recover its complete JSON. Verify the decoded byte count and SHA256. The receiver verifies the bank and every embedded member independently. A later source bank can be selected with its own actual published identity.

The original 217-HUC domain is `dbc61-upstate-model-domain-20261012.zip`, 8,800,689 bytes, SHA256 `1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04`. Its stable Library identity is `libfile_cce17e762e948191be1d226b1dbce00d`. The exact sorted HUC12 list has SHA256 `ec0cb3d05a0ede9da1b9238b7c7bff2fa495d94e5a6a0451890b54233edfbd52`.

The retained domain ZIP includes `model-domain.esri.json.gz`, `feature-bindings.json` and `domain-summary.json`. Original polygon coordinates and IDs remain the source for both envelope acquisition and final exact-domain membership.

## Application and native dependencies

Run from the existing Upstate application root containing `model/` and `source_tools/`. Keep these maintained modules together:

- `source_tools/original_huc12_bounds.py`
- `source_tools/capture_water_sources.py`
- `source_tools/resume_nhd_originals.py`
- `source_tools/water_context_geometry.py`
- `source_tools/water_context_intake.py`

The bounds producer uses only Python's standard library. Exact polygon selection uses Shapely, and the existing source intake and model use the application's GDAL/PROJ environment. Use the established GIS interpreter and current complete application from the same receiving operation. The source-preparation component catalogue includes these maintained source paths.

## Recover the retained original responses

The selected bank's `inventory-progress.json` lists `native_geometry_pages`. Each row's `stable_reference` identifies the exact original file attached to the existing [Ecosystem Sciences source page](https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e).

Resolve those stable references through the authorized file-download tool and keep the original body under its recorded filename. Preserve the stable reference in operation records; temporary signed URLs are download transports. Keep the original response bytes unchanged.

Alternatively, provide a local JSON mapping from each recorded filename to its downloaded path or freshly resolved HTTPS URL through `--downloads`. The receiver checks the original byte count, available content hash, native-ID equality, complete native fields, EPSG:3857, Z/M flags and coordinate dimensions. It records its own verified content hash for subsequent resumes. Diagnostic XY-only samples stay outside the native Z/M page set.

## Use the completed original217 bounds delivery

The completed source holder's five original files are retained together at
[source/water_context/20261013/domain217_query_bounds/](../source/water_context/20261013/domain217_query_bounds/). Its published metadata is a descriptor of the CSV, so it uses a different schema from the maintained Decimal inventory. The receiver now accepts either complete representation directly.

Select the committed metadata and its exact hash in the existing invocation:

```sh
NHD_HUC_BOUNDS="$APPLICATION/source/water_context/20261013/domain217_query_bounds/domain217-native3857-bounds.json"
NHD_HUC_BOUNDS_SHA256=94e54e27eef2802a92a0a35e3f576db3e86f6659338aaf513ac700ecd6565ba3

```

Pass these values to the same `--huc-bounds` and `--huc-bounds-sha256` options below. Keep the five source files together. The metadata selects the original 108,588-byte CSV, SHA256 `24fc2be0a18f0024410de1f727667ef6a2e68d012c4e4d7ace0971b0f5363179`, and its original manifest declares the metadata, reproduction method and guide companions.

The receiver also accepts the complete decoded five-member source-bank JSON, 120,529 bytes, SHA256 `338ebb7f6d7fb7d74a0e3064367206487c57b638a28268bed4af0692cc7641cc`, through the same options. Its `commons.source-map/1` envelope carries all original UTF-8 bodies. Supply the decoded JSON rather than its transport gzip or Base64.

Both forms verify all member hashes, the original compressed/decoded polygon identities, complete 217-HUC/OID relationships, every envelope coordinate, ring/vertex counts and native CRS. The source holder's Python producer used ordinary `json.loads` and CSV serialization; its numeric text is compared to that exact historical float representation of the original polygon extrema. This comparison does not replace query precision. The receiver's existing original-archive verification supplies unchanged Decimal extrema to every actual query.

Under the selected input hash, the operation retains the received metadata/bank, original CSV, source manifest, reproduction code and guide, plus the exact Decimal query inventory. All enter the native source edition as companions. A materialized archive's basename does not change this derived query identity. Resume the same operation with the same selected bounds input and source bank. Existing broad candidate IDs, native geometry bodies and query caches remain reusable.

This input join uses the source holder's completed native result. The optional producer command in the next section remains available when no completed bounds family has been received.

## Complete the original-HUC source import

Use the established operation paths and GIS interpreter. In the example below, `NHD_BANK` is the decoded revision 10 bank, `NHD_DOMAIN_ARCHIVE` is the original domain ZIP, and the capture, download, edition and Workspace variables name their existing operation directories.

```sh
cd "$APPLICATION"

if [ -z "${NHD_HUC_BOUNDS:-}" ]; then
  "$GIS_PYTHON" -m source_tools.original_huc12_bounds \
    --archive "$NHD_DOMAIN_ARCHIVE" \
    --output "$NHD_CAPTURE_ROOT/bounds217"
  
  NHD_HUC_BOUNDS="$NHD_CAPTURE_ROOT/bounds217/original-217-huc12-native-bounds.json"
  NHD_HUC_BOUNDS_SHA256=$("$GIS_PYTHON" -c \
    'import hashlib,pathlib,sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' \
    "$NHD_HUC_BOUNDS")
fi

"$GIS_PYTHON" -m source_tools.resume_nhd_originals \
  --bank "$NHD_BANK" \
  --bank-sha256 0816e8b4749c1e1d383dcd0e9c5c079a03a6e98951595890b6074d44d46b3aaa \
  --domain-archive "$NHD_DOMAIN_ARCHIVE" \
  --huc-bounds "$NHD_HUC_BOUNDS" \
  --huc-bounds-sha256 "$NHD_HUC_BOUNDS_SHA256" \
  --download-directory "$NHD_ORIGINAL_DOWNLOADS" \
  --output "$NHD_CAPTURE_ROOT" \
  --edition "$NHD_EDITION_ROOT" \
  --archive-output "${NHD_EDITION_ROOT}.zip" \
  --workspace "$NHD_WORKSPACE" \
  --timeout 180 \
  --chunk 500
```

When the source holder already supplied the verified bounds JSON, use that file and its actual SHA256 directly. The receiver compares the complete inventory against the unchanged original ZIP before making queries. A downloaded ZIP's local basename may differ; its source hashes, native field identities, CRS, complete HUC set and all polygon extrema must match.

The bounds producer preserves original decimal coordinate tokens. Its JSON and CSV contain the typed native object ID, HUC12, all-ring bounds and ring/vertex counts for each original feature. Only the comparison with the original summary reproduces that composer's documented historical float serialization; query extrema remain original numbers. See [ORIGINAL_HUC12_BOUNDS.md](ORIGINAL_HUC12_BOUNDS.md) for the complete source reduction contract.

An explicit `--huc-bounds` input takes precedence. When both flags are omitted, source banks with the optional `domain_query_bounds` descriptor use their verified original-domain reduced-grid plan; older banks keep the original four-by-four rectangular mode. The reduced-grid planner retains original Decimal extrema, skips cells containing no original HUC envelope, and preserves every previously completed broad query and geometry body. See [NHD_DOMAIN_QUERIES.md](NHD_DOMAIN_QUERIES.md) for its complete source and plan-inspection command. All modes keep the declared source bank, native layer, original geometry and final polygon selection.

A running capture remains pinned to its original bank hash. Resume with the same bank, output directory, original domain ZIP and edition path. To adopt a different published bank snapshot, select another output directory and reuse the already downloaded original bodies through `--download-directory` or `--downloads`. Keep the previous operation and source edition intact.

## Continue into Water and Habitat Context

Add `--boundary "$NHD_BOUNDARY_SELECTION"` to run `model.water_context.build` after source import. This is the existing native boundary selector:

```json
{"collection_id":"existing-imported-collection-id","source_id":"existing-polygon-source-id"}
```

Use the actual saved collection/source reference. The prepared source bindings supply the original NHD stream-order overlay. The model writes its ordinary saved assessment; the receiving operation retains `workspace-bindings.json`, `water-context-selection.json` and `water-context-assessment.json`.

`--counts-only` completes the selected coverage inventory and retains supplied geometry, then returns before requesting remaining geometry or creating the immutable edition. An ordinary invocation resumes those same original response caches.

## Coverage and restart behavior

Original-HUC mode verifies all 217 envelopes and retains their complete derived inventory as a source companion. A HUC query is skipped only when the exact union of complete original query envelopes covers its entire extent. Coverage partitions at every recorded x boundary and checks the whole y interval of every resulting strip. Positive-width gaps remain uncovered.

The original broad scopes are preserved even when another scope makes them redundant for coverage. Their count/ID requests, responses and candidate IDs remain in the selected union. Completed tile and HUC inventories from the same operation's prior capture are restored from their original HTTP records before the live capture is updated. Their response hashes, unrestricted envelope query parameters and matching count/ID scopes are verified.

Uncovered HUCs enter one maintained collector call with a single metadata read. Each scope has a stable HUC12-based identifier and an exact numeric envelope string. Adaptive subdivisions preserve the decimal boundaries. Saved split decisions are recovered by the same stable identifier, exact scope and depth even when other HUCs have become covered, avoiding another timeout at a previously split parent. Successful response caches remain reusable after interruption.

Legacy grid mode recomputes all 16 cells from the original `domain-summary.json`. Its original native coordinate and coverage rules remain available. Both modes retain the publisher-supported conservative candidate relation and finish with the same original polygon intersection.

`received-geometry.json` checkpoints validated pages after each successful batch. Restarts verify those bytes, hashes, requested IDs and geometry; remaining native IDs are obtained by set difference. Geometry timeouts split a batch through the maintained collector. Original-source quota handling remains in its existing HTTP helper.

The complete candidate inventory and every requested native geometry ID must be present before the descriptor is marked complete. `water_context_geometry.select_domain_objects` then identifies whole original flowlines intersecting the retained 217-HUC polygon union. Stream order remains the publisher's `streamorde` value. The resulting source edition includes original metadata, responses, requests, selection geometry, derived envelope inventory and transfer manifest.
