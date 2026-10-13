// MIT. Original SF88 event exports into reviewed customer Analysis sources.
import {createHash} from 'node:crypto';

const EXPORT='stellar-forge.event-feed-export.v1';
export const ANALYSIS='stellar-forge.event-feed-analysis-source.v1';
const HASH=/^[a-f0-9]{64}$/, NAME=/^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const bytes=s=>Buffer.byteLength(s,'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const need=(v,m)=>{if(!v)throw new Error(m);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const identity=v=>typeof v==='string'&&v.length>0&&v.length<=256;
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const pointer=p=>{need(typeof p==='string'&&(p===''||p.startsWith('/'))&&!/~(?:[^01]|$)/.test(p)&&p.length<=2000,'Use an original JSON Pointer.');return p===''?[]:p.slice(1).split('/').map(x=>x.replace(/~1/g,'/').replace(/~0/g,'~'));};
function at(value,path) {for(const key of pointer(path)){if(value===null||typeof value!=='object'||Array.isArray(value)&&(!/^(0|[1-9][0-9]*)$/.test(key)||!Number.isSafeInteger(Number(key))||Number(key)>=value.length)||!Object.prototype.hasOwnProperty.call(value,key))return{state:'missing',value:null};value=value[key];}return{state:value===null?'null':Array.isArray(value)?'array':typeof value,value};}
const textValue=selected=>['missing','null'].includes(selected.state)?null:typeof selected.value==='string'?selected.value:JSON.stringify(selected.value);
export function normalizeEventMapping(value={}) {
  need(object(value),'Use a complete mapping object.');
  const fields=value.fields??[];need(Array.isArray(fields)&&fields.length<=100,'Select at most 100 complete payload fields.');
  const reserved=new Set(['store_id','feed_id','feed_revision','source_id','event_id','sequence','event_type','received_at','occurred_at','occurred_at_state','source_body_sha256','payload_sha256','payload_json']);
  const seen=new Set(reserved);
  const mapped=fields.map(f=>{need(object(f)&&typeof f.name==='string'&&NAME.test(f.name)&&!seen.has(f.name.toLowerCase())&&!seen.has((f.name+'_state').toLowerCase()),'Choose distinct field names outside the original event columns.');seen.add(f.name.toLowerCase());seen.add((f.name+'_state').toLowerCase());pointer(f.pointer);return{name:f.name,pointer:f.pointer};});
  return{schema:'stellar-forge.event-feed-analysis-mapping.v1',fields:mapped};
}
export function inspectEventExport(ndjsonText,manifestText) {
  need(typeof ndjsonText==='string'&&typeof manifestText==='string','Receive both original complete files.');
  need(bytes(ndjsonText)<=32*1024*1024&&bytes(manifestText)<=4*1024*1024,'Select an original export within the complete source-document limits.');
  const m=JSON.parse(manifestText);
  need(object(m)&&m.schema===EXPORT&&identity(m.id)&&identity(m.feedId)&&identity(m.storeId)&&HASH.test(m.feedRevision),'The complete original export identity is required.');
  need(typeof m.source==='string'&&m.source.length<=3000,'Keep the original merchant resource URL.');
  const u=new URL(m.source);need(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash,'Retain the original resource origin/path without credentials or query.');
  need(integer(m.checkpointRevision)&&m.checkpointRevision>=1&&integer(m.throughSequence)&&integer(m.events)&&instant(m.createdAt),'The original export checkpoint is invalid.');
  need(m.cycleComplete===true,'Continue the original subscriber until its captured window is complete before customer Analysis.');
  need(object(m.data)&&m.data.format==='ndjson'&&m.data.bytes===bytes(ndjsonText)&&m.data.sha256===sha(ndjsonText),'The original export manifest must select these exact NDJSON bytes.');
  need(Array.isArray(m.pages)&&m.pages.length>0&&m.pages.length===m.checkpointRevision,'Retain every accepted original page.');
  let eventCount=0;const operations=new Set();
  m.pages.forEach((p,i)=>{need(object(p)&&p.ordinal===i+1&&identity(p.operationId)&&!operations.has(p.operationId)&&HASH.test(p.responseSha256)&&integer(p.events)&&(p.httpStatus===null||Number.isInteger(p.httpStatus)&&p.httpStatus>=100&&p.httpStatus<=599)&&(p.nativeStatus===null||typeof p.nativeStatus==='string'),'Retain the complete ordered page identities and recorded response outcomes.');operations.add(p.operationId);eventCount+=p.events;});
  need(eventCount===m.events,'The original page counts and retained event total differ.');
  const lines=ndjsonText===''?[]:ndjsonText.split('\n');
  if(lines.at(-1)==='')lines.pop();
  need(lines.length===m.events&&lines.every(line=>line.length>0),'Receive every original event row without blank records.');
  let prior=0;const ids=new Set();
  const events=lines.map((line,index)=>{
    const e=JSON.parse(line);need(object(e)&&integer(e.sequence)&&e.sequence>prior&&e.sequence<=m.throughSequence&&identity(e.sourceId)&&identity(e.eventId)&&typeof e.type==='string'&&e.type.length<=256&&instant(e.receivedAt)&&(e.occurredAt===null||instant(e.occurredAt))&&object(e.payload)&&HASH.test(e.sourceBodySha256)&&HASH.test(e.payloadSha256),'An original event row is invalid at '+(index+1)+'.');
    need(sha(JSON.stringify(e.payload))===e.payloadSha256,'The retained native payload digest differs at '+(index+1)+'.');
    const key=JSON.stringify([e.sourceId,e.eventId]);need(!ids.has(key),'An individual event identity is repeated.');ids.add(key);prior=e.sequence;
    return e;
  });
  const identityFields={id:m.id,source:m.source,storeId:m.storeId,feedId:m.feedId,feedRevision:m.feedRevision};
  return{schema:ANALYSIS,edition_id:sha(sha(ndjsonText)+':'+sha(manifestText)),source:identityFields,manifest:m,events,original_files:{ndjson:{bytes:bytes(ndjsonText),sha256:sha(ndjsonText)},manifest:{bytes:bytes(manifestText),sha256:sha(manifestText)}}};
}
export function projectEventExport(source,mapping={}) {
  const selected=normalizeEventMapping(mapping);
  const base=['store_id','feed_id','feed_revision','source_id','event_id','sequence','event_type','received_at','occurred_at','occurred_at_state','source_body_sha256','payload_sha256','payload_json'];
  const columns=[...base,...selected.fields.flatMap(f=>[f.name,f.name+'_state'])];
  const rows=source.events.map(e=>{
    const row={store_id:source.source.storeId,feed_id:source.source.feedId,feed_revision:source.source.feedRevision,source_id:e.sourceId,event_id:e.eventId,sequence:String(e.sequence),event_type:e.type,received_at:e.receivedAt,occurred_at:e.occurredAt,occurred_at_state:e.occurredAt===null?'null':'string',source_body_sha256:e.sourceBodySha256,payload_sha256:e.payloadSha256,payload_json:JSON.stringify(e.payload)};
    for(const f of selected.fields){const value=at(e.payload,f.pointer);row[f.name]=textValue(value);row[f.name+'_state']=value.state;}
    return row;
  });
  const document=JSON.stringify({events:rows})+'\n';need(bytes(document)<=32*1024*1024,'The complete projection exceeds the original Analysis JSON-document capacity; choose fewer projected fields or a smaller original subscription.');
  return{mapping:selected,mapping_sha256:sha(stable(selected)),columns,rows,document,document_bytes:bytes(document),document_sha256:sha(document)};
}
export function compareEventExports(before,after) {
  need(stable(before.source)===stable(after.source),'Use another customer programme for another subscription, source, store, feed or projection revision.');
  need(after.manifest.throughSequence>=before.manifest.throughSequence&&after.manifest.checkpointRevision>=before.manifest.checkpointRevision,'A later window cannot rewind the original subscriber checkpoint.');
  need(after.manifest.pages.length>=before.manifest.pages.length&&before.manifest.pages.every((p,i)=>stable(p)===stable(after.manifest.pages[i])),'The earlier original paid page history changed.');
  const old=new Map(before.events.map(e=>[JSON.stringify([e.sourceId,e.eventId]),e]));
  let retained=0;const added=[];
  for(const event of after.events){const key=JSON.stringify([event.sourceId,event.eventId]),prior=old.get(key);if(prior){need(stable(prior)===stable(event),'An earlier accepted individual event changed. Reconcile the original source before continuing.');old.delete(key);retained++;}else{need(event.sequence>before.manifest.throughSequence,'A new event appears behind the accepted complete window.');added.push({sourceId:event.sourceId,eventId:event.eventId,sequence:event.sequence});}}
  need(old.size===0,'A later cumulative export omitted original accepted events.');
  return{schema:'stellar-forge.event-feed-window-comparison.v1',before:before.edition_id,after:after.edition_id,retained,added:added.length,new_events:added,earlier_through_sequence:before.manifest.throughSequence,later_through_sequence:after.manifest.throughSequence,earlier_pages:before.manifest.pages.length,later_pages:after.manifest.pages.length};
}


export const EVENT_FIELDS='stellar-forge.event-feed-payload-fields.v1';
export const EVENT_FIELD_VALUES='stellar-forge.event-feed-payload-values.v1';
const STATES=['null','string','number','boolean','object','array'];
const pointerPart=key=>key.replace(/~/g,'~0').replace(/\//g,'~1');
const originalEvent=e=>({source_id:e.sourceId,event_id:e.eventId,sequence:e.sequence,event_type:e.type,payload_sha256:e.payloadSha256});
function fieldSource(source){
 need(object(source)&&source.schema===ANALYSIS&&Array.isArray(source.events),'Inspect the complete original validated event source.');
 return {edition_id:source.edition_id,source:source.source,original_files:source.original_files,
 events:source.events.length,through_sequence:source.manifest.throughSequence,pages:source.manifest.pages.length};
}
/** Inspect every actual path; limits reject the whole inspection, never truncate its coverage. */
export function inspectEventFields(source) {
 const selected=fieldSource(source),found=new Map();
 for(const e of source.events){
  const pending=[['',e.payload]];
  while(pending.length){
   const [path,value]=pending.pop(),state=value===null?'null':Array.isArray(value)?'array':typeof value;
   need(STATES.includes(state),'The original payload contains an unsupported JSON value.');
   let row=found.get(path);
   if(!row){
    need(found.size<10000,'The complete payload field catalogue exceeds 10,000 paths. Use the original mapping directly or select a smaller useful source window.');
    row={pointer:path,present:0,missing:0,types:Object.fromEntries(STATES.map(type=>[type,0])),
     selectable:path.length<=2000,examples:[]};found.set(path,row);
   }
   row.present++;row.types[state]++;
   if(row.examples.length<3&&!row.examples.some(example=>example.state===state)){
    const container=state==='array'||state==='object',full=container?null:textValue({state,value});
    let display=container?(state==='array'?'Array with '+value.length+' elements':'Object with '+Object.keys(value).length+' members'):
     full===null?null:full.slice(0,160);
    if(!container&&display&&/[\uD800-\uDBFF]$/.test(display))display=display.slice(0,-1);
    row.examples.push({event:originalEvent(e),state,display,preview_kind:container?'container-summary':'value',
     truncated:container||full!==display,value_bytes:full===null?null:bytes(full),value_sha256:full===null?null:sha(full)});
   }
   if(value!==null&&typeof value==='object'){
    const entries=Object.entries(value);
    for(let i=entries.length-1;i>=0;i--){const [key,child]=entries[i];pending.push([path+'/'+pointerPart(key),child]);}
   }
  }
 }
 const fields=[...found.values()].sort((a,b)=>a.pointer<b.pointer?-1:a.pointer>b.pointer?1:0);
 for(const row of fields)row.missing=source.events.length-row.present;
 const result={schema:EVENT_FIELDS,...selected,field_count:fields.length,fields};
 need(bytes(JSON.stringify(result))<=16*1024*1024,'The complete field catalogue exceeds 16 MiB. Use the original mapping directly or select a smaller useful source window.');
 return result;
}
/** Complete values for one original pointer and original event-index page, including missing/null. */
export function inspectEventFieldValues(source,path,{offset=0,limit=25}={}) {
 const selected=fieldSource(source);pointer(path);
 need(integer(offset)&&offset<=source.events.length&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,
 'Select an original event offset and a page of one to 100 events.');
 const rows=source.events.slice(offset,offset+limit).map((e,index)=>{
  const value=at(e.payload,path),text=textValue(value);
  return{index:offset+index,event:originalEvent(e),state:value.state,text,
   value_bytes:text===null?null:bytes(text),value_sha256:text===null?null:sha(text)};
 });
 const result={schema:EVENT_FIELD_VALUES,...selected,pointer:path,offset,limit,total:source.events.length,
 next_offset:offset+rows.length<source.events.length?offset+rows.length:null,rows};
 need(bytes(JSON.stringify(result))<=48*1024*1024,'This complete field-value page exceeds 48 MiB. Request a smaller page; all original source files remain retained.');
 return result;
}
