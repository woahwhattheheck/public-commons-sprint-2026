# Source-bound institution reports

Compile complete native bank/credit-union mapped views into three readable report sections: institution values, explicit peer/period comparisons, and source coverage/review. The engine retains exact source cells and definition approvals alongside every calculation. It uses exact rational arithmetic and rounds only the displayed result.

## Operate

Use an existing Node 24 installation. Save an approved complete input and choose a private output directory:

```sh
node operate_report.mjs --input /PRIVATE/report-input.json --output /PRIVATE/report-delivery
```

The command writes the complete original input, report.json, report.html, observations.csv and a completion manifest. It preserves existing different files. Repeat the same input/output after interruption to complete missing identical files. Copy the entire directory to the receiving engineer, who can re-run the same command in a separate private directory and compare all manifest hashes.

The complete input is at most 128 MiB. Each original UTF-8 source is at most 32 MiB. The report selects one institution family, up to 50 institutions, 15 measures and four calendar-quarter endpoints (at most3,000 selected institution/period/measure positions). Those positions are distinct from original table rows. Inputs preserve complete native mapped views and original text, including source rows outside the display selection.

The included reference/input.json is a complete authored operating example. Its values and native-shaped mapping documents illustrate the contract; they are not bank observations or an execution of the native parser. Run it through the same command to obtain all three report sections.

## Source and selection contract

The root schema is commons.institution-report-input.v1:

- title, ascending periods (YYYY-MM-DD quarter ends), institutions with id/name/family (bank or credit_union), and subjectIds.
- originals: complete UTF-8 documents {filename,sha256,text}. Hashes cover exact UTF-8 bytes.
- views: exact complete native object documents {sha256,text}. Each decoded object is commons.bankregdata-view.v1, with original source_sha256, all observations, and matching observation_count. The hash is the actual object-text hash; no reconstruction from metadata or preview pages is accepted.
- sourceSelections: one explicit selection per source metric and period, including sourceSha256,tableId,definitionId and compatibility:{group,approvedBy,approvedAt,note}. These link exact source editions to a reviewed definition. Changing a source account or definition needs an explicit reviewed compatibility decision.
- measures: id,label,unit,decimals,operation,peerStatistic,rankDirection,comparisonPolicy,comparisonNote and the operation-specific fields below.
- cohorts: one per subjectId, with id,definition,approvedBy,approvedAt,memberIds and explicit includeSubject. Membership must agree with that flag.
- review: actual findings, corrections and reviewer record, completed during the project. This record is retained without manufacturing an approval.

Use the complete objects/<view_sha256> from an authorized native handover. Native metadata alone omits observations. Preserve native handover/source/engine provenance and the complete approved selection with the resulting input. The existing native parser/receiving operation remains responsible for mapping and replay of the original tables; this compiler consumes that source-bound result.

## Measures and definitions

reported and quarter_from_ytd require sourceMetric,sourceBasis and sourceDefinitionGroup. Accepted native bases are instant,quarter,year_to_date,annualized and provider_defined. Unit must equal the native normalized_unit. Only comparable reported or reported_zero observations are admitted. Missing, bounded, suppressed, provider-unavailable and unresolved-zero values remain explicit exceptions.

quarter_from_ytd requires year_to_date. Q1 equals that year's Q1 YTD; Q2–Q4 subtract the immediately preceding same-year cumulative quarter. A rolling Q4,Q1,Q2,Q3 display therefore also needs the preceding Q3 source. Both sources must match the measure's approved compatibility group, basis and unit. No cross-year subtraction or zero filling occurs.

ratio requires numerator and denominator measure IDs plus an exact decimal multiplier (e.g. "100" for a percent). Both operands must be selected measures. Denominators must be positive. Label the chosen financial definition accurately: period-end assets are not average assets, and an unannualized quarter ratio is not an annualized return measure. Derived ratios retain both source chains. Formula cycles reject the selection.

Native value strings stay decimal strings. Calculations use reduced BigInt fractions; each output includes the exact numerator/denominator and a display rounded half away from zero, with no intermediate rounding. Display decimals range 0–12. Input decimal strings allow at most 40 integer and 20 fractional digits, without exponent notation.

## Cohorts and comparisons

Choose mean,median or ratio_of_sums explicitly. The first averages comparable values, the second uses the middle exact value (or mean of two middle values), and ratio_of_sums sums the valid ratio operands before division. A peer with a missing/invalid operand or nonpositive denominator is excluded from the observed ratio population. Eligible/observed counts and omitted institution IDs remain visible.

Rank direction is higher,lower or none. Competition ranking retains ties. A subject rank is shown only if the subject is in the selected cohort; otherwise the statistic remains available without inventing a rank.

comparisonPolicy is compatible,same_calendar_quarter or display_only, with a substantive comparisonNote. Reported YTD measures must use same_calendar_quarter or display_only. Each period change compares the immediately preceding displayed period. Percent-valued differences are percentage points; relative percent change is additionally shown only for positive baselines. A missing/incompatible value leaves the comparison unavailable.

## Review and delivery

Read report.html for the three sections. report.json contains full source traces, cohort definitions, exact fractions, exclusions and review fields. observations.csv is a complete selected-row export; formula-like text is prefixed for spreadsheet safety while original strings remain intact in input.json and report.json.

Compare selected example rows with original source cells, review the cohort and calculation definitions, inspect the unavailable rows, and record actual corrections. Retain prior source editions and reports when accepting a new edition. The compiler returns a detached report, so later caller mutations cannot alter an already produced result.

Actual current verification ran the complete authored reference in Functions V8 and compared all report bytes independently. It covers the rolling predecessor/year boundary, differing cohort statistics, missing and incompatible definitions, exact decimals above 2^53, duplicate selections, formula cycles, source lifetime and output escaping. The native CLI is supplied for the selected Node/Linux receiving environment; its actual installation/run is recorded by the receiving operator.

## Exact rendered receiving

Follow NATIVE_HANDOVER_INPUT.md for the complete native and browser operating course. Before presenting a generated report or attachment to a recipient, open and visually inspect that exact version at its real wide and narrow viewing sizes, operate the downloads, and reopen the received files. Fix affected layout or behavior directly. A source review, screenshot capture without viewing, or a scripted navigation result does not replace seeing the actual output. Preserve the complete source and actual operating result with the handover; do not add a separate approval workflow.
