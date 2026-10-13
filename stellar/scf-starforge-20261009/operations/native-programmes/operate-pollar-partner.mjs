// MIT. Complete original Pollar SDK, customer/operator, runtime and independent receiving journey.
// Provider actions use the owner's original configuration; no SDK, auth or signing protocol is replaced.
import * as fs from 'node:fs/promises';
import {constants,createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createInterface} from 'node:readline';

const PREFIX='stellar/scf-starforge-20261009/sf30-seller-sdk/pollar-partner';
const OPERATION='POLLAR-NATIVE-6BBB-20261012';
const SDK_VERSION='0.12.0-rc.1',NPM_VERSION='10.9.4';
const argv=process.argv.slice(2),options={};
for(let i=0;i<argv.length;i++){
 const key=argv[i];if(!/^--[a-z][a-z0-9-]*$/.test(key)||i+1>=argv.length)throw new Error('Supply --name value arguments.');
 if(Object.hasOwn(options,key.slice(2)))throw new Error('Repeated option '+key);
 options[key.slice(2)]=argv[++i];
}
const allowed=new Set(['source-packet','source-directory','operation-directory','configuration-file','customer-plan-file','operator-plan-file','npm-executable','playwright-module','chromium-executable','runtime-directory','installation-directory','runtime-manifest-sha256','manifest-sha256','courier-stdin','node-heap-mb','port','browser-user-data-directory','protocol-programme']);
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
let activeGeneration=null;
const sharedNames=new Set(['operation.json','progress.jsonl','native-operation.lock','tmp','npm-cache','bun-cache',
 'sdk-installation','runtime-original','runtime-received','runtime-regular-files','npm-bootstrap','private',
 'workspace','inputs','observed','source-history','applications','generations']);
function target(relative){
 const parts=safeRelative(relative).split('/'),head=parts[0];
 const shared=sharedNames.has(head)||head.startsWith('stale-native-lock-')||
  (head==='requests'&&!['export','received','http'].includes(parts[1]))||
  (head==='selections'&&!/receive|unpack|native-http/.test(parts.slice(1).join('/')));
 return path.join(root,...(activeGeneration&&!shared?['generations',activeGeneration]:[]),...parts);
}
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
const secretKeys=new Set(['apiKey','serverApiKey','secretKey','pat','token','accessToken','refreshToken','authorization','Authorization','DPoP','dpop','code','payload','signedXdr','signedTransactionXdr','signedPayload','submissionToken','privateKey','private_key']);
function publicRecord(value,key=''){
 if(secretKeys.has(key))return '[private original omitted]';
 if(Array.isArray(value))return value.map(item=>publicRecord(item));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).map(([name,item])=>[name,publicRecord(item,name)]));
 return typeof value==='bigint'?value.toString():value;
}
async function safeError(error){return {code:error?.code??error?.name??'NATIVE_OPERATION_FAILED',message:String(error?.message??error),details:publicRecord(error?.details??null)};}
let state,sealedOutputRoot=null;
async function save(){state.updatedAt=new Date().toISOString();await replace(target('operation.json'),state);}
async function announce(event,details={}){const item={time:new Date().toISOString(),event,...details};await fs.appendFile(target('progress.jsonl'),JSON.stringify(item)+'\n',{mode:0o600});process.stdout.write(JSON.stringify(item)+'\n');}
async function step(name,work,{repeat=false}={}){
 const previous=state.steps[name];
 if(previous?.status==='COMPLETE'&&previous.sourceGeneration===activeGeneration&&!repeat)return readJSON(path.join(root,previous.result));
 const attemptId=randomUUID(),startedAt=new Date().toISOString();
 state.steps[name]={...previous,status:'RUNNING',sourceGeneration:activeGeneration,startedAt:previous?.startedAt??startedAt,attemptId,
  attempts:[...(previous?.attempts??[]),{id:attemptId,startedAt}]};await save();await announce('START',{step:name,attemptId});
 try{
  const result=await work(),file='results/'+name+'/'+attemptId+'.json';await exact(target(file),json(result));
  state.steps[name]={...state.steps[name],status:'COMPLETE',finishedAt:new Date().toISOString(),result:path.relative(root,target(file)).split(path.sep).join('/'),error:null};await save();await announce('COMPLETE',{step:name,attemptId});return result;
 }catch(error){
  const problem=await safeError(error),file='results/'+name+'/'+attemptId+'.error.json';await exact(target(file),json(problem));
  state.steps[name]={...state.steps[name],status:'FAILED',finishedAt:new Date().toISOString(),error:path.relative(root,target(file)).split(path.sep).join('/')};await save();await announce('FAILED',{step:name,attemptId,code:problem.code,message:problem.message});return {error:problem};
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
 if(!source){
  const sourceDirectory=path.resolve(options['source-directory']),manifest=await fs.readFile(path.join(sourceDirectory,PREFIX,'source-files.json'));
  return {sourceDirectory,sourcePacket:null,generation:digest(manifest)};
 }
 const bytes=await bytesAt(source),packet=JSON.parse(bytes.toString('utf8'));
 need(Array.isArray(packet.files)&&packet.files.length>0,'Supply the complete original source carrier.');
 const generation=digest(bytes),previous=await readJSON(path.join(root,'operation.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 const known=(previous?.sourceGenerations??[]).find(item=>item.generation===generation);
 const sourceRoot=known?.sourceDirectory??(previous?.sourcePacket?.sha256===generation?previous.sourceDirectory:target('applications/'+generation)),seen=new Set();
 for(const file of packet.files){
  const relative=safeRelative(file.path);need(!seen.has(relative),'Duplicate original source member.');seen.add(relative);
  need(typeof file.content==='string','Complete source content is required.');
  const body=Buffer.from(file.content),mode=typeof file.mode==='number'?file.mode:parseInt(String(file.mode??'100644'),8)&0o777;
  need(body.length===file.bytes&&digest(body)===file.sha256,'An original source packet member differs.',{path:relative});
  if(file.gitBlob||file.sha){const expected=file.gitBlob??file.sha;need(createHash('sha1').update(Buffer.from('blob '+body.length+'\0')).update(body).digest('hex')===expected,'Original Git source identity differs.',{path:relative});}
  await exact(path.join(sourceRoot,...relative.split('/')),body,mode);await fs.chmod(path.join(sourceRoot,...relative.split('/')),mode);
 }
 await exact(target('source-history/'+generation+'/source-carrier.json'),bytes);
 return {sourceDirectory:sourceRoot,sourcePacket:{path:source,bytes:bytes.length,sha256:generation},files:seen.size,generation};
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
activeGeneration=original.generation;
if(await exists(target('operation.json'))){
 state=await readJSON(target('operation.json'));
 need(state.operation===OPERATION,'The same native operation must retain its original workspace.');
 const priorGeneration=state.activeSource?.generation??state.sourcePacket?.sha256??
  digest(await fs.readFile(path.join(state.sourceDirectory,PREFIX,'source-files.json')));
 state.sourceGenerations??=[{generation:priorGeneration,sourceDirectory:state.sourceDirectory,sourcePacket:state.sourcePacket,selectedAt:state.createdAt}];
 if(priorGeneration!==activeGeneration){
  await exact(target('source-history/'+priorGeneration+'/operation-before-'+activeGeneration+'.json'),json(state));
  for(const item of Object.values(state.steps))item.sourceGeneration??=priorGeneration;
  await announce('SOURCE_VERSION_CONTINUATION',{from:priorGeneration,to:activeGeneration,workspaceDirectory:target('workspace')});
 }else for(const item of Object.values(state.steps))item.sourceGeneration??=activeGeneration;
 if(!state.sourceGenerations.some(item=>item.generation===activeGeneration))
  state.sourceGenerations.push({...original,selectedAt:new Date().toISOString()});
}else{
 state={schema:'stellar-forge.pollar-partner.native-operation.v1',operation:OPERATION,id:randomUUID(),createdAt:new Date().toISOString(),sourceDirectory:original.sourceDirectory,sourcePacket:original.sourcePacket,
  sourceGenerations:[{...original,selectedAt:new Date().toISOString()}],steps:{},requests:{},applications:{},participants:{},journeys:{},reports:{},runtime:null};
}
state.activeSource=original;state.sourceRecovery??={};await save();
const sourceUpgrade=state.sourceGenerations.length>1;
const appRoot=original.sourceDirectory,P=path.join(appRoot,PREFIX),workspaceDirectory=target('workspace');



const imports={},appModules=['runtime','native','catalogue','browser-bridge','workspace','operator','server','archive','receiving'];
const verifiedApplication=await step('original-source',()=>retainSourceManifest(appRoot));
need(!verifiedApplication.error,'The coherent original application source must verify before its modules execute.',verifiedApplication.error);
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
await step('original-catalogues',async()=>{
 const browser=imports.catalogue.POLLAR_BROWSER_ACTIONS,host=imports.catalogue.POLLAR_NATIVE_ACTIONS;
 need(Array.isArray(browser)&&browser.length>=75&&Array.isArray(host)&&host.length>=22,'Keep the complete original action catalogues.');
 const sourceCapsule=await readJSON(path.join(P,'source','pollar-sdk-source.json'));
 const originalClient=sourceCapsule.files.find(item=>item.path==='packages/core/src/client/client.ts');
 need(originalClient&&sourceCapsule.files.length===343,'The complete pinned original SDK source is required.');
 const nativeMethods=browser.map(item=>({action:item.action,method:item.nativeMethod,parameters:item.parameters,mode:item.mode,
  inputSchema:item.inputSchema,source:item.source,sourceVersion:item.sourceVersion}));
 for(const action of nativeMethods){
  const leaf=action.method.split('.').at(-1);
  need(originalClient.content.includes(leaf),'The browser catalogue method is absent from the original client source.',{action:action.action,method:action.method});
 }
 return {browser:nativeMethods,host,source:{commit:sourceCapsule.commit??sourceCapsule.repository?.commit??null,files:sourceCapsule.files.length},
  forwarding:{auth:'original PollarClient; verified native session only',signing:'original SDK and supplied owner integrations',history:'native total/limit/offset/records'}};
});
let privateConfiguration=null,customerPlan=null,operatorPlan=null;
for(const [option,name] of [['configuration-file','configuration'],['customer-plan-file','customer-plan'],['operator-plan-file','operator-plan']]){
 if(!options[option])continue;
 const filename=path.resolve(options[option]),bytes=await fs.readFile(filename),value=JSON.parse(bytes.toString('utf8'));
 await exact(target('private/'+name+'-'+digest(bytes)+'.json'),bytes);
 if(name==='configuration')privateConfiguration=value;else if(name==='customer-plan')customerPlan=value;else operatorPlan=value;
 state.privateInputs??={};state.privateInputs[name]={sha256:digest(bytes),bytes:bytes.length};await save();
}
async function selectOriginalNpm(){
 const selected=options['npm-executable']??'npm';
 const initial=await command('npm-version',selected,['--version'],{requireSuccess:false});
 const actual=(await fs.readFile(initial.stdout.path,'utf8')).trim();
 if(initial.exitCode===0&&actual===NPM_VERSION)return {executable:selected,version:actual,source:'selected-installed'};
 const local=target('npm-bootstrap'),entry=path.join(local,'node_modules','npm','bin','npm-cli.js');
 await directory(local);
 if(!await exists(entry)){
  need(initial.exitCode===0,'The selected original npm command must run before its pinned local version can be prepared.',initial);
  await command('npm-original-tool-install',selected,['install','--prefix',local,'--no-save','--no-package-lock','--no-audit','--fund=false','npm@'+NPM_VERSION]);
 }
 const check=await command('npm-original-tool-version',process.execPath,[entry,'--version']);
 const version=(await fs.readFile(check.stdout.path,'utf8')).trim();
 need(version===NPM_VERSION,'Use the original SDK source-selected npm version.',{expected:NPM_VERSION,actual:version});
 return {executable:entry,version,source:'private-original-tool-install',package:await fullHash(path.join(local,'node_modules','npm','package.json'))};
}
let runtime=null;
const runtimeResult=await step('original-installed-runtime',async()=>{
 need(imports.runtime,'The original runtime module must import.');
 let value,tool=null;
 if(options['runtime-directory'])value=await imports.runtime.verifyPollarRuntime({directory:path.resolve(options['runtime-directory']),
  expectedManifestSha256:options['runtime-manifest-sha256']});
 else if(options['installation-directory'])value=await imports.runtime.retainPollarRuntime({directory:target('runtime-original'),
  installationDirectory:path.resolve(options['installation-directory'])});
 else{
  tool=await selectOriginalNpm();
  value=await imports.runtime.buildPollarRuntime({installationDirectory:target('sdk-installation'),directory:target('runtime-original'),
   npmExecutable:tool.executable,nodeHeapMB:Number(options['node-heap-mb']??512),signal:controller.signal,
   progress:detail=>announce('ORIGINAL_BUILD',{detail:publicRecord(detail)})});
 }
 return {id:value.id,directory:value.directory,manifestSha256:value.manifestSha256,versions:value.versions,
  entrypoints:value.entrypoints,requireEntrypoints:value.requireEntrypoints,browser:value.browser,build:value.build??null,tool};
});
if(!runtimeResult.error){
 runtime=await imports.runtime.verifyPollarRuntime({directory:runtimeResult.directory,expectedManifestSha256:runtimeResult.manifestSha256});
 state.retainedRuntimes??={};if(state.runtime)state.retainedRuntimes[state.runtime.id]=state.runtime;
 state.runtime={id:runtime.id,directory:runtime.directory,manifestSha256:runtime.manifestSha256,versions:runtime.versions};
 state.retainedRuntimes[runtime.id]=state.runtime;await save();
 await step('original-runtime-exports',async()=>{
  const esm=[],cjs=[],require=createRequire(path.join(root,'native-runtime-consumer.cjs'));
  for(const [name,entry]of Object.entries(runtime.entrypoints)){
   const value=await import(pathToFileURL(entry).href);esm.push({name,exports:Object.keys(value),
    version:value.POLLAR_CORE_VERSION??value.POLLAR_REACT_VERSION??value.version??null});
   if(name==='@pollar/core')need(value.POLLAR_CORE_VERSION===SDK_VERSION&&typeof value.PollarClient==='function','Original core build/version unavailable.');
   if(name==='@pollar/react')need(value.POLLAR_REACT_VERSION===SDK_VERSION&&typeof value.browserPasskeyCeremony==='function'&&typeof value.browserPasskeySigner==='function','Original React/passkey exports unavailable.');
   if(name==='@pollar/accesly-adapter')need(typeof value.createAcceslyAdapter==='function','Original Accesly adapter export unavailable.');
  }
  for(const [name,entry]of Object.entries(runtime.requireEntrypoints)){const value=require(entry);cjs.push({name,exports:Object.keys(value)});}
  const browserAssets=runtime.manifest.files.filter(item=>item.path.startsWith(runtime.manifest.browser.directory+'/'));
  for(const name of ['pollar-runtime.mjs','pollar-runtime.css','metafile.json'])need(browserAssets.some(item=>item.path.endsWith('/'+name)),'Original emitted browser asset missing.',{name});
  return {runtimeId:runtime.id,manifestSha256:runtime.manifestSha256,esm,cjs,browserAssets,
   packages:runtime.manifest.packages.map(item=>({id:item.id,name:item.name,version:item.version})),
   files:runtime.manifest.files.length,links:runtime.manifest.links.length};
 });
}


let host=null,operator=null,browserContext=null,browserEngine=null,receivedHost=null,operatorPage=null,portalPage=null;
const operatorBase={profile:{name:'Pollar native commissioning',operation:OPERATION,...(privateConfiguration?.profile??{})},
 connections:privateConfiguration?.connections??{},portalConnections:privateConfiguration?.portalConnections??{},
 runtimes:[...(privateConfiguration?.runtimes??[]),...Object.values(state.retainedRuntimes??(state.runtime?{[state.runtime.id]:state.runtime}:{})).map(item=>({directory:item.directory,expectedManifestSha256:item.manifestSha256}))]};
const configuredApplications=privateConfiguration?.applications??[];
need(Array.isArray(configuredApplications),'The owner applications selection must be a complete array.');
for(const option of ['configuration-file','customer-plan-file','operator-plan-file']){
 if(!options[option])continue;
 const stat=await fs.lstat(path.resolve(options[option]));
 need(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0,'Keep original owner configuration and plans in private regular files.');
}
const originalMethods=imports.operator?.POLLAR_PARTNER_METHODS??[];
function methodFor(name){const result=originalMethods.find(item=>item.name===name);need(result,'The original operator does not declare this method.',{method:name});return result;}
function requestSemanticIdentity(request){
 const args={...request.args};delete args.expectedRevision;
 return digest(Buffer.from(canonical({directory:request.directory,method:request.method,args})));
}
async function originalRevisionSelection(label,original){
 const directory=target('requests/'+label+'.json.revision-attempts');
 if(!await exists(directory))return {request:original,attempt:0};
 const names=(await fs.readdir(directory)).filter(name=>/^[0-9]{8}\.json$/.test(name)).sort();
 let request=original,attempt=0;
 const semanticSha256=requestSemanticIdentity(original);
 for(const name of names){
  const retained=await readJSON(path.join(directory,name));
  need(retained.schema==='stellar-forge.pollar-native.request-revision.v1'&&retained.attempt===attempt+1&&
   Number(name.slice(0,8))===retained.attempt&&retained.rejection?.code==='REVISION_CONFLICT'&&
   retained.semanticSha256===semanticSha256&&retained.previousExpectedRevision===request.args.expectedRevision&&
   retained.request?.args?.requestId===original.args.requestId&&requestSemanticIdentity(retained.request)===semanticSha256&&
   Number.isSafeInteger(retained.request.args.expectedRevision)&&retained.request.args.expectedRevision>=0,
   'The original explicitly rejected revision history differs.',{label,path:name});
  request=retained.request;attempt=retained.attempt;
 }
 return {request,attempt};
}
async function pinnedRequest(label,method,args,{selected=operator,directory:dir=workspaceDirectory}={}){
 const file=target('requests/'+label+'.json');
 if(await exists(file)){
  const original=await readJSON(file);
  need(original.method===method&&original.directory===dir,'The original request selection changed.',{label,method});
  return (await originalRevisionSelection(label,original)).request;
 }
 const entry=methodFor(method),input=typeof args==='function'?await args():args??{},current=entry.mutates?await selected.describe():null;
 const value={directory:dir,method,args:{...input}};
 if(entry.mutates){
  value.args.requestId??=randomUUID();
  if(entry.required.includes('expectedRevision'))value.args.expectedRevision??=current.revision;
 }
 await exact(file,json(value));
 return readJSON(file);
}
async function refreshRejectedRevision(label,request,rejection,{selected=operator}={}){
 need(rejection?.code==='REVISION_CONFLICT'&&methodFor(request.method).mutates&&
  methodFor(request.method).required.includes('expectedRevision'),'Only an explicit original revision rejection can select a newer precondition.');
 const original=await readJSON(target('requests/'+label+'.json'));
 const selection=await originalRevisionSelection(label,original);
 need(canonical(selection.request)===canonical(request),'The selected original request revision changed during dispatch.');
 const current=await selected.describe();
 need(Number.isSafeInteger(current.revision)&&current.revision>=0&&
  (!state.workspaceId||current.workspaceId===state.workspaceId),'The refreshed revision belongs to another original workspace.');
 if(current.revision===request.args.expectedRevision)throw rejection;
 const next={...request,args:{...request.args,expectedRevision:current.revision}};
 const retained={schema:'stellar-forge.pollar-native.request-revision.v1',attempt:selection.attempt+1,
  semanticSha256:requestSemanticIdentity(original),previousExpectedRevision:request.args.expectedRevision,
  rejection:await safeError(rejection),rejectedAt:new Date().toISOString(),
  revisionObservation:{workspaceId:current.workspaceId,revision:current.revision,head:current.head??null},request:next};
 await exact(target('requests/'+label+'.json.revision-attempts/'+String(retained.attempt).padStart(8,'0')+'.json'),json(retained));
 return next;
}
async function invokeOriginal(label,method,args,{selected=operator,directory:dir=workspaceDirectory,ephemeral}={}){
 let request=await pinnedRequest(label,method,args,{selected,directory:dir}),result;
 for(let attempt=0;;attempt++){
  try{result=await selected.invoke({method:request.method,args:request.args,...(ephemeral?{ephemeral}:{})});break;}
  catch(error){
   // The native workspace rejects this CAS before accepting the operation.
   // Lost responses and every other failure preserve the prior wire selection.
   if(error?.code!=='REVISION_CONFLICT'||attempt>=4||!methodFor(method).required.includes('expectedRevision'))throw error;
   request=await refreshRejectedRevision(label,request,error,{selected});
  }
 }
 // A provider may return a one-use value. Its native implementation marks this
 // separately; only the explicit private owner result receives that value.
 const retained={...result};delete retained.ephemeral;
 const bytes=Buffer.from(json(retained)),file=target('request-results/'+label+'/'+digest(bytes)+'.json');
 await exact(file,bytes);
 await replace(target('request-acknowledgements/'+label+'.json'),{method,requestId:request.args.requestId??null,
  result:path.relative(root,file).split(path.sep).join('/'),sha256:digest(bytes),observedAt:new Date().toISOString()});
 if(result.ephemeral!==undefined){
  const privateFile=target('private/ephemeral/'+digest(json({label,requestId:request.args.requestId,result:result.ephemeral}))+'.json');
  await exact(privateFile,json({method,requestId:request.args.requestId,ephemeral:result.ephemeral}));
 }
 return retained;
}
async function allRows(table,{selected=operator,applicationId,participantId}={}){
 const rows=[],pages=[],seen=new Set();let after;
 do{
  const value=await selected.invoke({method:'records.page',args:{table,limit:1000,...(after?{after}:{}),...(applicationId?{applicationId}:{}),...(participantId?{participantId}:{})}});
  need(Array.isArray(value.rows),'The original workspace page did not return its retained rows.');
  pages.push({after:after??null,nextCursor:value.nextCursor,total:value.total,revision:value.revision,rows:value.rows.length});
  for(const row of value.rows){need(!seen.has(row.id),'An original workspace page repeated a retained identity.',{table,id:row.id});seen.add(row.id);rows.push(row);}
  const next=value.nextCursor??null;need(!next||next!==after,'The original workspace page did not advance.');after=next;
 }while(after);
 return {rows,pages};
}
async function retainedPublicFile(label,read){
 const filename=target('native-files/'+label),temporary=filename+'.pending-'+randomUUID();
 await directory(path.dirname(filename));
 const first=await read(0,196608),total=first.bytes,expected=first.sha256;
 need(Number.isSafeInteger(total)&&total>=0&&/^[a-f0-9]{64}$/.test(expected),'The original file descriptor is incomplete.');
 if(await exists(filename)){const actual=await fullHash(filename);need(actual.bytes===total&&actual.sha256===expected,'The retained complete file differs.');return {path:filename,...actual,contentType:first.contentType??null};}
 const handle=await fs.open(temporary,'wx',0o600),hash=createHash('sha256');let offset=0,part=first;
 try{
  while(offset<total){
   need(part.bytes===total&&part.sha256===expected,'The source file identity changed between original ranges.');
   const bytes=part.content?Buffer.from(part.content):Buffer.from(part.contentBase64??'','base64');
   need(bytes.length>0&&bytes.length<=total-offset,'The original file range is incomplete.');
   await handle.write(bytes,0,bytes.length,offset);hash.update(bytes);offset+=bytes.length;
   if(offset<total)part=await read(offset,196608);
  }
  need(hash.digest('hex')===expected,'The received original file hash differs.');await handle.sync();
 }finally{await handle.close();}
 await fs.rename(temporary,filename);
 return {path:filename,bytes:total,sha256:expected,contentType:first.contentType??null};
}
async function collectOriginalSources(selection={selected:operator}){
 const selected=selection.selected??operator,items=await allRows('sources',selection),result=[];
 for(const source of items.rows){
  const metadata=await selected.invoke({method:'source.read',args:{sourceId:source.id}});
  const original=await retainedPublicFile('sources/'+source.id+'/source.json',(offset,length)=>
   selected.invoke({method:'source.file',args:{sourceId:source.id,part:'source',offset,length}}));
  const bodyPart=metadata.source?.body??metadata.record?.response?.body;
  let response=null;
  if(bodyPart)response=await retainedPublicFile('sources/'+source.id+'/response.bin',(offset,length)=>
   selected.invoke({method:'source.file',args:{sourceId:source.id,part:'response',offset,length}}));
  result.push({id:source.id,kind:source.kind,operationId:source.operationId??null,metadata:original,response});
 }
 return {sources:result,pages:items.pages};
}
function ownerRequired(message,details={}){
 const error=new Error(message);error.code='POLLAR_OWNER_CONFIGURATION_REQUIRED';error.details=details;throw error;
}
async function httpJSON(label,url,{method='GET',body,token,workspaceId,origin,headers={}}={}){
 const bytes=body===undefined?null:Buffer.from(json(body));
 const response=await fetch(url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),
  ...(workspaceId?{'X-Pollar-Workspace-ID':workspaceId}:{}),...(origin?{Origin:origin}:{}),
  ...(bytes?{'Content-Type':'application/json'}:{}),...headers},body:bytes,signal:controller.signal});
 const raw=Buffer.from(await response.arrayBuffer()),id=digest(Buffer.concat([Buffer.from(method+' '+url+'\n'),bytes??Buffer.alloc(0),raw]));
 const prefix='http/'+label+'/'+id;
 await exact(target(prefix+'.response.bin'),raw);
 await exact(target(prefix+'.json'),json({request:{method,url,bodySha256:bytes?digest(bytes):null,bodyBytes:bytes?.length??0},
  response:{status:response.status,statusText:response.statusText,headers:Object.fromEntries([...response.headers].filter(([key])=>key!=='set-cookie')),
   bytes:raw.length,sha256:digest(raw)},observedAt:new Date().toISOString()}));
 let value=null;try{value=JSON.parse(raw.toString('utf8'));}catch{}
 return {ok:response.ok,status:response.status,headers:Object.fromEntries(response.headers),value,
  responseFile:target(prefix+'.response.bin'),bodySha256:digest(raw)};
}
function startupToken(startup){const value=new URL(startup.url).hash;need(value.startsWith('#token='),'The original private startup token is absent.');return decodeURIComponent(value.slice(7));}
try {
const started=await step('original-host-lifecycle',async()=>{
 need(imports.server&&imports.operator,'The complete original host modules must import.');
 host=await imports.server.startPollarPartnerServer({workspaceDirectory,configuration:operatorBase,port:Number(options.port??8778),
  signal:controller.signal,applicationDirectory:appRoot,deliveryDirectory:target('receiving-inbox')});
 operator=host.operator;
 await exact(target('private/startup-'+activeGeneration+'-'+randomUUID()+'.json'),json(host.startup));
 const {url,...publicStartup}=host.startup;
 const description=await operator.describe();
 need(publicStartup.workspaceId===description.workspaceId,'The started native host selected another workspace.');
 state.workspaceId=description.workspaceId;await save();
 return {startup:publicStartup,description,methods:await operator.methods(),processIdentity:await identityOf(process.pid)};
},{repeat:true});
if(started.error)need(false,'The original operator host must open before its remaining workflow.',started.error);
const apiToken=startupToken(host.startup);
await step('native-http-identity',async()=>{
 const bootstrap=await httpJSON('bootstrap',host.startup.origin+'/api/bootstrap',{token:apiToken});
 need(bootstrap.ok&&bootstrap.value.state.workspaceId===state.workspaceId,'The original native bootstrap did not return the selected workspace.');
 const blockedRequest={method:'profile.save',args:{requestId:randomUUID(),expectedRevision:bootstrap.value.state.revision,
  profile:{identityProbe:OPERATION}}};
 const rejected=await httpJSON('workspace-identity-required',host.startup.origin+'/api/invoke',{method:'POST',token:apiToken,body:blockedRequest});
 need(rejected.status===409&&rejected.value?.error?.code==='WORKSPACE_IDENTITY_REQUIRED','The native mutation did not require the original workspace identity.');
 const after=await operator.describe();need(after.revision===bootstrap.value.state.revision,'A rejected foreign-workspace request changed the original workspace.');
 return {bootstrap:bootstrap.value,rejected:{status:rejected.status,code:rejected.value?.error?.code},workspaceId:state.workspaceId};
});
await step('original-profile-request-recovery',async()=>{
 const selected=await pinnedRequest('profile/original','profile.save',{profile:{name:operatorBase.profile.name,operation:OPERATION,commissioning:'original-source'}});
 const first=await operator.invoke({method:selected.method,args:selected.args});
 const before=(await operator.describe()).revision;
 const repeated=await operator.invoke({method:selected.method,args:selected.args});
 const after=(await operator.describe()).revision;
 need(canonical(first)===canonical(repeated)&&before===after,'The same original native profile request did not recover identically.');
 return {requestId:selected.args.requestId,original:first,replayed:repeated,revision:after};
});
const selectedApplications=[];
await step('original-application-selections',async()=>{
 for(const item of configuredApplications){
  need(item&&typeof item==='object'&&typeof item.name==='string'&&item.configuration&&typeof item.configuration==='object',
   'The owner application selection requires its original name and complete public SDK configuration.');
  const reference=String(item.reference??item.configuration.applicationId),key=digest(reference),configuration={...item.configuration};
  imports.catalogue.validatePollarValue(configuration,imports.catalogue.POLLAR_PUBLIC_CONFIGURATION_SCHEMA);
  if(configuration.stellarNetwork!=='testnet'&&operatorPlan?.steps?.some(x=>imports.catalogue.POLLAR_NATIVE_ACTIONS.find(row=>row.action===x.action)?.mutates))
   need(false,'This commissioning operation requires the owner-selected testnet application for native writes.');
  const existing=state.applications[reference];
  const args={name:item.name,configuration,...(existing?{applicationId:existing.id}:{}),...(runtime?{runtimeId:runtime.id}:{})};
  const selectionSha=digest(json({name:item.name,configuration,runtimeId:runtime?.id??null}));
  let original;
  if(existing?.selectionSha===selectionSha)original=await operator.invoke({method:'application.read',args:{applicationId:existing.id,version:existing.version}});
  else original=await invokeOriginal('applications/'+key+'/'+selectionSha,'application.save',args);
  const chosen={reference,id:original.application.id,version:original.version.version,name:original.version.name,
   configuration:original.version.configuration,selectionSha,connection:item.connection??null,runtime:original.version.runtime??null};
  state.applications[reference]=chosen;selectedApplications.push(chosen);await save();
 }
 if(!configuredApplications.length){
  const existing=await allRows('applications');
  for(const row of existing.rows){
   const version=await operator.invoke({method:'application.read',args:{applicationId:row.id}});
   selectedApplications.push({reference:row.originalApplicationId,id:row.id,version:version.version.version,
    name:version.version.name,configuration:version.version.configuration,runtime:version.version.runtime??null,
    connection:Object.entries(operatorBase.portalConnections).find(([key])=>key===row.id)?.[1]??null});
  }
 }
 return {applications:selectedApplications.map(item=>({reference:item.reference,applicationId:item.id,version:item.version,
  originalApplicationId:item.configuration.applicationId,network:item.configuration.stellarNetwork,runtime:item.runtime})),
  ownerConfigured:configuredApplications.length>0,credentialCustody:'original private file and native SDK'};
},{repeat:true});
function selectedApplication(reference){
 const item=reference?selectedApplications.find(row=>row.reference===reference||row.id===reference||row.configuration.applicationId===reference):selectedApplications[0];
 if(!item)ownerRequired('The original owner application key and application identity have not been supplied.');
 return item;
}
function selectedConnection(application,requested){
 const alias=requested??application.connection??operatorBase.portalConnections[application.id]??
  Object.keys(operatorBase.connections).find(name=>operatorBase.connections[name].applicationId===application.configuration.applicationId&&
   (!operatorBase.connections[name].network||operatorBase.connections[name].network===application.configuration.stellarNetwork));
 if(!alias||!Object.hasOwn(operatorBase.connections,alias))
  ownerRequired('Attach the original account-owner native connection for this application.',{applicationId:application.configuration.applicationId});
 return alias;
}
async function runNativeSelection(selection,index){
 const application=selectedApplication(selection.application??operatorPlan?.application),connection=selectedConnection(application,selection.connection??operatorPlan?.connection);
 const originalAction=imports.catalogue.POLLAR_NATIVE_ACTIONS.find(item=>item.action===selection.action);
 need(originalAction,'The selected owner action is absent from the original native catalogue.',{action:selection.action});
 if(originalAction.mutates)need(application.configuration.stellarNetwork==='testnet','Select the original testnet application for this commissioning mutation.');
 const originalArgs=selection.args??{};
 imports.catalogue.validatePollarValue(originalArgs,originalAction.inputSchema);
 const binding=digest(json({reference:application.reference,connection,action:selection.action,args:originalArgs,id:selection.id??index}));
 const label='native/'+binding;
 const prepared=await invokeOriginal(label+'/prepare','operation.prepare',{
  applicationId:application.id,applicationVersion:application.version,mode:'native',connection,action:selection.action,args:originalArgs});
 const operationId=prepared.operation.id;
 state.journeys[binding]={...state.journeys[binding],operationId,applicationId:application.id,action:selection.action,connection,selectedAt:state.journeys[binding]?.selectedAt??new Date().toISOString()};
 await save();
 let current=(await operator.invoke({method:'operation.read',args:{operationId}})).operation;
 if(current.paused)current=(await invokeOriginal(label+'/resume/'+current.updatedAt.replace(/[^0-9]/g,''),'operation.resume',{operationId})).operation;
 let result;
 if(originalAction.mutates){
  if(current.state==='PREPARED')result=await invokeOriginal(label+'/dispatch','operation.run',{operationId});
  else if(['RUNNING','PENDING','UNCERTAIN'].includes(current.state)){
   // A new reconciliation request reads the existing native provider identity.
   // It never creates a replacement registration, grant, payment or action.
   const count=(state.journeys[binding].reconciliations??0),savedLabel=label+'/reconcile/'+count;
   result=await invokeOriginal(savedLabel,'operation.reconcile',{operationId});
   state.journeys[binding].reconciliations=count+1;await save();
  }else result={operation:current};
 }else{
  if(['RUNNING','PENDING','UNCERTAIN','FAILED'].includes(current.state)){
   const count=state.journeys[binding].reconciliations??0;
   result=await invokeOriginal(label+'/read-reconcile/'+count,'operation.reconcile',{operationId});
   state.journeys[binding].reconciliations=count+1;await save();
   current=result.operation;
  }
  if(current.state==='PREPARED'||current.state==='COMPLETE'&&current.nextRequest){
   result=await invokeOriginal(label+'/collect','operation.collect',{operationId,...(selection.maxPages!==undefined?{maxPages:selection.maxPages}:{})});
  }else result??={operation:current};
 }
 const final=(await operator.invoke({method:'operation.read',args:{operationId}})).operation;
 state.journeys[binding]={...state.journeys[binding],state:final.state,nextRequest:final.nextRequest??null,
  providerIds:final.providerIds,sourceIds:final.sourceIds,execution:final.execution??null};await save();
 const pending=final.state!=='COMPLETE'||!originalAction.mutates&&Boolean(final.nextRequest);
 if(pending){const error=new Error('The original provider operation remains incomplete; its exact request, response and continuation are retained.');
  error.code='POLLAR_NATIVE_OPERATION_INCOMPLETE';error.details={operationId,state:final.state,sourceIds:final.sourceIds,
   providerIds:final.providerIds,nextRequest:final.nextRequest??null,execution:final.execution??null};throw error;}
 return {operation:final,sourceCount:final.sourceIds.length,providerIds:final.providerIds};
}
let nativeSelections=[];
if(operatorPlan){
 need(Array.isArray(operatorPlan.steps),'The explicit owner operator plan requires its complete original steps.');
 nativeSelections=operatorPlan.steps;
}else for(const application of selectedApplications){
 let connection;try{connection=selectedConnection(application);}catch{continue;}
 for(const action of ['mcp.tools.list','mcp.get_application','mcp.get_application_wallets','mcp.get_application_users','mcp.get_application_transactions','mcp.check_application_readiness']){
  nativeSelections.push({id:application.id+'/'+action,application:application.id,connection,action,
   args:action==='mcp.tools.list'?{}:{id:application.configuration.applicationId,...(['mcp.get_application_users','mcp.get_application_transactions'].includes(action)?{limit:100,offset:0}:{})}});
 }
}
if(nativeSelections.length){
 for(let index=0;index<nativeSelections.length;index++){
  const selected=nativeSelections[index],identity=digest(json({id:selected.id??index,action:selected.action,args:selected.args??{},application:selected.application??operatorPlan?.application??null})).slice(0,24);
  await step('owner-native-'+identity,()=>runNativeSelection(selected,index),{repeat:state.steps['owner-native-'+identity]?.status!=='COMPLETE'});
 }
}else await step('owner-native-account-configuration',async()=>ownerRequired(
 'The established account-owner request has not supplied the original private Pollar connection and application selection.',
 {origin:'http://127.0.0.1:8778',redirect:'http://127.0.0.1:8778/portal',sourceAndLocalStagesContinue:true}));
await step('original-native-source-files',()=>collectOriginalSources(),{repeat:true});


function originalPayload(value){
 let row=value;
 for(let i=0;i<6&&row&&typeof row==='object'&&!Array.isArray(row);i++){
  if(row.content&&typeof row.content==='object'&&!Array.isArray(row.content)){row=row.content;continue;}
  if(row.data&&typeof row.data==='object'&&!Array.isArray(row.data)){row=row.data;continue;}
  break;
 }
 return row;
}
function originalObjects(value){
 const rows=[],seen=new Set(),visit=(item,location='')=>{
  if(!item||typeof item!=='object'||seen.has(item))return;seen.add(item);
  if(Array.isArray(item)){item.forEach((row,index)=>visit(row,location+'/'+index));return;}
  rows.push({value:item,path:location});
  for(const [key,row]of Object.entries(item))if(row&&typeof row==='object')visit(row,location+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'));
 };visit(value);return rows;
}
async function inventorySources(application,{selected=operator}={}){
 const rows=(await allRows('sources',{selected,applicationId:application.id})).rows,result=[];
 for(const row of rows){
  const read=await selected.invoke({method:'source.read',args:{sourceId:row.id}});
  if(read.record.outcome?.state==='COMPLETE')result.push({sourceId:row.id,operationId:row.operationId,kind:row.kind,
   observedAt:row.createdAt,value:read.record.outcome.result,source:row});
 }
 return result;
}
function inventoryWallets(sources){
 const found=new Map();
 for(const source of sources.filter(row=>['mcp.get_application_wallets','mcp.get_application_users','mcp.get_application_wallet_by_role'].includes(row.kind))){
  for(const {value,path:originalPath}of originalObjects(originalPayload(source.value))){
   const publicKey=value.publicKey??value.public_key??value.address;
   if(typeof publicKey!=='string'||!/^G[A-Z2-7]{55}$/.test(publicKey))continue;
   const key=publicKey,old=found.get(key),row={publicKey,role:value.role??null,userId:value.userId??value.user_id??null,
    original:value,sources:[...(old?.sources??[]),{sourceId:source.sourceId,path:originalPath}]};
   if(old){row.role??=old.role;row.userId??=old.userId;}found.set(key,row);
  }
 }
 return [...found.values()];
}
state.derivedNativePlans??={};
for(const application of selectedApplications){
 await step('derived-native-inventory-'+application.id,async()=>{
  const connection=selectedConnection(application),source=await inventorySources(application);
  const wallets=inventoryWallets(source),tasks=wallets.map(wallet=>({id:'observed-wallet/'+wallet.publicKey,
   application:application.id,connection,action:'mcp.get_wallet_balances',
   args:{id:application.configuration.applicationId,publicKey:wallet.publicKey},sources:wallet.sources}));
  for(const role of ['GLOBAL','FUNDING','GAS','DISTRIBUTION'])
   tasks.push({id:'original-wallet-role/'+role,application:application.id,connection,action:'mcp.get_application_wallet_by_role',args:{id:application.configuration.applicationId,role}});
  const plan={schema:'stellar-forge.pollar-partner.derived-native-plan.v1',applicationId:application.id,
   originalApplicationId:application.configuration.applicationId,network:application.configuration.stellarNetwork,
   sourceIds:source.map(row=>row.sourceId),wallets,tasks,generatedAt:new Date().toISOString()};
  const file=target('observed/native-plan/'+application.id+'/'+digest(json(plan))+'.json');await exact(file,json(plan));
  state.derivedNativePlans[application.id]={path:file,sha256:digest(json(plan)),wallets,tasks};await save();
  const completed=[];
  for(let index=0;index<tasks.length;index++){
   const task=tasks[index],key=digest(json({application:application.id,id:task.id})).slice(0,24);
   completed.push(await step('native-inventory-'+key,()=>runNativeSelection(task,task.id)));
  }
  const expanded=inventoryWallets(await inventorySources(application));
  const additional=expanded.filter(wallet=>!wallets.some(original=>original.publicKey===wallet.publicKey)).map(wallet=>({
   id:'observed-wallet/'+wallet.publicKey,application:application.id,connection,action:'mcp.get_wallet_balances',
   args:{id:application.configuration.applicationId,publicKey:wallet.publicKey},sources:wallet.sources}));
  for(const task of additional){
   const key=digest(json({application:application.id,id:task.id})).slice(0,24);
   completed.push(await step('native-inventory-'+key,()=>runNativeSelection(task,task.id)));
  }
  if(additional.length){
   const continuation={...plan,wallets:expanded,tasks:[...tasks,...additional],generatedAt:new Date().toISOString()};
   const retained=target('observed/native-plan/'+application.id+'/'+digest(json(continuation))+'.json');await exact(retained,json(continuation));
   state.derivedNativePlans[application.id]={path:retained,sha256:digest(json(continuation)),wallets:expanded,tasks:continuation.tasks};await save();
  }
  return {plan:state.derivedNativePlans[application.id],completed};
 },{repeat:true});
 // The documented update tools replace their lists. Only add this exact
 // existing commissioning origin to an observed complete original list.
 if(application.configuration.stellarNetwork==='testnet')await step('derived-testnet-origin-'+application.id,async()=>{
  const connection=selectedConnection(application),nativeId=application.configuration.applicationId;
  const read=await runNativeSelection({id:'commissioning-origin-source',application:application.id,connection,
   action:'mcp.get_application',args:{id:nativeId}},'commissioning-origin-source');
  const retained=await operator.invoke({method:'source.read',args:{sourceId:read.operation.lastSourceId}});
  const original=originalPayload(retained.record.outcome.result),candidates=[original,original?.application,original?.settings,original?.application?.settings].filter(row=>row&&typeof row==='object');
  const selection=[
   {field:'allowed_origins',camel:'allowedOrigins',required:host.startup.origin,action:'mcp.update_application_domains'},
   {field:'allowed_redirect_uris',camel:'allowedRedirectUris',required:host.startup.origin+'/portal',action:'mcp.update_application_redirect_uris'}
  ],results=[];
  for(const item of selection){
   const known=candidates.find(row=>Array.isArray(row[item.field])||Array.isArray(row[item.camel]));
   if(!known){results.push({action:item.action,status:'ORIGINAL_LIST_NOT_RETURNED',sourceId:retained.source.id});continue;}
   const originalList=known[item.field]??known[item.camel];
   need(originalList.every(value=>typeof value==='string'),'The provider origin/redirect list did not contain its original strings.');
   if(originalList.includes(item.required)){results.push({action:item.action,status:'ALREADY_PRESENT',original:originalList,sourceId:retained.source.id});continue;}
   const full=[...originalList,item.required];
   const planned={id:'commissioning-origin/'+item.field,application:application.id,connection,action:item.action,
    args:{id:nativeId,[item.field]:full}};
   const result=await runNativeSelection(planned,planned.id);
   results.push({action:item.action,status:result.operation.state,operationId:result.operation.id,
    original:originalList,selected:full,sourceId:retained.source.id});
  }
  return {applicationId:application.id,origin:host.startup.origin,redirect:host.startup.origin+'/portal',results};
 },{repeat:true});
}


async function loadBrowserRuntime(){
 const require=createRequire(path.join(root,'native-browser-consumer.cjs'));
 const candidates=[options['playwright-module'],
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):null,
  process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright-core'):null,
  'playwright','playwright-core'].filter(Boolean);
 let loaded=null,modulePath=null;
 for(const candidate of candidates){
  try{modulePath=require.resolve(candidate);loaded=await import(pathToFileURL(modulePath).href);if(loaded.chromium??loaded.default?.chromium)break;}
  catch{loaded=null;}
 }
 if(!loaded){const error=new Error('Attach the existing original Playwright runtime; no browser implementation is substituted.');error.code='BROWSER_RUNTIME_REQUIRED';throw error;}
 const chromium=loaded.chromium??loaded.default.chromium;
 const executables=[options['chromium-executable'],
  '/workspace/scratch/9f05c4298c2e/shared-native-toolchain/chrome-155.0.8059.39/chrome-headless-shell-linux64/chrome-headless-shell',
  '/workspace/scratch/e42da696d3f1/shared-browser-151.0.7922.138/chrome-headless-shell-linux64/chrome-headless-shell',
  chromium.executablePath()].filter(Boolean);
 let executable=null;
 for(const filename of executables){try{await fs.access(filename,constants.X_OK);executable=filename;break;}catch{}}
 if(!executable){const error=new Error('The selected original Chromium executable is not installed on this host.');error.code='BROWSER_EXECUTABLE_REQUIRED';error.details={candidates:executables};throw error;}
 const version=await command('original-browser-version',executable,['--version']);
 return {chromium,modulePath,executable,version};
}
async function browserJournal(page,{store='requests',scope='operator',id:onlyId,workspaceId=state.workspaceId}={}){
 return page.evaluate(async({store,scope,onlyId,workspaceId})=>{
  const {sha256}=await import('/journal.mjs');
  const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('stellar-pollar-partner',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{
   const prefix=location.origin+'\n'+workspaceId+'\n'+scope+'\n';
   const rows=await new Promise((resolve,reject)=>{const transaction=database.transaction(store,'readonly'),request=transaction.objectStore(store).getAll(IDBKeyRange.bound(prefix,prefix+'\uffff'));
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   const values=rows.map(item=>item.value).filter(row=>!onlyId||row.id===onlyId);
   if(store==='requests')return values.map(row=>({id:row.id,workspaceId:row.workspaceId,scope:row.scope,method:row.method,
    args:row.args,intent:row.intent,createdAt:row.createdAt,updatedAt:row.updatedAt,state:row.state,
    result:row.result,error:row.error,attempts:row.attempts,fileSelection:row.fileSelection,
    retainedFile:row.file?{isFile:row.file instanceof File,size:row.file.size,type:row.file.type,name:row.file.name??null}:null}));
   if(store==='sdk')return Promise.all(values.map(async row=>({id:row.id,workspaceId:row.workspaceId,applicationId:row.applicationId,
    applicationVersion:row.applicationVersion,operationId:row.operationId,action:row.action,publicArgs:row.publicArgs,
    ephemeralFields:row.ephemeralFields,state:row.state,phase:row.phase,createdAt:row.createdAt,updatedAt:row.updatedAt,
    providerIds:row.providerIds,participantId:row.participantId,hostOperationId:row.hostOperationId,hostAttemptId:row.hostAttemptId,
    hostState:row.hostState,publishedSequence:row.publishedSequence,lastNativeReturnAt:row.lastNativeReturnAt,lastError:row.lastError,
    outcome:row.outcome,privateCheckpointSha256:row.checkpoint?await sha256(row.checkpoint):null,
    checkpoint:row.checkpoint?{schema:row.checkpoint.schema,operationId:row.checkpoint.operationId,action:row.checkpoint.action,
     sequence:row.checkpoint.sequence,phase:row.checkpoint.phase,state:row.checkpoint.state,scope:row.checkpoint.scope,
     intentSha256:row.checkpoint.intentSha256,history:row.checkpoint.history?{
      pageCount:row.checkpoint.history.pages.length,recordCount:row.checkpoint.history.recordCount,
      uniqueRecordCount:row.checkpoint.history.uniqueRecordCount,nextParams:row.checkpoint.history.nextParams,
      observedTotals:row.checkpoint.history.observedTotals,complete:row.checkpoint.history.complete,
      partialReason:row.checkpoint.history.partialReason}:null}:null})));
   return values.map(row=>({id:row.id,workspaceId:row.workspaceId,scope:row.scope,updatedAt:row.updatedAt}));
  }finally{database.close();}
 },{store,scope,onlyId,workspaceId});
}
async function browserWait(work,{timeout=60000,interval=200,message='The original browser outcome has not returned.'}={}){
 const deadline=Date.now()+timeout;let latest;
 while(Date.now()<deadline&&!controller.signal.aborted){
  latest=await work();if(latest)return latest;
  await new Promise(resolve=>setTimeout(resolve,interval));
 }
 const error=new Error(message);error.code='BROWSER_ORIGINAL_OUTCOME_PENDING';throw error;
}
async function browserScreenshot(page,name,{privateOnly=false}={}){
 const filename=target((privateOnly?'private/browser/':'browser/screens/')+name+'-'+randomUUID()+'.png');
 await directory(path.dirname(filename));await page.screenshot({path:filename,fullPage:true});
 return {path:filename,...await fullHash(filename)};
}
async function inspectOperatorBrowser(page,startup,{directory:dir=workspaceDirectory}={}){
 await page.goto(startup.url,{waitUntil:'domcontentloaded'});
 await browserWait(async()=>{
  const text=await page.locator('#workspace-label').textContent();return text?.includes(startup.workspaceId);
 },{message:'The real operator JavaScript did not open its selected original workspace.'});
 const views=[];
 for(const name of ['overview','applications','operations','participants','sources','reports','receiving','recovery','settings']){
  await page.locator('nav [data-tab="'+name+'"]').click();
  await page.locator('[data-panel="'+name+'"]').waitFor({state:'visible'});
  views.push({name,heading:await page.locator('[data-panel="'+name+'"] h2').textContent()});
 }
 const identity=await page.locator('#workspace-label').textContent(),status=await page.locator('#status').textContent();
 return {workspaceId:startup.workspaceId,directory:dir,origin:startup.origin,views,identity,status,
  screenshot:await browserScreenshot(page,dir===workspaceDirectory?'original-operator':'received-operator')};
}
let originalBrowser=null;
await step('original-browser-runtime',async()=>{
 const selected=await loadBrowserRuntime();browserEngine=selected.chromium;
 const userDataDir=options['browser-user-data-directory']?path.resolve(options['browser-user-data-directory']):target('private/browser-profile');
 await directory(userDataDir);
 browserContext=await selected.chromium.launchPersistentContext(userDataDir,{
  headless:true,executablePath:selected.executable,acceptDownloads:true,viewport:{width:1440,height:1050},
  args:['--no-sandbox','--disable-dev-shm-usage'],env:{...process.env,TMPDIR:target('tmp'),TMP:target('tmp'),TEMP:target('tmp')}});
 const log=target('private/browser/events-'+activeGeneration+'-'+randomUUID()+'.jsonl');await directory(path.dirname(log));
 browserContext.on('page',page=>{
  page.on('console',message=>{fs.appendFile(log,JSON.stringify({at:new Date().toISOString(),type:'console',level:message.type(),text:message.text()})+'\n',{mode:0o600}).catch(()=>{});});
  page.on('pageerror',error=>{fs.appendFile(log,JSON.stringify({at:new Date().toISOString(),type:'pageerror',message:String(error)})+'\n',{mode:0o600}).catch(()=>{});});
 });
 operatorPage=await browserContext.newPage();
 originalBrowser={modulePath:selected.modulePath,executable:selected.executable,version:selected.version,userDataDir};
 return {...originalBrowser,privateEventLog:log};
},{repeat:true});
if(browserContext){
 await step('operator-browser-open',()=>inspectOperatorBrowser(operatorPage,host.startup),{repeat:true});
 if(runtime)await step('original-browser-sdk-exports',async()=>{
  const result=await operatorPage.evaluate(async({runtimeId,version})=>{
   const native=await import('/api/runtimes/'+runtimeId+'/pollar-runtime.mjs');
   if(native.core.POLLAR_CORE_VERSION!==version||native.pollarReact.POLLAR_REACT_VERSION!==version||
      typeof native.core.PollarClient!=='function'||typeof native.pollarReact.browserPasskeyCeremony!=='function'||
      typeof native.pollarReact.browserPasskeySigner!=='function'||typeof native.acceslyAdapter.createAcceslyAdapter!=='function'||
      typeof native.React.createElement!=='function'||typeof native.createRoot!=='function')throw new Error('Original compiled browser exports differ.');
   return {coreVersion:native.core.POLLAR_CORE_VERSION,reactVersion:native.pollarReact.POLLAR_REACT_VERSION,
    exports:Object.keys(native),coreExports:Object.keys(native.core),reactExports:Object.keys(native.pollarReact),
    adapterExports:Object.keys(native.acceslyAdapter)};
  },{runtimeId:runtime.id,version:SDK_VERSION});
  return {runtimeId:runtime.id,manifestSha256:runtime.manifestSha256,...result};
 },{repeat:true});
 await step('operator-browser-original-response-recovery',async()=>{
  const marker=OPERATION+'/'+activeGeneration;
  state.browserRecoveries??={};let saved=state.browserRecoveries[marker];
  if(!saved){saved={marker,createdAt:new Date().toISOString(),phase:'SELECTED'};state.browserRecoveries[marker]=saved;await save();}
  await operatorPage.locator('nav [data-tab="settings"]').click();
  let rows=await browserJournal(operatorPage),original=rows.find(row=>row.method==='profile.save'&&row.args?.profile?.nativeRecoveryMarker===marker);
  let originalResponse=null,observedRequest=null;
  if(!original){
   let resolveResponse,rejectResponse;
   const responseObserved=new Promise((resolve,reject)=>{resolveResponse=resolve;rejectResponse=reject;});
   const handler=async route=>{
    let body;try{body=route.request().postDataJSON();}catch{}
    if(body?.method!=='profile.save'||body.args?.profile?.nativeRecoveryMarker!==marker){await route.continue();return;}
    try{
     observedRequest=body;
     const full=await route.fetch(),bytes=Buffer.from(await full.body());
     originalResponse={status:full.status(),body:JSON.parse(bytes.toString('utf8')),sha256:digest(bytes),bytes:bytes.length};
     await exact(target('browser/recovery/'+body.args.requestId+'.request.json'),Buffer.from(route.request().postData()??''));
     await exact(target('browser/recovery/'+body.args.requestId+'.response.json'),bytes);
     saved.requestId=body.args.requestId;saved.originalResponse=originalResponse;saved.phase='HOST_ACKNOWLEDGED_RESPONSE_LOST';await save();
     // The actual host has committed. Only the response to this browser is lost.
     await route.abort('failed');resolveResponse(originalResponse);
    }catch(error){rejectResponse(error);await route.abort('failed').catch(()=>{});}
   };
   await operatorPage.route('**/api/invoke',handler);
   try{
    const profile={...(await operator.describe()).profile,nativeRecoveryMarker:marker};
    await operatorPage.locator('#profile-json').fill(JSON.stringify(profile,null,2));
    await operatorPage.locator('#profile-form button[type="submit"],#profile-form button.primary').click();
    await Promise.race([responseObserved,new Promise((_,reject)=>setTimeout(()=>reject(new Error('The original profile request was not dispatched.')),60000))]);
    original=await browserWait(async()=>{
     const list=await browserJournal(operatorPage),row=list.find(item=>item.id===saved.requestId);
     return row&&['UNCERTAIN','SENDING'].includes(row.state)?row:null;
    });
   }finally{await operatorPage.unroute('**/api/invoke',handler);}
  }
  need(original,'The original durable browser request is absent.');
  const firstRevision=(await operator.describe()).revision;
  const retainedId=original.id,retainedIntent=original.intent,retainedArgs=original.args;
  await operatorPage.reload({waitUntil:'domcontentloaded'});
  await browserWait(async()=>((await operatorPage.locator('#workspace-label').textContent())??'').includes(state.workspaceId));
  const recovered=await browserWait(async()=>{
   const rows=await browserJournal(operatorPage),row=rows.find(item=>item.id===retainedId);return row?.state==='COMPLETE'?row:null;
  },{message:'The original persisted browser request was not recovered after reload.'});
  const current=await operator.workspace.readState();
  need(recovered.id===retainedId&&recovered.intent===retainedIntent&&canonical(recovered.args)===canonical(retainedArgs),
   'Browser recovery changed the original UUID, body or source selection.');
  need(current.revision===firstRevision,'Recovering the same browser request added another native workspace mutation.');
  need(current.requests[retainedId]&&canonical(current.requests[retainedId].result)===canonical(recovered.result),
   'The original native acknowledgement differs from its recovered browser result.');
  if(saved.originalResponse)need(canonical(saved.originalResponse.body)===canonical(recovered.result),'The lost original response differs from its acknowledged recovery.');
  saved.phase='COMPLETE';saved.completedAt=new Date().toISOString();saved.requestId=retainedId;await save();
  return {requestId:retainedId,intent:retainedIntent,attempts:recovered.attempts,revision:current.revision,
   actualLostResponse:saved.originalResponse??null,originalResult:recovered.result,
   screenshot:await browserScreenshot(operatorPage,'original-request-recovered')};
 },{repeat:true});
}
async function portalState(page){
 const text=await page.locator('#connection-detail').textContent();try{return JSON.parse(text||'null');}catch{return null;}
}
async function openPortal(application,{selectedHost=host}={}){
 if(!browserContext){const error=new Error('The original Chromium runtime is unavailable for the customer flow.');error.code='BROWSER_RUNTIME_REQUIRED';throw error;}
 if(portalPage)await portalPage.close().catch(()=>{});
 portalPage=await browserContext.newPage();
 await portalPage.goto(selectedHost.startup.origin+'/portal?application='+encodeURIComponent(application.id)+'&version='+application.version,{waitUntil:'domcontentloaded'});
 await browserWait(async()=>{
  const state=await portalState(portalPage);return state?.ready?state:null;
 },{timeout:90000,message:'The original Pollar client did not complete its ready() restoration.'});
 const native=await portalState(portalPage);
 need(native.scope.applicationId===application.configuration.applicationId,'The portal opened another original provider application.');
 return {page:portalPage,state:native};
}
async function runCustomerStep(application,selection,index){
 need(portalPage,'Open the owner-selected original customer portal before invoking its native SDK.');
 const spec=imports.catalogue.POLLAR_BROWSER_ACTIONS.find(item=>item.action===selection.action);
 need(spec,'The selected customer action is absent from the original SDK catalogue.',{action:selection.action});
 const args=selection.args??{};imports.catalogue.validatePollarArguments(selection.action,args,{surface:'browser'});
 if(spec.mutates)need(application.configuration.stellarNetwork==='testnet','Select the original owner testnet application for this customer commissioning action.');
 const scope='portal:'+application.id,planHash=state.privateInputs?.['customer-plan']?.sha256??'original-readiness';
 const key=digest(json({applicationId:application.id,version:application.version,id:selection.id??index,action:selection.action,planHash}));
 state.customerSteps??={};let saved=state.customerSteps[key];
 let sdkRows=await browserJournal(portalPage,{store:'sdk',scope}),original;
 if(saved?.id)original=sdkRows.find(row=>row.id===saved.id);
 if(!saved){saved={key,applicationId:application.id,applicationVersion:application.version,action:selection.action,
  selectionId:selection.id??index,phase:'SELECTED',beforeSDKIds:sdkRows.map(row=>row.id),createdAt:new Date().toISOString()};
  state.customerSteps[key]=saved;await save();}
 if(!original){
  const candidates=sdkRows.filter(row=>!saved.beforeSDKIds.includes(row.id)&&row.action===selection.action);
  need(candidates.length<=1,'The saved customer selection has more than one new original SDK identity. Inspect the retained browser journal.');
  original=candidates[0];
 }
 if(original?.state==='FAILED'&&!spec.mutates){
  saved.previousOriginalReads??=[];saved.previousOriginalReads.push({id:original.id,operationId:original.operationId,
   state:original.state,providerIds:original.providerIds,checkpointSha256:original.privateCheckpointSha256});
  saved.id=null;saved.operationId=null;saved.beforeSDKIds=sdkRows.map(row=>row.id);saved.phase='SELECTED';await save();original=null;
 }
 const recoveredExisting=Boolean(original);
 let lostResponse=false,lossHandler=null,lossError=null;
 if(!original){
  if(selection.loseResponse===true){
   lossHandler=async route=>{
    try{
    let request;try{request=route.request().postDataJSON();}catch{}
    if(request?.method!=='browser.outcome'||request.args?.outcome?.action!==selection.action||request.args.outcome.state!=='COMPLETE'){
     await route.continue();return;
    }
    const candidates=await browserJournal(portalPage,{store:'sdk',scope});
    const native=candidates.find(row=>row.operationId===request.args.operationId&&!saved.beforeSDKIds.includes(row.id));
    if(!native){await route.continue();return;}
    const response=await route.fetch(),bytes=Buffer.from(await response.body());
    if(!response.ok()){await route.fulfill({response});return;}
    saved.id=native.id;saved.operationId=native.operationId;saved.outcomeRequestId=request.args.requestId;
    saved.lostPublicResponse={status:response.status(),bytes:bytes.length,sha256:digest(bytes),
     result:JSON.parse(bytes.toString('utf8'))};saved.phase='HOST_OUTCOME_RETAINED_RESPONSE_LOST';await save();
    await exact(target('browser/customer-recovery/'+request.args.requestId+'.request.json'),Buffer.from(route.request().postData()??''));
    await exact(target('browser/customer-recovery/'+request.args.requestId+'.response.json'),bytes);
    await route.abort('failed');lostResponse=true;
    }catch(error){lossError=await safeError(error);await route.abort('failed').catch(()=>{});}
   };
   await portalPage.route('**/api/portal/invoke',lossHandler);
  }
  try{
   await portalPage.locator('nav [data-tab="advanced"]').click();
   await portalPage.locator('#sdk-action').selectOption(selection.action);
   await portalPage.locator('#sdk-args').fill(JSON.stringify(args,null,2));
   await portalPage.locator('#sdk-form button.primary').click();
   original=await browserWait(async()=>{
    const rows=await browserJournal(portalPage,{store:'sdk',scope}),candidates=rows.filter(row=>!saved.beforeSDKIds.includes(row.id)&&row.action===selection.action);
    need(candidates.length<=1,'A customer click produced more than one new original SDK action.');
    return candidates[0]??null;
   });
   saved.id=original.id;saved.operationId=original.operationId;saved.phase='ORIGINAL_SDK_DISPATCHED';await save();
   original=await browserWait(async()=>{
    const [row]=await browserJournal(portalPage,{store:'sdk',scope,id:saved.id});
    if(row?.lastError||row?.lastNativeReturnAt||row?.state==='FAILED')return row;
    return null;
   },{timeout:selection.timeoutMs??180000,message:'The original SDK outcome remains pending in its private browser checkpoint.'});
   // Remove one-call secret inputs from the visible form, preserving the
   // unchanged private checkpoint solely in the original browser journal.
   await portalPage.locator('#sdk-args').fill(JSON.stringify(imports.catalogue.publicPollarArguments(selection.action,args).args,null,2));
   if(lossError)need(false,'The original customer response-loss carrier failed.',lossError);
   if(selection.loseResponse===true&&original.state==='COMPLETE'&&original.hostAttemptId)
    need(lostResponse,'The complete original customer response-loss exchange was not observed.');
  }finally{if(lossHandler)await portalPage.unroute('**/api/portal/invoke',lossHandler);}
 }
 if(recoveredExisting&&!['COMPLETE','FAILED','CANCELED'].includes(original.state)){
  const sequence=original.checkpoint?.sequence??null,last=original.lastNativeReturnAt;
  await portalPage.locator('#recover-operations').click();
  original=await browserWait(async()=>{
   const [row]=await browserJournal(portalPage,{store:'sdk',scope,id:saved.id});
   return row&&(row.checkpoint?.sequence!==sequence||row.lastNativeReturnAt!==last||['COMPLETE','FAILED'].includes(row.state))?row:null;
  },{timeout:selection.timeoutMs??180000,message:'The same original SDK operation is awaiting its provider reconciliation.'});
 }
 saved.id=original.id;saved.operationId=original.operationId;
 if(lostResponse||saved.phase==='HOST_OUTCOME_RETAINED_RESPONSE_LOST'||saved.outcomeRequestId){
  const before=await browserJournal(portalPage,{store:'sdk',scope,id:saved.id});
  const originalCheckpoint=before[0]?.privateCheckpointSha256;
  await portalPage.reload({waitUntil:'domcontentloaded'});
  await browserWait(async()=>(await portalState(portalPage))?.ready);
  const recovered=await browserWait(async()=>{
   const requests=await browserJournal(portalPage,{scope}),request=requests.find(row=>row.id===saved.outcomeRequestId);
   return request?.state==='COMPLETE'?request:null;
  },{timeout:90000,message:'The original customer host outcome did not recover under its retained UUID.'});
  [original]=await browserJournal(portalPage,{store:'sdk',scope,id:saved.id});
  need(original?.operationId===saved.operationId,'Reload created another provider operation.');
  need(original.privateCheckpointSha256===originalCheckpoint,'A terminal original SDK checkpoint changed while its host acknowledgement was replayed.');
  need(canonical(recovered.result)===canonical(saved.lostPublicResponse.result),'The lost provider observation acknowledgement changed on replay.');
  saved.recoveredRequest={id:recovered.id,intent:recovered.intent,attempts:recovered.attempts};
 }
 saved.phase=original.state; saved.state=original.state;saved.providerIds=original.providerIds;saved.publicOutcome=original.outcome;
 saved.privateCheckpointSha256=original.privateCheckpointSha256;saved.updatedAt=new Date().toISOString();await save();
 if(original.lastError&&!original.checkpoint||original.state==='FAILED'||original.state==='UNCERTAIN'){
  const error=new Error('The actual original SDK returned a failed or uncertain customer operation. Its private browser checkpoint and public native source remain retained.');
  error.code='POLLAR_CUSTOMER_OPERATION_INCOMPLETE';error.details={operationId:original.operationId,action:original.action,state:original.state,providerIds:original.providerIds,lastError:original.lastError};throw error;
 }
 if(original.action==='sdk.history.collect')need(original.checkpoint?.history?.complete===true,
  'Keep the original complete history continuation; this selected history is still partial.',original.checkpoint?.history);
 return {...original,lostResponseRecovered:Boolean(saved.recoveredRequest),hostRecovery:saved.recoveredRequest??null};
}
if(browserContext)await step('owner-customer-portal',async()=>{
 const application=selectedApplication(customerPlan?.application),opened=await openPortal(application);
 return {applicationId:application.id,applicationVersion:application.version,state:opened.state,
  screenshot:await browserScreenshot(portalPage,'original-owner-portal',{privateOnly:true})};
},{repeat:true});
if(browserContext&&portalPage&&selectedApplications.length){
 const application=selectedApplication(customerPlan?.application);
 const ownerCustomer=privateConfiguration?.customer??{},restoredState=await portalState(portalPage);
 const generatedAuthentication=[];
 if(restoredState?.auth?.step!=='authenticated'){
  if(ownerCustomer.provider&&ownerCustomer.provider!=='email')generatedAuthentication.push({id:'owner-selected-login',action:'sdk.auth.login',args:{options:{provider:ownerCustomer.provider,...(ownerCustomer.email?{email:ownerCustomer.email}:{})}}});
  else if(ownerCustomer.email){
   generatedAuthentication.push({id:'owner-email-begin',action:'sdk.auth.beginEmail',args:{}});
   generatedAuthentication.push({id:'owner-email-send',action:'sdk.auth.sendCode',args:{email:ownerCustomer.email}});
   if(ownerCustomer.code)generatedAuthentication.push({id:'owner-email-verify/'+digest(ownerCustomer.code),action:'sdk.auth.verifyCode',args:{code:ownerCustomer.code}});
  }else if(ownerCustomer.passkey===true)generatedAuthentication.push({id:'owner-passkey-login',action:'sdk.auth.passkeyLogin',args:{}});
 }
 const steps=customerPlan?.steps??generatedAuthentication;
 need(Array.isArray(steps),'The explicit customer plan requires its original SDK steps.');
 for(let index=0;index<steps.length;index++){
  const selected=steps[index],key=digest(json({id:selected.id??index,action:selected.action})).slice(0,24);
  const result=await step('owner-customer-'+key,()=>runCustomerStep(application,selected,index),{repeat:true});
  if(result.error&&imports.catalogue.POLLAR_BROWSER_ACTIONS.find(row=>row.action===selected.action)?.mutates)break;
 }
 await step('owner-customer-session-verification',async()=>{
  const native=await portalState(portalPage);
  if(native?.auth?.step!=='authenticated'||native.auth.verified!==true)
   ownerRequired('The original owner sign-in is not complete. No customer token or wallet identity is synthesized.',{applicationId:application.id,auth:native?.auth??null});
  await portalPage.locator('#verify-session').click();
  const confirmed=await browserWait(async()=>{
   const response=await portalPage.request.get(host.startup.origin+'/api/portal/bootstrap?application='+application.id+'&version='+application.version);
   const body=await response.json();return body.session?body:null;
  });
  state.participants[application.id]={...confirmed.session,verifiedAt:new Date().toISOString()};await save();
  return {session:confirmed.session,state:await portalState(portalPage)};
 },{repeat:true});
 const native=await portalState(portalPage);
 if(native?.auth?.step==='authenticated'&&native.auth.verified===true){
  const readiness=[
   {id:'current-profile',action:'sdk.profile.read',args:{}},
   {id:'original-application',action:'sdk.application.read',args:{}},
   {id:'original-wallets',action:'sdk.wallet.list',args:{}},
   {id:'wallet-readiness',action:'sdk.wallet.provisioning',args:{}},
   {id:'wallet-balances',action:'sdk.wallet.balance',args:{},loseResponse:true},
   {id:'wallet-assets',action:'sdk.wallet.assets',args:{}},
   {id:'complete-wallet-history',action:'sdk.history.collect',args:{params:{limit:100,offset:0}}}
  ];
  for(let i=0;i<readiness.length;i++)await step('customer-original-'+readiness[i].id,()=>runCustomerStep(application,readiness[i],'readiness-'+i),{repeat:true});

  // The provider's authenticated wallet and enabled assets are the original
  // commissioning inputs. Null chain balances remain unavailable observations.
  const currentWallet=await portalState(portalPage);
  if(application.configuration.stellarNetwork==='testnet'&&!currentWallet.wallet)
   await step('customer-create-original-wallet',()=>runCustomerStep(application,{id:'derived-wallet-create',action:'sdk.wallet.create',args:{}},'derived-wallet-create'),{repeat:true});
  const provisioned=await portalState(portalPage);
  if(application.configuration.stellarNetwork==='testnet'&&provisioned.wallet?.existsOnStellar===false)
   await step('customer-create-original-stellar-account',()=>runCustomerStep(application,{id:'derived-account-create',action:'sdk.wallet.createAccount',args:{}},'derived-account-create'),{repeat:true});
  const readKinds=imports.catalogue.POLLAR_BROWSER_ACTIONS.filter(item=>!item.mutates&&
   !(item.inputSchema.required??[]).length&&!['sdk.auth.refresh','sdk.history.page','sdk.history.collect','sdk.wallet.balance','sdk.wallet.assets',
    ...readiness.map(row=>row.action)].includes(item.action));
  for(const item of readKinds)
   await step('customer-native-read-'+digest(item.action).slice(0,16),()=>runCustomerStep(application,{id:'derived-read/'+item.action,action:item.action,args:{}},'derived-read/'+item.action),{repeat:true});
  for(const rail of ['PIX','BREB'])
   await step('customer-native-liquidity-'+rail,()=>runCustomerStep(application,{id:'derived-liquidity/'+rail,action:'sdk.ramp.liquidity',args:{rail}},'derived-liquidity/'+rail),{repeat:true});
  const actual=await portalState(portalPage),wallets=actual.wallets??[],balances=actual.balance?.step==='loaded'?actual.balance.data:null,
   assets=actual.assets?.step==='loaded'?actual.assets.data:null;
  const plan={applicationId:application.id,network:application.configuration.stellarNetwork,wallet:actual.wallet,
   wallets,balances,assets,unknownBalanceIsZero:false,readKinds:readKinds.map(item=>item.action),generatedAt:new Date().toISOString()};
  state.customerInventory??={};state.customerInventory[application.id]=plan;await save();
  await exact(target('observed/customer-plan/'+application.id+'/'+digest(json(plan))+'.json'),json(plan));
  for(const chain of [...new Set(wallets.map(wallet=>wallet.chain).filter(value=>['STELLAR','SOLANA','POLYGON'].includes(value)))])
   await step('customer-complete-chain-history-'+chain,()=>runCustomerStep(application,{id:'derived-history/'+chain,
    action:'sdk.history.collect',args:{params:{chain,limit:100,offset:0}}},'derived-history/'+chain),{repeat:true});
  const held=new Set((balances?.balances??[]).filter(asset=>asset.chain===undefined||asset.chain==='STELLAR')
   .map(asset=>asset.code+'\n'+(asset.issuer??'')));
  if(application.configuration.stellarNetwork==='testnet'){
   for(const asset of assets?.assets??[]){
    if(asset.chain&&asset.chain!=='STELLAR'||asset.trustlineEstablished!==false||asset.sponsored!==true||
       typeof asset.code!=='string'||!/^G[A-Z2-7]{55}$/.test(asset.issuer??'')||held.has(asset.code+'\n'+asset.issuer))continue;
    const id='derived-enabled-trustline/'+asset.code+'/'+asset.issuer;
    await step('customer-enabled-trustline-'+digest(id).slice(0,16),()=>runCustomerStep(application,
     {id,action:'sdk.wallet.trustline',args:{asset:{code:asset.code,issuer:asset.issuer}}},id),{repeat:true});
   }
   await step('customer-source-derived-payment-plan',async()=>{
    const observed=await portalState(portalPage),sourceWallet=observed.wallet;
    need(observed.network==='testnet'&&observed.scope?.network==='testnet',
     'The original active SDK network must still be testnet before deriving this payment.');
    const knownWallets=inventoryWallets(await inventorySources(application)),candidates=knownWallets
     .filter(row=>row.publicKey!==sourceWallet?.address&&['GLOBAL','FUNDING','GAS','DISTRIBUTION'].includes(row.role))
     .sort((a,b)=>a.role.localeCompare(b.role)||a.publicKey.localeCompare(b.publicKey));
    const destination=privateConfiguration?.customer?.testnetDestination??
     candidates.find(row=>row.role==='FUNDING')?.publicKey??candidates[0]?.publicKey;
    if(!sourceWallet||!/^G[A-Z2-7]{55}$/.test(sourceWallet.address??'')||!destination)
     ownerRequired('The original application has not exposed both a signed customer Stellar wallet and an owned application receiving wallet.',
      {applicationId:application.id,customerWallet:sourceWallet??null,observedApplicationWallets:knownWallets});
    need(knownWallets.some(row=>row.publicKey===destination),'The selected testnet recipient must be in the original application wallet inventory.');
    const originalBalances=observed.balance?.step==='loaded'?observed.balance.data:null,
     nativeBalance=originalBalances?.balances.find(row=>(row.chain===undefined||row.chain==='STELLAR')&&(row.type==='native'||row.code==='XLM'&&!row.issuer));
    const exactUnits=value=>{
     if(typeof value!=='string'||!/^\d+(?:\.\d{1,7})?$/.test(value))return null;
     const [whole,fraction='']=value.split('.');return BigInt(whole)*10000000n+BigInt(fraction.padEnd(7,'0'));
    };
    const available=exactUnits(nativeBalance?.available);
    if(available===null)ownerRequired('The original chain balance is unavailable; the selected payment stays unprepared.',{applicationId:application.id,nativeBalance});
    if(available<1001n){
     const connection=selectedConnection(application),cfg=operatorBase.connections[connection];
     const action=cfg.personalAccessToken?'mcp.fund_testnet_wallet':'server.wallet.fund';
     await runNativeSelection({id:'derived-customer-testnet-funding/'+sourceWallet.address,application:application.id,connection,action,
      args:action.startsWith('mcp.')?{id:application.configuration.applicationId,publicKey:sourceWallet.address}:{publicKey:sourceWallet.address}},'derived-customer-testnet-funding');
     await runCustomerStep(application,{id:'balance-after-native-funding',action:'sdk.wallet.balance',args:{}},'balance-after-native-funding');
     const funded=await portalState(portalPage),fundedNative=funded.balance?.step==='loaded'?funded.balance.data.balances.find(row=>
      (row.chain===undefined||row.chain==='STELLAR')&&(row.type==='native'||row.code==='XLM'&&!row.issuer)):null;
     need((exactUnits(fundedNative?.available)??-1n)>=1001n,'The original funded wallet balance has not become available.',{wallet:sourceWallet.address,balance:fundedNative});

    }
    const id='derived-one-stroop-payment/'+sourceWallet.address+'/'+destination,selection={id,action:'sdk.payment.send',
     args:{params:{chain:'STELLAR',destination,amount:'0.0000001',asset:{type:'native'}}}};
    const intended={applicationId:application.id,customerWallet:sourceWallet,destination,amount:'0.0000001',
     asset:{type:'native'},network:'testnet',destinationSources:knownWallets.find(row=>row.publicKey===destination).sources,
     signing:'original authenticated SDK wallet and original browser signer',selection};
    await exact(target('observed/customer-payment/'+digest(json(intended))+'.json'),json(intended));
    const outcome=await runCustomerStep(application,selection,id);
    if(outcome.providerIds?.transactionHash){
     const transactionHash=outcome.providerIds.transactionHash;
     state.transactionObservations??={};const known=state.transactionObservations[transactionHash]??{attempts:[],next:0};
     const number=known.next,status=await runCustomerStep(application,{id:'derived-payment-status/'+transactionHash+'/'+number,
      action:'sdk.transaction.status',args:{hash:transactionHash}},'derived-payment-status/'+transactionHash+'/'+number);
     const nativeStatus=status.outcome?.result;
     need(nativeStatus?.hash===transactionHash&&['PENDING','SUCCESS','FAILED'].includes(nativeStatus?.status),
      'The original status response did not identify this selected transaction.',{transactionHash,status:nativeStatus});
     known.attempts.push({operationId:status.operationId,hash:transactionHash,status:nativeStatus.status,observedAt:new Date().toISOString()});
     known.next=number+1;state.transactionObservations[transactionHash]=known;await save();
     await runCustomerStep(application,{id:'complete-history-after/'+transactionHash,action:'sdk.history.collect',args:{params:{chain:'STELLAR',limit:100,offset:0}}},'complete-history-after/'+transactionHash);
     need(nativeStatus.status==='SUCCESS','The original signed payment has not reached SUCCESS.',{transactionHash,status:nativeStatus,originalOperationId:outcome.operationId});
     return {intended,operation:outcome,status};
    }
    need(false,'The original payment has no retained transaction hash for native SUCCESS readback.',
     {operationId:outcome.operationId,state:outcome.state,providerIds:outcome.providerIds??null});
   },{repeat:true});
  }

  await step('customer-original-views',async()=>{
   const views=[];for(const name of ['connect','wallet','activity','pending','advanced','reports']){
    await portalPage.locator('nav [data-tab="'+name+'"]').click();await portalPage.locator('[data-panel="'+name+'"]').waitFor({state:'visible'});
    views.push({name,heading:await portalPage.locator('[data-panel="'+name+'"] h2').textContent()});
   }
   return {applicationId:application.id,views,state:await portalState(portalPage),
    publicOriginalOperations:await browserJournal(portalPage,{store:'sdk',scope:'portal:'+application.id}),
    screenshot:await browserScreenshot(portalPage,'original-customer-activity',{privateOnly:true})};
  },{repeat:true});
 }
}


async function checkedDescriptor(base,file){
 const relative=safeRelative(file.path),filename=path.join(base,...relative.split('/')),stat=await fs.lstat(filename);
 need(stat.isFile()&&!stat.isSymbolicLink(),'A transported original member must be a regular file.',{path:relative});
 const actual=await fullHash(filename);
 need(actual.bytes===file.bytes&&actual.sha256===file.sha256,'The complete original transported member differs.',{path:relative});
 return {path:relative,...actual,mode:stat.mode&0o777};
}
async function receiveHTTPFile(label,url,filename,{token,expectedManifestSha256}={}){
 const descriptorFile=filename+'.receipt.json';
 if(await exists(descriptorFile)){
  const original=await readJSON(descriptorFile),actual=await fullHash(filename);
  need(actual.bytes===original.bytes&&actual.sha256===original.sha256,'The retained original HTTP file differs.');
  if(expectedManifestSha256)need(original.manifestSha256===expectedManifestSha256,'The original HTTP file selects another manifest.');
  return original;
 }
 await directory(path.dirname(filename));
 const response=await fetch(url,{headers:token?{Authorization:'Bearer '+token}:{},signal:controller.signal});
 const selected=response.headers.get('x-pollar-manifest-sha256');
 need(response.ok,'The complete original file route did not return success.',{status:response.status,url});
 if(expectedManifestSha256)need(selected===expectedManifestSha256,'The archive response names another original manifest.');
 const temporary=filename+'.pending-'+randomUUID();
 await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary,{flags:'wx',mode:0o600}),{signal:controller.signal});
 const actual=await fullHash(temporary),handle=await fs.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
 if(await exists(filename)){
  const previous=await fullHash(filename);need(previous.bytes===actual.bytes&&previous.sha256===actual.sha256,'The original complete response changed on retry.');
  await fs.unlink(temporary);
 }else await fs.rename(temporary,filename);
 const parent=await fs.open(path.dirname(filename),'r');try{await parent.sync();}finally{await parent.close();}
 const result={label,path:filename,...actual,manifestSha256:selected,url,status:response.status,
  headers:Object.fromEntries([...response.headers].filter(([key])=>key!=='set-cookie')),completedAt:new Date().toISOString()};
 await exact(descriptorFile,json(result));return result;
}
async function originalExport(kind,{reportId,selection}={}){
 state.deliveries??={};
 const chosen=selection??digest(json({sourceGeneration:activeGeneration,kind,reportId:reportId??null}));
 let saved=state.deliveries[chosen];
 if(!saved){saved={id:randomUUID(),kind,reportId:reportId??null,phase:'SELECTED',createdAt:new Date().toISOString()};
  saved.directory=target('deliveries/'+kind+'/'+saved.id);state.deliveries[chosen]=saved;await save();}
 const label='export/'+kind+'/'+saved.id,method=kind==='workspace'?'workspace.export':'report.export';
 const result=await invokeOriginal(label,method,{destination:saved.directory,name:'Pollar original '+kind+' '+OPERATION,
  ...(reportId?{reportId}:{})});
 need(result.exportId&&result.directory===saved.directory,'The original export descriptor is incomplete.');
 const inspection=await imports.receiving.inspectPollarDelivery({sourceDirectory:result.directory,expectedManifestSha256:result.manifestSha256});
 need(inspection.manifest.id===result.exportId&&inspection.manifest.workspaceId===state.workspaceId,
  'The original delivery selected another source workspace.');
 saved.phase='COMPLETE';saved.result=result;saved.manifestSha256=result.manifestSha256;await save();
 return {...result,inspection:{manifest:inspection.manifest,manifestSha256:inspection.manifestSha256,bytes:inspection.bytes}};
}
await step('complete-original-operation-sources',()=>collectOriginalSources(),{repeat:true});
const originalReports=[];
for(const application of selectedApplications){
 const result=await step('original-partner-report-'+application.id,async()=>{
  const current=await operator.workspace.readState(),operations=Object.values(current.operations).filter(row=>row.applicationId===application.id);
  const selection=digest(json({applicationId:application.id,version:application.version,operations:operations.map(row=>({
   id:row.id,state:row.state,paused:row.paused,sourceIds:row.sourceIds,providerIds:row.providerIds,execution:row.execution??null})),
   decisions:Object.values(current.decisions).filter(row=>row.applicationId===application.id).map(row=>row.id)}));
  const snapshot=await invokeOriginal('reports/'+application.id+'/'+selection+'/snapshot','snapshot.create',{
   applicationId:application.id,applicationVersion:application.version,name:'Original partner commissioning '+application.name,
   operationIds:operations.map(row=>row.id)});
  const created=await invokeOriginal('reports/'+application.id+'/'+selection+'/report','report.create',{
   snapshotId:snapshot.snapshot.id,name:application.name+' original SDK and native outcome report'});
  const read=await operator.invoke({method:'report.read',args:{reportId:created.report.id}}),files=[];
  for(const format of ['json','csv','html']){
   const selected=read.record.files.find(item=>item.format===format);need(selected,'The original complete report format is missing.');
   const file=await retainedPublicFile('reports/'+created.report.id+'/'+selected.filename,(offset,length)=>
    operator.invoke({method:'report.file',args:{reportId:created.report.id,format,offset,length}}));
   need(file.sha256===selected.file.sha256&&file.bytes===selected.file.bytes,'The full original report member differs.');
   files.push({format,...file});
  }
  state.reports[application.id]={id:created.report.id,snapshotId:snapshot.snapshot.id,selection,files};await save();
  if(browserContext&&operatorPage){
   await operatorPage.reload({waitUntil:'domcontentloaded'});
   await browserWait(async()=>((await operatorPage.locator('#workspace-label').textContent())??'').includes(state.workspaceId));
   await operatorPage.locator('nav [data-tab="reports"]').click();
   await browserWait(async()=>((await operatorPage.locator('[data-panel="reports"]').textContent())??'').includes(created.report.id));
  }
  return {applicationId:application.id,report:read.record,snapshot:snapshot.snapshot,files};
 },{repeat:true});
 if(!result.error)originalReports.push(result);
}
const reportDeliveries=[];
for(const report of originalReports){
 const result=await step('scoped-original-report-delivery-'+report.report.id,async()=>{
  const exported=await originalExport('report',{reportId:report.report.id});
  need(exported.inspection.manifest.runtimes.length===0,'A scoped report unexpectedly carried private runtime source.');
  need(!exported.inspection.manifest.files.some(file=>file.path.startsWith('workspace/')||file.role==='runtime'),
   'A scoped report unexpectedly included full workspace source.');
  const archive=await receiveHTTPFile('report-archive',host.startup.origin+'/api/packages/'+exported.exportId+'/archive',
   target('archives/report-'+exported.exportId+'.tar.gz'),{token:apiToken,expectedManifestSha256:exported.manifestSha256});
  const sourceDirectory=target('unpacked/report-'+exported.exportId),unpacked=await imports.archive.unpackPollarDelivery({
   input:createReadStream(archive.path),destination:sourceDirectory,expectedManifestSha256:exported.manifestSha256,signal:controller.signal});
  const request=await pinnedRequest('received/report-'+exported.exportId,'package.receive',{
   sourceDirectory:unpacked.sourceDirectory,destination:target('received/report-'+exported.exportId),
   expectedManifestSha256:exported.manifestSha256});
  const received=await imports.receiving.receivePollarDelivery(request.args);
  need(received.kind==='report'&&received.workspace===null&&received.runtimes.length===0,
   'The report recipient received a different package scope.');
  for(const member of report.report.files){
   const actual=await fullHash(path.join(received.directory,'report',member.filename));
   need(actual.bytes===member.file.bytes&&actual.sha256===member.file.sha256,'The received scoped report differs from its original bytes.');
  }
  return {exported,archive,unpacked,received};
 },{repeat:true});
 if(!result.error)reportDeliveries.push(result);
}
const originalSnapshot=await operator.workspace.readState();
const finalSourceSelection=digest(json({sourceGeneration:activeGeneration,
 applications:Object.values(originalSnapshot.applications),participants:Object.values(originalSnapshot.participants),
 operations:Object.values(originalSnapshot.operations),sources:Object.values(originalSnapshot.sources),
 snapshots:Object.values(originalSnapshot.snapshots),decisions:Object.values(originalSnapshot.decisions),
 reports:Object.values(originalSnapshot.reports),runtimeIds:operatorBase.runtimes}));
let fullDelivery=null,fullArchive=null,unpackedWorkspace=null,receivedWorkspace=null;
const delivered=await step('complete-original-workspace-export',()=>originalExport('workspace',{selection:finalSourceSelection}),{repeat:true});
if(!delivered.error){fullDelivery=delivered;state.activeDelivery={exportId:delivered.exportId,directory:delivered.directory,manifestSha256:delivered.manifestSha256};await save();}
if(fullDelivery){
 await step('original-workspace-export-replay',async()=>{
  const before=(await operator.describe()).revision;
  const replayed=await originalExport('workspace',{selection:finalSourceSelection}),after=(await operator.describe()).revision;
  need(replayed.exportId===fullDelivery.exportId&&replayed.manifestSha256===fullDelivery.manifestSha256&&before===after,
   'The same original export changed its native identity or workspace revision.');
  return {exportId:replayed.exportId,manifestSha256:replayed.manifestSha256,revision:after};
 },{repeat:true});
 const downloaded=await step('complete-http-archive-download',()=>receiveHTTPFile('full-workspace',
  host.startup.origin+'/api/packages/'+fullDelivery.exportId+'/archive',target('archives/workspace-'+fullDelivery.exportId+'.tar.gz'),
  {token:apiToken,expectedManifestSha256:fullDelivery.manifestSha256}),{repeat:true});
 if(!downloaded.error)fullArchive=downloaded;
}
async function uploadOriginalArchive({requestId,archive=fullArchive,manifestSha256=fullDelivery.manifestSha256}={}){
 const url=host.startup.origin+'/api/packages/unpack?requestId='+encodeURIComponent(requestId)+'&manifestSha256='+manifestSha256;
 const metadata={requestId,method:'POST',path:new URL(url).pathname+new URL(url).search,manifestSha256,
  archive:{bytes:archive.bytes,sha256:archive.sha256}};
 await exact(target('http/uploads/'+requestId+'.request.json'),json(metadata));
 const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+apiToken,'X-Pollar-Workspace-ID':state.workspaceId,
  'X-Pollar-Manifest-SHA256':manifestSha256,'Content-Type':'application/gzip','Content-Length':String(archive.bytes)},
  body:createReadStream(archive.path),duplex:'half',signal:controller.signal});
 const bytes=Buffer.from(await response.arrayBuffer()),value=JSON.parse(bytes.toString('utf8'));
 await exact(target('http/uploads/'+requestId+'.response-'+digest(bytes)+'.json'),bytes);
 need(response.ok,'The original archive upload did not complete.',{status:response.status,response:publicRecord(value)});
 need(value.manifestSha256===manifestSha256,'The receiving source names another original archive.');
 return {requestId,sourceDirectory:value.sourceDirectory,manifest:value.manifest,manifestSha256:value.manifestSha256,bytes:value.bytes};
}
if(fullArchive&&browserContext&&operatorPage){
 const result=await step('operator-original-file-response-recovery',async()=>{
  const key=fullDelivery.exportId;state.archiveUploads??={};let saved=state.archiveUploads[key];
  if(!saved){saved={id:null,exportId:key,phase:'SELECTED',archive:{bytes:fullArchive.bytes,sha256:fullArchive.sha256},
   manifestSha256:fullDelivery.manifestSha256,createdAt:new Date().toISOString()};state.archiveUploads[key]=saved;await save();}
  let requests=await browserJournal(operatorPage),request=saved.id?requests.find(row=>row.id===saved.id):requests.find(row=>
   row.method==='package.unpack'&&row.fileSelection?.sha256===fullArchive.sha256);
  if(!request){
   await operatorPage.locator('nav [data-tab="receiving"]').click();
   let resolveResponse,rejectResponse;const responseObserved=new Promise((resolve,reject)=>{resolveResponse=resolve;rejectResponse=reject;});
   const handler=async route=>{
    const url=new URL(route.request().url()),id=url.searchParams.get('requestId');
    if(url.pathname!=='/api/packages/unpack'||url.searchParams.get('manifestSha256')!==fullDelivery.manifestSha256){await route.continue();return;}
    try{
     saved.id=id;saved.phase='ORIGINAL_FILE_DISPATCHED';await save();
     const response=await route.fetch(),bytes=Buffer.from(await response.body());
     if(!response.ok()){await route.fulfill({response});rejectResponse(new Error('The original browser archive upload returned HTTP '+response.status()));return;}
     const result=JSON.parse(bytes.toString('utf8'));
     need(result.manifestSha256===fullDelivery.manifestSha256,'The original file upload returned another manifest.');
     saved.originalResponse=result;saved.phase='ORIGINAL_UPLOAD_ACKNOWLEDGED_RESPONSE_LOST';await save();
     await exact(target('http/uploads/'+id+'.browser-response.json'),bytes);
     await route.abort('failed');resolveResponse(result);
    }catch(error){rejectResponse(error);await route.abort('failed').catch(()=>{});}
   };
   await operatorPage.route('**/api/packages/unpack?*',handler);
   try{
    await operatorPage.locator('#unpack-form input[name="manifestSha256"]').fill(fullDelivery.manifestSha256);
    await operatorPage.locator('#unpack-form input[name="archive"]').setInputFiles(fullArchive.path);
    await operatorPage.locator('#unpack-form button.primary').click();
    await Promise.race([responseObserved,new Promise((_,reject)=>setTimeout(()=>reject(new Error('The complete original browser upload is still pending.')),600000))]);
    request=await browserWait(async()=>{
     const rows=await browserJournal(operatorPage),row=rows.find(item=>item.id===saved.id);
     return row&&['UNCERTAIN','SENDING'].includes(row.state)?row:null;
    });
   }finally{await operatorPage.unroute('**/api/packages/unpack?*',handler);}
  }
  need(request?.fileSelection?.sha256===fullArchive.sha256,'The original persisted browser file differs.');
  need(request.retainedFile?.isFile&&request.retainedFile.size===fullArchive.bytes,'The complete original File is absent after dispatch.');
  saved.id=request.id;await save();const originalIntent=request.intent,fileSelection=request.fileSelection;
  await operatorPage.reload({waitUntil:'domcontentloaded'});
  await browserWait(async()=>((await operatorPage.locator('#workspace-label').textContent())??'').includes(state.workspaceId));
  const recovered=await browserWait(async()=>{
   const rows=await browserJournal(operatorPage),row=rows.find(item=>item.id===saved.id);return row?.state==='COMPLETE'?row:null;
  },{timeout:600000,message:'The same original archived File has not completed its receiving-source recovery.'});
  need(recovered.id===saved.id&&recovered.intent===originalIntent&&canonical(recovered.fileSelection)===canonical(fileSelection),
   'The browser changed the original archive request or File selection.');
  need(recovered.result.manifestSha256===fullDelivery.manifestSha256,'The browser recovered a different package.');
  if(saved.originalResponse)need(canonical(recovered.result)===canonical(saved.originalResponse),
   'The original acknowledged upload response differs after replay.');
  saved.result=recovered.result;saved.phase='COMPLETE';await save();
  return {requestId:saved.id,fileSelection,attempts:recovered.attempts,originalResponse:saved.originalResponse??null,
   recovered:recovered.result,retainedCompleteFile:recovered.retainedFile,
   screenshot:await browserScreenshot(operatorPage,'complete-original-file-recovered')};
 },{repeat:true});
 if(!result.error)unpackedWorkspace=result.recovered;
}
if(fullArchive&&!unpackedWorkspace){
 const result=await step('complete-http-archive-upload',async()=>{
  state.archiveUploads??={};let saved=state.archiveUploads[fullDelivery.exportId];
  if(!saved){saved={id:randomUUID(),exportId:fullDelivery.exportId,phase:'SELECTED',manifestSha256:fullDelivery.manifestSha256};state.archiveUploads[fullDelivery.exportId]=saved;}
  saved.id??=randomUUID();await save();
  const result=await uploadOriginalArchive({requestId:saved.id});saved.result=result;saved.phase='COMPLETE';await save();return result;
 },{repeat:true});
 if(!result.error)unpackedWorkspace=result;
}
if(unpackedWorkspace){
 const outcome=await step('complete-independent-source-receiving',async()=>{
  const inspected=await imports.receiving.inspectPollarDelivery({sourceDirectory:unpackedWorkspace.sourceDirectory,
   expectedManifestSha256:fullDelivery.manifestSha256});
  need(inspected.manifest.id===fullDelivery.exportId,'The receiving source is from another original export.');
  // Delivery input contains only declared regular files. Native package links
  // are reconstructed only by the original runtime restore implementation.
  for(const file of inspected.manifest.files)await checkedDescriptor(unpackedWorkspace.sourceDirectory,file);
  const before=JSON.parse(await fs.readFile(path.join(unpackedWorkspace.sourceDirectory,'workspace/state.json'),'utf8'));
  need(before.workspaceId===state.workspaceId&&before.revision===fullDelivery.sourceRevision&&before.head===fullDelivery.sourceHead,
   'The full original source snapshot changed during archive transfer.');
  const request=await pinnedRequest('received/workspace-'+fullDelivery.exportId,'package.receive',{
   sourceDirectory:unpackedWorkspace.sourceDirectory,destination:target('received/workspace-'+fullDelivery.exportId),
   expectedManifestSha256:fullDelivery.manifestSha256});
  const result=await imports.receiving.receivePollarDelivery(request.args),again=await imports.receiving.receivePollarDelivery(request.args);
  need(result.requestId===again.requestId&&result.exportId===again.exportId&&again.replayed===true,
   'The original receiving request did not recover its complete immutable receipt.');
  const after=JSON.parse(await fs.readFile(path.join(result.workspace.directory,'state.json'),'utf8'));
  need(after.workspaceId===before.workspaceId&&after.revision>=before.revision+1,'The received workspace lost its original identity or receiving transition.');
  for(const [id,source]of Object.entries(before.sources))need(canonical(after.sources[id])===canonical(source),'The receiver changed an original source record.',{sourceId:id});
  for(const [id,original]of Object.entries(before.operations)){
   const received=after.operations[id];need(received,'The receiver omitted an original operation.',{operationId:id});
   for(const field of ['id','action','args','prepared','request','nextRequest','attemptIds','sourceIds','providerIds','createdByRequestId','state','outcomes'])
    if(original[field]!==undefined)need(canonical(received[field])===canonical(original[field]),
     'Receiving changed an original action, response or continuation.',{operationId:id,field});
   if(!['COMPLETE','FAILED','CANCELED'].includes(original.state))need(received.paused===true,
    'The independent recipient did not pause unfinished original work.',{operationId:id});
   if(original.execution){
    need(canonical(received.execution.args)===canonical(original.execution.args)&&
     canonical(received.execution.childRequests)===canonical(original.execution.childRequests)&&received.execution.requestId===original.execution.requestId,
     'The original complete-page execution changed after receiving.',{operationId:id});
    if(!['COMPLETE','CANCELED'].includes(original.execution.state))need(received.execution.paused&&received.execution.state==='PAUSED',
     'The recipient did not pause the original active collector.');
   }
  }
  need(canonical(after.applications)===canonical(before.applications),'Original application versions changed after receiving.');
  for(const runtimeSelection of inspected.manifest.runtimes){
   const received=result.runtimes.find(item=>item.id===runtimeSelection.id);
   need(received?.manifestSha256===runtimeSelection.manifestSha256,'An original runtime graph was omitted.');
   const transport=await imports.runtime.readPollarRuntimeManifest({directory:received.sourceDirectory,
    expectedManifestSha256:received.manifestSha256});
   const m=transport.manifest;
   for(const file of m.files)await checkedDescriptor(received.sourceDirectory,file);
   for(const link of m.links){
    const pathInSource=path.join(received.sourceDirectory,safeRelative(link.path));
    need(!await exists(pathInSource),'A file-only runtime source unexpectedly transported a native link.',{path:link.path});
   }
  }
  state.received??={};state.received[fullDelivery.exportId]=result;state.activeReceived=result;await save();
  return {received:result,replay:again,source:{workspaceId:before.workspaceId,revision:before.revision,head:before.head,
   operations:Object.keys(before.operations).length,sources:Object.keys(before.sources).length},
   restored:{workspaceId:after.workspaceId,revision:after.revision,head:after.head}};
 },{repeat:true});
 if(!outcome.error)receivedWorkspace=outcome.received;
}
if(receivedWorkspace){
 await step('original-runtime-independent-reconstruction',async()=>{
  const restored=[],require=createRequire(path.join(root,'received-native-runtime-consumer.cjs'));
  for(const item of receivedWorkspace.runtimes){
   const actual=await imports.runtime.verifyPollarRuntime({directory:item.directory,expectedManifestSha256:item.manifestSha256});
   need(actual.id===item.id,'The restored original runtime ID changed.');
   const original=(state.retainedRuntimes??{})[actual.id];
   if(original)need(original.manifestSha256===actual.manifestSha256,'The receiver changed the original installed runtime manifest.');
   const importsRead=[];
   for(const [name,entrypoint]of Object.entries(actual.entrypoints)){
    const value=await import(pathToFileURL(entrypoint).href);importsRead.push({name,kind:'import',exports:Object.keys(value)});
    if(name==='@pollar/core')need(value.POLLAR_CORE_VERSION===SDK_VERSION,'The restored original core version differs.');
    if(name==='@pollar/react')need(value.POLLAR_REACT_VERSION===SDK_VERSION,'The restored original React version differs.');
   }
   for(const [name,entrypoint]of Object.entries(actual.requireEntrypoints)){
    const value=require(entrypoint);importsRead.push({name,kind:'require',exports:Object.keys(value)});
   }
   for(const link of actual.manifest.links){
    const targetPath=path.join(actual.directory,link.path),stat=await fs.lstat(targetPath);
    need(stat.isSymbolicLink(),'A native package-resolution link was not reconstructed.',{path:link.path});
   }
   restored.push({id:actual.id,manifestSha256:actual.manifestSha256,versions:actual.versions,files:actual.manifest.files.length,
    links:actual.manifest.links.length,imports:importsRead,browser:actual.browser});
  }
  return {runtimes:restored,regularFileTransport:true,originalResolutionReconstructed:true};
 },{repeat:true});
 await step('original-host-graceful-stop',async()=>{
  const before=await operator.describe(),startup={...host.startup};delete startup.url;
  if(portalPage){await portalPage.close();portalPage=null;}
  if(operatorPage){await operatorPage.close();operatorPage=null;}
  await host.close();host=null;
  const checked=await imports.workspace.inspectPollarPartnerWorkspace({directory:workspaceDirectory});
  need(checked.workspaceId===before.workspaceId&&checked.revision===before.revision,'Draining the original host changed the workspace unexpectedly.');
  return {startup,workspaceId:checked.workspaceId,revision:checked.revision,stoppedAt:new Date().toISOString()};
 },{repeat:true});
 const reopened=await step('received-original-host-lifecycle',async()=>{
  need(!host,'Drain the originating host before reopening at the same allowlisted origin.');
  const module=await import(pathToFileURL(receivedWorkspace.application.server).href);
  const nextConfiguration={...operatorBase,runtimes:receivedWorkspace.runtimes.map(item=>({directory:item.directory,expectedManifestSha256:item.manifestSha256}))};
  receivedHost=await module.startPollarPartnerServer({workspaceDirectory:receivedWorkspace.workspace.directory,
   configuration:nextConfiguration,port:Number(options.port??8778),expectedWorkspaceId:state.workspaceId,
   applicationDirectory:receivedWorkspace.application.directory,deliveryDirectory:target('received-inbox'),signal:controller.signal});
  const description=await receivedHost.operator.describe();
  need(description.workspaceId===state.workspaceId,'The reopened original source selected another workspace.');
  await exact(target('private/received-startup-'+activeGeneration+'-'+randomUUID()+'.json'),json(receivedHost.startup));
  const {url,...startup}=receivedHost.startup;state.receivedStartup=startup;await save();
  const bootstrap=await httpJSON('received-bootstrap',startup.origin+'/api/bootstrap',{token:startupToken(receivedHost.startup)});
  need(bootstrap.ok&&bootstrap.value.state.workspaceId===state.workspaceId,'The received original bootstrap failed.');
  return {startup,description,bootstrap:bootstrap.value};
 },{repeat:true});
 if(!reopened.error){
  if(browserContext){
   await step('received-real-operator-browser',async()=>{
    operatorPage=await browserContext.newPage();
    const opened=await inspectOperatorBrowser(operatorPage,receivedHost.startup,{directory:receivedWorkspace.workspace.directory});
    if(runtime)opened.runtimeModule=await operatorPage.evaluate(async runtimeId=>{
     const native=await import('/api/runtimes/'+runtimeId+'/pollar-runtime.mjs');
     return {exports:Object.keys(native),coreVersion:native.core.POLLAR_CORE_VERSION,reactVersion:native.pollarReact.POLLAR_REACT_VERSION};
    },runtime.id);
    return opened;
   },{repeat:true});
   for(const application of selectedApplications){
    await step('received-original-customer-'+application.id,async()=>{
     const opened=await openPortal(application,{selectedHost:receivedHost}),originalParticipant=state.participants[application.id];
     if(originalParticipant){
      need(opened.state.auth?.step==='authenticated'&&opened.state.auth.verified===true,
       'The existing original SDK browser custody did not restore its verified session.');
      need(opened.state.scope.userId===originalParticipant.userId,'The received portal restored a different original customer.');
      const originalRows=await browserJournal(portalPage,{store:'sdk',scope:'portal:'+application.id});
      const nativeOperations=await allRows('operations',{selected:receivedHost.operator,applicationId:application.id});
      for(const row of originalRows.filter(row=>row.operationId)){
       const retained=nativeOperations.rows.find(item=>item.id===row.operationId);
       // Operations acknowledged after the frozen source head remain in the
       // browser until their same original observation is accepted by this host.
       if(retained)need(retained.action===row.action,'The received operation changed the original SDK action.');
      }
      await portalPage.locator('#verify-session').click();
      await browserWait(async()=>{
       const response=await portalPage.request.get(receivedHost.startup.origin+'/api/portal/bootstrap?application='+application.id+'&version='+application.version);
       const body=await response.json();return body.session?.userId===originalParticipant.userId?body:null;
      });
      await portalPage.locator('nav [data-tab="reports"]').click();
      await portalPage.locator('#load-reports').click();
      return {applicationId:application.id,state:await portalState(portalPage),originalSDKOperations:originalRows,
       nativeOperationCount:nativeOperations.rows.length,screenshot:await browserScreenshot(portalPage,'received-customer-reports',{privateOnly:true})};
     }
     return {applicationId:application.id,state:opened.state,customerCommissioning:'awaiting original owner sign-in'};
    },{repeat:true});
   }
   for(const report of originalReports){
    await step('received-original-report-browser-'+report.report.id,async()=>{
     const url=receivedHost.startup.origin+'/api/reports/'+report.report.id+'/html',page=await browserContext.newPage();
     await page.setExtraHTTPHeaders({Authorization:'Bearer '+startupToken(receivedHost.startup)});
     try{
      await page.goto(url,{waitUntil:'domcontentloaded'});
      need((await page.locator('h1').textContent())===report.report.name,'The received original report did not render.');
      return {reportId:report.report.id,title:await page.title(),heading:await page.locator('h1').textContent(),
       screenshot:await browserScreenshot(page,'received-report-'+report.report.id)};
     }finally{await page.close();}
    },{repeat:true});
   }
  }
  await step('received-native-cli-readback',async()=>{
   await receivedHost.close();receivedHost=null;
   const common=['--workspace',receivedWorkspace.workspace.directory];
   const stateRead=await command('received-cli-state',process.execPath,[receivedWorkspace.application.cli,'state',...common]);
   const actual=JSON.parse(await fs.readFile(stateRead.stdout.path,'utf8'));
   need(actual.workspaceId===state.workspaceId,'The independently received CLI opened another workspace.');
   const help=await command('received-cli-help',process.execPath,[receivedWorkspace.application.cli,'help']);
   const runtimeReads=[];
   for(const item of receivedWorkspace.runtimes)
    runtimeReads.push(await command('received-cli-runtime-'+item.id.slice(0,16),process.execPath,[receivedWorkspace.application.cli,
     'runtime-verify','--runtime-directory',item.directory,'--expected-manifest-sha256',item.manifestSha256]));
   return {state:actual,command:stateRead,help,runtimeReads};
  },{repeat:true});
 }
}
if(options['protocol-programme'])await step('local-original-transport-contract',async()=>{
 const filename=path.resolve(options['protocol-programme']),identity=await fullHash(filename);
 need(identity.bytes===10652&&identity.sha256==='793a9ef1f585268e242134440c8e6e5dc2bc4674ef52a0118e0d12d9db049b6e',
  'Use the complete original root protocol fixture unchanged.');
 const destination=target('original-protocol-fixture.mjs');await exact(destination,await fs.readFile(filename),0o644);
 const report=target('local-transport-contract-report.json');
 const commandResult=await command('local-transport-contract',process.execPath,[destination,P,report]);
 return {kind:'local-transport-contract-acceptance',providerCommissioning:false,source:identity,command:commandResult,
  report:await readJSON(report)};
},{repeat:true});
} finally {
 if(portalPage)await portalPage.close().catch(()=>{});
 if(operatorPage)await operatorPage.close().catch(()=>{});
 if(browserContext)await browserContext.close().catch(()=>{});
 if(receivedHost)await receivedHost.close().catch(()=>{});
 if(host)await host.close().catch(()=>{});
}
await step('final-original-provider-outcomes',async()=>{
 const candidates=[{kind:'original',directory:target('workspace')}];
 if(state.activeReceived?.workspace?.directory)candidates.push({kind:'received',directory:state.activeReceived.workspace.directory});
 const snapshots=[];
 for(const selected of candidates){
  const filename=path.join(selected.directory,'state.json');
  if(!await exists(filename))continue;
  const bytes=await fs.readFile(filename),original=JSON.parse(bytes.toString('utf8'));
  need(original.workspaceId===state.workspaceId,'The final original outcome source selected another workspace.');
  const operations=Object.values(original.operations??{}),counts={};
  for(const operation of operations)counts[operation.state]=(counts[operation.state]??0)+1;
  const pending=operations.filter(operation=>operation.state!=='CANCELED'&&(
   !['COMPLETE','FAILED'].includes(operation.state)||
   Boolean(operation.nextRequest)||
   operation.execution&&!['COMPLETE','CANCELED'].includes(operation.execution.state)))
   .map(operation=>({id:operation.id,action:operation.action,state:operation.state,paused:operation.paused??false,
    providerIds:operation.providerIds??{},sourceIds:operation.sourceIds??[],nextRequest:operation.nextRequest??null,
    execution:operation.execution??null}));
  snapshots.push({...selected,workspaceId:original.workspaceId,revision:original.revision,head:original.head,
   stateFile:{bytes:bytes.length,sha256:digest(bytes)},counts,pending});
 }
 need(snapshots.length>0,'The original native workspace was not available for final outcome inspection.');
 // The received workspace may have acknowledged a retained browser outcome
 // after the frozen export. Keep both states; completion follows that continuation.
 const current=snapshots.at(-1);
 state.providerOutcomeSummary={selected:current.kind,workspaceId:current.workspaceId,revision:current.revision,
  counts:current.counts,pending:current.pending,snapshots,observedAt:new Date().toISOString()};await save();
 return state.providerOutcomeSummary;
},{repeat:true});
state.status=Object.values(state.steps).some(row=>row.sourceGeneration===activeGeneration&&row.status!=='COMPLETE')||
 (state.providerOutcomeSummary?.pending?.length??0)>0?'PARTIAL':'COMPLETE';
state.finishedAt=new Date().toISOString();await save();
await announce('ORIGINAL_OPERATION_FINISHED',{operation:OPERATION,id:state.id,status:state.status,sourceGeneration:activeGeneration,
 workspaceId:state.workspaceId??null,steps:Object.fromEntries(Object.entries(state.steps).map(([name,row])=>[name,{status:row.status,sourceGeneration:row.sourceGeneration}])),
 activeDelivery:state.activeDelivery??null,receivedDirectory:state.activeReceived?.directory??null});
} catch(error) {
 if(state){state.status='PARTIAL';state.lastError=await safeError(error);await save();
  await announce('ORIGINAL_OPERATION_INTERRUPTED',{operation:OPERATION,error:state.lastError,sourceGeneration:activeGeneration});}
 else throw error;
} finally {
 try{
  if(state){
   sealedOutputRoot=target('sealed-output/'+randomUUID());await directory(sealedOutputRoot);
   await exact(path.join(sealedOutputRoot,'operation.json'),await fs.readFile(path.join(root,'operation.json')));
   await exact(path.join(sealedOutputRoot,'progress.jsonl'),await fs.readFile(path.join(root,'progress.jsonl')));
  }
 }finally{await releaseNativeLock();}
}
const operationResult=await readJSON(path.join(sealedOutputRoot??root,'operation.json'));
const artifactRows=[],artifactRoots=['source-history','generations'];
async function retainOutputInventory(filename,relative){
 const stat=await fs.lstat(filename);
 if(stat.isSymbolicLink())return;
 if(stat.isDirectory()){
  if(relative.split('/').some(part=>['private','sdk-installation','runtime-original','runtime-received','node_modules','workspace','received','received-inbox','receiving-inbox','unpacked','tmp','npm-cache','bun-cache','npm-bootstrap','request-acknowledgements'].includes(part)))return;
  for(const child of await fs.readdir(filename))await retainOutputInventory(path.join(filename,child),relative+'/'+child);
 }else if(stat.isFile()){
  const actual=await fullHash(filename);artifactRows.push({path:relative,bytes:actual.bytes,sha256:actual.sha256,mode:stat.mode&0o777});
 }
}
for(const name of artifactRoots){const filename=path.join(root,name);if(await exists(filename))await retainOutputInventory(filename,name);}
const inventory={schema:'stellar-forge.pollar-partner.native-output.v1',operation:OPERATION,
 status:operationResult.status,sourceGeneration:operationResult.activeSource?.generation,
 createdAt:new Date().toISOString(),files:artifactRows,filesCount:artifactRows.length,bytes:artifactRows.reduce((n,row)=>n+row.bytes,0),
 privateCustodyExcluded:['provider configuration and credentials','browser profile and SDK checkpoint','one-time native key results'],
 originalWorkspaceDelivery:operationResult.activeDelivery??null,independentReceivedDirectory:operationResult.activeReceived?.directory??null};
const inventoryFilename=path.join(root,'native-output-manifest-'+digest(json(inventory))+'.json');await exact(inventoryFilename,json(inventory));
process.stdout.write(JSON.stringify({event:'DURABLE_OUTPUT',operation:OPERATION,status:operationResult.status,root,
 manifest:inventoryFilename,...await fullHash(inventoryFilename),artifacts:artifactRows.length})+'\n');
if(options['courier-stdin']==='yes'){
 const allowed=new Map(artifactRows.map(file=>[file.path,file]));
 const manifestRelative=path.relative(root,inventoryFilename).split(path.sep).join('/');
 allowed.set(manifestRelative,{path:manifestRelative,...await fullHash(inventoryFilename)});
 process.stdout.write(JSON.stringify({event:'COURIER_READY',operation:OPERATION,manifest:manifestRelative,files:allowed.size})+'\n');
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
 for await(const line of lines){
  let request;try{request=JSON.parse(line);}catch{process.stdout.write(JSON.stringify({error:'INVALID_COURIER_JSON'})+'\n');continue;}
  if(request.action==='close'){lines.close();break;}
  if(request.action==='manifest'){process.stdout.write(JSON.stringify({id:request.id,manifest:inventory})+'\n');continue;}
  const file=allowed.get(request.path);
  if(request.action!=='read'||!file||!Number.isSafeInteger(request.offset??0)||request.offset<0||
     !Number.isSafeInteger(request.length??32768)||(request.length??32768)<1||(request.length??32768)>32768||(request.offset??0)>file.bytes){
   process.stdout.write(JSON.stringify({id:request.id,error:'ORIGINAL_ARTIFACT_REQUIRED'})+'\n');continue;
  }
  const offset=request.offset??0,length=Math.min(request.length??32768,Math.max(0,file.bytes-offset));
  const handle=await fs.open(path.join(root,file.path),'r'),buffer=Buffer.alloc(length);
  try{const {bytesRead}=await handle.read(buffer,0,length,offset);
   process.stdout.write(JSON.stringify({id:request.id,path:file.path,offset,bytes:file.bytes,sha256:file.sha256,
    contentBase64:buffer.subarray(0,bytesRead).toString('base64'),eof:offset+bytesRead===file.bytes})+'\n');
  }finally{await handle.close();}
 }
}
