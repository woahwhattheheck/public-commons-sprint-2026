// MIT. Complete unfinished review work beside the original recorded review journal.
import { reviewRoundView, readSubmissionExport, compareReviewDraft, reviewSha256, REVIEW_MAX_BYTES } from './grant-review-round-core.mjs';
import { saveDraft, loadDraft, listDrafts } from './drafts.mjs';

export const WORKING_SCHEMA='stellar-forge.grant-review-working-copy.v1';
export const WORKING_ENVELOPE='stellar-forge.grant-review-working-export.v1';
export const WORKING_MAX_BYTES=112*1024*1024;
const clone=value=>JSON.parse(JSON.stringify(value));
// Count the native JSON representation without retaining a second complete JSON
// string or a complete UTF-8 byte array. Traverse the full value so native
// toJSON/getter/cycle failures are not hidden by an already-exceeded allowance.
const boxedJSONKinds=[
  [Number.prototype.valueOf,value=>+value],
  [String.prototype.valueOf,value=>String(value)],
  [Boolean.prototype.valueOf,value=>Boolean.prototype.valueOf.call(value)],
  [BigInt.prototype.valueOf,value=>BigInt.prototype.valueOf.call(value)]
];
function jsonUnbox(value){
  for(const [read,convert]of boxedJSONKinds){
    let matches=false;try{read.call(value);matches=true;}catch{}
    if(matches)return convert(value);
  }
  return value;
}
function quotedBytes(value){
  let bytes=2;
  for(let i=0;i<value.length;i++){
    const n=value.charCodeAt(i);
    if(n===34||n===92||n===8||n===9||n===10||n===12||n===13){bytes+=2;continue;}
    if(n<32){bytes+=6;continue;}
    if(n>=0xd800&&n<=0xdbff){
      const next=value.charCodeAt(i+1);
      if(next>=0xdc00&&next<=0xdfff){bytes+=4;i++;}else bytes+=6;
    }else if(n>=0xdc00&&n<=0xdfff)bytes+=6;
    else bytes+=n<=0x7f?1:n<=0x7ff?2:3;
  }
  return bytes;
}
function textBytes(value){
  let bytes=0;for(const ch of value){const n=ch.codePointAt(0);bytes+=n<=0x7f?1:n<=0x7ff?2:n<=0xffff?3:4;}return bytes;
}
function jsonBytes(value,limit=WORKING_MAX_BYTES){
  let bytes=0;const active=new Set();
  const add=n=>{bytes=Math.min(limit+1,bytes+n);};
  function prepare(value,key){
    if(value!==null&&(typeof value==='object'||typeof value==='function'||typeof value==='bigint')){
      const toJSON=value.toJSON;if(typeof toJSON==='function')value=toJSON.call(value,key);
    }
    if(value!==null&&typeof value==='object')value=jsonUnbox(value);
    return value;
  }
  const omitted=value=>value===undefined||typeof value==='function'||typeof value==='symbol';
  function write(value){
    if(value===null){add(4);return;}
    if(typeof value==='string'){add(quotedBytes(value));return;}
    if(typeof value==='number'){add(Number.isFinite(value)?JSON.stringify(value).length:4);return;}
    if(typeof value==='boolean'){add(value?4:5);return;}
    if(typeof value==='bigint')throw new TypeError('Do not know how to serialize a BigInt');
    if(active.has(value))throw new TypeError('Converting circular structure to JSON');
    active.add(value);
    try{
      if(Array.isArray(value)){
        add(2);const length=value.length;
        for(let i=0;i<length;i++){if(i)add(1);const item=prepare(value[i],String(i));if(omitted(item))add(4);else write(item);}
      }else{
        add(2);let first=true;
        for(const key of Object.keys(value)){
          const item=prepare(value[key],key);if(omitted(item))continue;
          if(!first)add(1);first=false;add(quotedBytes(key)+1);write(item);
        }
      }
    }finally{active.delete(value);}
  }
  const prepared=prepare(value,'');if(!omitted(prepared))write(prepared);return bytes;
}
// Stable descriptors use sorted keys and the original array map/join behavior.
// Yield complete, bounded escaped string fragments; do not build either whole
// canonical descriptor simply to compare it with the original.
function* quotedPieces(value){
  yield '"';
  for(let start=0;start<value.length;){
    let end=Math.min(value.length,start+32768);
    if(end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff&&value.charCodeAt(end)>=0xdc00&&value.charCodeAt(end)<=0xdfff)end--;
    yield JSON.stringify(value.slice(start,end)).slice(1,-1);start=end;
  }
  yield '"';
}
function* stablePieces(value,arrayItem=false){
  if(Array.isArray(value)){
    yield '[';const length=value.length;
    for(let i=0;i<length;i++){if(i)yield ',';if(i in value)yield* stablePieces(value[i],true);}
    yield ']';
  }else if(value&&typeof value==='object'){
    yield '{';let first=true;
    for(const key of Object.keys(value).sort()){
      if(!first)yield ',';first=false;yield* quotedPieces(key);yield ':';yield* stablePieces(value[key]);
    }
    yield '}';
  }else if(typeof value==='string')yield* quotedPieces(value);
  else{const text=JSON.stringify(value);if(text!==undefined)yield text;else if(!arrayItem)yield 'undefined';}
}
function sameStable(left,right){
  const a=stablePieces(left),b=stablePieces(right);
  let x=a.next(),y=b.next(),xi=0,yi=0,equal=true;
  while(true){
    while(!x.done&&xi===x.value.length){x=a.next();xi=0;}
    while(!y.done&&yi===y.value.length){y=b.next();yi=0;}
    if(x.done||y.done){
      if(!x.done)for(const piece of a){}
      if(!y.done)for(const piece of b){}
      return equal&&x.done&&y.done;
    }
    const length=Math.min(x.value.length-xi,y.value.length-yi);
    if(x.value.slice(xi,xi+length)!==y.value.slice(yi,yi+length))equal=false;
    xi+=length;yi+=length;
  }
}
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const string=(value,name,max=WORKING_MAX_BYTES)=>need(typeof value==='string'&&value.length<=max,name+' must be complete text within its allowance.');
const object=(value,name)=>need(value&&typeof value==='object'&&!Array.isArray(value),name+' must be an object.');
const iso=value=>need(typeof value==='string'&&new Date(value).toISOString()===value,'Retain the original complete UTC time.');
function pairs(value,label,max=20000){
  need(Array.isArray(value)&&value.length<=max,label+' exceeds its entry allowance.');
  const seen=new Set();
  for(const row of value){need(Array.isArray(row)&&row.length===2,label+' must retain complete key/value pairs.');string(row[0],label+' key',2000);need(!seen.has(row[0]),label+' repeats a key.');seen.add(row[0]);object(row[1],label+' value');}
}
export function checkWorkingShape(value){
  object(value,'Working copy');need(value.schema===WORKING_SCHEMA,'Open a complete Submission review working copy.');
  string(value.id,'Working identity',200);need(value.id.length>0,'Keep the working identity.');iso(value.createdAt);
  string(value.label,'Working copy name',1000);need(value.folder==='SCF review working — '+value.label,'Retain the working-copy browser label.');
  need(value.round===null||value.round?.schema==='stellar-forge.grant-review-round.v1','Retain the original recorded review separately.');
  object(value.ui,'Working selections');
  need(['targets','saved','compare','changes','sources','history','finish'].includes(value.ui.screen),'Select an original review view.');
  for(const field of ['selectedTarget','newTitle','newPerson','newFormat','newParticipant'])string(value.ui[field],'Working '+field);
  need(['plain','markdown'].includes(value.ui.newFormat),'Keep the selected copy format.');
  for(const field of ['actorId','viewedEdition'])need(value.ui[field]===null||typeof value.ui[field]==='string','Keep the selected '+field+'.');
  pairs(value.forms,'Unrecorded forms');pairs(value.contexts,'Form contexts');pairs(value.carryChoices,'Revision choices');
  need(value.forms.length===value.contexts.length,'Retain the source context for every unfinished form.');
  const contexts=new Map(value.contexts);
  for(const [key,raw]of value.forms){
    const c=contexts.get(key);need(c&&c.roundId===value.round?.id,'The unfinished form lost its original review.');
    for(const f of ['editionId','actorId','kind','extra'])string(c[f],'Form context '+f,2000);
    need(key===[c.roundId,c.editionId,c.actorId,c.kind,c.extra].join('|'),'Keep the original form/context identity.');
    const fields={decision:['decision','note'],change:['title','priority','quote','note'],reply:['response','note'],resolve:['status','note'],receive:['note'],finish:['outcome','note'],reopen:['note']}[c.kind];
    need(fields,'Unsupported unfinished form kind.');for(const f of fields)string(raw[f],'Unfinished '+f);
    if(['decision','change','reply'].includes(c.kind)){
      need(Array.isArray(raw.references)&&raw.references.length<=1000,'Retain bounded unfinished references.');
      for(const ref of raw.references){object(ref,'Unfinished reference');for(const f of ['label','url','note'])string(ref[f],'Unfinished reference '+f);}
    }
  }
  for(const [,choice]of value.carryChoices){string(choice.choice,'Unfinished carry choice',1000);string(choice.note,'Unfinished carry note');}
  object(value.native,'Native saved review selection');
  need(value.native.id===null||typeof value.native.id==='string','Keep the original browser review identity.');
  need(Number.isSafeInteger(value.native.revision)&&value.native.revision>=0&&typeof value.native.dirty==='boolean','Keep the native browser revision and save state.');
  need(value.native.id!==null||value.native.revision===0,'A new native record starts at revision zero.');
  for(const key of ['incoming','initialCapture'])need(value[key]===null||typeof value[key]==='object','Keep the complete selected original draft.');
  need(value.incoming!==null||value.carryChoices.length===0,'Revision choices require their original incoming draft.');
  return value;
}
export async function validateWorkingCopy(value){
  checkWorkingShape(value);
  // Validate retained native bytes, never coerce unfinished form values into decisions.
  const view=value.round?await reviewRoundView(value.round):null;
  for(const key of ['incoming','initialCapture']){
    const old=value[key];if(!old)continue;
    const actual=await readSubmissionExport(old.exportText,{fileName:old.fileName,receivedAt:old.receivedAt});
    need(sameStable(actual,old),'The complete '+key+' descriptor differs from its original bytes.');
  }
  if(value.incoming){need(value.round,'An incoming revision requires its original review.');await compareReviewDraft(value.round,value.incoming);}
  if(view){
    need(value.ui.actorId===null||view.participants.some(p=>p.id===value.ui.actorId),'The selected participant is absent from this review.');
    need(value.ui.viewedEdition===null||value.round.editions.some(e=>e.id===value.ui.viewedEdition),'The viewed original edition is absent.');
    for(const [,context]of value.contexts){
      need(value.round.editions.some(e=>e.id===context.editionId)&&view.participants.some(p=>p.id===context.actorId),'An unfinished form names a missing original edition or participant.');
    }
  }else need(value.forms.length===0&&value.carryChoices.length===0,'Forms require the original recorded review.');
  need(jsonBytes(value)<=WORKING_MAX_BYTES,'The complete working copy exceeds112 MiB. Download existing work before selecting another source.');
  return clone(value);
}
export function newWorkingCopy({id=crypto.randomUUID(),at=new Date().toISOString(),label='Untitled review'}={}){
  return {schema:WORKING_SCHEMA,id,createdAt:at,label,folder:'SCF review working — '+label,round:null,incoming:null,initialCapture:null,
    ui:{screen:'targets',selectedTarget:'application:application',viewedEdition:null,actorId:null,newTitle:'',newPerson:'',newFormat:'plain',newParticipant:''},
    forms:[],contexts:[],carryChoices:[],native:{id:null,revision:0,dirty:false},receivedFrom:null};
}
export async function exportWorkingCopy(value,{at=new Date().toISOString()}={}){
  const working=await validateWorkingCopy(value);iso(at);
  return JSON.stringify({schema:WORKING_ENVELOPE,exportedAt:at,sha256:await reviewSha256(JSON.stringify(working)),working})+'\n';
}
export async function importWorkingCopy(text){
  string(text,'Complete working export',WORKING_MAX_BYTES+65536);
  need(textBytes(text)<=WORKING_MAX_BYTES+65536,'The full working export exceeds112 MiB.');
  const packet=JSON.parse(text);need(packet?.schema===WORKING_ENVELOPE&&packet.working,'Choose a complete review working package.');
  need(/^[a-f0-9]{64}$/.test(packet.sha256)&&await reviewSha256(JSON.stringify(packet.working))===packet.sha256,'The working package differs from its complete original content.');
  return validateWorkingCopy(packet.working);
}
export async function forkWorkingCopy(value,{id=crypto.randomUUID(),at=new Date().toISOString(),localNative=false}={}){
  const next=await validateWorkingCopy(value);
  const receivedFrom={id:next.id,sha256:await reviewSha256(JSON.stringify(next)),at};
  next.id=id;next.createdAt=at;next.receivedFrom=receivedFrom;
  // Portable or independently opened copies must not silently replace a browser-native review.
  if(!localNative)next.native={id:null,revision:0,dirty:!!next.round};
  return next;
}
export async function saveWorkingCopy(value,{recordId=value.id,revision=0}={}){
  checkWorkingShape(value);
  need(recordId===value.id,'Keep this independent working record identity.');
  need(jsonBytes(value)<=WORKING_MAX_BYTES,'The complete working copy exceeds112 MiB; no existing copy was changed.');
  return saveDraft({id:recordId,revision,input:value});
}
export async function loadWorkingCopy(id){
  const record=await loadDraft(id);need(record?.input?.schema===WORKING_SCHEMA,'This saved review working copy is unavailable.');
  const input=await validateWorkingCopy(record.input);return {...record,input};
}
export async function listWorkingCopies(){
  return (await listDrafts()).filter(row=>row.name?.startsWith('SCF review working — '));
}
