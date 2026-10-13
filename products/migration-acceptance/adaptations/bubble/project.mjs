// SPDX-License-Identifier: MIT
import {createSHA256} from '../../workbench/web/sha256.mjs';
export const SCHEMA='tjlabs.provider-migration-project.v1';
export const MAX_BYTES=512*1024*1024;
export const clone=v=>JSON.parse(JSON.stringify(v));
const need=(ok,message)=>{if(!ok)throw Error(message);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function canonical(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export function digest(value){return createSHA256().update(canonical(value)).hex();}
export function textPin(text){return{bytes:new TextEncoder().encode(text).length,sha256:createSHA256().update(text).hex()};}
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
export function validateProject(p){
 need(object(p)&&p.schema===SCHEMA&&validId(p.id)&&typeof p.title==='string'&&p.title.length>0&&p.title.length<=300,'Open one complete named provider migration project.');
 need(object(p.capture)&&object(p.mapping)&&Array.isArray(p.history)&&Array.isArray(p.operations),'Keep the complete capture, mapping, operations and history.');
 need(Number.isSafeInteger(p.revision)&&p.revision>=0&&p.history.length===p.revision&&p.operations.length===p.revision,'The original editable revision history is incomplete.');
 need(p.captureSha256===digest(p.capture),'The original provider capture differs from its retained identity.');
 need(typeof p.createdAt==='string'&&typeof p.updatedAt==='string','Retain the original created/updated values.');
 const seen=new Set();let previousMapping=p.initialMapping;
 need(object(previousMapping),'Retain the original full mapping.');
 for(let i=0;i<p.history.length;i++){
  const h=p.history[i],op=p.operations[i];
  need(object(h)&&h.revision===i+1&&validId(h.operationId)&&!seen.has(h.operationId)&&h.previousMappingSha256===digest(previousMapping),'The original mapping history chain differs.');
  seen.add(h.operationId);
  need(object(h.mapping)&&h.mappingSha256===digest(h.mapping)&&typeof h.actor==='string'&&h.actor.trim()&&typeof h.reason==='string'&&h.reason.trim(),'Retain each complete attributed mapping edition.');
  need(op.id===h.operationId&&op.request&&op.requestSha256===digest(op.request)&&op.resultRevision===h.revision,'The complete original review operation differs.');
  need(op.request.expectedRevision===i&&op.request.projectId===p.id&&op.request.captureSha256===p.captureSha256&&canonical(op.request.mapping)===canonical(h.mapping),'Original mapping request inputs differ from their recorded edition.');
  need(h.approval===null||object(h.approval)&&h.approval.mappingSha256===h.mappingSha256&&h.approval.captureSha256===p.captureSha256&&h.approval.actor===h.actor&&h.approval.reason===h.reason,'A review approval must bind this complete source and mapping.');
  previousMapping=h.mapping;
 }
 need(canonical(previousMapping)===canonical(p.mapping),'The current mapping differs from the complete retained history.');
 const expectedApproval=p.history.at(-1)?.approval??null;
 need(canonical(p.approval)===canonical(expectedApproval),'Current approval differs from its exact history.');
 need(textPin(JSON.stringify(p,null,2)+'\n').bytes<=MAX_BYTES,'The complete project exceeds the supported 512 MiB file capacity.');
 return p;
}
export function newProject({id,title,capture,mapping,at}){
 need(validId(id)&&typeof at==='string','Select a stable project identity and creation time.');
 const p={schema:SCHEMA,id,title,createdAt:at,updatedAt:at,revision:0,capture:clone(capture),captureSha256:digest(capture),
  initialMapping:clone(mapping),mapping:clone(mapping),approval:null,history:[],operations:[]};
 return validateProject(p);
}
export function applyMapping(project,request){
 validateProject(project);need(object(request)&&validId(request.operationId),'Use a stable original mapping operation ID.');
 const prior=project.operations.find(o=>o.id===request.operationId);
 if(prior){need(prior.requestSha256===digest(request)&&canonical(prior.request)===canonical(request),'The original operation ID belongs to different complete inputs.');return{project,changed:false,replayed:true,revision:prior.resultRevision};}
 need(request.projectId===project.id&&request.captureSha256===project.captureSha256,'Keep this exact project and original provider capture.');
 need(request.expectedRevision===project.revision,'Another edition is current. Reopen it and compare your complete draft.');
 need(object(request.mapping)&&typeof request.actor==='string'&&request.actor.trim()&&typeof request.reason==='string'&&request.reason.trim()&&typeof request.at==='string','Attribute the full mapping change or approval.');
 need(typeof request.approve==='boolean','Explicitly select whether this mapping is approved for native compilation.');
 const p=clone(project),mapping=clone(request.mapping),mappingSha256=digest(mapping),revision=p.revision+1;
 const approval=request.approve?{captureSha256:p.captureSha256,mappingSha256,actor:request.actor,reason:request.reason,at:request.at}:null;
 p.history.push({revision,operationId:request.operationId,previousMappingSha256:digest(p.mapping),mapping,mappingSha256,
  actor:request.actor,reason:request.reason,at:request.at,approval});
 p.operations.push({id:request.operationId,request:clone(request),requestSha256:digest(request),resultRevision:revision});
 p.mapping=mapping;p.approval=approval;p.revision=revision;p.updatedAt=request.at;
 return{project:validateProject(p),changed:true,replayed:false,revision};
}
export function requireApproval(project){
 validateProject(project);need(project.approval&&project.approval.captureSha256===project.captureSha256&&project.approval.mappingSha256===digest(project.mapping),
  'Record the named review of the exact complete capture and mapping before native execution.');
 return project.approval;
}
export function openProject(text){
 need(typeof text==='string'&&textPin(text).bytes<=MAX_BYTES,'Open a complete project within the 512 MiB capacity.');
 return validateProject(JSON.parse(text.replace(/^\uFEFF/,'')));
}
export function serializeProject(p){validateProject(p);return JSON.stringify(p,null,2)+'\n';}
