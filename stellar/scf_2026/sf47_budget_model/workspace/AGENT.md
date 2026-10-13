# SF47 agent client

agent-client.mjs gives applications typed access to the original planning and delivery service. It uses the same managed launch validation as **Grant planning and delivery** in Applications, and the same authenticated HTTP routes as the browser.

The original Workspace, Operations, forecast and portfolio implementations remain the authorities for saved revisions, source attachments, record states, allocations and calculations. This client opens no SQLite database and stores no alternative business records.

The complete Merchant setup, tools, input references, source-bound pages, downloads, same-ID recovery and receiving workflow are in [Grant workspaces through Merchant MCP](../../../../stellar-forge/mcp-merchant-operator/GRANT_WORKSPACES.md).

## Named financial desk continuity

[FINANCIAL_DESK_RECOVERY.md](FINANCIAL_DESK_RECOVERY.md) documents the complete ten-desk workflow, in-page same-operator sign-in, original pending-action recovery, earlier browser copies, and complete Issuer Terms / Customer Billing editor receiving. The public staff session returns its native `installationId`. Context-bound clients send `X-Grant-Staff` and `X-Grant-Installation` alongside the current cookie/CSRF credentials; the original role, assigned-case and financial command rules remain authoritative. Capture these identifiers before preparing or awaiting a write, and retain the original request body and actor through renewal or response recovery.

## Delivery agenda across selected cases

Open **Delivery agenda** in the original application to review multiple existing cases together, navigate to each original payment or Completion assignment, and export the complete selected cases. The typed client exposes `read('delivery-agenda', {caseIds, asOfDate, expectedVersions})` and `download('delivery-agenda', {...report.selection, format})`. Both use one original workspace snapshot; a supplied version map covers every selected case. The adjacent declarations include the complete report, original case metadata and wrapped native entries.

[Delivery agenda](DELIVERY_AGENDA.md) covers the browser, source navigation, authenticated HTTP, CLI, Python operation, typed client, Merchant tools and complete exports.

## Installation delivery queue

Read `client.read('delivery-queue', {caseId, asOfDate})` and download the complete handover with `client.download('delivery-queue', {caseId, asOfDate})`. The package now includes adjacent TypeScript declarations for the public client, complete queue, installation document and saved-edition workflow. [Installation delivery queue](DELIVERY_QUEUE.md) covers assignment editing, typed consumption, MCP paging, date semantics and complete receiving.

## Installation effort and support

`installationEffortSeed(caseId, body)` prepares the complete document and current native Work inventory for a saved Installation. `installationEffortSelection(caseId, body)` opens a complete original Forecast draft from exact saved effort editions. Effort persists through the existing `installationPreview` and `installationSave` methods. The typed document retains allocations, review identities and source-referenced support windows. [Installation effort and support](INSTALLATION_EFFORT.md) includes the complete seed/save/reopen recipe, hours selection, MCP tools and original receiving flow.

## Complete customer adoption operations

The original Merchant owner now carries native case or Calendar source through whole-plan authoring, pricing, shared capacity scheduling, full comparison, durable source saving and reopening. Use the eleven adoption tools or the typed `grant/cohort-agent` module described in [Complete adoption work through Merchant MCP](COHORT-PLANNING.md#complete-adoption-work-through-merchant-mcp). Full inputs, original funding groups and the native save request remain attached throughout the operation.

### Compare and save competing delivery dates

Use `merchant_grant_adoption_schedule` on the original complete plan, reviewed
document or saved source. Its optional `method` is `FIRST_FIT` (the default) or
`RESOLVE_CONFLICTS`. The latter revisits complete service groups sharing possible
delivery capacity. Enter `maxSearchSteps` only with `RESOLVE_CONFLICTS`; it is a
whole number from 1 through 1,000,000, defaulting to 100,000. The existing
`constraints` or verified `constraintsInput` selection carries the actual service
windows, priorities, spacing and entered daily availability.

Calculate both methods from the same original input and constraints before
choosing the full successor. The resolved result carries `resolution.method`,
`maxSearchSteps`, `visitedSteps`, group totals and every component's original
occurrence identities, outcome and date changes. `RESOLVED` means the whole
competing set was placed. `SEARCH_LIMIT` retains the prior complete allocation
after the selected search effort; `NO_COMPLETE_PLACEMENT` retains it after the
available alternatives were exhausted. The assignment's complete `issues` and
`rejectedDates` identify the remaining capacity or service constraint. Edit the
same original plan or choices to calculate another alternative.

The typed operation uses the original public module:

~~~ts
import {
  scheduleCohortAdoption,
  compareCohortAdoption
} from '@tokenjunkielabs/starforge-merchant/grant/cohort-agent';
import type {
  CohortAdoptionSchedulingInput
} from '@tokenjunkielabs/starforge-merchant/grant/cohort-agent';

const selection: CohortAdoptionSchedulingInput = {
  document: originalSavedDocument,
  constraints: enteredServiceChoices,
  method: 'RESOLVE_CONFLICTS',
  maxSearchSteps: 100000
};
const originalOrder = scheduleCohortAdoption({
  document: originalSavedDocument,
  constraints: enteredServiceChoices
});
const resolved = scheduleCohortAdoption(selection);
const completeComparison = compareCohortAdoption({
  beforeDocument: originalOrder,
  afterDocument: resolved,
  options: {
    title: 'Delivery dates under the same service constraints',
    note: 'Compare both complete allocations before selecting the successor.'
  }
});
~~~

Through MCP, keep the two complete schedule snapshots and call
`merchant_grant_adoption_compare` with their original verified input references.
For the selected allocation, run `adoption_review`, then `adoption_prepare`
and `adoption_save` with the same case version, original request ID and complete
prepared source. Preparation keeps the full original allocation and its
baseline-to-successor comparison in one saved edition. The usual
`adoption_request` resumes its accepted operation and `adoption_open` opens the
exact saved source. Reopening recalculates the retained method and effort.

`adoption_export` returns the whole selected JSON, allocation CSV or readable
HTML. CSV carries the method, effort, component outcome and prior allocation
date on each occurrence. HTML presents the complete competing-group decisions,
remaining constraints and original editable document together. Its funding
groups, source dates and original amounts remain in the retained plan and source.
The saved source also opens in the existing Customer adoption desk and remains
available to the recorded Cohort delivery workflow.

## Original merchant settlements

The browser, CLI and typed client now receive original merchant accounting, period-close and accountant sources into the same case. Use settlementPreview for source inspection and a full selected cash preview, settlementReceive for the original atomic save, and settlementCorrectionPreview/settlementCorrect for reviewed corrections. Read saved editions with read('settlements') and read('settlement'); download('settlement') returns their complete source handover. Adjacent TypeScript declarations retain exact decimal strings, settlement IDs, original cash records and both preview shapes.

[Merchant settlements](SETTLEMENTS.md) covers the complete row decisions, original asset units, separate USD valuation, existing-cash links, correction lifecycle, native routes, CLI, MCP and full-case receiving.

## Direct API

First call inspectGrantAgentBinding with directory and optional scenarioFile, pythonExecutable, allowStart and label. It reads the original host selection without launching a process. Construct a GrantWorkspaceClient from that result.

| Method | Original operation |
| --- | --- |
| open({expectedSelectionSha256?}) | Borrow the verified current managed service, or explicitly start its original launcher when allowStart is true. |
| inspect() | Inspect current original launch and connection ownership. |
| browser() | Obtain the same private original browser access link. |
| read(view, selection) | Original plans, plan revision/history, cases, case/report/history, forecasts, portfolios or review. |
| plan(action, planId, body) | Original estimate, save, restore or clone with current revision. |
| createCase(body) | Original case from the reviewed immutable plan/content hash. |
| command(caseId, body) | Original record/review lifecycle command with current version, actor and request ID. |
| forecastPreview(caseId, expectedVersion, inputs) | Pure original remaining-work and dated cash preview. |
| forecastSave(caseId, body) | Original save against the same input and reviewed preview SHA. |
| portfolioSeed(caseId, expectedVersion, forecastId, options?) | Original editable allocation from a saved forecast, with optional exact Installation editions and a complete existing draft. |
| portfolioPreview(caseId, expectedVersion, inputs) | Original complete resource/day alternatives and cash preview. |
| portfolioSave(caseId, body) | Native portfolio.save with the reviewed input, preview SHA, case version, actor and request ID. |
| portfolioSelection(caseId, expectedVersion, portfolioId, alternativeId) | Native selected dates returned as an original forecast input. |
| supportPreview(caseId, expectedVersion, bytes, filename) | Original SF74 support reader and complete source/deployment preview, without saving. |
| supportReceive(caseId, bytes, body) | Native support.receive, retaining the original file and rendered review with an existing or new deployment in the original case transaction. |
| buyerPreview(caseId, expectedVersion, bytes, filename) | Original SF88 source reader, full job/purchase/deployment review and preview SHA, without saving. |
| buyerReceive(caseId, bytes, body) | Native buyer.receive: explicitly selected original jobs remain associated with their original purchase and accountable buyer deployment. |
| download(kind, selection) | Complete original plan, case, forecast or portfolio ZIP, source, scenario or CSV. |
| importBundle(kind, bytes, body) | Original complete plan or case ZIP receiver. |
| importScenario(bytes, body) | Original source JSON with native byte identity. |
| attach(caseId, bytes, body) | Native source attachment. |
| intake(bytes, body) | Existing original source-intake importer. |
| detach(expectedInstanceId) | Drain the client and close only its own original server, or release a borrowed connection. |
| close() | Final process shutdown; drains requests and closes owned original service. |

Native data responses contain value, bytes, mediaType, status, sha256, source and filename. The value is present for JSON; bytes is always the complete exact HTTP body. The source identifies the actual managed instance and source selection. Native financial strings are passed unchanged.

The service accepts complete bundles up to 32 MiB and original source inputs up to 8 MiB. The client receives complete responses up to 64 MiB. The Merchant layer retains large responses and serves exact arrays and byte chunks, so those responses do not have to fit in a model message.

Mutations retain their original requestId and current version/revision. After an interrupted response, recover the original request with the identical payload. The original database rejects a changed payload under that same ID. The client performs no automatic write retry.

A borrowed Applications instance keeps its existing lifetime. A client-started service uses the same original managed startup and workspace lock; the client drains and closes that owned server on shutdown. Keep the access-fragment URL and private launch record with the original operator.

## Original-currency forecasts and portfolio selection

`forecastPreview` and `forecastSave`, and Merchant's corresponding original tools, accept `fxRates` plus per-project `nativePricing` and native receipt amounts within the same complete input object. Source references, inline inputs and `inputPointer` retain their existing routes. See [Original currencies in operating forecasts](CURRENCY.md) for exact decimals, rate direction, dated sources, original payment and cost credits, rounding and coverage. Portfolio selection preserves these complete inputs; assess both selected-scope and dated-cash coverage before using financial deltas or a frontier.

## Portfolio allocation and original cash handoff

The client uses the same saved Forecast, Portfolio, Installation editions and original case requests as the browser. Read `portfolios` or `portfolio` with the original `caseId`; the saved read also requires `portfolioId`. Download a saved calculation with `download('portfolio', {caseId, portfolioId})`. The complete case ZIP carries the receiving workspace, sources, Installation history, saved Forecasts and saved Portfolios.

### Select the original phase source

The original three-argument `portfolioSeed(caseId, expectedVersion, forecastId)` call remains supported. An optional fourth argument selects exact Installation editions and can retain a complete current draft:

```ts
import type {
  GrantPortfolioInputs,
  GrantPortfolioInstallationSelection
} from './agent-client.mjs';

const current = await client.read('case', { caseId });
const originalSeed = await client.portfolioSeed(
  caseId, current.value.program.version, forecastId
);
// Review the complete candidates and original commercial task IDs.
const installationSelections: GrantPortfolioInstallationSelection[] =
  reviewedEditionSelections;
const draft: GrantPortfolioInputs = existingDraft ?? originalSeed.value.inputs;
const phased = await client.portfolioSeed(
  caseId, current.value.program.version, forecastId,
  { installationSelections, inputs: draft }
);
```

`reviewedEditionSelections` contains the caller's actual `taskId`, `installationId`, `installationRevision` and `installationSha256` selections. `existingDraft` is the complete editable input if work is already in progress. The returned `value.inputs` retains the original task set, resources and alternatives while joining the selected phase source into the base plans. Seed preserves every explicit alternative override, including `installationPlans: []`. Retain the full returned JSON; candidate metadata includes the original owners, quoted hours, dependencies and delivery/support terms.

Enter each phase's explicit remaining hours and resource effort, retain all original phases and dependencies, and select `deliveryPhaseIds` with a `deliveryBoundaryNote`. Phase remainders must equal the original parent remainder; each effort map must equal its phase remainder. The parent's original aggregate effort stays retained while phase effort drives the shared schedule. Set the bound parent's minimum working duration to zero. A phase priority of `null` inherits the aggregate task priority; every integer is explicit, including `100`. Newly seeded phases use `null`. Support after the delivery boundary continues to consume capacity.

The seed copies original quoted phase effort and stated durations when the parent remainder equals the full original quote. Otherwise, remaining effort starts unentered. A current observation/coordination successor keeps the entered base phase draft when its original plan and effort are unchanged. Review a newly revised plan's complete preparation before saving. An explicitly overridden alternative retains its own source edition until it is deliberately refreshed.

An alternative's `installationPlans` is a complete field override. Omission inherits the base array. Each included phase plan retains all its original phases; an explicit `[]` uses the original aggregate tasks and their entered resource effort. Original acceptance observations remain source information; explicit remaining hours are separate inputs.

### Prepare one explicit phase alternative

Source selection updates the base phase plans. To prepare or refresh a named alternative, compose its complete inherited fields as a temporary base, then use the returned phase plans as only that alternative's explicit override. Start with `editedPortfolioInputs`, the full current input after source selection and editing. The empty array is preserved when it is the authored starting point.

```ts
const alternativeDraft: GrantPortfolioInputs = editedPortfolioInputs;
const alternative = alternativeDraft.alternatives.find(item => item.id === alternativeId);
if (!alternative) throw new Error('Select an existing named Portfolio alternative.');
const effective: GrantPortfolioInputs = {
  ...structuredClone(alternativeDraft),
  calendar: structuredClone(alternative.calendar ?? alternativeDraft.calendar),
  resources: structuredClone(alternative.resources ?? alternativeDraft.resources),
  tasks: structuredClone(alternative.tasks ?? alternativeDraft.tasks),
  installationPlans: structuredClone(
    alternative.installationPlans ?? alternativeDraft.installationPlans ?? []
  ),
  alternatives: []
};
const forAlternative = await client.read('case', { caseId });
const preparedAlternative = await client.portfolioSeed(
  caseId, forAlternative.value.program.version, forecastId,
  { installationSelections: reviewedAlternativeSelections, inputs: effective }
);
const refreshedDraft: GrantPortfolioInputs = {
  ...structuredClone(alternativeDraft),
  alternatives: alternativeDraft.alternatives.map(item =>
    item.id === alternativeId
      ? {
          ...structuredClone(item),
          installationPlans: structuredClone(
            preparedAlternative.value.inputs.installationPlans ?? []
          )
        }
      : structuredClone(item)
  )
};
```

`reviewedAlternativeSelections` is the complete set of exact edition selections the caller is applying to that alternative. Review its returned source metadata, phase effort and delivery boundary, then preview `refreshedDraft` as the whole comparison. Every other field and alternative stays in that complete draft.

### Preview, retain the request and reopen the saved result

The following sequence starts after `reviewedInputs` contains the complete authored allocation and the complete preview has been reviewed. The path and request ID are the caller's actual private selections. Save the request before dispatch so an interrupted response can be recovered exactly.

```ts
import { writeFile } from 'node:fs/promises';
import type { GrantModelSaveInput } from './agent-client.mjs';

const beforeSave = await client.read('case', { caseId });
const preview = await client.portfolioPreview(
  caseId, beforeSave.value.program.version, reviewedInputs
);
// Present preview.value, including phase results, findings and original cash.
const request: GrantModelSaveInput = {
  expectedVersion: beforeSave.value.program.version,
  inputs: preview.value.inputs,
  expectedPreviewSha256: preview.value.previewSha256,
  actor,
  note: reviewNote,
  requestId: portfolioRequestId
};
await writeFile(portfolioRequestFile, JSON.stringify({ caseId, request }) + '\n', {
  flag: 'wx', mode: 0o600
});
const saved = await client.portfolioSave(caseId, request);
const portfolioId = saved.value.recordId;
const retained = await client.read('portfolio', { caseId, portfolioId });
await writeFile(portfolioRecordFile, retained.bytes, {
  flag: 'wx', mode: 0o600
});
```

A Portfolio save receipt contains the case `id`, new `version`, `action: 'portfolio.save'`, `kind: 'portfolio'` and saved `recordId`. Reopen `recordId` for the native record's `sha256` and `previewSha256`. The response's outer `sha256` identifies HTTP bytes. Keep these identities with their respective objects.

After an interrupted save, read the retained request file and call `portfolioSave` with the identical case ID and payload. Retain the original request ID, version, input and preview digest even if the case now has a later version. The existing transaction resolves an accepted replay. A definite original stale-source or version conflict requires reopening and reviewing current state before authoring a new request.

### Select dates and save the original Forecast

A saved `READY` alternative can be opened in the original Forecast. The selected delivery boundary governs the commercial work dates; later support remains part of the Portfolio's shared-resource schedule. Read the current case version, select the original saved alternative, then preview the complete returned Forecast input:

```ts
const forSelection = await client.read('case', { caseId });
const selected = await client.portfolioSelection(
  caseId, forSelection.value.program.version, portfolioId, alternativeId
);
const cashPreview = await client.forecastPreview(
  caseId, forSelection.value.program.version, selected.value.inputs
);
// Review the complete original Forecast, including cash and collection timing.
const forecastRequest: GrantModelSaveInput = {
  expectedVersion: forSelection.value.program.version,
  inputs: selected.value.inputs,
  expectedPreviewSha256: cashPreview.value.previewSha256,
  actor,
  note: forecastReviewNote,
  requestId: forecastRequestId
};
await writeFile(forecastRequestFile,
  JSON.stringify({ caseId, request: forecastRequest }) + '\n',
  { flag: 'wx', mode: 0o600 });
const forecastSaved = await client.forecastSave(caseId, forecastRequest);
const forecastRecord = await client.read('forecast', {
  caseId, forecastId: forecastSaved.value.recordId
});
```

Selection is a calculation; `forecastSave` performs the existing original save. Its receipt has the same five fields, with `action: 'forecast.save'` and `kind: 'forecast'`. Native prices, costs, rates, credits, receipt dates and event-dependent terms remain in the complete selected input. Review financial coverage separately from operational readiness. A concurrent case change returns the original service's version/source result.

### Deliver and receive the complete work

Download both the calculation and the whole case as exact native bytes:

```ts
const allocation = await client.download('portfolio', { caseId, portfolioId });
await writeFile(portfolioZipFile, allocation.bytes, { flag: 'wx', mode: 0o600 });
const completeCase = await client.download('case', { caseId });
await writeFile(caseZipFile, completeCase.bytes, { flag: 'wx', mode: 0o600 });
```

Use the existing client binding and managed launch on the receiving host. Retain the full case ZIP and the receiving request before `receiver.importBundle('case', completeCase.bytes, {name, actor, requestId})`. On success, reopen the returned `value.id`, list its saved Portfolios and select the retained saved ID. Read the received case's version for any new operation. Continue from a new editable draft when changing a saved allocation.

The full case receiver restores saved Installation editions, exact attachments, Forecasts, Portfolios and event history. The Portfolio ZIP supplies the complete calculation and source handoff. Preserve the full case bytes and original import request ID for exact receiving replay. Always close an owned client in `finally`; a borrowed application keeps its existing process lifetime.

### Merchant MCP

Use the existing `merchant_grant_portfolio_seed` with `workspace`, `caseId`, `expectedVersion`, `forecastId` and optional `installationSelections`. An existing complete draft may be supplied inline as `inputs`, or by `input` plus `expectedInputSha256` and optional `inputPointer`. The provider uses the original verified model-input reader for both routes.

For a retained complete seed or preview file, `inputPointer: '/inputs'` selects the actual editable input after the full file's SHA is verified. Read large source candidate, phase or result arrays through the existing retained snapshot/page tools while preserving the same snapshot ID and digest. A compact tool response is an index into that full retained response.

Preview and save use `merchant_grant_portfolio_preview` and `merchant_grant_portfolio_save`. Saved date selection uses `merchant_grant_portfolio_selection`, and its returned `/inputs` goes through the original Forecast preview/save tools. Export and import continue through the original complete-case tools. [Portfolio delivery allocation](PORTFOLIO.md) explains the operator decisions and source terms.

## Receive the original merchant support handoff

Use the unchanged JSON file exported by Merchant Support. The client accepts its complete nonempty bytes up to the native 8 MiB attachment bound. Its original filename is part of the preview identity; retain that exact filename and byte sequence through receiving and retries.

~~~js
const preview = await client.supportPreview(caseId, version, handoffBytes, filename);
// Review preview.value.report, .reader, .source and .deployments.
const received = await client.supportReceive(caseId, handoffBytes, {
  expectedVersion: version,
  filename,
  expectedPreviewSha256: preview.value.previewSha256,
  deploymentId,
  actor,
  requestId,
  note: 'Receive the original support file with its existing deployment.'
});
~~~

For a new deployment, use deploymentId: null (or omit it) and deployment containing the original editable fields. Existing deployment selection permits no nonempty competing deployment object. The client excludes generated IDs, sourceIds, versions and recordedBy from new-deployment input; the original service validates the chosen operator, role, environment, work packages and receiving date.

The native support.receive command re-previews the file and compares expectedPreviewSha256 inside its existing request transaction. It retains the exact handoff, native rendered report, deployment/source association, event and request receipt together. Same-file/report association can return unchanged with the original version. Read the actual receipt and current case instead of assuming a version increment.

Preview is read-only: native reader availability, size and busy errors retain their definite original outcome. Receiving uses the same after-dispatch uncertainty and original-ID recovery as the other case writes. Source/case/reader changes require a fresh preview; an interrupted accepted write requires the identical original payload and request ID.

Source downloads and complete case export/import preserve the original file, retained report and deployment associations. The original operator, CLI, environment fields and native reader lifecycle are documented in [Merchant support in delivery operations](SUPPORT_DELIVERY.md).


## Receive original buyer observations

Use the complete original JSON exported by [Native buyer work in delivery Operations](BUYER_OPERATIONS.md). The file contains selected original SF88 Inbox sources and their native outcome/retained-output observations. Keep it private with the operating case. The client passes its nonempty original bytes, up to 8 MiB, to the installed native reader.

```js
const preview = await client.buyerPreview(caseId, version, handoffBytes, filename);
// Present every preview.value.rows entry and its original source, issues,
// receiving classification, matches and suggestedPurchaseId for review.
// selections contains only the operator's explicit original job choices.
const received = await client.buyerReceive(caseId, handoffBytes, {
  expectedVersion: version,
  filename,
  expectedPreviewSha256: preview.value.previewSha256,
  deploymentId,
  selections,
  actor,
  requestId,
  note: 'Receive the selected original buyer observations.'
});
```

Each selection is exactly `{jobId, purchaseId}`. The jobId is the original 64-character SHA-256 identifier, and purchaseId is the explicit original `purchase-...` ID or null for a new original purchase. Select one through 100 distinct original jobs; the native preview determines whether each is receivable and which existing intent or transaction it matches. The same existing purchase cannot be selected for two different source jobs.

Select an existing buyer or combined deployment by deploymentId, with no nonempty competing deployment object. A later observation retains its original purchase's deployment. For a new deployment use deploymentId:null or omit it, and provide deployment with its original name, operator and explicit role BUYER or BOTH. Other editable fields follow the existing deployment contract: participantClass, environment, state, original work-package costIds, tranche, source/reference details and actual handover fields. Generated identity, source associations, version and recordedBy remain native-owned.

buyerPreview is read-only. buyerReceive preserves the exact filename, bytes, reviewed preview SHA, current case version and stable requestId. It invokes the original command transaction directly; it does not reconstruct or edit payment fields. The native source reader determines the original intent, attempt, amount, asset/network, settlement and output observations. A later recovery remains linked to the existing purchase.

The returned value contains version, recordId (the deployment), sourceIds, sourceSha256, selectedJobIds, purchaseIds, totalSourceJobs, unselectedJobIds and unchanged. The whole source remains retained even for jobs left unselected; only selected native purchase records contribute to case metrics. An identical source association can return unchanged. Read the actual returned version and the current case.

A definite version/preview/source-identity conflict requires a fresh review. After an interrupted receive response, preserve and resubmit the identical original requestId, filename, byte sequence and payload; the original transaction returns its committed result before applying a later case-version check. The client makes no automatic write retry.

Download each sourceId through `download('source', ...)` and export the complete case with `download('case', ...)`. The normal case import retains exact buyer JSON and native HTML, job-to-purchase links, source metadata and original history alongside Completion, Support, forecasts and portfolios. Reopen the returned received case ID; do not assume an import replaces another operating case.

## Completion assignments, payment clocks and prepared forms

The completion client uses the same operating case and original work packages as the browser’s Completion tab. The award’s day 30/90/150 delivery schedule remains alongside the form deadline: each received T0, T1 or T2 grant payment starts the next tranche’s 90-calendar-day completion clock. A T3 payment remains the final receipt. The original service handles calendar arithmetic, payment corrections, recorded confirmations and the case’s OPERATIONS or WALKTHROUGH mode.

| Method | Original operation |
| --- | --- |
| read('completion', {caseId, asOfDate?}) | Complete payment clocks, original and confirmed deadlines, assignments and currently recorded issuer outcomes. |
| completionSeed(caseId, expectedVersion, tranche) | All original tranche packages and their saved or seeded assignment input. |
| completionSave(caseId, body) | Save the complete input in the native completion plan. |
| completionPreview(caseId, expectedVersion, {receiptId, asOfDate?, summary}) | Preview the completed deliverables and their original payment-based form. |
| completionPrepare(caseId, body) | Freeze the reviewed preparation and its entire original business snapshot. |
| completionExtension(caseId, body) | Retain an issuer-confirmed later deadline on the original payment. |
| completionSubmit(caseId, body) | Record the actual original form receipt against a frozen preparation. |
| completionDecision(caseId, body) | Record ACCEPTED, CHANGES_REQUESTED or WITHDRAWN on that original receipt. |
| download('completion', {caseId, reviewId}) | Complete prepared ZIP: form JSON, readable HTML, deliverables CSV, selected original source bytes and file manifest. |

Every write body includes expectedVersion, requestId and actor; note is an optional case-operation note. The specialized methods pass that envelope through the original command transport and native request journal. They never automatically retry an uncertain write.

completionSave also takes inputs. The seed’s value.inputs includes every original cost ID, accountable contributors, assignment dates, completed result, and linked work, deployment and source IDs. Save the complete object. For a later change in a linked work record’s contributor/cost or a deployment’s tranche/packages, preview identifies the association that needs an updated assignment. The older saved plan and its event remain in the case’s history and complete export.

completionPrepare takes receiptId, asOfDate, summary and expectedPreviewSha256. Keep the exact calendar date and summary used in the preview. Read the current case after the preparation to obtain its new version.

~~~js
const current = await client.read('case', {caseId});
const proposed = await client.completionPreview(caseId, current.value.program.version, {
  receiptId, asOfDate, summary
});
if (!proposed.value.ready) {
  // Present the native deliverable issues to the operating user.
  return proposed.value.issues;
}
const prepared = await client.completionPrepare(caseId, {
  expectedVersion: current.value.program.version,
  requestId: preparationRequestId, actor,
  receiptId, asOfDate, summary,
  expectedPreviewSha256: proposed.value.previewSha256
});
const review = await client.read('review', {
  caseId, reviewId: prepared.value.recordId
});
const files = await client.download('completion', {
  caseId, reviewId: prepared.value.recordId
});
~~~

The prepared review’s businessSha256 is the source identity expected by completionSubmit; it is distinct from the downloadable ZIP’s file SHA. The actual SCF form receipt supplies submittedOn and formReference. Record it using reviewId, expectedReviewSha256, optional sourceIds and sourceNote. If the operating case advanced after the form was prepared, the receipt retains that original frozen preparation and reports whether its source is still current.

completionExtension takes receiptId, confirmedOn, deadlineOn, reference, optional sourceIds and confirmationNote. confirmationNote becomes the original extension record’s note; the outer note remains the case-operation note. The service keeps the original 90-day deadline and uses the retained confirmation only on or after confirmedOn. Forecast assumptions and an extension request do not establish an issuer confirmation.

completionDecision takes outcomeId, state, date, sourceNote and optional sourceIds. It updates the recorded issuer outcome while preserving the form identity, prepared source and earlier events. Use a newly prepared form and the actual new form reference for a resubmission.

asOfDate selects which payment, confirmation and submission dates participate in the calendar view. Issuer outcomes display their current recorded state. Complete case export/import retains all completion plans, confirmations, form receipts, source files and complete frozen reviews.

## Cohort acceptance through the existing native case

The maintained typed client and original MCP provider delegate the complete workflow to this same Operations service. See [OPERATIONS-COHORT.md](OPERATIONS-COHORT.md) for the original rule and explicit review inputs.

| Typed client | Original MCP tool | Native result |
| --- | --- | --- |
| `cohortSeed(caseId, expectedVersion, tranche)` | `merchant_grant_cohort_seed` | Pinned proposed tranche-2/3 rule, original purchase/deployment/source inventory and complete input seed. |
| `cohortPreview(caseId, expectedVersion, inputs)` | `merchant_grant_cohort_preview` | Exact cutoff measurement, numerator/denominator scopes, source findings and reviewed preview digest. |
| `cohortPrepare(caseId, body)` | `merchant_grant_cohort_prepare` | Original `cohort.prepare` request receipt and immutable review identity, including unmet findings. |
| `read('review', {caseId,reviewId})` | `merchant_grant_review` | Complete original frozen review, source snapshot and observation history. |
| `download('cohort', {caseId,reviewId})` | `merchant_grant_export` with `kind:'cohort'` | Complete private evidence ZIP with readable result, CSV tables and original files. |

The preparation body is `{expectedVersion,requestId,actor,note?,inputs,expectedPreviewSha256}`. Preserve the exact body and request ID after an uncertain result. It replays the first committed case result before the case-version check. The provider can take the complete `inputs` inline or through its existing verified original input/snapshot/transfer selection, with `inputPointer` selecting the original seed's `/inputs`. It does not create a second input journal or a second business case.

Cohort input references use the original 32 MiB request allowance. The provider verifies the complete selected file's SHA and bytes before applying an explicit `inputPointer`, then sends the selected native JSON object; the full HTTP envelope must still fit 32 MiB. Use the existing chunked input transfer for a full file and retain its completion digest. The ordinary 8 MiB source-upload and other model-input limits remain those of their original operations.

Read the whole cohort preview before freezing it: its `/observations`, `/intents`, `/targets` and source findings are available through the original snapshot and row interfaces. Preserve the exact reviewed input, current case version and preview SHA. A freeze can retain unmet targets as a complete review; when a real preceding tranche payment exists, select the intended saved reviews in Completion and read its full combined findings before preparation. An empty `cohortReviewIds:[]` is an explicit selection and has its own native preview; omission retains the earlier request shape. Keep the same choice and order from preview through preparation.

Both `completionPreview` and `completionPrepare` accept optional `cohortReviewIds`, at most twenty distinct original review IDs. The corresponding `merchant_grant_completion_preview` and `merchant_grant_completion_prepare` retain that same optional array. Omit it when no cohort is selected to preserve the previous request shape. Currentness, the correct tranche, the observation cutoff and unmet target/source findings are checked by the original service. The prepared form and complete export embed the selected immutable evidence.

A `COHORT_EVALUATION` may truthfully retain unmet targets. There is no additional submission endpoint, payment action, award date or generated independent participant. The original payment-based completion clock, deliverables, form receipt and issuer outcome keep their existing owners and identities.

MCP responses use the same retained complete-file and array-page interfaces as other Operations results. Page the original `/observations`, `/intents`, `/targets` and other arrays from the returned immutable snapshot; preserve its ID and SHA. An oversized row remains available from the complete original file. Reopening the review or export does not recapture an Inbox or repeat a provider/payment operation.

## Customer installation editions and complete receiving

The original client and MCP provider operate the same Customer installations desk:

| Native client | MCP operation | Original selection |
| --- | --- | --- |
| `read('installations', {caseId})` | `merchant_grant_installations` | Current installation heads in the selected case. |
| `read('installation', {caseId, installationId, revision})` | `merchant_grant_installation` | A complete immutable edition; omit revision to select its current head. |
| `read('installation-history', {caseId, installationId, before, limit})` | `merchant_grant_installation_history` | Follow the returned `nextBefore` on this same installation. |
| `installationSeed(caseId, expectedVersion)` | `merchant_grant_installation_seed` | Complete editable document at `/document` plus original case/plan identity. |
| `installationPreview(caseId, body)` | `merchant_grant_installation_preview` | Exact document, case version, installation ID and current edition. |
| `installationSave(caseId, body)` | `merchant_grant_installation_save` | Original reviewed document, preview SHA, operator, save reason and request ID. |
| `download('installation', {caseId, installationId, revision})` | `merchant_grant_export`, kind `installation` | Complete case and selected-edition handover ZIP. |

A preview body is `{expectedVersion, installationId, expectedRevision, document}`. New installations select `installationId:null, expectedRevision:0`; a next edition selects the original stable ID and its current revision. Save adds `requestId, actor, note, expectedPreviewSha256`. The typed client maps this to the original `installation.save` case command and preserves the original request on recovery.

The MCP tools accept the complete document as `inputs` or the existing verified `input` reference plus its exact SHA. Use `inputPointer:'/document'` to select the seed document from a complete retained response. Read the full preview findings and original selected records before saving. The source desk remains the authority for workorders, commercial terms and existing purchase observations.

Import the selected handover through the original case receiver. Its response includes `selectedInstallation`; read that exact ID/revision in the returned receiving case. The ZIP retains its original readable rendition and every prior edition. The matching managed Python/Node launch source lists include the complete installed operating modules and mounted UI. Adopt both readers with the native/client/provider joins before reopening a changed release. [INSTALLATIONS.md](INSTALLATIONS.md) contains the full input, API, CLI and receiving contract.

## Original implementation evidence

The current complete catalogue adds `merchant_grant_implementation_source`, `merchant_grant_implementation_preview` and `merchant_grant_implementation_prepare`. These methods use the original case version and command journal. Preview/prepare accept the existing whole-file hash-verified input and optional JSON-pointer transport. `merchant_grant_export` supports `implementation` (case/review) and `implementation-original` (case/source/SHA-256). Completion preview/prepare accept optional ordered `implementationReviewIds` (up to 20 distinct original reviews). See [the complete operator, typed-client and source-provenance contract](IMPLEMENTATION_EVIDENCE.md). The selected complete catalogue has 67 tools; previous receipt records retain their original catalogue identities.

## Delivery risks and mitigation

Delivery risks belongs to the original grant operating case. It records named risks and issues, accountable contributors, affected delivery packages, mitigation actions, attached sources, dated reviews and resolutions. Operators set likelihood, impact and priority explicitly. The register's due findings use its recorded `asOfDate`; `ISSUE` entries use `NOT_APPLICABLE` likelihood. An unassigned owner is the explicit value `null`.

| Client operation | Result |
| --- | --- |
| `read('risks', {caseId})` | Current source identity, latest register and every saved edition, newest first. |
| `riskSeed(caseId, {expectedVersion, reviewId?})` | Editable complete document and actual case contributors, packages and source metadata. |
| `riskPreview(caseId, {expectedVersion, document})` | Normalized document, complete report and exact preview SHA256. |
| `riskSave(caseId, body)` | Immutable `risk-register.save` review with its native request identity. |
| `riskRequest(caseId, {command})` | Original request lookup using the whole retained save command and fingerprint. |
| `read('risk-register', {caseId, reviewId})` | Complete immutable review, report and current source comparison. |
| `read('risk-history', {caseId, riskId})` | The same stable risk and its actions across saved register editions. |
| `download('risk-register', {caseId, reviewId})` | Original complete case and all history, selected register JSON, action/risk CSVs and offline HTML. |

Start from `riskSeed` and edit the returned complete document. Keep stable risk and action IDs across successor editions. A successor refers to the exact previous `reviewId` and `reviewSha256`; keep resolved and closed records in the register so their history remains available. Record each actual review in `review.on`, `review.by` and `review.note`. Resolution records carry the date and explanatory note. Select original contributor, package and source IDs from the seed. The native preview preserves previously linked retired packages and reports their current state.

The native engine validates real civil dates, case ownership, source links, edition lineage and field bounds. Documents allow up to 200 risks and 100 actions per risk within 2 MiB of normalized JSON. Review owners can assign finance and reviewer read access through the existing staff desk. The existing case permissions govern save access.

Retain the exact complete command before its first save. This example uses an already opened original `GrantWorkspaceClient`, the reviewed case version, and an operator-edited complete seed document:

```js
import {open, readFile} from 'node:fs/promises';
import {dirname} from 'node:path';

export async function prepareRiskReview(client, caseId, selection, requestFile) {
  const {expectedVersion, document, requestId, actor, note} = selection;
  const preview = (await client.riskPreview(caseId, {expectedVersion, document})).value;
  const command = {
    expectedVersion, requestId, actor, note, action:'risk-register.save',
    data:{document:preview.document, expectedPreviewSha256:preview.previewSha256}
  };
  const retained = {caseId, command};
  const file = await open(requestFile, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(retained) + '\n', 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  const parent = await open(dirname(requestFile), 'r');
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
  return retained;
}

export async function continueRiskReview(client, requestFile) {
  const retained = JSON.parse(await readFile(requestFile, 'utf8'));
  const {caseId, command} = retained;
  const inspected = (await client.riskRequest(caseId, {command})).value;
  if (inspected.found) return inspected.result;
  // The native transaction validates the original version and full command.
  return (await client.command(caseId, command)).value;
}
```

A lost connection resumes through the same retained file. The native lookup checks the complete original command fingerprint and recovers the original saved result. If the original request is absent and its reviewed case version has changed, the native save reports that conflict; review the new case source and prepare a separately identified successor with the operator's updated input. Keep the original request record intact.

Reopen the saved `recordId`, inspect the current source comparison, and download its complete export. The existing case importer receives that archive with all risk editions, source attachments and original review identities. The report keeps the historical source context alongside the receiving case identity.

Merchant MCP exposes `merchant_grant_risks`, `merchant_grant_risk_register`, `merchant_grant_risk_history`, `merchant_grant_risk_seed`, `merchant_grant_risk_preview`, `merchant_grant_risk_save` and `merchant_grant_risk_request`. Preview and save accept the full document as `inputs`, or one verified host input, snapshot or transfer reference. Use `inputPointer: '/document'` for a native seed or preview snapshot. Request recovery takes the whole original command as `inputs`; for the example's retained file, use `inputPointer: '/command'`. It includes the original reviewed version, actor, note, request ID, action, document and preview digest. Native results remain complete retained snapshots, with the original byte paging and file download operations.

Use `merchant_grant_export` with `kind: 'risk-register'`, `caseId` and `reviewId` to receive the full selected handover. Existing staff accounts, service connection ownership, source transfers and client shutdown rules apply unchanged.


## Compare saved Delivery risk editions through the typed client

Select two immutable original review IDs and their SHA-256 values from
`client.read('risks', {caseId})`. Keep the full selected values, including
the two original saved reviews, across review and download. A comparison
does not save an edition, change a draft, assign a score or alter another
case workflow.

`GrantRiskComparisonSelection` contains `caseId`,
`beforeReviewId`, `beforeReviewSha256`, `afterReviewId` and
`afterReviewSha256`. The typed read returns
`GrantJsonResponse<GrantRiskComparisonView>`:

```js
// client is the existing authorized GrantWorkspaceClient.
// selection uses actual case/review IDs and hashes from its native risk list.
async function receiveRiskComparison(client, selection) {
  const response = await client.read('risk-comparison', selection);
  const {comparison, current} = response.value;
  const exact = {
    ...selection,
    expectedComparisonSha256: comparison.comparisonSha256,
  };
  const completeJSON = await client.download('risk-comparison-json', exact);
  const completeCase = await client.download('risk-comparison', {
    ...exact,
    expectedVersion: current.version,
  });
  return {response, completeJSON, completeCase};
}
```

Each response retains its complete `bytes`, SHA-256, media type, status,
filename and native response source under the existing transport owner.
Persist those original bytes through your existing private download
destination before reporting them delivered. The example borrows the
existing client; the caller retains its ordinary close responsibility.

The read value has `comparison` and `current`. Comparison JSON export
contains the complete comparison object itself, followed by the native
JSON line ending; it does not wrap that object in `{comparison,current}`.
Its `comparisonSha256` is the original native Python canonical digest
over the whole comparison before that hash field is added. Preserve this
digest exactly. Do not replace it with JavaScript JSON serialization:
legitimate numbers and Unicode keys can serialize differently. The
transport response hash identifies different bytes and is not a
substitute for the native comparison hash.

### Complete result and dated context

The result contains forward/reverse/same-edition direction, both summaries,
both complete original reviews, register fields, all dated counts,
every risk and action row, all saved context rows and the native notice.
The declarations retain every row and field rather than reducing the
result to counts or changed records.

Field sides distinguish absent `{present:false,value:null}` from explicit
null `{present:true,value:null}`. Original decimal strings and all
remaining JSON values are retained. Risk fields omit nested actions;
actions retain their original risk ID and have separate complete rows.

`reportFields` records changed original dated report observations.
`contextChanged` independently records changes to linked saved
plan/contributor/package/source context. A changed assessment date may
change overdue observations while a risk's fields and linked context
remain unchanged. A consumer displaying differences must consider both
facts. Count deltas are exactly After minus Before on the saved assessment
dates; they do not establish improved or worsened risk exposure.

The current case ID/version stay outside the comparison digest. After a
full case import, use the actual received `caseId` and retain the original
review IDs/hashes. Original review source identities may still refer to
the producing case. Do not rewrite those historical identities.

### Select the exact native download

| Client download kind | Native file | Required conditions |
| --- | --- | --- |
| `risk-comparison` | Complete case ZIP with comparison and both reviews | Exact selection, expectedComparisonSha256, expectedVersion |
| `risk-comparison-json` | Complete comparison JSON | Exact selection, expectedComparisonSha256 |
| `risk-comparison-report` | Native readable HTML | Exact selection, expectedComparisonSha256 |
| `risk-comparison-risks` | Every risk comparison row in CSV | Exact selection, expectedComparisonSha256 |
| `risk-comparison-actions` | Every mitigation comparison row in CSV | Exact selection, expectedComparisonSha256 |
| `risk-comparison-context` | Every saved context comparison row in CSV | Exact selection, expectedComparisonSha256 |

Only ZIP accepts and requires `expectedVersion`; supplying it for any
other format is an input error. The comparison client rejects unknown
arguments, omitted identity conditions and a conflicting explicit
`kind` before native work. It never silently drops a requested version
or hash guard.

If a full-case ZIP reports `OPERATIONS_CONFLICT`, read the same exact
comparison again to observe the actual current case version, review that
result and explicitly request the ZIP. A changed review or comparison
identity is a source conflict; preserve the original selected values and
inspect the native response rather than substituting a different edition.
No save command or new request ID is involved in this read/download path.

### Merchant MCP and large complete results

`merchant_grant_risk_comparison` takes the workspace alias, caseId and
the four exact review identity fields. It calls the same original client
and keeps the full native response in the existing immutable snapshot
store. Its read-only annotation grants no additional access.

Use `merchant_grant_snapshot` for individual pointers and
`merchant_grant_rows` to page `/comparison/riskRows`,
`/comparison/actionRows`, `/comparison/contextRows` and
`/comparison/counts`. Preserve the returned snapshot ID and SHA-256
when paging. Complete original reviews remain at
`/comparison/originals/before` and `/comparison/originals/after`.
Oversized rows remain in the complete retained file; they are not discarded.

`merchant_grant_export` accepts the six kinds in the table with the
same identities and required guards. It retains the exact native file
under the original snapshot/file transfer owner. Use the maintained
`merchant_grant_file_read` and host-download operations to receive every
byte; a preview or page is not the full export. Snapshot provenance
includes both review IDs/hashes, the native comparison hash and the ZIP
case-version condition. Existing source IDs, staff permissions,
connection ownership and shutdown remain authoritative.

The full case ZIP uses the original Operations importer. Its selected
comparison is validated and reopens in the received Risk desk through
the same native read. See [the complete comparison desk and receiving
workflow](RISK_COMPARISON.md).

### Outgoing installed-view inspection

Before describing the customer-facing comparison or exports as ready,
open the exact installed source edition and inspect its rendered output
with the original case owner. Operate the saved selectors, date-only
report differences, filters, all exports and independent receiving reopen.
View populated, empty, loading and native-error states at desktop and
narrow widths. Source review, peer approval and HTTP success alone are
not visual inspection. If runtime capacity is unavailable, keep the
edition source-reviewed and send its exact source and opening steps to
the existing equipped receiver; do not start a replacement case or an
unrelated validation programme.

## Contributor Engagements

The complete typed client, eight Merchant tools and original Forecast/Portfolio receiving course are documented in [Contributor Engagements](ENGAGEMENTS.md#typed-client-and-merchant-mcp). They retain the original source attachments, immutable agreement reviews, decimal amounts, command identities and complete case exports. Both `engagement.prepare` and `engagement.receiving` require a nonempty recorded note; current Work/Invoice and Installation operations remain on their original implementations.


### Client and provider shutdown

`detach(expectedInstanceId?)` stops new client requests before it waits for already accepted operations. It coalesces concurrent detach/close calls, reads the final retained connection after those operations drain, and stops only its own original launcher. Borrowed application processes remain owned by their original host. After successful detach, an explicit `open()` can reconnect the same client. A failed detach keeps admission stopped and preserves the same child/connection for another detach attempt. Permanent `close()` keeps admission stopped and can be called again after a failed close; it does not create a replacement launcher.

The original launch process remains owned through its `close` event and complete stdout/stderr closure, including late output errors. Its result retains the first output/launcher error and a bounded diagnostic tail. Startup failures remain primary if stopping that same child also reports an error. The Merchant provider drains all accepted calls, then attempts every retained file reader and client close even when another independent owner fails. Retry `close()` on that same provider after resolving the reported owner failure; its original objects and immutable results remain retained.

## Saved customer-use calendar

The optional `document.useCalendar` records complete useful tasks, dated uses, separate DIRECT/PREPAID funding groups and original buyer receipt associations in the same immutable Installation history. The **Customer use** tab reads exact saved reports alongside current receipt/source changes, expands explicit working dates into an editable draft, exports JSON/CSV/ICS, and stages the original Cohort inputs while preserving an existing edited draft. See [Customer-use calendar](CUSTOMER_USE_CALENDAR.md) for the full document, CLI, typed client, MCP and independent receiving workflow.


## Named staff and complete installation receiving

Open **Team workspace** at `/team` from the original private owner link. Enroll lead, finance, reviewer and contributor profiles against the existing case and contributor identities. Named HTTP sessions use individual cookies and a CSRF value; the original case commands record the enrolled actor. The contributor desk records original work and invoices and shows their paid, open and credit balances.

[STAFF_ACCESS.md](STAFF_ACCESS.md) contains the operating workflow and role matrix. [STAFF_INSTALLATION.md](STAFF_INSTALLATION.md) covers whole-database backup, source and attachment transfer, individual SSH access and independent recovery. Both Applications launchers include the same named-staff source inventory.

The full operating receiving entrypoint is `python3 STAFF_WORKFLOW_RECEIVING.py --output /absolute/private/receiving --node /absolute/path/to/node`. It operates the original local server through named staff HTTP and browser sessions, then opens the same complete installation in a separate recovered destination. Existing trusted integrations retain the original owner bearer API.


## Recorded cohort delivery agent

The nine `merchant_grant_cohort_delivery_*` tools take the original saved adoption source and frozen review through explicit identity/intent editing, complete comparison, source refresh, reviewed preparation, native save/recovery and JSON/CSV/HTML receiving. They share the existing source request owner with the adoption tools. Source refresh retains invalidated choices in complete editable input with the exact finding, so the same edit operation repairs the association. The public typed module is `@tokenjunkielabs/starforge-merchant/grant/cohort-delivery-agent`. See [the complete source selection, tool, native request and receiving workflow](COHORT-DELIVERY.md#merchant-agent-workflow).


## Continue a complete cohort editor between browsers

The existing Cohort Planning panel now carries its entire working state
through **Saved editions → Complete working session**. **Download working
session** includes unfinished row text, all prior drafts, both complete
comparison sources and history, incoming documents, full allocation choices
and results, opened source bytes and the exact original source request.
**Open working-session JSON** stages the full file beside current work;
**Open as working session** retains the predecessor before selecting it.

Continue through the same original Operations case. A transferred pending
save reuses the original actor/version/request ID and JSON bytes through the
existing `source.add` controls; its accepted source is read back through the
original source API. The portable reader validates that precise attachment
contract and rejects unrelated native actions. Agents can supply or retain
the complete working JSON without flattening it into a single plan or losing
unfinished operator text.

The full schema and browser workflow are documented in
[COHORT-PLANNING.md](COHORT-PLANNING.md#continue-the-complete-working-session).
The selected controller imports `cohort_planning_session.mjs` directly and
the adjacent declaration describes the complete file. Its immutable snapshot
archive uses the browser's existing origin; the portable JSON includes all
bodies for another browser. Read-only planning, original case ownership,
Calendar/Installation identities and native source request recovery keep
their existing client and Merchant dispatch paths.
