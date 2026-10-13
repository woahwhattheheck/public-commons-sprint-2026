/** Complete scientist-authored document and portable working-copy validation. */
export const DOCUMENT_SCHEMA='upstate.scientific-synthesis-document/v1';
export const WORK_SCHEMA='upstate.scientific-synthesis-working/v1';
export const WORK_BYTES=16*1024*1024;
export const KINDS=['finding','interpretation','limitation','next-work'];
const clone=v=>JSON.parse(JSON.stringify(v));
export const stableJSON=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const object=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error(label+' must be an object.');return v;};
const text=(v,label,required=false)=>{if(typeof v!=='string'||v.length>1000000||v.includes('\u0000'))throw Error(label+' must be ordinary text.');if(required&&!v.trim())throw Error('Enter '+label.toLowerCase()+'.');return v;};
const id=(v,label)=>{if(typeof v!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(v))throw Error(label+' is invalid.');return v;};
const hash=(v,label)=>{if(typeof v!=='string'||! /^[a-f0-9]{64}$/.test(v))throw Error(label+' is invalid.');return v;};
export function validateDocument(input,{complete=false}={}){
 const v=clone(object(input,'Document'));
 if(v.schema!==DOCUMENT_SCHEMA)throw Error('Open an original scientist-authored document.');
 id(v.series_id,'Series identity');
 for(const k of ['title','revision_name','question','scope','change_note'])text(v[k],k.replaceAll('_',' '),complete&&['title','revision_name','question'].includes(k));
 object(v.author,'Author');for(const k of ['name','organization','email'])text(v.author[k],'Author '+k,complete&&k==='name');
 if(!Array.isArray(v.sources))throw Error('Retain the ordered original source choices.');
 const pairs=new Set();
 for(const s of v.sources){object(s,'Source');hash(s.source_collection_id,'Source collection');text(s.source_id,'Source ID',true);const key=JSON.stringify([s.source_collection_id,s.source_id]);if(pairs.has(key))throw Error('Choose each source once.');pairs.add(key);}
 if(complete&&!v.sources.length)throw Error('Select at least one original scientific study.');
 if(!Array.isArray(v.sections))throw Error('Retain the authored sections.');
 const ids=new Set();let findings=0;
 for(const s of v.sections){object(s,'Section');id(s.id,'Section identity');if(ids.has(s.id))throw Error('Section identities must be unique.');ids.add(s.id);if(!KINDS.includes(s.kind))throw Error('Choose a supported authored section kind.');
  text(s.heading,'Section heading',complete);text(s.text,'Section text',complete);
  if(!Array.isArray(s.reference_ids)||s.reference_ids.some(x=>typeof x!=='string'||!x)||new Set(s.reference_ids).size!==s.reference_ids.length)throw Error('Keep distinct exact source references.');
  if(s.kind==='finding'){findings++;if(complete&&!s.reference_ids.length)throw Error('Link each finding to at least one original source section, figure or member.');}}
 if(complete&&!findings)throw Error('Write at least one finding with an original source reference.');
 if(new TextEncoder().encode(JSON.stringify(v)).length>8*1024*1024)throw Error('A saved authored document supports up to 8 MiB of complete UTF-8 text.');
 return v;
}
export function blankDocument({seriesId,sources=[]}){
 return {schema:DOCUMENT_SCHEMA,series_id:seriesId,title:'',revision_name:'First edition',question:'',scope:'',change_note:'',author:{name:'',organization:'TJ Labs',email:''},sources:clone(sources),sections:[]};
}
export function validateReferences(document,catalog){
 object(catalog,'Reference catalog');hash(catalog.catalog_sha256,'Catalog identity');
 const selected=new Set(document.sources.map(s=>JSON.stringify([s.source_collection_id,s.source_id])));
 const refs=new Map((catalog.references||[]).map(r=>[r.id,r]));
 for(const s of document.sections)for(const id of s.reference_ids){const r=refs.get(id);if(!r||!selected.has(JSON.stringify([r.source_collection_id,r.source_id])))throw Error('A finding references another source edition. Refresh and explicitly select its original reference.');}
 return document;
}
export function validateWorking(value){
 const v=clone(object(value,'Working copy'));
 if(v.schema!==WORK_SCHEMA)throw Error('Open the complete synthesis working-copy file.');
 text(v.project_id,'Original project',true);validateDocument(v.document);
 if(v.base_collection_id!==null)hash(v.base_collection_id,'Prior authored collection');
 if(v.catalog!==null)object(v.catalog,'Retained catalog');
 if(!Array.isArray(v.import_history))throw Error('Retain working-copy import history.');
 if(v.pending!==null){const p=object(v.pending,'Original request');id(p.operation_id,'Original request ID');object(p.payload,'Original request body');
  if(p.action!=='source-reports.synthesis-save'||p.payload.operation_id!==p.operation_id)throw Error('The retained request identity differs.');
  validateDocument(p.payload.document,{complete:true});hash(p.payload.catalog_sha256,'Original source catalog');
  if(p.payload.base_collection_id!==null)hash(p.payload.base_collection_id,'Original prior collection');
  if(p.task_id!==null&&typeof p.task_id!=='string')throw Error('Retain the accepted original task ID.');
  if(stableJSON(p.payload.document)!==stableJSON(v.document)||p.payload.base_collection_id!==v.base_collection_id||p.payload.catalog_sha256!==v.catalog?.catalog_sha256)throw Error('The complete working copy differs from its retained original save request.');}
 const bytes=new TextEncoder().encode(JSON.stringify(v,null,2)+'\n').length;
 if(bytes>WORK_BYTES)throw Error('The complete portable working copy exceeds the visible 16 MiB limit.');
 return v;
}
export function importWorking(current,incoming,{projectId,at}){
 const next=validateWorking(incoming);if(next.project_id!==projectId)throw Error('This working copy belongs to a different original project.');
 if(current?.pending&&stableJSON(current.pending)!==stableJSON(next.pending))throw Error('Recover the current original request before replacing this working copy.');
 next.import_history.push({at,previous:current?clone(current):null});
 return validateWorking(next);
}
