# Read a regional window from the original Annual NLCD archive

This adapter gives the existing Annual NLCD preparation an additional source reader. It uses the same published national ZIP entity, the original publisher metadata, the original model-domain geometry, and the maintained native-grid clipping functions in source_tools/nlcd_static.py. Its output is the ordinary upstate.sources/v1 manifest consumed by the current Workspace and source composition queue.

The original full-archive receiver and its retained prefix continue under their existing owner. Use this reader in that same source operation when its measured transfer and retained-range cost is preferable on the accepting host.

## Original entity

| Field | Selection |
|---|---|
| URL | https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/Annual_NLCD_LndCov_2025_CU_C1V2.zip |
| Entity bytes | 1,457,983,950 |
| Strong ETag | "56e711ce-64fec1a6cfdae" |
| Publisher metadata | https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/metadata/Annual_NLCD_LndCov_2025_CU_C1V2.xml |
| Source DOI | https://doi.org/10.5066/P94UXNTS |
| Retained application contract | source/nlcd-static-2025-c1v2/source-manifest.json |

Every new provider request selects an exact byte interval, supplies that strong ETag in If-Match, and accepts only an exact 206 response, Content-Range, entity size, ETag and body length. A changed entity requires a new reviewed source selection. Each accepted range has its own SHA256 and response receipt.

## Receive the source

Install the complete source_tools/nlcd_remote_window.py and this guide in the current application. Apply the two accompanying guarded edits to the CURRENT source_tools/nlcd_static.py: the _clip signature gains the optional source_tags keyword and its TIFF-tag block accepts the exact entity/range source identity. Existing local preparations retain their original member-SHA tag and clipping behavior.

The adapter calls the original _inspect_grid, _domain_geometry, _window, _clip and _verify_entry helpers. It does not introduce a second numerical clipping implementation.

A focused compilation reads source in memory without generating bytecode:

~~~python
from pathlib import Path
for name in ("source_tools/nlcd_remote_window.py", "source_tools/nlcd_static.py"):
    path = Path(name)
    compile(path.read_bytes(), str(path), "exec")
    print(name, "compiled")
~~~

The real first operating check is the original-entity probe below. Its returned member inventory and range receipts determine the actual access strategy.

## Inspect the actual ZIP first

Run from the current application root with its existing Python. Choose an owned persistent source directory on the accepting host. Set NLCD_RANGE_OUTPUT to that directory; it is also the final preparation directory.

~~~bash
python -B -m source_tools.nlcd_remote_window probe \
  --output "$NLCD_RANGE_OUTPUT/original/ranges"
~~~

The probe retains the real ZIP central directory, the selected TIFF local header, and any actual hidden SOZip index. The completed inspection names the original TIFF member and reports these actual modes:

| Access | Preparation behavior |
|---|---|
| stored | Read the TIFF directly through archive byte ranges. |
| sozip | Use the original seek index with rasterio's GDAL 3.7 or newer. |
| deflate-unindexed | Ordinary Deflate may require substantial sequential decompression. The explicit option below enables a measured attempt with the same retained byte cache. |
| unsupported | Use the original full-archive preparation for this member compression. |

SOZip index detection reads its actual hidden local header after the compressed member, including a matching ZIP data descriptor when present. Validation checks the index CRC, declared compressed/uncompressed lengths, every monotonically increasing offset, and the first and last independent flush markers. The completed inspection records those exact checks. It retains the original declared whole-member CRC separately from the SHA256 identities of actually received ranges.

If the archive contains more than one TIFF, repeat with --raster-member set to the exact member shown by its original inventory. The completed directory's immutable selection prevents silently switching to another source.

## Prepare the original domain

Use the same existing GIS Python, original metadata contract and complete domain selected by the regional source operation. For the retained Upper Savannah domain, the normal selection contains 217 features and the current preparation buffer is 1,000 metres. Set NLCD_DOMAIN to that retained geometry on the accepting host.

~~~bash
python -B -m source_tools.nlcd_remote_window prepare \
  --metadata-manifest source/nlcd-static-2025-c1v2/source-manifest.json \
  --domain "$NLCD_DOMAIN" \
  --expected-features 217 \
  --buffer-m 1000 \
  --output "$NLCD_RANGE_OUTPUT"
~~~

The preparation confirms the TIFF's actual single-band uint8 160,000 × 105,000 source grid and original WGS84 Albers CRS against the retained publisher XML. It reads the true TIFF affine, selects the same integer native window around the complete buffered domain, preserves original category values, and normalizes the original mask plus the published 250 NoData class to the maintained int32 NoData value. The original scientific model applies its buffered-domain mask during alignment.

For an actual deflate-unindexed result, the acquisition owner may continue the same operation with:

~~~bash
python -B -m source_tools.nlcd_remote_window prepare \
  --metadata-manifest source/nlcd-static-2025-c1v2/source-manifest.json \
  --domain "$NLCD_DOMAIN" \
  --expected-features 217 \
  --buffer-m 1000 \
  --allow-unindexed-deflate \
  --maximum-source-bytes 1457983950 \
  --output "$NLCD_RANGE_OUTPUT"
~~~

That explicit allowance permits retaining up to the complete compressed entity when GDAL must traverse it. It still avoids expanding the national TIFF. The real reported received bytes, reusable bytes, elapsed time and produced window show the actual cost on that source. The normal default is 512 MiB of retained original ranges; increasing the same command's allowance resumes the same cache. The final local window and output metadata need their own disk capacity in addition to retained source ranges.

## Reuse an existing exact prefix

When the original acquisition owner has an immutable retained prefix with its completed SHA256, add all three exact options:

~~~text
--prefix ORIGINAL_PREFIX_PATH
--prefix-bytes ORIGINAL_PREFIX_BYTE_COUNT
--prefix-sha256 ORIGINAL_PREFIX_SHA256
~~~

The reader verifies the whole selected prefix once, pins its device, inode, byte size, modification time and change time, and compares that identity before and after every range read. It obtains complete cache chunks directly from the unchanged prefix. It retains each consumed chunk with the original prefix SHA and byte count, so the finished manifest has the actual original bytes it used. A partial final cache chunk is fetched as one exact original range. The input prefix remains under its existing capture owner; the adapter never truncates, moves or rewrites it.

Use the existing prefix-transfer or prefix-recovery helper to put those original bytes on a different accepting host. The reader does not infer a prefix SHA from the archive ETag or its byte count.

## Progress, interruption and resumption

original/ranges/progress.json records the current stage, entity, retained bytes, new successful HTTP bytes, reused chunk bytes, prefix bytes, request count, elapsed time and the concrete last error. The CLI also emits each new range progress record to stderr. The Python prepare(..., progress=callback) interface passes these same dictionaries to its caller.

Ranges are 256 KiB except the final entity chunk. Each body is atomically retained before its immutable companion receipt is published. A restart validates retained receipt identities and verifies each chunk hash when it is reused. A crash between a body and its receipt reconciles that body against the same exact provider range. Completed source entries reopen directly through the original manifest validator.

Every reused cache chunk is checked against its recorded SHA256 on first access or whenever its full file identity changes. Before and after read identities must match, so file replacement or an edit during access is rejected before bytes enter GDAL. Freshly retained chunks receive the same digest and identity check. Unchanged verified chunks avoid repeated hashing.

The range cache is serialized by its existing operation lock. A temporary loopback HTTP server adapts these exact cached bytes to GDAL's native /vsizip/{/vsicurl/...}/member interface. It is local to the preparation, accepts explicit single-range reads only, and shuts down with the operation. It creates no background model job and no additional operator queue.

The unchanged native clip writer retains its completed output receipt; an interrupted partial window can be recomputed using the saved original source ranges. The original domain, metadata contract, selected ZIP member, native grid and plan remain pinned throughout resumption.

## Existing Workspace and operator intake

A completed output contains:

- land-cover.tif: actual native-grid categorical window.
- source-entry.json and sources.json: current Workspace source format.
- Original publisher XML and its contract, complete selected domain files, actual ZIP inspection and the retained source range bodies/receipts.
- The immutable native preparation plan, clip result, original grid and completed range receipt.

Register the resulting sources.json through the existing operator's source-manifest intake. Its normal source preparation catalogue supplies the actual registered manifest ID. Use that returned ID with the current source.compose action's registered_ids list, alongside any existing source collection IDs selected for the same scientific Workspace.

The maintained HTTP runner's plan mode can compose already-registered manifests with no new preparation steps. Use the existing operator origin, actual workspace key and private capability. Preserve the saved source-plan output directory so its existing task and resulting source collection are reused. The resulting NLCD entry has ordinary role NLCD, units class and nearest-neighbour alignment; current regional modelling consumes it through the same source collection as the local-archive preparation.

## Primary implementation references

- [GDAL virtual filesystems](https://gdal.org/en/stable/user/virtual_file_systems.html): chained ZIP/HTTP access and SOZip support.
- [SOZip specification](https://github.com/sozip/sozip-spec/blob/master/sozip_specification.md): the hidden index structure, source-member sizes and independent Deflate offsets.
- [GDAL SOZip utility](https://gdal.org/en/stable/programs/sozip.html): native archive inspection and validation.
- The publisher metadata and DOI above supply the original NLCD scientific grid and class contract.

The field result to retain is the real probe mode plus completed native preparation, source ID, output window, class counts, received/reused bytes and current Workspace import. Keep those outputs with the original source operation.

## Operate from the existing source desk

The source catalogue method `nlcd-range` appears as **Annual NLCD from original byte ranges**. Select the complete upstream domain from an existing source collection, a registered source root or an uploaded original. The original static-product metadata defaults to the installed `nlcd-metadata` bundle; its complete XML and manifest are snapshotted together. An optional **Existing immutable original archive prefix** comes from the same archive capture. The operator derives its exact byte count and SHA256 from the selected saved input.

Use **Stored or indexed SOZip** for the ordinary preparation. The native reader inspects the original member before choosing the access path. If that member is ordinary Deflate, **Also measure ordinary Deflate** enables its real decompression and transfer work. Enter the receiving allowance before starting: the default is 536870912 bytes; the complete compressed original is 1457983950 bytes. The native 1000 m buffer, exact attribute selection, optional expected feature count and local-window capacity remain explicit controls.

The request uses the existing `source.prepare` action, existing task identity and normal source import. Its progress panel shows the actual stage, original bytes received, reused reads, prefix reads, completed ranges and provider requests. The byte meter shows retained source storage relative to the selected allowance; it is not a percentage of scientific completion. All preparation, bank and import stages continue on that same task.

Resume a failed or interrupted task to use its existing inputs and retained ranges. If the actual source requires a larger receiving allowance or the explicit ordinary-Deflate option, create the revised request in the same study. Before any provider read, the adapter reuses completed ranges from previous requests with the same original domain, metadata, attribute selection, buffer and TIFF member. It checks every adopted range against its declared original entity and byte hash. Different regional windows keep their own receiving allowance. A committed reuse record travels with the new source bank. The original task and its capture remain available.

The finished task uses the ordinary `upstate.source-preparation-result/v1` result. With source import selected, `source_collection_id` names the retained Workspace collection and `source_id` names its actual NLCD raster. The normal result panel exposes the native source entry, selection, manifest and prepared-file bank. Existing authenticated source-preparation download tickets provide the selected files; source composition can include the completed `prepared_task_ids` or imported `source_collection_ids`. Whole-Workspace transfer retains the same bank and restored result links.

A direct queue request has this shape; replace the two source identifiers with the catalogue's actual retained entries:

~~~json
{
  "action": "source.prepare",
  "workspace": "ACTUAL_WORKSPACE_KEY",
  "payload": {
    "method": "nlcd-range",
    "title": "Original Upper Savannah land cover",
    "inputs": {
      "domain": {"collection_id": "ACTUAL_COLLECTION_ID", "source_id": "ACTUAL_DOMAIN_SOURCE_ID"},
      "metadata_manifest": {"builtin_id": "nlcd-metadata"}
    },
    "options": {
      "compression_mode": "seekable",
      "maximum_source_bytes": 536870912,
      "timeout": 60,
      "buffer_m": 1000,
      "expected_features": 217,
      "maximum_clip_pixels": 200000000
    },
    "import_sources": true
  }
}
~~~

The existing `operator_source_intake.py plan` client can use the same method, inputs and options in a normal preparation step. Its dependent DEM or soil steps can bind `from_step` to that actual imported NLCD source. The common source-composition queue supplies the final source edition; all numeric land-cover work stays in the original reader and clipping helpers.
