# Native parcel coordinates in the original source collector

Operation: ECO-SOURCE-PARCELS-20261013.
Base repository file: opportunities/upstate_forever_2026/source/capture_original_overlays.py.
Base Git blob: 3e9cd4f0b5055be15fcdb3cae88c2c064b6fb25d.
Application receiver path: source/capture_original_overlays.py.

## Source recovery and resulting behavior

Greenwood County publishes its maintained parcel geometry at:
https://www.greenwoodsc.gov/arcgis/rest/services/Operational_Layers/Parcels_Search_and_Select/MapServer/0

Its sourceSpatialReference is EPSG:3361. Its map spatialReference is 102100/latest3857. The default query returns map coordinates; an explicit outSR equal to the retained source declaration returns the native parcel coordinates. On 2026-10-13, the maintained source returned 40,302 records, OBJECTID as its OID, PIN as a 12-character string, and actual polygon rings for OBJECTID 1 / PIN 6913-674-230.

The existing collector already selects sourceSpatialReference for publication, records the native source declaration, and verifies that every geometry page matches it. This update supplies that same native declaration in outSR when the published default declaration differs. Both the true-curve request and the corresponding provider-linear request receive the same outSR. Services with matching known CRS declarations retain the exact previous request parameters and page names.

A changed geometry request receives a deterministic -native- suffix derived from its parameters. Earlier default-coordinate responses retain their original names, bodies and receipts. Existing metadata, count and selected-ID responses remain reusable. The strict coordinate agreement and the original curve/attribute checks continue at publication.

The declaration comparison is standard-library only. It recognizes the existing Web Mercator aliases 102100/102113/3857, preserves vertical identifiers, and requests explicit coordinates when a declaration cannot be matched by its retained WKID/WKT. It adds no geometry-runtime requirement to the connected source receiver.

## Receiver integration

Apply the complete collector only if the current receiver still matches the recorded base SHA256, or reapply the native_geometry_parameters helper and the two geometry request expansions to the receiver's fresh collector. Preserve concurrent source changes.

ES26 retains ownership of Greenwood's live-provider catalog addition. Its native_crs should record 3361; the map service declaration 3857 remains separate metadata. Keep the existing RFA 2025 snapshot as a distinct explicit alternative. The existing UPSTATE-REPORTING-PARCELS-DATA-20261013 workflow supplies full county selection, exact-ID capture, parcel preparation and import; this correction joins that engine.

Continue the existing incomplete receive operation with the revised collector. The new geometry request identity allows recovery after the old source/page CRS mismatch while retaining the original response history. Completed county captures are reused by the established receiver. A successor source plan retains its own provider choice and acquisition masks.

## Retained primary source observations

Metadata URL:
https://www.greenwoodsc.gov/arcgis/rest/services/Operational_Layers/Parcels_Search_and_Select/MapServer/0?f=pjson

Successful explicit native-CRS request:
https://www.greenwoodsc.gov/arcgis/rest/services/Operational_Layers/Parcels_Search_and_Select/MapServer/0/query?objectIds=1&outFields=OBJECTID%2CPIN%2CTAXPARCELTYPE&returnGeometry=true&returnTrueCurves=true&returnZ=true&returnM=true&outSR=%7B%22falseM%22%3A-100000%2C%22falseX%22%3A-122907600%2C%22falseY%22%3A-92800700%2C%22falseZ%22%3A-100000%2C%22latestWkid%22%3A3361%2C%22mTolerance%22%3A0.001%2C%22mUnits%22%3A10000%2C%22wkid%22%3A3361%2C%22xyTolerance%22%3A0.0032808398950131233%2C%22xyUnits%22%3A3048%2C%22zTolerance%22%3A0.001%2C%22zUnits%22%3A10000%7D&f=pjson

The two companion JSON files contain the source metadata and successful provider response text returned by the connected public fetcher. The active collector receives and hashes original HTTP response bodies in its existing OriginalResponses store.

The successful native response declares wkid 3361 / latestWkid 3361 and carries one actual 14-vertex polygon for OBJECTID1. Source field values, native OID, parcel string, actual coordinates and original request URL are retained.

Greenwood's IT/GIS authority describes live parcel linework and nightly assessor-data updates:
https://www.greenwoodcounty-sc.gov/it-gis/1000

The service does not declare a parcel data-edit timestamp in this metadata. Retain the response capture date and its native record dates as distinct fields.

## Source text checks

The full replacement source is based on the freshly fetched current collector. Both original-curve and provider-linear requests include the same geometry_parameters expansion. The known matching-CRS path produces an empty expansion and the previous response identity. The actual county request using the complete original EPSG:3361 declaration succeeded.

