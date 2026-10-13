#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Operate the original full workspace and case receiving; no provider requests. */
import {readFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {operationLease,regular} from '../../../scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {writeImmutableBytes} from '../../../../products/gravitee-merchant/store.mjs';
import {receivePackage,inspectReceivingPackage} from '../../../../products/gravitee-merchant/delivery.mjs';
import {openGraviteeWorkspace} from '../../../../products/gravitee-merchant/workspace.mjs';
import {sha256,hashJSON} from '../../../../products/gravitee-merchant/contract.mjs';
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const parse=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const usage='gravitee-installation-receive --prepared /private/prepared --operations-cli /source/workspace/cli.py --workspace /private/original-operations --case CASE --installation ID --revision N --receiving-workspace /private/independent-operations --gravitee-destination /private/independent-gravitee --out /private/receiving --actor OPERATOR [--python python3]';
async function privateFolder(path){
 await mkdir(path,{recursive:true,mode:0o700});const stat=await lstat(path);
 need(stat.isDirectory()&&!stat.isSymbolicLink()&&!(stat.mode&0o077)&&await realpath(path)===path,'Use the original private 0700 receiving directory without symbolic-link ancestors.');return path;
}
export async function main(argv=process.argv.slice(2)){
 const options={},required=['prepared','operations-cli','workspace','case','installation','revision','receiving-workspace','gravitee-destination','out','actor'];
 for(let i=0;i<argv.length;i+=2){const key=argv[i]?.replace(/^--/,'');need([...required,'python'].includes(key)&&argv[i+1]&&!Object.hasOwn(options,key),usage);options[key]=argv[i+1];}
 need(required.every(key=>options[key]),usage);options.python??='python3';
 for(const key of ['prepared','operations-cli','workspace','receiving-workspace','gravitee-destination','out']){need(options[key].startsWith('/'),'Use an absolute '+key+' path.');options[key]=resolve(options[key]);}
 need(options.workspace!==options['receiving-workspace'],'Receive the complete case in an independent workspace.');
 need(/^[1-9][0-9]*$/.test(options.revision)&&Number.isSafeInteger(Number(options.revision)),'Select the original saved installation revision.');
 await privateFolder(options.out);
 const lease=await operationLease(join(options.out,'gravitee-installation-receiving.lock'));
 const read=async(path,max=512*1024*1024)=>regular(path,max);
 const retained=async(name,raw)=>{await writeImmutableBytes(join(options.out,name),raw);return{path:name,bytes:raw.length,sha256:sha256(raw)};};
 const phase=async(name,action)=>{const path=join(options.out,name+'.json');try{return parse(await read(path));}catch(error){if(error.code!=='ENOENT')throw error;}const value=await action();await retained(name+'.json',encoded(value));return value;};
 function native(arguments_,workspace=options.workspace){
  const result=spawnSync(options.python,[options['operations-cli'],'operations','--workspace',workspace,...arguments_],
   {cwd:dirname(options['operations-cli']),encoding:'utf8',maxBuffer:128*1024*1024,env:process.env});
  if(result.error)throw result.error;
  need(result.status===0,'Original Operations '+arguments_[0]+' failed: '+String(result.stdout||result.stderr).slice(0,16000));
  return JSON.parse(result.stdout);
 }
 try{
  await retained('Original_Receiving_Arguments.json',encoded(options));
  const prepReceiptRaw=await read(join(options.prepared,'Gravitee_Installation_Receiving.json'),8*1024*1024),prepReceipt=parse(prepReceiptRaw);
  need(prepReceipt.schema==='stellar-forge.gravitee-installation-local-receiving.v1'&&prepReceipt.command==='prepare','Select the full original prepared edition.');
  for(const file of prepReceipt.outputs){need(typeof file.path==='string'&&!file.path.includes('/')&&!file.path.includes('\\'),'Retain the original flat preparation outputs.');const raw=await read(join(options.prepared,file.path));need(raw.length===file.bytes&&sha256(raw)===file.sha256,'Prepared bytes changed: '+file.path);}
  await retained('Original_Preparation_Receiving.json',prepReceiptRaw);
  const packetRaw=await read(join(options.prepared,'Gravitee_Complete_Original_Handover.json')),packet=parse(packetRaw),inspection=inspectReceivingPackage(packet);
  const document=parse(await read(join(options.prepared,'installation-input.json'),128*1024));
  need(prepReceipt.caseId===options.case&&prepReceipt.workspaceId===inspection.workspaceId,'Keep the exact original case and API workspace.');
  const selectionRaw=await read(join(options.prepared,'Selected_Gravitee_Cohort.json'),8*1024*1024),selection=parse(selectionRaw);
  const cohortSnapshot=parse(await read(join(options.prepared,'Gravitee_Installation_Cohort.json')));
  need(cohortSnapshot.selectedCohortSource?.sha256===sha256(selectionRaw)&&cohortSnapshot.selectedCohortSource.bytes===selectionRaw.length,'Keep the complete selected cohort source binding.');
  const cohortSourceId=cohortSnapshot.selectedCohortSource.sourceId;
  need(document.source.sourceIds.includes(cohortSourceId)&&document.receiving.sourceIds.includes(cohortSourceId),'The saved preparation must include its exact cohort source.');
  const saved=await phase('Original_Saved_Installation',async()=>{
   const value=native(['installation-show','--case',options.case,'--installation',options.installation,'--revision',options.revision]);
   need(value.id===options.installation&&String(value.revision)===options.revision&&hashJSON(value.preview.document)===hashJSON(document),'Select the actual saved edition of this complete preparation.');
   return value;
  });
  const originalCase=await phase('Original_Operations_Case',async()=>{
   const value=native(['show','--case',options.case]);need(value.program?.id===options.case&&Array.isArray(value.sources),'Retain the complete original case.');
   need(value.sources.some(row=>row.id===selection.handover.sourceId&&row.sha256===sha256(packetRaw)),'The original case lacks the exact selected handover.');
   need(value.sources.some(row=>row.id===cohortSourceId&&row.sha256===sha256(selectionRaw)),'The original case lacks the exact selected cohort source.');
   return value;
  });
  await retained('Gravitee_Complete_Original_Handover.json',packetRaw);
  const received=await receivePackage(packet,options['gravitee-destination']);
  await retained('Gravitee_Original_Receiving.json',encoded(received));
  async function readActual(){
   const workspace=await openGraviteeWorkspace({directory:join(options['gravitee-destination'],'workspace')});
   try{
    const view=await workspace.action('view'),rows=[];
    need(view.workspaceId===inspection.workspaceId,'The received original workspace changed.');
    for(const selected of selection.cohort){
     const r=selected.reference,value=await workspace.action('get',{kind:r.kind,id:r.id,revision:r.revision});
     need(value.sha256===r.sha256,'Original native record changed after independent receiving.');
     rows.push({reference:r,included:selected.included,stage:selected.stage,purpose:selected.purpose});
    }
    return{workspaceId:view.workspaceId,selectedOriginalRecords:rows};
   }finally{await workspace.close();}
  }
  await phase('Gravitee_Independent_Operating_Read',readActual);
  await phase('Gravitee_Cold_Reopen',readActual);
  const archivePath=join(options.out,'Complete_Original_Installation.zip');
  const archive=await phase('Installation_Export',async()=>{
   let raw;try{raw=await read(archivePath,128*1024*1024);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(!raw){native(['installation-export','--case',options.case,'--installation',options.installation,'--revision',options.revision,'--output',archivePath]);raw=await read(archivePath,128*1024*1024);}
   return{path:'Complete_Original_Installation.zip',bytes:raw.length,sha256:sha256(raw)};
  });
  const archiveRaw=await read(archivePath,128*1024*1024);need(archiveRaw.length===archive.bytes&&sha256(archiveRaw)===archive.sha256,'Preserve the complete original Installation export.');
  const request='gravitee-installation-'+hashJSON({archive:archive.sha256,workspace:options['receiving-workspace'],actor:options.actor}).slice(0,32);
  const imported=await phase('Installation_Independent_Import',async()=>native(['import','--file',archivePath,'--name','Received Gravitee commissioning installation',
   '--actor',options.actor,'--request-id',request],options['receiving-workspace']));
  need(typeof imported.id==='string','Keep the original receiving case identity.');
  async function readInstallation(){
   const value=native(['installation-show','--case',imported.id,'--installation',options.installation,'--revision',options.revision],options['receiving-workspace']);
   const complete=native(['show','--case',imported.id],options['receiving-workspace']);
   need(value.sha256===saved.sha256&&hashJSON(value.preview.document)===hashJSON(saved.preview.document),'The independent saved Installation differs.');
   for(const sourceId of new Set([...document.source.sourceIds,...document.receiving.sourceIds])){
    const before=originalCase.sources.find(row=>row.id===sourceId),after=complete.sources.find(row=>row.id===sourceId);
    need(before&&after&&before.sha256===after.sha256,'A complete original Installation source differs: '+sourceId);
   }
   return{caseId:imported.id,installationId:value.id,revision:value.revision,sha256:value.sha256,workshare:value.preview.document.workshare};
  }
  await phase('Installation_Independent_Reopen',readInstallation);
  await phase('Installation_Cold_Reopen',readInstallation);
  const result={schema:'stellar-forge.gravitee-installation-complete-receiving.v1',state:'COMPLETE',workspaceId:inspection.workspaceId,
   original:{caseId:options.case,installationId:options.installation,revision:Number(options.revision),sha256:saved.sha256},
   receiving:{caseId:imported.id,workspace:options['receiving-workspace'],gravitee:options['gravitee-destination']},
   source:{bytes:packetRaw.length,sha256:sha256(packetRaw),packageSha256:inspection.sha256,selectedCohort:cohortSnapshot.selectedCohortSource},archive,
   rendering:'Use the exact outgoing installed applications for the separately retained desktop/narrow visual and important-control course in GRAVITEE_INSTALLATION.md.'};
  await retained('Gravitee_Installation_Complete_Receiving.json',encoded(result));console.log(JSON.stringify(result,null,2));return result;
 }finally{await lease.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{console.error(JSON.stringify({code:error.code??'GRAVITEE_INSTALLATION_RECEIVING',message:String(error.message)}));process.exitCode=1;});
