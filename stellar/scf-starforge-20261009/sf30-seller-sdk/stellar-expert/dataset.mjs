// MIT. Compose original SF30 dataset, SF82 release and SF88/SF100 receiving.
import {mkdir,lstat,readFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hashBytes,fault} from './provider.mjs';
import {jsonBytes,stable,privateDirectory,readOwned} from './store.mjs';
import {editionRows,csvBytes} from './domain.mjs';
import {SOURCE_CONTRACT} from './schema.mjs';
const exists=async p=>{try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const sh=s=>"'"+String(s).replaceAll("'","'\"'\"'")+"'";
const original = path => fileURLToPath(new URL('../../'+path,import.meta.url));
export async function prepareNativeDataset(store,{edition,name,id}) {
  if(typeof name!=='string'||!name.trim()||name.length>128||/[\x00-\x1f\x7f]/.test(name))
    throw fault('STELLAR_DATASET_NAME','Use a printable dataset name of up to128 characters.');
  const directory=join(store.root,'datasets',id),packageDirectory=join(directory,'package');
  await privateDirectory(directory,{create:true});await privateDirectory(packageDirectory,{create:true});
  const {columns,rows}=await editionRows(store,edition,{limit:250000});
  const csv=csvBytes(columns,rows),filterCandidates=['asset','account','address','domain','name','sequence'];
  const config={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name,
    columns:Object.fromEntries(columns.map(k=>[k,'string'])),
    filters:[...filterCandidates.filter(k=>columns.includes(k)),'sourcePageSha256'].slice(0,8),
    ranges:columns.includes('sourceObservedAt')?['sourceObservedAt']:[],
    sorts:filterCandidates.filter(k=>columns.includes(k)).slice(0,8),
    maxBytes:256*1024*1024,maxRows:250000,defaultLimit:50,maxLimit:200};
  await store.immutable(join(packageDirectory,'dataset.csv'),csv);
  await store.immutable(join(packageDirectory,'dataset.json'),jsonBytes(config));
  const sourceFiles=[];await privateDirectory(join(packageDirectory,'provenance'),{create:true});
  for(let i=0;i<edition.pages.length;i++){
    const page=edition.pages[i],path='provenance/'+String(i).padStart(5,'0')+'-'+page.sha256+'.'+(edition.query.kind==='supply'?'txt':'json');
    const bytes=await store.object(page.sha256);await store.immutable(join(packageDirectory,path),bytes);
    sourceFiles.push({path,bytes:bytes.length,sha256:page.sha256});
  }
  const source={schema:'stellar-forge.stellar-expert-dataset-source.v1',provider:SOURCE_CONTRACT,
    edition,projection:{columns,numbers:'Exact original numeric text. Numeric strings are never advertised as numeric-range or numeric-sort columns.',
      csv:'Original projected strings; use workspace spreadsheet CSV export for formula-neutralized review.'},sourceFiles};
  const sourceBytes=jsonBytes(source);await store.immutable(join(packageDirectory,'source.json'),sourceBytes);
  const {loadDatasetConfig}=await import('../dataset-handler.mjs');
  const dataset=await loadDatasetConfig(join(packageDirectory,'dataset.json')),description=dataset.describe();

  const versionDirectory=join(directory,'publisher','dataset');
  const receipt={id,editionId:edition.id,name,snapshot:description.snapshot,sourceSha256:edition.sourceSha256,
    createdAt:edition.createdAt,rows:description.rowCount,columns:description.columns,description,
    csvSha256:hashBytes(csv),sourceConfigSha256:hashBytes(jsonBytes(config)),sourceManifestSha256:hashBytes(sourceBytes),
    versionState:null,relativeDirectory:'datasets/'+id,relativePublisherDirectory:'datasets/'+id+'/publisher',mode:'ORIGINAL_SF30_DATASET'};
  await store.immutable(join(directory,'dataset-receipt.json'),jsonBytes(receipt));
  return receipt;
}
export async function queryNativeDataset(store,dataset,query) {
  if(typeof query!=='string'||query.length>8192)throw fault('STELLAR_DATASET_QUERY','Use an original dataset query string of up to8192 characters.');
  const {loadDatasetConfig}=await import('../dataset-handler.mjs');
  const loaded=await loadDatasetConfig(join(store.root,dataset.relativeDirectory,'package','dataset.json'));
  if(loaded.describe().snapshot!==dataset.snapshot)throw fault('STELLAR_DATASET_CHANGED','The dataset bytes changed.',409);
  const context={query:new URLSearchParams(query)},admitted=loaded.admit(context),result=admitted===true?loaded.handle(context):admitted;
  if(result.status!==200)throw fault(result.body.error,result.body.message,result.status);
  return result.body;
}
export function nativePublishers(store) {
  const opened=new Map();
  async function get(dataset){
    const relative=dataset.relativePublisherDirectory??dataset.relativeDirectory+'/publisher';
    if(!/^datasets\/dataset-[a-f0-9]{24}\/publisher$/.test(relative))
      throw fault('STELLAR_PUBLISHER_IDENTITY','The original publisher path changed.',409);
    if(!opened.has(relative)){
      const promise=(async()=>{
        const {openSocrataPublisher}=await import('../socrata/publisher.mjs');
        return openSocrataPublisher({directory:join(store.root,relative)});
      })();
      opened.set(relative,promise);void promise.catch(()=>opened.delete(relative));
    }
    return opened.get(relative);
  }
  async function forRelease(release){
    const dataset=store.read().datasets.find(d=>d.id===release.datasetId);
    if(!dataset)throw fault('STELLAR_PUBLISHER_IDENTITY','The release dataset is not retained.',409);
    return get(dataset);
  }
  return {get,forRelease,state:async release=>(await forRelease(release)).state(),
    async close(){const results=await Promise.allSettled([...opened.values()].map(async pending=>(await pending).close()));
      opened.clear();const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;}};
}
export async function prepareNativeRelease(store,{dataset,origin,path,payment,id,runtime={port:0},publishers}) {
  const {loadDatasetConfig}=await import('../dataset-handler.mjs');
  const {buildDatasetSellerConfig}=await import('../dataset-cli.mjs');
  const directory=join(store.root,'releases',id),sourcePackage=join(directory,'package');
  await privateDirectory(directory,{create:true});await privateDirectory(sourcePackage,{create:true});
  const originalPackage=join(store.root,dataset.relativeDirectory,'package');
  const sourceBytes=await readOwned(join(originalPackage,'source.json')),source=JSON.parse(sourceBytes);
  for(const name of ['dataset.csv','dataset.json','source.json'])
    await store.immutable(join(sourcePackage,name),await readOwned(join(originalPackage,name),256*1024*1024));
  for(const entry of source.sourceFiles){
    await privateDirectory(join(sourcePackage,'provenance'),{create:true});
    const bytes=await readOwned(join(originalPackage,entry.path));if(hashBytes(bytes)!==entry.sha256||bytes.length!==entry.bytes)
      throw fault('STELLAR_SOURCE_CHANGED','The original source package changed.',409);
    await store.immutable(join(sourcePackage,entry.path),bytes);
  }
  const native=await loadDatasetConfig(join(sourcePackage,'dataset.json')),description=native.describe();
  if(description.snapshot!==dataset.snapshot)throw fault('STELLAR_DATASET_CHANGED','Select the original retained dataset snapshot.',409);
  const seller=await buildDatasetSellerConfig(native,{origin,path,payment});
  await store.immutable(join(sourcePackage,'seller.json'),jsonBytes(seller));
  const publisher=await publishers.get(dataset);
  const prepared=await publisher.act('publisher.prepare',{exportDirectory:sourcePackage});
  const staged=await publisher.act('publisher.release.stage',{draftId:prepared.result.draft.id,id,label:dataset.name,runtime});
  const released=staged.result,publisherState=staged.state;
  if(released.dataset?.baselineSnapshot!==dataset.snapshot||released.publicOrigin!==new URL(origin).origin)
    throw fault('STELLAR_RELEASE_IDENTITY','The retained original release differs from this operation.',409);
  const cli=original('sf82-seller-pilot/release-cli.mjs'),releaseRoot=publisher.releaseDirectory;
  return {id,datasetId:dataset.id,editionId:dataset.editionId,snapshot:dataset.snapshot,createdAt:released.createdAt,
    digest:released.digest,mode:released.mode,source:released.source,dataset:released.dataset,
    routes:released.routes,release:released,relativeDirectory:'releases/'+id,
    relativePublisherDirectory:dataset.relativePublisherDirectory,originalDraftId:prepared.result.draft.id,
    publisher:publisherState,selection:publisherState.releases.state,
    handoff:{engine:'Original dataset publisher and SF82 seller release store',publisherDirectory:publisher.directory,releaseRoot,
      inspect:'node '+sh(cli)+' inspect --store '+sh(releaseRoot)+' --id '+sh(id),
      workspace:'node '+sh(cli)+' console --store '+sh(releaseRoot),
      sourcePackage:prepared.result.packageDirectory,versionDirectory:publisher.datasetDirectory}};
}
export async function inspectNativeRelease(store,release,publishers) {
  const publisher=await publishers.forRelease(release);
  const inspected=await publisher.act('publisher.release.inspect',{id:release.id});
  if(inspected.result.digest!==release.digest)throw fault('STELLAR_RELEASE_CHANGED','The original staged release changed.',409);
  return {release:inspected.result,publisher:inspected.state,selection:inspected.state.releases.state,handoff:release.handoff};
}
export async function controlNativeRelease(store,release,action,{expectedGeneration}={},publishers) {
  const publisher=await publishers.forRelease(release),prior=await publisher.state();
  const selection=prior.releases.state;
  if(action!=='stop'&&(!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0))
    throw fault('STELLAR_RELEASE_GENERATION','Use the displayed original release generation.');
  if(action==='start'&&selection.active!==release.id)
    throw fault('STELLAR_RELEASE_SELECTION','Activate this exact release before starting it.',409);
  let nativeResult,next=prior;
  const completedSelection=selection.generation===expectedGeneration+1&&
    ((action==='activate'&&selection.active===release.id&&selection.history.at(-1)?.operation==='activate')||
     (action==='rollback'&&selection.history.at(-1)?.operation==='rollback'));
  if(completedSelection)nativeResult={reused:true,state:selection};
  else if(action==='start'&&selection.generation===expectedGeneration&&
    ['RUNNING','RESTART_REQUIRED'].includes(prior.releases.runtime.state)&&prior.releases.runtime.observed?.releaseId===release.id)
    nativeResult={reused:true,state:prior.releases.runtime.state};
  else{
    const result=await publisher.act('publisher.release.'+action,
      action==='activate'?{id:release.id,expectedGeneration}:action==='stop'?{}:{expectedGeneration});
    nativeResult=result.result;next=result.state;
  }
  return {releaseId:release.id,action,nativeResult,publisher:next,selection:next.releases.state};
}
export async function inspectBuyer(inbox,intentIds) {
  if(!inbox)throw fault('STELLAR_BUYER_NOT_BOUND','Start this workspace with the original private SF88 inbox.',409);
  if(!Array.isArray(intentIds)||!intentIds.length||intentIds.length>4096||new Set(intentIds).size!==intentIds.length||
    intentIds.some(x=>typeof x!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(x)))
    throw fault('STELLAR_BUYER_SELECTION','Select distinct original inbox intent IDs in page order.');
  const {openQueue}=await import('../../sf88-operator-buyer-cli/queue.mjs'),queue=await openQueue(inbox),items=[];
  for(const intentId of intentIds){
    const record=await queue.show(intentId);
    items.push({intentId,id:record.id,status:record.state,attempt:record.attempt,
      outcome:record.outcome,configSha256:record.configSha256});
  }
  return {engine:'ORIGINAL_SF88_INBOX',intentIds,items};
}
const BUYER_FILES=Object.freeze({
  'dataset.csv':{relative:'dataset/dataset.csv',type:'text/csv; charset=utf-8'},
  'dataset.jsonl':{relative:'dataset/dataset.jsonl',type:'application/x-ndjson'},
  'review.html':{relative:'dataset/review.html',type:'text/html; charset=utf-8'},
  'delivery.json':{relative:'delivery.json',type:'application/json; charset=utf-8'},
  'manifest.json':{relative:'dataset/manifest.json',type:'application/json; charset=utf-8'}
});
async function buyerDeliveryManifest(store,id,intentIds,inbox,expectedSha256) {
  if(!/^buyer-[a-f0-9]{24}$/.test(id))throw fault('STELLAR_BUYER_IDENTITY','Choose an original received dataset.',409);
  const directory=join(store.root,'receipts',id,'delivery');
  const bytes=await readOwned(join(directory,'delivery.json'),8*1024*1024),manifest=JSON.parse(bytes);
  if(manifest.schema!=='stellar-forge.sf88.queue-dataset-delivery.v1'||
    stable(manifest.selection?.intents)!==stable(intentIds)||manifest.queueRoot!==inbox||
    expectedSha256&&hashBytes(bytes)!==expectedSha256)
    throw fault('STELLAR_BUYER_IDENTITY','The retained delivery differs from its selected original inbox and intents.',409);
  const nativeBytes=await readOwned(join(directory,'dataset','manifest.json'),8*1024*1024);
  if(hashBytes(nativeBytes)!==manifest.originalDatasetManifest?.sha256||nativeBytes.length!==manifest.originalDatasetManifest?.bytes)
    throw fault('STELLAR_BUYER_IDENTITY','The original receiving manifest changed.',409);
  const native=JSON.parse(nativeBytes),downloads=[];
  for(const [name,kind] of Object.entries(BUYER_FILES)){
    const identity=name==='delivery.json'?{bytes:bytes.length,sha256:hashBytes(bytes)}:
      name==='manifest.json'?{bytes:nativeBytes.length,sha256:hashBytes(nativeBytes)}:native.outputs?.[name];
    if(!identity||!Number.isSafeInteger(identity.bytes)||identity.bytes<0||identity.bytes>256*1024*1024||
      !/^[a-f0-9]{64}$/.test(identity.sha256??''))
      throw fault('STELLAR_BUYER_IDENTITY','The original receiving output identity is invalid.',409);
    downloads.push({name,type:kind.type,bytes:identity.bytes,sha256:identity.sha256,
      downloadUrl:'/api/receipts/'+id+'/'+name});
  }
  return {directory,manifest,manifestSha256:hashBytes(bytes),native,downloads};
}
export async function readBuyerOutput(store,receipt,name) {
  if(!Object.hasOwn(BUYER_FILES,name))throw fault('STELLAR_BUYER_OUTPUT','Choose an original customer output.',404);
  const inbox=receipt.inboxDirectory??receipt.queueRoot;
  const selected=await buyerDeliveryManifest(store,receipt.id,receipt.intentIds,inbox,receipt.manifestSha256),
    identity=selected.downloads.find(item=>item.name===name);
  const bytes=await readOwned(join(selected.directory,BUYER_FILES[name].relative),256*1024*1024);
  if(bytes.length!==identity.bytes||hashBytes(bytes)!==identity.sha256)
    throw fault('STELLAR_BUYER_IDENTITY','The saved customer output changed.',409);
  return {bytes,item:identity};
}
export async function receiveBuyer(store,inbox,intentIds,id) {
  await inspectBuyer(inbox,intentIds);
  const directory=join(store.root,'receipts',id);await privateDirectory(directory,{create:true});
  await store.immutable(join(directory,'source-selection.json'),jsonBytes({schema:'stellar-forge.stellar-expert-receiving-selection.v1',inboxDirectory:inbox,intentIds}));
  const {exportQueueDataset}=await import('../../sf88-operator-buyer-cli/queue-dataset.mjs');
  const destination=join(directory,'delivery');
  const reused=await exists(join(destination,'delivery.json'));
  if(!reused){
    if(await exists(destination)){
      await privateDirectory(destination);
      // A closed incomplete projection contains no new payment. Keep it intact
      // and let the original exporter reassemble these same retained attempts.
      await rename(destination,join(directory,'interrupted-delivery-'+randomUUID()));
    }
    await exportQueueDataset({root:inbox,intents:intentIds,destination});
  }
  const selected=await buyerDeliveryManifest(store,id,intentIds,inbox);
  if(reused){
    const {scan}=await import('../../sf100-buyer-dataset-delivery/deliver.mjs');
    await scan(join(destination,'dataset'),{retainPayload:false});
    for(const item of selected.downloads){
      const bytes=await readOwned(join(destination,BUYER_FILES[item.name].relative),256*1024*1024);
      if(bytes.length!==item.bytes||hashBytes(bytes)!==item.sha256)
        throw fault('STELLAR_BUYER_IDENTITY','The saved customer output changed.',409);
    }
  }
  return {id,intentIds,inboxDirectory:inbox,mode:'ORIGINAL_SF88_SF100_DELIVERY',
    directory:destination,relativeDirectory:'receipts/'+id+'/delivery',manifestSha256:selected.manifestSha256,
    dataset:selected.manifest.dataset,createdAt:selected.manifest.createdAt,downloads:selected.downloads,reused};
}
