# Native source receiving — 12 October 2026

This source continuation joins the completed scientific workspace from PR 34174 / `80aed20e1f085a3abc12e5f05268c5f7ae637389`. It adds the actual USDA interpretation result, original PRISM metadata, and the source-bound Annual NLCD acquisition path.

## Retained inputs and receiving paths

| Source | Retained result | Workspace receiving |
|---|---|---|
| USDA whole-soil K, SC007 | Original calculation 109629 for AOI 13217298, preserving the original SC007 mapunit selection from AOI 13217297 | Import `soil-interpretation-20261012/native-sc007/source-manifest.json` |
| Annual NLCD Collection 1.2, year 2025 | Original WCS description plus the actual untargeted static national catalog row and XML; national archive acquisition remains pending | Receive the full original static archive and clip the 217-HUC12 domain locally using [NLCD_STATIC.md](../source_tools/NLCD_STATIC.md); the original WCS method remains documented separately |
| PRISM annual precipitation normal 1991–2020 | Original archive directory and terms, with original dataset manual retained by its stable source-file identity | Use [metadata-provenance.json](prism-precipitation-1991-2020/metadata-provenance.json) and the existing PRISM source-transfer operation |
| NOAA rainfall erosivity | Complete 47,143,128-byte original archive, Slack F0C9BC7MKME, SHA256 `157bbcaa54b445f96506fb1caffda4bbaea6b28f71bc7199235705e69cd00596` | Existing `source_tools.erosivity_sources receive` and original prepare workflow |

## USDA calculation

The four files under `soil-interpretation-20261012/native-sc007/` retain the completed native interpretation and all 49 source members. The original capture archive is 118,202 bytes with SHA256 `8988e539b70ef3fd8877591114a739b0f05b61c3fccc1d16a493230ccb312152`. Every original request, response, interpretation parameter, mapunit selection and same-result legend is listed in [method.json](soil-interpretation-20261012/native-sc007/method.json).

The native `chorizon.kwfact` attribute is a Choice value. The adapter binds each original rating string to its same-result legend before Decimal projection. The 34 selected mapunits contain 32 ratings and 2 retained nulls. The original distribution is .10×1, .17×6, .20×11, .24×6, .28×7 and .32×1. The source table retains both the native coefficient and its explicit SI conversion by 0.1317. The method is Dominant Condition with Surface Layer horizon aggregation and the original tie-break setting.

This result is imported as `SOIL_INTERPRETATION_REFERENCE`. The full model's spatial K input uses the selected native mapunit polygons and the existing soil-raster preparation. Source nulls and overlap conflicts remain explicit throughout that preparation.

## Complete upstream land-cover source

The original domain contains 217 selected native WBD polygons: 116 reporting intersections and 101 upstream ancestors. Its complete archive is 8,800,689 bytes with SHA256 `1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04`, retained as `libfile_cce17e762e948191be1d226b1dbce00d`. The source manifest and original page/index bindings remain inside that archive.

The original WCS description and its source-bound adapter remain retained. The actual deployed service returned version/reader exceptions instead of a numeric 2025 TIFF. The completed source lookup therefore also retains the published static national product, catalog row 2881 and exact 34,686-byte original XML in [nlcd-static-2025-c1v2/](nlcd-static-2025-c1v2/). The national ZIP's compressed size and image have not yet been observed. Its existing source owner retains the sole untargeted acquisition.

The static receiver uses the complete original national archive and performs the original 217-domain clip locally. It reads the actual WGS84 Albers TIFF grid and sidecars against the publisher's static XML; it does not reuse the separate WCS EPSG:5070 contract. The original WBD ring reader retains native IDs, original bytes and any analysis corrections. The local categorical output and all original companions enter the existing source importer as role NLCD, units class and nearest-neighbor alignment.

The previously rejected project ZIP upload and precise remote AOI request remain unissued. See [NLCD_STATIC.md](../source_tools/NLCD_STATIC.md) for original receipt intake, actual storage requirements, source-member/clip interruption recovery, and complete portable receiving.

## Original USGS seasonal-load release

The six original source files under [usgs-seasonal-loads-20261012/](usgs-seasonal-loads-20261012/) now retain the actual WMA catalog XML, ScienceBase item JSON, current metadata XML, original download response and their capture/interpretation guide. The complete source capture is bound by SHA256 `d8f10b51a6a7549fc41c1c1343383e552053e2bd9c7acb10499f54593a88cedf`.

The publisher identifies `data_release3.zip`, 1,897,877,062 bytes, with published MD5 `2dc4d81994c4fcbf7d27728eb16fdaef`. Its actual published legacy download flow requires a human CAPTCHA. Numeric archive members, station qualification, catchment acquisition and annual-load preparation remain pending that legitimate access step. The metadata does not establish an acquired seasonal table.

The existing [USGS_LOADS.md](../source_tools/USGS_LOADS.md) and source adapter retain the original estimator, complete annual period, quarter rows, units and uncertainty when the actual release is available. These seasonal N/P loads are modeled estimates derived from observations; they are not a direct sediment-validation dataset. No station values or fit statistics have been filled from metadata.

## Original precipitation operation

`DBC61-UPSTATE-PRISM-ANNUAL-ORIGINAL-20261012` retains the exact selected 62,685,097-byte annual archive URL, original source version and source/destination request. Its first private upload ended early at 30,007,881 bytes. The existing transfer journal preserves that partial attempt and its file identity; supported continuation revalidates the original resource and carries the same operation forward. The completed transfer result and original archive are consumed through the existing PRISM receiving method.

The original HTML source bytes are included here with SHA256s and stable provider identities. The dataset manual remains attached to the same retained source page. Original response fields that the attachment loader did not expose are represented as null.

## Assemble the scientific receiving

Use the existing source composer to join these source manifests with the original reporting basin, selected upstream domain, regional biophysical table, DEM and prepared raster inputs. The retained full-native plan then creates the 30 m grid, executes the original pinned InVEST NDR/SDR stages, and passes their actual IDs to the existing operator receiver. The receiver produces the seven-map GIS delivery, complete workspace backup and reopened delivered application described in [NATIVE_RECEIVING.md](../model/NATIVE_RECEIVING.md).
