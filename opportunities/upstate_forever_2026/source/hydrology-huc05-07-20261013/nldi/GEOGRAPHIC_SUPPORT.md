# Original gauge and whole-catchment applicability

This geographic continuation compares the thirteen original NLDI station locations with all thirteen published upstream whole-catchment geometries. It runs directly on the retained GeoJSON longitude/latitude coordinates. The original NWIS location and declared NAD83 datum remain separate fields in each station summary.

## Computed source relations

The complete result has 169 point/catchment pairs: 48 inside and 121 outside. Eleven station locations are inside their own supplied whole-catchment polygon. Two original station locations are outside their own supplied geometry:

| Original station | NLDI reach measure | Original NLDI longitude, latitude | Closest retained boundary coordinate |
|---|---:|---|---|
| USGS-02196690 — Horse Creek at Clearwater, SC |0| -81.90761399,33.4781928 | -81.905913072,33.483522925 |
| USGS-021968385 — Butler Creek below Butler Creek Reservoir at Fort Gordon, GA |0| -82.09873889,33.42509167 | -82.09869727757584,33.425847679971554 |

These relations preserve each original station, COMID, reach code/measure, daily-series ID, point response and unsplit whole-catchment response. The point coordinates and published basin geometry remain available together through the same native source collection. The closest-boundary columns describe the original longitude/latitude coordinate plane; native projected-CRS analysis supplies physical distances and areas.

The station/catchment membership matrix describes location within the supplied geometry. Select the original network and exact gauge-split source edition when comparing network connections or discharge support at a specified outlet. Both measure 0 endpoint records remain visible alongside their original support relation.

All 169 relations were computed on the exact retained source bodies. An independent winding-number calculation agreed on every inside/outside classification. The production module preserves polygon components and holes, classifies boundary cases explicitly, and records the source SHA256 on every pair. The published source provides the unsimplified upstream whole catchment with splitCatchment=false.

## Inspect the products

- derived/gauge-catchment-membership.csv contains all 169 point/catchment pairs, including outside relations and original point/basin hashes.
- derived/gauge-catchment-applicability.csv contains the thirteen station summaries, original NLDI and NWIS positions, source datum, measure, own-basin relation and containing-basin IDs.
- derived/gauge-catchment-applicability.json carries the same complete data, counts and declared coordinate/support interpretation.
- geographic-support-sources.json registers these source-derived products in the existing Workspace. Its companions preserve the original 26 responses, existing native source views, capture records and both reproducible processors.

## Reproduce and receive

From this retained nldi directory:

```sh
node rebuild_geographic_support.mjs "$PWD" /owned/rebuilt-catchment-support
```

The processor verifies the original binding and basin bodies by byte count and SHA256, then writes deterministic source products. Existing identical files are reused. A different source edition requires a separate output directory.

From the complete application:

```sh
"$PYTHON" -B -m model.cli --workspace "$WORKSPACE" source-import source/hydrology-huc05-07-20261013/nldi/geographic-support-sources.json
```

Use original nldi-daily-flow-gauge-locations-20261013 and nldi-daily-flow-whole-catchments-20261013 to open the retained vectors in Spatial review. Join the applicability tables through station_id, basin_id and ts_id. The original 217-HUC polygon source and its 49-HUC parent selection retain their own complete geometry and native selectors for the subsequent domain overlay.

## Original sources

The unchanged source requests and responses are recorded by capture-manifest.json and the existing model-sources.json. The basin request uses the original USGS endpoint with simplified=false and splitCatchment=false:

https://api.water.usgs.gov/docs/nldi/basin/
