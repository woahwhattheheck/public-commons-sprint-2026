#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Receive both original municipal and Installation workspaces without a new writer. */
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {same,sha,MAX_SOURCE} from './municipal-installation-core.mjs';
import {need,encoded,parse,identity,privateDirectory,retain,nativeMunicipal,nativeOperations,regular,operationLease,originalInput,originalUnchanged,inspectInstallationArchive} from './municipal-installation-io.mjs';
const usage='municipal-installation-receive --prepared /private/prepared --operations-cli /source/workspace/cli.py --workspace /private/original-operations --case CASE --installation ID --revision N --receiving-workspace /private/independent-operations --municipal-destination /private/independent-municipal --out /private/receiving --actor OPERATOR [--python /actual/python]';
export async function main(argv=process.argv.slice(2)){
 const required=['prepared','operations-cli','workspace','case','installation','revision','receiving-workspace','municipal-destination','out','actor'],options={};
 for(let i=0;i<argv.length;i+=2){const key=argv[i]?.replace(/^--/,'');need([...required,'python'].includes(key)&&argv[i+1]&&!Object.hasOwn(options,key),usage);options[key]=argv[i+1];}
 need(required.every(k=>options[k]),usage);options.python??='python3';
 for(const k of ['prepared','operations-cli','workspace','receiving-workspace','municipal-destination','out'])options[k]=resolve(options[k]);
 need(options.workspace!==options['receiving-workspace'],'Select an independent original Operations receiving directory.');
 need(/^[1-9][0-9]*$/.test(options.revision)&&Number.isSafeInteger(Number(options.revision)),'Select the actual saved Installation revision.');
 const output=await privateDirectory(options.out),lease=await operationLease(join(output,'municipal-installation-receiving.lock'));
 const read=(path,max=128*1024*1024)=>regular(path,max);
 const save=async(name,value)=>retain(join(output,name),encoded(value));
 const phase=async(name,action)=>{try{return parse(await read(join(output,name+'.json')));}catch(error){if(error.code!=='ENOENT')throw error;}const value=await action();await save(name+'.json',value);return value;};
 const native=(args,workspace=options.workspace)=>nativeOperations(options.python,options['operations-cli'],workspace,args);
 try{
  await save('Original_Receiving_Arguments.json',options);
  const receiptInput=await originalInput(output,'Original_Preparation_Receiving.json',join(options.prepared,'Municipal_Installation_Receiving.json'),MAX_SOURCE),receiptRaw=receiptInput.raw,receipt=parse(receiptRaw);
  need(receipt.schema==='stellar-forge.municipal-installation-local-receiving.v1'&&receipt.command==='prepare'&&Array.isArray(receipt.outputs),'Select the complete original prepared source edition.');
  const selected=new Map();
  for(const file of receipt.outputs){
   need(typeof file.path==='string'&&basename(file.path)===file.path&&!file.path.includes('\\'),'Retain complete flat preparation outputs.');
   const input=await originalInput(output,'prepared/'+file.path,join(options.prepared,file.path),128*1024*1024),raw=input.raw;need(same(identity(raw),{bytes:file.bytes,sha256:file.sha256}),'Prepared source changed: '+file.path);
   selected.set(file.path,raw);await retain(join(output,'prepared',file.path),raw);
  }
  await retain(join(output,'Original_Preparation_Receiving.json'),receiptRaw);
  const packetRaw=selected.get('Municipal_Complete_Original_Handover.zip'),selectionRaw=selected.get('Selected_Municipal_Projects.json');
  need(packetRaw&&selectionRaw,'Retain the complete original archive and selected projects.');
  const document=parse(selected.get('installation-input.json')),selection=parse(selectionRaw),snapshot=parse(selected.get('Municipal_Installation_Projects.json'));
  const originalSource=parse(selected.get('Municipal_Complete_Source_Report.json'));
  need(receipt.caseId===options.case&&same(receipt.workspace,originalSource.workspace)&&same(originalSource.archive,identity(packetRaw)),'Preserve the original source/case binding.');
  need(snapshot.selectedProjectsSource.sha256===sha(selectionRaw)&&snapshot.selectedProjectsSource.bytes===selectionRaw.length&&same(snapshot.workspace,selection.workspace),'The selected-project source changed.');
  const archiveId=selection.handover.sourceId,selectionId=snapshot.selectedProjectsSource.sourceId;
  for(const id of [archiveId,selectionId])need(document.source.sourceIds.includes(id)&&document.receiving.sourceIds.includes(id),'The saved Installation must select both complete sources.');
  const saved=await phase('Original_Saved_Installation',async()=>{
   const value=native(['installation-show','--case',options.case,'--installation',options.installation,'--revision',options.revision]);
   need(value.id===options.installation&&String(value.revision)===options.revision&&same(value.preview.document,document),'Select the actual native saved edition of this complete preparation.');return value;
  });
  const originalCase=await phase('Original_Operations_Case',async()=>{
   const value=native(['show','--case',options.case]);need(value.program?.id===options.case&&Array.isArray(value.sources),'Retain the complete original Operations case.');
   for(const [id,raw] of [[archiveId,packetRaw],[selectionId,selectionRaw]])need(value.sources.some(row=>row.id===id&&row.bytes===raw.length&&row.sha256===sha(raw)),'The actual case lacks its complete original source: '+id);return value;
  });
  const retainedArchive=join(output,'prepared','Municipal_Complete_Original_Handover.zip');
  const received=nativeMunicipal(options.python,'receive',retainedArchive,options['municipal-destination']);
  need(same(received.archive,identity(packetRaw))&&same(received.originalProjects.workspace,originalSource.workspace),'The actual original municipal receive changed.');
  await phase('Municipal_Original_Receiving',async()=>received);
  // Execute the cold read on each continuation; retain the first observation.
  const reopened=nativeMunicipal(options.python,'reopen',retainedArchive,options['municipal-destination']);
  need(same(reopened.originalProjects,received.originalProjects),'The independently reopened original project editions differ.');
  await phase('Municipal_Cold_Reopen',async()=>reopened);
  const archivePath=join(output,'Complete_Original_Installation.zip');
  const exported=await phase('Installation_Export',async()=>{
   let raw;try{raw=await read(archivePath);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(!raw){native(['installation-export','--case',options.case,'--installation',options.installation,'--revision',options.revision,'--output',archivePath]);raw=await read(archivePath);}
   return{path:'Complete_Original_Installation.zip',...identity(raw)};
  });
  const complete=await read(archivePath);need(same(identity(complete),{bytes:exported.bytes,sha256:exported.sha256}),'The full original Installation export changed.');
  // An export whose publish reply was lost is recoverable only after its complete native selection is read.
  // Validate before import so a pre-existing unrelated ZIP cannot create a different receiving case.
  const archiveSelection={schema:'stellar-forge.municipal-installation-archive-selection.v1',caseId:options.case,
   installation:{id:options.installation,revision:Number(options.revision),sha256:saved.sha256},document:saved.preview.document,
   sources:[...new Set([...document.source.sourceIds,...document.receiving.sourceIds])].map(id=>{
    const row=originalCase.sources.find(item=>item.id===id);need(row,'Keep the complete original selected source: '+id);
    return{id:row.id,bytes:row.bytes,sha256:row.sha256};
   })};
  await save('Original_Archive_Selection.json',archiveSelection);
  const inspected=inspectInstallationArchive(options.python,archivePath,join(output,'Original_Archive_Selection.json'));
  need(same(inspected.archive,identity(complete)),'The selected original Installation archive changed before import.');
  await phase('Installation_Archive_Selection',async()=>inspected);
  const request='municipal-installation-'+sha(encoded({archive:exported.sha256,workspace:options['receiving-workspace'],actor:options.actor})).slice(0,32);
  const imported=native(['import','--file',archivePath,'--name','Received municipal asset installation','--actor',options.actor,'--request-id',request],options['receiving-workspace']);
  need(typeof imported.id==='string','Retain the original independently received case identity.');
  const initialImport=await phase('Installation_Independent_Import',async()=>imported);need(initialImport.id===imported.id,'Original case receiving identity changed.');
  const actualRead=()=>{
   const value=native(['installation-show','--case',imported.id,'--installation',options.installation,'--revision',options.revision],options['receiving-workspace']);
   const full=native(['show','--case',imported.id],options['receiving-workspace']);
   need(value.sha256===saved.sha256&&same(value.preview.document,saved.preview.document),'The received original Installation edition differs.');
   for(const id of new Set([...document.source.sourceIds,...document.receiving.sourceIds])){
    const before=originalCase.sources.find(r=>r.id===id),after=full.sources.find(r=>r.id===id);
    need(before&&after&&before.sha256===after.sha256&&before.bytes===after.bytes,'An original complete source differs: '+id);
   }
   return{caseId:imported.id,installationId:value.id,revision:value.revision,sha256:value.sha256,workshare:value.preview.document.workshare};
  };
  const opened=actualRead();await phase('Installation_Independent_Reopen',async()=>opened);
  const cold=actualRead();need(same(opened,cold),'The original Installation changed between cold reads.');await phase('Installation_Cold_Reopen',async()=>cold);
  // Whole original preparation is read again after the native course.
  for(const file of receipt.outputs)await originalUnchanged(join(options.prepared,file.path),selected.get(file.path),128*1024*1024);
  await originalUnchanged(join(options.prepared,'Municipal_Installation_Receiving.json'),receiptRaw,MAX_SOURCE);
  const result={schema:'stellar-forge.municipal-installation-complete-receiving.v1',state:'COMPLETE',
   original:{caseId:options.case,installationId:options.installation,revision:Number(options.revision),sha256:saved.sha256},
   receiving:{caseId:imported.id,operations:options['receiving-workspace'],municipal:options['municipal-destination']},
   source:{...identity(packetRaw),workspace:originalSource.workspace,projects:received.originalProjects.projects,selectedProjects:snapshot.selectedProjectsSource},
   archive:exported,requestId:request,
   renderedCourse:'Open and personally inspect the exact outgoing installed applications, full source report and every attachment at desktop/narrow widths; operate important controls, download and reopen according to MUNICIPAL_INSTALLATION.md.'};
  await save('Municipal_Installation_Complete_Receiving.json',result);console.log(JSON.stringify(result,null,2));return result;
 }finally{await lease.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{console.error(JSON.stringify({code:error.code??'MUNICIPAL_INSTALLATION_RECEIVING',message:String(error.message)}));process.exitCode=1;});
