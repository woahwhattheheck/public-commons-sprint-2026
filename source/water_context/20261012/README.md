# Upper Savannah water source inputs

ECO-SOURCE12 supplies real public source data for the RFP's source-water and high-quality-water map families. The native importer uses the existing upstate.sources/v1 contract. The receiving-waters, receptor, portfolio and delivery owners consume the original source features and prepared contextual tables.

## Complete acquired inputs

- NRCS FY26 source-water priorities: original ArcGIS JSON, 158,251 bytes. SHA256 8a5d612f0869eab7011ceeaf116c3150b4717788ae6fe30617ec260c4eca3dcd. 337 state-HUC records across 303 distinct HUC12 codes in the 030601 prefix inventory.
- SCDES classified streams: original Esri polyline JSON, 4,978,867 bytes, publisher coordinates EPSG:3857. Capture contains 1,886 unique source OBJECTID values: 1,040 ORW, 247 TN and 599 TPGT. The original attribute pages were read completely and reconciled to the grouped source counts.
- NRCS CSV: 34,458 bytes; SCDES CSV: 168,811 bytes. Both complete derived tables retain original record IDs and source columns. Import HUC12 columns as strings.
- Adopted regulatory references: SCDES R.61-69, 667,947 bytes; EPA retained R.61-68, 779,027 bytes.
- Original layer metadata, application settings, field aliases/domains, one complete original geometry feature, grouped source counts and stable source references accompany the dictionary.

The retained source page contains every original file and full CSV:
https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e

The Slack carrier contains the complete executable source and small typed inputs. Read the source page with the normal Notion fetch tool. Resolve its exact notion-file-block references with get_file_download_urls for native downloads. The two CSVs and the NRCS original are also readable through download_attachment using the upload IDs recorded in the delivery message. Retain these original files with the application source edition.

## Prepare and import into the existing application

From the opportunities/upstate_forever_2026 root:

~~~sh
node source_tools/water_context_cli.mjs \
  --domain /path/to/original/model-domain.esri.json.gz \
  --nrcs /path/to/nrcs-source-water-fy26-upper-savannah-20261012.json \
  --classified /path/to/scdes-classified-streams-upper-savannah-original-esri.json \
  --out /path/to/workspace/source/water-context-20261012
~~~

The domain may also be a GeoJSON/Esri feature JSON, a JSON string array of exact HUC12 codes, or an object with huc12s. Use --huc-field for a different actual field name. The supplied focus-hucs.json contains the four RFP focus HUCs and exercises the focused view. The retained full model domain determines the regional join.

The CLI preserves both raw source bodies, computes their actual byte counts and SHA256 values, and writes sources.json for Workspace.import_sources. It also writes water-context.json, a domain-filtered nrcs-priorities-by-state.csv, the complete classified-reaches.csv, exact domain-huc12s.json, and source-file-manifest.json. All companion paths remain relative to the manifest directory.

The source core was executed here against the complete 337 NRCS rows and 1,886 SCDES attribute rows. The four-focus join has five state-HUC rows and no missing focus HUC; the complete NRCS candidate-inventory join retains all 337 rows. The Node filesystem wrapper is ready for the native receiver to execute on its retained original domain.

## Actual focus values

| HUC12 | RFP area | State | FY26 status | System | Concern |
| --- | --- | --- | --- | --- | --- |
| 030601010703 | Upper Six and Twenty Creek | SC | Not Selected | null | null |
| 030601010704 | Lower Six and Twenty Creek | SC | Not Selected | null | null |
| 030601020502 | Choestoea Creek | SC | Not Selected | null | null |
| 030601020507 | Lower Tugaloo River | GA | High Priority Area | Ground | Water Quality |
| 030601020507 | Lower Tugaloo River | SC | High Priority Area | Ground | Water Quality |

A state-HUC record is keyed by huc12_code plus st_usps. st_ac describes the state portion; huc12_ac repeats the full HUC area on each state row. Keep missing source coverage distinct from an explicit Not Selected value. Preserve the Ground classification on Lower Tugaloo when describing that priority.

## Classified-water spatial join

The active state application publishes its stream layer at:
https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2

Discovery source:
https://gis.des.sc.gov/stormwater/js/a_settings.js

Use OBJECTID as the source key. The object's display alias is OBJECTID_1; the separate OBJECTID_1 field is not the key. H2OCLASS is the mapped class; HYDNAME is the source name; HUC_12 is the publisher watershed attribute. The dictionary includes exact types, aliases, spatial reference and one original feature. Blank names and counties remain source blanks. The metadata does not publish editingInfo.

Clip/intersect original reach geometry against the retained model domain and reproject with the native GIS reader. Keep the source HUC12 and any newly assigned model HUC12 as separate fields. Use the actual hydrologic network to associate upstream lands with classified reaches. This adds the needed receiving-water context to land priorities. Source feature counts are geometric record counts, not unique named rivers or an area-based designation.

The SCDES application calls its mapped classification provisional. Adopted R.61-69 defines waterbody names, counties, classes and geographic reach descriptions:
https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf

The September 25, 2026 proposed triennial amendment remains a prospective edition on the state docket:
https://des.sc.gov/permits-regulations/regulations-regulatory-updates/regulations-currently-under-amendment-recently-finalized

## Operator wording and decision use

Use source-specific labels in the existing panels:

- NRCS FY26 source-water priority — status, state, system type and resource concern.
- SCDES mapped classified waters — original reach class and adopted reach reference.
- Modeled annual export or reduction — selected native run, physical units and paired support.
- Contributing lands to designated waters — the linked native reach/catchment selection.

The RFP asks for important lands protecting outstanding resource and trout waters. The state features provide those actual receiving-water designations. Native scenario benefits then compare physical baseline and alternative outputs on common valid support.

NRCS program context:
https://www.nrcs.usda.gov/programs-initiatives/source-water-protection

## Upstate Forever's prior parcel workflow

The Lake Keowee watershed plan, section 9, scores parcels separately for protection, restoration and BMP categories using category-specific criteria. It clips county parcel inventories to the watershed. Already protected lands are excluded from additional protection ranking, while restoration/BMP analyses include all parcels. Category totals support subsequent refinement and review. For this product, retain protected-land status, action category, physical modeled quantities and configurable decision weights as distinct fields.

Primary source:
https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/WPLakeKeowee.pdf

This method strengthens the parcel operator: preserve an already protected parcel in restoration workflows and expose the basis of its priority in the same record. Existing E7A1 and receiving-waters consumers retain their native engines and portfolio ownership.
