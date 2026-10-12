// Original Research case operation: browser-owned listener, CLI/MCP analysis, complete receiving.
import {readFile,writeFile,mkdir,rename,open,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
const execute=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const input=JSON.parse(await readFile(process.argv[2],'utf8'));
const required=(condition,message)=>{if(!condition)throw new Error(message);};
required(input.schema==='sf88.research-client.original-native-operation.v1','Use the original selected operation input.');
required(typeof input.operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(input.operationId),'Keep one stable original operation identifier.');
required(typeof input.sourceMerge==='string'&&/^[a-f0-9]{40}$/.test(input.sourceMerge),'Use the verified selected source commit.');
for(const name of ['sourceRoot','directory','outputDirectory'])required(typeof input[name]==='string'&&resolve(input[name])===input[name],'Use the selected absolute '+name+'.');
required(typeof input.dossierId==='string'&&typeof input.questionId==='string','Keep the original case and question identifiers.');
const root=input.sourceRoot,base=join(root,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers');
const merchantRoot=join(root,'stellar-forge/mcp-merchant-operator'),output=input.outputDirectory;
await mkdir(output,{recursive:true,mode:0o700});
const reportPath=join(output,'native-report.json');
let prior=null;try{prior=JSON.parse(await readFile(reportPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
required(!prior||prior.operationId===input.operationId&&prior.dossierId===input.dossierId&&prior.questionId===input.questionId,'This operation directory belongs to its original case.');
if(prior?.state==='complete'){process.stdout.write(JSON.stringify({state:'complete',operationId:prior.operationId,report:reportPath,revision:prior.finalRevision})+'\n');process.exit(0);}
const report={schema:'sf88.research-client.original-native-result.v1',operationId:input.operationId,
 sourceMerge:input.sourceMerge,dossierId:input.dossierId,questionId:input.questionId,
 startedAt:prior?.startedAt??new Date().toISOString(),attempts:[...(prior?.attempts??[]),new Date().toISOString()],
 state:'running',steps:prior?.steps??{},artifacts:prior?.artifacts??{}};
const save=async()=>{const tmp=reportPath+'.'+randomUUID();await writeFile(tmp,JSON.stringify(report,null,2)+'\n',{mode:0o600});await rename(tmp,reportPath);};
const stage=async(name,work)=>{
 report.currentStep=name;await save();
 try{const value=await work();report.steps[name]={state:'complete',at:new Date().toISOString(),value};await save();process.stdout.write(JSON.stringify({step:name,state:'complete'})+'\n');return value;}
 catch(error){report.steps[name]={state:'attention',at:new Date().toISOString(),error:{code:error.code??error.name,message:error.message,outcomeUnknown:error.outcomeUnknown??false}};await save();throw error;}
};
const {ResearchWorkspaceClient}=await import(pathToFileURL(join(base,'workspace-client.mjs')));
const {MerchantResearchWorkspaces,readResearchWorkspaceConfiguration}=await import(pathToFileURL(join(merchantRoot,'research-workspace.mjs')));
const {startDossierWorkspace}=await import(pathToFileURL(join(base,'server.mjs')));
const {openDossierStore}=await import(pathToFileURL(join(base,'dossier.mjs')));
const connectionFile=input.connectionFile??join(output,'original-research-connection.json');
const owned=[],clients=[];let merchant,attachment;
async function launchOriginal(directory,connection,additional=[]){
 const args=[join(base,'server.mjs'),'--dir',directory,'--connection-file',connection,...additional];
 const child=spawn(process.execPath,args,{env:{...process.env,NODE_OPTIONS:'--max-old-space-size=192'},stdio:['ignore','pipe','pipe']});
 owned.push(child);let errors='';child.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-3000);});
 const lines=createInterface({input:child.stdout});
 try{
  const startup=await Promise.race([
   (async()=>{for await(const line of lines){let value;try{value=JSON.parse(line);}catch{continue;}
    if(value.mode==='RESEARCH_DOSSIER_WORKSPACE'){required(value.directory===directory,'Original server directory differs.');return value;}}
    throw new Error('Original listener ended before readiness: '+errors);})(),
   new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Original listener startup timed out.')),45000);timer.unref();child.once('exit',()=>clearTimeout(timer));})
  ]);
  return {mode:startup.mode,directory:startup.directory,workspaceId:startup.workspaceId,instanceId:startup.instanceId};
 }finally{lines.close();child.stdout.resume();}
}
const nativeFields=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='dossierId'));
const call=(name,args={})=>merchant.call('merchant_research_'+name,{workspace:'original',...args});
async function fileIdentity(file){
 const digest=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(file)){bytes+=chunk.length;digest.update(chunk);}
 return {file,bytes,sha256:digest.digest('hex')};
}
async function completeFile(receipt,destination){
 destination+=('.'+receipt.exportId);
 try{
  const retained=await fileIdentity(destination);
  required(retained.bytes===receipt.bytes&&retained.sha256===receipt.exportId,'The retained original export differs.');
  return {...retained,kind:receipt.kind,receiptId:receipt.receiptId,reused:true};
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=destination+'.partial-'+randomUUID(),file=await open(temporary,'wx',0o600);
 const digest=createHash('sha256');let total=0,offset=0,readId;
 try{
  while(true){
   const part=await call('file_read',{kind:receipt.kind,exportId:receipt.exportId,offset,...(readId?{readId}:{}),limit:65536});
   required(part.encoding==='base64'&&part.offset===offset,'Retained chunk identity differs.');
   const bytes=Buffer.from(part.data,'base64');required(bytes.length===part.bytesRead,'Retained chunk length differs.');
   await file.writeFile(bytes);digest.update(bytes);total+=bytes.length;readId=part.readId;
   if(part.nextOffset===null)break;
   required(part.nextOffset===offset+bytes.length,'Retained chunk continuation differs.');offset=part.nextOffset;
  }
  const sha256=digest.digest('hex');
  required(total===receipt.bytes&&sha256===receipt.exportId,'Complete original export hash differs.');
  await file.sync();await file.close();await rename(temporary,destination);
  return {file:destination,bytes:total,sha256,kind:receipt.kind,receiptId:receipt.receiptId};
 }catch(error){await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
}
async function retainSdkExport(name,extension,publish,expected={}){
 const retained=report.artifacts[name];
 if(retained){
  const found=await fileIdentity(retained.file);
  required(found.bytes===retained.bytes&&found.sha256===retained.sha256,'The retained receiving output differs.');
  if(expected.sha256)required(found.sha256===expected.sha256,'The original receiving source identity differs.');
  if(expected.bytes!==undefined)required(found.bytes===expected.bytes,'The original receiving source length differs.');
  return retained;
 }
 const file=join(output,name+'-'+randomUUID()+extension),result=await publish(file);
 if(expected.sha256)required(result.sha256===expected.sha256,'The original receiving source identity differs.');
 if(expected.bytes!==undefined)required(result.bytes===expected.bytes,'The original receiving source length differs.');
 report.artifacts[name]={file,bytes:result.bytes,sha256:result.sha256};await save();return report.artifacts[name];
}
async function shutdown(child){
 if(child.exitCode!==null||child.signalCode!==null)return;
 child.kill('SIGTERM');
 await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>{const timer=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');resolve();},5000);timer.unref();})]);
}
try{
 if(!input.connectionFile)await stage('original-listener',()=>launchOriginal(input.directory,connectionFile,input.serverArguments??[]));
 const client=new ResearchWorkspaceClient({connectionFile,directory:input.directory});clients.push(client);
 const originalStatus=await client.status();
 const configFile=join(output,'research-workspaces.json');
 await writeFile(configFile,JSON.stringify({schema:'stellar-forge.research-workspaces.v1',workspaces:{original:{
  label:'Original research case',consoleUrlFile:connectionFile,directory:input.directory,sources:{}
 }}}),{mode:0o600});
 const configuration=await readResearchWorkspaceConfiguration(configFile);
 merchant=new MerchantResearchWorkspaces({researchWorkspaces:configuration,exportsDirectory:join(output,'merchant-exports')});
 await stage('original-attachment',async()=>{
  attachment=await call('attach');required(attachment.status.workspaceId===originalStatus.workspaceId,'Attachment selected a different workspace.');
  const {merchantToolCatalog}=await import(pathToFileURL(join(merchantRoot,'catalog.mjs')));
  const tools=merchantToolCatalog({researchWorkspaces:configuration}).filter(tool=>tool.name.startsWith('merchant_research_'));
  required(tools.length===27,'Original lazy catalog did not advertise the complete Research family.');
  return {workspaceId:originalStatus.workspaceId,instanceId:originalStatus.instanceId,attachmentId:attachment.attachmentId,tools:tools.length};
 });
 const before=await client.metadata(input.dossierId),question=before.questions.find(row=>row.id===input.questionId);
 required(question,'Original research question is absent.');
 if(input.expectedOriginalRevision!==undefined)required(before.revision>=input.expectedOriginalRevision,'The selected original Research history is stale.');
 if(input.expectedEditionCount!==undefined)required(before.editions.length>=input.expectedEditionCount,'The original Research editions are incomplete.');
 if(input.expectedFindingCount!==undefined)required(before.findings.length>=input.expectedFindingCount,'The original Research findings are incomplete.');
 if(input.questionText)required(question.text===input.questionText,'Original question text differs.');
 report.initialRevision??=before.revision;report.initialEditionCount??=before.editions.length;await save();
 await stage('original-paged-review',async()=>{
  const sections={};
  for(const section of ['questions','editions','selections','findings','revisions']){
   const all=[];let next={revision:before.revision,offset:0,limit:10};
   do{
    const page=await call('section',{dossierId:input.dossierId,section,...next});
    required(page.revision===before.revision,'Retained review revision changed.');
    all.push(...page.items);next=page.next;
   }while(next);
   sections[section]=all.length;
  }
  const selected=await call('section',{dossierId:input.dossierId,section:'sources',questionId:input.questionId,
   selected:true,revision:before.revision,limit:100});
  required(selected.next===null,'Continue this actual selected-source page before receiving.');
  const cli=await execute(process.execPath,[join(base,'workspace-cli.mjs'),'metadata','--connection-file',connectionFile,
   '--directory',input.directory,'--id',input.dossierId,'--revision',String(before.revision)],{maxBuffer:16*1024*1024,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=128'}});
  const value=JSON.parse(cli.stdout);required(value.id===input.dossierId&&value.revision===before.revision,'CLI selected another original revision.');
  return {revision:before.revision,sections,selectedSourceCount:selected.items.length,cliRevision:value.revision};
 });
 let originalOperation=null;
 if(input.crossrefOperationId)required(originalStatus.crossref?.configured,'Attach the original saved Crossref source state for its named operation.');
 if(originalStatus.crossref?.configured){
  await stage('same-crossref-operation',async()=>{
   const operations=[];let continuation;
   do{
    const page=await call('crossref_operations',{dossierId:input.dossierId,...(continuation?{after:continuation}:{}),limit:100});
    operations.push(...page.items);continuation=page.next;
   }while(continuation);
   originalOperation=input.crossrefOperationId?operations.find(item=>item.plan.id===input.crossrefOperationId):
    operations.find(item=>item.plan.request.questionId===input.questionId&&item.operation.phase==='IMPORTED');
   required(originalOperation&&originalOperation.operation.phase==='IMPORTED','Select the existing completed original Crossref operation.');
   const id=originalOperation.plan.id,sha256=originalOperation.plan.sha256,captures=originalOperation.operation.responses;
   const prepared=await call('crossref_prepare',{dossierId:input.dossierId,...nativeFields(originalOperation.plan.request)});
   required(prepared.plan.id===id&&prepared.plan.sha256===sha256,'Original preparation replay selected another operation.');
   const reviewed=await call('crossref_review',{dossierId:input.dossierId,operationId:id,section:'dois',limit:100});
   required(reviewed.page.complete,'Continue the original DOI review before receiving.');
   await call('crossref_start',{dossierId:input.dossierId,operationId:id,expectedPlanSha256:sha256});
   await call('crossref_stop',{dossierId:input.dossierId,operationId:id});
   const current=await client.metadata(input.dossierId);
   await call('crossref_receive',{dossierId:input.dossierId,operationId:id,expectedRevision:current.revision,
    expectedPlanSha256:sha256,expectedEditionSha256:originalOperation.operation.editionSha256});
   const after=await client.metadata(input.dossierId),operation=await call('crossref_review',{dossierId:input.dossierId,operationId:id});
   required(after.revision===current.revision&&operation.operation.responses===captures,'Completed original operation changed during its replay.');
   return {operationId:id,planSha256:sha256,editionSha256:originalOperation.operation.editionSha256,captures,
    doiCount:reviewed.page.total,phase:operation.operation.phase,revision:after.revision};
  });
 }
 await stage('source-grounded-question-note',async()=>{
  if(!input.analystNote)return {state:'retained',revision:(await client.metadata(input.dossierId)).revision};
  for(let attempt=0;attempt<3;attempt++){
   const current=await client.metadata(input.dossierId),q=current.questions.find(row=>row.id===input.questionId);
   required(q,'Original question disappeared.');
   if(q.notes.includes(input.analystNote))return {state:'present',revision:current.revision,noteSha256:hash(input.analystNote)};
   const notes=q.notes?q.notes+'\n\n'+input.analystNote:input.analystNote;
   try{
    const received=await call('question',{dossierId:input.dossierId,questionId:input.questionId,expectedRevision:current.revision,notes});
    required(received.question?.notes===notes,'Saved question notes differ.');
    return {state:'appended',before:current.revision,revision:received.dossier.revision,noteSha256:hash(input.analystNote),
     sourceReferences:input.noteSources??[]};
   }catch(error){if(error.code!=='REVISION_CONFLICT'&&!error.outcomeUnknown)throw error;}
  }
  throw new Error('The same original question is being edited concurrently; retain and continue this operation.');
 });
 const after=await client.metadata(input.dossierId);
 required(after.editions.length===before.editions.length&&JSON.stringify(after.selections)===JSON.stringify(before.selections)&&
  JSON.stringify(after.findings)===JSON.stringify(before.findings),'Original source editions, selections or findings changed during the question-note operation.');
 const selectedRaw=after.editions.find(row=>row.questionId===input.questionId&&row.provider==='crossref'&&row.mode==='retained');
 required(selectedRaw,'The original retained Crossref edition is absent.');
 const receipts={};
 await stage('complete-original-delivery',async()=>{
  for(const [kind,name,extra]of [['portable-gzip','research-portable.json.gz',{}],['html','research-report.html',{}],
   ['retained-edition','original-crossref-edition.json',{editionId:selectedRaw.id}],
   ['comparison','research-comparison.json',{before:report.initialRevision,after:after.revision}]]){
   const receipt=await call('export',{dossierId:input.dossierId,kind,...extra});receipts[kind]=receipt;
   report.artifacts[kind]=await completeFile(receipt,join(output,name));await save();
  }
  required(report.artifacts['retained-edition'].sha256===selectedRaw.raw.sha256,'Original raw edition bytes changed.');
  const reopened=await call('reopen',{kind:'portable-gzip',exportId:receipts['portable-gzip'].exportId});
  required(reopened.dossier.id===input.dossierId&&reopened.dossier.revision===after.revision,'Original portable replay changed saved history.');
  const inventory=await call('exports',{dossierId:input.dossierId,limit:100});
  required(inventory.items.some(row=>row.exportId===receipts['portable-gzip'].exportId),'Retained export receipt is absent.');
  return {revision:after.revision,editionId:selectedRaw.id,exports:Object.fromEntries(Object.entries(report.artifacts).map(([kind,v])=>[kind,{bytes:v.bytes,sha256:v.sha256}])),reopenedRevision:reopened.dossier.revision};
 });
 await stage('encoding-preserving-receiving',async()=>{
  if(prior?.steps?.['encoding-preserving-receiving']?.state==='complete')return prior.steps['encoding-preserving-receiving'].value;
  const target=join(output,'portable-receiver'),store=await openDossierStore(target);
  const received=await store.reopenStream(createReadStream(report.artifacts['portable-gzip'].file));
  required(received.id===input.dossierId&&received.revision>=after.revision,'Independent original portable receiving differs.');
  const app=await startDossierWorkspace({directory:target});const receiver=new ResearchWorkspaceClient({url:app.url,directory:target});
  clients.push(receiver);
  try{
   await receiver.status();
   const original=await readFile(report.artifacts['retained-edition'].file);
   const bytes=original.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]))?original:Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),original]);
   const expected=hash(bytes),metadata=await receiver.metadata(input.dossierId);
   const existing=metadata.editions.find(row=>row.raw?.sha256===expected&&row.questionId===input.questionId);
   required(metadata.revision===after.revision||existing&&metadata.revision===after.revision+1,'The independent encoding receiver has unrelated later history.');
   const result=existing?metadata:await receiver.receiveResearchBytes(input.dossierId,{questionId:input.questionId,
    label:'UTF-8 BOM encoding copy of the retained Crossref edition',provider:'crossref',bytes,
    sourceReference:selectedRaw.sourceReference??'',expectedRevision:metadata.revision});
   const retained=result.editions.find(row=>row.raw?.sha256===expected&&row.questionId===input.questionId);
   required(retained,'The receiving edition did not preserve the exact UTF-8 bytes.');
   await retainSdkExport('encoding-retained-edition','.json',file=>receiver.exportRetainedEdition(input.dossierId,retained.id,{file}),{sha256:expected,bytes:bytes.length});
   const portable=await retainSdkExport('encoding-receiving-portable','.json.gz',file=>receiver.exportDossier(input.dossierId,{format:'json.gz',file}));
   const portableFile=portable.file;
   const second=await openDossierStore(join(output,'encoding-portable-reopen'));
   const again=await second.reopenStream(createReadStream(portableFile));
   required(again.editions.some(row=>row.id===retained.id&&row.raw.sha256===expected),'The original portable reopen changed raw source bytes.');
   report.artifacts['encoding-receiving']={file:portableFile,bytes:portable.bytes,sha256:portable.sha256};
   return {sourceKind:'explicit UTF-8 encoding derivative of the original retained edition',originalSha256:hash(original),
    derivativeSha256:expected,bytes:bytes.length,retainedEditionId:retained.id,receiverRevision:result.revision,reopenedRevision:again.revision};
  }finally{await receiver.close();await app.close();}
 });
 await stage('attachment-return',async()=>{
  await call('detach',{attachmentId:attachment.attachmentId});
  const status=await client.status();required(status.instanceId===originalStatus.instanceId,'Detach changed the original listener.');
  attachment=await call('attach');
  const inventory=await call('exports',{dossierId:input.dossierId,limit:100});
  required(inventory.items.some(row=>row.exportId===receipts['portable-gzip'].exportId),'Durable original exports disappeared after attachment return.');
  await call('detach',{attachmentId:attachment.attachmentId});
  return {instanceId:status.instanceId,retainedExports:inventory.total,finalRevision:(await client.metadata(input.dossierId)).revision};
 });
 report.finalRevision=(await client.metadata(input.dossierId)).revision;report.state='complete';report.endedAt=new Date().toISOString();delete report.currentStep;await save();
 process.stdout.write(JSON.stringify({state:report.state,operationId:report.operationId,report:reportPath,revision:report.finalRevision})+'\n');
}catch(error){
 report.state='attention';report.error={code:error.code??error.name,message:error.message,outcomeUnknown:error.outcomeUnknown??false};
 report.endedAt=new Date().toISOString();await save();process.exitCode=1;
 process.stderr.write(JSON.stringify({state:report.state,operationId:report.operationId,step:report.currentStep,error:report.error})+'\n');
}finally{
 if(merchant)await merchant.close();
 for(const client of clients)await client.close();
 for(const child of owned)await shutdown(child);
}
