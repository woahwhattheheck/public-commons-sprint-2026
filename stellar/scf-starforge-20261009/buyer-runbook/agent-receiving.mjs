// MIT. Same original Buyer purchase, received through its actual merchant provider.
import {readFile,open,mkdir,lstat,rename,unlink,link} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {receiveBuyerManagedApplication} from '../distribution/receiving/d7ca-buyer-workspace/receive_buyer_managed_application.mjs';

const ROOT='stellar/scf-starforge-20261009/';
const SCHEMA='stellar-forge.buyer-runbook.agent-reception.v1';
const PREFIX='merchant_buyer_runbook_';
const SDK_FILES=['client-export.json','seller-client.mjs','seller-client.d.mts','seller-openapi.json','package.json','README.md'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?
 Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const fingerprint=value=>hash(JSON.stringify(ordered(value)));
const requireValue=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function directory(path){try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const stat=await lstat(path);requireValue(stat.isDirectory()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0,'BUYER_AGENT_RECEIVING_PRIVATE_DIRECTORY');}
async function sync(path){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
async function json(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function replace(path,bytes){
 const part=path+'.'+randomUUID()+'.tmp',file=await open(part,'wx',0o600);
 try{await file.writeFile(bytes);await file.sync();await file.close();await rename(part,path);await sync(dirname(path));}
 finally{await file.close().catch(()=>{});await unlink(part).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function retain(path,bytes){
 const matches=async()=>requireValue((await readFile(path)).equals(bytes),'BUYER_AGENT_RECEIVING_ORIGINAL_INPUT_CHANGED');
 if(await exists(path)){await matches();return;}
 const temporary=path+'.'+randomUUID()+'.part',file=await open(temporary,'wx',0o600);
 try{
  await file.writeFile(bytes);await file.sync();await file.close();
  try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;await matches();}
  await sync(dirname(path));
 }finally{await file.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

const at=(root,path)=>import(pathToFileURL(join(root,path)).href);

export async function receiveBuyerAgentManagedApplication(config,{onProgress=()=>{}}={}){
 let originalAgentRecord=null;
 const root=join(config.receptionDirectory,'agent'),journalPath=join(root,'agent-reception.json');
 const completed=await json(journalPath);
 if(completed?.completedAt){
  const native=await json(join(config.receptionDirectory,'buyer-managed-reception.json'));
  requireValue(completed.identity.sourceCommit===config.expectedSourceCommit&&completed.identity.manifestSha256===config.expectedManifest&&
   native?.completedAt===completed.originalCompletedAt&&native.originalResult?.nativeResultSha256===completed.passes.reopen.nativeResultSha256,
   'BUYER_AGENT_RECEIVING_COMPLETED_SELECTION_CHANGED');
  const destination=completed.passes.reopen.delivery.directory;
  const manifest=await json(join(destination,'buyer-agent-export.json'));
  requireValue(manifest&&hash(encode(manifest))===completed.passes.reopen.delivery.manifestSha256,'BUYER_AGENT_RECEIVING_DELIVERY_CHANGED');
  for(const file of manifest.files)requireValue(hash(await readFile(join(destination,file.name)))===file.sha256,'BUYER_AGENT_RECEIVING_DELIVERY_CHANGED');
  return completed;
 }
 const sessions=new Set();
 const openWorkspaceClient=async context=>{
  const {api,announcement,pass,installed,original,journal:buyer,selection}=context;
  await directory(root);await directory(join(root,'inputs'));await directory(join(root,'receiving'));
  const configurationPath=join(root,'agent-connections.json'),launchFile=join(root,'current-launch.json');
  await replace(launchFile,encode(announcement));
  let journal=await json(journalPath);
  const identity={schema:SCHEMA,sourceCommit:installed.sourceCommit,manifestSha256:installed.sourceManifestSha256,
   nativeDirectory:selection.buyerDirectory,nativeApplication:buyer.applicationId,selectionSha256:announcement.selectionSha256,
   sdkManifestSha256:config.expectedSDKManifestSha256,handoffSha256:hash(original.handoffBytes),customerSha256:hash(original.customer)};
  if(journal)requireValue(isDeepStrictEqual(journal.identity,identity),'BUYER_AGENT_RECEIVING_SELECTION_CHANGED');
  else{journal={schema:SCHEMA,identity,createdAt:new Date().toISOString(),requests:{},passes:{},exportId:'original-customer-delivery'};await replace(journalPath,encode(journal));}
  originalAgentRecord=journal;
  const persist=async()=>{journal.updatedAt=new Date().toISOString();await replace(journalPath,encode(journal));};
  const inputFiles={};
  for(let index=0;index<SDK_FILES.length;index++){
   const name=SDK_FILES[index],handle=index===0?'sdk_manifest':'sdk_'+index,path=join(root,'inputs',name),bytes=original.sdk[name];
   await retain(path,bytes);inputFiles[handle]={path,kind:index===0?'sdk-manifest':'sdk-file',sha256:hash(bytes),label:name};
  }
  const handoff=join(root,'inputs','merchant.handoff.json');await retain(handoff,original.handoffBytes);
  inputFiles.paid_handoff={path:handoff,kind:'paid-handoff',sha256:hash(original.handoffBytes),label:'Original merchant handoff'};
  let session,client,closed=false,closePromise;
  const token=randomBytes(32).toString('hex'),tokenEnv='D7CA_BUYER_AGENT_RECEIVING_TOKEN',environment={[tokenEnv]:token};
  const ensureMerchant=async settings=>{
   if(session)return;
   requireValue(settings&&typeof settings==='object','BUYER_AGENT_RECEIVING_ORIGINAL_SETTINGS_REQUIRED');
   const settingsPath=join(root,'inputs','operator-settings.json'),settingsBytes=encode(ordered(settings));
   await retain(settingsPath,settingsBytes);inputFiles.setup={path:settingsPath,kind:'settings',sha256:hash(settingsBytes),label:'Original Local buyer setup'};
   const configuration={schema:'stellar-forge.buyer-runbook.agent-connections.v1',workspaces:{customer:{
    label:'Original Buyer managed receiving',directory:selection.buyerDirectory,launchFile,
    expectedSelectionSha256:announcement.selectionSha256,storageDirectory:join(root,'receiving'),files:inputFiles,operators:{}}}};
   await retain(configurationPath,encode(configuration));
   const {initializeBuyerRunbookMerchant}=await at(installed.sourceRoot,ROOT+'buyer-runbook/agent-setup.mjs');
   const setup=await initializeBuyerRunbookMerchant({directory:join(root,'merchant'),connection:configurationPath,name:'Original Buyer agent receiving'});
   const {startMerchantMcp}=await at(installed.sourceRoot,'stellar-forge/mcp-merchant-operator/serve.mjs');
   session=await startMerchantMcp({configPath:setup.configuration,port:0,tokenEnv,environment});
   sessions.add(session);
   const tools=session.operator.tools.filter(tool=>tool.name.startsWith(PREFIX));
   requireValue(tools.length===45&&!tools.some(tool=>/decide|approve$/.test(tool.name)),'BUYER_AGENT_RECEIVING_CATALOG_CHANGED');
   const {openMerchantFileClient}=await at(installed.sourceRoot,'stellar-forge/mcp-merchant-operator/retained-download.mjs');
   client=await openMerchantFileClient({url:session.url,tokenEnv,environment,errorPrefix:'BUYER_AGENT',clientName:'original-buyer-agent-receiving'});
   const opened=await client.call(PREFIX+'open',{workspace:'customer'});
   requireValue(opened.native.instanceId===announcement.instanceId&&opened.native.selectionSha256===announcement.selectionSha256,
    'BUYER_AGENT_RECEIVING_WRONG_NATIVE_INSTANCE');
   journal.passes[pass.name]??={startedAt:new Date().toISOString()};
   Object.assign(journal.passes[pass.name],{instanceId:announcement.instanceId,pid:announcement.pid,selectionSha256:announcement.selectionSha256,
    merchantConfiguration:setup.configuration,tools:tools.map(tool=>tool.name)});
   await persist();onProgress({stage:'BUYER_AGENT_ORIGINAL_MCP_OPEN',pass:pass.name,instanceId:announcement.instanceId,tools:tools.length});
  };
  if(buyer.operator?.settings||buyer.operatorProposal?.settings)await ensureMerchant(buyer.operator?.settings??buyer.operatorProposal.settings);
  const invoke=async(action,args,body,path)=>{
   requireValue(session&&!closed,'BUYER_AGENT_RECEIVING_MERCHANT_NOT_OPEN');
   const mutating=['operator_save','receive_client','client_file','client_request','receive_request','review_request','prepare_request',
    'receive_paid_file','review_paid_file','prepare_paid_file','save_draft','initialize','execute','finalize','cancel','recover','unlock',
    'bind_accounting','retrieve_file','reset_file','backup_start','backup_cancel'].includes(action);
   if(mutating){
    const key=fingerprint({action,path,body});
    if(!journal.requests[key]){journal.requests[key]={requestId:randomUUID(),action,args:{workspace:'customer',...args},createdAt:new Date().toISOString()};await persist();}
    const retained=journal.requests[key];requireValue(retained.action===action&&isDeepStrictEqual(retained.args,{workspace:'customer',...args}),
     'BUYER_AGENT_RECEIVING_REQUEST_CHANGED');args={...args,requestId:retained.requestId};
   }
   const reply=await client.call(PREFIX+action,{workspace:'customer',...args});
   requireValue(reply.schema==='stellar-forge.buyer-runbook.agent.v1'&&reply.workspace==='customer'&&reply.native,
    'BUYER_AGENT_RECEIVING_NATIVE_REPLY_REQUIRED');
   if(mutating){const record=Object.values(journal.requests).find(row=>row.requestId===args.requestId);
    record.replySha256=fingerprint(reply.native);record.phase=reply.operation?.phase??null;record.replayed=reply.operation?.replayed??false;await persist();}
   return reply.native;
  };
  const readRoute=path=>{
   if(path==='/api/operator')return {action:'operator',args:{}};
   if(path==='/api/approval')return {action:'approval',args:{}};
   if(path==='/api/launch')return {action:'open',args:{}};
   let match=/^\/api\/(clients|requests|paid-files)\/([^/]+)$/.exec(path);
   if(match)return {action:{clients:'client',requests:'request','paid-files':'paid_file'}[match[1]],args:{id:match[2]}};
   match=/^\/api\/drafts\/([^/]+)(?:\/([1-9][0-9]*))?$/.exec(path);
   if(match)return {action:'draft',args:{id:match[1],...(match[2]?{revision:Number(match[2])}:{})}};
   match=/^\/api\/runs\/([^/]+)$/.exec(path);if(match)return {action:'run',args:{id:match[1]}};
   return null;
  };
  const request=async(path,body)=>{
   if(body===undefined){
    const route=readRoute(path);
    if(route&&session)return invoke(route.action,route.args,body,path);
    return api.request(path);
   }
   // The original native receiving operator continues to make its decision at
   // the same browser API. No agent approval tool or replacement broker exists.
   if(path==='/api/approval')return api.request(path,body);
   let action,args;
   if(path==='/api/operator/review'||path==='/api/operator/save'){
    await ensureMerchant(body.settings);action=path.endsWith('/save')?'operator_save':'operator_review';
    requireValue(isDeepStrictEqual(body.settings,JSON.parse(await readFile(inputFiles.setup.path,'utf8'))),'BUYER_AGENT_RECEIVING_SETTINGS_CHANGED');
    const {settings,...rest}=body;args={...rest,settings:'setup',expectedSettingsSha256:inputFiles.setup.sha256};
   }else if(path==='/api/clients/upload'){
    requireValue(hash(Buffer.from(body.base64,'base64'))===inputFiles.sdk_manifest.sha256,'BUYER_AGENT_RECEIVING_SDK_CHANGED');
    action='receive_client';args={file:'sdk_manifest',expectedSha256:inputFiles.sdk_manifest.sha256};
   }else if(path==='/api/clients/file'){
    const index=SDK_FILES.indexOf(body.file),file=inputFiles['sdk_'+index];
    requireValue(index>0&&file&&hash(Buffer.from(body.base64,'base64'))===file.sha256,'BUYER_AGENT_RECEIVING_SDK_FILE_CHANGED');
    action='client_file';args={id:body.id,file:'sdk_'+index,name:body.file,expectedSha256:file.sha256};
   }else if(path==='/api/paid-files/upload'){
    requireValue(hash(Buffer.from(body.base64,'base64'))===inputFiles.paid_handoff.sha256,'BUYER_AGENT_RECEIVING_HANDOFF_CHANGED');
    action='receive_paid_file';args={file:'paid_handoff',filename:body.filename,expectedSha256:inputFiles.paid_handoff.sha256};
   }else{
    const routes={'/api/clients/request':'client_request','/api/requests/review':'review_request','/api/requests/prepare':'prepare_request',
     '/api/paid-files/review':'review_paid_file','/api/paid-files/prepare':'prepare_paid_file','/api/drafts/save':'save_draft',
     '/api/drafts/initialize':'initialize','/api/runs/execute':'execute','/api/runs/finalize':'finalize','/api/runs/cancel':'cancel',
     '/api/runs/recover':'recover','/api/runs/unlock':'unlock','/api/runs/retrieve-file':'retrieve_file','/api/runs/reset-file-transfer':'reset_file'};
    action=routes[path];requireValue(action,'BUYER_AGENT_RECEIVING_UNDECLARED_NATIVE_MUTATION');args=body;
   }
   return invoke(action,args,body,path);
  };
  const received=async({journal:originalJournal})=>{
   await ensureMerchant(originalJournal.operator.settings);
   const current=await invoke('run',{id:originalJournal.buyerRunId},undefined,'/api/runs/'+originalJournal.buyerRunId);
   const row=current.state.operations.find(value=>value.id===originalJournal.fixture.operationId);
   requireValue(fingerprint(row.result)===originalJournal.originalResult.nativeResultSha256,'BUYER_AGENT_RECEIVING_RESULT_CHANGED');
   for(const retained of Object.values(journal.requests)){
    if(!['execute','save_draft'].includes(retained.action))continue;
    const observed=await client.call(PREFIX+'operation',{workspace:'customer',requestId:retained.requestId});
    if(['ATTENTION','DISPATCHING'].includes(observed.native.phase)){
     const reconciled=await client.call(PREFIX+'reconcile',{workspace:'customer',requestId:retained.requestId,
      ...(retained.action==='save_draft'?{id:originalJournal.buyerRunId}:{})});
     requireValue(reconciled.native.phase==='RECONCILED','BUYER_AGENT_RECEIVING_ORIGINAL_ACTION_NOT_RECONCILED');
     retained.phase='RECONCILED';retained.reconciliationBasis=reconciled.native.reconciliation.basis;await persist();
    }
   }
   const ids=Object.values(journal.requests);
   const saved=ids.find(row=>row.action==='operator_save');
   requireValue(saved,'BUYER_AGENT_RECEIVING_SETUP_NOT_OPERATED');
   const replay=await client.call(PREFIX+'resume',{workspace:'customer',requestId:saved.requestId});
   requireValue(replay.operation.phase==='COMPLETE'&&replay.operation.replayed===true,'BUYER_AGENT_RECEIVING_ORIGINAL_SAVE_REPLAY_REQUIRED');
   const exportId=journal.exportId;
   const files=[
    ...SDK_FILES.map((name,index)=>({kind:'sdk',id:originalJournal.sdk.id,name,expectedSha256:original.identity.sdk[index].sha256})),
    {kind:'paid-handoff',id:originalJournal.paidFile.id,expectedSha256:hash(original.handoffBytes)},
    {kind:'resource',id:originalJournal.buyerRunId,operation:originalJournal.fixture.operationId,expectedSha256:hash(original.customer)},
    {kind:'report',id:originalJournal.buyerRunId,format:'json'},
    {kind:'accounting',id:originalJournal.buyerRunId}
   ];
   const captured=await client.call(PREFIX+'capture',{workspace:'customer',exportId,files});
   const {downloadBuyerRunbookExport}=await at(installed.sourceRoot,ROOT+'buyer-runbook/agent-client.mjs');
   const destination=join(root,'complete-delivery');
   const delivered=await downloadBuyerRunbookExport({url:session.url,workspace:'customer',tokenEnv,environment,exportId,
    directory:destination,expectedManifestSha256:captured.native.manifestSha256});
   requireValue(delivered.state==='COMPLETE'&&delivered.files===10,'BUYER_AGENT_RECEIVING_COMPLETE_FILES_REQUIRED');
   const retained=JSON.parse(await readFile(join(destination,'buyer-agent-export.json'),'utf8'));
   const customer=retained.files.find(file=>file.selection.kind==='resource');
   requireValue(customer&&customer.bytes===original.customer.length&&customer.sha256===hash(original.customer)&&
    (await readFile(join(destination,customer.name))).equals(original.customer),'BUYER_AGENT_RECEIVING_CUSTOMER_BYTES_CHANGED');
   for(const file of retained.files)requireValue(hash(await readFile(join(destination,file.name)))===file.sha256,'BUYER_AGENT_RECEIVING_DELIVERY_CHANGED');
   const status=await client.call(PREFIX+'status',{workspace:'customer'});
   requireValue(status.native.active?.finishedAt||pass.name==='reopen','BUYER_AGENT_RECEIVING_NATIVE_NOT_FINISHED');
   journal.passes[pass.name].receivedAt=new Date().toISOString();journal.passes[pass.name].delivery=delivered;
   journal.passes[pass.name].nativeResultSha256=fingerprint(row.result);journal.passes[pass.name].originalSaveRequestId=saved.requestId;
   await persist();onProgress({stage:'BUYER_AGENT_COMPLETE_ORIGINAL_FILES',pass:pass.name,files:10,bytes:delivered.bytes,resumed:delivered.resumed});
  };
  const close=()=>{
   if(closePromise)return closePromise;closed=true;
   closePromise=(async()=>{if(session){await session.close();sessions.delete(session);}session=null;client=null;})();
   closePromise.catch(()=>{closePromise=null;});return closePromise;
  };
  return {request,received,close};
 };
 try{
  const result=await receiveBuyerManagedApplication(config,{onProgress,openWorkspaceClient});
  requireValue(originalAgentRecord&&originalAgentRecord.passes['first-open']?.receivedAt&&originalAgentRecord.passes.reopen?.receivedAt,
   'BUYER_AGENT_RECEIVING_ORIGINAL_PASSES_REQUIRED');
  requireValue(originalAgentRecord.passes['first-open'].instanceId!==originalAgentRecord.passes.reopen.instanceId&&
   originalAgentRecord.passes['first-open'].nativeResultSha256===originalAgentRecord.passes.reopen.nativeResultSha256&&
   originalAgentRecord.passes.reopen.delivery.resumed===true,'BUYER_AGENT_RECEIVING_REOPEN_CHANGED');
  originalAgentRecord.completedAt=new Date().toISOString();originalAgentRecord.originalCompletedAt=result.completedAt;
  await replace(journalPath,encode(originalAgentRecord));return originalAgentRecord;
 }finally{
  const closed=await Promise.allSettled([...sessions].map(session=>session.close()));
  requireValue(closed.every(result=>result.status==='fulfilled'),'BUYER_AGENT_RECEIVING_CLOSE_INCOMPLETE');
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const config=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
 const result=await receiveBuyerAgentManagedApplication(config,{onProgress:value=>process.stdout.write(JSON.stringify(value)+'\n')});
 process.stdout.write(JSON.stringify({state:'COMPLETE',operation:'D7CA-SCF-BUYER-RECEIVING-APPLICATION-20261012',
  originalApplication:result.identity.nativeApplication,sourceCommit:result.identity.sourceCommit,
  nativeResultSha256:result.passes.reopen.nativeResultSha256,delivery:result.passes.reopen.delivery,
  receipt:join(config.receptionDirectory,'agent','agent-reception.json')})+'\n');
}
