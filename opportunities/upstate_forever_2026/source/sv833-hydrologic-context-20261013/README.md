# SV-833 original hydrologic network and monitoring context

Open sv833-hydrologic-context.html for the complete offline report and mapped original source context. This is the hydrologic companion to the original 2021–2026 SV-833 concentration study in observations/sv833_2021_2026.

## Reproduce the complete family

Node.js 18 or newer, standard library only. From the application root:

```sh
node source/sv833-hydrologic-context-20261013/build_study.mjs --output /absolute/path/to/new-sv833-hydrology-family
```

The CLI verifies all seven original inputs and writes ten derived outputs into a new application-relative directory. It copies originals, source modules, the unchanged shared CSV parser, this guide, and the app-root native manifest. Existing destination directories are rejected.

## Original observations and requests

The unchanged WQP station catalogue supplies station 21SC60WQ_WQX-SV-833 at longitude-82.636966, latitude 34.704792, WGS84. Six original USGS NLDI responses retained on 2026-10-13 supply:

1. Indexed WQP station feature: COMID 11749277, original coordinate, null reachcode and measure.
2. Coordinate hydrolocation using the exact original station coordinate: the original provided point and indexed reach point; COMID 11749277, reachcode 03060101000028, measure 80.38507527086269.
3. Upstream-with-tributaries NWIS surface-water sites within 100 km: original empty FeatureCollection.
4. Downstream-mainstem NWIS surface-water sites within 100 km:14 original indexed sites.
5. Upstream-with-tributaries original whole flowlines within 100 km:45 unique COMIDs,615 original vertices.
6. Unsimplified whole upstream catchment basin: one Polygon with 273 original vertices, explicit simplified=false and splitCatchment=false.

Exact source queries, byte lengths, SHA256 and roles are in input-manifest.json. Original body content is unmodified. The shared source page is https://app.notion.com/p/3f8dd77231008194832bda8cdd7b6c84.

## Spatial interpretation

The indexed WQP coordinate differs from the original station point by 0.225376 m. The coordinate hydrolocation is 35.235336 m from the original point. Both responses identify the same COMID; the actual original coordinate remains unchanged. All three location representations are native identified point features.

The upstream flowline query returns whole reaches, including the full containing reach. Its geometry can therefore extend downstream of the sample point. The basin likewise includes the complete local catchment and all upstream catchments. It has not been split precisely at the monitoring position. The original and hydrolocated points both lie within this whole-catchment polygon.

The original upstream response contains zero indexed NWIS surface-water sites under the explicit100 kmUT query. This is a statement about that source and request, not a census of all possible monitoring networks. The 14 downstream indexed sites lie in the Seneca/Hartwell/Savannah system. Indexed presence alone supplies no active-operation, parameter or observation-period coverage guarantee.

The closest returned downstream point by great-circle geographic separation is USGS-02187000, Seneca River near Anderson,29.996390 km from SV-833. Geographic separation is not network travel distance. Flow use requires a separate original parameter/date and hydrologic-support check.

## Computation and geometry

Haversine distances use mean Earth radius 6371008.8 m. Original reach-vertex distances sum to62.048540341 km of retained geometric line length. This is derived geometry length, separate from the 100 km navigation search parameter. Point-in-polygon checks use original rings.

Native GeoJSON retains every original coordinate unchanged. Derived layers only add original source path, SHA256, zero-based source-feature index, stable identity and interpretation properties. Basin holes and original geometry types remain preserved. The map uses local equirectangular display separately for each panel, with a longitude/latitude graticule. The right panel shows original site points without an inferred connecting route.

Primary method references:
- https://api.water.usgs.gov/docs/nldi/navigation/
- https://api.water.usgs.gov/docs/nldi/basin/
- https://api.water.usgs.gov/docs/nldi/

## Outputs

| File | Content |
| --- | --- |
| station-location-representations.csv | Original catalogue, indexed WQP and hydrolocation coordinates, measures and separations |
| upstream-reach-inventory.csv | All 45 original COMIDs, geometric lengths, vertex counts, bounds and source pointers |
| downstream-nwis-site-context.csv | All 14 returned original site IDs, names, reaches, measures and geographic separation |
| station-location-representations.geojson | Three distinct station location representations |
| upstream-original-reaches.geojson | All 45 original line geometries with source provenance |
| whole-upstream-catchments.geojson | Full unsimplified original upstream Polygon and explicit whole-catchment support |
| downstream-nwis-sites.geojson | All 14 original indexed site point geometries and source context |
| hydrologic-context-summary.json | Original counts, station identity, distances, geometry support and method decisions |
| sv833-hydrologic-context.svg | Two-panel original network/basin and indexed-site map |
| sv833-hydrologic-context.html | Complete offline report with inline map, source queries and all site rows |

The app-root sv833_hydrologic_context.sources.json registers the full native vector/report/table family with every original and executable companion.
