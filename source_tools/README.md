# Original source preparation

These commands prepare the original public inputs for the same `model.workspace.Workspace` used by the operator. Run them from the product root with the equipped GIS interpreter. They retain original response bytes, request URLs, response metadata and SHA256s; completed exact responses are reused after interruption.

## Recover complete source archives

Use [Source archive recovery](SOURCE_BANK_RECOVERY.md) to inspect and extract original ZIPs, gzip source banks and exported Slack source documents. The pure JavaScript decoder works without a native executor. Its Node command verifies the complete archive before recovering files into a new directory and retains the original carrier and full member inventory. The guide includes commands for the actual completed 217-HUC run and the 19-file water-source bank.

## Native bounds for the original 217 watersheds

Use [Original 217-watershed acquisition bounds](ORIGINAL_HUC12_BOUNDS.md) to derive exact native EPSG:3857 query windows from the retained model-domain ZIP. The same original polygon union remains the final NHD feature-selection geometry. Continue the retained source through [the NHD receiver](RESUME_NHD_ORIGINALS.md), preserving its original IDs and geometry pages.

## Streamed downloads and original-object reuse

Use [Streamed original-source capacity](STORAGE_RESOURCES.md) when continuing a large retained source on a shared Linux worker. The receiver distinguishes disk-backed streams from memory-backed appends, accounts for the effective cgroup memory limit and clean reclaimable file cache, and records the next range's actual storage and buffer requirements.

The original NLCD continuation is `source_tools/continue_original_capture.py`. Select the existing operation root and its retained application with `--root` and `--application`; the original capture engine, archive identity and range validators remain pinned. The guide includes the receiving command and one focused local check.

Repeated Workspace intake now verifies an existing content-addressed original before allocating a temporary copy. New objects are flushed and published exclusively, so concurrent intake reuses the same verified content without replacing a completed object.

## Retain and prepare the selected rasters

The DEM command uses the selected original 30 m land-cover grid and the actual complete upstream model-domain geometry. It requests disjoint Float32 elevation tiles through the USGS 3DEP ImageServer's documented unrendered data path, then assembles their exact pixels. The explicit context buffer must match the later Workspace grid selection.

```sh
python -m source_tools.raster_sources dem \
  --reference sources/nlcd/original-land-cover.tif \
  --domain sources/upstream/model-domain.gpkg --layer model_domain \
  --buffer-m 1000 --service-metadata sources/usgs-3dep/image-service.json \
  --vintage "Original service edition identified by the retained metadata" \
  --output sources/prepared/dem
```

Use paths from the actual retained source packet. The command validates the observed service's band, pixel type, advertised function and maximum dimensions. Its request grid is immutable in `plan.json`; choose a separate output directory for another source selection. Every original tile and receipt, the exact service metadata, and the tile assembly are companions of `source-entry.json`. Elevation units are metres. The assembled raster is then admitted through the unchanged Workspace alignment and complete-data checks.

For precipitation, the selected original product is PRISM's 1991–2020 annual normal at 30 arcseconds (nominal 800 m), used as the explicit NDR annual runoff proxy. A completed original download can be handed to the same preparer:

```sh
python -m source_tools.raster_sources prism \
  --archive sources/prism/original-annual-normal.zip \
  --capture sources/prism/original-annual-normal.capture.json \
  --output sources/prepared/precipitation
```

For an original archive already carried through the maintained SourceArtifacts transfer, pass its complete result instead:

```sh
python -B -m source_tools.raster_sources prism \
  --archive sources/prism/original-annual-normal.zip \
  --transfer source/prism-precipitation-1991-2020/source-transfer.json \
  --output sources/prepared/precipitation
```

The exact completed PRISM transfer is retained in [the original source record](../source/prism-precipitation-1991-2020/README.md), including its completed destination recovery. This path uses the completed original file, HTTP body identity, actual upload acknowledgment and original destination readback. It performs no source download or Slack upload. The unchanged transfer document becomes a source companion beside the original archive and projected capture receipt. `--capture` and `--transfer` select their respective original capture formats; they cannot be supplied together.

The capture receipt supplies the original `url`, `bytes`, `sha256` and actual `observed_at`; its URL must be the exact annual-normal source declared in the helper. Omitting `--archive` performs that original download, so reuse the existing source worker's receipt when one is already assigned. The full original ZIP remains a companion, including its metadata and station information. The helper retains the unique original GeoTIFF bytes and its native grid, band scale/offset and tags. Original precipitation units are millimetres; a non-unit native scale becomes an explicit conversion. Regridding to 30 m preserves the product's recorded 800 m source resolution.

HTTP failures retain their actual status, error and retry metadata. There is no automatic remote retry loop. Re-entering the same command reuses complete original entities and resumes preparation from the retained source selection.

## Compose one native intake

The regional parameter pack, original basin/catchment/overlay packets and prepared rasters can be selected in one import without copying their large files:

```sh
python -m source_tools.compose \
  --manifest sources/original/source-manifest.json \
  --manifest sources/biophysical/source-manifest.json \
  --entry sources/prepared/dem/source-entry.json \
  --entry sources/prepared/precipitation/source-entry.json \
  --entry sources/prepared/r-factor/source-entry.json \
  --entry sources/prepared/k-factor/source-entry.json \
  --output sources/model-inputs.json \
  --scope-json sources/selected-scope.json
```

Each `--manifest` is an original `upstate.sources/v1` file; each `--entry` is one source row with its original file and companions. The output directory must contain all selected source files. The composer verifies every declared byte count and hash, rewrites only their relative paths, retains the original input manifests as document sources, and rejects duplicate source IDs. Reusing an identical selection returns the same immutable manifest bytes.

Import `sources/model-inputs.json` through the existing operator or `Workspace.import_sources`. Source bodies and companions then enter the original content-addressed store. Native views preserve each entry's directory relationships, including original tile/request definitions and shapefile sidecars. Existing source editions without those path annotations remain readable.

The grid also requires actual NLCD, R-factor and K-factor rasters with the declared physical units. Their original source vintages, selection rules and conversions stay in their own source entries. The scientific engine is the original pinned InVEST NDR/SDR implementation; these preparation commands do not execute a model.

## Original service references

- USGS 3DEP elevation service: https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer
- ArcGIS original exportImage contract: https://developers.arcgis.com/rest/services-reference/enterprise/export-image/
- PRISM original annual-normal archive: https://data.prism.oregonstate.edu/normals/us/800m/ppt/monthly/prism_ppt_us_30s_2020_avg_30y.zip
- PRISM current product format, units and attribution: https://prism.oregonstate.edu/formats/
- PRISM actual product editions and units: https://prism.oregonstate.edu/documents/PRISM_datasets.pdf
- PRISM data attribution: https://prism.oregonstate.edu/terms/
