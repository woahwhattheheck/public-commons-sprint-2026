# Analysis Lineage through the native agent

This interface uses the existing Analysis workspace, its saved lineage plans and its original publication worker. An operator chooses a completed Analysis job, reviews its complete dependency closure, saves the exact event source, publishes that saved plan to a configured collector and downloads the original delivery files.

The agent receives configured aliases and original IDs. Startup connection files, producer credentials and local cache paths remain with the host. Review, plan saving and downloads do not publish events.

## Configure the existing hosts

Start the original Analysis service with its existing Lineage connections configuration and complete selected runtime. A connection names an original collector workspace UUID, startup connection file and optional private producer-token file. The service reads the current startup file; the reviewed collector origin remains pinned. The original bridge permits a local collector restart to change only the port on the same numeric loopback host and scheme.

Register that running Analysis service in the existing MCP native workspace. Use its actual Analysis alias as `analysisWorkspace`. Every operation below uses the original native Analysis envelope:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "analysis",
  "analysisOperation": "lineage-configuration",
  "analysisRequest": {}
}
~~~

The response is the existing native Analysis envelope; its `result` is the operation result described here. The configuration includes `workspace_id` for Analysis, `can_publish`, existing collector aliases, their actual collector UUIDs and current availability. It contains no token or startup-file path.

The identities have different roles:

| Field | Original identity |
|---|---|
| `analysisWorkspace` | Host-registered Analysis alias |
| Analysis `workspace_id` | 32 lowercase hexadecimal characters |
| `connection` | Existing collector alias from `lineage-configuration` |
| `expected_workspace_id` | Canonical hyphenated collector workspace UUID |
| `job_id` | Completed source Analysis job, 32 lowercase hexadecimal characters |
| Plan `id` / `plan_id` | Saved plan, 32 lowercase hexadecimal characters |
| Publication `id` | Original Analysis publication job, 32 lowercase hexadecimal characters |
| `operation_id` | Original collector idempotency key retained by the plan |
| `plan_sha256` / `index_sha256` | Exact reviewed plan / selected delivery index |

A publication request ID must be saved before dispatch and reused after a lost reply. The plan already owns the original collector idempotency key.

## Review and save a complete plan

Call `lineage-jobs` with `{}` or `{before, limit}`. These are completed imports, response imports, queries, complete query exports and workbooks supported by the original projection. Use the returned `next_before` unchanged.

Call `lineage-review` with the selected `job_id` and an explicit `include_sql` choice. SQL inclusion changes the retained source and its review digest. The default summary returns `snapshot_sha256`, `events_sha256`, `events_bytes` and the original job/dataset/event counts. It does not rerun Analysis.

The optional fields `collection`, `offset` and `limit` page metadata from the same complete source:

| Collection | Returned metadata |
|---|---|
| `summary` | Original digests, counts and bounded warning preview |
| `jobs` | Original job/run IDs, timestamps, dependency counts and native detail hashes |
| `datasets` | Native dataset names, namespaces, facet names and scalar Analysis metadata |
| `events` | Original event type/time, run/job identity and input/output counts |

`limit` defaults to 25 and is at most 100. `projection.next_offset` is the next position; a byte-bound page can return fewer than the requested limit. `projection.kind` is `metadata`. Large mappings, SQL text, document bodies and full facet content remain in the original complete download files. Warning previews and omitted metadata fields are marked explicitly.

Save the plan with `lineage-save-plan`:

~~~json
{
  "id": "<saved plan ID:32hex>",
  "job_id": "<original completed Analysis job ID:32hex>",
  "expected_snapshot_sha256": "<lineage-review snapshot SHA256>",
  "connection": "<configured collector alias>",
  "expected_workspace_id": "<actual collector workspace UUID>",
  "title": "Workbook lineage",
  "note": "Reviewed original import, complete query export and workbook.",
  "include_sql": false
}
~~~

The original service rechecks the reviewed snapshot, freezes the exact event bytes and binds the selected collector. A title is nonblank and at most 160 characters. Notes can be empty, at most 4000 characters, with ordinary tabs/newlines.

The result preserves the complete normalized `request`, the plan ID and SHA, source event SHA/length/name/URL, target binding and actual publication state. To recover an uncertain save, read `lineage-plan` using the same `plan_id` or repeat the exact original save request. Do not create another plan solely because the reply was lost.

`lineage-plans` lists compact summaries. Its `request_summary` is explicitly incomplete; retrieve `lineage-plan` for the full original replay request. Plan reads accept the same optional metadata collection paging.

## Publish and reopen the original job

Publish with:

~~~json
{
  "id": "<saved original publication job ID:32hex>",
  "plan_id": "<saved plan ID:32hex>",
  "plan_sha256": "<exact plan SHA256>"
}
~~~

Use operation `lineage-publish`. The helper reads the current original plan. If it already names a publication job, that job ID must match; the helper reads the actual original job before an explicit continuation. A completed job returns its retained result. Otherwise the original Analysis start/resume rules decide whether that same request can proceed.

After an uncertain reply, use `lineage-publication` with the same `id`. Its result is the actual original Analysis job, request, result, error and progress. An accepted result contains the original native collector receipt; completion is not inferred from a transport connection or a successful local command.

If work is still unwanted, `lineage-cancel` with that `id` requests cancellation of the original local worker. This returns the native progress envelope with `job_id`, `state`, `cancel_requested` and observations. Read `lineage-publication` afterward to see the actual job outcome. A complete accepted collector receipt remains accepted.

A saved plan can have an unknown dispatch outcome. Reuse its exact source, original job ID and collector key through the original continuation path. No helper operation creates a replacement key, changes the collector destination or automatically resends an uncertain publication.

## Select and read the exact delivery files

`lineage-downloads` accepts `{plan_id}` and returns the unchanged original native index:

~~~text
schema, workspace_id, plan_id, plan_sha256, events_sha256,
manifest_sha256, files[{name,bytes,sha256,mime}], index_sha256
~~~

The index has exactly these seven complete files:

| File | Original content |
|---|---|
| `events.json` | Exact event-source bytes submitted by this plan |
| `plan.json` | Original saved plan and selected publication view |
| `native-bindings.json` | Complete Analysis source and dependency bindings |
| `receipts.json` | Original publication observations and receipts |
| `report.html` | Human-readable original publication report |
| `manifest.json` | Full handover member identities |
| `handover.zip` | Complete portable delivery verified by the original reader |

The index hash is the original sorted-key UTF-8 canonical JSON digest. Its selected bytes may change when later publication observations are added. Preserve the exact returned `plan_sha256`, `index_sha256`, file SHA and byte count for a download.

`lineage-file` requires `{plan_id, plan_sha256, index_sha256, filename, sha256}` and optional `byteOffset` / `maxBytes`. The maximum chunk is 65536 bytes; the default is 32768. The first file read checks the current native index, receives the complete selected file (at most 128 MiB), verifies its exact size/hash and privately publishes it through the existing initialization helpers. Each subsequent range uses the existing SavedFileReader and its stable descriptor/hash check.

The result is:

~~~text
{
  planId, workspaceId, planSha256, indexSha256, filename,
  file: {bytes,sha256,contentType,byteOffset,returnedBytes,
         encoding:"base64",data,nextByteOffset,verifiedSavedFile:true}
}
~~~

Follow `file.nextByteOffset` until it is null. A cached original file remains tied to its original index even after a newer publication history changes the live index. If that old file was never saved and the current native index differs, the operation refuses the mismatch; inspect and review the new index rather than mixing editions.

The agent never supplies a cache path. The original host owns the private `analysis/lineage-files/<workspace>/<plan>/<index>/` directory beneath its registered native workspace. Local publication and file reads remain inside the parent's complete request/close lifetime.

## Download, resume and reopen with the CLI

The maintained entry point is `stellar-forge/mcp-paid-agent/native-analysis-lineage-download.mjs`. It uses the existing retained-download transport and saves all seven original members plus `lineage-download-index.json`.

~~~bash
node stellar-forge/mcp-paid-agent/native-analysis-lineage-download.mjs inspect \
  --url "$MCP_URL" --workspace analysis --plan "$PLAN_ID" --token-env MCP_TOKEN

node stellar-forge/mcp-paid-agent/native-analysis-lineage-download.mjs download \
  --url "$MCP_URL" --workspace analysis --plan "$PLAN_ID" --token-env MCP_TOKEN \
  --dir /absolute/private/lineage-delivery \
  --plan-sha256 "$PLAN_SHA256" --index-sha256 "$INDEX_SHA256" --chunk-size 32768

node stellar-forge/mcp-paid-agent/native-analysis-lineage-download.mjs reopen \
  --plan "$PLAN_ID" --dir /absolute/private/lineage-delivery \
  --plan-sha256 "$PLAN_SHA256" --index-sha256 "$INDEX_SHA256"
~~~

`--token-env` selects an existing environment variable when this MCP host requires it; omit it for a host configured without that credential. Tokens are not command-line values.

Repeat `download` with the same directory and identities after a lost range reply or MCP restart. The original download checkpoint binds its exact verified prefix and exclusive final publication. `reopen` verifies the complete saved files and index without a live host or collector.

The original Python handover reader can then inspect the complete exported archive offline:

~~~python
from stellar_forge_buyer.analysis_lineage_reports import LineagePublication

publication = LineagePublication(
    "/absolute/private/lineage-delivery/handover.zip",
    expected_sha256="<exact handover.zip SHA256 from the saved index>",
)
review = publication.inspect()
print(review["plan_id"], review["events_sha256"])
print(review["summary"])
~~~

The constructor verifies all original handover members, plan/event digests and accepted native receipt. `publication.plan`, `.snapshot`, `.receipts`, `.events` and `.manifest` are the retained parsed values. `publication.native_document(sha256)` returns a selected exact verified original document. This reader has no context-manager or close method and makes no collector call.

## Receiving and deployment

Ship these additive helper/schema/guide leaves with the original Analysis dispatcher, schema imports, native file reader and complete original initialization module. The dispatcher owns HTTP capability/origin checks, response bounds, cancellation and draining through local publication.

The existing full receiving programme reuses one saved plan and its accepted publication ID. It reads the original plan and job, repeats the exact saved request, downloads the native files, interrupts a real retained prefix, reopens the same MCP workspace at a new port, resumes into the same directory and verifies the delivery offline. It creates no second Analysis run or collector publication.

Source publication, syntax/import checks and an executed native receiving result are separate evidence. The operating commands above do not claim that a receiving run has completed.
