# Original concentration coverage in Published studies

This additive module enriches the existing study context with reporting-limit support. It leaves the original concentration values, source cohorts, printed table summaries, selected observations, quantified-only statistics and native model calculations intact.

## Scientific meaning

For each original station / parameter / source-project / activity-type series, a quantified result contributes its reported concentration. A result explicitly below a positive original reporting limit contributes the interval from zero to that limit, excluding the upper endpoint, conditional on nonnegative concentration. Divide the sum of those intervals by the complete result-row count.

These are arithmetic bounds on the mean of the retained observations, conditional on the original censor statements. They are not confidence intervals, estimates of a population mean, or assigned values for individual samples. No zero, half-limit or other point substitution is written into a source row. Missing/unsupported numerical support, a negative quantified concentration conflicting with the stated assumption, or incompatible units leaves the aggregate interval unavailable. Original qualifiers, activity counts, result identities and source selectors remain accessible.

The selected Eighteenmile source contains 85 microcystin results. The published Table 8 analytical summary contains 73 samples. Its printed statistics remain separate. Four April 5 original records use a 0.1 ug/L limit; the other relevant limits are 0.016 ug/L. Original methods and detection fields are retained in the result artifact.

## Existing native context integration

In measurement_workspace/published_studies.py, use the sibling module:

```python
from .observation_support import enrich_observation_context, report_html as support_report_html
```

In PublishedStudyStore.context, directly after the existing call to _observation_context(...):

```python
observation_context = enrich_observation_context(observation_context)
```

The selected-context JSON and existing study export then retain each series' observation_support object. This contains full numerical endpoints, complete original detection support and selected result/source IDs.

In PublishedStudyStore.report_html, append support_report_html(context) to the existing observed HTML before composing the final page. It renders two readable tables per original parameter/project/activity-type series: coverage and mean intervals. This uses the original report's industrial styling and small table widths.

Keep the concurrent report-manifest and flow-manifest traversal additions when applying these two hooks. No importer or source-manifest alteration is needed.

## Existing scientific report integration

The maintained observed_context collector can append:

```python
from measurement_workspace.observation_support import report_sections
sections.extend(report_sections(original_published_study_context))
```

The returned value matches the actual v6/v7 scientific report contract: a list of (heading, blocks) pairs; ordinary paragraphs are strings and table blocks use kind, columns, rows, widths and caption. Therefore the same values render in PDF, HTML, Markdown and structured report data. Preserve the existing observed source binding in the delivery identity.

## Existing native receiving continuation

On the same actual application and exported study context:

```sh
python -B -m measurement_workspace.observation_support /actual/selected-context.json --output /actual/observation-support
```

This command reads a native upstate.published-study-context/v1 export, writes its enriched selected-context.json, exact scientific report section JSON and complete original study-report.html with the new support section. It uses the maintained PublishedStudyStore HTML exporter.

Inspect the five actual microcystin series and original source links in that same report. The accompanying original-campaign-support.json contains source arithmetic evaluated directly from the complete original 920-result CSV and preserves every one of the 85 underlying microcystin records. The module's native execution belongs to the existing report receive operation.

## Actual result

| Station | Original results | Quantified | Below limit | Quantified-only mean (ug/L) | Complete-campaign mean interval (ug/L) |
|---|---:|---:|---:|---:|---|
| SV-268 | 21 | 7 | 14 | 0.0859286 | [0.0286429, 0.0433095) |
| SV-374 | 21 | 20 | 1 | 0.0611 | [0.0581905, 0.0629524) |
| SV-838 | 14 | 12 | 2 | 0.0447917 | [0.0383929, 0.0466786) |
| SV-839 | 15 | 13 | 2 | 0.0569615 | [0.0493667, 0.0571) |
| SV-840 | 14 | 12 | 2 | 0.0502083 | [0.0430357, 0.0453214) |

Values displayed here are rounded to six significant figures; the JSON preserves full arithmetic. Bounds and quantified-only means have different denominators, which the tables expose.

## Receiving review

Independent review used the complete retained native PublishedStudyStore producer. Its four-part series key, source value/limit fields, record selectors and static report_html contract match this module. Recalculation of all 85 original records agrees with all five interval endpoints within 1e-12. The CLI detects its rendered version marker and preserves one support section when the in-application hook is already installed.
