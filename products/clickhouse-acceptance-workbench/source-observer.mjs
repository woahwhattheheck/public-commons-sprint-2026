#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// An explicit receiver correction, bound beside the unchanged original operation.
import {readFileSync,existsSync,lstatSync,realpathSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,join,dirname,isAbsolute,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolveSourceEdition} from './source-editions.mjs';
import {collectSourceFiles,atomicBytes,atomicJson,canonical} from './workbench/vendor/sling/core/common.mjs';
import {hashFile} from './workbench/vendor/sling/core/objects.mjs';
import {privateDirectory,acquireWorkspaceLease} from './workbench/vendor/sling/vendor/stellar-expert/store.mjs';
const HERE=dirname(fileURLToPath(import.meta.url)),SCHEMA='altinity.source-observer.v1';
const OBSERVER_MANIFEST_SHA256='01d3622dcc9a923c7b5123475896e3f0be496c62d8c4791ba63d2926913a2006';
const REVIEWED_BASELINES=new Set(['7465743b33c7418e229f86452bc8c71cb83e4197f21068d87c5585b8b422d3eb','319d467960f5cd86534ca90f20d4fbff29a36bf5e8af0ec94284ee3e32d7a1a0']);
const REVIEWED_SOURCE_PATHS=new Set(['receiving/receive.mjs','reference/fixture.py','SOURCE_MANIFEST.json','web/app.mjs']);
const AUTHORITY_SHA256='616931dfe75e9cfbcaa82423c4cddde8bdc7505a10cb2d8f33c11bc21f87f081';
const read=p=>JSON.parse(readFileSync(p,'utf8')),same=(a,b)=>canonical(a)===canonical(b);
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'SOURCE_OBSERVER_BINDING'});};
const identity=p=>hashFile(p);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safe=name=>typeof name==='string'&&name.length>0&&!/[\\\u0000-\u001f\u007f]/.test(name)&&!isAbsolute(name)&&name.split('/').every(v=>v&&v!=='.'&&v!=='..');
function absolute(path){need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'Use the original canonical absolute path.');return path;}
function regular(path){absolute(path);need(lstatSync(path).isFile()&&realpathSync(path)===path,'Retain each complete source as an original regular file.');}
function matches(path,expected){regular(path);need(same(identity(path),{bytes:expected.bytes,sha256:expected.sha256}),'Retain the complete original selected bytes: '+path);}
function originalCommand(request){
 const command=request.command??[request.node,join(request.source,'receiving/receive.mjs'),'--source',request.source,'--directory',request.directory,'--config',request.config,'--source-manifest',request.sourceManifest,'--python',request.python,'--playwright',request.playwright,'--chromium',request.chromium];
 need(Array.isArray(command)&&command.every(v=>typeof v==='string'&&v.length)&&command[0]===request.node&&command[1]===join(request.source,'receiving/receive.mjs'),'Retain the exact original receiver command.');
 const values={};for(let i=2;i<command.length;i+=2){const key=command[i];need(['--source','--directory','--config','--source-manifest','--python','--playwright','--chromium'].includes(key)&&!Object.hasOwn(values,key)&&typeof command[i+1]==='string','Retain each original option/value once.');values[key]=command[i+1];}
 for(const [key,value]of Object.entries({'--source':request.source,'--directory':request.directory,'--config':request.config,'--source-manifest':request.sourceManifest,'--playwright':request.playwright,'--chromium':request.chromium}))need(values[key]===value,'The original command selection changed.');
 if(values['--python'])need(values['--python']===request.python,'The original Python option changed.');
 return command;
}
function reference(path){
 absolute(path);regular(path);const request=read(path);
 const keys=['source','directory','fixtureDirectory','config','sourceManifest','python','clickhouse','node','playwright','chromium'];
 need(request.schema==='stellar-forge.clickhouse-acceptance-reference-request.v1'&&Object.keys(request).every(k=>['schema','command',...keys].includes(k)),'Use the complete original reference request.');
 for(const key of keys)absolute(request[key]);
 need(request.node===process.execPath,'Use the original Node executable.');
 need(request.sourceManifest===join(request.source,'SOURCE_MANIFEST.json'),'Retain the original source manifest in its complete source root.');
 return{request,identity:{path,...identity(path)},command:originalCommand(request)};
}
function source(root,authority,expected){
 absolute(root);need(realpathSync(root)===root,'Use the original real source directory.');
 const manifestPath=join(root,'SOURCE_MANIFEST.json'),manifestBytes=readFileSync(manifestPath);
 const files=collectSourceFiles(root);for(const f of files){need(safe(f.path),'Retain safe complete source members.');regular(join(root,f.path));}
 const edition=resolveSourceEdition({authority,manifestBytes,actualFiles:files,expectedManifest:expected});
 return{root,manifestPath,manifest:JSON.parse(manifestBytes.toString('utf8')),identity:edition.manifest,files,edition};
}
function trustedAuthority(){const bytes=readFileSync(join(HERE,'original-source.json'));need(hash(bytes)===AUTHORITY_SHA256,'Use the exact published complete source authority.');return JSON.parse(bytes.toString('utf8'));}
function reviewedTransition(baseline,observer){
 need(REVIEWED_BASELINES.has(baseline.identity.sha256)&&observer.identity.sha256===OBSERVER_MANIFEST_SHA256,'Use an explicitly reviewed original-to-observer source transition.');
 const previous=new Map(baseline.files.map(file=>[file.path,file])),changes=[];
 for(const file of observer.files){
  const old=previous.get(file.path);need(old,'Preserve the entire original source path set.');
  if(old.bytes!==file.bytes||old.sha256!==file.sha256){
   need(REVIEWED_SOURCE_PATHS.has(file.path),'The observer changes a source outside this reviewed correction: '+file.path);
   changes.push({path:file.path,original:{bytes:old.bytes,sha256:old.sha256},observer:{bytes:file.bytes,sha256:file.sha256}});
  }
 }
 return{baselineManifest:baseline.identity,observerManifest:observer.identity,changes};
}
function sourceMembers(root){
 const members=['source-observer.mjs','source-editions.mjs','original-source.json'];
 const authority=read(join(root,'original-source.json'));
 for(const f of authority.files)members.push('workbench/'+f.path);
 need(members.length===57&&new Set(members).size===57,'Retain the complete standalone observer and all original source members.');
 return members;
}
export function admitSourceObserver(path,{options,executingRoot}={}){
 absolute(path);regular(path);const value=read(path);
 need(value.schema===SCHEMA&&typeof value.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value.id)&&typeof value.reason==='string'&&value.reason.trim().length>0&&Number.isFinite(Date.parse(value.at)),'Retain the explicit original observer identity, time and reason.');
 const selected=reference(absolute(value.referenceRequest.path)),request=selected.request;
 matches(value.referenceRequest.path,value.referenceRequest);need(same(selected.command,value.originalCommand),'The immutable original reference command changed.');
 const directory=join(request.directory,'merchant-reference','source-observers',value.id);
 need(path===join(directory,'request.json')&&value.baseline.root===request.source&&value.observer.root===join(directory,'source','workbench'),'Keep the observer beside its one original operation.');
 need(value.sourceArchive.directory===join(directory,'source')&&Array.isArray(value.sourceArchive.files),'Retain the complete actual observer source archive.');
 const support=value.sourceArchive.files,names=new Set();
 for(const row of support){need(safe(row.path)&&!names.has(row.path),'Retain unique observer source members.');names.add(row.path);matches(join(value.sourceArchive.directory,row.path),row);}
 const required=sourceMembers(value.sourceArchive.directory);need(support.length===required.length&&required.every(x=>names.has(x)),'The complete observer source is required for independent receiving.');
 const actual=collectSourceFiles(value.sourceArchive.directory);need(actual.length===support.length&&actual.every(f=>support.some(s=>s.path===f.path&&s.bytes===f.bytes&&s.sha256===f.sha256)),'The observer source archive contains another source edition.');
 const authority=trustedAuthority(),archivedAuthority=read(join(value.sourceArchive.directory,'original-source.json'));
 need(same(archivedAuthority.origin,authority.origin)&&Array.isArray(archivedAuthority.maintenance)&&same(archivedAuthority.maintenance,(authority.maintenance??[]).slice(0,archivedAuthority.maintenance.length)),'Retain a coherent published observer authority predecessor.');
 const baseline=source(value.baseline.root,authority,value.baseline.manifest),observer=source(value.observer.root,authority,value.observer.manifest);
 const archived=resolveSourceEdition({authority:archivedAuthority,manifestBytes:readFileSync(join(value.observer.root,'SOURCE_MANIFEST.json')),actualFiles:observer.files});
 need(archived.maintenanceApplied===archivedAuthority.maintenance.length,'The retained observer authority must select its complete actual source.');
 need(same(value.transition,reviewedTransition(baseline,observer)),'Retain the exact reviewed observer transition.');
 if(executingRoot)need(resolve(executingRoot)===value.observer.root,'Execute the exact retained observer source.');
 need(same(value.config,{path:request.config,...identity(request.config)})&&same(baseline.identity,value.baseline.manifest),'The original configuration or source changed.');
 const state=read(join(request.directory,'operation.json'));
 need(state.id===value.operationId&&state.schema==='altinity.complete-receiving.v1'&&same(state.selection,{schema:state.schema,sourceManifest:baseline.identity,config:identity(request.config),node:{executable:process.execPath,version:process.version},expectedRows:3}),'The observer belongs to another original operation or runtime.');
 matches(join(directory,'original-operation.json'),value.originalOperation);
 const preimage=read(join(directory,'original-operation.json'));need(preimage.id===state.id&&preimage.schema===state.schema&&same(preimage.selection,state.selection),'Retain the original operation preimage and selection.');
 const command=[...selected.command];command[1]=join(observer.root,'receiving','receive.mjs');command.push('--source-observer',path);
 need(same(command,value.command),'Only the actual receiver observer may replace the original command entry point.');
 if(options){
  for(const [key,expected]of Object.entries({source:request.source,directory:request.directory,config:request.config,'source-manifest':request.sourceManifest,playwright:request.playwright,chromium:request.chromium}))need(resolve(options[key])===expected,'Keep the original receiver '+key+' selection.');
  need((options.python??request.python)===request.python,'Keep the original Python selection.');
 }
 return{path,identity:identity(path),value,request,baseline,observer,directory,state};
}
export async function prepareSourceObserver({referenceRequest,id,reason,at}){
 need(typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(id)&&typeof reason==='string'&&reason.trim().length>0,'Supply an explicit observer ID and correction reason.');
 if(at!==undefined)need(Number.isFinite(Date.parse(at)),'Use a complete original observer timestamp.');
 const selected=reference(absolute(referenceRequest)),request=selected.request;
 await privateDirectory(request.directory);
 const guard=await acquireWorkspaceLease(join(request.directory,'merchant-reference.lock'));let operationGuard;
 try{
  operationGuard=await acquireWorkspaceLease(join(request.directory,'receiving.lock'));
  const directory=join(request.directory,'merchant-reference','source-observers',id),path=join(directory,'request.json');
  if(existsSync(path)){const retained=admitSourceObserver(path);need(retained.value.reason===reason&&(!at||retained.value.at===at)&&same(retained.value.referenceRequest,selected.identity),'Replay the exact original observer request.');return{path,...retained.identity,operationId:retained.value.operationId};}
  const statePath=join(request.directory,'operation.json'),state=read(statePath);
  need(state.schema==='altinity.complete-receiving.v1'&&state.status!=='complete','Select the existing interrupted original operation; completed results are received directly.');
  const fixture=read(join(request.fixtureDirectory,'fixture.json'));need(same(fixture.command,selected.command),'The original fixture command must remain exact.');
  const authority=trustedAuthority(),baseline=source(request.source,authority,state.selection.sourceManifest),current=source(join(HERE,'workbench'),authority);
  need(same(state.selection.config,identity(request.config))&&same(state.selection.node,{executable:process.execPath,version:process.version}),'Retain the original configuration and Node runtime.');
  await privateDirectory(directory,{create:true});
  const pendingPath=join(directory,'preparation.json'),pending={schema:'altinity.source-observer-preparation.v1',id,reason,referenceRequest:selected.identity,operationId:state.id,baselineManifest:baseline.identity,observerManifest:current.identity,at:at??new Date().toISOString()};
  if(existsSync(pendingPath)){const old=read(pendingPath);need(old.id===id&&old.reason===reason&&same(old.referenceRequest,selected.identity)&&old.operationId===state.id&&same(old.baselineManifest,baseline.identity)&&same(old.observerManifest,current.identity)&&(!at||old.at===at),'Resume the exact selected observer preparation.');pending.at=old.at;}
  atomicJson(pendingPath,pending,{immutable:true});
  const archive=join(directory,'source');await privateDirectory(archive,{create:true});
  const members=[];
  for(const name of sourceMembers(HERE)){const from=join(HERE,name);regular(from);const bytes=readFileSync(from);const row={path:name,bytes:bytes.length,sha256:hash(bytes)};atomicBytes(join(archive,name),bytes,{immutable:true});members.push(row);}
  const preimagePath=join(directory,'original-operation.json');
  if(existsSync(preimagePath)){const original=read(preimagePath);need(original.id===state.id&&same(original.selection,state.selection),'Retain the original observer operation snapshot.');}
  else atomicBytes(preimagePath,readFileSync(statePath),{immutable:true});
  const command=[...selected.command],observerRoot=join(archive,'workbench');command[1]=join(observerRoot,'receiving','receive.mjs');command.push('--source-observer',path);
  const value={schema:SCHEMA,id,at:pending.at,reason,operationId:state.id,referenceRequest:selected.identity,transition:reviewedTransition(baseline,current),
   baseline:{root:baseline.root,manifest:baseline.identity},observer:{root:observerRoot,manifest:current.identity},config:{path:request.config,...identity(request.config)},
   originalCommand:selected.command,command,sourceArchive:{directory:archive,files:members},originalOperation:identity(join(directory,'original-operation.json'))};
  atomicJson(path,value,{immutable:true});const retained=admitSourceObserver(path);return{path,...retained.identity,operationId:state.id};
 }finally{try{await operationGuard?.close();}finally{await guard.close();}}
}
export function fixtureCompletionAccepted(fixture){
 const database=fixture?.cleanup?.database,programme=fixture?.cleanup?.programme;
 const errorsEmpty=value=>Array.isArray(value)&&value.length===0;
 const closed=database?.owned===true&&database.runningBefore===true&&database.terminateRequested===true&&database.forceKill===false&&database.reaped===true&&[0,-15].includes(database.exit)&&database.exit===fixture.databaseExit&&errorsEmpty(database.errors)&&database.acceptedNormal===true;
 const receiver=programme&&errorsEmpty(programme.errors)&&(programme.owned===true&&programme.reaped===true&&programme.exit===0||programme.owned===false&&programme.reaped===false&&programme.exit===null&&typeof fixture.reusedProgramme?.operationId==='string'&&fixture.reusedProgramme.resultIdentity);
 return fixture?.schema==='altinity.reference-result.v1'&&fixture.completed===true&&fixture.programmeExit===0&&fixture.sourceUnchanged===true&&typeof fixture.closedAt==='string'&&fixture.closedAt.length>0&&!fixture.error&&!fixture.interrupted&&closed&&Boolean(receiver)&&(!fixture.resultPersistenceErrors||errorsEmpty(fixture.resultPersistenceErrors));
}
export function completeSourceObserver(path){
 const admitted=admitSourceObserver(path),{request,value,directory,state}=admitted;
 const resultPath=join(request.directory,'CUSTOMER_RESULT.json'),result=read(resultPath),fixture=read(join(request.fixtureDirectory,'fixture-result.json'));
 need(state.status==='complete'&&result.status==='complete'&&result.operationId===value.operationId&&same(result.sourceManifest,value.baseline.manifest),'Receive the complete same original operation.');
 matches(resultPath,state.resultIdentity);
 const entry=(state.sourceObservers??[]).find(row=>row.id===value.id);need(entry&&same(entry.request,{path,...admitted.identity})&&same(entry.baselineManifest,value.baseline.manifest)&&same(entry.observerManifest,value.observer.manifest),'Only an actually admitted observer can complete its original course.');
 need(fixtureCompletionAccepted(fixture)&&fixture.fixture===request.fixtureDirectory&&fixture.native?.version==='26.8.24.9'&&fixture.native.sourceRows===3,'The original fixture must retain accepted normal database shutdown and completed receiver closure.');
 if(fixture.reusedProgramme)need(fixture.reusedProgramme.operationId===state.id&&same(fixture.reusedProgramme.resultIdentity,state.resultIdentity),'The reused receiver must remain the exact completed original operation.');
 const completionPath=join(directory,'complete.json');
 if(existsSync(completionPath)){
  const retained=read(completionPath);need(retained.operationId===value.operationId&&retained.observerId===value.id&&same(retained.request,admitted.identity)&&same(retained.result,{path:resultPath,...identity(resultPath)}),'Retain the original complete observer result.');
  for(const file of retained.sourceFiles){need(safe(file.path),'Retain safe observer artifacts.');matches(join(directory,file.path),file);}
  matches(retained.fixtureResult.path,retained.fixtureResult);
  return{...admitted,completion:retained,completionIdentity:identity(completionPath)};
 }
 const fixtureRoot=join(request.fixtureDirectory,'source-observers',value.id),fixtureFiles=[];
 function retainFixture(root,prefix=''){
  for(const entry of readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=prefix+entry.name,original=join(root,entry.name);need(safe(name)&&!entry.isSymbolicLink(),'Retain exact regular fixture observer artifacts.');
   if(entry.isDirectory())retainFixture(original,name+'/');
   else{need(entry.isFile(),'Retain complete fixture artifacts.');regular(original);const bytes=readFileSync(original),relativeName='fixture/'+name;atomicBytes(join(directory,relativeName),bytes,{immutable:true});fixtureFiles.push({path:relativeName,bytes:bytes.length,sha256:hash(bytes)});}
  }
 }
 retainFixture(fixtureRoot);
 matches(join(fixtureRoot,'request.json'),admitted.identity);
 const files=[...fixtureFiles,{path:'request.json',...identity(path)},{path:'preparation.json',...identity(join(directory,'preparation.json'))},{path:'original-operation.json',...value.originalOperation},...value.sourceArchive.files.map(f=>({...f,path:'source/'+f.path}))];
 const completion={schema:'altinity.source-observer-completion.v1',operationId:value.operationId,observerId:value.id,request:admitted.identity,
  result:{path:resultPath,...identity(resultPath)},fixtureResult:{path:join(request.fixtureDirectory,'fixture-result.json'),...identity(join(request.fixtureDirectory,'fixture-result.json'))},
  baselineManifest:value.baseline.manifest,observerManifest:value.observer.manifest,sourceFiles:files};
 atomicJson(join(directory,'complete.json'),completion,{immutable:true});
 return{...admitted,completion,completionIdentity:identity(join(directory,'complete.json'))};
}
export async function runSourceObserver(path){
 const admitted=admitSourceObserver(path),guard=await acquireWorkspaceLease(join(admitted.request.directory,'merchant-reference.lock'));
 try{
  const fixtureResult=join(admitted.request.fixtureDirectory,'fixture-result.json');
  if(existsSync(join(admitted.request.directory,'CUSTOMER_RESULT.json'))&&existsSync(fixtureResult)){
    const fixture=read(fixtureResult);if(fixtureCompletionAccepted(fixture))return completeSourceObserver(path).completion;
  }
  const argv=[join(admitted.value.observer.root,'reference','fixture.py'),'--directory',admitted.request.fixtureDirectory,'--clickhouse',admitted.request.clickhouse,'--resume','--source-observer',path,'--',...admitted.value.originalCommand];
  const env={...process.env};for(const key of ['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE','PYTHONSTARTUP'])delete env[key];
  let child,closed=false,failure;
  const forward=signal=>{if(child&&!closed)child.kill(signal);},term=()=>forward('SIGTERM'),interrupt=()=>forward('SIGINT');
  process.on('SIGTERM',term);process.on('SIGINT',interrupt);
  try{
   child=spawn(admitted.request.python,argv,{cwd:admitted.request.source,env,stdio:'inherit'});
   const outcome=await new Promise(resolveClose=>{child.once('error',e=>{failure=e;});child.once('close',(code,signal)=>{closed=true;resolveClose({code,signal});});});
   need(!failure&&outcome.code===0,'The same original receiver has not completed; retain its actual fixture/operation and observer.');
  }finally{process.off('SIGTERM',term);process.off('SIGINT',interrupt);}
  return completeSourceObserver(path).completion;
 }finally{await guard.close();}
}
export async function main(argv=process.argv.slice(2)){
 const [mode,...args]=argv,options={};
 if(!mode||mode==='--help'){process.stdout.write('source-observer.mjs prepare --reference-request ABS --id ID --reason TEXT [--at ISO]\nsource-observer.mjs run --descriptor ABS\n');return;}
 for(let i=0;i<args.length;i+=2){need(args[i]?.startsWith('--')&&args[i+1]&&!Object.hasOwn(options,args[i].slice(2)),'Use each documented option once.');options[args[i].slice(2)]=args[i+1];}
 let result;
 if(mode==='prepare'){need(Object.keys(options).every(k=>['reference-request','id','reason','at'].includes(k)),'Use the documented preparation options.');result=await prepareSourceObserver({referenceRequest:options['reference-request'],id:options.id,reason:options.reason,at:options.at});}
 else{need(mode==='run'&&Object.keys(options).length===1&&options.descriptor,'Select run --descriptor ABS.');result=await runSourceObserver(options.descriptor);}
 process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'SOURCE_OBSERVER_FAILED',message:error.message}})+'\n');process.exitCode=1;});
