# DSpace repository workspace — joined API

Maintained source: `business/dspace-mcp-repository-workspace-20261012/`.
Native root: `/workspace/scratch/f47a89a78f42/4science-repository-workspace`.

Root owns `server.mjs`, `public/index.html`, `public/app.mjs`, `public/style.css`, and `WORKFLOW.md`.
Revenue_workshare owns `workspace.mjs`, `bridge.mjs`, `store.mjs`, `patch.mjs`, `vendor/`, examples, source and commercial delivery.

## Original implementation

4Science/dspace-mcp commit `ee503ba97910f592867c897c1fa938f9e029d03c`; actual tree `6386328dd49282b98840b4dd41340b9c8a110b78`. Preserve upstream code and notices in vendor/dspace-mcp. Original source registers 15 tools, including dspace_move_item. It uses AGPL-3.0 notices; original LICENSE is retained.

The bridge registers the unchanged original tools with their original DSpaceClient and connects an actual MCP SDK Client over the SDK in-memory transport. The native DSpace request/response observations and original MCP result are retained together. DSpace credentials come only from configured environment variable names; values and auth/cookie headers never enter saved workspace/export.

## Core interface

```js
import { openWorkspace } from './workspace.mjs';
const workspace = await openWorkspace({directory, upstreamRoot}); // upstreamRoot optional: vendor/dspace-mcp
workspace.state(); // synchronous summary
workspace.read(kind, id, {offset:0,limit:50}); // synchronous, kind below
await workspace.dispatch(action, input); // write/capture; see below
workspace.file(kind, id); // {bytes: Buffer, filename, contentType}
await workspace.close();
```

All persisted actions require `{actor,operationId,revision,...payload}`. Actor is a staff attribution label, while the actual authenticated DSpace principal comes from the original native session and is retained separately. Repeat same operationId/action/input returns the saved result. An altered replay returns an error. Revision is an integer; changed state returns 409 with `{error,message,current_revision}`. Native writes have a durable execution record before dispatch.

Server should bind 127.0.0.1 by default. Generate a session token, insert it into an `__SESSION_TOKEN__` HTML meta tag and require `X-Workspace-Token` on every /api request and download (browser downloads can use fetched Blob URLs). Reject unsafe Origin. Max JSON body 32 MiB; file upload included below.

### Suggested HTTP mapping

- GET /api/state -> workspace.state()
- GET /api/records/:kind/:id -> workspace.read(kind,id,pagination)
- POST /api/actions/:action -> await workspace.dispatch(action,body)
- GET /api/files/:kind/:id -> workspace.file(kind,id)
- GET /api/files/handoff/current -> complete portable gzip JSON handover
- GET /api/files/backup/current -> same complete native workspace export (filename differs)
- POST /api/actions/restore -> original complete export into an empty workspace only

Errors thrown by core carry `code`, `status`, optional `current_revision`; expose them as `{error:code,message,current_revision?}`.

## State and read models

State:
```json
{
  "schema":"dspace-repository-workspace/v1","revision":0,
  "upstream":{"repository":"4Science/dspace-mcp","commit":"ee503ba97910f592867c897c1fa938f9e029d03c","license":"AGPL-3.0"},
  "selected_profile_id":null,
  "profiles":[],
  "captures":[],
  "selections":[],
  "plans":[],
  "executions":[],
  "assets":[],
  "tools":[],
  "limits":{"selection_items":500,"plan_steps":100,"asset_bytes":20971520}
}
```

Profiles: `{id,name,base_url,auth_env:{token,user,password},created_at,previous_profile_id,connection}`. Env values absent. Connection includes authenticated, principal:{uuid,email,name}, checked_at, error if any. Profiles are immutable; editing creates a successor; select switches the active pointer.

Capture summaries: `{id,label,profile_id,tool,args,created_at,principal,object_count,request_count,is_error}`.
Full capture: summary plus `result` (original MCP response), `requests` (method, URL, status, response body, sha256, content type, timestamp; auth redacted), `objects` (native full item/collection/community/workspaceitem records), `assets`.
Read `captures` returns full capture plus paged `rows,total,offset,limit` from objects. Preserve metadata arrays with value/language/authority/confidence/place and all other native fields.

Selections: `{id,name,profile_id,members:[{capture_id,uuid,type,name}],created_at,previous_selection_id}`. Read `selections` adds exact native object to each paged row. UUID is scoped to profile; workspace item numeric IDs remain their own type.

Plans: `{id,name,profile_id,created_at,previous_plan_id,step_count,status,review,latest_execution_id}`.
Read `plans` adds complete `steps`: `{id,tool,args,source_capture_id,subject_id,before,after,changes,preconditions,asset_id}`. Changes are `{path,before,after}`, retaining original metadata arrays and missing-vs-null meaning. Review is `{actor,decision,note,at}`. Status PREPARED / CHANGES_REQUESTED / APPROVED / RUNNING / APPLIED / PARTIAL / UNCERTAIN / CONFLICT.

Executions: `{id,plan_id,profile_id,principal,status,created_at,updated_at,steps}`. Step status PENDING / RUNNING / APPLIED / RECOVERED / FAILED / UNCERTAIN / CONFLICT. Steps retain original tool/args, native before/after observations, MCP result, requests, error and subject IDs. Read `executions` is full. The original target and principal remain fixed when active profile changes.

Assets: `{id,name,media_type,bytes,sha256,created_at,profile_id?,bitstream_uuid?}`; use file assets/:id for exact bytes. Capture raw download: file captures/:id (JSON). Plan/execution/selection JSON similarly supported.

## Actions

### Profiles and native reads

- `save-profile`: `{name,base_url,auth_env?:{token,user,password},previous_profile_id?}`; returns profile_id. Example URL https://sandbox.dspace.org/server. Default env references DSPACE_TOKEN / DSPACE_USER / DSPACE_PASSWORD; clear all names for an explicitly anonymous profile. Only environment variable names, never credentials.
- `select-profile`: `{profile_id}`.
- `connect`: `{profile_id}`; invokes original authentication/status and returns principal plus discovered original tool schemas. No password form.
- `capture`: `{profile_id,tool,args,label?}`. Supported reads: dspace_auth_status, dspace_search, dspace_get_item, dspace_list_communities, dspace_list_collections, dspace_get_item_fulltext, dspace_get_bitstream_content, dspace_list_workspace_items. Original tool schemas in state.tools are from actual SDK discovery. Bitstream outputPath is assigned by the workspace, never accepted from browser input; saved bytes become an asset. Get-item capture also retains its native owningCollection.
- `import-capture`: `{filename,content_b64}` for source-capture JSON with base_url and retained native responses. Imported captures are marked source-import and do not claim a current authenticated session.
- `save-selection`: `{name,profile_id,members:[{capture_id,uuid,type}],previous_selection_id?}`. Maximum500 exact original objects; no dedup by title.

### Plans and original actions

- `prepare-plan`: `{name,profile_id,steps:[{tool,args,source_capture_id?,subject_id?,asset_id?}],previous_plan_id?}`.
  Tool choices: dspace_update_item_metadata, dspace_move_item, dspace_upload_bitstream, dspace_create_workspace_item, dspace_update_workspace_item, dspace_create_item.
  Metadata/item/move/upload updates require the exact source capture and subject UUID. Workspace updates require a captured original workspace item. Creation requires an explicit owningCollectionUuid.
  Upload args use itemUuid/bundleName/name/description/mimeType; browser passes asset_id, never filePath.
  New archive creation and ordinary workspace draft creation must be separately named in the interface; use the original tool description to explain their effect.
- `review-plan`: `{plan_id,decision:"APPROVED"|"CHANGES_REQUESTED",note}`.
- `execute-plan`: `{plan_id}`; sequentially calls the original MCP tools, after re-reading the relevant native fields and original principal. Returns execution_id and status; each step stays independently recoverable.
- `recover-execution`: `{execution_id,resolutions?:[{step_id,subject_id}]}`; read original target/result, recover known response-created subjects and exact already-applied metadata. No automatic duplicate creates/uploads. An explicit observed subject may be supplied for an uncertain creation; exact expected content and original collection are checked.
- `prepare-reversal`: `{execution_id,name}`; creates a NEW reviewable plan reversing the touched metadata or collection move against the saved accepted result. It preserves unrelated intervening staff edits and requires the ordinary new review/execution.

For metadata plans the frontend may construct exact RFC6902 operations from the native arrays:
`{op:"replace",path:"/metadata/dc.title",value:[{value:"Corrected title",language:"en",authority:null,confidence:-1,place:0}]}`.
Use add for a previously absent field, remove for explicit deletion. Preserve existing value object properties when editing one property. The engine computes and retains the before/after preview and checks the touched fields at execution.

Workspace update JSON Pointer paths are actual supplied /sections/<section>/<field> paths; show the native sections before constructing them. The upstream initial metadata helper uses traditionalpageone; the preview retains this exact path.

### Files and receiving

- `upload-asset`: `{name,media_type,content_b64}`; returns asset_id/sha256,20MiB maximum.
- `restore`: `{filename,content_b64}`, from the complete gzip JSON workspace download, accepted only into a new empty workspace.
- Files handoff/current include full retained objects, native responses, plans, exact uploaded/downloaded bytes, execution histories, profile references and a manifest of digests. Tokens/passwords are absent. Reopen the same selection/plan/execution offline, then configure the original environment credentials to reconnect.

## Native journey

Use the actual pinned upstream server/client and real SDK discovery/calls. Retain source pages from scout's public anonymous sandbox capture. Customer-visible write behavior is exercised only on clearly authorized own demo records; preserve their UUIDs and original record ancestry. One substantive journey covers metadata review/change, native preflight conflict, corrected plan, draft creation/update, file receiving, interrupted-write reconciliation, retained original-target recovery, reversal and complete export/reopen. Source snapshots and illustrative authored demo records remain separately identified.
