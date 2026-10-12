# PMTiles source and operating contract

This source bundle supplies the original archive, exact upstream pins and working inputs for the Starforge PMTiles release workspace. The sample is a complete Stamen Toner PMTiles v3 archive. Its bytes remain unchanged; the local filename is shorter for portable command lines.

## Included original source

| Input | Identity |
|---|---|
| Stamen Toner raster archive | 716,052 bytes; SHA-256 `b96efe3ea10b98632c0c0dc229d000b604ebdad6b2f1321ea11d9de931df1ce5` |
| Original upstream archive | `protomaps/PMTiles`, commit `aec8fa1341222fdddb3318e9ffa8e18e19b312f7`, `spec/v3/stamen_toner(raster)CC-BY+ODbL_z3.pmtiles`, Git blob `8d170ca89ecf3197d14366db63679f198a198101` |
| PMTiles specification | v3; original CC0 specification copied in `upstream/PMTILES_V3.md` |
| Native PMTiles tool | `go-pmtiles v1.31.2`; release archive identities in `upstream-sources.json` |
| Native tile server | `Martin martin-v1.16.1`; release archive identities in `upstream-sources.json` |

The archive contains PNG tiles at zooms 0–3: 85 addressed tiles, 84 directory entries and 80 distinct tile contents. Its header declares clustered storage, gzip-compressed directories/metadata and uncompressed PNG payloads. The first original PNG is 256 × 256 pixels. Full header values and original byte identity are retained in `sample.json`.

[The official OpenLayers example](https://openlayers.org/en/latest/examples/pmtiles-image.html) uses this same archive and supplies its attribution: map tiles by Stamen Design under CC BY 4.0; underlying OpenStreetMap data under ODbL. Keep the attribution in `sample-raster-style.json`, the displayed map, and any downstream archive handover. The original sample and the BSD software are separately licensed; `licenses/PMTILES.txt` explicitly says sample datasets retain their own terms.

## Fit to the original Camptocamp workflow

[Camptocamp’s 10 April 2026 article](https://camptocamp.com/en/news-events/pmtiles) describes OpenLayers with the Geoblocks MapLibre layer, PMTiles in private object storage, and Martin exposing conventional XYZ tiles. It also uses a separate Mapterhorn terrain archive. Keeping named source identities, reviewed archive bytes and owned server restarts in the release workspace fits that published architecture. The complete included raster sample exercises the same source-to-Martin-to-styled-browser delivery path.

An additional original vector source is available in the same Protomaps commit: `spec/v3/protomaps(vector)ODbL_firenze.pmtiles`, 6,601,156 bytes, Git blob `bd5f906fb433787604abbae0ad405f3197b97b49`. The upstream `REUSE.toml` explicitly assigns ODbL-1.0 and © OpenStreetMap Contributors to that file. Its exact source URL and license reference are in the manifest.

## Native inspection and extraction

Use the selected original binary; preserve its version output, exit status and complete command output in the owning release request.

```sh
pmtiles version
pmtiles show stamen-toner-z0-z3.pmtiles --header-json
pmtiles show stamen-toner-z0-z3.pmtiles --metadata
pmtiles verify stamen-toner-z0-z3.pmtiles
pmtiles tile stamen-toner-z0-z3.pmtiles 0 0 0
```

The `tile` command writes the stored tile payload to stdout, including its archive compression. A missing coordinate can produce empty output with a successful exit, so a retained sample probe needs a known-present coordinate and nonempty bytes. In the complete raster sample, 0/0/0 is present.

`verify` accepts an existing local file and examines structure and header statistics. Its help explicitly excludes individual tile-content validation. The pinned `verify.go` is included for the exact behavior: an out-of-range tile entry is logged as `Invalid` without returning an error; the clustered-order branch adds an offset before asking whether that same offset is absent. The latter condition cannot become true. Preserve full diagnostics, reject invalid diagnostics, and retain the product’s independent section/entry-range checks. Keep the original full archive hash alongside these results.

For extraction, use an unpublished new destination owned by the selected operation:

```sh
pmtiles extract stamen-toner-z0-z3.pmtiles next-staged.pmtiles --bbox=-10,35,25,60 --minzoom=0 --maxzoom=3 --download-threads=1
pmtiles verify next-staged.pmtiles
```

The original tool requires clustered input. `--bbox` and `--region` are mutually exclusive; the region parser accepts polygonal GeoJSON. Zoom endpoints are inclusive and clamped to the source header. `--dry-run` calculates the selection; ordinary extraction writes a new archive. Native defaults are four download threads and 0.05 overfetch.

The implementation calls `os.Create(output)`, which truncates an existing destination. The release workspace therefore allocates an unpublished staging path and installs completed bytes after inspection. Extraction selects whole tiles intersecting the area and copies their original contents and metadata. Geometry inside an intersecting vector tile extends to that tile’s original boundaries.

## V3 ranges and identities

The fixed header occupies bytes 0–126. Its magic is the seven ASCII bytes `PMTiles`; byte 7 is version 3. Offset/length pairs at 8/16, 24/32, 40/48 and 56/64 are little-endian unsigned 64-bit values for root directory, metadata, leaf directories and tile data. Preserve integer precision and compare ranges against the complete archive length.

The root directory must end within the first 16,384 bytes. Other sections may be relocated; valid files do not require a fixed section order or a sum-of-lengths layout. A zero leaf-section length means no leaves. Nonempty sections belong outside the header and within the archive. The saved product also verifies section nonoverlap.

Directory entries have positive compressed lengths. A zero RunLength identifies a leaf-directory pointer; positive values count a run of addressed tiles. Tile offsets are relative to the tile-data section; leaf offsets are relative to the leaf section. Delta TileIDs use the cumulative Hilbert order. A zero encoded offset after the first entry means the previous offset plus its length; otherwise the decoded offset is encoded value minus one. Header count zero means unknown. The included original specification supplies the full compression, tile-type and metadata definitions.

## Selecting a tile that exists

Use the pinned reader's public API to choose the readiness coordinate from its original directory. A regional archive can omit its declared center coordinate.

```js
import {PMTiles, tileIdToZxy} from 'pmtiles';

const archive = new PMTiles(originalSource);
const header = await archive.getHeader();
const root = await archive.cache.getDirectory(
  archive.source,
  header.rootDirectoryOffset,
  header.rootDirectoryLength,
  header,
  signal,
);
```

Each returned entry has `tileId`, `offset`, `length` and `runLength`. A positive `runLength` addresses tile contents: `tileIdToZxy(entry.tileId)` returns the first present coordinate in that run. A zero `runLength` points to another directory at `header.leafDirectoryOffset + entry.offset`, with `entry.length` bytes. Follow it through the same `archive.cache.getDirectory`, source and header. The library's own traversal permits four directory levels, depths 0 through 3. Preserve section/entry range checks and the product's byte limits, and reject cycles or a deeper chain.

Finally, require nonempty `(await archive.getZxy(z, x, y, signal)).data` at the selected coordinate. This method returns decompressed tile bytes. Compare the Martin response using the actual HTTP content encoding. `deserializeIndex` and the standalone `getDirectory` helper are private functions; the exported cache interface supplies the original directory decoder. The [exact 4.5.0 source](https://github.com/protomaps/PMTiles/blob/aec8fa1341222fdddb3318e9ffa8e18e19b312f7/js/src/index.ts) is bound in the manifest.

## Martin named-source release

Copy `martin.sample.yaml` to the selected release directory, resolve the source to its immutable archive path, and choose the owned loopback port. The example uses port 3010 and source ID `toner`.

```sh
martin --version
martin --config /absolute/release/martin.yaml
```

The original CLI accepts `--config`; source parameters are supplied in that file. The file sets `listen_addresses` and a named `pmtiles.sources.toner`. Conversion is disabled explicitly so the release keeps its selected archive tile encoding.

Native readiness includes all of:

1. `/health` returns HTTP 200 and `OK`.
2. `/catalog` includes the exact selected source ID under `tiles`.
3. `/toner` returns the source TileJSON with expected zoom bounds, attribution and tile URL.
4. `/toner/0/0/0` returns the original sample’s nonempty PNG tile.

The v1.16.1 endpoints are `/{sourceID}` for TileJSON and `/{sourceID}/{z}/{x}/{y}` for tiles. Source names colliding with Martin’s reserved or existing names can be renamed; use an explicit available ID and read it back. The exact reserved list is in `native-contract.json`.

Named sources and individual remote URLs are snapshotted at startup. Changing the archive requires the workspace’s owned stop/drain/start cycle. Directory and remote-prefix watchers use different semantics; their polling does not substitute for this named-source release transition.

## Browser packages and style validation

`package-profile.json` contains exact direct package pins:

| Package | Version | Role |
|---|---:|---|
| `pmtiles` | 4.5.0 | Original archive reader |
| `@maplibre/maplibre-gl-style-spec` | 26.4.4 | Style validation |
| `ol` | 10.11.0 | OpenLayers map |
| `maplibre-gl` | 6.14.0 | Styled renderer and worker |
| `@geoblocks/ol-maplibre-layer` | 2.0.0 | MapLibre layer inside OpenLayers |

`upstream-sources.json` retains the tagged package source, native release archives and observed npm integrity records from the upstream projects’ complete locks. The owning runtime installation resolves and retains the full selected dependency graph.

The style-spec public export is `validateStyleMin`. Pass the parsed style object and retain its returned error array. An empty array denotes a style that passes that specification. Its separate `gl-style-validate --json style.json` CLI accepts JSON text/files and exits 1 for validation errors.

MapLibre 6.14.0 builds two self-contained ESM bundles: `dist/maplibre-gl.mjs` and `dist/maplibre-gl-worker.mjs`. Retain both plus `dist/maplibre-gl.css`. Its current build intentionally removed the shared runtime chunk used by older versions. Call `setWorkerUrl` before creating the map, using the worker’s actual same-origin URL and selected version/hash. Preserve all outputs produced by the chosen bundler in the installed runtime inventory.

The package root exports a named class: `import {MapLibreLayer} from '@geoblocks/ol-maplibre-layer'`. Its `src/index.ts` re-exports the class under that name; it has no default package export. The Geoblocks constructor accepts `{mapLibreOptions:{style:styleObjectOrUrl}, ...OpenLayersLayerOptions}`. Its `mapLibreMap` is created after attachment to a visible map with a target. Wait for the layer’s `load` event before calling `layer.mapLibreMap.setStyle(nextStyle)`. Disposing the layer removes its original MapLibre map.

The included `sample-raster-style.json` declares the original 256-pixel raster source and its attribution, with one raster layer. Replace its local TileJSON URL with the reviewed owned server URL as part of the saved release input.

## Source custody

The original sample bytes were retrieved through GitHub’s base64 file reader and SHA-256 was computed over the decoded complete file. Native executable/archive digests are the exact official release-asset digests. `SOURCE_MANIFEST.json` binds the delivered files to their original source and distinguishes preserved upstream files from generated operating inputs. All source links refer to public upstream material.
