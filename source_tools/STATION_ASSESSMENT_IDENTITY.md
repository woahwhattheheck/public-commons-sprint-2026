# Published assessment station identities

This source join connects all 192 records in the published assessment inventory to the original 159-station identity crosswalk supplied by the station-geography source owner. It preserves every original assessment field, native coordinate string, coordinate reference system, station identifier and source hash.

The actual cohort contains 108 records at 94 stations from the published 2024 assessment and 84 records at 84 stations from the July 28, 2026 TMDL attainment edition. Original station sources supply 152 SCDES Atlas identities, five identities from the retained WQP eight-station supplement, and two from the additional WQP station-page source.

## Source comparison findings

Across the complete 192-record inventory, 176 records have matching publisher HUC12 identifiers and ten have matching HUC8 prefixes, which is the level reported by those station sources. Six records retain different publisher HUC12 assignments:

| Station | Assessment publisher HUC12 | Station publisher HUC12 | Assessment cause |
|---|---|---|---|
| SV-809 | 030601010305 | 030601020507 | E. coli |
| RS-06190 | 030601030502 | 030601030602 | E. coli |
| SV-318 | 030601030510 | 030601030609 | E. coli |
| SV-164 | 030601030602 | 030601030502 | E. coli |
| SV-052 | 030601030609 | 030601030509 | E. coli |
| SV-353 | 030601070208 | 030601070207 | E. coli |

All six differences occur in the July 2026 TMDL attainment edition and concern E. coli / recreational use with the source's `not_supported` status. The full difference table retains original report links, approval dates, source page/row references, source-bound record IDs and descriptions alongside the native station identity.

Use the two publisher assignments explicitly when preparing a source interpretation or programme association comparison. The existing station-geography operator independently computes geographic membership from original station points and the retained 217-HUC polygon source. Its saved result supplies the geometric association for geographic decisions. Native coordinates remain in their recorded EPSG:26917 or EPSG:4326 reference system.

## Reproduce the complete result

From the maintained application root:

```sh
node source_tools/station_assessment_identity_cli.mjs \
  --assessments source/station-assessment-context/assessment-records-domain217.csv \
  --crosswalk source_data/wqp_assessment159_additional_two_20261013/assessment159_native_identity_crosswalk.csv \
  --output received-assessment-identities
```

The command uses Node built-ins and the application's existing `archive_codec.mjs`. Its output directory must be new and its parent must exist. It reads the two complete retained originals, checks their exact byte identities, checks every source-bound record ID and station/cohort association, then writes all three outputs together.

| Output | Contents |
|---|---|
| `assessment-native-identity.csv` | All 192 assessment records and every original assessment column, followed by original native location identity, source hash, CRS/x/y, both station publisher HUC fields, comparison category and original crosswalk row |
| `publisher-huc-differences.csv` | The six complete original assessment records with different publisher HUC12 assignments, using the same complete output columns |
| `identity-summary.json` | Source identities, full cohort/edition counts, exact difference record IDs, native source counts, identifier meanings and original source paths |

The completed outputs are retained under `results/station-assessment-identity-20261013/`. The pure `joinAssessmentIdentities(assessmentText, crosswalkText)` function returns the same summary, all enriched records, difference records and exact output file texts. This API runs in a JavaScript-only runtime with no filesystem or network dependency.

The helper is intentionally bound to this completed original source edition. Its input identities are:

| Input | Bytes | SHA-256 |
|---|---:|---|
| Published assessment CSV | 111,624 | `01f1a0262bb719f39d4b6c8b6e690bbf670d9aea83cbe0f532daf81b0c6a09f7` |
| Source owner's complete native identity crosswalk | 42,751 | `b5a658b16a9cb0b891426d53db78de01429f4363b83f2ff30625f9dbf932d84c` |

Publication sources: [maintained assessment integration PR2972](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2972), [complete original station crosswalk and WQP two-station source PR3017](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3017), and [the complete maintained assessment source carrier](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8JP4654K). The two-station manifest retains both official page extractions and the original reported coordinate strings.

## Source and output handling

All source records retain their original order and string values. CSV output is quoted and preserves multiline descriptions and source-row text. Assessment record identity is the pair of original `source_id` and `id`; station IDs match exactly. The source crosswalk's complete record set and HUC set are checked for every station, so a duplicated cause row or dropped source edition cannot silently change the result.

The native command reads only regular files below 2 MiB, checks unchanged size/mtime and exact source hashes, and validates the complete result before creating output. It creates the destination exclusively, writes private ordinary files without following symlinks, and removes its own incomplete output if a write fails.

The pure helper was executed on both complete original input bodies. All 192 exported records retain every original assessment column exactly; all 159 source identities and each station's complete assessment record/HUC sets agree with the retained crosswalk. The six reported differences follow directly from the two original publisher fields.
