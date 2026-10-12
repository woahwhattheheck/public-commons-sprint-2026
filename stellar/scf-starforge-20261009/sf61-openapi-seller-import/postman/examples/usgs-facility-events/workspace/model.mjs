// MIT. Customer operating semantics over the original facility-event reporter.
import { createHash, randomUUID } from 'node:crypto';
import { buildFacilityReport, normaliseFacilities, renderFacilityCsv, renderFacilityHtml } from '../report-core.mjs';
import { parseCollectionManifest } from '../../../../../sf88-operator-buyer-cli/resource-library/collection-package.mjs';

export const DESK_SCHEMA = 'stellar-forge.facility-operations-workspace.v1';
export const TRANSFER_SCHEMA = 'stellar-forge.facility-operations-transfer.v1';
export const COLLECTION_TRANSFER_SCHEMA = 'stellar-forge.facility-operations-transfer.v2';
export const BUYER_COLLECTION_SCHEMA = 'stellar-forge.facility-buyer-collection.v1';
export const STARTUP_SCHEMA = 'stellar-forge.facility-operations-startup.v1';
export const SOURCE_LIMIT = 64 * 1024 * 1024;
export const REVIEW_STATUSES = ['assigned','investigating','action-recorded','closed'];
export const now = () => new Date().toISOString();
export const uuid = () => randomUUID();
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key,sort(value[key])]));
  return value;
}
export const hash = value => createHash('sha256').update(typeof value === 'string' || ArrayBuffer.isView(value) ? value : canonical(value)).digest('hex');
export function need(condition, message, status=400) { if (!condition) throw Object.assign(new Error(message),{status}); }
export function string(value, label, maximum=2000, required=false) {
  need(typeof value === 'string' && value.length <= maximum && !value.includes('\0'), label+' must be text of at most '+maximum+' characters.');
  const result=value.trim(); need(!required || result.length>0,label+' is required.'); return result;
}
export function timestamp(value, label, optional=false) {
  if (optional && (value===null || value==='')) return null;
  need(typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)),label+' must be an explicit UTC timestamp.');
  return new Date(value).toISOString();
}
export function parseBytes(bytes,label='Source') {
  let text; try { text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); }
  catch { throw new TypeError(label+' must contain valid UTF-8.'); }
  try { return JSON.parse(text.charCodeAt(0)===0xfeff?text.slice(1):text); }
  catch { throw new TypeError(label+' must contain valid JSON.'); }
}
export function projectSettings(input) {
  need(plain(input),'Supply the project settings.');
  return {title:string(input.title,'Project title',200,true),organisation:string(input.organisation??'','Organisation',300),
    operator:string(input.operator??'','Operator',200),procedure:string(input.procedure??'','Operating procedure',12000),
    handoverContact:string(input.handoverContact??'','Handover contact',1000)};
}
export function roster(input) {
  need(plain(input),'Supply the original facility input.');
  const native=plain(input.facilityInput)?input.facilityInput:input;
  const facilities=normaliseFacilities(native);
  const detail=plain(input.details)?input.details:{};
  const ids=new Set(facilities.map(site=>site.id));
  need(Object.keys(detail).every(id=>ids.has(id)),'Facility details must name a facility in this roster.');
  const details=Object.fromEntries(facilities.map(site=>{
    const d=Object.hasOwn(detail,site.id)?detail[site.id]:{};
    need(plain(d),'Facility details must be objects.');
    return [site.id,{owner:string(d.owner??'','Facility owner',200),procedure:string(d.procedure??'','Facility procedure',8000),notes:string(d.notes??'','Facility notes',4000)}];
  }));
  return {label:string(input.label??'Facility roster','Roster label',200,true),facilityInput:{schema:'commons.facility-watch-input.v1',
    ...(typeof native.description==='string'?{description:string(native.description,'Roster description',4000)}:{}),facilities},details};
}
const FEED_MAGNITUDES = ['all','1.0','2.5','4.5','significant'];
const FEED_PERIODS = ['hour','day','week','month'];
function number(value,label,min,max) { need(typeof value==='number' && Number.isFinite(value) && value>=min && value<=max,label+' is outside its valid range.');return value; }
export function queryPlan(value) {
  need(plain(value),'Supply a source selection.');
  const label=string(value.label??'USGS source','Source name',200,true);
  if (value.mode==='feed') {
    need(FEED_MAGNITUDES.includes(value.magnitude) && FEED_PERIODS.includes(value.period),'Choose a published USGS real-time feed.');
    return {label,mode:'feed',magnitude:value.magnitude,period:value.period};
  }
  need(value.mode==='catalog','Choose a real-time feed or a fixed catalog window.');
  const starttime=timestamp(value.starttime,'Window start'),endtime=timestamp(value.endtime,'Window end');
  need(Date.parse(starttime)<Date.parse(endtime),'Window end must follow its start.');
  const minmagnitude=number(value.minmagnitude,'Minimum magnitude',-10,10);
  const bounds=value.bounds===null || value.bounds===undefined?null:{
    minlatitude:number(value.bounds.minlatitude,'Minimum latitude',-90,90),
    maxlatitude:number(value.bounds.maxlatitude,'Maximum latitude',-90,90),
    minlongitude:number(value.bounds.minlongitude,'Minimum longitude',-360,360),
    maxlongitude:number(value.bounds.maxlongitude,'Maximum longitude',-360,360)};
  if(bounds) need(bounds.minlatitude<bounds.maxlatitude && bounds.minlongitude<bounds.maxlongitude && bounds.maxlongitude-bounds.minlongitude<=360,'Use ordered geographic bounds spanning at most 360 degrees.');
  return {label,mode:'catalog',starttime,endtime,minmagnitude,bounds};
}
export function sourceRequest(plan,window,kind='query') {
  if(plan.mode==='feed') return 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/'+plan.magnitude+'_'+plan.period+'.geojson';
  const url=new URL('https://earthquake.usgs.gov/fdsnws/event/1/'+kind);
  url.searchParams.set('format',kind==='count'?'text':'geojson');
  url.searchParams.set('starttime',window?.starttime??plan.starttime);
  url.searchParams.set('endtime',window?.endtime??plan.endtime);
  url.searchParams.set('minmagnitude',String(plan.minmagnitude));
  for(const [key,value] of Object.entries(plan.bounds??{})) url.searchParams.set(key,String(value));
  if(kind==='query') {url.searchParams.set('limit','20000');url.searchParams.set('orderby','time-asc');}
  return url.href;
}
export function buyerCollection(bytes, identity, input={}, receivedAt=now()) {
  const manifest=parseCollectionManifest(bytes),collection=manifest.collection;
  need(/^[a-f0-9]{64}$/.test(identity.archiveSha256??'')&&Number.isSafeInteger(identity.archiveBytes)&&
    identity.archiveBytes>=1024&&identity.archiveBytes<=16*1024*1024*1024,'Supply the complete original collection archive identity.');
  const result={schema:BUYER_COLLECTION_SCHEMA,name:string(input.name??collection.id+'.tar','Collection filename',4096,true),
    operator:string(input.operator,'Receiving operator',200,true),note:string(input.note??'','Collection receiving note',8000),
    receivedAt:timestamp(receivedAt,'Collection receiving time'),archiveSha256:identity.archiveSha256,archiveBytes:identity.archiveBytes,
    manifestSha256:hash(bytes),manifestBytes:bytes.byteLength,memberCount:collection.members.length,objectCount:manifest.objects.length,
    collection:{id:collection.id,revision:collection.revision,name:collection.name,note:collection.note,updatedAt:collection.updatedAt??null}};
  return {...result,id:hash(result)};
}
export function buyerProvenance(value) {
  need(plain(value)&&value.schema==='stellar-forge.facility-buyer-source.v1','Supply the original collection source binding.');
  const result={schema:value.schema};
  for(const key of ['collectionId','archiveSha256','manifestSha256','memberId']){
    need(/^[a-f0-9]{64}$/.test(value[key]??''),'The original collection '+key+' is required.');result[key]=value[key];
  }
  return result;
}
export function validateBuyerSource(source,collection,metadata) {
  const acquisition=buyerProvenance(source.acquisition),manifest=parseCollectionManifest(metadata);
  need(collection.schema===BUYER_COLLECTION_SCHEMA&&collection.id===acquisition.collectionId&&
    collection.archiveSha256===acquisition.archiveSha256&&collection.manifestSha256===acquisition.manifestSha256&&
    hash(metadata)===acquisition.manifestSha256&&collection.manifestBytes===metadata.byteLength&&
    collection.collection.id===manifest.collection.id&&collection.collection.revision===manifest.collection.revision,
    'The source differs from its original buyer collection.');
  const member=manifest.collection.members.find(item=>item.id===acquisition.memberId);
  need(member&&member.sha256===source.bodySha256&&member.bytes===source.bytes&&member.deliveryStatus==='SAVED'&&
    member.httpStatus===source.status&&member.name===source.name&&String(member.url??'')===source.url&&
    source.mode==='buyer-collection','The response differs from the selected original buyer member.');
  return {sourceId:source.id,collection,member};
}

function originalSourceString(value,label,maximum) {
  string(value,label,maximum);return value;
}
export function sourceRecord(bytes, input={}) {
  need(bytes.byteLength<=SOURCE_LIMIT,'A retained response may contain at most 64 MiB.');
  const status=input.status??200;
  need(status===200 || status===204,'Select a successful GeoJSON response or an original empty HTTP 204 response.');
  let document=null;
  if(status===204) need(bytes.byteLength===0,'An HTTP 204 source must retain an empty response body.');
  else {
    document=parseBytes(bytes);
    need(document?.type==='FeatureCollection' && Array.isArray(document.features),'Select a USGS GeoJSON FeatureCollection.');
    need(document.features.length<=100000,'This source exceeds the original reporter’s 100000 received-row limit.');
    need(document.metadata?.status===undefined || document.metadata.status===200,'The retained provider metadata reports an unsuccessful response.');
  }
  const sourceName=input.name??'events.geojson',sourceUrl=input.url??document?.metadata?.url??'';
  const record={name:input.acquisition?originalSourceString(sourceName,'Source filename',4096):string(sourceName,'Source filename',4096,true),bodySha256:hash(bytes),bytes:bytes.byteLength,
    status,receivedAt:timestamp(input.receivedAt??now(),'Receiving time'),
    url:input.acquisition?originalSourceString(sourceUrl,'Source URL',8000):string(sourceUrl,'Source URL',8000),
    mode:input.mode??'retained-file',returnedFeatures:document?.features.length??0,
    metadata:document?.metadata??null,headers:plain(input.headers)?input.headers:{},
    ...(input.captureId?{captureId:input.captureId}:{}),...(input.plan?{plan:queryPlan(input.plan)}:{}),
    ...(input.window?{window:input.window}:{}),...(input.counts?{counts:input.counts}:{}),
    ...(input.note?{note:string(input.note,'Source note',4000)}:{}),
    ...(input.acquisition?{acquisition:buyerProvenance(input.acquisition)}:{}),
    ...(input.receivedBy?{receivedBy:string(input.receivedBy,'Receiving operator',200,true)}:{})};
  return {...record,id:hash(record)};
}
export function originalInput(source,bytes) {
  need(hash(bytes)===source.bodySha256 && bytes.byteLength===source.bytes,'A retained source differs from its original bytes.');
  return {name:source.name,sha256:source.bodySha256,document:source.status===204?null:parseBytes(bytes,source.name),
    ...(source.status===204?{response:{status:204,bodyBytes:0,url:source.url}}:{})};
}
export function edition(input, rosterEntry, sources, generatedAt=now()) {
  const label=string(input.label,'Report name',200,true),operator=string(input.operator,'Report operator',200,true);
  need(Array.isArray(sources) && sources.length>=1 && sources.length<=16,'Select 1–16 original source responses for the report.');
  const ids=sources.map(item=>item.source.id);
  need(new Set(ids).size===ids.length,'Select each source response once.');
  const report=buildFacilityReport(sources.map(item=>originalInput(item.source,item.bytes)),rosterEntry.facilityInput,{generatedAt});
  report.facilitySource={name:rosterEntry.label+'.json',sha256:hash(rosterEntry.facilityInput)};
  const result={label,operator,note:string(input.note??'','Report note',8000),createdAt:timestamp(generatedAt,'Report time'),
    rosterId:rosterEntry.id,sourceIds:ids,report,reportSha256:hash(report),
    selectionNotes:sources.flatMap(item=>coverageNotes(item.source,rosterEntry.facilityInput.facilities).map(note=>item.source.name+': '+note))};
  return {...result,id:hash(result)};
}
export const pairId = (facilityId,eventId) => JSON.stringify([facilityId,eventId]);
export function eventFingerprint(site,event) {
  const {events,matchCount,...facility}=site, {sources,...originalEvent}=event;
  return hash({facility,event:originalEvent});
}
export function editionRows(value) {
  return value.report.facilities.flatMap(site=>site.events.map(event=>({pair:pairId(site.id,event.id),
    facility:((({events,matchCount,...s})=>s)(site)),event,fingerprint:eventFingerprint(site,event),editionId:value.id,reportLabel:value.label,reportTime:value.createdAt})));
}
export function review(input,row,createdAt=now()) {
  need(plain(input) && row,'Select an original facility/event match.');
  need(REVIEW_STATUSES.includes(input.status),'Choose an operator review state.');
  const operator=string(input.operator,'Review operator',200,true),assignee=string(input.assignee??'','Assigned operator',200);
  const action=string(input.action??'','Recorded action',8000),notes=string(input.notes??'','Decision rationale',8000);
  need(input.status!=='assigned'||assignee,'Name the assigned operator.');
  need(!['action-recorded','closed'].includes(input.status)||action,'Describe the action or the decision before completing this review.');
  const result={pair:row.pair,facilityId:row.facility.id,eventId:row.event.id,editionId:row.editionId,fingerprint:row.fingerprint,
    status:input.status,operator,assignee,action,notes,dueUtc:timestamp(input.dueUtc??null,'Due time',true),
    createdAt:timestamp(createdAt,'Review time'),...(input.previousId?{previousId:input.previousId}:{})};
  return {...result,id:hash(result)};
}
export function workRows(editions,reviews,selectedId=null) {
  const selected=selectedId?editions.find(item=>item.id===selectedId):null, latest=new Map(), decisions=new Map();
  for(const item of [...editions].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)))
    for(const row of editionRows(item)) latest.set(row.pair,row);
  for(const item of [...reviews].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))) decisions.set(item.pair,item);
  const current=new Set(selected?editionRows(selected).map(row=>row.pair):[]);
  const rows=selected?editionRows(selected):[...latest.values()];
  return rows.map(row=>{
    const previous=decisions.get(row.pair)??null,unchanged=previous?.fingerprint===row.fingerprint;
    return {...row,review:previous,status:unchanged?previous.status:'needs-review',sourceChanged:Boolean(previous&&!unchanged),
      assignee:previous?.assignee??'',inSelectedEdition:selected?true:current.has(row.pair),carriedFrom:unchanged&&previous.editionId!==row.editionId?previous.editionId:null};
  });
}
export function compareEditions(before,after) {
  const left=new Map(editionRows(before).map(row=>[row.pair,row])),right=new Map(editionRows(after).map(row=>[row.pair,row]));
  const rows=[...new Set([...left.keys(),...right.keys()])].sort().map(pair=>{
    const a=left.get(pair)??null,b=right.get(pair)??null;
    return {pair,change:!a?'added':!b?'outside-current-selection':a.fingerprint===b.fingerprint?'unchanged':'changed',before:a,after:b};
  });
  return {before:before.id,after:after.id,counts:Object.fromEntries(['added','changed','unchanged','outside-current-selection'].map(kind=>[kind,rows.filter(row=>row.change===kind).length])),rows,
    rosterChanged:before.rosterId!==after.rosterId,sourceSelectionChanged:canonical(before.sourceIds)!==canonical(after.sourceIds)};
}
export function coverageNotes(source,facilities) {
  const notes=[],plan=source.plan;
  if(source.counts) {
    const {before,after}=source.counts;
    if(before!==source.returnedFeatures || after!==source.returnedFeatures) notes.push('Catalog count observations ('+before+' before, '+after+' after) differ from '+source.returnedFeatures+' retained event rows.');
  }
  if(!plan) return notes;
  const floor=plan.mode==='catalog'?plan.minmagnitude:plan.magnitude==='significant'?null:plan.magnitude==='all'?-Infinity:Number(plan.magnitude);
  if(plan.mode==='feed' && plan.magnitude==='significant') notes.push('This is the provider’s significant-event selection.');
  for(const site of facilities) {
    if(floor!==null && site.minimumMagnitude<floor) notes.push(site.name+': the site magnitude threshold is below this source’s '+floor+' selection.');
    if(plan.mode==='catalog'&&plan.bounds) {
      const r=site.radiusKm/6371, lat=site.latitude*Math.PI/180,b=plan.bounds;
      const south=Math.max(-90,(lat-r)*180/Math.PI),north=Math.min(90,(lat+r)*180/Math.PI);
      const delta=r>=Math.PI/2 || Math.abs(lat)+r>=Math.PI/2?180:Math.asin(Math.min(1,Math.sin(r)/Math.cos(lat)))*180/Math.PI;
      const coversLongitude=[-360,0,360].some(shift=>b.minlongitude<=site.longitude-delta+shift && b.maxlongitude>=site.longitude+delta+shift);
      if(b.minlatitude>south || b.maxlatitude<north || !coversLongitude)
        notes.push(site.name+': the selected rectangle does not contain the whole '+site.radiusKm+' km site radius.');
    }
  }
  return notes;
}
export const escape = value => String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function csvCell(value) {
  let result=String(value??'');
  if(typeof value==='string' && /^[\s]*[=+@\t\r-]/.test(result)) result="'"+result;
  return '"'+result.replaceAll('"','""')+'"';
}
export function reviewCsv(rows) {
  const keys=['facility_id','facility_name','event_id','event_time_utc','magnitude','epicentral_distance_km','operator_state',
    'source_changed','assignee','due_utc','operator','action','rationale','reviewed_utc','source_edition','event_updated_utc','review_edition','review_fingerprint','current_fingerprint'];
  const values=rows.map(row=>[row.facility.id,row.facility.name,row.event.id,row.event.timeUtc,row.event.magnitude,row.event.distanceKm,
    row.status,row.sourceChanged,row.assignee,row.review?.dueUtc,row.review?.operator,row.review?.action,row.review?.notes,row.review?.createdAt,row.editionId,row.event.updatedUtc,row.review?.editionId,row.review?.fingerprint,row.fingerprint]);
  return [keys,...values].map(line=>line.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function comparisonCsv(comparison) {
  return [['change','facility_id','event_id','before_magnitude','after_magnitude','before_distance_km','after_distance_km','before_updated_utc','after_updated_utc'],
    ...comparison.rows.map(row=>[row.change,(row.after??row.before).facility.id,(row.after??row.before).event.id,row.before?.event.magnitude,row.after?.event.magnitude,
      row.before?.event.distanceKm,row.after?.event.distanceKm,row.before?.event.updatedUtc,row.after?.event.updatedUtc])]
    .map(line=>line.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function handoverHtml(project,current,rows,rosterEntry,sources,{retainedWork=[],reviewHistory=[],acquisitions=[]}={}) {
  const actions=rows.map(row=>'<tr><td>'+escape(row.facility.name)+'<br>'+escape(row.event.id)+'</td><td>'+escape(row.status)+
    (row.sourceChanged?'<br>Event or facility selection changed':'')+'</td><td>'+escape(row.assignee)+'</td><td>'+escape(row.review?.action)+'</td><td>'+
    escape(row.review?.notes)+'</td><td>'+escape(row.review?.dueUtc)+'</td><td>'+escape(row.review?.operator)+'<br>'+escape(row.review?.createdAt)+'</td></tr>').join('');
  const currentPairs=new Set(rows.map(row=>row.pair)),older=retainedWork.filter(row=>!currentPairs.has(row.pair)&&row.status!=='closed');
  const relevantPairs=new Set([...currentPairs,...older.map(row=>row.pair)]);
  const carried=older.length?'<section><h2>Outstanding work from earlier retained editions</h2><div class="table"><table><thead><tr><th>Facility / event</th><th>Original edition</th><th>Operating state</th><th>Assignment / due</th><th>Recorded action</th><th>Rationale / attribution</th></tr></thead><tbody>'+
    older.map(row=>'<tr><td>'+escape(row.facility.name)+'<br>'+escape(row.event.id)+'</td><td>'+escape(row.reportLabel)+'<br>'+escape(row.reportTime)+'</td><td>'+escape(row.status)+'</td><td>'+escape(row.assignee)+'<br>'+escape(row.review?.dueUtc)+'</td><td>'+escape(row.review?.action)+'</td><td>'+escape(row.review?.notes)+'<br>'+escape(row.review?.operator)+'<br>'+escape(row.review?.createdAt)+'</td></tr>').join('')+'</tbody></table></div></section>':'';
  const history=reviewHistory.filter(item=>relevantPairs.has(item.pair));
  const historyHtml=history.length?'<section><h2>Attributed review history</h2>'+history.map(item=>'<article><h3>'+escape(item.facilityId)+' / '+escape(item.eventId)+'</h3><p>'+escape(item.status)+' · '+escape(item.operator)+' · '+escape(item.createdAt)+'</p><p>Assigned: '+escape(item.assignee)+' · Due: '+escape(item.dueUtc)+'</p><pre>'+escape(item.action)+'</pre><pre>'+escape(item.notes)+'</pre><p class="hash">Original edition '+escape(item.editionId)+'<br>Review '+escape(item.id)+'</p></article>').join('')+'</section>':'';
  const procedures=rosterEntry.facilityInput.facilities.map(site=>'<h3>'+escape(site.name)+'</h3><p>Assigned contact: '+escape(rosterEntry.details[site.id]?.owner)+
    '</p><pre>'+escape(rosterEntry.details[site.id]?.procedure)+'</pre>').join('');
  const notes=sources.flatMap(source=>coverageNotes(source,rosterEntry.facilityInput.facilities).map(note=>source.name+': '+note));
  const extra='<section><h2>Customer operating handover</h2><p>'+escape(project.title)+' · '+escape(project.organisation)+'</p><p>'+escape(project.handoverContact)+
    '</p><p>Report: '+escape(current.label)+' · prepared by '+escape(current.operator)+'</p><pre>'+escape(project.procedure)+'</pre>'+
    '<pre>'+escape(current.note)+'</pre><div class="table"><table><thead><tr><th>Facility / event</th><th>Review state</th><th>Assignee</th><th>Recorded action</th>'+
    '<th>Decision rationale</th><th>Due (UTC)</th><th>Recorded by / time</th></tr></thead><tbody>'+actions+'</tbody></table></div></section>'+
    '<section><h2>Site procedures</h2>'+procedures+'</section>'+
    (notes.length?'<section><h2>Source selection and count observations</h2><ul>'+notes.map(note=>'<li>'+escape(note)+'</li>').join('')+'</ul></section>':'')+
    '<section><h2>Retained edition</h2><p class="hash">'+escape(current.id)+'</p><p>Report SHA-256: '+escape(current.reportSha256)+
    '</p><p>The accompanying full workspace retains original source bytes, all saved reports, procedures, attribution and decision history.</p></section>';
  const acquisitionHtml=acquisitions.length?'<section><h2>Original buyer collections and selected responses</h2>'+
    acquisitions.map(({sourceId,collection,member})=>'<article><h3>'+escape(member.name)+'</h3><p>'+
      escape(collection.collection.name)+' · original revision '+escape(collection.collection.revision)+
      ' · received by '+escape(collection.operator)+' · '+escape(collection.receivedAt)+'</p>'+
      '<p>Original intent: '+escape(member.intentId)+' · buyer outcome: '+escape(member.buyerStatus)+
      ' · HTTP status: '+escape(member.httpStatus)+'</p><p>Original payment terms: '+escape(member.paymentTerms?.scheme)+
      ' · '+escape(member.paymentTerms?.network)+' · asset '+escape(member.paymentTerms?.asset)+
      ' · recipient '+escape(member.paymentTerms?.payTo)+' · maximum atomic amount '+escape(member.paymentTerms?.maxAtomic)+'</p>'+
      '<pre>'+escape(member.annotation?.note)+'</pre><p>Original review tags: '+escape((member.annotation?.tags??[]).join(', '))+'</p>'+
      '<p class="hash">Collection archive SHA-256: '+escape(collection.archiveSha256)+
      '<br>Original manifest SHA-256: '+escape(collection.manifestSha256)+'<br>Original response SHA-256: '+
      escape(member.sha256)+'<br>Facility source edition: '+escape(sourceId)+'</p></article>').join('')+
    '<p>The complete original collection archives, including all members, accompany the full workspace transfer.</p></section>':'';
  return renderFacilityHtml(current.report).replace('</main>',() => extra+carried+historyHtml+acquisitionHtml+'</main>');
}
export { renderFacilityCsv };
