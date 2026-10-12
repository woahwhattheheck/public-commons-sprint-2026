# Original study extraction: browser commissioning and receiving

The browser program attaches to the existing Research workspace and dossier
created by the original source owner. It operates the actual Study extraction
interface and original extraction engine. Its own resources are a Playwright
browser/context, a borrowed Research client, complete authored-input files and
a restartable operation journal. The listener, source acquisition, source bundle,
question, eligibility study, original dossier, publication lifecycle and portable
creator remain with their existing owner.

## Inputs and exact scope

The existing study-extraction-case.mjs helper supplies the validated source case
for NCT03529110. Its three original inputs remain:

| Original input | Bytes | Role |
| --- | ---: | --- |
| Original registry study JSON | 99,951 | Exact retained registry source |
| Original capture provenance | 923 | Source and original-capture binding |
| Complete result projection | 22,605 | Original fields and container locations |

The helper binds five outcomes, seven classes, seven categories and fourteen
measurement rows. Each row has thirteen authored fields: reported value, lower
and upper confidence limits, measurement comment, three separate denominator
scopes, unit, parameter type, precision, full time frame, full population and
comparative analyses. The complete extraction contains 182 answers, using 112
original JSON pointers.

The original typed representation is retained throughout. Decimal strings and
numeric tokens are not converted into JavaScript numbers. Missing fields,
reported NA, not-estimable comments and present null values remain distinct.
Outcome, class and category counts retain their separate original containers
and units.

The commissioning source case identifies one intentional operator entry:
extractor B enters the string 79.0 where the registry and extractor A retain
79.7. This is an authored discrepancy in the commissioning workflow. The
source JSON and its source-bound value remain unchanged. The resolver chooses
the original 79.7 submission with a written source-based reason; both original
independent submissions remain available.

## Call the complete original browser program

Use the existing selected Playwright module and Chromium executable. The
function does not install either dependency or start a new Research server.

~~~js
import {runStudyExtractionBrowser} from './study-extraction-browser.mjs';

const authored = await runStudyExtractionBrowser({
  url: originalOperatorUrl,
  dossierId: originalDossier.id,
  questionId: originalQuestion.id,
  studyId: originalStudy.id,
  studyVersion: originalStudy.version,
  sourceCase: boundOriginalSourceCase,
  runDirectory: originalRunDirectory + '/study-browser',
  playwrightModule: existingPlaywrightModule,
  chromiumExecutable: existingChromiumExecutable,
  mode: 'author',
  signal: originalOperationAbortSignal // optional AbortSignal
});
~~~

The original URL has the form /#token=<the original 64-character lowercase
hex token>. The driver preserves that credential and adds the selected dossier
and view=study-extraction. The maintained host moves its token into its original
session storage and removes it from the visible URL. The program does not write
the operator URL, token or request headers into its journal.

The source case must be the complete output of bindStudyExtractionCase.
The driver verifies its original digest, dossier/question selection and full
fourteen-row, 182-answer population. Supply the actual existing eligibility
study ID and version. The source-case helper, existing Research client, extraction
engine, original UI and its IndexedDB helper must be in the composed source.

### Author mode

The program performs twenty actual UI commits:

1. Import the complete authored form through its file control and save form
   edition 1 under the registered resolver.
2. Import all fourteen source-bound result rows and bind them to the actual
   selected study version and saved form.
3. Select extractor A, import all 182 answers, inspect every displayed row and
   field value/type/status, save the complete draft, and submit that saved draft.
4. Select extractor B, import its complete independent 182-answer draft, inspect
   every displayed row and field, and change only the selected value from 79.7
   to 79.0 through the real value editor. Save and submit that complete draft.
5. Use the source-values page to read the original measurement and examples of
   denominator, missing and not-estimable fields from the retained source.
6. Resolve all fourteen results under the registered resolver. Thirteen matching
   rows use consensus with a specific group/source/denominator reason. The
   deliberate differing row uses adjudication: each of its thirteen field
   choices selects extractor A's original submission, with the full discrepancy
   and source interpretation retained.
7. Read the original selected result/history pages, require two saved drafts,
   two submissions, fourteen resolutions and fourteen current resolved results,
   and compare all 182 resolved typed values/statuses with the source case.
8. Download the complete original JSON, Markdown and HTML extraction reports
   through the real UI. Read History and, when present in this browser's original
   request history, download the exact committed adjudication request.
9. Read the evidence-table page without authoring a separate publication, inspect
   the selected review at a 390-pixel viewport, reload the same original entry
   and restore the same selected form/result set.

The original creator can continue with form editions, publications, appraisal,
Merchant/client receiving and full portable delivery using the returned
identities. This function does not take over those separate stages.

### Returned identities and files

The returned record contains:

~~~js
{
  schema: 'sf88-study-extraction-browser-run/v1',
  mode: 'author',
  dossierId, questionId, studyId, studyVersion,
  formId, formEditionId, resultSetId,
  extractionAId, extractionBId,
  submissionAId, submissionBId,
  originalRevision, reviewedRevision, currentRevision,
  reviewRequestFile,
  nativeOutputs: {
    journalFile, resultFile, sourceCaseFile,
    artifacts, requestFiles, screenshots, browserErrors
  },
  completedAt
}
~~~

IDs and revisions come from actual original native responses. No identifier is
constructed from an assumed form or result count. reviewRequestFile names the
exact five-field UI request that committed the intentional row's adjudication.
The complete requestFiles mapping also exposes the form, result-set, both draft,
both submission and fourteen resolution requests for the original caller's
selected replay/receiving stages.

Each retained artifact has its complete path, byte length and SHA-256. UI downloads
keep the original suggested filename in their phase record and use a short,
stable name in the journal directory. The
journal's actual screenshots and browser errors describe what this one
invocation observed. The complete native operation records preserve the actual
original and committed revisions, actor, action, request and returned records.

## Request identity and restart behavior

Before allowing each real UI review POST to leave the browser, the driver writes
the exact request object to its run directory:

~~~json
{
  "requestId": "the-original-browser-generated-UUID",
  "expectedRevision": 1,
  "actor": {"id": "the-selected-original-reviewer", "name": "The selected reviewer"},
  "action": "the-original-extraction-action",
  "data": {}
}
~~~

The numbers and strings above are illustrative field shapes. The retained file
contains the actual complete authored data and actual reviewed revision.

The driver checks the action, actor and complete data against the authored
phase, writes the original request and its journal binding, then releases the
same browser request. It does not replace the browser-generated request ID or
modify the request body.

If the response is lost, run the same function with the same original run
directory and source selection. The original Research client replays only that
exact saved five-field request. The native engine owns request deduplication,
source validation and compare-and-set semantics. A completed request returns
its original operation instead of adding another draft, submission or resolution.

A complete request file can survive immediately before the journal update
fails. The continuation recovers that same file and checks its full data before
allowing a new UI action. A response can likewise be recovered through the
original idempotent API. All former request and response files stay retained.

Complete source, request, response and result files are written through a synced
temporary file and create-only hard-link publication. Incomplete temporary files
never become a complete source/request artifact. The mutable journal is replaced
atomically. A full filesystem therefore leaves the former complete journal and
original request available for continuation.

A definitive original API rejection remains recorded with its original status,
response and expected revision. The driver does not silently change that request's
revision or claim it was committed. The original owning programme can review the
actual current source and disposition before continuing. No new dossier or
replacement native store is created by recovery.

An already completed mode returns its saved result without opening a browser
or repeating authored operations. A partial mode resumes its original phases.
The function closes only its own browser/context and detaches its borrowed
client on completion or interruption; the original Research listener remains
owned by its creator.

## Cancel and resume the original operation

The optional signal accepts the original caller's AbortSignal. A signal that is
already aborted prevents a new invocation. During a run, cancellation aborts
the original client's active network reads or recovery request and closes only
this function's owned browser/context. The listener and its native dossier remain
with the original owner.

The driver finishes retaining any intercepted request before its cancellation
journal is written. A request already released to the original server may have
committed even when its response is lost. Cancellation records status=cancelled
and throws AbortError with code STUDY_BROWSER_CANCELLED plus journalFile and
runDirectory. Supply a new, non-aborted signal with the same original run
directory to reconcile that exact request through the original API. Never
replace its requestId or expectedRevision.

Complete authored input files remain available alongside the journal. A
cancelled phase before its review POST can restore those same inputs; a phase
with a retained POST reconciles the original native operation before another UI
commit. The same recovery handles a complete result file written immediately
before the final journal replacement was interrupted.

## Inspect the actual received copy

After the original creator exports and receives its complete dossier or
workspace through the maintained native portable workflow, attach to that
received copy's actual original URL:

~~~js
const received = await runStudyExtractionBrowser({
  url: receivedOperatorUrl,
  dossierId: receivedDossier.id,
  questionId: originalQuestion.id,
  studyId: selectedResultStudy.id,
  studyVersion: selectedResultStudy.version,
  sourceCase: boundOriginalSourceCase,
  runDirectory: originalRunDirectory + '/received-study-browser',
  playwrightModule: existingPlaywrightModule,
  chromiumExecutable: existingChromiumExecutable,
  mode: 'inspect',
  selection: {
    formId: selectedFormId,
    formEditionId: selectedFormEditionId,
    resultSetId: selectedResultSetId,
    tableId: selectedTableId,
    publicationId: selectedPublicationId,
    reviewedRevision: authored.reviewedRevision
  }
});
~~~

Choose the actual received form/result/publication IDs, including a later
authored edition when the original programme selected it. Supply the study
version belonging to that selected result set. The received copy must retain
the original dossier/question/source identity; its native workspace identity
is established from that received listener.

Inspect mode reads the selected forms, result sets, drafts, independent
submissions, result/resolution history, source values and publication states.
It opens the original UI's selected records, retains screenshots and downloads
the complete JSON/Markdown/HTML extraction reports. When a publication is
selected, it downloads the complete JSON/CSV/Markdown/HTML frozen publication
through the same original UI.

The driver rejects an extraction or publication review POST in inspect mode.
It does not import sources, create a form, save a draft, submit an extraction,
resolve a result or create another publication on the received copy. The
original portable receiver remains the only receiving implementation.

## Retained file layout

Within the supplied original run directory:

- study-extraction-browser.author.json or
  study-extraction-browser.inspect.json is the mutable original journal.
- study-extraction-browser-author/ or study-extraction-browser-inspect/
  contains the exact bound source case, complete authored file inputs,
  actual request and native-response files, selected records, source-value
  observations, complete downloaded reports, screenshots and result.json.
- The returned nativeOutputs names every complete artifact with its byte
  count and SHA-256. It also supplies the selected actual review request.

Keep these files with the original commissioning handoff and receiving
programme. They belong to the same source operation and contain its complete
review provenance. Repository publication of this driver describes source
availability; the caller's actual returned result and original native journal
describe the completed browser/receiving outcome.
