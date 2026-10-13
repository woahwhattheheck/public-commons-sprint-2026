# InVEST 3.20 output interpretation

This source asset defines the meanings shared by the Upper Savannah producer, operator panel, map renderer, and report exports. Read `invest320_output_semantics.json` for machine-readable filenames, native registry IDs, units, roles, and calculation rules. The registry targets InVEST 3.20.0 and consumes its existing outputs.

## Annual mass and area

Final NDR rasters report nitrogen or phosphorus in kg/ha/year. Final SDR mass rasters report metric tonnes/ha/year. Native watershed vectors already contain annual mass totals: NDR uses `watershed_results_ndr.gpkg`; SDR uses `watershed_results_sdr.shp` with its sidecars. Some native MODEL_SPEC declarations omit the time denominator; the registry preserves the declared metadata separately from annual reporting units. Both native aggregation routines multiply raster sums by hectares per pixel. [NDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py) · [SDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py)

Integrate a density with `sum(value * included_cell_area_m2 / 10000)`. A 30 m square cell contributes 0.09 ha. The mean density is the annual total divided by valid included hectares. A raw pixel-value sum is an intermediate arithmetic quantity; it is not an annual total. Apply no second area multiplier to native vector totals. Use projected metre units. For a general affine grid, pixel area is `abs(a*e-b*d)`.

Exact reconciliation with native totals uses native selected-pixel semantics. Fractional polygon intersections provide another valid reporting convention, but produce different boundary-cell weights. Record the convention. Utility watersheds may overlap or nest: compute their totals independently and compute a regional total from a dissolved union or disjoint partition.

## Conservation service and intervention benefit

Existing conservation service describes what present cover contributes. SDR `avoided_erosion` expresses local soil protection relative to a bare-soil reference. `avoided_export` combines local prevention weighted by delivery ratio with sediment trapped from upslope. These support conservation decisions. High baseline `usle` and `sed_export` identify local soil-loss and downstream-source concerns that can support restoration decisions. [SDR interpretation](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html#evaluating-sediment-retention-services)

Intervention benefit answers a different question: how much does the proposed scenario change delivery? For each pollutant use `baseline_export - scenario_export`; positive values mean lower modeled export. A successful upstream source reduction can also reduce downstream trapping because less sediment arrives. Therefore, a decline in trapping alone does not indicate a poorer scenario. Run a combined intervention portfolio before giving its total benefit; interacting scenarios are not reliably additive.

## Nutrient meanings

NDR maps source contributions to streams. `n_total_export` equals surface plus subsurface nitrogen export. Phosphorus has surface export only. `surface_load_n`, `sub_load_n`, and `surface_load_p` are runoff-adjusted source loads; raw `load_n` and `load_p` precede runoff adjustment. Application-rate loading coefficients are first adjusted by on-cell efficiency, while measured-runoff coefficients are used directly. [NDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py)

At watershed scale, source-attributed retention is nitrogen surface load plus subsurface load minus total export, or phosphorus surface load minus surface export. Pixel load-minus-export locates the source whose load is retained somewhere along its downslope path; it does not map the location doing the retention. Effective-retention and NDR rasters are dimensionless diagnostics. For regional delivered fractions, divide aggregate export by aggregate load on matched support. [NDR interpretation](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html#evaluating-nutrient-retention-services)

## Sediment meanings and arithmetic

On common valid pixels:

- `avoided_erosion = rkls - usle`
- `sed_export = usle * sdr_factor`
- `e_prime = usle * (1 - sdr_factor)`
- `avoided_export = avoided_erosion * sdr_factor + sed_deposition`

The source partition is `usle = sed_export + e_prime`. Sediment deposition describes a receiving location, whereas `e_prime` describes a source contribution retained downstream. Inside an arbitrary polygon, boundary transfers mean deposition need not equal local soil loss minus export. The routed `f.tif` field can represent the same material at successive cells and must not be summed as a regional retention service. [SDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py)

## Coverage and scenario comparison

Keep finite zero, pollutant not run, missing output, and all-NoData distinct. Return a null total for no valid data. SDR intentionally masks some stream cells; classify those separately from missing inputs and terrain disconnected from the modeled stream network. Use `stream.tif`, `stream_and_drainage.tif` when present, and `intermediate_outputs/what_drains_to_stream.tif` to explain coverage. [SDR coverage](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html#defined-area-of-outputs)

Retain native/full-valid totals and comparison totals separately. A multi-scenario ranking uses the common valid mask across its declared scenario cohort for each pollutant. Report common area and each run's excluded area. Source retention also needs matched load/export support; unrouted source cells must not silently become retained mass.

Use `scenario - baseline` for signed change and `baseline - scenario` for avoided pollution. Divide by a strictly positive baseline for percentages. If baseline is zero, return null percentage with `zero_baseline_unchanged` or `zero_baseline_new_load`, preserving absolute change. Keep nitrogen, phosphorus, and sediment separate.

Record the model version, source profile, raster grid, domain, DEM, routing, stream threshold, runoff reference, and actual scenario dimensions. The `runoff_proxy_av` input fixes the normalization reference when needed. Label changed source profiles and intentional climate effects. The models describe long-term annual hillslope/nonpoint delivery to streams; a utility catchment total is an upstream modeled contribution. Intake concentration additionally requires appropriate flow and timing data. [NDR model](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html#the-model) · [SDR model](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html#the-model)

## Source identity

- NDR 3.20.0: `src/natcap/invest/ndr/ndr.py`; Git blob `f518b2867d4a327675fcb1c9b4ba56f29b12188d`.
- SDR 3.20.0: `src/natcap/invest/sdr/sdr.py`; Git blob `0cac27add172011df367ff8026427dbbdbcda5b2`.
- Public source and guide retrieval: 12 October 2026. The current user-guide build is `3.20.3.dev4+ug.gda7852b01`; pinned 3.20.0 source governs filenames and native registry definitions.

Integration paths: `model/invest320_output_semantics.json` and `model/OUTPUT_INTERPRETATION.md`.
