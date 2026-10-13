/* SPDX-License-Identifier: MIT
 * Complete customer/site/job source mapping, migration handover and receiving.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MEPMigration=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
const VERSION='1.0.0',SCHEMA='commons.mep-migration.workspace.v1',MAX=64*1024*1024,FILE_MAX=8*1024*1024;
const SHA=function(bytes){const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],n=bytes.length,b=Array.from(bytes),bits=n*8;b.push(128);while(b.length%64!==56)b.push(0);for(let i=7;i>=0;i--)b.push(Math.floor(bits/2**(8*i))&255);const rr=(a,n)=>(a>>>n)|(a<<(32-n));for(let j=0;j<b.length;j+=64){const w=new Int32Array(64);for(let i=0;i<16;i++)w[i]=(b[j+4*i]<<24)|(b[j+4*i+1]<<16)|(b[j+4*i+2]<<8)|b[j+4*i+3];for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=((rr(x,7)^rr(x,18)^(x>>>3))+w[i-16]+(rr(y,17)^rr(y,19)^(y>>>10))+w[i-7])|0}let [a,c,d,e,f,g,k,l]=h;for(let i=0;i<64;i++){const t1=(l+(rr(f,6)^rr(f,11)^rr(f,25))+((f&g)^(~f&k))+K[i]+w[i])|0,t2=((rr(a,2)^rr(a,13)^rr(a,22))+((a&c)^(a&d)^(c&d)))|0;l=k;k=g;g=f;f=(e+t1)|0;e=d;d=c;c=a;a=(t1+t2)|0}for(const [i,v]of[a,c,d,e,f,g,k,l].entries())h[i]=(h[i]+v)|0;}return h.map(x=>(x>>>0).toString(16).padStart(8,"0")).join("");};

const collections=['programmes','files','profiles','records','batches','deliveries','receipts','history'],entities=['customer','site','job'],trusted=new WeakSet(),frozen=new WeakSet();let counter=0;
function need(ok,code,message){if(!ok){const e=new Error(message||code.replaceAll('_',' ').toLowerCase());e.code=code;throw e;}}
function plain(v){return v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;}
function copy(v){return JSON.parse(JSON.stringify(v));}
function bytes(s){need(typeof s==='string','TEXT_REQUIRED');return Uint8Array.from(unescape(encodeURIComponent(s)),c=>c.charCodeAt(0));}
function canonical(v){if(v===null||typeof v!=='object'){need(v!==undefined&&!(typeof v==='number'&&!Number.isFinite(v)),'JSON_VALUE_REQUIRED');return JSON.stringify(v);}if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';need(plain(v),'PLAIN_JSON_REQUIRED');return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
function hash(v){return SHA(bytes(typeof v==='string'?v:canonical(v)));}
function text(v,label,required=false,max=16000){need(typeof v==='string'&&v.length<=max,'TEXT_REQUIRED',label+' must be text within '+max+' characters.');if(required)need(v.trim(),'VALUE_REQUIRED',label+' is required.');return v;}
function str(v,label,required=false,max=16000){return text(v??'',label,required,max);}
function id(v){need(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(v),'INVALID_ID');return v;}
function key(v){need(typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v),'FIELD_KEY_REQUIRED');return v;}
function uid(prefix='row'){return id(prefix)+'_'+Date.now().toString(36)+'_'+(++counter).toString(36)+'_'+Math.random().toString(36).slice(2,10);}
function choice(v,values,label){need(values.includes(v),'INVALID_CHOICE','Choose '+label+'.');return v;}
function bool(v){need(typeof v==='boolean','BOOLEAN_REQUIRED');return v;}
function list(v,label,max=10000){need(Array.isArray(v)&&v.length<=max,'ARRAY_REQUIRED',label+' is invalid or too large.');return v;}
function day(v){const d=typeof v==='string'?new Date(v+'T00:00:00Z'):null;need(typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v,'DATE_REQUIRED');return v;}
function iso(v){need(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v)),'TIMEZONE_INSTANT_REQUIRED');day(v.slice(0,10));need(Number(v.slice(11,13))<24&&Number(v.slice(14,16))<60&&(v[16]!==':'||Number(v.slice(17,19))<60),'CLOCK_REQUIRED');return new Date(v).toISOString();}
function freeze(v){if(!v||typeof v!=='object'||frozen.has(v))return v;for(const x of Object.values(v))freeze(x);Object.freeze(v);frozen.add(v);return v;}
function unique(rows,fn,label){const seen=new Set();for(const r of rows){const k=fn(r);need(!seen.has(k),'DUPLICATE_VALUE',label+' contains a duplicate: '+k);seen.add(k);}return rows;}
function get(w,type,k){const value=w[type].find(x=>x.id===k);need(value,'RECORD_NOT_FOUND',type+' record not found: '+k);return value;}
function same(a,b){return canonical(a)===canonical(b);}
function safeName(v){text(v,'Filename',true,240);need(!/[\x00-\x1f\\/:]/.test(v)&&v!=='.'&&v!=='..','FILENAME_REQUIRED');return v;}
function plainScalar(v){need(v===null||typeof v==='string'||typeof v==='boolean'||Number.isSafeInteger(v),'JSON_EXACT_SCALAR_REQUIRED','JSON rows must use text for decimals or unsafe integers; nested values require explicit flattening.');return v;}
function parseCSV(input){
 text(input,'Original CSV',false,FILE_MAX);need(bytes(input).length<=FILE_MAX,'SOURCE_TOO_LARGE');
 const s=input.charCodeAt(0)===0xfeff?input.slice(1):input,rows=[];let row=[],field='',quoted=false,after=false,start=true;
 function cell(){row.push(field);field='';after=false;start=true;}
 function record(){cell();rows.push(row);row=[];need(rows.length<=10001,'TOO_MANY_SOURCE_ROWS');}
 for(let i=0;i<s.length;i++){const c=s[i];if(quoted){if(c==='"'){if(s[i+1]==='"'){field+='"';i++;}else{quoted=false;after=true;}}else field+=c;continue;}
  if(after){need(c===','||c==='\r'||c==='\n','CSV_AFTER_QUOTE');}
  if(c==='"'){need(start,'CSV_QUOTE_POSITION');quoted=true;start=false;}else if(c===','){cell();}else if(c==='\n'||c==='\r'){if(c==='\r'&&s[i+1]==='\n')i++;record();}else{field+=c;start=false;}
 }
 need(!quoted,'CSV_UNCLOSED_QUOTE');if(field!==''||row.length||after||s.length&&!/[\r\n]$/.test(s))record();
 need(rows.length>0,'SOURCE_HEADERS_REQUIRED');const originalHeaders=rows.shift(),headers=originalHeaders.map(h=>h.trim());need(headers.length>0&&headers.length<=100&&headers.every(h=>h&&h.length<=240),'SOURCE_HEADERS_REQUIRED');unique(headers,x=>x,'Headers');
 for(const h of headers)need(!['__proto__','constructor','prototype'].includes(h),'UNSAFE_SOURCE_HEADER');
 const data=rows.map((r,i)=>{need(r.length===headers.length,'CSV_ROW_WIDTH','CSV record '+(i+2)+' has '+r.length+' cells; expected '+headers.length+'.');return Object.fromEntries(headers.map((h,j)=>[h,r[j]]));});
 return {headers,originalHeaders,rows:data};
}

// JSON numbers are kept as their exact original token text, including long IDs.
function exactJSON(textValue){
 let i=0;const s=textValue,ws=()=>{while(i<s.length&&/[ \t\r\n]/.test(s[i]))i++;};
 function string(){const start=i++;while(i<s.length){const c=s[i++];if(c==='"')return JSON.parse(s.slice(start,i));if(c==='\\'){need(i<s.length,'JSON_STRING_INVALID');i++;}else need(c.charCodeAt(0)>=32,'JSON_STRING_INVALID');}need(false,'JSON_STRING_INVALID');}
 function value(depth){
  need(depth<=32,'JSON_TOO_DEEP');ws();const c=s[i];
  if(c==='"')return string();
  if(c==='['){i++;ws();const out=[];if(s[i]===']'){i++;return out;}while(true){out.push(value(depth+1));ws();if(s[i]===']'){i++;return out;}need(s[i++ ]===',','JSON_ARRAY_INVALID');}}
  if(c==='{'){i++;ws();const entries=[],seen=new Set();if(s[i]==='}'){i++;return {};}while(true){ws();need(s[i]==='"','JSON_KEY_REQUIRED');const k=string();need(!seen.has(k),'DUPLICATE_JSON_KEY');seen.add(k);ws();need(s[i++] ===':','JSON_COLON_REQUIRED');entries.push([k,value(depth+1)]);ws();if(s[i]==='}'){i++;return Object.fromEntries(entries);}need(s[i++]===',','JSON_OBJECT_INVALID');}}
  for(const [token,v]of [['true',true],['false',false],['null',null]])if(s.slice(i,i+token.length)===token){i+=token.length;return v;}
  const match=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(s.slice(i));need(match,'JSON_VALUE_INVALID');i+=match[0].length;return match[0];
 }
 const result=value(0);ws();need(i===s.length,'JSON_TRAILING_CONTENT');return result;
}

function parseSource(v){
 if(v.format==='csv')return parseCSV(v.text);need(bytes(v.text).length<=FILE_MAX,'SOURCE_TOO_LARGE');
 let root=exactJSON(v.text.charCodeAt(0)===0xfeff?v.text.slice(1):v.text);for(const part of list(v.jsonPath??[],'JSON path',20)){str(part,'JSON path',true,240);need(!['__proto__','constructor','prototype'].includes(part)&&plain(root)&&Object.hasOwn(root,part),'JSON_PATH_MISSING');root=root[part];}
 list(root,'JSON data rows');const headers=[];for(const r of root){need(plain(r),'FLAT_JSON_ROW_REQUIRED');for(const k of Object.keys(r)){text(k,'Header',true,240);need(!['__proto__','constructor','prototype'].includes(k),'UNSAFE_SOURCE_HEADER');plainScalar(r[k]);if(!headers.includes(k))headers.push(k);}}
 need(headers.length<=100&&(headers.length>0||root.length===0),'SOURCE_HEADERS_REQUIRED');return {headers,originalHeaders:headers.slice(),rows:root.map(r=>Object.fromEntries(headers.map(k=>[k,Object.hasOwn(r,k)?r[k]:null])))};
}
function normalizeProgramme(w,v){
 need(w.catalogue.operators.some(o=>o.key===v.operatorKey),'OPERATOR_REQUIRED');
 return {id:id(v.id||uid('programme')),operatorKey:v.operatorKey,title:str(v.title,'Programme title',true,300),targetSystem:str(v.targetSystem,'Receiving system',true,300),targetVersion:str(v.targetVersion,'Receiving version',false,300),notes:str(v.notes,'Notes')};
}
function normalizeSource(w,v){
 get(w,'programmes',v.programmeId);choice(v.entity,entities,'entity');choice(v.kind,['source','target-result'],'original type');choice(v.format,['csv','json'],'original format');
 text(v.text,'Original data',true,FILE_MAX);need(bytes(v.text).length<=FILE_MAX,'SOURCE_TOO_LARGE');const parsed=parseSource(v);
 if(v.parentId){const prior=get(w,'files',v.parentId);need(prior.programmeId===v.programmeId&&prior.entity===v.entity&&prior.kind===v.kind,'SOURCE_PARENT_CHANGED');}
 return {id:id(v.id||uid('source')),programmeId:v.programmeId,entity:v.entity,kind:v.kind,name:safeName(v.name),format:v.format,text:v.text,jsonPath:v.format==='json'?list(v.jsonPath??[],'JSON path',20).slice():[],sourceSystem:str(v.sourceSystem,'Original system',true,300),capturedAt:iso(v.capturedAt),parentId:v.parentId||'',notes:str(v.notes,'Notes'),sha256:hash(v.text),bytes:bytes(v.text).length,...parsed};
}
function normalizeProfile(w,v){
 const source=get(w,'files',v.sourceId);need(source.kind==='source','MAPPING_SOURCE_REQUIRED');
 const fields=unique(list(v.fields,'Mapped fields',40).map(f=>{
  need(plain(f.from)&&(Object.hasOwn(f.from,'column')!==Object.hasOwn(f.from,'constant')),'FIELD_SOURCE_REQUIRED');let from;
  if(Object.hasOwn(f.from,'column')){need(source.headers.includes(f.from.column),'SOURCE_COLUMN_MISSING');from={column:f.from.column};}else from={constant:plainScalar(f.from.constant)};
  const referenceEntity=choice(f.referenceEntity??'',['',...entities],'reference entity'),type=choice(f.type,['text','decimal','integer','boolean','date','datetime'],'field type');
  need(!referenceEntity||type==='text','REFERENCE_MUST_BE_TEXT');
  const values=unique(list(f.values??[],'Explicit value map',1000).map(x=>({from:plainScalar(x.from),to:plainScalar(x.to)})),x=>canonical(x.from),'Value map');
  return {key:key(f.key),label:str(f.label,'Field label',true,240),type,required:bool(f.required),from,trim:bool(f.trim??false),empty:choice(f.empty??'null',['null','keep'],'empty value'),values,referenceEntity};
 }),x=>x.key,'Fields');need(fields.length,'MAPPED_FIELDS_REQUIRED');
 const keyField=key(v.keyField),identity=fields.find(x=>x.key===keyField);need(identity&&identity.required&&identity.type==='text'&&!identity.referenceEntity,'REQUIRED_TEXT_KEY_FIELD');
 const targetFields=unique(list(v.targetFields??[],'Target fields',40).map(t=>{const f=fields.find(x=>x.key===t.field);need(f,'TARGET_FIELD_MISSING');const mode=choice(t.relationshipMode??'sourceKey',['sourceKey','nativeId'],'relationship output');need(mode!=='nativeId'||f.referenceEntity,'NATIVE_ID_REQUIRES_REFERENCE');const column=str(t.column,'Actual target column',true,240);need(!['__proto__','constructor','prototype'].includes(column),'UNSAFE_TARGET_COLUMN');return {field:f.key,column,relationshipMode:mode};}),x=>x.column,'Target columns');
 if(v.parentId){const p=get(w,'profiles',v.parentId);need(p.programmeId===source.programmeId&&p.entity===source.entity,'PROFILE_PARENT_CHANGED');}
 return {id:id(v.id||uid('profile')),programmeId:source.programmeId,entity:source.entity,sourceId:source.id,name:str(v.name,'Mapping name',true,300),parentId:v.parentId||'',keyField,fields,targetFields,targetContractLabel:str(v.targetContractLabel,'Receiving contract source',false,1000),notes:str(v.notes,'Notes')};
}
function transform(raw,f){
 let v=raw;if(typeof v==='string'&&f.trim)v=v.trim();
 if(v===null||v===''){if(f.required)need(false,'REQUIRED_FIELD_EMPTY',f.label+' is required.');return f.empty==='null'?null:v;}
 if(f.values.length){const map=f.values.find(x=>same(x.from,v));need(map,'UNMAPPED_SOURCE_VALUE',f.label+': choose an explicit translation for '+String(v));v=map.to;}
 if(v===null||v===''){if(f.required)need(false,'REQUIRED_FIELD_EMPTY');return f.empty==='null'?null:v;}
 if(f.type==='text')return text(String(v),f.label,true,16000);
 if(f.type==='decimal'){v=String(v);need(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v),'DECIMAL_TEXT_REQUIRED',f.label+' needs explicit decimal text, no currency/grouping symbols.');return v;}
 if(f.type==='integer'){v=String(v);need(/^-?(?:0|[1-9]\d*)$/.test(v),'INTEGER_TEXT_REQUIRED');return v;}
 if(f.type==='boolean'){need(v===true||v===false||v==='true'||v==='false','EXPLICIT_BOOLEAN_REQUIRED');return v===true||v==='true';}
 if(f.type==='date')return day(v);if(f.type==='datetime')return iso(v);
}
function mapRow(original,profile){const fields={},issues=[];for(const f of profile.fields){try{fields[f.key]=transform(Object.hasOwn(f.from,'column')?original[f.from.column]:f.from.constant,f);}catch(e){fields[f.key]=null;issues.push({code:e.code??'FIELD_INVALID',field:f.key,message:e.message});}}return {fields,issues};}
function rowId(source,index){return source.id+':'+(index+1);}
function recordMatch(w,programmeId,entity,originalKey){if(originalKey===null||originalKey===undefined||originalKey==='')return null;return w.records.find(r=>r.programmeId===programmeId&&r.entity===entity&&(r.key===originalKey||r.aliases.includes(originalKey)))??null;}
function issue(code,message,row=''){return {code,message,rowId:row};}
function finishReview(body){return freeze({...body,reviewSha256:hash(body)});}

function reviewBatch(w,input){
 validate(w);const source=get(w,'files',input.sourceId),profile=get(w,'profiles',input.profileId);need(source.kind==='source'&&profile.sourceId===source.id,'PROFILE_SOURCE_CHANGED');
 const title=str(input.title,'Batch title',true,300),notes=str(input.notes,'Notes'),decisions=list(input.decisions??[],'Row decisions'),decisionMap=new Map();
 for(const d of decisions){need(plain(d)&&source.rows.some((_,i)=>rowId(source,i)===d.rowId)&&!decisionMap.has(d.rowId),'ROW_DECISION_CHANGED');decisionMap.set(d.rowId,{rowId:d.rowId,action:choice(d.action,['create','update','link','exclude'],'row decision'),recordId:str(d.recordId,'Existing record ID'),reason:str(d.reason,'Decision reason')});}
 const issues=[],rows=[],claimedKeys=new Map(),mutatedRecords=new Set();if(!source.rows.length)issues.push(issue('EMPTY_ORIGINAL_SOURCE','This original source has no rows to select.'));
 for(let index=0;index<source.rows.length;index++){
  const original=source.rows[index],rid=rowId(source,index),mapped=mapRow(original,profile),keyValue=mapped.fields[profile.keyField],existing=recordMatch(w,source.programmeId,source.entity,keyValue),decision=decisionMap.get(rid)??null;
  let record=null,recordIdValue='',rowIssues=[],changes=[],links={};const values=mapped.fields;
  const recommended=mapped.issues.length?'review':existing?(same(existing.fields,values)?'link':'update'):'create';
  if(!decision)rowIssues.push(issue('ROW_DECISION_REQUIRED','Choose a decision for this original row.',rid));
  else if(decision.action==='exclude'){if(!decision.reason.trim())rowIssues.push(issue('EXCLUSION_REASON_REQUIRED','Explain this original row exclusion.',rid));}
  else{
   if(['update','link'].includes(decision.action)){record=w.records.find(r=>r.id===decision.recordId&&r.programmeId===source.programmeId&&r.entity===source.entity);if(!record)rowIssues.push(issue('SAME_ENTITY_RECORD_REQUIRED','Choose an existing record in this programme and entity.',rid));else recordIdValue=record.id;}
   if(decision.action==='create'){recordIdValue=source.entity+'_'+hash({sourceId:source.id,profileId:profile.id,rowId:rid}).slice(0,32);if(existing)rowIssues.push(issue('KEY_ALREADY_EXISTS','This original key already belongs to '+existing.id+'.',rid));if(w.records.some(r=>r.id===recordIdValue))rowIssues.push(issue('ROW_ALREADY_CREATED','Link or update the original staged record.',rid));}
   if(record)changes=[...new Set([...Object.keys(record.fields),...Object.keys(values)])].map(field=>({field})).filter(x=>!same(record.fields[x.field]??null,values[x.field]??null)).map(x=>({field:x.field,before:record.fields[x.field]??null,after:values[x.field]??null}));
   if(decision.action==='link'){
    if(record&&(changes.length||mapped.issues.length)&&!decision.reason.trim())rowIssues.push(issue('LINK_REASON_REQUIRED','Explain preserving the existing record despite different or invalid source values.',rid));
    if(record){links=copy(record.links);if(keyValue&&existing&&existing.id!==record.id)rowIssues.push(issue('KEY_BELONGS_TO_OTHER_RECORD','This key belongs to a different staged record.',rid));}
   }else{
    rowIssues.push(...mapped.issues.map(v=>({...v,rowId:rid})));
    if(decision.action==='update'&&!decision.reason.trim())rowIssues.push(issue('UPDATE_REASON_REQUIRED','Explain the corrected record edition.',rid));
    if(record&&existing&&existing.id!==record.id)rowIssues.push(issue('KEY_BELONGS_TO_OTHER_RECORD','A different record owns this original key.',rid));
    if(recordIdValue){if(mutatedRecords.has(recordIdValue))rowIssues.push(issue('MULTIPLE_UPDATES_ONE_RECORD','Select one update for a record in this batch; link or exclude other rows.',rid));mutatedRecords.add(recordIdValue);}
   }
   if(keyValue&&recordIdValue){const claimed=claimedKeys.get(keyValue);if(claimed&&claimed!==recordIdValue)rowIssues.push(issue('DUPLICATE_BATCH_KEY','Another selected row assigns this key to a different record.',rid));else claimedKeys.set(keyValue,recordIdValue);}
  }
  rows.push({rowId:rid,index:index+1,original:copy(original),mapped:values,key:keyValue??'',existingRecordId:existing?.id??'',recommended,decision,changes,issues:rowIssues,recordId:recordIdValue,links,recordRevision:record?.revision??0,recordSha256:record?hash(record):null});
 }
 const candidates=new Map(w.records.filter(r=>r.programmeId===source.programmeId).flatMap(r=>[r.key,...r.aliases].map(k=>[r.entity+'\0'+k,r.id])));
 for(const row of rows)if(row.decision&&row.decision.action!=='exclude'&&row.recordId&&row.key)candidates.set(source.entity+'\0'+row.key,row.recordId);
 for(const row of rows){
  if(row.decision&&['create','update'].includes(row.decision.action))for(const f of profile.fields.filter(f=>f.referenceEntity)){
   const value=row.mapped[f.key];if(value===null||value==='')continue;const ref=candidates.get(f.referenceEntity+'\0'+value);if(!ref)row.issues.push(issue('UNRESOLVED_REFERENCE','Resolve '+f.label+' key '+value+' in '+f.referenceEntity+' first.',row.rowId));else{if(ref===row.recordId)row.issues.push(issue('SELF_REFERENCE','A record cannot refer to itself.',row.rowId));else row.links[f.key]=ref;}
  }
  issues.push(...row.issues);
 }
 // More than one row touching a record may add links, but its revised values must be chosen once.
 const counts={rows:rows.length,create:0,update:0,link:0,exclude:0,undecided:0,issues:issues.length};
 for(const row of rows)counts[row.decision?.action??'undecided']++;
 return finishReview({schema:'commons.mep-migration.batch-review.v1',revision:w.revision,programmeId:source.programmeId,entity:source.entity,sourceId:source.id,sourceSha256:source.sha256,profileId:profile.id,profileSha256:hash(profile),title,notes,rows,issues,counts});
}
function latestReceipt(w,deliveryId){return w.receipts.filter(x=>x.deliveryId===deliveryId).sort((a,b)=>b.createdRevision-a.createdRevision)[0]??null;}
function nativeFor(w,recordId,targetSystem){
 const record=get(w,'records',recordId);let selected=null;
 for(const receipt of w.receipts){const delivery=get(w,'deliveries',receipt.deliveryId);if(delivery.programmeId!==record.programmeId||delivery.targetSystem!==targetSystem)continue;const row=receipt.rows.find(x=>x.recordId===recordId);
  if(row&&(!selected||receipt.createdRevision>selected.createdRevision))selected={...row,receiptId:receipt.id,deliveryId:delivery.id,observedAt:receipt.observedAt,createdRevision:receipt.createdRevision};
 }return selected;
}
function reviewDelivery(w,input){
 validate(w);const batch=get(w,'batches',input.batchId),profile=get(w,'profiles',batch.profileId),programme=get(w,'programmes',batch.programmeId),issues=[],rows=[];
 if(!profile.targetFields.length)issues.push(issue('TARGET_COLUMNS_REQUIRED','Configure the actual receiving columns in a source mapping profile.'));
 if(!profile.targetContractLabel.trim())issues.push(issue('TARGET_CONTRACT_REQUIRED','Retain the actual receiving field contract or operator-selected demonstration contract.'));
 for(const row of batch.rows.filter(r=>['create','update'].includes(r.decision.action))){
  const fields={};for(const target of profile.targetFields){const value=row.mapped[target.field];if(target.relationshipMode==='nativeId'&&value!==null&&value!==''){
    const recordId=row.links[target.field],native=recordId?nativeFor(w,recordId,programme.targetSystem):null;
    if(!native||native.status!=='accepted'||!native.nativeId){issues.push(issue('NATIVE_PARENT_UNCONFIRMED','Receiving native ID is unresolved for '+target.column+'.',row.rowId));fields[target.column]=null;}else fields[target.column]=native.nativeId;
   }else fields[target.column]=value??null;
  }
  rows.push({rowId:row.rowId,recordId:row.recordId,recordRevision:row.committedRecordRevision,fields,sourceFields:copy(row.mapped),links:copy(row.links)});
 }
 if(!rows.length)issues.push(issue('NO_EXPORT_ROWS','This batch contains only linked/excluded rows.'));
 const counts={rows:rows.length,issues:issues.length};
 return finishReview({schema:'commons.mep-migration.delivery-review.v1',revision:w.revision,programmeId:programme.id,entity:batch.entity,batchId:batch.id,batchSha256:hash(batch),profileId:profile.id,targetSystem:programme.targetSystem,targetVersion:programme.targetVersion,targetContractLabel:profile.targetContractLabel,title:str(input.title,'Handover title',true,300),notes:str(input.notes,'Notes'),columns:profile.targetFields.map(x=>x.column),rows,issues,counts});
}
function reviewReceipt(w,input){
 validate(w);const delivery=get(w,'deliveries',input.deliveryId),evidence=get(w,'files',input.evidenceFileId),prior=latestReceipt(w,delivery.id),issues=[];
 need(evidence.kind==='target-result'&&evidence.programmeId===delivery.programmeId&&evidence.entity===delivery.entity,'TARGET_RESULT_SOURCE_REQUIRED');
 const observedAt=iso(input.observedAt),reference=str(input.reference,'Actual receiving reference',true,1000),notes=str(input.notes,'Notes'),outcomes=unique(list(input.outcomes,'Actual row outcomes').map(v=>{
  need(delivery.rows.some(x=>x.rowId===v.rowId),'RECEIPT_ROW_MISSING');return {rowId:v.rowId,status:choice(v.status,['accepted','rejected','unknown'],'actual outcome'),nativeId:str(v.nativeId,'Actual native ID',false,1000),reason:str(v.reason,'Outcome reason')};
 }),x=>x.rowId,'Outcomes');
 need(outcomes.length,'OUTCOMES_REQUIRED');const rows=delivery.rows.map(d=>{
  const supplied=outcomes.find(x=>x.rowId===d.rowId),previous=prior?.rows.find(x=>x.rowId===d.rowId),value=supplied??previous??{rowId:d.rowId,status:'unknown',nativeId:'',reason:'No original target outcome supplied.'};
  if(value.status==='accepted'&&!value.nativeId.trim())issues.push(issue('NATIVE_ID_REQUIRED','Enter the native ID actually returned.',d.rowId));
  if(value.status!=='accepted'&&!value.reason.trim())issues.push(issue('OUTCOME_REASON_REQUIRED','Retain the returned reason or uncertainty.',d.rowId));
  if(supplied&&previous?.status==='accepted'&&(value.status!=='accepted'||value.nativeId!==previous.nativeId)&&!notes.trim())issues.push(issue('ACCEPTED_OUTCOME_CHANGE_REASON','Explain this change from the previous accepted outcome.',d.rowId));
  const earlier=nativeFor(w,d.recordId,delivery.targetSystem);if(supplied&&value.status==='accepted'&&earlier?.status==='accepted'&&earlier.nativeId!==value.nativeId&&!notes.trim())issues.push(issue('NATIVE_ID_CHANGE_REASON','Explain the changed target ID and preserve its original source.',d.rowId));
  return {...value,recordId:d.recordId,recordRevision:d.recordRevision,supplied:Boolean(supplied),evidenceFileId:supplied?evidence.id:previous?.evidenceFileId??'',observedAt:supplied?observedAt:previous?.observedAt??''};
 });
 const nativeIds=new Map();
 for(const r of w.records.filter(r=>r.programmeId===delivery.programmeId&&r.entity===delivery.entity)){
  const state=nativeFor(w,r.id,delivery.targetSystem);if(state?.status==='accepted'&&!rows.some(row=>row.recordId===r.id))nativeIds.set(state.nativeId,r.id);
 }
 for(const row of rows.filter(x=>x.status==='accepted'&&x.nativeId)){const previous=nativeIds.get(row.nativeId);if(previous&&previous!==row.recordId)issues.push(issue('NATIVE_ID_COLLISION','This native ID is already assigned to another staged record.',row.rowId));else nativeIds.set(row.nativeId,row.recordId);}
 const counts={rows:rows.length,accepted:rows.filter(x=>x.status==='accepted').length,rejected:rows.filter(x=>x.status==='rejected').length,unknown:rows.filter(x=>x.status==='unknown').length,issues:issues.length};
 return finishReview({schema:'commons.mep-migration.receipt-review.v1',revision:w.revision,programmeId:delivery.programmeId,entity:delivery.entity,deliveryId:delivery.id,deliverySha256:hash(delivery),evidenceFileId:evidence.id,evidenceSha256:evidence.sha256,observedAt,reference,notes,priorReceiptId:prior?.id??'',rows,issues,counts});
}

function baseMetadata(w,at){return {createdAt:at,createdRevision:w.revision+1};}
function csvText(headers,rows){const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';return [headers.map(cell).join(','),...rows.map(r=>headers.map(h=>cell(r[h])).join(','))].join('\r\n')+'\r\n';}
function ready(w,authored=false){need(bytes(JSON.stringify({schema:'commons.mep-migration.handover.v1',sha256:'0'.repeat(64),workspace:w},null,2)+'\n').length<=MAX,'WORKSPACE_TOO_LARGE');if(!authored)validate(w);freeze(w);trusted.add(w);return w;}
function create(catalogue,options={}){
 need(plain(catalogue)&&Array.isArray(catalogue.operators)&&catalogue.operators.length,'SOURCE_CATALOGUE_REQUIRED');unique(catalogue.operators,x=>id(x.key),'Operator keys');
 const now=iso(options.now??new Date().toISOString()),w={schema:SCHEMA,version:VERSION,id:id(options.id||uid('migration')),title:str(options.title??'Customer and job migration','Workspace title',true,300),createdAt:now,updatedAt:now,revision:0,catalogue:copy(catalogue)};
 for(const c of collections)w[c]=[];return ready(w);
}
function mutate(w,command,options={}){
 validate(w);need(plain(command),'COMMAND_REQUIRED');const type=command.type;
 const committed=type==='batch.commit'?'batches':type==='delivery.prepare'?'deliveries':type==='receipt.commit'?'receipts':null;
 if(committed&&command.expectedReviewSha){const prefix=committed==='batches'?'batch_':committed==='deliveries'?'delivery_':'receipt_',previous=w[committed].find(x=>x.id===prefix+command.expectedReviewSha);if(previous){need(previous.requestSha256===hash(command.input),'ORIGINAL_REQUEST_CHANGED');return w;}}
 need(options.expectedRevision===w.revision,'REVISION_CHANGED','Reopen the current workspace and review the operation again.');
 const actor=str(options.actor,'Operator',true,300),at=iso(options.now??new Date().toISOString());need(at>=w.updatedAt,'OPERATION_TIME_BEFORE_CURRENT');
 const next={...w};for(const c of collections)next[c]=w[c].slice();let changed=[],detail={};
 function append(kind,value){need(next[kind].length<20000,'TOO_MANY_WORKSPACE_RECORDS');need(!next[kind].some(x=>x.id===value.id),'ID_ALREADY_EXISTS');next[kind].push(value);changed.push({kind,id:value.id,before:null,after:hash(value)});}
 function replace(kind,value){const i=next[kind].findIndex(x=>x.id===value.id);need(i>=0,'RECORD_NOT_FOUND');const previous=next[kind][i];next[kind][i]=value;changed.push({kind,id:value.id,before:hash(previous),after:hash(value)});}
 if(type==='programme.save'){
  const value=normalizeProgramme(w,command.value),previous=w.programmes.find(x=>x.id===value.id);
  if(previous){need(previous.operatorKey===value.operatorKey,'PROGRAMME_OPERATOR_CHANGED');if(w.deliveries.some(d=>d.programmeId===value.id))need(previous.targetSystem===value.targetSystem,'DELIVERED_TARGET_SYSTEM_IMMUTABLE');replace('programmes',{...previous,...value,updatedAt:at,updatedRevision:w.revision+1});}
  else append('programmes',{...value,...baseMetadata(w,at),updatedAt:at,updatedRevision:w.revision+1});
 }else if(type==='source.add'){
  const value=normalizeSource(w,command.value),duplicate=w.files.find(x=>x.programmeId===value.programmeId&&x.entity===value.entity&&x.kind===value.kind&&x.sha256===value.sha256);
  need(!duplicate,'SOURCE_ALREADY_RETAINED',duplicate?'Original already retained as '+duplicate.id+'.':'');append('files',{...value,...baseMetadata(w,at)});detail={sourceId:value.id,sourceSha256:value.sha256,rows:value.rows.length};
 }else if(type==='profile.save'){
  const value=normalizeProfile(w,command.value);append('profiles',{...value,...baseMetadata(w,at)});detail={sourceId:value.sourceId,profileId:value.id};
 }else if(type==='batch.commit'){
  const review=reviewBatch(w,command.input);need(review.reviewSha256===command.expectedReviewSha,'REVIEW_CHANGED');need(!review.issues.length,'BATCH_ISSUES_UNRESOLVED',review.issues[0]?.message);
  const batchId='batch_'+review.reviewSha256,batchRows=review.rows.map(r=>copy(r));
  for(const row of batchRows){
   const d=row.decision;if(d.action==='exclude'){row.committedRecordRevision=null;continue;}
   const origin={sourceId:review.sourceId,rowId:row.rowId,batchId,action:d.action,reason:d.reason};
   const existing=next.records.find(x=>x.id===row.recordId);
   if(d.action==='create'){
    const revision={revision:1,key:row.key,fields:copy(row.mapped),links:copy(row.links),sourceId:review.sourceId,rowId:row.rowId,batchId,actor,at,reason:d.reason};
    append('records',{id:row.recordId,programmeId:review.programmeId,entity:review.entity,key:row.key,aliases:[],fields:copy(row.mapped),links:copy(row.links),revision:1,revisions:[revision],origins:[origin],...baseMetadata(w,at),updatedAt:at});row.committedRecordRevision=1;
   }else{
    need(existing,'SELECTED_RECORD_MISSING');let changedRecord={...existing,aliases:existing.aliases.slice(),origins:existing.origins.concat(origin),updatedAt:at};
    if(row.key&&row.key!==existing.key&&!changedRecord.aliases.includes(row.key)&&d.action==='link')changedRecord.aliases.push(row.key);
    if(d.action==='update'){
     if(existing.key!==row.key&&!changedRecord.aliases.includes(existing.key))changedRecord.aliases.push(existing.key);
     changedRecord.aliases=changedRecord.aliases.filter(x=>x!==row.key);
     const revision=existing.revision+1,value={revision,key:row.key,fields:copy(row.mapped),links:copy(row.links),sourceId:review.sourceId,rowId:row.rowId,batchId,actor,at,reason:d.reason};
     changedRecord={...changedRecord,key:row.key,fields:copy(row.mapped),links:copy(row.links),revision,revisions:existing.revisions.concat(value)};
    }
    replace('records',changedRecord);row.committedRecordRevision=changedRecord.revision;
   }
  }
  append('batches',{...review,id:batchId,rows:batchRows,requestSha256:hash(command.input),request:copy(command.input),...baseMetadata(w,at),actor});
  detail={batchId,sourceId:review.sourceId,profileId:review.profileId,counts:review.counts};
 }else if(type==='delivery.prepare'){
  const review=reviewDelivery(w,command.input);need(review.reviewSha256===command.expectedReviewSha,'REVIEW_CHANGED');need(!review.issues.length,'DELIVERY_ISSUES_UNRESOLVED',review.issues[0]?.message);
  const csv=csvText(review.columns,review.rows.map(x=>x.fields)),json=JSON.stringify({schema:'commons.mep-migration.target-rows.v1',targetSystem:review.targetSystem,targetVersion:review.targetVersion,targetContractLabel:review.targetContractLabel,batchId:review.batchId,columns:review.columns,rows:review.rows},null,2)+'\n';
  append('deliveries',{...review,id:'delivery_'+review.reviewSha256,csv,json,csvSha256:hash(csv),jsonSha256:hash(json),requestSha256:hash(command.input),request:copy(command.input),...baseMetadata(w,at),actor});
  detail={deliveryId:'delivery_'+review.reviewSha256,batchId:review.batchId,rows:review.rows.length};
 }else if(type==='receipt.commit'){
  const review=reviewReceipt(w,command.input);need(review.reviewSha256===command.expectedReviewSha,'REVIEW_CHANGED');need(!review.issues.length,'RECEIPT_ISSUES_UNRESOLVED',review.issues[0]?.message);
  append('receipts',{...review,id:'receipt_'+review.reviewSha256,requestSha256:hash(command.input),request:copy(command.input),...baseMetadata(w,at),actor});detail={receiptId:'receipt_'+review.reviewSha256,deliveryId:review.deliveryId,counts:review.counts};
 }else need(false,'UNKNOWN_COMMAND');
 next.revision=w.revision+1;next.updatedAt=at;next.history.push({id:'change_'+next.revision,revision:next.revision,type,actor,at,detail,changed});
 return ready(next,true);
}
function stripMeta(v){const {createdAt,createdRevision,updatedAt,updatedRevision,...rest}=v;return rest;}
function validate(w,options={}){
 need(plain(w)&&w.schema===SCHEMA&&w.version===VERSION,'WORKSPACE_SCHEMA_REQUIRED');if(options.catalogue)need(hash(options.catalogue)===hash(w.catalogue),'SOURCE_CATALOGUE_CHANGED');if(trusted.has(w))return w;
 id(w.id);text(w.title,'Title',true,300);iso(w.createdAt);iso(w.updatedAt);need(Number.isSafeInteger(w.revision)&&w.revision>=0,'WORKSPACE_REVISION_REQUIRED');
 need(plain(w.catalogue)&&Array.isArray(w.catalogue.operators),'SOURCE_CATALOGUE_REQUIRED');unique(w.catalogue.operators,x=>id(x.key),'Operators');
 for(const kind of collections)unique(list(w[kind],kind,kind==='history'?100000:20000),x=>id(x.id),kind);
 need(w.history.length===w.revision,'HISTORY_REVISION_CHANGED');w.history.forEach((h,i)=>{need(h.revision===i+1,'HISTORY_ORDER_CHANGED');iso(h.at);str(h.actor,'History actor',true);list(h.changed,'Changed records');});
 for(const p of w.programmes){need(same(stripMeta(p),normalizeProgramme(w,p)),'PROGRAMME_CHANGED');iso(p.createdAt);iso(p.updatedAt);}
 const fileKeys=new Set();for(const f of w.files){const v=normalizeSource(w,f);need(same(stripMeta(f),v),'ORIGINAL_SOURCE_CHANGED');const k=[f.programmeId,f.entity,f.kind,f.sha256].join('\0');need(!fileKeys.has(k),'DUPLICATE_ORIGINAL_SOURCE');fileKeys.add(k);}
 for(const p of w.profiles)need(same(stripMeta(p),normalizeProfile(w,p)),'SOURCE_PROFILE_CHANGED');
 const identity=new Set();for(const r of w.records){
  get(w,'programmes',r.programmeId);choice(r.entity,entities,'entity');str(r.key,'Original identity',true);list(r.aliases,'Identity aliases');need(Number.isSafeInteger(r.revision)&&r.revision>=1&&r.revisions.length===r.revision,'RECORD_HISTORY_CHANGED');
  unique([r.key,...r.aliases],x=>str(x,'Identity',true),'Identity aliases').forEach(k=>{const value=r.programmeId+'\0'+r.entity+'\0'+k;need(!identity.has(value),'DUPLICATE_RECORD_IDENTITY');identity.add(value);});
  need(plain(r.fields)&&plain(r.links),'RECORD_FIELDS_REQUIRED');for(const [field,recordId]of Object.entries(r.links)){key(field);const parent=get(w,'records',recordId);need(parent.programmeId===r.programmeId&&parent.id!==r.id,'RELATED_RECORD_CHANGED');}
  r.revisions.forEach((rev,i)=>{need(rev.revision===i+1&&plain(rev.fields)&&plain(rev.links),'RECORD_REVISION_CHANGED');get(w,'files',rev.sourceId);get(w,'batches',rev.batchId);iso(rev.at);});
  const last=r.revisions.at(-1);need(same(last.fields,r.fields)&&same(last.links,r.links)&&last.key===r.key,'CURRENT_RECORD_HISTORY_CHANGED');
  for(const origin of r.origins){const source=get(w,'files',origin.sourceId),batch=get(w,'batches',origin.batchId);need(source.programmeId===r.programmeId&&source.entity===r.entity&&batch.rows.some(x=>x.rowId===origin.rowId&&x.recordId===r.id),'RECORD_ORIGIN_CHANGED');}
 }
 for(const b of w.batches){
  const source=get(w,'files',b.sourceId),profile=get(w,'profiles',b.profileId);need(b.sourceSha256===source.sha256&&b.profileSha256===hash(profile)&&source.programmeId===b.programmeId&&profile.sourceId===source.id,'BATCH_SOURCE_CHANGED');
  need(b.requestSha256===hash(b.request)&&b.id==='batch_'+b.reviewSha256&&b.rows.length===source.rows.length&&!b.issues.length,'BATCH_BINDING_CHANGED');
  const reviewRows=b.rows.map(({committedRecordRevision,...row})=>row),{id:bid,requestSha256,request,createdAt,createdRevision,actor,...originalReview}=b;originalReview.rows=reviewRows;const {reviewSha256,...reviewBody}=originalReview;need(hash(reviewBody)===reviewSha256,'BATCH_REVIEW_CHANGED');
  for(let i=0;i<b.rows.length;i++){const row=b.rows[i];need(row.rowId===rowId(source,i)&&same(row.original,source.rows[i])&&same(row.mapped,mapRow(source.rows[i],profile).fields),'BATCH_ROW_CHANGED');choice(row.decision.action,['create','update','link','exclude'],'decision');
   if(row.decision.action==='exclude')need(row.decision.reason.trim(),'EXCLUSION_REASON_REQUIRED');else{const record=get(w,'records',row.recordId);need(record.programmeId===b.programmeId&&record.entity===b.entity,'BATCH_RECORD_CHANGED');const rev=record.revisions.find(x=>x.revision===row.committedRecordRevision);need(rev,'BATCH_RECORD_REVISION_MISSING');if(['create','update'].includes(row.decision.action))need(same(rev.fields,row.mapped)&&same(rev.links,row.links)&&rev.batchId===b.id,'FROZEN_BATCH_RECORD_CHANGED');}
  }
 }
 for(const d of w.deliveries){
  const b=get(w,'batches',d.batchId),p=get(w,'profiles',d.profileId);need(d.batchSha256===hash(b)&&d.programmeId===b.programmeId&&d.profileId===b.profileId&&d.id==='delivery_'+d.reviewSha256&&d.requestSha256===hash(d.request),'DELIVERY_BINDING_CHANGED');
  need(same(d.columns,p.targetFields.map(x=>x.column))&&d.rows.length===b.rows.filter(x=>['create','update'].includes(x.decision.action)).length,'DELIVERY_SELECTION_CHANGED');
  for(const row of d.rows){const original=b.rows.find(x=>x.rowId===row.rowId);need(original&&['create','update'].includes(original.decision.action)&&original.recordId===row.recordId&&original.committedRecordRevision===row.recordRevision&&same(original.mapped,row.sourceFields)&&same(original.links,row.links),'DELIVERY_SOURCE_ROW_CHANGED');}
  need(d.csv===csvText(d.columns,d.rows.map(x=>x.fields))&&hash(d.csv)===d.csvSha256&&hash(d.json)===d.jsonSha256,'DELIVERY_BYTES_CHANGED');
  const json=JSON.parse(d.json);need(json.batchId===d.batchId&&same(json.rows,d.rows)&&same(json.columns,d.columns),'DELIVERY_JSON_CHANGED');
  const {id:did,csv,json:j,csvSha256,jsonSha256,requestSha256,request,createdAt,createdRevision,actor,reviewSha256,...body}=d;need(hash(body)===reviewSha256&&!d.issues.length,'DELIVERY_REVIEW_CHANGED');
 }
 for(const r of w.receipts){
  const d=get(w,'deliveries',r.deliveryId),e=get(w,'files',r.evidenceFileId);need(r.deliverySha256===hash(d)&&r.programmeId===d.programmeId&&e.programmeId===d.programmeId&&e.kind==='target-result'&&e.entity===d.entity&&e.sha256===r.evidenceSha256,'RECEIPT_SOURCE_CHANGED');
  if(r.priorReceiptId){const prior=get(w,'receipts',r.priorReceiptId);need(prior.deliveryId===r.deliveryId&&prior.createdRevision<r.createdRevision,'RECEIPT_HISTORY_CHANGED');}
  need(r.rows.length===d.rows.length&&r.requestSha256===hash(r.request)&&r.id==='receipt_'+r.reviewSha256,'RECEIPT_BINDING_CHANGED');
  unique(r.rows,x=>x.rowId,'Receipt rows');for(const row of r.rows){const original=d.rows.find(x=>x.rowId===row.rowId);need(original&&original.recordId===row.recordId&&original.recordRevision===row.recordRevision,'RECEIPT_ROW_CHANGED');choice(row.status,['accepted','rejected','unknown'],'outcome');if(row.status==='accepted')str(row.nativeId,'Native ID',true);if(row.evidenceFileId)get(w,'files',row.evidenceFileId);}
  const {id:rid,requestSha256,request,createdAt,createdRevision,actor,reviewSha256,...body}=r;need(hash(body)===reviewSha256&&!r.issues.length,'RECEIPT_REVIEW_CHANGED');
 }
 return w;
}
function exportWorkspace(w){validate(w);const payload=w,serialized=JSON.stringify({schema:'commons.mep-migration.handover.v1',sha256:hash(payload),workspace:payload},null,2)+'\n';need(bytes(serialized).length<=MAX,'WORKSPACE_TOO_LARGE');return serialized;}
function importWorkspace(raw,options={}){text(raw,'Complete workspace',true,MAX);need(bytes(raw).length<=MAX,'WORKSPACE_TOO_LARGE');const value=JSON.parse(raw);need(value.schema==='commons.mep-migration.handover.v1'&&value.sha256===hash(value.workspace),'HANDOVER_CHANGED');validate(value.workspace,options);return ready(value.workspace);}

function sourceView(w,sourceId){validate(w);return get(w,'files',sourceId);}
function recordView(w,recordId){
 validate(w);const record=get(w,'records',recordId);return {record,origins:record.origins.map(x=>({...x,source:get(w,'files',x.sourceId)})),outcomes:w.receipts.flatMap(r=>r.rows.filter(x=>x.recordId===recordId).map(x=>({...x,receiptId:r.id,deliveryId:r.deliveryId,reference:r.reference,observedAt:r.observedAt,notes:r.notes})))};
}
function reconciliation(w,programmeId){
 validate(w);const programme=get(w,'programmes',programmeId),files=w.files.filter(x=>x.programmeId===programmeId),batches=w.batches.filter(x=>x.programmeId===programmeId),deliveries=w.deliveries.filter(x=>x.programmeId===programmeId);
 const records=w.records.filter(x=>x.programmeId===programmeId).map(record=>{
  const delivery=deliveries.filter(d=>d.rows.some(x=>x.recordId===record.id)).sort((a,b)=>b.createdRevision-a.createdRevision)[0]??null,native=nativeFor(w,record.id,programme.targetSystem);
  const currentRevisionAccepted=Boolean(native?.status==='accepted'&&native.recordRevision===record.revision&&delivery?.id===native.deliveryId);
  return {recordId:record.id,entity:record.entity,key:record.key,revision:record.revision,latestDeliveryId:delivery?.id??'',latestReceiptId:native?.receiptId??'',status:native?.status??'unknown',nativeId:native?.nativeId??'',reason:native?.reason??(delivery?'No original target outcome received.':'No receiving handover prepared.'),receiptAt:native?.observedAt??'',acceptedRevision:native?.status==='accepted'?native.recordRevision:null,currentRevisionAccepted,sourceOrigins:copy(record.origins)};
 });
 const counts={sources:files.filter(x=>x.kind==='source').length,sourceRows:files.filter(x=>x.kind==='source').reduce((s,x)=>s+x.rows.length,0),stagedRecords:records.length,batches:batches.length,deliveries:deliveries.length,accepted:records.filter(x=>x.status==='accepted').length,rejected:records.filter(x=>x.status==='rejected').length,unknown:records.filter(x=>x.status==='unknown').length,currentAccepted:records.filter(x=>x.currentRevisionAccepted).length,outdated:records.filter(x=>x.status==='accepted'&&!x.currentRevisionAccepted).length,excluded:batches.reduce((n,b)=>n+b.counts.exclude,0)};
 return {programme,counts,records,batches:batches.map(b=>({id:b.id,title:b.title,entity:b.entity,sourceId:b.sourceId,profileId:b.profileId,counts:b.counts,createdAt:b.createdAt})),deliveries:deliveries.map(d=>({id:d.id,title:d.title,entity:d.entity,rows:d.rows.length,createdAt:d.createdAt,csvSha256:d.csvSha256,jsonSha256:d.jsonSha256,latestReceiptId:latestReceipt(w,d.id)?.id??''}))};
}
function overview(w){
 validate(w);const counts={programmes:w.programmes.length,sources:w.files.filter(f=>f.kind==='source').length,sourceRows:w.files.filter(f=>f.kind==='source').reduce((n,f)=>n+f.rows.length,0),profiles:w.profiles.length,records:w.records.length,batches:w.batches.length,deliveries:w.deliveries.length,accepted:0,rejected:0,unknown:0,currentAccepted:0,outdated:0};
 for(const p of w.programmes){const c=reconciliation(w,p.id).counts;for(const k of ['accepted','rejected','unknown','currentAccepted','outdated'])counts[k]+=c[k];}return counts;
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function table(headers,rows){return '<div class="table"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function page(title,body){return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>html{color:#202020;background:#f5f5f5;font:15px/1.5 system-ui,sans-serif}body{max-width:1200px;margin:24px auto;padding:0 18px}h1{font-size:25px}h2{font-size:20px;margin-top:32px}h3{font-size:17px}p,td,li{overflow-wrap:anywhere}.table{overflow:auto;background:#fff;border:1px solid #aaa}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #ccc;max-width:460px;white-space:pre-wrap}th{background:#e8e8e8}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;padding:14px;border:1px solid #aaa}.muted{color:#505050}@media print{body{max-width:none;margin:0}th,td{font-size:10px;padding:5px}.table{overflow:visible}}</style><h1>'+esc(title)+'</h1>'+body+'</html>';}
function programmeCSV(w,programmeId){
 const r=reconciliation(w,programmeId),headers=['entity','source_key','record_id','current_revision','latest_delivery','actual_outcome','native_id','accepted_revision','current_revision_accepted','receipt_time','reason','aliases','fields','relationships'];
 return csvText(headers,r.records.map(x=>{const rec=get(w,'records',x.recordId);return {entity:x.entity,source_key:x.key,record_id:x.recordId,current_revision:x.revision,latest_delivery:x.latestDeliveryId,actual_outcome:x.status,native_id:x.nativeId,accepted_revision:x.acceptedRevision,current_revision_accepted:x.currentRevisionAccepted,receipt_time:x.receiptAt,reason:x.reason,aliases:JSON.stringify(rec.aliases),fields:JSON.stringify(rec.fields),relationships:JSON.stringify(rec.links)};}));
}
function renderProgrammeReport(w,programmeId){
 const r=reconciliation(w,programmeId),p=r.programme;let body='<p>'+esc(p.targetSystem)+' · '+esc(p.targetVersion)+' · Workspace '+esc(w.id)+' · revision '+w.revision+'</p><p>'+esc(p.notes)+'</p><h2>Reconciliation</h2>'+table(['Measure','Count'],Object.entries(r.counts));
 body+='<p>Accepted records and accepted current revisions are separate: an older receipt remains original history when a later correction has not yet been received. All target outcomes below are operator-recorded observations linked to retained originals.</p>';
 body+=table(['Entity / original key','Current revision','Actual outcome / native ID','Current revision accepted','Original result / reason'],r.records.map(x=>[x.entity+' / '+x.key,x.revision,x.status+(x.nativeId?' / '+x.nativeId:''),x.currentRevisionAccepted?'Yes':'No',x.latestReceiptId+'\n'+x.receiptAt+'\n'+x.reason]));
 body+='<h2>Original source editions</h2>'+table(['File / original system','Role / entity','Original period / edition','Rows / bytes / SHA-256'],w.files.filter(f=>f.programmeId===p.id).map(f=>[f.name+'\n'+f.sourceSystem,f.kind+' / '+f.entity,f.capturedAt+'\n'+(f.parentId?'Previous source: '+f.parentId:'Original selection'),f.rows.length+' rows · '+f.bytes+' bytes\n'+f.sha256]));
 for(const batch of w.batches.filter(b=>b.programmeId===p.id)){
  body+='<h2>'+esc(batch.title)+'</h2><p>Original '+esc(get(w,'files',batch.sourceId).name)+' · mapping '+esc(get(w,'profiles',batch.profileId).name)+' · '+esc(batch.createdAt)+'</p><p>'+esc(batch.notes)+'</p>';
  body+=table(['Source row','Decision / record','Reason / changes','Mapped values / retained relationships'],batch.rows.map(x=>[x.index,x.decision.action+'\n'+x.recordId+'\n'+(x.committedRecordRevision?'Revision '+x.committedRecordRevision:''),x.decision.reason+(x.changes.length?'\n'+x.changes.map(c=>c.field+': '+String(c.before)+' → '+String(c.after)).join('\n'):''),JSON.stringify(x.mapped,null,2)+'\n'+JSON.stringify(x.links)]));
 }
 body+='<h2>Prepared handovers and actual result editions</h2>';
 for(const d of w.deliveries.filter(d=>d.programmeId===p.id)){
  body+='<h3>'+esc(d.title)+'</h3><p>'+esc(d.id)+' · '+d.rows.length+' rows · '+esc(d.targetContractLabel)+'</p><p>CSV SHA-256 '+esc(d.csvSha256)+'<br>JSON SHA-256 '+esc(d.jsonSha256)+'</p>';
  for(const receipt of w.receipts.filter(x=>x.deliveryId===d.id)){
   body+='<h3>Original target outcome: '+esc(receipt.reference)+'</h3><p>'+esc(receipt.observedAt)+' · source '+esc(get(w,'files',receipt.evidenceFileId).name)+'</p><p>'+esc(receipt.notes)+'</p>'+table(['Original row','Outcome','Native ID','Reason / source'],receipt.rows.map(x=>[x.rowId,x.status,x.nativeId,x.reason+'\n'+x.evidenceFileId]));
  }
 }
 body+='<h2>Record histories</h2>';
 for(const rec of w.records.filter(x=>x.programmeId===p.id)){
  body+='<h3>'+esc(rec.entity+' · '+rec.key)+'</h3><p>Original identity aliases: '+esc(rec.aliases.join(', ')||'None')+'</p>'+table(['Revision','Original source / row','Reason / operator / time','Fields and links'],rec.revisions.map(x=>[x.revision,x.sourceId+'\n'+x.rowId,x.reason+'\n'+x.actor+'\n'+x.at,JSON.stringify(x.fields,null,2)+'\n'+JSON.stringify(x.links)]));
 }
 return page(p.title,body);
}
function deliveryFiles(w,deliveryId){
 validate(w);const d=get(w,'deliveries',deliveryId),p=get(w,'programmes',d.programmeId),body='<p>'+esc(d.targetSystem)+' · '+esc(d.targetVersion)+'</p><p>'+esc(d.targetContractLabel)+'</p><p>Frozen handover '+esc(d.id)+' · prepared '+esc(d.createdAt)+' by '+esc(d.actor)+'</p><p>'+esc(d.notes)+'</p><p>These are the exact configured receiving columns. This file does not send data or assert target acceptance. Original batch '+esc(d.batchId)+' and complete source/history remain in the working handover.</p>'+table(['Source row','Staged record / revision',...d.columns],d.rows.map(x=>[x.rowId,x.recordId+' / '+x.recordRevision,...d.columns.map(k=>x.fields[k])]));
 return [{name:d.id+'.csv',mime:'text/csv;charset=utf-8',content:d.csv},{name:d.id+'.json',mime:'application/json',content:d.json},{name:d.id+'.html',mime:'text/html;charset=utf-8',content:page(p.title+' — '+d.title,body)}];
}
return Object.freeze({VERSION,SCHEMA,MAX,FILE_MAX,create,mutate,validate,exportWorkspace,importWorkspace,uid,hash,canonical,bytes,parseCSV,reviewBatch,reviewDelivery,reviewReceipt,reconciliation,overview,sourceView,recordView,renderProgrammeReport,programmeCSV,deliveryFiles});
});
