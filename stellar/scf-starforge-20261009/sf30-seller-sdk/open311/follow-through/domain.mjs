// MIT. Source-linked municipal service and work-order follow-through.
import { canonical, copy, digest, fail, object, text, instant, equal, entityId, seal, verifySeal, uniqueStrings, parseJson } from '../gis/shared.mjs';
import { originalRows } from './source.mjs';

export const PROFILE_SCHEMA='commons.open311.follow-through-profile.v1';
export const EDITION_SCHEMA='commons.open311.follow-through-edition.v1';
export const LINK_SCHEMA='commons.open311.follow-through-link.v1';
export const WORK_SCHEMA='commons.open311.follow-through-work.v1';
export const REVIEW_SCHEMA='commons.open311.follow-through-review.v1';
export const RETURN_SCHEMA='commons.open311.follow-through-return.v1';
export const DECISION_SCHEMA='commons.open311.follow-through-decision.v1';
export const DISPATCH_SCHEMA='commons.open311.follow-through-dispatch.v1';
export const WORK_STATUSES=['new','assigned','in_progress','done','dismissed'];
export const ACTIONS=['review','contact','inspect','create_work_order','update_work_order','reconcile','none'];
const PRIORITIES=['low','normal','high','urgent'],APPROVALS=['draft','approved','rejected'];
const nullField=value=>value===undefined||value===null||value===''?null:text(value,'Field name',200);
function choice(value,allowed,name){if(!allowed.includes(value))fail('INVALID_CHOICE',name+' must be one of '+allowed.join(', ')+'.');return value;}
function strings(value,name){return uniqueStrings(value??[],name,{max:1000});}
function values(value,name){if(!Array.isArray(value))fail('INVALID_VALUES',name+' must be an array of original JSON values.');return copy(value);}
function scalar(value){return value===null||['string','number','boolean'].includes(typeof value);}
function originalString(value){return value===null||value===undefined?'':typeof value==='string'?value:canonical(value);}
function coordinates(input={}){
  object(input,'Coordinate interpretation');const mode=choice(input.mode??'source',['source','wgs84','web-mercator','manual'],'Coordinate interpretation');
  const name=text(input.name??'','Interpretation name',300,{empty:true}),sourceReferences=strings(input.sourceReferences??[],'Interpretation references');
  if(mode!=='source'&&(!name.trim()||!sourceReferences.length))fail('COORDINATE_REFERENCE_REQUIRED','A coordinate interpretation needs a name and its operator or source reference.');
  const result={mode,name,sourceReferences};
  if(mode==='manual'){
    if(!validLonLat(input.longitude,input.latitude))fail('INVALID_COORDINATES','Manual location requires numeric longitude −180…180 and latitude −90…90.');
    result.longitude=input.longitude;result.latitude=input.latitude;
  }else if(input.longitude!==undefined||input.latitude!==undefined){result.longitude=null;result.latitude=null;}
  return result;
}
function roleProfile(input,name){
  object(input,name+' mapping');const idFields=uniqueStrings(input.idFields??[],name+' identity fields',{empty:name==='Order',max:16});
  const dates={};for(const [key,mapping]of Object.entries(input.dates??{})){
    if(!['createdAt','updatedAt','closedAt'].includes(key))fail('INVALID_DATE_MAPPING','Date mappings use createdAt, updatedAt or closedAt.');
    object(mapping,'Date field mapping');dates[key]={field:text(mapping.field,'Date field',200),format:choice(mapping.format,['epoch-ms','iso-offset','literal'],'Date format')};
  }
  const result={idFields,titleField:nullField(input.titleField),descriptionField:nullField(input.descriptionField),statusField:nullField(input.statusField),referenceFields:strings(input.referenceFields,name+' reference fields'),dates,coordinates:coordinates(input.coordinates??{})};
  if(name==='Request'){
    const need=input.workNeeded??{};result.workNeeded={field:nullField(need.field),neededValues:values(need.neededValues??[],'Work required values'),notNeededValues:values(need.notNeededValues??[],'Work not required values')};
    if(result.workNeeded.neededValues.some(v=>result.workNeeded.notNeededValues.some(w=>equal(v,w))))fail('WORK_NEEDED_MAPPING_CONFLICT','A source value cannot mean both work required and work not required.');
  }else result.costs=(input.costs??[]).map(item=>{object(item,'Order cost mapping');return {field:text(item.field,'Cost field',200),label:text(item.label??item.field,'Cost label',200),unit:item.unit===undefined||item.unit===null?null:text(item.unit,'Cost unit',100)};});
  if(result.coordinates.mode==='manual')fail('PROFILE_MANUAL_LOCATION','A manual point belongs to one source record; profile coordinate mappings apply to a complete role.');
  return result;
}
export function normalizeProfile(input){
  object(input,'Follow-through profile');text(input.id,'Profile ID',100);text(input.name,'Profile name',300);
  if(!Number.isSafeInteger(input.revision)||input.revision<1)fail('PROFILE_REVISION_REQUIRED','A profile revision is a positive integer.');
  const request=roleProfile(input.request,'Request'),order=roleProfile(input.order??{idFields:['WORKORDERID']},'Order');
  const joins=(input.joins??[]).map(join=>{object(join,'Relationship mapping');return {id:text(join.id,'Relationship rule ID',100),name:text(join.name,'Relationship name',300),requestField:text(join.requestField,'Request relationship field',200),orderField:text(join.orderField,'Order relationship field',200),normalization:choice(join.normalization??'exact',['exact','trim-text','fold-text'],'Relationship value normalization')};});
  if(new Set(joins.map(j=>j.id)).size!==joins.length)fail('DUPLICATE_JOIN_ID','Relationship rule IDs must be distinct.');
  const statuses={};for(const key of ['requestClosed','requestActive','orderClosed','orderActive'])statuses[key]=values(input.statuses?.[key]??[],key);
  for(const role of ['request','order'])if(statuses[role+'Closed'].some(v=>statuses[role+'Active'].some(w=>equal(v,w))))fail('STATUS_MAPPING_CONFLICT','An original '+role+' status cannot mean both active and closed.');
  const r=input.rules??{},rules={requireOrderWhenNeeded:r.requireOrderWhenNeeded??true,flagMultipleCandidates:r.flagMultipleCandidates??true,flagRequestClosedOrderActive:r.flagRequestClosedOrderActive??true,flagOrderClosedRequestActive:r.flagOrderClosedRequestActive??true,staleAfterDays:r.staleAfterDays??null};
  for(const key of Object.keys(rules).filter(k=>k!=='staleAfterDays'))if(typeof rules[key]!=='boolean')fail('INVALID_RULE',key+' must be true or false.');
  if(rules.staleAfterDays!==null&&(!Number.isFinite(rules.staleAfterDays)||rules.staleAfterDays<0))fail('INVALID_STALENESS','Stale-after days must be nonnegative or null.');
  return seal({schema:PROFILE_SCHEMA,id:input.id,key:input.id+'@'+input.revision,name:input.name,revision:input.revision,request,order,joins,statuses,rules,notes:text(input.notes??'','Profile notes',100000,{empty:true})});
}
export function validLonLat(x,y){return typeof x==='number'&&Number.isFinite(x)&&x>=-180&&x<=180&&typeof y==='number'&&Number.isFinite(y)&&y>=-90&&y<=90;}
function point(raw){
  const geometry=raw.geometry;if(!geometry)return null;
  if(geometry.type==='Point'&&Array.isArray(geometry.coordinates))return {x:geometry.coordinates[0],y:geometry.coordinates[1]};
  return Object.hasOwn(geometry,'x')&&Object.hasOwn(geometry,'y')?{x:geometry.x,y:geometry.y}:null;
}
export function coordinateFingerprint(row){return digest({geometry:row.originalGeometry??null,spatialReference:row.spatialReference??null});}
export function locate(row,interpretation={mode:'source',name:'',sourceReferences:[]}){
  const value=coordinates(interpretation),raw=point({geometry:row.originalGeometry??row.geometry}),sr=row.spatialReference??row.originalGeometry?.spatialReference??null;
  let x=null,y=null,reason=null;
  if(value.mode==='manual'){x=value.longitude;y=value.latitude;}
  else if(!raw)reason='The original record has no point geometry.';
  else if(typeof raw.x!=='number'||typeof raw.y!=='number'||!Number.isFinite(raw.x)||!Number.isFinite(raw.y))reason='The original point has nonnumeric or nonfinite coordinates.';
  else if(value.mode==='web-mercator'){
    const max=20037508.342789244;
    if(Math.abs(raw.x)>max||Math.abs(raw.y)>max)reason='The point is outside the configured Web Mercator bounds.';
    else{x=raw.x/6378137*180/Math.PI;y=(2*Math.atan(Math.exp(raw.y/6378137))-Math.PI/2)*180/Math.PI;}
  }else if(value.mode==='wgs84'){x=raw.x;y=raw.y;}
  else if([4326].includes(sr?.latestWkid??sr?.wkid)||sr?.source==='RFC7946'){x=raw.x;y=raw.y;}
  else reason='The original reference is not a declared WGS84 point. Choose a named interpretation.';
  if(reason===null&&!validLonLat(x,y))reason='The original coordinates do not fit WGS84 longitude and latitude bounds.';
  return {geometry:reason===null?{type:'Point',coordinates:[x,y]}:null,interpretation:copy(value),coordinateSha256:coordinateFingerprint(row),reason};
}
function mappedDate(attributes,mapping){
  const sourceValue=Object.hasOwn(attributes,mapping.field)?copy(attributes[mapping.field]):null;let parsed=null;
  if(sourceValue!==null&&sourceValue!==''&&mapping.format!=='literal'){
    if(mapping.format==='epoch-ms'){const numeric=typeof sourceValue==='number'?sourceValue:typeof sourceValue==='string'&&/^[+-]?\d+(?:\.\d+)?$/.test(sourceValue)?Number(sourceValue):null;if(numeric!==null&&Number.isFinite(numeric)&&Math.abs(numeric)<=8640000000000000)parsed=new Date(numeric).toISOString();}
    if(mapping.format==='iso-offset'&&typeof sourceValue==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(sourceValue)&&Number.isFinite(Date.parse(sourceValue)))parsed=new Date(sourceValue).toISOString();
  }
  return {field:mapping.field,format:mapping.format,sourceValue,instant:parsed};
}
function hasOriginal(values,value){return values.some(v=>equal(v,value));}
function normalizedRows(source,mapping,role){
  if(source.state!=='ready')fail('SOURCE_ERROR_SELECTED','Choose a successful original dataset; this source retains an error response.',400,{sourceId:source.id,error:source.error});
  const grouped=new Map();
  for(const raw of originalRows(source)){
    const attributes=raw.attributes,identityValues=mapping.idFields.map(field=>Object.hasOwn(attributes,field)?attributes[field]:null),identityValid=identityValues.every(value=>scalar(value)&&value!==null&&value!=='');
    const key=entityId(role,identityValid?{seriesId:source.seriesId,idFields:mapping.idFields,values:identityValues}:{sourceId:source.id,index:raw.index,sourceSha256:raw.sourceSha256});
    const dates=Object.fromEntries(Object.entries(mapping.dates).map(([name,date])=>[name,mappedDate(attributes,date)]));
    const locationBase={originalGeometry:raw.geometry,spatialReference:raw.spatialReference},location=locate(locationBase,mapping.coordinates);
    const issues=[];
    if(!identityValid)issues.push({code:'MISSING_SOURCE_ID',label:'Missing mapped source identity',detail:'One or more selected business identity fields are null, empty or not scalar.'});
    for(const [name,date]of Object.entries(dates))if(date.sourceValue!==null&&date.sourceValue!==''&&date.format!=='literal'&&date.instant===null)issues.push({code:'INVALID_SOURCE_DATE',label:'Unparsed '+name,detail:'The source value in '+date.field+' does not match '+date.format+'.'});
    if(location.geometry===null)issues.push({code:'UNLOCATED_SOURCE',label:'Location needs interpretation',detail:location.reason});
    const common={key,sourceSha256:raw.sourceSha256,sourceId:source.id,sourceSeriesId:source.seriesId,captureId:raw.captureId,sourceIndex:raw.index,identityValues:copy(identityValues),identityValid,
      title:originalString(mapping.titleField?attributes[mapping.titleField]:identityValues.length===1?identityValues[0]:identityValues),
      description:originalString(mapping.descriptionField?attributes[mapping.descriptionField]:null),
      sourceStatus:mapping.statusField?(attributes[mapping.statusField]??null):null,
      referenceValues:Object.fromEntries(mapping.referenceFields.map(field=>[field,copy(attributes[field]??null)])),
      dates,createdAt:dates.createdAt?.instant??null,updatedAt:dates.updatedAt?.instant??null,closedAt:dates.closedAt?.instant??null,
      geometry:location.geometry,location,originalGeometry:copy(raw.geometry),spatialReference:copy(raw.spatialReference),source:copy(attributes),original:copy(raw.original),issues};
    if(role==='request'){
      common.serviceRequestId=identityValues.length===1?originalString(identityValues[0]):canonical(identityValues);
      const needed=mapping.workNeeded,value=needed.field?(attributes[needed.field]??null):null;
      common.workNeeded=needed.field&&hasOriginal(needed.neededValues,value)?'needed':needed.field&&hasOriginal(needed.notNeededValues,value)?'not_needed':'unknown';
    }else{
      common.workOrderId=identityValues.length===1?originalString(identityValues[0]):canonical(identityValues);
      common.costs=mapping.costs.map(cost=>({...copy(cost),value:copy(attributes[cost.field]??null)}));
    }
    const previous=grouped.get(key),occurrence={index:raw.index,captureId:raw.captureId,sourceSha256:raw.sourceSha256};
    if(previous){
      const versions=previous.versions,version=versions.find(v=>v.sourceSha256===raw.sourceSha256);
      if(version)version.occurrences.push(occurrence);else versions.push({sourceSha256:raw.sourceSha256,source:copy(attributes),original:copy(raw.original),occurrences:[occurrence]});
      common.versions=versions;if(versions.length>1)common.issues.push({code:'MULTIPLE_SOURCE_EDITIONS',label:'Multiple original versions in this source',detail:'The last selected original occurrence is displayed; every different source version and occurrence is retained.'});
    }else common.versions=[{sourceSha256:raw.sourceSha256,source:copy(attributes),original:copy(raw.original),occurrences:[occurrence]}];
    grouped.set(key,common);
  }
  return [...grouped.values()];
}
export function normalizeDefinition(input){
  object(input,'Follow-through edition');return {name:text(input.name,'Edition name',300),seriesId:text(input.seriesId,'Follow-through series ID',200),profileId:text(input.profileId,'Profile revision',150),
    requestSourceId:text(input.requestSourceId,'Request source ID',120),orderSourceId:input.orderSourceId===undefined||input.orderSourceId===null||input.orderSourceId===''?null:text(input.orderSourceId,'Work-order source ID',120),asOf:instant(input.asOf,'Follow-through as-of time'),commentary:text(input.commentary??'','Edition commentary',100000,{empty:true})};
}
function joinToken(value,mode){if(value===null||value===undefined||value==='')return null;if(mode==='exact')return canonical(value);if(typeof value!=='string')return null;const str=value.trim();if(!str)return null;return mode==='fold-text'?str.toLocaleLowerCase('en-US'):str;}
function mappedFieldsExist(source,mapping,extra=[]){
  const available=new Set(source.fields.map(field=>field.name));
  if(!available.size&&!source.rows)return;
  const requested=[...mapping.idFields,...mapping.referenceFields,...Object.values(mapping.dates).map(date=>date.field),mapping.titleField,mapping.descriptionField,mapping.statusField,mapping.workNeeded?.field,...(mapping.costs??[]).map(cost=>cost.field),...extra].filter(Boolean);
  const missing=[...new Set(requested.filter(field=>!available.has(field)))];
  if(missing.length)fail('MAPPED_SOURCE_FIELDS_MISSING','A selected field mapping is absent from the original source schema.',400,{sourceId:source.id,fields:missing});
}
export function buildEdition(input,requestSource,orderSource,profile,identity){
  const definition=normalizeDefinition(input);
  if(requestSource.id!==definition.requestSourceId||requestSource.role!=='requests')fail('REQUEST_SOURCE_REQUIRED','Choose an original source saved as requests.');
  if(definition.orderSourceId!==null&&(!orderSource||orderSource.id!==definition.orderSourceId||orderSource.role!=='orders'))fail('ORDER_SOURCE_REQUIRED','Choose an original source saved as work orders.');
  if(profile.key!==definition.profileId)fail('PROFILE_REVISION_MISMATCH','The selected saved profile revision differs.');
  if(orderSource&&!profile.order.idFields.length)fail('ORDER_ID_MAPPING_REQUIRED','Map the original work-order identity fields before selecting an order source.');
  mappedFieldsExist(requestSource,profile.request,profile.joins.map(join=>join.requestField));if(orderSource)mappedFieldsExist(orderSource,profile.order,profile.joins.map(join=>join.orderField));
  const requests=normalizedRows(requestSource,profile.request,'request'),orders=orderSource?normalizedRows(orderSource,profile.order,'order'):[];
  const ordersByKey=new Map(orders.map(order=>[order.key,order]));
  const indexes=profile.joins.map(join=>{const byValue=new Map();for(const order of orders){const value=joinToken(order.source[join.orderField],join.normalization);if(value===null)continue;const list=byValue.get(value)??[];list.push(order.key);byValue.set(value,list);}return {join,byValue};});
  const candidateLinks=[];
  for(const request of requests){
    const candidates=new Map();
    for(const {join,byValue}of indexes){const token=joinToken(request.source[join.requestField],join.normalization);if(token===null)continue;
      for(const orderKey of byValue.get(token)??[]){const matches=candidates.get(orderKey)??[];matches.push({joinId:join.id,name:join.name,requestField:join.requestField,orderField:join.orderField,requestValue:copy(request.source[join.requestField]??null),orderValue:copy(ordersByKey.get(orderKey).source[join.orderField]??null)});candidates.set(orderKey,matches);}
    }
    candidateLinks.push({key:request.key,candidates:[...candidates].map(([orderKey,matches])=>({orderKey,matches}))});
  }
  const coverage={requestSource:copy(requestSource.coverage),orderSource:orderSource?copy(orderSource.coverage):null,orderSourceSelected:!!orderSource,requestSourceId:requestSource.id,orderSourceId:orderSource?.id??null,
    relationshipBasis:profile.joins.length?'Named explicit field mappings produce review candidates.':'No automatic relationship mapping is configured. Use manual order selection and review.',
    populationDescription:'Selected original request and work-order editions at their separate capture times; this is not an atomic cross-system snapshot.',
    selectionTime:definition.asOf,sourceTimes:{requests:requestSource.observedAt,orders:orderSource?.observedAt??null}};
  return seal({schema:EDITION_SCHEMA,id:identity.id,name:definition.name,seriesId:definition.seriesId,definition,profileId:profile.key,profileSha256:profile.sha256,requestSourceId:requestSource.id,orderSourceId:orderSource?.id??null,asOf:definition.asOf,createdAt:identity.createdAt,
    requests,orders,candidateLinks,coverage,totals:{requests:requests.length,orders:orders.length,candidates:candidateLinks.reduce((n,r)=>n+r.candidates.length,0),unlocatedRequests:requests.filter(r=>!r.geometry).length,ambiguousRequestVersions:requests.filter(r=>r.versions.length>1).length}});
}
export function editionSummary(value){return {id:value.id,name:value.name,seriesId:value.seriesId,profileId:value.profileId,requestSourceId:value.requestSourceId,orderSourceId:value.orderSourceId,asOf:value.asOf,rows:value.requests.length,totals:copy(value.totals),createdAt:value.createdAt,sha256:value.sha256};}
const editionIndexes=new WeakMap();
function editionIndex(edition){
  let index=editionIndexes.get(edition);
  if(!index){index={requests:new Map(edition.requests.map(row=>[row.key,row])),orders:new Map(edition.orders.map(row=>[row.key,row])),candidates:new Map(edition.candidateLinks.map(row=>[row.key,row.candidates]))};editionIndexes.set(edition,index);}
  return index;
}
export function requestRow(edition,key){const row=editionIndex(edition).requests.get(key);if(!row)fail('REQUEST_NOT_FOUND','The selected request is absent from this saved edition.',404,{key,editionId:edition.id});return row;}
export function orderRow(edition,key){const row=editionIndex(edition).orders.get(key);if(!row)fail('ORDER_NOT_FOUND','The selected order is absent from this saved edition.',404,{key,editionId:edition.id});return row;}
export function createLink(edition,input,identity){
  object(input,'Relationship decision');const request=requestRow(edition,input.key),order=orderRow(edition,input.orderKey);
  if(input.editionId!==edition.id||input.sourceSha256!==request.sourceSha256||input.orderSha256!==order.sourceSha256)fail('SOURCE_VERSION_CHANGED','Select the exact saved request and order versions for this relationship decision.',409);
  return seal({schema:LINK_SCHEMA,id:identity.id,seriesId:edition.seriesId,editionId:edition.id,key:request.key,sourceSha256:request.sourceSha256,orderKey:order.key,orderSha256:order.sourceSha256,
    decision:choice(input.decision,['confirm','reject'],'Relationship decision'),reviewer:text(input.reviewer,'Relationship reviewer',200),note:text(input.note??'','Relationship note',100000,{empty:true}),createdAt:identity.createdAt});
}
function lastBy(items,key){const map=new Map();for(const value of items)map.set(key(value),value);return map;}
export function effectiveLinks(edition,request,links){
  const current=[...lastBy(links.filter(link=>link.seriesId===edition.seriesId&&link.key===request.key),link=>link.orderKey).values()];
  return current.map(link=>{const order=editionIndex(edition).orders.get(link.orderKey)??null;return {...copy(link),sourceChanged:link.sourceSha256!==request.sourceSha256||!order||link.orderSha256!==order.sourceSha256,order};});
}
export function currentWork(edition,key,work){
  for(let i=work.length-1;i>=0;i--)if(work[i].seriesId===edition.seriesId&&work[i].key===key)return work[i];return null;
}
export function normalizeWorkInput(input){
  object(input,'Follow-up work');const value={editionId:text(input.editionId,'Edition ID',120),key:text(input.key,'Request key',120),sourceSha256:text(input.sourceSha256,'Original request SHA-256',64),
    status:choice(input.status??'new',WORK_STATUSES,'Work status'),assignee:text(input.assignee??'','Assignee',300,{empty:true}),priority:choice(input.priority??'normal',PRIORITIES,'Priority'),dueAt:input.dueAt===undefined||input.dueAt===null||input.dueAt===''?null:instant(input.dueAt,'Follow-up due time'),
    note:text(input.note??'','Work note',100000,{empty:true}),action:choice(input.action??'review',ACTIONS,'Follow-up action'),actionNote:text(input.actionNote??'','Action note',100000,{empty:true}),
    targetOrderKeys:uniqueStrings(input.targetOrderKeys??[],'Selected related order keys'),approval:choice(input.approval??'draft',APPROVALS,'Action approval'),reviewer:text(input.reviewer??'','Action reviewer',200,{empty:true}),location:coordinates(input.location??{})};
  if(value.approval!=='draft'&&!value.reviewer.trim())fail('ACTION_REVIEWER_REQUIRED','An approved or rejected action needs its named reviewer.');
  return value;
}
export function createWork(edition,input,identity,{previous=null,links=[]}={}){
  const value=normalizeWorkInput(input),request=requestRow(edition,value.key);
  if(value.editionId!==edition.id||value.sourceSha256!==request.sourceSha256)fail('SOURCE_VERSION_CHANGED','Choose the exact source request version before saving work.',409);
  for(const key of value.targetOrderKeys)orderRow(edition,key);
  const approvedRelations=effectiveLinks(edition,request,links).filter(link=>link.decision==='confirm'&&!link.sourceChanged);
  if(value.approval==='approved'){
    if(!request.identityValid)fail('SOURCE_ID_REQUIRED','Map the original business request identity before approving dispatch.');
    if(value.action==='none')fail('ACTION_REQUIRED','Select an action before approving it.');
    if(value.action==='update_work_order'&&!value.targetOrderKeys.length)fail('TARGET_ORDER_REQUIRED','An approved work-order update needs at least one selected related order.');
    for(const key of value.targetOrderKeys)if(!approvedRelations.some(link=>link.orderKey===key))fail('RELATIONSHIP_REVIEW_REQUIRED','Confirm each selected request/order relationship at these exact source versions before approving its action.',409,{orderKey:key});
  }
  const location=locate(request,value.location.mode==='source'?request.location.interpretation:value.location);
  return seal({schema:WORK_SCHEMA,id:identity.id,seriesId:edition.seriesId,...value,previousWorkId:previous?.id??null,createdAt:identity.createdAt,
    serviceRequestId:request.serviceRequestId,title:request.title,profileId:edition.profileId,locationApplied:copy(location.interpretation),coordinateSha256:coordinateFingerprint(request),locatedGeometry:location.geometry,locationReason:location.reason,targetOrders:value.targetOrderKeys.map(key=>{const order=orderRow(edition,key);return {key,sourceSha256:order.sourceSha256,workOrderId:order.workOrderId};}),
    approvalSource:{editionId:edition.id,sourceSha256:request.sourceSha256,orderVersions:value.targetOrderKeys.map(key=>({key,sourceSha256:orderRow(edition,key).sourceSha256}))}});
}
export function workView(value,request,edition){
  if(!value)return null;const sourceChanged=value.sourceSha256!==request.sourceSha256;
  const orderChanged=value.targetOrders.some(target=>editionIndex(edition).orders.get(target.key)?.sourceSha256!==target.sourceSha256);
  const coordinateChanged=value.coordinateSha256!==coordinateFingerprint(request);
  const geometry=coordinateChanged?request.geometry:value.locatedGeometry;
  return {...copy(value),sourceChanged,orderChanged,coordinateChanged,geometry,approvalCurrent:value.approval==='approved'&&!sourceChanged&&!orderChanged};
}
export function projectRequest(edition,profile,request,{links=[],work=[]}={}){
  const candidates=editionIndex(edition).candidates.get(request.key)??[],related=effectiveLinks(edition,request,links),confirmed=related.filter(link=>link.decision==='confirm'&&!link.sourceChanged);
  const current=workView(currentWork(edition,request.key,work),request,edition),discrepancies=copy(request.issues),add=(code,label,detail)=>discrepancies.push({code,label,detail});
  if(!edition.orderSourceId)add('ORDER_SOURCE_UNAVAILABLE','No work-order source selected','Request-only follow-through is available; work-order absence and disposition cannot be determined.');
  else{
    if(profile.rules.requireOrderWhenNeeded&&request.workNeeded==='needed'&&!confirmed.length)add(candidates.length?'RELATIONSHIP_UNREVIEWED':'WORK_ORDER_NOT_LINKED',candidates.length?'Relationship needs review':'Work order needs linking','The source says work is needed; there is no current confirmed relationship in these selected source editions.');
    if(profile.rules.flagMultipleCandidates&&candidates.length>1)add('MULTIPLE_ORDER_CANDIDATES','Multiple candidate orders',candidates.length+' orders match the explicit field mappings.');
    const requestClosed=hasOriginal(profile.statuses.requestClosed,request.sourceStatus),requestActive=hasOriginal(profile.statuses.requestActive,request.sourceStatus);
    if(profile.rules.flagRequestClosedOrderActive&&requestClosed&&confirmed.some(link=>hasOriginal(profile.statuses.orderActive,link.order.sourceStatus)))add('REQUEST_CLOSED_ORDER_ACTIVE','Closed request with active order','The exact source statuses map to a closed request and active confirmed order.');
    if(profile.rules.flagOrderClosedRequestActive&&requestActive&&confirmed.some(link=>hasOriginal(profile.statuses.orderClosed,link.order.sourceStatus)))add('ORDER_CLOSED_REQUEST_ACTIVE','Closed order with active request','The exact source statuses map to a closed confirmed order and active request.');
  }
  if(related.some(link=>link.sourceChanged))add('LINK_SOURCE_CHANGED','Reviewed relationship has changed source','A retained relationship decision refers to an older or absent source version.');
  if(current?.sourceChanged||current?.orderChanged)add('WORK_SOURCE_CHANGED','Saved work refers to a changed source','Review the current original editions before dispatching a previously approved action.');
  if(current?.coordinateChanged&&current.location.mode!=='source')add('LOCATION_SOURCE_CHANGED','Original point changed','The previous location interpretation remains in history; the changed original point needs a fresh decision.');
  const ageOrigin=request.updatedAt??request.createdAt;if(profile.rules.staleAfterDays!==null&&ageOrigin&&!hasOriginal(profile.statuses.requestClosed,request.sourceStatus)&&Date.parse(edition.asOf)-Date.parse(ageOrigin)>profile.rules.staleAfterDays*86400000)add('SOURCE_STALE','Source record exceeds chosen age','The selected source time is older than the operator profile threshold.');
  if(current?.dueAt&&!['done','dismissed'].includes(current.status)&&Date.parse(current.dueAt)<Date.parse(edition.asOf))add('FOLLOW_UP_OVERDUE','Follow-up is overdue','The assigned internal due time is before this edition’s as-of time.');
  return {...request,geometry:current?current.geometry:request.geometry,candidateCount:candidates.length,linkCount:confirmed.length,discrepancies,work:current};
}
export function compareEditions(before,after,{entity='requests',sourceMetadataFields=[]}={}){
  choice(entity,['requests','orders'],'Compared source records');
  const previous=new Map(before[entity].map(r=>[r.key,r])),current=new Map(after[entity].map(r=>[r.key,r])),items=[],summary={added:0,changed:0,notObserved:0,unchanged:0,sourceMetadataOnly:0},metadataFields=new Set(sourceMetadataFields);
  if(before.seriesId!==after.seriesId)fail('EDITION_SERIES_MISMATCH','Compare editions of the same follow-through series.');
  const display=row=>entity==='requests'?{serviceRequestId:row.serviceRequestId}:{workOrderId:row.workOrderId};
  for(const row of after[entity]){
    const prior=previous.get(row.key);
    if(!prior){summary.added++;items.push({entity,key:row.key,...display(row),kind:'added',before:null,after:row,fields:[],sourceMetadataOnly:false});}
    else if(prior.sourceSha256!==row.sourceSha256){
      summary.changed++;const names=new Set([...Object.keys(prior.source),...Object.keys(row.source)]);
      const fields=[...names].filter(name=>Object.hasOwn(prior.source,name)!==Object.hasOwn(row.source,name)||!equal(prior.source[name]??null,row.source[name]??null));
      if(!equal(prior.originalGeometry,row.originalGeometry)||!equal(prior.spatialReference,row.spatialReference))fields.push('$geometry');
      const sourceMetadataOnly=fields.length>0&&fields.every(name=>metadataFields.has(name));
      if(sourceMetadataOnly)summary.sourceMetadataOnly++;
      items.push({entity,key:row.key,...display(row),kind:'changed',before:prior,after:row,fields,sourceMetadataOnly});
    }else summary.unchanged++;
  }
  for(const row of before[entity])if(!current.has(row.key)){summary.notObserved++;items.push({entity,key:row.key,...display(row),kind:'not_observed',before:row,after:null,fields:[],sourceMetadataOnly:false});}
  return {entity,items,summary,before:editionSummary(before),after:editionSummary(after),scope:{before:before.coverage,after:after.coverage,sourceMetadataFields:[...metadataFields],meaning:'Not observed in the selected later files; no global deletion or completion is inferred. Original source-generated identity metadata changes remain visible separately from mapped business facts.'}};
}
const WORK_EDIT_FIELDS=['status','assignee','priority','dueAt','note','action','actionNote','targetOrderKeys','approval','reviewer','location'];
export function workEditable(work){return Object.fromEntries(WORK_EDIT_FIELDS.map(key=>[key,copy(work[key])]));}
function defaultWork(edition,row){return normalizeWorkInput({editionId:edition.id,key:row.key,sourceSha256:row.sourceSha256});}
export function reviewTemplate(edition,profile,{links=[],work=[]}={}){
  const workByKey=lastBy(work.filter(value=>value.seriesId===edition.seriesId),value=>value.key),linksByKey=new Map();
  for(const link of links)if(link.seriesId===edition.seriesId){const items=linksByKey.get(link.key)??[];items.push(link);linksByKey.set(link.key,items);}
  const index=editionIndex(edition);
  return {schema:REVIEW_SCHEMA,name:edition.name+' follow-through review',baseEditionId:edition.id,baseEditionSha256:edition.sha256,reviewer:'',notes:'',
    work:edition.requests.map(row=>{const current=workByKey.get(row.key)??null,before=workEditable(current??defaultWork(edition,row));return {key:row.key,serviceRequestId:row.serviceRequestId,sourceSha256:row.sourceSha256,beforeWorkId:current?.id??null,before,after:copy(before)};}),
    links:edition.requests.flatMap(row=>{const decisions=effectiveLinks(edition,row,linksByKey.get(row.key)??[]);const candidates=index.candidates.get(row.key)??[];const selected=[...new Set([...candidates.map(c=>c.orderKey),...decisions.map(d=>d.orderKey)])].filter(key=>index.orders.has(key));return selected.map(orderKey=>({orderKey})).map(candidate=>{const order=orderRow(edition,candidate.orderKey),prior=decisions.find(d=>d.orderKey===order.key);const before=prior?{decision:prior.decision,reviewer:prior.reviewer,note:prior.note}:null;return {key:row.key,sourceSha256:row.sourceSha256,orderKey:order.key,orderSha256:order.sourceSha256,beforeLinkId:prior?.id??null,before,after:before?copy(before):null};});})};
}
export function createReturn(originalText,base,profile,baseContext,identity){
  const input=parseJson(originalText,'Reviewer file');object(input,'Reviewer file');canonical(input);
  if(input.schema!==REVIEW_SCHEMA||input.baseEditionId!==base.id||input.baseEditionSha256!==base.sha256)fail('REVIEW_BASE_MISMATCH','The reviewer file must name the exact original saved edition.',409);
  text(input.reviewer??'','Reviewer name',200,{empty:true});
  if(!Array.isArray(input.work)||!Array.isArray(input.links))fail('REVIEW_ROWS_REQUIRED','The complete reviewer file needs work and links arrays.');
  const proposals=[],seen=new Set();let unchanged=0;
  for(const item of input.work){
    object(item,'Reviewer work row');const row=requestRow(base,item.key),token='work:'+item.key;if(seen.has(token))fail('DUPLICATE_REVIEW_ROW','The reviewer file repeats a request work row.');seen.add(token);
    if(item.sourceSha256!==row.sourceSha256)fail('REVIEW_SOURCE_MISMATCH','A reviewer work row changed its original source identity.');
    const prior=item.beforeWorkId?baseContext.work.find(w=>w.id===item.beforeWorkId):null;
    if(item.beforeWorkId&&(!prior||prior.seriesId!==base.seriesId||prior.key!==row.key))fail('REVIEW_WORK_BASE_MISMATCH','An original saved work predecessor is missing.');
    const expected=workEditable(prior??defaultWork(base,row));if(!equal(expected,item.before))fail('REVIEW_BASE_CHANGED','The reviewer file altered its original work preimage.');
    const after=workEditable(normalizeWorkInput({...item.after,editionId:base.id,key:row.key,sourceSha256:row.sourceSha256}));
    if(equal(expected,after)){unchanged++;continue;}
    proposals.push({id:entityId('proposal',{returnId:identity.id,kind:'work',key:row.key}),kind:'work',key:row.key,sourceSha256:row.sourceSha256,beforeWorkId:item.beforeWorkId??null,before:expected,after,conflicts:[],status:'pending'});
  }
  for(const item of input.links){
    object(item,'Reviewer relationship row');const row=requestRow(base,item.key),order=orderRow(base,item.orderKey),token='link:'+item.key+':'+item.orderKey;if(seen.has(token))fail('DUPLICATE_REVIEW_ROW','The reviewer file repeats a request/order relationship.');seen.add(token);
    if(item.sourceSha256!==row.sourceSha256||item.orderSha256!==order.sourceSha256)fail('REVIEW_SOURCE_MISMATCH','A reviewer relationship row changed its original source identities.');
    const prior=item.beforeLinkId?baseContext.links.find(l=>l.id===item.beforeLinkId):null;
    if(item.beforeLinkId&&(!prior||prior.seriesId!==base.seriesId||prior.key!==row.key||prior.orderKey!==order.key))fail('REVIEW_LINK_BASE_MISMATCH','An original relationship predecessor is missing.');
    const before=prior?{decision:prior.decision,reviewer:prior.reviewer,note:prior.note}:null;
    if(!equal(before,item.before))fail('REVIEW_BASE_CHANGED','The reviewer file altered its original relationship preimage.');
    let after=null;if(item.after!==null){const normalized=createLink(base,{...item.after,editionId:base.id,key:row.key,sourceSha256:row.sourceSha256,orderKey:order.key,orderSha256:order.sourceSha256},{id:'preview',createdAt:identity.createdAt});after={decision:normalized.decision,reviewer:normalized.reviewer,note:normalized.note};}
    if(equal(before,after)){unchanged++;continue;}if(after===null)fail('LINK_DECISION_REQUIRED','Reject a relationship explicitly; deletion is not a review decision.');
    proposals.push({id:entityId('proposal',{returnId:identity.id,kind:'link',key:row.key,orderKey:order.key}),kind:'link',key:row.key,sourceSha256:row.sourceSha256,orderKey:order.key,orderSha256:order.sourceSha256,beforeLinkId:item.beforeLinkId??null,before,after,conflicts:[],status:'pending'});
  }
  return seal({schema:RETURN_SCHEMA,id:identity.id,name:text(input.name??'Follow-through review','Reviewer file name',300),baseEditionId:base.id,baseEditionSha256:base.sha256,seriesId:base.seriesId,reviewer:input.reviewer??'',notes:text(input.notes??'','Reviewer notes',100000,{empty:true}),createdAt:identity.createdAt,
    originalText,originalFile:{bytes:Buffer.byteLength(originalText),sha256:digest(originalText)},unchanged,proposals});
}
export function proposalConflicts(proposal,edition,{links=[],work=[]}={}){
  const conflicts=[],row=edition.requests.find(r=>r.key===proposal.key);
  if(!row||row.sourceSha256!==proposal.sourceSha256)conflicts.push({code:'SOURCE_VERSION_CHANGED',message:'The original request version is absent or changed in the target edition.'});
  if(proposal.kind==='work'){
    const current=currentWork(edition,proposal.key,work);if((current?.id??null)!==proposal.beforeWorkId)conflicts.push({code:'WORK_PREIMAGE_CHANGED',message:'The current saved work changed after the reviewer file was prepared.',currentWorkId:current?.id??null});
  }else{
    const order=edition.orders.find(r=>r.key===proposal.orderKey);if(!order||order.sourceSha256!==proposal.orderSha256)conflicts.push({code:'ORDER_VERSION_CHANGED',message:'The selected original order version is absent or changed.'});
    const prior=[...links].reverse().find(l=>l.seriesId===edition.seriesId&&l.key===proposal.key&&l.orderKey===proposal.orderKey);
    if((prior?.id??null)!==proposal.beforeLinkId)conflicts.push({code:'LINK_PREIMAGE_CHANGED',message:'The relationship decision changed after the reviewer file was prepared.',currentLinkId:prior?.id??null});
  }return conflicts;
}
export function applyReview(returned,edition,input,identity,context){
  object(input,'Reviewer decision');if(input.returnId!==returned.id||input.targetEditionId!==edition.id||edition.seriesId!==returned.seriesId)fail('REVIEW_TARGET_MISMATCH','Choose an edition of the original follow-through series.');
  const accept=uniqueStrings(input.accept??[],'Accepted proposals'),reject=uniqueStrings(input.reject??[],'Rejected proposals');
  if(!accept.length&&!reject.length)fail('PROPOSAL_SELECTION_REQUIRED','Select at least one proposal to accept or reject.');
  if(accept.some(id=>reject.includes(id)))fail('PROPOSAL_SELECTION_CONFLICT','A proposal cannot be both accepted and rejected.');
  const reviewer=text(input.reviewer,'Decision reviewer',200),note=text(input.note??'','Decision note',100000,{empty:true}),priorDecisions=context.decisions??[];
  const resolved=new Set(priorDecisions.filter(d=>d.returnId===returned.id).flatMap(d=>[...d.accept,...d.reject]));
  for(const id of [...accept,...reject]){if(!returned.proposals.some(p=>p.id===id))fail('PROPOSAL_NOT_FOUND','A selected reviewer proposal was not found.',404);if(resolved.has(id))fail('PROPOSAL_ALREADY_DECIDED','This proposal already has a saved decision.',409,{proposalId:id});}
  const newLinks=[],newWork=[];
  const chosen=accept.map(id=>returned.proposals.find(p=>p.id===id)).sort((a,b)=>(a.kind==='link'?0:1)-(b.kind==='link'?0:1));
  for(const proposal of chosen){
    const conflicts=proposalConflicts(proposal,edition,{links:context.links,work:context.work});if(conflicts.length)fail('REVIEW_PREIMAGE_CONFLICT','The selected proposal conflicts with current original source or work.',409,{proposalId:proposal.id,conflicts});
    const childIdentity={id:entityId(proposal.kind,{decisionId:identity.id,proposalId:proposal.id}),createdAt:identity.createdAt};
    if(proposal.kind==='link')newLinks.push(createLink(edition,{...proposal.after,reviewer,editionId:edition.id,key:proposal.key,sourceSha256:proposal.sourceSha256,orderKey:proposal.orderKey,orderSha256:proposal.orderSha256},childIdentity));
    else newWork.push(createWork(edition,{...proposal.after,reviewer:proposal.after.approval==='draft'?proposal.after.reviewer:reviewer,editionId:edition.id,key:proposal.key,sourceSha256:proposal.sourceSha256},childIdentity,{previous:currentWork(edition,proposal.key,context.work),links:[...context.links,...newLinks]}));
  }
  return {decision:seal({schema:DECISION_SCHEMA,id:identity.id,returnId:returned.id,targetEditionId:edition.id,accept,reject,reviewer,note,createdAt:identity.createdAt,linkIds:newLinks.map(l=>l.id),workIds:newWork.map(w=>w.id)}),links:newLinks,work:newWork};
}
export function returnSummary(value,decisions=[]){const decided=new Set(decisions.filter(d=>d.returnId===value.id).flatMap(d=>[...d.accept,...d.reject]));return {id:value.id,name:value.name,baseEditionId:value.baseEditionId,seriesId:value.seriesId,reviewer:value.reviewer,createdAt:value.createdAt,proposals:value.proposals.length,pending:value.proposals.filter(p=>!decided.has(p.id)).length,unchanged:value.unchanged,sha256:value.sha256};}
export function workSummary(value){return {id:value.id,seriesId:value.seriesId,editionId:value.editionId,key:value.key,sourceSha256:value.sourceSha256,serviceRequestId:value.serviceRequestId,title:value.title,status:value.status,assignee:value.assignee,priority:value.priority,dueAt:value.dueAt,action:value.action,actionNote:value.actionNote,approval:value.approval,reviewer:value.reviewer,createdAt:value.createdAt,previousWorkId:value.previousWorkId};}
export const DEFAULT_DISPATCH_COLUMNS=[
  {name:'request_id',source:'request',field:'serviceRequestId'},{name:'request_status',source:'request',field:'sourceStatus'},
  {name:'request_description',source:'request',field:'description'},{name:'work_order_ids',source:'order',field:'workOrderId'},
  {name:'work_order_statuses',source:'order',field:'sourceStatus'},{name:'action',source:'work',field:'action'},
  {name:'action_note',source:'work',field:'actionNote'},{name:'assignee',source:'work',field:'assignee'},
  {name:'priority',source:'work',field:'priority'},{name:'due_at',source:'work',field:'dueAt'},
  {name:'reviewer',source:'work',field:'reviewer'},{name:'request_source_sha256',source:'request',field:'sourceSha256'}];
export function createDispatch(edition,input,identity,{links=[],work=[]}={}){
  object(input,'Reviewed dispatch');if(input.editionId!==edition.id)fail('DISPATCH_EDITION_MISMATCH','Choose the saved edition for this reviewed dispatch.');
  const workIds=uniqueStrings(input.workIds??[],'Approved work selection',{empty:false}),columns=(input.columns?.length?input.columns:DEFAULT_DISPATCH_COLUMNS).map(column=>{
    object(column,'Dispatch column');const name=text(column.name,'Column name',100);if(name==='open311_csv_encoding')fail('RESERVED_COLUMN','open311_csv_encoding is reserved for reversible CSV encoding.');
    return {name,source:choice(column.source,['request','order','work'],'Dispatch column source'),field:text(column.field,'Dispatch field',200)};
  });
  if(new Set(columns.map(c=>c.name)).size!==columns.length)fail('DUPLICATE_COLUMN','Dispatch column names must be distinct.');
  const rows=workIds.map(id=>{
    const saved=work.find(item=>item.id===id);if(!saved||saved.seriesId!==edition.seriesId)fail('WORK_NOT_FOUND','A selected work record is not in this follow-through series.',404,{workId:id});
    const request=requestRow(edition,saved.key),current=currentWork(edition,saved.key,work);
    if(current?.id!==saved.id)fail('WORK_EDITION_CHANGED','Select the current saved work for each request.',409,{workId:id,currentWorkId:current?.id??null});
    const viewed=workView(saved,request,edition);
    if(!viewed.approvalCurrent||saved.action==='none'||['done','dismissed'].includes(saved.status))fail('DISPATCH_APPROVAL_REQUIRED','Every selected action must be approved against the current request and order source versions.',409,{workId:id});
    const confirmed=effectiveLinks(edition,request,links).filter(link=>link.decision==='confirm'&&!link.sourceChanged);
    const orders=saved.targetOrderKeys.map(key=>{if(!confirmed.some(link=>link.orderKey===key))fail('RELATIONSHIP_REVIEW_REQUIRED','A selected relationship changed after action approval.',409,{orderKey:key});return copy(orderRow(edition,key));});
    const mapped=Object.fromEntries(columns.map(column=>{const field=column.field,read=row=>Object.hasOwn(row,field)?copy(row[field]):Object.hasOwn(row.source??{},field)?copy(row.source[field]):null;return [column.name,column.source==='request'?read(request):column.source==='work'?read(saved):orders.map(read)];}));
    return {key:request.key,serviceRequestId:request.serviceRequestId,sourceSha256:request.sourceSha256,request:copy(request),orders,work:copy(saved),geometry:copy(viewed.geometry),mapped};
  });
  if(new Set(rows.map(row=>row.key)).size!==rows.length)fail('DUPLICATE_DISPATCH_REQUEST','Select one current action per original request.');
  return seal({schema:DISPATCH_SCHEMA,id:identity.id,name:text(input.name,'Dispatch name',300),editionId:edition.id,editionSha256:edition.sha256,seriesId:edition.seriesId,createdAt:identity.createdAt,definition:{name:input.name,editionId:edition.id,workIds,columns,note:text(input.note??'','Dispatch note',100000,{empty:true})},rows,coverage:copy(edition.coverage),totals:{actions:rows.length,located:rows.filter(row=>row.geometry).length,unlocated:rows.filter(row=>!row.geometry).length}});
}
export function dispatchSummary(value){return {id:value.id,name:value.name,editionId:value.editionId,seriesId:value.seriesId,createdAt:value.createdAt,rows:value.rows.length,totals:copy(value.totals),sha256:value.sha256};}
