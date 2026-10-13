# Pebble and Sky complete studio operations API
Version 1.0.0. Browser global and CommonJS export: PebbleStudioOperations. All plain JSON. Each function either returns its complete result or throws Error with readable message and stable code. The UI owns no derived business state.

## Functions
create(catalogue,{id,title,now}) => workspace.
mutate(w,command,{expectedRevision:w.revision,now:ISO,actor:string}) => NEW workspace. Never mutates the input. command={type,...payload}.
reviewSession(w,id), reviewBooking(w,id), reviewLoad(w,id) => {id,revision,reviewSha256,ready,findings:[{code,message}],snapshot}.
Review commands use expectedReviewSha256. An unrelated workspace revision invalidates an old review intentionally.
memberBalance(w,membershipId) => {membershipId,unit,opening,adjustments,used,reserved,remaining,available,validFrom,validTo,status}.
pieceView(w,id) => {piece,clearance,activeLoad,loads,notices,history}.
overview(w) => {revision,counts:{people,memberships,sessions,requested,confirmed,attended,pieces,awaiting,ready,activeLoads,unsentNotices},upcomingSessions,activeLoads,readyPieces}.
reviewCSV(w,{name,text,mapping:{label,ownerId,studioKey,material,cone,stage,externalRef,notes}}) => {id,revision,sourceSha256,name,headers,rows:[{row,key,values,suggestedPieceId,findings}],mapping,rawText}.
commitCSV(w,review,decisions,[options]) => NEW workspace; decisions=[{row,action:'create'|'link'|'ignore',pieceId?,reason?}]. Link preserves the existing piece and adds original provenance; no automatic overwrite. Full original file and decisions retained.
exportWorkspace(w) => complete stable JSON string; importWorkspace(text,{catalogue}) => validated complete workspace.
uid(prefix) => unique string.
bytes(text), hash(text), canonical(value) are exported pure helpers.
Examples: PebbleStudioExamples.build(C,catalogue) => {workspace,ids,walkthrough}; buildAsync(C,catalogue,{onProgress,yieldEvery}) => same Promise.

## Workspace
schema:'commons.pebblesky.studio-workspace.v1', version:'1.0.0', id,title,createdAt,updatedAt,revision,catalogue,catalogueSha256.
Arrays: people,resources,programmes,memberships,sessions,bookings,pieces,loads,notices,ledger,imports,history.
Every record has id,studioKey,createdAt,updatedAt,createdRevision,updatedRevision; cross-studio references reject. catalogue.studios[{key,name,timezone,companyUrl,sourceUrls,publishedFacts,existingTools}], catalogue.sources[{url,checkedAt,facts}]. Source facts remain distinct from actual operating records.

## Setup commands
person-save {person:{id?,studioKey,name,email:'',phone:'',externalRef:'',notes:'',active:true}}.
resource-save {resource:{id?,studioKey,name,kind:'room'|'wheels'|'kiln'|'shelf'|'other',capacity:null|positiveInteger,active:true,notes:'',externalRef:''}}. Capacity is an actual operator-entered limit. Published wheel/kiln counts never create physical assets.
programme-save {programme:{id?,studioKey,name,kind:'class'|'open-studio'|'member-access'|'firing-dropoff'|'firing',cone:'',materials:'',instructions:'',sourceUrls:[],makeupLimit:null|nonnegativeInteger,active:true}}. Cone is an exact STRING including leading zero/range. No temperature/duration inferred.
membership-save {membership:{id?,studioKey,personId,name,access:'booked'|'unbooked'|'firing-only',validFrom:'YYYY-MM-DD',validTo:'YYYY-MM-DD',unit:'visits'|'minutes',opening:null|integer>=0,limits:[{period:'week'|'month',unit:'visits'|'minutes',maximum:positiveInteger,weekStartsOn:1}],sourceUrls:[],externalRef:'',notes:'',active:true}}. ValidTo is inclusive studio-local date. opening:null explicitly means no total-credit ledger limit; explicit calendar-week/month allowances in limits still apply. An empty limits array imposes no additional period limit. Existing member/unit/opening cannot be rewritten after ledger/reservations; use adjustment. Unbooked access is recorded using a member-access session with attendance, not a reservation requirement.
credit-adjust {membershipId,amount:nonzeroInteger,reason}. Opening and adjustment limits are explicit; no automatic refund/fee.
session-save {session:{id?,studioKey,title,kind:'class'|'open-studio'|'member-access'|'firing-dropoff',programmeId:'',resourceIds:[],start:ISO,end:ISO,timezone:IANA,capacity:positiveInteger,membershipRequired:false,notes:'',externalRef:''}}. Created/edited status is draft; actual shared resources are exclusively allocated across overlapping approved sessions. capacity must fit each selected room/wheels capacity where specified; no sum of unrelated capacities.
session-approve {id,expectedReviewSha256}. Snapshot records exact resource/programme/capacity/time. Editing an approved session returns draft, retaining existing bookings and explicit re-review needs.
session-cancel {id,reason}. Reject when an attendance debit exists; preserves cancellation and releases unconsumed bookings.

## Access, class bookings and balances
booking-save {booking:{id?,studioKey,personId,sessionId,membershipId:'',units:positiveInteger,makeupOf:'',courseRef:'',notes:'',externalRef:''}}. One person per booking, exactly one seat. Units are visits/minutes explicitly selected; membership-free booking uses units=1. Creates requested; cannot edit attended/cancelled records.
booking-confirm {id,expectedReviewSha256}. Checks approved current session, capacity, unique person, active member/window, allowance. Makeup links an earlier missed/cancelled booking for same person/studio and only one active replacement; the operator-configured programme.makeupLimit applies to that person's matching courseRef across the original programme; courseRef is required for a limited makeup. The number is never inferred from a source sentence. Future change of session/membership requires fresh re-review at attendance.
booking-attend {id,expectedReviewSha256}. May directly attend requested unbooked member-access if membership.access='unbooked'; otherwise needs confirmed. Captures current complete booking/person/session/membership snapshot and debits membership exactly once. Repeated same attendance is a no-op.
booking-missed {id,consume:false|true,reason}. Closes confirmed booking; optional actual policy decision consumes one explicit debit. No blanket cancellation rule.
booking-cancel {id,reason}. Releases reservation; does not reverse attended/missed history.
attendance-correct {id,reason}. Reverses this booking's exact original debit once, records correction, moves to corrected. A later replacement is a new booking. No editing an old ledger item.

## Pieces and loads
piece-save {piece:{id?,studioKey,ownerId,label,material:'',cone:'',stage:'greenware'|'bisque'|'glazed'|'finished'|'other',bookingId:'',externalRef:'',notes:'',gallery:'private'|'owner-consented'}}. New status awaiting. No edit while firing/cooling, after collection or while in approved load. Material/cone/stage changes revoke clearance.
piece-clear {id,programmeId,approved:boolean,reason}. Operator records exact technical material/cone/programme clearance, not inferred string equality. Programme must be firing. Clearance saves piece/programme snapshot and actor/time. A changed programme revokes readiness by snapshot comparison.
piece-withdraw {id,reason}. No active load; retains original history.
load-save {load:{id?,studioKey,name,kilnId,programmeId,pieceIds:[],plannedStart:ISO,plannedEnd:ISO,timezone:IANA,capacityAcknowledged:false,notes:''}}. Draft only; changes retain prior history. One piece can only be in one active load. Actual programme is firing, resource is an active kiln, dates valid. No calculated loading volume.
load-approve {id,expectedReviewSha256}. Review requires every included piece's matching current clearance, no active conflicting kiln/load, explicit operator capacity acknowledgment, and complete contents. Records full immutable reviewed load/piece/programme/kiln snapshot.
load-start {id,expectedReviewSha256,actualAt:ISO}. Fresh current review, approved status, actual operator decision; sets each piece firing.
load-cooling {id,actualAt:ISO,notes:''}. Firing only, saves actual transition; pieces cooling.
load-unload {id,actualAt:ISO,outcomes:[{pieceId,result:'bisqued'|'glazed'|'finished'|'damaged'|'refire',notes:''}]}. Cooling only, exactly one explicit outcome for every original loaded piece. Clears technical clearance. finished -> ready; damaged -> damaged; other outcomes -> awaiting with stage retained/advanced. No elapsed-time automatic release.
load-cancel {id,reason}. Draft/approved only, pieces return awaiting; retained old approval.
piece-pickup {id,collector,actualAt:ISO,notes:''}. Ready only, records collection; repeated call rejects, not a second pickup.

## Ready notices
notice-prepare {notice:{id?,studioKey,personId,pieceIds:[],channel:'email'|'sms'|'phone'|'other',destination:'',body,notes:''}}. All selected pieces ready and owned by same person. State prepared. No outbound transport.
notice-record {id,sentAt:ISO,reference}. Records actual operator-supplied transport/result reference after the send; never sends.
notice-cancel {id,reason}. Prepared only. Existing sent notice retained.

## History/import
Each mutation includes original before/after record snapshots in history [{id,revision,at,actor,kind,changes:[{collection,id,before,after}]}]. Original imported rawText/mapping/decisions retained with source SHA and original row references. Exact full JSON export/import validates all references, source catalog identity, original ledger linkage and current record schemas. Unknown/malformed input fails before replacing a workspace.
Limits: CSV8MiB, fullJSON64MiB, textfields16000chars, piece imports10000rows. UI checks byte size before reading/receiving. ISO times retain timezone choices; all capacity overlaps compare actual instants.

