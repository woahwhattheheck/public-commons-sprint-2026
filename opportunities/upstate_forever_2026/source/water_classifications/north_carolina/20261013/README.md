# North Carolina Savannah designated-water source

This complete source family joins the NC DEQ Savannah hydrologic and alphabetic classification schedules to all103 original Savannah-labelled classified stream features. It preserves237 native polyline paths and32,145 vertices in EPSG:32119. All103 source indices, names, complete reach descriptions, exact compound classes and effective dates agree across the independent schedule and native attribute sources.

## Use in the maintained water review

The registry is `derived/classification-registry.json` (`upstate.classified-water-registry/v2`). The maintained crosswalk accepts this directory as `--capture`, `mapping.json` as its original field mapping and the registry as a legal source. Use the shared jurisdiction-aware engine and the retained original reporting/HUC geography. The publisher query `Name='Savannah'` defines the captured cohort; actual reporting-area and217-HUC intersections are computed from the complete geometry.

Each mapping is explicit: BIMS_Class, BIMS_Name, BIMS_Descr, BIMS_INDEX and BIMS_Date. No county or HUC field is inferred. Exact jurisdiction + system + original index + full class supports a candidate legal association; geometric coextensivity is retained separately.

## Rebuild

From this directory, run `node build-nc-source.mjs`. It reads every original JSON body and the two retained PDF text extractions, checks the original hashes and exact IDs, reconstructs wrapped schedule descriptions, reconciles every row, then writes the registry, readableCSV, native capture, field mapping and reconciliation summary. The same pure module was executed against this entire original source family before publication.

## Class interpretation

All14 original labels retain their punctuation. For example, `C;Tr,ORW` remains that exact source class; Tr and ORW are separate components. The `+` and `@` symbols identify downstream management strategies and remain separate from designated HQW/ORW components. The screening predicate matches Tr, HQW or ORW directly:84 of103 records.32 records carry a management marker; these groups overlap. The UI displays the original source class, effective date and index alongside the derived components.

## Source editions and originals

Edition status is `source-published`. The alphabetic schedule carries the original printed timestamp `2016/03/03 9:26:10`; capture date is13October2026. Native metadata retains dataLastEditDate1773841052625 and its older descriptive prose independently. Per-record effective dates agree exactly with the original BIMS epoch dates. Source publication, record effective date and retrieval time are separate fields.

The complete original native service metadata, count, object-ID inventory, independent attributes and21 geometry responses are retained unchanged under `original/`. Metadata before and after capture is identical. `source-manifest.json` records exact URLs, source bytes, hashes, original PDF attachment handles and the complete capture inventory.

- [NC DEQ schedule index](https://www.deq.nc.gov/about/divisions/water-resources/water-planning/classification-standards/river-basin-classification-schedule)
- [Original hydrologic PDF](https://www.deq.nc.gov/water-quality/planning/csu/surface-water/river-basin-water-quality-classifications-dec-9-2013/savannah-hydro-order/download)
- [Original alphabetic PDF](https://www.deq.nc.gov/water-quality/planning/csu/surface-water/river-basin-water-quality-classifications-dec-9-2013/savannah-alpha-order/download)
- [Original classified-stream service](https://services2.arcgis.com/kCu40SDxsCGcuUWO/arcgis/rest/services/SurfaceWaterClassifications/FeatureServer/0)
- [Retained original PDFs and service captures](https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e)

The originalPDF files are preserved in the source collection above. The repository's `extracted/` files are explicitly labelled indexed text extractions, with PDF pages and line positions retained for each registry record.
