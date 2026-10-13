# Original Annual NLCD acquisition and preparation

This workflow acquires the original numeric Annual NLCD coverage for the complete selected upstream model domain. It composes the existing source-capture journal and scientific raster importer.

## Retained source contract

The original USGS WCS DescribeCoverage is retained under `source/annual-nlcd-service-20261012/`. Its exact 13,096 UTF-8 bytes have SHA256 `1a3cba52dca82969d46c0f08aa02f5f2047b5c94edb87bc476c8d172bbad0ff9`. The actual document identifies one coverage, native EPSG:5070, X/Y/time axes, a north-up 30 m grid, 41 annual dates from 1985 through 2025, and a single `PALETTE_INDEX` range. Its published nil value is 250.

The chosen current edition is Annual NLCD Collection 1.2, year 2025. Its first-party dataset reference is https://doi.org/10.5066/P143HE8T . The year passed to the command must match an exact time value in the retained description. The published default is preserved as metadata; selection is explicit.

The service's range metadata labels a radiance unit. The preparation preserves that original label in the coverage contract and treats the observed band as categorical land-cover class integers. It never applies the label as a physical conversion.

The original description was retained through Notion's source-file loader. Its receipt records the actual uploaded identity and byte/hash readback. The loader did not expose the USGS HTTP response status, headers or source-response time; these fields remain null in the receipt.

## Complete upstream domain

The actual selected domain is `upstate-wbd-upstream-domain-20261012`: 217 original USGS WBD HUC12 polygons, comprising 116 reporting intersections and 101 upstream ancestors. The selection retains the 303-row native topology, all 254 context geometries and the original source-page/feature-index binding. The reporting area remains the separate PlanningBasins2023 `Basin = Upper Savannah` feature, native record 5. The raster acquisition uses the complete upstream selection plus an explicit 1,000 m buffer.

Completed input:

- `/dev/shm/dbc61-upstate-model-domain-20261012/model-domain.esri.json.gz`
- Decoded original-native collection: 11,220,042 bytes, SHA256 `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`.
- `sources.json` SHA256 `ac652012c82671c8fdc5d6711f0f9a63f35c1573061419deae6153f8b19a2a03`.
- Complete portable archive: 8,800,689 bytes, SHA256 `1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04`.
- Saved original package identity: `libfile_cce17e762e948191be1d226b1dbce00d`.

The explicit `.esri.json` and `.esri.json.gz` reader calls the original `source.capture_upstream_network.esri_polygon` function from blob `106b648d69c2dbe62839e9b2463fbdae3aa4c792`. It keeps original attributes, object IDs, native CRS and body bytes. The request plan records any analysis corrections performed by that original ring reader. Reprojection to EPSG:5070 is used to calculate the buffered request extent. Other supported vector formats use the existing Fiona reader.

## Produce the exact request

Run from the existing Upstate product root, using its existing Shapely and pyproj runtime. The native Esri planning path does not require Rasterio or Fiona.

```sh
python -B -m source_tools.nlcd_wcs plan \
  --description source/annual-nlcd-service-20261012/coverage-description.xml \
  --description-receipt source/annual-nlcd-service-20261012/contract.json \
  --collection "Annual NLCD Collection 1.2" \
  --collection-reference https://doi.org/10.5066/P143HE8T \
  --domain /dev/shm/dbc61-upstate-model-domain-20261012/model-domain.esri.json.gz \
  --expected-features 217 \
  --time 2025-01-01T00:00:00.000Z \
  --buffer-m 1000 \
  --output /absolute/owned/nlcd-source
```

The retained `plan.json` contains the exact URL and ordered request parameters, source-description and domain hashes, selected date, coverage origin/offsets, request grid-index envelope, buffered bounds, feature count and expected pixel count. The request uses WCS 2.0.1 GetCoverage, original image/tiff, X/Y/time subsets, lossless Deflate compression and tiled output. It requests the original grid without a scale, reprojection or interpolation parameter.

The complete buffered bounds must fall within the published coverage. The native index envelope includes an outward pixel allowance and is derived from the observed source origin and offsets. A changed description, domain, date, buffer or collection reference requires a different output directory and an explicit new source edition.

## Acquire and validate the original TIFF

Use `capture` with the same arguments to complete the one original acquisition and preparation. Its optional `--maximum-bytes` limits the actual body transfer; the default is 512 MiB. Run the receiving/preparation step in the existing scientific environment with Rasterio and NumPy.

The maintained `raster_sources.capture` helper retains its actual URL, response status/headers, time, body bytes and SHA256 in a source journal. A completed exact body is reopened without another request. A retained failed or interrupted acquisition is reconciled using that same output and original request identity.

If the exact original TIFF was already acquired by the existing equipped source worker, use `receive` with `--original` and `--original-receipt`. Its receipt must bind the exact planned URL and the original TIFF byte size and SHA256. Supported observed HTTP receipts require a successful original 200 response.

A server-side original-file loader can instead supply an explicit `upstate.external-original-source/v1` receipt:

```json
{
  "schema": "upstate.external-original-source/v1",
  "state": "complete",
  "url": "EXACT plan.json URL",
  "status": null,
  "bytes": 1,
  "sha256": "ACTUAL ORIGINAL TIFF SHA256",
  "provider": {
    "type": "notion_file_upload",
    "status": "uploaded",
    "file_upload_id": "ACTUAL UPLOADED ID",
    "stable_file_reference": "ACTUAL STABLE NOTION FILE REFERENCE",
    "content_length": 1
  }
}
```

Replace the illustrative length and identity fields with the actual source receipt. This retains the provider's actual original-file custody while leaving unexposed USGS HTTP fields null. An uploaded identity alone does not replace the TIFF byte/hash verification.

The validator opens the actual TIFF, checks its single integer class band, CRS, native resolution, grid alignment, scale/offset, complete buffered coverage and masks. It records original band, grid, tags, palette, class counts and NoData metadata. The prepared `land-cover.tif` copies native class values blockwise on the exact returned pixel grid. It writes signed-integer NoData `-2147483648` for source-invalid cells and the explicitly published nil class 250. The original TIFF remains unchanged as a companion.

No spatial resampling occurs in this preparation. The subsequent existing model alignment selects the retained source ID through `input_sources.NLCD`, anchors its 30 m model grid to the actual raster and permits categorical nearest/mode alignment.

## Import and portable receiving

The completed directory contains:

- `sources.json`: the original `upstate.sources/v1` importer manifest.
- `source-entry.json`: one exact `kind: raster`, `role: NLCD`, `units: class`, `resampling: nearest` source entry.
- `land-cover.tif`: prepared categorical input.
- `plan.json` and original description, receipt, domain, raster body, response journal and native-raster metadata under `original/`.

All paths are relative and every companion has a hash. Import this manifest through the existing Workspace source intake. The source ID incorporates the selected year and complete request-plan hash. The importer and receiving copy keep the original source/companion relationships.

Reopening verifies the retained prepared raster and every companion. If a process ended after writing the final source entry but before its importer manifest, the same command reconstructs and verifies the exact `sources.json` using the original immutable entry. The command preserves an existing differing output.

The original 217-domain preparation is complete. The full source-native TIFF acquisition and model receiving outcome are retained by their respective operation journals as those operations execute.
