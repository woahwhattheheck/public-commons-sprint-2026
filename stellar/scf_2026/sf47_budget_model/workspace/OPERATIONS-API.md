# SF47 delivery and cash operations — source contract

This is an extension of the original SF47 planning workspace. It preserves budget.py, the current candidate and all planning revisions. It uses the existing Workspace connection, mutex, process lease and idempotent `_transaction` method, and creates only `ops_*` tables.

## Installation delivery queue

`GET /api/operations/{case}/delivery-queue?asOfDate=YYYY-MM-DD` returns the complete current-head work queue. `GET /api/operations/{case}/delivery-queue/export.zip?asOfDate=YYYY-MM-DD` returns its report and complete native case. Omit the date for the current UTC date. Save optional installation coordination with the existing `installation.save` command; receive the full queue ZIP through the existing case import route. [Installation delivery queue](DELIVERY_QUEUE.md) documents the source fields, dated classifications, typed selections and receiving identity.

## Work and invoice intake

The original Operations service adds `list_work_intakes`, `work_intake` and `preview_work_intake`. The `work-intake.upload`, `work-intake.save` and `work-intake.apply` actions execute inside its existing request transaction. Full case exports retain `workIntakes` and current `workIntakeRefs`; receiving validates complete immutable editions and their native record links. Older cases keep their original snapshot shape. [Complete work/invoice source contract](WORK_INTAKE.md) describes fields, routes, CLI and typed/MCP access.

## Installation effort and support

`POST /api/operations/{case}/installation-effort-seed` accepts the current case version, saved Installation identity/edition, selected asOfDate and optional complete same-edition document. Its complete input uses `document.effort.schema = "stellar-forge.sf47-installation-effort.v1"`. Persist it through the original Installation preview/save transaction. `POST /api/operations/{case}/installation-effort-selection` accepts an original forecastId and exact saved Installation selections to return complete native Forecast inputs from reviewed phase remainders. [Installation effort and support](INSTALLATION_EFFORT.md) specifies the SDK/CLI/MCP operation, source pointers, original Work and support meanings, and full receiving.

## Public interfaces

`operations.py`: `Operations(workspace)` with `list(plan_id=None)`, `create(body)`, `read(id)`, `command(id,body)`, `history(id,after=0,limit=100)`, `source(id,source_id)`, `report(id)`, `export(id)`, `import_bundle(raw,name,request_id,actor)`.

`operations_http.py`: `read(handler,parsed)`, `write(handler,parsed)`, `register_static(STATIC)`. Invoke after the original access guard, before planner route matching/body consumption. Existing Problem errors, response helpers and access control remain authoritative.

`operations.mjs`: `mountOperations({container,api,plan,inform,mutationId})`. Render inside the existing app through a Delivery & cash nav entry. This view uses its own versioned commands; preserve planner drafts and hide the planning save bar while it is shown. New `operations.css` is scoped to this root.

`operations_cli.py` exports `register(subparsers, common)` and `operate(workspace, args)`. Registration adds one `operations` command with nested `args.operation`, performs no I/O and preserves `args.command == 'operations'`. The existing CLI passes its already-open Workspace; this module owns exact output files. No second launcher or lock.

## API

GET/POST `/api/operations`, GET `/api/operations/{id}`, POST `/api/operations/{id}/command`, GET `/api/operations/{id}/report`, GET `/api/operations/{id}/history?after=0&limit=100`, GET `/api/operations/{id}/sources/{sourceId}`, GET `/api/operations/{id}/reviews/{reviewId}`, GET `/api/operations/{id}/export.zip`, POST `/api/operations/import`, POST `/api/operations/intake`.

GET list returns `{cases:[{id,planId,planRevision,version,state,name,mode,updatedAt}]}`; optional `?planId=...` filters it. GET history returns `{events,nextAfter,currentVersion}` and supports page sizes1–200. Source downloads preserve exact bytes and use attachment disposition.

Raw ZIP import takes `?name=...`, `X-Request-ID` and URI-encoded `X-Recorded-By`. JSON source intake takes the same selection fields as create plus `packetBase64`; the importer chooses OPERATIONS mode and accepts only the supported original pre-award packet. No source packet ships in the public module.

Create: `{planId,selectedRevision,expectedContentSha256,name,mode,actor,requestId,calendarStart?}`. Mode is OPERATIONS or WALKTHROUGH. Pin the exact source/scenario/planning/report and saved revision. Creating a case does not create an award or alter a plan.

Command: `{expectedVersion,requestId,actor,note,action,data}`. Use the original idempotency transaction. Conflicting case version returns409 OPERATIONS_CONFLICT. Closed cases accept only reopen; old close reviews remain retained.

GET case response: `{program,plan,records,sources,report,reviews}`. Mutation responses are compact receipts: `{id,version,action,kind?,recordId?,businessSha256?}`; read the case after acceptance. Create/import additionally return the receiving original plan identity. Never treat a mutation receipt as a complete case. Record arrays: contributors, work, invoices, cash, awards, deployments, purchases, outcomes. Attachments are private, byte/hash-preserved and only downloaded explicitly.

Actions: source.add, contributor.save, work.save/submit/accept/reopen/void, invoice.save/review/dispute/reopen/void, cash.record/void, award.save, deployment.save, purchase.record/observe/void, outcome.save, review, close, reopen.

## Business distinctions

Actual work carries contributor, optional original cost ID, ISO dates, decimal hours and PREAWARD/GRANT/CUSTOMER/INTERNAL basis. Internal work acceptance is distinct from an external tranche decision. Invoices retain source, contributor, number, dates and exact USD line amounts. Payment allocations determine partial payment/open balance independently of invoice review.

Cash retains original direction, category, date, currency/network/asset, decimal quantity, external reference, optional sourced USD valuation and invoice allocations. No transfer is performed. Reference identity prevents duplicate counting. Non-USD unvalued quantities remain separate. Real refunds are separate cash records; correction voids preserve history. Forecast capital and conditional grant payments never become observed cash automatically.

Award stages and tranche outcomes are explicitly recorded from their original sources. No award, acceptance, customer relationship or payment is inferred. Deployment records retain MERCHANT/BUYER role, TEAM_OPERATED/INDEPENDENT_OPERATOR/CUSTOMER participation, environment, release/source identity and explicit acceptance. Purchases retain original transaction, ledger, stroops, response bytes/hash, request/reservation/merchant-operation joins. TESTNET records remain product operations, outside real revenue.

Review freezes the full case/report with its digest and unresolved items. Close compares that unchanged business state; reopening preserves the original review. Complete ZIP includes the original planner bundle, pinned revision, records/history/reviews, exact source bytes, summaries and CSVs. Original access keys are excluded.

## Receiving run

Use one explicitly labeled WALKTHROUGH case for the complete work/invoice/cash/deployment/close/export/reopen sequence. A separate OPERATIONS case can adopt the actual interest acknowledgement and seven team-operated native testnet purchases. Both keep their original factual stage and source references.


## Source joins and receiving behavior

A case's plan content SHA is the original hash of scenario and planning. Its retained report, saved time and revision note are also preserved. The nested planner archive may contain later revisions; only the selected immutable revision and exact original source identity must match the case's pin before import.

Import validates the original request identity, source program fields, unique frozen-review identities and conflicting original receipt before invoking the original planner importer. Native imports retain all saved reports and source bytes. The receiving plan ID is new, and the selected revision is reread from that new plan. Aggregate exports retain one SQLite read snapshot through the original connection and mutex.

Purchase recovery uses purchase.observe with the existing ID and a reason. Original transaction, intent, request, operation and other known authority joins cannot silently switch. Participation/operator/environment are snapshotted from the original deployment. A later cancellation cannot erase paymentAttempted; complete output does not by itself prove settlement. Missing original intent/timing data is retained as missing.

Review returns a compact receipt with recordId and businessSha256. Close data is {reviewId,expectedReviewSha256}. Review/close/reopen require a note. A changed business snapshot returns409 REVIEW_CONFLICT. The state contains original frozen-review metadata; GET the review ID for its full snapshot and report.

## Minimal original-source integration

The only existing browser/server files changed are server.py, app.mjs and index.html. server.py registers the two static assets and calls operations_http.read/write after its original guard. app.mjs mounts the new view inside its existing main panel and hides the planning save bar while the view is active. index.html loads the scoped stylesheet and labels the original exports as planning exports.

The optional CLI registration already accepted by the original CLI owner remains unchanged. budget.py, sf10_current_candidate.json, model.py, native forecasting, original source bytes and original private process ownership are preserved.

OPERATIONS.md describes the complete operator flow. operations_walkthrough.py attaches to the existing server and retains a private request checkpoint for the single receiving workflow; it creates no additional server or external payment.

## Browser mount lifetime

`mountOperations({container, api, plan, inform, mutationId})` returns `{ready, refresh, dispose, root}` immediately. Await `ready` for the initial retained-case read. The original app calls `dispose()` before replacing this view or closing access. A disposed view suppresses later messages, downloads and rendering, and checks its lifetime immediately before an API dispatch and after its response. File reading and hashing can finish privately after navigation, but cannot submit a new mutation from the old view.

An already-dispatched mutation keeps its original request identity and native receipt. Disposal does not replay that request or infer that it was rejected. Reopening the case reads its retained version, records and history through the original workspace.

## Operating forecasts

The existing original case supports pure preview and immutable saved forecasts. `POST /api/operations/{case}/forecast-preview` takes `{expectedVersion, inputs}` and returns `source`, normalized `inputs`, the complete `report`, and `previewSha256`. The original command route accepts `action:"forecast.save"` with `data:{inputs,expectedPreviewSha256}` plus its existing expectedVersion/operator/note/requestId fields. Save is atomic with the original case event and stable request receipt.

`GET /api/operations/{case}/forecasts` lists summaries. `GET /api/operations/{case}/forecasts/{forecast}` reopens the complete original record and adds its current-source comparison. Appending `/export.zip` downloads complete saved JSON, dated cash/work and other native CSV reports with their file manifest. Full case archives now include the optional `forecasts` collection; old archives remain valid. The receiver checks each complete snapshot, recalculation, digest and original save-event link. See [FORECAST.md](FORECAST.md) for the input fields and all date/payment semantics.

## Portfolio and saved Installation phases

Portfolio allocates the complete remaining task set from one current saved Forecast. The optional phase join binds original commercial task IDs to exact saved Installation editions. The existing Portfolio preview, save, selection and full-case receiving routes remain the native lifecycle.

| Operation | Native selection and result |
| --- | --- |
| `POST /api/operations/{case}/portfolio-seed` | `{expectedVersion, forecastId, installationSelections?, inputs?}`; returns the complete editable input, original Forecast/source tasks and Installation source choices. |
| `POST /api/operations/{case}/portfolio-preview` | `{expectedVersion, inputs}`; returns normalized input, full source, complete report and reviewed `previewSha256`. |
| Original `command`, `action: "portfolio.save"` | `data: {inputs, expectedPreviewSha256}` plus the original version, actor, note and request ID; saves the complete reviewed Portfolio atomically. |
| `GET /api/operations/{case}/portfolios/{portfolioId}` | Reopens the complete saved source, input, results and current-source comparison. |
| `GET /api/operations/{case}/portfolios/{portfolioId}/export.zip` | Downloads the complete saved calculation and its original source. |
| `POST /api/operations/{case}/portfolio-selection` | `{expectedVersion, portfolioId, alternativeId}`; returns complete original Forecast `inputs` and the selected source/date identity. |

A seed selection is `{taskId, installationId, installationRevision, installationSha256}`. Supply the current full draft in optional `inputs` when joining phases into an allocation already being edited. The three-argument SDK seed and the original seed body continue to work. Seed attaches or refreshes base phase plans and preserves all explicit alternative overrides, including `installationPlans: []`.

An optional `inputs.installationPlans` array contains complete plans:

```text
{
  taskId, installationId, installationRevision, installationSha256,
  deliveryPhaseIds: [phaseId, ...], deliveryBoundaryNote,
  phases: [{
    phaseId, remainingHours, effortHours: {resourceId: hours, ...},
    dependsOn: [phaseId, ...], releaseDate, dueDate,
    minBusinessDays, priority, note
  }],
  note
}
```

The service retains every original phase ID and dependency. Remaining-hour and effort values are exact decimal strings or null; dates are civil `YYYY-MM-DD` or null. Phase priority is `null` to inherit the parent task priority or an explicit integer; `100` remains the explicit value 100. Newly seeded phase priorities are null. Phase remainders must total the original commercial task remainder, and each resource-effort map must total its phase remainder. Acceptance observations remain original source fields and never supply remaining effort.

The original aggregate `tasks` array remains complete. A bound parent's release, due date, priority and dependencies govern its phase graph, while its retained aggregate effort map is dormant and its minimum working duration is zero. Explicit delivery phases and the boundary note identify the commercial work window; subsequent support still uses shared resource capacity. An alternative's `installationPlans` replaces that complete field when supplied. Every included plan retains all original phases. An explicit `[]` uses the original aggregate task allocation, including its required resource effort; omission inherits the base phase array. To refresh a selected alternative's source, seed its complete inherited fields as temporary base `inputs` with `alternatives: []`, then retain the returned `installationPlans` as its explicit override in the full original draft.

The native seed exposes `installationCandidates` with exact edition identities, matching task IDs and complete original phase/term metadata. An unavailable candidate retains its source result. Selected source metadata uses schema `stellar-forge.sf47-portfolio-installations.v1` and its native digest. Each alternative's calculated `installationPlans` separates `deliveryStartDate`/`deliveryFinishDate` from `allWorkFinishDate`; phase rows retain `scheduleTaskId`, `deliveryScope`, original observations and the explicit remaining effort. Edit the complete saved `inputs`, preserving the result projection as the reviewed output. See the adjacent [TypeScript declaration](agent-client.d.mts) for the detailed source and result fields.

Both `portfolio.save` and `forecast.save` return `{id, version, action, kind, recordId}`. Reopen `recordId` through its saved read route for `sha256` and `previewSha256`; the receipt's `id` is the case ID. The original transaction resolves exact request replay before a new mutation. Date selection returns a Forecast draft; its preview and save use the existing Forecast implementation.

The complete operations-case export and original import carry the saved Installation editions, exact source attachments, Forecasts, Portfolios and event history. `portfolio_installations.py` supplies the native source/phase join and is retained by both managed runtime selectors. [Portfolio delivery allocation](PORTFOLIO.md), [CLI operation](CLI.md#portfolio-with-installation-phases) and [agent consumption](AGENT.md#portfolio-allocation-and-original-cash-handoff) cover the full receiving workflow.

## Source-bound cohort acceptance

The complete operator and receiving contract is [OPERATIONS-COHORT.md](OPERATIONS-COHORT.md). The evaluator reads the original `deployment_acceptance_plan` from this case's pinned scenario and stores its frozen result in the existing `ops_reviews`/case event transaction.

| Operation | Native interface |
| --- | --- |
| Seed original tranche 2/3 input | `POST /api/operations/{case}/cohort-seed` with `{expectedVersion,tranche}` |
| Evaluate explicit input | `POST /api/operations/{case}/cohort-preview` with `{expectedVersion,inputs}` |
| Freeze exact preview | Original `command` envelope, `action:"cohort.prepare"`, `data:{inputs,expectedPreviewSha256}` |
| Reopen frozen source | Original `GET /api/operations/{case}/reviews/{review}` |
| Export complete evidence | `GET /api/operations/{case}/cohort-reviews/{review}/export.zip` |
| Prepare with selected evidence | Optional `cohortReviewIds` in existing completion preview/prepare data |

The complete reviewed input fields are `name,tranche,windowStart,windowEnd,asOfAt,buyerDeploymentIds,merchantDeploymentIds,operations,facilitators,bindings,products,outcomes,refundCashIds,coverage,awardAcceptance,requiredWork,note`; the seed provides their native structure. Times retain their original ISO strings and explicit timezone, atomic amounts retain exact integers, and effort remains decimal text. Original deployment/intent/source identities remain authoritative. The full input, selected and excluded observations, as-of purchase history, current/gross results, denominator scopes, proposed targets, coverage and source digests are returned by preview.

A frozen review has `purpose:"COHORT_EVALUATION"`, `cohort`, `cohortHistory` and the existing reviewer/snapshot/report/business digest fields. Case review summaries add `cohortTranche,cohortName,cohortWindow,cohortReady,cohortMeasurementSha256,cohortPreviewSha256,cohortSourceCurrent`. No new database or payment action is introduced.

When `cohortReviewIds` is supplied to Completion, the preview embeds `cohortEvidence` and the original measurement history. A wrong tranche, later cutoff, changed measurement source or unmet target is a native preparation finding. Missing optional selection preserves earlier completion payloads and digests. Export/import validates each original cohort against its source snapshot and original preparation event, and preserves all embedded reviews in the complete case.

## Implementation evidence source and review

See [IMPLEMENTATION_EVIDENCE.md](IMPLEMENTATION_EVIDENCE.md) for complete inputs, original-source boundaries and receiving behavior. Read-only POST routes `/api/operations/{case}/implementation-source` and `/implementation-preview` take the current `expectedVersion`. Freezing uses the existing `/command` action `implementation.prepare`, with `data:{inputs,expectedPreviewSha256}` and the unchanged original actor/request fields. Frozen evidence and embedded originals download through `/implementation-reviews/{review}/export.zip` and `/implementation-originals/{source}/{sha256}`. Completion preview/prepare optionally accept `implementationReviewIds`, preserving omitted-field replay semantics.
