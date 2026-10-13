# Source-error sensitivity of the retained calibration

This module analyzes how the original completed calibration ranking changes inside declared bands around the original published annual-load estimates. It uses the saved native predictions, source observation edition, spatial split, temporal weights, external-load adjustments, pollutant weights and normalization scales. Results retain the original selected run and profile.

The output answers three concrete questions:

1. Does the selected candidate have a strictly smaller objective throughout the chosen source-error region?
2. Which completed challengers can tie or outperform it somewhere in that region, and which original source rows contribute to the change?
3. At what multiple of the published standard errors does each challenger first tie the selected candidate, accounting for the nonnegative-load boundary?

This is a deterministic supplement to an existing result. Its work is proportional to the saved candidate/reference table plus sorting source clipping points. It starts no model run, makes no source-estimator fit, and needs no GIS imports at module import time.

## Use the completed original result

From the application directory containing `model/`:

```sh
python -m model.calibration_uncertainty /path/to/original/workspace analyze EXISTING_CALIBRATION_ID --standard-errors 1
python -m model.calibration_uncertainty /path/to/original/workspace inspect RETURNED_UNCERTAINTY_ID
```

Use the actual content-addressed ID returned by the completed calibration desk. The command validates the workspace, original report, plan, observation edition and retained CSV. It then verifies that the saved candidate predictions reproduce the original objective before saving its own record.

Python API:

```python
from model.calibration_uncertainty import analyze, inspect

result = analyze(workspace, actual_calibration_id, standard_errors=1.0)
retained = inspect(workspace, result["id"])
```

The multiplier must be a finite nonnegative number. Zero gives the original point comparison; the output still reports rows lacking a published standard error. There is no arbitrary upper limit. Arithmetic that would leave the finite numerical range raises a clear error instead of creating invalid JSON or an infinite endpoint.

The application stores the result under `calibration-uncertainties/<id>.json` using the original Workspace immutable item API. Repeating the same supported analysis produces the same content-addressed result; no timestamps or random seed change that identity. The operator extension provides queue execution, linked result views and exports.

## The exact retained objective

The original calibration ranks candidates by normalized **mean squared error**. Its displayed RMSE and physical bias statistics are descriptive metrics, not the ranking objective.

Let:

- (p) identify a positive-weight pollutant.
- (w_p) be its retained objective weight and (W) the sum of those weights.
- (G_p) be the number of calibration spatial groups containing that pollutant.
- (n_{g,p}) be the number of catchment/pollutant units in a group.
- (s_p) be the retained normalization scale.
- (m_{r,i}) be the original native prediction for candidate (r) and unit (i), including the saved delivered external load.
- (y_i) be the time-weighted original annual reference for that unit.

The coefficient of each squared residual is

```text
c_i = w_p / W / G_p / n_(g,p) / s_p²
L_r(y) = sum_i c_i (m_(r,i) - y_i)²
```

Only units assigned to the original calibration groups enter this sum. The module reconstructs these coefficients and reproduces every eligible candidate's stored objective. The original scale stays fixed as source observations are perturbed. Recomputing a scale from each changed observation set would define a different objective and is outside this analysis.

All input candidate predictions must have the same complete original calibration support. Failed or ineligible native candidates retain their original report history but are not introduced into sensitivity comparisons.

## One common perturbation of original source records

A unit may combine several disjoint original annual-rate periods. For source record (j) in unit (i), the existing plan supplies period weight (t_{ij}) and aggregation weight (T_i):

```text
y_i = sum_j (t_ij / T_i) x_j
```

The module reopens the original observation rows by ID, verifies period/catchment/parameter identity and the retained uncertainty detail, and reproduces the saved mean. It uses the actual stored whole-year or elapsed-day weights. Multiple source periods do not add spatial calibration groups.

For each original source estimate (x_j) with published standard error (e_j), and selected multiplier (k), the declared marginal interval is:

```text
lower_j(k) = max(0, x_j - k e_j)
upper_j(k) = x_j + k e_j
```

A unit's interval follows from the same positive temporal weights. It is **not** presented as a newly estimated standard error of that mean. In particular, the analysis never uses a square-root-of-summed-variances formula or assumes that different years, pollutants, nested catchments or estimators are independent.

The source variable is the original observation record ID. If a record contributes to more than one unit, its coefficients are summed before evaluating bounds. Every candidate sees the same changed value of that source record. Distinct source IDs define a joint marginal box. Dependence between distinct estimates can make some combinations in this box unattainable; a strict preference throughout the whole box is therefore conservative with respect to those dependencies. A possible reversal means a reversal within the declared box, not an assigned probability or a claim about a particular unrecorded dependence model.

This analysis does not join differently named records by guessing from station names, coordinates or free-form provenance. The original observation edition and spatial grouping remain visible for source review.

## Original uncertainty semantics and units

The supported uncertainty detail is explicit:

```json
{
  "kind": "published standard error",
  "value": 1200.0,
  "unit": "kg/year",
  "original_field": "serload_a_00600"
}
```

The numbers above illustrate the field schema only. The analysis obtains values from the retained source rows and does not construct observation data from this example.

A missing value, unsupported uncertainty kind, absent source field, negative/nonfinite value, or unrecognized mass-rate unit remains visible as an uncovered source row. A standard deviation, confidence interval, percent error or opaque string is not silently reinterpreted as a standard error. The complete original uncertainty and source-record details are retained in the result.

Supported mass-rate conversions match the original observation workflow: kilograms, grams and metric tonnes per year. Nitrogen and phosphorus comparisons use kg/year; sediment comparisons use metric tonnes/year. The module converts the published standard error using its own explicit unit. This is necessary for the actual F7DN436B source: a retained sediment annual mass is already in tonnes/year while its published standard error remains in kg/year.

For the original USGS 2012-reference release:

- Beale's selected load `rload_a_CODE` pairs with `serload_a_CODE`.
- Fluxmaster's selected load `LOAD_A_CODE` pairs with `SLOAD_A_CODE`.
- All four fields are in kg/year.
- SSC `80154` and TSS `00530` preserve their original constituent identities and selected source series.
- Source standard errors belong to the selected published estimator and its original long-term reference period. They are not native model uncertainty or measurement-only uncertainty.

Original release: https://doi.org/10.5066/F7DN436B  
Original report: https://doi.org/10.3133/sir20195069  
Original metadata: https://www.sciencebase.gov/catalog/item/583f2f21e4b04fc80e3bd227

The source importer retains the exact publisher dictionary, final-method selection, load/SE field names, source period and original tokens.

## Exact pairwise bounds

Let (A) be the originally selected candidate and (B) a retained eligible challenger. The reported gap is:

```text
D_B(y) = L_B(y) - L_A(y)
```

A positive gap favors the original selection. Expanding the difference cancels the observation-squared term:

```text
D_B(y) = sum_i c_i (m_(B,i) - m_(A,i))
                         (m_(B,i) + m_(A,i) - 2 y_i)
```

For numerical evaluation the module uses a centered form:

```text
D_B(y0) = sum_i c_i (m_B - m_A) ((m_B - y0) + (m_A - y0))
q_i = -2 c_i (m_B - m_A)
Q_j = sum_i q_i t_ij / T_i
D_B(x) = D_B(x0) + sum_j Q_j (x_j - x0_j)
```

The sums use `math.fsum`. This avoids subtracting two separately accumulated large squared-loss totals.

Because the gap is affine in the common source values, the exact box extrema occur at endpoints. For the minimum, use the lower endpoint when (Q_j>0) and the upper endpoint when (Q_j<0). Reverse those choices for the maximum. A zero coefficient is invariant to that source value.

The result includes per-source coefficients, contributions to each gap extreme, and endpoint labels. These are sensitivity coordinates and contribution accounting, not replacement observations. The module does not export a constructed endpoint vector as an observation dataset.

A source with missing SE prevents a complete finite bound only when its combined coefficient is nonzero. Exact cancellation can make a pair insensitive to an uncovered record. At (k=0), the interval is the original point regardless of missing SE; published-SE coverage remains separately visible.

### Numerical tolerance

The reported tolerance is (10^{-10}) times the maximum of one and the relevant retained objective magnitudes. It is used for nominal reproduction and near-zero classification. Endpoint values and the original score gap remain visible for interpretation.

- `selected_strictly_preferred`: the minimum challenger gap is greater than tolerance.
- `rank_reversal_possible`: the minimum gap is less than negative tolerance.
- `tie_possible`: the band reaches the numerical tie region.
- `nominal_tie`: the zero-multiplier point is in the tie region.
- `equivalent_predictions`: all original calibration predictions are identical for this pair.
- `incomplete_uncertainty`: a contributing original source lacks supported SE.

The existing calibration's deterministic tie-breaking and selected ID remain unchanged. A near-zero gap does not rerank candidates.

A global `strictly_stable` result requires strict preference over every eligible challenger in the comparison cohort. Runs from the same profile but different native model selections are labeled through `same_profile_as_selected` and `selected_models`; distinct profile counts remain explicit. One available candidate produces `single_candidate`, not an unsupported dominance claim.

## First tie in published standard-error units

For each challenger the module also finds the first (kge0) at which its minimum gap reaches zero, under the same declared box and fixed objective.

For a positive source coefficient, the minimum-gap displacement is (-min(k e_j,x_j)). Its contribution becomes constant once (k=x_j/e_j), because source loads cannot fall below zero. For a negative coefficient, the minimizing displacement is (+k e_j), which has no nonnegative-load upper cap. The lower gap is therefore continuous, nonincreasing and piecewise linear.

The implementation sorts the finite positive-coefficient clipping points, computes the slope from the active source coefficients, and solves for zero in the containing segment. It recomputes active slopes with `math.fsum` after each event rather than subtracting a nearly equal saturated slope. Source SE zero contributes no slope.

`first_tie_standard_errors` contains the finite multiplier when available. `first_tie_state` gives:

| State | Meaning |
| --- | --- |
| `available` | A finite multiplier reaches the mathematical zero gap. |
| `nominal_tie` | The retained centered nominal gap is already zero or slightly negative within its verified numerical tolerance. |
| `never_within_nonnegative_source_box` | Clipping exhausts all relevant movement before the challenger can tie. |
| `incomplete_uncertainty` | A nonzero source coefficient has no supported published SE. |
| `beyond_finite_multiplier` | The mathematical crossing exceeds the finite numerical representation. |

The first-tie value solves the mathematical zero of the computed centered gap, while displayed preference states use the reported numerical tolerance. These are explicitly different near a numerical tie. Null values always have a reason; the JSON contains no infinity or NaN.

## Validation and coverage

Original validation groups remain held out. The supplement shows original source bands and residual ranges for the already selected candidate on validation units. It does not compare or select challengers on validation outcomes.

A saved result can have `state: partial_uncertainty` and still provide complete pairwise information for some or all candidates. The state describes published source-error coverage, including validation rows. Pairwise completeness follows actual nonzero source coefficients. The coverage table distinguishes:

- Original source rows and rows with recognized published SE.
- Calibration and validation unit counts.
- Units whose contributing source rows all have published SE.
- Missing record IDs.
- Source records used in each original partition.

A missing SE is not assigned zero. A published SE explicitly equal to zero is retained as a zero-width source band. Neither state changes the underlying original calibration result.

## Retained result and integration contract

The result has `version: 1` and Workspace schema `upstate.calibration-uncertainties/v1`.

Main objects:

- `source_stamp`: original calibration, plan and observation IDs; original retained CSV description and metadata; hashes of the frozen reference units, prediction rows, objective and normalization; original comparison IDs and source vintages.
- `candidate_scores`: every original eligible candidate's score, independently reproduced score, difference and numerical tolerance.
- `pairwise`: signed gap bounds, exact interval state, first-tie margin, native model selection, profile identity and source attribution.
- `reference_units`: original spatial/temporal identity, native units, source means/bands, original period weights and objective coefficient.
- `source_records`: source values, original units, converted SE, source uncertainty details, bands and issues.
- `selected_validation`: original selected-candidate validation residual bands.
- `coverage`, `nominal_reproduction` and `selection_sensitivity`: compact summaries for the operator view.

`inspect` validates the content-addressed supplement and its original dependency chain. It reopens the retained completed calibration, original plan and observation edition; checks frozen source/objective identities; verifies the original observation CSV byte count and SHA-256; and compares the reconstructed dependency stamp and selected IDs. This supports the existing extension verification hook and portable-workspace adoption without rerunning the analysis.

The operator adapter owns HTML, CSV and ZIP presentations. The original JSON remains the complete scientific record. Normal backups include `calibration-uncertainties` and the operator's uncertainty exports through the maintained workspace archive workflow.

## Scientific scope

The intervals describe sensitivity to the supported published source-estimate error only. They preserve the original source period and model vintage; they do not remove a mismatch between them. They also do not quantify uncertainty in native process structure, source raster inputs, reservoirs, point sources, stream-bank erosion or other omitted processes. The existing calibration result retains those interpretation inputs.

The first-tie margin and exact box comparisons provide a concrete way to identify which original source estimates matter for the current candidate decision. They help prioritize source review and additional candidate evaluation while retaining the original scientifically traceable working profile.
