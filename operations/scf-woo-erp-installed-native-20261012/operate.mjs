// Continue the original installed Woo/ERP operation through its merchant agent.
import { readFile, writeFile, mkdir, chmod, rename, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initializeWooCommerceMerchant } from '../../stellar-forge/mcp-merchant-operator/config.mjs';
import { startMerchantMcp } from '../../stellar-forge/mcp-merchant-operator/serve.mjs';
import { openWooErpClient, inspectReceivedWooErp } from '../../stellar-forge/mcp-merchant-operator/woo-erp-client.mjs';
import { canonicalErpJson, verifyErpProject } from '../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/merchant-erp-client.mjs';

const run=promisify(execFile);
const [journeyPath,phase,operatorSourceCommit]=process.argv.slice(2);
const need=(ok,message)=>{if(!ok)throw new Error(message);};
need(journeyPath&&['capture','receive'].includes(phase)&&/^[a-f0-9]{40}$/.test(operatorSourceCommit||''),
 'Use operate.mjs ORIGINAL_JOURNEY_JSON capture|receive PINNED_OPERATOR_COMMIT.');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>canonicalErpJson(a)===canonicalErpJson(b);
const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const cfgBytes=await readFile(resolve(journeyPath)),cfg=JSON.parse(cfgBytes);
const original=await read(join(cfg.outputRoot,'phase-delivery-result.json'));
const originalReopen=await read(join(cfg.outputRoot,'phase-reopen-result.json'));
need(original.schema==='commons.woo-erp.operating-delivery.v1'&&
 originalReopen.schema==='commons.woo-erp.operating-reopen.v1'&&originalReopen.projects?.length===2,
 'Complete the same original delivery and browser/CLI cold receiving before this continuation.');
const root=join(resolve(cfg.outputRoot),'installed-erp');
await mkdir(root,{recursive:true,mode:0o700});await chmod(root,0o700);
const hostRoot=join(resolve(cfg.privateRoot),'installed-erp-host');
await mkdir(hostRoot,{recursive:true,mode:0o700});await chmod(hostRoot,0o700);
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
async function save(path,value){
 const temporary=path+'.'+randomBytes(8).toString('hex')+'.next';
 await writeFile(temporary,jsonBytes(value),{flag:'wx',mode:0o600});
 await rename(temporary,path);await chmod(path,0o600);
}
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
const owner={schema:'commons.woo-erp.installed-operation.v1',journeySha256:hash(cfgBytes),
 nativeSourceCommit:cfg.sourceCommit,siteUrl:cfg.siteUrl,
 orders:Object.fromEntries(['first','tax'].map(name=>[name,original[name].operationId]))};
const ownerPath=join(root,'owner.json');
if(await exists(ownerPath))need(same(await read(ownerPath),owner),'This receiving directory belongs to another original Woo operation.');
else await save(ownerPath,owner);

const credentials=await read(cfg.credentialsPath);
const operatorPath=join(resolve(cfg.privateRoot),'operator.json');
const operatorConfig=await read(operatorPath);
need(operatorConfig.siteUrl===cfg.siteUrl,'The original application-password client points to another Woo store.');
const environment={...process.env,[operatorConfig.usernameEnv]:credentials.adminUsername,
 [operatorConfig.applicationPasswordEnv]:credentials.applicationPassword,
 MCP_ACCESS_TOKEN:randomBytes(32).toString('base64url')};
const connectionPath=join(hostRoot,'woocommerce.json'),configPath=join(hostRoot,'merchant','merchant-mcp.json');
const inputs={};
for(const name of ['first','tax']){
 inputs[name+'_project']={label:name+' complete received ERP project',kind:'project',file:join(root,'received',name+'-project','project.json')};
 inputs[name+'_mapping']={label:name+' original mapping',kind:'mapping',file:join(root,'received',name+'-mapping','mapping.json')};
}
const connection={schema:'stellar-forge.woocommerce-connection.v1',stores:{shop:{
 label:'Original Woo ERP operating store',operator:operatorPath,erpInputs:inputs}}};
if(await exists(connectionPath))need(same(await read(connectionPath),connection),'The original Woo connection selection changed.');
else await save(connectionPath,connection);
if(!await exists(configPath)){
 const initialized=await initializeWooCommerceMerchant({directory:join(hostRoot,'merchant'),connection:connectionPath,
  name:'Original Woo ERP merchant receiving'});
 need(initialized.configuration===configPath,'The maintained initializer returned another original configuration.');
}
const distributionCli=join(sourceRoot,'stellar/scf-starforge-20261009/distribution/cli.mjs');
const events=[];let server,client;
async function event(action,value={}){
 events.push({at:new Date().toISOString(),action,...value});
 await save(join(root,'journey-'+phase+'.json'),events);
 process.stdout.write(JSON.stringify(events.at(-1))+'\n');
}
async function start(port=0){
 server=await startMerchantMcp({configPath,port,environment});
 client=await openWooErpClient({url:server.url+'/mcp',store:'shop',environment});
 need(server.operator.tools.filter(tool=>tool.name.startsWith('merchant_woo_erp_')).length===23,
  'The maintained Woo provider did not advertise all23 ERP tools.');
 return Number(new URL(server.url).port);
}
async function stop(){const running=server;server=null;client=null;if(running)await running.close();}
async function cli(command,args=[]){
 const {stdout}=await run(process.execPath,[distributionCli,'merchant-woo-erp',command,...args],{
  env:environment,cwd:sourceRoot,timeout:120000,maxBuffer:2*1024*1024});
 return JSON.parse(stdout);
}
async function receiverState(){
 const response=await fetch(cfg.receiverUrl+'/development/state',{
  headers:{'X-Development-Token':cfg.controlToken},signal:AbortSignal.timeout(10000)});
 need(response.ok,'The original selected ERP receiver did not return its operating state.');
 return response.json();
}
function selected(name,kind,id){return{kind,id,exportId:name+'-'+kind+'-received'};}
function recordOf(project){verifyErpProject(project);return project.operation;}
async function receiveFile(selection,directory,expectedManifestSha256,options={}){
 const result=await client.download({...selection,directory,expectedManifestSha256,...options});
 need(result.state==='COMPLETE','The original complete ERP file was not received.');
 return result;
}
async function collectProject(name,selection,manifestSha256,directory){
 const received=await inspectReceivedWooErp({directory,expectedManifestSha256:manifestSha256,store:'shop',...selection});
 const project=await read(received.file.path),record=recordOf(project);
 need(record.operationId===original[name].operationId&&record.orderId===original[name].orderId&&record.state==='RECEIVED',
  'The received project differs from the original accepted Woo ERP order.');
 const edition=record.editions.find(row=>row.id===record.currentEditionId);
 need(edition&&project.mappings.some(row=>row.id===edition.mapId),'The complete original source/mapping closure is missing.');
 return {name,selection,directory,manifestSha256,projectSha256:project.sha256,
  operationId:record.operationId,orderId:record.orderId,revision:record.revision,mapId:edition.mapId,
  sourceSha256:edition.sourceSha256,currentEditionId:record.currentEditionId,targetKey:record.target.key,
  lineLinks:record.target.lineLinks,editions:record.editions.length,attempts:record.attempts.length,
  decisions:record.decisions.length,fileSha256:received.file.sha256,fileBytes:received.file.bytes};
}
async function capture(){
 const completed=join(root,'capture.json');
 if(await exists(completed)){
  const retained=await read(completed);
  for(const item of retained.projects)await collectProject(item.name,item.selection,item.manifestSha256,item.directory);
  await event('Reopened the completed original agent capture',{projects:retained.projects.length});return;
 }
 const before=await receiverState(),port=await start();
 const listed=await client.call('inputs');
 need(listed.inputs.length===4,'The original mapping/project receiving handles are incomplete.');
 const {stdout}=await run(process.execPath,[distributionCli,'registrations','--source','woo-erp-operator'],{
  env:environment,cwd:sourceRoot,timeout:30000,maxBuffer:2*1024*1024});
 const registrations=JSON.parse(stdout);
 await save(join(root,'installed-registration.json'),registrations);
 const queue=await cli('orders',['--url',server.url+'/mcp','--store','shop','--limit','100']);
 need(queue.native.total===2,'The original installed queue does not contain exactly its two ERP orders.');
 const projects=[];
 for(const name of ['first','tax']){
  let view=await client.call('inspect',{operationId:original[name].operationId});
  need(view.native.state==='RECEIVED','Finish the original order receiving before capturing its project.');
  const page=await client.call('read',{operationId:view.native.operationId,pointer:'/editions',limit:1});
  if(page.value.nextOffset!==null)await client.call('read',{operationId:view.native.operationId,pointer:'/editions',
   limit:1,offset:page.value.nextOffset,expectedSnapshotSha256:page.value.snapshotSha256});
  const selection=selected(name,'project',view.native.operationId);
  const retained=await client.call('export',{...selection,expectedRevision:view.native.revision});
  const directory=join(root,'received',name+'-project');
  let download;
  if(name==='first'&&!await exists(join(directory,'manifest.json'))){
   let interrupted=false;
   try{
    await receiveFile(selection,directory,retained.manifestSha256,{chunkSize:1024,onProgress:async progress=>{
     if(progress.bytes<progress.total){interrupted=true;throw Object.assign(new Error('Original receiving interruption'),{code:'NATIVE_RECEIVING_INTERRUPTED'});}
    }});
   }catch(error){if(error.code!=='NATIVE_RECEIVING_INTERRUPTED')throw error;}
   need(interrupted,'The original project did not produce an interrupted complete-file receiving interval.');
   await stop();await start(port);
   download=await receiveFile(selection,directory,retained.manifestSha256,{chunkSize:4096});
   need(download.resumed&&download.resumedBytes>0&&download.resumedBytes<download.bytes,
    'The installed downloader did not resume the retained original file after MCP restart.');
   await event('Resumed the original complete project after merchant MCP restart',{
    operationId:view.native.operationId,resumedBytes:download.resumedBytes,bytes:download.bytes});
  }else download=await receiveFile(selection,directory,retained.manifestSha256,{chunkSize:4096});
  const item=await collectProject(name,selection,retained.manifestSha256,directory);
  const mapping=selected(name,'mapping',item.mapId);
  const mapRetained=await client.call('export',mapping);
  const mapDirectory=join(root,'received',name+'-mapping');
  await receiveFile(mapping,mapDirectory,mapRetained.manifestSha256,{chunkSize:4096});
  const mapReceived=await inspectReceivedWooErp({directory:mapDirectory,expectedManifestSha256:mapRetained.manifestSha256,
   store:'shop',...mapping});
  item.mapping={selection:mapping,directory:mapDirectory,manifestSha256:mapRetained.manifestSha256,
   fileSha256:mapReceived.file.sha256,fileBytes:mapReceived.file.bytes};
  const source=await client.call('input',{input:name+'_project',pointer:'/operation',limit:1});
  need(source.file.sha256===item.fileSha256&&source.nativeSha256===item.projectSha256,
   'The host receiving handle differs from the complete downloaded project.');
  const local=await cli('inspect-local',['--directory',directory,'--expected-manifest-sha256',item.manifestSha256]);
  need(local.native.sha256===item.projectSha256,'The installed CLI did not reopen the original native project digest.');
  projects.push(item);
  await event('Captured the full original ERP project and mapping through the installed merchant',{
   name,operationId:item.operationId,revision:item.revision,projectSha256:item.projectSha256,
   bytes:item.fileBytes,editions:item.editions,attempts:item.attempts});
 }
 const after=await receiverState();
 need(after.totals.putRequests===before.totals.putRequests,'Source receiving changed the original ERP write count.');
 const result={schema:'commons.woo-erp.installed-capture.v1',completedAt:new Date().toISOString(),
  operatorSourceCommit,nativeSourceCommit:cfg.sourceCommit,projects,erpPutRequests:after.totals.putRequests,
  targetDocuments:after.documents.length,tools:23,transport:'original merchant MCP HTTP',installedCommand:'merchant-woo-erp'};
 await save(completed,result);await event('Completed both original installed receiving captures',{projects:projects.length,erpPutRequests:result.erpPutRequests});
}
async function receive(){
 const captured=await read(join(root,'capture.json'));
 need(captured.schema==='commons.woo-erp.installed-capture.v1'&&captured.projects.length===2,
  'Finish both original capture projects before the native owner restores its Woo-only receiving snapshot.');
 const before=await receiverState();await start();
 const reopened=[];
 for(const item of captured.projects){
  await collectProject(item.name,item.selection,item.manifestSha256,item.directory);
  const source=await client.call('input',{input:item.name+'_project',pointer:'/operation',limit:1});
  let view=await client.call('import',{input:item.name+'_project',expectedSha256:source.file.sha256});
  need(view.native.operationId===item.operationId,'The original project import selected another ERP operation.');
  const mappingSource=await client.call('input',{input:item.name+'_mapping',limit:1});
  const status=await client.call('status',{limit:1});
  const mapping=await client.call('mapping-save',{input:item.name+'_mapping',expectedSha256:mappingSource.file.sha256,
   expectedCurrentMapId:status.native.currentMapId??''});
  need(mapping.native.mapId===item.mapId,'The original mapping selection changed during receiving.');
  view=await client.call('inspect',{operationId:item.operationId});
  if(view.native.imported===true)view=await client.call('bind-import',{operationId:item.operationId,
   expectedRevision:view.native.revision,reason:'Receiving engineer reviewed the complete downloaded project, original Woo order, mapping and installed ERP contract.'});
  if(view.native.state==='NEEDS_RECONCILIATION')view=await client.call('reconcile',{
   operationId:item.operationId,expectedRevision:view.native.revision});
  need(view.native.state==='RECEIVED','The original imported order did not complete native target reconciliation.');
  const selection={kind:'project',id:item.operationId,exportId:item.name+'-agent-reopened'};
  const exported=await client.call('export',{...selection,expectedRevision:view.native.revision});
  const destination=join(root,'reopened',item.name);
  await receiveFile(selection,destination,exported.manifestSha256,{chunkSize:4096});
  const received=await inspectReceivedWooErp({directory:destination,expectedManifestSha256:exported.manifestSha256,store:'shop',...selection});
  const project=await read(received.file.path),record=recordOf(project),edition=record.editions.find(row=>row.id===record.currentEditionId);
  need(same(record.target.key,item.targetKey)&&same(record.target.lineLinks,item.lineLinks),
   'Receiving changed an original ERP document or owned native line identity.');
  need(record.currentEditionId===item.currentEditionId&&edition.sourceSha256===item.sourceSha256&&
   record.editions.length===item.editions&&record.attempts.length===item.attempts,
   'Receiving replaced original source, edition or request history.');
  need(record.imports.some(entry=>entry.sha256===item.projectSha256),
   'The current native journal does not retain the complete downloaded project import.');
  reopened.push({name:item.name,operationId:item.operationId,orderId:record.orderId,state:record.state,
   revision:record.revision,targetKey:record.target.key,ownedLines:record.target.lineLinks.length,
   projectSha256:project.sha256,manifestSha256:exported.manifestSha256,
   importedProjectSha256:item.projectSha256,editions:record.editions.length,attempts:record.attempts.length});
  await event('Reopened the complete original project through native merchant receiving',reopened.at(-1));
 }
 const after=await receiverState();
 need(after.totals.putRequests===before.totals.putRequests&&after.documents.length===captured.targetDocuments,
  'Customer project receiving repeated an ERP PUT or changed its original document count.');
 await stop();await start();
 for(const item of reopened){const current=await client.call('inspect',{operationId:item.operationId});
  need(current.native.state==='RECEIVED'&&current.native.revision===item.revision,
   'Merchant restart did not reopen the same original received journal.');}
 const result={schema:'commons.woo-erp.installed-receiving.v1',state:'COMPLETE',completedAt:new Date().toISOString(),
  operatorSourceCommit,captureOperatorSourceCommit:captured.operatorSourceCommit,nativeSourceCommit:cfg.sourceCommit,
  projects:reopened,erpWritesBefore:before.totals.putRequests,erpWritesAfter:after.totals.putRequests,
  targetDocuments:after.documents.length,tools:23,merchantRestart:true,originalWooColdRestore:true,
  receiverKind:original.receiverKind};
 await save(join(root,'native-outcome.json'),result);
 await event('Completed original merchant-agent receiving and journal reopen',{projects:reopened.length,erpPutRequests:after.totals.putRequests});
}
try{if(phase==='capture')await capture();else await receive();}
catch(error){
 await save(join(root,'failure-'+phase+'.json'),{at:new Date().toISOString(),phase,operatorSourceCommit,
  error:{code:error.code??null,message:error.message,stack:error.stack},events});
 process.stderr.write(JSON.stringify({phase,error:error.message,code:error.code??null})+'\n');process.exitCode=1;
}finally{await stop();}
