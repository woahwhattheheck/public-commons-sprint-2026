# Scientific interpretation

Use **Scientific interpretation** to examine how completed model runs respond to land-cover scenarios and parameter choices. The analysis connects every result to the original native run identifiers. It helps distinguish scenario effects, parameter sensitivity, observation fit, and changes in priority order.

The workflow is: select an existing run cohort, choose its baseline and reference profile, attach relevant retained data, analyze, inspect the comparisons, and export or save the analysis.

## 1. Select the comparison cohort

Open **Scientific interpretation**, choose **Select cohort**, and select the retained grid or run cohort. When an experiment programme already contains the cases, choose **Use programme cases** to preserve its complete planned matrix. Select the **baseline scenario** representing the comparison condition, then select the **reference parameter profile**. A profile is one specific set of model parameters; a scenario describes the land cover or intervention being evaluated.

Use **Find native runs**, **Native run state**, and **Native model selection** to narrow a large cohort. NDR supplies nutrient outputs; SDR supplies sediment outputs. The table shows 200 runs per page and keeps selections across pages and filters. **Select all matching** applies to the complete filtered set. The selected-run count covers the whole cohort; **Analyze** includes selected runs on the study grid even when the current filter hides them.

Choose one native run for each parameter profile and land-cover case. A workspace can retain nutrient-only, sediment-only, and combined runs for the same case. The **Models** column identifies each variant. Use **Cohort selection → Conflicting selections** to resolve duplicated choices; submission also opens that view if needed. Original native runs remain available for another analysis.

Check the displayed native run IDs and parameter values. The baseline must exist under each profile used to calculate a matched scenario effect. Reference-profile results provide a second comparison for interpreting parameter changes.

Keep runs comparable in producing model version, pollutant, raster grid, input domain, and reporting boundaries. Scientific interpretation reads each completed model stage's recorded InVEST version first, then the original observed-run fallback, and finally a labeled requested-version fallback for older records. The **Native producing versions** column states that basis. A requested version is not presented as evidence that the engine actually executed.

The immutable original run selection and ID remain unchanged when a completed run is adopted into a newer experiment. Each pollutant's comparison checks its producing model across every complete applicable run: NDR for nitrogen/phosphorus and SDR for sediment. Different NDR versions leave the nutrient cohort unavailable without suppressing a compatible sediment cohort. Missing selected artifacts, unresolved versions, or unfinished expected cases remain visible. Explicitly inactive models remain **Model not selected**. No mismatched run is quietly removed to make a comparison succeed.

Older saved reports keep their original identities and native bindings. New reports retain each run's exact original selection, so **Prepare Decision study** can use an adopted run without reconstructing its requested version. Analysis source stamps include the original version-policy and model-selection modules; reanalysis under changed scientific code creates a new diagnostic snapshot.

Review the coordinate system, cell size, and spatial extent before interpreting differences. The upstream modeling domain and the South Carolina reporting area serve different purposes: upstream land supplies the hydrologic context, while reporting boundaries define where results are summarized.

Use a distinct cohort for a different experiment design or structural model choice. One-at-a-time profiles and factorial profiles cover parameter space differently; combining their rows would change the meaning of a design frequency.

## 2. Attach retained observations and catchments

Select existing observations and catchment definitions when they match the question. Retain station and observation identifiers, pollutant, measurement period, units, catchment, and calibration or evaluation role. A concentration measurement requires a documented conversion to a compatible load before comparison with annual export.

Freeze the observation cohort for each pollutant. Every baseline profile selected for that pollutant is assessed against the same expected observations. Profiles explicitly configured without the corresponding model appear under **Model not selected**; unresolved or missing baselines remain expected. Missing comparisons keep their observation IDs visible, including observations omitted from every profile.

Compare present-condition observations with the corresponding baseline runs. Hypothetical land-cover scenarios use those baseline diagnostics as context. Repeating one long-term mean modeled value against several observed years does not add independent temporal model predictions.

Catchment boundaries also remain fixed. Inspect a receiving catchment when evaluating a restoration intervention: changed retention can alter exports from contributing land beyond the intervention footprint. Keep overlapping or nested catchment totals separate when constructing regional summaries.

## 3. Analyze and inspect completeness

Choose **Analyze**. Review the source summary before the result tables: selected native runs, scenarios, profiles, baseline, reference profile, reporting units, and attached observation cohort.

Start with **Missing or unfinished runs** and **Common spatial support**. Expected and completed counts describe which comparisons the selected design actually supports. A missing baseline prevents its paired scenario comparison. A missing scenario or profile remains identifiable throughout the summary.

Read the selected models beside run completion. A completed NDR-only run can support nutrient diagnostics while sediment appears under **Model not selected**. A missing output from a selected model remains incomplete.

Observation fit uses its own baseline-only producing-version cohort. An incompatible hypothetical scenario does not invalidate otherwise compatible baseline observation comparisons. If applicable baseline producing versions differ, raw per-profile modeled/observed rows and the frozen expected observation IDs remain available, while shared-cohort and full-cohort scores are withheld with the version reason.

Common support is the shared set of valid cells used for the stated comparison. Read its area and coverage beside every spatial result. A run's full native total and its total restricted to common support answer different questions; keep their labels distinct.

If the common support contains no valid cells, totals, effects, and ranks are unavailable for that comparison. A zero-area overlap is different from a valid modeled export of zero.

If a cohort changes, analyze again so the support, membership, and summaries correspond to the new selection.

## 4. Read matched effects

Let `Y(s, p)` be an output for scenario `s` and profile `p`, calculated for the same pollutant, reporting unit, and spatial support. Let `b` be the baseline and `p0` the reference profile.

| Diagnostic | Calculation | Interpretation |
| --- | --- | --- |
| Baseline parameter effect | `Y(b, p) − Y(b, p0)` | Change caused by the parameter profile under baseline land cover |
| Matched scenario effect | `Y(s, p) − Y(b, p)` | Scenario change while holding the profile constant |
| Scenario–parameter interaction | `[Y(s, p) − Y(b, p)] − [Y(s, p0) − Y(b, p0)]` | How the scenario effect changes relative to the reference profile |
| Export reduction | `Y(b, p) − Y(s, p)` | Positive values indicate lower modeled export under the scenario |

The canonical scenario delta is **alternative minus baseline**. For export, a negative canonical delta is a positive reduction. Use the field's stated orientation when reading rankings or comparing exported tables.

A percentage change uses the matched baseline as its denominator. A zero baseline produces an undefined percentage, while the absolute difference remains available. Interpret values near zero using a declared tolerance in the output's units.

NDR nitrogen and phosphorus export rasters use `kg/ha/year`; their spatially integrated masses use `kg/year`. SDR export rasters use metric `t/ha/year`; integrated masses use `t/year`. Integration requires cell area in hectares. The workspace's delivered export artifacts already contain annual mass per pixel. These diagnostics sum those normalized values once; cell area has already been applied by the native adapter. Keep nitrogen, phosphorus, sediment, mass, and area-normalized rates in separate comparisons. [NDR 3.20.0](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) · [SDR 3.20.0](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html)

## 5. Interpret spatial support and spread

NoData identifies unavailable model values. Zero identifies a valid modeled value. Replacing NoData with zero can create apparent improvements, so inspect the missing-cell and coverage information alongside effects.

Use one declared common support for comparisons that will be ranked or summarized together. Pair-specific valid areas may be useful diagnostics, but totals from different areas are unsuitable for direct priority ranking.

Minimum, median, maximum, and any reported quantiles describe the **evaluated parameter design**. A narrow spread means the chosen profiles produced similar values on the stated support. It says little about untested parameter ranges, alternative input datasets, or processes outside the model.

These summaries are design ranges, rather than statistical confidence intervals. Their interpretation follows the recorded parameter values and source assumptions. The [freshwater calibration guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html) explains how local sensitivity analysis can inform subsequent joint parameter exploration.

## 6. Inspect priority ranks

Read the pollutant, reporting unit, and ranking direction beside the rank table. The current ranking places lower paired export deltas first, equivalent to larger positive reductions. For development or impact screening, inspect positive export increases in the matched-effect tables and use their stated units.

Read the rank range across profiles together with the effect range and completeness counts. Stable ranks indicate consistency within the evaluated design and fixed candidate set. A priority that changes direction or moves widely across ranks deserves closer examination of the responsible profiles.

Ties receive average ranks. At a top-`k` boundary, tied candidates share the remaining places fractionally. For example, with one candidate strictly ahead and three tied candidates competing for the remaining place in a top-two set, each tied candidate receives one-third membership.

A candidate's **top-k design fraction** averages that membership across the distinct profiles included in the comparison. It is a frequency within the evaluated design, rather than the probability that the candidate is truly best. Inspect the candidate universe and missing-member counts; a smaller candidate set can make a rank look stronger without improving the modeled benefit.

## 7. Read observation fit

Inspect the individual matched observations before the aggregate scores. The residual convention is **modeled minus observed**, so positive mean bias and positive signed percent bias indicate overprediction.

MAE describes typical absolute discrepancy. RMSE places greater weight on large discrepancies. Signed percent bias divides summed residuals by summed observations and is undefined when that denominator is zero. NSE compares squared errors with observed variation and is undefined when observations have no variation. These conditions should appear as missing metrics with reasons, rather than substituted perfect scores.

Read expected and shared observation counts, applicable and missing profiles, station coverage, units, period, and observation role beside the metrics. **Full expected cohort** requires every expected observation and every baseline profile selected for that pollutant. **Shared observations** uses the same available pairs across compared profiles and names omitted members. Scores summarize agreement under that definition; scientific assessment also considers spatial patterns, source data, and process suitability.

NDR represents long-term nutrient delivery to streams, and SDR represents hillslope sediment delivery. Receiving-water processes and additional pollutant sources affect the relationship between those outputs and monitoring observations. Apply the model-specific guidance when interpreting discrepancies. [NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) · [SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html)

## 8. Export, save, and reopen

Use **Export** to download the complete analysis archive or individual source-stamped CSV tables, JSON analysis, and HTML report. Keep native run IDs, cohort and profile identifiers, baseline and reference selections, units, support information, observation membership, and missing-member counts with the numerical results. These fields make a result traceable when another operator reads it separately from this screen.

Use the operator's existing **Create complete backup** action to preserve the retained workspace and analysis state. Reopen it through **Restore an archive**, confirm the selected sources and reference choices, and inspect the retained diagnostic summary. Reanalyze after changing runs, parameters, boundaries, observations, or cohort membership so the exported interpretation follows the current inputs.

## Investigate a saved analysis

When Scientific investigations is connected, **Investigate this analysis** opens its composer with the complete saved report selected. The linked dataset contains the actual native run identities, units, scenario effects, parameter comparisons, ranks, and observation membership. Ask a question about those results in the investigation interface; the saved diagnostic remains the numerical source.

The integration passes the current registered workspace and exact diagnostic dataset identity. A transferred workspace resolves the report through its restored location. Saved reports remain readable through **Runs and files** and **Export**.

## Include this analysis in a scientific or client report

Choose **Use in scientific report** on a saved analysis. A new standalone
scientific report opens the original Sources composer after the report source
is prepared. It supports the selected NDR, SDR or combined-model results and
keeps the current source order, title and contact editable. Preview and prepare
a saved PDF, HTML, Markdown and data edition there.

You can also choose an existing mapped delivery whose native runs and ordered
sources should continue. The same completed task offers **Open scientific
report** and **Open mapped report form**. Both use the exact retained report SHA
and original source companions; reopening the task does not prepare a new source.

See [DIAGNOSTIC_REPORTS.md](DIAGNOSTIC_REPORTS.md) for the complete operator,
command-line, revision-recovery and receiving workflow. Incomplete diagnostic
cohorts remain explicitly incomplete in their report sections.
