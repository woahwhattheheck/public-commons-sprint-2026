// SPDX-License-Identifier: MIT
/** Bind a complete original Gravitee edition to the existing Installation case. */
import {inspectReceivingPackage} from '../../../../products/gravitee-merchant/delivery.mjs';
import {hashJSON,sha256,SCHEMA} from '../../../../products/gravitee-merchant/contract.mjs';
import {bindingTemplate,prepareInstallation,renderWorkorder} from './prepare-core.mjs';
export const SELECTION_SCHEMA='stellar-forge.gravitee-installation-selection.v1';
const need=(value,message)=>{if(!value)throw new Error(message);};
const copy=value=>JSON.parse(JSON.stringify(value));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value,keys,label)=>need(object(value)&&Object.keys(value).every(key=>keys.includes(key))&&keys.every(key=>Object.hasOwn(value,key)), 'Use the complete '+label+' fields: '+keys.join(', '));
const decoder=new TextDecoder('utf-8',{fatal:true});
const json=raw=>JSON.parse(decoder.decode(raw));
const reference=r=>({kind:r.kind,id:r.id,revision:r.revision,sha256:r.sha256});
const same=(a,b)=>hashJSON(a)===hashJSON(b);
export function inspectGraviteeInstallation(raw){
  need(Buffer.isBuffer(raw)&&raw.length<=512*1024*1024,'Select the complete original Gravitee JSON handover, within its 512 MiB receiving limit.');
  const packet=json(raw),inspection=inspectReceivingPackage(packet);
  const members=new Map(packet.files.map(file=>[file.path,file]));
  const read=path=>{const f=members.get(path);need(f,'Retain the original package member '+path);return json(Buffer.from(f.base64,'base64'));};
  need(packet.includeSoftware===true,'Receive the complete original source-bearing Gravitee export with includeSoftware:true.');
  const software=read('source/products/gravitee-merchant/source-files.json');
  need(software.schema==='gravitee.source-files.v1'&&Array.isArray(software.files)&&software.files.length>0&&new Set(software.files).size===software.files.length,'Retain the complete original software source manifest.');
  for(const path of software.files)need(typeof path==='string'&&members.has('source/'+path),'The original declared software source is missing: '+path);
  for(const path of ['cli.mjs','workspace.mjs','store.mjs','delivery.mjs','source-files.json'])
    need(software.files.includes('products/gravitee-merchant/'+path),'The original software manifest lacks '+path);
  const heads=read('workspace/heads.json');
  need(heads.schema===SCHEMA&&Array.isArray(heads.heads),'Retain the original native head index.');
  const known=new Map();
  for(const head of heads.heads){
    need(object(head)&&typeof head.kind==='string'&&typeof head.id==='string'&&Number.isSafeInteger(head.revision)&&head.revision>0,'Retain complete native record heads.');
    const key=head.kind+'/'+head.id;need(!known.has(key),'Duplicate native head '+key);known.set(key,head);
  }
  function record(ref){
    need(object(ref)&&typeof ref.kind==='string'&&/^[a-z]+$/.test(ref.kind)&&typeof ref.id==='string'&&/^[a-f0-9]{24}$/.test(ref.id)&&Number.isSafeInteger(ref.revision)&&ref.revision>0&&/^[a-f0-9]{64}$/.test(ref.sha256),'Use an exact original native record reference.');
    const head=known.get(ref.kind+'/'+ref.id);need(head&&ref.revision<=head.revision,'The selected native record is absent from this full edition.');
    const path='workspace/records/'+ref.kind+'/'+ref.id+'/'+String(ref.revision).padStart(8,'0')+'.json',value=read(path),{sha256:saved,...unsigned}=value;
    need(value.schema===SCHEMA&&same(reference(value),ref)&&hashJSON(unsigned)===saved,'The selected native record identity changed: '+path);
    return value;
  }
  function objectValue(ref){
    need(object(ref)&&/^[a-f0-9]{64}$/.test(ref.sha256)&&Number.isSafeInteger(ref.bytes)&&ref.bytes>=0,'Use the original source-object identity.');
    const file=members.get('workspace/objects/'+ref.sha256);need(file&&file.bytes===ref.bytes&&file.sha256===ref.sha256,'The complete original object is absent from the handover.');
    return read(file.path);
  }
  const cohort=[];
  for(const head of heads.heads.filter(row=>row.kind==='draft').sort((a,b)=>a.id.localeCompare(b.id))){
    const draft=record(reference(head)),source=record(draft.value.source),sourceObject=objectValue(source.value.sourceRef),draftObject=objectValue(draft.value.draft);
    need(source.kind==='source'&&draftObject.sourceSha256===source.value.sourceSha256&&sourceObject.sourceSha256===source.value.sourceSha256,'The draft must bind its exact original source.');
    cohort.push({reference:reference(draft),label:draft.value.label,connection:null,target:null,draft:reference(draft),source:reference(source),
      sourceFiles:sourceObject.files?.map(file=>({path:file.path,bytes:file.bytes,sha256:file.sha256}))??[],
      state:draft.value.state,apiId:null,planIds:[],deploymentState:null,steps:[],observationReference:null,observation:null});
  }
  for(const head of heads.heads.filter(row=>row.kind==='commissioning').sort((a,b)=>a.id.localeCompare(b.id))){
    const value=record(reference(head)),v=value.value;
    need(object(v)&&typeof v.connectionId==='string'&&object(v.draft)&&Array.isArray(v.steps),'Retain the original whole commissioning sequence.');
    const connectionHead=known.get('connection/'+v.connectionId);need(connectionHead,'The commissioning connection is missing.');
    const connection=record(reference(connectionHead)),draft=record(v.draft),source=record(draft.value.source);
    need(connection.kind==='connection'&&draft.kind==='draft'&&source.kind==='source','Keep the original connection → draft → source relationship.');
    const sourceObject=objectValue(source.value.sourceRef),draftObject=objectValue(draft.value.draft);
    need(draftObject.sourceSha256===source.value.sourceSha256&&sourceObject.sourceSha256===source.value.sourceSha256,'The exact draft no longer binds its complete source.');
    const steps=v.steps.map(step=>{
      const original=record(step.operation);
      need(original.kind==='operation'&&original.value.connectionId===v.connectionId,'A commissioning step targets another native connection.');
      return {name:step.name,reference:reference(original),state:original.value.state,operationId:original.value.operationId,
        response:original.value.response??null,originalOutcome:original.value.originalOutcome??null};
    });
    const observation=v.observation?objectValue(v.observation):null;
    if(observation)need(observation.apiId===v.apiId,'The original observation targets a different native API.');
    cohort.push({reference:reference(value),label:v.label,connection:reference(connection),
      target:copy(connection.value.connection),draft:reference(draft),source:reference(source),
      sourceFiles:sourceObject.files?.map(file=>({path:file.path,bytes:file.bytes,sha256:file.sha256}))??[],
      state:v.state,apiId:v.apiId,planIds:copy(v.planIds??[]),deploymentState:v.deploymentState??null,
      steps,observationReference:v.observation??null,observation:copy(observation)});
  }
  return {schema:'stellar-forge.gravitee-installation-source.v1',
    file:{bytes:raw.length,sha256:sha256(raw)},package:inspection,softwareSource:{files:software.files.length,manifest:members.get('source/products/gravitee-merchant/source-files.json').sha256},
    recordCounts:Object.fromEntries([...new Set(heads.heads.map(x=>x.kind))].sort().map(kind=>[kind,heads.heads.filter(x=>x.kind===kind).length])),
    cohort};
}
function originalCase(seed,caseValue){
  need(object(caseValue)&&object(caseValue.program)&&Array.isArray(caseValue.sources),'Read the complete original Operations show result.');
  need(caseValue.program.id===seed.source.caseId&&caseValue.program.version===seed.source.version&&caseValue.program.planId===seed.source.planId,
    'Receive a fresh seed and complete case from the same original case version and pinned plan.');
}
export function graviteeInstallationTemplate({raw,seed,caseValue,profile}){
  const source=inspectGraviteeInstallation(raw);originalCase(seed,caseValue);
  const matches=caseValue.sources.filter(row=>row.sha256===source.file.sha256);
  return {selection:{schema:SELECTION_SCHEMA,workspaceId:source.package.workspaceId,
    handover:{sourceId:matches.length===1?matches[0].id:null,...source.file},
    cohort:source.cohort.map(row=>({reference:row.reference,included:true,stage:'unassigned',purpose:''}))},
    bindings:bindingTemplate(seed,profile),source};
}
export function prepareGraviteeInstallation({raw,seed,caseValue,profile,bindings,selectionRaw,cohortSourceId}){
  const source=inspectGraviteeInstallation(raw);originalCase(seed,caseValue);
  need(Buffer.isBuffer(selectionRaw)&&selectionRaw.length<=8*1024*1024,'Select the complete original cohort JSON within the source limit.');
  const selection=json(selectionRaw),cohortFile={sourceId:cohortSourceId,bytes:selectionRaw.length,sha256:sha256(selectionRaw)};
  const cohortAttachment=caseValue.sources.find(row=>row.id===cohortSourceId);
  need(cohortAttachment&&cohortAttachment.sha256===cohortFile.sha256,'Attach the exact complete selected cohort JSON to the same original case before preparation.');
  exactKeys(selection,['schema','workspaceId','handover','cohort'],'Gravitee selection');
  need(selection.schema===SELECTION_SCHEMA&&selection.workspaceId===source.package.workspaceId,'Select the original Gravitee workspace.');
  exactKeys(selection.handover,['sourceId','bytes','sha256'],'original attached handover');
  need(selection.handover.bytes===source.file.bytes&&selection.handover.sha256===source.file.sha256,'The selected complete handover bytes changed.');
  const attached=caseValue.sources.find(row=>row.id===selection.handover.sourceId);
  need(attached&&attached.sha256===source.file.sha256,'Attach this exact full handover to the original Operations case before preparation.');
  need(Array.isArray(selection.cohort)&&selection.cohort.length===source.cohort.length&&source.cohort.length>0,
    'Explicitly retain every draft and commissioning head in this complete edition, including excluded records.');
  const selected=new Map();
  for(const row of selection.cohort){
    exactKeys(row,['reference','included','stage','purpose'],'cohort selection');
    need(typeof row.included==='boolean'&&['staging','production','other','unassigned'].includes(row.stage)&&typeof row.purpose==='string'&&row.purpose.trim()&&row.purpose.length<=4000,
      'Give every included or excluded original cohort record its full purpose or exclusion reason.');
    need(!row.included||row.stage!=='unassigned','Name the actual staging/production/other role of every included original record.');
    const original=source.cohort.find(item=>same(item.reference,row.reference));
    need(original&&!selected.has(original.reference.kind+'/'+original.reference.id),'Select each original draft/commissioning head once by its complete reference.');
    selected.set(original.reference.kind+'/'+original.reference.id,{...copy(row),source:original});
  }
  need([...selected.values()].some(x=>x.included),'Select a complete useful API cohort.');
  const next=copy(bindings);
  need(object(next.source)&&object(next.receiving),'Use the original complete bindings template.');
  next.source.sourceIds=[...new Set([...(next.source.sourceIds??[]),attached.id,cohortSourceId])];
  next.receiving.sourceIds=[...new Set([...(next.receiving.sourceIds??[]),attached.id,cohortSourceId])];
  const prepared=prepareInstallation(seed,profile,next);
  need(prepared.document.workshare,'Use the original complete commercial Workshare seed.');
  const snapshot={schema:'stellar-forge.gravitee-installation-cohort.v1',workspaceId:source.package.workspaceId,
    originalCase:copy(seed.source),handover:copy(selection.handover),selectedCohortSource:cohortFile,packageSha256:source.package.sha256,
    entireEdition:{records:source.recordCounts,files:source.package.totalFiles,bytes:source.package.totalBytes},
    cohort:[...selected.values()],acceptance:'Native observations retain their original states. Installation acceptance remains an attributed decision against the selected source and original commercial checks.'};
  return {schema:'stellar-forge.gravitee-installation-preparation.v1',prepared,source,snapshot,bindings:next,
    workorder:renderWorkorder(prepared)};
}
