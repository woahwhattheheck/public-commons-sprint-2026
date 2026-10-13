#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// One original native/bootstrap/browser receiving lifetime. No runtime installation.
import fs from 'node:fs/promises';
import {openSync,closeSync,fstatSync,statSync,writeSync} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const OP='LANDSAGE-PARCEL-EVIDENCE-OPERATOR-103D-20261013';
const SCHEMA='commons.landsage-foreground-receiving/v1';
const HERE=fileURLToPath(import.meta.url);
const sha=data=>createHash('sha256').update(data).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const check=(value,message)=>{if(!value)throw new Error(message);};
async function bounded(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out.')),ms);})]);}finally{clearTimeout(timer);}}
const cleanError=error=>({name:error?.name||'Error',message:String(error?.message||error),
  errors:error instanceof AggregateError?error.errors.map(cleanError):undefined});
async function read(filename,max=256*1024*1024){
 const handle=await fs.open(filename,'r');
 try{
  const before=await handle.stat();check(before.isFile()&&before.size<=max,'Use a bounded ordinary original file: '+filename);
  const data=await handle.readFile(),after=await handle.stat(),named=await fs.lstat(filename);
  const same=s=>s.dev===before.dev&&s.ino===before.ino&&s.size===before.size&&s.mtimeMs===before.mtimeMs&&s.ctimeMs===before.ctimeMs;
  check(!named.isSymbolicLink()&&same(after)&&same(named)&&data.length===before.size,'Original file changed while reading: '+filename);
  return data;
 }finally{await handle.close();}
}
async function verifyDescriptor(item){
 check(item&&typeof item.path==='string'&&Number.isSafeInteger(item.bytes)&&item.bytes>=0&&/^[a-f0-9]{64}$/.test(item.sha256||''),'Use a complete original output descriptor.');
 const handle=await fs.open(item.path,'r');
 try{
  const before=await handle.stat();check(before.isFile()&&before.size===item.bytes,'The original output size changed: '+item.path);
  const digest=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
  while(offset<before.size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);check(bytesRead>0,'The original output was truncated: '+item.path);digest.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
  const after=await handle.stat(),named=await fs.lstat(item.path);
  const same=value=>value.dev===before.dev&&value.ino===before.ino&&value.size===before.size&&value.mtimeMs===before.mtimeMs&&value.ctimeMs===before.ctimeMs;
  check(!named.isSymbolicLink()&&same(after)&&same(named)&&digest.digest('hex')===item.sha256,'The completed original output changed: '+item.path);
 }finally{await handle.close();}
}
async function json(filename,max){return JSON.parse(await read(filename,max));}
async function maybe(filename){try{return await json(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function syncDirectory(directory){const h=await fs.open(directory,'r');try{await h.sync();}finally{await h.close();}}
async function retain(filename,data){
 await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
 const temporary=filename+'.receiving-'+randomUUID();
 const h=await fs.open(temporary,'wx',0o600);
 try{await h.writeFile(data);await h.sync();}finally{await h.close();}
 try{
  try{await fs.link(temporary,filename);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const previous=await read(filename);check(previous.equals(data),'The original retained selection changed: '+filename);
  }
  await syncDirectory(path.dirname(filename));
 }finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 return {path:filename,bytes:data.length,sha256:sha(data)};
}
async function replacePrivate(filename,data){
 await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
 const temporary=filename+'.receiving-'+randomUUID(),h=await fs.open(temporary,'wx',0o600);
 try{await h.writeFile(data);await h.sync();}finally{await h.close();}
 await fs.rename(temporary,filename);await syncDirectory(path.dirname(filename));
}
function parse(argv){
 const locked=argv.includes('--locked'),args=argv.filter(x=>x!=='--locked');
 const allowed=new Set(['--application-root','--directory','--inputs','--python','--playwright-module','--chromium','--operation-timeout','--browser-timeout']);
 check(args.length%2===0,'Use complete named option/value pairs.');
 const options={};
 for(let i=0;i<args.length;i+=2){check(allowed.has(args[i])&&!Object.hasOwn(options,args[i])&&args[i+1]&&!args[i+1].includes('\0'),'Invalid or repeated receiving option.');options[args[i]]=args[i+1];}
 for(const key of ['--application-root','--directory','--inputs','--python','--playwright-module','--chromium'])check(options[key]&&path.isAbsolute(options[key]),'Select the absolute installed '+key+' path.');
 const seconds=Number(options['--operation-timeout']||1200),browserSeconds=Number(options['--browser-timeout']||1800);
 check(Number.isSafeInteger(seconds)&&seconds>0&&seconds<=7200&&Number.isSafeInteger(browserSeconds)&&browserSeconds>0&&browserSeconds<=7200,'Use bounded operation/browser seconds up to7200.');
 return {locked,app:path.resolve(options['--application-root']),directory:path.resolve(options['--directory']),
  inputs:path.resolve(options['--inputs']),python:path.resolve(options['--python']),
  playwright:path.resolve(options['--playwright-module']),chromium:path.resolve(options['--chromium']),
  operationSeconds:seconds,browserSeconds,argv:args};
}
const LOCK=String.raw`
import fcntl,os,sys
directory,node,module,*args=sys.argv[1:]
os.makedirs(directory,mode=0o700,exist_ok=True)
fd=os.open(os.path.join(directory,'foreground.lock'),os.O_CREAT|os.O_RDWR|getattr(os,'O_NOFOLLOW',0),0o600)
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
os.set_inheritable(fd,True)
env=dict(os.environ);env['LANDSAGE_RECEIVING_LOCK_FD']=str(fd)
os.execvpe(node,[node,module,'--locked',*args],env)
`;
const SOURCE_SCAN="\nimport json,sys,hashlib\nfrom pathlib import Path\napp=Path(sys.argv[1]).resolve(strict=True)\nsys.path[:0]=[str(app),str(app.parent)]\nfrom analyst.binding import source_binding, SOURCE_PATHS\nfrom starforge_stac.analyst_state import analyst_source_paths\nfrom starforge_stac import postgis\nbound=source_binding(app)\ncore=app/'starforge_stac' if (app/'starforge_stac').is_dir() else app\nadapter=Path(postgis.__path__[0]).resolve(strict=True)\npaths={'starforge_stac/'+name:core/name for name in SOURCE_PATHS}\npaths.update(analyst_source_paths(core))\npaths['starforge_stac/postgis/__init__.py']=core/'postgis'/'__init__.py'\nmembers={}\nfor item in bound['files']:\n name=item['path']\n source=(adapter/name.split('/',1)[1] if item.get('scope')=='postgis-adapter' else paths[name])\n source=source.resolve(strict=True)\n members[str(source)]={'path':str(source),'bytes':item['bytes'],'sha256':item['sha256']}\nvector_names=('__init__.py','common.py','capture.py','driver.py','materialize.py','comparison.py','archive.py','engine.py')\nvector=next((p for p in (app/'vector',app.parent/'vector') if all((p/n).is_file() and not (p/n).is_symlink() for n in vector_names)),None)\nif vector is None: raise ValueError('Keep the complete original vector producer source')\nfor source in [*(app/n for n in ('evidence-native-bootstrap.py','evidence-native-receiving.py','evidence-browser-receiving.mjs','analyst.mjs')),*(vector/n for n in vector_names)]:\n source=source.resolve(strict=True)\n data=source.read_bytes()\n if len(data)>4*1024*1024: raise ValueError('The selected source member exceeds 4 MiB')\n record={'path':str(source),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}\n if str(source) in members and members[str(source)]!=record: raise ValueError('The maintained source selection changed')\n members[str(source)]=record\nprint(json.dumps({'schema':'commons.landsage-selected-source/v1','application':str(app),'sourceSha256':bound['sha256'],'members':sorted(members.values(),key=lambda x:x['path'])},separators=(',',':')),flush=True)\n";
async function ownLock(options){
 const child=spawn(options.python,['-B','-c',LOCK,options.directory,process.execPath,HERE,...options.argv],{stdio:'inherit'});
 const forward=signal=>{if(child.exitCode===null&&child.signalCode===null)child.kill(signal);};
 const int=()=>forward('SIGINT'),term=()=>forward('SIGTERM');
 process.on('SIGINT',int);process.on('SIGTERM',term);
 try{
  const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  check(status.code===0,'Original foreground receiver stopped: '+JSON.stringify(status));
 }finally{process.off('SIGINT',int);process.off('SIGTERM',term);}
}
async function execute(options){
 const lockFd=Number(process.env.LANDSAGE_RECEIVING_LOCK_FD);
 check(Number.isInteger(lockFd)&&lockFd>=3,'The original foreground lock must remain held.');
 const held=fstatSync(lockFd),named=statSync(path.join(options.directory,'foreground.lock'));
 check(held.isFile()&&held.dev===named.dev&&held.ino===named.ino,'The inherited original operation lock changed.');
 const root=options.directory,control=path.join(root,'controller');
 await fs.mkdir(control,{recursive:true,mode:0o700});
 const inputBytes=await read(options.inputs),input=JSON.parse(inputBytes);
 check(input.schema==='commons.landsage-native-bootstrap/v1'&&input.operationId===OP&&typeof input.reviewer==='string'&&input.reviewer.trim(),'Select the complete original native bootstrap input and actual reviewer.');
 const fixed={schema:SCHEMA,operationId:OP,applicationRoot:options.app,inputs:{path:options.inputs,bytes:inputBytes.length,sha256:sha(inputBytes)},
  python:options.python,node:process.execPath,playwrightModule:options.playwright,chromium:options.chromium,
  operationSeconds:options.operationSeconds,browserSeconds:options.browserSeconds,reviewer:input.reviewer.trim()};
 await retain(path.join(control,'selection.json'),encode(fixed));
 await retain(path.join(control,'bootstrap-input.json'),inputBytes);
 await retain(path.join(control,'foreground-source.mjs'),await read(HERE));
 let activeApp=options.app,sourceSelection;

 const finished=await maybe(path.join(control,'foreground-result.json'));
 if(finished){
  check(finished.schema===SCHEMA&&finished.operationId===OP,'The retained original foreground result changed.');
  for(const item of [finished.reportArchive,finished.editableProject,finished.printedReport,...finished.images,...finished.downloads]){
   await verifyDescriptor(item);
  }
  process.stdout.write(JSON.stringify({operationId:OP,state:finished.state,result:path.join(control,'foreground-result.json'),replayed:true})+'\n');
  return finished;
 }
 const attempts=path.join(control,'attempts');await fs.mkdir(attempts,{recursive:true,mode:0o700});
 const attempt=await fs.mkdtemp(path.join(attempts,'run-'));await fs.chmod(attempt,0o700);
 const jobs=new Set(),stopping=new AbortController();
 let browserServer,context,browserWork,primary,result;
 const onSignal=signal=>{if(!stopping.signal.aborted)stopping.abort(new Error('Original receiving interrupted by '+signal+'; resume the same directory.'));};
 const int=()=>onSignal('SIGINT'),term=()=>onSignal('SIGTERM');
 process.on('SIGINT',int);process.on('SIGTERM',term);
 function abort(){if(stopping.signal.aborted)throw stopping.signal.reason;}
 async function job(name,command,args,{startup=false}={}){
  abort();const stdout=openSync(path.join(attempt,name+'.stdout.log'),'ax',0o600),stderr=openSync(path.join(attempt,name+'.stderr.log'),'ax',0o600);
  let child;
  try{child=spawn(command,args,{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',QT_QPA_PLATFORM:process.env.QT_QPA_PLATFORM||'offscreen'},detached:true,stdio:['ignore',startup?'pipe':stdout,stderr]});}
  catch(error){closeSync(stdout);closeSync(stderr);throw error;}
  let descriptorsClosed=false,settled=false,resolveDone,rejectDone,readyResolve,readyReject,line='',seenReady=false;
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});done.catch(()=>{});
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});ready.catch(()=>{});
  const record={name,child,done,ready,stop:null};
  const closeFD=()=>{if(descriptorsClosed)return;descriptorsClosed=true;try{closeSync(stdout);}catch{}try{closeSync(stderr);}catch{}};
  if(startup)child.stdout.on('data',bytes=>{
   // The connection announcement includes a private token. It remains in the private attempt log.
   writeSync(stdout,bytes);
   if(seenReady)return;
   line+=bytes.toString('utf8');
   if(line.length>1024*1024){readyReject(new Error('Unexpected oversized original listener announcement.'));return;}
   let end;
   while((end=line.indexOf('\n'))>=0){const one=line.slice(0,end);line=line.slice(end+1);
    try{const value=JSON.parse(one);if(value.status==='QGIS_ANALYST_READY'){seenReady=true;readyResolve(value);break;}}catch{}
   }
  });
  child.once('error',error=>{settled=true;closeFD();rejectDone(error);readyReject(error);});
  child.once('close',(code,signal)=>{settled=true;closeFD();resolveDone({code,signal});if(!seenReady)readyReject(new Error('Original process closed before listener readiness: '+name+' '+code+' '+signal));});
  record.stop=async()=>{
   if(settled){await done;return;}
   child.kill('SIGTERM');
   let timer;const waited=await Promise.race([done.then(value=>({value})),new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),35000);})]);clearTimeout(timer);
   if(waited.timeout){try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}await done;throw new Error('Owned original child required forced cleanup: '+name);}
  };
  jobs.add(record);return record;
 }
 async function until(promise,milliseconds,label){
  let timer,onAbort;
  try{return await Promise.race([promise,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out; original operation retained.')),milliseconds);
   onAbort=()=>reject(stopping.signal.reason);stopping.signal.addEventListener('abort',onAbort,{once:true});if(stopping.signal.aborted)onAbort();})]);}
  finally{clearTimeout(timer);if(onAbort)stopping.signal.removeEventListener('abort',onAbort);}
 }
 async function run(name,command,args,seconds){
  const original=await job(name,command,args);let failure;
  try{const state=await until(original.done,seconds*1000,name);check(state.code===0,'Original '+name+' failed; inspect '+attempt+' logs.');return state;}
  catch(error){failure=error;throw error;}
  finally{try{await original.stop();}catch(error){if(failure)throw new AggregateError([failure,error],'Original phase and cleanup failed.');throw error;}}
 }
 async function verifySelection(){
  check(sourceSelection&&sourceSelection.application===activeApp,'Keep the retained original source selection.');
  for(const item of sourceSelection.members)await verifyDescriptor(item);
 }
 async function isolateSource(){
  const manifestFile=path.join(control,'selected-installation.json'),saved=await maybe(manifestFile);
  if(saved){
   check(saved.schema==='commons.landsage-selected-installation/v1'&&saved.originalApplication===options.app,'The retained original installation selection changed.');
   sourceSelection=saved;activeApp=saved.application;await verifySelection();return;
  }
  const scanFile=path.join(control,'source-selection.json');
  let selection=await maybe(scanFile);
  if(!selection){
   await run('source-selection',options.python,['-B','-c',SOURCE_SCAN,options.app],60);
   selection=await json(path.join(attempt,'source-selection.stdout.log'),4*1024*1024);
   check(selection.schema==='commons.landsage-selected-source/v1'&&selection.application===options.app&&Array.isArray(selection.members)&&selection.members.length>4&&/^[a-f0-9]{64}$/.test(selection.sourceSha256),'Use the maintained complete source binding and producer closure.');
   await retain(scanFile,encode(selection));
  }
  check(selection.application===options.app&&selection.members.length<=4096,'The original source closure is not the selected application.');
  let anchor=options.app;
  const contains=(directory,filename)=>filename===directory||filename.startsWith(directory+path.sep);
  while(!selection.members.every(item=>contains(anchor,item.path))){const parent=path.dirname(anchor);check(parent!==anchor,'Cannot retain the original source layout.');anchor=parent;}
  const tree=path.join(control,'selected-installation','tree'),members=[],directories=new Set([tree]);
  for(const item of selection.members){
   check(path.isAbsolute(item.path)&&path.normalize(item.path)===item.path,'Use the canonical original source member path.');
   const relative=path.relative(anchor,item.path);
   check(relative&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'The source member escapes its original layout.');
   const destination=path.join(tree,relative);
   let bytes;
   try{bytes=await read(destination,4*1024*1024);}
   catch(error){if(error.code!=='ENOENT')throw error;bytes=await read(item.path,4*1024*1024);check(bytes.length===item.bytes&&sha(bytes)===item.sha256,'Source changed before private selection: '+item.path);await retain(destination,bytes);}
   check(bytes.length===item.bytes&&sha(bytes)===item.sha256,'The retained source member changed: '+destination);
   await fs.chmod(destination,0o400);
   members.push({path:destination,bytes:item.bytes,sha256:item.sha256,originalPath:item.path});
   for(let directory=path.dirname(destination);contains(tree,directory);directory=path.dirname(directory)){directories.add(directory);if(directory===tree)break;}
  }
  activeApp=path.join(tree,path.relative(anchor,options.app));
  sourceSelection={schema:'commons.landsage-selected-installation/v1',originalApplication:options.app,application:activeApp,
   sourceSha256:selection.sourceSha256,members};
  await retain(manifestFile,encode(sourceSelection));
  for(const directory of [...directories].sort((a,b)=>b.length-a.length))await fs.chmod(directory,0o500);
  await verifySelection();
 }
 async function listener(workspace,workspaceId,label,runtimeFile){
  abort();await verifySelection();const selectionPath=path.join(control,'listeners',label+'.json'),choice=await maybe(selectionPath);
  if(choice)check(choice.workspace===workspace&&choice.workspaceId===workspaceId,'The original listener workspace changed.');
  const bindingOutput=path.join(attempt,label+'-binding.json');
  // Use the existing binding reader through its normal entrypoint; its complete stdout stays private.
  await run(label+'-binding',options.python,['-B',path.join(activeApp,'analyst','binding.py'),'--workspace',workspace,'--source-root',activeApp,'--native-runtime-file',runtimeFile],60);
  const binding=await json(path.join(attempt,label+'-binding.stdout.log'),4*1024*1024);
  check(binding.schema==='starforge.stac-qgis-analyst-binding.v1'&&binding.workspaceId===workspaceId&&binding.workspaceDirectory===workspace&&binding.sourceSha256===sourceSelection.sourceSha256&&/^[a-f0-9]{64}$/.test(binding.sha256||''),'The original listener binding differs.');
  await retain(bindingOutput,encode(binding));
  const connection=path.join(attempt,label+'-connection.json');
  const original=await job(label,process.execPath,[path.join(activeApp,'analyst.mjs'),'--workspace',workspace,'--python',options.python,
   '--source-root',activeApp,'--expected-binding',binding.sha256,'--native-runtime-file',runtimeFile,'--connection-file',connection,'--port',String(choice?.port??0)],{startup:true});
  let returned;
  try{
   returned=await until(original.ready,60000,label+' readiness');
   check(returned.workspaceDirectory===workspace&&returned.workspaceId===workspaceId&&returned.bindingSha256===binding.sha256&&returned.sourceRoot===activeApp,'The original running listener returned another source/workspace.');
   const url=new URL(returned.operatorUrl);check(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&/^#[a-f0-9]{64}$/.test(url.hash),'Use the actual private localhost analyst URL.');
   const port=Number(url.port);check(Number.isInteger(port)&&port>0&&port<=65535&&(!choice||choice.port===port),'Keep the original listener origin across browser continuation.');
   await verifySelection();await retain(selectionPath,encode({workspace,workspaceId,port}));
   await retain(path.join(attempt,label+'-startup.json'),encode(returned));
   return {url:returned.operatorUrl,close:original.stop,instanceId:returned.instanceId};
  }catch(error){try{await original.stop();}catch(cleanup){throw new AggregateError([error,cleanup],'Original listener startup and cleanup failed.');}throw error;}
 }
 try{
  await isolateSource();
  const bootstrap=path.join(root,'native-bootstrap'),backend=path.join(root,'evidence-course');
  await verifySelection();await run('bootstrap',options.python,['-B',path.join(activeApp,'evidence-native-bootstrap.py'),'--application-root',activeApp,
   '--directory',bootstrap,'--inputs',path.join(control,'bootstrap-input.json'),'--operation-timeout',String(options.operationSeconds)],options.operationSeconds*12);
  await verifySelection();const bootstrapResult=await json(path.join(bootstrap,'bootstrap-result.json'));
  check(bootstrapResult.operationId===OP&&bootstrapResult.state==='NATIVE_SETUP_COMPLETE','Complete the original native map setup before its evidence course.');
  await verifySelection();await run('backend',options.python,['-B',path.join(activeApp,'evidence-native-receiving.py'),'--application-root',activeApp,
   '--directory',backend,'--inputs',path.join(bootstrap,'evidence-inputs.json'),'--operation-timeout',String(options.operationSeconds)],options.operationSeconds*60);
  await verifySelection();const backendResult=await json(path.join(backend,'backend-receiving-result.json'));
  check(backendResult.operationId===OP&&backendResult.state==='BACKEND_RECEIVING_COMPLETE'&&backendResult.workspaceId===bootstrapResult.workspaceId,'Receive the same actual native workspace.');
  const browserInputs=await json(path.join(backend,'browser-inputs.json'));
  check(browserInputs.workspaceId===backendResult.workspaceId&&browserInputs.workspace===backendResult.workspace,'Keep the original browser workspace binding.');
  const runtimeFile=path.join(bootstrap,'bootstrap-runtime.json');
  const launched=await listener(browserInputs.workspace,browserInputs.workspaceId,'original-listener',runtimeFile);
  abort();const loaded=await import(pathToFileURL(options.playwright).href),playwright=loaded.chromium?loaded:loaded.default;abort();
  check(playwright?.chromium?.launchServer,'Select the actual installed Playwright module.');
  browserServer=await playwright.chromium.launchServer({executablePath:options.chromium,headless:true,timeout:60000});
  abort();const browser=await playwright.chromium.connect(browserServer.wsEndpoint());abort();
  const storagePath=path.join(control,'browser-storage.json'),previous=await maybe(storagePath);
  context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900},storageState:previous||undefined});
  abort();const page=await context.newPage();abort();
  await verifySelection();const module=await import(pathToFileURL(path.join(activeApp,'evidence-browser-receiving.mjs')).href);
  check(typeof module.reviewEvidenceBrowser==='function','Use the complete original browser receiving module.');
  abort();browserWork=module.reviewEvidenceBrowser({page,url:launched.url,inputs:browserInputs,directory:path.join(backend,'browser'),
   reviewer:fixed.reviewer,pythonExecutable:options.python,operationTimeoutMs:options.operationSeconds*1000,
   openReceived:async directory=>listener(path.resolve(directory),browserInputs.workspaceId,'received-listener',runtimeFile)});
  browserWork.catch(()=>{});
  const rendered=await until(browserWork,options.browserSeconds*1000,'Whole browser receiving');
  await verifySelection();check(rendered.operationId===OP&&rendered.state==='RENDERED_AWAITING_VISUAL_INSPECTION','Retain the original full rendered receiving result.');
  result={schema:SCHEMA,operationId:OP,state:'OPERATED_AWAITING_LITERAL_INSPECTION',workspaceId:backendResult.workspaceId,
   sourceSelection:path.join(control,'selected-installation.json'),selectedSourceSha256:sourceSelection.sourceSha256,
   bootstrap:path.join(bootstrap,'bootstrap-result.json'),backend:path.join(backend,'backend-receiving-result.json'),
   browser:path.join(backend,'browser','rendered-receiving-result.json'),reportArchive:backendResult.reportArchive,
   editableProject:rendered.editableExport,receivedDirectory:rendered.receivedDirectory,printedReport:rendered.printedReport,
   images:rendered.images,downloads:rendered.downloads,viewedScreens:[],
   meaning:'Original native geometry, app controls and cold receiving operated. The accepting operator must actually view/use all outgoing reports, PDF pages, maps, archives and reopened project before readiness.'};
 }catch(error){primary=error;if(!stopping.signal.aborted)stopping.abort(error);}
 finally{
  const failures=[];
  if(context){
   try{await replacePrivate(path.join(control,'browser-storage.json'),encode(await bounded(context.storageState({indexedDB:true}),30000,'Browser storage receiving')));}catch(error){failures.push(error);}
   try{await bounded(context.close(),20000,'Owned browser context close');}catch(error){failures.push(error);}
  }
  if(browserServer){
   try{await bounded(browserServer.close(),20000,'Owned browser process close');}
   catch(error){failures.push(error);try{await browserServer.kill();}catch(kill){failures.push(kill);}}
  }
  // Closing the browser stops UI work; drain its original continuation before releasing listeners/lock.
  if(browserWork)try{await browserWork;}catch(error){if(!primary)failures.push(error);}
  for(const original of [...jobs].reverse())try{await original.stop();}catch(error){failures.push(error);}
  process.off('SIGINT',int);process.off('SIGTERM',term);
  if(primary||failures.length){
   const error=primary&&failures.length?new AggregateError([primary,...failures],'Original receiving and cleanup failures retained.'):primary||new AggregateError(failures,'Original receiving cleanup failed.');
   await retain(path.join(attempt,'failure.json'),encode({schema:SCHEMA,operationId:OP,error:cleanError(error)}));
   throw error;
  }
 }
 await retain(path.join(control,'foreground-result.json'),encode(result));
 process.stdout.write(JSON.stringify({operationId:OP,state:result.state,result:path.join(control,'foreground-result.json'),workspaceId:result.workspaceId})+'\n');
 return result;
}
export async function main(argv=process.argv.slice(2)){
 process.umask(0o077);const options=parse(argv);
 if(options.locked)return execute(options);
 await fs.mkdir(options.directory,{recursive:true,mode:0o700});return ownLock(options);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 main().catch(error=>{process.stderr.write(JSON.stringify(cleanError(error))+'\n');process.exitCode=1;});
