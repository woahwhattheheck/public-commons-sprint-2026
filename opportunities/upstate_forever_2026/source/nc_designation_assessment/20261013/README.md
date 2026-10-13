# NC designated waters: published 2022 assessment context

This complete source family joins all 103 NC Savannah classified-water schedule records to the original 110 assessment units acquired from the NC DEQ FINAL 2022 service. It supplies the existing Scientific Report operator with `observed-report.json`, full source-preserving CSVs and an explicit source-review queue.

## Use the source

From the application directory:

```sh
node source/nc_designation_assessment/20261013/reproduce.mjs
```

The command uses Node's standard library, checks the retained original bodies and regenerates all eight derived outputs. An optional destination argument writes the outputs elsewhere. The original inputs remain unchanged.

Import the root `nc_designation_assessment.sources.json` through the existing application's source import. Select the report titled **NC designated waters: published 2022 assessment context** in the maintained Scientific Report operator. The report uses its ordinary table, paragraph and source-link structures. Export the report/study with all source companions and reopen that same exported study.

## What the join preserves

- All 110 unique AU_IDs and their complete original layer 2 attributes, including historical IR labels and original AU_Length/AU_Units.
- The 103 legal record IDs, exact BIMS indices, full class punctuation, management markers, effective dates and legal descriptions.
- All 34 original polygon attribute records, associated with their existing AU_ID. These add zero assessment units.
- All 77 parameter records, their original OBJECTID/ASMT_ID, CYCLE, collection year, assessment date, status, category and stated reason.
- Source paths, original publisher URLs, byte counts, hashes and original layer identities.

Join identity is NC jurisdiction plus exact BIMS index. Every original BIMS_CLASS agrees literally with its retained legal class. A source-index relationship does not replace the native geometry intersection. Use the existing ES-9960 selected-217-HUC assessment crosswalk to determine project membership.

## Outputs

| File | Use |
| --- | --- |
| observed-report.json | Existing Scientific Report content |
| designation-assessment.json | Complete nested join and row provenance |
| assessment-unit-join.csv | One row per AU; every original stream attribute |
| parameter-join.csv | One row per original parameter record |
| legal-reach-rollup.csv | One row per legal reach; all child AU IDs and label counts |
| source-review-queue.csv | All AUs with explicit source-review reasons and proposed next evidence |
| source-label-reconciliation.json | Exact cyanide label/methodology discrepancy |
| summary.json | Source counts, split reaches, coverage and component counts |

## Interpretation for the watershed team

The acquired cohort contains 23 Meeting Criteria, 83 No Data and four Data Inconclusive overall labels. Ninety units have literal Tr, HQW or ORW class components: 22 Meeting Criteria, 66 No Data and two Data Inconclusive. Component flags overlap, so individual Tr/HQW/ORW counts are not additive.

The parameter table covers 27 units. Twenty-four of those have only one parameter record; Big Creek contributes 42 of the 77 rows. Sixty-five rows have an original collection year before 2016. The 2022 NC methodology describes a 2016–2020 data window with older assessments carried forward when newer evidence is unavailable (printed page 2).

Horsepasture AU10512 is Meeting Criteria overall but retains a separate trout-temperature20°C parameter row categorized3a/Data Inconclusive. Its blank publisher compound key remains blank; row identity uses original OBJECTID15212/ASMT_ID15896.

Trays Island AU13394 retains both original fecal-coliform rows, ASMT_ID14374 and14375, with different categories/reasons and CYCLE2020/DRAFT. Five parameter rows across the full table have the original DRAFT status. All statuses remain visible.

The original Big Creek cyanide label embeds5mg/L. The agency methodology's printed page6 shows5µg/L. The original string is preserved and the discrepancy is flagged separately; a label-embedded value is never used as a numeric measurement or silently corrected.

The assessment rows guide source review and parameter/site selection. Use original measured concentration, flow and temporal support for sediment/nutrient mass calibration. Original assessment labels retain their source edition; the acquired No Data label alone does not establish absence of environmental monitoring.

## Source editions and attribution

Original NC DEQ assessment service:
https://services2.arcgis.com/kCu40SDxsCGcuUWO/ArcGIS/rest/services/2022_Integrated_Report_Overall_Stream_Assessment/FeatureServer

Original NC Savannah classification schedule:
https://www.deq.nc.gov/water-quality/planning/csu/surface-water/river-basin-water-quality-classifications-dec-9-2013/savannah-hydro-order/download

NC 2022 303(d) methodology:
https://www.deq.nc.gov/water-quality/planning/tmdl/303d/2022/2022-303d-listing-methodology-final/download

The legal registry is the complete 103-record NC family from source commit bed2f0d28fe965b8aefe4b1fbb3467ae6ec12a6d. Original assessment bodies came from ECHO-SOURCE12-PUBLIC's complete 20261013 capture. `provenance.json` retains each exact original query URL. The independent NC native geometry normalizer remains the ES-9960 course.

## Inspect the rendered outgoing product

Before presenting the outgoing report to a human, the producing and receiving peers must open its exact populated version and visually inspect the actual pixels. Use a desktop/screenshare viewport and a narrow viewport, operate the report selection, tables, source downloads, export and reopened study, and inspect meaningful empty/loading/error states. Fix visible clipping, broken controls, incorrect content or unreadable exports in the maintained product. Review an actual exported PDF where that is the chosen presentation. Source inspection and automated checks support this course; they do not replace looking at the rendered product.

This is part of Bryce's original product-delivery instruction:
https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
