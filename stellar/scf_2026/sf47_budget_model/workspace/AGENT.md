# SF47 agent client

agent-client.mjs gives applications typed access to the original planning and delivery service. It uses the same managed launch validation as **Grant planning and delivery** in Applications, and the same authenticated HTTP routes as the browser.

The original Workspace, Operations, forecast and portfolio implementations remain the authorities for saved revisions, source attachments, record states, allocations and calculations. This client opens no SQLite database and stores no alternative business records.

The complete Merchant setup, tools, input references, source-bound pages, downloads, same-ID recovery and receiving workflow are in [Grant workspaces through Merchant MCP](../../../../stellar-forge/mcp-merchant-operator/GRANT_WORKSPACES.md).

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
| portfolioSeed(caseId, expectedVersion, forecastId) | Original editable allocation input from the selected current saved forecast. |
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

## Portfolio allocation and original cash handoff

Read views portfolios and portfolio use caseId and, for the saved result, portfolioId. Portfolio exports use kind portfolio and those same IDs. The native complete case ZIP remains the receiving carrier for all saved portfolios, sources, forecasts and original history.

portfolioSeed returns value.inputs with the complete original task set. Edit the actual resource availability and effort, then preview and save through the original implementation. Save body is {expectedVersion, requestId, actor, note?, inputs, expectedPreviewSha256}. It uses the same original command journal and after-dispatch uncertainty handling as forecastSave.

After a portfolio save, read the case's new version before selecting an alternative. Selection is read-only and returns value.inputs plus its exact original source/date selection:

~~~js
const current = await client.read('case', {caseId});
const selected = await client.portfolioSelection(
  caseId, current.value.program.version, portfolioId, alternativeId
);
const preview = await client.forecastPreview(
  caseId, current.value.program.version, selected.value.inputs
);
// After the operator reviews the original cash result:
const saved = await client.forecastSave(caseId, {
  expectedVersion: current.value.program.version,
  inputs: selected.value.inputs,
  expectedPreviewSha256: preview.value.previewSha256,
  actor,
  requestId
});
~~~

A concurrent case change is rejected by the original version check. Source-stale forecasts and allocations keep the original service's specific validation result. Quoted collection amounts and dates retain their native forecast semantics when resource dates change.

Merchant MCP can use a retained native response directly: input plus expectedInputSha256 verifies the full file, and inputPointer selects its original /inputs object. The native snapshot keeps the complete file and selection lineage. That avoids reconstructing large arrays from a compact tool reply while preserving the full original JSON values.

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
