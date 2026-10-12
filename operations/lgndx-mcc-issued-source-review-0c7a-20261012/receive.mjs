#!/usr/bin/env node
import {readFile,writeFile,rename,mkdir,open} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [sourceRoot,operationRoot,updatePath,portablePath,phase]=process.argv.slice(2);
const OP='LGNDX-MCC-ISSUED-SOURCE-REVIEW-0C7A-20261012';
const PROJECT='opp_c414e4b0-302f-0005-bda6-cb8906d7a644';
const REF='2e666ad2e63db286c97d7f1a33e16249c043dfa0';
const UPDATE='f2156f48c784568a56b1eef853e6a717a3f90d09c65f9695fbaceb44e6034d61';
const BASELINE='9512b0bf69c34748df36bdc08f8b2aa0b06117eaacbafb6d38e035f5dd797140';
const digest=x=>createHash('sha256').update(x).digest('hex');
const ensure=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
ensure(['restore','apply','receive'].includes(phase),'RECEIVING_PHASE');
const root=resolve(operationRoot),journalPath=join(root,'operation.json');
await mkdir(root,{recursive:true,mode:0o700});
const body=await readFile(updatePath);
ensure(body.length===896542&&digest(body)===UPDATE,'PREPARED_UPDATE_CHANGED');
const packet=JSON.parse(body);
ensure(packet.operation===OP&&packet.projectId===PROJECT&&packet.baselineRevision===133,'PREPARED_PROJECT_CHANGED');
const component=join(sourceRoot,'stellar/scf-starforge-20261009/partners/lgndx-opportunity-operations');
const {openOpportunityStore}=await import(pathToFileURL(join(component,'model.mjs')));
const {applyIssuedReview,exportIssuedReview}=await import(pathToFileURL(join(component,'references/issued-source-review/apply_issued_review.mjs')));
async function save(value){
 const temporary=journalPath+'.pending';
 const h=await open(temporary,'w',0o600);
 try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}
 await rename(temporary,journalPath);
 const d=await open(root,'r');try{await d.sync();}finally{await d.close();}
}
let journal;
try{journal=JSON.parse(await readFile(journalPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(!journal)journal={schema:'stellar-forge.mcc-issued-source-receiving.v1',operation:OP,projectId:PROJECT,
 sourceRef:REF,updateSha256:UPDATE,baselinePortableSha256:BASELINE,startedAt:new Date().toISOString(),steps:{}};
ensure(journal.operation===OP&&journal.sourceRef===REF&&journal.updateSha256===UPDATE,'ORIGINAL_OPERATION_CHANGED');
if(journal.steps[phase]?.complete){console.log(JSON.stringify({stage:phase,reopened:true,result:journal.steps[phase]}));process.exit(0);}
journal.activePhase=phase;journal.status='running';delete journal.error;await save(journal);
let store;
try{
 if(phase==='restore'){
  const raw=await readFile(portablePath);
  ensure(raw.length===14822528&&digest(raw)===BASELINE,'BASELINE_PORTABLE_CHANGED');
  const original=JSON.parse(raw);
  store=await openOpportunityStore({directory:join(root,'workspace'),operator:'MCC issued-source receiver'});
  const view=await store.importPackage(original);
  ensure(view.id===PROJECT&&view.revision===133&&view.requirements.length===34&&view.coverage.length===34,'BASELINE_RECEIVING_CHANGED');
  ensure(view.packages.length===2&&packet.businessPreservation.existingPackages.every(id=>view.packages.some(p=>p.id===id)),'ORIGINAL_PACKAGES_CHANGED');
  journal.steps.restore={complete:true,projectId:view.id,revision:view.revision,
   requirements:view.requirements.length,coverage:view.coverage.length,originalPackageIds:view.packages.map(x=>x.id),
   completedAt:new Date().toISOString()};
 }else if(phase==='apply'){
  ensure(journal.steps.restore?.complete,'BASELINE_RECEIVING_REQUIRED');
  store=await openOpportunityStore({directory:join(root,'workspace'),operator:'MCC issued-source receiver'});
  const result=await applyIssuedReview({store,directory:join(root,'workspace'),packetText:body.toString('utf8'),
   operator:'MCC issued-source receiver',onProgress:row=>console.log(JSON.stringify({stage:'apply',step:row.key,revision:row.revision}))});
  const report=await exportIssuedReview({store,result,output:join(root,'handoff')});
  ensure(report.complete&&report.completedSteps===88&&report.revision===221,'ISSUED_REVIEW_SEQUENCE_CHANGED');
  ensure(report.outputs.length===8&&new Set(report.outputs.map(x=>x.filename)).size===8,'NAMED_HANDOFF_CHANGED');
  journal.steps.apply={complete:true,result:report,completedAt:new Date().toISOString()};
 }else{
  ensure(journal.steps.apply?.complete,'ISSUED_REVIEW_REQUIRED');
  const report=journal.steps.apply.result;
  const selected=report.outputs.find(x=>x.format==='portable');
  ensure(selected&&basename(selected.filename)===selected.filename,'NAMED_PORTABLE_REQUIRED');
  const raw=await readFile(join(root,'handoff',selected.filename));
  ensure(raw.length===selected.bytes&&digest(raw)===selected.sha256,'NAMED_PORTABLE_CHANGED');
  const named=JSON.parse(raw);
  store=await openOpportunityStore({directory:join(root,'buyer-receiving'),operator:'MCC handoff receiver'});
  const view=await store.importPackage(named);
  ensure(view.id===PROJECT&&view.revision===221&&view.requirements.length===34&&view.coverage.length===34,'CUSTOMER_RECEIVING_CHANGED');
  ensure(view.packages.length===3&&packet.businessPreservation.existingPackages.every(id=>view.packages.some(p=>p.id===id)),'CUSTOMER_PACKAGES_CHANGED');
  const sources=[];
  for(const expected of view.sources){
   const selectedSource=await store.dispatch('read_source',{id:PROJECT,sourceId:expected.id});
   const bytes=Buffer.from(selectedSource.contentBase64,'base64');
   ensure(bytes.length===expected.bytes&&digest(bytes)===expected.sha256,'CUSTOMER_SOURCE_CHANGED');
   sources.push({id:expected.id,filename:expected.filename,bytes:bytes.length,sha256:digest(bytes)});
  }
  const exported=await store.exportPackage(PROJECT,{packageId:report.packageId});
  ensure(JSON.stringify(exported)===JSON.stringify(named),'CUSTOMER_NAMED_PACKET_CHANGED');
  journal.steps.receive={complete:true,projectId:view.id,revision:view.revision,packageId:report.packageId,
   packages:view.packages.map(x=>x.id),sources,portable:{filename:selected.filename,bytes:raw.length,sha256:digest(raw)},
   completeNamedPacketUnchanged:true,completedAt:new Date().toISOString()};
  const customer={schema:'stellar-forge.mcc-issued-source-delivery.v1',operation:OP,complete:true,projectId:PROJECT,
   sourceRef:REF,dossierGitBlob:'8458167af2e1fb03420042b095d03f10c326185f',
   baselineRevision:133,revision:221,preparedUpdateSha256:UPDATE,baselinePortableSha256:BASELINE,
   originalApiCalls:report.completedSteps,requirements:34,coverage:34,responseUpdates:7,
   originalPackageIds:report.originalPackageIds,packageId:report.packageId,
   sources:journal.steps.receive.sources,outputs:report.outputs,receiving:journal.steps.receive,
   completedAt:journal.steps.receive.completedAt};
  await writeFile(join(root,'handoff','receiving-result.json'),JSON.stringify(customer,null,2)+'\n',{mode:0o600});
 }
 await store.close();store=null;
 journal.activePhase=null;
 if(['restore','apply','receive'].every(key=>journal.steps[key]?.complete)){journal.status='complete';journal.completedAt=new Date().toISOString();}
 await save(journal);
 console.log(JSON.stringify({stage:phase,complete:true,status:journal.status,result:journal.steps[phase]}));
}catch(error){
 if(store)await store.close().catch(()=>{});
 journal.status='failed';journal.error={code:String(error.code||error.name||'RECEIVING_FAILED').slice(0,160),
  message:String(error.message||'').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/https?:\/\/[^\s"']+/g,'[source URL]').slice(0,500)};
 journal.failedAt=new Date().toISOString();await save(journal);
 console.error(JSON.stringify({stage:phase,error:journal.error}));process.exitCode=1;
}
