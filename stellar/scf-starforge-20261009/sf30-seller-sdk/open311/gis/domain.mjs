// MIT. Immutable GIS handoffs, analyst proposals and reviewed dispatch editions.
import { copy, digest, equal, fail, object, text, instant, uniqueStrings, entityId, seal, verifySeal, rowSearch, MAX_ROWS } from './shared.mjs';
import { EMPTY_OPERATOR, OPERATOR_FIELDS, SOURCE_COLUMNS, FILE_COLUMNS, columnText, normalizeOperator, normalizeGeometry, flatRow, operatorFromFlat, editableRow } from './fields.mjs';
export const HANDOFF_SCHEMA='commons.open311.gis-handoff.v1';
export const RETURN_SCHEMA='commons.open311.gis-return.v1';
export const DECISION_SCHEMA='commons.open311.gis-decision.v1';
export const DISPATCH_SCHEMA='commons.open311.gis-dispatch.v1';
export const ANALYST_SCHEMA='commons.open311.gis-analyst.v1';
function values(value,name){if(value===undefined)return [];if(!Array.isArray(value)||value.some(v=>v!==null&&typeof v!=='string')||new Set(value).size!==value.length)fail('INVALID_FILTER',name+' must contain distinct source values.');return copy(value);}
export function normalizeDefinition(value){
  object(value,'Handoff definition');
  const filter=object(value.filters??{},'Source filters');
  if(Object.keys(filter).some(k=>!['q','statuses','serviceCodes','geometry'].includes(k)))fail('UNKNOWN_FILTER','The source filter contains an unknown field.');
  const geometry=filter.geometry??'any';if(!['any','located','unlocated'].includes(geometry))fail('INVALID_GEOMETRY_FILTER','Choose any, located or unlocated.');
  return {name:text(value.name,'Handoff name',200),sourceIds:uniqueStrings(value.sourceIds,'Source editions',{empty:false,max:1000}),
    predecessorId:value.predecessorId==null?null:text(value.predecessorId,'Predecessor handoff',120),
    filters:{q:text(filter.q??'','Search',2000,{empty:true}),statuses:values(filter.statuses,'Source statuses'),serviceCodes:values(filter.serviceCodes,'Service codes'),geometry},
    defaults:normalizeOperator(value.defaults??{})};
}
function rowCounts(rows){return {rows:rows.length,located:rows.filter(r=>r.geometry!==null).length,unlocated:rows.filter(r=>r.geometry===null).length,
  invalidGeometry:rows.filter(r=>r.geometry===null&&r.geometryStatus==='INVALID_COORDINATES').length,
  dispatchReady:rows.filter(r=>r.operator.action==='dispatch'&&r.lastDecisionId).length,changedSources:rows.filter(r=>r.sourceChanged).length};}
export function handoffSummary(handoff,head=false){return {id:handoff.id,seriesId:handoff.seriesId,edition:handoff.edition,predecessorId:handoff.predecessorId,name:handoff.name,sha256:handoff.sha256,createdAt:handoff.createdAt,sourceIds:copy(handoff.sourceIds),counts:copy(handoff.counts),head};}
function sourceOrder(a,b){return Date.parse(a.observedAt)-Date.parse(b.observedAt)||a.sourceSha256.localeCompare(b.sourceSha256)||a.captureId.localeCompare(b.captureId)||a.sourceId.localeCompare(b.sourceId);}
export function createHandoff(input,sources,identity,{predecessor=null}={}){
  const definition=normalizeDefinition(input),byId=new Map(sources.map(source=>[source.id,source]));
  if(definition.sourceIds.some(id=>!byId.has(id)))fail('SOURCE_NOT_FOUND','A selected complete source edition is missing.',404);
  if(definition.predecessorId!==(predecessor?.id??null))fail('PREDECESSOR_MISMATCH','The selected previous handoff does not match.');
  const selected=definition.sourceIds.flatMap(id=>byId.get(id).rows).sort(sourceOrder),winner=new Map();
  for(const row of selected)winner.set(row.key,row);
  if(winner.size>MAX_ROWS)fail('HANDOFF_ROW_LIMIT','A handoff supports up to 100,000 selected request identities.',413);
  const previous=new Map((predecessor?.rows??[]).map(row=>[row.key,row]));
  let rows=[...winner.values()].map(sourceRow=>{
    const before=previous.get(sourceRow.key),same=before?.sourceSha256===sourceRow.sourceSha256;
    return {...copy(sourceRow),geometry:same?copy(before.geometry):copy(sourceRow.geometry),
      operator:same?copy(before.operator):copy(definition.defaults),lastDecisionId:same?before.lastDecisionId:null,
      geometryOrigin:same?(before.geometryOrigin??'source'):'source',sourceChanged:!!before&&!same,
      previousSourceSha256:before?.sourceSha256??null};
  });
  const f=definition.filters;
  rows=rowSearch(rows,f.q).filter(row=>(!f.statuses.length||f.statuses.includes(row.sourceStatus))&&(!f.serviceCodes.length||f.serviceCodes.includes(row.serviceCode))&&(f.geometry==='any'||f.geometry==='located'&&row.geometry!==null||f.geometry==='unlocated'&&row.geometry===null)).sort((a,b)=>a.key.localeCompare(b.key));
  const id=text(identity.id,'Handoff identity',120);
  const coverage=definition.sourceIds.flatMap(sourceId=>byId.get(sourceId).coverage.map(item=>({inputSourceId:sourceId,...copy(item)})));
  return seal({schema:HANDOFF_SCHEMA,id,seriesId:predecessor?.seriesId??id,edition:(predecessor?.edition??0)+1,predecessorId:predecessor?.id??null,
    name:definition.name,createdAt:instant(identity.createdAt,'Handoff time'),sourceIds:copy(definition.sourceIds),definition,rows,coverage,
    counts:rowCounts(rows),decisionHistory:copy(predecessor?.decisionHistory??[]),
    interpretation:'Latest observed original request version across the selected source editions. GIS edits are separate from the source record.'});
}
function changeFields(before,after){const fields=[];if(!equal(before.geometry,after.geometry))fields.push('geometry');for(const key of OPERATOR_FIELDS)if(before.operator[key]!==after.operator[key])fields.push('operator.'+key);return fields;}
export function analystReturn(handoff,decoded,input,identity){
  verifySeal(handoff,HANDOFF_SCHEMA);
  const analyst=text(input.analyst,'Analyst',200),name=text(input.name??('Analyst return — '+analyst),'Return name',200);
  if(!['gpkg','geojson','csv','json'].includes(input.format))fail('INVALID_RETURN_FORMAT','Choose gpkg, geojson, csv or json.');
  const original=copy(object(input.original,'Complete analyst file'));
  if(original.encoding!=='base64'||typeof original.body!=='string')fail('ORIGINAL_RETURN_REQUIRED','Keep the complete original analyst file.');
  const bytes=Buffer.from(original.body,'base64');if(bytes.toString('base64')!==original.body||bytes.length!==original.bytes||digest(bytes)!==original.sha256)fail('ORIGINAL_RETURN_MISMATCH','The analyst file differs from its saved bytes and SHA-256.');
  const rows=new Map(handoff.rows.map(row=>[row.key,row])),changes=[],conflicts=[],seen=new Set(),duplicates=new Set();
  const incoming=Array.isArray(decoded.rows)?decoded.rows:[];
  if(incoming.length>MAX_ROWS)fail('RETURN_ROW_LIMIT','An analyst return supports up to 100,000 rows.',413);
  const conflict=(rowNumber,key,code,message,fields=[])=>conflicts.push({id:entityId('conflict',{returnId:identity.id,rowNumber,key,code,fields}),rowNumber,key:key??null,code,message,fields});
  for(const issue of decoded.problems??[])conflict(issue.rowNumber??null,issue.key??null,issue.code??'INVALID_ANALYST_FILE',issue.message??'The analyst file has an invalid structure.',issue.fields??[]);
  const header=decoded.metadata??null;
  let headerMatches=true;
  if(header&&(header.handoffId!==handoff.id||header.handoffSha256!==handoff.sha256)){headerMatches=false;conflict(null,null,'HANDOFF_HEADER_MISMATCH','The file header belongs to a different handoff edition.');}
  for(const entry of incoming){const key=columnText(entry.properties?.feature_key);if(seen.has(key))duplicates.add(key);seen.add(key);}
  let unchanged=0;
  for(const entry of incoming){
    const props=object(entry.properties??{},'Analyst row'),key=columnText(props.feature_key),base=rows.get(key),rowNumber=entry.rowNumber??null;
    if(!key){conflict(rowNumber,null,'FEATURE_KEY_MISSING','The row has no original feature key.');continue;}
    if(duplicates.has(key)){conflict(rowNumber,key,'DUPLICATE_FEATURE_KEY','The returned file repeats this original feature key.');continue;}
    if(!base){conflict(rowNumber,key,'UNKNOWN_FEATURE','The returned row does not belong to the saved handoff.');continue;}
    if(!headerMatches)continue;
    const absent=FILE_COLUMNS.filter(column=>!Object.hasOwn(props,column));
    if(absent.length){conflict(rowNumber,key,'COLUMNS_MISSING','Keep the original source and analyst columns.',absent);continue;}
    const expected=flatRow(handoff,base),changedSource=SOURCE_COLUMNS.filter(column=>columnText(props[column])!==expected[column]);
    if(changedSource.length){conflict(rowNumber,key,'SOURCE_FIELDS_CHANGED','The source identity or original source columns changed.',changedSource);continue;}
    if(entry.problem){conflict(rowNumber,key,entry.problem.code??'INVALID_GEOMETRY',entry.problem.message??'The returned geometry is invalid.');continue;}
    let after;
    try{after={geometry:normalizeGeometry(entry.geometry),operator:operatorFromFlat(Object.fromEntries(Object.entries(props).map(([k,v])=>[k,columnText(v)])))};}
    catch(error){if(error.status!==400)throw error;conflict(rowNumber,key,error.code,error.message);continue;}
    const before=editableRow(base),fields=changeFields(before,after);
    if(!fields.length){unchanged++;continue;}
    changes.push({id:entityId('change',{returnId:identity.id,key,sourceSha256:base.sourceSha256,before,after}),key,serviceRequestId:base.serviceRequestId,sourceSha256:base.sourceSha256,fields,before,after});
  }
  const missingKeys=handoff.rows.filter(row=>!seen.has(row.key)).map(row=>row.key);
  return seal({schema:RETURN_SCHEMA,id:text(identity.id,'Return identity',120),handoffId:handoff.id,handoffSha256:handoff.sha256,analyst,name,format:input.format,
    original,receivedAt:instant(identity.createdAt,'Return time'),changes,conflicts,missingKeys,unchangedCount:unchanged,
    counts:{changes:changes.length,conflicts:conflicts.length,missing:missingKeys.length,unchanged}});
}
export function returnSummary(value){return {id:value.id,handoffId:value.handoffId,handoffSha256:value.handoffSha256,analyst:value.analyst,name:value.name,format:value.format,sha256:value.original.sha256,editionSha256:value.sha256,bytes:value.original.bytes,receivedAt:value.receivedAt,counts:copy(value.counts)};}
export function applyDecision(base,current,returned,input,identity,{previousDecisions=[]}={}){
  verifySeal(base,HANDOFF_SCHEMA);verifySeal(current,HANDOFF_SCHEMA);verifySeal(returned,RETURN_SCHEMA);
  const selection=object(input,'Review selection');
  if(returned.handoffId!==base.id||returned.handoffSha256!==base.sha256||current.seriesId!==base.seriesId||selection.returnId!==returned.id||selection.handoffId!==current.id)fail('DECISION_SOURCE_MISMATCH','Choose the exact analyst return and current handoff in its original series.',409);
  const reviewer=text(selection.reviewer,'Reviewer',200),note=text(selection.note??'','Review note',20000,{empty:true});
  const accept=uniqueStrings(selection.accept??[],'Accepted changes'),reject=uniqueStrings(selection.reject??[],'Rejected changes');
  if(!accept.length&&!reject.length)fail('DECISION_SELECTION_REQUIRED','Choose at least one proposal to accept or reject.');
  const chosen=[...accept,...reject];if(new Set(chosen).size!==chosen.length)fail('DUPLICATE_DECISION','A proposal cannot be both accepted and rejected.');
  const byId=new Map(returned.changes.map(change=>[change.id,change]));
  if(chosen.some(id=>!byId.has(id)))fail('CHANGE_NOT_FOUND','A selected analyst proposal does not exist.',404);
  const already=new Set(previousDecisions.filter(d=>d.returnId===returned.id).flatMap(d=>[...d.accept,...d.reject]));
  if(chosen.some(id=>already.has(id)))fail('PROPOSAL_ALREADY_REVIEWED','A selected proposal already has a saved review decision.',409);
  const rows=current.rows.map(copy),byKey=new Map(rows.map(row=>[row.key,row])),conflicts=[];
  for(const id of accept){
    const change=byId.get(id),row=byKey.get(change.key);
    if(!row||row.sourceSha256!==change.sourceSha256){conflicts.push({changeId:id,key:change.key,code:'SOURCE_VERSION_CHANGED',currentSourceSha256:row?.sourceSha256??null,expectedSourceSha256:change.sourceSha256});continue;}
    for(const field of change.fields){
      const currentValue=field==='geometry'?row.geometry:row.operator[field.slice(9)],before=field==='geometry'?change.before.geometry:change.before.operator[field.slice(9)],after=field==='geometry'?change.after.geometry:change.after.operator[field.slice(9)];
      if(!equal(currentValue,before)&&!equal(currentValue,after))conflicts.push({changeId:id,key:change.key,code:'ANALYST_FIELD_CHANGED',field,before,current:copy(currentValue),proposed:copy(after)});
    }
  }
  if(conflicts.length)fail('DECISION_CONFLICT','Some proposals differ from the selected current source or analyst fields.',409,{conflicts,currentHandoffId:current.id});
  const decisionId=text(identity.id,'Decision identity',120),newHandoffId=entityId('handoff',{decisionId});
  for(const id of accept){
    const change=byId.get(id),row=byKey.get(change.key);
    for(const field of change.fields){if(field==='geometry'){row.geometry=copy(change.after.geometry);row.geometryOrigin=equal(row.geometry,row.originalGeometry)?'source':'analyst';}else row.operator[field.slice(9)]=change.after.operator[field.slice(9)];}
    row.lastDecisionId=decisionId;
  }
  const handoff=seal({...copy(current),id:newHandoffId,edition:current.edition+1,predecessorId:current.id,createdAt:instant(identity.createdAt,'Decision time'),
    rows,counts:rowCounts(rows),decisionHistory:[...current.decisionHistory,decisionId],creation:{kind:'decision',decisionId}});
  const decision=seal({schema:DECISION_SCHEMA,id:decisionId,returnId:returned.id,returnSha256:returned.sha256,handoffId:current.id,handoffSha256:current.sha256,
    baseHandoffId:base.id,newHandoffId,newHandoffSha256:handoff.sha256,reviewer,note,accept,reject,createdAt:identity.createdAt});
  return {decision,handoff};
}
export function decisionSummary(value){return {id:value.id,returnId:value.returnId,handoffId:value.handoffId,newHandoffId:value.newHandoffId,reviewer:value.reviewer,note:value.note,accepted:value.accept.length,rejected:value.reject.length,accept:copy(value.accept),reject:copy(value.reject),createdAt:value.createdAt};}
export const DISPATCH_FIELDS=Object.freeze(['key','serviceRequestId','sourceKey','sourceId','sourceSha256','captureId','collectionId','sourceStatus','sourceStatusNotes','sourceClosedAt','serviceCode','serviceName','description','address','agency','requestedAt','updatedAt','observedAt','longitude','latitude',...OPERATOR_FIELDS]);
export const DEFAULT_DISPATCH_COLUMNS=Object.freeze([
  {name:'service_request_id',field:'serviceRequestId'},{name:'source_status',field:'sourceStatus'},{name:'service_code',field:'serviceCode'},
  {name:'service_name',field:'serviceName'},{name:'description',field:'description'},{name:'address',field:'address'},{name:'agency',field:'agency'},
  {name:'longitude',field:'longitude'},{name:'latitude',field:'latitude'},
  ...Object.entries({assigned_team:'assignedTeam',asset_id:'assetId',work_order_id:'workOrderId',priority:'priority',action:'action',due_date:'dueDate',analyst_note:'note'}).map(([name,field])=>({name,field})),
  {name:'source_status_notes',field:'sourceStatusNotes'},{name:'source_closed_at',field:'sourceClosedAt'}
]);
export function createDispatch(handoff,input,identity){
  verifySeal(handoff,HANDOFF_SCHEMA);object(input,'Dispatch definition');
  if(input.handoffId!==handoff.id)fail('DISPATCH_HANDOFF_MISMATCH','Choose one retained handoff edition.');
  const name=text(input.name,'Dispatch name',200),destination=text(input.destination,'Destination',500),note=text(input.note??'','Dispatch note',20000,{empty:true});
  const available=handoff.rows.filter(row=>row.operator.action==='dispatch'&&row.lastDecisionId),ready=new Map(available.map(row=>[row.key,row]));
  const keys=input.keys===undefined?available.map(row=>row.key):uniqueStrings(input.keys,'Dispatch features');
  if(keys.some(key=>!ready.has(key)))fail('DISPATCH_REVIEW_REQUIRED','Each selected row must have an accepted analyst decision and action dispatch.');
  const columns=copy(input.columns??DEFAULT_DISPATCH_COLUMNS);
  if(!Array.isArray(columns)||columns.length>100||columns.some(c=>!c||typeof c.name!=='string'||!c.name.trim()||c.name.length>100||/[\0\r\n]/.test(c.name)||!DISPATCH_FIELDS.includes(c.field)))fail('INVALID_DISPATCH_COLUMNS','Use distinct named columns mapped to supported source or analyst fields.',400,{fields:DISPATCH_FIELDS});
  const names=['feature_key','source_sha256','handoff_id','handoff_sha256','open311_csv_encoding',...columns.map(c=>c.name)];
  if(new Set(names).size!==names.length)fail('DUPLICATE_DISPATCH_COLUMN','Column names must be distinct; the four identity columns and CSV encoding column are retained automatically.');
  const rows=keys.map(key=>copy(ready.get(key))).sort((a,b)=>a.key.localeCompare(b.key)),counts=rowCounts(rows);
  return seal({schema:DISPATCH_SCHEMA,id:text(identity.id,'Dispatch identity',120),name,handoffId:handoff.id,handoffSha256:handoff.sha256,destination,
    createdAt:instant(identity.createdAt,'Dispatch time'),definition:{name,handoffId:handoff.id,destination,note,keys,columns},rows,coverage:copy(handoff.coverage),
    decisionIds:[...new Set(rows.map(row=>row.lastDecisionId))].sort(),counts:{rows:counts.rows,located:counts.located,unlocated:counts.unlocated}});
}
export function dispatchSummary(value){return {id:value.id,name:value.name,handoffId:value.handoffId,destination:value.destination,sha256:value.sha256,createdAt:value.createdAt,counts:copy(value.counts)};}
