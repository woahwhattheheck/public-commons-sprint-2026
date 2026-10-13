# Published USGS sediment reference calculation

## What this course establishes

This course executes the Measurements sediment surrogate core on all 120 numbered samples printed in Attachment B of the USGS 2016.07 / 2016.10 memorandum. The original source is station 07144100, Little Arkansas River near Sedgwick, Kansas, with SSC in mg/L, YSI 6136 turbidity in FNU and discharge in cubic feet per second. The included CSV retains the published raw numeric columns and numbered samples, including five repeated dates. It does not use the rounded logarithms printed alongside those columns.

The source includes dates, with no clock time or timezone. Each row therefore has calendar-date support. Its numbered sample identity binds the three reported quantities; it does not prove a separate storm. The module retains this distinction and reports hydrologic grouping as unassessed.

The actual scientific calculation has executed in connected JavaScript V8 using the complete authored module and the original Measurements CSV parser. The complete unchanged original parser, explicit pairing adapter and pure service rebuild have also executed using openly authored source-exercise review contexts. Their complete source identities and outcomes are retained separately in the execution receipt. This calculation is useful evidence about the numerical engine and this historical dataset. It does not claim that the SQLite workspace, HTTP service, browser or field deployment has run.

## Source and precision

The exact source CSV is 3,153 bytes with SHA-256 `7783717d890ffc902096823a626b080cbaa457bc82977ebe97961abc74881e26`. The companion provenance document and complete retained extraction provide the published table location, original numbers and transcription history. The 120 numbered rows cover 115 dates from 2004-07-27 through 2014-08-04. Their numeric precision is the precision in the publication, rather than the unavailable original laboratory and sensor CSV stream.

The original authors removed seven samples before the published calibration table. This course preserves the table as published and makes no new exclusions. One date appears in both the publication's outlier discussion and the retained numbered table; the complete table remains authoritative for this reproduction. No rows have been silently selected to improve a fit.

Discharge is converted to the original Measurements model's m³/s using the exact factor 0.028316846592. SSC and TSS are distinct analytical targets. This reference uses SSC only, and no TN, TP, TSS or sediment load is inferred from it.

## Explicit calculations

The first model is a calibration reproduction: all 120 samples are training observations, with no validation observations. It fits log10(SSC) against log10(turbidity) and log10(discharge), with an intercept.

A separate, predeclared exercise assigns dates before 2012-01-01 to training and dates from 2012-01-01 onward to validation. That produces 68 training and 52 later validation samples. No sample is dropped. Three named model forms use this same split:

| Form | Fitted response | Turbidity and discharge predictors |
| --- | --- | --- |
| Linear | SSC | Original numeric units |
| Log-linear | log10(SSC) | Original numeric units |
| Log-log | log10(SSC) | log10 of each predictor |

Each fitted model remains a complete separate result. The software does not choose a winner. Examining the alternatives on the same held-out period is exploratory comparison; using those scores to select a model consumes that validation evidence and requires later independent evidence for a final operational performance claim.

## Reproducing the published calibration

The all-120 log-log fit is:

```text
log10(SSC mg/L) =
    0.3288767345784884
  + 0.9331008361097172 log10(turbidity FNU)
  + 0.043115648002162325 log10(discharge m³/s)
```

Converting the discharge-unit intercept back to cubic feet per second gives 0.2621356468464646. Thus the reconstructed published-unit coefficients round to 0.262, 0.933 and 0.0431, matching the original reported equation. The training-only Duan bias factor is 1.0189662086238862, which rounds to the published 1.02.

The model's fitted-scale R² is 0.9798071276. Its original-scale RMSE, using the bias-corrected arithmetic-mean estimate, is 83.8876 mg/L. These summarize the full calibration population; they are not held-out validation scores.

## Temporal validation results

The following scores use all 52 later observations. Error units are mg/L and bias means predicted minus observed. Original-scale estimates use the training-only bias factor for logarithmic responses.

| Candidate | Validation RMSE | Validation MAE | Validation bias | Predictive R² | 95% individual-interval coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Linear | 35.5194 | 19.5493 | +13.7705 | 0.96413 | 52/52 |
| Log-linear | 446.8902 | 100.2000 | +65.2196 | -4.67813 | 47/52 |
| Log-log | 28.9884 | 17.2733 | +7.8627 | 0.97611 | 50/52 |

The log-linear candidate performs poorly on the original concentration scale and is retained visibly. Negative predictive R² means its sum of squared prediction errors exceeds the variation around the validation cohort's own mean; it is not removed or coerced to zero.

The temporal log-log training model is:

```text
log10(SSC mg/L) =
    0.3509003776115023
  + 0.9227172135985725 log10(turbidity FNU)
  + 0.04828885365058373 log10(discharge m³/s)
```

Its Duan factor is 1.0208891895369923, computed only from the 68 training residuals. The two held-out observations outside their individual prediction intervals are published rows 83 and 84, with observed SSC of 9 and 8 mg/L. Every original observation, prediction, residual and interval remains in the complete JSON output.

## Validation and deployment support are different

Fifteen of the 52 later samples are outside at least one training predictor range. Thirteen have discharge below the training minimum of 14.5 ft³/s; two have turbidity below the training minimum of 4.37 FNU. The training maxima are 15,100 ft³/s and 784 FNU.

The same source-bound prediction path is exercised twice. Explicit `block` handling returns 37 estimates and 15 unresolved out-of-range rows. Explicit `flag` handling retains estimates for all 52 rows and marks 15 as extrapolated. Flagging preserves an inspectable calculation; it does not authorize deployment. Good aggregate held-out scores do not establish supported operation over the full later range.

These are estimates at actual retained surrogate observations. The programme does not interpolate missing measurements, generate future turbidity, infer an unobserved time series or integrate a sediment load.

## Uncertainty and diagnostics

The core fits centered and scaled predictors with reorthogonalized QR and maps coefficient covariance back to the original transformed predictor units. Student-t intervals use the actual residual degrees of freedom, including the fitted intercept. The full output includes all coefficients and their standard errors, covariance, training ranges, residuals, internally studentized residuals, leverage, Cook's distance and deleted-residual PRESS.

For a logarithmic response, the inverse-log fitted location and the Duan-corrected arithmetic-mean estimate are separate fields. The location confidence interval describes the fitted log-response mean after inverse transformation. The individual-observation prediction interval includes residual variance on the fitted scale and is backtransformed without multiplying its endpoints by the smearing factor. No arithmetic-mean confidence interval for the estimated smearing factor is claimed.

These are pointwise conditional OLS intervals. Their interpretation requires a suitable model form, compatible sensor/sample population, independent errors and approximately constant normally distributed residual error on the fitted response scale. The source does not identify independent hydrologic events. Irregularly spaced residual-order diagnostics cannot establish storm independence. Sensor/laboratory uncertainty beyond fitted residual variation, uncertain pairing, censoring decisions, model selection and nonstationarity are not presented as a complete environmental uncertainty budget.

No diagnostic automatically deletes or downweights observations. Scientific changes require a new explicit saved selection with the original rows and reasons retained.

## Reproduction and operating limits

Run the included reference course from the selected complete source edition:

```bash
node reference/run-sediment-reference.mjs \
  --output /ABS/NEW-OR-EXACT-REFERENCE-OUTPUT \
  --reviewer 'Actual scientific source reviewer' \
  --review-at '2026-10-13T19:06:20Z' \
  --reason 'Explicit review of the retained published table for this source-only exercise'
```

The reviewer, reason and UTC time are explicit authored context, never native review receipts. Reuse those exact arguments to reproduce that context. The course produces the complete service-shaped temporal study, full HTML report, four CSV reports, all fit and prediction JSONs, full source preparation/inputs and all three original source files. The final execution manifest lists every artifact. It also records hashes of the actual loaded parser, pairing, science, service, report and course source files.

This calculation binds record and source IDs from the actual selected parser edition. A newer maintained parser may add source metadata or change canonical identities while retaining the same observations. Older recorded results remain bound to their own complete source edition; compare the scientific values at appropriate numerical precision, without pretending that old and current source hashes are identical. It verifies the source CSV, uses the original source parser and pairing module, retains the openly authored source-review decisions, and writes complete results for all candidates and both prediction policies. Reentry verifies existing output bytes rather than replacing an unrelated result. The output manifest lists every expected artifact; it does not accept a directory-discovered subset.

The application's subsequent SQLite/UI/portable course uses the same source, model definitions and original request ownership. Opening and operating the rendered screens, reviewing plots at normal and narrow widths, downloading all original attachments and reopening the complete portable result remain part of that actual application receiving course.

## Primary methods

- USGS Rasmussen et al. (2009), *Guidelines and Procedures for Computing Time-Series Suspended-Sediment Concentrations and Loads from In-Stream Turbidity-Sensor and Streamflow Data*: https://pubs.usgs.gov/tm/tm3c4/
- USGS Technical Memoranda 2016.07 / 2016.10, *Policy and guidance for computing suspended-sediment concentrations and loads from in-situ turbidity-sensor and streamflow data*, including the actual source table and subsequent policy: https://water.usgs.gov/admin/memo/SW/sw.2016.07%2Bwq.2016.10.pdf
- NIST/SEMATECH, least-squares modelling and prediction intervals: https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd431.htm and https://www.itl.nist.gov/div898/handbook/pmd/section5/pmd512.htm

The USGS documents govern SSC methodology; they do not approve this implementation or confer publication authority. The reference course keeps calculations, observations, assumptions and the scientist's choices separately visible.
