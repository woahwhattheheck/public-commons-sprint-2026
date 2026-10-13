# Parcel quantities and scenario coverage

TokenJunkieLabs | UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012 | ED6E parcel engine

The existing delivery builder prepares the parcel inventory from saved model outputs. Native-block aggregation processes every selected parcel, pollutant layer and alternative. Original source identities, attributes, geometries and overlaps remain part of the same inventory.

## Build and retrieve the inventory

Keep the original parcel source selection in the delivery's `overlays.parcels`, including its source-collection ID, source ID, layer/filter and optional native identity field. Use the existing operator delivery operation or CLI:

```sh
python -B -m model.cli --workspace /absolute/study delivery-build /absolute/delivery-selection.json
```

The delivery selection identifies the completed baseline and alternative run IDs. The parcel calculation reads their retained outputs. To adopt this export revision, save a new delivery selection/version while preserving the selected run IDs; existing completed deliveries keep their original contents.

| File | Content |
| --- | --- |
| `parcel-priorities.gpkg` | Original parcel geometry and attributes, annual quantities, context intersections, priority and per-layer coverage. |
| `parcel-priorities.csv` | The same property fields for filtering and review. |
| `parcel-scenarios.csv` | One row per parcel, alternative and pollutant, with annual totals, paired change and each input's modeled support. |

Delivery consumers must retain every entry in `inventory["files"]`, including `scenario_csv`. The original CSV/GPKG roles and existing columns remain available.

## Interpret quantities and coverage

Nitrogen and phosphorus totals use kilograms per year. Sediment totals use metric tonnes per year. The input rasters already contain mass per pixel per year, so the inventory sums those values directly without another cell-area multiplication.

A real total of zero remains numeric zero. When no selected cell has a finite unmasked value, the total is null in the GeoPackage and empty in the CSV. A small parcel can have positive polygon area and no selected 30 m cell centre; its geometry and identity remain with zero selected pixels.

The original `priority_mean`, `valid_pixels` and `coverage_fraction` describe the combined priority raster. Each pollutant additionally has `<pollutant>_valid_pixels`, `<pollutant>_coverage_fraction` and `<pollutant>_valid_area_ha`, where the pollutant is `nitrogen`, `phosphorus` or `sediment`. `selected_pixels` counts raster cell centres in the parcel's reporting-area intersection.

`reporting_area_ha` is the actual clipped polygon area. Raster support areas are cell counts multiplied by actual projected pixel area. These measures describe different geometric supports, especially at boundaries and for small parcels.

## Scenario table

Every record binds `feature_id`, `scenario_run_id` and `pollutant`. The inventory also identifies the comparison, baseline run and alternative run IDs.

| Fields | Interpretation |
| --- | --- |
| `baseline_total`, `scenario_total` | Each run's sum on its own finite modeled cells inside the parcel. |
| `change` | Sum of the native difference raster: alternative minus baseline on paired valid support. Positive means greater modeled export; negative means lower export. |
| `units` | `kg/year` for nitrogen and phosphorus; `t/year` for sediment. |
| `polygon_area_ha` | Parcel area within the reporting polygon. |
| `selected_pixels` | Parcel cell-centre selection on the shared model grid. |
| `baseline_valid_pixels`, `scenario_valid_pixels` | Finite unmasked cell counts in the two original mass rasters. |
| `paired_valid_pixels`, `valid_pixels` | Finite cells in the original paired difference raster. |
| `baseline_valid_area_ha`, `scenario_valid_area_ha`, `paired_valid_area_ha` | The corresponding cell counts multiplied by pixel area. |
| `baseline_only_area_ha`, `scenario_only_area_ha` | Valid area supplied by only one run instead of the paired change. |
| `coverage_fraction` | Paired valid cells divided by selected parcel cells. |
| `paired_fraction_of_union_valid_area` | Paired valid cells divided by union-valid cells; null/empty when the union has no valid cells. |

When coverage differs, subtracting the two own-support totals mixes coverage differences with modeled change. Use `change` and paired coverage for the change assessment. The independent totals preserve what each run supplied.

`scenario_changes` retains the original nested sums in the inventory CSV/GPKG. `scenario_coverage` carries support with the same run/pollutant keys. The scenario CSV exposes ordinary rows for consumers.

## Overlaps and portfolio meaning

Every parcel is independent. A pixel inside two overlapping source parcels contributes to both records. A portfolio or regional total must use a spatial union or disjoint partition; adding overlapping parcel totals is not a regional mass balance. The existing `parcel_coverage` metadata separately reports union coverage within the reporting mask.

This inventory preserves the original pixel-centre sampling method. E7A1's fractional-cell conservation quantities are a separately identified measure. Preserve each method's support and area meaning when integrating the two; do not relabel a centre-sampled quantity as fractional-cell integration.

## Processing and consumer integration

`model/parcel_aggregate.py:aggregate_layers` accepts already-open, aligned, single-band Rasterio sources and parcel geometries in their CRS. It returns one statistics record per original geometry position for every selected layer and actual processing metadata. Record positions remain stable.

The reducer indexes geometry, traverses native blocks and reads every useful block once per layer. Layers with different block layouts retain their original grouping and summation order. Per-layout selected-cell counts are preserved independently. Polygon masks are shared across layers within memory-sized chunks; all selected data are processed.

`processing` records layer count, block layouts, visited blocks, parcel/block candidates, mask evaluations, raster reads, pixels read and elapsed seconds on the actual worker.

The `parcel_inventory` call and `upstate.parcel-priorities/v1` schema remain. Additional scalar fields, scenario CSV, comparison identities and processing metadata extend the existing interface. The conservation and regional summary lanes can consume it through the same delivery.

Original source base: `7c4223a111581935b494d5ac4b9357ef86992d67`; preserve later compatible shared-file edits when integrating these three leaves. No `delivery.py`, operator, scenario-summary or conservation path is replaced by this source package.

Primary APIs: [Rasterio native blocks](https://rasterio.readthedocs.io/en/stable/topics/windowed-rw.html), [Rasterio polygon masks](https://rasterio.readthedocs.io/en/stable/api/rasterio.features.html), [Shapely spatial indexing](https://shapely.readthedocs.io/en/stable/strtree.html).
