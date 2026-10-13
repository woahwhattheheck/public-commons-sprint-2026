# MEPflow customer and job migration workspace — frozen API v1
This is a complete offline commissioning application for the original customer/job import promise, not a native MEPflow API. Actual target field names, acceptance and IDs are explicit operator inputs. All company correspondence remains outside the reusable public programme.

## Runtime
One dependency-free `mep-migration-core.cjs`, browser global `MEPMigration` and CommonJS exports.
`create(catalogue,{id,title,now})` → immutable workspace.
`mutate(w,command,{expectedRevision:w.revision,actor,now})` → new immutable workspace; rejected commands leave original unchanged.
`validate(w,{catalogue?})`, `exportWorkspace(w)` → complete pretty JSON envelope; `importWorkspace(text,{catalogue?})` verifies exact content and source bindings.
Helpers `uid(prefix)`, `hash(value)`, `canonical(value)`, `bytes(text)`, `parseCSV(text)`.
Limits: CSV/JSON original file 8 MiB; complete workspace 64 MiB; 10,000 data rows per original; 40 target fields. All file selection is local, never an automatic upload or native dispatch.

## Workspace
`{schema,version,id,title,createdAt,updatedAt,revision,catalogue,programmes,files,profiles,records,batches,deliveries,receipts,history}`.
Catalogue `{schema,operators:[{key,name,trade,sourceUrls,workflow}],buyer:{name,url,sourceNotes}}` preserves the six original public operator identities. Worked people/jobs are labelled demonstration.
Every record has id, createdAt and createdRevision. Commands store actor/time/reason in history. Original files, profiles, committed batches, delivery editions and receipt editions are append-only.

## Programmes and originals
`{type:'programme.save',value:{id?,operatorKey,title,targetSystem,targetVersion,notes}}`
Existing programmes keep their operatorKey. targetSystem is the explicit receiving-system label, not inferred from the buyer name.
`{type:'source.add',value:{id?,programmeId,entity:'customer'|'site'|'job',kind:'source'|'target-result',name,format:'csv'|'json',text,jsonPath:[],sourceSystem,capturedAt,parentId?,notes}}`
Retains complete original text, SHA, BOM/line endings and parse result. CSV returns trimmed unique headers but retains originalHeaders and every original field string; JSON selects an explicitly named object path to an array of flat records. Strings, nulls and booleans retain their original values. Every JSON number is read directly as its exact original token string, including long identifiers, decimals and exponent notation. Duplicate object keys and malformed JSON are rejected. Decimal/integer mappings accept their explicit canonical string forms; exponent-to-decimal translation requires an explicit value map. Repeated source bytes in the same programme/entity/kind are rejected with original ID. A changed original may name parentId of the same programme/entity/kind.

## Mapping profiles
`{type:'profile.save',value:{id?,sourceId,name,parentId?,keyField,fields,targetFields,targetContractLabel,notes}}`
A profile is immutable and bound to one source edition; make another profile for another source or changed mapping.
`fields:[{key,label,type:'text'|'decimal'|'integer'|'boolean'|'date'|'datetime',required,from:{column:'Original header'}|{constant:'exact value'},trim:false,empty:'null'|'keep',values:[{from:'Original',to:'Mapped'}],referenceEntity:''|'customer'|'site'|'job'}]`.
keyField selects one required text field as the record's explicit original identity. Blank mappings remain blank; operators choose transformations/status translations. Decimal/integer values stay strings (canonical exact decimal syntax), dates are YYYY-MM-DD, datetimes require a timezone. A value map translates only listed values; unmatched values cause a review issue. Reference fields resolve the mapped exact source key to the selected programme's staged records.
`targetFields:[{field:'mappedKey',column:'Actual receiving column',relationshipMode:'sourceKey'|'nativeId'}]`. NativeId is allowed only for reference fields. These are explicit user-supplied export bindings, not an advertised product import schema.

## Complete row review and commit
`reviewBatch(w,{sourceId,profileId,title,notes,decisions:[]})` →
`{schema,revision,sourceId,profileId,title,notes,rows,issues,counts,reviewSha256}`.
Each row `{rowId,index,original,mapped,key,existingRecordId,recommended,decision,changes,issues,recordId,links}`.
RowId is the original source ID plus row number (read the returned value).
Recommendation is create/link/update/review only; it is not a decision.
Decision `{rowId,action:'create'|'update'|'link'|'exclude',recordId:'',reason:''}`.
Every row needs an explicit decision. Update and link choose an existing same-programme/entity record. Updates retain prior values and add the changed source key as an alias. Links preserve the existing record unchanged; if mapped values differ a reason is required. Exclude always requires a reason and preserves original row. Duplicate creates and cross-record identity aliases are issues. Unresolved required references prevent create/update. Already accepted rows may be linked in a later edition; no source record is silently merged.
`{type:'batch.commit',input:<same review input>,expectedReviewSha:<reviewSha256>}` creates immutable batch, applies exactly its reviewed create/update/link decisions and retains every original row/exclusion. Batch ID is `batch_` + review SHA. Replaying that exact committed review returns original workspace unchanged.
Records `{id,programmeId,entity,key,aliases,fields,links,revision,revisions:[{revision,fields,links,key,sourceId,rowId,batchId,actor,at,reason}],origins:[{sourceId,rowId,batchId,action,reason}],...}`.
Committed batch `{id,programmeId,sourceId,profileId,title,notes,reviewSha256,rows,counts,createdAt,...}` retains the exact record revisions selected at commit.

## Exact receiving handover
`reviewDelivery(w,{batchId,title,notes})` → `{revision,batchId,rows,columns,issues,counts,reviewSha256}`.
Only create/update rows are export rows; link/exclude rows remain in the complete batch report. Target columns come from the frozen profile. Reference nativeId requires an actual accepted prior receipt for that related record in this programme/targetSystem. No target API call exists.
`{type:'delivery.prepare',input:{batchId,title,notes},expectedReviewSha}` → appends exact immutable delivery containing columns, rows, CSV and JSON plus hashes, original source/profile/batch IDs and targetSystem. Repeated exact preparation returns the first saved edition.
`deliveryFiles(w,deliveryId)` → `[{name,mime,content}]` for exact target CSV, target JSON and complete readable review HTML. CSV is actual configured receiving data, so open as data; human HTML escapes all source text. Customer and site batches can be received before job foreign keys are exported.
Saved delivery `{id,programmeId,batchId,profileId,targetSystem,title,notes,columns,rows:[{rowId,recordId,recordRevision,fields,sourceFields,links}],csv,json,csvSha256,jsonSha256,...}`.

## Actual target outcomes and reconciliation
`reviewReceipt(w,{deliveryId,evidenceFileId,observedAt,reference,notes,outcomes:[{rowId,status:'accepted'|'rejected'|'unknown',nativeId,reason}]})` → `{revision,deliveryId,rows,issues,counts,reviewSha256}`.
Evidence file must be a retained target-result original in the same programme/entity. Each supplied outcome selects a real delivery row. Unmentioned rows preserve that delivery’s latest receipt snapshot or remain unknown. Carried snapshot rows are not new observations and do not supersede a newer explicit outcome from another handover. Accepted requires an actual nativeId; rejected/unknown require a reason. Conflicting accepted native IDs or a change from a previous accepted outcome requires explicit notes and remains visible in history. Two distinct staged records cannot claim the same native ID in one target system/entity.
`{type:'receipt.commit',input:<same receipt input>,expectedReviewSha}` appends one immutable full current outcome snapshot with original evidence and prior receipt ID. Exact retry returns original edition.
`reconciliation(w,programmeId)` →
`{programme,counts:{sources,sourceRows,stagedRecords,batches,deliveries,accepted,rejected,unknown,currentAccepted,outdated,excluded},records:[{recordId,entity,key,revision,latestDeliveryId,latestReceiptId,status,nativeId,reason,receiptAt,acceptedRevision,currentRevisionAccepted,sourceOrigins}],batches:[...],deliveries:[...]}`.
`overview(w)` → `{programmes,sources,sourceRows,profiles,records,batches,deliveries,accepted,rejected,unknown,currentAccepted,outdated}`.
`sourceView(w,id)` returns the exact parsed headers/rows and original metadata. `recordView(w,id)` returns complete record plus source origins and native outcomes.
`renderProgrammeReport(w,programmeId)` and `programmeCSV(w,programmeId)` are full readable exports with all row decisions, identity links, unresolved/accepted results and original source references. Entire original source, row mapping and complete history stay in workspace JSON and original-file downloads.

## Interface/ownership
Use 8 sections: overview/programmes; original exports; mappings; row decisions; complete handovers; actual target outcomes; reconciliation/record history; workspace receiving.
Blank target/schema/source choices remain explicit. Provide source key/type/status mapping, complete source-row decisions and previewed update differences; preserve form drafts and async file selection epochs.
Source downloads use original filenames/text. Incoming 64 MiB preflight, saved-workspace selection guard, full readable exports and detached working example.
No credentials, email, financial dispatch or automatic target import. Original six-company lead editions and sender history remain untouched.
