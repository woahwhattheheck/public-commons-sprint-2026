# Service capture to buyer and accountant receiving

This is the downstream arm of `SCF-SERVICE-ADJUSTMENT-HANDOVER-24EA-20261012`. It joins the existing saved Service case, its verified merchant adjustment capture, the original Buyer Expenses workspace, and the original Accountant workspace. Source is complete; the full receiving program must still be invoked in the selected original native operation before an executed receiving result can be reported.

## What staff can complete

Staff select a saved Service capture and the configured buyer workspace. They receive its original purchase and verified credits, choose the matching existing purchase or register the proven original purchase, assign the original cost centers and exact native allocations, review and close a period, and issue the complete accountant delivery. They can receive an accountant's original returned file into that issued period while retaining the earlier source, coding and close.

Every adjustment status stays in the native source. An unresolved adjustment or a reference-only capture does not become a paid credit. The upstream merchant adjustment workspace remains responsible for payment, transfer observation and refund verification. This arm records and delivers the original result through the existing buyer and accountant applications.

The operator workflow belongs in the existing Support case page and configured MCP/CLI. The modules add no service, separate collector, alternate buyer store or automatic refund policy.

## Complete source and integration ownership

| Source | Responsibility |
| --- | --- |
| `service-buyer-handover.mjs` | Typed inspection, preparation, native execution, exact files and original case materials |
| `service-buyer-receiving.mjs` | Complete original native receiving continuation, including its accountant return and fresh received project |
| `SERVICE_BUYER_HANDOVER.md` | This operating and integration guide |
| `stellar-forge/mcp-merchant-operator/buyer-expenses.mjs` | Narrow admission into the existing selected buyer session and serialized alias lane |

The first three files live in `stellar/scf-starforge-20261009/sf74-merchant-support-console/`. The buyer owner postimage preserves its current provider and governed-quote work. Its original preimage is `dee4cf5a2a5c16731b7eaa29f28be6c198bf1151`; the corrected complete postimage is `a634baebbc87cd35464b53b421f6d8a6bee10c86`.

The current buyer leaf was created as Git blob `f14ee48f5e00925d86b4495a4d620a9c9740824c` and is 52,719 UTF-8 bytes. It preserves the original native JSON filename when preparing a capture. This matters because the original capture manifest binds that basename. The preceding `e0984e85` edition lacks that filename correction. The obsolete `02f52171` owner is invalid and must not be used.

Root owns the original Support case/API/browser/MCP/CLI composition and accounting-owner admission. Actions owns the original Service adjustment core, its native execution and the enclosing `service-adjustment-journey.mjs`. These files compose those owners' interfaces.

Required upstream leaves are `service-adjustments.mjs` at `b59d04fdc04be137c769391783faf74ac4f24427` and `service-adjustments-native.mjs` at `806c3ba77c6fdfa837f99a21eb7e11b4e0cf592a`. The existing case store must export root's exact-byte `retainCaseArtifact` helper. Use the cohesive source edition containing these additions.

## Original owner admission

The existing `MerchantBuyerExpenses` owner exposes:

```js
await buyer.withServiceBuyerWorkspace(alias, async session => {
  // session is valid only for this callback.
  session.workspaceId;
  await session.read('/api/state');
  await session.mutate(fixedNativePath, originalEnvelope);
  await session.bytes(fixedNativeDownloadPath);
});
```

The callback uses the already selected original session. Its alias lane remains serialized for the whole callback; active work participates in the owner's existing close drain. Fixed routes are checked by the owner. Mutation envelopes are cloned before queued execution. No callback survives its admission interval and no directory is opened independently.

Root's original accounting owner exposes:

```js
await accounting.withServiceAccountant(alias, async binding => {
  binding.accountant;     // Existing original AccountantWorkspace.
  binding.workspaceId;   // Original accountingWorkspaceBinding identity.
  binding.sourcesSha256; // Exact original configured source identity.
});
```

This callback participates in the accounting owner's existing maintenance, active-call and close lifecycle. It supports a buyer-only accountant configuration. Its workspace identity is not an assumed `state.id`; it comes from the original accounting binding over its selected directory and state.

Use actual configured aliases supplied by the original host. A filesystem path, copied fixture name or another account is not an alias.

## Staff workflow and native decisions

### 1. Inspect the saved capture

Choose a saved capture outcome and a configured buyer alias. The inspector returns the actual buyer identity/revision, matching original refund packets, cost centers, labels, periods and optional selected packet, item, credit and report.

Only one exact matching packet is auto-selected. If several original purchases match the receipt, staff choose the intended native purchase. The capture retains its original expected job/settlement binding, source event, manifest and files.

A capture with no proven purchase remains reference-only. Staff may accept or reject that source review in the original buyer application, but the complete purchase/credit receiving program requires the selected native purchase and at least one verified credit.

### 2. Receive the original purchase and credits

Prepare `adjustment_capture` with a source name, provenance and explicit `operational` or `development` context. The main leaf writes the original merchant JSON under the native export's original filename, verifies its exact bytes through the original capture producer, and prepares the original buyer request.

Save the prepared intent in the Service case before executing it. Then use `refund_review` to ACCEPT or REJECT the returned packet. ACCEPT either binds a matching original `purchase_item_id`, or explicitly requests `register_original_purchase:true` when the original native proof supports it. Those two choices are mutually exclusive.

The original buyer records its purchase, credits and source packet. It retains every native adjustment status, including outcomes that have not become verified credits.

### 3. Code the purchase and returns

Use the original cost center and asset label controls. `state.labels` is an array; saving labels supplies the complete selected `assets` array. Labels change presentation and declared native scales, not the original amounts.

Set an explicit operator recognition date. It is not a claimed transfer or settlement date. Choose the original nonoverlapping period covering that date.

Purchase and credit allocation amounts are exact native base-unit strings. The original validators require purchase allocations to equal the original settled purchase and credit allocations to respect the remaining original dimensions. No JavaScript floating-point currency calculation or assumed exchange rate is introduced.

An existing current purchase coding is preserved. When the purchase has several dimensions, supply explicit credit allocations. A single original dimension can receive the exact verified credit amount with that same center, project and account code.

A closed original period requires a named operator and reason before it can be reopened. Source or coding changes continue through that original period; earlier closes remain retained.

### 4. Review and issue the period

Read the actual native period report. Each `issues[]` entry carries:

```js
{
  code, item_id, request_id, source_name, description, source_capture,
  basis, allowed_kinds, resolved, disposition, group
}
```

Render each issue's own `allowed_kinds`. Some issues permit carry-forward or exclusion; duplicate-event groups have different original choices. The current `basis` must accompany an explicit disposition. Do not invent an enum or automatically exclude an unresolved payment.

A READY review captures the exact period context. Close uses that specific review ID and the original version checks. The issued source includes the selected accepted merchant capture and complete native outcome history.

### 5. Deliver and receive the accountant's return

The delivery action captures four native files from one selected buyer revision:

| File | Meaning |
| --- | --- |
| `issued-buyer-accountant-source.json` | Complete original issued period and its source identities |
| `buyer-expense-accountant-edition.zip` | Original accountant period packet |
| `buyer-bookkeeping-complete-period.zip` | Complete native period and bookkeeping history at the selected revision |
| `buyer-expense-complete-project.zip` | Portable original application source, project database and retained files |

`accountant_create` consumes the exact issued source bytes from that saved delivery outcome. Its original handoff ID and request remain stable. The outcome retains all files emitted by the original AccountantWorkspace, with exact names, bytes, hashes and base64.

Staff can edit the original accountant CSV using its existing editable fields, preview it in the original accountant application, and save its original return. The generated `buyer-return.json` carries that native handoff and return chain.

In Support, upload that full original JSON file and call the return-preview operation before saving. Show the native match, previous return, overlaps and current preview hash. The save includes every explicitly selected overlapping `other_handoffs[].return_id` in `supersedes`; a reason is required when superseding. Empty supersedes is valid only when no overlap needs replacement. Accepted bookkeeping changes do not rewrite issued amounts.

## Public leaf API

```js
inspectServiceBuyerWorkspace(buyer, context, {
  captureOutcomeId, buyerWorkspace,
  packetId, periodId, itemId, creditId
});

previewServiceBuyerAccountantReturn(buyer, context, {
  captureOutcomeId, buyerWorkspace, closeId, file
});

readServiceBuyerHandovers(context);
serviceBuyerSummary(view);

prepareServiceBuyerIntent(buyer, context, {
  id, captureOutcomeId, buyerWorkspace, action, actor, input
}, {directory, accounting});

executeServiceBuyerIntent(buyer, {
  context, intentId, directory, accounting
});

validateServiceBuyerMaterial(context, material);

retainServiceBuyerMaterial(context, {
  requestId, expectedRevision, material
});

serviceBuyerFile(context, {outcomeId, name});
```

The context is the current original case selection:

```js
{
  caseId, caseRevision, workspaceSha256,
  service: parsedWorkspace.service,
  commissioning: parsedWorkspace.commissioning
}
```

The inspector returns `{buyer,capture,packets,centers,periods,labels,packet,item,credits,credit,report}`. Buyer identity includes alias, actual workspace ID, native revision, schema and context. Optional selected records are validated against the capture.

Return preview returns `{buyer,capture,closeId,file,preview}`. Its `preview` is the full unchanged native result, including `native`, `previous`, `other_handoffs`, `duplicate`, `preview_sha256` and `revision`.

The full read retains original materials and file data. Use `serviceBuyerSummary` for table rows; load full selected materials only when staff open them. Download routes serve exact retained bytes. The special `original-buyer-result.json` download is the complete outcome.

### Action input wrappers

| Action | Exact input wrapper |
| --- | --- |
| `adjustment_capture` | `{name,provenance,dataContext}` |
| `refund_review` | `{id:packetId,payload:{decision,operator,reason,purchase_item_id?,register_original_purchase?}}` |
| `center_save` | `{payload:{id?,code,name,active?}}` |
| `labels_save` | `{payload:{assets:[{network,asset,symbol,decimals}]}}` |
| `period_save` | `{payload:{id?,name,from_day,through_day}}` |
| `coding_save` | `{id:itemId,packetId,payload:{basis,recognition_date,operator,memo?,allocations}}` |
| `credit_coding_save` | `{id:creditId,packetId,payload:{basis,recognition_date,operator,memo?,allocations}}` |
| `disposition` | `{periodId,payload:{item_id,code,basis,kind,reason,operator}}` |
| `period_review` | `{id:periodId,reviewer,role,notes}` |
| `period_close` | `{id:periodId,reviewId}` |
| `period_reopen` | `{id:periodId,operator,reason}` |
| `delivery` | `{closeId}` |
| `accountant_create` | `{deliveryOutcomeId,accountingWorkspace,name,handoffId?}` |
| `accountant_return_save` | `{closeId,file,previewSha256,operator,name,reason?,supersedes:[]}` |

An allocation is `{center_id,amount,project?,account_code?,memo?}`. File input is `{name,type,bytes,sha256,base64}`; the full decoded bytes must match the descriptor.

Native buyer mutations remain `{request_id,expected_revision,payload}`. The native request ID is `service-buyer-` plus the retained intent UUID. The inspector and preview do not mutate the original buyer state.

### Original case materials

The schemas are exported constants:

```text
stellar-forge.merchant-service-buyer-intent.v1
stellar-forge.merchant-service-buyer-outcome.v1
stellar-forge.merchant-service-buyer-handovers.v1
```

The prepared intent retains source case, capture, buyer alias and identity, native revision, action/input, exact native request, reviewed basis and optional accountant binding. The native outcome retains that intent identity, full original native result and all files.

The original commissioning journal is the material store. Public retain accepts only a validated prepared intent. Only the native execution route may append an outcome. Save the entire new commissioning value using the ordinary case compare-and-swap, preserving Support text, metadata, Service and all other workspace fields:

```js
const workspaceText = await serializeWorkspace(
  workspaceDraft(parsedWorkspace, {commissioning: nextCommissioning}),
  {now: parsedWorkspace.savedAt}
);

await saveCase({
  id: saved.id,
  expectedRevision: saved.revision,
  workspaceText,
  supportText: saved.supportText,
  metadata: saved.metadata
});
```

Use the original `now` option. An invented `savedAt` option does not preserve the intended serialization.

## Recovery and concurrent work

Prepare writes the complete native intent before dispatch and keeps the first selected revision and bytes. Execute requires that same prepared intent to be present in the original case.

For buyer mutations, execute first reads the original native request journal. Only an actual `REQUEST_NOT_COMMITTED` result permits initial dispatch. If the mutation response is lost, the same journal can recover its committed result. Other failed reads preserve uncertainty. The original native fingerprint binds method, path, payload and expected revision.

If the request is definitely uncommitted and the live revision changed, staff refresh and make a new explicit decision. They retain the old intent. A stale request is never silently rebased.

The accountant's original create/apply methods also check retained request IDs before current revision. Existing matching results are reused. A changed body under the same ID is rejected.

Case-save uncertainty is separate from native mutation uncertainty. Read the case for the exact accepted material before another save. A case conflict can be composed against the new case revision while retaining the unchanged native material and peer fields. It does not justify replaying a different payment or buyer request.

Original files are immutable operation artifacts. Their full descriptor, base64 and hashes remain in the selected outcome, case export and receiving outputs. A changed alias or workspace identity is rejected. Later live buyer or case activity does not change an already issued delivery.

## Complete receiving factory

The receiving module exports a factory; importing it starts no process:

```js
const buyerReceive = createServiceBuyerReceiving({
  buyer, accounting,
  buyerId, accountingId,
  readCase: id => store.read(id),
  saveCase: value => store.save(value),
  selection,
  actor,
  python: 'python3',
  node: process.execPath,
  simulateLostBuyerReply: true
});
```

Supply the actual existing owner instances and aliases from the enclosing original native operation. `selection` contains the operator's explicit choices:

```js
{
  dataContext: 'development', // Or the actual operational workspace context.
  recognitionDate: 'YYYY-MM-DD',
  period: {id, name, from_day, through_day}, // id is optional for a new period.
  center: {id, code, name, active},          // id is optional for a new center.
  project, accountCode,
  purchaseItemId,
  purchaseAllocations,
  creditAllocations: {[originalAdjustmentId]: originalAllocationArray},
  dispositions: [originalDispositionPayload],
  reopenReason,
  accountantNote
}
```

Optional fields can be omitted. The placeholder date and IDs above are documentation, not native fixtures. Select actual dates, identities and source from the enclosing operation.

Actions' existing Service-adjustment journey invokes the callback:

```js
await buyerReceive({
  directory,
  caseId, caseRevision, proposalId, outcomeId, sourceCommit,
  capture: unchangedSavedOutcome.result.buyer,
  capturePath,
  nativeFilePath,
  expectedJob
});
```

`capturePath` contains the complete unchanged buyer-source descriptor JSON. `nativeFilePath` contains the original merchant adjustment JSON bytes. The factory verifies both against the saved case capture. It does not reconstruct or normalize another copy of the buyer source.

### Receiving phases and retained outputs

The factory receives the source, accepts its original receipt, codes purchase and credits, resolves only supplied native dispositions, reviews/closes the actual period and issues all four files. It creates the original accountant handoff, changes only `externalNote` in the original CSV, previews/saves that return in the original accountant and receives its exact generated buyer-return packet. External posting status and book references are preserved; this controlled receiving edit asserts no external ledger posting.

The accepted buyer decision deliberately loses its returned response once. The main leaf must recover the original committed request. Every performed intent is executed again with its exact original bytes before outcome save; the result must remain identical.

All initial accountant files and every returned accountant file are copied. An initial and a complete post-return buyer delivery are both retained. The latter project is passed to the existing trusted `receiveBuyerExpenseProject` with its actual archive hash and a fresh private destination.

The reopen then imports the received package's own original Python `Store` from `app/sf36-spend-governor/expense-workspace`, opens its received `project`, and compares the selected workspace/revision, original request receipts, captured packet, exact credit/coding history, issued source and original accountant return. It does not reuse the sender's Store implementation.

The original Service case is reread after receiving. Every accepted buyer intent/outcome must remain; additional peer materials are allowed. The enclosing Actions journey then freezes and receives the full final case after these buyer journals.

The private `buyer-receiving` directory retains the exact selection, prepared requests, native outcomes, phase files, original merchant source, original/edited accountant CSVs, all initial/returned accountant files, both four-file deliveries, full received buyer project and native reopen results. No native fixture fact is invented.

A completed `service-buyer-receiving-result.json` is immutable. Reinvocation verifies its artifacts and retained case phases, then returns that original result without issuing another native action. If completion is partial, the same directory and phase identities resume from retained requests and accepted case materials. A durable preparation that has not yet reached the case is reused with its original input. The exported revision is the receiving comparison target; the live buyer may continue afterward.

### Callback result

```js
{
  schema: 'stellar-forge.service-buyer-receiving.v1',
  case: {id, revision, workspaceSha256},
  capture: {id, sha256, sourceSha256, eventId, manifestSha256},
  buyer: {alias, workspaceId, revision},
  packetId, purchaseItemId,
  credits: [{id, adjustmentId, codingId}],
  period: {id, closeId, reviewId},
  accountant: {alias, workspaceId, handoffId, returnId, buyerReturnId},
  steps: [{phase, intentId, outcomeId, action, requestId, revision,
           recordId, caseRevision, sha256}],
  artifacts: [{name, path, type, bytes, sha256}],
  received: {directory, result},
  originalAdjustmentStatuses
}
```

The result's case and buyer revisions identify the completed receiving edition. A later enclosing case read may have advanced through other authorized work. Keep the result and its original artifact bytes; do not rewrite its history to match a later revision.

## Native operation and delivery status

Use the one existing Service adjustment receiving operation and its original source/payment fixture. The completed E42D buyer/accountant workspace remains an original source asset; do not reuse one verified reverse transfer as proof for a different refund or open a competing writer on that workspace.

The factory needs the actual owner aliases, original verified capture and explicit period/coding choices. Source parsing and independent source-byte readback establish implementation custody; they do not establish that the native flow ran. Report the executed controller, original case/buyer/period/accountant IDs, exit/result and artifact hashes only after the enclosing native operation returns them.

When delivering the complete product, include these source files and guide with the cohesive original Support application, its buyer/accountant dependencies, original source capture and exact generated files. Preserve upstream licenses and the complete application/project receiver.
