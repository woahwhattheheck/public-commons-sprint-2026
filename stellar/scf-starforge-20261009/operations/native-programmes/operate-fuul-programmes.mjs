// MIT. Complete original Fuul SDK, programme, native source and receiving journey.
// This is an operator programme using published source and actual provider records.
import * as fs from 'node:fs/promises';
import {constants,createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {pipeline} from 'node:stream/promises';

const PREFIX='stellar/scf-starforge-20261009/sf30-seller-sdk/fuul-programmes';
const OPERATION='FUUL-NATIVE-6BBB-20261012';
const argv=process.argv.slice(2),options={};
for(let i=0;i<argv.length;i++){
 const key=argv[i];if(!/^--[a-z][a-z0-9-]*$/.test(key)||i+1>=argv.length)throw new Error('Supply --name value arguments.');
 if(Object.hasOwn(options,key.slice(2)))throw new Error('Repeated option '+key);
 options[key.slice(2)]=argv[++i];
}
const allowed=new Set(['source-packet','source-directory','operation-directory','connections-file','programme-file','operations-file','activity-file','bun-executable','npm-executable','playwright-module','chromium-executable','runtime-directory','manifest-sha256','courier-stdin']);
for(const key of Object.keys(options))if(!allowed.has(key))throw new Error('Unknown option --'+key);
if(!options['operation-directory']||(!options['source-packet']&&!options['source-directory']))throw new Error('Use --operation-directory and --source-packet or --source-directory.');
const root=path.resolve(options['operation-directory']);
const controller=new AbortController();
process.once('SIGINT',()=>controller.abort(new Error('Operator interrupted')));
process.once('SIGTERM',()=>controller.abort(new Error('Operator interrupted')));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,(_key,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
function need(value,message,details){if(!value){const error=new Error(message);error.details=details;throw error;}}
function safeRelative(value){need(typeof value==='string'&&value&&!value.startsWith('/')&&!value.includes('\\')&&!value.includes('\0')&&!value.split('/').some(x=>!x||x==='.'||x==='..'),'Invalid retained relative path.',{path:value});return value;}
function target(relative){return path.join(root,...safeRelative(relative).split('/'));}
async function exists(filename){try{await fs.lstat(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function bytesAt(filename){return fs.readFile(filename);}
async function readJSON(filename){return JSON.parse(await fs.readFile(filename,'utf8'));}
async function directory(filename){await fs.mkdir(filename,{recursive:true,mode:0o700});const stat=await fs.lstat(filename);need(stat.isDirectory()&&!stat.isSymbolicLink(),'Use an original private directory.');await fs.chmod(filename,0o700);}
async function exact(filename,bytes,mode=0o600){
 await directory(path.dirname(filename));bytes=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
 if(await exists(filename)){const original=await fs.readFile(filename);need(original.equals(bytes),'The retained original file differs.',{filename});return;}
 const temporary=filename+'.pending-'+randomUUID(),handle=await fs.open(temporary,'wx',mode);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 try{await fs.link(temporary,filename);}catch(error){if(error.code!=='EEXIST')throw error;need((await fs.readFile(filename)).equals(bytes),'Concurrent original source changed.');}finally{await fs.unlink(temporary).catch(()=>{});}
 const parent=await fs.open(path.dirname(filename),'r');try{await parent.sync();}finally{await parent.close();}
}
async function replace(filename,value){
 await directory(path.dirname(filename));const temporary=filename+'.pending-'+randomUUID(),handle=await fs.open(temporary,'wx',0o600);
 try{await handle.writeFile(json(value));await handle.sync();}finally{await handle.close();}
 await fs.rename(temporary,filename);const parent=await fs.open(path.dirname(filename),'r');try{await parent.sync();}finally{await parent.close();}
}
async function fullHash(filename){
 const hash=createHash('sha256');let bytes=0;
 for await(const part of createReadStream(filename)){hash.update(part);bytes+=part.length;}
 return {bytes,sha256:hash.digest('hex')};
}
async function safeError(error){return {code:error?.code??error?.name??'NATIVE_OPERATION_FAILED',message:String(error?.message??error),details:error?.details??null};}
let state;
async function save(){state.updatedAt=new Date().toISOString();await replace(target('operation.json'),state);}
async function announce(event,details={}){const item={time:new Date().toISOString(),event,...details};await fs.appendFile(target('progress.jsonl'),JSON.stringify(item)+'\n',{mode:0o600});process.stdout.write(JSON.stringify(item)+'\n');}
async function step(name,work,{repeat=false}={}){
 const previous=state.steps[name];
 if(previous?.status==='COMPLETE'&&!repeat)return readJSON(target(previous.result));
 state.steps[name]={...previous,status:'RUNNING',startedAt:previous?.startedAt??new Date().toISOString()};await save();await announce('START',{step:name});
 try{const result=await work();const file='results/'+name+'.json';await replace(target(file),result);state.steps[name]={...state.steps[name],status:'COMPLETE',finishedAt:new Date().toISOString(),result:file};await save();await announce('COMPLETE',{step:name});return result;}
 catch(error){const problem=await safeError(error),file='results/'+name+'.error.json';await replace(target(file),problem);state.steps[name]={...state.steps[name],status:'FAILED',finishedAt:new Date().toISOString(),error:file};await save();await announce('FAILED',{step:name,code:problem.code,message:problem.message});return {error:problem};}
}
async function command(label,executable,args,{cwd=root,env={},requireSuccess=true}={}){
 const dir=target('commands/'+label);await directory(dir);
 const stamp=randomUUID(),out=path.join(dir,stamp+'.stdout'),err=path.join(dir,stamp+'.stderr');
 const stdout=await fs.open(out,'wx',0o600),stderr=await fs.open(err,'wx',0o600);
 const childEnv={...process.env,TMPDIR:target('tmp'),TMP:target('tmp'),TEMP:target('tmp'),npm_config_cache:target('npm-cache'),BUN_INSTALL_CACHE_DIR:target('bun-cache'),...env};
 const child=spawn(executable,args,{cwd,env:childEnv,stdio:['ignore',stdout.fd,stderr.fd],signal:controller.signal});
 const ended=new Promise(resolve=>{child.once('error',error=>resolve({exitCode:null,signal:null,error}));child.once('exit',(exitCode,signal)=>resolve({exitCode,signal,error:null}));});
 await replace(path.join(dir,stamp+'.command.json'),{executable,args,cwd,pid:child.pid??null,startedAt:new Date().toISOString()});
 let exitCode=null,signal=null,error=null;
 try{const result=await ended;exitCode=result.exitCode;signal=result.signal;error=result.error?await safeError(result.error):null;}catch(problem){error=await safeError(problem);}
 finally{await stdout.close();await stderr.close();}
 const result={executable,args,cwd,pid:child.pid??null,exitCode,signal,error,stdout:{path:out,...await fullHash(out)},stderr:{path:err,...await fullHash(err)}};
 await replace(path.join(dir,stamp+'.result.json'),result);
 if(requireSuccess&&exitCode!==0){const failure=new Error(label+' did not complete; original command output is retained.');failure.code='NATIVE_CHILD_FAILED';failure.details=result;throw failure;}
 return result;
}
async function originalPacket(){
 const source=options['source-packet']?path.resolve(options['source-packet']):null;
 if(!source)return {sourceDirectory:path.resolve(options['source-directory']),sourcePacket:null};
 const bytes=await bytesAt(source),packet=JSON.parse(bytes.toString('utf8'));
 need(Array.isArray(packet.files)&&packet.files.length>0,'Supply the complete original source carrier.');
 const sourceRoot=target('application'),seen=new Set();
 for(const file of packet.files){
  const relative=safeRelative(file.path);need(!seen.has(relative),'Duplicate original source member.');seen.add(relative);
  need(typeof file.content==='string','Complete source content is required.');
  const body=Buffer.from(file.content),mode=typeof file.mode==='number'?file.mode:parseInt(String(file.mode??'100644'),8)&0o777;
  need(body.length===file.bytes&&digest(body)===file.sha256,'An original source packet member differs.',{path:relative});
  if(file.gitBlob||file.sha){const expected=file.gitBlob??file.sha;need(createHash('sha1').update(Buffer.from('blob '+body.length+'\0')).update(body).digest('hex')===expected,'Original Git source identity differs.',{path:relative});}
  await exact(path.join(sourceRoot,...relative.split('/')),body,mode);await fs.chmod(path.join(sourceRoot,...relative.split('/')),mode);
 }
 await exact(target('source-carrier.json'),bytes);
 return {sourceDirectory:sourceRoot,sourcePacket:{path:source,bytes:bytes.length,sha256:digest(bytes)},files:seen.size};
}
async function retainSourceManifest(sourceRoot){
 const filename=path.join(sourceRoot,PREFIX,'source-files.json'),bytes=await fs.readFile(filename),manifest=JSON.parse(bytes.toString('utf8'));
 if(options['manifest-sha256'])need(digest(bytes)===options['manifest-sha256'],'The complete source manifest differs from the selected release.');
 await exact(target('application-source-manifest.json'),bytes);
 const entries=manifest.files??manifest.members;need(Array.isArray(entries)&&entries.length,'The original application source manifest is incomplete.');
 let total=0;
 for(const file of entries){
  const relative=file.path??file.name;safeRelative(relative);const candidates=[path.join(sourceRoot,relative),path.join(sourceRoot,PREFIX,relative)];
  let filename;
  for(const candidate of candidates)if(await exists(candidate)){filename=candidate;break;}
  need(filename,'An original application source member is absent.',{path:relative});
  const actual=await fullHash(filename);need(actual.bytes===file.bytes&&actual.sha256===file.sha256,'The selected application source differs.',{path:relative});
  total+=actual.bytes;
 }
 return {fileCount:entries.length,bytes:total,sha256:digest(bytes),schema:manifest.schema};
}
await directory(root);await directory(target('tmp'));
process.env.TMPDIR=target('tmp');process.env.TMP=target('tmp');process.env.TEMP=target('tmp');process.env.npm_config_cache=target('npm-cache');process.env.BUN_INSTALL_CACHE_DIR=target('bun-cache');
const original=await originalPacket();
if(await exists(target('operation.json'))){
 state=await readJSON(target('operation.json'));
 need(state.operation===OPERATION&&state.sourceDirectory===original.sourceDirectory&&canonical(state.sourcePacket)===canonical(original.sourcePacket),'The same native operation must retain its original source.');
}else{
 state={schema:'stellar-forge.fuul-native-operation.v1',operation:OPERATION,id:randomUUID(),createdAt:new Date().toISOString(),sourceDirectory:original.sourceDirectory,sourcePacket:original.sourcePacket,steps:{},requests:{},captures:{},programmes:{},reports:{},runtime:null};await save();
}
const appRoot=original.sourceDirectory,P=path.join(appRoot,PREFIX),workspaceDirectory=target('workspace');
const imports={};
for(const name of ['runtime','native','stellar','reconciliation','workspace','operator','server','archive','receiving','application']){
 imports[name]=await import(pathToFileURL(path.join(P,name+'.mjs')).href);
}
await step('original-source',()=>retainSourceManifest(appRoot));
await step('native-imports',async()=>({node:process.version,platform:process.platform,architecture:process.arch,modules:Object.fromEntries(Object.entries(imports).map(([name,mod])=>[name,Object.keys(mod)]))}));
await step('original-cli-methods',async()=>command('cli-methods',process.execPath,[path.join(P,'cli.mjs'),'methods']));
let runtime=null;
const runtimeResult=await step('source-built-runtime',async()=>{
 if(options['runtime-directory']){
  const value=await imports.runtime.verifyFuulRuntime({directory:path.resolve(options['runtime-directory'])});
  return {id:value.id,directory:value.directory,manifestSha256:value.manifestSha256,entrypoints:value.entrypoints,requireEntrypoints:value.requireEntrypoints,stellarEntrypoints:value.stellarEntrypoints,stellarRequireEntrypoints:value.stellarRequireEntrypoints};
 }
 let bun=options['bun-executable'];
 if(!bun){
  const probe=await command('existing-bun','bun',['--version'],{requireSuccess:false});
  if(probe.exitCode===0&&(await fs.readFile(probe.stdout.path,'utf8')).trim()==='1.3.12')bun='bun';
  else{
   const toolRoot=target('toolchain');
   await directory(toolRoot);await exact(path.join(toolRoot,'package.json'),json({private:true,name:'fuul-original-build-tools',version:'1.0.0',dependencies:{bun:'1.3.12'}}));
   await command('install-original-bun',options['npm-executable']??'npm',['install','--no-audit','--no-fund','--save-exact','bun@1.3.12'],{cwd:toolRoot});
   bun=path.join(toolRoot,'node_modules','.bin','bun');
  }
 }
 const value=await imports.runtime.buildFuulRuntime({installationDirectory:target('sdk-consumer'),directory:target('runtime-original'),bunExecutable:bun,npmExecutable:options['npm-executable']??'npm',signal:controller.signal,progress:value=>announce('NATIVE_BUILD',{detail:value})});
 return {id:value.id,directory:value.directory,manifestSha256:value.manifestSha256,entrypoints:value.entrypoints,requireEntrypoints:value.requireEntrypoints,stellarEntrypoints:value.stellarEntrypoints,stellarRequireEntrypoints:value.stellarRequireEntrypoints,build:value.build};
});
if(!runtimeResult.error){
 runtime=await imports.runtime.verifyFuulRuntime({directory:runtimeResult.directory,expectedManifestSha256:runtimeResult.manifestSha256});
 state.runtime={id:runtime.id,directory:runtime.directory,manifestSha256:runtime.manifestSha256};await save();
}
let loaded=null,restoredRuntime=null;
if(runtime){
 await step('original-runtime-exports',async()=>{
  const esm=[],cjs=[],require=createRequire(path.join(root,'runtime-consumer.cjs'));
  for(const [name,entry] of Object.entries(runtime.entrypoints)){const mod=await import(pathToFileURL(entry).href);esm.push({package:'@fuul/sdk-stellar',name,entry,exports:Object.keys(mod)});}
  for(const [name,entry] of Object.entries(runtime.stellarEntrypoints)){const mod=await import(pathToFileURL(entry).href);esm.push({package:'@stellar/stellar-sdk',name,entry,exports:Object.keys(mod)});}
  for(const [name,entry] of Object.entries(runtime.requireEntrypoints)){const mod=require(entry);cjs.push({package:'@fuul/sdk-stellar',name,entry,exports:Object.keys(mod)});}
  for(const [name,entry] of Object.entries(runtime.stellarRequireEntrypoints)){const mod=require(entry);cjs.push({package:'@stellar/stellar-sdk',name,entry,exports:Object.keys(mod)});}
  return {runtimeId:runtime.id,esm,cjs};
 });
 const receiving=await step('independent-runtime-reconstruction',async()=>{
  const transport=target('runtime-regular-files');
  for(const file of runtime.manifest.files){const filename=path.join(runtime.directory,...safeRelative(file.path).split('/'));const dest=path.join(transport,...file.path.split('/'));await directory(path.dirname(dest));if(!await exists(dest))await fs.copyFile(filename,dest,constants.COPYFILE_EXCL);await fs.chmod(dest,file.mode);}
  await exact(path.join(transport,'manifest.json'),await fs.readFile(path.join(runtime.directory,'manifest.json')));
  const value=await imports.runtime.restoreFuulRuntime({sourceDirectory:transport,destination:target('runtime-received'),expectedManifestSha256:runtime.manifestSha256});
  need(value.id===runtime.id,'Independent runtime source identity changed.');
  const reopened=await imports.runtime.loadFuulStellar({runtimeDirectory:value.directory,expectedManifestSha256:value.manifestSha256});
  for(const entry of Object.values(value.entrypoints))await import(pathToFileURL(entry).href);
  for(const entry of Object.values(value.stellarEntrypoints))await import(pathToFileURL(entry).href);
  const require=createRequire(path.join(root,'runtime-received-consumer.cjs'));for(const entry of [...Object.values(value.requireEntrypoints),...Object.values(value.stellarRequireEntrypoints)])require(entry);
  return {id:value.id,directory:value.directory,manifestSha256:value.manifestSha256,regularFiles:runtime.manifest.files.length,originalLinks:runtime.manifest.links.length,originalSDKExports:Object.keys(reopened.sdk),originalStellarExports:Object.keys(reopened.stellar)};
 });
 if(!receiving.error)restoredRuntime=receiving;
 loaded=await imports.runtime.loadFuulStellar({runtimeDirectory:runtime.directory,expectedManifestSha256:runtime.manifestSha256});
}
const publicTestnet={
 provider:'stellar',network:'stellar:testnet',rpcUrl:'https://soroban-testnet.stellar.org',
 contracts:[
  {role:'factory',address:'CDSZT33KVQYHFQT7VLCSP7QJEMBALW6SDCQCXFINKWYD6577P73AQQQY'},
  {role:'manager',address:'CDJ5XION5VZH4RRDDDUBRFC25UGBUHMTYEQBAL3G6J46W62K7P7GLXPA'}
 ],timeoutMs:60000
};
let connections=options['connections-file']?await readJSON(path.resolve(options['connections-file'])):{};
if(await exists(target('private-connections.json')))connections={...await readJSON(target('private-connections.json')),...connections};
need(connections&&typeof connections==='object'&&!Array.isArray(connections),'Select the original alias-to-connection file.');
if(!Object.values(connections).some(row=>row.provider==='stellar'&&['stellar:testnet','testnet','Test SDF Network ; September 2015'].includes(row.network)))connections={publishedTestnet:publicTestnet,...connections};
for(const [alias,value] of Object.entries(connections)){
 if(value.provider==='stellar'&&runtime&&!value.runtime?.runtimeDirectory&&!value.runtimeDirectory&&!value.runtime?.installationDirectory&&!value.installationDirectory){
  value.runtime={runtimeDirectory:runtime.directory,expectedManifestSha256:runtime.manifestSha256};
 }
}
await replace(target('private-connections.json'),connections);
let host=await imports.operator.openFuulProgrammesOperator({workspaceDirectory,connections,profile:{name:'Fuul original source operation',operation:OPERATION},applicationDirectory:P});
const mutating=new Set(host.methods().filter(row=>row.mutates).map(row=>row.method));
async function call(key,method,args={},selectedHost=host){
 const requestPath=target('requests/'+key+'.json');
 let input;
 if(await exists(requestPath)){
  input=await readJSON(requestPath);need(input.method===method,'Original operation method changed.');const selected={...input.args};delete selected.requestId;delete selected.expectedRevision;need(canonical(selected)===canonical(args),'Original operation arguments changed.',{key,method});
 }else{
  input={method,args:{...args,...(mutating.has(method)?{requestId:randomUUID(),...(method==='package.receive'?{}:{expectedRevision:(await selectedHost.describe()).revision})}:{})}};
  await exact(requestPath,json(input));
 }
 const result=await selectedHost.invoke(input);await replace(target('responses/'+key+'.json'),result);return result;
}
async function allRows(table,programmeId,selectedHost=host){
 const result=[];let offset=0;
 while(true){const page=await selectedHost.invoke({method:'workspace.list',args:{table,programmeId,offset,limit:1000}});result.push(...page.rows);if(page.nextOffset===null)break;offset=page.nextOffset;}return result;
}
async function sourceRows(sourceId,selectedHost=host){
 const result=[];let offset=0,source;
 while(true){const page=await selectedHost.invoke({method:'source.read',args:{sourceId,offset,limit:1000}});source=page.source;result.push(...page.rows);if(page.nextOffset===null)break;offset=page.nextOffset;}return {source,rows:result};
}
async function capture(key,programmeId,alias,read){
 if(!state.captures[key]){
  const started=await call('capture-'+key+'-start','capture.start',{programmeId,connectionAlias:alias,name:key,read});
  state.captures[key]=started.captureId;await save();
 }
 const captureId=state.captures[key];let observed=await host.invoke({method:'capture.read',args:{captureId,limit:1000}});
 if(!['COMPLETE','FAILED','PAUSED'].includes(observed.capture.status)){
  await call('capture-'+key+'-run','capture.run',{captureId});
  observed=await host.invoke({method:'capture.read',args:{captureId,limit:1000}});
 }
 const sources=[];let offset=0;
 while(true){const page=await host.invoke({method:'capture.read',args:{captureId,offset,limit:1000}});sources.push(...page.sources.rows);if(page.sources.nextOffset===null)break;offset=page.sources.nextOffset;}
 const records=[];for(const sourceId of sources){const result=await sourceRows(typeof sourceId==='string'?sourceId:sourceId.id);records.push(...result.rows);}
 const result={captureId,capture:observed.capture,sourceIds:sources.map(x=>typeof x==='string'?x:x.id),records};
 if(observed.capture.status!=='COMPLETE'){
  const failure=new Error('The original native capture did not complete; its requests, provider responses and checkpoint remain retained.');
  failure.code=observed.capture.status==='FAILED'?'NATIVE_CAPTURE_FAILED':'NATIVE_CAPTURE_INCOMPLETE';
  failure.details={captureId,alias,read,status:observed.capture.status,error:observed.capture.lastError??observed.capture.error??null,sourceIds:result.sourceIds,recordCount:records.length};throw failure;
 }
 return result;
}
const nativeProgrammes=[];
await step('native-catalogues',async()=>({methods:host.methods(),sources:await host.invoke({method:'source.catalog'}),actions:await host.invoke({method:'action.catalog'}),state:await host.describe()}));

async function originalPlan(name,make){
 const filename=target('selections/'+name+'.json');if(await exists(filename))return readJSON(filename);
 const value=await make();await exact(filename,json(value));return value;
}
function scopeKey(value){return digest(Buffer.from(String(value))).slice(0,24);}
function csvCell(value){const s=String(value??'');return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;}
let suppliedProgramme=options['programme-file']?await readJSON(path.resolve(options['programme-file'])):null;
function inputDefinition(alias,connection){
 if(!suppliedProgramme)return null;
 if(Array.isArray(suppliedProgramme))return suppliedProgramme.find(row=>row.connectionAlias===alias)?.definition??suppliedProgramme.find(row=>row.definition?.projectId===connection.projectId)?.definition??null;
 if(suppliedProgramme.programmes)return suppliedProgramme.programmes[alias]?.definition??suppliedProgramme.programmes[alias]??null;
 const definition=suppliedProgramme.definition??suppliedProgramme;
 return (!connection.projectId||definition.projectId===connection.projectId)&&definition.network===connection.network?definition:null;
}
for(const [alias,connection] of Object.entries(connections)){
 if(state.dynamicAliases?.includes(alias))continue;
 const key=scopeKey(alias);
 await step('native-programme-'+key,async()=>{
  const described=imports.native.openFuulSource(connection).descriptor;
  const selected=inputDefinition(alias,connection);
  const contracts=connection.contracts??[];
  const definition=selected??{
   name:connection.provider==='stellar'?'Published Fuul '+described.network+' protocol history':'Selected Fuul project '+described.projectId,
   projectId:described.projectId??contracts.find(x=>x.role==='factory')?.address??contracts[0]?.address,
   network:described.network,chainIdentifier:described.chainIdentifier,contracts,currencies:[],mappings:[],providerSourceIds:[],rules:{sourceOperation:OPERATION}
  };
  need(definition.projectId,'Select the original project or deployed protocol contract identity.');
  if(!state.programmes[alias]){
   const saved=await call('programme-'+key,'programme.save',{definition});state.programmes[alias]=saved.programmeId;await save();
  }
  return {alias,programmeId:state.programmes[alias],definition};
 });
 const programmeId=state.programmes[alias];if(!programmeId)continue;
 nativeProgrammes.push({alias,programmeId,connection});
 if(connection.provider!=='stellar')continue;
 await step('stellar-source-'+key,async()=>{
  const network=await capture(key+'-network',programmeId,alias,{kind:'network',filters:{}});
  const health=await capture(key+'-health',programmeId,alias,{kind:'health',filters:{}});
  const latest=await capture(key+'-latest',programmeId,alias,{kind:'latest-ledger',filters:{}});
  const retainedHealth=health.records.find(row=>row.original?.oldestLedger!==undefined&&row.original?.latestLedger!==undefined)?.original;
  const outcome={alias,programmeId,network:{captureId:network.captureId,status:network.capture.status},health:{captureId:health.captureId,status:health.capture.status,original:retainedHealth??null},latest:{captureId:latest.captureId,status:latest.capture.status},events:null};
  if(loaded){
   const keys=(connection.contracts??[]).map(row=>new loaded.stellar.Contract(row.address).getFootprint().toXdr('base64'));
   if(keys.length)outcome.instances=await capture(key+'-instances',programmeId,alias,{kind:'ledger-entries',filters:{keys}});
  }
  if(!retainedHealth)return outcome;
  const range=await originalPlan(key+'-ledger-range',()=>{
   const startLedger=Number(retainedHealth.oldestLedger),endLedger=Number(retainedHealth.latestLedger)+1;
   need(Number.isSafeInteger(startLedger)&&Number.isSafeInteger(endLedger)&&startLedger>=1&&endLedger>startLedger&&endLedger<=0xffffffff,'The original RPC retention range is invalid.');
   return {startLedger,endLedger,healthSourceIds:health.sourceIds,contractIds:(connection.contracts??[]).map(row=>row.address)};
  });
  const eventCapture=await capture(key+'-events',programmeId,alias,{kind:'events',filters:{startLedger:range.startLedger,endLedger:range.endLedger,contractIds:range.contractIds},pageSize:1000});
  outcome.events={captureId:eventCapture.captureId,status:eventCapture.capture.status,range,originalRecords:eventCapture.records.length,sourceIds:eventCapture.sourceIds};
  const selectedEvents=eventCapture.records.filter(row=>row.provider==='stellar'&&row.kind==='events'&&row.projection?.selected!==false);
  const nativeClaims=selectedEvents.filter(row=>row.projection?.entity==='native-claim');
  const projects=new Set((connection.contracts??[]).filter(row=>row.role==='project').map(row=>row.address));
  for(const row of selectedEvents){
   const p=row.projection??{},parsed=p.native?.parsed;
   if(p.projectAddress)projects.add(p.projectAddress);
   if(parsed&&/project/i.test(parsed.name)){
    for(const [name,value] of Object.entries(parsed.data??{}))if(/project/i.test(name)&&typeof value==='string'&&/^C[A-Z2-7]{55}$/.test(value))projects.add(value);
   }
  }
  const discovered=[...projects].filter(value=>!(connection.contracts??[]).some(x=>x.address===value));
  outcome.discoveredProjects=discovered;
  // Each project group is an explicit source connection and saved programme version.
  // The original factory/manager capture remains pinned to its original descriptor.
  for(let offset=0;offset<discovered.length;offset+=5){
   const addresses=discovered.slice(offset,offset+5),projectKey=key+'-projects-'+offset;
   const update=await originalPlan(projectKey+'-programme',async()=>{const existing=await host.invoke({method:'programme.read',args:{programmeId}});return {programmeId,expectedVersion:existing.version,definition:{...existing.definition,contracts:[...existing.definition.contracts,...addresses.filter(value=>!existing.definition.contracts.some(item=>item.address===value)).map(address=>({address,role:'project'}))]}};});
   await call(projectKey+'-programme','programme.save',update);
   const projectAlias=alias+'Projects'+offset,projectConnection={...connection,contracts:addresses.map(address=>({address,role:'project'}))};
   connections[projectAlias]=projectConnection;state.dynamicAliases=[...new Set([...(state.dynamicAliases??[]),projectAlias])];await save();
   await host.close();await replace(target('private-connections.json'),connections);
   host=await imports.operator.openFuulProgrammesOperator({workspaceDirectory,connections,applicationDirectory:P});
   const events=await capture(projectKey,programmeId,projectAlias,{kind:'events',filters:{startLedger:range.startLedger,endLedger:range.endLedger,contractIds:addresses},pageSize:1000});
   selectedEvents.push(...events.records.filter(row=>row.projection?.selected!==false));
   nativeClaims.push(...events.records.filter(row=>row.projection?.entity==='native-claim'&&row.projection.selected!==false));
   outcome.projectCaptures??=[];outcome.projectCaptures.push({captureId:events.captureId,status:events.capture.status,contractIds:addresses,sourceIds:events.sourceIds,records:events.records.length});
  }
  const txHashes=[...new Set(selectedEvents.map(row=>row.projection?.transactionHash).filter(hash=>typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)))];
  outcome.transactions=[];
  for(const hash of txHashes){
   const observed=await capture(key+'-transaction-'+hash,programmeId,alias,{kind:'transaction',filters:{hash}});
   outcome.transactions.push({hash,captureId:observed.captureId,status:observed.capture.status,sourceIds:observed.sourceIds,records:observed.records.length});
  }
  // CSV is a lossless view of observed original native rows, with its source identity carried in every row.
  // It does not manufacture a payment, claim, API pipeline or accepted programme activity.
  const activity=nativeClaims.filter(row=>typeof row.projection.userIdentifier==='string'&&row.projection.successful===true).map(row=>({
   id:row.projection.eventId,user_identifier:row.projection.userIdentifier,
   timestamp:row.original.ledgerClosedAt??row.projection.native?.closedAt??'',
   project_address:row.projection.projectAddress??'',currency:row.projection.currency??'',
   amount:row.projection.amount??'',transaction_hash:row.projection.transactionHash??'',
   source_id:row.sourceId,record_id:row.id,native_event:row.projection.nativeEventName??''
  }));
  const headers=['id','user_identifier','timestamp','project_address','currency','amount','transaction_hash','source_id','record_id','native_event'];
  const csv=Buffer.from(headers.join(',')+'\r\n'+activity.map(row=>headers.map(name=>csvCell(row[name])).join(',')).join('\r\n')+(activity.length?'\r\n':''));
  const csvFile=target('observed/native-claims-'+key+'.csv');await exact(csvFile,csv);
  const imported=await call(key+'-original-csv','source.import',{provider:'activity',kind:'observed-native-claim',programmeId,format:'csv',network:connection.network,sourceScope:'stellar:'+connection.network+':'+range.contractIds.join(','),recordsPath:'',filename:path.basename(csvFile),contentType:'text/csv',label:'CSV view of original retained native claims',bodyBase64:csv.toString('base64')});
  outcome.activity={sourceId:imported.sourceId,file:csvFile,bytes:csv.length,sha256:digest(csv),rows:activity.length};
  const originalProgramme=await host.invoke({method:'programme.read',args:{programmeId}});
  const nativeMapping={id:'retained-native-claim',name:'Retained native claim source mapping',provider:'activity',kind:'observed-native-claim',event:'native_fuul_claim_observed',identityPointer:'/id',userPointer:'/user_identifier',timestampPointer:'/timestamp',view:'original',sourceNamespace:'original-stellar-claims-'+connection.network,args:{source:'original-stellar-contract-event'},fields:[
   {target:'/transaction_hash',source:'/transaction_hash',format:'string'},
   {target:'/source_id',source:'/source_id',format:'string'},
   {target:'/record_id',source:'/record_id',format:'string'},
   {target:'/amount_base_units',source:'/amount',format:'integer'},
   {target:'/currency_contract',source:'/currency',format:'string'}
  ]};
  const update=await originalPlan(key+'-observed-mapping',()=>({programmeId,expectedVersion:originalProgramme.version,definition:{...originalProgramme.definition,mappings:[...originalProgramme.definition.mappings.filter(row=>row.id!==nativeMapping.id),nativeMapping]}}));
  await call(key+'-observed-mapping','programme.save',update);
  const version=await host.invoke({method:'programme.read',args:{programmeId}}),projected=await sourceRows(imported.sourceId),mapped=[];
  for(const record of projected.rows){
   try{mapped.push(imports.reconciliation.prepareFuulEvent({programme:version,record,mappingId:nativeMapping.id}));}
   catch(error){mapped.push({recordId:record.id,error:await safeError(error)});}
  }
  await exact(target('observed/native-claim-event-mappings-'+key+'.json'),json(mapped));
  outcome.mapping={count:mapped.length,sourceIds:[imported.sourceId],file:target('observed/native-claim-event-mappings-'+key+'.json')};
  return outcome;
 });
}
for(const {alias,programmeId,connection} of nativeProgrammes.filter(x=>x.connection.provider==='fuul')){
 const key=scopeKey(alias);
 await step('fuul-rest-source-'+key,async()=>{
  const catalog=imports.native.openFuulSource(connection).catalog;
  const kinds=connection.authType==='dashboard-oauth'?['projects','project','customizations','incentives','audiences','tiers','payout-schemas','chains','trigger-types','currencies','pending-payouts','rewards-payouts']:['project','payouts','movements','claim-checks','claim-totals','claim-history'];
  const rows=[];
  for(const kind of kinds){
   const entry=catalog.find(row=>row.kind===kind);if(!entry)continue;
   const supplied=(connection.nativeReads??[]).find(row=>row.kind===kind);
   const filters=supplied?.filters??{};
   const required=entry.filtersSchema?.required??[];
   if(required.some(field=>!Object.hasOwn(filters,field))){rows.push({kind,requires:required,selection:'Use an original user or programme selection from the private operation inputs.'});continue;}
   const result=await capture(key+'-'+kind,programmeId,alias,{kind,filters,pageSize:supplied?.pageSize??100});
   rows.push({kind,captureId:result.captureId,status:result.capture.status,sourceIds:result.sourceIds,records:result.records.length});
  }
  for(const [index,read] of (connection.nativeReads??[]).entries()){
   const result=await capture(key+'-selected-'+index,programmeId,alias,read);
   rows.push({kind:read.kind,captureId:result.captureId,status:result.capture.status,sourceIds:result.sourceIds,records:result.records.length});
  }
  return {alias,programmeId,reads:rows};
 });
}
if(options['activity-file']){
 await step('original-customer-activity',async()=>{
  need(nativeProgrammes.length>0,'Select an original programme before importing activity.');
  const selected=nativeProgrammes.find(x=>x.connection.provider==='fuul')??nativeProgrammes[0],filename=path.resolve(options['activity-file']),body=await fs.readFile(filename);
  const format=/\.csv$/i.test(filename)?'csv':'json';
  return call('original-customer-activity','source.import',{programmeId:selected.programmeId,provider:'activity',kind:'activity',format,recordsPath:'',network:selected.connection.network,sourceScope:'original-file:'+digest(body),filename:path.basename(filename),contentType:format==='csv'?'text/csv':'application/json',bodyBase64:body.toString('base64')});
 });
}
if(options['operations-file']){
 await step('original-selected-operations',async()=>{
  const filename=path.resolve(options['operations-file']),bytes=await fs.readFile(filename),operation=JSON.parse(bytes.toString('utf8'));
  need(Array.isArray(operation.actions),'Supply the original operator action sequence.');
  await exact(target('original-selected-operations.json'),bytes);
  const result=[];
  for(let index=0;index<operation.actions.length;index++){
   const action=operation.actions[index];need(typeof action.method==='string'&&action.args&&typeof action.args==='object','Supply each complete original method and arguments.');
   const args={...action.args};
   if(action.connectionAlias&&!args.connectionAlias)args.connectionAlias=action.connectionAlias;
   if(action.connectionAlias&&!args.programmeId)args.programmeId=state.programmes[action.connectionAlias];
   need(!action.connectionAlias||args.programmeId,'The selected original connection programme is absent.');
   const value=await call('selected-operation-'+index,action.method,args);result.push({index,method:action.method,value});
  }
  return {sourceSha256:digest(bytes),operations:result};
 });
}
for(const {alias,programmeId} of nativeProgrammes){
 const key=scopeKey(alias);
 await step('programme-reconciliation-'+key,async()=>{
  const first=await call('reconcile-'+key,'reconciliation.create',{programmeId,name:'Original captured programme history'});
  const report=await call('report-'+key,'report.create',{reconciliationId:first.reconciliationId,formats:['html','json','csv'],name:'Original Fuul programme source report'});
  state.reports[alias]=report.reportId;await save();
  const sources=await allRows('sources',programmeId);let selected=null;
  for(const source of sources){const page=await host.invoke({method:'source.read',args:{sourceId:source.id,limit:100}});selected=page.rows.find(row=>row.projection?.transactionHash)||selected;if(selected)break;}
  let linked=null,comparison=null;
  if(selected?.projection?.transactionHash){
   linked=await call('decision-'+key,'decision.save',{programmeId,sourceId:selected.sourceId,recordId:selected.id,action:'link',link:{transactionHash:selected.projection.transactionHash},actor:OPERATION,reason:'Retain the exact transaction reference already present on this original provider record.'});
   const next=await call('reconcile-after-link-'+key,'reconciliation.create',{programmeId,name:'Original source with explicit transaction attribution'});
   comparison=await host.invoke({method:'reconciliation.compare',args:{leftId:first.reconciliationId,rightId:next.reconciliationId}});
  }
  const body=await host.reportBody({reportId:report.reportId,format:'html'});await exact(target('reports/'+key+'.html'),body.body);
  return {programmeId,reconciliationId:first.reconciliationId,reportId:report.reportId,decisionId:linked?.decisionId??null,comparison,report:{bytes:body.body.length,sha256:digest(body.body)}};
 });
}

async function completeSourceFile(sourceId,part='body',selectedHost=host){
 let offset=0,original=null;const chunks=[];
 for(;;){
  const result=await selectedHost.invoke({method:'source.file',args:{sourceId,part,offset,length:1024*1024}});
  const body=Buffer.from(result.base64,'base64');need(body.length===result.bytes&&result.offset===offset,'Original file range differs.');
  if(original)need(original.sha256===result.file.sha256&&original.bytes===result.file.bytes,'Original file identity changed.');else original=result.file;
  chunks.push(body);offset+=body.length;
  if(result.eof)break;need(body.length,'Original source range did not advance.');
 }
 const body=Buffer.concat(chunks);need(body.length===original.bytes&&digest(body)===original.sha256,'Complete original file differs.');
 return {body,file:original};
}
async function browserModule(){
 const attempts=[];
 const explicit=options['playwright-module'];
 if(explicit){const value=await import(pathToFileURL(path.resolve(explicit)).href);return value.chromium?value:value.default;}
 for(const base of [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,appRoot,root].filter(Boolean)){
  const require=createRequire(path.join(base,'fuul-browser-native.cjs'));
  for(const name of ['playwright','playwright-core','@playwright/test']){
   try{const filename=require.resolve(name),value=await import(pathToFileURL(filename).href);if(value.chromium)return value;if(value.default?.chromium)return value.default;}catch(error){attempts.push({base,name,code:error.code??error.name});}
  }
 }
 const error=new Error('Select the original installed Playwright module for this complete browser flow.');error.code='BROWSER_RUNTIME_REQUIRED';error.details={attempts};throw error;
}
async function runBrowser(server,{selectedProgrammeId,reportId,received=false}={}){
 const playwright=await browserModule(),launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
 if(options['chromium-executable'])launch.executablePath=options['chromium-executable'];
 const browser=await playwright.chromium.launch(launch),context=await browser.newContext({acceptDownloads:true,viewport:{width:1500,height:1000}});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
 const result={received,workspaceId:server.startup.workspaceId,visits:[],errors};
 try{
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForSelector('#active-programme',{timeout:30000});
  if(selectedProgrammeId){
   await page.selectOption('#active-programme',selectedProgrammeId);
   await page.click('#open-active-programme');
   await page.locator('#programme-editor-title').waitFor({state:'visible'});
  }
  for(const tab of ['overview','programmes','sources','events','runs','actions','editions','reports','transfer','requests']){
   await page.click('nav [data-tab="'+tab+'"]');await page.locator('#'+tab).waitFor({state:'visible'});
   result.visits.push({tab,heading:await page.locator('#'+tab).innerText()});
  }
  if(!received){
   await page.click('nav [data-tab="overview"]');
   const form=page.locator('#profile-form');
   await form.locator('[name="name"]').fill('Fuul original source operation');
   await form.locator('[name="organization"]').fill('Original native programme '+OPERATION);
   const finished=page.waitForResponse(response=>response.url().endsWith('/api/invoke')&&response.request().postDataJSON()?.method==='workspace.profile');
   await form.getByRole('button',{name:'Save profile',exact:true}).click();
   const saved=await finished;need(saved.ok(),'The real browser profile mutation failed.');result.profile=await saved.json();
   const candidates=await allRows('sources',selectedProgrammeId,server.operator);
   let selectedSource=null;
   for(const candidate of candidates){if(candidate.kind==='health'&&!candidate.error){selectedSource=(await server.operator.invoke({method:'source.read',args:{sourceId:candidate.id,limit:1}})).source;break;}}
   let body,metadata;
   if(selectedSource){
    const original=await completeSourceFile(selectedSource.id,'body',server.operator);body=original.body;
    metadata={provider:selectedSource.provider,kind:selectedSource.kind,format:'json',sourceScope:selectedSource.sourceScope,connectionAlias:selectedSource.connection?.alias??'',recordsPath:selectedSource.recordsPath??'',request:selectedSource.projectionRequest};
   }else{
    body=await fs.readFile(path.join(P,'source','contracts.json'));
    metadata={provider:'document',kind:'published-contract-source',format:'json',sourceScope:'published-source:'+digest(body),connectionAlias:'',recordsPath:'',request:{source:'original-selected-application',path:'source/contracts.json'}};
   }
   const uploadFile=target('browser/original-upload.body');await exact(uploadFile,body);
   await page.click('nav [data-tab="sources"]');
   const sourceForm=page.locator('#source-form');
   for(const name of ['provider','format'])await sourceForm.locator('[name="'+name+'"]').selectOption(metadata[name]);
   for(const name of ['kind','sourceScope','recordsPath'])await sourceForm.locator('[name="'+name+'"]').fill(metadata[name]);
   await sourceForm.locator('[name="connectionAlias"]').selectOption(metadata.connectionAlias);
   await sourceForm.locator('[name="request"]').fill(json(metadata.request));
   await sourceForm.locator('[name="label"]').fill('Original source File recovery across browser reload');
   await sourceForm.locator('[name="file"]').setInputFiles({name:'retained-original-source.json',mimeType:'application/json',buffer:body});
   let originalArgs=null,committedResult=null,resolveLost,rejectLost;
   const lost=new Promise((resolve,reject)=>{resolveLost=resolve;rejectLost=reject;});
   await page.route('**/api/sources/import',async route=>{
    try{
     originalArgs=JSON.parse(Buffer.from(route.request().headers()['x-fuul-source'],'base64').toString('utf8'));
     need(route.request().headers()['x-fuul-workspace-id']===server.startup.workspaceId,'Browser changed the original workspace header.');
     const response=await route.fetch();committedResult=await response.json();
     need(response.ok()&&committedResult.sourceId,'The original browser upload was not retained.');
     // The source has really committed. Only the acknowledgement is interrupted.
     await route.abort('failed');resolveLost();
    }catch(error){rejectLost(error);await route.abort().catch(()=>{});}
   },{times:1});
   await sourceForm.getByRole('button',{name:'Retain original file',exact:true}).click();await lost;
   await page.waitForFunction(()=>document.querySelector('#request-journal')?.textContent?.includes('AWAITING_RESULT'));
   const before=await server.operator.invoke({method:'request.status',args:{requestId:originalArgs.requestId}});
   need(before.record?.result?.sourceId===committedResult.sourceId,'The original upload result is absent from the native journal.');
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForSelector('#active-programme');
   await page.click('nav [data-tab="requests"]');
   const card=page.locator('#request-journal [data-request-id="'+originalArgs.requestId+'"]');
   await card.waitFor({state:'visible'});need((await card.innerText()).includes('Recover original request'),'The browser did not retain the original incomplete File request.');
   const restoredRequest=page.waitForRequest(request=>request.url().endsWith('/api/sources/import'));
   await card.getByRole('button',{name:'Recover original request',exact:true}).click();
   const replay=await restoredRequest,replayArgs=JSON.parse(Buffer.from(replay.headers()['x-fuul-source'],'base64').toString('utf8'));
   need(canonical(replayArgs)===canonical(originalArgs),'Browser reload changed the original native request selection.');
   await card.waitFor({state:'detached'});
   const after=await server.operator.invoke({method:'request.status',args:{requestId:originalArgs.requestId}});
   need(after.record?.result?.sourceId===committedResult.sourceId,'Original request replay created a different source.');
   const retained=await completeSourceFile(committedResult.sourceId,'body',server.operator);
   need(retained.body.equals(body),'The original File bytes changed across browser recovery.');
   result.fileRecovery={requestId:originalArgs.requestId,sourceId:committedResult.sourceId,originalSourceId:selectedSource?.id??null,bytes:body.length,sha256:digest(body),nativeRequestReplayed:true,browserWorkspaceId:server.startup.workspaceId};
   await page.screenshot({path:target('browser/source-recovered.png'),fullPage:true});
  }
  if(reportId){
   const token=new URL(server.url).hash.slice('#token='.length);
   const reportURL=server.startup.origin+'/api/reports/'+reportId+'/files/html';
   const response=await page.request.get(reportURL,{headers:{Authorization:'Bearer '+decodeURIComponent(token)}});
   need(response.ok(),'The original report did not reopen in the received browser context.');
   const body=await response.body();await exact(target('browser/'+(received?'received':'original')+'-report.html'),body);
   await page.goto('data:text/html;base64,'+body.toString('base64'),{waitUntil:'domcontentloaded'});
   await page.screenshot({path:target('browser/'+(received?'received':'original')+'-report.png'),fullPage:true});
   result.report={reportId,bytes:body.length,sha256:digest(body)};
  }
  await context.tracing.stop({path:target('browser/'+(received?'received':'original')+'-browser-trace.zip')});
  return result;
 }finally{await context.close();await browser.close();}
}
await host.close();
let sourceServer=await imports.server.startFuulProgrammesServer({workspaceDirectory,connections,port:0});
host=sourceServer.operator;
await step('complete-original-browser',()=>runBrowser(sourceServer,{selectedProgrammeId:nativeProgrammes[0]?.programmeId,reportId:state.reports[nativeProgrammes[0]?.alias]}));
await step('native-http-identity',async()=>{
 const token=decodeURIComponent(new URL(sourceServer.url).hash.slice('#token='.length)),headers={Authorization:'Bearer '+token};
 const bootstrap=await fetch(sourceServer.startup.origin+'/api/bootstrap',{headers});need(bootstrap.ok,'Native bootstrap did not return.');const body=await bootstrap.json();
 need(body.state.workspaceId===sourceServer.startup.workspaceId,'Native HTTP workspace identity differs.');
 const describe=await fetch(sourceServer.startup.origin+'/api/invoke',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({method:'workspace.describe',args:{}})});
 need(describe.ok,'Native HTTP describe did not return.');
 const original=await describe.json();return {workspaceId:original.workspaceId,revision:original.revision,methods:body.methods,catalog:body.catalog,actionCatalog:body.actionCatalog};
});
const whole=await step('whole-workspace-export',async()=>{
 const args={destination:target('deliveries/workspace')},result=await call('whole-workspace-export','workspace.export',args);
 const before=await host.describe();await call('export-live-progress','workspace.profile',{profile:{...before.profile,exportContinuation:OPERATION}});
 const replay=await call('whole-workspace-export','workspace.export',args);
 need(replay.exportId===result.exportId&&replay.manifestSha256===result.manifestSha256,'Original export retry selected newer live workspace content.');
 const inspection=await imports.receiving.inspectFuulDelivery({sourceDirectory:result.directory,expectedManifestSha256:result.manifestSha256});
 const archive=target('artifacts/fuul-complete-workspace.tar.gz');await directory(path.dirname(archive));
 if(!await exists(archive)){
  const pending=archive+'.pending';await pipeline(await imports.archive.streamFuulDelivery({sourceDirectory:result.directory,expectedManifestSha256:result.manifestSha256,signal:controller.signal}),createWriteStream(pending,{flags:'w',mode:0o600}));await fs.rename(pending,archive);
 }
 return {...result,manifest:inspection.manifest,archive:{path:archive,...await fullHash(archive)}};
});
let received=null;
if(!whole.error){
 received=await step('whole-independent-receiving',async()=>{
  const unpacked=await imports.archive.unpackFuulDelivery({input:createReadStream(whole.archive.path),destination:target('unpacked-workspace'),expectedManifestSha256:whole.manifestSha256,signal:controller.signal});
  const request=await originalPlan('whole-receive',()=>({sourceDirectory:unpacked.sourceDirectory??target('unpacked-workspace'),destination:target('received-workspace'),requestId:randomUUID(),expectedManifestSha256:whole.manifestSha256}));
  const result=await imports.receiving.receiveFuulDelivery(request),replay=await imports.receiving.receiveFuulDelivery(request);
  need(result.workspace.workspaceId===whole.sourceWorkspaceId&&replay.workspace.workspaceId===result.workspace.workspaceId&&replay.replayed,'Independent receiving changed original identity or replay.');
  const runtimeIds=whole.runtimes.map(row=>row.id).sort();need(canonical(result.runtimes.map(row=>row.id).sort())===canonical(runtimeIds),'The complete original runtime graph did not arrive.');
  return result;
 });
}
for(const [alias,reportId] of Object.entries(state.reports)){
 await step('scoped-report-delivery-'+scopeKey(alias),async()=>{
  const exported=await call('scoped-report-export-'+scopeKey(alias),'report.export',{reportId,destination:target('deliveries/report-'+scopeKey(alias))});
  const manifest=(await imports.receiving.readFuulDeliveryManifest({sourceDirectory:exported.directory,expectedManifestSha256:exported.manifestSha256})).manifest;
  need(manifest.kind==='report'&&manifest.runtimes.length===0&&!manifest.files.some(file=>file.role==='workspace'||file.role==='runtime'),'Scoped report includes unrelated original workspace or runtime source.');
  const archive=target('artifacts/fuul-report-'+scopeKey(alias)+'.tar.gz');
  if(!await exists(archive))await pipeline(await imports.archive.streamFuulDelivery({sourceDirectory:exported.directory,expectedManifestSha256:exported.manifestSha256}),createWriteStream(archive,{flags:'wx',mode:0o600}));
  const unpacked=await imports.archive.unpackFuulDelivery({input:createReadStream(archive),destination:target('unpacked-report-'+scopeKey(alias)),expectedManifestSha256:exported.manifestSha256});
  const input=await originalPlan('report-receive-'+scopeKey(alias),()=>({sourceDirectory:unpacked.sourceDirectory??target('unpacked-report-'+scopeKey(alias)),destination:target('received-report-'+scopeKey(alias)),requestId:randomUUID(),expectedManifestSha256:exported.manifestSha256}));
  const result=await imports.receiving.receiveFuulDelivery(input);
  need(result.report?.id===reportId&&result.workspace===null,'Original scoped report identity differs.');
  return {export:exported,archive:{path:archive,...await fullHash(archive)},received:result};
 });
}
await sourceServer.close();sourceServer=null;
if(received&&!received.error){
 await step('received-original-cli',async()=>{
  need(received.application?.cli,'The original full application source did not arrive.');
  return command('received-cli-describe',process.execPath,[received.application.cli,'workspace-describe','--workspace',received.workspace.directory]);
 });
 await step('received-browser-and-continuation',async()=>{
  const receivedP=path.dirname(received.application.server),receivedServerModule=await import(pathToFileURL(received.application.server).href);
  const restoredConnections=JSON.parse(JSON.stringify(connections)),originalRuntime=new Map((received.runtimes??[]).map(value=>[value.id,value]));
  for(const value of Object.values(restoredConnections))if(value.provider==='stellar'){
   const current=value.runtime??{},selected=(received.runtimes??[]).find(row=>row.manifestSha256===current.expectedManifestSha256)??originalRuntime.get(runtime?.id);
   if(selected)value.runtime={runtimeDirectory:selected.directory,expectedManifestSha256:selected.manifestSha256,retained:(received.runtimes??[]).map(row=>({id:row.id,runtimeDirectory:row.directory,expectedManifestSha256:row.manifestSha256}))};
  }
  const server=await receivedServerModule.startFuulProgrammesServer({workspaceDirectory:received.workspace.directory,connections:restoredConnections,port:0,expectedWorkspaceId:received.workspace.workspaceId});
  try{
   const before=await server.operator.describe();
   need(before.workspaceId===whole.sourceWorkspaceId,'The received operator has a different original identity.');
   const browser=await runBrowser(server,{selectedProgrammeId:nativeProgrammes[0]?.programmeId,reportId:state.reports[nativeProgrammes[0]?.alias],received:true});
   const captures=await allRows('captures',undefined,server.operator);
   need(captures.every(row=>row.paused===true),'Receiving did not retain explicit paused capture ownership.');
   const alias=Object.keys(restoredConnections).find(name=>restoredConnections[name].provider==='stellar');
   if(alias){
    const programmeId=state.programmes[alias]??nativeProgrammes[0]?.programmeId;
    const created=await call('received-native-head','capture.start',{programmeId,connectionAlias:alias,name:'Original native network after independent receiving',read:{kind:'network',filters:{}}},server.operator);
    const completed=await call('received-native-head-run','capture.run',{captureId:created.captureId},server.operator);
    return {browser,workspaceId:before.workspaceId,receivedSourceDirectory:receivedP,continuedCapture:completed,pausedOriginalCaptures:captures.length};
   }
   return {browser,workspaceId:before.workspaceId,receivedSourceDirectory:receivedP,pausedOriginalCaptures:captures.length};
  }finally{await server.close();}
 });
}
const current=await imports.operator.openFuulProgrammesOperator({workspaceDirectory,connections,applicationDirectory:P});
const finalState=await current.describe(),history=await current.invoke({method:'workspace.history',args:{limit:1000}}),nativeCaptureOutcomes=(await allRows('captures',undefined,current)).map(row=>({id:row.id,provider:row.provider,status:row.status,sourceCount:row.sourceCount,error:row.lastError}));
await current.close();
const report={schema:'stellar-forge.fuul-native-outcome.v1',operation:OPERATION,operationId:state.id,startedAt:state.createdAt,finishedAt:new Date().toISOString(),node:process.version,
 source:original,runtime:state.runtime,nativeCaptureOutcomes,steps:state.steps,workspace:{directory:workspaceDirectory,id:finalState.workspaceId,revision:finalState.revision,counts:finalState.counts},
 nativeProgrammes:nativeProgrammes.map(row=>({alias:row.alias,programmeId:row.programmeId})),reports:state.reports,wholeDelivery:whole.error?whole:{exportId:whole.exportId,manifestSha256:whole.manifestSha256,files:whole.files,bytes:whole.bytes,archive:whole.archive},received:received?.error?received:received?{directory:received.directory,workspace:received.workspace,runtimes:received.runtimes}:null,
 completed:Object.values(state.steps).filter(row=>row.status==='COMPLETE').length,failed:Object.entries(state.steps).filter(([_key,row])=>row.status==='FAILED').map(([name,row])=>({name,error:row.error}))};
await replace(target('native-outcome.json'),report);await replace(target('final-workspace-description.json'),finalState);await replace(target('final-history.json'),history);
const supportNames=['native-outcome.json','operation.json','progress.jsonl','application-source-manifest.json','results','commands','requests','responses','observed','reports','browser','final-workspace-description.json','final-history.json'].filter(name=>name);
const available=[];for(const name of supportNames)if(await exists(target(name)))available.push(name);
await directory(target('artifacts'));
await command('preserve-native-support','tar',['-czf',target('artifacts/fuul-native-operation.tar.gz'),'-C',root,...available]);
const artifacts=[];
for(const name of await fs.readdir(target('artifacts'))){const filename=target('artifacts/'+name);if((await fs.lstat(filename)).isFile())artifacts.push({name,path:filename,...await fullHash(filename)});}
await replace(target('artifacts.json'),artifacts);
await announce('NATIVE_OUTCOME',{operation:OPERATION,operationId:state.id,completed:report.completed,failed:report.failed,workspace:report.workspace,artifacts});
if(options['courier-stdin']==='true'){
 const {createInterface}=await import('node:readline'),reader=createInterface({input:process.stdin,crlfDelay:Infinity});
 await announce('COURIER_READY',{artifacts});
 for await(const line of reader){
  try{
   const command=JSON.parse(line);if(command.action==='finish'){reader.close();break;}
   const artifact=artifacts.find(row=>row.name===command.name);need(artifact,'Select an original produced artifact.');
   if(command.action==='upload'){
    const url=new URL(command.url);need(url.protocol==='https:','Use the provided HTTPS artifact upload URL.');
    const response=await fetch(url,{method:command.method??'POST',headers:{'Content-Type':'application/octet-stream','Content-Length':String(artifact.bytes),...(command.headers??{})},body:createReadStream(artifact.path),duplex:'half',redirect:'error'});
    const body=await response.text();const result={name:artifact.name,bytes:artifact.bytes,sha256:artifact.sha256,status:response.status,response:body};
    await replace(target('courier/'+artifact.name+'.json'),result);process.stdout.write(JSON.stringify({event:'COURIER_UPLOADED',...result})+'\n');
   }else if(command.action==='range'){
    const offset=Number(command.offset??0),length=Number(command.length??196608);
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(length)&&length>0&&length<=1048576,'Use a valid original file range.');
    const handle=await fs.open(artifact.path,'r'),buffer=Buffer.alloc(Math.min(length,Math.max(0,artifact.bytes-offset)));
    try{const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);process.stdout.write(JSON.stringify({event:'COURIER_RANGE',name:artifact.name,offset,bytes:bytesRead,complete:offset+bytesRead>=artifact.bytes,sha256:artifact.sha256,base64:buffer.subarray(0,bytesRead).toString('base64')})+'\n');}finally{await handle.close();}
   }else throw new Error('Select upload, range or finish.');
  }catch(error){process.stdout.write(JSON.stringify({event:'COURIER_ERROR',error:await safeError(error)})+'\n');}
 }
}
