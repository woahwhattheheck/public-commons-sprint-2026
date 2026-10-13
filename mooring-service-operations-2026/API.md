# Mooring service workspace API · v1
Global and CommonJS: MooringServiceOperations (C). One dependency-free core file. Immutable return values.
create(catalogue,{id,title,now}); mutate(w,command,{expectedRevision:w.revision,actor,now}); validate; exportWorkspace(w); importWorkspace(text,{catalogue}); uid; bytes; hash; canonical.
catalogue={schema,operators:[{key,name,timezone,geography,sourceUrls,publishedWork,notes}],townExample:{...}}. Six operator keys are the existing mooringops-* IDs.
All state collections are arrays: people, resources, moorings, components, permits, jobs, inspections, repairs, submissions, notices, evidence, movements, imports. Every row has id,operatorKey,createdAt,updatedAt,createdRevision,updatedRevision. Immutable complete before/after history is w.history. No physical asset/permit is created from a published company profile.

## Save commands
Each is {type:'person-save',person:{...}} etc.; source IDs optional on new row, stable on edit. Every row uses operatorKey.
person: name,email,phone,role ('owner'|'crew'|'contact'),externalRef,notes,active.
resource: name,kind ('workboat'|'equipment'|'other'),externalRef,notes,active.
mooring: label,externalRef,municipality,harbor,ownerId,vessel:{name,registration,kind,length,lengthUnit,notes},position:{format ('decimal'|'degrees-minutes'|'other'|'unknown'),latitude,longitude,datum,source,recordedAt},anchorDetails,season,inspectionDue/serviceDue(optional dates),timingSource,notes,active. Due dates are operator-entered, never inferred from company prose. All coordinates/measurements are original strings; decimal format validates numeric geographic bounds, other formats retained literally. recordedAt optional ISO. No coordinate/engineering conversion.
component: mooringId,label,kind,description,serial,installedAt(optional YYYY-MM-DD),notes. State initially 'unknown'; actual installed/winter/stored/retired state is changed only by gear-move. A component keeps its original mooring.
permit: mooringId,jurisdiction,reference,validFrom/validTo(optional dates),requirements,sourceUrls,externalRef,notes. Initially draft; edits reset draft and preserve history; jobs/completed reports retain their snapshots.
job: mooringId,title,kind ('install'|'inspect'|'remove'|'repair'|'relocate'|'seasonal'|'other'),plannedStart,plannedEnd,timezone,crewIds,resourceIds,permitRequired:boolean,permitId(or ''),inspectionRequired:boolean,checklist:[{id,label,required:boolean}],notes,externalRef. Save produces requested. A completed/cancelled/aborted/in-progress job is preserved. Saving confirmed job returns requested.
inspection: jobId,method ('hauled'|'dive'|'visual'|'other'),observedAt,findings:[{id,componentId(or ''),label,condition ('serviceable'|'attention'|'unsafe'|'not-assessed'),measurement,unit,notes,evidenceIds}],summary,notes. Initially draft; performed time cannot exceed operation now. Only in-progress jobs accept field inspections. finalized inspection is immutable.
repair: jobId,inspectionId(or ''),findingId(or ''),description,parts:[{id,description,quantity,unit,unitPriceCents:null|integer}],minutes:null|integer,currency (three uppercase letters when a price is recorded),notes. State open. Explicit operator entries only; money is a record, never an inferred invoice. Editing completed or cancelled repairs requires repair-reopen with a reason while the parent job remains in progress.
submission: mooringId,jobIds,inspectionIds,permitId(or ''),authority,externalRef,notes,previousSubmissionId(or ''). Initially draft. Complete jobs + finalized inspections required for municipal handoff. Returned original stays preserved; amended submission names previousSubmissionId.
notice: mooringId,jobId(or ''),recipient,channel ('email'|'sms'|'phone'|'other'),destination,body,notes. Initially prepared. No send transport.

## Reviewed operational commands
reviewJob(w,id) => {revision,jobId,ready,findings:[{code,message}],snapshot,reviewSha256}.
job-confirm {id,expectedReviewSha256}; validates permit jurisdiction/mooring/date when explicitly required, owners/crew/resources and schedule overlap. Confirmation saves source snapshots. Existing other confirmed/in-progress job overlaps use crew/resource IDs.
job-start {id,at}; actual at must be inside its reviewed planned interval, not future; current source/permit/assignment must still match confirmation.
job-check {id,checkId,done:boolean,note}; only in progress. A required row is explicit; missing assessment remains false.
reviewJobCompletion(w,id) same review shape; checks required checklist and finalized inspection when selected. Unsafe/attention/not-assessed findings need a completed linked repair OR explicit operator exception on that finding. Completion reports remain distinct from authority acceptance.
job-complete {id,at,expectedReviewSha256}; stores complete job/mooring/component/permit/inspection/repair/evidence snapshot.
job-cancel {id,reason}; requested/confirmed only.
job-abort {id,at,reason}; in-progress only, with an actual stop time and reason. Retains the complete partial field snapshot without counting the visit as completed or ready for authority submission.
inspection-finalize {id}; freezes actual mooring/components and field finding/evidence selection. Inspection immutable afterward.
inspection-exception {id,findingId,reason}; records a visible exception to an attention/unsafe finding without rewriting original observation; supports explicit customer/authority handoff. Never labels engineering certification.
repair-complete {id,at,result}; stores source finding and work/parts/time snapshot.
repair-cancel {id,reason}; open repair only; preserves the reason. Cancelled repair work does not resolve a field finding.
repair-reopen {id,reason}; completed or cancelled repair, retains previous completion/cancellation history; current job must remain in progress.
permit-decision {id,result:'approved'|'returned'|'rejected',at,reference,reason}; actual external decision evidence/reference required; records, does not submit or certify.
reviewSubmission(w,id) => {revision,submissionId,ready,findings,snapshot,reviewSha256}.
submission-submit {id,at,reference,expectedReviewSha256}; records actual external submission and exact frozen full source. No transport.
submission-response {id,result:'approved'|'returned'|'rejected',at,reference,issues:[{id,text}],notes}; only submitted, stored response. Approval never silently updates permit; actual permit-decision is explicit.
notice-record-sent {id,at,reference}; records an actual separate send; prepared recipient/body snapshot, no transport.
notice-cancel {id,reason}; prepared only.
gear-move {mooringId,componentIds,state:'installed'|'winter'|'stored'|'retired',location,at,jobId(or ''),reason}; snapshots each component's original state/location and records actual explicit destination. Repeated movements do not erase prior season; retired components stay retired.
evidence-add {evidence:{id?,operatorKey,mooringId,jobId(or ''),name,mime,contentBase64,notes}}; exact bytes/hash computed; 8 MiB per original, 24 MiB raw evidence, 64 MiB complete workspace; no network. evidence reference IDs remain original.
No destructive delete command.

## Queries
mooringView(w,id,{now}) => {mooring,owner,components,permits,jobs,inspections,repairs,submissions,notices,movements,evidence,history,latestCompletedJob,openJobs,openRepairs}. No inferred safe/unsafe overall certificate.
jobView(w,id) => {job,mooring,owner,crew,resources,components,permit,inspections,repairs,evidence,checklist,history,canEdit,canStart,canComplete}. Closed display uses job.completion.snapshot or job.aborted.snapshot when present; current editable views stay separately labeled.
dayPlan(w,day,timezone) => {day,timezone,jobs:[{jobId,title,mooringId,label,start,end,status,crewIds,resourceIds}],conflicts:[{jobIds,kind,id,message}]}.
overview(w,{now}) => {revision,counts:{moorings,jobs,requested,confirmed,inProgress,completed,aborted,openRepairs,submitted,returned},dueInspections:[mooring rows],dueServices:[mooring rows],duePermits:[permit rows],upcomingJobs:[job rows],recentHistory:[last events]}.
costSummary(w,repairId) => {minutes,currency,knownPartsCents,unpricedParts}; quantities numeric explicit, preserve decimals; integer minor-unit computed rounding per line, no automatic labor charge.

## Full original CSV intake
parseCSV, reviewCSV(w,{name,text,mapping}) -> {id,revision,sourceSha256,name,rawText,headers,mapping,rows:[{row,key,values,suggestedMooringId,findings}]}.
Map fields operatorKey,label,externalRef,municipality,harbor,ownerId,vesselName,vesselRegistration,latitude,longitude,positionFormat,datum,positionSource,anchorDetails,season,notes. A mapping value is exact trimmed header name OR {constant:'explicit value'}.
commitCSV(w,review,[{row,action:'create'|'link'|'ignore',mooringId?:id,reason?:text}],options). Every row explicitly decided. Create requires valid fields; link preserves existing asset, links full source row/provenance without overwriting owner/location; ignore requires reason. Raw BOM/CRLF/text and field map retained; duplicate exact source+mapping rejected. CSV8 MiB/10,000rows; workspace64 MiB.
Complete export retains all evidence bytes, source catalogue, raw CSV, frozen handoffs, history. Receiving validates full history and every original byte. Original prospect/native sender records do not enter this reusable application.

## Worked programme
MooringServiceExamples.build(C,catalogue) returns {workspace,ids,walkthrough}; buildAsync(C,catalogue,{onProgress}) reports {message,operations}, yields between source operations.
Examples use explicit demonstration owners/crews/assets, blank personal contacts, dates and decisions labeled demonstration. No copied customer identity or invented real permit approval.
