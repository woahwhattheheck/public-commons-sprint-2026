# North Carolina FINAL 2022 assessment originals

This complete source capture provides the original NC DEQ Integrated Report records for HUC8 03060101 and 03060102. The service is https://services2.arcgis.com/kCu40SDxsCGcuUWO/ArcGIS/rest/services/2022_Integrated_Report_Overall_Stream_Assessment/FeatureServer (item fd9604db2885417f887d27e9b30dc0d9). Capture completed 2026-10-13 08:59:02 UTC.

## Contents

49 original JSON responses (1512202 UTF-8 bytes), the exact query/source catalog, observed inventory summary, three CSV previews, and the existing Workspace source-import manifest. All original bodies, metadata, field aliases/types, inventories and geometry coordinates remain unchanged.

- Layer 1: 1 original station, OBJECTID 3093/H6000000, Horsepasture River at NC 281 near Union, AU_ID 10512.
- Layer 2: 110 assessed streamline features, 22 original pages, 32,147 coordinate pairs.
- Layer 3: 34 assessed polygon features, 7 original pages, 6,658 coordinate pairs.
- Table 4: 77 original parameter rows for 27 of 110 selected AU_IDs. 75 rows have CYCLE 2022; 2 have CYCLE 2020. Neither missing parameter records nor No Data classifications establish attainment.

The station service stores HUC8 as the unpadded string 3060101. The initial padded-string query returned zero; both that result and the original distinct-value/corrected count/ID responses are retained. Streams and polygons use integers 3060101 / 3060102. The polygon AU_ID set is a subset of the 110 streamline AU_IDs. The original service has metadata for all four layers, including field definitions and original date representations.

## Receiving

Materialize the source bank members into the existing application with their exact project-relative names. For the original Workspace importer, pass the local manifest path:

```python
from model.workspace import Workspace
ws = Workspace('/absolute/existing/workspace')
collection = ws.import_sources('/absolute/application/source/nc_assessment_2022/20261013/sources.json')
print(collection['id'])
```

This manifest imports 30 original vector pages, 3 typed CSV previews, and one complete source-catalog document. The catalog retains all 49 original responses as companions. Each preview retains its complete original JSON response and original field definitions. The source catalog names all 49 original files and exact public requests. Source-native normalization and the actual 217-HUC geometry join remain in the existing ES-9960 assessment workflow; this capture does not replace that model or interpretation.

## Original record semantics

Preserve original AU_ID and OBJECTID independently. CYCLE, ASMNT_DATE, COLLECTION_YEAR, F303_D_YEAR and the 2022 service edition are distinct fields. IR_CATEGORY values 1, 3a and 3z1 remain their publisher strings. Preserve pollutant labels and original unit/criterion text exactly, including publisher spelling. CSV null and empty-string cells both display empty; the authoritative original JSON preserves that distinction. Geometry is returned in EPSG:3857 with true curves requested; these selected responses contain ordinary paths/rings and no curve features. No coordinate rounding, simplification or geometry repair was applied.

The110 original streamline records classify 23 Meeting Criteria, 83 No Data and 4 Data Inconclusive in IR2022. This describes the captured source rows; it is not an area-weighted regional result. The actual model-domain intersection belongs to the maintained native consumer.
