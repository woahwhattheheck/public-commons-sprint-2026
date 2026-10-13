# Implementation outcome comparison method

This method belongs to the existing Implementation workbench and its retained
observation/report workflow. It compares original observations in an explicitly
selected saved plan revision. Its numerical results describe the selected
measurements and dates. They do not estimate a causal intervention effect.

## Source and selection contract

The catalogue comes from the saved `ImplementationStore` revision. The request
uses `upstate.implementation-outcome-selection/v1` and pins `plan_id`,
`revision`, and `document_digest`. Select actual `impact_site_ids`,
optional `control_site_ids`, and catalogue `group_ids`; do not supply browser
measurement arrays. Impact and control identities must be unique and disjoint.

Both `before` and `after` contain inclusive ISO calendar `start` and `end`.
Each start precedes or equals its end, and before.end precedes after.start.
`calendar_months` explicitly selects months 1–12. `qa_statuses=null` includes
all original labels; an array selects exact original labels, including a blank
label if chosen. An empty label is not an implied quality approval.

The request records an explicit `time_zone` (UTC by default), an optional
physical `lower_bound`, and optional `event` context with its original source
references. An event is not inferred from scheduled tasks, proposed completion
dates, land-cover scenarios, sampling visits, or an observed change. Show the
actual selected periods even when event context is absent. An entered event
outside the gap between the selected periods should remain visible so the
operator can correct a mislabeled comparison.

An original result joins observation → activity → site and visit. Use the actual
activity.collected_at timestamp. If actual visit.visited_at is accepted as a
fallback, mark `date_basis=visit_visited_at` explicitly. Never use planned_date.
Convert the recorded instant to the selected timezone for calendar grouping,
while retaining the original timestamp and offset. Original WQP samples in the
Eighteenmile case declare EST and retain UTC−05:00; do not reinterpret them as
daylight-saving local timestamps.

## Measurement groups and original identities

Keep parameter, original unit, basis, fraction and effective analytical method
separate. Effective method is the observation method when supplied, otherwise
the activity method, with both originals retained. Original method authority,
depth and depth unit, result basis, project and activity type remain useful
support diagnostics. Distinct supplied sampling or analytical support must not
be silently pooled under a convenient label. Do not convert units or map station
names to native sites without an explicit source binding.

A selected plan observation is counted once. Original importer identities are
`lab_ + digest([plan.id, csv_sha256, original_record_number])[:32]` unless an
explicit observation ID was selected. The importer already treats identical
same-ID records idempotently, requires explicit resolution for conflicting
same-ID records, and preserves equal measurements under different IDs. Those
different identities can represent real laboratory or field replicates; equal
date, station and value do not prove duplicate ingestion.

The retained `lab_source` contains source_link_id, csv_sha256, record, source
line range, mapping_sha256, operation_id, original_headers, original_row and
selected_columns. Keep these with observation/activity/visit/site IDs and
revision-specific JSON pointers. Do not append the imported agency mirror of
the same plan to its own original observations.

## Result support and censoring

A finite numeric result remains its original point value with its qualifier.
Estimated numeric results are distinct from nondetections. In particular,
the actual WQP phrase **Present Above Quantification Limit** with a numeric
result means successful quantification, not right censoring.

For a censored result, retain its original text, direction, limit type, value,
unit and endpoint inclusion:

* An explicit literal `<x`, `<=x`, `≤x`, `>x`, `>=x`, or `≥x`
  supplies its stated bound in the original measurement unit.
* A source-specific reporting-condition and original reporting-limit field can
  supply a bound when their meanings and units match. Preserve the original
  limit type; do not rename a reporting limit as a detection or quantitation
  limit.
* If the text explicitly names detection or quantitation, use that corresponding
  original limit. Generic censor text with different candidate limits remains
  unresolved unless a source-specific mapping identifies the applicable one.
  A raw `U` code has no universal interpretation.
* Different detection and quantitation values are not contradictory when an
  explicit literal or source-specific limit type identifies the applicable
  endpoint. Retain all original values.
* Contradictory typed numeric/censor semantics, incompatible units, missing
  direction, nonfinite bounds, or impossible intervals remain visible with
  reasons rather than acquiring a fabricated point value.

A below-limit result `<L` plus an explicitly selected physical floor `F`
supports `[F,L)`; `<=L` supports `[F,L]`. Without a floor its lower
endpoint is unbounded. An above-limit result has an unbounded upper endpoint
unless an original bound exists. The physical floor must be expressed in the
selected group's exact unit. One scalar floor cannot silently apply across
different units. Never default every parameter to zero: temperature and other
valid negative measurements require their own physical interpretation.

The resulting interval is a range supported by the original reported limit and
chosen physical domain. It does not assign a distribution below that limit.
There is no substitution of zero, half the limit, the limit, or a new common
reporting threshold. Unbounded and unresolved endpoints use explicit nulls and
reason fields in JSON, not Infinity or NaN.

The existing `measurement_workspace/observation_support.py` supplies the
established quantified/below-limit interpretation for original study rows.
Its series means are result-row weighted. Outcome comparisons add their own
explicit sampled-date weighting; they must not silently reuse those means as
date-balanced results.

## Sampled-date and period summaries

For one selected site and one exact measurement group, average the eligible
original result intervals recorded on each selected calendar date. Preserve
all original row, activity and sample identities and show replicate counts.
This is a sampled-date arithmetic summary, not a measured 24-hour average.

The before and after period summaries give each supported sampled date equal
weight. Thus a day with more laboratory result rows does not receive more
period weight. Explicitly report all selected rows and dates, QA exclusions,
undated records, text/missing results, unresolved censoring and dates omitted
from finite summaries.

A date containing unresolved selected measurements does not have a complete
finite all-measurement interval. A supported-subset result can still be useful,
but identify that subset and its missing support. Do not label a subset mean as
the mean of all selected measurements. Retain quantified-only summaries
separately when helpful.

Return per-impact-site results. A pooled multi-site outcome needs its own
explicit site weighting; it is not implied by selecting several impact sites.

For intervals A and B, all weights below are positive:

* Weighted mean lower = sum(weight × lower) / sum(weight).
* Weighted mean upper = sum(weight × upper) / sum(weight).
* A mean endpoint is attainable only when all contributing endpoints are
  attainable.
* A − B = [A.lower − B.upper, A.upper − B.lower].
* The subtraction lower endpoint uses A.lower and B.upper inclusion; its upper
  endpoint uses A.upper and B.lower inclusion.

Apply these identities to after minus before. A strictly negative upper bound,
or an open upper endpoint equal to zero, supports a lower selected-period mean
throughout the retained range. The corresponding positive lower bound supports
a higher mean. A closed singleton zero is unchanged; bounds containing both
directions leave the direction unresolved. These are censoring/support bounds,
not confidence intervals.

Absolute change in the original unit is the primary comparison. A percentage
requires an explicitly appropriate ratio-scale quantity and a strictly positive
before lower bound. Do not compute a percentage for pH, Celsius, a zero-admitting
reference interval, or a control-difference denominator.

## Same-date controls and calendar balance

For each impact site, group and date, form the impact sampled-date mean minus
the equal-weight mean of **all selected control sites** on that same date.
The control membership stays fixed. Missing or unresolved control support makes
that date unavailable for the complete paired comparison; retain the missing
control IDs and original records.

Before/after changes in these paired differences are descriptive
difference-in-differences. Preserve actual within-date collection times and
offsets: samples sharing a date need not have been collected simultaneously.
Do not shift dates, interpolate a control, or use a nearby date by default.

Report a second, common-calendar-month-balanced comparison when supported.
For a direct site comparison, take the intersection of calendar months with
supported dates in both periods, calculate each month's period means, then
give each common month equal weight. For a control comparison, derive this
intersection from its own complete paired dates. Retain per-month counts,
actual dates and omitted months. Empty common-month support produces an
explicit unavailable balanced result, while ordinary selected-period summaries
remain available.

Month balance does not remove differences in discharge, storm timing, long-term
trend or other time-varying conditions. Matching within a partial single-year
campaign can have only one or no common months. Do not describe that result as
a fully seasonal or flow-normalized intervention estimate.

## Retained outputs

The existing operation should retain its normalized selection, original plan,
result JSON, original-record decisions CSV, sampled-date summaries CSV, period
and common-month comparisons, paired-date membership, and ordinary report
files through the current Implementation report bank and OBSERVED_CONTEXT
handoff. Report blocks use the existing scientific table/paragraph conventions.

Useful support fields are original/selected/QA-excluded/undated/unresolved row
counts; numeric and censored counts; unique sample/activity/date counts; actual
date ranges and date lists; limit types and values; source row references;
before/after and paired-date counts; fixed selected controls and missing-control
dates; common/omitted months; complete-support flags; and separate subset
summaries. The headline should state which of these measurements it describes.

## Actual maintained receiving case

The original Eighteenmile CSV at
`observations/eighteenmile_2023/wqp_20261013/three-lake-results-2023-original.csv`
has SHA256
`5b22e3de1a4311963b2ed616886273788bd485897f276663157a7137ce0aaa61`,
47,412 bytes and 88 original rows.

The maintained `receive_wqp_field_results.py` imports these into the applied
revision of `eighteenmile-2023-original-lake-samples`. The source plan is an
empty-observation seed. Select the actual applied revision, not that seed.

The source has:

* 45 numeric chlorophyll records, method 445.0 / USEPA, Total, ug/L, depth
  0.3 m: 15 original dates at each of SV-838, SV-839 and SV-840.
* 41 microcystins/nodularin records using method 520019 / ABRAXIS LLC:
  37 numeric and four censored.
* Two additional censored microcystins/nodularin records on April 5 using method
  520011 / ABRAXIS LLC. These remain a separate group.
* All six censored rows state Below Reporting Limit. Two original limits are
  0.1 ug/L and four are 0.016 ug/L, with original type Lower Reporting Limit.

The case mapping deliberately leaves normalized detection_limit and
quantitation_limit empty. Their original reporting bounds remain in
`observation.lab_source.original_row` under
`DetectionQuantitationLimitTypeName`,
`DetectionQuantitationLimitMeasure/MeasureValue`, and
`DetectionQuantitationLimitMeasure/MeasureUnitCode`.

Original microcystin dates include August 24 where applicable; they do not become
September 5 to match chlorophyll samples. The case has no supplied intervention
or causal control assignment. Its selected site/period comparisons must retain
that distinction.

## Operating the maintained workflow

In the native Implementation workbench, open the saved plan's **Outcomes** tab,
load its saved-revision observations, select original groups/sites and explicit
periods, and build the retained evaluation. Saved evaluations reopen their
original selection and revision. The controller preserves a pending operation
identity across retry, and its result reads remain bound to the selected
workspace, plan and request.

The same maintained module supports native command-line receiving from the
application root:

```sh
python -B -m model.implementation_outcomes --workspace "$SCIENTIFIC_WORKSPACE" --plan-id "$PLAN_ID" --revision "$APPLIED_REVISION" --catalog
python -B -m model.implementation_outcomes --workspace "$SCIENTIFIC_WORKSPACE" --plan-id "$PLAN_ID" --selection outcome-selection.json
python -B -m model.implementation_outcomes --workspace "$SCIENTIFIC_WORKSPACE" --plan-id "$PLAN_ID" --get "$OUTCOME_ID"
python -B -m model.implementation_outcomes --workspace "$SCIENTIFIC_WORKSPACE" --plan-id "$PLAN_ID" --list
```

These environment values identify the already received Workspace and its
actual laboratory applied revision. Use the catalogue's plan binding and
group IDs in the selection file; group IDs include original measurement
support, so never fabricate them from a display label.

The existing Implementation report bank retains the original 17 core members: the original
`plan.json`, `summary.json`, seven original plan CSVs, and `manifest.json`;
the original plan report as `implementation-plan.html`; and the new
`report.html`, `outcomes.json`, `outcome_rows.csv`,
`period_summary.csv`, `sampled_dates.csv`, and `matched_controls.csv`.

Newly built editions also retain `outcome-figures.json` and one original SVG
for every evaluated site and measurement group. The complete figure specification
contains each unchanged full-support interval, date/result support, original
measurement support and source selection. It drives the retained SVG and the
existing scientific-report vector renderer. The saved HTML embeds those same
SVG bodies so the readable outcome remains self-contained.

Each figure shows before/after site means, same-date site-minus-reference means
when selected, and direct, paired and common-month balanced changes. A filled
endpoint belongs to the bound; a hollow endpoint is open. An unbounded side
continues to the displayed axis edge with an explicit label. Unavailable full
support has no value marker. Month-balanced rows remain unavailable when the
two periods share no calendar month. These marks describe reporting-limit
bounds, not confidence intervals, and never join different sites or periods.
The full numeric values and original support remain in the adjacent tables.

Already saved editions keep their original bytes and identities. Receiving
accepts their original 17-member format; figure-bearing editions additionally
verify the complete specification and every listed SVG before registration.
The normal observed-source collector carries that exact specification and all
original figure files into the scientific and client report. Native PDFs use
the existing vector renderer, and HTML/Markdown keep the original SVG files.
The manifest and saved edition bind the original revision and file bytes.
The ordinary Workspace archive carries this report bank.

### Original-data receiving comparison

The following is an explicitly chosen **descriptive calendar-period comparison**
for the existing 88-result receiving case. Its reference-site designation is an
analyst comparison choice. Keep event context empty.

* Before: 2023-04-01 through 2023-06-30.
* After: 2023-07-01 through 2023-10-31.
* Impact/study site: `21SC60WQ_WQX-SV-838`.
* Reference/control site: `21SC60WQ_WQX-SV-840`.
* Select the actual catalogue groups for methods 445.0 and 520019, preserving
  their parameter, fraction, unit and original support. Method 520011 can be
  selected separately to inspect its before-only support.
* Select original QA label `Final`, all calendar months, UTC, physical floor
  0 in the original ug/L units, and no intervention event.

Independent arithmetic on the retained original CSV supplies the following
receiving reference. These values are descriptive results of these explicitly
chosen periods.

| Measurement and comparison | Before support | After support | After minus before (ug/L) |
| --- | ---: | ---: | ---: |
| Chlorophyll, SV-838 | 7 dates; mean 24.4728571428571 | 8 dates; mean 23.76875 | -0.7041071428571 |
| Chlorophyll, SV-840 | 7 dates; mean 6.26 | 8 dates; mean 5.895 | -0.365 |
| Chlorophyll, SV-838 minus SV-840 | 7 exact-date pairs | 8 exact-date pairs | -0.3391071428571 |
| Microcystins/nodularin 520019, SV-838 | 6 dates; mean 0.04175 | 7 dates; mean [0.041, 0.0432857142857) | [-0.00075, 0.0015357142857) |
| Microcystins/nodularin 520019, SV-838 minus SV-840 | 6 exact-date pairs | 6 exact-date pairs | [-0.02975, -0.0244166666667) |

The two selected sites/groups contribute 57 original results: 54 numeric and
three censored. They represent 57 site–group–date summaries, 31 distinct
site–date combinations, and 27 group-specific paired dates. The latter comprise
15 chlorophyll and 12 microcystin pairs, spanning 15 distinct calendar dates.
Do not report 57 or 27 as a count of independent sampling dates.

Microcystin pairing excludes the reference's April 5 record because the study
site uses a different analytical method that day; the reference's August 24
record has no same-date study-site record; and the study site's October 17
record has no same-date reference record. All originals remain retained.
Method 520011 contains only April 5 results and has no after-period comparison.

The selected periods have no common calendar months, so their month-balanced
result is unavailable. This is the expected consequence of the chosen calendar
support, while their direct and paired period summaries remain useful.

For the complete original case, the catalogue has 88 dated results, 88 unique
sample/activity IDs, 48 visits, 16 calendar dates and 47 distinct site–date
combinations. All original QA labels are Final; all timestamps retain EST
(UTC−05:00), and UTC conversion changes no sample date. Each site–method–date
contains one result. The applied revision therefore provides a concrete
receiving path for source identity, method separation, original reporting-limit
bounds, complete-date controls and saved-result reopening.

## Primary method references

* U.S. EPA (2002), *Methods for Evaluating Wetland Condition: Study Design for
  Monitoring Wetlands*, EPA-822-R-02-015, especially printed pages 11–12.
  The before/after control/impact discussion supports repeated paired temporal
  comparisons, comparable controls, attention to temporal dependence and
  limited generalization from unreplicated treatment sites.
  https://www.epa.gov/sites/production/files/documents/wetlands_4studydesign.pdf
* U.S. Geological Survey, Open-File Report 99-193, *Considerations for Data
  Interpretation*. Quantified, estimated and censored values have different
  meanings; reporting limits can change. Simple censored-value substitution can
  bias summaries, and recensoring to one highest limit can discard information.
  https://water.usgs.gov/owq/OFR_99-193/data.html
* Oelsner and others (2017), USGS Scientific Investigations Report 2017-5006,
  *Water-quality trends in the Nation's rivers and streams, 1972–2012—Data
  preparation, statistical methods, and trend results*. Its treatment of time,
  discharge and season explains why a selected-period comparison should retain
  hydrologic and sampling context rather than claim flow-normalized change.
  https://www.usgs.gov/publications/water-quality-trends-nations-rivers-and-streams-1972-2012-data-preparation-statistical

This implementation uses deterministic interval arithmetic and explicit
sampling weights. It does not add a distributional censored-data model,
hypothesis test, confidence interval or causal estimator.
