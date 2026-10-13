# Original USGS regional river-flow capture

## Purpose and delivered behavior

This source intake adds measured daily river discharge and original monitoring-location
metadata to the Upper Savannah workbench. It complements the existing DES water-quality,
EPA point-source and native NDR/SDR work. The receiving command creates an ordinary
upstate.sources/v1 edition that the original Workspace can import and transfer.

The buyer's utilities are Anderson Regional Joint Water System and Pioneer Rural Water
District. The collector selects stations through the retained model-domain polygons. It
keeps the original HUC12 identities and records which polygon contains each published
station point. This supports source selection, context maps and the design of observed
water-quality comparisons for the actual basin.

The source acquisition uses USGS OGC API v1. It preserves each original response body
in a deterministic gzip file, the request URL, retrieval time, source ETag/Last-Modified
where present, page counts and both original-body and retained-file SHA256 values.
An interrupted command resumes from verified responses already in the output directory.
Each completed series is also written immediately. The CLI uses an operating-system
file lock so a second process in the same capture directory does not start duplicate
downloads.

## Receive and run

Place source_tools/usgs_flow.py in the original application checkout. The receiver uses the Python standard library for WGS84/CRS84 source geometries.
For an original domain in another declared geographic CRS, it uses the existing GIS
interpreter's pyproj to resolve coordinates to WGS84, retaining the exact original
reference system, operation and stated transformation accuracy. Run it from the application directory with
the existing interpreter; adding --workspace uses the already installed original
Workspace import method.

A concrete original-source receive for two published Tugaloo-basin stations is:

~~~sh
python -B -m source_tools.usgs_flow \
  --output ../usgs-flow-tugaloo-2023 \
  --start 2023-01-01 --end 2023-12-31 \
  --stations USGS-02177000 USGS-344108083090600
~~~

The first station is Chattooga River near Clayton, GA. Its published point is in
Oconee County, South Carolina, and its stated drainage area is 207 square miles.
The second is Chauga River above Westminster, SC, with stated drainage area 66.8
square miles. Their original site pages are listed below. The maintained API
metadata, rather than the site-page summary's aggregate data dates, determines
which daily mean discharge series actually overlap the requested period.

For the complete original regional domain, use its retained Esri JSON/gzip, GeoJSON,
or existing ZIP without copying/extracting the whole archive:

~~~sh
python -B -m source_tools.usgs_flow \
  --output ../usgs-flow-model-domain-2023 \
  --start 2023-01-01 --end 2023-12-31 \
  --domain /actual/retained/dbc61-upstate-model-domain-20261012.zip \
  --expected-features 217
~~~

For a ZIP, the command selects the unique GeoJSON or Esri polygon feature set with 217 features.
If the original archive contains more than one matching member, provide
--domain-member with the exact original member name. --huc-field selects the exact
original twelve-digit field when it has a different name or the dataset carries
more than one equivalent field. Automatic selection accepts only a case-insensitive
HUC12 field containing twelve-digit strings. HUC values keep their leading zeros.

The original Esri input must carry its declared spatialReference. The receiver reads
wkid/latestWkid or WKT and preserves it in selection.json. Normal WGS84/CRS84 coordinates
are retained directly. Other explicitly declared geographic reference systems use
the existing pyproj coordinate operation with ballpark transformations disabled.
The exact transformation description and stated accuracy are recorded. The complete
original decoded domain travels as domain/original-domain.json.gz among the source
companions, bound by its decoded SHA256 and content-addressed URI. Supply
--domain-source-uri when the existing capture manifest provides the exact publisher
or query URL; that URI is preserved with the input. Esri outer
rings and holes use ring parity for point membership, including boundaries.

The already-retained source operation also reported this direct input:
 /dev/shm/dbc61-upstate-model-domain-20261012/model-domain.esri.json.gz

It has exact decoded SHA256
2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af.
The direct continuation can use:

~~~sh
python -B -m source_tools.usgs_flow \
  --output ../usgs-flow-model-domain-2023 \
  --start 2023-01-01 --end 2023-12-31 \
  --domain /dev/shm/dbc61-upstate-model-domain-20261012/model-domain.esri.json.gz \
  --expected-features 217 \
  --expected-domain-sha256 2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af
~~~

The known retained original domain archive is 8,800,689 bytes with SHA256
1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04.
Existing source hosts have reported it at
/dev/shm/upstate-405f-20261012/inputs/dbc61-upstate-model-domain-20261012.zip
and /workspace/scratch/c86a240c6d17/dbc61-upstate-model-domain-20261012.zip.
Resolve the location actually present on the executing host.

When the command is receiving into the original product as well:

~~~sh
python -B -m source_tools.usgs_flow \
  --output ../usgs-flow-model-domain-2023 \
  --start 2023-01-01 --end 2023-12-31 \
  --domain /actual/retained/dbc61-upstate-model-domain-20261012.zip \
  --expected-features 217 \
  --workspace /actual/original/scientific-workspace
~~~

The returned workspace_import.source_collection_id is the actual saved source
edition. The source IDs are USGS_DAILY_DISCHARGE and USGS_FLOW_STATIONS. Existing
source selection, inspection, file tickets and portable Workspace export can use
these original source entries without changing the native engine or shared UI.

The output selection is content-bound. Reusing the same output directory with a
different date period, station selection or domain body is rejected; use a new
capture directory for a new source edition. Repeating the same selection reuses
verified source pages and produces the same source-manifest bytes. A fresh
directory captures a new source revision.

## Files and integration

| Output | Purpose |
| --- | --- |
| selection.json | Exact requested period, domain/HUC identities and source-selection ID |
| domain/original-domain.json.gz | Complete original decoded polygon source, when a domain was supplied |
| capture.json | Current acquisition state, completed series and all product identities |
| original/*.json.gz | Complete original USGS response bodies |
| original/*.receipt.json | Exact request, capture metadata, size and source-body SHA256 |
| stations.geojson | Unchanged original USGS monitoring-location features |
| stations.csv | Names, drainage-area fields and original-domain HUC12 membership |
| series.geojson | Unchanged original matching daily-discharge time-series metadata |
| series/<original-series-id>.csv | Complete received daily records per original series |
| observations.csv | Combined normalized daily table with original observation/series IDs |
| coverage.csv | Monthly and calendar-year completeness and flow summaries per series |
| hydrology_context.md | A readable regional monitoring/flow context for existing reports |
| source_manifest.json | Complete source-request inventory and numerical/spatial methods |
| workspace-sources.json | Original upstate.sources/v1 import with complete source companions |
| workspace-import.json | Actual saved original source edition, when --workspace was supplied |

The normalized table preserves original source_value and source_unit and adds
discharge_m3_s only when the source unit is recognized. Exact conversion for
ft^3/s is 0.028316846592 m^3/s per ft^3/s. The USGS parameter is 00060 (discharge);
statistic 00003 is the mean. Source documentation includes some older examples
with alternate field spellings. The parser preserves the actual v1 IDs and accepts
the maintained approval_status/time_series_id as well as the documented earlier
approvals_status/timeseries_id representations.

Each original time series remains separate throughout aggregation. Repeated dates
are reported explicitly and contribute no silently selected value to the summary.
Coverage records list missing dates, exact requested first/last dates, unique
finite daily values, approved numeric values and qualified numeric values.
Periods are clipped to the requested date range. A complete_numeric_period flag
requires a unique finite recognized-unit value for every requested day.

Mean, minimum, median, 90th percentile and maximum are computed over the reported
finite unique daily values in each monthly/calendar-year period. Quantiles use
linear interpolation between sorted observations. Approval/provisional status,
qualifiers and original last_modified values are retained. Missing values remain
missing throughout capture and summary.

The station point's containing HUC12 expresses geographic membership. The gauge's
published drainage area describes its whole upstream basin. Preserve that distinction
when the existing calibration/report feature associates flow with watershed exports:
the relevant upstream geometry and observation period must accompany the quantity
being compared. This capture supplies measured volumetric flow and supporting
source identities for that analysis.

## Interpretation with the existing calibration work

The 2023 period matches the current DES lake and EPA point-source acquisition period.
Keep source time-series coverage explicit: a newly established station can provide
useful part-year flow context while a long-running station supplies the requested
full-year record. coverage.csv gives the actual available days and each source's
quality flags. It never fills an unobserved day from a nearby station or changes a
partial period into a complete year.

Discharge is a volumetric flow rate. A pollutant-load calibration record requires
its pollutant identity, original concentration/load observations, spatial contributing
basin and a documented estimator with the appropriate temporal support. Bind the
separately maintained USGS seasonal-load/archive compiler and original observation
methods when producing those annual N/P/sediment reference quantities. This daily-flow
capture remains an ordinary contextual source edition, with units and timing intact.

## Completed regional observations available in the application

The sprint has already captured a complete original-data edition under
`observations/observed_hydrology_20261013/`. Use its existing
`model-sources.json` to receive those observations into the project Workspace.
Its 88 files retain 69 original agency responses, the executed processing source,
derived tables, original station geometry and native source companions. The source
bank is [Upper Savannah observed hydrology](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8QAH0AQ2).

| Retained product | Actual coverage |
| --- | --- |
| `derived/daily_flow.csv` | 33,459 original daily means at 16 gauges, 2020-01-01 through 2025-12-31 |
| `derived/calendar_year_flow.csv` | 96 gauge-year records; 88 complete calendar years |
| `derived/calendar_month_flow.csv` | 1,152 gauge-month records with original coverage |
| `derived/monitoring_stations_nad83.geojson` | 67 original station points, NAD83 / EPSG:4269 |
| `derived/eighteenmile_gage_whole_catchments.geojson` | Original full-resolution upstream whole catchments, EPSG:4326; splitCatchment=false |
| `derived/coverage.json` and `inputs.json` | Exact methods, qualifier definitions, periods, original URLs and response identities |

The companion `observations/eighteenmile_2023/model-sources.json` imports the
maintained cumulative 44-file study edition. It includes 920 original WQP result
rows in 225 activity groups, the original report context and the source owner's
same-date and antecedent-flow calculations. Its
`wqp/study_flow_dates.csv` preserves sixteen original laboratory dates, with
separate CHLA and microcystin sampling calendars and preceding three- and seven-day
flow windows. The complete source bank is
[Eighteenmile 2023 monitoring](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8JNNS1BP).

The existing `assessment/operate_assessment_maps.py` receives both manifests
through repeated `--context-manifest` arguments. It imports the original tables
and vector sources into the same Workspace, includes intersecting context vectors
in the maintained SpatialReview families, and uses the existing map exporter.
Select the actual application root, existing populated Workspace and original
domain manifest used by that receiving operation. Preserve the relative directory
structure so every manifest companion resolves to its verified original file.

These completed discharge responses use legacy USGS NWIS / WaterML JSON. Their
retained `hydrology_core.mjs` and `rebuild_hydrology.mjs` already parse and
rebuild them. This Python receiver captures the separately maintained USGS OGC
FeatureCollection format. Reuse each original source edition with its matching
processor and manifest.

For the Eighteenmile gauge USGS-02186702, the existing annual table reports 365
approved daily means in 2023, mean discharge 68.420547945 ft³/s, annual volume
61,099,554.3868 m³ and runoff depth 485.404729 mm over the original USGS drainage
area of 48.6 square miles. The published lake-study interval, April 5 through
October 17, has 196 approved days and mean discharge 63.523979592 ft³/s. These
different observation windows stay explicit in calibration and reporting.

Daily flow supports hydrologic context and complete-period volume. Annual
nitrogen, phosphorus or sediment calibration must additionally match the actual
pollutant quantity, concentration or measured-load method, upstream contributing
geometry and observation period. A lake sampling point and an upstream stream gauge
retain their own locations and spatial support. Keep the original nutrient
fractions, analytical methods, qualifiers and censoring with those comparisons.
The station's containing HUC12 is a spatial index; the original gauge drainage area
and whole-catchment geometry describe the flow's contributing basin.

## Source-native continuation

The command prints a series_complete JSON event after each original series is
durably written. On an HTTP 429 it honors the provider's Retry-After up to the next
retry boundary, then continues the same request. Source fetches are paced by
--request-interval (default 1.1 seconds). The default five attempts cover transient
429/500/502/503/504 and network timeouts; a later invocation continues retained work.

The full response and per-series CSVs survive an interrupted final combination or
Workspace import. capture.json records the exact failed exception and retains the
completed series. Inspect the concrete exception and fix that operation; reissue
the same command to use the retained request bodies.

Returned "next" links are followed until the provider ends pagination. Each page's
numberReturned must match its full feature list. Repeated cursors and conflicting
contents under one original feature ID are rejected. The requested station, time
series, parameter, statistic and date range are also checked against every daily
record. The file importer receives only files explicitly written by this capture.

## Primary sources checked 2026-10-13

- Buyer scope and named utilities:
  https://www.upstateforever.org/news/upstate-forever-seeks-consultant-for-gis-mapping-and-modeling-services
- USGS API v1 behavior and pagination:
  https://api.waterdata.usgs.gov/docs/ogcapi/
- Maintained daily-query fields:
  https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/queryables?f=html
- Monitoring-location schema, coordinates, drainage and original identifiers:
  https://api.waterdata.usgs.gov/ogcapi/v1/collections/monitoring-locations/schema
- Maintained complex-query/time-series metadata examples:
  https://api.waterdata.usgs.gov/docs/ogcapi/complex-queries/
- Efficient annual source-page acquisition:
  https://api.waterdata.usgs.gov/docs/ogcapi/efficiency/
- Chattooga River near Clayton:
  https://waterdata.usgs.gov/monitoring-location/USGS-02177000/
- Chauga River above Westminster:
  https://waterdata.usgs.gov/monitoring-location/USGS-344108083090600/

Historical analyses can use the stations and periods identified in the original
time-series metadata. The regional command discovers matching daily mean series
within the retained domain and requested period, so its selected source set follows
the current published data inventory.
