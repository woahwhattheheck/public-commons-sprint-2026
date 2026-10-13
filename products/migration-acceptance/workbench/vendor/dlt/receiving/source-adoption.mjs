#!/usr/bin/env node
// Adopt a reviewed complete source edition without replaying a receiving operation.
import {existsSync,readFileSync,readdirSync,lstatSync,realpathSync,readlinkSync,unlinkSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acquireWorkspaceLease,privateDirectory} from '../vendor/sling/vendor/stellar-expert/store.mjs';
import {atomicBytes,atomicJson,canonical,collectSourceFiles,digest,identity,now,requireValue,safeRelative,sha,fsyncDirectory} from '../vendor/sling/core/common.mjs';
import {hashFile} from '../vendor/sling/core/objects.mjs';

const SCHEMA='dlthub.receiving-source-adoption.v1';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const same=(a,b)=>canonical(a)===canonical(b);
const measured=b=>({bytes:b.length,sha256:sha(b)});
const check=(p,expected)=>{requireValue(same(hashFile(p),expected),'ADOPTION_BYTES','Retained source-adoption bytes changed.',409,{path:p});};
function source(root,expected){
  root=resolve(root);requireValue(realpathSync(root)===root&&lstatSync(root).isDirectory(),'ADOPTION_SOURCE','Select the complete canonical source directory.',409);
  const path=join(root,'SOURCE_MANIFEST.json'),bytes=readFileSync(path),manifest=JSON.parse(bytes);
  requireValue(sha(bytes)===expected&&manifest.schema==='dlthub.complete-source-manifest.v1','ADOPTION_MANIFEST','Select the exact complete source manifest.',409);
  const declared=new Map();for(const f of manifest.files??[]){safeRelative(f.path);requireValue(f.path!=='SOURCE_MANIFEST.json'&&!declared.has(f.path),'ADOPTION_MANIFEST','Source manifest repeats a leaf.');declared.set(f.path,f);}
  const files=collectSourceFiles(root).filter(f=>f.path!=='SOURCE_MANIFEST.json');
  requireValue(files.length===declared.size&&files.length>0,'ADOPTION_MANIFEST','The complete source inventory differs.',409);
  for(const f of files){const wanted=declared.get(f.path);requireValue(wanted&&f.bytes===wanted.bytes&&f.sha256===wanted.sha256&&realpathSync(join(root,f.path))===join(root,f.path),'ADOPTION_SOURCE','A complete selected source leaf differs.',409,{path:f.path});}
  return{root,manifest,bytes,identity:measured(bytes),files};
}
function retainSource(root,selected){
  const directory=join(root,'source-editions',selected.identity.sha256,'source');
  for(const f of selected.files)atomicBytes(join(directory,f.path),f.body,{immutable:true});
  atomicBytes(join(directory,'SOURCE_MANIFEST.json'),selected.bytes,{immutable:true});
  source(directory,selected.identity.sha256);return relative(root,directory).split('\\').join('/');
}
function walk(root,{omitOperation=false}={}){
  const rows=[];const visit=(directory,prefix='')=>{
    for(const e of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const name=prefix?prefix+'/'+e.name:e.name;
      if(!prefix&&['source-editions','source-adoptions','source-adoption-pending.json'].includes(e.name))continue;
      if(omitOperation&&name==='operation.json')continue;
      if(e.name.endsWith('.lock')||e.name.endsWith('.lease'))continue;
      const path=join(directory,e.name);
      if(e.isSymbolicLink())rows.push({path:name,kind:'symlink',target:readlinkSync(path)});
      else if(e.isDirectory())visit(path,name);else if(e.isFile())rows.push({path:name,...hashFile(path)});
      else requireValue(false,'ADOPTION_CASE','A special member cannot be silently omitted.',409,{path:name});
    }
  };visit(root);return rows;
}
async function lockCase(root,leases){
  const workspaces=join(root,'workspaces');
  if(existsSync(workspaces))for(const e of readdirSync(workspaces,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    requireValue(e.isDirectory()&&!e.isSymbolicLink(),'ADOPTION_WORKSPACE','The saved workspace path differs.',409);
    const directory=await privateDirectory(join(workspaces,e.name));leases.push(await acquireWorkspaceLease(join(directory,'workspace.lock')));
  }
  const paths=new Set();const visit=directory=>{for(const e of readdirSync(directory,{withFileTypes:true})){
    const p=join(directory,e.name);
    if(directory===root&&['source-editions','source-adoptions'].includes(e.name))continue;
    if(e.isSymbolicLink())continue;
    if(e.isDirectory()){
      if(e.name.startsWith('binding_')&&relative(root,p).split('/').includes('native'))paths.add(join(p,'lifetime.lock'));
      visit(p);
    }else if(e.isFile()&&e.name==='lifetime.lock')paths.add(p);
  }};visit(root);
  for(const p of [...paths].sort())leases.push(await acquireWorkspaceLease(p));
}
function history(root,state){
  let current=hashFile(join(root,'source-manifest.json'));const seen=new Set();
  for(const entry of state.sourceAdoptions??[]){
    safeRelative(entry.path);requireValue(entry.path.startsWith('source-adoptions/')&&!seen.has(entry.id),'ADOPTION_HISTORY','The original source history differs.',409);seen.add(entry.id);
    check(join(root,entry.path),{bytes:entry.bytes,sha256:entry.sha256});const record=read(join(root,entry.path));
    requireValue(record.schema===SCHEMA&&record.id===entry.id&&record.operationId===state.id&&same(record.from,current),'ADOPTION_HISTORY','The selected source history is not continuous.',409);
    for(const [label,selection] of [['from',record.from],['to',record.to]]){
      const directory=join(root,'source-editions',selection.sha256,'source');check(join(directory,'SOURCE_MANIFEST.json'),selection);
      requireValue(record[label+'Source']===relative(root,directory).split('\\').join('/'),'ADOPTION_HISTORY','Retain the original complete source edition.',409);
    }
    current=record.to;
  }
  requireValue(same(current,state.selection.sourceManifest),'ADOPTION_HISTORY','The selected edition differs from its original source history.',409);return current;
}
export function retainReceivingSourceManifest(root,state,manifestPath,selection){
  requireValue(!existsSync(join(root,'source-adoption-pending.json')),'ADOPTION_PENDING','Finish the retained source-adoption command before resuming this same programme.',409);
  if(!state.sourceAdoptions?.length){atomicBytes(join(root,'source-manifest.json'),readFileSync(manifestPath),{immutable:true});return;}
  requireValue(same(history(root,state),selection),'ADOPTION_HISTORY','This receiver is not the selected reviewed edition.',409);
  check(manifestPath,selection);
  source(join(root,'source-editions',selection.sha256,'source'),selection.sha256);
}
export function sourceAdoptionArtifacts(root,state){
  if(!state.sourceAdoptions?.length)return[];history(root,state);
  const rows=[];const paths=new Set();
  for(const entry of state.sourceAdoptions){
    const record=read(join(root,entry.path));
    for(const selection of [record.from,record.to]){
      const prefix='source-editions/'+selection.sha256+'/source',edition=source(join(root,prefix),selection.sha256);
      for(const f of [...edition.files,{path:'SOURCE_MANIFEST.json',...edition.identity}]){const p=prefix+'/'+f.path;if(!paths.has(p)){paths.add(p);rows.push({path:p,bytes:f.bytes,sha256:f.sha256});}}
    }
    for(const name of ['intent.json','transition.json','operation.before.json','operation.after.json','retained-case.json','prepared.json','complete.json']){
      const p='source-adoptions/'+entry.id+'/'+name;if(!paths.has(p)){paths.add(p);rows.push({path:p,...hashFile(join(root,p))});}
    }
  }return rows;
}
export async function adoptSource(options){
  for(const key of ['directory','previous-source','source','from-sha256','to-sha256','expected-operation-sha256','adoption-id','reason'])requireValue(typeof options[key]==='string'&&options[key].length,'ADOPTION_ARGUMENT','Supply --'+key+'.');
  for(const key of ['from-sha256','to-sha256','expected-operation-sha256'])digest(options[key]);
  requireValue(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(options['adoption-id'])&&options['from-sha256']!==options['to-sha256'],'ADOPTION_ARGUMENT','Select a named, different reviewed source edition.');
  const root=await privateDirectory(resolve(options.directory)),leases=[await acquireWorkspaceLease(join(root,'receiving.lock'))];
  try{
    await lockCase(root,leases);
    const beforeSource=source(options['previous-source'],options['from-sha256']),afterSource=source(options.source,options['to-sha256']);
    requireValue(beforeSource.manifest.originalDltCommit===afterSource.manifest.originalDltCommit&&beforeSource.manifest.operation===afterSource.manifest.operation,'ADOPTION_ENGINE','Preserve the original engine and business operation.',409);
    const statePath=join(root,'operation.json'),currentBytes=readFileSync(statePath),state=JSON.parse(currentBytes),id=options['adoption-id'],directory=join(root,'source-adoptions',id),pendingPath=join(root,'source-adoption-pending.json');
    const intent={schema:SCHEMA,id,operationId:state.id,from:beforeSource.identity,to:afterSource.identity,expectedOperationSha256:options['expected-operation-sha256'],reason:options.reason};
    const pending={schema:SCHEMA,id,intentSha256:identity(intent)};
    if(existsSync(pendingPath))requireValue(same(read(pendingPath),pending),'ADOPTION_PENDING','Finish the already-selected source adoption.',409);
    if(existsSync(join(directory,'intent.json')))requireValue(same(read(join(directory,'intent.json')),intent),'ADOPTION_INTENT','This adoption identity already selects different source or intent.',409);
    if(existsSync(join(directory,'complete.json'))){
      const done=read(join(directory,'complete.json'));requireValue(done.status==='complete'&&done.operationId===state.id&&done.intentSha256===identity(intent)&&state.sourceAdoptions?.at(-1)?.id===id,'ADOPTION_INTENT','The complete adoption is not the current selected edition.',409);
      history(root,state);sourceAdoptionArtifacts(root,state);
      if(existsSync(pendingPath)){unlinkSync(pendingPath);fsyncDirectory(root);}return{...done,reused:true};
    }
    const preparedPath=join(directory,'prepared.json');let prepared;
    if(existsSync(preparedPath)){
      prepared=read(preparedPath);requireValue(prepared.intentSha256===identity(intent),'ADOPTION_INTENT','The retained transition differs.',409);
    }else{
      requireValue(state.schema==='dlthub.complete-receiving.v1'&&state.status==='interrupted'&&state.attempts?.at(-1)?.status==='interrupted','ADOPTION_STATE','Select the original ended receiving attempt.',409);
      requireValue(sha(currentBytes)===intent.expectedOperationSha256&&same(state.selection.sourceManifest,beforeSource.identity),'ADOPTION_STATE','The saved operation or selected original source changed.',409);history(root,state);
      atomicJson(join(directory,'intent.json'),intent,{immutable:true});
      const fromSource=retainSource(root,beforeSource),toSource=retainSource(root,afterSource);
      atomicBytes(join(directory,'operation.before.json'),currentBytes,{immutable:true});
      const retained=walk(root,{omitOperation:true});atomicJson(join(directory,'retained-case.json'),retained,{immutable:true});
      const old=new Map(beforeSource.files.map(f=>[f.path,{bytes:f.bytes,sha256:f.sha256}])),next=new Map(afterSource.files.map(f=>[f.path,{bytes:f.bytes,sha256:f.sha256}]));
      const changes=[...new Set([...old.keys(),...next.keys()])].sort().filter(p=>!same(old.get(p)??null,next.get(p)??null)).map(path=>({path,from:old.get(path)??null,to:next.get(path)??null}));
      const adoptedAt=existsSync(join(directory,'transition.json'))?read(join(directory,'transition.json')).adoptedAt:now();
      const transition={...intent,fromSource,toSource,adoptedAt,beforeOperation:measured(currentBytes),changes};
      atomicJson(join(directory,'transition.json'),transition,{immutable:true});
      const entry={id,path:'source-adoptions/'+id+'/transition.json',...hashFile(join(directory,'transition.json'))};
      const after={...state,selection:{...state.selection,sourceManifest:afterSource.identity},sourceAdoptions:[...(state.sourceAdoptions??[]),entry]};
      atomicJson(join(directory,'operation.after.json'),after,{immutable:true});
      prepared={schema:SCHEMA,id,intentSha256:identity(intent),before:measured(currentBytes),after:hashFile(join(directory,'operation.after.json')),retainedCase:hashFile(join(directory,'retained-case.json')),transition:hashFile(join(directory,'transition.json'))};
      atomicJson(preparedPath,prepared,{immutable:true});
    }
    for(const [name,key] of [['operation.before.json','before'],['operation.after.json','after'],['retained-case.json','retainedCase'],['transition.json','transition']])check(join(directory,name),prepared[key]);
    const before=read(join(directory,'operation.before.json')),after=read(join(directory,'operation.after.json'));
    requireValue(before.id===state.id&&same(before.selection.sourceManifest,intent.from)&&same(after.selection.sourceManifest,intent.to),'ADOPTION_STATE','The retained transition belongs to another operation.',409);
    const restored=structuredClone(after);restored.selection.sourceManifest=before.selection.sourceManifest;if(before.sourceAdoptions===undefined)delete restored.sourceAdoptions;else restored.sourceAdoptions=before.sourceAdoptions;
    requireValue(same(restored,before),'ADOPTION_STATE','Source adoption must preserve every original phase, request, attempt and selection.',409);
    requireValue(same(walk(root,{omitOperation:true}),read(join(directory,'retained-case.json'))),'ADOPTION_CASE_CHANGED','The original saved case changed during source adoption.',409);
    source(join(root,'source-editions',intent.from.sha256,'source'),intent.from.sha256);source(join(root,'source-editions',intent.to.sha256,'source'),intent.to.sha256);
    const current=hashFile(statePath);requireValue(same(current,prepared.before)||same(current,prepared.after),'ADOPTION_STATE','The original operation advanced during its prepared transition.',409);
    for(const lease of leases)lease.assert();atomicJson(pendingPath,pending,{immutable:true});
    if(same(current,prepared.before))atomicBytes(statePath,readFileSync(join(directory,'operation.after.json')));
    check(statePath,prepared.after);history(root,after);
    const done={schema:SCHEMA,id,operationId:state.id,intentSha256:identity(intent),from:intent.from,to:intent.to,operation:prepared.after,status:'complete'};
    atomicJson(join(directory,'complete.json'),done,{immutable:true});unlinkSync(pendingPath);fsyncDirectory(root);return done;
  }finally{for(const lease of leases.reverse())await lease.close();}
}
function flags(argv){const out={};for(let i=0;i<argv.length;i+=2){const key=argv[i];requireValue(/^--[a-z][a-z0-9-]*$/.test(key)&&argv[i+1]&&!Object.hasOwn(out,key.slice(2)),'ADOPTION_ARGUMENT','Use each documented option and its value once.');out[key.slice(2)]=argv[i+1];}return out;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)adoptSource(flags(process.argv.slice(2))).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'SOURCE_ADOPTION_FAILED',message:error.message,details:error.details??{}})+'\n');process.exitCode=1;});
