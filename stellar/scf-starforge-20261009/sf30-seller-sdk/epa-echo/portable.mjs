// MIT. Portable analyst worksets retain complete original source and customer files.
import {join} from 'node:path';
import {readOwned,jsonBytes,stable,privateDirectory} from '../stellar-expert/store.mjs';
import {hashBytes,fault,text} from './provider.mjs';
export const PACKAGE_SCHEMA='stellar-forge.epa-echo-workspace-package.v1';
const MAX=256*1024*1024, MAX_FILES=100000;
const allowedPath=value=>typeof value==='string'&&value.length<2048&&!value.includes('\\')&&
  !value.startsWith('/')&&!/[\x00-\x1f\x7f]/.test(value)&&value.split('/').every(s=>s&&s!=='.'&&s!=='..');
const typeFor=path=>path.endsWith('.csv')?'text/csv; charset=utf-8':path.endsWith('.html')?'text/html; charset=utf-8':
  path.endsWith('.jsonl')?'application/x-ndjson':path.endsWith('.json')?'application/json; charset=utf-8':'application/octet-stream';
const itemBy=(items,id,label)=>{const v=items.find(x=>x.id===id);if(!v)throw fault('ECHO_RECEIVED_SELECTION','Choose a received '+label+'.',404);return v;};
function viewState(state){
  const operations=Object.values(state.operations??{}).map(o=>Object.fromEntries(
    ['operationId','action','requestSha256','expectedRevision','state','createdAt','completedAt','failedAt','attempts','error']
      .filter(k=>Object.hasOwn(o,k)).map(k=>[k,o[k]])));
  const releases=(state.releases??[]).map(r=>Object.fromEntries(
    ['id','datasetId','editionId','snapshot','createdAt','digest','mode','source','dataset','routes','selection','relativeDirectory']
      .filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]])));
  return {schema:'stellar-forge.epa-echo-portable-working-state.v1',sourceWorkspaceId:state.workspaceId,
    sourceRevision:state.revision,createdAt:state.createdAt,updatedAt:state.updatedAt??null,
    portfolios:state.portfolios??[],searches:state.searches??[],captures:state.captures??[],
    editionIds:state.editionIds,selectedEditionId:state.selectedEditionId,reviews:state.reviews??[],
    datasets:state.datasets,releases,receipts:state.receipts,exports:(state.exports??[]).filter(x=>x.kind!=='workspace'),
    operations,sourceReceipts:state.receivedWorkspaces??[]};
}
export async function exportWorkspace(store,{snapshot=store.read(),createdAt=new Date().toISOString()}={}){
  const files=[],objects=new Map(),paths=new Set();let total=0;
  async function add(path,bytes,kind='source',type=typeFor(path)){
    if(!allowedPath(path)||paths.has(path))throw fault('ECHO_PACKAGE_PATH','A portable file path is invalid or repeated.',409);
    if(files.length>=MAX_FILES)throw fault('ECHO_PACKAGE_CAPACITY','The complete workset exceeds100000 files.',413);
    const sha256=hashBytes(bytes);
    if(!objects.has(sha256)){total+=bytes.length;if(total>MAX)throw fault('ECHO_PACKAGE_CAPACITY','The complete portable workset exceeds256 MiB.',413);
      objects.set(sha256,{sha256,bytes:bytes.length,contentBase64:bytes.toString('base64')});}
    paths.add(path);files.push({path,bytes:bytes.length,sha256,kind,type});return files.at(-1);
  }
  const state=viewState(snapshot),editions=[];
  await add('workspace-view.json',jsonBytes(state),'working-records');
  const objectIds=new Set();
  function addObject(sha){if(sha===undefined||sha===null)return;if(!/^[a-f0-9]{64}$/.test(sha))throw fault('ECHO_PACKAGE_SOURCE','A source object identity is invalid.',409);objectIds.add(sha);}
  for(const id of snapshot.editionIds){
    const edition=await store.edition(id);editions.push(edition);
    await add('editions/'+id+'.json',await readOwned(join(store.root,'editions',id+'.json')),'edition');
    for(const p of edition.pages){addObject(p.sha256);addObject(p.responseSha256);}
    addObject(edition.sourcePackageSha256);
  }
  for(const search of snapshot.searches??[]){
    for(const p of [...(search.pages??[]),...(search.failedResponses??[])]){addObject(p.sha256);addObject(p.responseSha256);}
    addObject(search.sourcePackageSha256);
  }
  for(const capture of snapshot.captures??[]){
    for(const p of [...(capture.pages??[]),...(capture.failedResponses??[])]){addObject(p.sha256);addObject(p.responseSha256);}
    addObject(capture.sourcePackageSha256);
    for(const task of capture.tasks??[])for(const p of task.pages??[]){addObject(p.sha256);addObject(p.responseSha256);}
  }
  for(const item of state.exports)addObject(item.sha256);
  // Earlier received worksets remain available as their complete original package.
  for(const receipt of state.sourceReceipts??[])addObject(receipt.sha256);
  for(const sha of objectIds)await add('objects/'+sha,await store.object(sha),'source-object');
  for(const dataset of snapshot.datasets??[]){
    if(!/^datasets\/dataset-[a-f0-9]{24}$/.test(dataset.relativeDirectory??''))throw fault('ECHO_PACKAGE_DATASET','A retained dataset path changed.',409);
    const root=join(store.root,dataset.relativeDirectory),packageRoot=join(root,'package');
    await add(dataset.relativeDirectory+'/dataset-receipt.json',await readOwned(join(root,'dataset-receipt.json')),'dataset');
    const manifestBytes=await readOwned(join(packageRoot,'source.json')),manifest=JSON.parse(manifestBytes);
    for(const name of ['dataset.csv','dataset.json','source.json'])
      await add(dataset.relativeDirectory+'/package/'+name,await readOwned(join(packageRoot,name),MAX),'dataset');
    for(const item of manifest.sourceFiles??[]){
      if(!allowedPath(item.path)||!item.path.startsWith('provenance/'))throw fault('ECHO_PACKAGE_DATASET','A dataset source path changed.',409);
      const bytes=await readOwned(join(packageRoot,item.path),MAX);
      if(bytes.length!==item.bytes||hashBytes(bytes)!==item.sha256)throw fault('ECHO_PACKAGE_DATASET','The original dataset source bytes changed.',409);
      await add(dataset.relativeDirectory+'/package/'+item.path,bytes,'dataset-source');
    }
  }
  const {readBuyerOutput}=await import('../stellar-expert/dataset.mjs');
  for(const receipt of snapshot.receipts??[]){
    if(!/^buyer-[a-f0-9]{24}$/.test(receipt.id))throw fault('ECHO_PACKAGE_CUSTOMER','A received customer identity changed.',409);
    for(const name of ['dataset.csv','dataset.jsonl','review.html','delivery.json','manifest.json']){
      const {bytes,item}=await readBuyerOutput(store,receipt,name);
      await add('customer-files/'+receipt.id+'/'+name,bytes,'customer-file',item.type);
    }
  }
  const manifest={schema:PACKAGE_SCHEMA,sourceWorkspaceId:snapshot.workspaceId,sourceRevision:snapshot.revision,
    createdAt,mode:'PORTABLE_ANALYST_WORKSET',state,editions,
    description:'Complete retained source, analytical working records, dataset packages, customer files and saved reviews. Receiving opens this same saved material.',
    files,objects:[...objects.values()],decodedBytes:total,fileCount:files.length};
  validateWorkspaceBundle(manifest);
  const bytes=jsonBytes(manifest);if(bytes.length>MAX)throw fault('ECHO_PACKAGE_CAPACITY','The encoded complete workset exceeds the original256 MiB object capacity.',413);
  return {bytes,type:'application/json; charset=utf-8',extension:'echo-workspace.json',
    manifest:{schema:manifest.schema,sourceWorkspaceId:manifest.sourceWorkspaceId,sourceRevision:manifest.sourceRevision,
      fileCount:files.length,decodedBytes:total,portfolioCount:state.portfolios.length,editionCount:editions.length,reviewCount:state.reviews.length}};
}
export function validateWorkspaceBundle(bundle){
  if(!bundle||typeof bundle!=='object'||Array.isArray(bundle)||bundle.schema!==PACKAGE_SCHEMA||
     !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bundle.sourceWorkspaceId??'')||
     !Number.isSafeInteger(bundle.sourceRevision)||bundle.sourceRevision<0||
     !Array.isArray(bundle.files)||!bundle.files.length||bundle.files.length>MAX_FILES||
     !Array.isArray(bundle.objects)||!Array.isArray(bundle.editions)||!bundle.state)
    throw fault('ECHO_PACKAGE_FORMAT','Choose a complete exported EPA ECHO workspace package.');
  if(bundle.state.sourceWorkspaceId!==bundle.sourceWorkspaceId||bundle.state.sourceRevision!==bundle.sourceRevision)
    throw fault('ECHO_PACKAGE_IDENTITY','The package working state has another source identity.',409);
  if(['portfolios','searches','captures','reviews','datasets','releases','receipts','exports','operations'].some(k=>!Array.isArray(bundle.state[k])))
    throw fault('ECHO_PACKAGE_FORMAT','The complete portable working records are missing.');
  const objects=new Map(),used=new Set(),paths=new Set();let total=0;
  for(const item of bundle.objects){
    if(!item||typeof item.contentBase64!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256??'')||objects.has(item.sha256)||
       !Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>MAX)
      throw fault('ECHO_PACKAGE_OBJECT','A portable source object is invalid.');
    const bytes=Buffer.from(item.contentBase64,'base64');
    if(bytes.toString('base64')!==item.contentBase64||bytes.length!==item.bytes||hashBytes(bytes)!==item.sha256)
      throw fault('ECHO_PACKAGE_OBJECT','A portable source object differs from its saved bytes.',409);
    total+=bytes.length;if(total>MAX)throw fault('ECHO_PACKAGE_CAPACITY','This complete workset exceeds256 MiB.',413);
    objects.set(item.sha256,bytes);
  }
  for(const file of bundle.files){
    if(!file||!allowedPath(file.path)||paths.has(file.path)||!objects.has(file.sha256)||
       file.bytes!==objects.get(file.sha256).length||typeof file.type!=='string'||file.type.length>150||/[\r\n]/.test(file.type))
      throw fault('ECHO_PACKAGE_FILE','A portable file manifest entry is invalid or repeated.');
    paths.add(file.path);used.add(file.sha256);
  }
  if(used.size!==objects.size||bundle.fileCount!==bundle.files.length||bundle.decodedBytes!==total)
    throw fault('ECHO_PACKAGE_COMPLETENESS','The complete file/object counts differ from this manifest.',409);
  const workingFile=bundle.files.find(f=>f.path==='workspace-view.json');
  if(!workingFile||stable(JSON.parse(objects.get(workingFile.sha256).toString('utf8')))!==stable(bundle.state))
    throw fault('ECHO_PACKAGE_IDENTITY','The retained working-state file differs.',409);
  if(!Array.isArray(bundle.state.editionIds)||bundle.state.editionIds.length!==bundle.editions.length||
     new Set(bundle.state.editionIds).size!==bundle.editions.length||
     new Set(bundle.editions.map(e=>e?.id)).size!==bundle.editions.length)
    throw fault('ECHO_PACKAGE_IDENTITY','The retained edition selection differs.',409);
  for(const edition of bundle.editions){
    if(!/^[a-f0-9]{64}$/.test(edition.id??'')||!bundle.state.editionIds.includes(edition.id))
      throw fault('ECHO_PACKAGE_IDENTITY','A portable source edition has an invalid identity.',409);
    const file=bundle.files.find(f=>f.path==='editions/'+edition.id+'.json');
    if(!file||stable(JSON.parse(objects.get(file.sha256).toString('utf8')))!==stable(edition))
      throw fault('ECHO_PACKAGE_IDENTITY','A retained edition differs from its original file.',409);
    for(const p of edition.pages??[]){
      if(!bundle.files.some(f=>f.path==='objects/'+p.sha256&&f.sha256===p.sha256)||
         p.responseSha256&&!bundle.files.some(f=>f.path==='objects/'+p.responseSha256&&f.sha256===p.responseSha256))
        throw fault('ECHO_PACKAGE_COMPLETENESS','An original edition response is missing.',409);
    }
  }

  // The saved working state names the original file closure. An internally
  // consistent shortened manifest cannot stand in for that complete workset.
  const files=new Map(bundle.files.map(file=>[file.path,file]));
  function requiredFile(path,expected,label){
    const file=files.get(path);
    if(!file)throw fault('ECHO_PACKAGE_COMPLETENESS',
      'Include the original '+label+' file "'+path+'" from this saved workset.',409,
      {missingPath:path,requiredBy:label});
    if(expected?.sha256!==undefined&&
       (!/^[a-f0-9]{64}$/.test(expected.sha256)||file.sha256!==expected.sha256)||
       expected?.bytes!==undefined&&
       (!Number.isSafeInteger(expected.bytes)||expected.bytes<0||file.bytes!==expected.bytes))
      throw fault('ECHO_PACKAGE_IDENTITY',
        'The original '+label+' file "'+path+'" differs from its saved byte identity.',409,
        {path,requiredBy:label,expectedSha256:expected?.sha256??null,expectedBytes:expected?.bytes??null});
    return file;
  }
  function jsonFile(path,label){
    const file=requiredFile(path,null,label);
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(objects.get(file.sha256)));}
    catch{throw fault('ECHO_PACKAGE_FORMAT',
      'The original '+label+' file "'+path+'" is not complete UTF-8 JSON.',409,{path,requiredBy:label});}
  }
  function requiredObject(sha256,bytes,label){
    if(!/^[a-f0-9]{64}$/.test(sha256??''))
      throw fault('ECHO_PACKAGE_IDENTITY','The saved '+label+' has no valid original source identity.',409,{requiredBy:label});
    return requiredFile('objects/'+sha256,{sha256,...(bytes===undefined?{}:{bytes})},label);
  }
  function originalResponses(record,label){
    for(const response of [...(record.pages??[]),...(record.failedResponses??[])]){
      requiredObject(response.sha256,response.bytes,label+' response');
      if(response.responseSha256)requiredObject(response.responseSha256,undefined,label+' transport response');
    }
    if(record.sourcePackageSha256)requiredObject(record.sourcePackageSha256,undefined,label+' source package');
    for(const task of record.tasks??[])for(const response of task.pages??[]){
      requiredObject(response.sha256,response.bytes,label+' source task');
      if(response.responseSha256)requiredObject(response.responseSha256,undefined,label+' task transport response');
    }
  }
  for(const edition of bundle.editions)originalResponses(edition,'edition '+edition.id);
  for(const capture of bundle.state.captures)originalResponses(capture,'capture '+capture.id);
  for(const search of bundle.state.searches)originalResponses(search,'search '+search.id);
  for(const item of bundle.state.exports)requiredObject(item.sha256,item.bytes,'saved export '+item.id);
  if(bundle.state.sourceReceipts!==undefined&&!Array.isArray(bundle.state.sourceReceipts))
    throw fault('ECHO_PACKAGE_FORMAT','The saved source-workspace receipts must remain an array.');
  for(const receipt of bundle.state.sourceReceipts??[])
    requiredObject(receipt.sha256,receipt.bytes,'received workspace '+receipt.id);
  const datasetIds=new Set();
  for(const dataset of bundle.state.datasets){
    if(!dataset||!/^dataset-[a-f0-9]{24}$/.test(dataset.id??'')||datasetIds.has(dataset.id)||
       dataset.relativeDirectory!=='datasets/'+dataset.id||
       ![dataset.csvSha256,dataset.sourceConfigSha256,dataset.sourceManifestSha256].every(value=>/^[a-f0-9]{64}$/.test(value??'')))
      throw fault('ECHO_PACKAGE_IDENTITY','A saved dataset has a changed or repeated original identity.',409);
    datasetIds.add(dataset.id);
    const label='dataset '+dataset.id,root=dataset.relativeDirectory,
      receipt=jsonFile(root+'/dataset-receipt.json',label+' receipt');
    if(stable(receipt)!==stable(dataset))
      throw fault('ECHO_PACKAGE_IDENTITY','The original dataset receipt differs from the saved dataset '+dataset.id+'.',409,
        {path:root+'/dataset-receipt.json',requiredBy:label});
    requiredFile(root+'/package/dataset.csv',{sha256:dataset.csvSha256},label+' CSV');
    requiredFile(root+'/package/dataset.json',{sha256:dataset.sourceConfigSha256},label+' configuration');
    requiredFile(root+'/package/source.json',{sha256:dataset.sourceManifestSha256},label+' source manifest');
    const source=jsonFile(root+'/package/source.json',label+' source manifest');
    if(!Array.isArray(source.sourceFiles))
      throw fault('ECHO_PACKAGE_FORMAT','The original source manifest for '+label+' has no provenance-file list.',409,
        {path:root+'/package/source.json',requiredBy:label});
    const provenance=new Set();
    for(const item of source.sourceFiles){
      if(!item||!allowedPath(item.path)||!item.path.startsWith('provenance/')||provenance.has(item.path)||
         !/^[a-f0-9]{64}$/.test(item.sha256??'')||!Number.isSafeInteger(item.bytes)||item.bytes<0)
        throw fault('ECHO_PACKAGE_IDENTITY','The original '+label+' provenance list has a changed or repeated file.',409,
          {requiredBy:label,path:item?.path??null});
      provenance.add(item.path);
      requiredFile(root+'/package/'+item.path,item,label+' provenance');
    }
  }
  const customerNames=['dataset.csv','dataset.jsonl','review.html','delivery.json','manifest.json'],receiptIds=new Set();
  for(const receipt of bundle.state.receipts){
    if(!receipt||!/^buyer-[a-f0-9]{24}$/.test(receipt.id??'')||receiptIds.has(receipt.id)||
       !Array.isArray(receipt.downloads)||receipt.downloads.length!==customerNames.length||
       !Array.isArray(receipt.intentIds)||!receipt.intentIds.length||
       !/^[a-f0-9]{64}$/.test(receipt.manifestSha256??''))
      throw fault('ECHO_PACKAGE_IDENTITY','A saved customer receipt has a changed original identity or five-file selection.',409);
    receiptIds.add(receipt.id);
    const label='customer receipt '+receipt.id,root='customer-files/'+receipt.id,downloads=new Map();
    for(const item of receipt.downloads){
      if(!item||!customerNames.includes(item.name)||downloads.has(item.name)||
         !/^[a-f0-9]{64}$/.test(item.sha256??'')||!Number.isSafeInteger(item.bytes)||item.bytes<0)
        throw fault('ECHO_PACKAGE_IDENTITY','The saved '+label+' has a changed or repeated original download.',409,
          {requiredBy:label,filename:item?.name??null});
      downloads.set(item.name,item);requiredFile(root+'/'+item.name,item,label);
    }
    const delivery=jsonFile(root+'/delivery.json',label+' delivery manifest'),
      native=jsonFile(root+'/manifest.json',label+' original dataset manifest');
    requiredFile(root+'/delivery.json',{sha256:receipt.manifestSha256},label+' delivery manifest');
    if(delivery.schema!=='stellar-forge.sf88.queue-dataset-delivery.v1'||
       stable(delivery.selection?.intents)!==stable(receipt.intentIds)||
       delivery.queueRoot!==(receipt.inboxDirectory??receipt.queueRoot))
      throw fault('ECHO_PACKAGE_IDENTITY','The original '+label+' delivery manifest has another inbox or intent selection.',409,
        {path:root+'/delivery.json',requiredBy:label});
    const originalManifest=delivery.originalDatasetManifest;
    if(!originalManifest||!/^[a-f0-9]{64}$/.test(originalManifest.sha256??'')||
       !Number.isSafeInteger(originalManifest.bytes)||originalManifest.bytes<0)
      throw fault('ECHO_PACKAGE_IDENTITY','The original '+label+' has no complete retained dataset-manifest identity.',409,
        {path:root+'/delivery.json',requiredBy:label});
    requiredFile(root+'/manifest.json',originalManifest,label+' original dataset manifest');
    for(const name of customerNames.slice(0,3)){
      const identity=native.outputs?.[name];
      if(!identity||!/^[a-f0-9]{64}$/.test(identity.sha256??'')||
         !Number.isSafeInteger(identity.bytes)||identity.bytes<0)
        throw fault('ECHO_PACKAGE_IDENTITY','The original '+label+' dataset manifest does not identify "'+name+'".',409,
          {path:root+'/manifest.json',requiredBy:label,filename:name});
      requiredFile(root+'/'+name,identity,label+' original dataset output');
    }
  }
  return {bundle,objects};
}
export async function receiveWorkspace(store,{bundle,id,createdAt}){
  if(!/^received-[a-f0-9]{24}$/.test(id))throw fault('ECHO_RECEIVED_SELECTION','Use an original receiving operation identity.');
  const checked=validateWorkspaceBundle(bundle),raw=jsonBytes(bundle);
  if(raw.length>MAX)throw fault('ECHO_PACKAGE_CAPACITY','The encoded complete workset exceeds the original256 MiB object capacity.',413);
  const saved=await store.putObject(raw);
  const directory=join(store.root,'received-workspaces',id);await privateDirectory(directory,{create:true});
  for(const file of bundle.files){
    const path=join(directory,...file.path.split('/'));
    await privateDirectory(join(path,'..'),{create:true});
    await store.immutable(path,checked.objects.get(file.sha256));
  }
  const record={id,sourceWorkspaceId:bundle.sourceWorkspaceId,sourceRevision:bundle.sourceRevision,
    createdAt:bundle.createdAt,receivedAt:createdAt,sha256:saved.sha256,bytes:saved.bytes,
    fileCount:bundle.files.length,portfolioCount:bundle.state.portfolios.length,editionCount:bundle.editions.length,
    reviewCount:bundle.state.reviews.length,state:'RECEIVED',relativeDirectory:'received-workspaces/'+id,
    originalOperationId:null};
  await store.immutable(join(directory,'Receiving_Manifest.json'),jsonBytes(record));
  return record;
}
export async function inspectReceivedWorkspace(store,id){
  const receipt=itemBy(store.read().receivedWorkspaces??[],id,'workspace');
  const raw=await store.object(receipt.sha256),bundle=JSON.parse(raw);
  if(hashBytes(raw)!==receipt.sha256||raw.length!==receipt.bytes)throw fault('ECHO_RECEIVED_CHANGED','The received package bytes changed.',409);
  return {schema:'stellar-forge.epa-echo-received-workspace-view.v1',receipt,readonly:true,state:bundle.state,editions:bundle.editions,files:bundle.files,mode:'RECEIVED_SOURCE_WORKSPACE'};
}
export async function readReceivedWorkspaceFile(store,id,path){
  if(!allowedPath(path))throw fault('ECHO_RECEIVED_FILE','Choose a retained original workspace file.');
  const {receipt,files}=await inspectReceivedWorkspace(store,id),file=files.find(f=>f.path===path);
  if(!file)throw fault('ECHO_RECEIVED_FILE','Choose a retained original workspace file.',404);
  const bytes=await readOwned(join(store.root,receipt.relativeDirectory,...path.split('/')),MAX);
  if(bytes.length!==file.bytes||hashBytes(bytes)!==file.sha256)throw fault('ECHO_RECEIVED_CHANGED','The received original file changed.',409);
  return {item:{...file,name:path.split('/').at(-1)},bytes};
}
