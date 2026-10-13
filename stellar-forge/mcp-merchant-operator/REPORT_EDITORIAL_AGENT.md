# Report editorial agents and full recipient delivery

This provider operates the maintained Analysis report editorial workflow from a Merchant agent or installed CLI. It uses the original running Analysis workspace and its capability. The original report model remains the definition writer; the existing report run, exact query revisions, typed table values and saved source bindings travel with the recipient package.

The customer can issue an actual completed report to a named recipient, receive that recipient's complete attributed return, compare it with the original issue and the author's current definition, explicitly apply selected editorial changes, reconcile interruptions, and receive the complete original files into a separate directory. Query definitions and native publication remain under the original report interface.

## Connect the existing workspace

Add this configuration property to the original Merchant host's complete configuration:

~~~json
{
  "reportEditorialConnection": "./report-editorial-connection.json"
}
~~~

The connection file follows examples/report-editorial-connection.json. Replace its illustrative all-zero workspace ID with the actual original Analysis workspace_id. Select the existing private Analysis launch JSON. Its URL must be the original numeric-loopback listener with its private fragment capability; the saved workspace ID must match the live state. Paths resolve relative to the connection file. Preserve private file permissions. Configure the host's existing exportsDirectory for retained complete deliveries.

The source-owned distribution contribution registers the provider and installed report-editorial-agent command. Each alias is an explicit operator selection; connections returns the configured aliases, readable labels and original workspace IDs. This interface does not start another AnalysisWorkspace or acquire its database lease.

## Whole operator flow

1. Obtain the actual COMPLETE report job ID and result SHA256 from the existing report run. The state action lists the original recent report jobs; it does not manufacture a completed report or rerun one. The existing report UI supplies the result hash.
2. Issue that selected report with a stable original 32-character request ID, named recipient and instructions. The exact full request is saved before dispatch. The response includes a complete delivery selection.
3. Download the delivery with its exportId and manifest SHA256. It contains review.html, package.json and the issue record, including all original typed source rows. The recipient opens the actual HTML, edits editorial wording, saves unfinished work and its editions, and downloads the attributed returned JSON.
4. Receive that full JSON with a stable uploadId and private operation directory. The client saves the complete file within its immutable intent before the first upload. It sends original 64 KiB chunks with exact offsets and hashes. Resume from the verified availableBytes prefix, including after fragments are moved or unavailable. Original source/issue/workspace bindings are checked again before native registration.
5. Read the complete comparison.json produced by preview. It retains current and issued section definitions, explicit section mapping, original/current/returned text and the native preview SHA256. Inspect all fields; tools return a compact file selection, and the complete comparison is received through the same original file transport.
6. Apply only explicit reviewed choices with the exact preview_sha256, section mapping, decision note and new original request ID. A successful save uses the native report definition CAS. The current query definitions remain intact.
7. Read original status after an uncertain reply. Reuse the same request body and ID to continue. A recorded NEEDS_REVIEW means a fresh comparison is required; preserve that original rejection, then create a different request only for newly reviewed choices.
8. Download the selected application outcome and original recipient/return files. Full original SQLite workspace export carries issue, return and application history for cold receiving; this provider's delivery is the report-specific portable recipient package.

External sending remains a separate authorized action. The named recipient field is part of the editorial record; issue does not send email or a Slack message.

## Complete command examples

Use the original endpoint and bearer token environment variable. Arguments are private UTF-8 JSON files. All IDs below are descriptions: use the actual original 32 lower-case hex identities.

~~~sh
starforge report-editorial-agent call \
  --url "$MCP_URL" --action issue \
  --arguments /absolute/private/issue.json \
  --directory /absolute/private/issue-operation
~~~

An issue arguments file contains workspace and request:

~~~json
{
  "workspace": "research",
  "request": {
    "id": "ORIGINAL_32_HEX_REQUEST_ID",
    "job_id": "ACTUAL_COMPLETE_REPORT_JOB_ID",
    "result_sha256": "ACTUAL_REPORT_RESULT_SHA256",
    "recipient": "Named reviewer",
    "instructions": "Review the introduction and section notes against the complete report."
  }
}
~~~

Use the returned delivery.exportId and delivery.manifestFile.sha256:

~~~sh
starforge report-editorial-agent download \
  --url "$MCP_URL" --workspace research \
  --export-id ACTUAL_EXPORT_SHA256 \
  --manifest-sha256 ACTUAL_MANIFEST_SHA256 \
  --directory /absolute/private/recipient-delivery
~~~

Receive the actual full recipient return:

~~~sh
starforge report-editorial-agent receive \
  --url "$MCP_URL" --workspace research \
  --upload-id ORIGINAL_32_HEX_UPLOAD_ID \
  --returned /absolute/private/Report_Return.json \
  --directory /absolute/private/return-operation
~~~

Repeat the same command/directory/upload ID after interruption. Once the complete intent exists, --returned may be omitted: it reconstructs the exact original file from the saved complete bytes. This cannot replace the recipient's return ID or silently change its contents. A later genuinely edited return must use its actual new native return identity and a new upload operation.

Preview arguments are {"workspace":"research","returnId":"ACTUAL_RETURN_ID","mapping":null}. The native model proposes unambiguous same-query section matches. Supply a complete explicit array of target section indices or null when necessary, obtain its new preview, and review it before apply.

Apply arguments contain workspace, returnId and this full native request shape:

~~~json
{
  "id": "ORIGINAL_32_HEX_APPLY_ID",
  "preview_sha256": "EXACT_REVIEWED_NATIVE_PREVIEW_SHA256",
  "mapping": [0, 1],
  "decisions": {
    "title": {"choice": "returned"},
    "introduction": {"choice": "current"},
    "sections/0/note": {"choice": "custom", "text": "Explicitly reviewed wording."}
  },
  "note": "Why these particular changes were accepted."
}
~~~

The native model validates every choice and required field. Use the actual returned mapping and field keys, not the illustrative two-section array. The available choices are current, returned and custom. Full unchanged fields remain from the current authored definition.

Use a different private call directory for a different intent. Retrying an existing directory validates its exact endpoint, action and complete arguments before any write. The CLI prints the compact result and keeps every full result/error observation by content hash.

## Tool catalogue and complete history

All actions use merchant_report_editorial_:

| Action | Original effect or result |
|---|---|
| connections, state | Declared aliases and current original report job selectors |
| history | Compact issue page; continue next_before |
| detail | Full issue file and independent returns/applies summary pages; continue both cursors |
| issue | Durable original request, native issue, complete recipient delivery |
| return_begin, return_status, return_chunk | Complete original file intent and verified contiguous chunk custody |
| return_receive | Same-ID attributed native registration and complete file capture |
| returned | Full exact returned record with original recipient sources |
| preview | Complete current/issued/returned comparison file and exact native preview hash |
| apply | Original native save using reviewed choices and retained request |
| status | Original application record and its complete files |
| export | Exact issue with selected return/application records |
| manifest, file, file_release | Full retained file reception with hashes, EOF and read leases |

Read and preserve every relevant history page. Issues and returned/application records are immutable or native-versioned as defined by the original report model. Comparison is a current observation; its native digest must be reviewed again after a current definition change.

MCP envelopes are bounded at 1 MiB plus 64 KiB; the original issue/apply request itself retains its native 1 MiB limit. Large recipient returns use the complete-file upload route, never shortened JSON. Source packages and captured native records have explicit 512 MiB complete-file capacity. The original native issue source is bounded by the report model. Returned JSON remains within its original 16 MiB limit. Each upload chunk is 64 KiB. The delivery manifest is at most 65,000 bytes and names every full selected file.

A content-derived export ID includes all selected complete member hashes, source identity, workspace identity and native issue/return/application IDs. A later corrected recipient HTML edition is retained as a different delivery with its exact body; earlier deliveries remain readable.

## Request and shutdown custody

The host saves full native write intent before dispatch, reads the original native request record before replay, and retains every observed result/error. A received HTTP reply followed by a local storage failure is not represented as a missing native request. Read the original status and continue the same original intent.

Local upload and capture work is serialized per declared alias. The native SQLite report transaction remains the only report writer, including when two aliases select the same original workspace. File readers have the original retained read leases. The provider drains its pending calls and retained readers on shutdown, aborting its own HTTP clients without closing the original Analysis application.

The uploader retains both the original full return and immutable exact chunks. A missing fragment is retransmitted from the original file using the same upload ID and hash. A mismatch is preserved and reported. Registration never proceeds from SQL counters or metadata without the actual complete hash-verified bytes.

The receiver uses the existing Merchant retained downloader: complete manifest first, checkpointed original file chunks, full length and SHA checks, manifest publication last. It then checks that package.json contains the exact issue/workspace/source binding, hashes its original source_json, and checks any returned/application IDs. Retained downloads continue after the native Analysis service closes.

## JavaScript integration

The installed distribution exports:
- merchant/report-editorial/client: callReportEditorial, receiveReportEditorialReturn, downloadReportEditorial and the retained downloader factory.
- merchant/report-editorial/native: the existing-owner HTTP client wrapper for an equipped local caller.
- merchant/report-editorial/provider: source-owned Merchant provider declaration.

A caller-supplied Merchant client has a stable endpoint and call(name,args,options). Its lifecycle remains with its original caller. The optional caller signal cancels only this operation. The reusable native wrapper accepts the original launch and workspaceId and uses the existing Origin/capability headers.

## Original receiving integration

Compose this provider on the same maintained Analysis report source and FE85 original receiving case. The native report browser course receives an actual completed report job/result SHA and caller-owned Pages. Its source and guide are maintained under sf88-operator-buyer-cli/python/receiving/report_editorial_course.mjs and REPORT_EDITORIAL_COURSE.md. The prepared managed-runtime archive is an installation input; the original case must finish producing its actual report before that selection is available.

The report source, offline recipient and native author browser course have separate operation, cold-receiving and visual-review completion fields. Agent source integration and successful complete-file reception should be recorded with their actual outcomes. Native/browser acceptance comes from that original running case and actual rendered views.
