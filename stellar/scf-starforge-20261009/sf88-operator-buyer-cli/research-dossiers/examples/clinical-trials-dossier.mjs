#!/usr/bin/env node
// MIT. Complete retained-source Research workflow, using the original Store and receiving APIs.
// Configure this example with a previously exported original ClinicalTrials packet.
import {open,readFile,link,unlink,rename,mkdtemp,rm} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {openDossierStore} from '../dossier.mjs';
import {openClinicalTrialsWorkspace} from '../clinical-trials-workspace.mjs';
import {analyzeClinicalTrialsCohort,filterClinicalTrialsCohort,renderClinicalTrialsCohortCsv,renderClinicalTrialsCohortJson,renderClinicalTrialsCohortReport} from '../clinical-trials-analysis.mjs';
import {privateDirectory,readJson,writeJson,jsonBytes} from '../../node/store.mjs';
import {need,sha} from '../clinical-trials-model.mjs';
import {withPrivateLock} from '../../../sf30-seller-sdk/routescan/quota.mjs';

async function exists(path){try{const f=await open(path,'r');await f.close();return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function fileIdentity(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha(bytes)};}
async function syncParent(path){const handle=await open(resolve(path,'..'),'r');try{await handle.sync();}finally{await handle.close();}}
async function publish(path,body){
 if(await exists(path)){const old=await readFile(path);need(old.equals(Buffer.from(body)),'EXAMPLE_OUTPUT_CHANGED');return fileIdentity(path);}
 const dir=await mkdtemp(join(resolve(path,'..'),'.artifact-')),stage=join(dir,'body');let handle;
 try{handle=await open(stage,'wx',0o600);await handle.writeFile(body);await handle.sync();await handle.close();handle=null;await link(stage,path);await syncParent(path);}
 finally{await handle?.close();await rm(dir,{recursive:true,force:true});}
 return fileIdentity(path);
}
async function streamExport(store,id,path){
 if(!(await exists(path))){
  const dir=await mkdtemp(join(resolve(path,'..'),'.export-')),temp=join(dir,'portable.json.gz');
  try{const saved=await store.exportStream(id,{compression:'gzip'});
   await pipeline(saved.body,createWriteStream(temp,{flags:'wx',mode:0o600}));
   const handle=await open(temp,'r');try{await handle.sync();}finally{await handle.close();}
   await link(temp,path);await syncParent(path);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
 return fileIdentity(path);
}
export async function runClinicalTrialsDossierExample(options){
 need(typeof options?.outputDirectory==='string','EXAMPLE_CONFIGURATION_REQUIRED');
 const root=await privateDirectory(options.outputDirectory);
 return withPrivateLock(root,'example.lock',async()=>enrichHeld(options,await runHeld(options)));
}
async function runHeld(options){
 const required=['sourcePacket','packetSha256','captureId','question','title','workspaceDirectory','receivingDirectory','outputDirectory','requestId','selectNctId'];
 need(options&&required.every(key=>typeof options[key]==='string'&&options[key].length>0),'EXAMPLE_CONFIGURATION_REQUIRED');
 need(/^[a-f0-9]{64}$/.test(options.packetSha256)&&/^[A-Za-z0-9_-]{8,100}$/.test(options.requestId),'EXAMPLE_IDENTITY_INVALID');
 for(const key of ['sourcePacket','workspaceDirectory','receivingDirectory','outputDirectory'])need(options[key]===resolve(options[key]),'EXAMPLE_ABSOLUTE_PATH_REQUIRED');
 need(options.workspaceDirectory!==options.receivingDirectory,'EXAMPLE_SEPARATE_RECEIVER_REQUIRED');
 const output=await privateDirectory(options.outputDirectory),journalPath=join(output,'workflow.json'),inputSha256=sha(jsonBytes(options));
 let journal;try{journal=await readJson(journalPath);}catch(e){if(e.code!=='ENOENT')throw e;journal={schema:'sf88-clinicaltrials-example-v1',inputSha256,steps:[]};await writeJson(journalPath,journal,{exclusive:true});}
 need(journal.inputSha256===inputSha256,'EXAMPLE_INPUT_CHANGED');
 if(journal.result)return journal.result;
 const persist=async()=>writeJson(journalPath,journal);
 const step=async(name,value)=>{journal.steps=journal.steps.filter(row=>row.name!==name);journal.steps.push({name,at:new Date().toISOString(),value});await persist();process.stdout.write(JSON.stringify({step:name,...value})+'\n');};
 const store=await openDossierStore(options.workspaceDirectory);let workspace,receiver;
 try{
  workspace=await openClinicalTrialsWorkspace({directory:join(store.directory,'clinical-trials'),dossiers:store,python:options.python??'python3'});
  const description='Retained ClinicalTrials source workflow '+options.requestId+'. Original registry capture and source remain unchanged.';
  let dossier;
  if(journal.dossierId)dossier=await store.get(journal.dossierId);
  else{
   const matches=(await store.list()).filter(row=>row.title===options.title&&row.description===description);need(matches.length<=1,'EXAMPLE_DOSSIER_AMBIGUOUS');
   dossier=matches.length?await store.get(matches[0].id):await store.create({title:options.title,description});
   journal.dossierId=dossier.id;await persist();
  }
  let question=dossier.questions.find(row=>row.text===options.question);
  if(!question){dossier=await store.addQuestion(dossier.id,{text:options.question,expectedRevision:dossier.revision});question=dossier.questions.find(row=>row.text===options.question);}
  journal.questionId=question.id;await persist();
  const input=await workspace.importFile(options.sourcePacket,{expectedSha256:options.packetSha256});
  need(input.packetSha256===options.packetSha256,'EXAMPLE_ORIGINAL_PACKET_CHANGED');
  const capture=input.captures.find(row=>row.id===options.captureId);need(capture,'EXAMPLE_ORIGINAL_CAPTURE_MISSING');
  await step('original-input',{sourceId:input.sourceId,captureId:capture.id,rows:capture.rowCount,packetSha256:input.packetSha256});
  if(!journal.prepare){
   journal.prepare={requestId:options.requestId,questionId:question.id,expectedRevision:dossier.revision,sourceId:input.sourceId,captureId:options.captureId,label:options.label??'Original retained ClinicalTrials cohort',allowPartial:options.allowPartial??false};await persist();
  }
  const prepared=await workspace.prepare(dossier.id,journal.prepare);journal.operationId=prepared.plan.id;await persist();
  // Repeated original dispatches share the same operation, lease and cancellation handle.
  await Promise.all([workspace.start(prepared.plan.id,{expectedPlanSha256:prepared.plan.sha256}),workspace.start(prepared.plan.id,{expectedPlanSha256:prepared.plan.sha256})]);
  const reviewed=await workspace.wait(prepared.plan.id);need(reviewed.operation.phase==='READY'||reviewed.operation.phase==='IMPORTED','EXAMPLE_ORIGINAL_READ_NOT_READY');
  const selected=await workspace.edition(prepared.plan.id),index=selected.value.results.findIndex(row=>row.id===options.selectNctId);
  need(index>=0,'EXAMPLE_SELECTED_STUDY_MISSING');
  const original=await workspace.record(prepared.plan.id,index);
  need(sha(Buffer.from(original.record.content))===original.record.metadata.recordSha256,'EXAMPLE_ORIGINAL_STUDY_CHANGED');
  if(options.expectedRows!==undefined)need(selected.value.results.length===options.expectedRows,'EXAMPLE_CAPTURE_COUNT_CHANGED');
  if(options.expectedStudySha256!==undefined)need(original.record.metadata.recordSha256===options.expectedStudySha256,'EXAMPLE_SOURCE_STUDY_SHA_CHANGED');
  await step('whole-source-reviewed',{operationId:prepared.plan.id,editionSha256:selected.sha256,coverage:selected.value.usage.coverage,rows:selected.value.results.length,pages:selected.value.sourcePages.length,studyId:original.record.id,studySha256:original.record.metadata.recordSha256});
  if(!journal.receive){journal.receive={expectedPlanSha256:prepared.plan.sha256,expectedEditionSha256:selected.sha256,expectedRevision:(await store.getMetadata(dossier.id)).revision};await persist();}
  const received=await workspace.receive(prepared.plan.id,journal.receive);dossier=received.dossier;journal.editionId=received.receipt.editionId;await persist();
  const evidence=dossier.sources.find(row=>row.url===original.record.url);need(evidence,'EXAMPLE_RETAINED_EVIDENCE_MISSING');
  const note=options.evidenceNote??'Full original registry study retained with its page, capture, source edition and unchanged numeric tokens.';
  if(!journal.selection){
   if(!(evidence.selected&&evidence.note===note))dossier=await store.selectEvidence(dossier.id,{sourceId:evidence.id,selected:true,note,classification:'background',expectedRevision:dossier.revision});
   journal.selection={sourceId:evidence.id};await persist();
  }
  const findingTitle=options.findingTitle??'Source and cohort review';
  const findingText=options.findingText??('The selected retained cohort contains '+selected.value.usage.uniqueStudies+' distinct studies in '+selected.value.results.length+' source occurrences. '+original.record.id+' is available in full original source with its capture and page identities. This report describes the selected registry edition; it does not infer patient eligibility or treatment efficacy.');
  if(!dossier.findings.some(row=>row.questionId===question.id&&row.title===findingTitle&&row.text===findingText)){
   dossier=await store.addFinding(dossier.id,{questionId:question.id,title:findingTitle,text:findingText,sourceIds:[evidence.id],expectedRevision:dossier.revision});
  }
  if(dossier.questions.find(row=>row.id===question.id).status!=='answered')dossier=await store.updateQuestion(dossier.id,question.id,{status:'answered',expectedRevision:dossier.revision});
  const before=await workspace.compareRetained(dossier.id,journal.editionId,journal.editionId);
  need(before.beforeSha256===selected.sha256&&before.afterSha256===selected.sha256&&before.unchanged===selected.value.usage.uniqueStudies,'EXAMPLE_COMPARISON_SOURCE_CHANGED');
  const reports={};
  for(const format of ['md','html']){const report=await store.exportDossier(dossier.id,{format});reports[format]=await publish(join(output,'clinicaltrials-report.'+format),report.body);}
  reports.portable=await streamExport(store,dossier.id,join(output,'clinicaltrials-dossier.json.gz'));
  await step('findings-and-report',{dossierId:dossier.id,revision:dossier.revision,findings:dossier.findings.length,reports});
  await workspace.close();workspace=null;
  const receiving=await openDossierStore(options.receivingDirectory);
  const restored=await receiving.reopenStream(createReadStream(reports.portable.path));
  need(restored.id===dossier.id&&restored.revision===dossier.revision&&JSON.stringify(restored.revisions)===JSON.stringify(dossier.revisions),'EXAMPLE_RESTORED_HISTORY_CHANGED');
  receiver=await openClinicalTrialsWorkspace({directory:join(receiving.directory,'clinical-trials'),dossiers:receiving,python:options.python??'python3'});
  // The receiver has no imported provider input, console, provider workspace or credentials.
  need((await receiver.inputs()).items.length===0,'EXAMPLE_RECEIVER_INPUTS_NOT_EMPTY');
  const retained=await receiver.retainedEdition(restored.id,journal.editionId),record=await receiver.retainedRecord(restored.id,journal.editionId,index);
  need(retained.sha256===selected.sha256&&record.record.content===original.record.content,'EXAMPLE_RESTORED_STUDY_CHANGED');
  const packet=await receiver.retainedPacket(restored.id,journal.editionId);
  need(packet.sha256===options.packetSha256&&sha(packet.bytes)===options.packetSha256,'EXAMPLE_RESTORED_PACKET_CHANGED');
  reports.originalPacket=await publish(join(output,'clinicaltrials-workspace.zip'),packet.bytes);
  const comparison=await receiver.compareRetained(restored.id,journal.editionId,journal.editionId);
  need(comparison.beforeSha256===selected.sha256&&comparison.afterSha256===selected.sha256,'EXAMPLE_RESTORED_COMPARISON_CHANGED');
  for(const format of ['md','html']){const report=await receiving.exportDossier(restored.id,{format});need(sha(Buffer.from(report.body))===reports[format].sha256,'EXAMPLE_RESTORED_REPORT_CHANGED');}
  await step('portable-reopened',{dossierId:restored.id,revision:restored.revision,rows:retained.value.results.length,editionSha256:retained.sha256,originalPacket:reports.originalPacket});
  journal.result={status:'CLINICALTRIALS_DOSSIER_REOPENED',dossierId:dossier.id,questionId:question.id,operationId:prepared.plan.id,editionId:journal.editionId,revision:dossier.revision,captureId:options.captureId,rows:selected.value.results.length,pages:selected.value.sourcePages.length,editionSha256:selected.sha256,studyId:original.record.id,studySha256:original.record.metadata.recordSha256,packetSha256:options.packetSha256,reports,providerRequests:0,purchases:0};
  await persist();return journal.result;
 }finally{await workspace?.close();await receiver?.close();}
}
async function enrichHeld(options,completed){
 const store=await openDossierStore(options.receivingDirectory),workspace=await openClinicalTrialsWorkspace({
  directory:join(store.directory,'clinical-trials'),dossiers:store,python:options.python??'python3'});
 try{
  const selected=await workspace.retainedEdition(completed.dossierId,completed.editionId);
  need(selected.sha256===completed.editionSha256,'EXAMPLE_ANALYSIS_EDITION_CHANGED');
  const analysis=filterClinicalTrialsCohort(analyzeClinicalTrialsCohort(selected.value,{editionSha256:selected.sha256}),{});
  need(analysis.selectedOccurrences===completed.rows&&analysis.selectedStudies===selected.value.usage.uniqueStudies,
   'EXAMPLE_ANALYSIS_POPULATION_CHANGED');
  const reports={};
  for(const format of ['csv','json','html','md']){
   const content=format==='csv'?renderClinicalTrialsCohortCsv(analysis):format==='json'?renderClinicalTrialsCohortJson(analysis):
    renderClinicalTrialsCohortReport(analysis,{format});
   reports[format]=await publish(join(options.outputDirectory,'clinicaltrials-cohort.'+format),Buffer.from(content,'utf8'));
  }
  const groups=Object.fromEntries(Object.entries(analysis.groups).map(([name,items])=>[name,Array.isArray(items)?
   items.map(row=>({label:row.label,count:row.count,occurrences:row.occurrences,denominator:row.denominator,percent:row.percent})):items]));
  const result={...completed,cohortAnalysis:{source:analysis.source,selectedStudies:analysis.selectedStudies,
   selectedOccurrences:analysis.selectedOccurrences,repeatedStudies:analysis.repeatedStudies,groups,observations:analysis.observations,reports}};
  const journalPath=join(options.outputDirectory,'workflow.json'),journal=await readJson(journalPath);
  need(journal.inputSha256===sha(jsonBytes(options))&&journal.result?.editionSha256===selected.sha256,'EXAMPLE_ANALYSIS_IDENTITY_CHANGED');
  journal.result=result;await writeJson(journalPath,journal);
  process.stdout.write(JSON.stringify({step:'cohort-analysis',studies:analysis.selectedStudies,occurrences:analysis.selectedOccurrences,
   editionSha256:selected.sha256,reports})+'\n');
  return result;
 }finally{await workspace.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const config=JSON.parse(await readFile(process.argv[2],'utf8'));
 try{process.stdout.write(JSON.stringify(await runClinicalTrialsDossierExample(config))+'\n');}
 catch(error){process.stderr.write(JSON.stringify({error:error?.code??'CLINICALTRIALS_EXAMPLE_FAILED',message:error.message})+'\n');process.exitCode=1;}
}
