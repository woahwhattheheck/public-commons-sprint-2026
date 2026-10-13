// SPDX-License-Identifier: MIT
import {Sha256} from './operations_installation_source_hash.mjs';
export const SCHEMA='stellar-forge.gravitee-source-working-copies.v1';
export const COPY='stellar-forge.gravitee-source-working-copy.v1';
export const clone=value=>structuredClone(value);
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const need=(ok,message)=>{if(!ok)throw new Error(message);};
export const canonical=v=>JSON.stringify(v,(_,x)=>obj(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const same=(a,b)=>canonical(a)===canonical(b);
export const utf8=text=>new TextEncoder().encode(text);
export const hashText=text=>new Sha256().update(utf8(text)).hex();
export const identity=text=>({bytes:utf8(text).length,sha256:hashText(text)});
export const refKey=r=>r.kind+'/'+r.id;
export function sourceOriginal(metadata,raw,report){
 need(obj(metadata)&&typeof raw==='string'&&obj(report),'Receive the complete original source and report.');
 const actual=identity(raw);
 need(actual.bytes===metadata.bytes&&actual.sha256===metadata.sha256&&same(actual,report.file),'Original handover bytes do not match the source receipt.');
 const p=JSON.parse(raw.replace(/^\uFEFF/,''));
 need(Array.isArray(p.files)&&p.includeSoftware===true&&Array.isArray(report.cohort)&&Array.isArray(report.members),'Retain the whole source-bearing handover and native inventory.');
 const seen=new Set();
 for(const row of report.cohort){const k=refKey(row.reference);need(!seen.has(k),'Duplicate native cohort identity.');seen.add(k);}
 return {metadata:clone(metadata),raw,report:clone(report)};
}
export function initialSelection(source){
 return {schema:'stellar-forge.gravitee-installation-selection.v1',workspaceId:source.report.package.workspaceId,
 handover:{sourceId:source.metadata.id,bytes:source.metadata.bytes,sha256:source.metadata.sha256},
 cohort:source.report.cohort.map(row=>({reference:clone(row.reference),included:true,stage:'unassigned',purpose:''}))};
}
export function newCopy({id,name,scope,source,at}){
 need(typeof id==='string'&&id.length>10&&typeof name==='string'&&name.trim()&&name.length<=300,'Name this complete working copy.');
 return {schema:COPY,id,name,scope:clone(scope),createdAt:at,updatedAt:at,source:clone(source),selection:initialSelection(source),
 bindings:null,document:null,pending:null,prepared:null,cohortAttachment:null,comparison:null,history:[],notes:''};
}
export function checkpoint(value,label,at){
 const next=clone(value),snapshot=clone(value);delete snapshot.history;delete snapshot.comparison;
 need(next.history.length<500,'Retain this complete history and fork another named copy.');
 next.history.push({label,at,sha256:hashText(canonical(snapshot)),snapshot});
 next.updatedAt=at;return next;
}
function validateRef(r){
 need(obj(r)&&['draft','commissioning'].includes(r.kind)&&/^[a-f0-9]{24}$/.test(r.id)&&
 Number.isSafeInteger(r.revision)&&r.revision>0&&/^[a-f0-9]{64}$/.test(r.sha256),'Retain a full original native reference.');
}
export function validateCopy(value,{history=true}={}){
 need(obj(value)&&value.schema===COPY&&typeof value.id==='string'&&typeof value.name==='string'&&value.name.length<=300&&
 obj(value.scope)&&typeof value.scope.caseId==='string','Use a complete named original working copy.');
 sourceOriginal(value.source.metadata,value.source.raw,value.source.report);
 const selected=value.selection,source=value.source;
 need(obj(selected)&&selected.schema==='stellar-forge.gravitee-installation-selection.v1'&&
 selected.workspaceId===source.report.package.workspaceId&&same(selected.handover,{sourceId:source.metadata.id,bytes:source.metadata.bytes,sha256:source.metadata.sha256})&&
 Array.isArray(selected.cohort)&&selected.cohort.length===source.report.cohort.length,'The selected cohort must preserve the full original source.');
 const seen=new Set(),original=new Map(source.report.cohort.map(x=>[refKey(x.reference),x]));
 for(const row of selected.cohort){
  validateRef(row.reference);const key=refKey(row.reference);
  need(!seen.has(key)&&same(original.get(key)?.reference,row.reference),'The complete cohort selection changed its original native references.');seen.add(key);
  need(typeof row.included==='boolean'&&['staging','production','other','unassigned'].includes(row.stage)&&typeof row.purpose==='string'&&row.purpose.length<=4000,'Retain every complete or unfinished cohort decision.');
 }
 need(typeof value.notes==='string'&&value.notes.length<=16000&&Array.isArray(value.history)&&value.history.length<=500,'Retain the complete bounded notes and history.');
 if(history)for(const entry of value.history){
  need(obj(entry)&&entry.sha256===hashText(canonical(entry.snapshot)),'A saved working-copy history changed.');
  validateCopy({...entry.snapshot,history:[]},{history:false});
 }
 if(value.comparison){
  const c=value.comparison;sourceOriginal(c.source.metadata,c.source.raw,c.source.report);
  need(c.baseSha256===hashText(canonical({source:value.source.metadata.sha256,selection:value.selection})),'Recompare the changed original cohort before carrying choices.');
  const expected=compareEdition({...value,comparison:null},c.source);
  need(Array.isArray(c.rows)&&c.rows.length===expected.rows.length&&same(c.members,expected.members),'Retain the complete original comparison.');
  c.rows.forEach((row,i)=>{const {choice,...body}=row;const {choice:unused,...original}=expected.rows[i];
   need(same(body,original)&&[null,'','KEEP','RESET','ACK_REMOVED'].includes(choice),'A source comparison changed its original records or decisions.');});
 }
 if(value.pending){
  const p=value.pending,b=p.body,d=b?.data;
  need(obj(p)&&typeof p.raw==='string'&&same(identity(p.raw),p.identity)&&p.raw===JSON.stringify(value.selection,null,2)+'\n','Retain the exact original attachment and selected cohort.');
  need(obj(b)&&Object.keys(b).every(k=>['requestId','expectedVersion','actor','action','note','data'].includes(k))&&
   typeof b.requestId==='string'&&/^[a-f0-9-]{36}$/.test(b.requestId)&&Number.isSafeInteger(b.expectedVersion)&&b.expectedVersion>0&&
   typeof b.actor==='string'&&b.actor.length<=300&&b.action==='source.add'&&typeof b.note==='string'&&b.note.length<=4000&&
   obj(d)&&Object.keys(d).every(k=>['filename','mediaType','kind','contentBase64','observedAt'].includes(k))&&
   d.filename==='Gravitee_Selected_Cohort.json'&&d.mediaType==='application/json'&&d.kind==='deployment'&&
   typeof d.contentBase64==='string'&&typeof d.observedAt==='string','Only the exact original cohort source attachment can be recovered.');
  const bytes=Uint8Array.from(atob(d.contentBase64),c=>c.charCodeAt(0));
  need(bytes.length===p.identity.bytes&&new Sha256().update(bytes).hex()===p.identity.sha256,'The original source command differs from its retained cohort bytes.');
 }
 return value;
}
export function compareEdition(value,nextSource){
 validateCopy({...value,comparison:null});sourceOriginal(nextSource.metadata,nextSource.raw,nextSource.report);
 need(value.source.report.package.workspaceId===nextSource.report.package.workspaceId,'A different native workspace starts a separate working copy.');
 const old=new Map(value.source.report.cohort.map(x=>[refKey(x.reference),x]));
 const current=new Map(nextSource.report.cohort.map(x=>[refKey(x.reference),x]));
 const choices=new Map(value.selection.cohort.map(x=>[refKey(x.reference),x]));
 const rows=[...new Set([...old.keys(),...current.keys()])].sort().map(key=>{
  const before=old.get(key),after=current.get(key),state=!before?'ADDED':!after?'REMOVED':same(before.reference,after.reference)?'UNCHANGED':'CHANGED';
  return {key,state,before:before??null,after:after??null,decision:clone(choices.get(key)??null),choice:state==='UNCHANGED'?'KEEP':null};
 });
 const prior=new Map(value.source.report.members.map(x=>[x.path,x])),later=new Map(nextSource.report.members.map(x=>[x.path,x]));
 const members=[...new Set([...prior.keys(),...later.keys()])].sort().map(path=>({path,before:prior.get(path)??null,after:later.get(path)??null,
 state:!prior.has(path)?'ADDED':!later.has(path)?'REMOVED':same(prior.get(path),later.get(path))?'UNCHANGED':'CHANGED'}));
 return {source:clone(nextSource),baseSha256:hashText(canonical({source:value.source.metadata.sha256,selection:value.selection})),rows,members};
}
export function applyComparison(value,at){
 validateCopy(value);const c=value.comparison;need(c,'Compare the whole incoming edition first.');
 const next=checkpoint(value,'Before applying complete later source',at),by=new Map(c.rows.map(x=>[x.key,x]));
 for(const row of c.rows)need(row.state==='UNCHANGED'&&row.choice==='KEEP'||
 row.state==='REMOVED'&&row.choice==='ACK_REMOVED'||
 row.state==='ADDED'&&row.choice==='RESET'||
 row.state==='CHANGED'&&['KEEP','RESET'].includes(row.choice),'Resolve every changed, added and removed original record explicitly.');
 next.source=clone(c.source);next.selection=initialSelection(c.source);
 next.selection.cohort=next.selection.cohort.map(row=>{
  const original=by.get(refKey(row.reference));
  return original.choice==='KEEP'&&original.decision?{...clone(original.decision),reference:row.reference}:row;
 });
 next.comparison=null;next.prepared=null;next.cohortAttachment=null;next.bindings=null;
 return next;
}
export function completeSelection(value){
 validateCopy(value);
 need(value.selection.cohort.some(x=>x.included),'Select a complete useful API cohort.');
 for(const row of value.selection.cohort)need(row.purpose.trim()&&(!row.included||row.stage!=='unassigned'),'Give every record its purpose/exclusion reason and every included record its environment role.');
 return JSON.stringify(value.selection,null,2)+'\n';
}
export function validateArchive(raw){
 need(typeof raw==='string'&&utf8(raw).length<=64*1024*1024,'Receive the whole working-copy JSON within 64 MiB.');
 const v=JSON.parse(raw);need(v.schema===SCHEMA&&Array.isArray(v.copies)&&v.copies.length<=100,'Use the complete named working-copy archive.');
 const ids=new Set();for(const c of v.copies){validateCopy(c);need(!ids.has(c.id),'Duplicate complete working-copy identity.');ids.add(c.id);}
 return v;
}
export function archive(copies,selected){
 const raw=JSON.stringify({schema:SCHEMA,copies,selected},null,2)+'\n';validateArchive(raw);return raw;
}
export function mergeCopies(current,incoming,{forkConflict=false,newId=()=>crypto.randomUUID()}={}){
 const result=clone(current),known=new Map(result.map(x=>[x.id,x]));
 for(const candidate of incoming){
  const previous=known.get(candidate.id);
  if(previous){if(!same(previous,candidate)){need(forkConflict,'A same-ID working copy has different complete content. Select receive as separate copies.');const fork=clone(candidate);fork.id=newId();fork.name+=' · received alternative';result.push(fork);known.set(fork.id,fork);}}
  else {result.push(clone(candidate));known.set(candidate.id,candidate);}
 }
 archive(result,null);return result;
}
export async function openStore(key){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('sf47-gravitee-source-desk',1);r.onupgradeneeded=()=>r.result.createObjectStore('work');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const read=()=>new Promise((resolve,reject)=>{const tx=db.transaction('work','readonly'),r=tx.objectStore('work').get(key);r.onsuccess=()=>resolve(r.result??{revision:0,copies:[],selected:null});r.onerror=()=>reject(r.error);});
 const write=(expected,value)=>new Promise((resolve,reject)=>{
  const tx=db.transaction('work','readwrite'),store=tx.objectStore('work'),r=store.get(key);let result,problem;
  r.onsuccess=()=>{const before=r.result??{revision:0,copies:[],selected:null};if(before.revision!==expected){problem=new Error('Another tab saved a complete working copy. Keep/download your current work, then reopen the current store or fork it.');problem.code='GRAVITEE_COPY_CONFLICT';tx.abort();return;}
   try{archive(value.copies,value.selected);result={...clone(value),revision:expected+1};store.put(result,key);}catch(error){problem=error;tx.abort();}};
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(problem||tx.error||new Error('Working-copy save was interrupted.'));tx.onerror=()=>{};
 });
 return {read,write,close:()=>db.close()};
}
