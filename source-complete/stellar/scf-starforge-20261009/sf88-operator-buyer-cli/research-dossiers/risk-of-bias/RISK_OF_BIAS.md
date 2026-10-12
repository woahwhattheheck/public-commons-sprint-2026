# Research Appraisal

Research Appraisal adds a complete source-linked review to an existing Research dossier. A team can define its appraisal protocol, select an exact study or reported result, record independent reviewer answers, compare the submitted versions, publish an adjudication, and continue that work after the complete dossier is received in another installation.

The operator is the **Appraisal** tab in the existing Research application. It uses the dossier's original source occurrences, study registry, extraction results, retained revisions, authenticated listener and portable exports. Browser, typed client, CLI and Merchant operations address those same records.

The included **Project-specific Result Appraisal, version 2026-10-12.1**, is an original MIT-licensed form with five domains and ten questions. Its judgments are authored by the review team. Published instrument metadata, design variants and original source links are retained separately in [method-references.json](./method-references.json). A protocol records the actual instrument and form editions, source URLs, design applicability and rights statement used for its work.

## Open an existing project

Open the maintained Research application through its existing connection, select the dossier, and choose **Appraisal**. The same dossier also contains its questions, source records, eligibility review, study links, extraction and evidence publications.

The selected workspace and dossier are part of browser recovery. The host supplies the actual workspace identity and running instance through its existing state response. Keep the original application origin when recovering a saved browser request. The browser checks the selected workspace and dossier before adopting a delayed response and retains an accepted mutation receipt before changing its displayed context.

The navigation and original source inspector are documented in [BROWSER.md](./BROWSER.md). The domain's complete request and response definitions are in [API.md](./API.md); the typed declarations are in [client.d.mts](./client.d.mts).

A useful complete project has:

- An existing dossier and a precise research question.
- The original reports received as source occurrences, including named source files when available.
- The existing eligibility review and linked study identity.
- A selected immutable extraction result when the appraisal concerns a particular outcome.
- A protocol with at least two distinct reviewers, a resolver and a written disagreement procedure.

A study-scoped assessment can use an existing study directly. A result-scoped assessment also selects the exact reported-result version and its complete original record.

## What the operator retains

| Record | Meaning | Later work |
|---|---|---|
| Review | Question-specific appraisal programme and its description | Retains its protocol history and all linked assessments |
| Protocol | Complete instrument, form, reviewer and disagreement definition | A revised protocol creates a new immutable protocol record |
| Assessment | Stable appraisal family for an explicitly selected study or result | Each source/protocol revision has a new assessment edition |
| Draft | One reviewer's complete working answers and judgments | A correction explicitly names the draft it supersedes |
| Submission | Immutable reviewer decision submitted for comparison | A corrected submission names its earlier submitted version |
| Comparison | Current submitted versions and their value/rationale differences | The complete selected submission set has a native digest |
| Adjudication | Resolver's complete decision and source-based reasoning | A correction names the earlier adjudication and the exact new comparison |
| Impact review | A decision about a detected source, result, protocol or assessment change | The original change fingerprint and earlier decision remain retained |
| Operation | Original request, actor, revision and native result | The same request can recover its original result after an interrupted reply |

The original dossier revision advances once for an accepted mutation. Reads and report exports use an explicit selected revision. The stable assessment ID identifies the family; the assessment edition identifies the source and protocol actually reviewed.

## Define the protocol and assessment

Create the review against the selected question and existing eligibility review. Enter a clear name and purpose. **Use project appraisal form** loads the complete included form into the protocol editor, where the review team can read and adapt its definition before saving.

The protocol contains:

- The instrument's ID, title, version, origin, applicable designs, scope, source URLs and rights statement.
- The form's title, version, domains, questions, field types, permitted judgment values and evidence requirements.
- The named reviewers and resolver IDs.
- The minimum reviewer count and a written disagreement procedure.

Every domain in the included form requires evidence. Each question requires an answer, and the form requires five domain judgments plus an overall judgment.

| Domain | Questions |
|---|---|
| Reported result and source basis | Exact result definition; what the retained reports establish or leave unresolved |
| Formation of the comparison | How groups or samples were formed; consequences of reported formation or baseline features |
| Exposure, care and follow-up | Relevant exposure and follow-up; implications of reported departures or incomplete follow-up |
| Measurement and available observations | Outcome measurement; result-specific available, excluded or missing observations |
| Analysis and choice of reported result | Analysis and available prespecified context; consequences for interpretation |

The available original-form judgment labels are **No material concern identified**, **Concern affects interpretation**, **Material concern**, **Insufficient information**, and **Not applicable**. The reviewer supplies the rationale for each choice.

Create the assessment from the actual study/result picker. The native picker supplies the saved study ID, version and digest and, for a result assessment, the original result ID, version and record digest. Retain those returned selectors together. The result record includes the original row, source bindings, submitted extractions, reported values, denominator/timepoint context and resolution.

Choose the study design and explain its source basis. A target's occurrence IDs and passages show which retained reports support that design. Selecting a protocol or source revision later creates an assessment edition with an explicit reason, so an earlier review continues to identify the material it actually assessed.

## Work with the original source

Use the source inspector from the assessment or an answer. Its named-file selection corresponds to a real member in the retained source bundle. An answer passage has:

~~~json
{
  "occurrenceId": "THE_ORIGINAL_OCCURRENCE_ID",
  "fileName": "NCT03529110_Original_Registry_Study.json",
  "locator": "Original registry baseline characteristic, parameter type",
  "quote": "MEDIAN",
  "jsonPointer": "/resultsSection/baselineCharacteristicsModule/measures/1/paramType",
  "note": "The source explicitly labels the retained age statistic."
}
~~~

Use the actual occurrence ID returned by the existing dossier. The source's file name, pointer and quoted string are independently checked against its retained bytes when the operation is recorded. Ordinary source passages can use the retained row representation; named-file passages resolve through the original source-bundle and typed extraction helpers.

For JSON sources, the original typed resolver keeps literal values, types and source ranges. Preserve reported missing or non-estimable text, units, timepoints, confidence limits and denominator scope. A treatment discontinuation count, an outcome analysis denominator and a category count describe different source facts; each answer should identify the one it uses.

The optional file name supports a real named source member and is limited to 2,048 characters. JSON pointers are limited to 4,096 characters. The native domain validates the complete passage rather than trusting a browser preview.

## Independent review, submission and adjudication

Choose a registered reviewer and complete the ten answers, five domain judgments and overall judgment. Each answer records its status, value, rationale and source basis. A status such as not reported, unavailable or not applicable retains the reason that applies to the selected result.

Save the complete draft. The saved version has an explicit actor and assessment edition. The browser retains the complete original request before sending it, so reopening Recovery can continue that request without changing its ID, expected revision or body.

Submit the intended draft as an immutable reviewer version. The second reviewer completes and submits their own version. Draft selection uses the selected actor; submitted decisions retain their actual attribution in the shared authenticated operator.

Open the comparison. It shows the complete submitted set, value disagreements, rationale variation, reviewer coverage and the actual comparison digest. The resolver considers both submitted versions, records complete answers and judgments, and explains the resolution.

An adjudication uses the exact comparison being displayed:

~~~json
{
  "assessmentId": "THE_STABLE_ASSESSMENT_ID",
  "assessmentEditionId": "THE_SELECTED_ASSESSMENT_EDITION",
  "submissionIds": ["THE_CURRENT_A_SUBMISSION", "THE_CURRENT_B_SUBMISSION"],
  "expectedComparisonSha256": "THE_NATIVE_COMPARISON_SHA256",
  "answers": ["COMPLETE_AUTHORED_ANSWER_OBJECTS"],
  "judgments": ["COMPLETE_AUTHORED_DOMAIN_JUDGMENT_OBJECTS"],
  "overall": {
    "judgment": "insufficient-information",
    "rationale": "THE_RESOLVER_SOURCE_BASED_REASONING",
    "basis": ["COMPLETE_ORIGINAL_SOURCE_PASSAGE_OBJECTS"]
  },
  "supersedes": null,
  "reason": "THE_COMPLETE_REASON_FOR_THIS_RESOLUTION"
}
~~~

The array placeholders above stand for the full objects described in [API.md](./API.md). Copy the native IDs and digest from the selected comparison. The domain refuses a comparison that has changed while the resolver was preparing a decision.

For a correction, retain the earlier draft/submission/adjudication IDs and name them in the appropriate supersedes field. The previous version remains part of the dossier. A new submission changes the current comparison; the original adjudication remains visible with the submitted set that supported it.

## Respond to changed information

The impact view identifies changes to the selected source, study/result, protocol or assessment context. Open the reported before/after records and decide what that change means for this appraisal.

Use **reviewed**, **needs review**, or **out of scope** with the original impact ID, fingerprint and a complete reason. The saved impact decision is tied to that exact change. If the change requires a new appraisal, revise the assessment explicitly, select the current protocol/source edition, and retain the earlier assessment edition.

Additional reports belong in the original source-receiving workflow. A later official protocol, supplementary report or corrected registry record can then be selected as an actual new occurrence and assessment edition. Reviewers can compare its evidence with the prior registry-only assessment while keeping both source histories.

## Reports and portable continuation

Choose the review, assessment edition and dossier revision, then export JSON, CSV, Markdown or HTML. These formats retain the selected form/instrument editions, authored answers and judgments, source passages, submitted comparisons, adjudication, correction history and impact context.

| Format | Intended use |
|---|---|
| JSON | Complete structured appraisal data and source/review history |
| CSV | Selected appraisal table for a review workbook |
| Markdown | Editable narrative and evidence report |
| HTML | Readable report for staff review and delivery |

The complete dossier export also contains appraisal events and all original source blobs. Use the existing Research JSON or gzip receiving command to open that full dossier in another workspace. The receiving store validates the original event transitions alongside the other dossier modules.

A report file is a selected view. The full dossier JSON/gzip is the editable project handover. Keep both in a delivery when the recipient needs to inspect a report and continue the review.

The browser's saved request envelope is bound to its original workspace. The commissioning programme retains those actual envelopes, request bodies, accepted responses, browser state and result files as operator artifacts. The received installation has its own workspace-bound recovery context while the imported dossier preserves the original native requests and decisions.

## CLI

The installed command is the original research-client. Use its existing connection file and workspace directory. Run risk-help for the complete current arguments.

Read one selected page:

~~~sh
research-client risk-view \
  --connection-file "$APPRAISAL_CONNECTION" \
  --directory "$APPRAISAL_WORKSPACE" \
  --id "$APPRAISAL_DOSSIER" \
  --review "$APPRAISAL_REVIEW" \
  --assessment "$APPRAISAL_ASSESSMENT" \
  --assessment-edition "$APPRAISAL_EDITION" \
  --section comparisons \
  --revision "$APPRAISAL_REVISION" \
  --offset 0 --limit 30
~~~

Available sections are overview, reviews, protocols, studies, results, assessments, drafts, submissions, comparisons, adjudications, impact, operations and sources. Use the returned revision on later pages. The next offset belongs to that same selected revision.

Prepare one complete operation in a new file:

~~~sh
research-client risk-prepare \
  --connection-file "$APPRAISAL_CONNECTION" \
  --directory "$APPRAISAL_WORKSPACE" \
  --id "$APPRAISAL_DOSSIER" \
  --review "$APPRAISAL_REVIEW" \
  --action save-draft \
  --actor "$APPRAISAL_REVIEWER_ID" \
  --actor-name "$APPRAISAL_REVIEWER_NAME" \
  --revision "$APPRAISAL_REVISION" \
  --data "$APPRAISAL_COMPLETE_DRAFT_DATA" \
  --out "$APPRAISAL_RETAINED_REQUEST"
~~~

The data file is the complete action data object. Preparation saves the actual workspace/dossier identity, original UUID, selected revision, actor, complete body and digest. It creates the file once.

Submit or recover that exact prepared operation:

~~~sh
research-client risk-review \
  --connection-file "$APPRAISAL_CONNECTION" \
  --directory "$APPRAISAL_WORKSPACE" \
  --id "$APPRAISAL_DOSSIER" \
  --input "$APPRAISAL_RETAINED_REQUEST"
~~~

Named action commands consume that same file: risk-create, risk-protocol, risk-assessment, risk-revise-assessment, risk-draft, risk-submit, risk-adjudicate and risk-impact. Each checks the action retained in the file.

A raw original native request is also accepted. On a lost reply, keep its exact requestId, expectedRevision, actor, reviewId and body. The existing store looks for the original request before evaluating a later current revision; a matching request returns the original operation. A different body is a different reviewed operation and needs its own request identity.

Export a selected report to a new destination:

~~~sh
research-client risk-export \
  --connection-file "$APPRAISAL_CONNECTION" \
  --directory "$APPRAISAL_WORKSPACE" \
  --id "$APPRAISAL_DOSSIER" \
  --review "$APPRAISAL_REVIEW" \
  --assessment "$APPRAISAL_ASSESSMENT" \
  --assessment-edition "$APPRAISAL_EDITION" \
  --revision "$APPRAISAL_REVISION" \
  --format html \
  --out "$APPRAISAL_REPORT"
~~~

The original file writer publishes a complete new file and returns its actual bytes and SHA-256. An existing different destination is preserved.

## Typed client and HTTP

The existing ResearchWorkspaceClient supplies riskOfBias, reviewRiskOfBias and exportRiskOfBias. The appraisal facade checks the returned dossier/selection/revision, page cursor, original request digest and export identity.

~~~js
import {createRiskOfBiasClient} from './risk-of-bias/client.mjs';

export async function receiveAppraisal(client, dossierId, selection, originalRequest, reportFile) {
  const appraisal = createRiskOfBiasClient(client);
  const page = await appraisal.view(dossierId, {
    ...selection,
    section: 'comparisons',
    offset: 0,
    limit: 30,
  });

  const original = await appraisal.review(dossierId, originalRequest);
  const report = await appraisal.export(dossierId, {
    ...selection,
    format: 'html',
    file: reportFile,
  });

  return {page, original, report};
}
~~~

The caller retains and closes its existing client. The example's originalRequest is a complete retained request; if it has already committed, the call receives its original duplicate result.

The original authenticated HTTP routes are:

| Method | Route | Operation |
|---|---|---|
| GET | /api/dossiers/:id/risk-of-bias | Selected revision and one complete page |
| POST | /api/dossiers/:id/risk-of-bias/reviews?projection=metadata | Complete original native request |
| GET | /api/dossiers/:id/risk-of-bias/export | Selected report format and original download |

Use the original session connection and existing response handling. Native field names are dossierId, reviewId, assessmentId, assessmentEditionId, revision, section, actorId, offset and limit. A read returns its explicit total and nextOffset. Mutations return the original dossier metadata, immutable operation and duplicate flag.

## Merchant integration

The existing Research attachment exposes:

- merchant_research_risk_view for the same thirteen read sections.
- merchant_research_risk_review for one complete retained native request.
- Existing Research export operations with risk-json, risk-csv, risk-markdown and risk-html kinds.

Merchant review arguments contain workspace, dossierId, requestId, expectedRevision, actor, action, optional reviewId and dataJson. Serialize only the complete native action data object into dataJson; the adapter restores it before calling the original typed client. The native request's identity and body stay intact.

For selected exports, use reviewId, assessmentId, assessmentEditionId, actorId and revision as applicable. riskSection is the appraisal section field in the shared export operation. The original retained-file reader receives and verifies the exported file using its returned identity.

The receiving-transports.mjs consumer exercises the existing SDK, actual shared CLI and original Merchant attachment against one already-committed request. It first locates that request in the pinned operations page, recovers the same operation through each interface, receives all four report formats and compares their actual complete bytes.

## Original NCT03529110 commissioning case

The included [study-case.json](./study-case.json) contains the complete independent reviewer material and resolver reasoning for the original NCT03529110 result. [study-case.mjs](./study-case.mjs) binds it to the study and reported result created by the existing full extraction programme.

Original retained source identities:

| Input | Bytes | SHA-256 |
|---|---:|---|
| NCT03529110_Original_Registry_Study.json | 99,951 | 1e8f401843a30673b2d653ceb2682ad8f6d038af268a185c3333028d339d14c1 |
| Original source locator/provenance | 923 | 97e7af80fa105e38307228f657744d6ecd0ac0da20f023ee8677ad01ceef8720 |
| Existing complete result projection | 22,605 | 26fe9d252136ec2e2428c2c04dd7afa9f0ab4b5a70b0e8dabc20c8802fe4c093 |

Source: [ClinicalTrials.gov NCT03529110](https://clinicaltrials.gov/study/NCT03529110). The exact retained original capture remains authoritative for the programme; its provenance file records the original acquisition.

The selected result is the first primary BICR progression-free-survival measurement, row outcome-0-class-0-category-0-measurement-0 in the original extraction result set. The binder reads the actual native resolved result ID, immutable record revision and record digest. It keeps the full original result record and the exact study ID/version/digest.

The complete original extraction still contains fourteen measurement cells across five outcomes and seven categories. This appraisal selects one reported result from that same population. It retains the source's full-analysis-set denominators of 261 and 263, the reported NA median and NA upper confidence bound for the selected group, the lower bound of 18.5, and the comparator median 6.8 with limits 5.6–8.2. The source attributes non-estimation to insufficient events. All values remain tied to their original group, timepoint, unit and source pointer.

The reviewers distinguish open-label treatment delivery from blinded independent central outcome review. They also distinguish adverse-event or treatment-only discontinuation counts from missing PFS observation counts. The source's baseline age statistic is MEDIAN, with reported values 54.5 and 54.2. The complete answers explain which source details support a judgment and which information remains unresolved.

Reviewer A and reviewer B were authored independently against the original retained record. Their complete ten-answer, five-domain and overall decisions are preserved in the case packet. The resolver retains both versions and explains the substantive difference in the measurement/availability judgment. The original binder checks all 301 passage occurrences against 53 distinct pointers through the maintained typed source resolver.

## Run and resume the complete original programme

Appraisal is composed into the existing study-extraction-workflow.mjs. Use that programme's retained operation ID, directory, original input paths and actual installed browser/runtime. Its current caller already owns the dossier, listeners, source receiving, independent extraction, publications, portable receivers and customer continuation.

The original entry accepts:

~~~sh
node study-extraction-workflow.mjs \
  --operation "$STUDY_OPERATION" \
  --run-directory "$STUDY_RUN_DIRECTORY" \
  --study-file "$STUDY_ORIGINAL_JSON" \
  --provenance-file "$STUDY_ORIGINAL_PROVENANCE" \
  --projection-file "$STUDY_ORIGINAL_PROJECTION" \
  --playwright-module "$STUDY_PLAYWRIGHT_MODULE" \
  --chromium "$STUDY_CHROMIUM" \
  --python "$STUDY_PYTHON"
~~~

Use the same retained values when continuing the operation. The programme's original lock, request files, saved browser origins and completed checkpoints determine where it resumes.

The appraisal joins have five concrete receiving stages:

1. After the original first extraction publication, bind the exact native study/result and author the seven appraisal actions through the real browser: review, assessment, two drafts, two submissions and adjudication.
2. Receive the original client/CLI/Merchant reads, same-request recovery and complete four-format exports on the existing sender.
3. Compare every appraisal read section, source/result/protocol binding, original operation and reviewer history in both existing JSON and gzip receiving copies at the selected dossier revision.
4. Open the received appraisal through the actual browser. Clarify reviewer A's baseline answer to name the source's MEDIAN statistic, retain the reported values, save a superseding draft, submit it and adjudicate the complete new A plus original B comparison.
5. Carry the received appraisal through the existing final reports, full JSON/gzip export, fresh reopen and recurring customer-delivery continuation.

The correction preserves the original two independent submissions and first adjudication. Its final review history has three drafts, three submissions and two adjudications, with the original B submission unchanged. It changes the explanatory wording and adds the actual MEDIAN source passage.

The programme uses its existing cancellation signal and owned browser/child cleanup. The appraisal consumer borrows the original Store and listener. A completed appraisal phase returns its saved result after checking retained artifact identities, so later dossier work can continue without recreating the earlier review.

## Receiving files and result interpretation

The original run directory receives sender-appraisal, json-appraisal-receiving, gzip-appraisal-receiving, received-appraisal and continued-appraisal-receiving directories.

| File group | Contents |
|---|---|
| Bound source case | Actual dossier/question/study/result selection and complete independently authored review packet |
| Browser requests | Exact wire body, actual workspace-bound browser envelope, original accepted response and response attempts |
| Browser continuation | Original receiving-state.json and receiving-result.json |
| Native views | Selected result, complete independent comparison, original and corrected appraisal history |
| Reports | JSON, CSV, Markdown and HTML at their original selected revisions |
| Transport receiving | SDK, actual CLI and Merchant native reads, original duplicate-recovery results and received report files |
| Visual receiving | Actual desktop/narrow screenshots from the author and received inspection contexts |
| Portable comparisons | Same-revision section counts/digests, original operation IDs and exact source/result bindings for the existing full receivers |

The parent result includes appraisal.sender, appraisal.received, appraisal.jsonReceiving, appraisal.gzipReceiving and appraisal.continuedReceiving. Each records its actual selection and verified files. The parent also keeps the original extraction row lineage, evidence-publication editions, eligibility customer handover and recurring customer output.

A saved original request always retains its original revision. The operation result's revision identifies its committed change; the current dossier may legitimately be later. The appraisal phase and full programme retain both values.

When investigating a continuation, start with the saved phase result, its native request and the actual returned operation. Use the existing original workspace and published source cohort. Completed original exports and review histories remain useful inputs for the next customer edition.

## Source and maintenance map

| Source | Responsibility |
|---|---|
| contracts.mjs | Instrument/form/request/source validation and canonical digest |
| model.mjs | Original immutable events, source-bound assessments, reviewer history, comparisons and impact |
| report.mjs | Full selected report and original dossier rendering |
| registry.mjs | Exact existing study/extraction-result descriptors |
| routes.mjs | Original authenticated listener routes |
| browser.mjs, panel.html, browser.css | Complete Appraisal operator and workspace-bound recovery |
| client.mjs, client.d.mts | Typed original client and receipt checks |
| cli.mjs | Existing research-client operations and retained request files |
| form-template.json, method-references.json | Original editable form and separately attributed method references |
| study-case.mjs, study-case.json | Original NCT source binding and complete independent review packet |
| receiving-browser.mjs | Actual author/inspect UI receiving and original request/output retention |
| receiving-transports.mjs | Existing SDK/CLI/Merchant receiving and exact report comparison |
| receiving.mjs | Full appraisal author, original portable comparison and received correction |
| ../study-extraction-workflow.mjs | Sole original commissioning, customer and portable operation |
| ../../../../../stellar-forge/mcp-merchant-operator/research-risk-of-bias.mjs | Existing Merchant adapter |

Shared dossier, server, client, CLI, report and distribution changes compose with their maintained owners. An instrument/form revision, original-source supplement or customer-specific assessment should advance the existing records and programme using their exact current source and selected identities.

Method references and instrument metadata are in [method-references.json](./method-references.json). The full action/field contracts are in [API.md](./API.md), and detailed browser forms and recovery controls are in [BROWSER.md](./BROWSER.md).
