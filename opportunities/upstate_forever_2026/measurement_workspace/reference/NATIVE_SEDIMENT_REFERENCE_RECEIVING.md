# Native receiving of the published sediment reference

## One original receiving operation

The additive `reference/receive-sediment-reference.mjs` course uses the existing Measurements application and its original SQLite implementation. It imports the complete published USGS table through the maintained reference adapter, applies the explicitly attributed source-review requests through the original revision checks, saves the complete scientific models, and transfers the full saved project to independent receiving workspaces.

The module borrows three already-owned `MeasurementWorkspace` handles. It never opens or closes a database, starts an HTTP service or browser, launches a child, acquires a new controller, or signals another owner. Continue the accepting public-reference host's original operation and runtime. The existing customer-data receiving course remains separate.

The caller supplies an ownership assertion that returns true only while that same original operation lease remains held. The module calls it before native effects. This is a join to the caller's maintained ownership, not a new lease implementation. Do not substitute a constant true callback in an actual receiving invocation.

The completed native result is `NATIVE_COMPLETE_RENDER_PENDING`. That status describes actual native operations only. Actual rendered inspection remains with the same equipped owner and must include the application, reports, attachments and independently reopened result.

## What is measured

The source remains the complete 120 numbered published SSC samples for USGS station 07144100, Little Arkansas River near Sedgwick, Kansas. The table has 115 dates, without clock times or a timezone. Numbered samples bind the simultaneous SSC, YSI 6136 FNU and discharge columns; they do not establish independent storms. The original author removed seven samples before the published table. This course retains all 120 published samples and makes no additional removal.

The reference CSV, provenance and complete source extraction are copied unchanged into the receiving output. The adapter's 360 long-form measurements are a declared interchange projection of that published table, not an original WQP stream or Upper Savannah field dataset. SSC, TSS and nutrients remain distinct.

Four saved native studies retain:

| Named study | Training | Validation | Predictors and response |
| --- | ---: | ---: | --- |
| Calibration reproduction | 120 | 0 | log10 SSC against log10 turbidity and log10 discharge |
| Temporal log-log | 68 | 52 | log10 SSC against log10 turbidity and log10 discharge |
| Temporal linear | 68 | 52 | SSC against turbidity and discharge |
| Temporal log-linear | 68 | 52 | log10 SSC against turbidity and discharge |

The calendar cutoff is explicitly 2012-01-01. These are four retained scientific choices, without an automatic winner. Comparing the three candidates on this holdout consumes that evidence for model choice; it does not create a new independent validation population.

The temporal studies retain the explicit `flag` deployment policy. A separate actual native preview retains `block` handling on the same temporal log-log fit. The receiver then saves a following block-policy edition in the same named study, with its parent and complete historical source basis retained. Both policies keep all 52 source-bound prediction rows, including unresolved or flagged rows.

## Exact caller API

Import from the selected complete source:

~~~js
import {
  createSedimentReferenceReceivingPlan,
  receiveSedimentReference,
  verifySedimentReferenceColdReopen
} from './reference/receive-sediment-reference.mjs';
~~~

`createSedimentReferenceReceivingPlan(options)` is pure. Its options are:

~~~js
{
  operationId, // the existing public-reference receiving operation, not a new run
  actor,       // named scientific author
  reviewer,    // source reviewer explicitly accepting the published reference
  reason,      // complete source-review rationale
  at,          // actual explicit UTC ISO time, with optional millisecond precision
  note,        // receiving and scientific context
  bindings: {
    author: '/absolute/canonical/original/author-workspace',
    receiver: '/absolute/canonical/independent/receiver-workspace',
    cold: '/absolute/canonical/independent/cold-workspace'
  },
  sources: {
    csv: completeOriginalCsvText,
    provenance: completeOriginalProvenanceText,
    extraction: completeOriginalExtractionText
  }
}
~~~

The operation ID determines stable custom UUIDv8 identities for each original save/receive request and each named study. The complete source texts, attribution, time, physical workspace paths and all IDs are written and fsynced in `command-manifest.json` before the first native import or source-review effect. Every subsequent request body is likewise frozen before dispatch. The course never generates a different retry UUID or timestamp after a failure.

The physical paths must be distinct, absolute canonical real directories. The caller has already opened the original `MeasurementWorkspace` handles at those paths. The output directory has an existing parent and is separate from the three workspace directories.

The native call is synchronous:

~~~js
const result = receiveSedimentReference({
  author: originalAuthorHandle,
  receiver: originalReceivingHandle,
  cold: originalColdHandle,
  directory: originalOperationOutputDirectory,
  plan: exactOriginalPlan,
  assertOwner: currentOperationOwnershipAssertion
});
~~~

On first entry the caller constructs the plan from the actual authored choices and source files. On continuation read the already-retained `command-manifest.json` and pass that exact object. Do not recreate a plan with new attribution, time or a new operation ID to bypass an unresolved original operation. If a plan or source file differs, the course stops before adopting it.

The source-only CLI `run-sediment-reference.mjs` remains unchanged and available for calculations without a workspace. This receiving module has no standalone launch CLI because the original owner supplies its already-open workspaces and custody.

## Original import and review behavior

The module calls `importSedimentReference(author, preparation, {applyReviews:false})` first. That maintained adapter verifies the exact three original files and uses the original idempotent import identity. A complete review baseline is then retained before the explicit `applyReviews:true` call.

The adapter writes only currently pending reviews through `MeasurementWorkspace.review` with the current revision. An existing include or exclude remains untouched. The module checks that any decision present in the original baseline did not change during its course. It never substitutes publication status for a laboratory approval.

The original import and measurement-review APIs do not have a command UUID facility. Their real source identity, SQLite revision and original measurement-review events remain authoritative. The receiving plan supplies durable intention; the observed helper outcome and complete original event histories supply the actual result. If an invocation is interrupted after some reviews commit, continuation retains those decisions and applies only remaining pending reviews. The helper's `applied` count is explicitly the count from the observed attempt, not an invented count for a lost earlier response.

An existing exclusion or unresolved source condition stops fitting after retaining the complete observed state. This course cannot authorize replacing that scientist's decision. Reconcile the original source decision through its existing operating workflow and retain that history; do not alter the source, suppress a row or relabel a failed fit as complete.

## Native save, recovery and source editions

Each of the four scientific studies is previewed through `previewSedimentStudy` on the actual current native source context. The exact definition, original workspace revision and complete preview ID are retained before `saveSedimentStudy` is invoked. The result is read back through `sedimentRequest` and `readSedimentStudy`.

If a response is lost after commit, the same immutable request is invoked again. The original service validates its complete request/history and returns the first result. New source/review changes do not silently rebind a pending save to a fresh preview. A stale original request requires explicit scientific reconciliation in the existing application.

All complete studies retain the actual original import records, full source text, mapping, rejected-row accounting, review contexts and scientific inputs. Every fit, residual, uncertainty field and prediction is produced by the maintained scientific module. The receiving course contains no second regression implementation.

The output source inventory records the actual selected parser, normalizer, characteristics, reference adapter, pairing, core, service, report, workspace and receiving module bytes. Historical source-execution results remain bound to their original source edition. A newer maintained normalizer may change canonical source IDs or row order; this course computes IDs from its actual current original parser rather than asserting older fixed IDs.

## Independent receiving and editable continuation

The original author's full `sedimentProject` is frozen and retained. Its exact complete studies, drafts and original request history are received by `receiveSedimentProject` on the independent receiver. This additive project receiving preserves any separate existing work and validates every scientific edition from its full original sources.

All received scientific studies and original requests are read and compared in full. The receiver's following edition uses:

~~~js
{
  parent_id: originalTemporalLogLogStudyId,
  source_basis: {kind: 'study', id: originalTemporalLogLogStudyId},
  deployment: explicitOriginalBlockPolicy
}
~~~

This is a real editable continuation from the retained historical source. The receiver need not physically reimport the observation rows merely to work with that complete saved source edition. The original model validates parent ancestry and source-context equality.

The first receive is then repeated using the exact original UUID and request bytes. Its original result must remain unchanged and the receiver's following edition must still exist. The full following project is exported and received by the third caller-owned workspace. Every original study and request is compared again. Whole native portable workspace documents are also retained for the author, receiver and cold receiver.

None of these operations overwrites the original workspace, replaces a native database file, or clones a live SQLite main file while discarding its WAL. The product's own complete portable documents are the exchange mechanism.

## Real cold reopen

After the above call returns, the original owner closes its cold handle using its maintained lifecycle and independently reopens the same canonical directory with the same original `MeasurementWorkspace` implementation. Only then call:

~~~js
const reopened = verifySedimentReferenceColdReopen({
  workspace: actuallyReopenedColdHandle,
  directory: originalOperationOutputDirectory,
  assertOwner: currentOperationOwnershipAssertion
});
~~~

This reads the full frozen following project, every exact original request result and scientific study, and every enumerated receiving artifact. It writes `cold-reopen-observed.json` only after those original reads agree. Calling this on a handle that has never been closed/reopened would not establish the lifecycle outcome; the caller's actual close/reopen record must accompany it.

The function never closes the borrowed handle and never starts another runtime. The original caller retains all database and operation ownership.

## Complete outputs and interruption behavior

The output contains the complete command manifest, loaded source inventory and full source bodies, source preparation, native review baseline and observed histories, complete reviewed input, all four preview/save requests and results, all four scientific studies, the separate block preview, and a following editable study. It includes the full author/following projects, whole portable workspace documents, request replay observations, cold verification and final result.

Every saved study and the block preview have complete HTML, pairs CSV, residuals CSV, predictions CSV and coefficients CSV. The complete original projected CSV and all three publication attachments accompany the reports. Cold-received study outputs are generated again from the original received bodies and preserved separately.

The final result enumerates expected artifacts and hashes. It never treats whatever happens to be present in a directory as a complete delivery. It uses private create-only, fsynced publication; exact existing bytes are reused. An interrupted partial belonging to the same hash-named publication is repaired only when its bytes are the exact prefix of the expected complete file and it has no other link. Unrelated files are not replaced.

There is no mutable progress head that can claim a phase finished before its original native result exists. Retained request bodies and the original native request registry govern continuation. Source files are frozen for the operation, and a different loaded implementation is rejected by its retained source selection. Missing scientific reports can be regenerated from the same complete native edition; original receipt files that cannot be reconstructed exactly remain explicit recovery issues.

Native completion is not rendered completion. Keep the complete output directory and original operation record together; the accepting owner may package them using its existing delivery mechanism. No archive file is discovered or silently omitted by this module.

## Operate the actual application and every output

Use the same accepted host and browser owner. Open the current Measurements application with the original author workspace selected. Inspect the original published source and review attribution, all 120 sample rows, explicit 68/52 roles, model form, units, sensor method, calendar support and range choices. Open all four named studies and their complete reports. Confirm the poor log-linear result is visible alongside the other candidates and the all-120 calibration is not presented as independent validation.

At desktop and narrow widths, use the source and model controls, inspect residual and observed/predicted plots, expand full source/provenance details, switch block/flag range handling, and retain/reopen an unfinished scientific draft. Inspect the original physical workspace/copy identity during switching and request recovery. Observe actual empty, loading, stale-source and unresolved-source states when the existing workflow reaches them.

Open every HTML and CSV report, the original CSV/provenance/extraction, all complete JSON studies and the portable project through appropriate real viewers. Verify the on-screen source matches the original downloaded bytes at their declared representation; HTML text controls normalize line endings and are not an authority for byte hashing. Download and reopen the complete project through the actual receiving UI, select the independent receiver, open its historical source and edit the following edition. Inspect the actual screenshots you capture.

The following full instruction is part of the original receiving handoff.

Rendered product inspection — owner instruction, 2026-10-13
This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.


