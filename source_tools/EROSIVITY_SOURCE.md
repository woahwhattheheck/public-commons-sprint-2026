# Original NOAA rainfall-runoff erosivity source

This intake prepares NOAA's original CONUS R-factor GeoTIFF for the workspace's existing `R_FACTOR` input. It keeps the numeric source raster, the original archive, source metadata, HTTP response records and the conversion selected for the model grid.

## Open the delivered original archive

The original NOAA archive was acquired on October 12, 2026 and retained as [NOAA-R-Factor-CONUS-original.zip](https://tokenjunkielabs.slack.com/files/U0BR9670G2H/F0C9BC7MKME/noaa-r-factor-conus-original.zip) in the existing Upstate source thread. Its original byte identity is:

| Field | Original value |
| --- | --- |
| Bytes | 47,143,128 |
| SHA-256 | `157bbcaa54b445f96506fb1caffda4bbaea6b28f71bc7199235705e69cd00596` |
| Source ETag | `0x8D736D0673CC5A7` |
| Published source period | 1975–1997 |
| NOAA publication | December 26, 2013 |
| Metadata capture | October 12, 2026, 07:28 UTC |

The retained source package at `source/noaa-r-factor-conus-2013/` contains the original metadata body and HTTP receipt, the observed archive HEAD response, and the completed transfer result. The transfer result retains the original source hash, accepted byte count and file identity. The body itself remains the original completed file linked above.

Download that existing file through the receiving host's supported original Slack file route. Then use the received local file and retained source metadata:

```sh
python -B -m source_tools.erosivity_sources receive \
  --archive /actual/received/NOAA-R-Factor-CONUS-original.zip \
  --transfer source/noaa-r-factor-conus-2013/source-transfer.json \
  --metadata source/noaa-r-factor-conus-2013/metadata.html \
  --metadata-receipt source/noaa-r-factor-conus-2013/metadata.html.capture.json \
  --output /actual/source/noaa-r-received

python -B -m source_tools.erosivity_sources prepare \
  --capture-directory /actual/source/noaa-r-received \
  --output /actual/prepared/noaa-r
```

The receiving command validates the received archive against the complete original transfer result and validates the metadata against its own original HTTP receipt. It retains the transfer record unchanged, builds the standard archive inventory and enters the same source-capture reader used by direct acquisition. The original archive, metadata, source responses and transfer result then travel with the prepared source entry and full workspace delivery. Reopening uses the same capture ID and recorded files.

The receiving command makes no HTTP request. Its archive response sidecar identifies the original SourceArtifacts stream and carries the header observation and completed-body timestamps separately; it does not relabel the receiving time as the source acquisition time. Native raster preparation and the model's existing one-time unit conversion continue through the original code below.


## Published source and units

| Field | Original source |
| --- | --- |
| Publisher and record | NOAA Office for Coastal Management, InPort 48224 |
| Dataset | R-Factor for the Conterminous United States |
| Numeric archive | [R-Factor-CONUS.zip](https://coast.noaa.gov/data/digitalcoast/zip/R-Factor-CONUS.zip) |
| Full metadata | [NOAA InPort 48224](https://www.fisheries.noaa.gov/inport/item/48224) |
| Publication | December 26, 2013 |
| Source period | 1975–1997 |
| Method lineage | Digitized isoerodents from Renard et al. (1997), *Agriculture Handbook 703*, pages 47–51, interpolated into the published NOAA raster |
| Original grid | 800 metre Albers Equal Area, NAD83 / GRS80 |
| Original physical units | `(hundreds ft-tonf-in)/(ac-h-yr)` |
| Model units | `MJ*mm/(ha*h*year)` |
| Physical conversion | Multiply original physical values by `17.02`, as specified by the [InVEST SDR input documentation](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html) |

The saved source edition carries this historical period and 800 metre resolution into the source catalogue, grid preparation and delivery. Alignment places the source on the chosen 30 metre model grid; the source metadata continues to identify its original resolution and interpolation method.

The historical county climate files captured from the original NRCS/Purdue RUSLE2 directory remain separate source editions. A model profile selects one actual R source through its source ID. Comparisons should retain the selected edition in each run.

## Capture the original source

Run from the product root using the existing Python environment:

```bash
python -B -m source_tools.erosivity_sources capture \
  --output /absolute/source-root/noaa-r-original
```

Capture uses the standard-library HTTP and ZIP implementation already used by the raster source adapter. It saves:

- The original NOAA metadata response and its request time, response time, status, final URL, available headers, byte count and SHA-256.
- The complete original ZIP and the same HTTP identity.
- Every ZIP member's original name, expanded length, compressed length, compression method and CRC.
- The actual GeoTIFF member candidates.
- A `capture.json` with schema `upstate.noaa-rainfall-erosivity-capture/v1`, a content identity, source contract and observed request interval.

The metadata parser checks the original title, publication date, source years, grid and units before selecting this source. A changed source contract produces a specific source-review error before a model input is prepared.

Use the same directory to continue an interrupted transfer. A complete response is reused only after its body and receipt match. The original received/complete states cover the atomic body rename, so a completed transfer is retained across interruption. A later source edition belongs in a new capture directory.

## Prepare the retained GeoTIFF

Preparation uses the existing native Rasterio, NumPy and pyproj runtime. It does not invoke NDR or SDR.

```bash
python -B -m source_tools.erosivity_sources prepare \
  --capture-directory /absolute/source-root/noaa-r-original \
  --output /absolute/source-root/noaa-r-prepared
```

The complete retained capture is sufficient for this command; it makes no source request. If the original archive contains more than one GeoTIFF, inspect `capture.json` and add `--raster-member` with the exact selected member name.

For a single capture-and-prepare operation, omit `--capture-directory`; the command retains the original capture below the output's `original/` directory.

Preparation:

1. Reopens the selected capture and verifies its body, receipt, member inventory and source identity.
2. Retains the archive, metadata and capture records as declared relative companions.
3. Extracts the exact original numeric GeoTIFF through a received/complete extraction checkpoint bound to the original archive and member.
4. Reads the native raster block by block. It verifies a single numeric GeoTIFF band, the published Albers/NAD83 metre grid, 800 metre cells, finite nonnegative unmasked values and the native band scale.
5. Writes `source-entry.json` and `source-manifest.json`, ready for the original workspace source importer.

The original TIFF bytes are unchanged. Its grid, NoData value, stored-value range, valid/NoData counts, tags, band scale and offset remain in `native_grid`. The original archive also retains all published sidecars and metadata.

A nonzero band offset requires a different explicit conversion and is surfaced during preparation. For an accepted source band scale, the declared conversion factor is:

```text
model value = stored original value × source band scale × 17.02
```

The existing `model.rasters.align_source` applies that combined factor once during grid preparation. The prepared source declares the original customary units and the model target units together; no pre-scaled replacement TIFF is created.

## Join the original scientific inputs

The preparation writes an `upstate.sources/v1` manifest. For a one-source intake, pass its actual path to `Workspace.import_sources` or choose it in the operator's source intake.

For the complete model source edition, use the existing composer. Place the composed manifest above every selected source packet so all native files and companions retain portable relative paths:

```bash
python -B -m source_tools.compose \
  --manifest /absolute/source-root/original/sources.json \
  --manifest /absolute/source-root/biophysical/source-manifest.json \
  --manifest /absolute/source-root/noaa-r-prepared/source-manifest.json \
  --manifest /absolute/source-root/soil-prepared/source-manifest.json \
  --output /absolute/source-root/complete-sources.json
```

Add the actual DEM, land-cover, precipitation, reporting/model-domain and delivery-overlay manifests to the same command. The composer checks each selected original file and retains the original source definitions. The example paths designate existing prepared inputs.

In the grid selection, use the R source's emitted ID, `noaa-r-factor-conus-2013-<archive SHA prefix>`, and its declared `R_FACTOR` role. Keep the emitted ID, source manifest hash and grid selection in the native model plan. The native batch then uses the same retained source edition in every selected model stage and in the complete receiving handoff.

## Continuation and storage

Capture accepts a ZIP up to 256 MiB. The selected TIFF may be up to 512 MiB, and the complete member inventory may declare up to 1 GiB expanded. These are input limits; the actual archive inventory and native file lengths determine the storage declaration for the original job.

Preparation extracts only the selected TIFF and keeps the original archive. On the same filesystem, retained original bodies are hard-linked; across filesystems, the existing content-addressed source retention performs a verified copy. Account for the actual archive, TIFF and any subsequent workspace backup or receiving copy when declaring native job storage.

Reuse the same output and immutable `plan.json` after interruption. The extraction checkpoint binds the exact archive hash and member. A completed `source-entry.json` reopens only after its numeric raster and every declared companion verify; a missing final source manifest is reconstructed from that same completed entry.

The actual model and operator receiving continue through `model.native_batch` and `operator/RECEIVING.md`. This source command prepares their original input.
