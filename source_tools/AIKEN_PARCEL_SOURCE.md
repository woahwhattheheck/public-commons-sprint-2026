# Aiken County parcels from the original SCFC Coastal source

## Original source and coverage

The South Carolina Forestry Commission's official [Forest Stewardship application](https://www.scfc.gov/management/stewardship/forest-stewardship-application/) links its [parcel qualification StoryMap](https://storymaps.arcgis.com/stories/8cbb85193ed94a3eb14c34260c894c46). The original story node `n-NutIeD.data.link`, following the Coastal county list containing Aiken, opens [Coastal Region App](https://scfc.maps.arcgis.com/apps/webappviewer/index.html?id=f9340b121b1e4f1cb19e2b50e284a417). Its public item metadata references web map `027939b0a770497ba274604133c92982`; the original map's `operationalLayers` entry titled Parcel Boundary points to this exact service:

https://services9.arcgis.com/MvVEDRWecTZBD2xl/arcgis/rest/services/Parcels_Coastal/FeatureServer/0

This is a state forestry stewardship parcel copy. It is a distinct source edition from Aiken County's current assessor viewer. The service contains thirteen Coastal county values, so the literal county predicate is part of this provider's identity:

```sql
County = 'Aiken County'
```

Original queries captured on 2026-10-13 returned:

| Property | Original result |
| --- | --- |
| Aiken polygon records | 101,173 |
| Non-null T_Map_Number values | 101,173 |
| Native OBJECTID range | 1–101173 |
| Geometry type | esriGeometryPolygon |
| Native CRS | 103146 / latest6570 |
| Original geometry units | esriFeet |
| Query maximum record count | 1,000 |
| Aiken-only WGS84 extent | -82.014916373263887, 33.196613421676339, -81.187129906507721, 33.878601166090831 |
| Observed service dataLastEditDate | 1776791197075 / 2026-04-21T17:06:37.075Z |

The observed service edit timestamp does not state every parcel's legal effective date. The county count and extent describe the observed original source selection; the maintained collector independently captures current metadata, exact original IDs and their complete response pages at execution. The application selects Aiken only when the original reporting-area/county intersection has positive area.

`OBJECTID` is the original feature identity. `T_Map_Number` is a string of up to fifty characters. Preserve punctuation and leading zeros; do not infer uniqueness from the non-null count. The complete original sample for OBJECTID1 has reference `036-08-07-001` and a closed native polygon ring.

SCFC's `Acreage`, `PriorityAcres`, `ForestAcres`, `PriorityPercent` and `ForestPercent` remain separate publisher attributes. Capture every original Aiken polygon selected by the reporting masks, including parcels with zero forest or priority acreage. Forestry qualification and parcel coverage are different selections.

## Complete source retention

The ten complete original small responses, their original public URLs, byte lengths and SHA256 identities are retained in the existing internal [ECO-SOURCE12 source page](https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e), under Aiken SCFC original parcel provider. They contain the original story, application item, exact owner/map search, web-map item, complete web map, native layer schema, county grouped counts, Aiken-only extent and statistics, and one full original polygon response. Their combined size is 47,276 bytes.

The full 546,912-byte original application configuration is already attached to that same page by ECO-SOURCE12. The complete web map is 23,587 bytes, SHA256 `5e224b0b86b6eec0c29e597fa3a783df4394b399d2181c05a1ddf47977170fda`. The original schema is 9,329 bytes, SHA256 `92ccad54d7f93190e4450869c026eb4a61450e97c436ef88896dc6429ab7e664`. Captured parcel bodies stay in the internal original-source workspace; public source contains the provider definition and operating code.

## Collector integration and source identity

Use this catalogue together with the maintained source-predicate successor of `source/capture_original_overlays.py` and `source_tools/reporting_parcels.py`. The matched collector successor is delivered in the [original source operation](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791862144818729).

The complete integration must carry `provider.where` into the original count and exact-ID queries, retain the predicate in `selection.json` and `layer-capture.json`, and compare it for restoration and same-mask source reuse. Exact-ID geometry pages continue to preserve the original selected records. The original `County` attribute must match `Aiken County` before those records receive Aiken's county-qualified identity. The provider definition records `native_county_field` and `native_county_value` for that check.

Existing single-county providers have an implicit `1=1` source predicate. Their original request identities and retained default captures remain compatible. An older unfiltered capture of this multicounty source is not a matching Aiken capture. Changing the catalogue or predicate produces a new source-bound plan; retain previous captures and reuse only providers whose URI, predicate and original acquisition masks still agree.

## Continue the existing native operation

From the current application, use its accepted interpreter, actual retained Workspace and existing reporting-parcel operation root:

```sh
python -B -m source_tools.reporting_parcels run \
  --workspace ACTUAL_RETAINED_WORKSPACE \
  --output EXISTING_REPORTING_PARCEL_OPERATION \
  --catalog source_tools/SC_PARCEL_PROVIDERS.json
```

The maintained `run` command derives the plan identity from the actual county geometry, catalogue and tile size. It preserves the original county capture, creates the new plan directory and reuses complete unchanged provider captures with the same original acquisition masks. It then captures remaining original sources, prepares the inventory and binds the returned selection into that same Workspace. Keep the resulting `reporting-parcel-run.json`, source manifest, county coverage and parcel inventory with the existing operation.

For a separately transferred existing plan containing this provider:

```sh
python -B -m source_tools.reporting_parcels receive \
  --plan-directory ACTUAL_NEW_SOURCE_BOUND_PLAN \
  --output ACTUAL_CAPTURE_DIRECTORY \
  --provider aiken-scfc-coastal-stewardship-copy
python -B -m source_tools.reporting_parcels prepare \
  --capture-directory ACTUAL_CAPTURE_DIRECTORY
python -B -m source_tools.reporting_parcels bind \
  --workspace ACTUAL_RETAINED_WORKSPACE \
  --capture-directory ACTUAL_CAPTURE_DIRECTORY \
  --output ACTUAL_SELECTION_JSON
```

A provider-only capture can remain partial until the same original plan's other selected counties are complete. Preserve the original source count, returned IDs and response hashes through retries; source acquisition and preparation use the existing maintained engine.
