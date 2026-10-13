# Native assessment coverage with measured E. coli context

This delivery joins the completed native station report to the original utility microbial study. It provides one interactive report, the existing scientific report recipe, all 17 typed source entries and a portable source ZIP.

The original geography, assessment records, annual references and measured samples retain their separate identities. The microbial addition uses the completed original station-identity join published in PR3515.

## Open the complete source edition

The delivered application contains:

- `results/native-assessment-microbial-delivery-20261013/sources.json`
- `results/native-assessment-microbial-delivery-20261013/association/OPEN_ASSESSMENT_ASSOCIATIONS.html`
- `results/native-assessment-microbial-delivery-20261013/native-assessment-microbial-delivery.zip`

In **Sources**, preview and import the bundled measured native assessment edition through the existing source queue. **Source reports** then opens its interactive report. The complete ZIP can also be imported through the ordinary source receiver.

The 17 source entries include the original four native geography/context entries, seven station and assessment entries, four microbial entries, the interactive document and its scientific report recipe. The four new source IDs are:

| Source ID | Original role |
|---|---|
| assessment-microbial-geography159-20261013 | ASSESSMENT_MICROBIAL_GEOGRAPHY |
| assessment-microbial-observations730-20261013 | ASSESSMENT_MICROBIAL_OBSERVATIONS |
| assessment-microbial-observed-stations36-20261013 | ASSESSMENT_MICROBIAL_STATIONS |
| assessment-microbial-coverage159-20261013 | ASSESSMENT_MICROBIAL_COVERAGE |

The original measured point layer retains the completed 159 point geometries. Existing Spatial Review can select `has_microbial_observations = true` to open the four shared stations.

## Read the three source scopes together

| Scope | Stations | Records |
|---|---:|---:|
| Complete published assessment context | 159 | 192 assessment records |
| Complete retained microbial study | 36 | 730 observation records |
| Exact shared station identities | 4 | 132 routine samples and 8 assessment records |

The 730 observation records comprise 729 routine samples and one field replicate. The four shared stations are SV-111, SV-735, SV-833 and RS-21014.

| Shared station | Utility | Routine samples | First sample | Last sample in this edition |
|---|---|---:|---|---|
| SV-111 | ARJWS | 47 | 2021-01-06 | 2025-11-04 |
| SV-735 | ARJWS | 23 | 2021-01-20 | 2023-05-03 |
| SV-833 | ARJWS | 50 | 2021-01-20 | 2025-12-02 |
| RS-21014 | PRWD | 12 | 2021-01-06 | 2021-12-02 |

The source join requires an exact SCDES site ID in the `21SC60WQ_WQX` namespace and an identical original station name. Other publisher prefixes remain attached to their records.

The 32 other observed stations contribute 598 source records. The 155 assessment stations without a microbial match have no record in this selected retained utility E. coli cohort. The original native report still exposes all 159 assessment stations.

## Inspect measured samples

Open **Measured source context** in the report. Its controls cover:

- Original utility selection.
- Four shared assessment stations, other measured stations or the complete source.
- An exact original observation station ID.
- Original result status and sample type.
- Inclusive sample-date range.
- Search across source identities, comments and assessment causes.

The sample table shows distinct original activity IDs. **Select all matching activities** selects the full filtered result across every page. Changing filters preserves the selection. **Show selected activities only** returns to that retained selection.

Open a sample to inspect its original clock and timezone, method, result, limit, interval, source units, comments, hydrologic context and source row. The same panel shows its exact assessment station and each original assessment edition.

All 132 shared-station samples use APHA 9223-B and MPN per 100 mL. They comprise 126 numerical results and six above-limit records. The latter keep an empty measured-result cell, their original reporting or quantitation limit and an unbounded upper endpoint.

The full source retains the field replicate `21GAEPD_WQX-A00428245`, sampled on 2023-06-22 using APHA 9221-F. Use the sample-type filter to inspect it independently.

## Compare original assessment periods

The measured source requested 2021-01-01 through 2025-12-31; retained records extend from 2021-01-06 through 2025-12-10.

The 2024 assessment edition explicitly covers 2018–2022. The report preserves the original station-level comparisons:

- SV-111: 16 samples inside that period and 31 later samples.
- SV-833: 21 samples inside that period and 29 later samples.
- RS-21014: 12 samples inside that period and none later.

July 2026 is a publication/status edition. Its records do not specify an assessment-period window, so those comparison cells remain **Not specified**.

Each of the four shared stations has an E. coli assessment record. Four other records at those stations concern turbidity, dissolved oxygen or pH. The twelve RS-21014 samples remain twelve distinct activities when viewed beside its three assessment records.

## Continue into the existing station study

From a shared sample's detail panel choose **Open [station] in native station coverage**. This opens the same original station in the report's physical coverage view.

Use that view's existing station selection and **Export selected native JSON** when preparing a new retained study. In Station geography, **Use selected native report stations** imports the source-bound selection. The existing **Build selected study** and **Use saved study in assessment context** course then carries the chosen original station and assessment records into the maintained assessment report producer.

The measured sample export is separate. **Export selected sample JSON** preserves the selected original activity rows, source provenance, station associations and original assessment-period context. **Export selected sample CSV** keeps every original joined CSV column. Spreadsheet formula characters in textual cells are escaped; retained original CSV files stay byte-identical.

**Save complete review HTML** retains the measured-source filters and selected activities together with the native and assessment review states. The file reopens offline. **Print source summary** includes all 36 original station coverage rows and the eight assessment-period comparisons; the complete 730 rows remain in the retained CSV and embedded interactive data.

## Prepare a client report

In Source reports choose **Prepare scientific report** for this source. The existing composer opens **Prepare a scientific report** with the measured native recipe available.

Use **Preview selected sources**, arrange studies with **Earlier** and **Later**, and choose **Prepare PDF, HTML and data**. The new measured section summarizes the actual four-station overlap, all eight assessment-period relationships and the complete source scope. It links the original observation CSV, coverage tables and source interpretation.

The existing annual-reference sections retain their nutrient and sediment targets, source periods, catchments and units. E. coli measurements supply microbial station context.

Reopen the saved report through **Open saved report**. **Prepare complete report ZIP** and **Back up Workspace with this report** retain the full source edition through the maintained scientific-report workflow.

## Reproduce the complete delivery

From the actual application source:

~~~bash
node source_tools/native_assessment_delivery_cli.mjs \
  --application /absolute/current/application \
  --output /absolute/new/native-assessment-microbial-delivery \
  --microbial
~~~

To import that result into an existing Workspace in the same operation:

~~~bash
node source_tools/native_assessment_delivery_cli.mjs \
  --application /absolute/current/application \
  --output /absolute/new/native-assessment-microbial-delivery \
  --microbial \
  --workspace /absolute/current/workspace \
  --python python3
~~~

The output directory must be new. The original command without `--microbial` continues to produce the existing 13-entry native source edition.

The pure API is:

~~~javascript
composeNativeAssessmentDelivery({
  nativeFiles,
  assessmentInputs,
  originalAssessmentFiles,
  stationSourceFiles,
  annualSourceFiles,
  microbialFiles,
  microbialOriginalFiles
});
~~~

`microbialFiles` contains the eight complete original PR3515 files relative to `source/annual-reference-assessment-20261013/`, including `microbial-assessment-sources.json`.

`microbialOriginalFiles` contains the 39 complete original publisher, utility and temporal-source files at their canonical application-relative paths. `MICROBIAL_ORIGINAL_FILES` supplies their retained byte counts and SHA256 identities. The original temporal and utility manifests resolve inside the delivered archive, including the retained USGS daily source.

The composer checks all original microbial source declarations, the complete station and activity cohorts, exact native assessment identities and explicit assessment-period counts. It uses the original completed memberships and source results throughout.
