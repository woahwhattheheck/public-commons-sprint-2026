// MIT. Carry original publisher source through the Central resource graph and SF82 APIs.
import { constants, createReadStream } from 'node:fs';
import { open, mkdir, readdir, lstat, realpath, readFile, link, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { openDatasetVersions } from '../dataset-refresh/versions.mjs';
import { DATASET_BINDING_SCHEMA, prepareDatasetRelease } from '../../sf82-seller-pilot/release-dataset.mjs';
import { initReleaseStore, readReleaseState, listReleases, inspectRelease, stageRelease, normalizeReleaseRuntime } from '../../sf82-seller-pilot/releases.mjs';
import { digest, fault, formatted, identifier, now, stable, writeNew } from '../odata/state.mjs';

const SNAPSHOT='stellar-forge.central-publisher-snapshot.v1';
const RECEIVING='stellar-forge.central-publisher-receiving.v1';
const VERSION_SCHEMAS=new Set(['stellar-forge.dataset-versions.v1','stellar-forge.dataset-versions.v2']);
const HASH=/^[a-f0-9]{64}$/;
const same=(left,right)=>stable(left)===stable(right);
const fail=(code,message,status=409)=>{throw fault('CENTRAL_PUBLISHER_'+code,message,status);};
const requireValue=(value,code,message)=>{if(!value)fail(code,message);};
const jobs=new WeakMap();
function once(store,key,operation){
  if(!jobs.has(store))jobs.set(store,new Map());
  const retained=jobs.get(store);if(retained.has(key))return retained.get(key);
  const pending=operation();retained.set(key,pending);
  return pending.finally(()=>retained.delete(key));
}
function sourcePath(value){
  if(typeof value!=='string'||!value||value.includes('\\')||value.startsWith('/')||
      value.split('/').some(part=>!part||part==='.'||part==='..')||/[\u0000-\u001f\u007f]/.test(value))
    fail('PATH','Keep original publisher paths relative to their selected directory.');
  return value;
}
async function directory(path){
  await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  requireValue(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===resolve(path)&&
    (process.platform==='win32'||!(info.mode&0o077)),'DIRECTORY','Use a canonical private publisher directory.');
}
async function readSmall(path,maximum=4*1024*1024){
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const info=await file.stat();requireValue(info.isFile()&&info.size<=maximum,'METADATA','Keep the original size-limited publisher metadata.');
    const bytes=await file.readFile();requireValue(bytes.length<=maximum,'METADATA','Publisher metadata grew during its read.');
    return {bytes,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
  }finally{await file.close();}
}
async function walk(root){
  const files=[];let bytes=0;
  async function visit(folder,prefix=''){
    const parent=await lstat(folder);
    requireValue(parent.isDirectory()&&!parent.isSymbolicLink(),'SOURCE_TYPE','Publisher directories must remain real directories.');
    const entries=(await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      const name=sourcePath(prefix+entry.name),path=join(folder,entry.name),info=await lstat(path);
      if(info.isDirectory()&&!info.isSymbolicLink())await visit(path,name+'/');
      else{
        requireValue(info.isFile()&&!info.isSymbolicLink(),'SOURCE_TYPE','Preserve only original regular publisher files in this transfer.');
        bytes+=info.size;requireValue(files.length<100000&&bytes<=8*1024*1024*1024,'SOURCE_SIZE','Use a publisher source graph within 100,000 files and 8 GiB.');
        files.push({path:name,bytes:info.size});
      }
    }
  }
  await visit(root);return files;
}
function historicalPath(path){return /^received\/[^/]+\/historical-source(?:\/|$)/.test(path);}
function sourceDiagnostic(error){
  if(error?.code==='ENOENT'||error?.code==='ENOTDIR')return 'PENDING';
  if(error instanceof SyntaxError||error instanceof TypeError||
      ['DATASET_RELEASE_CHANGED','DATASET_GENERATION_CHANGED','CENTRAL_PUBLISHER_METADATA',
       'CENTRAL_PUBLISHER_DATASET_STATE','CENTRAL_PUBLISHER_DATASET_BINDING'].includes(error?.code)||
      error?.name==='Error'&&!error.code)return 'INVALID';
  return null;
}
function pendingSource(kind,path,error,extra={}){
  const status=sourceDiagnostic(error);if(!status)throw error;
  return {kind,path,status,code:error.code??error.name??'INVALID_NATIVE_SOURCE',
    message:String(error.message??error).slice(0,1200),...extra};
}
function incomplete(kind,path,missingPaths,extra={}){
  return {kind,path,status:'PENDING',code:'NATIVE_SOURCE_INCOMPLETE',
    message:'The retained original preparation has not completed its native source closure.',
    missingPaths,...extra};
}
async function selection(root,files,preparations=[]){
  const indexed=new Map(files.filter(file=>!historicalPath(file.path)).map(file=>[file.path,file]));
  const pending=[],datasets=[],packages=[],unavailableReleases=[];
  const releasesRoot=join(root,'releases');let state=null,stateSha256=null,catalog={releases:[],errors:[]};
  if(indexed.has('releases/state.json')){
    try{
      state=await readReleaseState(releasesRoot);
      const stateSource=await readSmall(join(releasesRoot,'state.json'));
      requireValue(same(state,stateSource.value),'SELECTION_CHANGED','The original release state changed during its metadata read.');
      stateSha256=digest(stateSource.bytes);catalog=await listReleases(releasesRoot);
    }catch(error){
      pending.push(pendingSource('release-store','releases',error));
      state=null;stateSha256=null;
    }
  }else pending.push(incomplete('release-store','releases',['releases/state.json']));
  const packageCandidates=new Map(),datasetCandidates=new Map();
  for(const file of indexed.values()){
    if(!file.path.endsWith('/state.json')&&!file.path.endsWith('/binding.json'))continue;
    if(file.path==='releases/state.json')continue;
    const isBinding=file.path.endsWith('/binding.json'),part=file.path.slice(0,isBinding?-'/binding.json'.length:-'/state.json'.length);
    let parsed;
    try{parsed=await readSmall(join(root,file.path));}
    catch(error){
      if(isBinding||/(^|\/)datasets\/[^/]+$/.test(part))
        pending.push(pendingSource(isBinding?'package':'dataset',part,error));
      else if(!sourceDiagnostic(error))throw error;
      continue;
    }
    if(VERSION_SCHEMAS.has(parsed.value?.schema)){
      const value=parsed.value;
      if(!Array.isArray(value.versions)||!value.versions.length||!HASH.test(value.current??'')||
          value.versions.some(item=>!HASH.test(item?.snapshot??''))){
        pending.push({kind:'dataset',path:part,status:'INVALID',code:'NATIVE_DATASET_STATE_INVALID',
          message:'The original native version state has no complete current-generation selection.'});
        continue;
      }
      datasetCandidates.set(part,{path:part,state:value,stateSha256:digest(parsed.bytes)});
    }else if(parsed.value?.schema===DATASET_BINDING_SCHEMA){
      const binding=parsed.value;
      let selected;
      try{
        requireValue(typeof binding.datasetDirectory==='string','DATASET_BINDING','Retain the original absolute native version-store binding.');
        selected=relative(root,binding.datasetDirectory).split(sep).join('/');sourcePath(selected);
        requireValue(resolve(root,selected)===resolve(binding.datasetDirectory)&&!selected.startsWith('../'),
          'DATASET_BINDING','The package selects a version store outside this retained publisher.');
      }catch(error){
        // An external native binding is retained as source; it is never read or copied.
        if(error.code==='CENTRAL_PUBLISHER_PATH')error=Object.assign(new Error(error.message),{code:'CENTRAL_PUBLISHER_DATASET_BINDING'});
        pending.push(pendingSource('package',part,error,{bindingSha256:digest(parsed.bytes)}));continue;
      }
      packageCandidates.set(part,{path:part,binding,bindingSha256:digest(parsed.bytes),datasetPath:selected});
    }else if(isBinding||/(^|\/)datasets\/[^/]+$/.test(part)){
      pending.push({kind:isBinding?'package':'dataset',path:part,status:'INVALID',code:'NATIVE_SCHEMA_UNRECOGNIZED',
        message:'The retained metadata does not identify the original native publisher component.'});
    }
  }
  for(const item of datasetCandidates.values()){
    const required=item.state.versions.flatMap(version=>['dataset.json','data.csv','manifest.json']
      .map(file=>item.path+'/versions/'+version.snapshot+'/'+file));
    const missing=required.filter(path=>!indexed.has(path));
    if(missing.length)pending.push(incomplete('dataset',item.path,missing,{stateSha256:item.stateSha256}));
    else datasets.push(item);
  }
  for(const item of packageCandidates.values()){
    const required=['dataset.csv','dataset.json','seller.json','source.json','binding.json'].map(file=>item.path+'/'+file);
    const missing=required.filter(path=>!indexed.has(path));
    if(!datasets.some(value=>value.path===item.datasetPath))missing.push(item.datasetPath+'/state.json or complete referenced generations');
    if(missing.length){pending.push(incomplete('package',item.path,missing,{datasetPath:item.datasetPath,bindingSha256:item.bindingSha256}));continue;}
    try{
      const prepared=await prepareDatasetRelease(join(root,item.path));
      requireValue(prepared.dataset.bindingSha256===item.bindingSha256,'SELECTION_CHANGED','The original package binding changed during capture.');
      packages.push({...item,files:prepared.files.map(file=>({...file,file:sourcePath(file.file.slice('dataset/'.length))}))});
    }catch(error){pending.push(pendingSource('package',item.path,error,{datasetPath:item.datasetPath,bindingSha256:item.bindingSha256}));}
  }
  const releases=[];
  for(const error of catalog.errors){
    pending.push({kind:'release',path:'releases/releases/'+sourcePath(error.id),status:'INVALID',
      code:'NATIVE_RELEASE_CATALOG_ERROR',message:String(error.message).slice(0,1200),originalReleaseId:error.id});
  }
  for(const release of catalog.releases){
    const path='releases/releases/'+release.id;
    if(!release.dataset||release.source?.kind!=='VERSIONED_DATASET_PACKAGE'){
      unavailableReleases.push(release);pending.push({kind:'release',path,status:'INVALID',
        code:'NATIVE_RELEASE_KIND',message:'This original release is retained but is not a versioned dataset release.',originalRelease:release});continue;
    }
    if(!packages.some(value=>value.path===path+'/dataset')){
      unavailableReleases.push(release);pending.push(incomplete('release',path,[path+'/dataset complete native package'],{originalRelease:release}));continue;
    }
    try{const inspected=await inspectRelease(releasesRoot,release.id);
      requireValue(same(inspected,release),'SELECTION_CHANGED','The original immutable release changed during capture.');
      releases.push(release);
    }catch(error){unavailableReleases.push(release);pending.push(pendingSource('release',path,error,{originalRelease:release}));}
  }
  // Preserve preparation directories whose interruption preceded binding/state metadata.
  for(const file of indexed.values()){
    const match=file.path.match(/^(packages|datasets)\/([^/]+)\//);
    if(!match)continue;const path=match[1]+'/'+match[2],kind=match[1]==='packages'?'package':'dataset';
    if([...datasets,...packages,...pending].some(value=>value.path===path))continue;
    pending.push(incomplete(kind,path,[path+(kind==='package'?'/binding.json':'/state.json')]));
  }
  const stagedPaths=new Set();
  for(const file of indexed.values()){
    const match=file.path.match(/^(.*\/(?:\.stage-|\.v2-stage-)[^/]+)\//);
    if(match)stagedPaths.add(match[1]);
    const release=file.path.match(/^releases\/releases\/([^/]+)\//);
    if(release&&!release[1].startsWith('.stage-')){
      const path='releases/releases/'+release[1];
      if(!releases.some(item=>item.id===release[1])&&!pending.some(item=>item.path===path))
        pending.push(incomplete('release',path,[path+'/release.json with a complete original release store']));
    }
  }
  for(const path of stagedPaths)pending.push({kind:'preparation',path,status:'PENDING',
    code:'NATIVE_STAGE_PENDING',message:'This original native staging directory remains unfinished historical source.'});
  for(const id of new Set([state?.active,state?.previous].filter(Boolean))){
    if(!releases.some(item=>item.id===id)&&!pending.some(item=>item.originalReleaseId===id||item.originalRelease?.id===id))
      pending.push(incomplete('release','releases/releases/'+id,['releases/releases/'+id+'/release.json'],{originalReleaseId:id}));
  }
  for(const item of preparations){
    if(item.status==='COMPLETE')continue;
    pending.push({kind:'preparation',path:'packages/'+sourcePath(item.request.exportId),status:'PENDING',
      code:'ORIGINAL_PREPARATION_PENDING',message:'Resume the retained original publisher preparation through its existing API.',
      preparationId:item.id,request:item.request,originalStatus:item.status});
  }
  pending.sort((a,b)=>(a.path+'\0'+a.kind+'\0'+a.code).localeCompare(b.path+'\0'+b.kind+'\0'+b.code));
  datasets.sort((a,b)=>a.path.localeCompare(b.path));packages.sort((a,b)=>a.path.localeCompare(b.path));
  return {state,stateSha256,datasets,packages,releases:releases.sort((a,b)=>a.id.localeCompare(b.id)),
    unavailableReleases:unavailableReleases.sort((a,b)=>a.id.localeCompare(b.id)),pending,preparations};
}
function portableSelection(selected){
  return {releaseState:selected.state,releaseStateSha256:selected.stateSha256,
    datasets:selected.datasets,packages:selected.packages,releases:selected.releases,
    unavailableReleases:selected.unavailableReleases,pending:selected.pending,preparations:selected.preparations};
}
function sameFile(before,after){
  return ['dev','ino','size','mtimeNs','ctimeNs'].every(key=>before[key]===after[key]);
}
async function captureFile(store,root,item,scope,capturedAt){
  const path=join(root,item.path),handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await handle.stat({bigint:true});requireValue(before.isFile(),'SOURCE_TYPE','The original publisher source must remain regular.');
    const retained=await store.retainStream(handle.createReadStream({autoClose:false}));
    const after=await handle.stat({bigint:true}),current=await lstat(path,{bigint:true});
    requireValue(sameFile(before,after)&&sameFile(after,current)&&BigInt(retained.bytes)===after.size,
      'SOURCE_CHANGED','A publisher file changed while its exact original bytes were retained.');
    const value={...retained,path:item.path,capturedAt};
    return store.transaction(()=>store.saveResource(scope,item.path,'publisher-source',value));
  }finally{await handle.close();}
}
function originalGraph(store,snapshot){
  const resources=[...store.resourceEntries('publisher:'+snapshot.id)];
  requireValue(resources.length===snapshot.files.length,'SOURCE_GRAPH','The original publisher resource graph is incomplete.');
  const indexed=new Map(resources.map(item=>[item.key,item]));
  for(const item of snapshot.files){
    const original=indexed.get(item.path);
    requireValue(original?.kind==='publisher-source'&&original.sha256===item.sha256&&original.bytes===item.bytes,
      'SOURCE_GRAPH','A retained publisher resource differs from its original snapshot.');
  }
  requireValue(digest(stable(snapshot.files))===snapshot.manifestSha256,'SOURCE_GRAPH','The original publisher manifest differs.');
  return indexed;
}

/** Called before the original SQLite archive snapshot, with the same archive ID. */
export async function capturePublisherSnapshot(store,{id=randomUUID(),expectedGeneration}={}){
  identifier(id,'publisher snapshot ID');
  return once(store,'capture:'+id,async()=>{
    const root=join(store.directory,'publisher'),request={root,expectedGeneration:expectedGeneration??null},
      prior=store.get('publisher-snapshot',id,false);
    if(prior){
      requireValue(same(prior.request,request),'SNAPSHOT_REQUEST','Resume the exact original publisher snapshot request.');
      if(prior.status==='COMPLETE'){originalGraph(store,prior);return prior;}
    }
    let current=prior??store.put('publisher-snapshot',id,{schema:SNAPSHOT,status:'CAPTURING',request,
      createdAt:now(),sourceWorkspaceId:store.identity().workspaceId,files:[]},0);
    let present=true;try{const info=await lstat(root);requireValue(info.isDirectory()&&!info.isSymbolicLink(),
      'DIRECTORY','Retain the actual publisher directory.');}catch(error){if(error.code==='ENOENT')present=false;else throw error;}
    if(!present){
      requireValue(!current.present&&!current.selection,'SOURCE_MISSING','The original publisher disappeared after this capture began; preserve its retained source.');
      requireValue(expectedGeneration===undefined||expectedGeneration===0,'GENERATION','The selected publisher has no release store.');
      const preparations=store.list('publisher-preparation'),pending=preparations.filter(item=>item.status!=='COMPLETE')
        .map(item=>({kind:'preparation',path:'packages/'+sourcePath(item.request.exportId),status:'PENDING',
          code:'ORIGINAL_PREPARATION_PENDING',message:'Resume this retained original preparation through prepareRelease.',
          preparationId:item.id,request:item.request,originalStatus:item.status}));
      const selection=pending.length?{releaseState:null,releaseStateSha256:null,datasets:[],packages:[],releases:[],
        unavailableReleases:[],pending,preparations}:null;
      return store.put('publisher-snapshot',id,{...current,status:'COMPLETE',present:false,files:[],
        manifestSha256:digest(stable([])),fileCount:0,bytes:0,selection,completedAt:now()},current.revision);
    }
    requireValue(await realpath(root)===resolve(root),'DIRECTORY','Use the original canonical publisher directory.');
    const observedFiles=await walk(root),preparations=store.list('publisher-preparation'),
      selected=portableSelection(await selection(root,observedFiles,preparations));
    if(expectedGeneration!==undefined)requireValue((selected.releaseState?.generation??0)===expectedGeneration,
      'GENERATION','The original release selection changed; read its current generation.');
    if(current.selection)requireValue(same(current.selection,selected),'SELECTION_CHANGED',
      'The original publisher selection changed during capture; preserve this snapshot and choose a new capture ID.');
    else current=store.put('publisher-snapshot',id,{...current,present:true,selection:selected,sourceFiles:observedFiles},current.revision);
    const retained=[];
    for(const item of current.sourceFiles){
      const old=store.resource('publisher:'+id,item.path);
      if(old){
        // A replay retains the observed control bytes; immutable/native state is
        // independently bound by the complete selection and original file hashes.
        const receipt=await store.sourceFile(old.sha256);
        requireValue(receipt.bytes===old.bytes,'SOURCE_GRAPH','The retained original publisher file differs.');
        retained.push({path:item.path,sha256:old.sha256,bytes:old.bytes});
      }else{
        const receipt=await captureFile(store,root,item,'publisher:'+id,current.createdAt);
        retained.push({path:item.path,sha256:receipt.sha256,bytes:receipt.bytes});
      }
    }
    const afterFiles=await walk(root),after=portableSelection(await selection(root,afterFiles,store.list('publisher-preparation')));
    requireValue(same(current.sourceFiles,afterFiles),'SOURCE_CHANGED','The original publisher file inventory changed during capture.');
    requireValue(same(selected,after),'SELECTION_CHANGED','The publisher changed during its source capture; retain this operation and capture its new selection separately.');
    const indexed=new Map(retained.map(item=>[item.path,item]));
    if(selected.releaseStateSha256)requireValue(indexed.get('releases/state.json')?.sha256===selected.releaseStateSha256,
      'SELECTION_CHANGED','The retained release state differs from its original selected history.');
    for(const item of selected.datasets)requireValue(indexed.get(item.path+'/state.json')?.sha256===item.stateSha256,
      'DATASET_CHANGED','The retained dataset state differs from the selected generation.');
    for(const item of selected.packages){
      requireValue(indexed.get(item.path+'/binding.json')?.sha256===item.bindingSha256,
        'PACKAGE_CHANGED','The retained package binding differs from the selected source.');
      for(const file of item.files){
        const retained=indexed.get(item.path+'/'+sourcePath(file.file));
        requireValue(retained?.sha256===file.sha256&&retained.bytes===file.bytes,
          'PACKAGE_CHANGED','The retained package differs from its complete original native source closure.');
      }
    }
    for(const release of selected.releases){
      const metadata=indexed.get('releases/releases/'+release.id+'/release.json');
      requireValue(metadata,'RELEASE_SOURCE','Keep the complete original release metadata.');
      const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await store.raw(metadata.sha256)));
      requireValue(record.digest===release.digest,'RELEASE_CHANGED','The original release metadata changed during capture.');
      for(const file of record.files){
        const actual=indexed.get('releases/releases/'+release.id+'/'+sourcePath(file.file));
        requireValue(actual?.sha256===file.sha256&&actual.bytes===file.bytes,'RELEASE_CHANGED','A compiled original release file differs.');
      }
    }
    retained.sort((a,b)=>a.path.localeCompare(b.path));
    current=store.put('publisher-snapshot',id,{...current,status:'COMPLETE',files:retained,manifestSha256:digest(stable(retained)),
      fileCount:retained.length,bytes:retained.reduce((total,item)=>total+item.bytes,0),completedAt:now()},current.revision);
    originalGraph(store,current);return current;
  });
}
async function exactFile(store,item,destination,body){
  await directory(dirname(destination));
  const expected=body?{sha256:digest(body),bytes:body.length}:item;
  let existing;try{existing=await lstat(destination);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing){
    requireValue(existing.isFile()&&!existing.isSymbolicLink(),'DESTINATION','Preserve the existing destination file.');
    const hash=createHash('sha256');let bytes=0;
    for await(const chunk of createReadStream(destination)){hash.update(chunk);bytes+=chunk.length;}
    requireValue(bytes===expected.bytes&&hash.digest('hex')===expected.sha256,'DESTINATION_CHANGED','Preserve the different receiving file.');
    return expected;
  }
  if(body){await writeNew(destination,body);return expected;}
  const original=await store.sourceFile(item.sha256);requireValue(original.bytes===item.bytes,'SOURCE_GRAPH','The original resource length differs.');
  const temporary=destination+'.'+randomUUID()+'.part',output=await open(temporary,'wx',0o600);
  try{
    const hash=createHash('sha256');let bytes=0;
    try{
      for await(const chunk of createReadStream(original.path)){hash.update(chunk);bytes+=chunk.length;await output.writeFile(chunk);}
      requireValue(bytes===item.bytes&&hash.digest('hex')===item.sha256,'SOURCE_GRAPH','The retained publisher bytes changed during receiving.');
      await output.sync();
    }finally{await output.close();}
    try{await link(temporary,destination);}catch(error){if(error.code!=='EEXIST')throw error;return exactFile(store,item,destination);}
    const parent=await open(dirname(destination),'r');try{await parent.sync();}finally{await parent.close();}
    return expected;
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function copySelection(snapshot,prefix){
  return snapshot.files.filter(item=>item.path.startsWith(prefix+'/')).map(item=>({...item,suffix:sourcePath(item.path.slice(prefix.length+1))}));
}
async function receiveVersions(store,snapshot,selected,destination,maxResidentRows){
  const sourceFiles=new Map(copySelection(snapshot,selected.path).map(item=>[item.suffix,item]));
  const required=['state.json',...selected.state.versions.flatMap(item=>
    ['dataset.json','data.csv','manifest.json'].map(file=>'versions/'+item.snapshot+'/'+file))];
  let nativeState=null;
  try{nativeState=(await readSmall(join(destination,'state.json'))).value;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(nativeState){
    const upgraded=selected.state.schema==='stellar-forge.dataset-versions.v1'&&nativeState.schema==='stellar-forge.dataset-versions.v2';
    requireValue(same(nativeState,selected.state)||upgraded&&same({...nativeState,schema:selected.state.schema},selected.state),
      'DATASET_RECEIVING','Preserve the different native version-store state.');
  }
  for(const name of required){
    const item=sourceFiles.get(name);requireValue(item,'DATASET_SOURCE','Keep every original retained version generation.');
    if(name==='state.json'&&nativeState)continue;
    await exactFile(store,item,join(destination,name));
  }
  const versions=await openDatasetVersions({directory:destination,collectOnOpen:false,maxCachedVersions:1,maxResidentRows});
  try{
    const result=versions.status();
    requireValue(result.current===selected.state.current&&same(result.settings,selected.state.settings)&&
      same(result.versions.map(({snapshot,configHash,csvHash,sourceBytes,activatedAt,expiresAt})=>
        ({snapshot,configHash,csvHash,sourceBytes,activatedAt,expiresAt})),selected.state.versions),
      'DATASET_RECEIVING','The original version-store receiver changed a retained generation.');
    return {originalPath:selected.path,originalStateSha256:selected.stateSha256,directory:destination,
      current:result.current,versions:result.versions.map(({snapshot,configHash,csvHash,sourceBytes,activatedAt,expiresAt})=>
        ({snapshot,configHash,csvHash,sourceBytes,activatedAt,expiresAt})),revision:result.revision};
  }finally{await versions.close();}
}
async function retainPendingSource(store,snapshot,current,root){
  const pending=current.pending??[],selected=snapshot.files.filter(file=>pending.some(item=>
    file.path===item.path||file.path.startsWith(item.path+'/')));
  if(!selected.length)return {directory:null,files:[],manifestSha256:digest(stable([]))};
  const destination=join(root,'historical-source');
  for(const item of selected)await exactFile(store,item,join(destination,sourcePath(item.path)));
  return {directory:destination,files:selected,manifestSha256:digest(stable(selected))};
}
function resumePreparationRequests(selected){
  return (selected?.preparations??[]).filter(item=>item.status!=='COMPLETE').map(item=>({
    originalRecordId:item.id,request:item.request,originalStatus:item.status,action:'prepareRelease'
  }));
}
function completeReceivingStatus(current){return current.pending?.length?'COMPLETE_WITH_PENDING':'COMPLETE';}
function receiverRoot(store,id){return join(store.directory,'publisher','received',id);}
export function publisherTransferState(store){
  return {snapshots:store.list('publisher-snapshot'),receiving:store.list('publisher-receiving')};
}
/** Receive the original source on this host; activation remains the existing CAS action. */
export async function receivePublisherSnapshot(store,{id,snapshotId,maxResidentRows=1000000}={}){
  identifier(snapshotId,'publisher snapshot ID');identifier(id,'publisher receiving ID');
  if(!Number.isSafeInteger(maxResidentRows)||maxResidentRows<1||maxResidentRows>16000000)
    throw new RangeError('Use the original native parsed-data budget from 1 through 16,000,000 rows.');
  return once(store,'receive:'+id,async()=>{
    const snapshot=store.get('publisher-snapshot',snapshotId);
    requireValue(snapshot.schema===SNAPSHOT&&snapshot.status==='COMPLETE','SNAPSHOT','Choose the completed original publisher snapshot.');
    originalGraph(store,snapshot);
    const identity=store.identity(),request={snapshotId,manifestSha256:snapshot.manifestSha256,directory:store.directory,
      receivedArchive:identity.receivedArchive??null},prior=store.get('publisher-receiving',id,false);
    if(prior){
      requireValue(same(prior.request,request),'RECEIVING_REQUEST','Keep the original receiving identity for this destination and archive.');
      if(['COMPLETE','COMPLETE_WITH_PENDING'].includes(prior.status))return prior;
    }
    let current=prior??store.put('publisher-receiving',id,{schema:RECEIVING,status:'RECEIVING',request,
      createdAt:now(),datasets:[],packages:[],releases:[],pending:snapshot.selection?.pending??[],
      resumePreparations:resumePreparationRequests(snapshot.selection),
      originalSelection:snapshot.selection?.releaseState??null,
      unavailableReleases:snapshot.selection?.unavailableReleases??[]},0);
    if(current.runtime?.maxResidentRows!==maxResidentRows)current=store.put('publisher-receiving',id,
      {...current,runtime:{maxResidentRows,maxCachedVersions:1}},current.revision);
    if(!snapshot.present)return store.put('publisher-receiving',id,{...current,status:completeReceivingStatus(current),
      historicalSource:{directory:null,files:[],manifestSha256:digest(stable([]))},activation:null,completedAt:now()},current.revision);
    const root=receiverRoot(store,id),releaseRoot=join(store.directory,'publisher','releases');
    await directory(root);await directory(dirname(releaseRoot));await initReleaseStore(releaseRoot,{resume:true});
    for(const selected of snapshot.selection.datasets){
      if(current.datasets.some(item=>item.originalPath===selected.path)||current.pending?.some(item=>item.kind==='dataset'&&item.path===selected.path))continue;
      const local=join(root,'datasets',digest(selected.path).slice(0,32));
      try{
        const result=await receiveVersions(store,snapshot,selected,local,maxResidentRows);
        current=store.put('publisher-receiving',id,{...current,datasets:[...current.datasets,result]},current.revision);
      }catch(error){
        const diagnostic=pendingSource('dataset',selected.path,error,{stage:'native-receiving',directory:local});
        current=store.put('publisher-receiving',id,{...current,pending:[...(current.pending??[]),diagnostic]},current.revision);
      }
    }
    for(const selected of snapshot.selection.packages){
      if(current.packages.some(item=>item.originalPath===selected.path)||current.pending?.some(item=>item.kind==='package'&&item.path===selected.path))continue;
      const dataset=current.datasets.find(item=>item.originalPath===selected.datasetPath);
      if(!dataset){
        current=store.put('publisher-receiving',id,{...current,pending:[...(current.pending??[]),
          incomplete('package',selected.path,[selected.datasetPath+' accepted native version store'],{stage:'native-receiving'})]},current.revision);
        continue;
      }
      const local=join(root,'packages',digest(selected.path).slice(0,32));
      for(const item of copySelection(snapshot,selected.path)){
        const body=item.suffix==='binding.json'?formatted({...selected.binding,datasetDirectory:dataset.directory}):null;
        await exactFile(store,item,join(local,item.suffix),body);
      }
      let prepared;try{prepared=await prepareDatasetRelease(local);}
      catch(error){
        const diagnostic=pendingSource('package',selected.path,error,{stage:'native-receiving',directory:local});
        current=store.put('publisher-receiving',id,{...current,pending:[...(current.pending??[]),diagnostic]},current.revision);continue;
      }
      requireValue(prepared.dataset.contractSha256===selected.binding.contractSha256&&
        prepared.dataset.baselineSnapshot===selected.binding.baselineSnapshot,'PACKAGE_RECEIVING','The original dataset contract changed while receiving.');
      const result={originalPath:selected.path,originalBindingSha256:selected.bindingSha256,directory:local,
        datasetDirectory:dataset.directory,receivedBindingSha256:prepared.dataset.bindingSha256,dataset:prepared.dataset};
      current=store.put('publisher-receiving',id,{...current,packages:[...current.packages,result]},current.revision);
    }
    for(const original of snapshot.selection.releases){
      if(current.releases.some(item=>item.originalId===original.id)||current.pending?.some(item=>item.kind==='release'&&item.originalRelease?.id===original.id))continue;
      const prepared=current.packages.find(item=>item.originalPath==='releases/releases/'+original.id+'/dataset');
      if(!prepared){
        current=store.put('publisher-receiving',id,{...current,pending:[...(current.pending??[]),
          incomplete('release','releases/releases/'+original.id,
            ['releases/releases/'+original.id+'/dataset accepted native package'],{stage:'native-receiving',originalRelease:original})]},current.revision);
        continue;
      }
      const localId='central-'+digest(stable({id,snapshotId,release:original.id})).slice(0,48);
      const runtime=normalizeReleaseRuntime(original.runtime);
      let staged;
      try{staged=await inspectRelease(releaseRoot,localId);}
      catch(error){
        if(error.code!=='ENOENT')throw error;
        try{staged=await stageRelease(releaseRoot,{id:localId,label:original.label,datasetPackage:prepared.directory,runtime});}
        catch(error){if(error.code!=='EEXIST')throw error;staged=await inspectRelease(releaseRoot,localId);}
      }
      requireValue(staged.id===localId&&staged.label===original.label&&same(staged.dataset,prepared.dataset)&&
        same(staged.runtime,runtime),'RELEASE_RECEIVING','The local release differs from the original prepared source and runtime.');
      const result={originalId:original.id,originalDigest:original.digest,localId,localDigest:staged.digest,
        originalPackage:'releases/releases/'+original.id+'/dataset',packageDirectory:prepared.directory,
        originalSource:original.source,localSource:staged.source,staged};
      current=store.put('publisher-receiving',id,{...current,releases:[...current.releases,result]},current.revision);
    }
    const localState=await readReleaseState(releaseRoot);
    const original=snapshot.selection.releaseState,historicalSource=await retainPendingSource(store,snapshot,current,root);
    return store.put('publisher-receiving',id,{...current,status:completeReceivingStatus(current),historicalSource,completedAt:now(),
      activation:{releaseRoot,expectedGeneration:localState.generation,
        originalActive:original?.active??null,localActive:current.releases.find(item=>item.originalId===original?.active)?.localId??null,
        unavailableActive:Boolean(original?.active&&!current.releases.some(item=>item.originalId===original.active)),
        originalPrevious:original?.previous??null,localPrevious:current.releases.find(item=>item.originalId===original?.previous)?.localId??null,
        originalStateAvailable:original!==null}},
      current.revision);
  });
}
