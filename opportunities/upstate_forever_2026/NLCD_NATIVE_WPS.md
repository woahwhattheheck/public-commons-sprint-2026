# Original Annual NLCD native WPS continuation

This component acquires the selected Annual NLCD source for the existing Upper Savannah model domain and feeds the original workspace source importer. It reuses the evaluated 217-feature domain plan, its 1,000-metre buffer, native grid and retained description. The source operation is **UPSTATE-ORIGINAL-SOURCES-DBC61**; the existing four-cell POST investigation is **ECOSYSTEM-SCIENCES-NLCD-READER-20261013**.

## Complete source workflow

The module source_tools.nlcd_wps saves a deterministic regional request plan, captures original native-grid crops sequentially, resumes completed crops, mosaics their exact integer windows, applies the maintained nlcd_wcs categorical conversion, and counts actual valid land-cover cells in each of the 217 original polygons. The completed directory contains the ordinary sources.json consumed by Workspace.import_sources.

A two-by-two-cell probe uses the centre of this same regional request. Its result records the returned band, CRS, transform, valid/missing cells and original class counts. Its separate output directory is never imported as a complete regional source.

The regional domain-support.json preserves each original object ID/properties, centre-in-polygon selected cells, valid/missing counts, valid fraction and observed class counts. The complete manifest requires nonempty, complete support in every selected polygon. Feature sums explicitly count any overlapping source polygons separately.

## Original source identity

The recovered original-wcs-plan.json is 5,062 bytes, SHA256:

41296472d82dfb53e65b9fa86045cf5facba33d567977269f69437d53f9eefa9

| Field | Retained value |
|---|---|
| Coverage | mrlc_Land-Cover-Native_conus_year_data__Land-Cover-Native_conus_year_data |
| Selected time | 2025-01-01T00:00:00.000Z |
| Native CRS | EPSG:5070 |
| Native centre-index envelope | columns 117681–124125; rows 62886–69206, inclusive |
| Complete request | 6,445 × 6,321 cells; 40,738,845 cells |
| Source domain | 217 original features plus 1,000-metre buffer |
| Compressed domain member | 3,732,669 bytes; SHA256 6f49c2f1dc10709d7957e38e92642a1de4cda44e67e4d70a8bc2ff51388e6af9 |
| Decoded domain member | 11,220,042 bytes; SHA256 2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af |
| Original description | 13,096 bytes; SHA256 1a3cba52dca82969d46c0f08aa02f5f2047b5c94edb87bc476c8d172bbad0ff9 |
| Published nil value | 250 |

The description's pixel coefficients are approximately 30 metres. Windows use those actual coefficients and the original pixel-centre anchor. Source cells are copied without spatial resampling. The existing workspace may subsequently define its model grid through its original source alignment policy.

The original source material and exact GET attempts/responses are retained on the [raster service metadata page](https://app.notion.com/p/3f7dd77231008147bfb0d97e296fda3b).

## Bind the dated source file

The required --granule-basename and --granule-reference retain the explicit source selection. The filter matches a location ending in the complete basename. A wildcard around a bare year can also match that year in a directory containing other annual files.

The captured MRLC catalogue row Viewer_Layers_Extent.25 publishes the template data_YYYY0101_YYYY1231.tif, giving data_20250101_20251231.tif for 2025. Its clipped product filename is Annual_NLCD_LndCov_YYYY_CU_C1V2. This catalogue row identifies the non-Native download collection and a different projection identifier. The native WPS operation therefore validates the actual returned native grid against its own description; it does not copy the catalogue projection.

Catalogue source:

https://www.mrlc.gov/geoserver/wfs?request=GetFeature&version=1.1.0&typeName=mrlc_display:Viewer_Layers_Extent&propertyName=category,src_meta,clpd_rstr,src_folder,src_file,clpd_meta,src_proj

The retained XML is 23,480 bytes, SHA256 7ba0f8921803c2793faa4eb755739f8a493652d29c601208297762b47996b2e9. The first native response establishes whether the exact dated filename filter returns the selected numeric coverage.

USGS identifies P143HE8T as the Collection 1.2 Land Cover product DOI and P94UXNTS as the Collection 1 Science Products suite citation, version 1.2, June 2026. Preserve the original plan's valid product reference. The explicit --collection-reference records the selected product DOI or publication page.

- [USGS Collection 1.2 Land Cover product](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-land-cover-annual-nlcd-collection-1-land-cover)
- [USGS edition and suite citation](https://www.usgs.gov/centers/eros/science/about-annual-nlcd)

## Run on the existing receiver

Run from the application root with its actual installed GIS Python. PLAN, DESCRIPTION and DOMAIN below are the receiver's existing retained files. OUTPUT is its owned regional output directory; PROBE_OUTPUT is a separate small-probe directory.

~~~sh
python -B -m source_tools.nlcd_wps probe \
  --plan PLAN --description DESCRIPTION --domain DOMAIN \
  --granule-basename data_20250101_20251231.tif \
  --granule-reference 'https://www.mrlc.gov/geoserver/wfs?request=GetFeature&version=1.1.0&typeName=mrlc_display:Viewer_Layers_Extent&propertyName=category,src_meta,clpd_rstr,src_folder,src_file,clpd_meta,src_proj' \
  --collection-reference https://doi.org/10.5066/P143HE8T \
  --output PROBE_OUTPUT
~~~

Use the command plan with those same source arguments and the regional OUTPUT to save all requests without network operations. Default crops are at most 2,048×2,048 native cells; this exact original plan produces 16 sequential crops. Every complete XML or GET request and its hash is in operation.json.

After the original source response is established, capture with the same regional arguments continues through all tiles, the native mosaic, normalized raster, 217-feature support calculation and source manifest. Default transport is POST using the documented internal chain; --transport get selects its supported nested GET form. A saved operation's source and transport remain fixed.

~~~sh
python -B -m source_tools.nlcd_wps resume --output OUTPUT
~~~

Progress identifies the operation, tile, completed/total tile count, actual valid cells and response bytes. Timeout defaults to 180 seconds per native HTTP operation; maximum-bytes defaults to 64 MiB per response. Both choices are recorded in each attempt.

## Interruption and response reuse

Every request is retained before transmission. Responses retain original bytes, status, headers, request identity and actual hashes. Completed responses and their native observations are reused.

An interruption after complete response state but before its convenience receipt is recovered by checking the retained HTTP 200 TIFF and reconstructing the missing receipt. Attempt numbering uses every existing numeric directory, including directories interrupted before their state file, so later attempts preserve those originals.

A transport interruption can leave the remote request executing. Its saved issued/transport_uncertain state identifies the exact operation. Reconnect the existing execution where possible; --retry-uncertain explicitly permits a new attempt after resolving that original execution. --retry-failed permits another attempt after addressing the retained original XML/HTTP error. Earlier attempts remain intact.

An incomplete derived mosaic is rebuilt from completed original crops. The original response bodies stay intact. The final normalization applies the existing source mask and published nil policy.

## Adopt a completed public GET response

~~~sh
python -B -m source_tools.nlcd_wps receive-file \
  --output OUTPUT --tile tile-0000 \
  --original ORIGINAL_TIFF --original-receipt ORIGINAL_RECEIPT_JSON
~~~

The maintained nlcd_wcs receiver checks the exact saved GET URL, actual bytes and SHA256. It accepts an original HTTP 200 receipt or the existing upstate.external-original-source/v1 completed provider receipt with its actual stable file reference. An unavailable source HTTP status remains null.

This command adopts and inspects the named tile without starting other HTTP requests. Resume then reuses that tile and continues the same operation.

Execute new WPS requests with the direct native caller. Generic URL attachment loaders may send a preliminary HEAD before GET; do not use that two-request sequence to launch WPS jobs. This receiving command is for a completed original response already held by its owner.

## Import and select the complete source

The output entry has kind raster, role NLCD, units class and resampling nearest. Its distinct usgs-annual-nlcd-wps-2025-… identity derives from this exact operation. It retains the year, named coverage, dated-basename filter, publication references, original plan/description/domain, all requests/responses/receipts/observations, native mosaic, normalized raster and per-feature support report.

~~~python
from model.workspace import Workspace

workspace = Workspace(existing_workspace_path)
collection = workspace.import_sources(completed_source_directory / "sources.json")
source_id = collection["entries"][0]["id"]
~~~

Select the returned source ID as the existing grid workflow's NLCD role, keeping the selected regional model domain, reporting areas and other scientific inputs. The source raster, workspace model grid and Gura demonstration study retain their own identities.

## Protocol sources and observed investigation

GeoServer's GetFullCoverage exposes name and optional filter, then calls the original catalogue reader. It has no bounds/size argument. CropCoverage applies the geometry and treats untagged WKT as being in the returned coverage CRS.

The internal GET reference starts with http://geoserver/wps; its query is encoded inside the outer DataInputs value. The current KVP parser accepts bare RawDataOutput=result with the advertised TIFF default. GET uses the advertised default Filter 1.0 XML decoder and application/wkt geometry; POST retains explicit Filter 1.1 XML.

Primary implementations:

- https://raw.githubusercontent.com/geoserver/geoserver/main/src/extension/wps/wps-core/src/main/java/org/geoserver/wps/gs/GetFullCoverage.java
- https://raw.githubusercontent.com/geoserver/geoserver/main/src/extension/wps/wps-core/src/main/java/org/geoserver/wps/executor/InternalWPSInputProvider.java
- https://raw.githubusercontent.com/geoserver/geoserver/main/src/extension/wps/wps-core/src/main/java/org/geoserver/wps/kvp/ExecuteKvpRequestReader.java
- https://raw.githubusercontent.com/geotools/geotools/main/modules/unsupported/process-raster/src/main/java/org/geotools/process/raster/CropCoverage.java
- https://docs.geoserver.org/stable/en/user/services/wps/operations/
- https://docs.geoserver.org/stable/en/user/services/wps/processes/chaining/

The retained GET investigation received actual XML for an output-identifier parse error, then a timestamped inline-GML conversion failure. Corrected WKT synchronous/asynchronous downloads returned provider source_download_failed without an HTTP body, status or execution ID. Exact requests and outcomes are preserved with the original operation; this regional component consumes an actual native response and continues the complete source workflow.
