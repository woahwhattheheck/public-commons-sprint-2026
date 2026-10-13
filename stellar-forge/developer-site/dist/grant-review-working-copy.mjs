// MIT. Complete unfinished review work beside the original recorded review journal.
import { reviewRoundView, readSubmissionExport, compareReviewDraft, reviewSha256, REVIEW_MAX_BYTES } from './grant-review-round-core.mjs';
import { saveDraft, loadDraft, listDrafts } from './drafts.mjs';

export const WORKING_SCHEMA='stellar-forge.grant-review-working-copy.v1';
export const WORKING_ENVELOPE='stellar-forge.grant-review-working-export.v1';
export const WORKING_MAX_BYTES=112*1024*1024;
const clone=value=>JSON.parse(JSON.stringify(value));
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value);
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
    need(stable(actual)===stable(old),'The complete '+key+' descriptor differs from its original bytes.');
  }
  if(value.incoming){need(value.round,'An incoming revision requires its original review.');await compareReviewDraft(value.round,value.incoming);}
  if(view){
    need(value.ui.actorId===null||view.participants.some(p=>p.id===value.ui.actorId),'The selected participant is absent from this review.');
    need(value.ui.viewedEdition===null||value.round.editions.some(e=>e.id===value.ui.viewedEdition),'The viewed original edition is absent.');
    for(const [,context]of value.contexts){
      need(value.round.editions.some(e=>e.id===context.editionId)&&view.participants.some(p=>p.id===context.actorId),'An unfinished form names a missing original edition or participant.');
    }
  }else need(value.forms.length===0&&value.carryChoices.length===0,'Forms require the original recorded review.');
  need(new TextEncoder().encode(JSON.stringify(value)).length<=WORKING_MAX_BYTES,'The complete working copy exceeds112 MiB. Download existing work before selecting another source.');
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
  need(new TextEncoder().encode(text).length<=WORKING_MAX_BYTES+65536,'The full working export exceeds112 MiB.');
  const packet=JSON.parse(text);need(packet?.schema===WORKING_ENVELOPE&&packet.working,'Choose a complete review working package.');
  need(/^[a-f0-9]{64}$/.test(packet.sha256)&&await reviewSha256(JSON.stringify(packet.working))===packet.sha256,'The working package differs from its complete original content.');
  return validateWorkingCopy(packet.working);
}
export async function forkWorkingCopy(value,{id=crypto.randomUUID(),at=new Date().toISOString(),localNative=false}={}){
  const original=await validateWorkingCopy(value),next=clone(original);next.id=id;next.createdAt=at;
  next.receivedFrom={id:original.id,sha256:await reviewSha256(JSON.stringify(original)),at};
  // Portable or independently opened copies must not silently replace a browser-native review.
  if(!localNative)next.native={id:null,revision:0,dirty:!!next.round};
  return next;
}
export async function saveWorkingCopy(value,{recordId=value.id,revision=0}={}){
  checkWorkingShape(value);
  need(recordId===value.id,'Keep this independent working record identity.');
  need(new TextEncoder().encode(JSON.stringify(value)).length<=WORKING_MAX_BYTES,'The complete working copy exceeds112 MiB; no existing copy was changed.');
  return saveDraft({id:recordId,revision,input:value});
}
export async function loadWorkingCopy(id){
  const record=await loadDraft(id);need(record?.input?.schema===WORKING_SCHEMA,'This saved review working copy is unavailable.');
  const input=await validateWorkingCopy(record.input);return {...record,input};
}
export async function listWorkingCopies(){
  return (await listDrafts()).filter(row=>row.name?.startsWith('SCF review working — '));
}
