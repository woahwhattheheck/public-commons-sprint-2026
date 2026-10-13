# Original 2023 to 2025 land-cover changes by 217 HUC12s

These completed results use the actual original 217 Upper Savannah HUC12 polygons and both complete native Annual NLCD rasters. All 273,049 original polygon vertices are retained. The declared original CRS is EPSG:3857; the conversion reproduces the native PROJ operation supplied by the current project owner, with its stated 4 m operation accuracy recorded separately from numerical agreement.

## Completed watershed result

The union selects **20,949,527 native cells**, representing **1,885,457.431353 hectares** by the original pixel-area determinant. There are **zero overlapping selected cells and zero NoData cells**. The sum of all 217 HUC selections equals the independently counted union.

From 2023 to 2025, **1,089,063 cells changed source class**, or **5.1985087778%** of the union, covering **98,015.670070 hectares**. The remaining **19,860,464 cells** retain the same class. Each HUC's transition-matrix row and column margins exactly match its independently calculated annual class inventories.

These are changes between annual product classifications. They do not identify a physical cause, an exact date within the interval, or the classification accuracy. Use the complete matrices and original class definitions when interpreting them.

## Domain class groups

| Group | 2023 ha | 2025 ha | Net ha |
| --- | ---: | ---: | ---: |
| developed | 214013.34 | 218483.91 | 4470.57 |
| forest | 1102546.26 | 1084330.71 | -18215.55 |
| agriculture | 321445.53 | 320644.89 | -800.64 |
| wetlands | 44088.12 | 44121.96 | 33.84 |
| shrub | 51978.69 | 56207.16 | 4228.47 |
| grass | 68325.30 | 78012.18 | 9686.88 |

The largest individual transitions are evergreen forest (42) to grassland/herbaceous (71), **25,840.62 ha**; grassland/herbaceous (71) to shrub/scrub (52), **21,018.06 ha**; and shrub/scrub (52) to evergreen forest (42), **15,219.00 ha**. These directions are preserved separately in the complete matrix.

## Watersheds with the largest changed share

| HUC12 | Original name | Changed cells | Changed share |
| --- | --- | ---: | ---: |
| 030601030704 | Middle Fishing Creek | 14093 | 17.0512% |
| 030601070205 | Log Creek | 11243 | 16.0787% |
| 030601070104 | Town of Breezewood-Beaverdam Creek | 5360 | 15.3248% |
| 030601070105 | Upper Cuffytown Creek | 15374 | 14.9958% |
| 030601070204 | Mountain Creek | 9991 | 13.2235% |
| 030601070303 | Key Branch-Stevens Creek | 9216 | 12.8534% |
| 030601070103 | Lower Hard Labor Creek | 9483 | 12.2241% |
| 030601070207 | Chap Branch-Beaverdam Creek | 15187 | 12.0830% |
| 030601050206 | Kemp Creek-Little River | 11575 | 12.0165% |
| 030601030512 | Upper Little River | 11887 | 11.8747% |
| 030601060105 | Llyod Creek-Savannah River | 16792 | 11.7033% |
| 030601030702 | Newford Creek | 11167 | 11.6549% |
| 030601070304 | Cedar Creek | 6608 | 11.5975% |
| 030601070102 | Middle Hard Labor Creek | 8880 | 11.5927% |
| 030601040504 | Dry Fork Creek | 20676 | 11.4393% |

## Scope and method

The pixel-centre rule uses half-open scanline edges and even-odd ring parity, preserving interior rings. Polygon edges connect the transformed original vertices. Every original polygon fits inside the actual native raster. Both rasters have the same exact dimensions and affine coefficients, so each paired value refers to the same original cell.

The full rectangular source has 40,713,317 cells and 1,970,699 changed cells (4.8404285016%). Those rectangle totals are distinct from the 217-HUC union above. They are retained separately in the JSON results.

The existing native land-cover ledger can additionally calculate fractional polygon/pixel boundary areas. Those boundary-weighted areas are a separate method from the explicit cell-centre statistics here.

## Files and reuse

- `annual-2023.json` and `annual-2025.json`: complete full-raster, union and per-HUC inventories with original polygon attributes.
- `transitions-2023-2025.json`: complete 16 by 16 matrix for each of 217 HUCs, the union and rectangle; class margins and grouped transitions.
- `annual-huc12-classes.csv`: both annual class inventories.
- `huc12-change-summary.csv`: all 217 watersheds ranked by changed share.
- `huc12-transitions.csv`: all 55,552 HUC/class-pair rows, including zeros.
- `domain-transitions.csv`, `domain-class-change.csv`, `domain-group-transitions.csv`: complete union tables.
- `analysis-run.json`: source identities, exact computation-module hashes and output checks.
- `model-sources.json`: ordinary source importer manifest for the completed tables and JSON results.

Rasters are retained at `source/annual-nlcd-2023-native-20261013/source/land-cover.tif` and `source/annual-nlcd-native-20261013/source/land-cover.tif`. Use their adjacent source manifests. The original domain decoded SHA256 is `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`. Reproduce with the maintained `source_tools/run_original_landcover.mjs` and the original source geometry.

Source provider: https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms .
