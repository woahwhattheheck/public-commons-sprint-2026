# Fiscal Data operator domain

The operator captures the public U.S. Treasury Fiscal Data API with every original field, retains exact source pages, and builds reviewed editions for the existing SF30 dataset publisher, SF82 release lifecycle and SF88 buyer. Published numeric values remain strings. Original source observations, field meaning and units travel with each edition.

## Host contract and ownership

`openFiscalWorkspace({directory, buyerWorkspaces = [], limits = {}})` is exported by `workspace-model.mjs`. The normalized absolute directory is a private operator workspace. Each configured buyer workspace is `{id,label,directory}`; its original SF88 settings stay there.

The returned object provides async `snapshot()`, `dispatch(action,payload={})`, `file(kind,id,name)`, `startWorker()`, and `close()`. Call startWorker once after opening. Close pauses network work at an original page checkpoint, drains an action and releases the existing kernel workspace lease. Reopening keeps paused work paused and resumes captures whose retained desired state is RUNNING. One capture runs at a time. No extra native seller or buyer controller is introduced.

Every dispatch returns `{result,state}`. Errors have `code`, `message`, `status` (400/404/409/413/422/429/502). The server provides GET /api/state, POST /api/action with `{action,payload}`, and authenticated GET /api/files/:kind/:id/:name. A file response is `{path,name,mime,sha256,size}` after its original identity is checked. All URLs are generated through these routes; the HTTP client does not supply local source paths.

Root owns workspace-server.mjs and workspace-ui/{index.html,app.js,style.css}. The source arm owns workspace-model.mjs, capture.mjs, decimal.mjs, publishing.mjs, cli.mjs, DOMAIN.md and README.md.

## Snapshot

```json
{
  "schema": "stellar-forge.fiscaldata-workspace.v1",
  "revision": 1,
  "createdAt": "ISO-8601",
  "observedAt": "ISO-8601",
  "catalog": {
    "id": null, "observedAt": null, "sha256": null,
    "endpoints": []
  },
  "sources": [],
  "captures": [],
  "editions": [],
  "comparisons": [],
  "exports": [],
  "buyerWorkspaces": [],
  "publisher": null,
  "worker": {"running": false, "captureId": null},
  "limits": {},
  "recoveryWarnings": []
}
```

Catalog endpoints have `{id,datasetId,datasetName,tableName,description,endpoint,sourceUrl,fields}`. Fields retain the official raw metadata as well as their source name/label/type/format when supplied. Endpoint paths begin /v1/ or /v2/ below the one official API base. The source catalogue is the original production metadata feed, retained with URL, time, response digest and complete original bytes.

Source summaries have `{id,revision,sha256,name,endpoint,filter,sort,pageSize,notes,createdAt,updatedAt,lastProbe}`. Filter is the official API filter expression, sort is its comma-separated field order, pageSize is 1–10000. API fields/format/page-number are controlled by the capture, not free query text. A source edit preserves the earlier immutable revision; old captures keep its exact hash. lastProbe is null or the most recent retained `{id,observedAt,sha256,meta,fields,sampleRows}`.

Capture summaries have `{id,revision,sourceId,sourceRevision,sourceSha256,name,createdAt,updatedAt,status,desiredState,pages,rows,totalRows,totalPages,bytes,nextPage,sha256,error,completedAt}`. Status is QUEUED, RUNNING, PAUSED, FAILED, CANCELLED or COMPLETE. desiredState is RUNNING, PAUSED or CANCELLED. pages/rows/bytes are retained counts, totalRows/totalPages are null before the first page, sha256 is null before a sealed complete capture. error is null or `{code,message,at}`. The source query, original row order, every response page, metadata, links and duplicate observations remain inspectable. A failed HTTP operation is retried only by its original job continuation.

Edition summaries have `{id,revision,captureId,captureSha256,name,status,createdAt,updatedAt,fields,keyFields,notes,rowCount,sha256,dataset,files,merchant}`. DRAFT and READY are the two states. A READY edition is immutable; create another edition to change its review. dataset is null until built, then the original loader's description (snapshot, rowCount, columns, filters, ranges, sorts, defaultLimit, maxLimit). merchant is null or the latest immutable merchant export reference. files contain `{name,mime,size,sha256}`.

A reviewed field is `{source,name,label,role,unit,scale,notes,nullToken}`. source is the exact original field. name is the published identifier, defaulting to source. role is identifier, dimension, date or measure. unit and scale are explicit source-unit annotations; scale is a positive decimal string, usually "1". No multiplication, rounding or currency conversion is performed on original values. Measure fields require an explicit unit and source-context notes. nullToken is null for the native nullable representation, or an explicit collision-free string used to preserve original null separately from an actual empty string. All dataset types remain string, optionally nullable. Field selection is a local projection of full retained source rows.

Comparison summaries have `{id,name,leftEditionId,rightEditionId,createdAt,keyFields,measureFields,sha256,summary,files}`. summary is `{leftRows,rightRows,added,removed,changed,unchanged,fieldChanges,measureTotals}`. measureTotals retain exact decimal-string deltas and count incompatible/non-numeric values separately. Comparison never silently sums different units or different field scales. Keys must identify one row in both editions; duplicates produce an actionable key conflict before a comparison is committed.

Export summaries have `{id,kind,sourceId,createdAt,sha256,files}`, with kind capture, edition, comparison, merchant or acquisition. Complete exports have an archive plus source manifest and readable overview; individual files remain available. publisher is the original publisher's state, documented below, and stays null until first prepared merchant.

## Actions

All identifiers refer to retained objects in this workspace. Creation requestId is an operator-generated string; retrying identical input with the same ID returns its existing result, and changing that input is a conflict.

| Action | Payload | Result |
| --- | --- | --- |
| catalog.refresh | {} | retained catalogue summary and endpoints |
| sources.save | {id?,expectedRevision?,name,endpoint,filter:"",sort:"",pageSize:1000,notes:""} | source summary |
| sources.probe | {id,revision?} | retained original one-page metadata and sample |
| captures.start | {sourceId,sourceRevision,sourceSha256,requestId,name?} | capture summary |
| captures.get | {id} | capture summary plus source, metadata, page manifests and duplicate summary |
| captures.pause | {id} | same capture summary after pause intent |
| captures.resume | {id} | same capture summary; original pages verified before continuing |
| captures.cancel | {id} | same retained capture after cancellation intent |
| captures.rows | {id,offset:0,limit:50} | {fields,rows:[{ordinal,page,index,values}],offset,total,nextOffset} |
| editions.create | {captureId,captureSha256,name,requestId} | DRAFT edition with source-derived suggested fields |
| editions.review | {id,expectedRevision,fields,keyFields,notes,filters?,ranges?,sorts?,defaultLimit?,maxLimit?} | revised DRAFT with exact field review |
| editions.build | {id,expectedRevision,requestId} | immutable READY edition, native snapshot and files |
| editions.get | {id} | full edition including source field observations and review |
| editions.rows | {id,offset:0,limit:50} | DRAFT or READY {fields,rows:[{ordinal,values}],offset,total,nextOffset} |
| editions.query | {id,query:"limit=50"} | original native dataset page response |
| comparisons.create | {leftEditionId,rightEditionId,keyFields,measureFields,name,requestId} | immutable comparison summary |
| comparisons.get | {id,offset:0,limit:50,changesOnly:false} | comparison plus {rows,offset,total,nextOffset} |
| exports.create | {kind:"capture\|edition\|comparison",id,requestId} | complete immutable export summary |
| merchant.configure | {editionId,origin,path,payment,requestId} | complete merchant export summary |
| publisher.prepare | {exportId} | original prepared package/candidate result |
| publisher.status | {} | original publisher status |
| publisher.preview | {target:"draft:UUID" or snapshot,query} | original native query response |
| publisher.reviewDraft | {draftId,expectedSnapshot,expectedRevision} | original review |
| publisher.publish | {draftId,expectedSnapshot,expectedRevision} | original publication result |
| publisher.activateSnapshot | {snapshot,expectedSnapshot,expectedRevision} | original version activation |
| publisher.collect | {} | original collection result |
| publisher.release.stage | {draftId,id,label,runtime:{port,facilitator?,allowLocalFacilitator?}} | original SF82 stage result |
| publisher.release.inspect | {id} | original release |
| publisher.release.activate | {id,expectedGeneration} | original release selection |
| publisher.release.rollback | {expectedGeneration} | original rollback |
| publisher.release.start | {expectedGeneration} | original retained process start |
| publisher.release.stop | {} | original owned process drain |
| publisher.buyer.review | {snapshot,query} | original offer/terms/preview |
| publisher.buyer.prepare | {review,intentId,acceptIndex,offerSha256} | original saved SF88 buyer |
| publisher.buyer.session | {buyerId,workspaceId,maxPages,maxTotalAtomic,maxRows?,maxPageBytes?} | original SF88 dataset session using configured workspace |
| publisher.buyer.run | {id} | original acquisition continuation |
| publisher.buyer.recover | {id} | original retained attempt recovery |
| publisher.buyer.account | {id} | original recorded attempt accounting |
| publisher.buyer.export | {id} | original completed acquisition delivery plus retained complete export |

Publisher actions preserve their original payload/result vocabulary. They use the exact existing Socrata publisher service through a source-agnostic bridge. Publisher state has `{target,drafts,releases,sessions,running,ownsRelease}`: target is `{connected,initialized?,dataset,versions}`; drafts is the original view with candidates/buyers; releases is original SF82 state. Native original code remains the authority for those subobjects. The bridge resolves only its own merchant export ID and configured buyer workspace ID.

merchant.configure uses original buildDatasetSellerConfig. Payment is the original exact scheme/network/asset/amount/payTo/maxTimeoutSeconds object, with amount an atomic integer string. Origin is the original public HTTPS origin and path its dataset route. The original publisher adds optional snapshot selection without changing the supplied merchant terms.

## Download kinds

- capture: exact original response pages `page-000001.json`, original `source.json`, final `capture.json`.
- edition: `dataset.csv`, `dataset.json`, `source.json`, `rows.jsonl`, `review.json`, `README.md`.
- comparison: `comparison.json`, `changes.csv`, `rows.jsonl`, `README.md`.
- export: a manifest-listed flat filename from the selected complete export, including its `delivery.tar.gz`.
- publisher: names `buyer-config.json`, `draft-csv.csv`, `draft-review.json`, `session-manifest.json`; id is the original buyer/draft/session UUID. Bytes are acquired through the existing publisher's readExport and retained before download.

No response or archive includes a session capability, private publisher control token or signing configuration.

## Native source rules

The API base is https://api.fiscaldata.treasury.gov/services/api/fiscal_service. Production dataset discovery is the public Treasury metadata feed used by its published frontend. Source URLs, all response byte hashes, metadata and capture intervals are retained. Pages start at 1. Every next link is validated against the exact endpoint/filter/sort/page size and its expected next number. Number of rows, page counts, field names/types/formats and links must remain coherent through a complete capture. A changing paginated source is preserved as incomplete for a fresh dated capture.

Full source columns are requested: no fields parameter is sent. Treasury explicitly documents that omitted fields can trigger implicit aggregation; local edition projection therefore occurs after native capture. Exact duplicate source rows are retained and reported, not silently removed. A saved operation resumes at its next original page, rechecking saved bytes and the first-page source anchor before fetching further pages. Treasury exposes no transactional snapshot token; a complete edition records the actual acquisition interval and its consistency observations.

The source API is public and needs no token. Capture has explicit page/row/byte/time limits. Reaching a configured capacity leaves original pages and an actionable same-job state; it never marks a truncated source complete. Background worker control is separate from the running original merchant, so pausing Treasury capture does not stop a published service.

## Exact comparison and full acquisition delivery

Each measureTotals entry is keyed by the published field name and includes compatible, left/right source contexts, unit, scale, leftSum, rightSum and delta as exact decimal strings or null; leftNumericRows/rightNumericRows, leftNonNumericRows/rightNonNumericRows, comparedRows, participatingRows and incompatibleRows explain the included values. contextNotes retain both edition and field interpretations. These are sums of selected numeric observations, not Treasury period totals. leftObservations and rightObservations retain dateField, groupFields, incompatibleDates and each group’s original first/last {date,value,ordinal}, row count and exact change. Daily debt is a stock series; its date-ordered observation change is distinct from adding balances across dates.

Publisher buyer export first completes the original SF88 manifest and SF100 delivery. The same returned result gains export, a normal kind=acquisition export entry containing complete delivery.tar.gz, manifest.json, DELIVERY.md and session-manifest.json. The archive carries every original native delivery file byte for byte. It does not copy the configured buyer workspace. Retrying the same original delivery content reopens the same content-bound complete export.

Original internal export records use kind=exports for their record collection and exportKind for their delivery type; public snapshot/action results expose kind=capture|edition|comparison|merchant|acquisition. This distinction is internal; callers use the public kind above.
