# Original receiving workflow and exact legacy sources

The Blockworks application composes the existing SF88 buyer-runbook workspace for merchant intake, reviewed local setup, immutable acquisition plans, execution, resource delivery, accounting and recovery. This component adds the selected legacy response view used by migration comparison. The original acquisition journal remains authoritative.

## Open the complete existing browser interface

```js
import {startRunbookWorkspace} from '../../buyer-runbook/workspace.mjs';
const receiving = await startRunbookWorkspace({
  directory: originalReceivingDirectory,
  configsDirectory: originalConfigDirectory,
  operatorSettings: originalOperatorSettingsFile,
  port: 0,
});
// Open receiving.url; await receiving.close() when its owner closes.
```

The starter returns `{url,server,model,close}`. Run it in the application's existing process/network namespace. Its original loopback URL and absolute asset/API paths stay together; rewritten subpath mounting is unsupported. It owns the existing Host, Origin and session checks. Reopen the same `directory`; initial config/operator selections are retained. Awaited, idempotent `close()` drains its own execution, active requests and connections.

Keep the complete [buyer-runbook component](../../buyer-runbook/WORKSPACE.md), including its model, intake, runbook, accounting/recovery modules and all `workspace-ui` assets. The existing interface already supplies receive, review, prepare, plan, execute, recover, download, accounting and backup forms.

## Open the original SDK

```js
import {openCustomerReceiver} from './customer.mjs';
const customer = await openCustomerReceiver({
  directory: originalReceivingDirectory,
  configsDirectory: originalConfigDirectory,
  operatorSettings: originalOperatorSettingsFile,
  temporaryDirectory: originalPrivateCommandDirectory,
});
```

The default runtime is the matching sibling `sf88-operator-buyer-cli` in the complete distribution. Construction creates no workspace or ledger. Options forwarded to the original `AcquisitionWorkspace` are:

| Option | Meaning |
| --- | --- |
| `directory` | Original receiving workspace; omit only for original verify/restore use. |
| `runtimeDirectory` | Complete matching SF88 CLI directory, when selected explicitly. |
| `configsDirectory` | Existing private source-config directory selected on first creation. |
| `operatorSettings` | Original receiver preset used by native intake. |
| `paidFileClaimEnvs` | Original host-declared claim environment names. |
| `temporaryDirectory` | Existing private command directory outside source state. |
| `node`, `environment` | Actual native executable and memory-only child environment. |
| `timeoutMs`, `cleanupGraceMs`, `outputLimit` | Original child lifetime/log bounds. |
| `resultLimit` | Original command-result bound; default 32 MiB. |
| `maxReadBytes` | Complete saved-response read bound; default 128 MiB, maximum 256 MiB. |

Paths follow the original canonical/private-path rules. Environment names may enter a preset; actual signer and claim values remain in the original child environment. Serialize command results rather than the client/runtime object.

### Original methods and outcome

| Work | Methods |
| --- | --- |
| State and selection | `state(options)`, `attachRun(absoluteRun,options)`, `inspect(id,options)` |
| Merchant request | `receiveRequest(file,{filename,signal})`, `request(id,options)`, `reviewRequest(id,{acceptIndex,totalAtomic,dailyAtomic,signal})`, `prepareRequest(id,{reviewSha256,signal})` |
| Immutable plan | `save({id,expectedRevision,manifest,signal})`, `draft(id,{revision,signal})`, `initialize(id,{expectedRevision,reviewSha256,signal})` |
| Execution and recovery | `execute(id,{expectedPlanSha256,only,signal})`, `recover(id,options)`, `unlock(id,{ownerPid,signal})` |
| Accounting | `finalize(id,{only,signal})`, `bindAccounting(id,{only,workspace,signal})` |
| Resource | `preview(id,operationId,options)`, `download(id,operationId,newDestination,options)`, `export(id,{format,destination,signal})` |
| Request attachment | `exportRequest(id,{kind,destination,signal})` |
| Paid-file workflow | Unchanged `paidFile`, `receivePaidFile`, `reviewPaidFile`, `preparePaidFile`, `retrievePaidFile`, `resetPaidFile`, `downloadPaidFile`, `exportPaidFile`. |
| Complete native recovery | Unchanged `backupReview`, `backup`, `verify`, `restore`. |
| Migration source | `readSource(runId,operationId,selection,metadata,{signal})` |
| Report convenience | `exportRun(id,{format,destination,signal})` aliases original `export`. |

Methods are bound and return original `AcquisitionResult` values: `{command,commandId,native,completionReported,process,ok}`. `AcquisitionError.result` retains the same shape when a command fails. Native effects and later caller/process cleanup are separate. Inspect the held outcome before deciding whether an interrupted command needs original recovery.

The [complete SDK guide](../../sf88-operator-buyer-cli/node/ACQUISITIONS.md) defines all arguments and the original paid-file and encrypted backup workflows. An acquisition backup can contain private operator state. It remains separate from migration handover containing selected source captures and reports.

### Receive, review and prepare an actual request

```js
const received = (await customer.receiveRequest(actualHandoffFile)).native;
const reviewed = (await customer.reviewRequest(received.id, {
  acceptIndex: selectedAdvertisedOffer,
  totalAtomic: reviewedLocalTotal, dailyAtomic: reviewedLocalDaily,
})).native;
const ready = (await customer.prepareRequest(received.id, {
  reviewSha256: reviewed.review.reviewSha256,
})).native;
const draft = (await customer.save({manifest: {
  schema: 'stellar-forge.buyer-runbook.v1',
  id: selectedPlanId, title: selectedPlanTitle,
  operations: [{id: selectedOperationId, config: ready.configName,
    saveAs: selectedResponseFilename}],
}})).native;
const initialized = (await customer.initialize(draft.id, {
  expectedRevision: draft.revision, reviewSha256: draft.reviewSha256,
})).native;
```

These values come from the actual selected request and receiver review. Native setup preserves the payer, policy, request bytes and original intent. A selected purchase continues through the original execution UI/CLI and controlling-terminal approval. This module supplies no terminal answer or substitute payment path. Existing attempts retain their original skip/recover behavior.

## Read an already-saved original response

```js
const source = await customer.readSource(
  originalAcquisitionId, originalOperationId,
  reviewedLegacySelection, retainedAdditionalCaptureMetadata,
);
```

`readSource` requires an existing original workspace. It inspects that selected run and uses the original saved-resource reader, which verifies recorded path, SAVED status, complete byte length and SHA-256. It then reads the same open descriptor within the selected bound, verifies its full digest/file identity again, and closes the descriptor and model.

The resulting source binds the original run, operation, intent, plan digest, config digest, saved file and input-integrity observation. Method, URL and HTTP status come from that actual operation; a readable file does not imply HTTP 200. Unknown status stays `null`. The original attempt's `finishedAt` supplies its retained completion/capture time when present; a recovered attempt without that timestamp needs actual retained capture metadata. An explicitly supplied timestamp can retain a more precise original observation. Caller metadata cannot replace native request/status/file pins.

For unknown-status native files, provenance uses the actual saved name and filesystem modification time unless an original import time was already supplied. Reopening keeps those stable observations. A changed descriptor or result/file mismatch stops the read. No replacement provider request starts.

## Select an externally captured original response

```js
import {legacyCaptureSource} from './customer.mjs';
const source = await legacyCaptureSource({
  body: originalBodyBuffer,
  metadata: originalCaptureMetadata,
  selection: reviewedLegacySelection,
});
```

This pure projection performs no filesystem, network or payment action. The application retains the complete original body before decoding. Pass the actual Buffer, without reconstructing it from displayed rows or summaries.

| Metadata | Meaning |
| --- | --- |
| `id` | Optional retained capture identity; otherwise derived from immutable source facts. |
| `sha256`, `bytes` | Optional expected digest/length; mismatches fail. |
| `status` | Actual HTTP integer status or `null` when unknown/file-only; omission means unknown. |
| `request` | Actual `{method,url}` and retained native request context. |
| `capturedAt` | Original timezone-qualified HTTP capture time. |
| `name`, `importedAt` | Actual file name and first import time for an unknown-status/file source. Persist once. |
| `provenance` | Existing `{kind:'file',name,importedAt}` is accepted directly. |
| `headers` | Actual response headers, when available. |
| `paging` | Actual `{page,firstPage,totalRows,totalPages,pageSize}` fields; omit unknown values. |
| `accepted` | Optional retained acceptance; `false` remains unaccepted. |

A failed HTTP response remains a rejected capture with its full bytes. Its error body does not become successful rows. Missing actual HTTP provenance leaves comparison coverage incomplete. Malformed JSON/CSV or a missing selected field reports the actual decode/selection error; the application's retained body stays available.

### Frozen selection

`schemaVersion` is exactly `blockworks-legacy-projection/v1`.

| Selection | Behavior |
| --- | --- |
| `format` | `json` or `csv`. |
| `kind` | `tabular` or `timeseries`. CSV retains original tabular rows, including a time column if present. |
| `rowsPointer` | RFC6901 pointer to the JSON row array. CSV uses decoded root rows; omit or use `""`. |
| `pointsPointer` | Pointer to each selected original point array. |
| `pointSchemaPointer` | Descriptor-array pointer, always relative to the original document root. |
| `descriptorKey` | Actual descriptor identity property: `slug` or `field`; no renaming. |
| `seriesPointer` | Optional root pointer to the original series-container array. |
| `seriesKeyPointer` | Required with `seriesPointer`, relative to each entry. |
| `seriesKey` | Explicit original scalar for a single series without `seriesPointer`. |
| `entityPointer` | Entry-relative entity pointer, or root-relative for a single series. |
| `entity` | Explicit entity instead of entityPointer; present null remains null. |
| `metadataPointer` | Optional root pointer to original response metadata. |
| `totalRowsPointer`, `totalPagesPointer` | Optional root pointers to original population/page totals. |
| `csv` | `{delimiter,header:boolean,columns?:[]}`; headerless data requires exact declared columns. |
| `wholeExport`, `by`, `at`, `reference`, `note` | Reviewed whole-export declaration; retained outside the projection as coverage. |

Pointers follow RFC6901, including `~0` and `~1`. Missing fields remain absent. Null and empty strings remain values. Array positions are literal canonical indices. Point width must match the original descriptor array. Per-series keys are not replaced with names or product-group identifiers.

The mapper's shared `decodeLegacyCapture` supplies the same strict UTF-8/BOM, exact JSON and declared CSV parsing used in its source readback. CSV cells remain strings, including numeric-looking and empty cells. Headerless columns remain the reviewed names. Quoted delimiters/newlines use the declared dialect. Raw body bytes retain all original numeric lexemes. Numeric-versus-scalar interpretation belongs to the reviewed mapping.

### Population coverage

A native single-response population is complete only when selected integer totalRows equals its projected row/point count, page totals do not indicate another page, and any retained page is its original first page. `firstPage` explicitly supports zero-based paging. Counts are not coerced from strings or null.

Otherwise retain `wholeExport:true` with actual `by`, timezone-qualified `at`, `reference` and `note`. This becomes `coverage.kind:'declared-export'` outside `manifest.request.projection`. A declaration does not override contradictory original row totals. Partial pages remain available as incomplete captures.

The returned envelope is `{manifest,result,captures:[{body:Buffer,metadata}]}`. Manifest contains `id`, `request`, `requestHash`, `sourceSha256`, `selectionSha256`, `state`, `complete`, `coverage`, `captures`, `source` and `problem`. Result contains `kind`, `rows`, `series`, `pointSchema`, `rowCount`, `complete`, the same coverage, and original metadata only when selected and present.

Manifest and supplied capture metadata agree on byte identity, actual status and acceptance. Feed this full envelope directly to reviewMapping/compareMappedResults. Migration handover uses selected source exports and review bindings, while the customer's private payment state stays in its original acquisition workspace.
