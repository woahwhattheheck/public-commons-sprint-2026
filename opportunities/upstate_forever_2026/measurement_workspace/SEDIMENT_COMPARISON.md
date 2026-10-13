# Compare saved sediment models on a common held-out population

## Purpose and operator responsibility

The Measurements workspace can compare complete saved sediment study editions against the same explicitly selected laboratory observations. The comparison keeps the original imported source text, source mapping, native review context, sample pairing, model definition and calculated results for each candidate. It reconstructs each study through the maintained sediment service before using its predictions. A complete comparison is portable JSON: the original studies occur once at input.studies, followed by the exact authored selection and the derived comparison.

This capability supports a scientist deciding what a set of candidate models actually explains. It does not choose a model, turn a favorable score into operational approval, or infer independence from separate sample identifiers. The laboratory target, station, sensor, turbidity method and units must agree. SSC and TSS remain separate targets. FNU and NTU are not interchangeable. Measurements of concentration remain mg/L; these comparisons do not calculate sediment mass loads.

The original sediment source interpretation and scientific calculation remain authoritative. See [SOURCE_PAIRING.md](reference/SOURCE_PAIRING.md) for original field mappings, sample-support interpretation, explicit pairing, reviewed exclusions and complete source receiving. See [SCIENTIFIC_REFERENCE.md](reference/SCIENTIFIC_REFERENCE.md) for the published reference and numerical method. This guide documents the additional comparison contract. The existing store and its original request/revision rules own saving, editable drafts, whole-project history and receiving; this module introduces no second database or controller.

## Select actual saved editions

Select at least two full saved study editions. The selected identity is each content-derived study.id; the human-named study_id alone is not sufficient because a named study can have multiple complete editions. Retain an explanatory label and inclusion reason for every candidate. Keep a scientifically unhelpful candidate when it is part of the declared comparison; hiding it changes the comparison.

The complete study format is upstate.sediment-surrogate-study/v1. It includes input.definition, original sources, review contexts and workspace revision, and the result pairing and fit. A coefficient table or fit-only JSON cannot replace this envelope. The comparison calls rebuildSedimentStudy(study.input) and requires complete equality with the supplied study. Changed source bytes, pairing choices, reviews, cohorts, numerical outputs or IDs therefore cause a conflict instead of silently accepting a pasted prediction column.

The comparison accepts any number of candidates that fit the whole-document capacity; there is no arbitrary model-count cap. Current bounds are 100,000 target identities and 128 MiB minus 65,536 bytes for complete JSON. Capacity errors retain the original studies in the caller. Select a smaller scientific scope explicitly if necessary. Do not truncate histories or remove source bodies to force a document through a limit.

All candidates must agree on:

- Exact target SSC or TSS and target response unit mg/L.
- Exact original site identity.
- Complete sensor identity, including turbidity unit and measurement method.
- Original target value and target-specific source support for a sample to be common.

Models may use different supported forms, train on different populations, include different valid predictors or use different confidence levels. These differences are retained in the side-by-side descriptors. A model trained using a target that another model treats as validation cannot contribute that target to common held-out scores. A different predictor support window is visible in pairSupport, while laboratory target support must match exactly for the common target.

## Review the full held-out union

catalogueSedimentComparison(studies) returns the union of target observations that appear in at least one candidate's validation population. It returns every model's corresponding entries, including training, validation, excluded, absent or ambiguous entries. It also returns original calibration metadata and unidentifiable excluded records. The catalogue is an inspection and selection aid, not a statement that all returned targets can be scored together.

A targetId is a SHA-256 identity of the sorted exact source-observation identities in the paired laboratory quantity. The maintained expression is:

    hash(stable({
      kind: 'sediment-target-observations',
      sourceIds: [...ssc.sourceIds].sort()
    }))

These are original record/JSON-pointer observation identities. They are not merely an imported file hash, a date, a station, an array index or a row position. Distinct samples taken on the same date stay distinct. A raw-file reimport with different observation identity is not automatically treated as the same sample. Resolve an actual source-identity change in the underlying study; do not guess a correspondence in the comparison.

Every target in the union requires one authored include or exclude choice with a reason. Every selected model likewise requires an inclusion reason. The comparator rejects a missing or duplicated choice and rejects references outside the full union. Retain these choices and their author, zoned timestamp, title, note and overall rationale with the comparison.

For every selected target, each candidate must contain exactly one corresponding pair, use that pair as validation, retain a finite original mean prediction in mg/L, have no unresolved pair issues, and agree on the interpreted target quantity and original support. The target signature preserves analyte, unit, value, site, method, censor status, date, actual zoned instant when present, and original support. The returned raw value and event information remain inspectable. A source identity reused with a conflicting quantity or support is unavailable; it is not repaired with a numeric tolerance or date-only join.

The complete row classifications are:

| Status | Meaning | Included in all candidates' comparison metrics? |
|---|---|---|
| COMMON | Explicitly included; all original target and held-out requirements pass; selected range policy passes | Yes |
| EXCLUDED_BY_AUTHOR | The author explicitly excluded the target with a retained reason | No |
| UNAVAILABLE | At least one model lacks a unique valid held-out result, or target quantity/support differs | No |
| OUTSIDE_COMMON_RANGE | Otherwise common, but at least one candidate is outside its calibration predictor range under in-range-only policy | No |

All statuses keep the full original candidate evidence. A missing entry includes its absence reason. An ambiguous entry retains all matching original pair/outcome entries. Training and excluded entries retain their original cohort reasons. Full studies still include rows without usable laboratory identity; these appear in each descriptor's unidentified list, rather than being falsely joined.

## Choose one explicit range policy

include-flagged scores every otherwise common selected target. Each model's actual predictor value is compared with that model's original training range. Every row retains the status and the exact outside predictor, value, unit, range and source identities. Out-of-range predictions remain flagged.

in-range-only applies a single intersection across all candidates: a target is scored only when every candidate is inside its own training ranges. It does not score a different subset for each model. All removed targets remain in result.rows with OUTSIDE_COMMON_RANGE and their original predictions.

The policy changes the scoring denominator. Scores on 37 common in-range observations cannot be described as scores on all 52 later observations. Store a separate attributed comparison edition for a changed range policy. Do not silently replace a saved comparison with a newly filtered display.

A range flag is evidence of leaving observed calibration support; it is not a complete validity assessment. The fitted model's original guidance, assumptions and scientific limitations remain applicable inside the rectangular range as well. This component does not invent a joint probability or multivariate extrapolation probability.

## Read means, locations and intervals correctly

The comparator reuses each model's unchanged original prediction. It does not refit on the common target population, recompute smearing on validation residuals, or transform a model merely to improve comparability.

For an identity-response model, the original fitted location and arithmetic mean coincide. For a log-response model, the inverse-log fitted location and the estimated arithmetic mean differ. The native mean includes the model's training-only Duan smearing factor. Scores use this original-scale arithmetic mean. The fitted location, linear predictor, leverage, native uncertainty objects and smearing information remain available for inspection.

Individual interval coverage uses prediction.predictionInterval, the original interval for an individual observation. It does not use the fitted-location interval as an interval for the mean. The locationInterval retains its original estimand; no arithmetic-mean confidence interval is fabricated from it.

Candidates may use different nominal confidence levels. The complete comparison records those levels and emits a warning. Empirical coverage at 90% and 95% nominal coverage is not an equivalent-coverage comparison. Broad intervals can cover many observations while providing weak precision, so the result also retains each interval's width and mean width on the common population.

A negative linear concentration estimate is kept as a calculated outcome and flagged as nonphysical. It is not clamped to zero before scoring, and it is not approved as an operational concentration. If arithmetic would exceed finite numerical capacity, a complete result is not silently serialized with nonfinite numbers.

## Exact metric denominators

For each candidate, let C be the exact same ordered set of rows with common:true after the author's choices and common range policy. Let n be its size; y_i is the retained original laboratory value; m_i is the candidate's original arithmetic-mean prediction; e_i = m_i - y_i. All concentration metrics use mg/L.

- RMSE = square root of sum(e_i squared) / n.
- MAE = sum(abs(e_i)) / n.
- Bias = sum(e_i) / n. Positive bias means mean overprediction.
- Predictive R-squared = 1 - sum(e_i squared) / sum((y_i - mean(y)) squared), where mean(y) is calculated on this common population.
- Empirical interval coverage = number of original individual prediction intervals containing y_i / n, only when all n intervals are available.
- Mean interval width = sum(upper_i - lower_i) / n, only when all n widths are available.

These definitions have no degrees-of-freedom adjustment. R-squared can be negative and is preserved. When the common target has zero variation, R-squared is null with an explicit reason. If no target can be scored, metric status is UNAVAILABLE, count is zero and scores are null, rather than fabricated zeros. IntervalCounts retains covered, available and requested counts so a partial interval denominator cannot be confused with n.

The result retains the actual targetIds used in every candidate's metric. The candidate descriptors separately retain originalStatistics, including original training/validation and response-scale values. Models on different response transformations must not be ranked by unadjusted fitted-scale SSE, R-squared or AIC. Common original-scale predictive errors are a different, explicitly defined comparison.

## Model selection consumes the holdout

This is an exploratory comparison of declared candidates. If a scientist uses these scores, plots, residuals or intervals to choose or tune a model, the observation set has been used for selection. These same values are not independent final validation of that choice. Record the decision and arrange an appropriate subsequent validation design under scientific direction.

A declared sample/event ID can establish an exact source correspondence and can detect reuse across original train/validation populations. It does not demonstrate independent hydrologic events. The published reference uses numbered samples; storm grouping is unknown. The comparison retains each model's cohort separation, source reuse, hydrologic grouping status and original event information. It provides no p-values or asserted effective sample size.

No row is dropped because its error is inconvenient. Scientists can author an exclusion with a reason, but the original outcome remains in the result. A saved comparison should make the change in denominator and the reason visible to a later reviewer.

## API and complete portable result

The additive module is engine/sediment_comparison.mjs. It exports:

    catalogueSedimentComparison(studies)
    compareSedimentStudies(studies, selection)
    reopenSedimentComparison(document)
    sedimentTargetIdentity(sourceIds)

sedimentComparisonCatalogue is an alias for catalogueSedimentComparison. All functions are pure with respect to the workspace. They reconstruct complete sources and results but do not save, import, mutate a review, open an HTTP server or launch a browser.

The exact selection shape is:

    {
      schema: "upstate.sediment-model-comparison-selection/v1",
      id: "<canonical UUID>",
      title: "<comparison title>",
      actor: "<author>",
      at: "<explicit zoned ISO time>",
      note: "<retained note>",
      models: [
        { studyId: "<complete saved edition SHA>", label: "<label>", reason: "<why included>" }
      ],
      observations: [
        { targetId: "<catalogue target SHA>", action: "include", reason: "<selection rationale>" }
      ],
      rangePolicy: "include-flagged",
      rationale: "<overall scientific rationale>"
    }

Every supplied model and catalogue target appears once. action can be include or exclude. rangePolicy can be include-flagged or in-range-only. Authoring time cannot predate a selected model's definition.

The returned document has schema upstate.sediment-model-comparison/v1. Its id hashes the stable complete input, containing input.studies and input.selection. Each full study occurs once, at input.studies. Descriptors and rows elsewhere contain measured context and IDs, not another full copy of every study.

result.sourceBinding records target, site, sensor and response unit. result.counts records model count, union held-out targets, explicit include/exclude counts, common count, unavailable count and outside-common-range count. result.models contains coefficients, original-unit predictor metadata, original fitted-scale statistics, common metrics, full calibration/held-out/excluded populations and original guidance. result.rows contains every selected target and candidate outcome. result.warnings and result.interpretation state the relevant uncertainty and use limitations.

To cold-reopen, read the whole document and call reopenSedimentComparison. It rebuilds each original study through its retained source and review inputs, recalculates the exact authored comparison, and compares the complete returned body with the supplied document. Changing a source, omitted population, predicted value, choice, summary, warning or ID causes a conflict. A summary CSV alone cannot cold-reopen the model provenance.

The host's saved comparison definition may refer to this one complete input and retain its own original request, revision, ancestry and title. It should not duplicate the full studies both inside and outside the core document. Whole project receiving remains responsible for preserving editable study ancestors and original request history beyond the chosen comparison editions.

## Genuine three-model reference exercise

The included source exercise uses all 120 published samples for USGS station 07144100, with 68 samples before the explicit 2012 calendar cutoff used for fitting and the later 52 held out. The original source is Attachment B of the USGS memorandum at https://water.usgs.gov/admin/memo/SW/sw.2016.07%2Bwq.2016.10.pdf . Complete retained table text, original CSV and provenance are already in reference/. The CSV SHA-256 is 7783717d890ffc902096823a626b080cbaa457bc82977ebe97961abc74881e26.

SSC is mg/L; turbidity is YSI 6136 FNU. Discharge is explicitly converted from published cubic feet per second using 0.028316846592 cubic metres per second per cubic foot per second. Dates have no invented time or timezone, and separate same-date samples are preserved. Original source constants and the exact three-column/row correspondence remain in every rebuilt study.

The three model forms are log-log, linear and log-linear, all with discharge and the same original68/52 cohorts. The actual connected source execution produced:

| Form | Common n | RMSE mg/L | MAE mg/L | Bias mg/L | Predictive R-squared | Covered / n | Mean interval width mg/L |
|---|---:|---:|---:|---:|---:|---:|---:|
| log-log | 52 | 28.988362 | 17.273349 | 7.862697 | 0.976108 | 50 / 52 | 112.169705 |
| linear | 52 | 35.519385 | 19.549308 | 13.770548 | 0.964130 | 52 / 52 | 492.141796 |
| log-linear | 52 | 446.890193 | 100.200040 | 65.219569 | -4.678132 | 47 / 52 | 699.113195 |

Each candidate has15 targets outside its training predictor ranges. Under the separately authored common in-range policy, all52 targets remain visible,37 are scored and15 are OUTSIDE_COMMON_RANGE:

| Form | Common n | RMSE mg/L | MAE mg/L | Bias mg/L | Predictive R-squared | Covered / n | Mean interval width mg/L |
|---|---:|---:|---:|---:|---:|---:|---:|
| log-log | 37 | 34.063955 | 22.078056 | 10.700114 | 0.974305 | 37 / 37 | 142.292257 |
| linear | 37 | 41.435286 | 24.412196 | 16.773389 | 0.961981 | 37 / 37 | 492.457936 |
| log-linear | 37 | 529.196358 | 127.425352 | 79.255829 | -5.201505 | 37 / 37 | 879.578338 |

The narrower range population did not make errors smaller in this example. The log-linear candidate remains poor on both populations, and the linear intervals are much wider than the log-log intervals. These are measured descriptive results on this historical dataset, not an automatic winning-model rule or a performance promise for another site.

The source exercise uses openly authored include-review contexts. The full source-derived study envelopes are shaped exactly like saved studies and are rebuilt by the actual service, but a connected calculation does not create a SQLite save receipt, a native review, an operated browser or a field deployment.

## Reproduce from the original complete reference study

First use the existing run-sediment-reference.mjs course to obtain its complete service-study.json, or use a complete equivalent original reference input from the maintained service. Keep its actual original files. The comparison runner reads that complete study, verifies its service rebuild and genuine reference population, then generates the three explicitly labeled source-exercise candidates through the same service.

From the measurement_workspace directory:

    node reference/run-sediment-comparison.mjs \
      --study /ABS/REFERENCE/service-study.json \
      --output /ABS/COMPARISON \
      --actor "Actual exercise operator" \
      --at "2026-10-13T19:20:00.000Z" \
      --reason "Reproduce all three specified forms on the same published later samples"

Use your actual authoring time and rationale. The paths are absolute. The output parent must already exist. Reuse the same arguments and directory to continue the exact same deterministic output; a different source or options cannot overwrite existing retained artifacts.

The runner retains input.json and the complete original-service-study.json before calculation. It writes two complete documents, comparison-all.json and comparison-in-range.json; a complete comparison-summary.json; source-exercise.json; and two full CSVs. Each CSV has one row per target per candidate, including all52 targets and3 candidates even when only37 are scored. It includes selection reasons, target/support identity, original mean and location, interval endpoints/coverage, errors, range status and unresolved reasons.

The runner rereads the actual delivered comparison-all.json and cold-rebuilds it. execution.json records actual runtime/version, source file hashes, all artifact bytes/hashes and both comparison IDs/counts. It is emitted only after complete output publication and reopen. Existing files are reused only after exact equality; publication uses an atomic no-replace hard link followed by directory sync and settlement of the exact temporary alias. The course owns no native workspace and does not start a second original operation.

A runtime receipt is evidence about that execution. The JSON/CSV source calculation can be complete while the installed application's rendered receiving remains with its existing equipped owner. Use the original Eco programme and source owner for those surfaces.

## Use and inspect the integrated product

In the existing Measurements application, select saved study editions, open the complete target catalogue, author the target choices/range policy and inspect the common result. Check which original validation rows were retained or lost and why; inspect paired model estimates and intervals; compare original calibration populations, coefficients and source metadata. Save through the same original workspace revision and request mechanism, reopen the named comparison, and continue an explicit later edition if the scientific selection changes.

Export the complete comparison and the original full project when editable ancestry is required. Cold-receive into an explicitly selected original application branch, reopen the retained comparison, inspect its original study/source bodies and continue a changed selection without overwriting the prior edition. Keep whole outputs when a capacity error requires a smaller later selection.

The responsible equipped receiving owner must open the actual outgoing installed page and downloads, operate the controls, inspect desktop and narrow layouts, view actual screenshots and reopen the complete delivered files. Source calculations and a correct metric table do not substitute for seeing the recipient-facing product. The complete owner direction is retained in SOURCE_PAIRING.md and is reproduced below for this additive handoff.


<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->
