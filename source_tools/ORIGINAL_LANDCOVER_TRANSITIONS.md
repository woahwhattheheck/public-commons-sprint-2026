# Original annual land-cover areas and transitions

These maintained Node modules compute native pixel-centre land-cover areas inside the original watershed polygons. A paired run additionally counts every before/after NLCD class combination on identical original pixel positions.

## One annual source

Run from the application root with the retained original 217-feature Esri JSON (plain or gzip) and the current original source manifest:

```sh
node source_tools/run_original_landcover.mjs \
  --domain /actual/source/model-domain.esri.json.gz \
  --manifest source/annual-nlcd-native-20261013/source/source-manifest.json \
  --output /actual/project/results/landcover-2025
```

The command reads the geometry collection's actual `spatialReference`. If the retained collection has no CRS declaration, supply its documented `--source-epsg 3857`, `--source-epsg 4269` or `--source-epsg 5070`. An explicit CRS must agree with any declaration in the original collection.

The source manifest binds the exact original raster bytes, native affine grid, annual source time, original domain hash and feature count. The command reads those identities from the files. Select the current manifest from the same checkout as its raster.

## Two original annual sources

After both annual source editions are present, use their actual manifest paths:

```sh
node source_tools/run_original_landcover.mjs \
  --domain /actual/source/model-domain.esri.json.gz \
  --before-manifest /actual/source/nlcd-2023/source-manifest.json \
  --after-manifest source/annual-nlcd-native-20261013/source/source-manifest.json \
  --output /actual/project/results/landcover-2023-2025
```

Both years must have identical dimensions and affine coefficients, EPSG:5070, PixelIsArea and increasing source years. The original domain file must match both source manifests. The output directory is newly created; existing output directories are preserved.

## Delivered outputs

| File | Contents |
| --- | --- |
| `landcover-YEAR.json` | Original annual raster, domain union and each HUC12's class counts and areas. |
| `watershed-class-areas.csv` | One row per watershed, year and original NLCD class. |
| `landcover-transitions.json` | Full 16-by-16 transition matrices, class margins, grouped changes, valid-data coverage and spatial overlap accounting. |
| `watershed-class-transitions.csv` | Before/after class pair counts and hectares for every watershed. |
| `watershed-change-summary.csv` | Stable/change counts and coverage for each watershed. |
| `run.json` | Original input identities, geometry CRS, method and exact output file identities. |

The transition and change files appear for paired runs. The source-year rasters are read strip by strip; each reader keeps one decoded strip in memory. The original compressed TIFFs are retained in memory for hash checking and strip access.

## Scientific method

The annual calculator uses pixel centres, half-open scanline edges and even-odd ring parity, preserving polygon holes. The retained original domain declares `wkid:102100, latestWkid:3857`. Its inverse Web Mercator transform and NAD83/WGS84 (1) operation reproduce the native worker's selected PROJ pipeline, followed by the GRS80 Albers transform. The first original point agrees with the native result within 0.000001 m; the coordinate operation itself has stated 4 m accuracy. NAD83 coordinates supplied directly are transformed using the GRS80 ellipsoidal Albers equations for EPSG:5070. Geographic polygon segments connect the transformed original vertices. Areas use the exact affine determinant in square metres, divided by 10,000 for hectares.

Each annual product keeps its complete original 16-class classification. A transition cell is counted only when both years have a valid original class. Cells valid in only one year, or missing in both, have separate counters. Therefore class margins and net area changes in the paired report refer to exactly the same valid-cell cohort.

Individual watershed counts and domain-union counts are reported separately. The union counts each native cell once; an overlap counter identifies cells selected by multiple original polygons. All original polygons must lie within the native raster rectangle.

The broad groups are water(11), snow/ice(12), developed(21–24), barren(31), forest(41–43), shrub(52), grass(71), agriculture(81–82) and wetland(90,95). Full original classes remain in every transition matrix. The grouped results are an additional view.

Annual NLCD class transitions describe changes between the published annual classification products. Interpretation of land-management causes, event timing or classification uncertainty requires the corresponding evidence and product documentation.

## Source and replay

- USGS Annual NLCD: https://www.usgs.gov/centers/eros/science/annual-national-land-cover-database
- Published land-cover classes: https://www.usgs.gov/centers/eros/science/usgs-eros-archive-land-cover-annual-nlcd-collection-1-land-cover
- USGS projection equations: https://pubs.usgs.gov/pp/1395/report.pdf
- EPSG:5070 Albers implementation reference: https://proj.org/en/stable/operations/projections/aea.html

The production modules are `original_landcover_zonal.mjs`, `original_landcover_transitions.mjs`, `read_original_landcover.mjs` and `run_original_landcover.mjs`. The TIFF reader accepts the maintained unsigned-byte Deflate-strip GeoTIFF and validates its original georeference and byte layout. It rejects unexpected source classes during the actual cell calculation.


## Existing native fractional-area report

The application's maintained `model.landcover_cli` supplies the final polygon/pixel intersection ledger and portable HTML/CSV/raster report. It already uses Rasterio, GEOS and PROJ, checkpoints completed windows, and resumes an interrupted run. Reuse the current native application and the existing original 217-watershed GeoJSON with its actual CRS:

```sh
/opt/pyvenv/bin/python -m model.landcover_cli run \
  --baseline /actual/source/land-cover-2023.tif \
  --scenario observed_2025=/actual/source/land-cover-2025.tif \
  --zones /actual/source/original-217.geojson \
  --zone-crs EPSG:3857 \
  --support pair --tile-size 512 \
  --output /actual/project/results/landcover-fractional-2023-2025 \
  --title "Upper Savannah observed annual land cover 2023–2025"
```

Use the CRS of the actual derived GeoJSON; if the existing native geometry is already EPSG:5070, declare EPSG:5070. The original Esri JSON is preserved separately. Where conversion is needed, the existing `model.spatial_esri.OriginalEsriFeatures` reader provides each feature's original properties, native geometry and geometry-operation metadata. Retain its original decoded hash, reader-source hash and per-feature operation records with the derived geometry.

```sh
/opt/pyvenv/bin/python -m model.landcover_cli pack \
  /actual/project/results/landcover-fractional-2023-2025 \
  /actual/project/delivery/landcover-fractional-2023-2025.zip
/opt/pyvenv/bin/python -m model.landcover_cli receive \
  /actual/project/delivery/landcover-fractional-2023-2025.zip \
  /actual/project/received/landcover-fractional-2023-2025
```

The native ledger weights boundary cells by their exact intersection with the polygon. The Node companion assigns full native cells by centre inclusion. Both retain the original class values and paired valid-data cohort; their boundary areas express these two documented accounting methods.

## Retained coordinate operation

The actual native transformation was returned at
https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791874776189589 .

```text
proj=pipeline
step inv proj=webmerc lat_0=0 lon_0=0 x_0=0 y_0=0 ellps=WGS84
step proj=aea lat_0=23 lon_0=-96 lat_1=29.5 lat_2=45.5 x_0=0 y_0=0 ellps=GRS80
```

Original point: `[-9231631.8728, 4187362.152400002]`.
Native result: `[1176760.6723355297, 1427167.8254433053]`.
The source module records the operation, original control and numerical comparison independently from its stated 4 m geographic accuracy.
Web Mercator equations: https://proj.org/en/stable/operations/projections/webmerc.html
