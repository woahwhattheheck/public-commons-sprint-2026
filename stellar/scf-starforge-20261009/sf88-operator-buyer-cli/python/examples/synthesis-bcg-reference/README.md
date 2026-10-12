# BCG source and method reference for Research synthesis

This package supplies the original thirteen-study BCG reference data and the author's open methods paper for the existing Research → Analysis workflow. The original bytes stay alongside the derived review projection. An operator can trace every projected value to its original line, column and byte span before accepting an extraction.

## Source files

| File | Purpose |
| --- | --- |
| `original/dat.bcg.txt` | Exact original nine-column, thirteen-row table, preserving its CRLF bytes. |
| `original/dat.bcg.r` | The source package's original data construction and metadata code. |
| `original/dat.bcg.Rd` | Complete original field dictionary, sources and references. |
| `original/metadat-DESCRIPTION` | Original package version, authors and GPL (>=2) declaration. |
| `original/viechtbauer-2010-metafor.pdf` | Complete open Journal of Statistical Software methods article, retained from its author's repository. |
| `bcg-source-rows.json` | Derived review projection with all original tokens, field locations and explicitly calculated arm totals. |
| `reference-protocol.json` | Authored reference selection and analysis choices to review in the original protocol workflow. |
| `sources.json` | Original URLs, immutable Git identities, byte hashes, retrieval receipts and license provenance. |

The table reports study number, author, publication year, vaccinated and control TB event/non-event counts, absolute latitude and allocation classification. Individual follow-up durations and independently adjudicated risk-of-bias judgments are absent. The retained source uses the same data under `dat.colditz1994`; the alias contributes no extra study. The table and dictionary come from [metadat's original source](https://github.com/wviechtb/metadat/blob/master/data-raw/dat.bcg.txt), [original dictionary](https://github.com/wviechtb/metadat/blob/master/man/dat.bcg.Rd) and [field reference](https://wviechtb.github.io/metadat/reference/dat.bcg.html).

## Receive original records

Import the original table and report through the selected existing Research source occurrence. Create the original eligibility studies and source-bound extraction result sets from that occurrence. The `metadat-bcg-trial-N` identifiers in the projection are reference identifiers for matching this file; record the actual generated dossier, study, form, result and edition identifiers in the receiving operation.

Every numeric source token remains a string. The projection gives `tpos+tneg` and `cpos+cneg` as separately described derived totals, calculated with integer arithmetic. The raw source event and non-event counts remain the reported values. An accepted extraction must preserve the original reviewer/submission/resolution and source bindings. The projection is source material for that workflow, not a saved native extraction result.

Select accepted result editions through the original revision-bound export. Each selected result must bind study identity/version, result ID, immutable edition/fingerprint, contrast, outcome, timepoint convention, source occurrence/hash/locator, exact typed values and relevant appraisal. Store the protocol, selected records, full model request and complete calculation output in the original Analysis workspace and its archive.

## Cohort and dependence

The full thirteen rows are the published reference dataset. The allocation subgroups are random (1,2,3,4,7,8,9), alternate (5,6), and systematic (10,11,12,13). Keep the seven-row random subgroup visible as an explicit selection. Allocation labels describe this source field; they do not themselves replace a design-specific appraisal.

The reference outcome is TB events in vaccinated versus control participants over each source trial's reported follow-up. The table does not establish one common duration. Preserve that limitation in the reviewed protocol and report instead of filling a duration from another study. Distinct reports or aliases of the same trial must map to the same study. A conventional independent-study pairwise model requires a single selected compatible estimate per independent study; shared-control or repeated estimates need an explicitly supported dependency model or a reviewed selection. Cochrane's [Chapter 10](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-10) explains compatible outcomes, generic inverse-variance synthesis and model assumptions.

## Effect calculation

For this binary table, select risk ratio with vaccinated as group 1 and control as group 2. Supply event counts and the explicitly reviewed arm totals to the original statistical engine. Analysis uses log(RR); only presentation exponentiates the effect and interval limits. The direction label must remain attached to the result and plot.

The native API `statsmodels.stats.meta_analysis.effectsize_2proportions(..., statistic="risk-ratio", zero_correction=None)` returns logarithmic effects and their variances. All thirteen source rows have positive events and non-events, so no continuity correction is needed for this reference. Other inputs require an explicit selected zero-cell policy; changing that policy creates a new calculation edition. See the [official effect-size API](https://www.statsmodels.org/stable/generated/statsmodels.stats.meta_analysis.effectsize_2proportions.html).

## Native model and inference

Record the actual installed Python, NumPy, SciPy and statsmodels versions and the selected engine source/capability in the native result. Pin the saved request to the actual supported implementation; a documentation version is not an installed-runtime observation.

The original `combine_effects` API supports Paule–Mandel (`method_re="iterated"` or `"pm"`) and DerSimonian–Laird (`"chi2"` or `"dl"`). It computes fixed-effect and random-effects results and includes fixed-scale and estimated-scale/HKSJ inference. Select and report the model, heterogeneity estimator, scale treatment, confidence level and normal/t inference separately. A `use_t` choice alone does not identify which standard-error/scale result was selected. Preserve any convergence diagnostics and the actual estimator boundary behavior. See the [official combination API](https://www.statsmodels.org/stable/generated/statsmodels.stats.meta_analysis.combine_effects.html).

The accompanying authored protocol proposes PM with explicitly selected estimated-scale t inference for its random-effects reference calculation, and a separately named common-effect normal-inference comparison. The operator reviews these choices before the original job runs. No numerical expected result is invented in this source package.

## Compare like methods

The author's [JSS 2010 article](https://doi.org/10.18637/jss.v036.i03) and [original example code](https://www.jstatsoft.org/article/download/v036i03/2084) illustrate the BCG analyses in metafor. Their ordinary `rma` example uses metafor's REML default. This is not the same heterogeneity estimator as PM or DL.

The author's [Berkey 1995 reproduction](https://www.metafor-project.org/doku.php/analyses:berkey1995) explicitly replaces ordinary sampling variances with smoothed estimates and selects EB. Its published log-effect −0.5429 and SE 0.1842 therefore belong to that exact method. Compare those values only after selecting the same variance transformation and estimator.

The native receiving programme should compare a complete output only with a reference that binds the same input cohort, transformation, estimator and inference. Retain a different method as a named sensitivity result. Do not alter a model until it happens to match an unrelated reference number.

## Reports, review and later editions

The report should include every original source row, inclusion/exclusion reason, source and accepted-result binding, reported and derived values, effect scale, exact native model selection, weights, heterogeneity and inference, complete forest/funnel data and the underlying machine-readable calculation. A forest plot's displayed ratio uses exponentiated limits; the underlying stored calculation remains on its selected scale.

Leave-one-study-out influence, allocation subgroups and selected appraisal/source exclusions retain their own exact cohorts and method settings. Interpret a funnel pattern as a description that may have several causes; retain the study count and method prerequisites rather than presenting it as proof of publication bias. Treat a prediction interval as a distinct quantity from uncertainty in the mean effect and show it only when the selected engine/method supplies it. These interpretation distinctions follow [Cochrane Chapter 10](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-10).

A corrected extraction, changed appraisal or new source edition leaves the old completed result intact. The operator reviews its impact and starts a new revision-bound calculation. Original archive receiving must retain protocol and selection, accepted source records, full request, actual engine result, plots/report payloads and original job/review history so the same report opens without network access.

## Attribution

The four metadat originals retain the source package's GPL (>=2) license declaration and author metadata. The JSS article is Wolfgang Viechtbauer (2010), *Conducting Meta-Analyses in R with the metafor Package*, Journal of Statistical Software 36(3), 1–48, DOI 10.18637/jss.v036.i03. The journal's [copyright notice](https://www.jstatsoft.org/about/submissions) permits article reuse with attribution under its Creative Commons Attribution license. This package preserves the original article without modification.

The authored projection, protocol and integration notes describe how to use these original sources in the existing Commons Research product. Original source URLs, licenses and hashes remain in `sources.json`.
