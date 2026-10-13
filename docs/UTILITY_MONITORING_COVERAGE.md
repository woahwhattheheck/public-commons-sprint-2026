# Utility monitoring coverage

This is an additive observed-source report for the existing Ecosystem Sciences workbench. It connects the complete retained 2021-2025 utility E. coli cohort to the saved native station memberships and original receptor upstream network. It uses `model.observed_context`, `model.scientific_report` and `model.scientific_figures` rather than adding another renderer, monitoring interface or geography solver.

## Completed original-source operation

The executed source case contains 730 original records at 36 stations and the retained 217-HUC12 network. Its eight full CSV companions include 2,160 station-month rows, 217 watershed rows and 20 utility-focus geographic review rows. Original source file/row identities, numeric strings, methods, unit spelling, qualifiers and detection conditions stay unchanged.

| Utility | Original records | Stations | Upstream HUC12s | HUC12s with a selected sample | HUC12s without a selected sample |
| --- | ---: | ---: | ---: | ---: | ---: |
| ARJWS | 142 | 5 | 4 | 3 | 1 |
| PRWD | 588 | 31 | 32 | 13 | 19 |

These are the actual outputs in `coverage.json` and `tables/receptor-coverage.csv` of the completed source package. A coverage gap means no record in this selected cohort, not an assertion that no monitoring exists. Sampling support ends December 31, 2025. The geographic review queue supports source acquisition and scientific planning; it is not a pollution ranking or an approved set of new sampling locations.

The original utility labels agree with the native receptor memberships for all 730 rows. Of these rows, 176 carry an explicit detection condition and 75 have a blank reported unit. The original numeric strings and reporting limits remain in the full lineage table. No concentration pooling, reporting-limit substitution, threshold classification or annual-load conversion is performed.

The original source was imported into the retained project and composed through the native observed-report APIs. The same complete source was then imported into an independent workspace, retaining the identical report body and all 58 member identities. The result has eight composed sections. Native receiving output is `receiving-result.json`; the original completed collection is `306dad0ef3ec63a6790754f1ea7c7881d02f48ff337b67567ef02506283e9346`.

## Build from the saved regional workspace

Use Python 3.10 or newer with ReportLab and the existing delivered workbench application. Run from the application root. Supply the actual existing workspace path and a separate output directory:

```sh
PYTHONPATH="$PWD" python -B source_tools/utility_monitoring_coverage.py \
  --workspace /absolute/path/to/workspace \
  --station-study f5a40fa16c0ddca2fbc1f91087f02b05893cac8b56371e0f46af6b7bea8af969 \
  --receptor-network 5a02c70737ff8b11c0a3ecf1faa83f76f5b96e3df53e3514caed27a04f944b81 \
  --input-archive-sha256 4d4572c7e12e4dd1c21802e98869888e1e1fe71f6aed27953b69947b281d635b \
  --package /absolute/path/to/utility-monitoring-coverage
```

Those study and network IDs select the actual original received case, project `b9d5d257-c6bb-4f07-b975-8e8c63705db3`. Its original archive is `Upper_Savannah_Regional_Complete_Project_20261013.zip`, 214,778,005 bytes. Supply `--input-archive-sha256` only when that is the known source archive; the optional field is not a substitute for reading the original saved workspace. The build selects the declared 2021-2025 study period and stages its original source bodies from the workspace. It does not make external data requests or rerun station geometry or models.

The direct workspace staging command was also executed successfully on the original case, producing the 730-record, 36-station, 20-review-row report from its saved source files. After staging, the same destination is reusable:

```sh
PYTHONPATH="$PWD" python -B source_tools/utility_monitoring_coverage.py \
  --package /absolute/path/to/utility-monitoring-coverage
```

Every retained input is checked against `input-manifest.json`. Each original source-file/row is reconciled with the saved native observation link. A manifest selecting another native study is preserved rather than replaced. If staging was interrupted before the input manifest was completed, retain that incomplete directory and select another output directory; an already completed input manifest supports ordinary continuation.

## Open the complete result

Open `report.html` or `Utility_Monitoring_Coverage.pdf`. The HTML contains the figures directly and links to the complete local tables. The grayscale report retains method/detection support, sampling effort, original watershed names and the full geographic review queue. HUC12 identifiers must be read as text to preserve their leading zero.

| File | Content |
| --- | --- |
| `tables/observation-lineage.csv` | All original result columns plus native station, HUC12, receptor and link-row identities |
| `tables/station-coverage.csv` | Station records, original activities, distinct station-days, methods and sampling gaps |
| `tables/station-month-coverage.csv` | All 36 selected stations over all 60 months, including empty cells |
| `tables/watershed-coverage.csv` | All 217 original watershed rows, including units outside the two receptor selections |
| `tables/utility-year-coverage.csv` | Complete annual sampling support by utility |
| `tables/method-detection-support.csv` | Exact method context, method, raw unit and detection-condition groups |
| `tables/receptor-coverage.csv` | Geographic and temporal support for both upstream receptor selections |
| `tables/geographic-review-queue.csv` | The 20 utility-focus watershed units without a selected sample |

Empty calendar cells are missing selected observations, not a zero concentration. Station-month coverage is not watershed area coverage. Multiple native boundary/overlap memberships remain separate. Complete original source objects travel under `inputs/objects`; `inputs/original-source-catalog.json` maps their hashes to original titles, publisher URLs and source meanings.

## Import, compose and independently receive

For ordinary operation, use Original sources to import the generated `sources.json`, then select `utility-monitoring-coverage-2021-2025` in Scientific Reports. It carries role `OBSERVED_CONTEXT` and schema `upstate.observed-report/v1`. Its figure specification and all declared companions travel with the source.

The complete native receiving command uses the original selected project and a separate receiving workspace:

```sh
PYTHONPATH="$PWD" python -B source_tools/receive_utility_monitoring_coverage.py \
  --package /absolute/path/to/utility-monitoring-coverage \
  --workspace /absolute/path/to/existing/workspace \
  --receiving-workspace /absolute/path/to/independent/workspace \
  --output /absolute/path/to/receiving-output
```

The receiver imports the selected original source, binds the actual returned collection and source IDs, composes PDF/HTML companions, receives the source into the separate workspace and retains the body/member identities in `receiving-result.json`. Existing operator accounts and unrelated source editions remain in their original workspace. Use the returned collection ID for the exact package being received; source/guide additions may produce another immutable source edition.

To retain the updated whole project with application and sources, use the existing workbench backup and restore commands:

```sh
PYTHONPATH="$PWD" python -B -m model.cli --workspace /absolute/path/to/workspace \
  backup /absolute/path/to/complete-project.zip
PYTHONPATH="$PWD" python -B -m model.cli \
  restore /absolute/path/to/complete-project.zip /absolute/path/to/new-receiving-directory
```

The application component fragment adds the producer, native receiver and this guide to the existing observed-context distribution. This feature introduces no new test or CI entrypoint.
