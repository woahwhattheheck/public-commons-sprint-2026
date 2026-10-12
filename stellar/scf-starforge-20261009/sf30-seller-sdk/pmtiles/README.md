# PMTiles Release Operations

PMTiles Release Operations turns a set of original regional map archives, a MapLibre style, and its assets into a saved, reviewable release. The operator can inspect the actual archives, render them through the original Martin server and OpenLayers/MapLibre stack, publish an immutable edition, restore its preceding release, and hand the complete working product to another Linux host.

The workspace retains source bytes, source and license records, immutable edition versions, original inspection output, review decisions, release files, request results, and publication history. Browser and command-line operations use the same SQLite store and lifecycle. The full portable package also carries the application source and its actual native runtime.

## Included application

| Surface | What it does |
| --- | --- |
| Browser operator | Original file receiving, edition editing, source and layer binding, native inspection, review, release, map preview, restore, and complete package download. |
| Native workspace | Transactional saved operations with immutable versions and exact request replay. |
| Original archive inspection | go-pmtiles verification plus the PMTiles library's header, directory, metadata and known-present tile reads. |
| Native map | Owned Martin child; OpenLayers and the Geoblocks MapLibre layer render that selected release. |
| Source receiving | Complete local file, public HTTPS response, or an already assembled original SF88 Object Buyer delivery. |
| Handover | Frozen complete workspace export, content-addressed ZIP, full source/runtime receiving, cold reopen and prior-release restore. |
| Existing merchant MCP | The companion provider in the repository's merchant MCP operator uses this same workspace/controller. Its installed MCP source and runtime are described in that provider's guide. |

The product uses the existing SF31 public HTTPS transport, SF88 verified-file and Object Buyer interfaces, and the maintained private-file primitives. It adds no payment protocol or alternate map engine.

## Runtime

The initial builder uses an existing Linux x86-64 installation of:

| Component | Selected version or host contract |
| --- | --- |
| Node.js | 22.16.0 or later, with the native node:sqlite module |
| go-pmtiles | 1.31.2 |
| Martin | 1.16.1 |
| pmtiles JavaScript package | 4.5.0 |
| @maplibre/maplibre-gl-style-spec | 26.4.4 |
| OpenLayers, package ol | 10.11.0 |
| MapLibre GL JS | 6.14.0 |
| @geoblocks/ol-maplibre-layer | 2.0.0 |
| esbuild | The installed version is captured, with its exact package and build inputs. |
| Python | Existing complete Linux Python 3.11+ standard library, including ctypes. |
| Linux flock | The existing util-linux flock executable. |

The builder copies the two selected native executables, retains their complete version output, bundles the original native JavaScript library and browser renderer, copies the original MapLibre worker, and records every bundled input and available package license. The system Python installation remains an explicit host dependency. Its exact binary SHA and version are recorded on each host and verified before launching Martin. The portable runtime identity covers the executable and bundle bytes plus this Python compatibility contract.

MapLibre 6.14.0 uses a separate self-contained worker. The operator serves that worker from its own origin and configures it before creating a map. The Geoblocks 2.0.0 root export is the named MapLibreLayer; the attached map is available as mapLibreMap.

Read sources/README.md, sources/native-contract.json and sources/package-profile.json for exact upstream release artifacts, digests, APIs and licenses. The builder does not install dependencies or start hosted CI.

### Build the original runtime

Use an absolute JSON file such as /srv/map-inputs/runtime-build.json:

~~~json
{
  "schema": "starforge.pmtiles-runtime-build.v1",
  "requestId": "regional-runtime-build-01",
  "destination": "/srv/map-runtime",
  "modulesDirectory": "/srv/map-dependencies/node_modules",
  "pmtilesExecutable": "/srv/native/pmtiles",
  "martinExecutable": "/srv/native/martin",
  "pythonExecutable": "/usr/bin/python3"
}
~~~

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs runtime-build --input /srv/map-inputs/runtime-build.json
~~~

The result gives profilePath and the runtime SHA. Preserve that runtime directory. Reopening the identical request verifies the completed profile and returns it. A different input or executable cannot replace the original build in that directory.

### Initialize and open the saved workspace

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs init --workspace /srv/map-workspace --title "Regional map releases"
~~~

Use the returned id as the actual workspace ID in every following command and request. Initialization of a new directory is separate from selecting an existing workspace.

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs serve --workspace /srv/map-workspace --workspace-id PMTILES_ID --runtime /srv/map-runtime/runtime.json --port 0
~~~

The foreground command prints the actual origin and a URL with its access token in the fragment. Open that URL. The browser consumes the token and keeps the saved draft under this origin and workspace ID. The server binds only 127.0.0.1; use the host's existing local browser or its authorized local forwarding route.

Port 0 chooses an available port on the first launch and reuses the workspace's saved port on later launches. Stop and start the same application to retain that browser origin. An explicitly selected different nonzero port is a separate browser origin. If a saved port is occupied, stop its actual owner or select another port explicitly.

SIGINT and SIGTERM drain the owned preview and close the server. Only the current authoring process may hold its authoring-server lease. Native Martin uses the workspace's own shared file lease and native-server lease, so a package snapshot cannot race a live source reader.

## Receive the original files

In the browser, choose each original file's type, license, attribution and source URL, then receive the whole file. The application streams the bytes to its retained transfer, records the body digest, and registers the immutable resource. A lost response reopens that same transfer; selecting the same local file again resumes its original identity and source details.

The archive's PMTiles metadata does not replace the supplier's license or attribution. Supply both. A separate terrain archive, sprite JSON/PNG, optional retina sprite pair, and every selected glyph PBF range must be received as their own original files.

The native equivalent for a local archive is:

~~~json
{
  "requestId": "regional-archive-import-01",
  "expectedWorkspaceId": "PMTILES_ID",
  "name": "regional-basemap.pmtiles",
  "kind": "pmtiles",
  "path": "/srv/original/regional-basemap.pmtiles",
  "rights": {
    "license": "The original supplier's applicable license",
    "attribution": "The supplier's required map and data attribution",
    "sourceUrl": "https://supplier.example/original-source"
  },
  "expected": {
    "bytes": 123456,
    "sha256": "THE_ACTUAL_64_CHARACTER_SOURCE_SHA256"
  }
}
~~~

Replace the source descriptor with the actual full file's bytes and SHA, or omit expected to record the original local selection's observed descriptor.

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs import-local --workspace /srv/map-workspace --workspace-id PMTILES_ID --input /srv/map-inputs/archive.json
~~~

Use kind style for the complete original MapLibre v8 style. The result supplies the retained resource ID needed in the edition.

### Public HTTPS receiving

The acquire command accepts the same resource fields, with url instead of path. Optional etag is sent as If-Match. The existing SF31 transport receives the complete original GET response and retains its request, complete body, status, headers and interruption history. The selected source must return its full body with HTTP 200. Use the actual final HTTPS URL, without embedded credentials. The request retains a supplied exact file expectation.

### Existing Object Buyer delivery

An original paid object acquisition remains in its SF88 workspace. First complete its normal selected acquisition and assembly through the original buyer. This operator adopts that assembled delivery through its native offline receiving command:

~~~json
{
  "requestId": "regional-object-adoption-01",
  "expectedWorkspaceId": "PMTILES_ID",
  "name": "regional-basemap.pmtiles",
  "kind": "pmtiles",
  "rights": {
    "license": "The acquired object's original license",
    "attribution": "The original map and data attribution",
    "sourceUrl": "https://supplier.example/object-description"
  },
  "buyer": {
    "runtimeDirectory": "/srv/original-sf88-runtime",
    "stateDirectory": "/srv/original-object-buyer"
  },
  "objectId": "ORIGINAL_OBJECT_SESSION_ID",
  "assemblyPath": "/srv/original-object-buyer/received/regional.pmtiles"
}
~~~

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs adopt-object --workspace /srv/map-workspace --workspace-id PMTILES_ID --input /srv/map-inputs/object-adoption.json
~~~

The CLI constructs the original Buyer, calls object(id).delivery(assemblyPath), verifies its complete file and retained receipt, and passes that exact ObjectDelivery to the workspace. The map workspace preserves the original session, configuration, snapshot, full native delivery record and file identity. The existing SF88 runtime is needed for this adoption; later map serving uses the already retained complete bytes.

## Save, inspect, review and release

Create an edition by binding every source ID from the original style to a retained archive resource. Preserve the original layer definitions. Layer visibility decisions and the selected view are explicit edition changes.

A complete initial edition request is:

~~~json
{
  "requestId": "regional-edition-save-01",
  "expectedWorkspaceId": "PMTILES_ID",
  "editionId": "regional-basemap",
  "expectedVersion": 0,
  "edition": {
    "name": "Regional basemap",
    "notes": "Original regional source selection.",
    "style": "STYLE_RESOURCE_ID",
    "archives": [
      {"sourceId": "basemap", "resourceId": "ARCHIVE_RESOURCE_ID", "type": "vector"}
    ],
    "sprite": null,
    "glyphs": [],
    "layerDecisions": [],
    "view": {"center": [6.63, 46.52], "zoom": 9}
  }
}
~~~

A raster style uses its exact original source ID and type raster; a terrain source uses raster-dem. For multiple sources, bind each archive explicitly. A sprite pair is {json: RESOURCE_ID, png: RESOURCE_ID, retina: null}; a supplied retina pair goes in retina. Each glyph row is {fontstack, range, resourceId}, where range names a 256-codepoint block such as 0-255. Font stacks and range coverage are shown in the reviewed release.

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs save-edition --workspace /srv/map-workspace --workspace-id PMTILES_ID --input /srv/map-inputs/edition.json
~~~

The result is immutable version 1. Further edits use a new requestId and expectedVersion 1. If another edit has moved that edition, reopen the current version and compare it before saving.

Inspection request:

~~~json
{"requestId":"regional-inspection-01","expectedWorkspaceId":"PMTILES_ID","editionId":"regional-basemap","version":1}
~~~

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs inspect --workspace /srv/map-workspace --workspace-id PMTILES_ID --runtime /srv/map-runtime/runtime.json --input /srv/map-inputs/inspection.json
~~~

Inspection runs the actual go-pmtiles verifier and retains its complete stdout, stderr, return code and executable identity. The original PMTiles library then reads the archive's v3 header, metadata, directories and a known-present tile. It validates every section against the complete file, independent of physical section order. Empty leaf sections and unknown zero counts retain their original meanings.

The current upstream verifier can print Invalid while returning success. The application therefore requires both a successful native exit and no invalid diagnostic, plus the independent complete-file, directory and tile checks. The native style-spec validator checks the original style; the workspace checks its source bindings and actual vector-layer metadata.

Review request:

~~~json
{
  "requestId": "regional-review-01",
  "expectedWorkspaceId": "PMTILES_ID",
  "editionId": "regional-basemap",
  "version": 1,
  "inspectionRequestId": "regional-inspection-01",
  "expectedCurrentRelease": null,
  "reviewer": "The actual reviewer",
  "note": "Source, attribution, visible layers, glyph coverage and regional view reviewed."
}
~~~

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs review --workspace /srv/map-workspace --workspace-id PMTILES_ID --input /srv/map-inputs/review.json
~~~

The returned review id and reviewSha256 select preparation:

~~~json
{"requestId":"regional-prepare-01","expectedWorkspaceId":"PMTILES_ID","reviewId":"ACTUAL_REVIEW_ID","reviewSha256":"ACTUAL_REVIEW_SHA256"}
~~~

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs prepare-release --workspace /srv/map-workspace --workspace-id PMTILES_ID --input /srv/map-inputs/prepare.json
~~~

Preparation retains the complete original edition, review and assets, resolved style, immutable release manifest, and Martin source selection. Original vector MVT tiles remain MVT; original image tiles remain their selected image encoding. Both Martin conversion directions are explicitly disabled.

### Preview the original native release

Open native preview in the browser, or use the foreground command with the returned release ID:

~~~json
{"requestId":"regional-preview-01","expectedWorkspaceId":"PMTILES_ID","releaseId":"ACTUAL_RELEASE_ID"}
~~~

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs preview --workspace /srv/map-workspace --workspace-id PMTILES_ID --runtime /srv/map-runtime/runtime.json --input /srv/map-inputs/preview.json --port 0
~~~

The command prints the actual browser URL after Martin has passed health, exact source catalog, TileJSON, zoom and known-present tile checks. The returned HTTP tile is decompressed according to its actual content encoding and compared with the same original archive tile's full bytes and SHA. The browser renders that real native endpoint.

Martin's named PMTiles sources are snapshots from startup. Selecting another prepared release stops the prior owned Martin process, waits for its exit, writes a new bound configuration, and starts the selected native source. Its Python launcher requires Linux parent-death signaling and checks the original parent after arming it. Native process identity, exact command/configuration, full output, readiness and final exit remain with the workspace.

### Publish and restore

Publish uses the selected release manifest and the exact previous release observed in its review:

~~~json
{
  "requestId": "regional-publish-01",
  "expectedWorkspaceId": "PMTILES_ID",
  "releaseId": "ACTUAL_RELEASE_ID",
  "manifestSha256": "ACTUAL_RELEASE_MANIFEST_SHA256",
  "expectedCurrentRelease": null
}
~~~

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs publish --workspace /srv/map-workspace --workspace-id PMTILES_ID --input /srv/map-inputs/publish.json
~~~

The native publish command saves the selected current release. The browser command also reopens its native preview. A preview startup error remains visible alongside the completed publication so the operator can repair that actual host issue without repeating the publication.

For a second release, save an additional edition version, inspect it, and review against the current first release. Publish the returned second release with expectedCurrentRelease set to the first release ID.

Restore the actual current release's preceding release:

~~~json
{
  "requestId": "regional-restore-01",
  "expectedWorkspaceId": "PMTILES_ID",
  "fromReleaseId": "ACTUAL_SECOND_RELEASE_ID",
  "manifestSha256": "ACTUAL_SECOND_RELEASE_MANIFEST_SHA256"
}
~~~

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs restore --workspace /srv/map-workspace --workspace-id PMTILES_ID --input /srv/map-inputs/restore.json
~~~

The original release chain and file hashes determine the restored selection. Restoring the first publication selects its original empty predecessor. A current-release change rejects stale restore input.

## Saved work and interruptions

Every mutation includes a requestId and expectedWorkspaceId. Keep the original JSON input. An identical completed request returns its saved result; changing that request's body is rejected. An interrupted native operation reopens its original request after obtaining the actual workspace/native leases. An ended failed inspection retains its full result; correct the source or runtime and create a new inspection request.

The browser retains complete draft text, including unfinished JSON, plus pending request IDs and source transfers. After a lost save response, Refresh or Resume reads the original saved operation. An unchanged draft adopts the acknowledged immutable version. Later local text or settings remain and only their matching acknowledged version advances. This keeps subsequent saves tied to the correct version.

The browser's closed-request history is local convenience. It does not alter a native request or erase its history. A RUNNING request must be resumed through its original input. An interrupted received body can finish without uploading it again; a partial body reuses the original transfer and selected local file identity.

Useful native reads:

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs state --workspace /srv/map-workspace --workspace-id PMTILES_ID --offset 0 --limit 50
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs resources --workspace /srv/map-workspace --workspace-id PMTILES_ID --offset 0 --limit 100
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs read-request --workspace /srv/map-workspace --workspace-id PMTILES_ID --id regional-inspection-01
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs read-edition --workspace /srv/map-workspace --workspace-id PMTILES_ID --id regional-basemap --version 1
~~~

Page according to hasMore and nextOffset. The browser shows the latest releases and operations and retains exact pending IDs; native read commands open any retained selected record.

## Complete handover

A workspace export freezes the selected SQLite snapshot and all original resources, source captures, native records, receiving history and retained releases. The portable package adds this application, its literal source dependencies, original source contracts/licenses/sample, the native executables and complete built browser/native runtime.

A portable package request is:

~~~json
{
  "requestId": "regional-package-01",
  "expectedWorkspaceId": "PMTILES_ID",
  "stagingDirectory": "/srv/map-package-01",
  "destination": "/srv/delivery/regional-map-release.zip"
}
~~~

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/cli.mjs package --workspace /srv/map-workspace --workspace-id PMTILES_ID --runtime /srv/map-runtime/runtime.json --input /srv/map-inputs/package.json
~~~

Stop an independently running preview before a native package command. The browser's Build portable package action drains its own preview, takes the snapshot, completes the package, and reopens the previous selection. Download complete package returns the exact saved ZIP after its full SHA is checked.

The saved result gives the archive SHA and bytes, package ID, workspace ID/revision, source count and complete logical inventory. Keep that result with the ZIP. It selects receiving. Files with identical content share one ZIP payload while retaining every logical path, mode and hash.

Use PORTABLE_HANDOVER.md for complete extraction, source receiving, compatible-host validation, cold reopen and restore. Reopening a completed package request returns the original selected archive even if the live workspace has moved.

For a workspace-only handover use export with {requestId, expectedWorkspaceId, destination}, then receive-workspace with {requestId, source, destination, expectedWorkspaceId, expectedSha256}. expectedSha256 is the returned handover manifest SHA. An installed matching runtime remains necessary for native map preview.

## Run the complete original receiving journey

The included native-receiving.mjs is one producer, browser and customer operation. It uses the actual installed pmtiles, Martin, PMTiles JavaScript, MapLibre and OpenLayers implementations, plus the existing Playwright/Chromium host. Give it one private absolute input file:

~~~json
{
  "schema": "starforge.pmtiles-native-receiving.v1",
  "operationId": "CAMPT0CAMP-PMTILES-RELEASE-OPERATIONS-20261012",
  "directory": "/srv/map-native-receiving",
  "runtimeProfile": "/srv/map-runtime/runtime.json",
  "playwrightModule": "/srv/browser/node_modules/playwright/index.mjs",
  "chromiumExecutable": "/srv/browser/chromium",
  "reviewer": "The operating engineer's actual name"
}
~~~

Use actual existing paths. In place of runtimeProfile, runtimeBuild may contain the complete original runtime-build input described above. Keep the original operation ID and input after a process or response interruption.

~~~sh
node /ABS/source/sf30-seller-sdk/pmtiles/native-receiving.mjs /srv/map-inputs/native-receiving.json
~~~

The operation carries the complete included Stamen archive through native inspection, immutable review/release and the real map. It then saves an edition through the actual browser, loses that response after the real save, retains later local text, reconciles the original request and saves the subsequent edit. Stop and Start reopen the same origin and unfinished browser draft.

The next source selection acquires the complete official Florence MVT archive from its immutable upstream Git revision, through the original workspace HTTPS acquisition. Before selecting its edition, the receiver checks the full 6,601,156-byte body against Git blob bd5f906fb433787604abbae0ad405f3197b97b49. The actual SHA256, body and complete HTTP response join the workspace's original source record. Its matching original water/buildings/roads/pois style is retained with the upstream example and license declaration under sources/. The selected vector edition replaces the raster source and style, is inspected against actual vector-layer metadata, and opens through the same Martin/OpenLayers application.

The browser downloads the complete frozen package. A fresh customer directory receives it through the original CLI, renders the received vector release, restores its prior raster release and then restores the original baseline. CLI reopen confirms the same workspace and retained receiving history. The result is native-result.json with the actual source/runtime/browser identities, three release IDs, complete package and receiving results, observed native tile responses and map screenshots. The original step records, browser request/response files, native outputs and full source captures remain beside it.

The first Florence acquisition needs public HTTPS access to the retained immutable source URL. Later same-operation continuations reuse the complete captured file. Normal customer package receiving and rendering use the delivered source/runtime files.

## Source formats and practical limits

The initial product supports PMTiles v3 archives with MVT vector tiles or PNG, JPEG, WebP and AVIF image tiles. Each style source must bind a supported original archive; unrelated external GeoJSON, video or image-source types require their original adapter before this PMTiles release path can accept them. MLT archives and unknown tile types are rejected by the explicit format mapping.

Vector layers must be declared in the actual archive metadata. A single original style sprite and its optional retina pair are supported. The complete selected glyph files and coverage are retained; choose the original ranges needed by the region's labels and language. Dynamic font expressions need their actual selected font stacks and ranges.

Each resource is at most 2 GiB; a selected JSON document is at most 16 MiB. The SQLite main database has a 1 GiB page limit; read-only recovery and complete export remain available at that boundary. An edition has up to 32 archive bindings, 4,096 explicit layer decisions and 8,192 glyph-range rows. A complete package has at most 30,000 logical files and 32 GiB of unique payloads. Package creation and receiving stream whole bytes; provision disk for the saved source, immutable runtime, workspace, package and receiving destination.

The frozen workspace includes all source/history selected by that workspace. Choose the source and customer delivery deliberately before producing its complete handover.

## Source references

- [Original Camptocamp PMTiles/OpenLayers/Martin workflow](https://camptocamp.com/en/news-events/pmtiles)
- [PMTiles documentation](https://docs.protomaps.com/pmtiles/)
- [PMTiles v3 specification](https://github.com/protomaps/PMTiles/blob/aec8fa1341222fdddb3318e9ffa8e18e19b312f7/spec/v3/spec.md)
- [Martin PMTiles source configuration and startup behavior](https://maplibre.org/martin/sources-pmtiles/)
- [OpenLayers original attributed PMTiles image example](https://openlayers.org/en/latest/examples/pmtiles-image.html)
- [MapLibre style specification](https://maplibre.org/maplibre-style-spec/)

Exact retrieved source identities and applicable original licenses are in sources/SOURCE_MANIFEST.json. The complete included raster sample is sources/stamen-toner-z0-z3.pmtiles; its expected bytes and SHA are in sources/sample.json. sources/sample-vector.json pins the complete Florence archive's immutable original Git source, byte count and blob identity for acquisition by the same native receiving operation. sources/sample-vector-style.json, the original example and REUSE.toml preserve its matching style and original licensing.

## Merchant MCP and the complete receiving journey

The existing merchant operator now exposes 31 PMTiles tools over this same workspace and controller: original source capture, saved editions, native inspection, reviewed publication, native preview and restore, full workspace export, portable package download, and independent receiving. The [MCP operating guide](../../../../stellar-forge/mcp-merchant-operator/PMTILES_WORKSPACE.md) contains the complete source/runtime installation, host-selected connection, commands, original request recovery and authenticated download workflow.

The single `native-receiving.mjs` journey also exercises that actual HTTP MCP provider after both original browser contexts close. It consumes the producer’s captured Florence vector edition, imports the same source files through configured aliases, saves and reviews a further edition, publishes it, exports and packages the workspace, interrupts a returned archive chunk, closes and reopens the same MCP endpoint and browser origin, resumes and verifies the complete download, receives the package, and restores the producer’s original vector release. The final `native-result.json` retains the MCP result and exact downloaded archive alongside the original raster/vector browser and customer receiving result.

Run this complete engineering journey from the committed repository or the full merchant installation’s `source/` root containing both `stellar/` and `stellar-forge/`. Its original input and operation ID stay unchanged. The native hook resolves that original root at runtime; it does not add MCP dependencies to the customer operations ZIP. That ZIP includes its complete declared SCF source, original map runtime, saved workspace, captures, reviews and release chain. Use the full installed merchant distribution to add the MCP interface to a received customer workspace.
