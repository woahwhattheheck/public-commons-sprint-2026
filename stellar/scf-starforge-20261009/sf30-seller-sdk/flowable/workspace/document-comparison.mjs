// MIT. Exact selected-version comparison over the maintained Alfresco capture contract.
import {createHash} from 'node:crypto';
import {inspectAlfrescoDocument,documentMember,documentBytes,documentLosslessJSON} from './alfresco-document.mjs';
import {parseInterfaceJSON} from './interface-contract-v2.mjs';
import {readFlowableLosslessJSON} from '../native.mjs';
export const DOCUMENT_COMPARISON_SCHEMA='stellar-forge.document-comparison-source.v1';
export const DOCUMENT_COMPARISON_LIMITS=Object.freeze({pairs:50,sources:100,packet:64*1024*1024,selection:256*1024,fields:40});
const hash=v=>createHash('sha256').update(v).digest('hex');
const need=(v,m)=>{if(!v)throw Object.assign(new Error(m),{code:'FLOWABLE_DOCUMENT_COMPARISON_REQUIRED'});};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v,n=2000)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\u0000-\u001f\u007f]/.test(v);
const exact=(v,keys,label)=>{need(plain(v),label+' must be an object');for(const k of Object.keys(v))need(keys.includes(k),label+' contains unknown field '+k);};
const canonical=v=>JSON.stringify(v!==null&&typeof v==='object'?(Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))]))):v);
function packetJSON(text,label,maximum){need(typeof text==='string'&&Buffer.byteLength(text)<=maximum,label+' exceeds its declared bound');readFlowableLosslessJSON(text);const value=JSON.parse(text);need(plain(value),label+' must be an object');return value;}
function boundedMember(name,text,maximum){need(Buffer.byteLength(text)<=maximum,'Full member exceeds its declared bound');return{name,bytes:Buffer.byteLength(text),sha256:hash(text),mediaType:'application/json',contentBase64:Buffer.from(text,'utf8').toString('base64')};}
const decode=m=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(documentBytes(m));
function pointer(root,path){
 need(typeof path==='string'&&/^\/(?:version|content)(?:\/|$)/.test(path)&&path.length<=1000,'Select a version/content JSON pointer');
 let value=root;for(const raw of path.slice(1).split('/')){need(!/~(?:[^01]|$)/.test(raw),'Invalid JSON pointer');const key=raw.replace(/~1/g,'/').replace(/~0/g,'~');if(!plain(value)&&!Array.isArray(value)||!Object.hasOwn(value,key))return{present:false};value=value[key];}
 return{present:true,value};
}
function selectedIdentity(c){return{repositoryId:c.repository.id,repositoryBaseUrl:c.repository.baseUrl,nodeId:c.selection.nodeId,versionId:c.selection.versionId};}
function validateIdentity(v,label){exact(v,['repositoryId','repositoryBaseUrl','nodeId','versionId'],label);for(const k of Object.keys(v))need(text(v[k]),label+' '+k+' must be explicit');need(Object.keys(v).length===4,label+' requires all four original identity fields');}
function readValue(capture,path,type){
 const raw=pointer(capture.raw,path);if(!raw.present)return{present:false};
 if(type==='string')need(typeof raw.value==='string'&&Buffer.byteLength(raw.value)<=2048,'Selected field '+path+' is not a string');
 if(type==='boolean')need(typeof raw.value==='boolean','Selected field '+path+' is not boolean');
 if(type==='number')need(typeof raw.value==='number'&&Number.isFinite(raw.value),'Selected field '+path+' is not a finite original JSON number');
 if(type==='string-set')need(Array.isArray(raw.value)&&raw.value.length<=100&&raw.value.every(v=>typeof v==='string'&&Buffer.byteLength(v)<=256)&&Buffer.byteLength(JSON.stringify(raw.value))<=2048&&new Set(raw.value).size===raw.value.length,'Selected field '+path+' must contain unique strings');
 const exactValue=type==='number'?pointer(capture.lossless,path).value:type==='string-set'?[...raw.value].sort():raw.value;
 need(Buffer.byteLength(JSON.stringify(exactValue))<=4096,'Selected field '+path+' exceeds the bounded report value; retain the full source and select a smaller explicit field');return{present:true,type,value:exactValue};
}
function inspectSelection(selectionText){
 need(typeof selectionText==='string'&&Buffer.byteLength(selectionText)<=DOCUMENT_COMPARISON_LIMITS.selection,'Selection exceeds 256 KiB');
 const s=parseInterfaceJSON(selectionText,'document comparison selection');
 exact(s,['schema','key','label','scopeNote','fields','pairs'],'selection');
 need(s.schema==='stellar-forge.document-comparison-selection.v1'&&/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(s.key??'')&&text(s.label,250)&&text(s.scopeNote,4000),'Select a named comparison cohort and explicit sample scope');
 need(Array.isArray(s.fields)&&s.fields.length<=DOCUMENT_COMPARISON_LIMITS.fields,'At most forty explicit metadata fields are supported');
 const fieldKeys=new Set();for(const f of s.fields){exact(f,['key','label','source','target','type','required'],'field');need(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(f.key??'')&&!fieldKeys.has(f.key)&&text(f.label,200)&&['string','boolean','number','string-set'].includes(f.type)&&typeof f.required==='boolean','Invalid unique typed comparison field');fieldKeys.add(f.key);pointer({},f.source);pointer({},f.target);}
 need(Array.isArray(s.pairs)&&s.pairs.length>0&&s.pairs.length<=DOCUMENT_COMPARISON_LIMITS.pairs,'Select one to fifty explicit document pairs');
 const pairKeys=new Set(),sources=new Set(),targets=new Set();
 for(const p of s.pairs){
  exact(p,['key','label','source','target','sourceMember','targetMember'],'pair');
  need(/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(p.key??'')&&!pairKeys.has(p.key)&&text(p.label,250),'Invalid unique pair');pairKeys.add(p.key);
  validateIdentity(p.source,'source identity');validateIdentity(p.target,'target identity');
  const a=canonical(p.source),b=canonical(p.target);need(a!==b,'Source and target must be separately selected original versions');need(!sources.has(a)&&!targets.has(b),'A native version cannot be silently mapped to multiple pairs');sources.add(a);targets.add(b);
  for(const key of ['sourceMember','targetMember'])need(p[key]===null||typeof p[key]==='string'&&/^[A-Za-z][A-Za-z0-9_.-]{0,119}\.json$/.test(p[key]),'Capture member is a portable JSON name or explicit null');
 }
 return s;
}
export function inspectDocumentComparisonSource(sourceText){
 need(typeof sourceText==='string'&&Buffer.byteLength(sourceText)<=DOCUMENT_COMPARISON_LIMITS.packet,'Complete comparison source exceeds 64 MiB');
 const p=packetJSON(sourceText,'document comparison source',DOCUMENT_COMPARISON_LIMITS.packet);exact(p,['schema','selectionText','members'],'source');
 need(p.schema===DOCUMENT_COMPARISON_SCHEMA&&Array.isArray(p.members)&&p.members.length<=DOCUMENT_COMPARISON_LIMITS.sources,'Select the complete bounded comparison source');
 const selection=inspectSelection(p.selectionText),members=new Map();
 for(const m of p.members){need(text(m.name,125)&&!members.has(m.name),'Duplicate or missing source member');const body=decode(m);members.set(m.name,{member:m,text:body});}
 const used=new Set(),captures=new Map();
 for(const pair of selection.pairs)for(const side of ['source','target']){
  const name=pair[side+'Member'];if(name===null)continue;need(members.has(name),'Full selected capture is missing: '+name);used.add(name);
  let c=captures.get(name);if(!c){const entry=members.get(name),inspected=inspectAlfrescoDocument(entry.text),packet=packetJSON(entry.text,'original capture',16*1024*1024),before=packet.reads.find(x=>x.role==='selected-before'),lossless=documentLosslessJSON(before.body);
   const content={sha256:inspected.content.sha256,bytes:String(inspected.content.bytes),mimeType:inspected.content.mediaType};
   c={inspected,raw:{version:inspected.version,content},lossless:{version:lossless.entry,content},member:entry.member};captures.set(name,c);}
  need(canonical(selectedIdentity(c.inspected))===canonical(pair[side]),'Capture belongs to another selected repository/node/version: '+pair.key+' '+side);
 }
 need(used.size===members.size,'Every full source member must be referenced by the selected cohort');
 return{source:p,selection,captures,identity:{bytes:Buffer.byteLength(sourceText),sha256:hash(sourceText)}};
}
function analyse(inspected){
 const {selection,captures}=inspected,rows=[];
 for(const pair of selection.pairs){
  const source=captures.get(pair.sourceMember),target=captures.get(pair.targetMember),available=Boolean(source&&target);
  const row={key:pair.key,label:pair.label,source:pair.source,target:pair.target,sourceCapture:source?{name:source.member.name,bytes:source.member.bytes,sha256:source.member.sha256}:null,targetCapture:target?{name:target.member.name,bytes:target.member.bytes,sha256:target.member.sha256}:null,content:{status:available?(source.inspected.content.sha256===target.inspected.content.sha256&&source.inspected.content.bytes===target.inspected.content.bytes?'MATCH':'DIFFERENT'):'NOT_OBSERVED',source:source?{bytes:source.inspected.content.bytes,sha256:source.inspected.content.sha256}:null,target:target?{bytes:target.inspected.content.bytes,sha256:target.inspected.content.sha256}:null},fields:[]};
  for(const field of selection.fields){
   let a=null,b=null,error=null;try{if(source)a=readValue(source,field.source,field.type);if(target)b=readValue(target,field.target,field.type);}catch(e){error=e.message;}
   let status=!available?'NOT_OBSERVED':error?'TYPE_MISMATCH':!a.present||!b.present?(field.required?'REQUIRED_MISSING':a.present===b.present?'ABSENT_BOTH':'DIFFERENT'):canonical(a)===canonical(b)?'MATCH':'DIFFERENT';
   row.fields.push({key:field.key,label:field.label,type:field.type,sourcePath:field.source,targetPath:field.target,required:field.required,status,source:a,target:b,error});
  }
  row.status=!available?'NOT_OBSERVED':row.content.status==='MATCH'&&row.fields.every(f=>['MATCH','ABSENT_BOTH'].includes(f.status))?'MATCH':'REVIEW_REQUIRED';rows.push(row);
 }
 return{schema:'stellar-forge.document-comparison-report.v1',key:selection.key,label:selection.label,scopeNote:selection.scopeNote,source:inspected.identity,counts:{selected:rows.length,matched:rows.filter(x=>x.status==='MATCH').length,reviewRequired:rows.filter(x=>x.status==='REVIEW_REQUIRED').length,notObserved:rows.filter(x=>x.status==='NOT_OBSERVED').length},method:{content:'Complete captured bytes: SHA-256 and byte count; no text normalization or inferred transformation.',fields:'Only explicit selected field pairs; JSON numeric values retain the original lossless coefficient/exponent. Missing fields and type mismatches remain visible.',scope:'These observations cover only the selected pairs, not an exhaustive repository or migration.',consistency:'Each selected version retains matching before/after metadata and complete observed history pages. This is not an atomic repository snapshot or server attestation.',review:'Manual disposition does not change native documents or erase observed differences.'},rows};
}
export function analyseDocumentComparison(sourceText){const report=analyse(inspectDocumentComparisonSource(sourceText));need(Buffer.byteLength(JSON.stringify(report,null,2)+'\n')<=8*1024*1024,'Complete comparison report exceeds 8 MiB; split the selected cohort');return report;}
function inspectReview(reviewText,report){
 const r=parseInterfaceJSON(reviewText,'document comparison review');exact(r,['schema','sourceSha256','reportSha256','reviewer','reviewedAt','decisions'],'review');
 need(r.schema==='stellar-forge.document-comparison-review.v1'&&r.sourceSha256===report.source.sha256&&r.reportSha256===hash(JSON.stringify(report,null,2)+'\n'),'Review belongs to different original source/report');
 need(text(r.reviewer,200)&&text(r.reviewedAt,40)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.reviewedAt)&&Number.isFinite(Date.parse(r.reviewedAt))&&new Date(r.reviewedAt).toISOString()===r.reviewedAt,'Name the reviewer and actual timestamp');
 need(Array.isArray(r.decisions)&&r.decisions.length===report.rows.length,'Retain one explicit disposition for every selected pair');
 const rows=new Map(report.rows.map(x=>[x.key,x])),seen=new Set();
 for(const d of r.decisions){exact(d,['key','decision','note'],'decision');const row=rows.get(d.key);need(row&&!seen.has(d.key)&&['UNREVIEWED','ACCEPT_MATCH','ACCEPT_EXCEPTION','REJECT'].includes(d.decision)&&typeof d.note==='string'&&d.note.length<=4000,'Invalid complete row disposition');seen.add(d.key);if(d.decision==='ACCEPT_MATCH')need(row.status==='MATCH','Only an observed exact match can be accepted as a match');if(d.decision==='ACCEPT_EXCEPTION')need(row.status==='REVIEW_REQUIRED'&&d.note.trim().length>0,'An observed discrepancy and explicit reason are required');if(d.decision==='REJECT')need(d.note.trim().length>0,'Explain the rejection');}
 return r;
}
export function createDocumentComparisonDelivery({sourceText,reviewText=null}){
 const inspected=inspectDocumentComparisonSource(sourceText),report=analyse(inspected),reportText=JSON.stringify(report,null,2)+'\n';need(Buffer.byteLength(reportText)<=8*1024*1024,'Complete comparison report exceeds 8 MiB; split the selected cohort');const review=reviewText===null?null:inspectReview(reviewText,report);
 const delivery={schema:'stellar-forge.document-comparison-delivery.v1',source:boundedMember('comparison-source.json',sourceText,DOCUMENT_COMPARISON_LIMITS.packet),report:documentMember('comparison-report.json',reportText),review:review===null?null:documentMember('comparison-review.json',reviewText)};
 const text=JSON.stringify(delivery,null,2)+'\n';need(Buffer.byteLength(text)<=128*1024*1024,'Complete receiving delivery exceeds 128 MiB');return{delivery,text,bytes:Buffer.byteLength(text),sha256:hash(text),report,review};
}
export function inspectDocumentComparisonDelivery(deliveryText){
 need(typeof deliveryText==='string'&&Buffer.byteLength(deliveryText)<=128*1024*1024,'Delivery exceeds 128 MiB');const d=packetJSON(deliveryText,'document comparison delivery',128*1024*1024);exact(d,['schema','source','report','review'],'delivery');
 need(d.schema==='stellar-forge.document-comparison-delivery.v1','Select the original complete comparison delivery');
 const sourceText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(documentBytes(d.source,DOCUMENT_COMPARISON_LIMITS.packet)),reported=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(documentBytes(d.report,8*1024*1024)),report=analyseDocumentComparison(sourceText);
 need(d.source.name==='comparison-source.json'&&d.report.name==='comparison-report.json'&&reported===JSON.stringify(report,null,2)+'\n','Complete report does not reproduce from its original sources');
 const reviewText=d.review===null?null:decode(d.review);if(d.review!==null)need(d.review.name==='comparison-review.json','Unexpected review member');const review=reviewText===null?null:inspectReview(reviewText,report);
 return{schema:'stellar-forge.document-comparison-received.v1',bytes:Buffer.byteLength(deliveryText),sha256:hash(deliveryText),sourceText,report,reportText:reported,reviewText,review};
}
