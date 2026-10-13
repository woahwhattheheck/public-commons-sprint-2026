# Tiptap / Hocuspocus application operating contract

Operation: TIPTAP-HOCUSPOCUS-APPLICATION-WORKSHARE-0C7A-20261012.
Repository: woahwhattheheck/commons.
Component: revenue/tiptap_hocuspocus_workshare_20261012/.
Core/server/source/runtime/company owner: 0C7A work_scout.
Editor/operator and the sole complete browser/receiving programme: 0C7A scf_engineering.

## Source boundary

Core owns core/, native/, reference/schema.mjs, reference/documents.json, package.json, package lock and installation, server.mjs, cli.mjs, SOURCE-CONTRACT.md, WORKSHARE.md and the customer case.
UI owns web/index.html, web/style.css, web/app.mjs, web/editor.mjs, OPERATOR.md, receiving/browser.mjs and receiving/receive.mjs.
The application selects Node 24, Hocuspocus server/provider 4.7.1, Tiptap 3.31.4, Yjs 13.6.33, y-prosemirror 1.3.7 and y-indexeddb 9.0.12 through the exact package-lock.json. scripts/install.mjs completes the original npm installation and browser build, then records the actual executable, package/module identities, shared schema and lockfile in runtime-ready.json. The receiving journal records actual application execution separately from source checks or installation.

Both browser and native migration import the SAME reference/schema.mjs. It exports SCHEMA_ID, FIELD_NAME and createContentExtensions(). FIELD_NAME is explicitly "default". The initial factory uses the original StarterKit with undoRedo:false; the browser adds native Collaboration and CollaborationCaret. All input nodes/marks/attributes are validated against that original schema before conversion. Unsupported input is a visible mapping error, never silently dropped. A changed schema is an explicit source/edition change and a receiving source selection. The original y-indexeddb package is part of the complete browser runtime for offline reload recovery.

## Common HTTP and actor contract

The installed host calls createApplicationServer({directory,authFile?,contextForRequest?,host:"127.0.0.1",port:8785,runtimeReadyFile?,publicOrigin?}). Port 0 is supported. It returns {origin,instanceId,close()}.
The CLI is node cli.mjs serve --directory DIR --auth FILE [--host 127.0.0.1 --port 8785]. The host may provide its existing async contextForRequest(request) instead of the local reference token file.
The local token file has schema "tjlabs.tiptap-auth.v1" and actors:[{id,name,token,roles:[],tenantIds:[]}]. It is private installation input; tokens are not source, history, browser storage or handoff content. A reference operator may use tenantIds:["*"] for administrative metadata, but live native document access still requires an explicit project grant. HTTP uses Authorization: Bearer <token>. The verified actor is {id,name,tenantIds:[],roles:[]}; roles contains operator, editor and/or viewer. The server enforces both this host identity and exact project tenant/document grants. A body field never establishes actor identity.

GET /api/session -> {instanceId,actor:{id,name,tenantIds,roles},permissions:{operate,read,edit},runtime:{configured,ready,selection}}
GET /api/projects -> {instanceId,projects:[{id,title,revision,updatedAt,documentCount,sourceCount,deploymentState}]}
GET /api/projects/:id?revision=N -> a complete ProjectView directly. Without revision, reconcile the current original local operation before returning it. Historical reads are immutable and explicitly labeled.
POST /api/projects -> {requestId,title,notes?}; returns MutationResult.
POST /api/actions -> {action,projectId,expectedRevision,requestId,payload}; returns MutationResult.
requestId is caller-generated, stable for retries, 1..160 ASCII letters/digits/._:-. Reusing one request ID with changed original input is an error.
MutationResult = {view:ProjectView,result:any,replayed:boolean,currentRevision:number}. A replay returns the original committed project revision, data and result. The response also carries explicitly current revision, runtime, connections and access metadata; those current observations are not a byte-identical sealed copy of the first HTTP envelope. The UI keeps the original action result and can refresh the newer current view separately.
The browser entry is /assets/app.js, bundled from web/app.mjs; CSS is /assets/style.css. GET /operator-guide returns the exact OPERATOR.md with original filename and SHA headers. Handoff receive returns the imported original project in result.projectId and view.id; the caller changes its selected project to that identity. A receiving placeholder is never substituted for the imported project identity.
Errors are {error:{code,message,details?}}. HTTP 401/403 is authentication/authorization, 409 revision or identity conflict, 413 selected size limit, 423 an actually owned or receiving-busy resource.

The UI keeps bearer credentials in memory only. Pending authored HTTP requests/files may be kept in IndexedDB under instanceId + actor.id + origin + projectId. No request is silently given a new requestId after an uncertain result. A restored page first reconciles the original request and current project. Destructive actions show their exact document/edition and require the ordinary explicit operator action.

## Complete source and package uploads

Uploads are original-byte transport, separate from project revision changes:
POST /api/uploads {uploadId,filename,mediaType,bytes,sha256} -> {id,offset,bytes,sha256,complete}
GET /api/uploads/:id -> the same current descriptor
PATCH /api/uploads/:id: raw bytes with Content-Range "bytes START-END/TOTAL" and X-Chunk-SHA256; maximum chunk 8 MiB. Replaying the same previously committed chunk is accepted only when its exact bytes/hash match. -> descriptor
POST /api/uploads/:id/finish {} -> {id,objectId,filename,mediaType,bytes,sha256,complete:true}.
The total upload limit is 512 MiB. Source document input limit is 32 MiB per individual original document; the batch can contain multiple documents. Handoffs may use the full upload limit.
The subsequent source.retain or handoff.receive action consumes the completed upload ID with normal request/revision custody. Upload control does not mutate a project or authorize source execution.

GET /api/projects/:id/sources/:sourceId/content?revision=N streams original bytes, exact Content-Type and filename, with X-Content-SHA256. Original HTML/XML/text is rendered in a sandboxed source viewer or escaped as text, not executed as application UI.
GET /api/projects/:id/handoffs/:handoffId/download streams the immutable complete .ndjson.gz package with exact Content-Length, filename and X-Content-SHA256.
GET /api/projects/:id/checkpoints/:checkpointId/download streams a complete deterministic NDJSON gzip containing the selected checkpoint descriptor and its actual native binary files, with filename, Content-Length and X-Content-SHA256.
GET /api/projects/:id/jobs/:jobId/files/:fileId streams the selected retained original artifact, never an arbitrary host path.

## ProjectView

{
 id, title, notes, revision, createdAt, updatedAt,
 settings:{namespace,defaultField,sessionTtlSeconds},
 sources:[Source], tenants:[Tenant], grants:[Grant], editions:[Edition],
 migrations:[Migration], documents:[Document], deployments:[Deployment],
 checkpoints:[Checkpoint], jobs:[Job], handoffs:[Handoff], history:[Event],
 currentEditionId:null|string, activeDeploymentId:null|string,
 runtime:{configured,ready,selection,observedAt,error:null|object},
 permissions:{operate,read,edit},
 historical:boolean, currentRevision:number
}

Source = {id,title,role,filename,mediaType,bytes,sha256,url,capturedAt,metadata}.
Tenant = {id,name,notes}.
Grant = {id,actorId,tenantId,documentIds:[],access:"read"|"write",enabled,reason,updatedAt}; an empty documentIds array means all current documents in that exact tenant, never all tenants.
Edition = {id,title,notes,sourceIds:[],schemaId,field,config,sourceSha256,createdAt,status:"draft"|"frozen"}.
Migration = {id,title,editionId,sourceId,format:"tiptap_json"|"html"|"yjs_update",mapping,rows:[],status,jobId:null|string,createdAt}.
A migration row has {id,sourceKey,title,tenantId,documentName,schemaId,field,sourceSha256,status:"ready"|"error"|"skipped"|"imported",decision:"import"|"skip"|"unreviewed",reason,errors:[],targetDocumentId:null|string}.
Document = {id,tenantId,title,logicalKey,documentName,epochId,schemaId,field,sourceId,migrationId,createdAt,updatedAt,persisted:{sha256,bytes,stateVectorBase64,stateVectorSha256,savedAt,sequence}|null,previousEpochs:[],access:"read"|"write"|"none"}.
Deployment = {id,title,editionId,status:"prepared"|"running"|"stopping"|"stopped"|"failed"|"interrupted",createdAt,startedAt,stoppedAt,jobId,connections:[],lastError:null|object}.
Checkpoint = {id,title,editionId,deploymentId,createdAt,source:"drained"|"persisted",documents:[{documentId,documentName,epochId,sha256,bytes,stateVectorBase64,stateVectorSha256,sequence}],files:[],sha256}.
Job = {id,kind,status:"queued"|"running"|"cancelling"|"complete"|"failed"|"interrupted",attemptId,attempts:[],progress,result,error,createdAt,updatedAt,files:[]}.
Handoff = {id,title,revision,createdAt,filename,bytes,sha256,sourceIds:[],checkpointId}.
Event = {id,revision,type,actorId,createdAt,summary,data}. Current actor scope filters unauthorized documents and sources.

## Exact mutation actions

- project.update {title?,notes?,settings?}
- source.retain {uploadId,title,role:"documents"|"schema"|"application"|"auth_contract"|"other",url?,metadata?}
- tenant.save {tenantId?,name,notes?}
- grant.save {grantId?,actorId,tenantId,documentIds:[],access:"read"|"write",enabled,reason}
- edition.save {editionId?,title,notes?,sourceIds:[],schemaId,field,config:{debounceMs,maxDebounceMs,maxDocumentBytes,allowedOrigins:[]}}
- edition.freeze {editionId}
- migration.plan {title,editionId,sourceId,format,mapping}
- migration.review {migrationId,rows:[{rowId,decision:"import"|"skip",tenantId?,documentName?,title?,reason}]}
- migration.apply {migrationId}
- job.cancel {jobId,reason}
- job.resume {jobId,reason}
- deployment.prepare {title,editionId}
- deployment.start {deploymentId}
- deployment.stop {deploymentId,reason}
- deployment.rollback {deploymentId,targetEditionId,reason,documentPolicy:"preserve_current"}
- checkpoint.create {title,deploymentId?,mode:"drain"|"persisted"}
- document.restore {checkpointId,documentIds:[],reason,mode:"new_epoch"}
- handoff.prepare {title,notes?,revision?}
- handoff.receive {uploadId}
- review.save {subjectType:"migration"|"checkpoint"|"deployment"|"handoff",subjectId,decision:"accepted"|"changes_requested"|"rejected",note,evidenceSourceIds:[]}

Operator actions require operate permission. Grant changes and epoch restore recheck/close affected existing native connections; stale provider tokens cannot retain write access. Queued/running jobs have original attempt ownership, replay and recovery. UI polls the current project/jobs; it does not create another job merely because the view is stale.

mapping for a JSON batch is {arrayPath:"documents",sourceKeyField:"id",titleField:"title",tenantField:"tenantId",contentField:"content",documentNameField:"documentName",schemaId,field,defaultTenantId?}.
A single HTML or Yjs source uses {sourceKey,title,tenantId,documentName,schemaId,field}.
Original source bytes and mapping remain retained. A native binary input is decoded and validated by original Yjs. JSON/HTML conversion occurs once with the shared native schema; the exact converted binary is retained before target commit and reused on interrupted continuation. Existing nonempty target documents are not overwritten by an import; the reviewed operator must choose a new name or the explicit restore operation.

## Editor and durable-save contract

GET /api/projects/:id/documents -> {documents:[Document]} under the actual current actor.
POST /api/projects/:id/documents/:documentId/session {} ->
 {projectId,documentId,tenantId,documentName,epochId,schemaId,field,
  websocketUrl,token,expiresAt,access:"read"|"write",actor:{id,name},deploymentId}.
Only this endpoint returns the ephemeral native provider token. It is held in browser memory, never copied to sources, logs, project history or handoff. token refresh uses this same authenticated endpoint.
GET /api/projects/:id/documents/:documentId/persistence ->
 {documentId,documentName,epochId,persisted:{sha256,bytes,stateVectorBase64,stateVectorSha256,savedAt,sequence}|null,deploymentState}.

The browser uses original HocuspocusProvider({url,name,document,token:async()=>...}), original Y.Doc and the original Collaboration extension with explicit field. The pinned v4 provider owns its native websocketProvider; explicit offline/reconnect controls use provider.configuration.websocketProvider.disconnect()/connect(), because the older provider.connect()/disconnect() methods are deprecated no-ops. Closing uses the original provider and y-indexeddb lifecycle, including storeState when flushing the local binary. Its cache key includes instanceId/projectId/tenantId/documentId/epochId/schemaId; a restored epoch must never reopen the previous epoch's IndexedDB document.

Provider synced means synchronization, not durable storage. The UI compares both original Y.encodeStateAsUpdate(localDoc) v1 complete binary SHA256/length and Y.encodeStateVector(localDoc) with the returned persisted receipt, and labels storage confirmed only when both match. persisted.sha256/bytes bind those complete native update bytes, not a projection or an incremental last message. A pure deletion can change the delete set without advancing the state vector; vector equality alone must not show Saved. It shows pending or offline edits explicitly. The provider remains the engine for sync/reconnect/merge; UI code does not implement merging.
Historical project/checkpoint reads never mount an editable live provider. A selected historical checkpoint displays its saved metadata/source or a read-only, detached native document representation; it cannot silently edit the current target.

A configuration/runtime rollback preserves current native document state. An explicit content restore first drains the original deployment and then creates a new physical document epoch from the selected retained binary, revoking the previous epoch. Old connected/offline clients must not merge their newer state back into the restored target. The previous epoch and its data remain in custody and receiving.

## Receiving and closure

The sole programme is receiving/receive.mjs, invoking receiving/browser.mjs against this exact same installed source/runtime. The source owner supplies the complete immutable source manifest and completed runtime-ready.json before first dispatch. The receiver creates its own private five-actor auth file and consumes the exact reference/documents.json (three explicitly authored documents across two tenants). It verifies every selected source byte before acquiring its original operation lease.
It must operate the original UI/core: intake retained original source; review mappings; import through the native transformer; select exact tenants/grants; start deployment; two distinct authenticated browser clients; concurrent edits; one offline disconnect and reload from original y-indexeddb; reconnect/merge; native persisted-state receipt; read-only/other-tenant rejection; source/config change; drained checkpoint; configuration rollback preserving data; explicit new-epoch restore; full named handoff; fresh receiving/reopen of the same original binaries and editable app; repeat/older/forward receiving under the original project history.
Record actual source/runtime, job/attempt, native provider and artifact receipts. A source parse or written programme is not an operated result.
The received project opens closed. It requires the receiving host's original auth/runtime binding and explicit start, while retained document/source/history reads work before starting collaboration. Private tokens and host credentials are absent from the package. Source, license, installer, native binary documents, checkpoints, mapping/review history and all original request receipts needed for reopening remain included.
