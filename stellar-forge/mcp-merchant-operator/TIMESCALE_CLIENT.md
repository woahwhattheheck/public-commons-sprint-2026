# Timescale client and assigned-work receiving

This client uses the existing merchant MCP host, its original Timescale project, and its original retained-file receiver. It covers source editions, comparison review, refresh and job plans, publication, assigned remediation, complete reports and whole-project receiving. It adds no SQL endpoint, database, scheduler or server.

Configure the original host with [TIMESCALE_WORKSPACE.md](TIMESCALE_WORKSPACE.md). The installed command is `starforge timescale-client`. The programmatic export is `@tokenjunkielabs/starforge-merchant/merchant/mcp/timescale/client`; its adjacent declaration file describes the original inputs and results.

## Start with the existing project

Use the MCP URL printed by the original `timescale-agent` or installed Applications start. Keep its bearer token in the agreed environment variable, outside request files and reports. The client accepts HTTPS, or the original loopback HTTP endpoint. It rejects URL credentials, fragments, query strings and redirects.

Work in an ordinary-user private directory:

```sh
umask 077
mkdir -p "$PWD/timescale-receiving"
cd "$PWD/timescale-receiving"

starforge timescale-client status \
  --url "$TIMESCALE_MCP_URL" --workspace usage \
  --workspace-id "$TIMESCALE_WORKSPACE_ID" \
  --token-env TIMESCALE_MCP_TOKEN
```

The persistent workspace ID comes from the existing host configuration/status. The client checks it on every reply. `open` first reads that declared identity, then opens or reuses the original publisher. It never silently opens a different project when an alias has changed.

The original browser and MCP tools share one model, journal, publisher and scheduler. Ending this client does not close that host. The explicit `close` method needs the actual current adapter and publisher instance IDs. Closing the borrowed resource keeps the original publisher owner until its normal owner close.

## Read exact sources and original results

Every method accepts the original JSON arguments through `--input PRIVATE_JSON`. Files must be private regular files under a private directory. `--input-sha256` optionally fixes their exact bytes. The command prints the returned original result as JSON.

| Method | Required selection |
| --- | --- |
| edition | editionId; optionally table, offset and limit |
| compare | beforeId, afterId; optionally offset and limit |
| plan | original planId |
| record | requestId and result/before; optionally native table and page |
| operation | action inspect/cancel and the original requestId |
| file | edition/result/before, original id, expectedSha256 and byte offset |
| remediation-sources | optional page of completed Remediate/Defer review choices |
| remediation-item | workItemId; select summary or an exact pinned history section |
| remediation-context | workItemId, itemRevision, itemDigest; optional later edition |

Native table cells remain exact strings or null. Decimal amounts, timestamps and PostgreSQL identifiers are not coerced into JavaScript numeric values. Complete source JSON and native result bytes remain available through the original file tools and full project export.

A comparison page is a view of the complete original comparison digest. A new review must account for every change, including later pages. The client does not generate approval or remediation decisions. A source choice exposes its original review, comparison, change and source digests plus changed field names. Full before/after values stay in the original editions and the complete work-item report; a shortened source summary is not substituted for those originals.

## Retain mutations before dispatch

Capture, review, refresh, verification, job changes, publication and work-item commands retain their existing request UUID. Prepare the complete request JSON before the call. The client does not generate a replacement UUID or replay a mutation when a response is lost.

```sh
starforge timescale-client remediation-command \
  --url "$TIMESCALE_MCP_URL" --workspace usage \
  --workspace-id "$TIMESCALE_WORKSPACE_ID" \
  --token-env TIMESCALE_MCP_TOKEN \
  --input "$PWD/assigned-work-request.json" \
  --input-sha256 "$REQUEST_FILE_SHA256" --wait-ms 600000
```

`--wait-ms` only reads that same accepted operation until it returns. A client interruption or observation timeout does not cancel or resubmit the server operation. Use `operation` with the same requestId to recover its actual result. `OUTCOME_UNKNOWN` remains an unknown native outcome and requires the original reconciliation path.

If the original operation is FAILED or INTERRUPTED and its existing API permits continuation, inspect the cause and current workspace first. An explicit repeat uses the same request UUID and meaningful input; the current optimistic workspace version may be refreshed. A changed item, plan, source or requested action needs a reviewed new request. The server still verifies its original request digest.

## Assign and continue real work

The source must be a completed original comparison review with a Remediate or Defer decision. Creating work does not change that review. An item carries owner, due date, priority, intended work and acceptance condition.

The full source contract is in [the original remediation guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/REMEDIATION.md). All seven actions are available through the same merchant command:

| Action | Exact additional input |
| --- | --- |
| create | full source reference and work fields |
| edit | workItemId, expectedRevision and all mutable work fields |
| rebase | workItemId, expectedRevision and a later exact review of the same original catalog item |
| bind-plan | workItemId, expectedRevision, planId, planDigest and relevance |
| observe | workItemId, expectedRevision, original operationId/operationDigest and relevance |
| resolve | workItemId, expectedRevision and the full later-edition resolution |
| reopen | workItemId, expectedRevision and OPEN/IN_PROGRESS/DEFERRED |

Every command also needs requestId, expectedVersion, actor and note. Work fields contain title, owner, optional empty/actual YYYY-MM-DD dueDate, NORMAL/HIGH/URGENT priority, intent, acceptance and OPEN/IN_PROGRESS/DEFERRED status.

Use operation digests returned by the original remediation context. Do not hash a shortened MCP display and use that as the native operation digest. Observing an operation preserves its state at the recorded time; it does not rerun its refresh or job change.

CURRENT_STATE_REVIEW records the operator's assessment of a later retained catalog edition. It does not assert complete aggregate coverage. COMPLETE_AGGREGATE_VERIFICATION requires the original matching verification and exact plan/window, completed after the selected later edition. Earlier successful verification is not silently relabeled as coverage for a later source.

Read item summary first. To page `plans`, `observations` or `history`, send its exact itemRevision and itemDigest on every page. The response includes total and nextOffset. A changed item produces a conflict, so a receiver cannot join pages from different revisions. Full original operation bodies and source field values are also in the report JSON.

## Retain and receive the complete report

The report operation calls the original renderer. It stores its exact full JSON and printable HTML inside the original workspace at `remediation-reports/REQUEST_UUID`, with a manifest. The original exclusive writer records its request and completion. Existing whole-project export automatically includes that directory and the full earlier item history.

A report request is:

```json
{
  "requestId": "THE_NEW_REPORT_REQUEST_UUID",
  "expectedVersion": 42,
  "workItemId": "THE_ORIGINAL_WORK_ITEM_UUID",
  "itemRevision": 6,
  "itemDigest": "THE_EXACT_CURRENT_ITEM_SHA256"
}
```

Replace every shown value with the actual selected result. Run `remediation-report --input ... --wait-ms ...`, then `report-manifest` with `{"exportId":"THE_SAME_REPORT_UUID"}`. This manifest read performs no new rendering or database capture.

```sh
starforge timescale-client report-download \
  --url "$TIMESCALE_MCP_URL" --workspace usage \
  --workspace-id "$TIMESCALE_WORKSPACE_ID" \
  --token-env TIMESCALE_MCP_TOKEN \
  --export "$REPORT_REQUEST_ID" --directory "$PWD/received-report" \
  --expected-manifest-sha256 "$REPORT_MANIFEST_SHA256"
```

The directory receives the complete `Timescale_Remediation_Manifest.json`, `report.json` and `report.html`. Open the HTML directly. It uses the original script-free renderer and includes source decisions, linked plans, observed outcomes, resolution meaning and complete revision metadata.

Repeat the exact receiving command after interruption. The maintained receiver rechecks the original manifest, endpoint, workspace, file digests and retained byte prefix before continuing. A host restart can reopen the same completed report even after other project work has advanced. No source renderer is called for a completed report. If the MCP endpoint changes, its original endpoint binding must be restored or a new explicitly selected receiving directory used.

The report manifest is bounded at 64 KiB; each complete JSON/HTML file is bounded at 256 MiB. Oversized reports fail clearly before final publication. The full original workspace package remains available. Reads use the existing immutable file descriptors and at most196,608 bytes per chunk; the whole report is not copied into memory for each chunk.

## Programmatic workflow

```js
import { openTimescaleClient } from
  '@tokenjunkielabs/starforge-merchant/merchant/mcp/timescale/client';

const client = await openTimescaleClient({
  url: process.env.TIMESCALE_MCP_URL,
  workspace: 'usage',
  workspaceId: process.env.TIMESCALE_WORKSPACE_ID,
  tokenEnv: 'TIMESCALE_MCP_TOKEN'
});
await client.open();
const status = await client.status();
const choices = await client.remediation.sources({offset: 0, limit: 25});

// Load this complete original request from the caller's retained private file.
// The source/plan/item references come from the actual inspected choices.
const accepted = await client.remediation.command(savedRequest);
const operation = await client.wait(accepted.id);
if (operation.state !== 'COMPLETE') {
  throw new Error('Inspect the original operation: ' + operation.id);
}

const selected = await client.remediation.item({
  workItemId: operation.result.workItemId
});
const page = await client.remediation.item({
  workItemId: selected.item.id,
  itemRevision: selected.item.revision,
  itemDigest: selected.itemDigest,
  section: 'history', offset: 0, limit: 25
});
// Follow page.page.nextOffset with the same item pin for every remaining row.

const originalReport = await client.remediation.inspectReport({
  exportId: savedReportRequest.requestId
});
await client.remediation.downloadReport({
  exportId: savedReportRequest.requestId,
  directory: process.env.TIMESCALE_REPORT_DIRECTORY,
  expectedManifestSha256: originalReport.manifestSha256
});
```

The client exposes typed original capture, edition, comparison, review, refresh, verify, job, publication, operation, plan, record, file and browser methods alongside remediation. It also exposes `exports.inspect` and `exports.download` for the existing whole-project format. Raw `call` is restricted to the declared Timescale methods, with the same persistent scope.

## Full project handover and reopening

Create a new original workspace export after report retention. Receive it with `timescale-client download` or `client.exports.download`. The maintained native package includes the Timescale journal, all source editions/results, publisher state, original dataset generations, empty directories and every retained remediation report. Existing source configuration and environment-reference rules are preserved.

Use the original `dataset-timescale receive` command or `receiveTimescaleWorkspace` API to receive into a new private project. Reopen it through its maintained model or installed Applications. The received work items retain their complete original revisions and source identities. The received report files must match their manifest, while the mutable receiving workspace remains distinct from the immutable downloaded package.

The ordinary full-package reader supports 8 GiB per original file and 64 MiB for its complete download manifest. Those receiving bounds are separate from the native package's larger per-file construction ceiling. Nothing in this client expands paid authority or causes another purchase.

The source-owned receiving continuation operates this client against the original completed native project and existing merchant configuration, after the original merchant/browser receiver closes:

    starforge-merchant timescale-remediation-receiving \
      --native-result "$PRIVATE/native/native-demo.json" \
      --config "$PRIVATE/merchant-receiving/merchant/merchant-mcp.json" \
      --workspace usage --directory "$PRIVATE/remediation-receiving"

The same `--directory` retains each request before dispatch. This is the single complete desk continuation: it assigns the actual changed native job through a new complete comparison review, edits and explicitly adopts a later review, links the original plan and actual outcome, captures one later read-only edition, records an explicit current-state resolution, and reopens it with its prior resolution retained in history. It never repeats a refresh, job change, dataset publication or database setup.

The continuation retains the original full report, deliberately pauses its actual file download, closes and reopens the same merchant owner, and resumes the same verified receiving prefix. It runs the installed client command against the retained item, exports and receives the complete original project, and reopens its work history, original before/after editions, later edition, report files and four exact-text published customer rows. Its complete record distinguishes the one read-only source capture from zero database mutations. Reopening an already completed receiving record verifies its retained report/package/receipt without contacting the source.

API hosts can call `runTimescaleRemediationReceiving({nativeResult, configPath, workspace, directory, environment})` from the same executable module. The externally owned original Timescale database remains available for the read-only later capture. The function closes only the merchant/receiving handles it opens. Actual completion belongs to that one equipped runtime's returned record.
