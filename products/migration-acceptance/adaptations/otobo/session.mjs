// SPDX-License-Identifier: MIT
import {inspectConfigurationCapture,FAMILIES} from './core.mjs';
import {validateProject,textPin,clone,canonical} from './project.mjs';
export const SCHEMA='otobo.review-working.v1',MAX_BYTES=512*1024*1024;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),sha=/^[a-f0-9]{64}$/;
const need=(ok,message)=>{if(!ok)throw Error(message);};
const string=(v,label,max=1048576)=>need(typeof v==='string'&&v.length<=max,'Invalid '+label+'.');
const keys=(v,allowed,label)=>{need(object(v)&&Object.keys(v).every(k=>allowed.includes(k)),'Invalid '+label+' fields.');};
export const recordKey=(family,name)=>JSON.stringify([family,name]);
export function emptyWorking(){return{intake:{source:null,before:null,after:null},project:null,editor:{planText:'',projectId:'',title:'OTOBO configuration handover',reviewer:'',reason:'',approve:false,decisionDrafts:{}},view:{tab:'intake',family:'all',query:'',selected:null}};}
export function newSession(){return{schema:SCHEMA,working:emptyWorking(),history:[],nextHistory:1};}
function input(value,side){
 if(value===null)return null;
 keys(value,['filename','text','bytes','sha256','generated'],'retained capture');string(value.filename,'capture filename',4096);string(value.text,'capture JSON',MAX_BYTES);
 need(Number.isSafeInteger(value.bytes)&&value.bytes>=0&&sha.test(value.sha256),'Retain complete capture file identity.');
 const pin=textPin(value.text);need(pin.bytes===value.bytes&&pin.sha256===value.sha256,'Retained capture file differs: '+value.filename);
 need(value.generated===undefined||typeof value.generated==='boolean','Invalid capture origin.');
 const capture=JSON.parse(value.text.replace(/^\uFEFF/,'')),result=inspectConfigurationCapture(capture);need(capture.side===side,'The selected capture has the wrong source/target role.');return result;
}
export function validateWorking(w){
 keys(w,['intake','project','editor','view'],'working');keys(w.intake,['source','before','after'],'capture selection');
 const source=input(w.intake.source,'source'),before=input(w.intake.before,'target'),after=input(w.intake.after,'target');
 if(source&&before)need(source.capture.caseId===before.capture.caseId,'Source and baseline belong to different cases.');
 if(after){need(source&&before,'Retain source and baseline with the returned target.');need(after.capture.caseId===source.capture.caseId&&after.capture.workspaceReference===before.capture.workspaceReference,'Returned target belongs to another case or workspace.');}
 if(w.project!==null){
  validateProject(w.project);const c=w.project.capture;
  need(c.schema==='otobo.review-source.v1'&&source&&before,'A reviewed project needs its original source and target baseline.');
  need(canonical(c.source)===canonical(source.capture)&&canonical(c.before)===canonical(before.capture)&&canonical(c.after??null)===canonical(after?.capture??null),'Project capture differs from the selected retained files.');
 }
 const e=w.editor;keys(e,['planText','projectId','title','reviewer','reason','approve','decisionDrafts'],'editor');
 string(e.planText,'complete plan text',32*1024*1024);string(e.projectId,'project identifier',120);string(e.title,'project title',300);string(e.reviewer,'reviewer',300);string(e.reason,'review reason');need(typeof e.approve==='boolean','Invalid review selection.');
 need(object(e.decisionDrafts),'Keep named decision drafts.');
 for(const [k,d]of Object.entries(e.decisionDrafts)){
  let identity;try{identity=JSON.parse(k);}catch{throw Error('Invalid decision draft identity.');}
  need(Array.isArray(identity)&&identity.length===2&&FAMILIES.includes(identity[0])&&typeof identity[1]==='string'&&source?.entries.has(k),'Draft belongs to an unselected source entry.');
  keys(d,['action','reason','genericAgentReviewed','overridesText','basis','overrideSourcePath','overrideTargetEntry','overrideTargetPath','overrideReason'],'decision draft');
  for(const name of ['action','reason','overridesText','overrideSourcePath','overrideTargetEntry','overrideTargetPath','overrideReason'])string(d[name],name,name==='action'?100:1048576);
  need(typeof d.genericAgentReviewed==='boolean'&&sha.test(d.basis),'Retain exact original draft basis.');
 }
 keys(w.view,['tab','family','query','selected'],'view');need(['intake','plan','comparison','history','files','native'].includes(w.view.tab),'Unknown view.');
 need(w.view.family==='all'||FAMILIES.includes(w.view.family),'Unknown family filter.');string(w.view.query,'record filter',4096);
 need(w.view.selected===null||typeof w.view.selected==='string'&&!!source?.entries.has(w.view.selected),'Selected source record is absent.');
 return w;
}
export function receiveSession(value){
 if(typeof value==='string')value=JSON.parse(value);
 keys(value,['schema','working','history','nextHistory'],'complete working copy');need(value.schema===SCHEMA,'Open a complete OTOBO working copy.');
 need(Array.isArray(value.history)&&value.history.length<=500&&Number.isSafeInteger(value.nextHistory)&&value.nextHistory>0,'Retain complete prior working editions.');
 validateWorking(value.working);const seen=new Set();
 for(const entry of value.history){keys(entry,['id','at','reason','working'],'saved history');need(Number.isSafeInteger(entry.id)&&entry.id>0&&entry.id<value.nextHistory&&!seen.has(entry.id),'Original history identities differ.');seen.add(entry.id);string(entry.at,'history time',100);string(entry.reason,'history reason');validateWorking(entry.working);}
 const text=JSON.stringify(value,null,2)+'\n';need(textPin(text).bytes<=MAX_BYTES,'Complete working copy exceeds 512 MiB. Keep this original file and use a smaller explicitly selected capture.');
 return clone(value);
}
export function serializeSession(session){const checked=receiveSession(session);return JSON.stringify(checked,null,2)+'\n';}
export function remember(session,reason,at){
 const out=clone(session);need(out.history.length<500,'Save the complete original working history before starting a separate workspace.');
 out.history.push({id:out.nextHistory++,at,reason,working:clone(out.working)});return out;
}
export function retainedInput(filename,text,generated=false){return{filename,text,...textPin(text),generated};}
export function receiveBareProject(project){
 validateProject(project);const capture=project.capture;need(capture.schema==='otobo.review-source.v1'&&capture.source&&capture.before,'Open an original OTOBO project.');
 const session=newSession(),w=session.working;
 for(const role of ['source','before','after'])if(capture[role])w.intake[role]=retainedInput('project-'+role+'-capture.json',JSON.stringify(capture[role],null,2)+'\n',true);
 w.project=clone(project);w.editor.planText=JSON.stringify(project.mapping,null,2)+'\n';w.editor.projectId=project.id;w.editor.title=project.title;w.view.tab='plan';return receiveSession(session);
}
