# RL-18151 sampling support

This extension uses the complete original A73C study and its existing five-source bank. It adds an offline sampling explorer and reproducible calculations while preserving every original result, activity, response and source identity.

## Run the complete existing source

Use a directory already containing the complete maintained RL-18151 study, its original response files and a valid `study-files.json`. Place the four new source files alongside the maintained compiler, then run:

```sh
node build-sampling-support.mjs /absolute/path/to/rl18151-study
```

The command verifies the exact original acquisition plan, each original response, the existing file ledger, every current source companion and every report input before calculation. It writes the full review, three CSV exports and the existing observed-report/source descriptors. Every one of the five existing source entries receives the complete new companion closure; source IDs, original data, receiving metadata and other report sections survive.

Run this extension after any rebuild using the original `build-study.mjs`, because the original builder generates its original report edition. The extension is deterministic and can be rerun on its own completed output. Any revised native importer and `RL_NATIVE_RECEIVING.md` already in the valid source bank are preserved and included.

## Delivered views and files

- `sampling-review.html`: self-contained offline browser view, cohort search, year/programme filters, original versus compatible grouping, activity membership, complete leave-one-activity-out tables and monitoring calendar.
- `sampling-review.json`: complete machine-readable result, both grouping modes and all original member identities.
- `derived/sampling-cohorts.csv`: means and exact interval endpoint flags for both grouping modes.
- `derived/sampling-activity-sensitivity.csv`: every removal with exact activity and result identifiers.
- `derived/sampling-calendar.csv`: every programme/month, including months without returned measurements.
- `observed-report.json`: the same original native report, with an appended sampling-support section and links.
- `sources.json` and `study-files.json`: refreshed complete closures.

Open `sampling-review.html` locally. It makes no external network requests. Its JSON and selected-cohort CSV downloads are generated from the same embedded full review.

## Mean definitions and censor bounds

For each selected year and compatible scientific cohort, let activity j have n_j original result intervals and let A be the number of observed activities. The equal-activity mean is the average of each activity's mean interval. The secondary result-weighted mean averages all N original result intervals.

The difference uses each same original result with coefficient `1/(A*n_j) - 1/N`. A positive coefficient uses the result's lower endpoint for the difference lower bound and its upper endpoint for the upper bound; a negative coefficient reverses them. Open/closed endpoints follow the nonzero coefficients. This preserves dependence between the two means, including when both means involve the same unknown censored value.

A left-censored `[0, limit)` result retains the exact interval supplied by the maintained compiler. Zero is a mathematical nonnegative lower bound, not an observed zero. No half-limit substitution is performed. Unresolved results prevent a complete-cohort mean. Bounds are not sampling confidence intervals.

## Cohort compatibility

The 83 existing source cohorts remain separately accessible. The additional 66 compatible cohorts require matching year, characteristic, fraction, quantitative unit, chemical basis, medium, activity type, both depth fields and references, analytical method/context/name, result basis, time/temperature/weight/particle basis, statistical base, qualifier and status.

Numeric and censored representations may share a compatible cohort when those actual scientific fields agree. The original blank result unit remains blank; a quantitative unit inherited from the explicitly published limit remains typed separately. Every original unit/interval-unit provenance group and all of its ResultIdentifiers remain in the review.

No cross-year pooling, chemical conversion or substitution of a physical “Depth” observation into an absent sampling-depth field is performed. In particular, the two 2024 phosphorus activities with explicit 0.3 m depth remain separate from unspecified-depth measurements.

## Repeated assays and sensitivity

Every ResultIdentifier survives. Repeated quantitative agreement compares the reported value, its original unit, detection condition and quantitative interval. Reporting-limit/status/qualifier metadata agreement is recorded separately. Equal values with different original limit metadata are not described as differing measurements.

Leave-one-activity-out calculations remove all original rows associated with one activity in the selected cohort, then recompute both descriptive means. They describe sensitivity of this observed campaign. A one-activity cohort has no leave-one-activity-out comparison.

The calendar includes every month from January 2018 through 13 October 2026 for each retained programme. “No returned measurements” means no rows in these exact response files; it does not establish that no monitoring occurred elsewhere. The partial October query window is explicit.

No continuous trend, treatment effect, unobserved daily value, discharge or annual catchment load is inferred across the 2019–2023 gap. Arithmetic pH averages are averages of reported pH numbers, not mean hydrogen-ion concentrations. Assessment editions remain separate from measurement dates.

## Current source execution

The actual complete 498-result / 40-activity study yields 83 source cohorts, 66 compatible cohorts, 458 original-cohort and 465 compatible-cohort activity removals, and 318 programme/month rows. All 31 repeated compatible activity/cohort groups agree quantitatively; original metadata differences remain visible.

For 2026 water temperature, nine retained results represent six activities. Equal activity weighting yields 21.255 deg C; result weighting yields 20.4966666667 deg C. This difference reflects the sampling weights of the retained campaign.

The compatible phosphorus bounds remain divided by year and original depth: 2018 unspecified depth [0.0264166667, 0.0414166667); 2024 unspecified depth [0.0031111111, 0.0208888889); 2024 depth 0.3 m [0, 0.020); 2025 unspecified depth [0, 0.020); and 2026 unspecified depth [0, 0.020), all mg/L as P. These are descriptive retained-measurement bounds, not a statistical trend result.

## Native receiving

Receive the refreshed `sources.json` through the existing RL-18151 importer. Preserve the current delivery's prior ordered observed reports and append/select this same RL source using its actual saved collection/source IDs. If the complete source includes `RL_NATIVE_RECEIVING.md`, follow that maintained guide for optional Station Geography and current-delivery composition. The sampling extension does not allocate a second study or select a publisher on behalf of the existing owner.

The source bank intentionally excludes `sources.json`, `study-files.json` and the report itself from the report's own input list, preventing a circular content identity.
