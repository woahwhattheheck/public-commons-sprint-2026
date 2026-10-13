# Parameter studies in SourceReports

Open **Parameter studies**, open a saved study, and choose **Prepare scientific source**. This uses the saved result edition already produced by the study. The original native run, parameter profile, grid, land-cover scenario and reporting polygons remain its scientific basis.

## Choose the report

Name the report source. Leave **All completed cases in this result** selected to present the complete saved cohort. To choose a subset, select **Choose original cases**. Search by case, profile, native run or parameter assignment; use the paged case list to select across pages. **Select matching cases** adds every matching original case, including off-page cases. **Clear selected cases** empties the explicit selection. Returning to all cases preserves the stored explicit choices for later editing, while the submitted report uses all cases.

Select one or more original reporting areas and pollutants. The prepared source retains each case ID, run ID, profile ID, parameter assignment, original polygon selection and original source edition. A **Report this case** button beside a completed native case starts the same selection with that case chosen. If that case completed after the last summary, first use **Refresh completed results**.

**Prepare scientific source** submits one action to the existing native operator queue. Preparation freezes the complete original exported study files and selected numeric rows. The task opens the original study and offers **Compose selected scientific report**, plus the ordinary scientific PDF, HTML, Markdown and ZIP downloads. The composer uses the shared SourceReports renderer and can combine this source with other original sources in the chosen order.

From the saved study, **Open prepared source in composer** reopens the most recently prepared source. The task button carries its exact source-operation ID, so reopening an earlier task selects that exact earlier result and subset even after another source was prepared. If no source exists, prepare one first.

## Read the original quantities

Every displayed change is **case minus baseline**, on the original paired valid cells. The source presents paired quantities and support counts alongside independent full totals. A zero baseline leaves percentage change undefined. A case with no valid paired support retains undefined quantities.

Full-study minimum/maximum ranges appear only when every completed case in that saved result is selected. Selecting fewer cases preserves their original rows and omits the full-cohort range from the selected presentation. The complete original results file still retains every published range. Source preparation performs no new scientific aggregation or native calculation.

The selected report can have fewer cases than the original study. Its introduction separately states original total cases, completed cases in the result and selected cases, areas and pollutants. All physical constituents remain separate, in their original annual-mass units.

## Map and source navigation

**View difference maps** opens the actual retained comparison in Spatial review. **Open difference maps** opens its original comparison record. Both refer to the original full comparison extent. Selecting a reporting polygon for the scientific report does not clip or replace a native GeoTIFF.

The source package includes the complete original study report and export members, original requested maps, native arguments, execution-version records, aggregation context and any adopted aggregation ancestry. It also retains the selected coefficient-table originals with companions, selected reporting-polygon originals, original grid record, reporting/model-domain geometry when available, and an inventory of the larger native inputs retained in the full Workspace.

Use the SourceReports original-source export for an independently importable source edition. Use the complete Workspace transfer when the recipient will continue original native calculations or inspect the large original/aligned input and output rasters.

## Saved editions and continuation

The selection is bound to the exact original results SHA256. If results change between reviewing the form and queue execution, the operation asks for a new review instead of silently selecting the new result. Existing prepared sources remain available through their original task and imported source IDs.

Preparation retains independent file copies, exact export-manifest descriptors and immutable selected rows. It can continue interrupted preparation of the same source operation. Once the original source is registered, a renderer interruption can resume without rerunning the scientific model.

## Native API

Existing queued action:

    parameter-study.source.prepare

Payload:

    {
      "experiment_id": "<original-study-id>",
      "expected_artifact_sha256": "<saved-results-sha256>",
      "title": "Selected Parameter study",
      "case_ids": null,
      "area_ids": ["reporting-area"],
      "pollutants": ["nitrogen_export", "phosphorus_export"],
      "render": true
    }

Null case/area/pollutant selections mean all original available choices. Explicit lists must be nonempty, unique and part of that result. Original producer order is retained.

Read endpoints:

- GET /api/parameter-studies/source-catalog?id=STUDY_ID
- GET /api/parameter-studies/scientific-source?id=STUDY_ID
- GET /api/parameter-studies/scientific-source?source_id=SOURCE_OPERATION_ID

The first read returns original choices and the current result identity. The second opens the latest prepared source for the study. The third opens an exact saved source operation. All reads use the selected Workspace.

The additive model API is model.parameter_report_source.catalog, preview, prepare, latest and get. The original parameter-study kernel, result index, full exports, ensemble source producer and shared collector/renderer remain authoritative.

## Receiving inspection

Use a real saved native study with both completed and pending cases, multiple reporting areas when available, and its actual difference maps. Operate the exact current application at desktop and narrow widths: open the report form, search beyond its first case page, select across pages, change between all/explicit choices, select areas/pollutants, prepare, open the exact task source in the composer, render all offered formats, follow original map/source links, then reopen the Workspace and earlier source task. Inspect the actual PDF pages and original report links as well as populated/empty/error states. Retain the original study and source IDs in the existing native operation's response.

Source and V8 controller checks support this implementation; actual rendered desktop/mobile/report inspection belongs to the equipped receiving application.


## Original-result figures

Prepared sources include separate monochrome figures for each selected reporting area, pollutant and original unit. Each page shows at most twelve original cases, with a position-to-case key immediately after the figure. One panel shows the original baseline/case annual masses on that pair's valid cells; the next shows the retained case-minus-baseline change around a visible zero line. Cases are points rather than a connected trend.

Changed support has a separate marker and legend entry. Each figure includes the original independent baseline and case cell counts, paired cells and paired area. Matching counts alone do not establish identical geography across different cases. The paired values retain their original comparison support; the original full totals remain distinct in the numeric report.

Undefined values have no plotted point. The coverage record retains the exact field, original case and source-row pointer for each omission. A page containing only undefined original values produces no empty quantitative plot; those cases remain in the report's original tables and coverage files.

The shared scientific renderer uses the same numeric figure specification for vector PDF graphics and ordinary report exports; standalone SVGs remain source companions. The complete coordinate CSV and JSON retain the original result SHA256, selected-results SHA256, source JSON pointer, case/profile/run identities, parameter assignments and support metadata. Ordinal case positions and padded axis bounds are presentation metadata. No fitting, interpolation, averaging, physical conversion or probabilistic interval is introduced.

Inspect each actual PDF/HTML figure, case key and support table at receiving. Check units, zero line, undefined coverage, changed-support markers, page boundaries and original source links. Open the standalone SVG, coordinate CSV/JSON and original numeric result from the delivered source before approving that outgoing report. Earlier prepared sources remain independently reopenable; preparing under the figure edition creates another source operation from the same original scientific result.
