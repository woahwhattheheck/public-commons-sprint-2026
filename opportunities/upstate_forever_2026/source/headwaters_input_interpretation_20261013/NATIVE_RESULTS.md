# Native results in the original headwaters chapter

This continuation extends the existing source-and-placement chapter with the original completed twelve-run numerical report. It uses the existing observed-report importer and scientific renderer. It starts no model and creates no second reporting engine.

## Original scientific scope

The supported case is project `1b6a344c-df5a-4986-a5e4-47a2d158324b`, ensemble `8cb02b0fe3b6a96782525e8aa5607621dd0a456719c6651ce07a675d9cae1ff4`: the 120 × 120, 30 m, 1296 ha simulated square. The real Upper Savannah geometry is a separate source edition.

The helper requires all twelve completed runs, four retained profiles, three retained scenarios, 24 within-profile land-cover rows and nine baseline-parameter rows. It verifies each unchanged source member's UTF-8 bytes and SHA, the report's release descriptor, native run selections, grid/profile/scenario identity, annual units, support counts, delta arithmetic and percentages. The caller separately pins the complete source packet SHA. The helper also verifies the original 30 m EPSG:26917 grid, every reported artifact against its full run descriptor, all 24 native stage input signatures against the retained profiles and exact coefficient table, and both native and converted raster identities for each Lmax pair.

## Produce one complete new chapter edition

Use the existing completed numerical source JSON; do not rerun its extraction or models. In the maintained complete application, select the actual installed Node executable and new output directory outside the application:

```sh
"$NODE" "$APP/source_tools/extend_headwaters_native_report.mjs" \
  --application "$APP" \
  --native-source "$ORIGINAL_NATIVE_SOURCE_JSON" \
  --expected-sha256 "$ORIGINAL_NATIVE_SOURCE_SHA256" \
  --output "$NEW_CHAPTER_DIRECTORY"
```

The original input chapter must already be present through component `headwaters-input-interpretation`. The output directory must not exist. The helper first validates all source bodies; it then writes the original complete input companions, the unchanged numerical packet and its individual JSON members, full-precision result tables, a new combined scientific recipe and chapter, and the updated source manifest. It preserves the previous input-only recipe and Markdown as explicit originals. The installed input chapter and its deterministic replay remain unchanged.

The new manifest is `headwaters_input_and_native_interpretation.sources.json`. It declares every original and generated companion with exact bytes/SHA. The helper itself travels with the package. The output metadata records the original project, ensemble, report, source operation and packet SHA.

## Interpret the result correctly

Land-cover rows hold a profile fixed while comparing baseline with one alternative. Parameter rows hold baseline land cover fixed while comparing profiles. Their deltas are alternative minus baseline. The additional avoided-export field reverses that sign on exactly the same valid cells.

Full totals retain each run's own valid reporting support. They are displayed separately from common-support quantities and must not be subtracted as if their denominators matched. NoData and excluded cells are not filled with zero.

The restoration-versus-control contrast is calculated only when both rows select the same baseline, exact common mask hash, common cell count and annual units. That equality establishes their all-three support. Otherwise the result explicitly directs the operator to the retained joint-support decision report and leaves the placement difference unavailable.

Cross-profile ranges are grouped only by exact scenario, pollutant, annual units and mask hash. A missing hash keeps a member separate. These are descriptive selected assumptions, not confidence intervals; equivalent NDR configurations across differing SDR Lmax settings are not independent replicates.

The seven original input sections remain intact. Their full-grid assumed source totals are not relabeled as native modified loads or stream exports. Actual loading types and retained runtime arguments govern the original calculation: InVEST's application-rate coefficients receive the retention-efficiency adjustment, whereas measured-runoff coefficients enter directly before runoff weighting. The original input replay and all 24 native stage signatures bind the same 397-byte measured-runoff table, SHA `bd5d7a436a302df751e57f63c188216402f13acdfff26c847b9b83733651fd94`. The full-grid accounting still has 14,400 cells; native export denominators remain the separately retained valid-cell masks.

The complete JSON originals preserve literal labels and unrounded numbers. Generated CSV numbers are unrounded; text beginning with spreadsheet formula characters receives a leading apostrophe. This formatting does not alter the unchanged original JSON companions.

## What the original completed results show

The exact original packet is 1,066,937 bytes, SHA `75d157b8540900cd97d42f35a1ca48de2f7dd33dc6153eecf7b27fb7eeaea572`; all twelve original members total 969,887 bytes and independently match their declared SHA. The compiled report is `9c0d1a2a6cf4bfa06a5811885d4bc8955ef9ccf5e020284a9b6169e86aa50cac`.

The values below are **baseline minus alternative annual stream export on exact shared cells**, rounded here to six decimals. The generated JSON and CSV retain full precision.

| Routing | Placement | Avoided N (kg/year) | Avoided P (kg/year) | Avoided sediment (t/year) |
|---|---|---:|---:|---:|
| MFD | Riparian | 2646.862656 | 212.165349 | 127.910849 |
| MFD | Matched off-riparian | 1099.859773 | 89.026014 | 113.906530 |
| D8 | Riparian | 2685.037331 | 215.193842 | 396.860289 |
| D8 | Matched off-riparian | 1002.366604 | 81.270776 | 201.004932 |

MFD nutrient comparisons retain 14,034 cells (1,263.06 ha), MFD sediment 13,976 cells (1,257.84 ha), and D8 comparisons 14,164 cells (1,274.76 ha). Within each profile and pollutant, baseline/riparian/control use the same exact mask. Across routing choices those masks differ. The restoration placement has lower export for all three pollutants under both routing choices, but sediment benefit magnitude is much more routing-sensitive: the riparian reduction is 18.261635% with MFD and 39.216260% with D8. This is a matched modeled-placement result with retained soil/terrain differences, not an isolated causal estimate of stream distance.

The two Lmax values, 122 and 333, yield byte-identical native and converted outputs in every routing/scenario/pollutant pair: eighteen exact paired artifact comparisons. Lmax does not enter NDR. Its lack of an observed SDR effect here applies to this terrain and selected range, not to all landscapes.

For baseline land cover, switching MFD to D8 raises common-support N export by 14.653145 kg/year (0.387026%), P by 0.845586 kg/year (0.280930%), and sediment by 306.001543 t/year (43.687370%). These are the original parameter contrasts. Subtracting full own-valid totals would add coverage differences, so it answers a different question.

The practical next step is to inspect the preserved riparian/control maps and routing assumptions with the scientific team, then edit an explicit source, treatment or parameter through Run revisions. The software offload is the complete repeatable source/selection/result/history/GIS handover. The scientific team controls calibration and field or regional interpretation.

## Render and join the existing scientific report

Use the current maintained observed-report receiving command at the same original application/Workspace boundary:

```sh
"$PYTHON" -B "$APP/source/observed-report-20261013/render.py" \
  --app-root "$APP" --workspace "$WORKSPACE" \
  --manifest "$NEW_CHAPTER_DIRECTORY/headwaters_input_and_native_interpretation.sources.json" \
  --output "$NEW_RENDER_DIRECTORY" \
  --archive "$OUTSIDE_WORKSPACE_ARCHIVE" \
  --receive-directory "$NEW_RECEIVING_DIRECTORY"
```

Use distinct new destination paths. Preserve the returned source collection/source pair. Append that exact binding to the existing ordered Scientific Report `observed_context_sources` through its normal binder; keep `source_roles.OBSERVED_CONTEXT` equal to the first selected source. Original native report/source identities remain separate from the new explanatory chapter identity.

The artifact adds no economic rates, intake concentrations or uncalibrated probability claims. The modeling team retains method choice, calibration, scientific interpretation and client direction.

## Complete receiving and inspection

Open the actual combined chapter and scientific output at desktop and 390 px. Read every table, open the full CSV/JSON and original profile/run companions, download the final archive, and cold-reopen the transported project. Use the original Sources and Scientific Report controls; check the actual source links and printed report. A source-only or mocked-controller exercise is not rendered acceptance.

Carry `CURRENT_OWNER_DIRECTION.md` version `2026-10-13.3` and the complete current owner instruction file with the same application. Preserve active native jobs, the separate geographic-model course, current source owners and the 14:00 UTC cutoff on 13 October 2026. Record execution speed only from actual retained history. If making video, operate the real application, use natural generative narration, and personally watch and listen to the final media and every outgoing attachment.
