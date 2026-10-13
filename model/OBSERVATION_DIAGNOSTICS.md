# Annual-load comparison review

The existing Observed water quality comparison now retains a complete descriptive review under `diagnostics`. Open any newly saved comparison to inspect **Annual-load cohorts and catchment weighting**, download the full review JSON, and continue to its ordinary scientific delivery. PDF, offline HTML, Markdown and report data consume the same typed review blocks.

## What the review answers

A catchment with many retained annual periods contributes more rows to the original pooled fit scores than a catchment with one period. The review presents those original row weights alongside equal weight per original catchment. It also separates exact observation periods and lists the original observed range, modeled range and errors for each catchment. These are descriptive comparisons of the selected completed model run against the actual retained annual references.

The original comparison metrics, admission rules, source methods, raster support and calibration decisions remain unchanged. Concentrations and point-source discharges keep their original context workflow. No load is estimated or annualized by this reader.

## Cohorts and periods

A cohort uses the exact retained parameter, source species, comparison mass unit and method. Structured methods use a deterministic JSON key while their original value remains in the result. Missing species or methods remain explicitly unspecified; the reader does not assign a source definition.

Each period summary then uses the exact original period-start and period-end values. No date windows are combined, no source end-date convention is changed, and periods are not duration-weighted. Comparing these summaries is not a trend estimate: their catchments and underlying observation support can differ. Original model period and source vintages remain with the result without an inferred temporal match.

Rows enter this review only when the original comparison explicitly marks complete catchment support and retains nonnegative finite observed and modeled annual masses, an original catchment identity, parameter and mass unit. Explicit non-catchment support remains outside it. Other original comparison rows keep their partial totals and explanations; diagnostic omissions identify their zero-based index and original observation identifier.

## Error definitions

For original row i in catchment g, residual e_gi is modeled minus observed annual mass. The original row weighting uses each retained row once.

For G original catchments, with n_g retained rows per catchment:

- Equal-catchment mean bias = mean over catchments of mean_i(e_gi).
- Equal-catchment mean absolute error = mean over catchments of mean_i(abs(e_gi)).
- Equal-catchment RMSE = sqrt(mean over catchments of mean_i(e_gi squared)).

The last quantity includes variation among the original rows within a catchment. It is not the RMSE of catchment mean residuals. Every reported error uses the cohort's original comparison mass unit. Ranges describe retained values, not uncertainty intervals.

Equal catchment weights do not establish independent sites. Nested or overlapping source catchments remain distinct original identifiers, and repeated observation periods can overlap. Neither the source rows nor their spatial supports are deduplicated or treated as independent evidence.

## Source and application contract

`model.observation_diagnostics.build(comparison)` is a standard-library reader. Its result retains:

- original run, observation edition, comparison version and catchment source;
- model period and original model-source vintages;
- every cohort member's original comparison-row index and observation identifier;
- exact original station, catchment, period, observed mass, modeled mass and stored residual;
- row-weighted, equal-catchment, exact-period and per-catchment summaries;
- duplicate original identifiers and varying predictions where present;
- diagnostic omissions and original pre-comparison exclusion count;
- one typed block stream used by every human report.

New `model.observations.compare` results save the review as comparison version 6. Existing saved comparisons retain their original identities and bodies. The scientific formatter derives the same current review from those original rows during a new report build. It does not mutate the saved comparison. The existing Observations browser reads only the saved review and downloads that complete JSON; it does not implement a second set of statistical formulas.

The reviewer uses original comparison values, not rounded display strings. Original qualifiers, methods, uncertainty, conversion factors, spatial coverage and source records remain available in the main comparison and its row CSV. Full precision review values and exact source membership remain in the diagnostics JSON.

## Receiving in the existing project

Use the current complete application and the existing retained native project. The current ordinary observation-comparison action creates the result from its selected original completed run, annual observation edition and source catchments. Open that same retained comparison, inspect the cohort review, download its JSON, and select it in the original scientific report journey. Use the original report/export/reopen operation already assigned to that project; this change creates no new native model run.

During receiving, compare the full saved JSON with the operator's table, then open the same report's PDF, HTML, Markdown and data companions. Confirm exact source-period labels, mass units and the retained cohort members. Source code review and browser parsing are separate from that actual project execution.
