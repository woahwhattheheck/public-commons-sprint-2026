#!/usr/bin/env node
/**
 * Apply a prepared source review through the original opportunity-store API.
 * The original revision-133 portable is received separately by its current owner.
 */
import {readFile, mkdir, open, rename, unlink, link} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {openOpportunityStore} from '../../model.mjs';
import {opportunityExport} from '../../server.mjs';

const MAX_PACKET = 256 * 1024 * 1024;
const SCHEMA = 'tjlabs.opportunity-issued-review.v1';
const JOURNAL_SCHEMA = 'tjlabs.opportunity-issued-review-journal.v1';
const json = value => JSON.stringify(value,null,2)+'\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code,message=code) => {const e=new Error(message);e.code=code;throw e;};
const ensure = (condition,code,message) => {if(!condition) fail(code,message);};
const copy = value => structuredClone(value);

async function readBytes(path) {
  const h=await open(resolve(path),'r');
  try {ensure((await h.stat()).size<=MAX_PACKET,'INPUT_TOO_LARGE');return await h.readFile();}
  finally {await h.close();}
}
async function syncDir(path) {
  const h=await open(path,'r');
  try {await h.sync();} finally {await h.close();}
}
async function writeAtomic(path,bytes,{exclusive=false}={}) {
  const target=resolve(path),parent=dirname(target),temp=target+'.tmp-'+randomUUID();
  await mkdir(parent,{recursive:true,mode:0o700});
  let h;
  try {
    h=await open(temp,'wx',0o600);await h.writeFile(bytes);await h.sync();await h.close();h=null;
    if(exclusive){await link(temp,target);await unlink(temp);}else await rename(temp,target);
    await syncDir(parent);
  } catch(e) {if(h)await h.close().catch(()=>{});await unlink(temp).catch(()=>{});throw e;}
}
async function writeRetained(path,bytes) {
  try {
    const old=await readFile(path);
    ensure(old.equals(Buffer.from(bytes)),'OUTPUT_IDENTITY_CHANGED','Retained output has different bytes: '+path);
  } catch(e) {if(e.code!=='ENOENT')throw e;await writeAtomic(path,bytes,{exclusive:true});}
  return {filename:resolve(path).split('/').at(-1),bytes:Buffer.byteLength(bytes),sha256:hash(bytes)};
}
function semantic(value) {
  if(Array.isArray(value))return value.map(semantic);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value)
    .filter(([key])=>!['reviewRequired','reviewReasons','blocked','overdue','supersededBy'].includes(key))
    .map(([key,item])=>[key,semantic(item)]));
  return value;
}
function stable(value) {
  if(Array.isArray(value))return value.map(stable);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
function same(left,right){return JSON.stringify(stable(semantic(left)))===JSON.stringify(stable(semantic(right)));}
function pick(value,keys){return Object.fromEntries(keys.map(key=>[key,value[key]]));}
function byId(rows){return [...rows].sort((a,b)=>String(a.id||a.requirementId).localeCompare(String(b.id||b.requirementId)));}
function preserve(view,packet) {
  const original=packet.businessPreservation;
  for(const name of ['company','opportunity','capabilities','teaming'])
    ensure(same(view[name],original[name]),'BUSINESS_FIELD_CHANGED','Preserved business field changed: '+name);
  const currentDecisions=view.coverage.map(row=>pick(row,['requirementId','decision','capabilityIds','teamIds']));
  ensure(same(byId(currentDecisions),byId(original.coverageDecisions)),'COVERAGE_DECISION_CHANGED');
  const dispositions=view.requirements.map(row=>pick(row,['id','responseDisposition','evidenceRule','status']));
  ensure(same(byId(dispositions),byId(original.requirementDispositions)),'REQUIREMENT_DISPOSITION_CHANGED');
  if(original.requirementCore) {
    const keys=Object.keys(original.requirementCore[0]||{});
    ensure(same(byId(view.requirements.map(row=>pick(row,keys))),byId(original.requirementCore)),'REQUIREMENT_TEXT_CHANGED');
  }
  for(const id of original.existingPackages)
    ensure(view.packages.some(p=>p.id===id),'ORIGINAL_PACKAGE_MISSING');
}
function contentBytes(payload) {
  if(typeof payload.contentText==='string') {
    ensure(payload.contentBase64===undefined,'SOURCE_BODY_AMBIGUOUS');
    return Buffer.from(payload.contentText);
  }
  ensure(typeof payload.contentBase64==='string','SOURCE_BODY_MISSING');
  const bytes=Buffer.from(payload.contentBase64,'base64');
  ensure(bytes.toString('base64')===payload.contentBase64,'SOURCE_BASE64_INVALID');
  return bytes;
}
function checkPacket(packet) {
  ensure(packet.schema===SCHEMA,'REVIEW_SCHEMA');
  ensure(typeof packet.operation==='string' && typeof packet.projectId==='string','REVIEW_IDENTITY');
  ensure(Number.isSafeInteger(packet.baselineRevision),'REVIEW_REVISION');
  ensure(Array.isArray(packet.sources)&&Array.isArray(packet.actions)&&Array.isArray(packet.sourceReviews),'REVIEW_SEQUENCE');
  ensure(packet.businessPreservation && packet.package,'REVIEW_PRESERVATION');
  const keys=new Set();
  for(const source of packet.sources) {
    ensure(typeof source.key==='string' && !keys.has('source-'+source.key),'REVIEW_DUPLICATE_KEY');
    keys.add('source-'+source.key);contentBytes(source.payload);
  }
  const allowed=new Set(['save_requirement','save_coverage','update','save_question','save_milestone']);
  for(const action of packet.actions) {
    ensure(typeof action.key==='string' && !keys.has(action.key),'REVIEW_DUPLICATE_KEY');
    ensure(allowed.has(action.action),'REVIEW_ACTION');keys.add(action.key);
    ensure(action.payload && !['id','requestId','expectedRevision'].some(k=>Object.hasOwn(action.payload,k)),'REVIEW_PAYLOAD_IDENTITY');
  }
  for(const item of packet.sourceReviews){
    ensure(keys.has('source-'+item.key) && !keys.has('review-'+item.key),'REVIEW_SOURCE');
    keys.add('review-'+item.key);
  }
}
function bindings(value,sourceMap) {
  if(Array.isArray(value))return value.map(item=>bindings(item,sourceMap));
  if(value && typeof value==='object'){
    if(Object.hasOwn(value,'sourceKey')){
      const sourceId=sourceMap[value.sourceKey];ensure(sourceId,'UNRESOLVED_SOURCE',value.sourceKey);
      const {sourceKey,...rest}=value;return {...rest,sourceId};
    }
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,bindings(item,sourceMap)]));
  }
  return value;
}

/** The caller must retain sole ownership of this receiving project during review. */
export async function applyIssuedReview({store,directory,packetText,operator='MCC issued-source receiver',onProgress}={}) {
  ensure(store && directory && typeof packetText==='string','REVIEW_ARGUMENTS');
  const packet=JSON.parse(packetText);checkPacket(packet);
  const packetSha256=hash(packetText);
  const journalPath=join(resolve(directory),'intake','issued-source-'+packetSha256+'.json');
  let journal;
  try{journal=JSON.parse(await readFile(journalPath,'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(journal){
    ensure(journal.schema===JOURNAL_SCHEMA && journal.packetSha256===packetSha256 &&
      journal.projectId===packet.projectId && journal.operator===operator,'REVIEW_JOURNAL_IDENTITY');
  }else{
    const view=await store.get(packet.projectId);
    ensure(view.revision===packet.baselineRevision,'BASELINE_REVISION_CHANGED');
    preserve(view,packet);
    for(const step of packet.actions)if(step.baseline){
      const base=step.baseline,row=view[base.collection]?.find(r=>r.id===base.id);
      ensure(row?.version===base.version,'BASELINE_RECORD_CHANGED',step.key);
    }
    journal={schema:JOURNAL_SCHEMA,operation:packet.operation,projectId:packet.projectId,
      packetSha256,operator,createdAt:new Date().toISOString(),baselineRevision:view.revision,
      lastRevision:view.revision,sourceMap:{},steps:{},pending:null,status:'running'};
    await writeAtomic(journalPath,json(journal),{exclusive:true});
  }
  if(journal.status==='complete' && journal.result){
    const selected=await store.get(packet.projectId,{revision:journal.result.revision});
    ensure(selected.packages.some(p=>p.id===journal.result.packageId),'CREATED_PACKAGE_MISSING');
    return {...copy(journal.result),journalPath};
  }
  const persist=async()=>{journal.updatedAt=new Date().toISOString();await writeAtomic(journalPath,json(journal));};
  const execute=async(key,action,makePayload)=>{
    if(journal.steps[key])return journal.steps[key];
    ensure(!journal.pending || journal.pending.key===key,'REVIEW_PENDING_ORDER');
    if(!journal.pending){
      const view=await store.get(packet.projectId);
      ensure(view.revision===journal.lastRevision,'INTERVENING_PROJECT_REVISION',
        'Another project revision was committed; reconcile it before resuming this original review.');
      const payload=await makePayload(view);
      payload.id=packet.projectId;payload.expectedRevision=view.revision;
      payload.requestId='issued-'+packetSha256.slice(0,32)+'-'+key;
      journal.pending={key,action,payload,preparedAt:new Date().toISOString()};
      await persist();
    }
    const pending=journal.pending;
    const returned=await store.dispatch(pending.action,pending.payload);
    const view=returned?.id===packet.projectId?returned:await store.get(packet.projectId);
    const committed=view.history.find(row=>row.requestId===pending.payload.requestId);
    ensure(committed && committed.action===pending.action &&
      committed.revision===pending.payload.expectedRevision+1,'REVIEW_COMMIT_IDENTITY');
    const completed={key,action,revision:committed.revision,requestId:pending.payload.requestId,
      completedAt:new Date().toISOString()};
    if(action==='retain_source'){
      const selected=packet.sources.find(row=>'source-'+row.key===key),sha256=hash(contentBytes(selected.payload));
      const row=view.sources.find(s=>s.sha256===sha256 && s.filename===selected.payload.filename &&
        s.role===selected.payload.role && s.url===selected.payload.url);
      ensure(row,'RETAINED_SOURCE_MISSING',selected.key);
      completed.sourceId=row.id;completed.sha256=sha256;
      journal.sourceMap[selected.key]=row.id;
    }
    if(action==='create_package'){
      const newPackage=view.packages.find(p=>p.revision===committed.revision &&
        p.title===packet.package.title && !packet.businessPreservation.existingPackages.includes(p.id));
      ensure(newPackage,'CREATED_PACKAGE_MISSING');completed.packageId=newPackage.id;journal.packageId=newPackage.id;
    }
    journal.steps[key]=completed;journal.lastRevision=committed.revision;journal.pending=null;await persist();
    if(onProgress)await onProgress(completed);
    return completed;
  };
  for(const source of packet.sources)
    await execute('source-'+source.key,'retain_source',async()=>copy(source.payload));
  for(const step of packet.actions){
    await execute(step.key,step.action,async view=>{
      if(step.baseline){
        const old=view[step.baseline.collection]?.find(row=>row.id===step.baseline.id);
        ensure(old?.version===step.baseline.version,'REVIEW_RECORD_CHANGED',step.key);
      }
      return bindings(copy(step.payload),journal.sourceMap);
    });
  }
  for(const review of packet.sourceReviews){
    await execute('review-'+review.key,'review_change',async view=>{
      const afterSourceId=journal.sourceMap[review.key];
      const matching=view.changes.filter(c=>c.beforeSourceId===review.beforeSourceId && c.afterSourceId===afterSourceId);
      ensure(matching.length===1,'REVIEW_CHANGE_IDENTITY',review.key);
      return {changeId:matching[0].id,status:'reviewed',decision:review.decision,note:review.note};
    });
  }
  const reviewed=await store.get(packet.projectId);
  preserve(reviewed,packet);
  ensure(reviewed.requirements.length===34 && reviewed.coverage.length===34,'REVIEW_RECORD_COUNT');
  for(const step of packet.actions.filter(row=>row.action==='save_coverage')){
    const coverage=reviewed.coverage.find(row=>row.requirementId===step.payload.requirementId);
    ensure(coverage && !coverage.reviewRequired,'REVIEW_COVERAGE_STALE',step.key);
  }
  await execute('package','create_package',async()=>copy(packet.package));
  const final=await store.get(packet.projectId);preserve(final,packet);
  ensure(final.revision===journal.lastRevision,'INTERVENING_PROJECT_REVISION');
  journal.status='complete';journal.completedAt ||= new Date().toISOString();
  const result={schema:'tjlabs.mcc-issued-review-result.v1',operation:packet.operation,complete:true,
    projectId:final.id,baselineRevision:packet.baselineRevision,revision:final.revision,
    packageId:journal.packageId,originalPackageIds:packet.businessPreservation.existingPackages,
    packetSha256,applicationSourceRef:packet.applicationSourceRef,completedAt:journal.completedAt,
    completedSteps:Object.keys(journal.steps).length,sources:final.sources.length,
    requirements:final.requirements.length,coverage:final.coverage.length,
    milestones:final.milestones.length,questions:final.questions.length,packages:final.packages.length,
    sourceMap:journal.sourceMap};
  journal.result=result;await persist();
  return {...result,journalPath};
}
export async function exportIssuedReview({store,result,output}={}) {
  const outputs=[];
  for(const format of ['portable','html','markdown','requirements','capabilities','teaming','milestones','questions']){
    const exported=await opportunityExport(store,result.projectId,{format,packageId:result.packageId});
    const bytes=Buffer.isBuffer(exported.bytes)?exported.bytes:Buffer.from(exported.bytes);
    const receipt=await writeRetained(join(resolve(output),exported.filename),bytes);
    outputs.push({format,...receipt,mediaType:exported.mediaType});
  }
  const {journalPath,...customerResult}=result;
  const report={...customerResult,outputs};
  await writeRetained(join(resolve(output),'issued-review-result.json'),json(report));
  return report;
}
function flags(argv){
  const out={};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--help'){out.help=true;continue;}
    ensure(['--workspace','--input','--output','--operator'].includes(arg),'UNKNOWN_OPTION',arg);
    const key=arg.slice(2),value=argv[++i];
    ensure(value && !value.startsWith('--') && !Object.hasOwn(out,key),'OPTION_VALUE',arg);out[key]=value;
  }
  return out;
}
export async function main(argv=process.argv.slice(2)){
  const args=flags(argv);
  if(args.help){
    process.stdout.write('node apply_issued_review.mjs --workspace RECEIVED_DIR --input project-update.json --output HANDOFF_DIR [--operator NAME]\n');
    return;
  }
  ensure(args.workspace && args.input && args.output,'REQUIRED_OPTIONS');
  const operator=args.operator||'MCC issued-source receiver',directory=resolve(args.workspace);
  const packetText=(await readBytes(args.input)).toString('utf8');
  const store=await openOpportunityStore({directory,operator});
  try{
    const result=await applyIssuedReview({store,directory,packetText,operator,
      onProgress:row=>process.stdout.write(json({step:row.key,revision:row.revision}))});
    const report=await exportIssuedReview({store,result,output:args.output});
    process.stdout.write(json(report));return report;
  }finally{await store.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(json({code:error.code||'REVIEW_FAILED',message:error.message}));process.exitCode=1;});
