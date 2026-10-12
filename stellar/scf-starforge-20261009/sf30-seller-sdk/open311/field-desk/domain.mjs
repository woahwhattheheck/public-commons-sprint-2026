// MIT. Versioned crew work, exact resource entries and explicit return reconciliation.
import { canonical, copy, digest, equal, fail, object, text, instant, entityId, seal, verifySeal, uniqueStrings, MAX_PACKAGE_BYTES, MAX_ROWS } from '../gis/shared.mjs';
import { rowBinding } from './source.mjs';

export const CREW_SCHEMA='commons.open311.field-crew.v1';
export const VISIT_SCHEMA='commons.open311.field-visit.v1';
export const ATTACHMENT_SCHEMA='commons.open311.field-attachment.v1';
export const ATTACHMENT_ALIAS_SCHEMA='commons.open311.field-attachment-name.v1';
export const PACKAGE_SCHEMA='commons.open311.field-crew-package.v1';
export const RETURN_INPUT_SCHEMA='commons.open311.field-return.v1';
export const RETURN_SCHEMA='commons.open311.field-return-record.v1';
export const DECISION_SCHEMA='commons.open311.field-decision.v1';
export const REVIEW_SCHEMA='commons.open311.field-supervisor-review.v1';
export const UPDATE_SCHEMA='commons.open311.field-destination-update.v1';
export const FIELD_STATUSES=['planned','assigned','in_progress','completed','unable','cancelled'];
export const PRIORITIES=['low','normal','high','urgent'];
export const FIELD_KEYS=['status','actualStart','actualEnd','completionNote','notes','resources','attachmentIds'];
const scalarFields=['status','actualStart','actualEnd','completionNote'];
export const choice=(value,values,name)=>{if(!values.includes(value))fail('INVALID_CHOICE',name+' must be one of '+values.join(', ')+'.');return value;};
const optionalTime=(value,name)=>value===undefined||value===null||value===''?null:instant(value,name);
const optionalText=(value,name,max=10000)=>text(value??'',name,max,{empty:true});
const safeId=(value,name)=>text(value,name,200);
export function decimal(value,name,{nullable=false}={}){
  if(nullable&&(value===null||value===undefined||value===''))return null;
  if(typeof value!=='string'||!/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,9})?$/.test(value))fail('INVALID_DECIMAL',name+' must be an exact nonnegative decimal string with at most 18 whole and 9 fractional digits.');
  return value;
}
function decimalParts(value){const [whole,fraction='']=value.split('.');return {n:BigInt(whole+fraction),scale:fraction.length};}
function decimalRender(n,scale){let digits=n.toString().padStart(scale+1,'0');if(scale){digits=digits.slice(0,-scale)+'.'+digits.slice(-scale);digits=digits.replace(/0+$/,'').replace(/\.$/,'');}return digits;}
export function addDecimal(a,b){const x=decimalParts(a),y=decimalParts(b),scale=Math.max(x.scale,y.scale);return decimalRender(x.n*10n**BigInt(scale-x.scale)+y.n*10n**BigInt(scale-y.scale),scale);}
export function multiplyDecimal(a,b){const x=decimalParts(a),y=decimalParts(b);return decimalRender(x.n*y.n,x.scale+y.scale);}
export function resourceTotals(visits){
  const groups=new Map(),costs=new Map();
  for(const visit of visits)for(const line of visit.field.resources){
    const key=canonical([line.kind,line.name,line.unit]),group=groups.get(key)??{kind:line.kind,name:line.name,unit:line.unit,quantity:'0',entries:0};
    group.quantity=addDecimal(group.quantity,line.quantity);group.entries++;groups.set(key,group);
    if(line.unitCost!==null){const amount=multiplyDecimal(line.quantity,line.unitCost);costs.set(line.currency,addDecimal(costs.get(line.currency)??'0',amount));}
  }
  return {resources:[...groups.values()],costs:[...costs].map(([currency,amount])=>({currency,amount}))};
}
function distinctEntries(value,name,normalize){
  if(!Array.isArray(value)||value.length>10000)fail('INVALID_FIELD_LIST',name+' must be an array of at most 10,000 records.');
  const rows=value.map(normalize),ids=new Set();for(const row of rows){if(ids.has(row.id))fail('DUPLICATE_FIELD_ENTRY',name+' needs distinct stable entry IDs.');ids.add(row.id);}return rows;
}
export function normalizeField(input={}){
  object(input,'Field record');for(const key of Object.keys(input))if(!FIELD_KEYS.includes(key))fail('UNKNOWN_FIELD','This field key is unsupported.',400,{key});
  const value={status:choice(input.status??'planned',FIELD_STATUSES,'Field status'),actualStart:optionalTime(input.actualStart,'Actual visit start'),actualEnd:optionalTime(input.actualEnd,'Actual visit end'),completionNote:optionalText(input.completionNote,'Completion note',100000),
    notes:distinctEntries(input.notes??[],'Visit notes',entry=>{object(entry,'Visit note');return {id:safeId(entry.id,'Note ID'),author:text(entry.author,'Note author',300),text:text(entry.text,'Note text',100000),recordedAt:instant(entry.recordedAt,'Note recorded time')};}),
    resources:distinctEntries(input.resources??[],'Resource entries',entry=>{
      object(entry,'Resource entry');const unitCost=decimal(entry.unitCost,'Unit cost',{nullable:true}),currency=entry.currency===null||entry.currency===undefined||entry.currency===''?null:text(entry.currency,'Cost currency',3).toUpperCase();
      if(currency!==null&&!/^[A-Z]{3}$/.test(currency))fail('INVALID_CURRENCY','Use a three-letter currency code for the entered cost.');
      if(unitCost!==null&&currency===null)fail('CURRENCY_REQUIRED','An entered unit cost needs its currency.');
      return {id:safeId(entry.id,'Resource entry ID'),kind:choice(entry.kind,['labor','material','equipment','other'],'Resource kind'),name:text(entry.name,'Resource name',500),quantity:decimal(entry.quantity,'Resource quantity'),unit:text(entry.unit,'Quantity unit',100),unitCost,currency,note:optionalText(entry.note,'Resource note',10000)};
    }),attachmentIds:uniqueStrings(input.attachmentIds??[],'Attachment IDs',{max:10000})};
  for(const id of value.attachmentIds)if(!/^attachment-[a-f0-9]{64}$/.test(id))fail('INVALID_ATTACHMENT_ID','Attachment IDs must bind their exact raw-byte SHA-256.');
  if(value.actualStart&&value.actualEnd&&Date.parse(value.actualEnd)<Date.parse(value.actualStart))fail('INVALID_VISIT_INTERVAL','Actual visit end must be at or after its start.');
  return value;
}
export function normalizeFieldPatch(input,base){
  object(input,'Returned field edits');if(!Object.keys(input).length)fail('EMPTY_FIELD_CHANGE','Each included return visit needs at least one edited field.');
  for(const key of Object.keys(input))if(!FIELD_KEYS.includes(key))fail('UNKNOWN_FIELD','The crew return can edit field records only.',400,{key});
  const full=normalizeField({...copy(base),...copy(input)});return Object.fromEntries(Object.keys(input).map(key=>[key,full[key]]));
}
export function createCrew(input,identity,previous=null){
  object(input,'Crew');const name=text(input.name,'Crew name',300),members=distinctEntries(input.members??[],'Crew members',member=>{
    object(member,'Crew member');return {id:member.id?safeId(member.id,'Crew member ID'):entityId('member',{crewId:identity.id,name:member.name,role:member.role??'',contact:member.contact??''}),name:text(member.name,'Member name',300),role:optionalText(member.role,'Member role',300),contact:optionalText(member.contact,'Member contact',1000)};
  });
  if(input.active!==undefined&&typeof input.active!=='boolean')fail('INVALID_ACTIVE','Crew active must be a boolean.');
  return seal({schema:CREW_SCHEMA,id:identity.id,versionId:identity.versionId,previousVersionId:previous?.versionId??null,name,members,note:optionalText(input.note,'Crew note',100000),active:input.active??true,createdAt:identity.createdAt});
}
export function createVisit(input,identity,{previous=null,source,row,crew=null,cause=null}={}){
  object(input,'Visit');
  if(previous&&(previous.source.seriesId!==source.seriesId||previous.sourceKey!==row.key||previous.serviceRequestId!==row.serviceRequestId))fail('VISIT_IDENTITY_CHANGED','Create a new visit for a different original request. Existing visits can explicitly select a successor dispatch for the same request.',409);
  const plannedStart=optionalTime(input.plannedStart,'Planned start'),plannedEnd=optionalTime(input.plannedEnd,'Planned end');
  if(plannedStart&&plannedEnd&&Date.parse(plannedEnd)<Date.parse(plannedStart))fail('INVALID_VISIT_INTERVAL','Planned end must be at or after planned start.');
  if(crew&&!crew.active&&previous?.crewId!==crew.id)fail('CREW_INACTIVE','Select an active crew for a new assignment.',409);
  return seal({schema:VISIT_SCHEMA,id:identity.id,versionId:identity.versionId,previousVersionId:previous?.versionId??null,createdAt:identity.createdAt,
    sourceId:source.id,sourceKey:row.key,serviceRequestId:row.serviceRequestId,workId:row.work.id,source:rowBinding(source,row),
    crewId:crew?.id??null,crewVersionId:crew?.versionId??null,crewName:crew?.name??'',title:text(input.title??row.request.title??row.serviceRequestId,'Visit title',1000),
    plannedStart,plannedEnd,dueAt:optionalTime(input.dueAt,'Visit due time'),priority:choice(input.priority??'normal',PRIORITIES,'Visit priority'),instructions:optionalText(input.instructions,'Crew instructions',100000),field:normalizeField(input.field??{}),cause:copy(cause)});
}
export function visitSummary(visit){const {id,versionId,previousVersionId,sourceId,sourceKey,serviceRequestId,workId,title,crewId,crewVersionId,crewName,priority,plannedStart,plannedEnd,dueAt,createdAt,field,sha256}=visit;return copy({id,versionId,previousVersionId,sourceId,sourceKey,serviceRequestId,workId,title,crewId,crewVersionId,crewName,priority,plannedStart,plannedEnd,dueAt,createdAt,field,sha256});}
export function decodeAttachment(input){
  object(input,'Original attachment');const filename=text(input.filename,'Original filename',500),contentType=text(input.contentType??'application/octet-stream','Original media type',300);
  if(/[\\/]/.test(filename)||/[\r\n]/.test(filename)||/[\r\n\0]/.test(contentType))fail('INVALID_ATTACHMENT_NAME','Use a filename without a path and a media type without control characters.');
  if(typeof input.contentBase64!=='string'||input.contentBase64.length>Math.ceil(32*1024*1024/3)*4)fail('ATTACHMENT_SIZE','Each complete field file may be at most 32 MiB.',413);
  const bytes=Buffer.from(input.contentBase64,'base64');if(bytes.toString('base64')!==input.contentBase64)fail('INVALID_BASE64','Use canonical complete base64 for the original file.');
  return {id:'attachment-'+digest(bytes),filename,contentType,bytes:bytes.length,sha256:digest(bytes),contentBase64:input.contentBase64};
}
export function createAttachment(input,identity){const decoded=decodeAttachment(input);return seal({schema:ATTACHMENT_SCHEMA,...decoded,contentSha256:decoded.sha256,createdAt:identity.createdAt});}
export function attachmentSummary(file){return {id:file.id,filename:file.filename,contentType:file.contentType,bytes:file.bytes,sha256:file.contentSha256,createdAt:file.createdAt};}
export function attachmentExport(file,aliases=[]){return {...attachmentSummary(file),contentBase64:file.contentBase64,aliases:copy(aliases)};}
export function createPackage(input,identity,entries,attachments){
  text(input.name,'Crew package name',300);
  if(!entries.length||entries.length>MAX_ROWS)fail('VISIT_SELECTION_REQUIRED','Select at least one saved visit for the crew package.');
  return seal({schema:PACKAGE_SCHEMA,id:identity.id,name:input.name,workspaceId:identity.workspaceId,workspaceRevision:identity.revision,createdAt:identity.createdAt,note:optionalText(input.note,'Crew package note',100000),visits:copy(entries),attachments:copy(attachments)});
}
export function packageSummary(value){return {id:value.id,name:value.name,workspaceId:value.workspaceId,workspaceRevision:value.workspaceRevision,createdAt:value.createdAt,visits:value.visits.length,attachments:value.attachments.length,sha256:value.sha256};}
export function createReturn(input,packet,identity){
  object(input,'Crew return');if(input.schema!==RETURN_INPUT_SCHEMA)fail('RETURN_SCHEMA','Use the original field-return.v1 file from the crew editor.');
  if(input.packageId!==packet.id||input.packageSha256!==packet.sha256)fail('RETURN_PACKAGE_MISMATCH','The return must name the exact issued crew package and SHA-256.');
  if(!Array.isArray(input.visits)||!input.visits.length||input.visits.length>MAX_ROWS)fail('RETURN_VISITS_REQUIRED','Include at least one edited visit in the partial return.');
  const visitIds=new Set(),proposals=input.visits.map(edit=>{
    object(edit,'Returned visit');text(edit.visitId,'Returned visit ID',200);
    if(visitIds.has(edit.visitId))fail('DUPLICATE_RETURN_VISIT','Include each visit only once in a return.');visitIds.add(edit.visitId);
    const entry=packet.visits.find(v=>v.visit.id===edit.visitId);
    if(!entry||edit.baseVersionId!==entry.visit.versionId)fail('RETURN_BASE_MISMATCH','The returned visit must retain its exact package baseline.',409,{visitId:edit.visitId});
    const fields=normalizeFieldPatch(edit.fields,entry.visit.field);
    return {id:entityId('proposal',{returnId:identity.id,visitId:edit.visitId}),visitId:edit.visitId,baseVersionId:edit.baseVersionId,fields};
  });
  if(!Array.isArray(input.attachments??[])||(input.attachments??[]).length>10000)fail('RETURN_ATTACHMENTS_INVALID','Return attachments must be a complete array.');
  const attachments=(input.attachments??[]).map(decodeAttachment),names=new Set();
  for(const file of attachments){const key=canonical([file.id,file.filename,file.contentType]);if(names.has(key))fail('DUPLICATE_RETURN_ATTACHMENT','The return repeats the same original file descriptor.');names.add(key);}
  return seal({schema:RETURN_SCHEMA,id:identity.id,packageId:packet.id,packageSha256:packet.sha256,name:text(identity.name??input.name??'Crew return','Return name',300),returnedBy:text(input.returnedBy,'Returned by',300),note:optionalText(input.note,'Return note',100000),createdAt:identity.createdAt,
    proposals,attachments:attachments.map(file=>({id:file.id,filename:file.filename,contentType:file.contentType,bytes:file.bytes,sha256:file.sha256})),originalText:identity.originalText,originalFile:{filename:'original-field-return.json',contentType:'application/json; charset=utf-8',bytes:Buffer.byteLength(identity.originalText),sha256:digest(identity.originalText)}});
}
export function returnSummary(value){return {id:value.id,packageId:value.packageId,name:value.name,returnedBy:value.returnedBy,createdAt:value.createdAt,proposals:value.proposals.length,attachments:value.attachments.length,sha256:value.sha256};}
function pointer(value){return value.replace(/~/g,'~0').replace(/\//g,'~1');}
export function proposalChanges(proposal,base,current){
  const changes=[],add=(field,entryId,before,after,currentValue)=>{
    if(equal(before,after))return;
    const path='/field/'+field+(entryId===null?'':'/'+pointer(entryId)),id=entityId('change',{proposalId:proposal.id,path});
    changes.push({id,path,field,entryId,base:copy(before),current:copy(currentValue),returned:copy(after),conflict:!equal(currentValue,before)&&!equal(currentValue,after)});
  };
  for(const field of Object.keys(proposal.fields)){
    const returned=proposal.fields[field];
    if(scalarFields.includes(field)){add(field,null,base.field[field],returned,current.field[field]);continue;}
    if(field==='attachmentIds'){
      const b=new Set(base.field[field]),r=new Set(returned),c=new Set(current.field[field]);
      for(const id of new Set([...b,...r]))add(field,id,b.has(id),r.has(id),c.has(id));
    }else{
      const b=new Map(base.field[field].map(v=>[v.id,v])),r=new Map(returned.map(v=>[v.id,v])),c=new Map(current.field[field].map(v=>[v.id,v]));
      for(const id of new Set([...b.keys(),...r.keys()]))add(field,id,b.get(id)??null,r.get(id)??null,c.get(id)??null);
    }
  }
  return changes;
}
export function assignmentChanged(base,current){
  return !equal({crewId:base.crewId,crewVersionId:base.crewVersionId,plannedStart:base.plannedStart,plannedEnd:base.plannedEnd,dueAt:base.dueAt,instructions:base.instructions,priority:base.priority},{crewId:current.crewId,crewVersionId:current.crewVersionId,plannedStart:current.plannedStart,plannedEnd:current.plannedEnd,dueAt:current.dueAt,instructions:current.instructions,priority:current.priority});
}
export function applyProposal(proposal,base,current,selection){
  const changes=proposalChanges(proposal,base,current),choices=new Map();
  if(!Array.isArray(selection.fieldChoices??[]))fail('FIELD_CHOICES_INVALID','Use an array of explicit field choices.');
  for(const item of selection.fieldChoices??[]){object(item,'Field choice');if(choices.has(item.changeId)||!changes.some(c=>c.id===item.changeId))fail('UNKNOWN_FIELD_CHOICE','A field choice is repeated or outside this proposal.');choices.set(item.changeId,choice(item.choice,['returned','current'],'Conflict choice'));}
  const unresolved=changes.filter(change=>change.conflict&&!choices.has(change.id));
  if(unresolved.length)fail('CONFLICT_CHOICES_REQUIRED','Choose the returned or current value for every overlapping field change.',409,{changes:unresolved.map(c=>({id:c.id,path:c.path}))});
  const field=copy(current.field),applied=[];
  for(const change of changes){
    const selected=choices.get(change.id)??'returned';applied.push({changeId:change.id,path:change.path,choice:selected,conflict:change.conflict});
    if(selected==='current')continue;
    if(change.entryId===null)field[change.field]=copy(change.returned);
    else if(change.field==='attachmentIds'){
      if(change.returned&&!field.attachmentIds.includes(change.entryId))field.attachmentIds.push(change.entryId);
      if(!change.returned)field.attachmentIds=field.attachmentIds.filter(id=>id!==change.entryId);
    }else{
      const index=field[change.field].findIndex(v=>v.id===change.entryId);
      if(change.returned===null){if(index>=0)field[change.field].splice(index,1);}
      else if(index>=0)field[change.field][index]=copy(change.returned);
      else field[change.field].push(copy(change.returned));
    }
  }
  return {field:normalizeField(field),changes,applied};
}
export function sourceContext(visit,sources){
  const original=sources.find(s=>s.id===visit.sourceId);if(!original)fail('MISSING_VISIT_SOURCE','The original visit source is missing.');
  const latest=[...sources].reverse().find(s=>s.seriesId===original.seriesId&&(original.originWorkspaceId===null||s.originWorkspaceId===null||s.originWorkspaceId===original.originWorkspaceId))??original;
  const row=latest.dispatch.rows.find(r=>r.key===visit.sourceKey),rowSha256=row?digest(row):null;
  return {sourceId:visit.sourceId,latestSourceId:latest.id,latestDispatchId:latest.dispatchId,latestDispatchSha256:latest.dispatchSha256,sourceKey:visit.sourceKey,originalRowSha256:visit.source.rowSha256,latestRowSha256:rowSha256,missingFromLatest:!row,changed:rowSha256!==visit.source.rowSha256};
}
export function sameSourceContext(a,b){return equal(a,b);}
export function createUpdate(input,identity,entries,attachments){
  text(input.name,'Destination update name',300);text(input.reviewer,'Dispatching supervisor',300);object(input.destination,'Destination');
  const destination={name:text(input.destination.name,'Destination name',300),system:text(input.destination.system,'Destination system',300),reference:optionalText(input.destination.reference,'Destination reference',2000)};
  if(!entries.length)fail('UPDATE_SELECTION_REQUIRED','Select approved visit versions for the destination update.');
  return seal({schema:UPDATE_SCHEMA,id:identity.id,name:input.name,workspaceId:identity.workspaceId,workspaceRevision:identity.revision,createdAt:identity.createdAt,reviewer:input.reviewer,destination,note:optionalText(input.note,'Destination update note',100000),items:copy(entries),attachments:copy(attachments),totals:{visits:entries.length,closureRequests:entries.filter(e=>e.action==='request_closure').length,...resourceTotals(entries.map(e=>e.visit))}});
}
export function updateSummary(value){return {id:value.id,name:value.name,destination:copy(value.destination),reviewer:value.reviewer,createdAt:value.createdAt,items:value.items.length,totals:copy(value.totals),sha256:value.sha256};}
