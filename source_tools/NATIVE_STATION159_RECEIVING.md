# Receive the complete original 159-station study inputs

The retained edition at `source/station-assessment-context/native159-source-context-20261013/` closes the original source inputs for the maintained `upper-savannah-published-assessments-2024-2026-159` study. It combines the complete ES-9960 revision 3 package with the exact full published 2024 and July 2026 normalized assessment banks already used by the application.

## Import and continue the original study

From the application directory, use the existing Workspace that contains the original 217-HUC model domain:

```sh
python -B -m model.cli --workspace /path/to/existing-workspace source-import source/station-assessment-context/native159-source-context-20261013/sources-complete.json
python -B -m model.station_study --workspace /path/to/existing-workspace --build --study-id upper-savannah-published-assessments-2024-2026-159 --receive-workspace /path/to/second-workspace --create-receiving-workspace
```

The first command imports all seven original source entries and their declared files in one collection. The second uses the maintained station engine to build the original study and reopen its complete geographic archive in a second Workspace. Existing source selection is by the accepted original body hashes; the retained domain is selected by its decoded SHA-256 `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`. The second Workspace path must differ from the source Workspace.

To prepare the same editable selection before a build, use the existing command without `--build` or receiving arguments:

```sh
python -B -m model.station_study --workspace /path/to/existing-workspace --study-id upper-savannah-published-assessments-2024-2026-159
```

Its output includes the selected source identities, original model-domain identity and any missing original input. The normal operator exposes the same prepared study. The original native receiving operation remains ECO-GEO-0D0F/ECSA; share its saved analysis and opening route in the existing [Ecosystem source thread](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791865223076739).

## Source roles and exact study selections

| Source | Complete source | Selected in published159 | Role |
| --- | ---: | ---: | --- |
| Original SCDES Savannah station feature response | 705 native features | 152 sites | Primary monitoring locations, EPSG:26917 |
| Original WQP eight-station supplement | 8 native features | 5 sites | Primary monitoring locations, EPSG:4326 |
| Original WQP two-station supplement | 2 native features | 2 sites | Primary monitoring locations, EPSG:4326 |
| Additional original WQP metadata pages | 73 pages and point features | Supplemental context | MONITORING_LOCATION_CONTEXT |
| Published 2024 assessment edition | 1,516 original records | 108 records | Complete normalized assessment source |
| July 2026 TMDL attainment edition | 813 original records | 84 records | Complete normalized assessment source |

All 192 selected records remain distinct at 159 sites. Their original normalized record IDs, zero-based JSON pointers, native source hashes and publisher HUC assignments are retained. The source engine keeps assessment publisher HUC, station publisher HUC and calculated polygon membership separate.

The 73-site WQP overlay keeps its original `MONITORING_LOCATION_CONTEXT` role. The prepared study resolves the primary sources by their original hashes and continues using the 705/WQP8/WQP2 locations. All 73 WQP HUC8 values agree with the primary station publisher HUC8. SV-809 retains the separate July 2026 assessment HUC12 assignment. Every original WQP property string and every native point in the optional overlay matches the retained publisher-page extraction.

The canonical missing WQP8 source is also available at `source_data/wqp_eight_20261013/sources.json`; the optional context is at `source_data/wqp_coordinate_context73_20261013/sources.json`. Their native files are the same original Git objects as those in the complete edition.

## Open the original contextual report

Open `source/station-assessment-context/native159-source-context-20261013/results/OPEN_STATION_ASSESSMENTS.html` for the original complete 192-record report. Its CSV, JSON and summary remain unchanged. The contextual table entry in `sources-complete.json` retains the readable report and all 29 original source/report files as the primary body plus companions, so original manifests and record pointers remain portable after Workspace import.

The composite manifest also records each related source ID and its role. It includes both actual normalized source editions; the unchanged owner's report retains its original metadata and all original records. The complete original normalized bodies resolve every `original_record_locator.path` under `inputs/`. Original publisher table text is included as the 2024 normalized bank's companion.

For broader source coverage and source selection, open the existing [705-station/statewide assessment review](../results/assessment-source-scope-review-20261013/) or the [192-record programme association review](../results/assessment-association-review-20261013/).

## Retained source edition and recovery

[ES-9960 revision 3](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8R6K30US) contains 25 unchanged files and 3,121,416 source bytes. Its gzip identity is 315,304 bytes / SHA-256 `b0d491d30526ddd9254854945f80a98bbb35592f7c43b7ae1ef5af5be4fa4908`; decoded source-map JSON is 3,468,234 bytes / SHA-256 `693674c1ce8c28511d7304ffebbfbc5b0f8c9a66a850a145d2f8c0b768285eda`.

The complete edition adds three byte-exact original assessment input bodies and the unchanged original assessment manifest, then `sources-complete.json` joins the seven source entries. The owner's 25 original bodies and their relative paths are preserved.

The shared decoder accepts the original carrier's 15 ordered indexed chunks:

```sh
node source_tools/source_bank_cli.mjs inspect native159-revision3.md
node source_tools/source_bank_cli.mjs extract native159-revision3.md /path/to/new-source-directory
```

Use the complete edition's `sources-complete.json` for the one-step full import above. The extracted owner's original carrier retains its original five individual manifests and source README.
