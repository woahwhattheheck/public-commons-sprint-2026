# eLTSS care-plan operator API

Original module: `stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_eltss/`.
The private server subclasses the existing XML Handler/OperatorServer and uses the existing token, host/origin checks, bounded streaming uploads and native workspace lease. Import `Workspace, original_workspace, original_server, InputError, ConflictError, ProviderError, MAX_SOURCE` from `eltss_workspace`. Open `Workspace(absolute_directory, create=False, credentials_file=None)`; it is a context manager. The separate native endpoint reads source Bundles, CarePlan operations and reviewed REST references. Its saved operations do not use the Bulk Data export protocol.

## Original receiving and limits

The original source is either a complete UTF-8 FHIR Bundle/resource JSON file or a complete eLTSS source ZIP. Source files remain exact. Source ZIPs declare every original body and HTTP/protocol member with full hashes, byte counts and retrieval context. The same source ID is the SHA-256 of the entire input file. The complete edition supports up to 256 MiB, 5,000 resources and 100 CarePlans; individual resources are bounded at 16 MiB. Bundle entries are read incrementally, so a large complete Bundle does not require one whole-document Python object. Interactive pages have a 4 MiB byte budget and expose actual next offsets. Whole editable transfers support 512 MiB.

Local authentication reuses the existing FHIR `Credentials` file and its bearer/SMART profiles. The persisted connection contains the profile name; tokens and signing keys stay in the original private file. GET acquisition is resumed through its original retained request and operation IDs. Server/provider errors expose the original status, retry time and receipt. A local pause stops the next acquisition step; it does not send a provider mutation.

## Common identifiers and responses

Sources, plans, graphs, editions, review sets, assessments, decisions, corrections, handoffs and receiving records use full lower-case SHA-256 content IDs. Native operation IDs are literal 1–96-character tokens. Workspace identity is a UUID. JSON uses camelCase. Empty optional references are null. Every immutable authored record includes its actor/note/reason when applicable; a changed body creates a new content ID and retains its predecessor.

`GET /api/state` -> `ws.state()`: the original generic state `{schema,workspaceId,sources,plans,builds,comparisons}` plus:
- `connections`: full `{id,connection,createdAt}`.
- `requests`: full `{id,request,createdAt}`.
- `discoveries`: `{id,connectionId,fhirVersion,kind,createdAt}`.
- `operations`: `{operationId,requestId,connectionId,state,phase,sourceId,createdAt,updatedAt,notBefore,receivedBytes,resourceCount,pageCount,queued,error}`.
- `editions`: `{id,label,sourceId,predecessorId,carePlanIds,referencePolicy,baseUrl,decisionIds,owner,actor,note,graphId,createdAt}`.
- `reviewSets`: `{id,label,profileId,predecessorId,fieldCount,reviewedCount,actor,createdAt}`.
- `assessments`: `{id,label,editionId,reviewSetId,carePlanIds,summary,createdAt}`.
- `decisions`: complete original saved decisions.
- `editionComparisons`: `{id,beforeId,afterId,counts,createdAt}`.
- `corrections`: `{id,sourceEditionId,sourceId,editionId,previewId,actor,reason,createdAt}`.
- `handoffs`: `{id,label,editionId,reviewSetId,assessmentId,scope,receiver,resourceCount,requestSha256,createdAt}`.
- `receivings`: complete saved receiving decisions/results.
- `artifacts`: `{id,label,name,bytes,contentType,createdAt}`.
- `receives`: `{id,state,archiveSha256,workspaceId,kind,createdAt,updatedAt}`.

`GET /api/catalogue` -> `ws.catalogue()`: full typed catalogue, enums and limits; source profile descriptors. `GET /api/profiles/:id` -> `ws.profile(id)`: `{id,label,publication,sourceReferences,fields,accessoryRequirements}`, all 56 exact source rows and their ready-to-review selector drafts.

## Connection, discovery and original acquisition

| Method/path | Native call | Body/result |
|---|---|---|
| GET /api/auth-profiles | auth_profiles() | Original public profile names/types/origins |
| POST /api/connections | save_connection(body) | Typed catalogue connection -> {id,connection,createdAt} |
| GET /api/connections/:id | connection(id) | Same saved record |
| POST /api/connections/:id/discover | discover(id) | Retains actual /metadata response -> saved discovery |
| GET /api/discoveries/:id | discovery(id) | {id,connectionId,kind,fhirVersion,capabilities,observation,createdAt} |
| POST /api/requests | save_request(body) | Typed request -> {id,request,createdAt}; request includes exact initial GETs/requestSha256 |
| GET /api/requests/:id | request(id) | Full immutable request |
| POST /api/requests/:id/advance | advance(id,body.operationId) | {operationId}; one original HTTP step or final source assembly |
| GET /api/operations/:id | operation(id) | Complete current operation and retained history/queue/receipts |
| POST /api/operations/:id/pause | pause(id) | Local pause of the same original operation |
| POST /api/operations/:id/resume | resume(id) | Re-enable the same operation; actual next request is advance |

The acquisition catalogue gives three routes. `bundle-url` selects one exact original URL and follows returned Bundle next links. `all-eltss-careplan` binds an actual discovery advertising the named CarePlan operation and explicit CarePlan IDs. `rest-graph` binds actual read/search/include capabilities, selected CarePlan IDs and explicit `searches:[{resourceType,parameters:[{name,value}]}]`. Repeated query names and exact values are retained. The request has explicit `followReferences`, selected `resourceTypes` (empty means all available types), and limits. Reference traversal follows only the reviewed FHIR base; external/logical/ambiguous references remain visible for a decision. Actual request URLs, responses and Bundle entry search modes are retained. Requirements CapabilityStatements are not accepted as observed server discovery.

Operation states are `ready,running,waiting,paused,failed,complete`. A complete acquisition may contain unresolved or rejected reference reads; its completeness summary distinguishes received HTTP pages from reference closure. Seed rejection fails the same operation, while an inaccessible linked target becomes an actual unresolved result. HTTP 202 and Retry-After retain the actual status URL/time. A resumed GET does not create a new acquisition.

## Original sources and graph

| Method/path | Native call | Shape |
|---|---|---|
| POST /api/sources | add_source(stream,label,name) | Original octet-stream upload; X-Source-Label/X-Source-Name URI encoded; native complete source record |
| GET /api/sources/:id | source(id) | {id,label,name,bytes,inventory,created} |
| GET /api/sources/:id/packet | source_path(id) | Complete unchanged original source file (JSON or ZIP) |
| GET /api/sources/:id/members | source_members(id) | [{name,bytes,sha256,role,sourceUrl?}] |
| GET /api/sources/:id/files/:member | open_source_member(id,member) | Stream exact original member; member URI encoded as one path component |
| GET /api/sources/:id/rows | source_rows(id,resource_type,offset,limit,query) | ?resourceType=&offset=0&limit=50&query= -> {sourceId,rows,total,offset,nextOffset,pageBytes,pageByteBudget} |
| GET /api/sources/:id/rows/:recordId | source_row(id,recordId) | Complete exact resource locator and lexical JSON |
| POST /api/sources/:id/graph | graph(id,body) | {referencePolicy:'bundle'|'selected-base',baseUrl:'',decisionIds:[]} -> complete graph descriptor |
| GET /api/graphs/:id | graph_view(id) | {id,sourceId,policy,summary,carePlans,createdAt} |
| GET /api/graphs/:id/nodes | graph_nodes(id,resource_type,offset,limit,query) | Paginated original node descriptors |
| GET /api/graphs/:id/edges | graph_edges(id,status,offset,limit,query) | Paginated reference edges, status may be null |
| GET /api/graphs/:id/nodes/:recordId | graph_node(id,recordId) | {resource,outgoing,incoming} |

A source row includes `recordId,sourceId,memberId,memberName,entryOrdinal,entryPointer,entrySha256,fullUrl,resourceType,id,versionId,lastUpdated,containedIn,rootRecordId,jsonText,resourceSha256,sourceUrl,bundleId,bundleType,searchMode`. Metadata and exact JSON numeric tokens remain separately available. A graph edge includes `id,fromRecordId,path,pointer,reference,kind,status,targetRecordIds,candidateRecordIds,reason,resolvedUrl,versionId`. Graph closure never joins persons by name or unqualified identifier. Reference resolution uses original fullUrl, retained request base and version; contained references keep their owning resource. An explicit saved reference decision can select one observed candidate. Unresolved and equivalent/conflicting duplicates remain visible.

## Editions, full field review and correction

| Method/path | Native call |
|---|---|
| POST /api/editions | save_edition(body) |
| GET /api/editions/:id | edition(id) |
| POST /api/review-sets/profile | adopt_profile(body) |
| POST /api/review-sets | save_review_set(body) |
| GET /api/review-sets/:id | review_set(id) |
| POST /api/assessments | assess(body) |
| GET /api/assessments/:id | assessment(id) |
| GET /api/assessments/:id/cells | assessment_cells(id,care_plan_id,field_key,status,offset,limit) |
| POST /api/decisions | save_decision(body) |
| GET /api/decisions/:id | decision(id) |
| POST /api/edition-comparisons | compare_editions(body) |
| GET /api/edition-comparisons/:id | edition_comparison(id) |
| GET /api/edition-comparisons/:id/changes | edition_changes(id,offset,limit) |
| POST /api/corrections/preview | preview_correction(body) |
| POST /api/corrections | apply_correction(body) |

Bodies use the typed catalogue. `adopt_profile` takes `{profileId,label,actor,note?,predecessorId?}` and atomically retains all 56 field rows. A review set is complete, including draft/not-applicable rows. Per-field selectors have ordered `steps:[{direction:'value'|'out'|'in',path:[exact tokens],resourceType?,where:[{path,operator,valueJson}]}]`. `out` follows original references at a selected path; `in` follows selected original incoming references from the chosen resource type; `value` selects retained values. Wildcard tokens iterate actual arrays. Predicates compare complete lexical JSON values. All field values expose exact source record/pointer/jsonText. A reviewed value-map conversion carries each original and selected value; it does not change source files.

An assessment retains the selected edition/graph/review set and all selected CarePlan cells. It returns summary counts and full cell-file identity. Cells expose `carePlanId,fieldKey,label,group,status,applicability,reviewStatus,absencePolicy,values,unresolved,findings`. Actual statuses are `present,absent,unresolved,not_applicable,review_pending`; no clinical or profile compliance conclusion is inferred from presence. `GET cells` returns `{assessmentId,rows,total,offset,nextOffset,pageBytes,pageByteBudget}`.

Edition comparison body is `{beforeId,afterId,label}`. It compares original graph identities within the same source namespace, retaining ambiguous and unmatched identities separately; exact changed field pointers and original before/after JSON are stored in its complete changes file. It is separate from the original SF30 mapping/build comparison.

Correction preview takes the typed correction body. Patches select original record ID plus exact JSON tokens; `valueJson` is complete authored JSON text. It returns `{id,request,changes,sourceEditionId,requestSha256}`. Apply takes **only** `{previewId,expectedRequestSha256}`. It derives a new explicitly authored source with its full original predecessor and exact patch manifest, then a successor edition. Original source files remain available under their unchanged IDs.

Complete field cells and complete edition changes also have streaming original-file routes:
`GET /api/assessments/:id/file` calls `assessment_file(id)`;
`GET /api/edition-comparisons/:id/file` calls `edition_changes_file(id)`.
Interactive pages stay within 4 MiB; full saved assessments can contain up to 256 MiB.
A selected field's values are limited to 16 MiB and 25,000 matches; the original source file
always retains its complete unchanged resource bytes. The file limit includes all cells.

## Complete receiving, datasets and editable restoration

| Method/path | Native call | Body/result |
|---|---|---|
| POST /api/handoffs | prepare_handoff(body) | Typed source/assessment/review/receiver selection -> full immutable handoff |
| GET /api/handoffs/:id | handoff(id) | Full source selection, original request hash, files and graph/field summaries |
| GET /api/handoffs/:id/packet | export_handoff(id,output_path) | Complete source, Bundle, graph, field mapping/cells, decisions and human-readable ZIP |
| POST /api/handoffs/receive | import_handoff(input_path) | Receive complete handoff into this workspace and reopen its selected source/edition/review |
| POST /api/artifacts | add_artifact(stream,label,name,content_type) | Complete original downstream result or attachment -> {id,label,name,bytes,contentType,createdAt} |
| GET /api/artifacts/:id/file | artifact_path(id) | Exact original received result |
| POST /api/receivings | save_receiving(body) | Typed actual receiving result/decision; operation ID bound to exact input |
| GET /api/receivings/:id | receiving(id) | Full original receiving state and retained result link |
| POST /api/sources/:id/mapping | default_mapping(id,body.resourceType,body.name?) | Native SF30 mapping body |
| POST /api/sources/:id/preview | projection_preview(id,body.plan,body.limit=25) | Native {columns,rows,totalRows,previewRows,...} |
| POST /api/plans | save_plan(body) | {id,plan} |
| GET /api/plans/:id | {id,plan:ws.plan(id)} | Explicit HTTP wrapper; native ws.plan returns bare mapping |
| POST /api/builds | build(body.sourceId,body.planId) | Original SF30 completed build |
| GET /api/builds/:id | build_view(id) | Complete build |
| GET /api/builds/:id/query | query(id,query_parameters) | Original native scalar-string query |
| GET /api/builds/:id/dataset | export_dataset(id,directory) then ZIP | Native data.csv/dataset.json/full lineage |
| GET /api/builds/:id/packet | export_packet(id,output) | Original six-member dataset packet |
| POST /api/packets | import_packet(input_path) | Original source/mapping/native dataset reconstruction |
| POST /api/comparisons | compare(body.beforeId,body.afterId) | Original same-plan unique-key dataset comparison |
| GET /api/comparisons/:id/changes | comparison_page(id,offset,limit) | Original paginated changes |
| GET /api/comparisons/:id/file | comparison_file(id) | Complete exact changes file |
| GET /api/workspace/packet | export_workspace(output) | Whole editable source/domain/operation/dataset ZIP |
| POST /api/workspace/packet | import_workspace(input_path) | Exact archive identity, resumable complete restoration into a fresh workspace |

The first native receiving route is the complete operator/customer handoff and fresh managed workspace intake. A saved external receiving decision links the actual unmodified downstream result artifact, destination IDs, received time and correction predecessor. It does not send a clinical resource to an unselected destination. Root may compose an explicitly selected native downstream adapter through the same frozen handoff request and its actual receipt.

Handoffs contain exact original source members and a generated collection Bundle with original fullUrl/resource identities, all 56 reviewed field rows and cells, complete reference graph, original decisions, START_HERE.html and a full byte/hash manifest. A care-plan subset chooses `forward`, `connected` or `edition` scope explicitly. The original customer receives the full necessary source context. Whole editable backup additionally retains all saved editions, requests, HTTP originals, pending operations, artifacts, native dataset inputs/results and history. It excludes private credential files and live operator connection descriptors.

The server can allocate temporary output files with the original `ws.scratch()`; it must stream downloads before leaving that context. Native source files are immutable and may be read directly. All paths supplied by HTTP upload are retained original content, never arbitrary browser-supplied host file reads.

## Native merchant family and version receiving

An exported dataset family binds the exact reviewed mapping and resource type to its source selection. Native acquisitions bind the original endpoint, seed URLs, reference traversal, selected resource types and limits. A local raw source binds its complete source SHA256. Authored successors follow their retained predecessor chain to that same family; capture UUIDs, receipt times and correction notes do not silently create a new family. Each release still identifies its exact source/edition, CSV, native configuration and snapshot. Original SF30 version publication requires the observed current snapshot and revision; original SF88 preparation retains the selected live offer and exact snapshot.
