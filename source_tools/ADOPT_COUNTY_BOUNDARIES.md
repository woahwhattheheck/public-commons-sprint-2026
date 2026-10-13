# Receive the original statewide county geometry for parcel preparation

The full original SC RFA county response is retained: 4,246,946 bytes from the
public County_Polygons_Status_CBApp service. The separately retained layer
metadata is 18,968 bytes and the original attribute response is 11,241 bytes.
The attribute response contains all 46 original county IDs and unique South
Carolina FIPS. This removes the county-service network dependency from the GIS
preparation host.

The original source is:

https://services9.arcgis.com/RvqSyw3diI7dTKo5/ArcGIS/rest/services/County_Polygons_CBApp/FeatureServer/4

The exact full geometry query is:

    where=1=1
    outFields=*
    returnGeometry=true
    returnTrueCurves=true
    outSR=6570
    orderByFields=OBJECTID
    f=json

Native WKID103146/latestWKID6570 is preserved. Each original source DateUpdate,
BoundaryComplete, project-boundary link, area, length, null and field type remains
attached to its feature. Published boundary effective dates and service edit
metadata remain separate facts.

## Inputs

Place the three original files together in one directory:

- sc-rfa-all-46-original-county-polygons-native-20261013.json
- sc-rfa-original-county-layer-20261013.json
- sc-rfa-original-county-attributes-20261013.json

The complete raw geometry is attached to the existing ECO-SOURCE12 primary-source
page under "Original SC RFA county geometry for reporting-area parcel preparation
— 13 October 2026". Resolve that attachment's original stable file reference
through the receiving session's connected Notion get_file_download_urls method,
then download the returned URL to the first filename above. Refresh the stable
reference if the short-lived URL expires. The original metadata and attribute
files are also included under source/geography/sc-rfa-counties-20261013 in this
source component. Preserve the original files; the receiving command records
the raw geometry's received SHA256 and verifies every complete source record.

| Original body | Bytes | SHA256 |
| --- | ---: | --- |
| Layer metadata | 18,968 | 75b25bccc73fffa346d3eba407f5e478d8b06ac8bf3792c5d8290b52308db5a2 |
| County attributes | 11,241 | c5f8fda1bc0c86efd2b5a0e29632813e547ad329bb32188a5b81b5648435e092 |

## Adopt, then continue the same parcel operation

Run from the complete current application:

    python -B -m source_tools.adopt_county_boundaries \
      --source-directory ACTUAL_ORIGINAL_COUNTY_DIRECTORY \
      --output ACTUAL_PERSISTENT_PARCEL_CAPTURE

The output argument is the parent parcel-operation directory used by
reporting_parcels run. The adopter derives the same counties-<source identity>
child directory that the existing operation uses. It validates the native
coordinate declaration and XY contract, the pinned metadata and attribute
identities, all 46 exact object IDs, unique county FIPS, matching original
attribute values, native field names/types, complete closed rings and finite
coordinates. It refuses a truncated source or a conflicting existing county
edition before publishing the index.

The adopter retains the original response, metadata and attributes unchanged in
gzip files. It uses the existing collector's publish_features function to
produce the normal features.esri.json.gz derivative. Its layer-capture.json,
county-boundaries.json and source companions match the maintained parcel
planner. county-source-inventory.json records all original county IDs, FIPS,
ring/vertex counts, DateUpdate and BoundaryComplete values.

Original PlanningBasins2023 files are received through the existing verified
local-source path introduced in PR2866. Those five physical inputs are already
included in the normal application archive.

Continue on the accepting GIS interpreter:

    python -B -m source_tools.reporting_parcels run \
      --workspace ACTUAL_SC_WORKSPACE \
      --output ACTUAL_PERSISTENT_PARCEL_CAPTURE \
      --retry-failed

The current boundaries function verifies and reuses a completed retained county
capture before any county provider call. The existing GIS planner then selects
the actual positive-area intersections with original Upper Savannah record5,
measures in EPSG5070 and produces provider-bound acquisition masks. Parcel
capture, preparation, measured coverage gaps, original whole parcel geometry,
inventory, Workspace import and the current parcel desk follow their existing
paths. The original scope remains the complete SC reporting area.

A source-only receiver can also emit the existing portable county-source ZIP:

    python -B -m source_tools.adopt_county_boundaries \
      --source-directory ACTUAL_ORIGINAL_COUNTY_DIRECTORY \
      --output ACTUAL_PERSISTENT_PARCEL_CAPTURE \
      --archive ACTUAL_TRANSFER_DIRECTORY/original-sc-counties.zip

That ZIP uses the original reporting_parcels bundle/unpack protocol. The
standard-library phase requires the complete application and its existing
source helper modules. Shapely/PyProj/Fiona/Rasterio are used by the subsequent
original GIS planner/preparation path.

## Edition and recovery

Re-running an identical adoption verifies the retained files and reuses the
same source index. An interrupted intake reuses exact immutable source bodies;
publishing county-boundaries.json is the final source adoption step. A
different already-retained county edition remains immutable. Continue that
existing operation or deliberately use a fresh output root for a different
edition.

The all-county attribute body and metadata are pinned to the actual acquired
edition. The raw full geometry must have the retained exact byte length and
agree with every original attribute row and field/axis/CRS contract. Its actual
received SHA256 is retained in the normal source index and transfer record.
The official service may change later; a later query belongs to its own source
edition.

## Result adoption

The normal output contains county-boundaries.json and its exact native source
record. The subsequent parcel run returns required-counties.csv,
county-reporting.geojson, parcel-plan.json, provider captures,
parcel-inventory.json and parcel-selection.json. The source selection keeps
source_collection_id/source_id, layer parcels_reporting and id_field parcel_id.

The county-envelope query is acquisition context only. The retained reporting
polygon's positive-area GIS intersection determines the final required county
set.
