# Annual NLCD 2025: complete native regional source

Operation: `ECOSYSTEM-SCIENCES-NLCD-READER-20261013`.

This directory contains the actual USGS Annual NLCD 2025 categorical raster for the complete Upper Savannah model source extent. The 6,443 by 6,319 grid contains 40,713,317 original cells and covers the retained 217-HUC12 domain plus its selected 1,000 m buffer. All 49 source tiles completed, with zero missing cells.

## Use the completed checkout

From the application root, the actual files are:

- Raster: `source/annual-nlcd-native-20261013/source/land-cover.tif`
- Ordinary Workspace source manifest: `source/annual-nlcd-native-20261013/source/source-manifest.json`

The TIFF is 9,443,751 bytes, SHA256 `3fa517b4cc3251b9e1bd31e51b54b036a875c09e5f1075511da7c8e951656670`. It is already present in the checkout. A normal source import can use this manifest immediately:

```python
from model.workspace import Workspace
ws = Workspace(ACTUAL_PROJECT_WORKSPACE)
collection = ws.import_sources(
    "source/annual-nlcd-native-20261013/source/source-manifest.json"
)
print(collection["id"])
```

Use the current project's actual Workspace path. The source ID is `usgs-annual-nlcd-2025-native-region-3fa517b4cc3251b9`, role is `NLCD`, units are `class`, and resampling is `nearest`.

## Continue the existing native soil operation

Select this completed raster as the reference for the maintained A74F source finalizer, preserving the existing original soil capture and selected output directory:

```sh
python -B -m source_tools.soil_region prepare \
  --capture "$UPSTATE_REGIONAL_SOIL_CAPTURE" \
  --reference source/annual-nlcd-native-20261013/source/land-cover.tif \
  --output "$UPSTATE_SOIL_PREPARED" \
  --null-policy nlcd-water-zero
```

The maintained soil coverage programme follows the same actual reference and original domain. The native NDR/SDR source intake then uses the resulting ordinary source editions.

## Native grid and actual source time

The source time is exactly `2025-01-01T00:00:00.000Z`. The CRS is EPSG:5070 and the affine coefficients are:

```json
[29.999999995403137, 0, 1114859.9994590343, 0, -30.000000026127967, 1428209.9983569037]
```

The national grid window starts at column 117682 and row 62887. GeoTIFF PixelIsArea is explicit; NoData is the published nil value 250. The full rectangular source has no nil pixels. Its original 217-feature domain is bound by decoded Esri JSON SHA256 `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`.

The provider requests retain the published native CRS, exact pixel-edge bounds and cell counts, explicit year, and nearest-neighbour interpolation. A fully qualified source layer and discrete SLD `ColorMap type="values"` encode each class as RGB(class, 0, 0); NoData uses transparent 250. The decoder checks original lossless PNG chunks, palettes, alpha and CRC values. The retained final discrete style avoids the one-code quantization observed in an earlier continuous colour ramp.

The independently queried changed cell is class 81 in 1985 and class 23 in 2025; both actual discrete PNGs agree. A second original point returns 43 and matches the 2025 PNG. All 4,096 cells in the small probe match the corresponding cells of the 1,024-square regional tile.

## Zonal analysis

The accompanying `source_tools/original_landcover_zonal.mjs` and `source_tools/ORIGINAL_LANDCOVER_ZONAL.md` provide native cell-centre class counts and area by the original HUC12 polygons. Select the actual source CRS from those original geometries. The completed `class-area.csv` here describes the full rectangular raster extent; polygon-domain and HUC12 totals are separate calculations.

## Retained original source and replay

`source/plan.json` retains all 49 exact provider URLs, original PNG hashes, decoded tile hashes, source-description identity, original document references, and grid. All 11,252,658 original PNG bytes remain in the seven source-row documents and original probe notebook; the plan identifies each document and its selected tiles. Normal DOCX exports retain the original PNG dimensions and bytes regardless of display size.

`decode_png.mjs` and `write_geotiff.mjs` are the executed byte decoder and TIFF writer. The decoder accepts a zlib inflate function, such as Node's `inflateSync`. The TIFF writer accepts verified compressed strips and writes AdobeDeflate GeoTIFF with the original GeoKeys, metre units and PixelIsArea. `source/validation.json` preserves point/year checks, the exact overlap result, TIFF tag checks, and full published-source replay.

The corrected serialized TIFF was inflated and compared cell-for-cell against freshly decoded original PNGs for all 49 tiles: 40,713,317 matched cells, zero mismatches, zero unexpected class-0 cells, and zero source NoData cells.

The previous `a9f6bfed…` file contained a zero rectangle because tile 24's cached typed array lost its length across persistence. Replaying its published bytes reproduced that defect. This edition rebuilds the affected strip from the original PNG, records the exact correction in `validation.json`, and verifies the actual final serialized pixels. Earlier Page-strip volumes are historical and are superseded by this complete raster.

To verify and retain this exact edition in a separate project source directory:

```sh
python -B source/annual-nlcd-native-20261013/receive.py \
  --raster source/annual-nlcd-native-20261013/source/land-cover.tif \
  --output /actual/project/sources/nlcd-2025-native-corrected
```

The standard-library receiver checks the whole TIFF, every compressed and decoded strip, actual categorical totals, and georeference before retaining the complete source manifest.

Original provider: https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms

GeoTIFF georeferencing: https://docs.ogc.org/is/19-008r4/19-008r4.html
