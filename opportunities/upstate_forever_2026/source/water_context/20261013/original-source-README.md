# Upper Savannah full-domain source-water context

The unchanged ECO-SOURCE12 source core has been executed against the original
217 model-domain HUC12 IDs, all 337 retained NRCS state-HUC records, and all
1,886 retained SCDES classified-feature records. The output covers the complete
actual model domain and can be imported through the existing Workspace source
pipeline.

## Results

| Quantity | Actual result |
|---|---:|
| Original model-domain HUC12 IDs | 217 |
| Distinct model-domain IDs | 217 |
| Matched NRCS state-HUC records | 240 |
| Model HUCs without an NRCS row | 0 |
| Source NRCS rows outside the selected domain | 97 |
| Matched high-priority state-HUC records | 18 |
| Distinct HUCs with a high-priority state row | 15 |
| Matched Not Selected state-HUC records | 222 |

The 240 rows retain 116 South Carolina, 115 Georgia and 9 North Carolina state
records. Five South Carolina rows and thirteen Georgia rows carry the original
High Priority Area value. These are state-specific program designations.
Their original Ground, Surface or Both system type and Water Quality resource
concern travel with each record.

The original four utility-focus HUCs are retained in this full domain. Lower
Tugaloo River has Ground / Water Quality priority rows for both Georgia and
South Carolina. Upper Six And Twenty Creek, Lower Six And Twenty Creek and
Choestoea Creek carry the original South Carolina Not Selected status.

## Files and direct use

- domain-huc12s.json is the compact original ID array received from the native
  domain extractor; it preserves twelve-character IDs and leading zeros.
- full-domain-water-context.json is the complete buildContext result.
- nrcs-domain-fy26.csv contains the 240 exact matched source rows using the
  publisher field names.
- source-context-run.json retains original byte identities, source-code
  identity, execution counts, class-capture scope and all fifteen priority HUCs.
- classified-full-domain-query.json provides the ready ArcGIS ID query and
  source-feature acquisition contract for the complete actual domain.
- sources.json is an upstate.sources/v1 manifest for the existing Workspace
  importer. Its paths are relative to this directory.

Run the existing source import against this directory's sources.json. The new
source IDs are nrcs-fy26-upper-savannah-domain217-20261013 and
upper-savannah-water-context-domain217-20261013. The previous original source
collection remains useful for direct native geometry and complete raw metadata.

## Classification acquisition scope

The original 1,886 classified features are valid retained source records.
Their query selected HUC8 prefixes 03060101, 03060102 and 03060103. The actual
217-HUC model domain also contains 03060104, 03060105, 03060106 and 03060107.
The full-domain query in this package selects all original 217 HUC12 IDs and
the original ORW, ONRW, TN, TPGT and TPT codes from SCHydroClass/MapServer/2.

Receive the original matching object-ID list, then acquire original feature
batches from those IDs. Reuse existing features by their real OBJECTID and
retain the newly received original responses. The active native OID field is
OBJECTID; the alias OBJECTID_1 refers to this field, while the separate field
OBJECTID_1 is nullable. Preserve source field names and geometry coordinates.

The classified-source inventory inside full-domain-water-context.json describes
the actual captured source selection. The run companion makes that scope
explicit. The existing receiving-water engine performs the later positive
geometry/HUC intersections and original ToHUC upstream association; the
publisher HUC_12 attribute is retained as a source attribute.

## Meaning in the product

Keep the NRCS state rows, source-system type and resource concern together.
Use the original source-water protection polygons for a source-area relation.
Use the original ToHUC graph for an upstream relation. Those two spatial
relationships describe different features of a drinking-water study.

A HUC program-priority flag does not turn into a stream designation or a
published intake-protection boundary. The operator can show the priority
context alongside native NDR/SDR outputs and separately selected receiving
waters. HUC acreage repeated on cross-state records must be counted once when
describing whole-HUC area; st_ac is the source's state portion.

## Original sources

- NRCS FY26 service:
  https://services.arcgis.com/SXbDpmb7xQkk44JV/ArcGIS/rest/services/Source_Water_Protection_Resource_Concern_FY26/FeatureServer/7
- SCDES mapped classifications:
  https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2
- Original domain extraction and compact ID array:
  https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791850636130089
- Original source package: F0C9J6KRJDN.
- Original retained geometry, metadata and source tables:
  https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e

The compact ID-array SHA-256 is
ec0cb3d05a0ede9da1b9238b7c7bff2fa495d94e5a6a0451890b54233edfbd52.
The full-domain JSON SHA-256 is
d607c93912102fbb8f28139a5d57b01b0e1886b0155ede16fc1a19d654323566.
