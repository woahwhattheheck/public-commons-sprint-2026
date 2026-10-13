# Conservation decisions: mixed criteria and retained native cases

This guide covers the decision-analysis extension in the existing Conservation workflow. It helps a scientist compare original land units under explicit objectives and resource limits, inspect why priorities change, save the chosen portfolio and reopen its original sources and geometries.

The calculation uses a completed conservation study. Changing decision weights or choosing a different already-retained alternative recalculates the decision; it does not launch a new NDR/SDR simulation. New physical scenarios must first be prepared and completed through the original native-run workflow, then bound to the conservation study.

## Start with the scientific decision

Choose the original completed study, its planning units and reporting geography. Retain the study’s exact baseline, alternatives, candidate inventory, source geometries and input edition. Give the decision a useful title and purpose—for example, comparing restoration benefit with source-water coverage for a specified utility and budget.

Choose only criteria that express the question. A modeled annual mass, an observed designation relation, a published practice point total and a recorded source attribute have different meanings. They may enter one explicit preference calculation, but they do not become interchangeable physical quantities.

The ordinary report presents the chosen units and union area first, followed by constraints, criterion values and scales, solver qualification, preference comparisons, native-case comparisons and candidate support. The original analysis JSON and complete candidate CSV remain available separately.

## Criterion sources and meanings

| Kind | Actual value | Scientific interpretation |
|---|---|---|
| Current export | Baseline native export in the original reporting footprint | A baseline export contribution, not an intervention benefit |
| Restoration | Baseline minus selected alternative on common valid native support | Positive means lower modeled export in the selected alternative; negative remains adverse |
| Avoided conversion | Selected disturbance alternative minus baseline on common support | An incremental modeled impact associated with the explicit disturbance case |
| Source context | Reporting/source-water/unprotected area, or the retained high-quality designation relation | Geographic or designation context, not modeled pollutant removal |
| Published method | Complete retained points from the original method/category, with its prerequisites | Practice priority points; unresolved criteria cannot satisfy a positive point weight |
| Source attribute | An unchanged finite numeric value in the original planning-unit attributes | The analyst declares its unit, reference and direction; the application does not infer a connectivity model or convert the field |

Nitrogen and phosphorus retain their original mass units; sediment retains its own original mass units. Published points, hectares and source indices remain separately labeled. A recorded connectivity field is usable only when it actually exists as a finite numeric original attribute. Numeric-looking text, booleans, missing fields and nonfinite values are not silently turned into credited numbers.

The total basis uses the retained quantity as supplied. Per-reporting-hectare divides the retained quantity by the original reporting footprint area. It is not automatically per treated hectare, per common-valid hectare or an extrapolation to missing pixels. Read coverage alongside the quantity. Source-context and source-attribute criteria retain their declared original units and accept only the total/source-value basis.

## Exact score calculation

Let x(i,j,c) be candidate i’s retained value for criterion j in explicit case c. Let d(j) be +1 for maximize and −1 for minimize. The fixed criterion scale is:

```text
s(j) = max |x(i,j,c)|
```

The maximum covers source-qualified original candidates with adequate support in the selected case and every distinct enabled comparison case. It is computed before resource-cost exclusions. The same scale is used for all named preference profiles and all compared cases.

For a supported criterion with a positive scale:

```text
normalized(i,j,c) = d(j) × x(i,j,c) / s(j)
score(i,c) = sum_j weight(j) × normalized(i,j,c)
```

Nonnegative entered weights are normalized to total one. At least one available criterion must have a positive weight. A supported zero-valued axis has zero contribution. An unsupported positive-weight criterion excludes that candidate for the corresponding calculation; it does not give the candidate a favorable zero. A zero-weight unavailable criterion remains visible without excluding the candidate for that criterion.

The score is dimensionless. The optimizer maximizes the sum of selected original-unit scores under the declared resource limits. The upper bound and optimality gap refer to this precise additive problem. They do not establish the best ecological outcome under every plausible scientific model.

A minimize criterion negates its signed normalized value. Because the original optimizer selects positive feasible contributions and has upper resource limits rather than a compulsory minimum selection, an all-negative portfolio can legitimately select no land. A budget is a cap, not an instruction to spend it. A unit-count cap is not a minimum number of units.

Scales depend on the selected candidate universe and explicit case family. Adding a candidate, changing a source filter or adding a case can alter the normalization and defines a new analysis. Compare the recorded scales and inputs when comparing two saved analyses. A consistent positive change of measurement units cancels in x/s; an undocumented transformation of source values does not.

Weights express the analyst’s trade-offs for these scales and definitions. Equal weights are still an explicit preference. Related criteria may reward related aspects of the same underlying process; review this intentionally rather than treating a larger number of similar criteria as more independent evidence.

## Resource limits and original geometry

The budget uses the original full-unit supplied costs and original currency. A USD solver budget requires original USD costs. The maintained solver uses integer cents; it does not infer exchange rates or convert other currencies. Missing costs remain unknown. The report distinguishes the known subtotal from the complete total, which is unavailable if any selected unit lacks a cost.

The area constraint can use whole source-unit area or reporting-footprint area. It is additive across original units and therefore conservative relative to the corresponding geometry union when units overlap. The report shows both summed areas and the actual union, with overlap explicitly retained. The existing adapter guards the solver’s area tolerance so the requested land limit remains the limit.

Candidate objective sums are also additive. Overlapping candidates can count the same mapped support more than once in an optimization objective. Sums of per-hectare values, designation flags or arbitrary indices are not basin mass totals. After saving, the authoritative conservation plan recomputes native quantities on the selected reporting union. The selected land’s modeled treatment response requires the original selected-mask scenario and a completed native run; a scored parcel contribution alone is not that treatment simulation.

## Support, missingness and eligibility

Original study exclusions, explicit include/exclude IDs, geographic relations, protected-area filters and resource eligibility remain operative. Choosing to include originally ineligible units is an explicit analyst selection; it does not erase missing positive-weight scientific support.

Current-export criteria use their own baseline coverage. Restoration and avoided-conversion criteria use the common valid support of baseline and the selected alternative. Each paired case retains its own coverage, valid area, availability reason and parameter-profile flag.

Case comparisons can therefore differ both in modeled quantity and valid support. Inspect those fields before attributing a rank change solely to an intervention or parameter. Unavailable models, unknown context, incomplete published points, missing source attributes and absent costs remain distinguishable.

## Two different comparisons

### Preference comparisons

Named preference profiles change the criterion weights while keeping the selected native case and fixed scales. The application records each profile’s weights, eligible set, selected units and solver result. If profiles are not supplied, enabled preference comparison uses the available single-criterion profiles.

Candidate counts report how many included profiles selected the unit and how many made it eligible, together with its rank range. These are counts across explicit choices, not probabilities or empirical confidence levels. Eligibility may change when a profile gives positive weight to a criterion unavailable for a particular candidate.

### Native case comparisons

Each named case maps one or more paired criteria to another actual alternative already retained by the same conservation study. The original baseline, planning units, resource limits and selected weights remain fixed. Context and source attributes do not acquire a fictitious alternative.

The selected case is retained once. Duplicate alternative mappings are not counted twice. Each case has its own original criterion bindings, objective values, coverage, exclusions, ranking, selected portfolio and solver outcome. The report displays candidate-level details for the additional cases.

These comparisons show sensitivity to the chosen native cases. They are not a sampled probability distribution, calibrated prediction interval or joint probability model. Preference profiles and native cases are reported separately; the application does not imply an uncomputed full weight-by-case factorial analysis.

## Worked arithmetic example

The following is an authored arithmetic example, not a measured site or native scientific result. There are two original candidates, one-unit capacity, three criteria, weights 0.5/0.3/0.2 and fixed scales 10/5/100.

| Candidate | Selected-case values | Second-case values | Selected score | Second score |
|---|---|---|---:|---:|
| A | 10, 1, 100 | 2, 1, 100 | 0.76 | 0.36 |
| B | 6, 5, 20 | 9, 5, 20 | 0.64 | 0.79 |

Only the first criterion varies by native case. A is selected in the first case and B in the second. Each is selected in one of the two included cases. That is a transparent rank reversal under the declared inputs, not a 50% probability of being the better land choice.

If B’s third original attribute is unavailable, a positive weight on that criterion makes B ineligible. It must not be given the score that would result from treating the missing attribute as zero. A separate preference that gives the third criterion zero weight can still consider B under its remaining supported criteria.

## Save, export and reopen

Preview returns a complete analysis with its original study/input identities, normalized request, quantities, support, scales, engine identity, solver outcome and explicit comparisons. Review that complete result before saving.

Save preserves the exact completed preview request and candidate selection. It verifies the original study, candidate and geometry inventories, then uses the existing conservation save-plan operation. It does not re-normalize the completed preview’s floating-point weights into a subtly different selection.

The original saved analysis includes analysis.json, candidates.csv and index.html with file descriptors. Reopening verifies the saved files and analysis digest; it does not silently recompute using new weights or newly installed source. Existing historical report files remain their original editions.

The decision export includes the original conservation packet and complete optimization files under optimization/. The original packet’s index.html remains the first entry; optimization/index.html opens this decision report. Geometries, original data and analysis references remain part of the same selected export.

For technical integration only, the maintained module also supports:

```text
python -m model.conservation_optimization --workspace ORIGINAL_WORKSPACE preview SELECTION.json
python -m model.conservation_optimization --workspace ORIGINAL_WORKSPACE save SELECTION.json
python -m model.conservation_optimization --workspace ORIGINAL_WORKSPACE inspect STUDY_ID ANALYSIS_ID
python -m model.conservation_optimization --workspace ORIGINAL_WORKSPACE export PLAN_ID
```

The normal user workflow stays in the existing operator. JSON is an interchange and source-download format, not a prerequisite for a scientist to use the decision panel.

## Mathematical background

The implementation is an explicit additive preference model with inspectable normalization and sensitivity comparisons. It does not claim that moving a weight slider by itself constitutes a complete stakeholder MCDA process. HM Treasury’s primary guidance describes weights in relation to the performance swings being valued and recommends examining how scoring and weighting assumptions change rankings. The OECD/European Union/JRC handbook treats normalization, weighting, aggregation and sensitivity as choices that should be transparent and evaluated together.

- HM Treasury and Department for Energy Security and Net Zero, 2024, *Use of Multi-Criteria Decision Analysis in options appraisal of economic cases*: https://www.gov.uk/government/publications/green-book-supplementary-guidance-use-of-multi-criteria-decision-analysis/use-of-multi-criteria-decision-analysis-in-options-appraisal-of-economic-cases
- OECD/European Union/European Commission Joint Research Centre, 2008, *Handbook on Constructing Composite Indicators: Methodology and User Guide*: https://doi.org/10.1787/9789264043466-en
- Original code: model/conservation_optimization.py and the maintained model/portfolios.py solver. The saved analysis retains the actual solver module’s byte/hash identity.

## Focused recipient operation

On the original receiving application, open an actual completed study and use its retained sources. Exercise one mixed criterion selection, an explicit native-case comparison and a meaningful weight change. Save the chosen completed preview, download the decision packet, reopen the saved analysis and open its original geometries and report.

The producing worker must render the exact outgoing edition, personally view desktop/screenshare and 390px screens, operate the important controls and open every outgoing report, CSV/JSON and archive/GIS attachment in its normal viewer. Check populated, empty and missing-support states, report downloads and reopening. Correct the actual affected result before presenting it. Source review or captured-but-unviewed screenshots do not replace this normal use.

Use the post-call owner orders in F0C8R2SQ0NP and the current original work thread. Preserve completed native cases and active producer ownership. A report comparing existing cases must be described as a comparison; a new Run action must execute the selected changed inputs through the maintained queue.
