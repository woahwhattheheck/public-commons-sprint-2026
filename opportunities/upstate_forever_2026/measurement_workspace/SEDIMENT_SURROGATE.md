# Sediment surrogate studies in Measurements

Sediment studies connect original laboratory concentrations to compatible optical observations at one site. The analyst selects the source population, interpretation, actual pairs, model, training and validation cohorts, and any separate observation population to estimate. Measurements retains the full input and every outcome in an editable, portable named study.

This is part of the existing Ecosystem Sciences Measurements application. It uses the original measured-source imports, record reviews, SQLite workspace, HTTP/CLI, exports and events. Source records stay measured records. A fitted concentration is a separately retained scientific estimate at an actual surrogate observation's support.

## Start with the scientific question

A useful study identifies the site, the actual concentration being modeled, the optical instrument and measurement method, and the purpose of the result. For example: estimate suspended-sediment concentration at station 07144100 using the YSI 6136 turbidity record, with concurrent measured discharge as an explicitly selected second predictor.

**SSC and TSS are separate targets.** Select SSC for suspended-sediment concentration and TSS for total suspended solids. The application retains their original analytical identities. FNU and NTU, different optical methods and different sensors remain separate populations. The USGS methods cited below concern suspended-sediment monitoring; a mathematical regression of TSS does not adopt SSC analytical equivalence, sampling policy or sediment-load equivalence.

| Choice | What the operator supplies |
| --- | --- |
| Population | Original source files, target, site, instrument, optical method, exact units and relevant source versions |
| Interpretation | Source SSC, TSS, turbidity or discharge quantities, retaining original characteristic, unit, method, fraction and censoring |
| Pairing | Explicit sample relationships or a supported time rule, complete candidate choices and exclusion reasons |
| Model | Linear, log-linear or log-log; discharge inclusion; interval coverage; scientific rationale |
| Cohorts | An explicit train, validate or exclude assignment for every retained pair |
| Prediction | Separate compatible original observations and explicit handling outside the training range |
| Authorship | Named study, author, actual edition time, parent and explanation |

## Operate the existing application

1. Open Measurements in the authenticated Ecosystem Sciences application. Import or reopen complete original files through the existing source controls. Each source retains exact text, mapping, original identifier, checksum, provider pages and parsing outcomes.
2. Review original observations through the existing measurement review. Resolve selected source revisions and actual data issues. Preserve laboratory or publication quality labels; analyst inclusion is separately attributed.
3. Open the sediment controls, choose a named study or start one, provide the author and purpose, and select original files. The observation catalogue exposes source identities and quantities.
4. Choose source interpretation and pairing. Inspect the full pair preview, ambiguities, source issues and unresolved rows. Unknown sampling time is not midnight sampling; a shared date does not establish that every sample was concurrent.
5. Assign every pair to training, validation or explicit exclusion. Retain exclusion reasons and inspect the actual time support and source identities of each group.
6. Choose model form, discharge inclusion and interval coverage. Preview the complete result. Review original-scale errors, fitted-scale diagnostics, source ranges and individual-observation intervals together.
7. Save that exact preview as a named edition. A following edition retains its parent. Changed reviews or controls require a fresh preview and new save request.
8. For predictions, explicitly select compatible original surrogate observations. Inspect every estimate, unresolved row and range decision; save the selection with the study.
9. Open the complete report and download the full study, pairs, residuals, coefficients and predictions. Export a complete sediment project for editable history and unfinished work. Normal full Measurements exports also retain these records.
10. Reopen the exported project in the receiving workspace and continue from a retained study or draft. Earlier editions remain available.

The interface retains unfinished raw controls and the last structured definition. Save a draft when work is incomplete. A draft records unfinished work; it does not imply a successful fit.

### Recover an interrupted save

A save carries a UUID, complete definition, workspace revision and preview identity. If its reply is lost, inspect the original request and retry unchanged bytes. An already committed request returns its original outcome. A different UUID creates a different operation.

If source reviews changed before a new save, preserve the work and preview the current selection. An operator can explicitly retire an uncommitted save with author, time and reason through the abandon operation. Saved outcomes remain retained.

Portable receiving preserves studies, drafts, original requests, source snapshots and ancestry. Historical source bases let an analyst continue an older or received study without silently substituting today's import.

## Pairing and source meaning

Each row retains original sample support, target concentration, optical observation, optional discharge, original observation identities and issues. The pairing retains full interpretation and candidate outcomes, including unresolved observations and exclusions.

Date-only records stay date-only. Same-row or same-event pairing is useful for a published concurrent-sample table when its source states that relationship. It establishes no clock time, sampling timezone, storm membership or statistical independence. Separate numbered samples on the same calendar date remain separate.

Exact unit conversion differs from analytical conversion. The reference's cubic feet per second become cubic metres per second through the recorded factor **0.028316846592**, from the exact international-foot definition of 0.3048 metres. FNU/NTU and SSC/TSS are not converted.

Resolve sensor, method and unit mismatches through source selection or a separately authored study. Censored and unresolved observations remain inspectable. OLS requires numerical values admissible for the selected transformation. Explicitly exclude an unresolved selected row or repair its original selection; there is no half-limit substitution, hidden averaging or automatic outlier removal.

## Scientific calculations

`engine/sediment_surrogate.mjs` deterministically reads the complete pairing and explicit selection. The service rebuilds saved studies from original sources before reading or receiving them.

Let C be the selected concentration, T turbidity, and Q optional discharge:

| Form | Response | Turbidity predictor | Optional discharge predictor |
| --- | --- | --- | --- |
| Linear | C | T | Q |
| Log-linear | log10(C) | T | Q |
| Log-log | log10(C) | log10(T) | log10(Q) |

Every model has an intercept. Log responses require positive concentration; log predictors require positive values. Zeros are not replaced with small constants. Rank-deficient or numerically singular selections require a different explicit model.

The solver centers and scales predictors for numerical stability, uses QR with reorthogonalization, and reports coefficients and covariance in original transformed units. The saved result includes the full solver, degrees of freedom, training ranges, residual standard error and coefficient intervals.

Model choice remains an authored scientific decision. Compare candidates on the same explicit cohort basis and inspect residual behavior, hydrologic/seasonal coverage, compatible methods and interpretation.

### Training and validation

Every pair is assigned once. Training estimates coefficients, residual variation and retransformation correction. Held-out observations contribute prediction errors without updating those fitted quantities.

Temporal validation follows complete training observation support. Held-out mode retains explicit source-disjoint observations without asserting temporal or hydrologic independence. Reused original observations across training and validation are rejected. Declared event overlap is checked. Missing hydrologic event identity remains a scientific consideration even when sample IDs differ.

The report separates training/validation counts, RMSE, MAE, bias, R² and prediction-interval coverage, with errors also on the fitted response scale. Bias means **predicted minus observed**. Individual residuals mean **observed minus fitted** on the response scale, with an additional observed-minus-mean residual in mg/L.

R² is one minus squared prediction errors divided by squared deviations from that cohort's mean. Held-out R² can be negative. It is not the square of an automatically favorable correlation.

Diagnostics retain every residual, leverage, studentized residual, deleted residual and Cook distance when defined, with exact flagged identities. Adjacent residual statistics describe retained observation order; irregular spacing, storms and method changes need interpretation.

### Retransformation and intervals

For a log response, inverse-transforming the fitted location does not automatically give an arithmetic mean. The model estimates original-scale mean using the Duan factor: the arithmetic average of 10 raised to each **training** residual. Validation rows do not alter that factor.

Student-t intervals use actual residual degrees of freedom and chosen coverage:

- The **location interval** surrounds the fitted conditional location. A log model's back-transformed location is the inverse of its conditional log-scale mean, or a conditional median under symmetric log errors.
- The **individual prediction interval** concerns one concentration observation conditional on compatible observed predictors.

Log prediction intervals back-transform fitted-scale endpoints. The smearing factor does not multiply these quantile endpoints. A location interval is not relabeled as an arithmetic-mean interval that includes estimated smearing uncertainty.

These are pointwise conditional OLS intervals. Their assumptions include selected functional form, compatible population, conditional error independence, variance behavior and fitted-scale distribution. Source pairing, sensor drift, additional laboratory error and model selection are not automatically quantified. The complete interval interpretation and assumptions stay in the report.

### Predictions and support

Predictions first rebuild the exact fit. Target, site, sensor identity, optical method and turbidity unit must match. Each row retains actual source support, quantities, training-range comparisons and outcome.

Explicitly choose **block** or **flag** for values outside training ranges. Flagged values remain identified as extrapolated. Negative linear estimates remain nonphysical rather than being clamped to zero. Missing predictors and incompatible log inputs stay unresolved. Every requested row is retained.

Predictions apply at supplied observation support. The feature creates no finer-time interpolation, missing observations or future turbidity forecasts. Estimates remain mg/L. It does not integrate mass loads, establish catchment correspondence, or convert native modeled landscape delivery into measured intake concentration.

## Reports and downloads

`engine/sediment_reports.mjs` renders the stored results without fitting another model. The standalone HTML needs no external JavaScript, style, font or chart service.

Its sections cover model, training/validation, residuals, uncertainty, pairs, predictions, source files and scientific definition. Grayscale observed-versus-estimated, residual and deployment-interval plots include every calculated point. Tables retain excluded and unresolved rows.

The complete original study is embedded, including source text. Download controls supply original text and complete CSV/JSON. Pairing and prediction details expand directly from that one complete embedded study. Closing those sections releases their displayed text; the report retains every source byte without duplicating the full scientific object in the initial page. Date-only observations retain their precision and appear on their calendar date in the plot.

| Download | Complete content |
| --- | --- |
| Study JSON | Definition, source bytes/mappings/origin/rejections/review contexts, pairing, fit and predictions |
| Pairs CSV | Quantities, units, original identities, time support, issues and original pair JSON |
| Residuals CSV | Every train/validation/excluded outcome, intervals, diagnostics and selection reason |
| Predictions CSV | Every requested observation, unresolved/range decisions, intervals and complete input/outcome |
| Coefficients CSV | Coefficients, standard errors, intervals, transforms, training count and smearing |
| Sediment project | Studies and ancestry, unfinished drafts, requests and captured inputs |

CSV numeric values retain stored precision. Text uses the original Measurements spreadsheet-safe prefix convention; JSON keeps original strings exactly. Original downloads contain the UTF-8 text retained by the original import.

## HTTP and CLI

The Node handler extends `/api/measurement-workspace/sediment/`. The authenticated Python application uses its existing Measurements bridge and remains the authentication/workspace owner.

| Method / suffix | Operation |
| --- | --- |
| GET `catalogue` | Original sources, editions, drafts and workspace identity/revision |
| POST `observations` | Full selected observation catalogue |
| POST `pairs-preview` | Complete source-bound pairing |
| POST `preview` | Scientific preview |
| POST `save` | Exact UUID/revision/preview-protected save |
| POST `drafts` | Unfinished work with captured sources |
| GET `studies/:SHA` | Rebuild/read a saved edition |
| GET `drafts/:UUID` | Read unfinished work |
| GET `requests/:UUID` | Recover original command outcome |
| POST `abandon` | Explicit retirement of an uncommitted save |
| GET `project` | Complete sediment project |
| POST `receive` | Receive complete ancestry and outcomes |
| GET `studies/:SHA/report.html` | Complete offline report |
| GET `studies/:SHA/pairs.csv` | Complete pairs |
| GET `studies/:SHA/residuals.csv` | Complete model outcomes |
| GET `studies/:SHA/predictions.csv` | Complete predictions |
| GET `studies/:SHA/coefficients.csv` | Model coefficients |

The original native SQLite runtime requires Node **22.16 or later**. From the repository root:

~~~sh
node opportunities/upstate_forever_2026/measurement_workspace/engine/cli.mjs sediment-catalogue --workspace ACTUAL_MEASUREMENTS_DIRECTORY --output sediment-catalogue.json
node opportunities/upstate_forever_2026/measurement_workspace/engine/cli.mjs sediment-preview --workspace ACTUAL_MEASUREMENTS_DIRECTORY --file complete-preview-input.json --output complete-preview.json
node opportunities/upstate_forever_2026/measurement_workspace/engine/cli.mjs sediment-save --workspace ACTUAL_MEASUREMENTS_DIRECTORY --file exact-save-request.json --output saved-result.json
node opportunities/upstate_forever_2026/measurement_workspace/engine/cli.mjs sediment-report --workspace ACTUAL_MEASUREMENTS_DIRECTORY --id SAVED_EDITION_SHA256 --output sediment-report.html
node opportunities/upstate_forever_2026/measurement_workspace/engine/cli.mjs sediment-project --workspace ACTUAL_MEASUREMENTS_DIRECTORY --output complete-sediment-project.json
~~~

Use the existing workspace directory and application listener. Avoid a second writer on an application-owned SQLite store.

The exact definition contains `study_id`, `parent_id`, `title`, `actor`, `at`, `note`, `selection`, `model`, `deployment` and `source_basis`. Model controls include `form`, `includeDischarge`, `validationMode`, `confidence`, `rationale` and one `cohorts` assignment per pair. Preserve the complete original source/pair identities supplied by the catalogue.

Preview accepts `{definition}`. Save requires `request_id`, `expected_revision`, `expected_preview_id` and the complete `definition`. Project receive requires `request_id`, `actor`, `at`, `note` and complete `project`. Retain exact request bytes across retries.

## Real published reference

The included dataset is the complete 120-row table in Attachment B of the [USGS 2016 sediment surrogate memorandum](https://water.usgs.gov/admin/memo/SW/sw.2016.07%2Bwq.2016.10.pdf): station **07144100, Little Arkansas River near Sedgwick, Kansas**, July 27, 2004 through August 4, 2014, SSC mg/L, YSI 6136 turbidity FNU and discharge ft³/s.

Files under `reference/` preserve extracted publication text, attributed numerical CSV and complete provenance. All 120 numbered samples remain, with 115 distinct dates including separate samples on the same day. Values have the precision printed by the publication, rather than the unrounded laboratory/sensor export. Fitting uses the raw SSC/turbidity/discharge columns and recomputes logs, preserving the publication's fitted columns solely as source evidence.

Published equation:

~~~text
log10(SSC mg/L)
  = 0.262 + 0.933 log10(turbidity FNU)
          + 0.0431 log10(discharge ft3/s)
~~~

The archive reports a retransformation factor around 1.02. A model expressed with discharge m³/s requires an intercept conversion before comparison.

The reference course distinguishes:

1. **All 120 calibration reproduction:** all published rows are training rows, for comparison with the rounded archive coefficients.
2. **Later-date validation:** 68 samples before 2012-01-01 are training; 52 from that date onward are validation. This newly declared split is separate from the author's cross-validation.

Sample row identity retains concurrent quantities. It invents no storm identity, clock time or timezone. The author's seven earlier excluded samples are not reconstructed from unavailable full numerical values.

The course uses the actual original parser, interpretation/pairing and scientific engine. The source adapter preserves untouched publication CSV and attributes site/unit/sensor constants to metadata. Original review records analyst inclusion; publication status is not relabeled as laboratory “Approved.”

This genuine Kansas cohort stays identified by its actual site and sensor. An Upper Savannah study uses its own compatible original observations.

### Executed reference findings

The actual complete 120-row log-log calculation gives turbidity coefficient 0.9331008361, discharge coefficient 0.0431156480 and a cfs-basis intercept 0.2621356468. The training Duan factor is 1.0189662086. These reproduce the archive's rounded 0.933/0.0431/0.262/1.02.

On the fixed68/52 later-date split, log-log held-out RMSE is 28.9884 mg/L, MAE 17.2733 mg/L and mean predicted-minus-observed bias +7.8627 mg/L. Held-out R² is 0.976108; 50 of 52 observations fall within the selected 95% individual prediction intervals. The same cohort produces linear RMSE 35.5194 mg/L and log-linear RMSE 446.8902 mg/L. All candidate results remain retained; the software does not silently select a winner.

Range support changes how those errors should be used:15 of the 52 later observations fall outside at least one training predictor range. Thirteen are below the training discharge minimum 14.5 cfs; two are below the training turbidity minimum 4.37 FNU. Explicit blocking gives 37 estimates and 15 unresolved range outcomes; flagging gives 52 estimates with 15 extrapolated. Favorable aggregate validation statistics do not make those predictor conditions part of the training support.

The pure scientific calculations run in connected V8 on the full genuine dataset. The complete source-integrated/native/browser course retains its own actual operation and result. Reproduce the source course with the included original-reference adapter and runner; use the report outputs from that exact run.

### Reproduce the complete scientific reference

From the repository root, run the included source-only course:

~~~sh
node opportunities/upstate_forever_2026/measurement_workspace/reference/run-sediment-reference.mjs \
  --output /ABSOLUTE/NEW_REFERENCE_OUTPUT \
  --reviewer "Named source reviewer" \
  --review-at "ACTUAL_ISO_REVIEW_TIME" \
  --reason "Rationale for interpreting this complete historical published sample table"
~~~

Supply the review time and attribution deliberately. This course retains its authored review context with the complete original publication files, runs the maintained parser/pairing and scientific modules, and writes the full calculation and artifact inventory. It does not write to an operating Measurements workspace. The application course uses the original import and review operations, saves the resulting study through its actual service and continues with independent receiving.

Keep all four full model outputs and both prediction policies together. A report of only the favorable model would omit the actual comparison. Preserve the complete output inventory, source identities and original execution record when handing the reference to the equipped application owner.

## Methods

Primary source guidance:

- [USGS 2016 memorandum, regression and source-specific surrogate policy, with original calibration example](https://water.usgs.gov/admin/memo/SW/sw.2016.07%2Bwq.2016.10.pdf)
- [USGS Techniques and Methods 3-C4, Computing Time-Series Suspended-Sediment Concentrations and Loads from In-Stream Turbidity-Sensor and Streamflow Data](https://pubs.usgs.gov/tm/tm3c4/)
- [NIST regression prediction and interval guidance](https://www.itl.nist.gov/div898/handbook/pmd/section5/pmd512.htm)

The USGS recommended calibration population is contextual scientific guidance, not a new software approval gate. Training adequacy also depends on actual season, hydrology, sampling design, laboratory and sensor methods.

## Operate and receive the actual release

Continue the existing Ecosystem Sciences application receiving course. Compose this full source with current observation-edition, temporal, benchmark, flow and source-reconciliation work. Preserve completed native model operations and already received studies.

On the equipped application, run the genuine reference through original import/review/pairing, inspect both definitions, save and reopen them, operate the full report, download every CSV and JSON, inspect original-text downloads, retain an unfinished edit, recover an original request, export/receive the project and resume a saved edition. Check normal populated, empty, loading and error states at desktop and narrow widths. Open every outgoing attachment and fix observed issues directly.

The following full owner instruction applies to the producing and receiving peers.

Rendered product inspection — owner instruction, 2026-10-13
This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.


Current application direction: `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.4`, and the active root `AGENTS.md`. Continue current original operations and full source/render receiving.
