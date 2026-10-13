# Matching completed native stages for a combined regional result

The selected-model core prepares NDR and SDR independently. A completed NDR run can therefore have a different grid or profile identifier from the later combined NDR/SDR selection, even when the actual NDR calculation is unchanged. `model/native_equivalence.py` compares the scientific inputs needed for that join.

The maintained native cache owner supplies stage storage and import. This module supplies a comparison that their cache or the completed-model bridge can consume:

```python
from model.native_equivalence import NativeInputMatcher
matcher = NativeInputMatcher(workspace, target_run_id)
nutrients = matcher.compare(completed_ndr_run_id, "ndr")
sediment = matcher.compare(completed_sdr_run_id, "sdr")
```

A land-cover target must first retain its actual scenario raster in its existing `stages.landcover.artifact`. Baseline targets use their original NLCD. This keeps the comparison tied to the raster that the native calculation will actually consume.

## Reuse decisions

`matches` means the native stage has matching source/version, actual grid, model parameters, biophysical values, watershed geometry and physical raster values. A successful match requires the selected native registry exports; SDR also requires its computed `ls` output, because the seven-map delivery retains this original terrain result.

`mass_exports_match` additionally requires all selected converted exports and an equal reporting mask. A native stage may be reusable when the reporting mask differs: reuse its native output and regenerate the annual mass raster on the target reporting mask using the existing conversion.

The comparison checks each model's parameters and biophysical columns. NDR uses its nitrogen/phosphorus loading and retention fields; SDR uses lucode, USLE C and USLE P. CSV ordering, number formatting and unused columns do not change a model's calculation.

Raster hashes provide a fast equality route after retained-file verification. Different file encodings are compared by CRS, transform, dimensions, valid-data masks and numeric values, in native raster blocks. The matcher retains verified-file state during one join, so comparing multiple components does not repeatedly hash the same unchanged target inputs.

GeoPackage byte differences can come from storage metadata. For the maintained single-feature model-domain grid, the fallback compares CRS, feature identity and spatially equal geometry. It preserves the actual watershed footprint while allowing equivalent container encodings.

A completed model stage can be used even if another model in its original run is unfinished. The importer must preserve that stage's original registry files and source run ID. Converted exports are imported only when available and matching; otherwise the normal native completion generates them from the reused stage.

## Integration

Prepare a normal combined grid/profile/run from the actual retained sources. Match and import completed components through the maintained native cache primitive. Keep the normal `run.json` selection and persist `source_run_id` on each imported model stage. Then call the existing `Workspace.run` to execute any model still missing and finalize normal exports.

That ordinary combined baseline and its combined scenarios feed the existing delivery, parcel priorities and baseline/alternative comparison APIs. The source matching class adds no second run or delivery format.

## Primary references

[Shapely spatial equality](https://shapely.readthedocs.io/en/stable/reference/shapely.equals.html) compares spatial footprints even when point ordering differs. [Rasterio windowed reading](https://rasterio.readthedocs.io/en/stable/topics/windowed-rw.html) supports processing full source rasters in their native blocks.

The native version remains InVEST3.20.0. Its [NDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py) and [SDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py) declare per-hectare raster exports. Existing annual mass conversion and units remain unchanged. Scientific interpretation of the resulting source-water priorities needs expert review.
