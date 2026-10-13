# Saved sediment model comparisons

TokenJunkieLabs · Upper Savannah Measurements

## Work a complete comparison

A comparison begins with at least two saved, source-bound sediment study editions. Save the candidate fits in the existing sediment workspace first. Each candidate carries its original measured source files, mappings, scientific review context, model specification, training/validation/exclusion decisions and calculated outcomes.

Open **Compare saved models** from the sediment workspace. Select the complete saved candidate editions, give each a readable label and record why it belongs in this comparison. The application retrieves the complete union of original target observations that at least one candidate reserved for validation. Include or exclude every observation explicitly and record the scientific reason. Select the common range policy and inspect the full preview before saving.

The preview shows every candidate on every target in that union, including absent targets, multiple pairings of one original target, training reuse, excluded observations, inconsistent target interpretation and out-of-range predictors. Metrics use only observations with complete common held-out support under the selected policy. All other outcomes remain visible with their reasons.

Save the preview under a named comparison. A subsequent edition retains its parent and the same named comparison identity. Opening an earlier comparison reads the exact saved candidates and original choices. Editing an earlier edition creates a new authored edition with a new timestamp and an explicit retained parent. A saved draft keeps an unfinished selection and the selected immutable study identities without asserting that a scientific comparison is complete.

The maintained application stores comparisons, drafts and request history in the original Measurements exports/events database. The source model and its original scientific authoring workflow remain the authority for candidate fits.

## Scientific meaning

### The target population

The join uses the exact original target-observation source identities. A matching date, row number or position is insufficient. A candidate must have exactly one usable pairing for the target, assign it to validation, retain the same original target value and measurement support, and supply its actual original-scale mean prediction.

A target used in one candidate's training population cannot contribute to the common held-out metrics. An absent or ambiguous pairing is retained as an unavailable outcome. An explicit author exclusion remains an exclusion even if a candidate could predict it. Every target has its own source identity and stated include/exclude reason.

The source binding must agree on target analyte, station/site and sensor identity, including turbidity method and unit. Suspended-sediment concentration and total suspended solids retain separate identities. Candidate discharge usage may differ because that is a legitimate model choice; each actual predictor, unit, support and calibration range remains visible.

The current model core rejects training/validation overlap in original source observations and explicitly declared events. Original sample identity and source disjointness do not establish independent hydrologic events. The comparison retains the candidate's event-grouping assessment.

### Range policy

Choose one of two explicit policies:

| Selection value | Population used for metrics |
| --- | --- |
| include-flagged | Every otherwise valid common held-out observation, including those outside a candidate's training predictor range. |
| in-range-only | Only otherwise valid observations inside every selected candidate's training predictor ranges. |

The second policy uses one common population for every candidate. It does not give each model its own favorable subset. Every out-of-range observation and its per-model predictor/range evidence remains in the full comparison, with status OUTSIDE_COMMON_RANGE.

Range flags describe the actual training predictor minima and maxima. They do not establish environmental suitability, operational approval or independent scientific validation.

### Quantities and denominators

RMSE, mean absolute error and bias use the predicted arithmetic mean on the original target scale in mg/L. Bias means predicted mean minus observed concentration. For a log-response candidate, the original training-only Duan smearing factor is already included in that arithmetic mean. The inverse-log fitted location remains a separate retained quantity.

Original-scale predictive R² is one minus the common-population sum of squared mean-prediction errors divided by the sum of squared deviations of the same observed target population from its mean. It can be negative. Zero observed variation or an unrepresentable numerical ratio produces an explicit unavailable result.

Empirical interval coverage uses each model's original individual-observation prediction interval. It is not coverage of the fitted-location interval and is not an asserted confidence interval for the arithmetic mean. The comparison records covered, available and requested counts. A missing interval cannot silently reduce the denominator. Different candidate nominal interval levels produce a warning and remain individually labeled.

The mean interval width is reported alongside coverage. Very wide intervals can achieve high coverage while providing less useful concentration information. Negative linear-model estimates remain visible in the comparison's errors and nonphysical counts; they are not silently clamped.

Original training and response-scale diagnostics remain available under their original labels. Fitted-scale SSE, R² and unadjusted information criteria from different response transformations are not used as a common-scale ranking.

Choosing or tuning a model using this comparison consumes these held-out observations for model selection. A later claim of independent final validation requires a separate defensible population. The application preserves all candidate outcomes and produces no automatic winner.

## The complete public reference

The maintained reference uses the complete 120 published selected samples for USGS station 07144100, Little Arkansas River near Sedgwick, Kansas, in Attachment B of the USGS 2016 sediment-surrogate memorandum. It is distinct from the Chiques Creek 01575900 source programme.

Original publication: https://water.usgs.gov/admin/memo/SW/sw.2016.07%2Bwq.2016.10.pdf

The original table carries SSC mg/L, YSI 6600/6136 turbidity FNU and discharge ft³/s. Source rows have published dates; the adapter does not invent times of day or timezones. The complete raw values, numbered-row identities, source extraction and provenance accompany the maintained reference. The model uses the actual raw values and exact discharge conversion, rather than fitting the rounded published logarithm columns.

The explicit calendar split trains on 68 samples before 2012-01-01 and reserves 52 samples from that date onward. The three candidates use the same train/validation choice and predictor selection while changing the response/predictor form. The complete all-120 calibration reproduction remains separately labeled.

Actual complete-source comparison on all 52 common held-out observations:

| Candidate | RMSE mg/L | MAE mg/L | Bias mg/L | Predictive R² | Individual interval coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Log-log | 28.9884 | 17.2733 | 7.8627 | 0.976108 | 50/52 |
| Linear | 35.5194 | 19.5493 | 13.7705 | 0.964130 | 52/52 |
| Log-linear | 446.8902 | 100.2000 | 65.2196 | -4.67813 | 47/52 |

Fifteen of the 52 observations lie outside the common training ranges: thirteen below the training discharge minimum and two below the training turbidity minimum. The in-range-only comparison retains all 52 rows and scores the common 37:

| Candidate | Common count | RMSE mg/L | Coverage | Mean individual interval width mg/L |
| --- | ---: | ---: | ---: | ---: |
| Log-log | 37 | 34.063955 | 37/37 | 142.292 |
| Linear | 37 | 41.435286 | 37/37 | 492.458 |
| Log-linear | 37 | 529.196358 | 37/37 | 879.578 |

The subset has higher RMSE for these candidates; excluding out-of-range inputs does not guarantee a numerically better score. The full rows explain the actual population used. These are historical public-reference outcomes under the stated source/model choices, not measurements from an Upper Savannah site.

The complete maintained source reference entry regenerates all candidate inputs, full original studies and both comparison policies. Native reference receiving uses the same existing workspace/parser/service and original author/receiver/cold handles. Original authored source-exercise review context and real native measurement review history have distinct recorded origins.

## Saved editions and storage

A full comparison read is an edition:

~~~json
{
  "format": "upstate.sediment-comparison-edition/v1",
  "id": "EDITION_SHA256",
  "comparison_id": "NAMED_COMPARISON_UUID",
  "parent_id": null,
  "document": {
    "schema": "upstate.sediment-model-comparison/v1",
    "id": "DOCUMENT_SHA256",
    "input": {
      "studies": ["COMPLETE_ORIGINAL_STUDY_OBJECTS"],
      "selection": "COMPLETE_ORIGINAL_SELECTION"
    },
    "result": {
      "sourceBinding": {},
      "counts": {},
      "models": [],
      "rows": [],
      "warnings": [],
      "interpretation": {}
    }
  }
}
~~~

The illustrative strings stand for complete objects, never filenames or substitutes in an actual outgoing edition. The full original studies occur once under document.input.studies. Every outcome and scientific interpretation is retained.

The scientific document identity hashes its complete original studies and selection. The saved edition identity hashes that document identity and its parent. The original selection UUID identifies the named comparison. This separates a named analysis, an immutable scientific result and a particular ancestry position.

The exports database stores a small deterministic recipe for each saved edition. It retains the ordered study identities, exact original selection, document/edition identities, parent and a short derived catalogue summary. Reopening reads the original immutable studies from the same store, rebuilds the maintained comparison and requires exact agreement with that recipe.

This avoids copying multi-megabyte original studies into every database comparison. The original saved studies remain ordinary maintained sediment studies and keep their complete sources and scientific review contexts. A standalone full comparison JSON includes them for independent inspection.

Drafts are immutable saved working copies with their own UUID. A draft can retain an unfinished selection; save a new draft identity for a changed copy. Draft source candidate identities must already be retained in the same original store. Its parent, if present, must be a retained comparison. Browser working copies and selected physical workspace remain explicitly scoped by the operator panel.

## Portable project and receiving

A comparison project has:

~~~json
{
  "format": "upstate.sediment-comparison-project/v1",
  "sediment": {
    "format": "upstate.sediment-surrogate-project/v1",
    "studies": [],
    "drafts": [],
    "requests": []
  },
  "comparisons": [],
  "drafts": [],
  "requests": []
}
~~~

Its sediment member contains the complete existing saved-study project once: all retained original study bodies, draft source snapshots, complete study ancestry, historical source-basis dependencies and original save/receive requests. Comparison recipes reference those exact saved studies. No physical reimport of historical observation rows is necessary merely to reopen a received saved comparison.

The comparison project also retains every comparison edition, unfinished draft and original comparison request. Receiving validates the entire scientific source graph before committing. It reconstructs every comparison from the complete original studies, validates ancestry and draft bases, and checks original request membership in order.

Receiving writes into the same original exports/events store in one transaction. It adds absent immutable members, retains exact existing members and rejects conflicting content at the same identity. The resulting union is checked before commit. Existing separate studies and comparison work remain in the receiver.

The receiving request records the ordered original member identities instead of recursively embedding another full project. Replaying an earlier receive rebuilds its exact original project from retained members and checks both the original project hash and original request hash. A later authored comparison is preserved when the earlier receive is replayed.

The standard whole Measurements portable workspace also validates these comparison families. Receiving through that ordinary workspace route includes the original exports and event history and validates the same source-bound scientific objects.

A project has the current complete JSON capacity of 128 MiB minus 65,536 bytes; an unfinished comparison draft has 4 MiB capacity. These are explicit transfer capacities, not a row truncation rule. The comparator's original target capacity is 100,000. A capacity error retains the original data and requires an explicitly smaller complete selection or project; no head-only file, sampled result or silent row omission is emitted.

## HTTP operations

All routes share the existing Measurements service prefix:

~~~text
/api/measurement-workspace/sediment-comparisons
~~~

| Method and path | Complete operation |
| --- | --- |
| GET /catalogue | Physical workspace identity, saved comparison editions, drafts, available original studies and declared capacities. |
| POST /candidates | Complete union of held-out target identities and original per-candidate support. |
| POST /preview | Full scientific edition rebuilt from chosen saved candidates and exact selection. |
| POST /save | Save the exact inspected preview with original UUID and request bytes. |
| GET /comparisons/:id | Reopen the complete original comparison edition. |
| GET /comparisons/:id/report.html | Complete standalone offline report. |
| GET /comparisons/:id/metrics.csv | Every candidate's common-population metrics and denominators. |
| GET /comparisons/:id/observations.csv | Every original union observation and every candidate outcome, including excluded/unavailable rows. |
| GET /comparisons/:id/coefficients.csv | Original candidate coefficients, units and uncertainty. |
| POST /drafts | Save a complete unfinished working copy with retained source identities. |
| GET /drafts/:id | Reopen the original saved unfinished copy. |
| GET /requests/:uuid | Reconcile the original immutable request and first committed result. |
| POST /abandon | Retire the exact unresolved save request or return its existing committed result. |
| GET /project | Export the full reusable comparison project and original study history. |
| POST /receive | Receive the full project atomically into the selected original store. |

Candidate request:

~~~js
{study_ids: [firstSavedStudySHA, secondSavedStudySHA]}
~~~

Preview request:

~~~js
{
  parent_id: null,
  selection: {
    schema: 'upstate.sediment-model-comparison-selection/v1',
    id: namedComparisonUUID,
    title: 'SSC candidates on the common 2012–2014 holdout',
    actor: scientificAuthor,
    at: actualZonedISOTime,
    note: authoredNote,
    models: [
      {studyId: firstSavedStudySHA, label: 'Candidate A', reason: authoredReasonA},
      {studyId: secondSavedStudySHA, label: 'Candidate B', reason: authoredReasonB}
    ],
    observations: completeCatalogue.targets.map(target => ({
      targetId: target.targetId,
      action: explicitChoiceForThisTarget,
      reason: authoredReasonForThisTarget
    })),
    rangePolicy: 'include-flagged',
    rationale: authoredPopulationAndComparisonRationale
  }
}
~~~

The map illustrates how to preserve the complete target inventory. The actual UI must retain the author's explicit choices; it cannot silently include observations or invent scientific reasons.

Save request:

~~~js
{
  request_id: originalRequestUUID,
  expected_preview_id: inspectedEdition.id,
  selection: exactInspectedSelection,
  parent_id: exactInspectedParent
}
~~~

The selected saved candidates are immutable. Saving requires the exact preview identity, selection and parent; a fresh live observation revision is not substituted for a candidate's captured original source. After a timeout, query the original request UUID. Reuse its exact original bytes for replay. A changed selection or physical workspace needs its own deliberate working-copy/request flow.

Receive request:

~~~js
{
  request_id: originalReceivingUUID,
  actor: receivingAuthor,
  at: actualZonedISOTime,
  note: receivingNote,
  project: completeOriginalComparisonProject
}
~~~

## Command-line operation

Use the original maintained Node CLI and explicit original workspace directory. It requires the same Node runtime as the Measurements application. The native receiving owner supplies any required SQLite runtime flag.

~~~sh
node engine/cli.mjs sediment-comparison-catalogue --workspace /absolute/original-workspace --output catalogue.json
node engine/cli.mjs sediment-comparison-candidates --workspace /absolute/original-workspace --file candidates.json --output full-target-catalogue.json
node engine/cli.mjs sediment-comparison-preview --workspace /absolute/original-workspace --file selection.json --output complete-preview.json
node engine/cli.mjs sediment-comparison-save --workspace /absolute/original-workspace --file original-save-request.json --output save-result.json
node engine/cli.mjs sediment-comparison-read --workspace /absolute/original-workspace --id EDITION_SHA --output complete-edition.json
node engine/cli.mjs sediment-comparison-report --workspace /absolute/original-workspace --id EDITION_SHA --output report.html
node engine/cli.mjs sediment-comparison-project --workspace /absolute/original-workspace --output complete-comparison-project.json
node engine/cli.mjs sediment-comparison-receive --workspace /absolute/receiving-workspace --file original-receive-request.json --output receive-result.json
~~~

The same command family includes metrics, observations, coefficients, drafts, draft, request and abandon. CSV and HTML commands return their native format; retain a matching output extension.

Use a new output path when preserving an earlier command-line artifact. The original CLI writes the selected output file; it is not an immutable archival store. The workspace's saved scientific editions and request identities retain the authoritative originals.

## Reports and operator use

The report is standalone and contains its full original comparison data, source/study downloads and complete CSV exports. Tables and charts retain all candidate outcomes. Large source/detail sections expand from the embedded original data; their closed visual state does not omit bytes from the outgoing document.

Read every metric with its declared common count, range policy, target unit and interval denominator. Inspect excluded and unavailable observations rather than assuming all original validation rows reached the common population. Open the original scientific study for a candidate to inspect its source mapping, review context, model definition, calibration population and original statistics.

Open the exact outgoing report at presentation width and narrow width. Use source/detail controls, every report download and reopening of exported originals. In the actual application, exercise original study selection, candidate labels, per-target decisions, both range policies, preview/save, opening an earlier edition, draft retention, physical-workspace switching and exact request recovery. Receive the complete project into the existing independent receiving workspace and author a following comparison from its retained originals.

Source execution supplies reproducible scientific output. Native SQLite receiving supplies original stored lifecycle behavior. Actual report/application opening and use supplies the rendered product observation. Keep their concrete outputs together under the same original receiving operation and repair the actual remaining behavior in the maintained source.


Rendered product inspection — owner instruction, 2026-10-13
This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.
