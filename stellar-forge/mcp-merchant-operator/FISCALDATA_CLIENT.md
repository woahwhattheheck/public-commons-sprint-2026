# Fiscal Data client, command line and complete downloads

This client operates a host-declared Fiscal Data workspace through the original Merchant MCP service. It retains the original named operator, source revisions, field reviews, exact decimal strings, request IDs and file hashes. Its download adapter uses the existing retained-download engine, and portable receiving uses the existing Fiscal package parser and workspace receiver.

The installed command contribution is **fiscaldata-remote**. It adds no service or background scheduler. The original Fiscal model, worker, browser, publisher and buyer remain the owners of their operations.

## Runtime and entry points

Use Node 24 and the complete original Merchant distribution. The analyst client, local file receiving and source-workspace reopen paths require no payment SDK. Actual publisher or buyer actions use the dependencies and approvals of their existing configured runtime.

The package exports are:

| Package export | Purpose |
|---|---|
| @tokenjunkielabs/starforge-merchant/merchant/fiscaldata/client | Typed MCP connection and native Fiscal actions |
| @tokenjunkielabs/starforge-merchant/merchant/fiscaldata/download | Complete selection, resumable download, verification and portable receiving |
| @tokenjunkielabs/starforge-merchant/merchant/fiscaldata/operations | The same command-line main function |

All three include adjacent .d.mts declarations. The original distribution contribution registers the fiscaldata-remote command. For a source checkout or an installed distribution's source directory, the identical CLI can be called directly:

~~~sh
FISCAL_CLIENT_CLI=/absolute/source/stellar-forge/mcp-merchant-operator/fiscaldata-workspace-cli.mjs
node "$FISCAL_CLIENT_CLI" --help
~~~

Set FISCAL_CLIENT_CLI to the real selected source path. The examples below use this direct entry point so they work with the original installation's chosen directory.

The MCP host supplies its URL, declared workspace alias and named operator. Credentials come from the existing environment variable MCP_ACCESS_TOKEN, or the variable named by --token-env. A bearer value is never accepted as a command-line option or written into a selection manifest. Use the original HTTPS endpoint, or its authenticated HTTP endpoint on 127.0.0.1 or [::1].

## Connect and inspect the original workspace

~~~js
import { connectFiscalWorkspace } from
  '@tokenjunkielabs/starforge-merchant/merchant/fiscaldata/client';

const client = await connectFiscalWorkspace({
  url: process.env.MCP_URL,
  workspace: process.env.FISCAL_WORKSPACE_ALIAS,
  expectedWorkspaceId: process.env.FISCAL_WORKSPACE_ID,
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
try {
  const status = await client.status();
  console.log(status);
} finally {
  await client.dispose();
}
~~~

Connection initializes the maintained MCP transport. It does not open a workspace or start its worker. Use client.open() when opening the declared workspace is intended. An already opened alias reuses the original process-owned instance.

The first observed original workspace UUID is retained by the local client. Supplying expectedWorkspaceId pins it before the first observation. A subsequent status response naming another UUID fails explicitly. A saved download also binds the canonical endpoint, alias, UUID and named reader.

~~~sh
node "$FISCAL_CLIENT_CLI" status \
  --url "$MCP_URL" --workspace "$FISCAL_WORKSPACE_ALIAS"

node "$FISCAL_CLIENT_CLI" open \
  --url "$MCP_URL" --workspace "$FISCAL_WORKSPACE_ALIAS" \
  --workspace-id "$FISCAL_WORKSPACE_ID"

node "$FISCAL_CLIENT_CLI" list \
  --url "$MCP_URL" --workspace "$FISCAL_WORKSPACE_ALIAS" \
  --workspace-id "$FISCAL_WORKSPACE_ID" --section editions
~~~

The list method reads every native page and checks one unchanged workspace revision and collection total. It rejects a concurrent change instead of skipping or duplicating records when a new item is inserted during pagination. Use the returned page methods when a deliberately bounded view is wanted. Available record collections are sources, captures, editions, comparisons and exports, plus refreshPlans and refreshRuns in a host containing the original refresh component.

## Original response and value types

Native actions return **{result,state}**, with the original named operator action record when the host adds it. The state is the host's bounded view of the original Fiscal snapshot.

~~~js
const response = await client.action('editions.get', { id: selectedEditionId });
const edition = response.result;

const sameEdition = await client.value('editions.get', { id: selectedEditionId });
~~~

action preserves the full native envelope. value is a convenience for its result. Lifecycle, status, browser, history and file methods return their documented native host responses.

Financial observations, null markers, scale annotations, sums, deltas and dated changes remain strings. The client performs no monetary Number conversion. Counts, revisions and byte offsets remain integers. A debt balance is an observation at its source date; the native comparison's leftSum and rightSum are arithmetic sums of selected rows, not Treasury period totals. Use the returned aggregation/context notes and the dated first/last observations for each reviewed series.

## Source capture and explicit field review

The original model remains the authority for source URLs, pagination, source consistency, field roles and unit interpretation. The client routes these original actions:

| Work | Action or method | Original selection |
|---|---|---|
| Read or refresh Treasury metadata | catalog('get') / catalog('refresh') | Native endpoint page; refresh creates a dated source observation |
| Save or edit a query | sources.save | Name, endpoint, filter, sort, pageSize, notes; edits add id and expectedRevision |
| Probe selected fields | sources.probe | Source id and optional original revision |
| Start a capture | captures.start | sourceId, sourceRevision, sourceSha256, name and requestId |
| Inspect a capture | captures.get / captures.rows | Original id and bounded source rows/pages |
| Control capture work | captures.pause / resume / cancel | Original capture id |
| Create an interpretation | editions.create | Complete captureId, captureSha256, name and requestId |
| Read or edit fields | editions.get / editions.review | Original id, exact current revision and full authored field/query rules |
| Build CSV and native dataset | editions.build | Original id, expectedRevision and stable requestId |

Every creation that supports requestId keeps that exact input on retry. A different source interval, field interpretation or delivery selection gets a new authored request ID. The client does not silently retry a mutation after a lost response.

The refresh source successor also supports a creation requestId on sources.save. Existing source edits remain id plus expectedRevision and do not accept that creation requestId. Earlier Fiscal hosts may not expose that additive source behavior; their native validation error is preserved.

For a new public Debt to the Penny selection, the original source input is:

~~~json
{
  "name": "Debt to the Penny — selected source interval",
  "endpoint": "/v2/accounting/od/debt_to_penny",
  "filter": "record_date:gte:2026-10-01,record_date:lte:2026-10-08",
  "sort": "record_date",
  "pageSize": 2,
  "notes": "Public Treasury daily debt observations. Dates and source units require explicit field review."
}
~~~

This is an authored query template, not a claim that a capture has already completed. Save it in a private JSON file, retain the actual returned source id/revision/SHA, and use those values in captures.start. The companion examples/fiscaldata-remote-inputs.json contains the complete action templates. All angle-bracket identifiers in that file must be replaced with actual native selections before execution.

~~~sh
node "$FISCAL_CLIENT_CLI" action \
  --url "$MCP_URL" --workspace "$FISCAL_WORKSPACE_ALIAS" \
  --workspace-id "$FISCAL_WORKSPACE_ID" \
  --action captures.start --input /absolute/private/capture-input.json
~~~

The original MCP adapter starts its existing capture worker on an explicit start or resume. A status call or local client disposal does not alter desiredState. Follow captures.get until the original state is COMPLETE, PAUSED, FAILED or CANCELLED. For capture metadata/attempt pages use client.action('captures.get',{id},{offset,limit}); the source-row action takes its offset and limit inside the original payload.

An edition review sends only the chosen field definitions. Each definition uses source, name, label, role, unit, scale, notes and nullToken. It does not send an extra included flag. Excluded source fields remain available in the original edition's sourceFields for a later reviewed edition. The native review/build validates null-versus-empty-string distinctions and rejects a null marker that collides with an actual original value.

A stale expectedRevision is a request to inspect the current record. Read its retained state and decide whether to keep or revise the intended input before resubmitting.

## Query, exact comparison and full briefing

~~~js
const queried = await client.query(readyEditionId, 'limit=2');
// queried.result is the original native dataset response body.
// Its rows retain the reported values as strings.

const compared = await client.value('comparisons.create', {
  leftEditionId: baselineEditionId,
  rightEditionId: candidateEditionId,
  keyFields: ['record_date'],
  measureFields: ['tot_pub_debt_out_amt'],
  name: 'Reviewed daily debt source comparison',
  requestId: 'debt-comparison-reviewed-01'
});

const detail = await client.value('comparisons.get', {
  id: compared.id, offset: 0, limit: 50, changesOnly: true
});
~~~

Use the full reviewed row identity for the selected source. The example record_date key is appropriate only when that date is the complete identity of the selected daily series. The original comparison rejects duplicate keys.

A READY comparison retains exact measure context, participating/missing/nonnumeric row counts, all matched and unmatched rows, and the original fields on each side. Its dated observations carry date, reported value and ordinal, plus the exact first-to-last change. Missing markers remain in the source rows but do not become monetary observations.

Create the ordinary complete comparison export, then the optional whole report:

~~~js
const sourceExport = await client.value('exports.create', {
  kind: 'comparison', id: compared.id,
  requestId: 'debt-comparison-source-01'
});
const briefing = await client.value('briefings.create', {
  comparisonId: compared.id,
  expectedComparisonSha256: compared.sha256,
  exportId: sourceExport.id,
  title: 'Reviewed Treasury debt observations',
  audience: 'Analyst handover',
  notes: 'Read the dated balances and the original unit/context notes.',
  rowsPerPage: 200,
  requestId: 'debt-comparison-briefing-01'
});
~~~

The native briefing retains the exact comparison, original source export, renderer identity and authored context. Its complete briefing.tar.gz contains the offline HTML report, row pages and source archive. The full export also contains readable briefing.json, briefing.md and dated-measures.csv. Select the returned briefing export id using kind: export to receive every native outer file and both complete archive levels.

## Saved refresh plans and run control

The typed client composes the original refresh component when that component is present in the installed client and host. It uses merchant_fiscaldata_refresh_plan and merchant_fiscaldata_refresh_run; an older catalog fails with TOOL_UNAVAILABLE or the original host error.

A plan binds a READY baseline, its complete capture/source, the full reviewed field/query rules, a source or date-window policy, comparison fields and report context.

~~~js
const plan = await client.value('refresh.plans.save', {
  name: 'Weekly reviewed debt observations',
  baselineEditionId: baselineEditionId,
  expectedBaselineSha256: baselineSha256,
  capture: {
    mode: 'window', dateField: 'record_date',
    days: 8, lagDays: 0, baseFilter: ''
  },
  comparison: {
    keyFields: ['record_date'],
    measureFields: ['tot_pub_debt_out_amt']
  },
  briefing: {
    title: 'Weekly Treasury debt source review',
    audience: 'Analyst handover',
    notes: 'Daily stock observations; preserve the original source units.'
  },
  requestId: 'debt-refresh-plan-01'
});
const selected = {
  planId: plan.id,
  expectedRevision: plan.revision,
  expectedPlanSha256: plan.sha256,
  asOf: '2026-10-12'
};
const preview = await client.value('refresh.runs.preview', selected);
// Review the original sourceUrl, period, baseline and copied review.
const run = await client.value('refresh.runs.start', {
  ...selected, requestId: 'debt-refresh-run-20261012-01'
});
~~~

The window uses an explicitly authored baseFilter; the client never guesses which older date clauses to remove. The original host starts its existing worker after start, resume or accepted review. Read the actual run for subsequent decisions.

| Action | Required binding |
|---|---|
| refresh.plans.list / get | Page bounds or exact id |
| refresh.plans.save | New requestId; edits add id and expectedRevision |
| refresh.runs.list / get | Optional planId and page bounds, or exact id |
| refresh.runs.preview | planId, expectedRevision, expectedPlanSha256; optional asOf |
| refresh.runs.start | The same selection plus requestId |
| refresh.runs.pause / resume / cancel | id and exact current expectedRevision |
| refresh.runs.review | Current run id/revision, READY editionId, expectedEditionSha256 and requestId |
| refresh.baseline.promote | planId/revision, completed runId/revision and requestId |

The native run pauses for changed source metadata or a field review issue. Review/build an edition of that run's exact capture, then accept its actual READY hash. A complete run's delivery.id selects an ordinary export whose full files include the frozen plan, actual run, comparison source archive and whole briefing. Baseline promotion is a separate explicit action.

See ../../stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/REFRESH.md for the complete original phase, persistence and recovery contract. This client adds no scheduler and does not manufacture a completed period.

## Select and download every original file

Selecting a download reads an already retained original; it does not create an export, capture, checkpoint or payment.

~~~js
import {
  selectFiscalDownload, writeFiscalSelection, downloadFiscalSelection
} from '@tokenjunkielabs/starforge-merchant/merchant/fiscaldata/download';

const selected = await selectFiscalDownload({
  client, kind: 'export', id: sourceExport.id,
  expectedSha256: sourceExport.sha256
});
await writeFiscalSelection('/absolute/private/debt-selection.json', selected.selection);

const downloaded = await downloadFiscalSelection({
  client,
  selection: selected.selection,
  expectedSelectionSha256: selected.selectionSha256,
  directory: '/absolute/private/debt-delivery',
  onProgress: progress => console.error(progress)
});
~~~

The selection file is published from complete, fsynced private bytes using create-only publication. An existing exact selection is reused. A partial attempt remains separate; it cannot become the selected manifest.

The complete selection pins:

- canonical MCP endpoint, declared alias and immutable source-workspace UUID;
- the named MCP reader id and label;
- original record id, ready state, source SHA and available source/revision bindings;
- every native outer filename, byte count, MIME type and full SHA-256.

The generated fiscal-selection.json is the client selection record. Native files named manifest.json or source.json remain unchanged. Their internal file lists retain their original meaning. In particular, a comparison export's delivery.tar.gz contains its nested original source paths, and a portable package's manifest describes the inner workspace files. The adapter never replaces either original manifest with a list of outer downloads.

~~~sh
node "$FISCAL_CLIENT_CLI" select \
  --url "$MCP_URL" --workspace "$FISCAL_WORKSPACE_ALIAS" \
  --workspace-id "$FISCAL_WORKSPACE_ID" \
  --kind export --id "$FISCAL_EXPORT_ID" \
  --source-sha256 "$FISCAL_EXPORT_SHA256" \
  --out /absolute/private/debt-selection.json

node "$FISCAL_CLIENT_CLI" download \
  --url "$MCP_URL" --workspace "$FISCAL_WORKSPACE_ALIAS" \
  --workspace-id "$FISCAL_WORKSPACE_ID" \
  --selection /absolute/private/debt-selection.json \
  --out /absolute/private/debt-delivery
~~~

Supported complete selections are capture (COMPLETE), edition (READY), comparison (READY), export (READY) and package (sealed). A partial capture can still be retained through the original explicit exports.create action; select that resulting READY export rather than presenting the incomplete capture itself as complete.

### Interruption and retry

Repeat download with the **same selection file, endpoint, alias, reader and output directory**. The existing engine verifies all completed files, checks every retained partial prefix, discards only its own uncheckpointed suffix, resumes the original byte offset and publishes each complete file atomically. An expired native read lease is reopened at that offset against the same file SHA.

SIGINT or an AbortSignal stops local requests. Progress is reported only after the original retained prefix/checkpoint write. The private download-state directory contains recovery state and partial files; keep it with the download until completion. Do not replace a source, edit a checkpoint or choose a new request ID to disguise changed input.

Each selected file is bounded by the maintained immutable-file reader's 8 GiB ceiling. This adapter bounds the full selection to 100,000 files, 32 MiB of selection metadata and 32 GiB of total original file bytes. The original Fiscal model/package limits can be lower and remain authoritative. Download metadata/checkpoints are bounded independently and file hashing uses bounded buffers.

The MCP file adapter passes an original read-only FileHandle to RetainedFileReads. That owner verifies the file against its selected size/SHA and checks device, inode, size and modification/change times around every chunk. The file is not copied into a second snapshot buffer merely for transport.

## Verify and receive a portable source workspace

A checkpoint is an explicit original lifecycle operation. It drains the borrowed browser and accepted work, closes original file reads, seals the actual source workspace under its kernel lease and reopens the same model. Its returned packageId selects exactly workspace.fiscal.gz and manifest.json.

~~~js
const checkpoint = await client.checkpoint('debt-reviewed-checkpoint-01');
const portable = await selectFiscalDownload({
  client, kind: 'package', id: checkpoint.packageId
});
await writeFiscalSelection('/absolute/private/workspace-selection.json', portable.selection);
await downloadFiscalSelection({
  client, selection: portable.selection,
  expectedSelectionSha256: portable.selectionSha256,
  directory: '/absolute/private/workspace-download'
});
~~~

Package listing and file receiving remain available for a closed declared source alias. Ordinary capture/edition/comparison/export reads require its original model to be open.

The following operations are local and require no MCP connection:

~~~sh
node "$FISCAL_CLIENT_CLI" verify \
  --directory /absolute/private/workspace-download \
  --selection-sha256 "$FISCAL_SELECTION_SHA256"

node "$FISCAL_CLIENT_CLI" receive \
  --directory /absolute/private/workspace-download \
  --destination /absolute/private/received-fiscal-workspace \
  --operation-id debt-workspace-receive-01 \
  --operator-id analyst-local \
  --operator-label "Local analyst receiving" \
  --workspace-id "$FISCAL_WORKSPACE_ID" \
  --selection-sha256 "$FISCAL_SELECTION_SHA256"

node "$FISCAL_CLIENT_CLI" reopen \
  --directory /absolute/private/received-fiscal-workspace \
  --workspace-id "$FISCAL_WORKSPACE_ID"
~~~

verify hashes every complete selected file under the existing local download lease. receive additionally invokes the original streaming Fiscal package inspector, compares the inner and downloaded outer manifests, and calls receiveFiscalSourcePackage with the exact package hash, stable operation id and named receiving operator. The destination is selected explicitly. The original receiver accepts its empty destination or resumes the same receiving intent and promotes workspace.json last.

The original source header and all original files remain retained. A receiving receipt increments the working workspace revision and records its source package; an unfinished capture or refresh run is paused according to the original portable contract. Repeat the same receive operation to reconcile an interrupted promotion. Use the resulting working revision for a subsequent edit.

reopen checks the selected UUID and directory identity, opens the actual original model under its kernel lease, returns its native snapshot and closes it. It does not start a capture, publisher, buyer or worker. The output therefore demonstrates that the saved source is usable by the original engine.

The separate client.restore method operates a host-declared destination and its configured sourceImport or sourceWorkspace/packageId. It is the native remote receiving action, not a way to submit arbitrary host paths. Close that exact destination instance first. Local receive is the appropriate method for an independently downloaded package and an explicitly chosen local private destination.

## Operator identity and lifetime

The configured MCP host records accepted mutations under its original named operator, including original inputs and outcomes. client.history pages those records. The download selection records the named reader. Local portable receiving records the separately supplied local receiving operator; it does not rewrite the source's prior history.

client.dispose drains this client's requests and releases its original file-read leases. It leaves the remote model, capture worker and borrowed browser under their original owner's lifetime. Explicit browser('close') uses the host's normal browser drain. Explicit closeWorkspace(instanceId) requires the exact instance id returned by the host and closes that remote instance.

A disconnect is not proof that an accepted server mutation failed. Inspect its original record/history and use the same supported request ID/input to reconcile it. The CLI preserves the original error code and reports JSON errors on stderr; JSON results go to stdout. Tokens are never included in the error envelope or saved selection.

## Native publisher and buyer composition

merchant.configure accepts the original editionId, a **host-declared profile** and requestId. Raw merchant terms cannot bypass that MCP profile. publisher.* actions remain explicit original publisher actions, with native release, buyer workspace, signing and approval controls.

The analyst download/restore flow never calls those actions implicitly. When an original buyer export is already READY, selecting kind: export receives its complete original acquisition files and delivery archive through the same trusted file resolver.

## Source ownership

This contribution changes only the Fiscal client, CLI, declarations, guide, examples and its additive distribution registration. The original refresh owner carries the independent FileHandle loader join in the shared Fiscal adapter. RetainedFileReads, retained-download, the Fiscal model, portable receiver, refresh engine, briefing renderer and payment flow remain their existing implementations.

Relevant source contracts in this repository are retained-download.mjs, retained-file-reads.mjs, catalog/fiscaldata-workspace.mjs, FISCALDATA-WORKSPACE.md the Fiscal DOMAIN.md and REFRESH.md guides, and the original portable.mjs receiver. The companion input templates contain no customer data, secrets or claimed completed operation.
