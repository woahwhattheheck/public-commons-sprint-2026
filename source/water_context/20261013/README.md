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

The manifest is one directory above this guide. All paths resolve from `source/water_context`, allowing the 20261012 raw captures and 20261013 domain files to travel together without parent traversal. Select this imported collection's `SOURCE_WATER_CONTEXT` entry in the decision-context workflow. The imported context now also retains the original SCDES geometry and domain-query bodies under their declared filenames, so the source-edition loader can validate and retain them with the report. The existing geometry source entry remains available for native receiving-water analysis and classified-water crosswalks.

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
| `20261013/scdes-classified-streams.esri.json` | Complete original 1,886-feature classified-stream geometry |
| `20261013/scdes-original-domain217-classified-objectids.json` | Original full-domain query response with the 1,886 publisher object IDs |
| `20261013/scdes-huc8-03060104-to-07-target-class-count.json` | Original zero-count response for selected classes in HUC8s 03060104–03060107 |

The NRCS table entry includes the raw NRCS body, original IDs and source dictionary as companions. The context entry includes every file in this table and the original USGS network companion described below. Both use the same content identities, so the existing source store can reuse retained objects.

The classified CSV contains attributes; the unchanged geometry companion supplies the original coordinates. The loader checks its feature IDs, class totals and publisher HUC/class rows against the domain query and context. Both original query responses use the exact historical filenames declared by the unchanged coverage record. Their URLs and hashes remain available there, and the import manifest supplies all three original bodies.

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

## Receive the original completed regional run

The companion `complete-sources.json` imports the completed 13 October receiving edition into the same Workspace source store. It preserves both stable source IDs and 22 context companions, including all seven outputs for `watershed-4592eb077b7164d59ba4`, the execution/source records, the exact original ZIP, and the historical model source used for that run.

```sh
python -B -m model.cli --workspace /path/to/existing-workspace source-import source/water_context/20261013/complete-sources.json
```

The maintained `operator/receive_watershed_context.py` consumes `received/watershed-context-20261013/eco-watershed13-received.zip` to register that original result for the existing report, selection and export views. Its archive SHA-256 is `716ddaeb211536cc90590a003bffb0bd1b18386d92cf663649743d06970868b5`.

This historical run selected Lower Tugaloo and preceded the later native-network enrichment documented above. Its source/output bytes and result identity stay together. The original seven-file edition's guide and manifest are preserved byte for byte as `original-source-README.md` and `original-sources.json`; the latter records the original filenames. Use `complete-sources.json` for the reconstructed receiving edition. The current network-enabled `../sources-20261013.json` remains available for the maintained loader.

## Open the network edition and retain its original sources

Inspect the source directory with the maintained native model and import the network-enabled manifest:

```sh
python -B source_tools/prepare_watershed_context.py inspect \
  --source-dir source/water_context/20261013

python -B -m model.cli --workspace /path/to/existing-workspace source-import \
  source/water_context/sources-20261013.json
```

In **Regional watersheds**, choose **Upper Savannah original 217-HUC domain: FY26 source-water priorities** from the imported collection and run the regional analysis. Select **030601020507 — Lower Tugaloo River** to inspect its local attributes, downstream path and distinct upstream watersheds. Save the focal, upstream or downstream selection; its CSV/JSON downloads and source files remain available when reopening the same scientific Workspace.

The network edition's core source fingerprint is `cb8ba9832d60fb47ae64b85d9e4e2c857cc2e25557572c7d251a908005bcd510`. It binds the exact context, coverage and native-network bytes. The three additional original query/geometry companions preserve the existing network report identity. Reanalyzing a retained same-source report augments its available original-source downloads under that identity. The earlier received report `watershed-4592eb077b7164d59ba4` retains its original two-input source identity.

| Original supporting file | Bytes | SHA-256 |
|---|---:|---|
| `scdes-classified-streams.esri.json` | 4,978,867 | `daae1887ba6ac25affd85fc6e1094a81ec24130e1846bbb538cf21375bdbb394` |
| `scdes-huc8-03060104-to-07-target-class-count.json` | 11 | `618de7d9f46f3f697d827a1b6d84974760d5deda62e4e592adaa3c646602a94c` |
| `scdes-original-domain217-classified-objectids.json` | 13,248 | `f30b8191b0fa0d044514dbe773e86fddf07192566e1c3c4714d477db2f4ceeab` |

These are the exact original blobs already retained in `../20261013-prepared/`. The current manifest preserves its original two source entries, source-reference fields, NRCS captures and native-network provenance.

## Retained connectivity results for this exact source

[CLOUD's complete connectivity analysis](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8NMPGQ78) retains the 217-row CSV, summary JSON and report calculated from this unchanged 303-record publisher response and the original regional context. The selected model domain remains 217 HUC12s.

| Measure | Retained result |
|---|---:|
| Selected domain HUCs with native network records | 217 |
| Domain headwater HUCs | 119 |
| Missing domain records / cycles | 0 / 0 |
| Lower Tugaloo upstream HUCs, excluding the focal watershed | 31 |
| Lower Tugaloo upstream acres | 573,633.44 |
| Lower Tugaloo upstream priority HUCs | 1 |
| Lower Tugaloo upstream selected SC classification source features | 1,002 |
| Lower Tugaloo focal plus upstream HUCs / acres | 32 / 633,323.13 |

The traversal counts each distinct upstream HUC once. When combining receiving watersheds, use the union of their HUC12 memberships to avoid counting shared upstream land repeatedly. SCDES classification counts retain their South Carolina source scope.

The complete **revision 2** files are available directly in [connectivity/](connectivity/) and in the same linked Slack document:

| Current file | Bytes | SHA-256 |
|---|---:|---|
| [WATERSHED_CONNECTIVITY.md](connectivity/WATERSHED_CONNECTIVITY.md) | 13,150 | `6ecf7533db4fe60b3e92d684260fcfc8d79e42a9ed74290a2145dda38e55b04a` |
| [watershed-connectivity-217.csv](connectivity/watershed-connectivity-217.csv) | 111,728 | `3f25af3b660a0949d01218c7cfb1fcb48be7e5092641f35da3be2921c47debfc` |
| [watershed-connectivity-summary.json](connectivity/watershed-connectivity-summary.json) | 38,779 | `c1ff41a0fc0ccca91f4a8e909c27f2043b615229b57fb595b20e5acbd55c07d7` |

Revision 2 adds the four utility-focus contributing memberships, their distinct union, publisher classification names and direct publisher links. The four-focus union is **36 HUC12s, 739,086.63 acres, three NRCS priority HUCs and 1,002 selected classification source features**. Upper Six And Twenty Creek is already upstream of Lower Six And Twenty Creek; Choestoea Creek is already upstream of Lower Tugaloo River. Adding the four separate contributing totals yields 782,778.80 acres and counts 43,692.17 acres twice. The saved union uses each original HUC once. Utility service-area polygons retain their own geographic meaning.

The CSV remains byte-for-byte identical to revision 1. The [historical revision 1 summary](connectivity/editions/1/watershed-connectivity-summary.json) is retained separately: 36,440 bytes, SHA-256 `00a94474c5b24370b05b3c1dd22afd5313b84563b5da02d030b3979976212b44`. That older digest describes the explicitly versioned historical file; use the revision 2 table for the current summary.

The source operation is `ECO13-CLOUD-INTEGRATION-WATERSHED-CONNECTIVITY-20261013`, continuing the existing `ECO-WATERSHED13-20261013` application workflow.
