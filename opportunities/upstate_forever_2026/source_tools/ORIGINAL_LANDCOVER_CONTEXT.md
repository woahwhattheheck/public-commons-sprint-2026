# Original watershed land-cover report and scientific delivery

The complete original-grid zonal result can enter the existing **Original sources → Review retained reports** workflow and the ordered **Maps and delivery** scientific-report picker. The receiving command produces one ordinary `OBSERVED_CONTEXT` source. Its report includes domain class areas, the complete watershed summary, all individual watershed/class rows, original coverage and source/method records.

## Original inputs

Use the exact complete `upstate.landcover-zonal-summary/v1` JSON returned by `original_landcover_zonal.mjs`, with the SHA256 recorded by its producing operation. Retain the unchanged raster `source-entry.json` and its adjacent original `class-area.csv` from the selected original source edition. The command verifies that CSV against the original companion descriptor and compares every full-raster class count with it.

Both retained annual source formats are accepted without rewriting their CSVs. The 2025 header is `class_code,cells,area_ha,scope`; its scope must remain `rectangular_native_source_grid`. The original 2023 header is `class_code,cells,area_m2,area_ha`; both area columns are checked against the unchanged native affine determinant. In either format, the exact companion hash and complete raster cell count bind the histogram to the original source rectangle. For 2023, use `observations/landcover_2023_2025/annual-2023.json` with `source/annual-nlcd-2023-native-20261013/source/source-entry.json` and its adjacent `class-area.csv`. That source entry retains TIFF SHA256 `d7db3a30d6595aa8da28b5e81dc5b84e7e0bf198b860543ac32c702328871fc5`. Each annual report remains its own selectable source edition; the paired change report keeps its original two-year comparison.

The unchanged annual JSON written by current `run_original_landcover.mjs` is accepted directly. Its retained metadata uses `sha256`, `domain_sha256` and `source_uri`, with the original `source_id`, `raster_bytes`, `epsg`, numeric `year` and `nodata`. The receiving command verifies those values against the raster entry. An original in-memory `summarizeRows` result may instead use `raster_sha256`, `polygon_body_sha256` and `source_urls`. If both names are present, every value must match the original source; conflicting aliases are rejected. No metadata rewrite or numerical replay is required.

The report displays the original structured coordinate-operation description, CRS pair and stated accuracy. For the current EPSG:3857 original domain this includes the retained native operation's stated 4 m accuracy. The complete original pipeline and native control point remain in `original-zonal.json`.

The 2025 full regional raster is the corrected PR3387 edition: 9,443,751 bytes, SHA256 `3fa517b4cc3251b9e1bd31e51b54b036a875c09e5f1075511da7c8e951656670`. Its decoded original 217-HUC polygon source has SHA256 `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`. The source entry carries the native affine, dimensions, product time and original domain count. Receiving compares these fields with the completed calculation before writing a report.

## Produce the complete source edition

From the full current application:

~~~sh
node source_tools/original_landcover_context_cli.mjs \
  --zonal /actual/original-zonal-summary.json \
  --zonal-sha256 ORIGINAL_ZONAL_RESULT_SHA256 \
  --raster-entry source/annual-nlcd-native-20261013/source/source-entry.json \
  --output /actual/new-landcover-report
~~~

Use a new output directory in its existing parent. The command retains all three input bodies exactly, creates the searchable grayscale HTML report, all CSV tables, scientific delivery recipe and import manifest. It reports the resulting source ID, actual watershed/class-row counts and domain support. The command does not rerun the raster calculation.

| Member | Content |
| --- | --- |
| `landcover-report.html` | Searchable complete HUC12/name table, original domain classes, coverage, method and downloads. |
| `watersheds.csv` | Every original watershed, valid area, NoData, forest/developed/agriculture shares. |
| `watershed-classes.csv` | Every original watershed and all 16 separate native classes, with exact counts and areas. |
| `original-zonal.json` | Unchanged complete original calculation body. |
| `raster-source-entry.json` | Unchanged original raster source entry. |
| `class-area.csv` | Unchanged authoritative class counts and areas for the complete source raster rectangle. |
| `observed-report.json` | Maintained scientific report recipe and its bound source companions. |
| `source-manifest.json` | Importable `upstate.sources/v1` document source. |

The program checks unique original HUC12 identifiers, the full declared watershed count, native source identities, affine and dimensions, exact pixel accounting, all 16 categorical rows and their cell areas. Domain totals count the union once. Individual watershed totals preserve original overlaps. Each HUC row covers its complete original polygon, including portions across state boundaries. Forest combines 41–43, developed 21–24, and agriculture 81–82; the separate class CSV retains their original distinctions. Percentages use valid classified cells. Full-raster counts and cells outside the polygon domain remain visible, including the model-context buffer.

CSV consumers should import HUC12 as text to retain its leading zero. The full JSON preserves source properties and identifiers.

## Application assembly

The additive `integration/component_fragments/original-landcover-context.json` component includes this module, CLI, guide and exact archive codec, and requires the original annual analysis plus the existing observed-context and saved scientific-report components. A current full application assembly therefore retains the complete calculation-to-report path while preserving concurrent component additions.

## Continue in the existing Workspace

Import `source-manifest.json` using the existing source importer. Select its document in the ordered scientific-report picker beside the retained observations, model results and watershed context. The current observed-report collector binds every companion and carries these tables and links through the saved scientific delivery and portable Workspace.

The original raster source remains separately selectable as `NLCD` for native models. This document provides its completed source-area interpretation. Existing model runs, management masks, source profiles and their producing identities continue through their existing operations.

For an in-memory source receiver, call `composeOriginalLandcoverContext({zonalBody, rasterEntryBody, classAreaBody, expectedZonalSha256})`. The returned `files` map contains all eight complete byte bodies; `manifest`, `recipe` and `summary` expose the same published edition. This function and its retained codec use standard JavaScript and require no raster-library import.

TokenJunkieLabs.
