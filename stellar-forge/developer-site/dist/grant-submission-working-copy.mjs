import {validateApplicationReturnWorking} from './grant-application-return-working.mjs';
// MIT. Complete unfinished preparation beside the original saved submission.
import {SCHEMA, MAX_BYTES, createDraft, validateDraftShape, measureText} from './grant-submission-core.mjs';
import {verifyHandoverContents, verifyReviewerSource, contentHash} from './grant-handover-source.mjs';
import {openFormWorkbook} from './grant-form-workbook.mjs';
import {saveDraft, loadDraft, listDrafts} from './drafts.mjs';
export const SUBMISSION_WORKING_SCHEMA='stellar-forge.grant-submission-working-copy.v1';
export const SUBMISSION_WORKING_ENVELOPE='stellar-forge.grant-submission-working-export.v1';
export const SUBMISSION_WORKING_MAX_BYTES=64*1024*1024;
const clone=value=>structuredClone(value);
const need=(value,message)=>{if(!value)throw new Error(message);};
const text=(value,name,max=SUBMISSION_WORKING_MAX_BYTES)=>need(typeof value==='string'&&value.length<=max,name+' must be complete text within its allowance.');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const date=value=>need(typeof value==='string'&&Number.isFinite(Date.parse(value)),'Retain the original working date.');
const views=['answers','fields','review','source','planning','products','returns','handover','history','saved'];
// These are JSON-only editor snapshots. Count complete strings without making
// whole encoded copies on every autosave; reject values JSON would silently lose.
function jsonSize(value,limit=SUBMISSION_WORKING_MAX_BYTES){
  let size=0;const active=new Set();
  const add=n=>{size+=n;need(size<=limit,'The complete working copy exceeds 64 MiB. Keep the prior copy and download existing work before receiving more source.');};
  const quoted=s=>{add(2);for(let i=0;i<s.length;i++){const n=s.charCodeAt(i);if(n===34||n===92||[8,9,10,12,13].includes(n))add(2);else if(n<32)add(6);else if(n<128)add(1);else if(n<2048)add(2);else if(n>=0xd800&&n<=0xdbff&&i+1<s.length&&s.charCodeAt(i+1)>=0xdc00&&s.charCodeAt(i+1)<=0xdfff){add(4);i++;}else if(n>=0xd800&&n<=0xdfff)add(6);else add(3);}};
  function visit(v){
    if(v===null){add(4);return;}if(typeof v==='string'){quoted(v);return;}
    if(typeof v==='boolean'){add(v?4:5);return;}
    if(typeof v==='number'){need(Number.isFinite(v),'Working values must remain finite JSON numbers.');add(JSON.stringify(v).length);return;}
    need(object(v)||Array.isArray(v),'Keep complete JSON working values.');need(!active.has(v),'Working snapshots cannot contain cycles.');active.add(v);add(2);
    if(Array.isArray(v)){for(let i=0;i<v.length;i++){if(i)add(1);visit(v[i]);}}
    else{let first=true;for(const key of Object.keys(v)){if(!first)add(1);first=false;quoted(key);add(1);visit(v[key]);}}
    active.delete(v);
  }visit(value);return size;
}
export function submissionLimitValue(raw){
  text(raw,'Unfinished issuer limit',10000);
  if(raw==='')return null;
  return /^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))&&Number(raw)>0?Number(raw):0;
}
export function newSubmissionWorkingCopy({id=crypto.randomUUID(),at=new Date().toISOString()}={}){
  return {schema:SUBMISSION_WORKING_SCHEMA,id,createdAt:at,label:'Untitled application',folder:'SCF submission working — Untitled application',
    draft:null,incoming:null,incomingLabel:'Current application reader',
    ui:{view:'answers',format:'plain',selectedAnswer:'project',selectedField:null},
    limits:[],workbook:null,applicationReturn:null,native:{id:null,revision:0,dirty:false},receivedFrom:null};
}
export function checkSubmissionWorkingCopy(value){
  need(object(value)&&value.schema===SUBMISSION_WORKING_SCHEMA,'Open the complete submission working copy.');
  text(value.id,'Working identity',200);need(value.id.length>0,'Keep the working identity.');date(value.createdAt);
  text(value.label,'Working label',1000);need(value.folder==='SCF submission working — '+value.label,'Retain the working label.');
  need(value.draft===null||object(value.draft)&&value.draft.schema===SCHEMA,'Retain the original complete application draft.');
  need(value.incoming===null||object(value.incoming),'Retain the complete incoming source comparison.');
  text(value.incomingLabel,'Incoming source label',2000);
  need(object(value.ui)&&views.includes(value.ui.view)&&['plain','markdown'].includes(value.ui.format),'Keep the original editor selection.');
  text(value.ui.selectedAnswer,'Selected answer',200);need(value.ui.selectedField===null||typeof value.ui.selectedField==='string','Keep the selected field.');
  need(Array.isArray(value.limits)&&value.limits.length<=20000,'Retain bounded complete unfinished issuer limits.');const seen=new Set();
  for(const row of value.limits){
    need(object(row)&&typeof row.fieldId==='string'&&!seen.has(row.fieldId),'Keep one unfinished limit record per native field.');seen.add(row.fieldId);
    const field=value.draft?.fields?.find(field=>field.id===row.fieldId);need(field,'Keep each unfinished limit with its original field.');
    for(const key of ['wordLimit','characterLimit']){text(row[key],'Raw '+key,10000);need(Object.is(field[key],submissionLimitValue(row[key])),'The unfinished limit must match its exact displayed text.');}
  }
  if(value.workbook!==null){
    const w=value.workbook;need(object(w)&&object(w.workbook)&&[',','\t'].includes(w.separator)&&typeof w.expanded==='boolean'&&object(w.decisions),'Retain the complete unapplied form workbook.');
    text(w.profile,'Unfinished profile worksheet',16*1024*1024);text(w.fields,'Unfinished field worksheet',16*1024*1024);
    for(const [key,choice]of Object.entries(w.decisions)){text(key,'Workbook choice identity',2000);need(['current','incoming'].includes(choice),'Retain an explicit original workbook choice.');}
  }
  need(object(value.native)&&(value.native.id===null||typeof value.native.id==='string')&&Number.isSafeInteger(value.native.revision)&&value.native.revision>=0&&typeof value.native.dirty==='boolean','Retain the original native save reference.');
  need(value.native.id!==null||value.native.revision===0,'A separate native draft starts at revision zero.');
  validateApplicationReturnWorking(value.applicationReturn);
  jsonSize(value);return value;
}
export function submissionWorkingDraft(value){
  checkSubmissionWorkingCopy(value);if(!value.draft)return null;
  const draft=clone(value.draft);
  // Zero is an invalid native limit and prevents any original Save/Prepare from
  // treating an unfinished control as accepted. Only validation of this working
  // envelope substitutes null; exact original raw text and zero remain retained.
  for(const row of value.limits)for(const key of ['wordLimit','characterLimit'])
    if(submissionLimitValue(row[key])===0)draft.fields.find(field=>field.id===row.fieldId)[key]=null;
  return validateDraftShape(draft);
}
export async function verifySubmissionWorkingCopy(value){
  checkSubmissionWorkingCopy(value);
  const draft=submissionWorkingDraft(value);if(draft)await verifyHandoverContents(draft);
  if(value.workbook){need(draft,'An unapplied workbook requires its original draft.');const baselineDraft=createDraft(draft.sources.find(source=>source.sha256===draft.currentSource),{id:draft.id,title:draft.title,now:draft.createdAt});await openFormWorkbook(value.workbook.workbook,baselineDraft);}
  if(value.incoming)await verifyReviewerSource(value.incoming);
  if(value.draft){
    need(value.draft.answers.some(row=>row.id===value.ui.selectedAnswer),'The selected answer is absent from the retained application.');
    need(value.ui.selectedField===null||value.draft.fields.some(row=>row.id===value.ui.selectedField),'The selected field is absent from the retained application.');
  }else need(value.limits.length===0&&value.native.id===null,'A saved native reference requires the original application.');
  return value;
}
export async function exportSubmissionWorkingCopy(value,{at=new Date().toISOString()}={}){
  await verifySubmissionWorkingCopy(value);date(at);
  return JSON.stringify({schema:SUBMISSION_WORKING_ENVELOPE,exportedAt:at,sha256:await contentHash(JSON.stringify(value)),working:value})+'\n';
}
export async function importSubmissionWorkingCopy(source){
  text(source,'Complete working file',SUBMISSION_WORKING_MAX_BYTES+65536);
  need(measureText(source).utf8Bytes<=SUBMISSION_WORKING_MAX_BYTES+65536,'Open the complete working file within 64 MiB.');
  const packet=JSON.parse(source.replace(/^\uFEFF/,''));
  need(packet?.schema===SUBMISSION_WORKING_ENVELOPE&&packet.working,'Open the original complete submission working file.');date(packet.exportedAt);
  need(/^[a-f0-9]{64}$/.test(packet.sha256)&&await contentHash(JSON.stringify(packet.working))===packet.sha256,'The complete working file differs from its exported identity.');
  return verifySubmissionWorkingCopy(packet.working);
}
export async function forkSubmissionWorkingCopy(value,{id=crypto.randomUUID(),at=new Date().toISOString(),localNative=false}={}){
  await verifySubmissionWorkingCopy(value);const next=clone(value);
  next.receivedFrom={id:value.id,sha256:await contentHash(JSON.stringify(value)),at};next.id=id;next.createdAt=at;
  // A portable file cannot select an unrelated same-ID record in another browser.
  if(!localNative)next.native={id:null,revision:0,dirty:!!next.draft};
  return next;
}
export function saveSubmissionWorkingCopy(value,{revision=0}={}){
  checkSubmissionWorkingCopy(value);return saveDraft({id:value.id,revision,input:value});
}
export async function loadSubmissionWorkingCopy(id){
  const record=await loadDraft(id);need(record?.input?.schema===SUBMISSION_WORKING_SCHEMA,'This complete working copy is absent from the browser.');
  await verifySubmissionWorkingCopy(record.input);return record;
}
export async function listSubmissionWorkingCopies(){
  return (await listDrafts()).filter(row=>row.name?.startsWith('SCF submission working — '));
}
