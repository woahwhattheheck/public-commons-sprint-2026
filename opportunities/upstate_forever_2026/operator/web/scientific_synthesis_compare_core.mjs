import {stableJSON,validateDocument,validateReferences} from './scientific_synthesis_core.mjs';
export const COMPARISON_SCHEMA='upstate.scientific-synthesis-comparison/v1';
export const COMPARISON_BYTES=64*1024*1024;
const clone=v=>JSON.parse(JSON.stringify(v));
const eq=(a,b)=>stableJSON(a)===stableJSON(b);
const object=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error(label+' must be a complete object.');return v;};
const sha=(v,label)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw Error(label+' must retain its original SHA-256 identity.');return v;};
const pair=s=>JSON.stringify([s.source_collection_id,s.source_id]);
const keys=(a,b)=>[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const bytes=s=>new TextEncoder().encode(s).length;
const changes=(a,b)=>keys(a,b).filter(k=>!eq(a[k],b[k])).map(k=>({field:k,before_present:own(a,k),after_present:own(b,k),...(own(a,k)?{before:clone(a[k])}:{}),...(own(b,k)?{after:clone(b[k])}:{})}));
function catalog(value,doc){
 object(value,'Original reference catalog');sha(value.catalog_sha256,'Catalog');
 if(!Array.isArray(value.sources)||!Array.isArray(value.references))throw Error('Retain all original source and reference rows.');
 if(!eq(value.sources.map(pair),doc.sources.map(pair)))throw Error('The catalog source order differs from its authored document.');
 const sources=new Set(value.sources.map(pair)),refs=new Set();
 for(const row of value.references){object(row,'Reference');sha(row.id,'Reference');if(refs.has(row.id)||!sources.has(pair(row)))throw Error('The catalog contains a repeated or unselected reference.');refs.add(row.id);}
 validateReferences(doc,value);return value;
}
export function validateEdition(value){
 const v=clone(object(value,'Authored edition'));sha(v.collection_id,'Collection');if(typeof v.source_id!=='string'||!v.source_id)throw Error('Retain the original authored source ID.');
 const r=object(v.record,'Authored record');
 if(r.schema!=='upstate.scientific-synthesis-record/v1'||typeof r.project_id!=='string'||!r.project_id||!Number.isSafeInteger(r.revision)||r.revision<1)throw Error('Retain the complete native authored record.');
 sha(r.revision_id,'Revision');validateDocument(r.document,{complete:true});catalog(v.catalog,r.document);
 if(!eq(r.catalog,v.catalog)||!Array.isArray(v.history)||v.history.length!==r.revision||!eq(v.history.at(-1),r))throw Error('The complete authored history or current catalog differs.');
 let previous=null;
 for(let i=0;i<v.history.length;i++){
  const h=object(v.history[i],'Historical edition');sha(h.revision_id,'Historical revision');sha(h.request_sha256,'Historical request');
  if(h.schema!==r.schema||h.revision!==i+1||h.project_id!==r.project_id||h.document?.series_id!==r.document.series_id||h.previous_revision_id!==previous)throw Error('Retain one complete original authored revision chain.');
  validateDocument(h.document,{complete:true});catalog(h.catalog,h.document);
  const q=object(h.request,'Original save request');
  if(q.operation_id!==h.operation_id||q.catalog_sha256!==h.catalog.catalog_sha256||q.base_collection_id!==h.previous_collection_id||!eq(q.document,h.document))throw Error('A historical request differs from its original authored record.');
  if(i===0&&h.previous_collection_id!==null)throw Error('A first authored edition must preserve its native null base.');
  if(i>0)sha(h.previous_collection_id,'Historical prior collection');
  previous=h.revision_id;
 }
 if(v.source&&(v.source.source_collection_id!==v.collection_id||v.source.source_id!==v.source_id))throw Error('The retained authored source selector differs.');
 return v;
}
function orderedRows(before,after,key){
 const a=new Map(before.map(x=>[key(x),x])),b=new Map(after.map(x=>[key(x),x]));
 if(a.size!==before.length||b.size!==after.length)throw Error('Distinct source identities are required for comparison.');
 return [...a.keys(),...[...b.keys()].filter(k=>!a.has(k))].map(id=>({id,status:!a.has(id)?'added':!b.has(id)?'removed':eq(a.get(id),b.get(id))?'unchanged':'changed',before:a.has(id)?clone(a.get(id)):null,after:b.has(id)?clone(b.get(id)):null}));
}
function lineage(a,b){
 const sameProject=a.record.project_id===b.record.project_id,sameSeries=a.record.document.series_id===b.record.document.series_id;
 let common=0;while(common<Math.min(a.history.length,b.history.length)&&eq(a.history[common],b.history[common]))common++;
 let relation='different-series';
 if(!sameProject)relation='different-projects';
 else if(sameSeries){
  if(a.record.revision_id===b.record.revision_id)relation=eq(a.record,b.record)?'same-edition':'conflicting-revision-identity';
  else if(common===a.history.length)relation='forward-revision';
  else if(common===b.history.length)relation='reverse-revision';
  else relation='divergent-history';
 }
 else if(b.record.document.fork_origin?.revision_id===a.record.revision_id)relation='explicit-fork-from-before';
 else if(a.record.document.fork_origin?.revision_id===b.record.revision_id)relation='explicit-fork-from-after';
 return {relation,same_project:sameProject,same_series:sameSeries,common_history_records:common,before_history_records:a.history.length,after_history_records:b.history.length};
}
export function compareAuthoredSections(beforeSections,afterSections,beforeReferences=[],afterReferences=[]){
 const ad={sections:beforeSections},bd={sections:afterSections};
 const am=new Map(ad.sections.map((s,i)=>[s.id,{s,i}])),bm=new Map(bd.sections.map((s,i)=>[s.id,{s,i}]));
 const sharedA=ad.sections.filter(s=>bm.has(s.id)).map(s=>s.id),sharedB=bd.sections.filter(s=>am.has(s.id)).map(s=>s.id);
 const positionsA=new Map(sharedA.map((id,i)=>[id,i])),positionsB=new Map(sharedB.map((id,i)=>[id,i]));
 const ar=new Map(beforeReferences.map(r=>[r.id,r])),br=new Map(afterReferences.map(r=>[r.id,r]));
 return [...am.keys(),...[...bm.keys()].filter(id=>!am.has(id))].map(id=>{
  const av=am.get(id),bv=bm.get(id),x=av?.s,y=bv?.s;
  const fields=x&&y?changes(x,y):[];
  const moved=!!(x&&y&&positionsA.get(id)!==positionsB.get(id));
  const refs=orderedRows((x?.reference_ids||[]).map(k=>ar.get(k)),(y?.reference_ids||[]).map(k=>br.get(k)),r=>r.id);
  return {id,status:!x?'added':!y?'removed':fields.length?'changed':moved?'reordered':'unchanged',moved,
   before_position:av?av.i+1:null,after_position:bv?bv.i+1:null,
   before:x?clone(x):null,after:y?clone(y):null,fields,
   reference_order_changed:!!(x&&y&&!eq(x.reference_ids,y.reference_ids)),
   references:refs};
 });
}
export function compareEditions({before,after}){
 const a=validateEdition(before),b=validateEdition(after),ad=a.record.document,bd=b.record.document;
 const sections=compareAuthoredSections(ad.sections,bd.sections,a.catalog.references,b.catalog.references);
 const headersA=Object.fromEntries(Object.entries(ad).filter(([k])=>k!=='sections'&&k!=='sources'));
 const headersB=Object.fromEntries(Object.entries(bd).filter(([k])=>k!=='sections'&&k!=='sources'));
 const sourceRows=orderedRows(a.catalog.sources,b.catalog.sources,pair),referenceRows=orderedRows(a.catalog.references,b.catalog.references,r=>r.id);
 const provenance=changes(
  Object.fromEntries(Object.entries(a.record).filter(([k])=>!['document','catalog','request'].includes(k))),
  Object.fromEntries(Object.entries(b.record).filter(([k])=>!['document','catalog','request'].includes(k))));
 return {schema:'upstate.scientific-synthesis-difference/v1',lineage:lineage(a,b),
  before:{collection_id:a.collection_id,source_id:a.source_id,revision_id:a.record.revision_id,project_id:a.record.project_id,series_id:ad.series_id,revision:a.record.revision,title:ad.title,edition:ad.revision_name,author:clone(ad.author),saved_at:a.record.saved_at},
  after:{collection_id:b.collection_id,source_id:b.source_id,revision_id:b.record.revision_id,project_id:b.record.project_id,series_id:bd.series_id,revision:b.record.revision,title:bd.title,edition:bd.revision_name,author:clone(bd.author),saved_at:b.record.saved_at},
  document_fields:changes(headersA,headersB),sections,
  sources:{order_changed:!eq(ad.sources.map(pair),bd.sources.map(pair)),rows:sourceRows},
  references:referenceRows,record_fields:provenance,
  counts:{added:sections.filter(x=>x.status==='added').length,removed:sections.filter(x=>x.status==='removed').length,changed:sections.filter(x=>x.status==='changed').length,reordered:sections.filter(x=>x.moved).length,unchanged:sections.filter(x=>x.status==='unchanged').length},
  interpretation:'This compares attributed authored text and retained evidence identities. It does not recompute scientific quantities or establish which interpretation is correct.'};
}
export async function hashText(text){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function comparisonText(value){const text=JSON.stringify(value,null,2)+'\n';if(bytes(text)>COMPARISON_BYTES)throw Error('The complete comparison supports 64 MiB of UTF-8 source. Retain the individual native source archives for larger histories.');return text;}
export async function createComparisonPackage({before,after}){
 const a=validateEdition(before),b=validateEdition(after),source_text=JSON.stringify({before:a,after:b});
 const v={schema:COMPARISON_SCHEMA,source_text,source_bytes:bytes(source_text),source_sha256:await hashText(source_text),comparison:compareEditions({before:a,after:b})};
 comparisonText(v);return v;
}
export async function openComparisonPackage(value){
 const v=clone(object(value,'Comparison file'));if(v.schema!==COMPARISON_SCHEMA||typeof v.source_text!=='string')throw Error('Open the complete authored comparison JSON.');
 comparisonText(v);sha(v.source_sha256,'Portable source');if(v.source_bytes!==bytes(v.source_text)||await hashText(v.source_text)!==v.source_sha256)throw Error('The full embedded edition source bytes changed.');
 const source=JSON.parse(v.source_text),comparison=compareEditions(source);
 if(!eq(comparison,v.comparison))throw Error('The saved comparison differs from its full original editions.');
 return {package:v,...source,comparison};
}
