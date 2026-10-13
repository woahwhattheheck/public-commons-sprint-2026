# Compound measurements and interval observations

The existing **Chemical transport & inference** desk accepts single-pool measurements and explicit weighted measurements over the selected saved chemical scenario. Calibration, local sensitivity, chemical-parameter monitoring design and parameter-prior ensembles use the same native observation definition. The original project still owns its physical species, conserved bases, reach topology and coefficients.

## Open, import and review

1. Open the actual saved chemical scenario in the Chemistry desk. Its original project and source references remain attached to subsequent scenario editions and analyses.
2. Choose the analysis and retain its complete native request: fitted parameter targets and bounds, or the original candidate/error/prior specification for a monitoring design.
3. Under **Import observation CSV**, supply a meaningful original source reference and choose the CSV. Imported records populate the original request's `observations` array in every inference mode, including monitoring candidate design.
4. **Review measurement definitions and limits** opens after import. Inspect the retained measurement label, weighted pools, conserved basis, role, reach, model day, error scale, qualifiers and source. The complete JSON remains editable in the original request field.
5. Save and open any changed physical scenario before running the request through the original task queue. Native validation checks actual species, reach, model duration and analysis-specific inputs.

The CSV reader preserves zero concentrations, numerical weights and explicit false endpoint flags. It rejects missing or nonfinite values, repeated record/species identifiers, cross-basis components and ambiguous point values on interval records. Extra source columns remain in the imported request. The native result retains the engine's original output fields and provenance.

### Measurement definitions

Every imported record needs `id`, `reach`, `day` and positive `sigma_mg_l`. The original request supports these two observation operators:

| Operator | Required fields | Meaning |
|---|---|---|
| Single modeled pool | `species` | Its concentration on the selected Project's declared conserved basis. An optional supplied `basis` must match exactly. |
| Compound measurement | `measurement`, `basis`, `components`; omit `species` | Sum of each declared species concentration multiplied by its positive numerical weight. Every component is unique and uses the exact conserved basis. |

`components` is a nonempty JSON array of objects with `species` and `weight`. In CSV, quote the complete JSON cell and double its internal quotation marks according to normal CSV syntax. Use exact species identifiers from the opened Project.

Weights are not normalized, and the engine does not convert mass bases. A concentration expressed as elemental nitrogen must be bound to pools whose declared basis is that same conserved quantity. The source-to-model binding remains explicit. Where total nitrogen is formed from TKN and NOx, ammonia already included within TKN must not be counted twice. The model's selected pools and the original observation method determine the valid operator.

### Original qualifiers and limits

| Qualifier | Values retained | Calibration contribution |
|---|---|---|
| `equal` (default) | `mg_l` | Signed predicted-minus-reference concentration divided by `sigma_mg_l`. |
| `below` | Original limiting `mg_l` | Zero at or below the limit; standardized exceedance above it. |
| `interval` | `lower_mg_l`, `upper_mg_l`, `lower_closed`, `upper_closed`; omit `mg_l` | Signed distance to the nearest endpoint divided by the error scale; zero within the endpoint range. |

Limits must be finite with `0 <= lower_mg_l < upper_mg_l`. Both inclusion flags must explicitly be JSON booleans, or CSV cells `true` / `false`. A bracket includes an endpoint; a parenthesis excludes it. No midpoint, half-limit value or numerical epsilon is substituted.

The fit uses distance to the interval closure. Consequently, a prediction exactly equal to an excluded endpoint has zero distance penalty while `interval_contains_prediction` is false. Reports show this distinction directly. Optional `role` is `fit` or `holdout`; held-out records remain outside the fit objective.

## Inspect the completed analysis

Use the original **Result collection** picker:

- **observations** shows a readable operator/limit table followed by every original result field, including endpoint inclusion and prediction membership.
- **scores** contains exact-value RMSE and bias, grouped by the complete operator identity.
- **interval_scores** contains count, predictions within the declared interval and root-mean-square standardized distance to the limits. These are separate from point RMSE.
- **rows**, **selected** and **summaries** retain the complete compound observation inside sensitivity targets, monitoring candidates and ensemble targets.

Native grouping includes the measurement label, exact basis and the sorted species/weight pairs. Distinct weights remain distinct groups even when labels match. Single-species grouping retains its original behavior. Component order remains intact in the original request and displayed table.

## Prepare and compose the scientific report

From a completed analysis choose **Prepare scientific report**, then open the saved report. The HTML presentation includes the full weighted measurement, original source reference, point or interval support, supplied error scale and native prediction. It does not rerun the model.

Exact-value scatter plots use equal physical axis ranges for each complete operator and distinguish fitted from held-out points. Censored values are not plotted as exact reference concentrations. Interval figures retain the declared endpoints: solid circles include the endpoint, open squares exclude it, and diamonds show native predictions. Captions map each record number to its original ID and role. The full tables retain all numerical bounds and membership fields.

Parameter-prior figures group by the same operator and retain the original 5th/50th/95th percentiles. Physical state trajectories, reaction transfers and mass budgets remain separated by actual modeled species and conserved basis.

Choose **Prepare source for scientific reports**, then **Open this report only** to select exactly that retained source and its title in the existing scientific composer. **Add to current report** deliberately appends it to the current ordered draft. The source includes:

- Complete reference, point-score and interval-support CSV tables.
- Full local sensitivity, design and ensemble tables when present.
- Native observation-fit CSV columns preserving complete compound operators and interval endpoints; interval analyses also retain the native interval-support CSV.
- Original numeric figure specifications and SVG companions, used by the existing PDF/HTML renderer.
- The saved Chemistry report, original project/request/result, artifact inventory and editable Chemistry archive.

Opening this report only replaces the draft source selection and title. Adding keeps the other selected sources in order, avoids duplicate source entries and preserves the draft title. Both retain contact information. Use its original preview, render, export and saved-edition controls. Full Workspace transfer retains these saved sources and report editions.

## Versioned presentation and continuation

The new HTML presentation is `reach-chemistry-scientific-report/3`; the scientific-source presentation is `native-chemistry-scientific-source-v2`. New preparation selects the new renderer identity. Existing completed HTML report records and v1 scientific-source editions retain their original bytes and continue to open and verify.

The native inference extension supplies `observation_key`, `observation_fields` and `observation_components`. These UI/report files are installed with that engine continuation and the native `interval_scores` result collection. The original task queue, immutable scenario/result identities, source inventory and transfer path remain the continuation mechanisms.
