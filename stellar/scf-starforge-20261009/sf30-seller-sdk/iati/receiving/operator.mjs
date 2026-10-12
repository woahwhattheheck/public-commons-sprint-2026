// MIT. One actual installed IATI Applications/client/MCP/browser receiving stage.
// The caller owns the admitted native operation and closes its core workspace first.
import { constants } from 'node:fs';
import { mkdir, open, readFile, lstat, realpath, rename, readdir } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { openInstalledIatiPage, receiveIatiBrowser, inspectReceivedIatiBrowser } from './browser.mjs';

const SCHEMA='stellar-forge.iati-operator-receiving.v1';
const ROOT='stellar/scf-starforge-20261009/';
const SDK=ROOT+'sf30-seller-sdk/';
const OPERATOR='stellar-forge/mcp-merchant-operator/';
const SHA=/^[0-9a-f]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):plain(value)?
 Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const encode=value=>Buffer.from(JSON.stringify(canonical(value),null,2)+'\n');
const hash=value=>createHash('sha256').update(value).digest('hex');
const same=(left,right)=>encode(left).equals(encode(right));
const check=(value,message)=>{if(!value)throw Object.assign(new Error(message),{code:'IATI_RECEIVING_ASSERTION'});};
const uuid=value=>{const x=hash(value);return x.slice(0,8)+'-'+x.slice(8,12)+'-4'+x.slice(13,16)+'-a'+x.slice(17,20)+'-'+x.slice(20,32);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const errorValue=error=>({code:error.code??'IATI_RECEIVING_ERROR',message:String(error.message??error).slice(0,3000)});
const CRITICAL=[
 ...['iati_source.py','iati_workspace.py','cli.py','cli.mjs','managed.py','server.py','client.mjs','client.d.mts',
  'public/index.html','public/app.js','public/style.css'].map(name=>SDK+'iati/'+name),
 ...['xml_source.py','workspace.py','server.py','native.mjs'].map(name=>SDK+'xml/'+name),
 SDK+'dataset-handler.mjs',
 ROOT+'distribution/contributions/iati.json',
 ROOT+'distribution/runtime-workspace/application-iati.mjs',
 ROOT+'distribution/runtime-workspace/providers/iati.mjs',
 ROOT+'distribution/runtime-workspace/model.mjs',
 ROOT+'distribution/runtime-workspace/server.mjs',
 ROOT+'distribution/runtime-workspace/applications.mjs',
 ROOT+'distribution/runtime-workspace/managed-workspace.mjs',
 ROOT+'distribution/runtime-workspace/application-provider.mjs',
 ROOT+'distribution/runtime-install.mjs',
 ROOT+'sf46-release/runtime-package.mjs',
 ROOT+'merchant-fleet-gateway/state-lease.mjs',
 OPERATOR+'source-workspace.mjs',OPERATOR+'catalog/source-workspace.mjs',
 OPERATOR+'retained-file-reads.mjs',OPERATOR+'retained-file-contracts.mjs',
 'stellar-forge/mcp-paid-agent/http-tools.mjs',ROOT+'sf33-failure-contract/contract.mjs'
];
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function json(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function privateDirectory(path){
 check(isAbsolute(path)&&resolve(path)===path&&path!=='/','Select a canonical private directory.');
 await mkdir(path,{recursive:true,mode:0o700});
 const info=await lstat(path);
 check(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid())&&
  await realpath(path)===path,'The receiver requires its original owned private directory without aliases.');
}
async function syncDirectory(path){const h=await open(path,constants.O_RDONLY);try{await h.sync();}finally{await h.close();}}
async function publish(path,data,immutable=false){
 data=Buffer.isBuffer(data)?data:encode(data);
 if(immutable&&await exists(path)){check((await readFile(path)).equals(data),'A retained immutable receiving selection changed.');return;}
 const temporary=join(dirname(path),'.iati-receiving-'+randomUUID()+'.partial');
 const handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
 check((await readFile(temporary)).equals(data),'A complete staged receiving record changed.');
 // The complete callback holds the original kernel lease. Rename avoids an
 // interrupted extra hard link on private connection files requiring nlink=1.
 await rename(temporary,path);await syncDirectory(dirname(path));
}
async function identity(path){
 const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{
  const before=await handle.stat({bigint:true});check(before.isFile(),'Select a complete regular original file.');
  const sha=createHash('sha256'),git=createHash('sha1').update(Buffer.from('blob '+before.size+'\0'));
  let bytes=0;
  for await(const chunk of handle.createReadStream({autoClose:false})){sha.update(chunk);git.update(chunk);bytes+=chunk.length;}
  const after=await handle.stat({bigint:true});
  check(BigInt(bytes)===before.size&&['dev','ino','size','mtimeNs','ctimeNs'].every(key=>before[key]===after[key]),
   'An original file changed while its complete bytes were retained.');
  return{bytes,sha256:sha.digest('hex'),gitBlob:git.digest('hex')};
 }finally{await handle.close();}
}
async function boundedJson(response,maximum=64*1024*1024){
 let bytes=0;const chunks=[];
 for await(const chunk of response.body??[]){bytes+=chunk.length;check(bytes<=maximum,'The original JSON response exceeds its full metadata boundary.');chunks.push(chunk);}
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
 if(!response.ok)throw Object.assign(new Error(value.message??value.error??'Original HTTP operation failed.'),{code:value.error??'IATI_HTTP',status:response.status});
 return value;
}
function validateExpected(expected){
 check(plain(expected)&&SHA.test(expected.portfolioId??'')&&SHA.test(expected.definitionSha256??'')&&
  Number.isSafeInteger(expected.revision)&&expected.revision>0,'Pass the full original portfolio/revision/definition identity.');
 check(plain(expected.counts)&&Array.isArray(expected.financialGroups),'Pass the core-created original counts and exact financial groups.');
 for(const group of expected.financialGroups){
  check(plain(group)&&typeof group.amount==='string'&&typeof group.currency==='string'&&
   typeof group.reportingOrgRef==='string'&&typeof group.hierarchy==='string',
   'Keep reported decimal strings and all original financial dimensions.');
 }
 if(expected.comparison)check(plain(expected.comparison)&&SHA.test(expected.comparison.id??'')&&
  Number.isSafeInteger(expected.comparison.beforeRevision)&&Number.isSafeInteger(expected.comparison.afterRevision),
  'Pass the complete retained portfolio-comparison identity and revisions.');
}
function verifyPortfolio(value,expected){
 check(value.id===expected.portfolioId&&value.revision===expected.revision&&value.definitionSha256===expected.definitionSha256,
  'The actual original portfolio selection changed.');
 check(same(value.report.counts,expected.counts)&&same(value.report.financialGroups,expected.financialGroups),
  'The original portfolio report differs from the core-observed financial groups.');
 return value;
}
function verifyReport(value,portfolio){
 check(value.portfolio===portfolio.id&&value.revision===portfolio.revision&&value.definitionSha256===portfolio.definitionSha256&&
  same(value.counts,portfolio.report.counts)&&same(value.financialGroups,portfolio.report.financialGroups),
  'The complete report changed source coverage or exact reported values.');
 return value;
}
const runtimeBinding=value=>Object.fromEntries(['installationId','profileId','profileSha256','lockSha256',
 'sourceCommit','sourceManifestSha256','directory','sourceRoot','dependencyCount'].map(key=>[key,value[key]]));
async function until(read,accept,message,{timeoutMs=240000}={}){
 const deadline=Date.now()+timeoutMs;let value;
 do{value=await read();if(await accept(value))return value;await pause(750);}while(Date.now()<deadline);
 throw Object.assign(new Error(message),{code:'IATI_RECEIVING_WAIT',last:value});
}

/**
 * sourceRoot is the complete selected repository source. runtimeDirectory is a
 * REAL READY original installation containing those exact production modules.
 * Existing source and native records are never copied into this procedure.
 */
export async function runIatiOperatorReceiving({
 directory,outputDirectory,sourceRoot,runtimeDirectory,operationId,actor,expected,
 pythonExecutable,chromiumExecutable,playwrightModule
}={}){
 process.umask(0o077);validateExpected(expected);
 check(typeof operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,139}$/.test(operationId),'Retain one original receiving operation ID.');
 check(plain(actor)&&typeof actor.id==='string'&&actor.id.length>0&&actor.id.length<=160&&
  typeof actor.label==='string'&&actor.label.trim()&&actor.label.length<=160,'Pass the actual named receiving operator.');
 for(const path of [directory,outputDirectory,sourceRoot,runtimeDirectory,pythonExecutable,chromiumExecutable,playwrightModule])
  check(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'Pass complete original runtime and private directory paths.');
 check(await realpath(directory)===directory&&await realpath(sourceRoot)===sourceRoot&&
  outputDirectory!==directory&&!outputDirectory.startsWith(directory+'/')&&!directory.startsWith(outputDirectory+'/'),
  'Keep the receiver beside the original closed source workspace.');
 await privateDirectory(outputDirectory);
 const original=path=>import(pathToFileURL(join(sourceRoot,path)).href);
 const {acquireStateLease}=await original(ROOT+'merchant-fleet-gateway/state-lease.mjs');
 const lease=await acquireStateLease(outputDirectory);
 let appsServer,appApi,browser,mcp,sourceClient,receivedClient,appsModel;
 const contexts=new Set(),activeApplications=new Map();
 let progress,selection,result,failure;
 const progressPath=join(outputDirectory,'progress.json');
 const save=async()=>{lease.assertHeld();progress.updatedAt=new Date().toISOString();await publish(progressPath,progress);};
 const stage=async(name,value)=>{progress.stages[name]=value;await save();};
 const endpointDocument=async(name,url)=>publish(join(outputDirectory,'connections',name+'.txt'),Buffer.from(url+'\n'));
 try{
  const {inspectMerchantRuntime}=await original(ROOT+'sf46-release/runtime-package.mjs');
  const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
  check(runtime.state==='READY'&&runtime.dependencyCount===0,'Use the original READY zero-dependency operator runtime for this complete receiving.');
  const installedRoot=await realpath(runtime.sourceRoot),installed=path=>import(pathToFileURL(join(installedRoot,path)).href);
  const source=[];
  for(const path of CRITICAL){
   const selected=await identity(join(sourceRoot,path)),actual=await identity(join(installedRoot,path));
   check(same(selected,actual),'The installed runtime does not contain the selected original '+path);
   source.push({path,...actual});
  }
  const marker=await identity(join(directory,'workspace.json')),info=await lstat(directory,{bigint:true});
  const header=await json(join(directory,'workspace.json'));
  check(header?.schema==='stellar-forge.iati-workspace.v1','The caller must close the original IATI workspace before operator receiving.');
  const callback=await identity(fileURLToPath(import.meta.url)),browserSource=await identity(fileURLToPath(new URL('./browser.mjs',import.meta.url)));
  selection={schema:SCHEMA,operationId,actor,directory,outputDirectory,sourceRoot,runtime:runtimeBinding(runtime),
   expected,workspace:{marker,device:String(info.dev),inode:String(info.ino)},
   source,callback,browserSource,execution:{node:process.execPath,nodeVersion:process.versions.node,
    pythonExecutable,chromiumExecutable,playwrightModule}};
  await publish(join(outputDirectory,'selection.json'),selection,true);
  progress=await json(progressPath)??{schema:SCHEMA,operationId,createdAt:new Date().toISOString(),stages:{},applications:{},downloads:{}};
  for(const name of ['connections','mcp','downloads','cli','views','temporary','attempts'])await privateDirectory(join(outputDirectory,name));
  const prior=await json(join(outputDirectory,'result.json'));
  if(prior){
   check(prior.state==='COMPLETE'&&same(prior.selectionSha256,hash(encode(selection))),'The completed receiver has a different original selection.');
   for(const file of prior.files)check((await identity(file.path)).sha256===file.sha256,'An original completed returned file changed.');
   return{...prior,reused:true};
  }
  const {createRuntimeWorkspace,openRuntimeWorkspace}=await installed(ROOT+'distribution/runtime-workspace/model.mjs');
  const applicationsDirectory=join(outputDirectory,'applications');
  if(!await json(join(applicationsDirectory,'workspace.json'))){
   if(await exists(applicationsDirectory))await rename(applicationsDirectory,join(outputDirectory,'attempts','unpublished-applications-'+randomUUID()));
   await createRuntimeWorkspace({directory:applicationsDirectory});
  }
  appsModel=await openRuntimeWorkspace({directory:applicationsDirectory});
  const {startRuntimeWorkspace}=await installed(ROOT+'distribution/runtime-workspace/server.mjs');
  appsServer=await startRuntimeWorkspace({directory:applicationsDirectory,port:0});
  const appsUrl=new URL(appsServer.url),appsToken=appsUrl.hash.slice(1);
  appApi=async(path,value)=>{
   const response=await fetch(appsUrl.origin+path,{method:value===undefined?'GET':'POST',redirect:'error',
    signal:AbortSignal.timeout(240000),headers:{'x-runtime-workspace-token':appsToken,
     ...(value===undefined?{}:{origin:appsUrl.origin,'content-type':'application/json'})},
    ...(value===undefined?{}:{body:JSON.stringify(value)})});
   return boundedJson(response);
  };
  const unauthenticated=await fetch(appsUrl.origin+'/api/applications/state');
  check(unauthenticated.status===401,'Applications must retain its original authenticated operating boundary.');await unauthenticated.body?.cancel();
  const attached=await appApi('/api/attach',{directory:runtimeDirectory,label:'Selected IATI source runtime'});
  check(attached.status==='READY','The actual original Applications runtime is not READY.');
  await stage('installedRuntime',{...runtimeBinding(runtime),runtimeId:attached.runtimeId,sourceFiles:source.length,applicationsDirectory});
  const {connectIatiWorkspace}=await installed(SDK+'iati/client.mjs');
  const playwrightLoaded=await import(pathToFileURL(await realpath(playwrightModule)).href);
  const playwright=playwrightLoaded.chromium?playwrightLoaded:playwrightLoaded.default;
  check(playwright?.chromium&&typeof playwright.chromium.launch==='function','Use the existing actual Playwright installation.');
  browser=await playwright.chromium.launch({executablePath:chromiumExecutable,headless:true,
   downloadsPath:join(outputDirectory,'temporary'),args:['--disable-dev-shm-usage']});
  const appState=async id=>(await appApi('/api/applications/state?historyLimit=30')).applications.find(item=>item.id===id);
  async function setupApplication(name,workspace){
   let owned=progress.applications[name];
   if(!owned){
    owned={name,workspace,label:actor.label.slice(0,80)+' · '+(name==='source'?'Original IATI portfolio':'Received IATI portfolio'),
     saveRequestId:uuid(operationId+':application:'+name),runs:[]};
    progress.applications[name]=owned;await save();
   }
   if(!owned.reviewId){
    const reviewed=await appApi('/api/applications/review',{runtimeId:attached.runtimeId,kind:'iati',label:owned.label,
     settings:{workspaceDirectory:workspace,pythonExecutable,port:0}});
    owned.reviewId=reviewed.id;await save();
   }
   if(!owned.id){
    const saved=await appApi('/api/applications/save',{requestId:owned.saveRequestId,reviewId:owned.reviewId});
    owned.id=saved.applicationId;owned.revision=saved.revision;owned.connection=saved.connection;await save();
   }
   let connected=await appState(owned.id);
   if(!connected?.release)await appApi('/api/applications/connect',{applicationId:owned.id});
   connected=await until(()=>appState(owned.id),value=>{
    check(value&&!value.error,'The original Applications entry is unavailable.');
    if(value.adoption?.phase==='FAILED'&&!value.adoption.active)throw Object.assign(new Error(value.adoption.state?.error?.message??'Original runtime adoption failed.'),{code:'IATI_RECEIVING_ADOPTION'});
    return Boolean(value.release);
   },'The original full managed-runtime adoption did not finish.');
   owned.release=connected.release;await save();return owned;
  }
  async function startApplication(owned){
   let current=await appState(owned.id);
   if(current.current&&!current.current.active&&['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(current.current.phase)){
    await appApi('/api/applications/recover',{applicationId:owned.id,operationId:current.current.id});
    current=await appState(owned.id);
   }
   if(!current.current?.active&&!['PENDING','QUEUED','RUNNING'].includes(current.current?.phase)){
    let attempt=owned.runs.at(-1);
    if(!attempt||attempt.dispatched||attempt.finished){
     attempt={requestId:uuid(operationId+':run:'+owned.name+':'+owned.runs.length),createdAt:new Date().toISOString()};
     owned.runs.push(attempt);await save();
    }
    if(!attempt.reviewId){const reviewed=await appApi('/api/applications/start-review',{applicationId:owned.id});attempt.reviewId=reviewed.id;await save();}
    const started=await appApi('/api/applications/start',{applicationId:owned.id,requestId:attempt.requestId,reviewId:attempt.reviewId});
    attempt.dispatched=true;attempt.operationId=started.operationId;await save();
   }
   current=await until(()=>appState(owned.id),value=>{
    check(value&&!value.error,'The saved original Applications entry became unavailable.');
    if(value.current&&!value.current.active&&['FAILED','SUCCEEDED','CANCELLED'].includes(value.current.phase))
     throw Object.assign(new Error('The original IATI command ended before its verified startup.'),{code:'IATI_RECEIVING_START',original:value.current});
    return value.phase==='RUNNING'&&value.current?.active&&typeof value.current.privateUrl==='string';
   },'The original managed IATI command produced no verified startup.');
   activeApplications.set(owned.id,current.current.id);
   const launched=current.current.url?.original;
   check(launched?.schema==='stellar-forge.iati-workspace-launch.v1'&&launched.workspace===owned.workspace,
    'The Applications observer must verify the exact original workspace before Open.');
   await endpointDocument(owned.name,current.current.privateUrl);
   const client=await connectIatiWorkspace({consoleUrlFile:join(outputDirectory,'connections',owned.name+'.txt')});
   const actual=await client.launch();
   check(actual.bindingSha256===launched.bindingSha256&&actual.workspace===owned.workspace&&actual.pid===launched.pid,
    'The authenticated original launch differs from the actual Applications observation.');
   owned.current={operationId:current.current.id,origin:client.origin,bindingSha256:launched.bindingSha256,pid:launched.pid};
   await save();
   return{client,url:current.current.privateUrl,owned};
  }
  async function stopApplication(owned){
   let current=await appState(owned.id);
   if(current.current&&(current.current.active||['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(current.current.phase))){
    await appApi('/api/applications/stop',{applicationId:owned.id,operationId:current.current.id});
    current=await until(()=>appState(owned.id),value=>!value.current?.active&&
     !['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(value.current?.phase),'The original IATI command has not completed its Stop.',{timeoutMs:90000});
   }
   activeApplications.delete(owned.id);
   if(owned.runs.at(-1)){owned.runs.at(-1).finished=true;owned.runs.at(-1).terminal=current.current?.phase??null;}
   owned.stopped=current.current?{operationId:current.current.id,phase:current.current.phase,result:current.current.result}:null;
   await save();
   const output=current.current?await appApi('/api/applications/output?'+new URLSearchParams({applicationId:owned.id,operationId:current.current.id})):null;
   if(output)await publish(join(outputDirectory,'applications-'+owned.name+'-'+current.current.id+'.json'),output);
   return owned.stopped;
  }
  async function runCli(name,workspace,args,{repeat=false}={}){
   const folder=join(outputDirectory,'cli',name);await privateDirectory(folder);
   const request={node:process.execPath,args:[join(installedRoot,SDK+'iati/cli.mjs'),'--python',pythonExecutable,'--workspace',workspace,...args]};
   await publish(join(folder,'request.json'),request,true);
   const done=await json(join(folder,'result.json'));
   if(done&&!repeat){check(done.exitCode===0,'A retained original CLI command failed.');return JSON.parse(await readFile(done.stdout,'utf8'));}
   const attempt=(await readdir(folder)).filter(file=>/^stdout-\d+\.json$/.test(file)).length;
   const stdout=join(folder,'stdout-'+attempt+'.json'),stderr=join(folder,'stderr-'+attempt+'.log');
   const out=await open(stdout,'wx',0o600),err=await open(stderr,'wx',0o600);let child;
   try{
    child=spawn(request.node,request.args,{shell:false,cwd:outputDirectory,
     env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',SF30_XML_NODE:process.execPath},stdio:['ignore',out.fd,err.fd]});
    const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
    await out.sync();await err.sync();
    const receipt={...request,stdout,stderr,exitCode:exit.code,signal:exit.signal,endedAt:new Date().toISOString(),
     stdoutFile:await identity(stdout),stderrFile:await identity(stderr)};
    await publish(join(folder,'attempt-'+attempt+'.json'),receipt);
    check(exit.code===0,'Original IATI CLI failed; its exact stderr is retained at '+stderr);
    await publish(join(folder,'result.json'),receipt);
    return JSON.parse(await readFile(stdout,'utf8'));
   }finally{await out.close();await err.close();}
  }
  const {MerchantSourceWorkspaces,readSourceWorkspaceConfiguration}=await installed(OPERATOR+'source-workspace.mjs');
  const {sourceWorkspaceTools}=await installed(OPERATOR+'catalog/source-workspace.mjs');
  const {createMcpToolHandler,MCP_VERSION}=await installed('stellar-forge/mcp-paid-agent/http-tools.mjs');
  const tools=sourceWorkspaceTools((name,description,properties,required,flags={})=>({
   name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
   annotations:{readOnlyHint:flags.readOnly===true,idempotentHint:flags.idempotent===true}
  }));
  async function startMcp(){
   const configFile=join(outputDirectory,'mcp','connections.json');
   await publish(configFile,{schema:'stellar-forge.source-workspace-connection.v1',workspaces:{
    source:{format:'iati',label:actor.label.slice(0,120)+' / original portfolio',consoleUrlFile:join(outputDirectory,'connections','source.txt')},
    received:{format:'iati',label:actor.label.slice(0,120)+' / received portfolio',consoleUrlFile:join(outputDirectory,'connections','received.txt')}
   }},true);
   const sourceWorkspaces=await readSourceWorkspaceConfiguration(configFile);
   const adapter=new MerchantSourceWorkspaces({sourceWorkspaces,exportsDirectory:join(outputDirectory,'mcp')});
   const token=randomBytes(32).toString('hex'),requests=new Set(),sockets=new Set();
   let closing=false;
   const handler=createMcpToolHandler({tools,call:(name,args)=>adapter.call(name,args)},{
    bearerToken:token,serverName:'Original IATI source receiving',serverVersion:'1.0.0',
    instructions:'Read and operate the declared original IATI consoles. The named operator and source selection are retained by the receiving owner.'
   });
   const server=createServer((request,response)=>{
    if(closing){response.writeHead(503);response.end();return;}
    const pending=handler(request,response).catch(error=>{if(!response.headersSent)response.writeHead(500);response.end();});
    requests.add(pending);pending.finally(()=>requests.delete(pending));
   });
   server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
   server.requestTimeout=240000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   const endpoint='http://127.0.0.1:'+server.address().port+'/mcp';
   let next=0;
   const rpc=async(method,params)=>{
    const id=++next;
    const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(240000),
     headers:{authorization:'Bearer '+token,'content-type':'application/json',
      accept:'application/json, text/event-stream','mcp-protocol-version':MCP_VERSION},
     body:JSON.stringify({jsonrpc:'2.0',id,method,...(params===undefined?{}:{params})})});
    const envelope=await boundedJson(response);
    check(envelope.id===id&&!envelope.error,'The original MCP response envelope was rejected.');
    if(envelope.result?.isError)throw Object.assign(new Error(envelope.result.structuredContent?.reason??'Original source MCP call failed.'),
     {code:envelope.result.structuredContent?.code??'IATI_MCP'});
    return envelope.result;
   };
   await rpc('initialize',{protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{name:actor.label,version:'1.0.0'}});
   const catalog=(await rpc('tools/list')).tools;
   check(['merchant_source_iati_report','merchant_source_iati_compare','merchant_source_file_read'].every(name=>catalog.some(tool=>tool.name===name)),
    'The actual original MCP catalog omitted the IATI operating tools.');
   const missing=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
   check(missing.status===401,'The actual source MCP endpoint must require the original bearer token.');await missing.body?.cancel();
   return{adapter,endpoint,call:async(name,args={})=>(await rpc('tools/call',{name,arguments:args})).structuredContent,
    async close(){
     if(closing)return;closing=true;
     const closed=new Promise(resolve=>server.close(resolve));server.closeIdleConnections();
     await Promise.allSettled([...requests]);await adapter.close();
     for(const socket of sockets)socket.destroy();await closed;
    }};
  }
  async function retainedExport(kind,portfolio){
   if(progress.downloads[kind]?.metadata)return progress.downloads[kind].metadata;
   const inventory=(await mcp.call('merchant_source_exports',{workspace:'source',limit:250})).native;
   const existing=inventory.items.find(item=>item.kind===kind&&item.portfolio===portfolio.id&&item.revision===portfolio.revision);
   const value=existing??await mcp.call('merchant_source_export',{workspace:'source',kind,portfolio:portfolio.id,revision:portfolio.revision});
   check(value.sha256===value.exportId&&value.kind===kind&&value.portfolio===portfolio.id&&value.revision===portfolio.revision,
    'The original export lost its complete selected portfolio identity.');
   progress.downloads[kind]={metadata:value,offset:0};await save();return value;
  }
  async function downloadMcp(kind,metadata,{interrupt=false}={}){
   const path=join(outputDirectory,'downloads','mcp-'+kind+'.zip'),partial=path+'.partial';
   let selected=progress.downloads[kind];
   if(await exists(path)){
    const saved=await identity(path);check(saved.sha256===metadata.sha256&&saved.bytes===metadata.bytes,'A completed original archive changed.');
    selected.file={path,...saved};await save();return selected.file;
   }
   const handle=await open(partial,(await exists(partial)?'r+':'wx+'),0o600);
   let readId=null;
   try{
    let offset=selected.offset??0;
    const size=(await handle.stat()).size;check(size>=offset,'The retained download is shorter than its committed offset.');
    if(size>offset)await handle.truncate(offset);
    while(offset<metadata.bytes){
     const chunk=await mcp.call('merchant_source_file_read',{workspace:'source',exportId:metadata.exportId,
      ...(readId?{readId}:{}),offset,limit:interrupt&&!selected.interrupted?Math.min(16384,Math.max(1,Math.floor(metadata.bytes/2))):196608});
     check(chunk.file.sha256===metadata.sha256&&chunk.file.bytes===metadata.bytes&&chunk.offset===offset&&chunk.encoding==='base64',
      'The original retained file reader changed its source binding.');
     const bytes=Buffer.from(chunk.data,'base64');
     check(bytes.length===chunk.bytesRead&&bytes.length>0&&offset+bytes.length<=metadata.bytes,'The original file range is incomplete.');
     let written=0;
     while(written<bytes.length){const result=await handle.write(bytes,written,bytes.length-written,offset+written);
      check(result.bytesWritten>0,'The retained native file range could not be written.');written+=result.bytesWritten;}
     await handle.sync();offset+=bytes.length;selected.offset=offset;readId=chunk.nextOffset===null?null:chunk.readId;await save();
     if(interrupt&&!selected.interrupted&&offset<metadata.bytes){
      if(readId)await mcp.call('merchant_source_file_release',{workspace:'source',readId});
      await mcp.close();mcp=null;selected.interrupted={offset,at:new Date().toISOString()};await save();
      mcp=await startMcp();readId=null;
     }
    }
   }finally{
    await handle.close();
    if(readId&&mcp)await mcp.call('merchant_source_file_release',{workspace:'source',readId}).catch(()=>{});
   }
   const complete=await identity(partial);check(complete.bytes===metadata.bytes&&complete.sha256===metadata.sha256,'The full returned archive differs from the original selected SHA256.');
   await rename(partial,path);await syncDirectory(dirname(path));
   selected.file={path,...complete};await save();return selected.file;
  }
  async function saveResponse(name,response){
   const destination=join(outputDirectory,'downloads',name),temporary=destination+'.partial';
   if(await exists(temporary))await rename(temporary,temporary+'.interrupted-'+randomUUID());
   const handle=await open(temporary,'wx',0o600);let bytes=0;
   const length=response.headers.get('content-length'),declared=length&&/^\d+$/.test(length)?Number(length):null;
   try{
    for await(const chunk of response.body??[]){bytes+=chunk.length;check(bytes<=4*1024*1024*1024,'The original archive exceeds its native limit.');await handle.writeFile(chunk);}
    await handle.sync();
   }finally{await handle.close();}
   check(declared===null||declared===bytes,'The authenticated native download ended before its declared byte count.');
   if(await exists(destination))await rename(destination,destination+'.previous-'+randomUUID());
   await rename(temporary,destination);await syncDirectory(dirname(destination));
   return{path:destination,...await identity(destination)};
  }

  // Reconcile this callback's own retained Applications after a prior interrupted
  // parent invocation. Stop through the original controller before either source
  // workspace is borrowed again; never alter its process or request records.
  for(const owned of Object.values(progress.applications)){
   if(!owned.id)continue;
   const current=await appState(owned.id);
   if(current?.current&&(current.current.active||['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(current.current.phase)))
    await stopApplication(owned);
  }

  const sourceOwned=await setupApplication('source',directory),sourceOpened=await startApplication(sourceOwned);
  sourceClient=sourceOpened.client;
  const portfolio=verifyPortfolio(await sourceClient.portfolio(expected.portfolioId,{revision:expected.revision}),expected);
  const report=verifyReport(await sourceClient.report(portfolio.id,{revision:portfolio.revision}),portfolio);
  const presets=await sourceClient.presets();
  check(presets.standard==='2.03'&&presets.currencyCatalog.codes.length===176&&presets.currencyCatalog.withdrawn.length===9,
   'The installed native IATI codelist snapshot is incomplete.');
  const nativeState=await sourceClient.state();
  const queryBuild=nativeState.builds.find(build=>portfolio.editions.some(entry=>entry.transactions.id===build.id)&&build.rowCount>0)??
   nativeState.builds.find(build=>portfolio.editions.some(entry=>entry.activities.id===build.id)&&build.rowCount>0);
  check(queryBuild,'The real core-created public portfolio has no native row to receive.');
  await stage('sourceIdentity',{portfolio:portfolio.id,revision:portfolio.revision,definitionSha256:portfolio.definitionSha256,
   counts:report.counts,financialGroups:report.financialGroups,currencyCatalog:presets.currencyCatalog,queryBuild:queryBuild.id});
  mcp=await startMcp();
  const mcpPortfolio=(await mcp.call('merchant_source_iati_portfolio',{workspace:'source',portfolio:portfolio.id,revision:portfolio.revision})).native;
  check(same(mcpPortfolio,portfolio),'MCP returned a different original selected portfolio.');
  const mcpQuery=(await mcp.call('merchant_source_query',{workspace:'source',build:queryBuild.id,query:{limit:'2'}})).native;
  check(same(mcpQuery.response.body,(await sourceClient.query(queryBuild.id,{limit:'2'})).response.body),
   'The authenticated MCP and native client do not share the same actual dataset.');

  let browserResult=progress.stages.browser;
  if(browserResult){
   check(same(await sourceClient.portfolio(browserResult.reviewed.id,{revision:browserResult.reviewed.revision}),browserResult.reviewed),
    'The completed browser selection changed before continuation.');
   for(const file of[browserResult.receipt.reportDownload,browserResult.receipt.portfolioDownload])
    check((await identity(file.path)).sha256===file.sha256,'A completed original browser download changed.');
  }else{
   const sourcePage=await openInstalledIatiPage({browser,applicationsUrl:appsServer.url,applicationLabel:sourceOwned.label,
   consoleUrl:sourceOpened.url,outputDirectory:join(outputDirectory,'views'),name:'source'});
  contexts.add(sourcePage.context);
  const compared=expected.comparison??{beforeRevision:portfolio.revision,afterRevision:portfolio.revision+1};
   browserResult=await receiveIatiBrowser({page:sourcePage.page,receipt:sourcePage.receipt,client:sourceClient,
   portfolio,report,queryBuild,actor,comparisonDefinition:compared,outputDirectory:join(outputDirectory,'views'),name:'source',
   retainedReview:progress.reviewInput,persistReview:async value=>{progress.reviewInput=value;await save();},
   recordDownload:async(kind,download)=>{
    const file=join(outputDirectory,'downloads','browser-'+kind+'-'+randomUUID()+'.zip');
    await download.saveAs(file);const value={path:file,...await identity(file)};
    const failure=await download.failure();check(!failure,'The complete native browser archive failed: '+failure);return value;
   }});
   await stage('browser',browserResult);
   await sourcePage.context.close();contexts.delete(sourcePage.context);
  }
  const reviewed=browserResult.reviewed,reviewedReport=browserResult.report;
  const mcpReport=(await mcp.call('merchant_source_iati_report',{workspace:'source',portfolio:reviewed.id,revision:reviewed.revision})).native;
  check(same(mcpReport,reviewedReport),'The reviewed report changed through the original MCP route.');
  const directReport=await saveResponse('client-report.zip',await sourceClient.export('report',reviewed.id,{revision:reviewed.revision}));
  await stage('directReport',directReport);
  const reportExport=await retainedExport('report',reviewed);
  const reportFile=await downloadMcp('report',reportExport);
  const packetExport=await retainedExport('portfolio',reviewed);
  const packetFile=await downloadMcp('portfolio',packetExport,{interrupt:true});
  await stage('fullFiles',{report:reportFile,portfolio:packetFile,interruption:progress.downloads.portfolio.interrupted??null,
   note:progress.downloads.portfolio.interrupted?'Original MCP reader closed after a saved range; resumed the same retained SHA256 with a fresh descriptor.':
    'The complete original file fit one native range; no extra interruption is claimed.'});
  await sourceClient.dispose();sourceClient=null;
  const sourceStop=await stopApplication(sourceOwned);await stage('sourceStop',sourceStop);

  // Every following original CLI acquires the same closed source serially.
  const closedReport=await runCli('source-report',directory,['report','--id',reviewed.id,'--revision',String(reviewed.revision)]);
  verifyReport(closedReport,reviewed);
  const replayFile=join(outputDirectory,'review-request.json');await publish(replayFile,progress.reviewInput,true);
  const replayed=await runCli('source-review-replay',directory,['portfolio-save','--file',replayFile]);
  check(same(replayed,reviewed),'The original reviewed request did not replay after the owning application closed.');
  const cliPacket=join(outputDirectory,'downloads','cli-portfolio.zip');
  const firstExport=await runCli('source-portfolio-export',directory,['portfolio-export','--id',reviewed.id,'--revision',String(reviewed.revision),'--out',cliPacket]);
  const repeatedExport=await runCli('source-portfolio-export',directory,['portfolio-export','--id',reviewed.id,'--revision',String(reviewed.revision),'--out',cliPacket],{repeat:true});
  check(firstExport.sha256===repeatedExport.sha256&&firstExport.bytes===repeatedExport.bytes&&repeatedExport.reused===true,
   'The original atomic full export did not reopen its same complete destination.');
  await stage('cli',{reviewReplay:{id:replayed.id,revision:replayed.revision},export:firstExport,repeatedExport});

  const receivedDirectory=join(outputDirectory,'received-workspace');
  if(!await json(join(receivedDirectory,'workspace.json'))){
   if(await exists(receivedDirectory))await rename(receivedDirectory,join(outputDirectory,'attempts','unpublished-recipient-'+randomUUID()));
   await runCli('recipient-init',receivedDirectory,['init']);
  }
  const receivedOwned=await setupApplication('received',receivedDirectory),receivedOpened=await startApplication(receivedOwned);
  receivedClient=receivedOpened.client;
  const input=await open(packetFile.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  let received;
  try{received=await receivedClient.receive({body:input.createReadStream({autoClose:false,start:0}),bytes:packetFile.bytes,kind:'portfolio'});}
  finally{await input.close();}
  check(received.reconstructed===true&&same(received.portfolio,reviewed)&&Array.isArray(received.receivingBuilds),
   'The complete actual packet did not reconstruct the original portfolio and separate native receiving identities.');
  const again=(await mcp.call('merchant_source_import',{workspace:'received',fromWorkspace:'source',exportId:packetExport.exportId})).native;
  check(same(again.portfolio,received.portfolio)&&same(again.receivingBuilds,received.receivingBuilds),
   'The same retained source export did not replay through the original MCP receiving path.');
  const originalHistory=await runCli('source-history',directory,['history','--id',reviewed.id]);
  const receivedHistory=(await receivedClient.history(reviewed.id)).history;
  check(same(originalHistory,receivedHistory),'The full source history was not retained in the detached receiver.');
  const receiverReport=verifyReport(await receivedClient.report(reviewed.id,{revision:reviewed.revision}),reviewed);
  const receiverQuery=await receivedClient.query(queryBuild.id,{limit:'2'});
  check(same(receiverQuery.response.body,browserResult.query.body),'The actual rebuilt native index changed the reported rows or dataset identity.');
  await stage('receiving',{directory:receivedDirectory,result:received,replayed:again,historyRevisions:receivedHistory.length});
  const receivedPage=await openInstalledIatiPage({browser,applicationsUrl:appsServer.url,applicationLabel:receivedOwned.label,
   consoleUrl:receivedOpened.url,outputDirectory:join(outputDirectory,'views'),name:'received'});
  contexts.add(receivedPage.context);
  const receivedView=await inspectReceivedIatiBrowser({page:receivedPage.page,receipt:receivedPage.receipt,client:receivedClient,
   portfolio:reviewed,report:receiverReport,outputDirectory:join(outputDirectory,'views'),name:'received',receiveFile:packetFile.path});
  await stage('receivedBrowser',receivedView);
  await receivedPage.context.close();contexts.delete(receivedPage.context);
  await receivedClient.dispose();receivedClient=null;
  await stopApplication(receivedOwned);
  const cliReceiving=await runCli('recipient-receive-repeat',receivedDirectory,['receive','--file',packetFile.path]);
  check(same(cliReceiving.portfolio,reviewed),'The native received workspace changed when reopened through the original CLI.');
  const reopened=await startApplication(receivedOwned);receivedClient=reopened.client;
  const reopenedPortfolio=await receivedClient.portfolio(reviewed.id,{revision:reviewed.revision});
  check(same(reopenedPortfolio,reviewed),'The stopped and reopened Application lost the received original portfolio.');
  const reopenedReport=verifyReport(await receivedClient.report(reviewed.id,{revision:reviewed.revision}),reviewed);
  const reopenedPage=await openInstalledIatiPage({browser,applicationsUrl:appsServer.url,applicationLabel:receivedOwned.label,
   consoleUrl:reopened.url,outputDirectory:join(outputDirectory,'views'),name:'reopened'});
  contexts.add(reopenedPage.context);
  await stage('reopenedBrowser',await inspectReceivedIatiBrowser({page:reopenedPage.page,receipt:reopenedPage.receipt,client:receivedClient,
   portfolio:reviewed,report:reopenedReport,outputDirectory:join(outputDirectory,'views'),name:'reopened'}));
  await reopenedPage.context.close();contexts.delete(reopenedPage.context);
  await receivedClient.dispose();receivedClient=null;await stopApplication(receivedOwned);
  const finalApps=await appApi('/api/applications/state?historyLimit=30');
  check(finalApps.applications.filter(item=>[sourceOwned.id,receivedOwned.id].includes(item.id)).every(item=>item.phase==='STOPPED'),
   'Both original Applications must finish Stop before returning the complete receiver.');
  const sourceNative=await runCli('source-final-list',directory,['list']);
  const receivedNative=await runCli('recipient-final-list',receivedDirectory,['list']);
  const files=[reportFile,packetFile,directReport,browserResult.receipt.reportDownload,browserResult.receipt.portfolioDownload,
   {path:cliPacket,...await identity(cliPacket)}];
  result={schema:SCHEMA,state:'COMPLETE',operationId,actor,selectionSha256:hash(encode(selection)),
   completedAt:new Date().toISOString(),runtime:runtimeBinding(runtime),
   source:{directory,portfolio:portfolio.id,originalRevision:portfolio.revision,reviewedRevision:reviewed.revision,
    definitionSha256:reviewed.definitionSha256,counts:reviewedReport.counts,financialGroups:reviewedReport.financialGroups},
   received:{directory:receivedDirectory,portfolio:reviewed.id,revision:reviewed.revision,
    receivingBuilds:received.receivingBuilds,historyRevisions:receivedHistory.length},
   sourceState:{sources:sourceNative.sources.length,plans:sourceNative.plans.length,builds:sourceNative.builds.length,comparisons:sourceNative.comparisons.length},
   receivedState:{sources:receivedNative.sources.length,plans:receivedNative.plans.length,builds:receivedNative.builds.length,comparisons:receivedNative.comparisons.length},
   applications:finalApps.applications.filter(item=>[sourceOwned.id,receivedOwned.id].includes(item.id)).map(item=>({
    id:item.id,label:item.label,phase:item.phase,revision:item.revision,release:item.release,totalRuns:item.totalRuns,
    runs:item.runs.map(run=>({id:run.id,phase:run.phase,active:run.active,result:run.result}))})),
   files,stages:Object.keys(progress.stages),browser:{pageErrors:[...browserResult.receipt.pageErrors,
    ...receivedView.receipt.pageErrors,...progress.stages.reopenedBrowser.receipt.pageErrors],
    views:[...browserResult.receipt.views,...receivedView.receipt.views,...progress.stages.reopenedBrowser.receipt.views]},
   notes:['One original installed Applications controller owns both sequential source sessions.',
    'Source and received workspace histories retain exact original financial strings; local rebuilt index identities are separate.',
    'All browser views remain private receiving scratch. No publisher payment or new public source fetch was performed.']};
  await publish(join(outputDirectory,'completed-workflow.json'),result);
 }catch(error){failure=error;if(progress)await publish(join(outputDirectory,'error-'+Date.now()+'.json'),{
   schema:SCHEMA,operationId,error:errorValue(error),stages:Object.keys(progress.stages),at:new Date().toISOString()}).catch(()=>{});
 }finally{
  const cleanup=[];
  for(const context of contexts)try{await context.close();}catch(error){cleanup.push(errorValue(error));}
  for(const client of[sourceClient,receivedClient])if(client)try{await client.dispose();}catch(error){cleanup.push(errorValue(error));}
  if(mcp)try{await mcp.close();}catch(error){cleanup.push(errorValue(error));}
  if(appApi)for(const owned of Object.values(progress?.applications??{})){
   if(!owned.id)continue;
   let operationId=activeApplications.get(owned.id)??owned.runs.at(-1)?.requestId;
   try{
    const state=await appApi('/api/applications/state?historyLimit=1');
    const current=state.applications.find(item=>item.id===owned.id)?.current;
    if(!current||!current.active&&!['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(current.phase))continue;
    operationId=current.id;
    await appApi('/api/applications/stop',{applicationId:owned.id,operationId});
    await until(()=>appApi('/api/applications/state?historyLimit=1'),
     value=>{const app=value.applications.find(item=>item.id===owned.id);return app&&!app.current?.active&&
      !['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(app.current?.phase);},
     'The original retained application is still finishing its Stop.',{timeoutMs:90000});
   }catch(error){cleanup.push({applicationId:owned.id,operationId,...errorValue(error)});}
  }
  if(browser)try{await browser.close();}catch(error){cleanup.push(errorValue(error));}
  if(appsServer)try{await appsServer.close();}catch(error){cleanup.push(errorValue(error));}
  if(appsModel)try{await appsModel.close();}catch(error){cleanup.push(errorValue(error));}
  if(cleanup.length){await publish(join(outputDirectory,'cleanup-'+Date.now()+'.json'),cleanup).catch(()=>{});
   failure??=Object.assign(new Error('The original receiving cleanup remains pending in its retained records.'),{code:'IATI_RECEIVING_CLEANUP'});}
  try{if(result&&!failure)await publish(join(outputDirectory,'result.json'),result,true);}
  finally{await lease.close();}
 }
 if(failure)throw failure;
 return result;
}
