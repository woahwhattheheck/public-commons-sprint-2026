# Native whole-soil erodibility source

`soil_sources.py` prepares the K-factor raster from USDA Soil Data Access's original **K Factor, Whole Soil** interpretation. It retains the native soil polygons, mapunit identities, interpretation inputs/results and source receipts alongside the prepared raster.

The retained initial attribute metadata is in `source/soil-interpretation-20261012/`. Its actual USDA response identifies `chorizon.kwfact`, attribute key **51**, **Dominant Condition**, **Surface Layer**, and nulls preserved. Rock-free `chorizon.kffact` remains a separate native attribute in the same source response.

## Source and method

The geometry phase creates geographic SDA AOIs from each target tile's geographic bounds, including a one-pixel halo. The halo protects the target pixel centres during coordinate transformation. The target raster windows themselves are disjoint on the selected NLCD grid.

Each geographic AOI is queried for its native polygon count, complete polygon-ID set and exact selected geometry pages. Original WGS84 WKB, native mapunit/polygon IDs, soil-survey identity and spatial version are retained. Polygons are bound to every field returned in the original ID selection before use.

The interpretation phase collects the actual unique mapunit keys from those polygons and submits batches of at most 1,000 keys to SDA's native mapunit-list AOI interface. It obtains the actual interpretation catalog, short-form defaults and long-form XML, then sends the original short-form JSON unchanged to `getrating`. Native metadata, original rating columns and legend are retained from the returned interpretation ID. This avoids rerunning the same mapunit interpretation for every geometry tile.

The geographic and mapunit-list AOIs have different jobs: geographic AOIs provide clipped geometry; mapunit-list AOIs provide the native soil interpretation. USDA documents that geometric AOI tables are populated only for the geographic form. The code follows those original interfaces directly.

Regional source-catalog observations bracket the capture. Every actually used soil survey must retain the same native survey row and spatial version. Individual HTTP receipts preserve the observed response interval.

Primary interfaces:

- [USDA advanced queries and native interpretations](https://sdmdataaccess.nrcs.usda.gov/documents/AdvancedQueries.html)
- [USDA web-service contract](https://sdmdataaccess.nrcs.usda.gov/WebServiceHelp.aspx)
- [Original InVEST SDR units and K-factor preparation](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html)

## Native choice values

USDA declares both the original and effective datatype of `chorizon.kwfact` as **Choice**. Its actual whole-soil result carries values such as `.20` in `MapUnitRatingString`; `MapUnitRatingNumeric` is empty for this native rule. The importer parses the original choice with Decimal, checks its exact label and colour against the same interpretation's source legend, and retains the original string beside the numerical projection. It never fills or relabels the original numeric column. A missing choice stays missing.

The retained October 12 Anderson County calculation used all **34** native mapunits from SC007, original AOI **13217298** and interpretation **109629**. It returned **32** rated mapunits and **2** missing choices. Those original responses remain available in the source packet; a continued importer consumes their existing result IDs. Metadata and rating tables use the provider's actual `AoiID` field. The provider's `LayerOption` is **Surface Layer**; its separate `HorizonAggregationMethod` metadata remains **Weighted Average**, alongside the unchanged short-form layer choice and full ParameterXml.

## Prepare the same model grid

Run from the complete product root using the already-equipped native GIS Python. Select the original numeric NLCD raster and the retained full upstream-domain vector used for DEM/grid preparation.

```sh
python -B -m source_tools.soil_sources \
  --reference "$UPSTATE_NLCD" \
  --domain "$UPSTATE_UPSTREAM_DOMAIN" \
  --attribute-metadata source/soil-interpretation-20261012/soil-erodibility-rule-form.body \
  --metadata-capture source/soil-interpretation-20261012/soil-erodibility-rule-form.capture.json \
  --buffer-m 1000 \
  --tile-size 512 \
  --page-size 128 \
  --rating-batch 1000 \
  --null-policy nlcd-water-zero \
  --vintage "$UPSTATE_SOIL_SOURCE_EDITION" \
  --output "$UPSTATE_SOIL_CAPTURE" \
  --resume
```

Supply the actual source layer or filter through `--layer` and `--where-json` where needed. The buffer must equal the explicit native model selection. Source and output paths are selected by the existing native worker; the command does not start another compute service.

The default missing-value policy is `preserve`. The example selects the explicit `nlcd-water-zero` policy: a source pixel classified as **11, open water**, by the original numeric NLCD receives zero K only when its native soil rating is absent and there is no conflicting rating. Other missing values remain NoData. The source summary records actual affected counts.

The selected source directory retains each complete response and reuses its original bytes on continuation. `--resume` allows the same incomplete public-source request to continue after a transport interruption or eligible temporary HTTP failure. It retains earlier attempts and honours the actual provider Retry-After value. Completed response bodies are checked before reuse; a completed interpretation is consumed by its original native result ID.

## Result and integration

The complete source directory contains:

| File or directory | Retained content |
| --- | --- |
| `plan.json` | Exact reference/domain hashes, grid, native attribute, source method, source-page sizes, units and missing-value policy. |
| `original/` | Original form requests, gzip-retained response bodies, native HTTP receipts and the initial attribute metadata. |
| `geometry-capture.json` | Exact tile AOIs, native polygon IDs, geometry-page requests and native survey spatial versions. |
| `ratings.json` | Actual interpretation IDs, unchanged selected parameters, every original rating column, complete legends and exact Decimal projections. |
| `survey-editions.json` | The original survey editions used by the completed capture. |
| `coverage.json` | Actual rated, missing, overlapping and open-water-zero pixel counts. |
| `soil-k.tif` | Float32 K values on the original aligned 30 m grid, with native NoData retained. |
| `source-manifest.json` | The complete `upstate.sources/v1` entry and every declared source companion. |

The customary K values are converted once with factor **0.1317** to the SI units required by the original SDR implementation. The entry declares the prepared SI units, so model-grid alignment does not apply the conversion again.

Rasterization uses GDAL's polygon pixel-centre convention. Minimum and maximum native mapunit labels expose every pixel with overlapping mapunits. Minimum and maximum ranks of the exact Decimal ratings then identify all conflicting values, with missing ratings kept distinct from zero. Conflicting K values remain NoData; equal physical values retain the source ambiguity count. Original WKB and ratings remain available for examination.

Add the completed `source-manifest.json` to the existing source composer. Bind its actual returned K-factor source ID in the same native model plan as the other four physical inputs. The model receiver then carries this complete original source directory inside the native workspace archive.
