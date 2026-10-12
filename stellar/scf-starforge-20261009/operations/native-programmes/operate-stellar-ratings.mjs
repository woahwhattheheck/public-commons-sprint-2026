// MIT. Complete original Bluechip/Stellar wallet, UTC activity, runtime and receiving journey.
// This is an operator programme using published source and actual provider records.
import * as fs from 'node:fs/promises';
import {constants,createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {pipeline} from 'node:stream/promises';

const PREFIX='stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-ratings';
const OPERATION='BLUECHIP-NATIVE-6BBB-20261012';
const argv=process.argv.slice(2),options={};
for(let i=0;i<argv.length;i++){
 const key=argv[i];if(!/^--[a-z][a-z0-9-]*$/.test(key)||i+1>=argv.length)throw new Error('Supply --name value arguments.');
 if(Object.hasOwn(options,key.slice(2)))throw new Error('Repeated option '+key);
 options[key.slice(2)]=argv[++i];
}
const allowed=new Set(['source-packet','source-directory','operation-directory','connections-file','registry-file','policy-file','addresses-file','prices-file','scores-file','methodology-file','activity-date','npm-executable','playwright-module','chromium-executable','runtime-directory','installation-directory','manifest-sha256','courier-stdin']);
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
 const attemptId=randomUUID(),startedAt=new Date().toISOString();
 state.steps[name]={...previous,status:'RUNNING',startedAt:previous?.startedAt??startedAt,attemptId,
  attempts:[...(previous?.attempts??[]),{id:attemptId,startedAt}]};await save();await announce('START',{step:name,attemptId});
 try{
  const result=await work(),file='results/'+name+'/'+attemptId+'.json';await exact(target(file),json(result));
  state.steps[name]={...state.steps[name],status:'COMPLETE',finishedAt:new Date().toISOString(),result:file,error:null};await save();await announce('COMPLETE',{step:name,attemptId});return result;
 }catch(error){
  const problem=await safeError(error),file='results/'+name+'/'+attemptId+'.error.json';await exact(target(file),json(problem));
  state.steps[name]={...state.steps[name],status:'FAILED',finishedAt:new Date().toISOString(),error:file};await save();await announce('FAILED',{step:name,attemptId,code:problem.code,message:problem.message});return {error:problem};
 }
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
const lockDirectory=target('native-operation.lock'),lockToken=randomUUID();
async function identityOf(pid){
 try{const boot=(await fs.readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),stat=await fs.readFile('/proc/'+pid+'/stat','utf8');return {pid,boot,startTicks:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]};}
 catch{return null;}
}
const ownIdentity=await identityOf(process.pid);
try{await fs.mkdir(lockDirectory,{mode:0o700});}
catch(error){
 if(error.code!=='EEXIST')throw error;
 const prior=await readJSON(path.join(lockDirectory,'owner.json')).catch(()=>null),actual=prior?.process?await identityOf(prior.process.pid):null;
 need(prior?.process,'The original operation lease is being established; retain this directory and retry after its owner completes.');
 need(!actual||canonical(prior.process)!==canonical(actual),'This same original native operation is already running.',{pid:prior?.process?.pid??null});
 await fs.rename(lockDirectory,target('stale-native-lock-'+randomUUID()));
 await fs.mkdir(lockDirectory,{mode:0o700});
}
await exact(path.join(lockDirectory,'owner.json'),json({token:lockToken,process:ownIdentity,operation:OPERATION}));
async function releaseNativeLock(){const own=await readJSON(path.join(lockDirectory,'owner.json')).catch(()=>null);if(own?.token===lockToken)await fs.rm(lockDirectory,{recursive:true});}

process.env.TMPDIR=target('tmp');process.env.TMP=target('tmp');process.env.TEMP=target('tmp');process.env.npm_config_cache=target('npm-cache');process.env.BUN_INSTALL_CACHE_DIR=target('bun-cache');
try {
const original=await originalPacket();
if(await exists(target('operation.json'))){
 state=await readJSON(target('operation.json'));
 need(state.operation===OPERATION&&state.sourceDirectory===original.sourceDirectory&&canonical(state.sourcePacket)===canonical(original.sourcePacket),'The same native operation must retain its original source.');
}else{
 state={schema:'stellar-forge.stellar-ratings.native-operation.v1',operation:OPERATION,id:randomUUID(),createdAt:new Date().toISOString(),sourceDirectory:original.sourceDirectory,sourcePacket:original.sourcePacket,steps:{},requests:{},captures:{},registries:{},policies:{},runs:{},collections:{},reports:{},runtime:null};await save();
}
const appRoot=original.sourceDirectory,P=path.join(appRoot,PREFIX),workspaceDirectory=target('workspace');


const imports={},appModules=['runtime','native','stellar','reconciliation','lossless-json','workspace','operator','server','archive','receiving','worker'];
await step('original-source',()=>retainSourceManifest(appRoot));
await step('native-module-imports',async()=>{
 for(const name of appModules)imports[name]=await import(pathToFileURL(path.join(P,name+'.mjs')).href);
 return {node:process.version,platform:process.platform,architecture:process.arch,
  modules:Object.fromEntries(Object.entries(imports).map(([name,mod])=>[name,Object.keys(mod)]))};
});
for(const name of appModules)if(!imports[name]){
 try{imports[name]=await import(pathToFileURL(path.join(P,name+'.mjs')).href);}
 catch(error){await announce('MODULE_UNAVAILABLE',{module:name,error:await safeError(error)});}
}
await step('original-cli-help',async()=>command('cli-help',process.execPath,[path.join(P,'cli.mjs'),'help']));
await step('original-cli-methods',async()=>command('cli-methods',process.execPath,[path.join(P,'cli.mjs'),'methods']));
let runtime=null,loaded=null,restoredRuntime=null;
const runtimeResult=await step('original-installed-runtime',async()=>{
 need(imports.runtime,'The original runtime module must import.');
 const value=options['runtime-directory']?
  await imports.runtime.verifyRatingsRuntime({directory:path.resolve(options['runtime-directory'])}):
  options['installation-directory']?await imports.runtime.retainRatingsRuntime({directory:target('runtime-original'),installationDirectory:path.resolve(options['installation-directory'])}):
  await imports.runtime.installRatingsRuntime({installationDirectory:target('stellar-consumer'),directory:target('runtime-original'),
   npmExecutable:options['npm-executable']??'npm',signal:controller.signal,progress:detail=>announce('ORIGINAL_INSTALL',{detail})});
 return {id:value.id,directory:value.directory,manifestSha256:value.manifestSha256,
  entrypoints:value.entrypoints,requireEntrypoints:value.requireEntrypoints,installation:value.installation??null};
});
if(!runtimeResult.error){
 runtime=await imports.runtime.verifyRatingsRuntime({directory:runtimeResult.directory,expectedManifestSha256:runtimeResult.manifestSha256});
 state.runtime={id:runtime.id,directory:runtime.directory,manifestSha256:runtime.manifestSha256};await save();
 await step('original-runtime-exports',async()=>{
  const esm=[],cjs=[],require=createRequire(path.join(root,'native-runtime-consumer.cjs'));
  for(const [name,entry] of Object.entries(runtime.entrypoints)){const value=await import(pathToFileURL(entry).href);esm.push({name,exports:Object.keys(value)});}
  for(const [name,entry] of Object.entries(runtime.requireEntrypoints)){const value=require(entry);cjs.push({name,exports:Object.keys(value)});}
  return {runtimeId:runtime.id,manifestSha256:runtime.manifestSha256,esm,cjs,
   packages:runtime.manifest.packages.map(item=>({id:item.id,name:item.name,version:item.version})),
   files:runtime.manifest.files.length,links:runtime.manifest.links.length};
 });
 const received=await step('original-runtime-independent-reconstruction',async()=>{
  const transport=target('runtime-regular-files');
  await directory(transport);
  for(const member of runtime.manifest.files){
   const rel=safeRelative(member.path),origin=path.join(runtime.directory,...rel.split('/')),destination=path.join(transport,...rel.split('/'));
   await directory(path.dirname(destination));
   if(!await exists(destination))await fs.copyFile(origin,destination,constants.COPYFILE_EXCL);
   const verified=await fullHash(destination);need(verified.bytes===member.bytes&&verified.sha256===member.sha256,'Original runtime file transport differs.',{path:rel});
   await fs.chmod(destination,0o600);
  }
  await exact(path.join(transport,'manifest.json'),await fs.readFile(path.join(runtime.directory,'manifest.json')));
  const value=await imports.runtime.restoreRatingsRuntime({sourceDirectory:transport,destination:target('runtime-received'),expectedManifestSha256:runtime.manifestSha256});
  need(value.id===runtime.id&&value.manifestSha256===runtime.manifestSha256,'Independent runtime identity differs.');
  const loaded=await imports.runtime.loadRatingsStellar({runtimeDirectory:value.directory,expectedManifestSha256:value.manifestSha256});
  const require=createRequire(path.join(root,'received-runtime-consumer.cjs'));
  for(const entry of Object.values(value.entrypoints))await import(pathToFileURL(entry).href);
  for(const entry of Object.values(value.requireEntrypoints))require(entry);
  return {id:value.id,directory:value.directory,manifestSha256:value.manifestSha256,files:runtime.manifest.files.length,
   originalLinks:runtime.manifest.links.length,sourceOnlyTransport:true,originalExports:Object.keys(loaded.stellar)};
 });
 if(!received.error)restoredRuntime=received;
 const binding=await step('original-runtime-application-binding',async()=>{
  const sourceBinding=await imports.runtime.bindRatingsRuntime({directory:runtime.directory,applicationDirectory:appRoot,expectedManifestSha256:runtime.manifestSha256});
  return {...sourceBinding,sourceManifest:await retainSourceManifest(appRoot)};
 });
 await step('original-runtime-native-loader',async()=>{
  loaded=await imports.runtime.loadRatingsStellar({runtimeDirectory:runtime.directory,expectedManifestSha256:runtime.manifestSha256});
  return {runtime:loaded.runtime,exports:Object.keys(loaded.stellar)};
 });
 if(!loaded)try{loaded=await imports.runtime.loadRatingsStellar({runtimeDirectory:runtime.directory,expectedManifestSha256:runtime.manifestSha256});}catch{}
}
const runtimeConfiguration=runtime?{runtimeDirectory:runtime.directory,expectedManifestSha256:runtime.manifestSha256}:{}; 
const suppliedConnections=options['connections-file']?await readJSON(path.resolve(options['connections-file'])):{};
need(suppliedConnections&&typeof suppliedConnections==='object'&&!Array.isArray(suppliedConnections),'Use the original alias-to-private-connection object.');
let registryDefinition=options['registry-file']?await readJSON(path.resolve(options['registry-file'])):await readJSON(path.join(P,'examples','registry.template.json'));
let policyDefinition=options['policy-file']?await readJSON(path.resolve(options['policy-file'])):await readJSON(path.join(P,'examples','wallet-policy.template.json'));
const canonicalNetwork=imports['lossless-json']?.ratingsNetwork(registryDefinition.network??'stellar:pubnet').network??registryDefinition.network;
const connections={...suppliedConnections};
function aliasFor(provider){
 return Object.entries(connections).find(([_alias,configuration])=>{
  if(configuration.provider!==provider)return false;
  if(provider==='bluechip')return true;
  try{return imports['lossless-json'].ratingsNetwork(configuration.network??canonicalNetwork).network===canonicalNetwork;}catch{return false;}
 })?.[0]??null;
}
if(!aliasFor('bluechip'))connections.bluechip={provider:'bluechip',network:canonicalNetwork,baseUrl:'https://backend.bluechip.org/api/1.2/',timeoutMs:60000};
if(!aliasFor('horizon'))connections.horizon={provider:'horizon',network:canonicalNetwork,
 baseUrl:canonicalNetwork==='stellar:testnet'?'https://horizon-testnet.stellar.org':'https://horizon.stellar.org',timeoutMs:60000};
if(!aliasFor('stellar-expert'))connections.stellarExpert={provider:'stellar-expert',network:canonicalNetwork,baseUrl:'https://api.stellar.expert',timeoutMs:60000};
for(const configuration of Object.values(connections))if(configuration.provider==='stellar'&&runtime&&!configuration.runtime)
 configuration.runtime=runtimeConfiguration;
const connectionAliases={horizon:aliasFor('horizon'),stellarExpert:aliasFor('stellar-expert'),bluechip:aliasFor('bluechip'),
 ...(aliasFor('stellar')?{stellar:aliasFor('stellar')}:{})};
await replace(target('private-connections.json'),connections);
let host=null;
const operatorResult=await step('original-operator-open',async()=>{
 need(imports.operator,'The complete original operator source must import.');
 host=await imports.operator.openStellarRatingsOperator({workspaceDirectory,connections,profile:{name:'Bluechip original Stellar commissioning',operator:OPERATION,collectDaily:false},
  applicationDirectory:P,runtime:runtimeConfiguration});
 return {methods:host.methods(),state:await host.describe(),sources:await host.invoke({method:'source.catalog'})};
});
if(!host&&imports.operator)try{
 host=await imports.operator.openStellarRatingsOperator({workspaceDirectory,connections,applicationDirectory:P,runtime:runtimeConfiguration});
}catch(error){await announce('OPERATOR_UNAVAILABLE',{error:await safeError(error)});}
async function invoke(key,method,args={},selectedHost=host){
 need(selectedHost,'The complete native operator must be open.');
 safeRelative(key);
 const requestPath=target('requests/'+key+'.json'),mutating=selectedHost.methods().some(row=>row.method===method&&row.mutates);
 let input;
 if(await exists(requestPath)){
  input=await readJSON(requestPath);need(input.method===method,'Original method changed.',{key,method});
  const prior={...input.args},next={...args};delete prior.requestId;delete prior.expectedRevision;delete next.requestId;delete next.expectedRevision;
  need(canonical(prior)===canonical(next),'Original operation selection changed.',{key,method});
 }else{
  input={method,args:{...args,...(mutating?{requestId:args.requestId??randomUUID(),
   ...(method==='package.receive'?{}:{expectedRevision:args.expectedRevision??(await selectedHost.describe()).revision})}:{})}};
  await exact(requestPath,json(input));
 }
 for(;;){
  const attempt=randomUUID();await exact(target('request-attempts/'+key+'/'+attempt+'.request.json'),json(input));
  try{
   const result=await selectedHost.invoke(input);
   await exact(target('request-attempts/'+key+'/'+attempt+'.response.json'),json(result));
   await replace(target('responses/'+key+'.json'),result);return result;
  }catch(error){
   await exact(target('request-attempts/'+key+'/'+attempt+'.error.json'),json(await safeError(error)));
   if(error.code!=='REVISION_CONFLICT')throw error;
   input={...input,args:{...input.args,expectedRevision:(await selectedHost.describe()).revision}};
  }
 }
}
async function allRows(table,selectedHost=host,filters={}){
 const rows=[];let offset=0;
 for(;;){const page=await selectedHost.invoke({method:'workspace.list',args:{table,...filters,offset,limit:1000}});rows.push(...page.rows);
  if(page.nextOffset===null)break;need(page.nextOffset>offset,'The original table did not advance.');offset=page.nextOffset;}
 return rows;
}
async function sourceRows(sourceId,selectedHost=host){
 const rows=[];let offset=0,source;
 for(;;){const result=await selectedHost.invoke({method:'source.read',args:{sourceId,offset,limit:1000}});source=result.source;rows.push(...result.rows);
  if(result.nextOffset===null)break;need(result.nextOffset>offset,'Original source records did not advance.');offset=result.nextOffset;}
 return {source,rows};
}
async function captureSources(captureId,selectedHost=host){
 const rows=[];let offset=0,capture;
 for(;;){const value=await selectedHost.invoke({method:'capture.read',args:{captureId,offset,limit:1000}});capture=value.capture;rows.push(...value.sources.rows);
  if(value.sources.nextOffset===null)break;offset=value.sources.nextOffset;}
 return {capture,sourceIds:rows.map(value=>typeof value==='string'?value:value.id)};
}
async function delay(milliseconds){
 if(controller.signal.aborted)throw controller.signal.reason;
 await new Promise((resolve,reject)=>{const timer=setTimeout(done,milliseconds);
  function done(){controller.signal.removeEventListener('abort',abort);resolve();}
  function abort(){clearTimeout(timer);controller.signal.removeEventListener('abort',abort);reject(controller.signal.reason);}
  controller.signal.addEventListener('abort',abort,{once:true});
 });
}
function retryTime(error){
 if(error?.code!=='SOURCE_RATE_LIMITED')return null;
 const raw=error.details?.retryAfter;
 if(raw&&/^\d+(?:\.\d+)?$/.test(String(raw)))return Math.max(1000,Number(raw)*1000);
 if(raw&&Number.isFinite(Date.parse(raw)))return Math.max(1000,Date.parse(raw)-Date.now());
 return 60000;
}
async function withProgress(label,work){
 let done=false,watch;
 const result=Promise.resolve().then(work).finally(()=>{done=true;});
 watch=(async()=>{while(!done&&!controller.signal.aborted){await new Promise(resolve=>setTimeout(resolve,5000));if(!done){
  try{const value=host?await host.describe():null;await announce('NATIVE_PROGRESS',{step:label,revision:value?.revision,counts:value?.counts});}catch{}
 }}})();
 try{return await result;}finally{done=true;await watch;}
}
async function capture(key,registryId,alias,read,{singlePage=false,selectedHost=host}={}){
 if(!state.captures[key]){
  const result=await invoke('capture/'+key+'/start','capture.start',{registryId,connectionAlias:alias,name:key,read},selectedHost);
  state.captures[key]=result.captureId;await save();
 }
 const captureId=state.captures[key];
 for(;;){
  let current=await selectedHost.invoke({method:'capture.read',args:{captureId,limit:1}});
  if(current.capture.status==='COMPLETE')return captureSources(captureId,selectedHost);
  if(singlePage&&current.capture.attemptCount>0){
   if(!current.capture.paused)await invoke('capture/'+key+'/selected-page-pause','capture.pause',{captureId},selectedHost);
   return captureSources(captureId,selectedHost);
  }
  if(['FAILED','PAUSED'].includes(current.capture.status)){
   if(current.capture.status==='FAILED'){
    const wait=retryTime(current.capture.lastError);
    if(wait===null){const error=new Error('Original native capture stopped with its complete response and continuation retained.');error.code='NATIVE_CAPTURE_FAILED';error.details=await captureSources(captureId,selectedHost);throw error;}
    await announce('NATIVE_RATE_LIMIT',{captureId,milliseconds:wait,error:current.capture.lastError});await delay(wait);
   }
   await invoke('capture/'+key+'/resume-'+current.capture.attemptCount,'capture.resume',{captureId},selectedHost);
   current=await selectedHost.invoke({method:'capture.read',args:{captureId,limit:1}});
  }
  if(singlePage){
   const original=current.capture.inflight?.args??{captureId};
   await invoke('capture/'+key+'/page-'+current.capture.attemptCount,'capture.next',original,selectedHost);
  }else{
   const original=current.capture.run?.args??{captureId};
   const result=await withProgress('capture '+key,()=>invoke('capture/'+key+'/run','capture.run',original,selectedHost));
   if(result.status==='COMPLETE')return captureSources(captureId,selectedHost);
  }
 }
}
async function originalSelection(name,make){
 const file=target('selections/'+name+'.json');if(await exists(file))return readJSON(file);
 const value=await make();await exact(file,json(value));return value;
}
async function completeSourceFile(sourceId,part='body',selectedHost=host){
 const chunks=[];let offset=0,descriptor;
 for(;;){
  const value=await selectedHost.invoke({method:'source.file',args:{sourceId,part,offset,length:1024*1024}}),body=Buffer.from(value.base64,'base64');
  need(value.offset===offset&&body.length===value.bytes,'Original source range changed.');
  if(descriptor)need(value.file.sha256===descriptor.sha256&&value.file.bytes===descriptor.bytes,'Original source descriptor changed.');else descriptor=value.file;
  chunks.push(body);offset+=body.length;if(value.eof)break;need(body.length>0,'Original source range did not advance.');
 }
 const body=Buffer.concat(chunks);need(body.length===descriptor.bytes&&digest(body)===descriptor.sha256,'Complete original source bytes differ.');
 return {body,file:descriptor};
}
async function nativeJSON(captureId,{kind}={}){
 const data=await captureSources(captureId);
 for(const sourceId of [...data.sourceIds].reverse()){
  const result=await sourceRows(sourceId);if(result.source.error||kind&&result.source.kind!==kind)continue;
  const original=await completeSourceFile(sourceId);
  return {sourceId,source:result.source,value:imports.native.parseRatingsJSON(original.body).value,rows:result.rows,body:original.body};
 }
 throw new Error('A successful complete original source response is required.');
}
function csvCell(value){const string=String(value??'');return /[",\r\n]/.test(string)?'"'+string.replaceAll('"','""')+'"':string;}


let registryId=null,activityRegistryId=null,policyId=null;
await step('original-registry-and-policy',async()=>{
 need(host,'Open the actual complete operator.');
 const registry=await invoke('registry/wallet','registry.save',{definition:registryDefinition});
 registryId=registry.registryId;state.registries.wallet=registryId;
 const activityDefinition=options['registry-file']?registryDefinition:{...registryDefinition,
  name:registryDefinition.name+' · tracked stablecoin daily activity',
  assets:registryDefinition.assets.filter(asset=>asset.assetType!=='native')};
 need(activityDefinition.assets.length>0,'Select an actual tracked activity asset.');
 const activity=await invoke('registry/activity','registry.save',{definition:activityDefinition});
 activityRegistryId=activity.registryId;state.registries.activity=activityRegistryId;
 const policy=await invoke('policy/original','policy.save',{definition:policyDefinition});
 policyId=policy.policyId;state.policies.original=policyId;await save();
 return {wallet:await host.invoke({method:'registry.read',args:{registryId}}),
  activity:await host.invoke({method:'registry.read',args:{registryId:activityRegistryId}}),
  policy:await host.invoke({method:'policy.read',args:{policyId}})};
});
registryId??=state.registries.wallet;activityRegistryId??=state.registries.activity;policyId??=state.policies.original;
const nativeSources={};
for(const [key,alias,read] of [
 ['bluechip-coins',connectionAliases.bluechip,{kind:'coins',filters:{}}],
 ['horizon-root',connectionAliases.horizon,{kind:'root',filters:{}}],
 ['bluechip-usdc-grade',connectionAliases.bluechip,{kind:'grade',filters:{coin:'USDC'}}]
]){
 const result=await step(key,async()=>{
  need(registryId,'Retain the actual registry first.');
  const captured=await capture(key,registryId,alias,read),original=await nativeJSON(captured.capture.id,{kind:read.kind});
  nativeSources[key]=original;
  return {...captured,originalValue:original.value,originalSourceId:original.sourceId,originalBody:{bytes:original.body.length,sha256:digest(original.body)}};
 });
 if(!result.error&&!nativeSources[key])try{nativeSources[key]=await nativeJSON(result.capture.id,{kind:read.kind});}catch{}
}
const extraSourceIds=[];
for(const [flag,kind] of [['prices-file','price'],['scores-file','score'],['methodology-file','methodology']]){
 if(!options[flag])continue;
 await step('original-'+kind+'-input',async()=>{
  const filename=path.resolve(options[flag]),body=await fs.readFile(filename);
  await exact(target('inputs/'+path.basename(filename)),body);
  const format=/\.csv$/i.test(filename)?'csv':'json';
  const result=await invoke('input/'+kind,'source.import',{registryId,provider:'source',kind,
   filename:path.basename(filename),format,sourceScope:'operator-selected-original-'+kind+'-'+digest(body),
   bodyBase64:body.toString('base64'),recordsPath:null,request:{source:'original-selected-file',filename:path.basename(filename),sha256:digest(body)}});
  extraSourceIds.push(result.sourceId);state.originalInputs??={};state.originalInputs[kind]=result.sourceId;await save();
  return {sourceId:result.sourceId,body:{bytes:body.length,sha256:digest(body)},records:result.source.selectedRecords,error:result.source.error??null};
 });
 if(state.originalInputs?.[kind]&&!extraSourceIds.includes(state.originalInputs[kind]))extraSourceIds.push(state.originalInputs[kind]);
}
if(state.originalInputs?.methodology){
 const original=await step('source-owned-methodology-policy',async()=>{
  const definition={...policyDefinition,methodologySourceIds:[...new Set([...(policyDefinition.methodologySourceIds??[]),state.originalInputs.methodology])]};
  const result=await invoke('policy/methodology','policy.save',{policyId,definition,expectedVersion:1});
  return {policyId:result.policyId,version:result.version};
 });
}
await step('original-address-and-asset-selection',async()=>{
 need(loaded?.stellar,'The original Stellar runtime must load before address and SAC selection.');
 const registry=await host.invoke({method:'registry.read',args:{registryId}});
 const source=await originalSelection('wallet-addresses',async()=>{
  if(options['addresses-file']){
   const filename=path.resolve(options['addresses-file']),bytes=await fs.readFile(filename);await exact(target('inputs/addresses.original'),bytes);
   let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{value=bytes.toString('utf8').split(/\r?\n/).map(row=>row.trim()).filter(Boolean);}
   const addresses=Array.isArray(value)?value:value.addresses;need(Array.isArray(addresses)&&addresses.length,'The original address file is empty.');
   return {addresses,source:{filename:path.basename(filename),bytes:bytes.length,sha256:digest(bytes)},observed:true};
  }
  const asset=registry.definition.assets.find(item=>item.assetType==='credit'&&item.enabled);
  need(asset,'Select an actual issued asset to discover a funded wallet.');
  const discovery=await capture('funded-holder-discovery',registryId,connectionAliases.stellarExpert,
   {kind:'holders',filters:{asset:asset.assetCode+'-'+asset.assetIssuer},pageSize:200},{singlePage:true});
  const data=await nativeJSON(discovery.capture.id,{kind:'holders'});
  const rows=data.value?data.value._embedded?.records??[]:[];
  const holder=rows.find(row=>typeof row.account==='string'&&loaded.stellar.StrKey.isValidEd25519PublicKey(row.account)&&
   row.account!==asset.assetIssuer&&BigInt(String(row.balance))>0n);
  need(holder,'The original holder response did not contain a funded G wallet.');
  const accountCapture=await capture('funded-wallet-original-account',registryId,connectionAliases.horizon,{kind:'account',filters:{account:holder.account}});
  const account=await nativeJSON(accountCapture.capture.id,{kind:'account'});
  need(account.value.account_id===holder.account&&Array.isArray(account.value.balances),'The discovered wallet does not match its original account response.');
  const balance=account.value.balances.find(row=>row.asset_code===asset.assetCode&&row.asset_issuer===asset.assetIssuer);
  need(balance&&Number(balance.balance)>0,'The discovered wallet no longer has a positive original selected asset balance.');
  const muxedId='1',baseAccount=new loaded.stellar.Account(holder.account,String(account.value.sequence)),
   muxed=new loaded.stellar.MuxedAccount(baseAccount,muxedId).accountId();
  return {addresses:[holder.account,muxed],holderSourceId:data.sourceId,accountSourceId:account.sourceId,
   assetId:asset.id,originalHolding:holder,originalAccount:holder.account,
   muxedView:{address:muxed,id:muxedId,kind:'original-sdk-address-view',underlyingAccount:holder.account},
   discoveryCaptureId:discovery.capture.id,discoveryContinuationRetained:true};
 });
 const prepared=await imports.native.prepareRatingsAccounts({addresses:source.addresses,registry,runtime:runtimeConfiguration});
 need(prepared.accounts.length===new Set(prepared.inputs.map(row=>row.account)).size,'Original G/M accounts were counted more than once.');
 state.walletSelection=source;state.preparedAccounts=prepared;await save();return {source,prepared};
});
async function reopenOriginalOperator(){
 if(host)await host.close();
 host=await imports.operator.openStellarRatingsOperator({workspaceDirectory,connections,applicationDirectory:P,runtime:runtimeConfiguration});
 return host;
}
async function runSources(runId,selectedHost=host){
 let offset=0,rows=[];
 for(;;){const current=await selectedHost.invoke({method:'run.read',args:{runId,offset,limit:1000}});
  rows.push(...current.sourceIds.rows);if(current.sourceIds.nextOffset===null)return [...new Set(rows)];
  offset=current.sourceIds.nextOffset;}
}
async function runTasks(runId,selectedHost=host){
 let offset=0,rows=[],run;
 for(;;){const current=await selectedHost.invoke({method:'run.read',args:{runId,offset,limit:1000}});run=current.run;rows.push(...current.tasks.rows);
  if(current.tasks.nextOffset===null)return {run,tasks:rows};offset=current.tasks.nextOffset;}
}
async function finishRun(key,runId,selectedHost=host){
 for(;;){
  let details=await runTasks(runId,selectedHost);
  if(details.run.status==='COMPLETE')return {run:details.run,tasks:details.tasks,editionId:details.run.editionId};
  const failed=details.tasks.filter(row=>row.status==='FAILED');
  if(details.run.status==='PARTIAL'){
   const retryable=failed.filter(row=>retryTime(row.error)!==null);
   if(retryable.length===0){
    const error=new Error('The full original review retained a partial source edition.');error.code='NATIVE_REVIEW_PARTIAL';error.details=details;throw error;
   }
   const wait=Math.max(...retryable.map(row=>retryTime(row.error)));await announce('NATIVE_RATE_LIMIT',{runId,milliseconds:wait});await delay(wait);
  }
  if(['PAUSED','PARTIAL','FAILED','WAITING_FOR_BOUNDARY'].includes(details.run.status)){
   if(details.run.status==='FAILED'&&retryTime(details.run.lastError)===null){
    const error=new Error('The original review retained a source planning failure.');error.code='NATIVE_REVIEW_FAILED';error.details=details;throw error;
   }
   if(details.run.status==='WAITING_FOR_BOUNDARY'){
    const error=new Error('The original source has not reached the selected UTC boundary.');error.code='WAITING_FOR_BOUNDARY';error.details=details;throw error;
   }
   await invoke('run/'+key+'/resume-'+(details.run.steps?.length??0)+'-'+(details.run.editionIds?.length??0),'run.resume',{runId},selectedHost);
   details=await runTasks(runId,selectedHost);
  }
  const original=details.run.execution?.args??{runId};
  const result=await withProgress('review '+key,()=>invoke('run/'+key+'/continue-'+(details.run.editionIds?.length??0),'run.continue',original,selectedHost));
  if(result.status==='COMPLETE')return {run:(await runTasks(runId,selectedHost)).run,editionId:result.editionId};
 }
}
await step('complete-original-wallet-review',async()=>{
 need(state.walletSelection?.addresses?.length,'Select original observed wallet addresses.');
 if(!state.runs.wallet){
  const started=await invoke('run/wallet/start','run.start',{kind:'wallet',registryId,policyId,addresses:state.walletSelection.addresses,
   connectionAliases,sourceIds:extraSourceIds,name:'Observed original wallet and native muxed view'});
  state.runs.wallet=started.runId;await save();
 }
 let current=await runTasks(state.runs.wallet);
 if(!state.walletRestart&&current.run.status==='READY'){
  await invoke('run/wallet/initial-planning','run.next',{runId:current.run.id});
  current=await runTasks(state.runs.wallet);
  const selected={id:current.run.id,phase:current.run.phase,tasks:current.tasks.map(row=>({id:row.id,captureId:row.captureId,read:row.read}))};
  if(!['COMPLETE','FAILED'].includes(current.run.status)){
   await invoke('run/wallet/pause-original','run.pause',{runId:current.run.id});
   await reopenOriginalOperator();
   const after=await runTasks(current.run.id);
   need(canonical(after.tasks.map(row=>({id:row.id,captureId:row.captureId,read:row.read})))===canonical(selected.tasks),'Original source tasks changed across operator reopen.');
   state.walletRestart={...selected,reopenedWorkspaceId:(await host.describe()).workspaceId};await save();
  }
 }
 const completed=await finishRun('wallet',state.runs.wallet),edition=await host.invoke({method:'edition.read',args:{editionId:completed.editionId}});
 need(edition.addresses.length===state.walletSelection.addresses.length,'The original input views were lost.');
 need(new Set(edition.accounts.map(row=>row.account)).size===edition.accounts.length,'Original canonical wallets are duplicated.');
 const lookup=await host.invoke({method:'lookup.read',args:{network:canonicalNetwork,limit:1000}}),popular=await host.invoke({method:'wallet.popular',args:{network:canonicalNetwork,limit:1000}});
 need(popular.wallets.every(row=>!Object.hasOwn(row,'count')),'Public ranks exposed the private lookup counter.');
 state.walletEditionId=edition.id;await save();
 return {editionId:edition.id,registryId:edition.registryId,policyId:edition.policyId,status:edition.status,
  addresses:edition.addresses,accounts:edition.accounts,holdings:edition.holdings,summary:edition.summary,coverage:edition.coverage,
  aggregate:edition.aggregate,lookup,popular,sourceIds:edition.sourceIds,originalRestart:state.walletRestart};
});
if(!state.walletEditionId&&state.runs.wallet){
 const value=await runTasks(state.runs.wallet).catch(()=>null);if(value?.run.editionId){state.walletEditionId=value.run.editionId;await save();}
}
await step('original-utc-collection-selection',async()=>{
 need(nativeSources['horizon-root'],'Retain the original Horizon network observation.');
 const value=await originalSelection('utc-collection',async()=>{
  const rootSource=nativeSources['horizon-root'],latest=Number(rootSource.value.history_latest_ledger);
  need(Number.isSafeInteger(latest)&&latest>0,'Original history latest ledger is invalid.');
  const captured=await capture('selected-original-head-ledger',activityRegistryId,connectionAliases.horizon,{kind:'ledger',filters:{ledger:latest}});
  const head=await nativeJSON(captured.capture.id,{kind:'ledger'}),closed=String(head.value.closed_at);
  need(Number.isFinite(Date.parse(closed)),'The original ledger close time is missing.');
  const date=options['activity-date']??new Date(Date.parse(closed.slice(0,10)+'T00:00:00.000Z')-86400000).toISOString().slice(0,10);
  need(/^\d{4}-\d{2}-\d{2}$/.test(date)&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,'Select a real original UTC activity date.');
  const to=new Date(Date.parse(date+'T00:00:00.000Z')+86400000).toISOString().slice(0,10);
  need(Date.parse(to+'T00:00:00.000Z')<=Date.parse(closed),'The actual ingested history has not reached the complete selected UTC day.');
  return {from:date,to,timeZone:'UTC',originalHead:{sourceId:head.sourceId,ledger:latest,closedAt:closed,networkSourceId:rootSource.sourceId}};
 });
 state.period=value;await save();
 const result=await invoke('collection/save','collection.save',{definition:{name:'Original complete UTC stablecoin activity',
  registryId:activityRegistryId,policyId,launchDate:value.from,timeZone:'UTC',cadence:'daily',connectionAliases,sourceIds:extraSourceIds,enabled:true}});
 state.collections.daily=result.collectionId;await save();return {collectionId:result.collectionId,period:value,definition:result.collection};
});
async function collectionDetails(selectedHost=host){
 return selectedHost.invoke({method:'collection.read',args:{collectionId:state.collections.daily,limit:1000}});
}
await step('complete-utc-collection-and-restart',async()=>{
 need(state.collections.daily&&state.period,'Select the full original UTC collection.');
 let current=await collectionDetails(),args=current.execution?.args??{collectionId:state.collections.daily,from:state.period.from,to:state.period.to};
 if(current.execution&&['PAUSED','FAILED','WAITING_FOR_BOUNDARY'].includes(current.execution.status))
  await invoke('collection/resume-'+digest(Buffer.from(canonical(current.execution))),'collection.resume',{collectionId:state.collections.daily});
 if(!state.collectionRestart){
  let completed=false,error=null,result=null;
  const running=withProgress('original complete daily collection',()=>invoke('collection/run','collection.run',args))
   .then(value=>{result=value;completed=true;},problem=>{error=problem;completed=true;});
  let held=null;
  while(!completed&&!controller.signal.aborted){
   await new Promise(resolve=>setTimeout(resolve,500));const selected=await collectionDetails();
   if(selected.execution?.pending?.runId){
    const run=await runTasks(selected.execution.pending.runId);
    const progressed=run.tasks.find(task=>task.status!=='COMPLETE')??null;
    const captureState=progressed?await host.invoke({method:'capture.read',args:{captureId:progressed.captureId,limit:1}}):null;
    if(captureState?.capture.attemptCount>0||run.run.phase==='PUBLISH'){
     held={executionId:selected.execution.id,runId:run.run.id,
      captures:run.tasks.map(task=>({id:task.captureId,read:task.read})),
      originalArguments:selected.execution.args};
     await invoke('collection/pause-original','collection.pause',{collectionId:state.collections.daily});break;
    }
   }
  }
  await running;if(error)throw error;
  if(held){
   const before=await runTasks(held.runId);held.cursors=[];
   for(const task of before.tasks){const value=await host.invoke({method:'capture.read',args:{captureId:task.captureId,limit:1}});held.cursors.push({captureId:task.captureId,nextRead:value.capture.nextRead,attemptCount:value.capture.attemptCount});}
   await reopenOriginalOperator();
   for(const selected of held.cursors){const value=await host.invoke({method:'capture.read',args:{captureId:selected.captureId,limit:1}});
    need(canonical(value.capture.nextRead)===canonical(selected.nextRead)&&value.capture.attemptCount===selected.attemptCount,'The retained original native cursor changed during operator restart.');}
   state.collectionRestart=held;await save();
   await invoke('collection/resume-original','collection.resume',{collectionId:state.collections.daily});
  }else{state.collectionRestart={completedBeforePause:true,result};await save();}
 }
 current=await collectionDetails();args=current.execution?.args??args;
 const result=await withProgress('complete original UTC collection',()=>invoke('collection/run','collection.run',args));
 if(result.status!=='COMPLETE'){const error=new Error('The original full daily operation remains resumable.');error.code='NATIVE_COLLECTION_INCOMPLETE';error.details={result,collection:await collectionDetails()};throw error;}
 const selected=await collectionDetails(),editions=[];
 for(const item of selected.execution?.results??[]){
  if(item.runId)await finishRun('collection-'+item.utcDate,item.runId);
  const latest=(await collectionDetails()).dates?.rows?.find(row=>row.utcDate===item.utcDate);
  const run=item.runId?await runTasks(item.runId):null;
  const editionId=run?.run.editionId??latest?.latestEditionId??item.editionId,edition=await host.invoke({method:'edition.read',args:{editionId}});
  const required=edition.sourceErrors?.filter(row=>row.required)??[];
  need(required.length===0,'The full UTC edition retains incomplete required original source tasks.',{editionId,required});
  need(edition.period.from===state.period.from+'T00:00:00.000Z'&&edition.period.to===state.period.to+'T00:00:00.000Z','The original complete UTC interval changed.');
  editions.push({editionId:edition.id,status:edition.status,period:edition.period,coverage:edition.coverage,
   coverageDetails:edition.coverageDetails,metricCount:edition.metrics.length,holderCount:edition.holders.length,sourceCount:edition.sourceIds.length});
 }
 need(editions.length>0,'The complete daily collection produced no original edition.');
 state.activityEditionIds=editions.map(row=>row.editionId);await save();
 return {result,editions,restart:state.collectionRestart};
});
if(state.collections.daily){
 const collection=await collectionDetails().catch(()=>null);
 if(collection){state.collectionLatest=collection.execution;await save();
  if(!state.activityEditionIds?.length){
   const rows=await allRows('editions',host,{kind:'activity'});state.activityEditionIds=rows.map(row=>row.id);await save();
  }
 }
}


await step('original-grade-csv-source-projection',async()=>{
 const grade=nativeSources['bluechip-usdc-grade'];need(grade?.value?.grade,'Retain the actual published grade before its CSV view.');
 const fields=['entity','symbol','grade','url','asOf'],values=['rating',grade.value.symbol,grade.value.grade,grade.value.url,grade.source.observedAt],
  body=Buffer.from(fields.join(',')+'\r\n'+values.map(csvCell).join(',')+'\r\n');
 await exact(target('observed/original-grade-fields.csv'),body);
 const result=await invoke('source/original-grade-csv','source.import',{registryId,provider:'source',kind:'rating',format:'csv',
  sourceScope:'derived-original-grade-fields:'+grade.sourceId,label:'CSV view of retained original Bluechip grade fields',
  filename:'original-grade-fields.csv',contentType:'text/csv',bodyBase64:body.toString('base64'),recordsPath:null,
  request:{source:'retained-original-field-export',originalSourceId:grade.sourceId,originalBodySha256:digest(grade.body),columns:fields}});
 const projected=await sourceRows(result.sourceId);
 need(projected.rows.length===1&&projected.rows[0].projection.grade===grade.value.grade&&projected.rows[0].projection.symbol===grade.value.symbol,
  'The actual retained grade fields changed during CSV parsing.');
 return {sourceId:result.sourceId,originalSourceId:grade.sourceId,bytes:body.length,sha256:digest(body),records:projected.rows};
});
await step('original-source-attribution-and-following-edition',async()=>{
 need(state.walletEditionId&&nativeSources['bluechip-usdc-grade'],'A retained actual wallet and grade source are required.');
 const edition=await host.invoke({method:'edition.read',args:{editionId:state.walletEditionId}}),
  registry=await host.invoke({method:'registry.read',args:{registryId,version:edition.registryVersion}});
 const asset=registry.definition.assets.find(row=>row.bluechipSymbol==='USDC');need(asset,'Select the actual issuer-qualified USDC registry entry.');
 let selected=null;
 for(const sourceId of edition.sourceIds){
  const result=await sourceRows(sourceId);
  const record=result.rows.find(row=>row.provider==='bluechip'&&row.projection.entity==='rating'&&row.projection.symbol==='USDC');
  if(record){selected={sourceId,record};break;}
 }
 need(selected,'The wallet edition does not contain the original case-sensitive USDC grade.');
 const decision=await invoke('decision/original-grade-issuer','decision.save',{registryId,registryVersion:edition.registryVersion,
  sourceId:selected.sourceId,recordId:selected.record.id,action:'map',mapping:{assetId:asset.id},actor:OPERATION,
  reason:'Bind the retained case-sensitive USDC agency record to the selected Circle issuer and Stellar network.'});
 const following=await invoke('review/attributed-original','wallet.review',{registryId,registryVersion:edition.registryVersion,
  policyId,policyVersion:edition.policyVersion,addresses:state.walletSelection.addresses,mode:'retained',sourceIds:edition.sourceIds,
  decisionIds:[decision.decisionId],asOf:edition.asOf,name:'Original wallet with explicit agency-to-issuer attribution'});
 need(following.editionId,'The following attribution edition was not published.',following);
 const compared=await host.invoke({method:'edition.compare',args:{leftEditionId:edition.id,rightEditionId:following.editionId,limit:1000}});
 const updated=await host.invoke({method:'edition.read',args:{editionId:following.editionId}});
 need(canonical(updated.holdings.map(row=>[row.account,row.assetKey,row.amountUnits]))===canonical(edition.holdings.map(row=>[row.account,row.assetKey,row.amountUnits])),
  'Attribution changed original ledger amounts.');
 state.correctedWalletEditionId=following.editionId;await save();
 return {decision,originalEditionId:edition.id,followingEditionId:following.editionId,comparison:compared,
  originalGrade:selected.record.projection.grade,originalSourceId:selected.sourceId};
});
const selectedEditions=[['wallet',state.walletEditionId],['wallet-attributed',state.correctedWalletEditionId],
 ...(state.activityEditionIds??[]).map((id,i)=>['activity-'+i,id])].filter(([_name,id])=>id);
for(const [name,editionId] of selectedEditions){
 await step('complete-report-'+name,async()=>{
  const edition=await host.invoke({method:'edition.read',args:{editionId}});
  const result=await invoke('report/'+name,'report.create',{editionId,name:'Original '+name+' commissioning report',formats:['html','csv','json']});
  state.reports[name]=result.reportId;await save();
  const outputs=[];
  for(const format of result.report.formats){
   let offset=0,member=null;const filename=target('reports/'+name+'/'+format),handle=await fs.open(filename+'.pending','w',0o600).catch(async error=>{
    if(error.code!=='ENOENT')throw error;await directory(path.dirname(filename));return fs.open(filename+'.pending','w',0o600);
   });
   try{
    for(;;){
     const value=await host.invoke({method:'report.file',args:{reportId:result.reportId,format,offset,length:4*1024*1024}}),
      body=Buffer.from(value.base64,'base64');
     if(member)need(member.sha256===value.file.sha256&&member.bytes===value.file.bytes,'Original report changed during complete download.');else member=value.file;
     need(value.offset===offset&&value.bytes===body.length,'Original report byte range differs.');await handle.writeFile(body);offset+=body.length;
     if(value.eof)break;need(body.length,'The complete report did not advance.');
    }
    await handle.sync();
   }finally{await handle.close();}
   const actual=await fullHash(filename+'.pending');need(actual.bytes===member.bytes&&actual.sha256===member.sha256,'The complete report source differs.');
   if(await exists(filename)){need((await fullHash(filename)).sha256===actual.sha256,'An earlier original report differs.');await fs.unlink(filename+'.pending');}
   else await fs.rename(filename+'.pending',filename);
   outputs.push({format,path:filename,...actual});
  }
  const jsonFile=outputs.find(row=>row.format==='json'),body=await readJSON(jsonFile.path);
  need(body.id===edition.id,'The complete JSON report lost original edition identity.');
  if(edition.kind==='wallet')need(body.holdings.length===edition.holdings.length,'Report only contains the visible wallet page.');
  else need(body.metrics.length===edition.metrics.length,'Report only contains the visible activity page.');
  return {reportId:result.reportId,editionId,outputs,scope:result.report.scope};
 });
}
await step('original-cli-state-and-report',async()=>{
 if(host){await host.close();host=null;}
 const described=await command('cli-workspace-state',process.execPath,[path.join(P,'cli.mjs'),'workspace-describe','--workspace',workspaceDirectory]);
 const selected=state.reports.wallet??Object.values(state.reports)[0];let download=null;
 if(selected){
  const filename=target('reports/native-cli-complete-report.csv');
  if(!await exists(filename))download=await command('cli-complete-report',process.execPath,[path.join(P,'cli.mjs'),'report-file',
   '--workspace',workspaceDirectory,'--report-id',selected,'--format','csv','--output',filename]);
  const actual=await fullHash(filename);download={...download,file:{path:filename,...actual}};
 }
 await reopenOriginalOperator();return {described,download};
});
if(!host&&imports.operator)await reopenOriginalOperator().catch(async error=>announce('OPERATOR_REOPEN_FAILED',{error:await safeError(error)}));
async function browserModule(){
 const attempts=[],explicit=options['playwright-module'];
 if(explicit){const value=await import(pathToFileURL(path.resolve(explicit)).href);return value.chromium?value:value.default;}
 const bases=[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,process.env.CODEX_PRIMARY_RUNTIME_ROOT,appRoot,root,
  '/workspace/scratch/64b7f381b23e/browser-runtime','/opt','/usr/local/lib'].filter(Boolean);
 for(const base of bases){
  for(const parent of [base,path.dirname(base)]){
   const require=createRequire(path.join(parent,'ratings-native-browser.cjs'));
   for(const name of ['playwright','playwright-core','@playwright/test']){
    try{const filename=require.resolve(name),module=await import(pathToFileURL(filename).href);if(module.chromium)return module;if(module.default?.chromium)return module.default;}
    catch(error){attempts.push({parent,name,code:error.code??error.name});}
   }
  }
 }
 const error=new Error('Select the actual installed Playwright module.');error.code='BROWSER_RUNTIME_REQUIRED';error.details={attempts};throw error;
}
async function browserExecutable(playwright){
 if(options['chromium-executable'])return path.resolve(options['chromium-executable']);
 const candidates=[playwright.chromium.executablePath(),process.env.CHROME_BIN,process.env.CHROMIUM_PATH,
  '/workspace/scratch/64b7f381b23e/browser-runtime/chrome-151.0.7922.34/chrome-linux64/chrome',
  '/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'];
 for(const filename of candidates.filter(Boolean))if(await exists(filename))return filename;
 const error=new Error('Select an actual installed Chromium executable.');error.code='BROWSER_EXECUTABLE_REQUIRED';error.details={candidates:candidates.filter(Boolean)};throw error;
}
async function browserJourney(server,{received=false,reportPackage=null}={}){
 const playwright=await browserModule(),executablePath=await browserExecutable(playwright);
 const browser=await playwright.chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']}),
  context=await browser.newContext({acceptDownloads:true,viewport:{width:1500,height:1000}}),page=await context.newPage(),errors=[];
 const label=received?'received':'original',result={received,workspaceId:server.startup.workspaceId,executablePath,visits:[],errors};
 page.on('pageerror',error=>errors.push(String(error)));
 await directory(target('browser'));
 try{
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#workspace-revision')?.textContent&&!document.querySelector('#workspace-revision').textContent.includes('Opening'));
  if(registryId)await page.selectOption('#active-registry',registryId);
  if(policyId)await page.selectOption('#active-policy',policyId);
  for(const panel of ['overview','registry','wallets','activity','sources','decisions','reports','receiving','requests']){
   await page.click('nav [data-page="'+panel+'"]');await page.locator('[data-panel="'+panel+'"]').waitFor({state:'visible'});
   result.visits.push({panel,text:await page.locator('[data-panel="'+panel+'"]').innerText()});
  }
  if(state.walletEditionId){
   await page.click('nav [data-page="wallets"]');
   const button=page.locator('[data-action="edition-open"][data-id="'+state.walletEditionId+'"]').first();
   if(await button.count())await button.click();
   else{
    const url=new URL(page.url());url.searchParams.set('page','wallets');url.searchParams.set('object','edition');url.searchParams.set('id',state.walletEditionId);
    await page.goto(url.href,{waitUntil:'domcontentloaded'});
   }
   await page.locator('#wallet-result table').first().waitFor({state:'visible'});
   result.wallet={editionId:state.walletEditionId,body:await page.locator('#wallet-result').innerText()};
  }
  if(state.activityEditionIds?.length){
   const editionId=state.activityEditionIds.at(-1);
   await page.click('nav [data-page="activity"]');
   const button=page.locator('[data-action="edition-open"][data-id="'+editionId+'"]').first();
   if(await button.count())await button.click();
   else{
    const url=new URL(page.url());url.searchParams.set('page','activity');url.searchParams.set('object','edition');url.searchParams.set('id',editionId);
    await page.goto(url.href,{waitUntil:'domcontentloaded'});
   }
   await page.locator('#activity-result table').first().waitFor({state:'visible'});
   result.activity={editionId,body:await page.locator('#activity-result').innerText()};
  }
  if(!received){
   await page.click('#profile-open');await page.locator('#profile-dialog').waitFor({state:'visible'});
   await page.fill('#profile-name','Bluechip original Stellar commissioning');await page.fill('#profile-operator',OPERATION);
   const profileResult=page.waitForResponse(response=>response.url().endsWith('/api/invoke')&&response.request().postDataJSON()?.method==='workspace.profile');
   await page.locator('#profile-form').getByRole('button',{name:'Save settings',exact:true}).click();
   const profile=await profileResult;need(profile.ok(),'The actual browser profile write failed.');result.profile=await profile.json();
   await page.locator('#profile-dialog').waitFor({state:'hidden'});
   let selectedSource=null;
   const sources=await allRows('sources',server.operator);
   for(const candidate of sources)if(candidate.provider==='bluechip'&&candidate.kind==='grade'&&!candidate.error){
    selectedSource=(await server.operator.invoke({method:'source.read',args:{sourceId:candidate.id,limit:1}})).source;break;
   }
   let body,provider,kind,scope,originalSourceId;
   if(selectedSource){
    body=(await completeSourceFile(selectedSource.id,'body',server.operator)).body;provider=selectedSource.provider;kind=selectedSource.kind;scope=selectedSource.sourceScope;originalSourceId=selectedSource.id;
   }else{
    body=await fs.readFile(path.join(P,'source','contracts.json'));provider='document';kind='published-native-contracts';scope='original-selected-application:'+digest(body);originalSourceId=null;
   }
   await exact(target('browser/original-upload.body'),body);
   await page.click('nav [data-page="sources"]');
   await page.selectOption('#source-provider',provider);await page.fill('#source-kind',kind);await page.fill('#source-scope',scope);
   await page.fill('#source-pointer','');await page.fill('#source-mapping','null');await page.fill('#source-label','Original source File recovery after committed response loss');
   await page.locator('#source-file').setInputFiles({name:'retained-original-source.json',mimeType:'application/json',buffer:body});
   let originalArgs=null,committed=null,resolveLost,rejectLost;
   const lost=new Promise((resolve,reject)=>{resolveLost=resolve;rejectLost=reject;});
   await page.route('**/api/sources/import',async route=>{
    try{
     originalArgs=JSON.parse(Buffer.from(route.request().headers()['x-ratings-source'],'base64').toString('utf8'));
     need(route.request().headers()['x-ratings-workspace-id']===server.startup.workspaceId,'Browser changed its original workspace identity.');
     const response=await route.fetch();committed=await response.json();
     need(response.ok()&&committed.sourceId,'The original File did not commit.');
     await route.abort('failed');resolveLost();
    }catch(error){rejectLost(error);await route.abort().catch(()=>{});}
   },{times:1});
   await page.locator('#source-form').getByRole('button',{name:'Retain complete original file',exact:true}).click();await lost;
   await page.waitForFunction(()=>document.querySelector('#requests-list')?.textContent.includes('UNCERTAIN'));
   const before=await server.operator.invoke({method:'request.status',args:{requestId:originalArgs.requestId}});
   need(before.record?.result?.sourceId===committed.sourceId,'The original native journal lost the committed source.');
   const replayRequest=page.waitForRequest(request=>request.url().endsWith('/api/sources/import'));
   await page.reload({waitUntil:'domcontentloaded'});
   const replay=await replayRequest,replayArgs=JSON.parse(Buffer.from(replay.headers()['x-ratings-source'],'base64').toString('utf8'));
   need(canonical(replayArgs)===canonical(originalArgs),'The reloaded browser changed the original File request.');
   await page.waitForFunction(id=>!document.querySelector('#requests-list [data-action="request-recover"][data-id="'+id+'"]'),originalArgs.requestId);
   await page.click('nav [data-page="requests"]');
   const after=await server.operator.invoke({method:'request.status',args:{requestId:originalArgs.requestId}});
   need(after.record?.result?.sourceId===committed.sourceId,'Reloading the original request created a different source.');
   const retained=await completeSourceFile(committed.sourceId,'body',server.operator);need(retained.body.equals(body),'Original source File bytes changed across browser recovery.');
   result.fileRecovery={requestId:originalArgs.requestId,sourceId:committed.sourceId,originalSourceId,bytes:body.length,sha256:digest(body)};
   if(await page.locator('#detail-dialog').isVisible())await page.click('#detail-close');
   await page.screenshot({path:target('browser/original-source-recovered.png'),fullPage:true});
  }
  const reportId=state.reports.wallet??Object.values(state.reports)[0];
  if(reportId){
   if(await page.locator('#detail-dialog').isVisible())await page.click('#detail-close');
   await page.click('nav [data-page="reports"]');
   const preview=page.locator('[data-action="report-preview"][data-id="'+reportId+'"]').first();await preview.waitFor({state:'visible'});
   await preview.click();await page.locator('#report-preview').waitFor({state:'visible'});
   await page.frameLocator('#report-preview').locator('h1').waitFor();
   result.report={reportId,title:await page.frameLocator('#report-preview').locator('h1').innerText()};
   await page.screenshot({path:target('browser/'+label+'-original-report.png'),fullPage:true});
  }
  if(reportPackage&&!received){
   await page.click('nav [data-page="receiving"]');
   await page.locator('#package-file').setInputFiles(reportPackage.archive.path);
   await page.fill('#package-upload-hash',reportPackage.manifestSha256);
   const completed=page.waitForResponse(response=>response.url().includes('/api/packages/unpack?'));
   await page.locator('#unpack-form').getByRole('button',{name:'Upload and open archive',exact:true}).click();
   const response=await completed;need(response.ok(),'The browser did not open the complete original report archive.');
   const unpacked=await response.json();await page.waitForFunction(value=>document.querySelector('#receive-source').value===value,unpacked.sourceDirectory);
   await page.fill('#receive-destination',target('browser-received-report'));
   const received=page.waitForResponse(response=>response.url().endsWith('/api/invoke')&&response.request().postDataJSON()?.method==='package.receive');
   await page.locator('#receive-form').getByRole('button',{name:'Receive complete installation',exact:true}).click();
   const reply=await received;need(reply.ok(),'The browser report receiving did not complete.');
   const delivery=await reply.json();need(delivery.report?.id===reportPackage.reportId,'Browser receiving changed original report identity.');
   result.reportReceiving={unpacked,delivery};
  }
  need(errors.length===0,'The actual browser raised an application error.',{errors});
  await context.tracing.stop({path:target('browser/'+label+'-trace.zip')});return result;
 }finally{await context.close();await browser.close();}
}


async function originalArchive(sourceDirectory,manifestSha256,filename){
 await directory(path.dirname(filename));
 if(!await exists(filename)){
  const pending=filename+'.pending-'+randomUUID();
  try{
   await pipeline(await imports.archive.streamRatingsDelivery({sourceDirectory,expectedManifestSha256:manifestSha256,signal:controller.signal}),
    createWriteStream(pending,{flags:'wx',mode:0o600}));
   const handle=await fs.open(pending,'r');try{await handle.sync();}finally{await handle.close();}
   await fs.rename(pending,filename);
   const parent=await fs.open(path.dirname(filename),'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await fs.unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 }
 return {path:filename,...await fullHash(filename)};
}
const reportDeliveries={};
for(const [name,reportId] of Object.entries(state.reports)){
 const result=await step('scoped-original-report-package-'+name,async()=>{
  const exported=await invoke('export/report-'+name,'report.export',{reportId,destination:target('deliveries/report-'+name)});
  const original=await imports.receiving.inspectRatingsDelivery({sourceDirectory:exported.directory,expectedManifestSha256:exported.manifestSha256}),
   manifest=original.manifest;
  need(manifest.kind==='report'&&manifest.reportId===reportId&&manifest.runtimes.length===0&&
   !manifest.files.some(file=>file.role==='workspace'||file.role==='runtime'),'The scoped report package contains another source selection.');
  const archive=await originalArchive(exported.directory,exported.manifestSha256,target('artifacts/bluechip-report-'+name+'.tar.gz'));
  const unpacked=await imports.archive.unpackRatingsDelivery({input:createReadStream(archive.path),destination:target('unpacked-report-'+name),
   expectedManifestSha256:exported.manifestSha256,signal:controller.signal});
  const receive=await originalSelection('report-receive-'+name,()=>({sourceDirectory:unpacked.sourceDirectory,destination:target('received-report-'+name),
   requestId:randomUUID(),expectedManifestSha256:exported.manifestSha256}));
  const delivered=await imports.receiving.receiveRatingsDelivery(receive);
  need(delivered.report?.id===reportId&&delivered.workspace===null,'Independent report receiving changed its original scope.');
  const report=await host.invoke({method:'report.read',args:{reportId}});
  for(const member of report.files){
   const originalMember=manifest.files.find(file=>file.path==='report/'+member.filename);
   need(originalMember?.sha256===member.sha256&&originalMember.bytes===member.bytes,'The complete report member was not delivered.',{format:member.format});
  }
  return {...exported,archive,received:delivered,manifest};
 });
 if(!result.error)reportDeliveries[name]=result;
}
if(state.period?.to===new Date().toISOString().slice(0,10)&&state.activityEditionIds?.length&&
 state.steps['complete-utc-collection-and-restart']?.status==='COMPLETE'){
 await step('original-daily-worker-handoff',async()=>{
  need(imports.worker,'The original daily worker must import.');
  const before=await host.describe(),selected=await collectionDetails(),events=[],workerControl=new AbortController();
  const stop=()=>workerControl.abort(controller.signal.reason);controller.signal.addEventListener('abort',stop,{once:true});
  let watchdog;
  try{
   await invoke('worker/enable','workspace.profile',{profile:{...before.profile,collectDaily:true}});
   watchdog=setTimeout(()=>workerControl.abort(new Error('Retained daily handoff did not return an outcome.')),60000);
   const result=await imports.worker.runRatingsCollectionsWorker({operator:host,signal:workerControl.signal,intervalMs:1000,
    onEvent:event=>{events.push(event);void announce('ORIGINAL_DAILY_WORKER',event);workerControl.abort();}});
   need(events.some(event=>event.type==='daily-collection'&&event.status==='COMPLETE'),
    'The original daily worker has not acknowledged the already completed native collection.',{events,result});
   const current=await collectionDetails();
   need(canonical(current.dates.rows.map(row=>[row.utcDate,row.latestEditionId]))===
    canonical(selected.dates.rows.map(row=>[row.utcDate,row.latestEditionId])),
    'Daily replay replaced the selected complete original activity editions.');
   return {result,events,originalDates:current.dates.rows};
  }finally{
   clearTimeout(watchdog);controller.signal.removeEventListener('abort',stop);
   const current=await host.describe();
   await invoke('worker/disable','workspace.profile',{profile:{...current.profile,collectDaily:false}});
  }
 });
}
let sourceServer=null;
async function openSourceServer(){
 if(host){await host.close();host=null;}
 need(imports.server,'The complete server source must import.');
 sourceServer=await imports.server.startStellarRatingsServer({workspaceDirectory,connections,host:'127.0.0.1',port:0,
  connectionsFile:target('private-connections.json'),deliveryDirectory:target('http-inbox'),
  runtime:runtimeConfiguration,applicationDirectory:P,collectDaily:false});
 host=sourceServer.operator;return sourceServer;
}
await step('original-server-startup',async()=>{
 const server=await openSourceServer();
 return {startup:{...server.startup,url:undefined},methods:server.operator.methods(),sourceDirectory:P};
});
if(!sourceServer&&imports.server)try{await openSourceServer();}
catch(error){await announce('SERVER_UNAVAILABLE',{error:await safeError(error)});}
function serverAuthentication(server){
 const token=new URL(server.url).hash.slice('#token='.length);
 need(/^[A-Za-z0-9_-]{43}$/.test(token),'The original server startup token format differs.');
 return {Authorization:'Bearer '+token};
}
async function originalHTTP(key,server,route,{method='GET',body=null,headers={}}={}){
 safeRelative(key);need(server,'The native HTTP operator must be running.');
 const attempt=randomUUID(),base='http/'+key+'/'+attempt;
 const wire=body===null?null:Buffer.isBuffer(body)?body:Buffer.from(json(body));
 await exact(target(base+'.request.json'),json({method,route,headers:Object.fromEntries(Object.entries(headers).filter(([key])=>!/^authorization$/i.test(key))),
  bodySha256:wire?digest(wire):null,bytes:wire?.length??0}));
 if(wire)await exact(target(base+'.request.body'),wire);
 const response=await fetch(server.startup.origin+route,{method,headers:{...serverAuthentication(server),...(wire?{'Content-Type':'application/json'}:{}),...headers},
  ...(wire?{body:wire}:{}),signal:controller.signal,redirect:'error'}),bytes=Buffer.from(await response.arrayBuffer());
 await exact(target(base+'.response.body'),bytes);
 await exact(target(base+'.response.json'),json({status:response.status,headers:Object.fromEntries(response.headers),
  bytes:bytes.length,sha256:digest(bytes)}));
 let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{value=null;}
 if(!response.ok){
  const error=new Error(value?.error?.message??'The original HTTP request returned '+response.status);
  error.code=value?.error?.code??'HTTP_'+response.status;error.details={status:response.status,bodyFile:base+'.response.body',value};throw error;
 }
 return {status:response.status,headers:Object.fromEntries(response.headers),value,body:bytes,bodySha256:digest(bytes),bodyFile:base+'.response.body'};
}
await step('native-http-wallet-commissioning',async()=>{
 need(sourceServer&&state.walletEditionId,'The original wallet edition and native server are required.');
 const bootstrap=await originalHTTP('bootstrap',sourceServer,'/api/bootstrap');
 need(bootstrap.value.state.workspaceId===sourceServer.startup.workspaceId,'HTTP bootstrap changed its original workspace identity.');
 const edition=await host.invoke({method:'edition.read',args:{editionId:state.correctedWalletEditionId??state.walletEditionId}});
 let args=await originalSelection('native-http-wallet-review',()=>({registryId:edition.registryId,registryVersion:edition.registryVersion,
  policyId:edition.policyId,policyVersion:edition.policyVersion,addresses:state.walletSelection.addresses,mode:'retained',
  sourceIds:edition.sourceIds,decisionIds:edition.decisionIds??[],asOf:edition.asOf,name:'Native wallet API using the retained original source',
  requestId:randomUUID(),expectedRevision:bootstrap.value.state.revision}));
 let result;
 for(;;){
  try{result=await originalHTTP('wallet-review',sourceServer,'/stellar/wallet-ratings',{method:'POST',body:args,
    headers:{'X-Ratings-Workspace-ID':sourceServer.startup.workspaceId,'Idempotency-Key':args.requestId}});break;}
  catch(error){if(error.code!=='REVISION_CONFLICT')throw error;args={...args,expectedRevision:(await host.describe()).revision};}
 }
 need(result.value.review?.id&&result.value.runId,'The native wallet route did not return the complete retained edition.',result.value);
 const replay=await originalHTTP('wallet-review-replay',sourceServer,'/stellar/wallet-ratings',{method:'POST',body:args,
  headers:{'X-Ratings-Workspace-ID':sourceServer.startup.workspaceId,'Idempotency-Key':args.requestId}});
 need(replay.value.runId===result.value.runId&&replay.value.review.id===result.value.review.id,'The original HTTP retry created another wallet review.');
 const resumed=await originalHTTP('wallet-review-status',sourceServer,'/stellar/wallet-ratings/reviews/'+result.value.runId);
 need(resumed.value.review?.id===result.value.review.id,'Native review status lost the original published result.');
 const popular=await originalHTTP('wallet-public-ranks',sourceServer,'/stellar/wallet-ratings/popular?network='+encodeURIComponent(canonicalNetwork)+'&limit=1000');
 need(Array.isArray(popular.value.wallets)&&popular.value.wallets.every(row=>!Object.hasOwn(row,'count')&&!Object.hasOwn(row,'lookupCount')),
  'The public wallet route exposed private lookup counters.');
 state.httpWalletEditionId=result.value.review.id;await save();
 return {workspaceId:bootstrap.value.state.workspaceId,requestId:args.requestId,runId:result.value.runId,editionId:result.value.review.id,
  reportStatus:result.value.review.status,canonicalAccounts:result.value.review.accounts,publicRanks:popular.value,bodyFile:result.bodyFile};
});
await step('actual-original-browser-and-file-recovery',async()=>browserJourney(sourceServer,{
 reportPackage:reportDeliveries.wallet??Object.values(reportDeliveries)[0]}));
await step('native-http-complete-original-report',async()=>{
 const reportId=state.reports.wallet??Object.values(state.reports)[0];need(sourceServer&&reportId,'An original report and native server are required.');
 const report=await host.invoke({method:'report.read',args:{reportId}}),results=[];
 for(const member of report.files){
  const result=await originalHTTP('report-'+reportId+'-'+member.format,sourceServer,'/api/reports/'+reportId+'/files/'+member.format);
  need(result.body.length===member.bytes&&result.bodySha256===member.sha256,'HTTP report delivery changed the complete original member.',{format:member.format});
  results.push({format:member.format,bytes:result.body.length,sha256:result.bodySha256,bodyFile:result.bodyFile});
 }
 return {reportId,files:results};
});
const whole=await step('complete-original-workspace-export',async()=>{
 need(host,'The original workspace must be open.');
 const args={destination:target('deliveries/workspace')},
  result=await invoke('export/whole-original','workspace.export',args),before=await host.describe();
 await invoke('export/live-progress','workspace.profile',{profile:{...before.profile,collectDaily:false,deliveryOperation:OPERATION}});
 const replay=await invoke('export/whole-original','workspace.export',args);
 need(replay.exportId===result.exportId&&replay.manifestSha256===result.manifestSha256&&replay.sourceRevision===result.sourceRevision,
  'Retrying a complete original export selected later live workspace content.');
 const inspection=await imports.receiving.inspectRatingsDelivery({sourceDirectory:result.directory,expectedManifestSha256:result.manifestSha256});
 need(inspection.manifest.workspaceId===before.workspaceId,'The original complete workspace identity changed.');
 const archive=await originalArchive(result.directory,result.manifestSha256,target('artifacts/bluechip-complete-workspace.tar.gz'));
 return {...result,manifest:inspection.manifest,archive};
});
if(!whole.error){
 await step('native-http-whole-original-archive',async()=>{
  need(sourceServer,'The source HTTP operator must be running.');
  const response=await fetch(sourceServer.startup.origin+'/api/packages/'+whole.exportId+'/archive',
   {headers:serverAuthentication(sourceServer),signal:controller.signal,redirect:'error'});
  need(response.ok&&response.body,'The native complete archive download did not open.',{status:response.status});
  need(response.headers.get('x-ratings-manifest-sha256')===whole.manifestSha256,'The native archive lost its selected source manifest.');
  const filename=target('artifacts/bluechip-complete-workspace-http.tar.gz'),pending=filename+'.pending-'+randomUUID();
  try{await pipeline(response.body,createWriteStream(pending,{flags:'wx',mode:0o600}));await fs.rename(pending,filename);}
  finally{await fs.unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  const request=await originalSelection('http-whole-unpack',()=>({requestId:randomUUID(),expectedManifestSha256:whole.manifestSha256}));
  const opened=await fetch(sourceServer.startup.origin+'/api/packages/unpack?requestId='+request.requestId+'&manifestSha256='+whole.manifestSha256,
   {method:'POST',headers:{...serverAuthentication(sourceServer),'Content-Type':'application/gzip',
    'X-Ratings-Workspace-ID':sourceServer.startup.workspaceId,'X-Ratings-Manifest-SHA256':whole.manifestSha256},
    body:createReadStream(filename),duplex:'half',signal:controller.signal,redirect:'error'});
  const body=Buffer.from(await opened.arrayBuffer());await exact(target('http/whole-unpack-original.body'),body);
  need(opened.ok,'The native uploaded complete archive did not reopen.',{status:opened.status,body:body.toString('utf8')});
  const value=JSON.parse(body.toString('utf8'));
  need(value.manifestSha256===whole.manifestSha256&&value.manifest.workspaceId===whole.sourceWorkspaceId,
   'The uploaded original full workspace changed identity.');
  return {archive:{path:filename,...await fullHash(filename)},unpacked:value};
 });
}
let received=null;
if(!whole.error){
 received=await step('complete-independent-workspace-receiving',async()=>{
  const unpacked=await imports.archive.unpackRatingsDelivery({input:createReadStream(whole.archive.path),destination:target('unpacked-workspace'),
   expectedManifestSha256:whole.manifestSha256,signal:controller.signal});
  const args=await originalSelection('whole-workspace-receive',()=>({sourceDirectory:unpacked.sourceDirectory,destination:target('received-workspace'),
   requestId:randomUUID(),expectedManifestSha256:whole.manifestSha256}));
  const result=await imports.receiving.receiveRatingsDelivery(args),replay=await imports.receiving.receiveRatingsDelivery(args);
  need(result.workspace.workspaceId===whole.sourceWorkspaceId&&replay.workspace.workspaceId===result.workspace.workspaceId&&replay.replayed,
   'Independent native receiving changed the retained workspace or replay identity.');
  need(canonical(result.runtimes.map(row=>[row.id,row.manifestSha256]).sort())===
   canonical(whole.runtimes.map(row=>[row.id,row.manifestSha256]).sort()),'The complete original runtime closure did not arrive.');
  need(result.application?.cli&&result.application?.server,'The full runnable original application did not arrive.');
  for(const selected of result.runtimes){
   const actual=await imports.runtime.verifyRatingsRuntime({directory:selected.directory,expectedManifestSha256:selected.manifestSha256});
   need(actual.id===selected.id,'The received original runtime differs.');
  }
  return result;
 });
}
if(sourceServer){await sourceServer.close();sourceServer=null;host=null;}
else if(host){await host.close();host=null;}
let receivedServer=null;
if(received&&!received.error){
 await step('received-original-native-cli',async()=>command('received-cli-describe',process.execPath,
  [received.application.cli,'workspace-describe','--workspace',received.workspace.directory]));
 await step('received-complete-original-source-reopen',async()=>{
  const module=await import(pathToFileURL(received.application.server).href),runtimeRow=received.runtimes.find(row=>row.id===state.runtime?.id)??received.runtimes[0],
   receivedRuntime=runtimeRow?{runtimeDirectory:runtimeRow.directory,expectedManifestSha256:runtimeRow.manifestSha256,
    retained:received.runtimes.map(row=>({id:row.id,runtimeDirectory:row.directory,expectedManifestSha256:row.manifestSha256}))}:{},
   receivedConnections=JSON.parse(JSON.stringify(connections));
  for(const connection of Object.values(receivedConnections))if(connection.provider==='stellar'){
   const originalRuntime=connection.runtime??{},matching=received.runtimes.find(row=>row.manifestSha256===originalRuntime.expectedManifestSha256)??runtimeRow;
   if(matching)connection.runtime={...receivedRuntime,runtimeDirectory:matching.directory,expectedManifestSha256:matching.manifestSha256};
  }
  receivedServer=await module.startStellarRatingsServer({workspaceDirectory:received.workspace.directory,connections:receivedConnections,
   expectedWorkspaceId:received.workspace.workspaceId,host:'127.0.0.1',port:0,runtime:receivedRuntime,
   applicationDirectory:path.dirname(received.application.server),deliveryDirectory:target('received-http-inbox'),collectDaily:false});
  const selected=await receivedServer.operator.describe();
  need(selected.workspaceId===whole.sourceWorkspaceId&&selected.revision>=whole.sourceRevision,'The received operator did not open its original workspace.');
  const originalState=await readJSON(path.join(whole.directory,'workspace','state.json')),
   captureRows=await allRows('captures',receivedServer.operator),runRows=await allRows('runs',receivedServer.operator),
   editions=await allRows('editions',receivedServer.operator),sources=await allRows('sources',receivedServer.operator);
  need(canonical(sources.map(row=>row.id).sort())===canonical(Object.keys(originalState.sources).sort()),'Independent receiving lost retained source pages.');
  need(canonical(editions.map(row=>row.id).sort())===canonical(Object.keys(originalState.editions).sort()),'Independent receiving lost original edition identities.');
  for(const row of captureRows){
   const original=originalState.captures[row.id];need(original,'The receiving capture was not in the selected original source.');
   need(canonical(row.nextRead)===canonical(original.nextRead),'Receiving changed an original native continuation.',{captureId:row.id});
   if(!['COMPLETE','CANCELED'].includes(original.status))need(row.paused===true||row.status==='PAUSED','An unfinished received capture retained active ownership.',{captureId:row.id});
  }
  for(const row of runRows)if(!['COMPLETE','CANCELED','PARTIAL'].includes(originalState.runs[row.id]?.status))
   need(row.paused===true||row.status==='PAUSED','An unfinished received review retained active ownership.',{runId:row.id});
  return {workspaceId:selected.workspaceId,revision:selected.revision,sourceIds:sources.map(row=>row.id),editionIds:editions.map(row=>row.id),
   captures:captureRows.map(row=>({id:row.id,status:row.status,paused:row.paused,nextRead:row.nextRead})),
   runtime:receivedRuntime,applicationDirectory:received.application.directory,startup:{...receivedServer.startup,url:undefined}};
 });
 if(!receivedServer&&imports.server){
  const module=await import(pathToFileURL(received.application.server).href),selected=received.runtimes.find(row=>row.id===state.runtime?.id)??received.runtimes[0],
   receivedRuntime=selected?{runtimeDirectory:selected.directory,expectedManifestSha256:selected.manifestSha256,
    retained:received.runtimes.map(row=>({id:row.id,runtimeDirectory:row.directory,expectedManifestSha256:row.manifestSha256}))}:{},
   receivedConnections=JSON.parse(JSON.stringify(connections));
  for(const connection of Object.values(receivedConnections))if(connection.provider==='stellar')connection.runtime=receivedRuntime;
  try{receivedServer=await module.startStellarRatingsServer({workspaceDirectory:received.workspace.directory,connections:receivedConnections,
   expectedWorkspaceId:received.workspace.workspaceId,port:0,runtime:receivedRuntime,
   applicationDirectory:path.dirname(received.application.server),collectDaily:false});}
  catch(error){await announce('RECEIVED_OPERATOR_UNAVAILABLE',{error:await safeError(error)});}
 }
 await step('received-actual-browser-and-report',async()=>browserJourney(receivedServer,{received:true}));
 await step('received-original-ledger-and-retained-review-continuation',async()=>{
  need(receivedServer&&state.walletEditionId,'The received original wallet workspace must be open.');
  const selectedHost=receivedServer.operator,original=await selectedHost.invoke({method:'edition.read',args:{editionId:state.correctedWalletEditionId??state.walletEditionId}});
  const reviewed=await invoke('received/wallet-following','wallet.review',{registryId:original.registryId,registryVersion:original.registryVersion,
   policyId:original.policyId,policyVersion:original.policyVersion,addresses:state.walletSelection.addresses,mode:'retained',
   sourceIds:original.sourceIds,decisionIds:original.decisionIds??[],asOf:original.asOf,name:'Independent received source wallet continuation'},selectedHost);
  need(reviewed.editionId,'The independently reconstructed runtime did not produce a retained-source wallet result.',reviewed);
  const edition=await selectedHost.invoke({method:'edition.read',args:{editionId:reviewed.editionId}});
  need(canonical(edition.holdings.map(row=>[row.account,row.assetKey,row.amountUnits]))===
   canonical(original.holdings.map(row=>[row.account,row.assetKey,row.amountUnits])),
   'The received original wallet calculation changed retained ledger amounts.');
  const selected=(await allRows('captures',selectedHost)).find(row=>row.provider==='stellar-expert'&&row.nextRead&&
   ['PAUSED','FAILED'].includes(row.status)&&row.id===state.walletSelection?.discoveryCaptureId);
  let continued=null;
  if(selected){
   const before=await selectedHost.invoke({method:'capture.read',args:{captureId:selected.id,limit:1}});
   await invoke('received/original-holder-resume','capture.resume',{captureId:selected.id},selectedHost);
   const next=await invoke('received/original-holder-next','capture.next',before.capture.inflight?.args??{captureId:selected.id},selectedHost),
    after=await selectedHost.invoke({method:'capture.read',args:{captureId:selected.id,limit:1}});
   need(after.capture.attemptCount>before.capture.attemptCount,'The original received cursor did not continue its actual provider read.');
   if(after.capture.status!=='COMPLETE')await invoke('received/original-holder-pause','capture.pause',{captureId:selected.id},selectedHost);
   continued={captureId:selected.id,originalRead:before.capture.nextRead,result:next,followingRead:after.capture.nextRead};
   need(!after.capture.lastError,'The received original source continuation retained a provider failure.',continued);
  }
  return {originalEditionId:original.id,followingEditionId:edition.id,runtime:edition.runtime,heldOriginalCursor:continued};
 });
 if(receivedServer){await receivedServer.close();receivedServer=null;}
}
let finalState=null,history=null,nativeCaptureOutcomes=[];
await step('complete-native-final-state',async()=>{
 const current=await imports.operator.openStellarRatingsOperator({workspaceDirectory,connections,applicationDirectory:P,runtime:runtimeConfiguration});
 try{
  finalState=await current.describe();const pages=[];let offset=0;
  for(;;){const value=await current.invoke({method:'workspace.history',args:{offset,limit:1000}});pages.push(value);
   if(value.nextOffset===null||value.nextOffset===undefined)break;need(value.nextOffset>offset,'Original history did not advance.');offset=value.nextOffset;}
  history={pages};
  nativeCaptureOutcomes=(await allRows('captures',current)).map(row=>({id:row.id,provider:row.provider,status:row.status,
   sourceCount:row.sourceCount,attemptCount:row.attemptCount,nextRead:row.nextRead,error:row.lastError}));
  await replace(target('final-workspace-description.json'),finalState);await replace(target('final-history.json'),history);
  return {workspaceId:finalState.workspaceId,revision:finalState.revision,counts:finalState.counts,nativeCaptureOutcomes};
 }finally{await current.close();}
},{repeat:true});
await exact(target('operate-stellar-ratings.mjs'),await fs.readFile(fileURLToPath(import.meta.url)));
const report={schema:'stellar-forge.stellar-ratings.native-outcome.v1',operation:OPERATION,operationId:state.id,
 startedAt:state.createdAt,finishedAt:new Date().toISOString(),node:process.version,source:original,runtime:state.runtime,
 registryId,activityRegistryId,policyId,addresses:state.walletSelection??null,period:state.period??null,steps:state.steps,
 nativeCaptureOutcomes,reports:state.reports,
 workspace:finalState?{directory:workspaceDirectory,id:finalState.workspaceId,revision:finalState.revision,counts:finalState.counts}:null,
 wholeDelivery:whole.error?whole:{exportId:whole.exportId,manifestSha256:whole.manifestSha256,sourceRevision:whole.sourceRevision,
  files:whole.files,bytes:whole.bytes,archive:whole.archive},
 received:received?.error?received:received?{directory:received.directory,workspace:received.workspace,runtimes:received.runtimes}:null,
 completed:Object.values(state.steps).filter(row=>row.status==='COMPLETE').length,
 failed:Object.entries(state.steps).filter(([_name,row])=>row.status==='FAILED').map(([name,row])=>({name,error:row.error}))};
await replace(target('native-outcome.json'),report);
const supportNames=['operate-stellar-ratings.mjs','source-carrier.json','native-outcome.json','operation.json','progress.jsonl',
 'application-source-manifest.json','results','commands','requests','request-attempts','responses','http','observed','selections','inputs','reports','browser',
 'final-workspace-description.json','final-history.json'];
const available=[];for(const name of supportNames)if(await exists(target(name)))available.push(name);
await directory(target('artifacts'));
const supportFiles=[];
async function supportMembers(relative){
 const filename=target(relative),stat=await fs.lstat(filename);
 if(stat.isDirectory()){for(const name of (await fs.readdir(filename)).sort())await supportMembers(relative+'/'+name);}
 else if(stat.isFile())supportFiles.push(relative);
}
for(const name of available)await supportMembers(name);
await exact(target('native-support-members.nul'),Buffer.from(supportFiles.join('\0')+'\0'));
try{await command('preserve-native-support','tar',['-czf',target('artifacts/bluechip-native-operation.tar.gz'),'-C',root,'--null','-T',target('native-support-members.nul')]);}
catch(error){await announce('SUPPORT_ARCHIVE_FAILED',{error:await safeError(error)});}
const artifacts=[];
for(const name of await fs.readdir(target('artifacts'))){
 const filename=target('artifacts/'+name);if((await fs.lstat(filename)).isFile())artifacts.push({name,path:filename,...await fullHash(filename)});
}
artifacts.push({name:'native-outcome.json',path:target('native-outcome.json'),...await fullHash(target('native-outcome.json'))});
await replace(target('artifacts.json'),artifacts);
await announce('NATIVE_OUTCOME',{operation:OPERATION,operationId:state.id,completed:report.completed,failed:report.failed,
 workspace:report.workspace,artifacts});
process.exitCode=report.failed.length?1:0;
if(options['courier-stdin']==='true'){
 const {createInterface}=await import('node:readline'),reader=createInterface({input:process.stdin,crlfDelay:Infinity});
 await announce('COURIER_READY',{artifacts});
 for await(const line of reader){
  try{
   const request=JSON.parse(line);if(request.action==='finish'){reader.close();break;}
   const artifact=artifacts.find(row=>row.name===request.name);need(artifact,'Select an original produced artifact.');
   if(request.action==='upload'){
    const url=new URL(request.url);need(url.protocol==='https:','Use the provided HTTPS artifact upload URL.');
    const response=await fetch(url,{method:request.method??'POST',headers:{'Content-Type':'application/octet-stream',
     'Content-Length':String(artifact.bytes),...(request.headers??{})},body:createReadStream(artifact.path),duplex:'half',redirect:'error'});
    const body=await response.text(),result={name:artifact.name,bytes:artifact.bytes,sha256:artifact.sha256,status:response.status,response:body};
    await replace(target('courier/'+artifact.name+'.json'),result);process.stdout.write(JSON.stringify({event:'COURIER_UPLOADED',...result})+'\n');
   }else if(request.action==='range'){
    const offset=Number(request.offset??0),length=Number(request.length??196608);
    need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(length)&&length>0&&length<=1048576,'Select a valid original file range.');
    const handle=await fs.open(artifact.path,'r'),buffer=Buffer.alloc(Math.min(length,Math.max(0,artifact.bytes-offset)));
    try{const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);
     process.stdout.write(JSON.stringify({event:'COURIER_RANGE',name:artifact.name,offset,bytes:bytesRead,
      complete:offset+bytesRead>=artifact.bytes,sha256:artifact.sha256,base64:buffer.subarray(0,bytesRead).toString('base64')})+'\n');}
    finally{await handle.close();}
   }else throw new Error('Select upload, range or finish.');
  }catch(error){process.stdout.write(JSON.stringify({event:'COURIER_ERROR',error:await safeError(error)})+'\n');}
 }
}
} finally {await releaseNativeLock();}
