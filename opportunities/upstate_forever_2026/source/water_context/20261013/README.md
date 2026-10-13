# Upper Savannah full-domain source-water context

This edition imports the original 217 model-domain HUC12 IDs and complete native source-water context into an existing Workspace. The context joins the 337 retained NRCS FY26 state–HUC records to the actual domain and retains the original SCDES classified-water attributes.

## Import the prepared edition

Run from `opportunities/upstate_forever_2026`, using the path of the existing project Workspace:

```sh
python -B -m model.cli --workspace /path/to/existing-workspace source-import source/water_context/sources-20261013.json
```

The importer checks the supplied SHA-256 values and retains each body and companion in the Workspace's existing source store. The source collection returned by this command contains these stable entry IDs:

- `nrcs-fy26-upper-savannah-domain217-20261013`, role `SOURCE_WATER_PRIORITY_CONTEXT`: the 240 selected state–HUC records.
- `upper-savannah-water-context-domain217-20261013`, role `SOURCE_WATER_CONTEXT`: the full native context document.

The manifest is one directory above this guide. All paths resolve from `source/water_context`, allowing the 20261012 raw captures and 20261013 domain files to travel together without parent traversal. Select this imported collection's `SOURCE_WATER_CONTEXT` entry in the decision-context workflow. Retain the existing SCDES geometry source entry for native receiving-water analysis and classified-water crosswalks.

## Actual domain and source coverage

| Quantity | Retained result |
|---|---:|
| Original, distinct model-domain HUC12 IDs | 217 |
| Original NRCS state–HUC records | 337 |
| Records matching the selected domain | 240 |
| Original records outside the domain | 97 |
| Selected HUCs without an NRCS row | 0 |
| Matched high-priority state–HUC records | 18 |
| Distinct HUCs with a high-priority state row | 15 |
| Matched Not Selected state–HUC records | 222 |
| Classified-water source features | 1,886 |
| Publisher HUC12 attributes represented by those features | 19 |

The selected NRCS records comprise 116 South Carolina, 115 Georgia and nine North Carolina rows. Five South Carolina rows and thirteen Georgia rows have the original High Priority Area value. The high-priority system types comprise eight Ground, five Both and five Surface records. Each row retains its original state, source-water system type, resource concern and acreage.

The classified attributes retain 599 TPGT, 1,040 ORW and 247 TN features. The original full-domain coverage capture confirms the same 1,886 feature IDs across the selected 217 HUCs, including a zero count for the target classes in HUC8 prefixes 03060104–03060107. The coverage companion preserves the original query URLs, byte identities, response hashes and complete-geometry reference.

## Files retained by the manifest

| Relative path under source/water_context | Role |
|---|---|
| `20261013/domain-huc12s.json` | Original compact 217-ID array, with twelve-character IDs and leading zeros |
| `20261013/full-domain-water-context.json` | Exact native `upstate.water-context/v1` document |
| `20261013/nrcs-domain-fy26.csv` | All 240 selected state–HUC rows in the original CSV serialization |
| `20261013/scdes-domain217-source-coverage.json` | Original complete-domain classification query and feature-equivalence record |
| `20261012/raw/nrcs-fy26.json` | Complete original 337-row NRCS source capture |
| `20261012/classified-reaches.csv` | Original 1,886 classified-feature attribute records |
| `20261012/source-dictionary.json` | Original field definitions, source identities and acquisition metadata |

The NRCS table entry includes the raw NRCS body, original IDs and source dictionary as companions. The context entry includes every file in this table and the original USGS network companion described below. Both use the same content identities, so the existing source store can reuse retained objects.

The classified CSV contains attributes; the existing retained SCDES geometry source supplies coordinates for spatial operations. Historical response filenames inside the unchanged coverage record identify the original capture. Its associated query URLs and hashes remain available there, while the manifest explicitly enumerates the files supplied in this edition.

## Original watershed network

The context entry retains `20261013/native-network.json`, the unchanged 71,787-byte USGS Savannah topology source. It contains 303 unique native `huc12` / `tohuc` rows, including every one of the selected 217 model HUCs. The existing watershed-context loader locates this companion by its filename and uses the original routing attributes directly.

Its content is identical to the canonical repository capture at `source/receptor-topology/20261013/usgs-wbd-savannah-original-topology-20261013.json`, SHA-256 `2e57f86d1725526f00f16870b1b03d9168b41ea94de6d0016b20dfe15e89bcac`. The source manifest retains the exact USGS WBD layer 6 request, capture vintage and original source entry identity. The topology companion travels in the same imported source collection as the context body, so the existing operator's watershed report can reopen the source and native network together.

## Interpretation in the model and operator

NRCS priority remains a state-specific programme designation. The `st_ac` field is the acreage of the state portion; `huc12_ac` is whole-HUC acreage and repeats across state records. Preserve the state–HUC rows when reporting programme priority, system type and resource concern, and count whole-HUC acreage once for a HUC-area summary. Missing source coverage and the explicit Not Selected status remain distinct.

The publisher's `HUC_12` attribute remains source context. Native geometry intersections establish spatial membership; the original ToHUC graph establishes upstream association. Existing receiving-water analysis supplies paired NDR/SDR quantities and their original physical units. The decision-context report joins these saved analysis results with the selected source context and classified-water crosswalk.

## Source identity and reproducibility

The unchanged `source_tools/water_context.mjs` implementation was executed against the exact retained 217 IDs, all 337 NRCS rows and all 1,886 classified attributes. The recomposed complete JSON structure and UTF-8 serialization match the retained native output byte for byte. The selected CSV also matches the original 240-row file.

| File | Bytes | SHA-256 |
|---|---:|---|
| `domain-huc12s.json` | 3,256 | `ec0cb3d05a0ede9da1b9238b7c7bff2fa495d94e5a6a0451890b54233edfbd52` |
| `full-domain-water-context.json` | 152,659 | `d607c93912102fbb8f28139a5d57b01b0e1886b0155ede16fc1a19d654323566` |
| `nrcs-domain-fy26.csv` | 24,474 | `478c36af3e01178b788ead7f474d94c1f3ae58d6ad5f1fa896b3d90e09766be5` |
| `scdes-domain217-source-coverage.json` | 7,043 | `2ed2f1bd402437d91aa8c1544d583dd5ceaf7da7e202aed1252f1b3ea47b3bcb` |

Original sources:

- [NRCS FY26 source-water priorities](https://services.arcgis.com/SXbDpmb7xQkk44JV/ArcGIS/rest/services/Source_Water_Protection_Resource_Concern_FY26/FeatureServer/7)
- [SCDES mapped classifications](https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2)
- [Original model-domain extraction and IDs](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791850636130089)
- [Retained original geometry, metadata and complete-domain response records](https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e)

The existing [20261012 source guide](../20261012/README.md) describes acquisition and the CSV-primary source CLI. This prepared edition supplies the actual full-domain import directly.
