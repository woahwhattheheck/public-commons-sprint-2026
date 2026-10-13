# Full Upper Savannah reporting-area parcel acquisition

Operation: UPSTATE-REPORTING-PARCELS-DATA-20261013.

This extension supplies county parcel inputs to the existing source importer and ED6E parcel reducer. It selects every county with a positive-area intersection against the retained original South Carolina Upper Savannah reporting boundary, captures each selected provider's complete native feature selection, and produces an importer-ready parcel inventory with county coverage. It complements the upstream context collector and the existing NDR/SDR model.

## One complete native operation

On the equipped host with provider connectivity, run the whole reporting-area acquisition, inventory and existing Workspace import in one operation:

~~~sh
/opt/pyvenv/bin/python -m source_tools.reporting_parcels run \
  --workspace /mnt/data/upstate-workspace \
  --output /mnt/data/upstate-reporting-parcel-operation \
  --retry-failed
~~~

Use the receiver's actual existing Workspace path; add `--create-workspace` when creating its intended Workspace. The operation receives the pinned reporting source and all native county boundaries, selects every county by its actual reporting intersection, captures the selected provider originals, prepares the inventory and imports it into that Workspace. Its `parcel-selection.json` is ready for the existing parcel and delivery analysis.

The same command resumes original requests. It writes each source plan and capture under its source identity, reuses complete unchanged counties when the catalog gains a current provider, and preserves earlier inventories. The latest `reporting-parcel-run.json` contains the actual capture, manifest, inventory and imported selection paths. Provider failures remain per county while available complete counties still produce a usable imported inventory; exit status 2 accompanies that partial capture, with its actual county coverage retained.

The separate phases below support an offline GIS planner and a connected standard-library receiver.

## Source selection

The reporting mask is whole original PlanningBasins2023 record 5, selected by Basin = Upper Savannah. The original .shp, .shx, .dbf, .prj and .shp.xml come from the pinned capellett/scsf commit recorded in the original source manifest. Their exact SHA256 values are enforced by the module. The original reporting CRS remains EPSG:26917. The bootstrap downloads all five small source members directly, or reuses already-received files with those exact hashes.

County geometry comes from the SC Revenue and Fiscal Affairs Office, Geodetic Survey county boundary app, County_Polygons_CBApp/FeatureServer/4. The bootstrap retains all 46 native county records, verifies unique five-digit South Carolina FIPS, and preserves the native CRS, CountyName, FIPS, DateUpdate, BoundaryComplete and original provider metadata. The captured county edition and a boundary's legal effective date are separate attributes. The pipeline derives county coverage from the actual hydrologic reporting mask.

The provider catalog contains exact original URLs, native parcel identifiers, source provenance and explicit preferred providers. The following sources were resolved from primary provider directories:

| County | Native parcel reference | Native object ID | Provider |
| --- | --- | --- | --- |
| Abbeville | PIN, then QPID or Map_Number | OBJECTID | County-published Schneider Taxparcel layer 15 |
| Anderson | TMS | OBJECTID | NewPropertyViewer layer 5; QueryMap layer 8 is an explicit alternate |
| Edgefield | PIN | OBJECTID_1 | Full county parcel copy in the SC RFA boundary project, layer 9 |
| Greenville | PIN | OBJECTID | County GCGIA tax parcel layer 10 |
| Greenwood | PIN, then OLDPIN | FID | Full county parcel copy in the SC RFA boundary project, layer 7 |
| Laurens | TMS | OBJECTID | County LaurensCountyDataAug2025 layer 4 |
| McCormick | PIN, then taxMapNumb | FID | Full county parcel copy in the SC RFA boundary project, layer 8 |
| Oconee | TMS_NUMBER | OBJECTID | County PARCELDATA layer 1 |
| Pickens | PIN | OBJECTID | County ArcReaderData layer 2 |
| Saluda | SDE.DBO.Parcels.TaxMapNumber | SDE.DBO.Parcels.OBJECTID | County PublicWebsite_Pro layer 4 |

A catalog county contributes only when the original reporting intersection selects it. Any selected county without a configured provider appears in required-counties.csv and capture-progress.json. Current county viewer recovery and source additions can be applied in a new retained plan without discarding completed captures.

The three RFA parcel copies carry their own observed 2025 source editions. Metadata capture times, provider data-edit values and parcel record date fields remain distinct. Adopt a current county successor by changing the explicit preferred provider in a new catalog/plan. Different providers' OIDs and geometries retain their separate source identities.

## Runtime division

The boundaries, receive, bundle and unpack commands use Python's standard library on the connected host. They compose the original capture_original_overlays.py collector, including its exact-declaration CRS fast path. The plan phase needs the existing Shapely, pyproj, Fiona and pyshp geometry runtime. The prepare phase needs Shapely, pyproj and Fiona. The vector preparation preserves the original model grid.

Install the new module, this guide and SC_PARCEL_PROVIDERS.json into the application's source_tools directory. The current upstream-context delivery supplies source_tools/domain_overlays.py and the compatible original collector. Keep the original source helper and model/common.py and model/rasters.py from the cumulative application.

All commands run from the application directory containing model/ and source_tools/. Use the actual interpreter and source volume on the receiving host.

### 1. Connected host: fetch original reporting and county sources

The confirmed 405F application is /dev/shm/upstate-405f-20261012/application. Its retained original model-domain ZIP is /dev/shm/upstate-405f-20261012/inputs/dbc61-upstate-model-domain-20261012.zip. This parcel bootstrap retrieves its reporting mask independently.

~~~sh
python -m source_tools.reporting_parcels boundaries \
  --output /dev/shm/upstate-reporting-counties-20261013 \
  --archive /dev/shm/upstate-reporting-counties-20261013.zip
~~~

The result includes original-reporting/PlanningBasins2023.shp and its four companions, exact reporting download bodies/receipts, layers/sc-county-boundaries/features.esri.json.gz, original county responses, county-boundaries.json and the catalog. It prints the actual transfer size and SHA256. Use the existing authorized original-data transfer into the GIS host.

A received original reporting source can also be placed in the bootstrap output's original-reporting directory before the command. The bootstrap verifies each original hash and reuses those bytes.

### 2. GIS host: derive the full reporting plan

Use the exact archive hash returned by the sending host with --archive-sha256 when available.

~~~sh
/opt/pyvenv/bin/python -m source_tools.reporting_parcels unpack \
  --archive /mnt/data/upstate-reporting-counties-20261013.zip \
  --output /mnt/data/upstate-reporting-counties-20261013

/opt/pyvenv/bin/python -m source_tools.reporting_parcels plan \
  --reporting /mnt/data/upstate-reporting-counties-20261013/original-reporting/PlanningBasins2023.shp \
  --county-capture /mnt/data/upstate-reporting-counties-20261013 \
  --output /mnt/data/upstate-reporting-parcel-plan-20261013 \
  --archive /mnt/data/upstate-reporting-parcel-plan-20261013.zip
~~~

This writes the actual required-county list and hectares, the reporting/county intersections in EPSG:5070, and 25km clockwise rectangular acquisition masks covering the reporting polygon. Every selected county provider is queried against all reporting tiles. This preserves parcels that straddle a recent county boundary or sit outside a county polygon's current geometry. Tile-edge overcoverage remains in native sources. Preparation selects parcels by a positive reporting intersection, publishes each complete analytical polygon, and measures the reporting intersection separately.

The plan includes original reporting members and county responses. It reports county-union area, reporting area outside that union, and summed county-intersection area so version differences and county polygon overlaps stay visible.

### 3. Connected host: receive selected counties

~~~sh
python -m source_tools.reporting_parcels receive \
  --plan-archive /dev/shm/upstate-reporting-parcel-plan-20261013.zip \
  --output /dev/shm/upstate-reporting-parcels-20261013
~~~

The collector requests independent counts and complete native object IDs for every mask, deduplicates IDs, then fetches exact-ID pages. It checks every page, retains native CRS and Z/M flags, and separately retains original true curves plus a provider-linear analytical representation when needed. It requests native coordinate precision without a simplification tolerance.

After each completed county, the command publishes a usable native source manifest. It continues other selected counties after a provider exception. Exit0 means complete acquisition; exit2 means a partial capture. capture-progress.json contains actual county status and exception details. Original responses and completed data remain available.

Retry the same capture after the provider's returned retry window:

~~~sh
python -m source_tools.reporting_parcels receive \
  --output /dev/shm/upstate-reporting-parcels-20261013 \
  --retry-failed
~~~

Repeat --provider to allocate separate whole county provider operations to existing workers. Use one writer per capture directory; the module takes a nonblocking file lock and retains request identities. The source plan continues to describe the full reporting area when a worker completes a subset first.

### 4. GIS host: prepare parcel and coverage products

Transfer the actual capture directory to the GIS host. The bundle/unpack commands preserve exact files and reject mismatched members, unsafe paths, duplicate names and changed hashes. Use a volume with space for the retained source and transfer copy.

~~~sh
python -m source_tools.reporting_parcels bundle \
  --directory /dev/shm/upstate-reporting-parcels-20261013 \
  --archive /dev/shm/upstate-reporting-parcels-20261013.zip

/opt/pyvenv/bin/python -m source_tools.reporting_parcels unpack \
  --archive /mnt/data/upstate-reporting-parcels-20261013.zip \
  --output /mnt/data/upstate-reporting-parcels-20261013

/opt/pyvenv/bin/python -m source_tools.reporting_parcels prepare \
  --capture-directory /mnt/data/upstate-reporting-parcels-20261013
~~~

Preparation creates a source-addressed inventory directory. It processes available complete county captures while others are receiving. When more providers complete, another prepare creates an inventory from the enlarged source set and preserves the preceding result.

## Prepared products and importer binding

parcel-sources.json uses the existing upstate.sources/v1 schema. Its prepared PARCEL entry binds layer = parcels_reporting and id_field = parcel_id. Import it through the existing Workspace source importer, then select that PARCEL source in parcel/scenario analysis. Original sources and response lineage remain companions.

The native capture manifest uses PARCEL_SOURCE for original county collections. The prepared manifest supplies PARCEL for the reducer.

The `bind` command imports the actual prepared source bodies into the existing scientific workspace and writes the exact selection consumed by `model.priorities.parcel_inventory`:

~~~sh
/opt/pyvenv/bin/python -m source_tools.reporting_parcels bind \
  --workspace /mnt/data/upstate-workspace \
  --capture-directory /mnt/data/upstate-reporting-parcels-20261013 \
  --output /mnt/data/upstate-reporting-parcel-selection.json
~~~

Use the existing workspace's actual path. Add `--create-workspace` only when creating the intended workspace for the first time. The source importer returns its actual content-addressed collection ID. The command retains that ID together with the prepared source's original ID, layer and qualified parcel ID field:

~~~json
{
  "source_collection_id": "<actual imported collection id>",
  "source_id": "sc-reporting-parcels-<actual source fingerprint prefix>",
  "layer": "parcels_reporting",
  "id_field": "parcel_id"
}
~~~

Pass this JSON object as the existing parcel selection. In a full delivery selection, assign it to `selection.overlays.parcels`; also set `source_roles.PARCEL` to its `source_collection_id` and `source_id` so the same imported source is included in delivery lineage. The analysis engine opens the imported GPKG through `Workspace.source_file`, projects to the received model grid, and reduces each reporting parcel independently. Repeating `bind` preserves the existing imported collection when its original source identity is unchanged. After a larger or revised native capture, it writes the selection for that imported edition.


| Output | Contents |
| --- | --- |
| reporting-parcels.gpkg / parcels_reporting | Complete eligible source polygons with positive reporting overlap; whole and reporting areas remain separate attributes |
| reporting-parcels.gpkg / cadastral_context | Complete source polygons for road, water, rail, outside-county and unclassified cadastral categories |
| reporting-parcels.gpkg / county_reporting | Reporting/county geometry and source coverage measures |
| reporting-parcels.gpkg / parcel_coverage_gaps | Spatial gaps in available source coverage, classified by provider status |
| parcels.csv | Parcel candidate inventory with county, provider, native ID, parcel reference and areas |
| cadastral-context.csv | Parallel inventory of source categories outside parcel ranking |
| county-coverage.csv | Expected reporting hectares, observed unique coverage, parcel-only coverage and overlap |
| county-sources.csv | Provider URI, native OID field, exact hash, capture/data-edit dates and counts |
| excluded-records.csv | Native records with absent geometry, nonpolygon repair outcomes, or no positive reporting intersection |
| geometry-corrections.json | Original-ID-linked repairs from the maintained geometry reader |
| methods.json | Preparation version, whole geometry, reporting intersection, identity, units, classification and coverage definitions |
| parcel-inventory.json | Latest prepared inventory and existing reducer binding |

The prepared key is county FIPS:provider ID:native OID. Native parcel references such as TMS/PIN remain strings, including leading zeros and fully qualified Saluda keys. Duplicate parcel references remain independent source records. Overlapping parcels keep independent model reductions.

Whole-source and clipped areas use actual geometry in EPSG:5070, measured in hectares. `parcels_reporting` and `cadastral_context` retain complete polygons after the maintained reader's recorded repairs and coordinate transformation. `whole_feature_area_ha` measures that complete geometry; `reporting_area_ha` measures its intersection with the original reporting mask. The ED6E reducer receives the complete polygon, calculates its original `area_ha`, and clips it against the selected analysis reporting mask itself. Coverage still intersects each full polygon with the exact county/reporting tile before forming a union. The model continues to use its received 30m grid and original raster units.

The preparation method is `upstate.reporting-parcels/whole-original-polygons/v2`. It is part of the source fingerprint, preparation context, source metadata and inventory result. Re-run the existing `prepare` command on the retained capture to create this edition, then import the returned `parcel-sources.json` and select its actual source-collection/source IDs in the existing delivery. Earlier inventories that contained reporting-clipped geometry remain under their original fingerprints and cannot be reused as this method. Original county responses and native feature bodies are reused unchanged.

### Abbeville source categories

The Taxparcel layer publishes PolyType: 0 Unknown, 1 TaxParcel, 2 Road, 3 Railroad, 4 Railroad Crossing, 5 Outside County, 6 Water, and 7 Government Parcel. Types1/7 feed candidates. Roads, rail, water and unclassified records remain context. Type5 stays retained and is excluded from coverage measurements. This prevents outside-county filling polygons from creating false coverage and avoids ranking roads or water as ordinary parcels.

Coverage is the unique union of available eligible cadastral records, including known road/water context. Parcel-only coverage is measured separately. Areas are reduced in spatial tiles with a Shapely index. Summed record area minus unique union is retained as overlap_excess_ha.

A gap from a pending provider has class provider_capture_pending. A gap after its complete original ID capture has class no_published_cadastral_polygon, describing available geometry. Areas outside the captured county-geometry union receive a separate contextual coverage row.


## Native parcel CRS and current county editions

The maintained original collector now explicitly requests the native source CRS when a service publishes a different map CRS. Greenwood's current `Parcels_Search_and_Select/MapServer/0` declares source EPSG:3361 and map EPSG:3857. Its retained native-coordinate response contains original OBJECTID 1 and PIN `6913-674-230` in EPSG:3361. Both the original curve and provider-linear request use the same native `outSR`.

The correction preserves the existing request identity for matching CRS declarations. Where a request needs the native CRS, it gets a deterministic new retained identity, so a former map-coordinate response remains available while the original capture resumes. The exact source and actual provider responses are supplied in the companion `PARCEL_NATIVE_CRS.md` and `source/parcel-native-crs-20261013/`.

Current county source discovery and source classification are retained separately from the previous RFA editions. The catalog identifies the selected provider explicitly; a revised county provider joins a new source plan, while unchanged completed county captures remain reusable.

## Updating sources and continuing acquisition

Copy SC_PARCEL_PROVIDERS.json to a new named catalog, retain the new provider's actual URI/fields/edition, and select its ID explicitly. Run plan with --catalog and a new output directory using the same original reporting and county capture.

Reuse unchanged complete county sources while receiving that plan:

~~~sh
python -m source_tools.reporting_parcels receive \
  --plan-archive /dev/shm/upstate-reporting-parcel-plan-revised.zip \
  --output /dev/shm/upstate-reporting-parcels-revised \
  --reuse-capture /dev/shm/upstate-reporting-parcels-20261013
~~~

Reuse requires identical retained acquisition masks and exact provider URLs. Original bytes and hashes are checked and copied or linked, preserving the earlier capture.

If a live service changed its ID set during acquisition, start a new capture directory and add --fresh-provider for it. Reuse the other complete counties. The fresh provider obtains a new selection and original responses; the earlier edition remains available.

## Primary source references

- Original reporting source: https://github.com/capellett/scsf/tree/45f7ea3ca968c96e2fc6188d7f55c3b0ce60da95/data-raw/planning_basins2023
- SC county geometry: https://services9.arcgis.com/RvqSyw3diI7dTKo5/ArcGIS/rest/services/County_Polygons_CBApp/FeatureServer/4
- Boundary clarifications: https://www.rfa.sc.gov/resources/geodetic/county-boundary-clarifications
- Abbeville authority: https://abbevillecountysc.com/assessor/
- Pickens authority: https://www.co.pickens.sc.us/departments/gis/index.php
- Greenville authority: https://www.gcgis.org/
- Greenwood authority: https://www.greenwoodcounty-sc.gov/it-gis/1000
- Exact parcel URLs, fields and edition notes: SC_PARCEL_PROVIDERS.json.

Domain experts review parcel classifications, source vintage and county context alongside the native inventory. The application performs NDR/SDR simulation and scenario ranking through the existing model and parcel engines.


## Current Greenwood county source and native row attributes

The maintained catalog now selects ES26's original county maintenance source
`greenwood-county-citizenserv-parcels`:
https://www.greenwoodsc.gov/arcgis/rest/services/Other_Services/CitizenServ/MapServer/11.
Its complete original provider definition and discovery are retained in
`source/greenwood-county-parcels-20261013/`. The SC RFA 2025 source remains an
explicit alternate. Other county choices and the original statewide boundary
identity are unchanged. Run the same full operation against the maintained
catalog; its source-bound plan incorporates the new provider, reuses completed
unchanged county captures, and receives Greenwood's current county edition.

The original unjoined county layer published 40,302 polygons at discovery.
Its source CRS is EPSG:3361 and its map CRS is EPSG:3857. The maintained collector
requests the full native source spatial reference in both true-curve and
provider-linear queries. ES26's original OBJECTID312542 responses in both modes
are preserved in its discovery file. `PIN` and `OLDPIN` remain strings.

The provider's per-record `REVISION` has 40,251 dated values and 51 null values;
the maximum observed source row is 2026-10-12. Each prepared parcel now retains
`source_revision_field`, `source_revision_type` and `source_revision_value`.
The value is the original scalar serialized as JSON text, with native nulls
stored as null. For an Esri date, the original epoch-millisecond value remains
available with its `esriFieldTypeDate` declaration. Capture time and the maximum
observed source revision do not replace the individual record date.

The original `TAXPARCELTYPE` codes are 0, 1, 2, 3 and 4. The captured schema
publishes no coded-value domain or subtype labels for this field. These native
codes are retained in the prepared inventory's `native_class`, with the exact
`native_class_field` and `classification_basis=uninterpreted_native_code`.
The county's published parcel cohort remains available as `parcel_source`
candidates. The code itself supplies no invented road, water, ownership or
land-use label. Providers with documented category mappings, such as Abbeville,
continue their original parcel/context/exclusion mapping. The separate county
operational `PropType` categories are being retained by ES26 as an original-ID
sidecar for this same source, preserving that joined layer's source identity.

The prepared inventory identity includes the attribute preparation revision, so
an existing retained inventory remains immutable when these new native fields
are added. Source collection binding and the county/provider/OID parcel key use
the same published consumer contract.

## Multicounty providers and exact source predicates

A provider can carry an original ArcGIS `where` expression. It is part of the
source-bound plan and must describe the actual selected county cohort. The
maintained Aiken provider, `aiken-scfc-coastal-stewardship-copy`, uses
`County = 'Aiken County'` against SCFC's thirteen-county Coastal layer. See
[AIKEN_PARCEL_SOURCE.md](AIKEN_PARCEL_SOURCE.md) for the original map, native
schema, source edition and complete acquisition route.

The collector sends the same expression with every count, original-ID and
exact-ID geometry request, including a provider-linear response when native
true curves require one. It retains the expression in `selection.json`,
`layer-capture.json`, capture progress, the native source manifest and prepared
`input_sources` / `county-sources.csv` as `source_where`. The publisher's own
`definitionExpression` remains a separate metadata value. Complete original
response bodies, coordinates and field values remain retained.

A provider that supplies `native_county_field` and `native_county_value`
must supply both as nonempty strings. Preparation verifies that the published
schema still contains the field and that every prepared source row has that
exact native value before assigning a county/provider/OID key. Aiken therefore
requires original `County == "Aiken County"`; the value is preserved without
case folding or replacement. A mismatch stops that preparation with its
provider and native OID. Native county field/value accompany prepared source
provenance and the county-source CSV.

Omitting `where` means `1=1`. Existing default captures and original request
identities remain compatible. For a filtered provider, original capture
restoration and reuse require the same URL, exact predicate text and unchanged
original acquisition masks. An older unfiltered capture cannot become an
Aiken-only capture through a catalogue edit. Use the maintained `run` command
with the updated catalogue: it creates the matching source-bound plan and
reuses only unchanged providers from earlier completed captures.

On 2026-10-13 an original service query for OBJECTIDs 1, 101173 and 101174
returned Aiken, Aiken and Bamberg respectively. The same exact-ID query with
the Aiken predicate returned only 1 and 101173. A separate full native polygon
response for OBJECTID 1 retained CRS 103146/latest6570 and parcel reference
`036-08-07-001`. Those full original requests/responses and hashes are retained
in the existing source operation. This check exercises the provider's actual
county selection; the existing reporting-mask acquisition still determines
which Aiken polygons enter a particular retained Workspace.
