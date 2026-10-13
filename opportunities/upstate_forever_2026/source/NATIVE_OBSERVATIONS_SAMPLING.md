# Native observations in Monitoring and Sampling

TokenJunkieLabs · Upper Savannah scientific workbench · 2026-10-13

The original Monitoring desk can retain an observational context from a saved native observation source without requiring a daily-flow series. The resulting saved context opens in Sampling, where exact station/cohort records inform historical coverage, reporting-limit review and an explicitly authored monitoring programme. The original Monitoring solver, calendar, source system, queue and editable Study remain the working application.

Current owner direction is **CURRENT_OWNER_DIRECTION.md version 2026-10-13.4**, accompanied by the complete current root **AGENTS.md** and standing rendered-product instruction. Continue the original native and receiving operations, inspect and use the actual populated outgoing application and its attachments, preserve TokenJunkieLabs attribution and the prime's scientific direction, and ship the working integration.

## Use the original Monitoring desk

Select the current Workspace and open Monitoring. Use the existing network, plan or campaign selector and the saved-native-observation intake. Choose the actual observation source. Review the original source columns, selected analytical/date/activity fields, qualifiers, measurement units and original laboratory-limit fields.

Author the interpretation options explicitly. The source retains the chosen mapping, the accepted numeric qualifiers, below- and above-limit qualifiers, any declared nonnegative support and the specific choice to use a retained reporting-limit unit when a result's original measurement unit is empty. Every original raw row and its source identity remains available. A row excluded from the normalized usable observation table retains its reason and original cells.

Select the saved network and review source-station mappings. Coordinates carried by a retained network station retain that origin. An absent station needs its real retained station source and the existing network-building operation. The original polygon assignment and station geometry determine a catchment assignment; a station name alone does not.

Preview the complete context. The station matches, record counts, date coverage, source choices and flow availability are visible before saving. Save through the original action queue and reopen the actual returned context. **Open in Sampling** selects that saved context in the existing Sampling desk.

In Sampling, choose the exact analytical cohort, historical window and calendar months. Enter the programme rationale, historical date goal, proposed visits, desired reporting limit and costs as explicit planning choices. The original model-evidence section can retain a separately selected complete native report and scientist-authored applicability. The concentration context and modeled annual quantities keep their original scientific meanings.

## Original observations and flow support

This source edition uses **upstate.monitoring-observed-source/v3** and an explicit unavailable flow scope:

~~~json
{
  "flow_scope": {"mode": "unavailable", "station_ids": []},
  "flow_availability": {
    "status": "not_received",
    "reason": "No daily-flow series was selected for this native observation context."
  }
}
~~~

The original observations support historical coverage and source-method decisions. Their quantity and measurement support remain explicit. The SV-833 course uses concentration measurements; another retained nonannual quantity keeps its own original meaning. Daily-flow support, event coverage and flow-supported load quantities remain unavailable. Episode summaries use an unavailable value where appropriate. The source does not introduce regional-gauge applicability into a concentration-only selection.

Original v1 regional-date context and v2 explicitly scoped same-station flow sources retain their existing behavior. Saved original proposals continue to inspect against their original context and calculation. New fields enter the native-observation edition.

## Exact analytical cohorts and readable reports

Sampling uses its existing field-presence and retained-value cohort identity. Method, method authority, method name, unit, fraction, speciation, value type, activity/media, depth, programme, organization and the other original analytical fields stay distinct. Missing, explicit null, empty and supplied normalized metadata remain separately represented. An explicitly selected unit fallback supplies an effective unit from the retained laboratory limit; the original empty measurement-unit cell and that authored choice remain in each original source row and the source settings. Cohort grouping then uses that selected effective unit.

The original-observation context report includes:

- The original source, project, observation record, file identity and selected interpretation options.
- Source totals, matched-station totals and exact station/cohort groups.
- Original source-station to saved-network/catchment bindings and coordinate provenance.
- Complete analytical cohort inventory and result-status counts.
- Distinct observed dates in each year and month, separately for each exact station/cohort group.
- Original results, laboratory limits, retained interval endpoints and original source row numbers.
- The unchanged saved calendar's original dates and matched observation activities.
- Full source records and explicit exclusions in the exported scientific files.

A zero monthly date count describes the retained records in that cell. The table counts repeated results on one date once and retains all original records in the accompanying observation table. It introduces no prescribed frequency or statistical trend estimate.

New native-observation rows carry **upstate.native-observation-sampling-cohort/v1**. For those rows, exact Sampling identity also includes **time_basis**, **temperature_basis**, **particle_size_basis**, **time_support**, **quantity_basis** and **measurement_support**. Unmarked historical rows retain their original cohort identity byte-for-byte.

The context export adds **observed-context/exact-cohort-summary.csv** and **observed-context/exact-cohort-monthly-dates.csv**, plus **observed-context/excluded-original-observations.csv** with complete original cells and reasons. The ordinary Sampling bundle includes the context report and CSVs through its existing source exporter. **sampling-review.html** identifies the original concentration source and its flow availability before the authored target details.

## Actual SV-833 continuation

The original current Workspace **b9d5d257-c6bb-4f07-b975-8e8c63705db3** contains saved observation source **2e3b1856bdacf538699044b4d11948287a4e8f9a188aef7c8bd94131bc0c1a36**. Its original CSV contains **208 nutrient measurements**, including **49 below-quantification records** with retained laboratory limits. The complete source was recovered from the original-file report and its retained source mapping.

The current native source is distinct from the historical RIVER45 receiving packet. That earlier packet's four selected targets use its original E. coli cohort. Both remain useful original records in the same continuing application.

The nutrient course uses the retained WBD domain **e11ef0eedfd65f245d5761a76cc0051be7d66b3d49b6e5dfe0a4fa6502f7b023 / upstate-wbd-upstream-domain-20261012** and original station source **5c1835b235f6508c282efe64684da5aaffbfadb18803939020732ef0af118e64 / utility-ecoli-native-wgs84**. The full station identifier is **21SC60WQ_WQX-SV-833**, with retained WGS84 coordinates **[-82.636966, 34.704792]**. The native polygon-based network construction checks the actual assignment to **030601010701** and retains its returned network identity.

The original 208 records contain nine temporal series with separate method/depth/value-type metadata. The authored receiving course selects four complete NPS-2013 analytical cohorts:

| Characteristic | Full original cohort records | Original below-quantification records | December distinct dates | Gap to authored five-date goal |
|---|---:|---:|---:|---:|
| Ammonia | 40 | 19 | 3 | 2 |
| Kjeldahl nitrogen | 54 | 7 | 4 | 1 |
| Nitrate + Nitrite | 53 | 0 | 3 | 2 |
| Phosphorus | 56 | 22 | 4 | 1 |

The remaining five SWS-2024 records at depth 0.3 m, including calculated Total Nitrogen, remain separate in the retained context. The receiver resolves the actual Sampling cohort identities from the full original record rosters. The temporal report's cohort identifiers belong to its own analytical schema.

The course retains the historical window **2021-01-20 through 2026-04-01** and selects January, November and December. The four target cohorts contain **203 full-period records** and **63 selected winter records**. Its independent source counts give a total **six-date gap** to the explicitly authored five-date goal across each selected calendar month. That goal applies across the selected historical window.

The future native calendar uses the original illustrative configuration: one required catchment, three rounds from **2026-11-02 through 2027-01-04**, a **USD 250** setup assumption, **USD 150** per physical visit and **USD 600** programme overhead. This yields an illustrative **USD 1,300** station/calendar scenario when the unchanged native solver returns the expected three visits. Four analytes share those physical visits. Constituent-specific laboratory costs remain unknown in the authored Sampling targets.

The complete course is **source_tools/selections/sampling_sv833_20261013.json**. It retains exact CSV, native-record, domain and station-source identities, all selected original row rosters, explicit qualifier/unit options, the full native calendar and independent source counts.

## Continue the original receiver

Use the same original **source_tools/receive_sampling_recommendations.py**, original application and Workspace, original RIVER input selection, optional original successor, original design configuration, operation ID and output directory. Add:

~~~text
--native-observation-course source_tools/selections/sampling_sv833_20261013.json
~~~

The original 45-input packet already contains its preparation script. When that preparation has completed, reuse its retained **selection.json**, **successor-selection.json**, **native-configuration.json** and **native-command.json**. If the original input preparation is still outstanding, use that packet's existing script against the same application and Workspace:

~~~text
prepare_river13_sampling.py --application "$APP" --workspace "$WS" --output "$INPUT_PREP" --prepare-only
~~~

That original preparation records the receiver command and its output **$INPUT_PREP/native-course**. Continue the command in **native-command.json** with the additional **--native-observation-course "$APP/source_tools/selections/sampling_sv833_20261013.json"** argument. This retains the issued operation and original output directory and uses the actual prepared observational context identifiers.

The current course remains **ECO-SAMPLING-RIVER13-15227-20261013** on **/mnt/data/eco-trends/application** and **/mnt/data/eco-trends/workspace**. The new nutrient phase runs inside that course and retains its own exact authored inputs and actual returned object identities. The original four-target proposal and its history/report/Study remain available.

The receiver verifies the actual original data and network-source bytes, builds the retained native network, prepares the concentration context, resolves exact original-row Sampling cohorts, saves the full proposal, invokes the existing native design/calendar, exports the complete reports and selected editable Study, and reopens the proposal and scientific files in the Study's contained application. Replaying the same authored course uses its stable identities and original saved output.

Use actual returned paths and identifiers from this receiver when opening Monitoring, Sampling, Sources and the downloaded reports. Source implementation review and original-data reconstruction precede native execution; the receiving result supplies the actual saved objects, native plan and contained-application reopen.

## Open and use the delivered product

The producing and receiving workers must open, see and operate the exact outgoing version. Follow the complete owner instruction in the carried **CURRENT_OWNER_DIRECTION.md** and **AGENTS.md**. Inspect the populated Monitoring intake, source mappings and qualifier controls, preview/save/reopen, station binding, Sampling handoff, native design/calendar, downloadable reports/CSV/source records, selected Study and contained application. Use the actual desktop/screenshare width and a narrow mobile width, and inspect the printed report pages.

Read the recovered real source records through the product. A source with absent flow should show that availability clearly. An original missing unit should retain its original state and the selected unit-interpretation option. Different method/depth/value-type records should remain distinct. Read the actual exported files in their normal viewer and repair any clipping, overflow, unreadable tables or broken control before presenting the application.


## Continue from a complete original source when a whole Workspace is unavailable

The saved 208-row SV-833 observation can be received independently of the later full Workspace ZIP. Use the actual original observation already present in the selected Workspace whenever available. The normal course verifies the immutable observation record and its original 78,656-byte CSV before preparing any Sampling context.

Two complete source inputs are supported by the SAME receiving program's optional `--native-observation-input`:

- Original package `SV833_Original_File_Monitoring_Complete_20261013.zip`, 274,293 bytes. The maintained original is Library `libfile_1c161ead52788191aff28687a08a11b6`, file `file_00000000b998820cac14d43902a8419c`. Its original source members are `source/temporal-workspace-observations/original-workspace-record.json` (672,461 bytes, SHA256 `2d4dcc91223863b34a1616c70c0db3721e4aeac2d30b02fd2dc6e94c2b41b9b0`) and `original.csv` (78,656 bytes, SHA256 `f6cf205ce830b97d8208839460d788993a890ddd95890634e5bf88ebddaebf2e`). Resolve the existing original file through its authorized receiving route; no archive reconstruction is needed.
- Complete extracted-source JSON, schema `upstate.sampling-extracted-native-observations/v1`. The authored public scientific input is Git blob `5a6f36b8a2a65f26a253772d6acffea3ef9ed9dd`, 4,290,838 bytes, SHA256 `8780eb2bde5c16e86fb732dd8d72776bf3378e33028e6cf4fa10734f97ae7bc1`. It contains all complete retained original cells and raw native records, exact upstream source packet text, explicit import metadata, original row correspondence, and the derived CSV text. Its new 78,866-byte CSV has SHA256 `98829cb3677c5f7b8fcda3e34d3dafb52faf907ac46bf753524130390327f12f`. It is explicitly a new serialization of the retained table; the different original CSV identity remains separate provenance. No observation value, blank, qualifier or scientific support is synthesized.

Append the following flags to the **existing original45 recorded receiving command**, keeping its operation, selections, configuration, Workspace and output:

```sh
--native-observation-course "$APP/source_tools/selections/sampling_sv833_20261013.json" \
--native-observation-input "$ORIGINAL_SOURCE_INPUT"
```

`ORIGINAL_SOURCE_INPUT` is the actual local original ZIP or complete extracted-source JSON. Obtain it through the existing source/data custody; a provider alias alone is not a local file. If the complete observation is already in the Workspace, the optional input is unnecessary.

The receiver verifies the original package members or the exact original source-packet SHA, then compares the complete CSV column inventory and every cell against all208 retained rows before calling the maintained `Workspace.import_observations`. The original eight-column mapping, source URI, observation kind and time/measurement/quantity support are retained. All49 below-quantification rows keep the blank source units. The later context still applies only the originally authored reporting-limit-unit fallback and qualifier choices.

A normal current import may produce a new immutable observation ID. Its actual returned record and row IDs are recorded; original and imported identities are never represented as the same by assumption. The derived course changes only the source binding and explicit original-to-imported row correspondence. Its four scientific targets, original source cohort dimensions, budgets, winter coverage goals and calendar choices remain unchanged. The full upstream raw rows and source descriptors travel inside the imported observation's retained provenance and therefore through the original context and selected editable Study.

Before any normal import, recovery saves an immutable intent selecting original-record reuse or native import. A retry honors this decision even if an import restored the donor CSV and then stopped before its result receipt was written. Before discovering an existing donor record on retry, recovery reopens its own saved import receipt. Thus a donor record arriving later, or a CSV object becoming available after an interrupted import, cannot switch the selected observation ID. The same input, original authored course, actual imported record and original CSV are checked again; immutable receipts reject changed source inputs. Existing successful original courses retain their original records and outputs.

The same `native-observations/` output contains `original-source-input.json`, `original-source-import-intent.json`, `original-source-import.json` and `source-bound-course.json` alongside the original context, proposal, calendar, reports and selected-Study receiving result. A received application reopens the actual imported observation and provenance, complete source bytes, network, context, exact cohorts and original saved choices. This is normal observation intake and Sampling execution; it does not start a landscape model or recompute a historical temporal analysis.

Preserve the original network sources and exact SV-833 station assignment. An observation input never establishes a station geometry or missing network membership. The existing network builder verifies the retained domain/station sources and returns the actual network ID before the authored Sampling selection is compiled.

The full owner direction above remains in force. Open and operate the actual populated desktop and390px product and every final report, CSV/JSON, original source and extracted editable Study, then reopen the contained application. Record the actual process/output and any failure in the same receiving operation. Source review is not rendered or native acceptance.
