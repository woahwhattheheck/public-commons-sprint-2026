// MIT. Compose portable OpenFEMA restoration with the original native publishers.
import {open,link,unlink} from 'node:fs/promises';
import {join,resolve,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {stable,jsonBytes,privateDirectory,readOwned,syncDir} from '../stellar-expert/store.mjs';

const SHA=/^[a-f0-9]{64}$/, UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DATASET=/^dataset-[a-f0-9]{24}$/, RELEASE=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=value=>structuredClone(value);
const equal=(a,b)=>stable(a)===stable(b);
const sh=value=>"'"+value.replace(/'/g,"'\\''")+"'";
function fail(code,message,status=409){throw Object.assign(new Error(message),{code,status});}
function absolute(value,label){
  if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value==='/'||value.includes('\0'))
    fail('OPENFEMA_RELOCATION_PATH','Use the exact canonical '+label+'.',400);
  return value;
}
function relative(value){
  if(typeof value!=='string'||!value||value.startsWith('/')||value.includes('\\')||
     value.split('/').some(x=>!x||x==='.'||x==='..')||/[\x00-\x1f\x7f]/.test(value))
    fail('OPENFEMA_RELOCATION_PATH','An original archive member has an invalid relative path.',400);
  return value;
}
function parse(bytes,label){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{fail('OPENFEMA_RELOCATION_SOURCE','The original '+label+' is not valid UTF-8 JSON.');}
}
async function optional(path,max=8*1024*1024){
  try{return await readOwned(path,max);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function versionIndex(value){
  if(!['stellar-forge.dataset-versions.v1','stellar-forge.dataset-versions.v2'].includes(value?.schema)||
     !SHA.test(value.current??'')||!Number.isSafeInteger(value.revision)||value.revision<1)
    fail('OPENFEMA_RELOCATION_VERSION','The original native dataset index is incomplete.');
  return value;
}
async function immutable(path,bytes){
  await privateDirectory(dirname(path),{create:true});
  const current=await optional(path,Math.max(bytes.length,1));
  if(current){if(!current.equals(bytes))fail('OPENFEMA_RELOCATION_PACKAGE_CHANGED','The restored native package differs from its original operation.');return;}
  const temp=path+'.restore-'+randomUUID();
  let file;
  try {
    file=await open(temp,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=null;
    try{await link(temp,path);}catch(error){if(error.code!=='EEXIST')throw error;
      const retained=await readOwned(path,Math.max(bytes.length,1));
      if(!retained.equals(bytes))fail('OPENFEMA_RELOCATION_PACKAGE_CHANGED','A concurrent package has different original bytes.');}
    await syncDir(dirname(path));
  } finally {
    await file?.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}

/**
 * Called after the archive owner verifies and restores its complete inventory.
 * That owner remains the only writer of OpenFEMA workspace.json. This operation
 * borrows only the original draft and SF82 stores and returns additive records.
 */
export async function restoreNativePublishers({directory,originalDirectory,workspaceId,
  archiveSha256,manifestSha256,sourceFiles}={}){
  directory=absolute(directory,'receiving workspace directory');
  originalDirectory=absolute(originalDirectory,'original workspace directory');
  if(directory===originalDirectory)fail('OPENFEMA_RELOCATION_TARGET','Restore into a distinct private directory.',400);
  if(!UUID.test(workspaceId??'')||!SHA.test(archiveSha256??'')||!SHA.test(manifestSha256??'')||!(sourceFiles instanceof Map))
    fail('OPENFEMA_RELOCATION_REVIEW','Use the verified original workspace, archive and manifest identities.',400);
  await privateDirectory(directory);
  const source=(name,{required=true}={})=>{
    name=relative(name);const value=sourceFiles.get(name);
    if(value===undefined&&!required)return null;
    if(!Buffer.isBuffer(value))fail('OPENFEMA_RELOCATION_SOURCE','The complete original archive member is missing: '+name);
    return value;
  };
  const original=parse(source('workspace.json'),'workspace index');
  if(original.schema!=='stellar-forge.openfema-workspace.v1'||original.workspaceId!==workspaceId||
     !Array.isArray(original.datasets)||!Array.isArray(original.releases))
    fail('OPENFEMA_RELOCATION_WORKSPACE','Use the selected original OpenFEMA workspace index.');
  const receiving=parse(await readOwned(join(directory,'workspace.json'),32*1024*1024),'receiving workspace index');
  if(receiving.schema!==original.schema||receiving.workspaceId!==workspaceId)
    fail('OPENFEMA_RELOCATION_WORKSPACE','The restored receiving index belongs to another workspace.');
  const datasetMap=new Map(),publisherMap=new Map(),oldIds=new Set();
  for(const dataset of original.datasets){
    if(!DATASET.test(dataset?.id??'')||datasetMap.has(dataset.id)||dataset.relativeDirectory!=='datasets/'+dataset.id)
      fail('OPENFEMA_RELOCATION_DATASET','The original dataset identities must be distinct retained packages.');
    const publisherRelative=dataset.relativePublisherDirectory??dataset.relativeDirectory+'/publisher';
    if(publisherRelative!==dataset.relativeDirectory+'/publisher')
      fail('OPENFEMA_RELOCATION_DATASET','A dataset publisher is outside its original retained package.');
    datasetMap.set(dataset.id,dataset);
    publisherMap.set(dataset.id,{dataset,publisherRelative,publisherDirectory:join(directory,publisherRelative),
      datasetDirectory:join(directory,publisherRelative,'dataset'),releaseDirectory:join(directory,publisherRelative,'releases')});
  }
  for(const release of original.releases){
    if(!RELEASE.test(release?.id??'')||oldIds.has(release.id)||!datasetMap.has(release.datasetId)||!SHA.test(release.digest??''))
      fail('OPENFEMA_RELOCATION_RELEASE','The original release identities and dataset bindings must be complete and distinct.');
    if(release.relativePublisherDirectory!==undefined&&release.relativePublisherDirectory!==publisherMap.get(release.datasetId).publisherRelative)
      fail('OPENFEMA_RELOCATION_RELEASE','A release points outside its original dataset publisher.');
    oldIds.add(release.id);
  }
  const plan={schema:'stellar-forge.openfema-native-restoration-plan.v1',workspaceId,archiveSha256,manifestSha256,
    originalDirectory,directory,workspaceIndexSha256:hash(source('workspace.json')),
    datasets:original.datasets.map(d=>({id:d.id,relativeDirectory:d.relativeDirectory})),
    releases:original.releases.map(r=>({id:r.id,digest:r.digest,datasetId:r.datasetId}))};
  const planSha256=hash(Buffer.from(stable(plan))),publisherRelocations=[],releaseMappings=[],releases=[],publisherViews=new Map();
  if(!publisherMap.size)return {schema:'stellar-forge.openfema-native-restoration.v1',workspaceId,
    archiveSha256,manifestSha256,planSha256,publisherRelocations,releaseMappings,releases};

  const {openPublisherDrafts}=await import('../dataset-refresh/workspace-state.mjs');
  const {openDatasetVersions}=await import('../dataset-refresh/versions.mjs');
  const {prepareDatasetRelease,readDatasetSourceFiles}=await import('../../sf82-seller-pilot/release-dataset.mjs');
  const {initReleaseStore,inspectRelease,stageRelease,readReleaseState,normalizeReleaseRuntime}=await import('../../sf82-seller-pilot/releases.mjs');
  const {openSocrataPublisher}=await import('../socrata/publisher.mjs');

  for(const [datasetId,publisher]of publisherMap){
    const {dataset,publisherRelative,publisherDirectory,datasetDirectory,releaseDirectory}=publisher;
    const indexRelative=publisherRelative+'/drafts/workspace.json',versionRelative=publisherRelative+'/dataset/state.json';
    const originalDraftBytes=source(indexRelative,{required:false}),originalVersionBytes=source(versionRelative,{required:false});
    const hasRelease=original.releases.some(r=>r.datasetId===datasetId);
    if(!originalDraftBytes&&!originalVersionBytes&&!hasRelease)continue;
    await privateDirectory(publisherDirectory,{create:true});
    let selectedVersion=originalVersionBytes?versionIndex(parse(originalVersionBytes,'native dataset index')):null;
    if(originalDraftBytes){
      const originalDraft=parse(originalDraftBytes,'native publisher index');
      const expectedDirectory=join(originalDirectory,publisherRelative,'dataset');
      if(originalDraft.schema!=='stellar-forge.dataset-publisher-workspace.v1'||
         originalDraft.datasetDirectory!==expectedDirectory||!Number.isSafeInteger(originalDraft.revision)||originalDraft.revision<1)
        fail('OPENFEMA_RELOCATION_DRAFT','The archived native publisher does not match its original dataset directory.');
      if(!selectedVersion){
        if(hasRelease||(originalDraft.candidates??[]).length||(originalDraft.buyers??[]).length||(originalDraft.workbookSources??[]).length)
          fail('OPENFEMA_RELOCATION_VERSION','Retain the original dataset state before reopening saved publisher work.');
        const originalConfig=source(dataset.relativeDirectory+'/package/dataset.json');
        const originalCsv=source(dataset.relativeDirectory+'/package/dataset.csv');
        if(hash(await readOwned(join(directory,dataset.relativeDirectory,'package/dataset.json')))!==hash(originalConfig)||
           hash(await readOwned(join(directory,dataset.relativeDirectory,'package/dataset.csv'),256*1024*1024))!==hash(originalCsv))
          fail('OPENFEMA_RELOCATION_SOURCE','The original initialization package changed.');
        const initialized=await openDatasetVersions({directory:datasetDirectory,
          initialConfig:join(directory,dataset.relativeDirectory,'package/dataset.json')});
        try{selectedVersion=versionIndex(initialized.status());}
        finally{await initialized.close();}
      }
      const operationId=hash(Buffer.from(stable({planSha256,purpose:'restore-original-dataset-publisher',datasetId,
        originalPublisherIndexSha256:hash(originalDraftBytes),originalDatasetIndexSha256:originalVersionBytes?hash(originalVersionBytes):null})));
      const currentBytes=await readOwned(join(directory,indexRelative),8*1024*1024);
      const current=parse(currentBytes,'receiving native publisher index');
      const previous=(current.datasetRelocations??[]).find(x=>x.operationId===operationId);
      if(!previous&&!currentBytes.equals(originalDraftBytes))
        fail('OPENFEMA_RELOCATION_DRAFT_CHANGED','The native publisher changed before the archived binding was adopted.');
      const drafts=await openPublisherDrafts({datasetDirectory:current.datasetDirectory,directory:join(publisherDirectory,'drafts')});
      try {
        const expectedRevision=previous?.previousRevision??drafts.view().revision;
        const adopted=await drafts.adoptDatasetDirectory({datasetDirectory,expectedDirectory,expectedRevision,
          expectedSnapshot:selectedVersion.current,expectedDatasetRevision:selectedVersion.revision,
          sourceManifestSha256:manifestSha256,sourcePlanSha256:planSha256,operationId});
        if(!adopted.bindingCurrent)fail('OPENFEMA_RELOCATION_SUPERSEDED','A later restoration selected another native dataset.');
        publisherRelocations.push({datasetId,relativePublisherDirectory:publisherRelative,
          originalIndexSha256:hash(originalDraftBytes),originalRevision:originalDraft.revision,
          currentRevision:adopted.workspace.revision,operationId,reused:adopted.reused,relocation:adopted.relocation});
      } finally {await drafts.close();}
    }
    await initReleaseStore(releaseDirectory,{resume:true});
    publisher.restored=true;
  }

  for(const old of original.releases){
    const publisher=publisherMap.get(old.datasetId);
    const {publisherRelative,publisherDirectory,datasetDirectory,releaseDirectory}=publisher;
    const nativeOld=await inspectRelease(releaseDirectory,old.id);
    if(nativeOld.digest!==old.digest||nativeOld.dataset?.baselineSnapshot!==old.snapshot)
      fail('OPENFEMA_RELOCATION_RELEASE_CHANGED','The archived release differs from its original native digest or snapshot.');
    const oldPrefix=publisherRelative+'/releases/releases/'+old.id+'/dataset';
    const oldBindingRaw=source(oldPrefix+'/binding.json'),oldBinding=parse(oldBindingRaw,'dataset release binding');
    if(hash(oldBindingRaw)!==nativeOld.dataset.bindingSha256||oldBinding.datasetDirectory!==nativeOld.dataset.datasetDirectory)
      fail('OPENFEMA_RELOCATION_BINDING','The archived native release binding changed.');
    const id='openfema-'+hash(Buffer.from(stable({planSha256,from:old.id,digest:old.digest,datasetDirectory}))).slice(0,24);
    const relativeDirectory='releases/'+id,packageRelative=relativeDirectory+'/package',packageDirectory=join(directory,packageRelative);
    if(old.relativeDirectory!=='releases/'+old.id)fail('OPENFEMA_RELOCATION_RELEASE','The archived source package is outside its original release.');
    const termsRelative=old.termsRelativePath??old.relativeDirectory+'/package/seller.json';
    if(!relative(termsRelative).startsWith(old.relativeDirectory+'/package/'))
      fail('OPENFEMA_RELOCATION_TERMS','The original seller terms are outside the retained release package.');
    const originalTerms=source(termsRelative),terms=parse(originalTerms,'original seller terms');
    if(terms.schema!=='stellar-forge.seller-service.v1'||terms.routes?.length!==1||!terms.routes[0].definition?.payment||
       old.termsSha256!==undefined&&old.termsSha256!==hash(originalTerms)||old.termsBytes!==undefined&&old.termsBytes!==originalTerms.length)
      fail('OPENFEMA_RELOCATION_TERMS','The complete original seller definition and exact payment terms are required.');
    await privateDirectory(packageDirectory,{create:true});
    for(const name of ['dataset.csv','dataset.json','seller.json','source.json'])
      await immutable(join(packageDirectory,name),source(oldPrefix+'/'+name));
    await immutable(join(packageDirectory,'binding.json'),jsonBytes({...oldBinding,datasetDirectory}));
    await immutable(join(packageDirectory,'original-seller.json'),originalTerms);
    const originalSource=parse(source(oldPrefix+'/source.json'),'dataset provenance');
    const companions=await readDatasetSourceFiles(join(directory,oldPrefix),originalSource);
    for(const file of companions){
      relative(file.path);
      const bytes=source(oldPrefix+'/'+file.path);
      if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)
        fail('OPENFEMA_RELOCATION_SOURCE','A complete original release companion has changed.');
      await immutable(join(packageDirectory,file.path),bytes);
    }
    const prepared=await prepareDatasetRelease(packageDirectory);
    const runtime=normalizeReleaseRuntime(nativeOld.runtime);
    if(prepared.dataset.datasetDirectory!==datasetDirectory||
       prepared.dataset.baselineSnapshot!==nativeOld.dataset.baselineSnapshot||
       prepared.dataset.csvSha256!==nativeOld.dataset.csvSha256||
       prepared.dataset.sourceConfigSha256!==nativeOld.dataset.sourceConfigSha256||
       prepared.dataset.sourceSha256!==nativeOld.dataset.sourceSha256||
       prepared.dataset.contractSha256!==nativeOld.dataset.contractSha256)
      fail('OPENFEMA_RELOCATION_PACKAGE_CHANGED','Restaging must preserve the original dataset, source and query contract.');
    let staged;
    try{staged=await inspectRelease(releaseDirectory,id);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(staged){
      if(!equal(staged.dataset,prepared.dataset)||!equal(staged.runtime,runtime)||staged.label!==nativeOld.label)
        fail('OPENFEMA_RELOCATION_ID_USED','This deterministic receiving release belongs to different native inputs.');
    }else staged=await stageRelease(releaseDirectory,{id,label:nativeOld.label,datasetPackage:packageDirectory,runtime});
    if(staged.dataset.datasetDirectory!==datasetDirectory||!equal(staged.runtime,runtime))
      fail('OPENFEMA_RELOCATION_RELEASE_CHANGED','The new native release did not retain its selected dataset or runtime.');
    const cli=fileURLToPath(new URL('../../sf82-seller-pilot/release-cli.mjs',import.meta.url));
    const mapping={fromReleaseId:old.id,fromDigest:old.digest,toReleaseId:id,toDigest:staged.digest,datasetId:old.datasetId,
      originalDatasetDirectory:nativeOld.dataset.datasetDirectory,datasetDirectory,relativeDirectory,
      archiveSha256,manifestSha256,planSha256};
    releaseMappings.push(mapping);
    releases.push({...copy(old),id,createdAt:staged.createdAt,digest:staged.digest,mode:staged.mode,source:staged.source,
      dataset:staged.dataset,routes:staged.routes,release:staged,relativeDirectory,
      relativePublisherDirectory:publisherRelative,restoredFromReleaseId:old.id,restoredFrom:copy(mapping),
      termsRelativePath:packageRelative+'/original-seller.json',termsSha256:hash(originalTerms),termsBytes:originalTerms.length,
      handoff:{engine:'Original dataset publisher and SF82 seller release store',publisherDirectory,releaseRoot:releaseDirectory,
        inspect:'node '+sh(cli)+' inspect --store '+sh(releaseDirectory)+' --id '+sh(id),
        workspace:'node '+sh(cli)+' console --store '+sh(releaseDirectory),
        sourcePackage:packageDirectory,versionDirectory:datasetDirectory}});
  }

  for(const [datasetId,publisher]of publisherMap){
    if(!publisher.restored)continue;
    const native=await openSocrataPublisher({directory:publisher.publisherDirectory});
    try{publisherViews.set(datasetId,await native.state());}finally{await native.close();}
    const expectedSource=source(publisher.publisherRelative+'/releases/state.json',{required:false});
    if(expectedSource){
      const before=parse(expectedSource,'original release selection'),after=await readReleaseState(publisher.releaseDirectory);
      if(after.generation!==before.generation||after.active!==before.active||after.previous!==before.previous||!equal(after.history,before.history))
        fail('OPENFEMA_RELOCATION_SELECTION_CHANGED','The original release selection changed during restoration.');
    }
  }
  for(const record of releases){record.publisher=copy(publisherViews.get(record.datasetId));record.selection=copy(record.publisher.releases.state);}
  return {schema:'stellar-forge.openfema-native-restoration.v1',workspaceId,archiveSha256,manifestSha256,
    planSha256,publisherRelocations,releaseMappings,releases,
    selections:[...publisherViews].map(([datasetId,view])=>({datasetId,...copy(view.releases.state)}))};
}
