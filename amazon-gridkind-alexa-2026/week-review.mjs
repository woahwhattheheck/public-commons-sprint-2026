// Household review files carry proposed inputs. The owned SQLite request and
// an explicit three-way decision determine a new week; daily approvals stay separate.
import {weekInputs,inspectWeek,planWeek,dateAt} from './weekly.mjs';

export const REQUEST_SCHEMA='gridkind-week-review-request/v1';
export const PACKAGE_SCHEMA='gridkind-week-review-package/v1';
export const RESPONSE_SCHEMA='gridkind-week-review-response/v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const clone=value=>structuredClone(value);
function need(ok,message){if(!ok)throw Error(message);}
function object(value,message){need(value&&typeof value==='object'&&!Array.isArray(value),message);return value;}
function string(value,label,max,{empty=false,multiline=false}={}){
  need(typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0),label+' must contain '+(empty?'0':'1')+'–'+max+' characters.');
  need(!(multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f\x7f]/).test(value),label+' contains unsupported control characters.');
  return value;
}
function keys(value,expected,label){
  object(value,label+' must be an object.');
  need(Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key)),label+' has missing or unsupported fields.');
}
function stable(value,depth=0){
  need(depth<=40,'Review data is nested too deeply.');
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'){need(Number.isFinite(value),'Review data contains a non-finite number.');return value;}
  if(Array.isArray(value))return value.map(item=>stable(item,depth+1));
  object(value,'Review data must contain JSON values.');
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key],depth+1)]));
}
export function reviewDigest(value){return sha256(JSON.stringify(stable(value)));}
function same(a,b){return reviewDigest(a)===reviewDigest(b);}
function recordIdentity(record,kind){
  object(record,'Choose a saved '+kind+' record.');
  const {sha256:hash,...body}=record;
  need(HASH.test(hash||'')&&reviewDigest(body)===hash,'The saved record content does not match its original digest.');
  need(UUID.test(record.id||'')&&record.kind===kind&&Number.isSafeInteger(record.sequence)&&record.sequence>0,'Invalid saved '+kind+' identity.');
  need(typeof record.createdAt==='string'&&Number.isFinite(Date.parse(record.createdAt)),'Invalid saved record date.');
  need(record.parentId===null||UUID.test(record.parentId||''),'Invalid saved record parent.');
  object(record.sourcePins,'The saved record must retain its producing source identities.');
  return record;
}
export function inspectWeekRecord(record){
  recordIdentity(record,'week');inspectWeek(record.detail?.report);return record;
}
export function createRequestDetail(baseRecord,{recipient='',message=''}={}){
  inspectWeekRecord(baseRecord);
  string(recipient,'Recipient label',100,{empty:true});
  string(message,'Review instructions',4000,{empty:true,multiline:true});
  return {schema:REQUEST_SCHEMA,recipient:recipient.trim(),message,baseRecord:clone(baseRecord)};
}
export function inspectRequestRecord(record){
  recordIdentity(record,'week-request');
  const detail=object(record.detail,'The review request is incomplete.');
  keys(detail,['schema','recipient','message','baseRecord'],'Review request detail');
  need(detail.schema===REQUEST_SCHEMA,'Unsupported household review request.');
  string(detail.recipient,'Recipient label',100,{empty:true});
  string(detail.message,'Review instructions',4000,{empty:true,multiline:true});
  inspectWeekRecord(detail.baseRecord);
  need(record.parentId===detail.baseRecord.id&&record.sequence>detail.baseRecord.sequence,'The review request is not linked to its original saved week.');
  return record;
}
export function requestPackage(record){
  inspectRequestRecord(record);
  return {schema:PACKAGE_SCHEMA,request:clone(record)};
}
export function inspectRequestPackage(bundle){
  keys(bundle,['schema','request'],'Review package');
  need(bundle.schema===PACKAGE_SCHEMA,'Choose a GridKind household week review package.');
  inspectRequestRecord(bundle.request);return clone(bundle);
}
export function inspectResponse(response,requestRecord){
  inspectRequestRecord(requestRecord);
  keys(response,['schema','request','responseId','reviewer','notes','dayNotes','input'],'Returned review');
  need(response.schema===RESPONSE_SCHEMA,'Choose a GridKind returned week review.');
  keys(response.request,['id','sha256'],'Returned request identity');
  need(response.request.id===requestRecord.id&&response.request.sha256===requestRecord.sha256,'The return belongs to a different original review request.');
  need(UUID.test(response.responseId||''),'The returned review needs its original response identity.');
  string(response.reviewer,'Reviewer name',100);
  string(response.notes,'Review notes',8000,{empty:true,multiline:true});
  need(Array.isArray(response.dayNotes)&&response.dayNotes.length===7,'Retain one review-note field for each of the seven days.');
  response.dayNotes.forEach(note=>string(note,'Day review notes',2000,{empty:true,multiline:true}));
  const input=weekInputs(response.input),base=requestRecord.detail.baseRecord.detail.report.input;
  need(input.startDate===base.startDate,'A returned review must keep the original seven calendar dates. Request a separate week to change dates.');
  return clone(response);
}
export function createResponse(requestRecord,{responseId,reviewer,notes='',dayNotes=Array(7).fill(''),input}){
  const response={schema:RESPONSE_SCHEMA,request:{id:requestRecord.id,sha256:requestRecord.sha256},
    responseId,reviewer:typeof reviewer==='string'?reviewer.trim():reviewer,notes,dayNotes:clone(dayNotes),input:weekInputs(input)};
  return inspectResponse(response,requestRecord);
}
function field(key,label,base,current,returned){
  const ownerChanged=!same(current,base),reviewerChanged=!same(returned,base),equal=same(current,returned);
  const status=equal?(ownerChanged?'same':'unchanged'):ownerChanged&&reviewerChanged?'conflict':reviewerChanged?'returned':'current';
  return {key,label,status,ownerChanged,reviewerChanged,defaultChoice:status==='conflict'?null:status==='returned'?'returned':'current',
    base:clone(base),current:clone(current),returned:clone(returned)};
}
function reviewComparison(requestRecord,targetRecord,response){
  inspectRequestRecord(requestRecord);inspectWeekRecord(targetRecord);
  const original=inspectResponse(response,requestRecord),base=weekInputs(requestRecord.detail.baseRecord.detail.report.input);
  const current=weekInputs(targetRecord.detail.report.input),returned=weekInputs(original.input);
  need(current.startDate===base.startDate,'Choose an owned saved week with the same seven calendar dates as this review.');
  const fields=[field('name','Week name',base.name,current.name,returned.name),
    ...base.days.map((day,index)=>field('day-'+index,dateAt(base.startDate,index),day,current.days[index],returned.days[index]))];
  return {schema:'gridkind-week-review-preview/v1',requestRecordId:requestRecord.id,requestSha256:requestRecord.sha256,
    targetRecordId:targetRecord.id,targetSha256:targetRecord.sha256,responseId:original.responseId,responseSha256:reviewDigest(original),
    reviewer:original.reviewer,notes:original.notes,dayNotes:clone(original.dayNotes),startDate:base.startDate,
    fields,conflicts:fields.filter(row=>row.status==='conflict').map(row=>row.key),
    sourceChanged:!same(requestRecord.detail.baseRecord.sourcePins,targetRecord.sourcePins),
    baseReport:clone(requestRecord.detail.baseRecord.detail.report),currentReport:clone(targetRecord.detail.report),
    returnedInput:returned,
    attribution:'Reviewer name is supplied in the returned file. File hashes identify content, not a verified person.'};
}
export function previewReview(requestRecord,targetRecord,response){
  const comparison=reviewComparison(requestRecord,targetRecord,response);
  const {returnedInput,...preview}=comparison;
  return {...preview,returnedReport:planWeek(returnedInput)};
}
export function resolveReviewInput(requestRecord,targetRecord,response,choices={}){
  object(choices,'Review choices must be an object.');
  const preview=reviewComparison(requestRecord,targetRecord,response),allowed=new Set(preview.fields.map(row=>row.key));
  for(const [key,choice]of Object.entries(choices))need(allowed.has(key)&&['current','returned'].includes(choice),'Choose current or returned for a listed review field.');
  const decisions=preview.fields.map(row=>{
    const choice=Object.hasOwn(choices,row.key)?choices[row.key]:row.defaultChoice;
    need(choice!==null,'Choose current or returned for '+row.label+' before applying this review.');
    return {key:row.key,label:row.label,status:row.status,choice,explicit:Object.hasOwn(choices,row.key)};
  });
  const selected=Object.fromEntries(decisions.map(row=>[row.key,clone(preview.fields.find(field=>field.key===row.key)[row.choice])]));
  const input=weekInputs({name:selected.name,startDate:preview.startDate,days:Array.from({length:7},(_,index)=>selected['day-'+index])});
  return {schema:'gridkind-week-review-reconciliation/v1',input,decisions,
    requestRecordId:preview.requestRecordId,requestSha256:preview.requestSha256,
    targetRecordId:preview.targetRecordId,targetSha256:preview.targetSha256,
    responseId:preview.responseId,responseSha256:preview.responseSha256,
    response:inspectResponse(response,requestRecord)};
}
export function reconcileReview(requestRecord,targetRecord,response,choices={}){
  const resolved=resolveReviewInput(requestRecord,targetRecord,response,choices);
  return {...resolved,report:planWeek(resolved.input)};
}
function sha256(value) {
 const raw=encodeURIComponent(value).replace(/%([0-9A-F]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)));
 const bytes=Array.from(raw,c=>c.charCodeAt(0)),bits=bytes.length*8;
 bytes.push(128);while(bytes.length%64!==56)bytes.push(0);
 for(let i=7;i>=0;i--)bytes.push(Math.floor(bits/2**(8*i))&255);
 const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
 const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let offset=0;offset<bytes.length;offset+=64){
 const w=new Uint32Array(64);for(let i=0;i<16;i++)w[i]=((bytes[offset+i*4]<<24)|(bytes[offset+i*4+1]<<16)|(bytes[offset+i*4+2]<<8)|bytes[offset+i*4+3])>>>0;
 for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rotr(x,7)^rotr(x,18)^(x>>>3))+w[i-7]+(rotr(y,17)^rotr(y,19)^(y>>>10)))>>>0;}
 let [a,b,c,d,e,f,g,j]=h;
 for(let i=0;i<64;i++){const t1=(j+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
 [a,b,c,d,e,f,g,j].forEach((x,i)=>h[i]=(h[i]+x)>>>0);
 }
 return h.map(x=>x.toString(16).padStart(8,"0")).join("");
}
