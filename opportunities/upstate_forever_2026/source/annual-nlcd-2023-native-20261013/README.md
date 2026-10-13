# Original 2023 land cover on the complete native model grid

The actual `source/land-cover.tif` contains all 40,713,317 native cells for the same Upper Savannah source grid as the corrected 2025 edition. CRS, affine coefficients and dimensions are identical; the explicit provider time is 2023-01-01T00:00:00.000Z.

- Raster: 8,931,261 bytes, SHA256 `d7db3a30d6595aa8da28b5e81dc5b84e7e0bf198b860543ac32c702328871fc5`.
- Source manifest: `source/source-manifest.json`, ordinary `upstate.sources/v1`, role `NLCD`.
- Source ID: `usgs-annual-nlcd-2023-native-region-d7db3a30d6595aa8`.
- Original domain: 217 HUC12 features, decoded Esri JSON SHA256 `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`.
- Source selection: published EPSG:5070 native 30 m grid; full original domain plus the selected 1,000 m buffer.

All 49 original PNG captures completed. The final serialized TIFF was inflated and compared against independently decoded original PNGs: 40,713,317 exact matches, zero mismatches, zero unexpected class-0 cells and zero source NoData cells. The retained plan binds every request, PNG and decoded tile hash; the seven original source documents retain the actual PNG bytes.

Import the adjacent source manifest into the current Workspace. For a separate verified source directory, run this edition's standard-library receiver:

```sh
python -B source/annual-nlcd-2023-native-20261013/receive.py --output /actual/project/sources/nlcd-2023-native
```

This source matches the calendar year of the 2023 Eighteenmile observations. The paired results under `observations/landcover_2023_2025` compare original product classes on identical cells. They preserve the complete rectangular source separately from the original 217-HUC union and each watershed. A changed class does not by itself establish cause or a precise within-interval event date.

The shared executed PNG decoder and TIFF writer are retained in `source/annual-nlcd-native-20261013`. Original provider: https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms .
