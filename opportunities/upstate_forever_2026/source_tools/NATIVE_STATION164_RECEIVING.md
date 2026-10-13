# Receive all original assessment editions for 164 monitoring sites

The additive `source/station-assessment-context/native159-source-context-20261013/sources-all-editions.json` imports all original inputs for the maintained `upper-savannah-assessments-all-editions-164` study. It preserves the seven-entry published 159 edition and adds the exact original 101-row draft assessment inventory under the existing native source ID.

## Import and run the maintained study

From the application directory, use the existing Workspace containing the original 217-HUC model domain:

```sh
python -B -m model.cli --workspace /path/to/existing-workspace source-import source/station-assessment-context/native159-source-context-20261013/sources-all-editions.json
python -B -m model.station_study --workspace /path/to/existing-workspace --build --study-id upper-savannah-assessments-all-editions-164 --receive-workspace /path/to/second-workspace --create-receiving-workspace
```

The single manifest registers all eight typed source entries. The native preparer finds the draft table by SHA-256 `545a4e1413012b8f17c81c8afe815dd1e225ade5f5b9792ca22e83ef8723307f`; an extra CSV argument is unnecessary after this import. The original model domain is selected by decoded SHA-256 `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`. Choose a second Workspace directory for receiving.

To inspect the actual editable selection and any missing original inputs before building:

```sh
python -B -m model.station_study --workspace /path/to/existing-workspace --study-id upper-savannah-assessments-all-editions-164
```

For an existing individual-manifest receiver, the exact native draft input is also retained at `source_data/wqp_eight_20261013/assessment_listed_causes_2026_draft_original.csv`. The maintained `--assessment-csv` option imports those same original bytes under the same source ID.

## Import the complete portable source edition

The ready archive `source/station-assessment-context/native159-source-context-20261013/upper-savannah-all-editions164-original-sources.zip` contains all 32 original source bodies plus the exact eight-entry manifest at `sources.json`. It is 733,539 bytes, SHA-256 `4423ff9e705c78decadd567259d112a2e6ebb5774d33a9f8c036273fdf99d6c9`. Every one of its 33 members reopens byte-exactly.

In the operator, choose **Original sources → Import source edition → ZIP archive**, select this file and use manifest member `sources.json`. It imports all eight typed source entries into the selected Workspace.

For a file-based receiver:

```sh
node source_tools/source_bank_cli.mjs extract source/station-assessment-context/native159-source-context-20261013/upper-savannah-all-editions164-original-sources.zip /absolute/new/all-editions164-sources
python -B -m model.cli --workspace /path/to/existing-workspace source-import /absolute/new/all-editions164-sources/sources.json
```

Continue with the same native 164 build command above. The existing Workspace supplies its original 217-HUC geometry.

## Complete source selection

| Assessment edition | Original selected records | Selected sites |
| --- | ---: | ---: |
| Published 2024 assessment | 108 | 94 |
| July 28, 2026 TMDL attainment | 84 | 84 |
| 2026 draft integrated report | 101 | 87 |
| Complete three-edition selection | 293 | 164 |

All original cause/use/edition records remain distinct. The draft and published selections share 82 sites. The five draft-only sites are RL-24073, RS-24163, SV-236, SV-344 and SV-376. All 101 draft records have publisher HUC IDs in the original 217-HUC domain; the complete selection references 77 distinct publisher HUC12s.

Each selected station resolves to exactly one original native feature: 154 SCDES Atlas features in EPSG:26917, eight WQP8 features and two WQP2 features in EPSG:4326. The original 87-row draft identity crosswalk agrees with native feature IDs, original coordinates and native CRS for every row. Its original Atlas source label is preserved; the typed source entry uses `scdes-bw-monitoring-savannah-native-20261013` and resolves the same original 705 source bytes.

The summary and five added source locations are retained in `source/station-assessment-context/native159-source-context-20261013/all-editions-source-selection.json`. Native geographic membership is produced by the existing station geography workflow when the study runs.

## Original source closure and report portability

The complete [eight-file WQP source bank](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8J8FE4GK) is retained byte-for-byte. Its original source-bank JSON is 165,487 bytes, SHA-256 `01408c58917614b9c912470f7de645d4a56a6df913fce9d4c0dfa97631c98355`. The draft CSV is 14,033 bytes; the original identity crosswalk is 29,712 bytes; the original list of 87 station IDs is 1,115 bytes. The other five files already match the published 159 complete edition.

The additive eight-entry manifest retains 32 unique original bodies. The original `sources-complete.json`, report of 192 published records at 159 sites and source metadata stay byte-exact. The supplementary 73 WQP source retains its contextual role; the maintained study selects original 705/WQP8/WQP2 sources.

After importing this all-editions manifest, the operator's Source Reports export includes the complete eight-entry original collection. Reimport its returned manifest to retain all typed source IDs, original assessment files and source relationships. The included published 159 HTML continues to describe its published 192-record scope; the native 164 prepared study selects all three original editions.

Continue the existing [ECO-GEO-0D0F/ECSA receiving operation](https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791865033313139). Its completed 53-file station family and merged PR3177 already implement the 164-station selection and original build/export/independent-receive workflow.
