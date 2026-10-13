'use strict';
/* Copyright 2026 TokenJunkieLabs. Public collection editing and source reconciliation. */
function createEventCollectionModel(hashes) {
  if (typeof hashes?.sha256Utf8 !== 'function') throw new TypeError('Supply the maintained UTF-8 SHA256 implementation.');
  const SCHEMA='tjlabs.event-collection/v1', SOURCE='tjlabs.public-events-source/v1';
  const SOURCE_FIELDS=['title','schedule','venue','organizers','categories','event_url','status','links','media'];
  const FIELDS=[...SOURCE_FIELDS,'editorial_summary','notes'];
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const object=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
  const need=(v,m)=>{if(!v)throw new Error(m);};
  const copy=o=>JSON.parse(JSON.stringify(o));
  function canonical(v){
    if(v===null||typeof v==='boolean')return JSON.stringify(v);
    if(typeof v==='number'){need(Number.isFinite(v),'Non-finite number.');return JSON.stringify(v);}
    if(typeof v==='string'){hashes.utf8ByteLength(v);return JSON.stringify(v);}
    if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
    need(object(v),'Only complete JSON values are supported.');
    return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  }
  const digest=v=>hashes.sha256Utf8(canonical(v)).sha256;
  const same=(a,b)=>canonical(a)===canonical(b);
  const present=(o,k)=>own(o,k)?{present:true,value:o[k]}:{present:false};
  const text=(v,label,empty=false)=>{need(typeof v==='string'&&(empty||v.trim()),label+' must be text.');hashes.utf8ByteLength(v);return v;};
  const key=(v,label)=>{text(v,label);need(v.length<=2048&&!/[\u0000-\u001f\u007f]/.test(v),label+' is invalid.');return v;};
  const url=(v,label)=>{text(v,label);need(/^https?:\/\/[^/\s]+(?:[/?#][^\s]*)?$/.test(v),label+' must be an HTTP(S) URL.');const authority=v.split('/')[2];need(!authority.includes('@'),label+' cannot contain credentials.');return v;};
  function meta(m){need(object(m),'An attributed operation is required.');text(m.id,'Operation ID');text(m.actor,'Editor');text(m.at,'Operation time');need(Number.isFinite(Date.parse(m.at)),'Operation time must be ISO-compatible.');return {id:m.id,actor:m.actor,at:m.at};}
  function validDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const y=Number(v.slice(0,4)),m=Number(v.slice(5,7)),d=Number(v.slice(8,10));if(y<1||m<1||m>12||d<1)return false;const leap=y%4===0&&(y%100!==0||y%400===0);return d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];}
  function validTime(v){const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|([+-])(\d{2}):(\d{2}))?$/.exec(v);return !!m&&validDate(m[1])&&Number(m[2])<24&&Number(m[3])<60&&Number(m[4]||0)<60&&Number(m[6]||0)<=23&&Number(m[7]||0)<60;}
  function schedule(s){
    need(object(s)&&['all-day','timed','unresolved'].includes(s.kind),'Schedule needs all-day, timed or unresolved kind.');
    for(const f of ['start','end','timezone','literal'])if(own(s,f))need(s[f]===null||typeof s[f]==='string','Schedule '+f+' must preserve text or null.');
    need(!own(s,'end_inclusive')||s.end_inclusive===null||typeof s.end_inclusive==='boolean','End inclusivity is boolean or unknown.');
    if(s.kind==='all-day')for(const f of ['start','end'])if(s[f]!==null&&s[f]!==undefined){need(/^\d{4}-\d{2}-\d{2}$/.test(s[f]),'All-day dates must be YYYY-MM-DD.');need(validDate(s[f]),'Invalid calendar date.');}
    if(s.kind==='timed')for(const f of ['start','end'])if(s[f]!==null&&s[f]!==undefined)need(validTime(s[f]),'Timed dates need a valid literal ISO date/time, with original offset if supplied.');
    if(s.start&&s.end&&s.kind==='all-day')need(s.end>=s.start,'The end date precedes the start date.');
    if(own(s,'recurrence'))need(s.recurrence===null||object(s.recurrence)||Array.isArray(s.recurrence)||typeof s.recurrence==='string','Keep complete original recurrence metadata.');
    canonical(s);return s;
  }
  function values(v,sourceOnly=false){
    need(object(v),'Record values must be a complete object.');
    for(const [f,x] of Object.entries(v)){
      need((sourceOnly?SOURCE_FIELDS:FIELDS).includes(f),'Unknown normalized field '+f+'; retain it in original source instead.');
      if(x===null)continue;
      if(['title','editorial_summary','notes','status'].includes(f))text(x,f,true);
      else if(f==='event_url')url(x,f);
      else if(f==='schedule')schedule(x);
      else if(f==='venue')need(object(x)||typeof x==='string','Venue retains its complete object or literal text.');
      else need(Array.isArray(x),f+' must be an array or null.');
      canonical(x);
    }return v;
  }
  function snapshot(input){
    need(object(input)&&input.schema===SOURCE,'Select a public-events source snapshot.');
    const s=copy(input),o=s.source;
    need(object(o),'Snapshot source descriptor is required.');
    key(o.key,'Source key');url(o.collection_url,'Collection URL');text(o.format,'Source representation');text(o.retrieved_at,'Retrieval time');
    need(Number.isFinite(Date.parse(o.retrieved_at)),'Invalid source retrieval time.');key(o.scope_id,'Source selection scope');
    need(['partial','complete'].includes(o.coverage),'Source coverage must be explicit.');need(own(o,'selection'),'Retain the original collection query/selection.');
    need(Array.isArray(s.records),'Snapshot records are required.');
    const ids=new Set();
    for(const r of s.records){
      need(object(r),'Invalid source record.');key(r.key,'Original record key');need(!ids.has(r.key),'Duplicate source record '+r.key);ids.add(r.key);
      url(r.url,'Original record URL');values(r.values,true);need(own(r,'original'),'Retain original source record fields.');
      need(Array.isArray(r.observed_fields)&&same([...r.observed_fields].sort(),Object.keys(r.values).sort()),'Observed fields must identify every supplied field exactly.');
      need(new Set(r.observed_fields).size===r.observed_fields.length,'Repeated observed field.');
      canonical(r.original);
    }
    const unsigned=copy(s);delete unsigned.id;
    const id=digest(unsigned);if(s.id!==undefined)need(s.id===id,'Snapshot content differs from its original identity.');s.id=id;return s;
  }
  const entryId=(sourceKey,recordKey)=>digest({source_key:sourceKey,record_key:recordKey});
  function stateBody(w){const b=copy(w);delete b.seal;return b;}
  function seal(w){const b=stateBody(w);return {...b,seal:digest(b)};}
  function validateWorkspace(input){
    need(object(input)&&input.schema===SCHEMA,'Select a complete event-collection working archive.');
    const w=copy(input);need(w.seal===digest(stateBody(w)),'Working archive content does not match its seal.');
    key(w.id,'Collection ID');text(w.title,'Collection title');need(Number.isSafeInteger(w.revision)&&w.revision>=0,'Invalid collection revision.');
    need(Array.isArray(w.snapshots)&&Array.isArray(w.entries)&&Array.isArray(w.operations)&&Array.isArray(w.editions),'Complete source, entries, operations and editions are required.');
    const shots=new Map();
    for(const raw of w.snapshots){const s=snapshot(raw);need(!shots.has(s.id),'Repeated source snapshot.');shots.set(s.id,s);}
    const ids=new Set();
    for(const e of w.entries){
      need(object(e)&&e.id===entryId(e.source_key,e.record_key)&&!ids.has(e.id),'Invalid or repeated entry identity.');ids.add(e.id);
      need(['active','withdrawn'].includes(e.disposition),'Invalid editorial disposition.');
      const s=shots.get(e.baseline_snapshot);need(s&&s.source.key===e.source_key,'Entry baseline source is missing.');
      const r=s.records.find(x=>x.key===e.record_key);need(r&&r.url===e.source_url,'Entry original URL changed without a received source.');
      need(object(e.field_sources)&&object(e.baseline),'Retain complete field-level source provenance.');
      need(same(Object.keys(e.baseline).sort(),Object.keys(e.field_sources).sort()),'Each baseline field needs its original source.');
      for(const [f,sourceId] of Object.entries(e.field_sources)){need(SOURCE_FIELDS.includes(f),'Unknown baseline field.');const shot=shots.get(sourceId),record=shot?.records.find(x=>x.key===e.record_key);need(shot?.source.key===e.source_key&&record&&own(record.values,f)&&same(record.values[f],e.baseline[f]),'Field baseline differs from its exact original source: '+f);}
      values(e.baseline,true);values(e.current);
      need(Array.isArray(e.field_history),'Complete entry history is required.');
      for(const h of e.field_history){need(object(h)&&FIELDS.includes(h.field)&&typeof h.actor==='string'&&typeof h.operation_id==='string','Invalid field history.');need(object(h.before)&&object(h.after),'Complete changed field values required.');canonical(h);}
    }
    const operations=new Set();
    for(const o of w.operations){meta(o);need(!operations.has(o.id),'Repeated operation ID.');operations.add(o.id);need(typeof o.kind==='string'&&typeof o.request_hash==='string'&&typeof o.after_revision==='number','Invalid operation history.');}
    for(const e of w.editions){need(object(e)&&typeof e.id==='string'&&typeof e.title==='string'&&object(e.working),'Complete named edition required.');const body=copy(e.working);need(body.editions.length===0,'Named editions cannot recursively contain editions.');validateWorkspace(body);need(e.id===digest({title:e.title,working:body,actor:e.actor,at:e.at}),'Named edition changed.');}
    if(w.target!==null){validateTarget(w.target);for(const id of Object.keys(w.target.entry_mappings||{}))need(ids.has(id),'Target mapping references an unknown original entry.');}
    if(w.pending!==null){need(object(w.pending)&&object(w.pending.snapshot)&&object(w.pending.choices),'Complete unfinished receiving work required.');snapshot(w.pending.snapshot);need(typeof w.pending.note==='string','Receiving note must be text.');}
    return w;
  }
  function createWorkspace({id,title},m){
    m=meta(m);key(id,'Collection ID');text(title,'Collection title');
    return seal({schema:SCHEMA,id,title,revision:0,created_at:m.at,created_by:m.actor,snapshots:[],entries:[],operations:[],editions:[],target:null,pending:null});
  }
  function start(w,kind,request,m){
    w=validateWorkspace(w);m=meta(m);const requestHash=digest({kind,request});const previous=w.operations.find(x=>x.id===m.id);
    if(previous){need(previous.kind===kind&&previous.request_hash===requestHash,'Operation ID already identifies different work.');return {w,replay:true,m,requestHash};}
    return {w,replay:false,m,requestHash};
  }
  function finish(t,kind,detail={}){
    t.w.revision++;t.w.operations.push({...t.m,kind,request_hash:t.requestHash,after_revision:t.w.revision,detail:copy(detail)});return seal(t.w);
  }
  function rememberSnapshot(w,s){if(!w.snapshots.some(x=>x.id===s.id))w.snapshots.push(copy(s));}
  function previewImport(input,incoming){
    const w=validateWorkspace(input),s=snapshot(incoming),rows=[],seen=new Set();
    for(const r of s.records){
      const id=entryId(s.source.key,r.key),e=w.entries.find(x=>x.id===id);seen.add(id);
      if(!e){rows.push({id,key:r.key,url:r.url,kind:'new',incoming:copy(r.values),fields:[]});continue;}
      const fields=[];
      for(const f of Object.keys(r.values)){
        const base=present(e.baseline,f),local=present(e.current,f),next=present(r.values,f);
        if(same(local,next))continue;
        const sourceChanged=!same(base,next),localChanged=!same(base,local);
        if(sourceChanged)fields.push({field:f,base,local,incoming:next,conflict:localChanged,choice_key:id+':'+f});
      }
      rows.push({id,key:r.key,url:r.url,kind:e.disposition==='withdrawn'?'withdrawn':fields.some(x=>x.conflict)?'conflict':fields.length?'updated':'unchanged',fields,incoming:copy(r.values),source_url_changed:e.source_url!==r.url});
    }
    for(const e of w.entries.filter(x=>x.source_key===s.source.key&&!seen.has(x.id))){
      const baseline=w.snapshots.find(x=>x.id===e.baseline_snapshot);
      const covered=s.source.coverage==='complete'&&baseline.source.scope_id===s.source.scope_id&&same(baseline.source.selection,s.source.selection);
      rows.push({id:e.id,key:e.record_key,url:e.source_url,kind:covered?'absent-in-complete-selection':'not-observed',fields:[],choice_key:e.id+':presence'});
    }
    const body={schema:'tjlabs.event-collection-import/v1',workspace_id:w.id,basis:w.seal,revision:w.revision,snapshot:s,rows};
    return {...body,id:digest(body)};
  }
  function verifyPlan(w,p){need(object(p)&&p.schema==='tjlabs.event-collection-import/v1','Select a complete import review.');need(p.basis===w.seal,'Collection changed. Prepare the review again before applying.');const fresh=previewImport(w,p.snapshot);need(same(fresh,p),'Import review differs from the exact current source comparison.');return fresh;}
  function changed(e,f,next,m,reason,snapshotId){
    const before=present(e.current,f);if(same(before,next))return;
    if(next.present)e.current[f]=copy(next.value);else delete e.current[f];
    e.field_history.push({field:f,before,after:copy(next),actor:m.actor,at:m.at,operation_id:m.id,reason,source_snapshot:snapshotId});
  }
  function applyImport(input,plan,choices,m){
    need(object(choices),'Choose how to resolve the import review.');
    const t=start(input,'receive-source',{plan_id:plan?.id,choices},m);if(t.replay)return t.w;
    const p=verifyPlan(t.w,plan),s=p.snapshot;const allowed=new Set();
    for(const row of p.rows){for(const f of row.fields)allowed.add(f.choice_key);if(['absent-in-complete-selection','withdrawn'].includes(row.kind))allowed.add(row.id+':presence');}
    for(const k of Object.keys(choices))need(allowed.has(k),'Choice is not part of this original review: '+k);
    rememberSnapshot(t.w,s);
    for(const row of p.rows){
      let e=t.w.entries.find(x=>x.id===row.id);
      if(row.kind==='new'){
        const r=s.records.find(x=>x.key===row.key);
        t.w.entries.push({id:row.id,source_key:s.source.key,record_key:r.key,source_url:r.url,baseline_snapshot:s.id,baseline:copy(r.values),field_sources:Object.fromEntries(Object.keys(r.values).map(f=>[f,s.id])),current:copy(r.values),disposition:'active',field_history:[]});continue;
      }
      if(row.kind==='not-observed')continue;
      if(row.kind==='absent-in-complete-selection'){
        const c=choices[row.id+':presence'];need(['KEEP','WITHDRAW'].includes(c),'Choose Keep or Withdraw for '+row.key);
        if(c==='WITHDRAW')e.disposition='withdrawn';continue;
      }
      if(row.kind==='withdrawn'){
        const c=choices[row.id+':presence'];need(['KEEP_WITHDRAWN','RESTORE'].includes(c),'Choose whether to restore the withdrawn entry '+row.key);
        if(c==='RESTORE')e.disposition='active';
      }
      for(const f of row.fields){
        const c=choices[f.choice_key]??(f.conflict?null:'INCOMING');need(['LOCAL','INCOMING'].includes(c),'Resolve '+row.key+' / '+f.field);
        if(c==='INCOMING')changed(e,f.field,f.incoming,t.m,'received-source',s.id);
      }
      const r=s.records.find(x=>x.key===row.key);
      e.baseline_snapshot=s.id;for(const [f,value] of Object.entries(r.values)){e.baseline[f]=copy(value);e.field_sources[f]=s.id;}e.source_url=r.url;
    }
    t.w.pending=null;return finish(t,'receive-source',{snapshot_id:s.id,selection:s.source.selection,rows:p.rows.map(x=>({id:x.id,kind:x.kind})),choices});
  }
  function editEntry(input,entry,patch,m){
    values(patch);const t=start(input,'edit-entry',{entry,patch},m);if(t.replay)return t.w;
    const e=t.w.entries.find(x=>x.id===entry);need(e,'Original entry not found.');
    for(const [f,v]of Object.entries(patch))changed(e,f,{present:true,value:v},t.m,'editor',null);
    return finish(t,'edit-entry',{entry,fields:Object.keys(patch)});
  }
  function disposition(input,entry,value,m){
    need(['active','withdrawn'].includes(value),'Choose active or withdrawn.');
    const t=start(input,'entry-disposition',{entry,value},m);if(t.replay)return t.w;const e=t.w.entries.find(x=>x.id===entry);need(e,'Original entry not found.');e.disposition=value;return finish(t,'entry-disposition',{entry,value});
  }
  function retainImport(input,incoming,choices,note,m){
    const s=snapshot(incoming);need(object(choices),'Choices must be an object.');text(note,'Receiving note',true);
    const t=start(input,'save-import-work',{snapshot:s,choices,note},m);if(t.replay)return t.w;
    t.w.pending={snapshot:s,choices:copy(choices),note};return finish(t,'save-import-work',{snapshot_id:s.id});
  }
  function validateTarget(target){
    need(object(target),'Select a target export.');need(['portable-json','event-csv','icalendar','tec-csv','tec-staging'].includes(target.adapter),'Unsupported target export.');
    text(target.name,'Target name');if(own(target,'id'))key(target.id,'Target identity');if(own(target,'timezone'))need(target.timezone===null||typeof target.timezone==='string','Target timezone must be explicit text or null.');need(object(target.mapping),'Complete field mapping required.');
    for(const [from,to]of Object.entries(target.mapping)){need(FIELDS.includes(from),'Unknown source field mapping '+from);need(to===null||(typeof to==='string'&&to.trim()),'Mapping must be a nonempty target field or explicit omitted null.');}
    const used=Object.values(target.mapping).filter(x=>x!==null);need(new Set(used).size===used.length,'Several source fields map to one target field.');
    if(target.adapter==='tec-staging'){url(target.base_url,'Selected staging URL');need(target.environment==='staging','Select the actual staging environment.');need(object(target.capabilities),'Retain the actual selected target schema/capabilities.');}
    if(own(target,'timezone_policy'))need(['preserve','override'].includes(target.timezone_policy),'Select preserve or override timezone policy.');
    if(own(target,'entry_mappings')){need(object(target.entry_mappings),'Target entry mappings must be keyed by original entry IDs.');for(const [id,mapping] of Object.entries(target.entry_mappings)){key(id,'Mapped entry ID');need(object(mapping),'Complete entry mapping required.');canonical(mapping);}}
    canonical(target);return target;
  }
  function setTarget(input,target,m){validateTarget(target);const t=start(input,'target-mapping',target,m);if(t.replay)return t.w;for(const id of Object.keys(target.entry_mappings||{}))need(t.w.entries.some(e=>e.id===id),'Target mapping references an unknown original entry.');t.w.target=copy(target);return finish(t,'target-mapping',{adapter:target.adapter});}
  function saveEdition(input,title,m){
    text(title,'Edition title');const t=start(input,'save-edition',{title},m);if(t.replay)return t.w;
    const working=seal({...stateBody(t.w),editions:[]});const e={title,actor:t.m.actor,at:t.m.at,working};e.id=digest(e);t.w.editions.push(e);return finish(t,'save-edition',{edition_id:e.id});
  }
  function restoreEdition(input,id,m){
    const t=start(input,'restore-edition',{id},m);if(t.replay)return t.w;
    const e=t.w.editions.find(x=>x.id===id);need(e,'Named edition not found.');
    const prior=seal({...stateBody(t.w),editions:[]}),backup={title:'Before reopening '+e.title,actor:t.m.actor,at:t.m.at,working:prior};backup.id=digest(backup);
    const all=[...t.w.editions,backup],history=t.w.operations,revision=t.w.revision;
    t.w={...stateBody(validateWorkspace(e.working)),editions:all,operations:history,revision};return finish(t,'restore-edition',{edition_id:id,preserved_current:backup.id});
  }
  function exportArchive(w){w=validateWorkspace(w);return canonical({schema:'tjlabs.event-collection-archive/v1',workspace:w});}
  function openArchive(raw){text(raw,'Complete working archive');const p=JSON.parse(raw);need(p.schema==='tjlabs.event-collection-archive/v1','Select an event collection archive.');return validateWorkspace(p.workspace);}
  function projection(input){
    const w=validateWorkspace(input);return {schema:'tjlabs.event-collection-export/v1',workspace_id:w.id,revision:w.revision,workspace_seal:w.seal,target:copy(w.target),sources:w.snapshots.map(s=>({id:s.id,...copy(s.source)})),records:w.entries.map(e=>({id:e.id,source_key:e.source_key,source_record_key:e.record_key,source_url:e.source_url,source_snapshot:e.baseline_snapshot,field_sources:copy(e.field_sources),disposition:e.disposition,values:copy(e.current),original_values:copy(e.baseline),field_history:copy(e.field_history)}))};
  }
  return {SCHEMA,SOURCE,SOURCE_FIELDS,FIELDS,canonical,digest,same,snapshot,createWorkspace,validateWorkspace,previewImport,applyImport,editEntry,disposition,retainImport,setTarget,saveEdition,restoreEdition,exportArchive,openArchive,projection};
}
module.exports={createEventCollectionModel};
