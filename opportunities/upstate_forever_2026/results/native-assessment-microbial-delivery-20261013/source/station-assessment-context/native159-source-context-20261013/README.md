# Upper Savannah station assessment context

This package contains all 159 station identities and all 192 selected assessment records. The primary locations reuse 152 points from the original SCDES 705-feature source, five points from the original WQP eight-station supplement, and the additional WQP locations RS-21038 and RS-22075. Every selected station retains its complete original attributes, native geometry, coordinate reference, feature ID and source-array position.

## Open the report

Open `results/OPEN_STATION_ASSESSMENTS.html`. Import `assessment-context-sources.json` through the existing Source intake desk to add the complete 192-row context table and its JSON/report companions. The native geographic build below opens through the maintained Station geography desk and creates its own portable archive and geographic report.

## Run the complete maintained station build

Use the current application containing merged PR3117, including the existing `model.station_inventory` bridge. Place this complete package at an absolute `STATION_INPUTS` path, the original 17-file normalized assessment package F0C8KECMA4V at `ASSESSMENT_INPUTS`, and the retained 217-HUC domain at `DOMAIN_INPUTS`. These uppercase names describe actual local input directories; set each to its received directory before running from the application root.

```sh
python -m model.station_study \\
  --workspace ACTUAL_STUDY --create-workspace --build \\
  --study-id upper-savannah-published-assessments-2024-2026-159 \\
  --source-manifest STATION_INPUTS/source_data/scdes_savannah705_20261013/sources.json \\
  --source-manifest STATION_INPUTS/source_data/wqp_eight_20261013/sources.json \\
  --source-manifest DOMAIN_INPUTS/sources.json \\
  --source-manifest ASSESSMENT_INPUTS/sources.json \\
  --source-manifest STATION_INPUTS/source_data/wqp_assessment159_additional_two_20261013/sources.json \\
  --receive-workspace ACTUAL_RECEIVING --create-receiving-workspace
```

The five source manifests provide all three original station sources, the retained polygon domain, and both complete normalized statewide assessment editions. The maintained engine projects original coordinates, derives polygon membership, preserves overlapping and boundary memberships, and opens the same result in the second workspace. Repeated imports resolve the retained source identities.

## Source editions and watershed relationships

The 192 records comprise 108 published 2024 cause records and 84 July 28, 2026 TMDL status records. Every record carries its complete original fields and unique `/records/{index}` pointer into the exact normalized source bank. The package identifies both complete original banks by filename, byte count and SHA256.

Six July 2026 assessment HUC assignments differ from the station publisher's HUC: RS-06190, SV-052, SV-164, SV-318, SV-353 and SV-809. The native application displays the assessment HUC, station publisher HUC and geometry-derived HUC separately. SV-809 retains assessment HUC 030601010305 and station HUC 030601020507 (Lower Tugaloo). RS-06190 retains its 2024 and July 2026 assessment assignments separately.

NRCS source-water priority, assessment cause status and classified-water categories keep their original meanings. Assessment TN means Total nitrogen; classified-water TN means Trout Natural. HUC context follows each assessment's published HUC12.

## Complete contents

- `results/station-assessment-context.json`: 159 stations, complete native feature attributes and geometry, 192 original records, source pointers and publisher HUC context.
- `results/station-assessment-context.csv`: the complete 192-row flat join.
- `results/station-assessment-summary.json`: station, edition and HUC comparison totals.
- `results/OPEN_STATION_ASSESSMENTS.html`: the readable source-context report.
- `source_data/scdes_savannah705_20261013/`: the complete original 705-point feature response, provenance, count response and manifest.
- `source_data/wqp_eight_20261013/`: the complete original WQP eight-station source and declared companions.
- `source_data/wqp_assessment159_additional_two_20261013/`: the six unchanged source files from merged PR3017, including the complete 159-station identity crosswalk.
- `source_data/wqp_coordinate_context73_20261013/`: 73 supplemental WQP station pages, their point overlay and source manifest.
- `assessment-context-sources.json`: the context-table importer manifest.
- `artifact-manifest.json`: every file's exact size and SHA256.

The optional 73-point WQP context overlay remains separate from the prepared study's three primary station sources. All 73 original WQP HUC8 values agree with the station publisher. Its SV-809 HUC8 is 03060102, preserving the separate July 2026 assessment assignment.

## Source and implementation references

- Original station layer: https://gis.des.sc.gov/gisserver/rest/services/water/BW_Monitoring_Stations/MapServer/9
- Published 2024 assessment: https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/303dList2024.pdf
- July 2026 TMDL status: https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/TMDLAttainmentStatus.pdf
- Original source integration: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3017
- Current map and report HUC display: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3117

Revision 3 adds the missing second bank to summary metadata and supplies the complete five-manifest command. Original station coordinates, assessment records, primary source files and the existing readable report remain byte-identical to revision 2.
