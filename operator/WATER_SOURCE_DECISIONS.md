# Water sources: operator decisions and the two-utility example

The designation desk turns a reviewed subset of an imported vector source into a saved GIS selection, a reopened record, and a delivery overlay. Use it to retain the actual receiving-water or protection-area geometry. Use the existing receiving-water engine to identify the land related to that geometry and summarize the modeled exports.

Upstate Forever's project identifies lands whose development could disproportionately affect water resources and drinking-water supplies. It also identifies current nitrogen, phosphorus and sediment export priorities. The two cooperating utilities are Anderson Regional Joint Water System (ARJWS) and Pioneer Rural Water District (Pioneer/PRWD). This makes the relationship between a receiving water, its published protection area and the upstream contributing land an operator decision with consequences for the delivered maps. [Issuer project description](https://www.upstateforever.org/news/upstate-forever-seeks-consultant-for-gis-mapping-and-modeling-services).

## Choose the geometry that answers the question

| Question | Retained source and geometry | Desk or model operation |
|---|---|---|
| Which mapped reaches have the selected legal classification? | SCDES classified-water lines; exact original class values and feature identities | Save a high_quality_waters designation. Retain the R.61-69 reach rule and the source's own status and edition. |
| Where are the utilities' published surface-water protection areas? | Public_Water_Supply/MapServer/2 polygons, including their original BUFFER_FT records | Save a drinking_water designation; use the existing source_area relation for the actual polygon footprint. |
| What land lies upstream of an intake or selected receiving reach? | Original intake point or classified-water receptor, plus the retained connected HUC12 network | Prepare an upstream_huc relation through the existing receiving-water engine. Keep the network, contributing membership and selected model domain. |
| Which priority parcels already intersect protected land? | The selected protected-land inventory and its publication edition | Retain the protected_lands overlay and the parcel analysis alongside the water-source selections. |

The protection-area publisher describes an extent of 15 miles upstream of the surface intake. Its 200-foot and 1,500-foot records are already polygons. Retain their geometry and original width attributes. Name these layers **Surface-water protection areas**. Use **Upstream source-water catchments** for derived upstream catchments. A general drinking-water overlay label can be **Drinking-water source areas**. [Official layer description and fields](https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2).

Public_Water_Supply layer 0 supplies intake points. Layer 3 supplies groundwater well-protection zones, with separate low-volume, one-year, five-year and ten-year time-of-travel categories. Preserve those mechanisms and the native zone fields when that source is selected. [Official public-water service](https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer); [well-zone metadata](https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/3).

## Preserve the actual rule and data editions

As checked on October 13, 2026, the current state **R.61-68 standards** history ends with May 23, 2025, Document 5333. The current **R.61-69 classified reaches** history ends with May 26, 2023, Document 5116. Each saved reference should identify the rule it actually uses. An older retained EPA copy keeps its own edition. The state’s September 25, 2026 triennial package is a proposal, with comments through October 26, 2026. [State R.61-68](https://des.sc.gov/sites/des/files/Library/Regulations/R.61-68.pdf); [state R.61-69](https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf); [official amendment docket](https://des.sc.gov/permits-regulations/regulations-regulatory-updates/regulations-currently-under-amendment-recently-finalized).

R.61-69 Section E defines class abbreviations, Section F explains prior classes in parentheses and site-specific markings, and Section H defines the individual reaches. The shared classification crosswalk already resolves these labels. Preserve its full result and the raw H2OCLASS value. Select exact observed source values in the desk.

For the practical Chattooga/Chauga case, the rule changes at Opossum Creek on the Chattooga and one mile above US Route 76 on the Chauga. The retained 377-feature named-river capture has 332 ORW and 45 FW features. Its native identity field is OBJECTID_1; the active SCHydroClass/MapServer/2 regional source uses OBJECTID. Each source edition keeps its own identity binding.

The named-river case exercises the editor. The regional classified-water preparation uses the separate, complete 1,886-feature source covering the retained 217-HUC12 domain. Its full-domain publisher-HUC inventory matches all 1,886 retained object/class/HUC triples. The native crosswalk supplies the geometric intersections. Native Basin or county attributes can be blank; spatial and HUC selections provide the relevant coverage.

## Save the actual ARJWS and Pioneer protection areas

The four original layer-2 records are:

| Utility | Public-system reference | Intake reference | Original OBJECTID | Original BUFFER_FT |
|---|---|---|---:|---:|
| ARJWS | SC0420011 | S04101 | 11 | 1500 |
| ARJWS | SC0420011 | S04101 | 12 | 200 |
| Pioneer / PRWD | SC3720001 | S37109 | 131 | 1500 |
| Pioneer / PRWD | SC3720001 | S37109 | 132 | 200 |

Keep the leading zeros in the native SYSTEM values: 0420011 and 3720001. Public-system references also include the SC prefix. The original point OBJECTIDs are 6 for ARJWS and 50 for Pioneer. [Exact original polygon query](https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2/query?objectIds=11,12,131,132&outFields=*&returnGeometry=true&orderByFields=OBJECTID&f=pjson).

Use the already supplied source importer first:

~~~bash
python source_tools/prepare_public_water.py \
  --model-root /path/to/upstate-project \
  --workspace /path/to/native-workspace \
  --protection-areas /path/to/scdes-arjws-prwd-source-water-protection-original.json \
  --out /path/to/public-water-native
~~~

This retains the 71 original intake points and the four original protection polygons, imports the sources into the existing Workspace, and prepares the four existing source_area receptors. Its public-water-preparation.json records the actual imported collection ID, plan ID and original protection-source hash.

Then run the companion:

~~~bash
python source_tools/prepare_utility_designations.py \
  --model-root /path/to/upstate-project \
  --workspace /path/to/native-workspace \
  --preparation /path/to/public-water-native/public-water-preparation.json \
  --out /path/to/utility-designations \
  --delivery /path/to/existing-delivery-selection.json
~~~

The final --delivery argument is optional. The companion inspects the source already in this Workspace and matches each retained SYSTEM/INTAKE/BUFFER_FT tuple to its actual reader feature identity. This handles an original OBJECTID field and the native-FID fallback through the same desk API.

The command saves and reopens three selections: ARJWS's two polygons, Pioneer's two polygons, and the four polygons together. It records their saved IDs and direct overlay bindings in utility-designations.json. With --delivery, it writes a complete revised delivery-selection.json using the combined selection.

**Use the combined selection for a map containing both utilities.** The delivery selection has one drinking_water overlay slot. Applying an ARJWS selection and then a Pioneer selection replaces that slot. Separate saved selections remain available for individual utility maps.

## Interpret the resulting geometry and contributing-land analysis

The desk's mapped polygon area adds the original selected records. These protection records overlap. Use the receiving-water family's geometric union for a physical footprint or combined pollutant quantity. The existing four-receptor preparation preserves each 200/1500-foot record and the union.

For the classified-water case, report the desk metric as **Mapped line length**: the original service includes bank and shoreline geometry. Preserve those original lines when saving; the measurement describes the geometry that was mapped.

To deliver critical contributing-land priorities, carry the prepared receiving-water relation and its resulting analysis into the map/delivery workflow alongside the desk overlay. The existing classified-receiver adapter uses the retained HUC network for upstream_huc membership; the existing public-water importer uses source_area for the published protection polygons. The resulting report should identify which relation produced its selected land, retain the selected model and reporting scope, and show the original designation or protection geometry as context.

## Exact receiving inputs

- Desk component: current unified water-designations source, including model/water_designations.py.
- Existing source component: source_tools/prepare_public_water.py and source/water_context/20261012/public-water.
- Original four-polygon input: scdes-arjws-prwd-source-water-protection-original.json; 2,389,556 bytes; SHA256 ddac0feb1c704ca5e95336e21961e08beede1f83b6b820423dffa5a63bd8e285; native EPSG:26917.
- Original named-river case: source/water-designations-case in this complete release; GeoJSON SHA256 eecab9bc33f02ab393c178297d966b35e9c372887b5fd23eaf00cc85817fbcea.
- Existing regional classified-receiver preparation and source_tools/designation_crosswalk.py; shared classification crosswalk v1.1.0 and source-review v1.3.0, documented in source_tools/WATER_DESIGNATION_APPLICABILITY.md and operator/WATER_SOURCE_REVIEW.md.

These source-specific inputs let the equipped native receiver continue its existing four-receptor run directly into operator selections and the saved delivery.
