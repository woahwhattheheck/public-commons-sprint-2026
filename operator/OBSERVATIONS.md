# Original watershed observations and whole-catchment comparisons

The existing observation workflow now carries source methods and uncertainty through a complete retained comparison. It uses the same Workspace, original NDR/SDR outputs, operator tasks, delivery selection and receiving archive.

## Import a source edition

Choose the original or explicitly derived observation CSV in **Observed water quality → Import observations**. A prepared source-method JSON can populate the source URI, annualization method, column mapping and accepted qualifiers. Its complete original bytes, filename, length and SHA-256 remain inside the immutable observation metadata. The selected CSV still passes the original source SHA check when the preparation supplies one.

Required CSV fields map to the original catchment identity, parameter, value and unit. Each admitted load also has its original period and an explicit annual mass-rate derivation. The native parameter names are nitrogen, phosphorus and sediment. Other measurements remain retained context.

Optional fields now include:

| Field | Meaning |
| --- | --- |
| method | The original per-record load estimation or annualization method; otherwise the edition's method is retained. |
| uncertainty | Original uncertainty text or a JSON object/array. The workbench preserves it without inventing an annual confidence interval. |
| source_records | Original contributing record identifiers and source lineage, as text or JSON. |
| qualifier | The exact original source disposition, interpreted only through the selected accepted qualifier set. |

A malformed structured uncertainty field remains its exact source text. Nonfinite JSON tokens are kept as text. Duplicate CSV headers are rejected because they otherwise discard one original column during dictionary parsing.

A USGS seasonal-load preparation must read that release's own units, season definitions, method flags and completeness rules before producing annual records. A four-quarter sum is valid only for the same original station, parameter, annual period and load basis, with every required period present. Original quarterly uncertainty and method choices remain available even when their cross-period covariance does not support a derived annual interval.

## Compare the complete upstream catchment

Select the actual catchment polygon source and its unique original ID field. A station point or a clipped administrative reporting boundary does not describe its upstream drainage area. Model aggregation uses each original full-domain NDR/SDR raster and its real affine grid, metre CRS, pixel area and NoData mask.

The comparison now measures two different boundaries:

1. **Whole-polygon extent coverage** compares the entire source catchment with the raster's actual affine quadrilateral. It retains the catchment area, area outside the raster, extent fraction and original CRS.
2. **Native grid support** counts every selected pixel centre inside the in-raster part of that catchment. It distinguishes valid export values, structural stream omissions and unexpected missing support. Covered cell area is explicitly a grid measure.

A read window clipped to the dataset is never the denominator for whole-catchment coverage. A complete comparison requires the whole polygon inside the original raster extent and complete expected native export support. Original InVEST 3.20 NDR/SDR exports deliberately leave some stream cells as NoData. The workbench reads the exact same-stage `stream` raster (or SDR's `stream_and_drainage` when its original arguments select drainage), verifies its retained bytes and identical CRS/affine grid, and identifies only original masked export cells with stream value 1 as structural omissions. It retains their count and area separately from missing nonstream cells, unclassified missing cells and unmasked nonfinite stream values. Valid native stream export values remain in the sum. No stream mass is added or imputed; the export raster stays byte-identical. Partial native mass remains in the record and operator table. Full-load residuals, relative residuals and aggregate fit metrics use complete catchments; partial rows retain a separately named partial difference and their concrete coverage reasons.

Each comparison retains the stream registry ID, file hash, original arguments and original native module identity. The statistical record identifies every included period, unique catchment count and repeated catchments. Mean bias, RMSE and Nash–Sutcliffe efficiency describe the selected record comparisons. Source periods, model input vintages, reservoir and point-source influences remain necessary context when interpreting them.

## Inspect and deliver

The operator shows original station periods, methods, uncertainty and contributing records next to each load. A station/parameter/coverage selector drives the native-value scatter plot and complete comparison table. The dashed plot line denotes equal observed and modeled annual mass. Selected comparison rows download as a CSV containing their original period, uncertainty, method, lineage and complete spatial-coverage object.

Earlier immutable comparisons remain readable as their original versions. A fresh comparison on the same retained model output and observation edition computes the current coverage fields without invoking either model again.

Select the retained observation comparison in the existing seven-family delivery. The original scientific workspace archive retains the complete observation CSV, method document, comparison, catchment source and original model outputs; the delivered operator reopens those same entities.
