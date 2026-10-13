# Receive the original Annual NLCD national product

This receiver joins the retained **2025 Annual NLCD CONUS Collection 1 Version 2** static product to the existing scientific workspace. The source owner obtains the untargeted published national archive once. The receiver preserves that complete archive, reads its actual TIFF and native sidecars, and clips the selected model domain entirely on the receiving worker. It makes no HTTP request.

The original public catalog selects row **2881**. The archive is:

https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/Annual_NLCD_LndCov_2025_CU_C1V2.zip

Its original XML is retained at [Annual_NLCD_LndCov_2025_CU_C1V2.xml](../source/nlcd-static-2025-c1v2/Annual_NLCD_LndCov_2025_CU_C1V2.xml), with the original loader record and catalog identity in that folder's source manifest. The XML is 34,686 bytes, SHA256 `abf071bc22e9e346433d8686c0b6f9c3107d491a57ee8ce6d46d9e4a4d362030`, DOI https://doi.org/10.5066/P94UXNTS.

## Current source state

The exact static metadata and catalog row are retained. **The national archive's compressed byte count and its TIFF have not yet been observed by this source continuation.** The existing original acquisition remains with the source owner in work item `UPSTATE-ORIGINAL-SOURCES-DBC61`. The adapter and a prepared selection do not establish a completed download or a completed model run.

The original project contains 217 selected WBD polygons: 116 reporting intersections and 101 upstream ancestors. Its retained original domain carrier is `libfile_cce17e762e948191be1d226b1dbce00d`, 8,800,689 bytes, SHA256 `1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04`. The native `model-domain.esri.json.gz` contains the actual selected features and original page/index bindings.

The previously rejected project ZIP upload and coordinate-bearing remote request remain unissued. This receiving path uses the public national product and performs the original domain selection locally. It does not finalize any earlier private upload or send project geometry to MRLC.

## Adopt the original completed download

Use the same installed scientific environment and current complete application source. Keep capture, expansion and prepared output directories outside the application checkout. The producer supplies the original complete national ZIP and its actual HTTP receipt, or the completed original SourceArtifacts result. No new downloader or account route is introduced.

For an original HTTP capture, the retained JSON must carry its actual `url`, `status:200`, `state:"complete"`, exact `bytes` and `sha256`. Preserve the original response headers, final URL and recorded retrieval times whenever the producer exposed them. An unobserved field remains absent; neither local modification time nor a known product size is an HTTP observation.

Replace `OBSERVED_ARCHIVE_BYTES` with the positive integer actually established by the original producer. The declared maximum is a receiving bound, not an invented source length.

~~~bash
python -m source_tools.nlcd_static receive \
  --archive /owned/source/Annual_NLCD_LndCov_2025_CU_C1V2.zip \
  --capture /owned/source/Annual_NLCD_LndCov_2025_CU_C1V2.capture.json \
  --metadata-manifest source/nlcd-static-2025-c1v2/source-manifest.json \
  --maximum-archive-bytes OBSERVED_ARCHIVE_BYTES \
  --output /owned/annual-nlcd-original
~~~

If the same original source was carried by the maintained SourceArtifacts helper, replace `--capture` with `--transfer /owned/source/original-transfer-result.json`. The shared validator requires the actual COMPLETE source stream, body hash, original provider completion and readback. The exact original transfer JSON is retained alongside its source-capture projection. A partial or unfinished upload cannot enter this receiver.

The ZIP's full inventory, member names, declared expanded sizes, compression and CRC values are retained. With multiple TIFF members, explicitly select the actual land-cover member using `--raster-member`. Ordinary paths and unencrypted regular files are required. The default maximum TIFF member is 32 GiB; change that explicit bound only from the actual native archive inventory and the receiving worker's available capacity.

~~~bash
python -m source_tools.nlcd_static inspect \
  --capture-directory /owned/annual-nlcd-original
~~~

This read returns the completed capture ID, exact archive bytes/hash, selected TIFF, original sidecars, full inventory and actual expanded-byte requirement. It does not extract the national image.

## Capacity belongs to the original whole job

The worker must account for the actual full archive, selected expanded TIFF and sidecars, local categorical output, project intake and later workspace backup/receiving copies. The published 160,000 by 105,000 grid does **not** establish compressed ZIP size. The preparation plan also reports the exact selected local cell count and its uncompressed int32 pixel bytes.

Source adoption uses the existing same-filesystem hardlink helper where possible. A different filesystem requires a real byte-verified copy. Import into the workspace's object store may require another retained full-archive copy; a complete portable backup carries it too. Include those actual copies in the existing job's declared storage and memory. A command-private expansion directory is useful only when it has room for the full original TIFF and is covered by the same job's resource envelope.

Preparation uses a 64 MiB GDAL cache and 256 by 256 output blocks; it does not allocate the full national raster as an array. Domain parsing uses the original source reader. The actual native process, original supervisor and worker admission retain their existing owners.

## Prepare the complete selected domain locally

~~~bash
python -m source_tools.nlcd_static prepare \
  --capture-directory /owned/annual-nlcd-original \
  --domain /owned/model-domain/model-domain.esri.json.gz \
  --expected-features 217 \
  --buffer-m 1000 \
  --work-directory /owned/expanded-national-source \
  --output /owned/annual-nlcd-upstream
~~~

The exact native Esri path uses the existing `source.capture_upstream_network.esri_polygon` helper through `nlcd_wcs._domain_geometry`. It retains the native source CRS, object identities, decoded byte hash and any source-reader analysis corrections. Other native vector formats keep the existing Fiona reader; shapefile intake retains SHP, SHX, DBF, PRJ and present CPG/QPJ companions together. `--layer` and an explicit `--where-json` select a retained source layer/filter. The original 217-feature collection needs neither.

The original static XML declares WGS 1984 Albers Equal Area, 30 metre cells, standard parallels 29.5/45.5, central meridian -96, latitude of origin 23, 105,000 rows and 160,000 columns. **This is the static-product contract; the earlier WCS EPSG:5070 description is a separate source.** The receiver verifies the actual TIFF against the static XML. It records the original affine, CRS WKT, dimensions, band scale/offset, tags, mask flags, palette and every native file the TIFF reader opened.

The actual native affine determines cell corners. No half-cell shift is inferred from prose in another manual. The full selected polygon union is transformed to the actual static CRS, buffered in metres, then enclosed by an integer native pixel window with one context cell. All selected features must be present, the complete buffered domain must lie within the national raster, and the requested window must fit the explicit pixel bound.

The local TIFF keeps original valid class values. Original native mask cells and the publisher's code 250 NoData become one explicit int32 NoData value. The source mask, additional published-nil count and class counts are retained separately. Unexpected unmasked class codes fail preparation. This step does not resample or invent class values; the original model subsequently performs its existing nearest-neighbor alignment into its declared exact 30 m grid and applies the retained buffered-domain mask.

## Interruption and receiving

Each operation retains an immutable source/domain selection before creating its outputs. A changed archive, metadata, member, domain, filter or selected capacity requires a new output selection. Reusing the same selection does not fetch the provider again.

Each expanded TIFF or sidecar has a `received` byte receipt written before its same-directory rename, followed by `complete`. A stopped expansion reuses verified completed members and rebuilds only an uncommitted local partial from the retained original ZIP. A command-private directory lost with its process can be re-expanded; the first retained original-member byte identity and time remain unchanged.

The local clip has the same received/rename/complete boundary and an exact preparation-plan hash. Once the source entry exists, a retry verifies the TIFF and every original companion, then creates or verifies the same `sources.json`. This covers interruption after entry creation but before manifest publication.

Only after the full source entry and all original companions verify does the same held work lock allow removal of the owned expanded TIFF/sidecars and their temporary receipts. Both first completion and terminal replay use this cleanup. A partial earlier cleanup can finish without recreating already removed files. The complete original ZIP, its member hashes/CRC values, original metadata, source receipt, native grid and final categorical clip remain retained.

## Existing workspace and portable delivery

The prepared `sources.json` uses the original `upstate.sources/v1` interface. Its raster entry has role `NLCD`, units `class`, and resampling `nearest`; identity binds the full original archive, member, metadata, domain and preparation. The companion list includes the complete national ZIP and original receipt/XML/manifest, the native domain files, source capture, original expanded-member hashes, native-grid observation, local clip receipt and preparation selection.

Import this manifest with the existing `Workspace.import_sources` or original operator source-intake action, then select its returned source ID for the existing model's `NLCD` role. The existing source composer can join it with the original reporting basin, upstream domain, regional biophysical table, PRISM precipitation, NOAA R, soil K and remaining selected inputs.

The scientific workspace's portable application now includes the original `source/` dependency alongside `model/`, `operator/` and `source_tools/`. Consequently the delivered original Esri reader and source operating guides are present after receiving. The workspace object store preserves selected original bytes. Continue the single existing native model/operator/backup/receiving programme with its retained IDs; this source adapter creates neither a competing model runner nor a new scientific result.


## Read the verified archive without a second national TIFF

The same original preparation now accepts `--read-mode archive`. This uses GDAL's
native `/vsizip/` reader against the completed local national archive. It performs
no provider request and keeps the domain selection entirely local.

The archive, capture, source contract, full native member inventory and sidecars
are unchanged. Each selected TIFF or sidecar is streamed to its end to establish
its complete SHA-256 and native ZIP CRC. Those original identities are retained
before the raster is opened. The driver must report only those exact retained
archive members. The local window then goes through the existing CRS/affine,
full-domain coverage, original class/NoData, block writing, manifest and receiving
checks. There is no full-size expanded TIFF on disk.

```bash
python -m source_tools.nlcd_static prepare \
  --capture-directory /owned/annual-nlcd-original \
  --domain /owned/model-domain/model-domain.esri.json.gz \
  --expected-features 217 --buffer-m 1000 \
  --read-mode archive \
  --work-directory /owned/annual-nlcd-member-records \
  --output /owned/annual-nlcd-upstream-archive-read
```

Use a fresh output selection when changing the read mode. Its selection and plan
record the archive access method and zero bytes of full-member scratch expansion.
The original `expanded` mode remains the default and preserves its existing
selection and cleanup behavior. The original ZIP must fit, along with the local
clip, native reader memory and the later source-intake/backup copies. Same-volume
original retention uses the existing hardlink path.

The archive mode trades expanded disk storage for the native ZIP reader's
decompression and seek work. A conventional compressed national ZIP can require
substantial decompression to reach the selected TIFF blocks. Keep the original
operation running and use the actual measured time. Full member verification is
retained per member, and an interrupted local clip continues through the same
original received/rename/complete boundary. Every completed output can be reopened
without fetching the national product again.

Reference: [GDAL virtual ZIP files and on-the-fly reading](https://gdal.org/en/stable/user/virtual_file_systems.html#vsizip-zip-archives).
Authored integration: TokenJunkieLabs, original UPSTATE-ORIGINAL-SOURCES-DBC61
national-source continuation, 405F.
