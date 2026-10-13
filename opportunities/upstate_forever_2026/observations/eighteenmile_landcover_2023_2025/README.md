# Eighteenmile original whole-catchment land cover, 2023–2025

The retained original USGS NLDI polygon for gauge **USGS-02186702** selects **143,520 native cells / 12,916.800009 ha**. Both annual rasters contain a valid original class in every selected cell. **5,382 cells (484.380000 ha; 3.75%)** change class between the 2023 and 2025 Annual NLCD products.

## Actual footprint

This is the original `simplified=false&splitCatchment=false` whole upstream catchment polygon, not a point-specific split basin. The gauge is partway along its indexed reach, so this footprint includes the local catchment portion downstream of the gauge. Keep that limitation when comparing upstream loads or gauge flows. Original source: https://api.water.usgs.gov/nldi/linked-data/nwissite/USGS-02186702/basin?f=json&simplified=false&splitCatchment=false . The complete 13,935-byte GeoJSON is retained, SHA256 `097050d2b09e371feb2dbcf3fe1d2fba90730086db45d4a90be514706145dc88`, one original polygon/ring and 480 vertices. Its geographic coordinates are EPSG:4326.

The computation uses the same maintained native scanline engine as the 217-HUC analysis. Generic basin identifiers are carried as `basins[].basin_id`. WGS84 longitude/latitude is transformed by the documented inverse NAD83/WGS84 (1) null shift followed by GRS80 Conus Albers, matching the native coordinate operation used for the original project domain; that operation's stated accuracy is 4 m. Areas count 30 m pixel centres, with half-open scanline edges and even-odd ring parity. They are distinct from the existing native fractional boundary-area ledger.

## Measured annual class changes

| Group | 2023 ha | 2025 ha | Net ha |
| --- | ---: | ---: | ---: |
| Developed (21–24) | 4,154.94 | 4,291.02 | +136.08 |
| Forest (41–43) | 5,747.31 | 5,696.10 | −51.21 |
| Agriculture (81–82) | 2,251.35 | 2,218.59 | −32.76 |
| Wetlands (90/95) | 240.57 | 239.76 | −0.81 |

Forest-to-developed crossings account for **45.54 ha**, agriculture-to-developed for **33.57 ha**, and grass/herbaceous-to-developed for **56.61 ha**. These are actual annual product classifications on identical cells. The transitions alone do not establish the cause, the date of change within the interval or classification accuracy. The full 16×16 matrix and 9×9 grouped matrix retain every zero and nonzero transition.

## Reproduce and import

After receiving both original rasters through the existing source manifests, run from the actual application root:

```sh
node source_tools/run_basin_landcover.mjs --recipe observations/eighteenmile_landcover_2023_2025/analysis-recipe.json --application-root . --output NEW_OUTPUT_DIRECTORY
```

The runner binds the original polygon, source manifests, exact TIFF identities and grid, calls the maintained analysis functions, reconciles every paired marginal to its independently computed annual result, and compares the three complete computed JSON bodies with the retained result hashes before writing. The ordinary `model-sources.json` in this directory imports the original footprint and complete result tables into the same project.

Both original TIFFs were previously checked against all 49 retained original source PNGs, cell for cell. The generalized maintained core was also run again on the original 217-HUC domain: the entire 2025 annual result and complete paired result remained byte-identical to the published originals.
