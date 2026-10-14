# Season-matched monitoring change

This maintained application component adds a complete temporal-analysis workflow to the original monitoring studies. It reads existing source cohorts, calculates same-calendar-month changes, keeps reporting-limit intervals and original data identifiers, and saves an editable offline analysis together with its inputs. The original station studies, scientific models and workspaces remain unchanged.

## Run from the maintained application

```sh
python measurement_workspace/temporal_analysis.py --application . --output /absolute/new-analysis
```

Open `review.html` in the output folder. Select a station, constituent and method. Inspect the original monthly measurements, fixed-month comparison, first-to-last-year change and leave-one-year-out results. Every visible series has complete source-row and paired-slope CSV downloads. Original field values and original source selectors are available through **Open row**.

Save analyst notes with **Save working HTML** or **Save review JSON**. A review can reopen only against the exact analysis identity. Importing makes a new working copy. Notes do not modify observations. The recipient can rerun the entire calculation offline from the delivered original inputs:

```sh
python engine/temporal_analysis.py --application inputs --config selection.json --output ../recalculated-analysis
```

The operator component **Monitoring change** runs the same engine through the original native task queue and saves results in the current Workspace. Each edition retains its calculation selection, exact inputs, complete report and source ZIP. A repeated request has a queue operation identity. Outputs are immutable; recalculation chooses a new directory rather than overwriting accepted work.

### Receive an existing complete analysis

In **Monitoring change**, choose **Receive a complete monitoring package** and select `temporal-analysis.zip`. The original upload, native task and Workspace save retain the complete calculation without rerunning it. The receiver verifies member paths, lengths, hashes, calculation identity and original input/source-engine identities before publishing a new immutable edition. It does not import or execute a module from the ZIP.

Open the saved edition and choose **Use this complete selection for a new analysis**. The new calculation uses that edition's captured `inputs/`, even when the current application has newer or different station sources. The existing installed engine executes the chosen settings. **Use installed source families** explicitly returns to current application data. Both choices and operation identities are retained per Workspace. A source receipt includes every original row, month, pair, source file and runnable standalone engine.

The additive `integration/component_fragments/temporal-analysis.json` exposes the component to the existing full-application assembler. The extension uses existing upload, queue, Workspace and download services. Source inventories include the component paths listed in the fragment; existing provider and shared application files are untouched.

## Analyze an original scientist file through the existing intake

The original **Measurements** importer remains the sole intake. Open the original CSV there, preview its actual headers and records, and map station, constituent, value, unit, sample dates, method and qualifier using the existing interface. The original file, untouched extra columns, source row numbers and selected mapping stay in the Workspace. Existing workbook-intake and source-shaped return components remain separate maintained workflows.

In **Monitoring change**, the **Analyze your imported measurements** panel lists those saved sources. Select the source and inspect its original mapped preview. Classify each original qualifier as measured, below its reporting limit, above its reporting limit, or context only. The optional laboratory fields use the original columns; they retain fraction, depth and depth unit, method authority, result type, chemical/physical bases, activity ID, sampling programme, time/time zone, limit and limit unit, and original comments.

The **quantity is nonnegative** choice explicitly constrains a below-limit interval to zero through the reported limit. It does not turn a nondetect into a zero measurement. Without that choice, its lower endpoint stays unbounded. The separate **use its original reporting-limit unit** choice applies only to a censored row whose measurement-unit cell is empty. A nonempty measurement unit is never replaced, and conflicting units never trigger an implicit conversion.

Use the dates, months, station IDs and constituent controls in the calculation form, then choose **Analyze selected imported measurements**. The native `temporal.analysis.observations` action captures a read-only edition of the already-imported original source and runs the same interval/season engine. The result includes the exact original CSV, complete original Workspace source record and mapping, all derived rows, qualifier interpretation and every result. Unknown qualifiers, invalid dates, missing dimensions and multi-day aggregate records remain retained with their disposition; this monthly single-day analysis does not silently change their meaning. Annual mass references remain with the original model/reference-comparison workflow.

The native action does not fetch an external site or ask the scientist to invent a new table format. Original-label station and constituent selectors remain in the result. Source-shaped CSV/workbook handback can consume the preserved original row IDs and `source_csv_row` while keeping the original source unchanged.

### Completed original-file operation

The retained South Carolina WQP SV-833 nutrient CSV was opened through `observation.import` and then analyzed through `temporal.analysis.observations`. It contains 208 original rows, including 49 below-quantification-limit results. The explicit original-limit-unit option retains all 208 rows in nine distinct analytical cohorts, yielding 194 month-years and 302 same-calendar-month pairs. The original 78,656-byte CSV remains exact. This is a completed public-source file workflow; Tim's future data will enter through the same original intake with its own reviewed mapping.

Original collection: `2e3b1856bdacf538699044b4d11948287a4e8f9a188aef7c8bd94131bc0c1a36`. Completed analytical edition: `9c6c7977c1a3927177100212ae2a4f69d6ec32a232228959116bbdc63866990a`. Original task: `b7e973284bd999e7b1a9955c51af7c36b0086880ade1a02465439f52e37682fd`. These identifiers are implementation references, not required manual user inputs.

## Analytical support

Four original source families are available: the SV-833 2021 to 2026 study, the four Eighteenmile stream nutrient stations for 2020 to 2025, the utility microbial source edition for 2021 to 2025, and original USGS daily discharge for 2020 to 2025. The microbial and SV-833 families overlap at SV-833. They are separate analytical editions and are never pooled into a supposedly independent record count.

The required comparison key retains source family, station, constituent, unit, fraction, chemical speciation, analytical method and authority, depth, actual versus calculated result, and available weight/time/temperature/particle-size bases. Original programme identifiers remain in every result. The optional `separate_projects` switch makes programme a further required matching dimension. With the default false, a programme named for its sampling year does not automatically prevent a same-method temporal comparison.

An agreeing repeated result within the same activity counts once in monthly calculations; its original IDs remain retained. The original SV-833 study already groups 34 repeated-result sets by its full source contract. Different activities in a month each contribute one interval to that month's median. Numerical values are singleton intervals. Source-reported below-limit and above-limit observations retain their intervals. The engine uses a conservative closed-endpoint enclosure, including unbounded upper endpoints, instead of inserting half a reporting limit or zero.

The median of lower endpoints and median of upper endpoints enclose the monthly median. Each monthly median is compared only with the same calendar month in another year. A pair's change interval is divided by its integer year difference. The medians of the lower and upper pair slopes enclose the season-matched Sen slope. Shared values may make pair extrema jointly incompatible, so the support bounds are conservative. They are not confidence intervals. This component intentionally does not attach a p-value that would require additional assumptions about censoring, serial dependence and the sampling design.

The same-month score bounds retain every feasible sign of the later-minus-earlier interval difference, including ties. The fixed-calendar-month comparison retains only months present in every selected year of that cohort. The first-to-last-year change uses months present in both endpoints. Leaving out each observed year repeats the calculation and identifies support that depends on a particular year. Three years are needed for a year-removal calculation; an insufficient series still shows its original coverage and every computable quantity.

For discharge, daily observations come directly from the retained USGS WaterML responses with original site, statistic, method, date and qualifiers. Only numerical nonnegative discharge values can enter a monthly median. The default requires an approved A qualifier and all dates in each included calendar month. Estimated approved values remain included by default and retain their e qualifier; the selection can explicitly exclude them. Lowering `minimum_flow_month_coverage` is an explicit alternate calculation, never an imputation. Partial selected months remain partial against the full calendar-month denominator.

All original dates, times, time zones, information-only comments, reporting limits and source fields remain available. Source-quality exclusions are recorded per row. The default excludes explicit information-only microbial comments, the original out-of-screen SV-833 pH value and non-routine/unreported microbial records. The underlying source is preserved.

These results describe observed sampled conditions. No concentration becomes an annual catchment mass, no daily mean becomes an instantaneous grab-sample flow, and no cross-station or upstream/downstream relationship is inferred merely from matching dates.

## Calculation settings

`selection.json` retains the title, selected source families, ISO start/end dates, station and parameter identifiers, calendar months, source-comment controls, approved/estimated flow controls, month coverage fraction and programme separation. To recalculate, edit the settings through the native operator or supply this JSON to the command line. All validation occurs before output publication.

Outputs are `analysis.json`, `review.html`, `cohort-summary.csv`, `monthly-intervals.csv`, `matched-month-pairs.csv`, `leave-one-year-out.csv`, `source-records.csv`, `selection.json`, exact `inputs/`, runnable `engine/`, the member manifest and `temporal-analysis.zip`.

## Method references

Hirsch, R. M., Slack, J. R. and Smith, R. A. (1982). Techniques of trend analysis for monthly water quality data. Water Resources Research 18(1), 107 to 121. https://pubs.usgs.gov/publication/70011649

Schertz, T. L., Alexander, R. B. and Ohe, D. J. (1991). The computer program estimate trend (ESTREND), a system for the detection of trends in water-quality data. USGS Water-Resources Investigations Report 91-4040. https://pubs.usgs.gov/publication/wri914040

These references motivate season matching and careful treatment of censoring. The interval enclosure here is explicitly derived in the saved methods, rather than labeled as the complete ESTREND hypothesis-testing procedure.

## Delivery

Use the exact outgoing application and report on a desktop and narrow browser. Operate selection, source-row inspection, downloads, working-file save and reopen, and native queue recovery. View actual rendered output and fix observed faults. Preserve original data and accepted simulation results. Use the current source component in the original application assembly and internal Ecosystem Sciences workstream.

## Rendering and native-operation scope

The delivered source-file import, calculation, complete-package receiving and saved native results were executed in the cloud runtime using the original Operator and Workspace services. Exact self-contained reports were operated in Chromium at desktop and 390-pixel widths, including original-row inspection, ordinary file downloads, working-note save and reopening. The operator component was separately rendered from the actual retained native responses and its source/mapping/result controls inspected. This cloud browser's managed localhost-navigation restriction remains intact; the receiving owner opens the full local HTTP interface through the maintained launcher in its normal authorized browser. No alternative runtime or proxy bypass was installed.

The source addition preserves the original application. Its full portable handover includes the original application and scientific Workspace, the completed monitoring editions, the public-file workflow and the separately completed DE49 flow-conditioned Eighteenmile study. Private operator session state and transient access URLs are excluded; the launcher creates the recipient's own private local session.


## Imported original analytical context (1.2)

The original native observation now carries its additional scientific declarations into Monitoring change. A source may retain a chemical basis, named analytical method, solids basis, result or activity sampling depth and reference, microbial-count method, turbidity scale or conductivity temperature correction. These declarations can distinguish measurements even when station, constituent, unit, method code and the usual sampling columns agree.

The capture reads these fields only from the retained native source quantity and original canonical record. It keeps those declarations in separate namespaces and retains explicitly supplied null, zero and empty values. It does not derive a basis from a unit, use a measured value as a grouping field, or resolve conflicting original declarations. Original values, qualifiers, source IDs and all other source fields remain in the complete source records. Legacy free-text source quantities remain original context; the capture does not guess their scientific dimensions.

The complete analytical context participates in the same cohort identity before within-activity deduplication or monthly aggregation. It travels in the saved analysis and full source/cohort CSV exports, and the standalone report exposes it beside the selected series. The report's search includes the full context. Two otherwise similar series have their own stable identity label and complete context; their monthly medians, paired slopes and analyst notes stay separate.

Existing captured records without this additional context retain the exact legacy cohort key. Existing saved analyses and ZIPs are immutable and still open with their original report and implementation. Rebuilding from a native observation with the new capture produces a correctly source-bound successor. The existing interpretation controls, source dispositions, censor intervals, estimator and all complete input/export/receiving mechanisms remain authoritative.

Continue the original CLOUD13 / 7915–8007 course at its accepted source boundary. Install the four exact guarded successors with the complete existing private temporal cohort. Use the already retained original observation, inspect its sampling meanings, and explicitly run the existing analysis command. The receiving producer must personally open and use the exact rendered desktop and 390 px views, every complete JSON/CSV/HTML/archive and independently reopened working project. Source review, successful HTTP or captured-but-unviewed screenshots do not establish recipient readiness. Repair any real product issue in this same course; do not create another worker or replace an active application.


### Original optional-field and support choices

An absent optional-column override keeps the original import mapping or metadata. A saved blank override explicitly disables that field. The existing Monitoring change form now offers both choices separately; old nonblank column selections keep their exact meanings. Capture records the selected field, whether its original cell exists, and its literal null, blank or zero value. It never turns a supplied zero into a missing cell.

Original quantity basis, measurement support and time support travel in the additional cohort context when declared. Each row also retains its original measurement unit and the explicit policy for using a reporting-limit unit if the measurement unit is absent. An actual fallback is labeled and counted; it does not silently overwrite the original unit.

Source activity identifiers and automatically generated original-record fallback identifiers remain distinct provenance. Neither count is described as independently verified sampling visits. The known canonical Measurements handoff carries its missing original activity through this same rule. Every original source cell and complete record remains present in the existing capture and portable package.
