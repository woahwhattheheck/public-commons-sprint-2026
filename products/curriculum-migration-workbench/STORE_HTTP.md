# Persistent store and HTTP interface

The managed Curriculum Migration Workbench operates the original API comparison and curriculum occurrence models. It retains full source editions, response bodies, assets, decisions, generated API client files and portable workspaces. The managed service supplies persistent physical branches and authenticated access to those same functions.

The exact 20 original files are in `app/`, selected from Commons commit `0a79b94fb3fe14008d37e71838822e41dee174cb`. Their complete inventory and SHA-256 identities are in `app/source-selection.json`; the source selection SHA is `0d327292684c56e52b45913e9acb5bb2efc6d7feb2a19f4ece489706fb432579`. `ADOPTION.json` records the model and receiving joins.

## Ownership and creation

`createStore({directory,id,title,createdAt,initialSnapshot})` initializes an explicit complete original workspace and returns the immutable creation identity. The UUID `id` belongs to the physical store. The portable workspace ID remains the original workspace's ID. Creation is serialized by the maintained parent creation lease; exact repeated creation adopts the original identity. It does not return a held service lease.

`openStore({directory})` returns the owner with synchronous `identity`, the store methods below, and `close()`. It holds the original Runtime `operationLease(directory/service.lock)` for its entire lifetime. The service drains HTTP before releasing the store. It never opens two writers for one physical directory.

`startServer({store,sourceDirectory,token,port,sourceSha256,renderPage})` returns `{origin,close}`. `renderPage()` composes the original standalone loader with the managed adapter; it does not rewrite the original app files. The lifecycle owner publishes the private connection, observes the original process identity and closes HTTP and the store independently.

Creation identity:

```json
{
  "schema": "stellar-forge.curriculum-migration-store.v1",
  "id": "<physical store UUID>",
  "directory": "<canonical absolute private directory>",
  "title": "<operator title>",
  "createdAt": "<original ISO timestamp>",
  "defaultBranchId": "<physical default branch ID>",
  "creationInputHash": "<original normalized creation SHA-256>"
}
```

The served identity additionally reports `sourceSha256`. That source pin is service metadata; it does not mutate the original creation record.

## Physical branches and complete portable identities

A branch record contains `schema:"curriculum-browser-branch.v1"`, `id`, `label`, `storeId`, `workspaceId`, `revision`, `snapshotSha256`, `createdAt`, `updatedAt`, `origin`, `creationSha256`, and the full original flat workspace in `snapshot`. Branch lists return the same summaries without `snapshot`.

All selected comparisons, reports, history pages, exports, binary downloads and commands bind this exact triple:

```json
{"workspaceId":"<portable ID>","revision":51,"snapshotSha256":"<complete workspace SHA-256>"}
```

The whole portable format remains `{format:"curriculum-workspace-export.v1",sha256,workspace}`, where the digest covers the original canonical workspace. Receiving selects a fresh physical branch ID while retaining that portable ID and its complete original history. It never replaces another branch just because the portable IDs match.

The original `Model.receiveWorkspace` checks its original structural history contract. The original `Curriculum.receiveCurriculumWorkspace` additionally reconstructs retained curriculum plans and validates their related events. The managed service preserves these semantics; it does not claim that the base model re-executes every historical generic command. New managed changes call the original exported functions with their exact saved arguments.

## Atomic changes and exact request recovery

Each mutation freezes a complete normalized input before joining the owner queue. Full inputs and results are immutable size-and-hash checked objects. The compact head stores their references, the request sequence and selected branch pointers. This keeps repeated large imported source content out of the head while preserving the complete original request for recovery.

The prospective original-model transition, full result and new branch are validated before one atomic head publication. A visible head always references completed immutable objects. A write that stops before head publication can leave unreferenced immutable files; those files are not a committed business result.

A request ID is a canonical UUID. Repeating the same ID and byte-equivalent normalized input returns the first complete result, even after later branch edits. Reusing that ID for different input fails. Reading the request hydrates and verifies both complete input and complete first result. A client that receives a historical first result should read the branch separately when it needs the current state.

A new deliberate mutation uses a new request ID and a newly reviewed expected triple. A stale expected triple returns a conflict without replacing the current branch. There is no arbitrary full-snapshot save endpoint: the nine original model operations below are the only managed business commands.

The managed browser boots with read-only identity, branch-list and branch-read requests. It keeps draft and pending request ownership tied to the physical store directory and branch. Selecting or reopening a branch does not replay an old initialization mutation.

## Authentication and responses

The service binds loopback. It verifies the exact Host and, when supplied, the same Origin. API requests carry `Authorization: Bearer <private token>`. Except for authenticated identity/state discovery, every API request also carries:

- `X-Curriculum-Store-Id`: the physical store UUID.
- `X-Curriculum-Store-Directory`: the exact canonical physical directory.

Successful JSON responses are `{ok:true,result}`. Errors are `{ok:false,error:{code,message},notCommitted,requestId?}`. A true `notCommitted` is returned only when the serialized owner has validated that the same original request is absent. A transport failure alone does not authorize a replacement business request.

The private token is delivered through the managed connection. It is never embedded in the pristine application source download, standalone HTML, portable workspace, source manifest or public guide.

## Endpoint table

| Method and path | Input | Result |
| --- | --- | --- |
| GET /api/identity or /api/state | Authenticated discovery | Creation identity plus sourceSha256 |
| GET /api/branches | Physical scope headers | Complete branch summaries |
| GET /api/branches/:id | Exact physical branch ID | Full current branch |
| GET /api/requests/:requestId | Original UUID | Null, or complete verified request and first result |
| POST /api/branches/create | requestId, id, label, snapshot, origin | Full separately created branch |
| POST /api/branches/command | requestId, id, expected, command | Full new branch and original operation result |
| POST /api/branches/export | id, expected | Whole original portable packet |
| POST /api/history | id, expected, offset, limit | Complete original history page |
| POST /api/report | id, expected, kind, options | Branch summary, report kind and full result |
| POST /api/download | id, expected, kind, options | Complete selected binary body |
| GET /api/branches/:id/assets/:assetId | Expected triple in query | Exact original asset content bytes |
| GET /api/application-source/:encodedPath | Fixed selected source path | Exact one of the original 20 source files |

The request lookup returns `{requestId,inputObject:{sha256,bytes},inputSha256,sequence,resultObject:{sha256,bytes},input,result}`. Its `result` is the original branch or command response.

A history page is `{id,workspaceId,revision,snapshotSha256,total,offset,nextOffset,items}`. Its items are complete original history rows. A later page must use the same expected triple; it cannot silently page across a changed branch. The page limit is at most 200. Full SDK iteration retains this selection.

Binary responses include `x-curriculum-source-sha256` and `x-curriculum-source-bytes`. Selected branch downloads also carry `x-curriculum-branch-id` and `x-curriculum-snapshot-sha256`. Streamed SDK downloads verify the complete returned bytes and digest. The application-source route reads only fixed manifest members and verifies their original full bytes.

## Original commands

The command envelope is `{kind,actor,at,body}`. Actor is a recorded nonempty string and `at` is the original ISO timestamp. The store forwards both to the native model context.

| Kind | Complete body |
| --- | --- |
| addEdition | `{edition}` |
| addCase | `{case:{id,name,operationKey,sourceEditionId,targetEditionId,request}}` |
| updateCase | `{caseId,patch}` |
| saveResponse | `{caseId,lane,response}` |
| compareCase | `{caseId}` |
| decide | `{caseId,decision:{runId,outcome,note}}` |
| addAsset | `{asset:{id,name,kind,content}}` |
| planCurriculumCase | `{caseId,options:{namespaces:{original,candidate},mappings}}` |
| decideCurriculumPlan | `{caseId,decision:{planId,outcome,note}}` |

The response is `{branch,result:{kind,revision,caseId?,editionId?,assetId?,runId?,planId?},replayed:false}`. Exact retry returns that complete first response unchanged. The `replayed` field is not rewritten on retry.

No command implicitly acquires external API data or sends a customer request. A captured response or reviewed local file retains its original provenance. The retained 25 published examples are useful source-backed operating inputs, and do not establish a customer's staging response or genuine BULK migration.

## Reports, generated API client and downloads

| Report kind | Options |
| --- | --- |
| portfolio | Empty object |
| curriculumPortfolio | Empty object |
| case | caseId |
| sourceInventory | editionId |
| curriculumPlan | caseId, planId |
| curriculumReviewRows | caseId, planId |
| sdk | editionId |

The SDK report invokes the unchanged original `generateSdk` against the selected edition. It preserves `files`, `client`, `types`, `inventory` and `diagnostics`, and adds `editionId` plus `descriptors:[{path,bytes,sha256}]`. These are the generated API client and source-contract declarations. The separate `CurriculumMigrationClient` controls the managed workbench; it does not replace that generated API client.

Binary download kinds are:

- `workspace`: full original portable packet.
- `report`: options contain `kind` and its nested `options`.
- `sdkFile`: exact `editionId` and generated `path`.
- `sourceEdition`: complete original edition selected by `editionId`.
- `response`: complete original response selected by `caseId` and `lane`.
- `case`: full retained case selected by `caseId`.

The managed UI's application ZIP carries all original 20 files, full current workspace and generated SDK files with receiving instructions. Its standalone HTML is the unchanged original offline edition. Receiving it in a separate browser retains the complete portable workspace and its history without a managed token or service dependency.

## Capacity and truthful failure

| Boundary | Maximum |
| --- | ---: |
| Complete original workspace | 128 MiB |
| Immutable object and HTTP request body | 160 MiB |
| Compact store head | 24 MiB |
| Retained request identities | 20,000 |
| Physical branches | 256 |
| Fixed application source file | 16 MiB |
| Complete fixed original source selection | 64 MiB |

Original assets, editions and response-file inputs can use the complete workspace limit; the fixed application-source limit is separate. An encoded HTTP envelope must fit its body limit as a whole. Capacity failure does not truncate source, skip rows or rewrite an existing committed branch.

## Complete receiving and current scope

Use the source-native course in `../../tools/curriculum-migration-workbench/MANAGED_RECEIVING.md`. It continues the original `curriculum-migration-complete-receiving-20261013` operation under its existing `complete-receiving.lock`, retaining prior records and the exact chosen input. Its Python owner verifies the published complete managed source manifest, and the Node course operates installed Runtime Applications, SDK and agent, independent stores and branches, browser controls, downloads and cold receiving.

The initial supplied workspace retains 25 published response cases and 51 original history rows. The complete course labels its additional published-example comparison as receiving work. Genuine customer BULK input remains pending until an operator supplies the actual complete selected source and reviewed mapping options. Source publication and static syntax parsing are recorded separately from a returned native receiving result.
