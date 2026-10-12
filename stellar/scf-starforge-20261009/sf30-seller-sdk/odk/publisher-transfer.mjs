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
async function selection(root,files){
  const releasesRoot=join(root,'releases'),state=await readReleaseState(releasesRoot),
    stateSource=await readSmall(join(releasesRoot,'state.json')),catalog=await listReleases(releasesRoot);
  requireValue(same(state,stateSource.value),'SELECTION_CHANGED','The original release state changed during its metadata read.');
  requireValue(catalog.errors.length===0,'RELEASE_SOURCE','Resolve the original release catalog errors before retaining its publisher.');
  const datasets=[],packages=[];
  for(const file of files){
    if(!file.path.endsWith('/state.json')&&!file.path.endsWith('/binding.json'))continue;
    if(file.bytes>4*1024*1024)continue;
    let parsed;try{parsed=await readSmall(join(root,file.path));}catch(error){
      if(error instanceof SyntaxError)continue;throw error;
    }
    if(VERSION_SCHEMAS.has(parsed.value?.schema)){
      requireValue(Array.isArray(parsed.value.versions)&&parsed.value.versions.length&&HASH.test(parsed.value.current??''),
        'DATASET_STATE','Retain the original version-store state and current generation.');
      datasets.push({path:file.path.slice(0,-'/state.json'.length),state:parsed.value,stateSha256:digest(parsed.bytes)});
    }else if(parsed.value?.schema===DATASET_BINDING_SCHEMA){
      const binding=parsed.value,selected=relative(root,binding.datasetDirectory??'').split(sep).join('/');
      sourcePath(selected);
      requireValue(resolve(root,selected)===resolve(binding.datasetDirectory)&&!selected.startsWith('../'),
        'DATASET_BINDING','The publisher package must select its original retained version store.');
      packages.push({path:file.path.slice(0,-'/binding.json'.length),binding,bindingSha256:digest(parsed.bytes),datasetPath:selected});
    }
  }
  datasets.sort((a,b)=>a.path.localeCompare(b.path));packages.sort((a,b)=>a.path.localeCompare(b.path));
  for(const item of packages)requireValue(datasets.some(value=>value.path===item.datasetPath),
    'DATASET_MISSING','The original package version store must travel with its publisher source.');
  for(const release of catalog.releases){
    requireValue(release.dataset&&release.source?.kind==='VERSIONED_DATASET_PACKAGE','RELEASE_KIND',
      'This Central publisher transfer receives the original versioned dataset releases.');
    requireValue(packages.some(value=>value.path==='releases/releases/'+release.id+'/dataset'),
      'RELEASE_PACKAGE','The original compiled dataset package is missing.');
  }
  return {state,stateSha256:digest(stateSource.bytes),datasets,packages,releases:catalog.releases.sort((a,b)=>a.id.localeCompare(b.id))};
}
function portableSelection(selected){
  return {releaseState:selected.state,releaseStateSha256:selected.stateSha256,
    datasets:selected.datasets,packages:selected.packages,releases:selected.releases};
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
      return store.put('publisher-snapshot',id,{...current,status:'COMPLETE',present:false,files:[],
        manifestSha256:digest(stable([])),fileCount:0,bytes:0,selection:null,completedAt:now()},current.revision);
    }
    requireValue(await realpath(root)===resolve(root),'DIRECTORY','Use the original canonical publisher directory.');
    const observedFiles=await walk(root),selected=portableSelection(await selection(root,observedFiles));
    if(expectedGeneration!==undefined)requireValue(selected.releaseState.generation===expectedGeneration,
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
    const after=portableSelection(await selection(root,await walk(root)));
    requireValue(same(selected,after),'SELECTION_CHANGED','The publisher changed during its source capture; retain this operation and capture its new selection separately.');
    const indexed=new Map(retained.map(item=>[item.path,item]));
    requireValue(indexed.get('releases/state.json')?.sha256===selected.releaseStateSha256,
      'SELECTION_CHANGED','The retained release state differs from its original selected history.');
    for(const item of selected.datasets)requireValue(indexed.get(item.path+'/state.json')?.sha256===item.stateSha256,
      'DATASET_CHANGED','The retained dataset state differs from the selected generation.');
    for(const item of selected.packages)requireValue(indexed.get(item.path+'/binding.json')?.sha256===item.bindingSha256,
      'PACKAGE_CHANGED','The retained package binding differs from the selected source.');
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
async function receiveVersions(store,snapshot,selected,destination){
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
  const versions=await openDatasetVersions({directory:destination,collectOnOpen:false});
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
function receiverRoot(store,id){return join(store.directory,'publisher','received',id);}
export function publisherTransferState(store){
  return {snapshots:store.list('publisher-snapshot'),receiving:store.list('publisher-receiving')};
}
/** Receive the original source on this host; activation remains the existing CAS action. */
export async function receivePublisherSnapshot(store,{id,snapshotId}={}){
  identifier(snapshotId,'publisher snapshot ID');identifier(id,'publisher receiving ID');
  return once(store,'receive:'+id,async()=>{
    const snapshot=store.get('publisher-snapshot',snapshotId);
    requireValue(snapshot.schema===SNAPSHOT&&snapshot.status==='COMPLETE','SNAPSHOT','Choose the completed original publisher snapshot.');
    originalGraph(store,snapshot);
    const identity=store.identity(),request={snapshotId,manifestSha256:snapshot.manifestSha256,directory:store.directory,
      receivedArchive:identity.receivedArchive??null},prior=store.get('publisher-receiving',id,false);
    if(prior){
      requireValue(same(prior.request,request),'RECEIVING_REQUEST','Keep the original receiving identity for this destination and archive.');
      if(prior.status==='COMPLETE')return prior;
    }
    let current=prior??store.put('publisher-receiving',id,{schema:RECEIVING,status:'RECEIVING',request,
      createdAt:now(),datasets:[],packages:[],releases:[],originalSelection:snapshot.selection?.releaseState??null},0);
    if(!snapshot.present)return store.put('publisher-receiving',id,{...current,status:'COMPLETE',completedAt:now()},current.revision);
    const root=receiverRoot(store,id),releaseRoot=join(store.directory,'publisher','releases');
    await directory(root);await directory(dirname(releaseRoot));await initReleaseStore(releaseRoot,{resume:true});
    for(const selected of snapshot.selection.datasets){
      if(current.datasets.some(item=>item.originalPath===selected.path))continue;
      const local=join(root,'datasets',digest(selected.path).slice(0,32));
      const result=await receiveVersions(store,snapshot,selected,local);
      current=store.put('publisher-receiving',id,{...current,datasets:[...current.datasets,result]},current.revision);
    }
    for(const selected of snapshot.selection.packages){
      if(current.packages.some(item=>item.originalPath===selected.path))continue;
      const dataset=current.datasets.find(item=>item.originalPath===selected.datasetPath);
      requireValue(dataset,'DATASET_BINDING','Receive the original version store before its package.');
      const local=join(root,'packages',digest(selected.path).slice(0,32));
      for(const item of copySelection(snapshot,selected.path)){
        const body=item.suffix==='binding.json'?formatted({...selected.binding,datasetDirectory:dataset.directory}):null;
        await exactFile(store,item,join(local,item.suffix),body);
      }
      const prepared=await prepareDatasetRelease(local);
      requireValue(prepared.dataset.contractSha256===selected.binding.contractSha256&&
        prepared.dataset.baselineSnapshot===selected.binding.baselineSnapshot,'PACKAGE_RECEIVING','The original dataset contract changed while receiving.');
      const result={originalPath:selected.path,originalBindingSha256:selected.bindingSha256,directory:local,
        datasetDirectory:dataset.directory,receivedBindingSha256:prepared.dataset.bindingSha256,dataset:prepared.dataset};
      current=store.put('publisher-receiving',id,{...current,packages:[...current.packages,result]},current.revision);
    }
    for(const original of snapshot.selection.releases){
      if(current.releases.some(item=>item.originalId===original.id))continue;
      const prepared=current.packages.find(item=>item.originalPath==='releases/releases/'+original.id+'/dataset');
      requireValue(prepared,'RELEASE_PACKAGE','Receive the original compiled package before staging its local release.');
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
    const original=snapshot.selection.releaseState;
    return store.put('publisher-receiving',id,{...current,status:'COMPLETE',completedAt:now(),
      activation:{releaseRoot,expectedGeneration:localState.generation,
        originalActive:original.active,localActive:current.releases.find(item=>item.originalId===original.active)?.localId??null,
        originalPrevious:original.previous,localPrevious:current.releases.find(item=>item.originalId===original.previous)?.localId??null}},
      current.revision);
  });
}
