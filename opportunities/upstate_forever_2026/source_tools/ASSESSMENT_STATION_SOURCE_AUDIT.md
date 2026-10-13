# Complete native station and statewide assessment source comparison

This receiver compares the unchanged official Savannah 705-station feature response with both complete published assessment editions: 1,516 2024 cause records and 813 July 2026 TMDL attainment records. It preserves every original station attribute, native point, source record, edition and source pointer. The existing 192-record report retains its original 217-HUC selection.

## Use the complete original source cohort

The four-file original 705-station source is under `source_data/scdes_savannah705_20261013/`. Its unchanged `sources.json` imports the original Esri point source with source ID `scdes-bw-monitoring-savannah-native-20261013`, role `MONITORING_STATIONS`, CRS `EPSG:26917`, station field `STAT` and native feature field `OBJECTID`. The count response and original acquisition provenance remain companions.

The full assessment editions are under `source/water-quality-assessments/20261013/`. They use the existing normalized Water-quality context import. From the application directory:

```sh
python -B -m model.cli --workspace /path/to/existing-workspace source-import source_data/scdes_savannah705_20261013/sources.json
python -B -m model.cli --workspace /path/to/existing-workspace source-import source/water-quality-assessments/20261013/sources.json
node source_tools/assessment_station_source_audit_cli.mjs --application . --output /path/to/new-source-comparison
```

The output parent must exist; the output directory must be new. The Node command uses only the standard library and the maintained pure source join. It checks the exact four calculation-input byte identities and five original manifest/provenance companions before joining the complete editions. The existing Station geography operator retains ownership of actual point/polygon membership and the original 159-station native study.

## Complete actual source result

| Measure | Original source result |
| --- | ---: |
| Native Savannah stations | 705 |
| Complete statewide assessment records | 2,329 |
| Assessment records matching a native Savannah station ID | 246 |
| Native stations with at least one matching selected-edition record | 209 |
| Native stations with no record in these two editions | 496 |
| Statewide assessment records absent from this native 705-station selection | 2,083 |
| Different assessment/station publisher HUC12 records | 8 |
| Native station publisher HUC fields stored with eleven digits | 2 |

The 2024 edition supplies 155 matching records at 137 stations; July 2026 supplies 91 matching records at 91 stations. Records and distinct stations use separate denominators. Absence describes these source selections.

Among the 246 exact station-ID matches, 182 have both publisher HUCs inside the selected 217-HUC domain, 63 have both outside, and one has assessment HUC outside with station HUC inside. The original 192 domain-selected assessment records include 182 native 705-station matches; the remaining ten records use the separately retained WQP station sources in the existing 159-station study.

## All eight publisher differences

| Edition | Station | Assessment publisher HUC12 | Station publisher HUC12 |
| --- | --- | --- | --- |
| 2024 | SV-686 | 030502050108 | 030601060202 |
| July 2026 | SV-809 | 030601010305 | 030601020507 |
| July 2026 | RS-06190 | 030601030502 | 030601030602 |
| July 2026 | SV-318 | 030601030510 | 030601030609 |
| July 2026 | SV-164 | 030601030602 | 030601030502 |
| July 2026 | SV-052 | 030601030609 | 030601030509 |
| July 2026 | SV-192 | 030601030613 | 030601030513 |
| July 2026 | SV-353 | 030601070208 | 030601070207 |

The six differences within the original 192-record report are preserved. The full source comparison adds two distinct cases:

- **SV-192:** the July 2026 E. coli record, page 38, retains HUC 030601030613 outside the selected 217-HUC domain. The original station and selected 2024 turbidity record use 030601030513. Its original TMDL report is 026-05†, approved July 21, 2005.
- **SV-686:** the 2024 mercury record, page 50, uses HUC 030502050108 and Richland County; the native station uses 030601060202 and Aiken County. Both original descriptions read “FLAT ROCK POND IN FOREBAY NEAR DAM.” Both publisher HUCs fall outside the selected 217-HUC domain.

Native SV-835 and SV-834 retain original HUC attribute strings `30601030507` and `30601010703`. The comparison labels these fields as not twelve-digit HUC12 values and leaves their source strings, complete attributes and native coordinates unchanged. Neither station occurs in these two selected assessment editions.

## Open the complete offline source review

The receiving CLI also composes the full source-scope report. Open `OPEN_SOURCE_SCOPE.html` from its generated directory to explore all stations and assessments, inspect original records and source assignments, and export an explicit selection. Its ordinary source manifest retains the generated report and all nine original input and provenance files at their original application-relative paths. Both original input manifests continue to resolve inside the generated directory and compressed `source-scope-report.zip`. The existing 192-record programme report remains a separate original selection.

The completed original output is also preserved at [`results/assessment-source-scope-review-20261013/`](../results/assessment-source-scope-review-20261013/). Import a generated review through the existing Sources command:

```sh
python -B -m model.cli --workspace /path/to/existing-workspace source-import /path/to/new-source-comparison/sources.json
```

For the human review controls and portable selection exports, see [ASSESSMENT_SOURCE_SCOPE_REPORT.md](ASSESSMENT_SOURCE_SCOPE_REPORT.md).

## Reusable outputs

- `assessment-station-source-audit.json`: all 705 station records and all 2,329 assessment records, including each complete original feature/assessment, source identity, original array pointer, native coordinate reference and comparison.
- `all-native-station-source-coverage.csv`: all 705 stations, original county/description/coordinates, HUC field status and source-bound matched record keys.
- `all-statewide-assessment-source-associations.csv`: all 2,329 original assessment identities, including unmatched records, both publisher roles and original source pointers.
- `publisher-huc-differences.csv`: all eight differences.
- `source-audit-summary.json`: complete counts and explicit publisher-domain quadrants.
- `artifacts.json`: exact output byte/hash inventory and the four original input identities.

CSV uses quoted UTF-8 fields with a byte-order mark. Import HUC and source-identity columns as text to preserve leading zeros. Formula-like text is escaped for spreadsheets; finite numeric coordinate strings remain numeric. JSON preserves every original record value and every original station attribute. The original input files remain the byte-exact source bodies.

For in-memory receiving, import `auditAssessmentStationSources` from `source_tools/assessment_station_source_audit.mjs` and pass four unchanged UTF-8 strings keyed `stations`, `published2024`, `tmdl2026` and `domain`. It returns `{result,files}`; `result.schema` is `upstate.assessment-station-source-audit/v1`. The exported `INPUTS` map declares maintained paths, byte lengths and SHA-256. This is the original completed cohort's reproducible source comparison.

The source-input carrier is [0D0F's complete original 705-station edition](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8KSKT3FX); the complete assessment carrier is [ES-9960's retained 17-file source bank](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8KECMA4V). Original source acquisition and the current native GIS study continue through those maintained operations.
