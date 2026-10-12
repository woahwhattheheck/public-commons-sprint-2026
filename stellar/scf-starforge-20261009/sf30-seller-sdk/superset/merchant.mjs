// MIT. Approved Superset editions use the original SF30/SF82 release and version engine.
import {join,dirname} from 'node:path';
import {lstat,rename,rm} from 'node:fs/promises';
import {loadDatasetConfig} from '../dataset-handler.mjs';
import {buildDatasetSellerConfig} from '../dataset-cli.mjs';
import {openDatasetVersions,DATASET_SNAPSHOT_PARAMETER} from '../dataset-refresh/versions.mjs';
import {datasetControl} from '../dataset-refresh/service.mjs';
import {DATASET_BINDING_SCHEMA,datasetContractSha256,prepareDatasetRelease,stageDatasetRelease,
  inspectDatasetRelease,startDatasetRelease} from '../../sf82-seller-pilot/release-dataset.mjs';
import {readCapture,buildEdition} from './source.mjs';
import {absolute,bytes,digest,identity,readJson,readPrivate,hashPrivate,privateDirectory,acquireWorkspace,
  saveExact,separated,syncDirectory,fault,MiB} from './files.mjs';
const SOURCE_SCHEMA='stellar-forge.superset-merchant-source.v1';
const exists=async path=>{try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const readHash=async file=>{const result=await hashPrivate(file,256*MiB);return{bytes:result.bytes,sha256:result.hash};};
async function copyExact(source,target,expected){
  const raw=await readPrivate(source,expected.bytes);
  if(raw.length!==expected.bytes||digest(raw)!==expected.sha256)throw fault('SUPERSET_SOURCE_CHANGED','The original source changed during merchant preparation.',409);
  return saveExact(target,raw);
}
function groupBinding(prepared){
  return{schema:'stellar-forge.superset-version-source.v1',workspaceId:prepared.source.workspaceId,
    source:{baseUrl:prepared.source.capture.source.baseUrl,chartId:prepared.source.capture.source.chartId,
      chartUuid:prepared.source.capture.source.chartUuid,queryOrdinal:prepared.source.edition.selection.queryOrdinal},
    contractSha256:prepared.binding.contractSha256,sellerSha256:digest(prepared.retained['seller.json'])};
}
async function checkGroup(prepared,{create=false}={}){
  const file=join(prepared.binding.datasetDirectory,'superset-source-binding.json');
  if(create)await saveExact(file,groupBinding(prepared));
  else if(identity(await readJson(file))!==identity(groupBinding(prepared)))
    throw fault('SUPERSET_VERSION_SOURCE','This version store belongs to another source, reviewed field contract or merchant route.',409);
}
function summary(prepared){
  return{schema:'stellar-forge.superset-merchant-preparation.v1',directory:prepared.directory,
    resource:prepared.service.publicOrigin+prepared.service.routes[0].path,snapshot:prepared.description.snapshot,
    rows:prepared.description.rowCount,edition:prepared.source.edition,review:prepared.source.review,
    binding:prepared.binding,dataset:prepared.dataset,offers:prepared.offers};
}
export async function prepareSupersetMerchant({editionExport,directory,datasetDirectory,publicOrigin,path='/report-data',payment}={}){
  directory=absolute(directory);datasetDirectory=absolute(datasetDirectory);
  separated(directory,datasetDirectory);separated(directory,editionExport.directory);
  await privateDirectory(directory,true);const unlock=await acquireWorkspace(directory);
  try{
    const intent={schema:'stellar-forge.superset-merchant-intent.v1',workspaceId:editionExport.lineage.workspaceId,
      edition:editionExport.edition,reviewId:editionExport.lineage.review.id,datasetDirectory,publicOrigin,path,payment};
    await saveExact(join(directory,'superset-intent.json'),intent);
    const input=editionExport.directory;
    const sourceFiles=[];
    for(const member of [...editionExport.sourceFiles,
      {path:'dataset.csv',...await readHash(join(input,'dataset.csv'))},
      {path:'dataset.json',...await readHash(join(input,'dataset.json'))}]){
      const relative='superset/'+member.path;
      await copyExact(join(input,member.path),join(directory,relative),member);
      sourceFiles.push({path:relative,bytes:member.bytes,sha256:member.sha256});
    }
    sourceFiles.sort((a,b)=>a.path.localeCompare(b.path));
    const native=await loadDatasetConfig(join(input,'dataset.json')),description=native.describe();
    if(description.snapshot!==editionExport.snapshot)throw fault('SUPERSET_NATIVE_SNAPSHOT','The approved dataset snapshot changed.',409);
    const seller=await buildDatasetSellerConfig(native,{payment,origin:publicOrigin,path});
    if(seller.routes[0].definition.queryParameters.length>=32)throw fault('SUPERSET_QUERY_BUDGET','Retain one original query-parameter slot for edition selection.');
    seller.routes[0].definition.queryParameters.push({...DATASET_SNAPSHOT_PARAMETER});
    const source={schema:SOURCE_SCHEMA,sourceType:'Reviewed Apache Superset saved-query result',
      workspaceId:editionExport.lineage.workspaceId,edition:editionExport.edition,review:editionExport.lineage.review,
      capture:{sha256:editionExport.capture.sha256,source:editionExport.capture.source,
        queryCount:editionExport.capture.queryCount,definitionSha256:editionExport.capture.definitionSha256},
      lineage:'superset/lineage.json',originalCapture:'superset/capture.json',
      originalEdition:'superset/edition.json',originalReview:'superset/review.json',sourceFiles};
    const sourceBytes=bytes(source);
    const binding={schema:DATASET_BINDING_SCHEMA,datasetDirectory,
      contractSha256:datasetContractSha256(description),baselineSnapshot:description.snapshot,sourceSha256:digest(sourceBytes)};
    const config=await readJson(join(input,'dataset.json'),65536);
    await copyExact(join(input,'dataset.csv'),join(directory,'dataset.csv'),await readHash(join(input,'dataset.csv')));
    await saveExact(join(directory,'dataset.json'),{...config,file:'dataset.csv'});
    await saveExact(join(directory,'seller.json'),seller);
    await saveExact(join(directory,'source.json'),sourceBytes);await saveExact(join(directory,'binding.json'),binding);
    return summary(await readSupersetMerchant(directory));
  }finally{await unlock();}
}
export async function readSupersetMerchant(directory){
  const prepared=await prepareDatasetRelease(absolute(directory)),source=JSON.parse(prepared.retained['source.json']);
  if(source.schema!==SOURCE_SCHEMA||source.edition?.snapshot!==prepared.description.snapshot||
      source.review?.editionId!==source.edition?.id||source.review?.editionSha256!==source.edition?.sha256||
      source.review?.decision!=='approved')throw fault('SUPERSET_MERCHANT_SOURCE','Choose a complete approved Superset merchant package.',409);
  for(const key of ['lineage','originalCapture','originalEdition','originalReview'])
    if(!prepared.sourceFiles.some(member=>member.path===source[key]))throw fault('SUPERSET_MERCHANT_SOURCE','An original source document is outside the retained source closure.',409);
  const [lineage,capture,edition,review]=await Promise.all([
    readJson(join(prepared.directory,source.lineage),4*MiB),
    readJson(join(prepared.directory,source.originalCapture),16*MiB),
    readJson(join(prepared.directory,source.originalEdition),4*MiB),
    readJson(join(prepared.directory,source.originalReview),MiB)]);
  for(const doc of [edition,review]){
    const {sha256,...unsigned}=doc;
    if(identity(unsigned)!==sha256)throw fault('SUPERSET_MERCHANT_REVIEW_CHANGED','The original edition or review identity changed.',409);
  }
  if(edition.sha256!==source.edition.sha256||review.sha256!==source.review.sha256||
      review.editionSha256!==edition.sha256||review.decision!=='approved'||capture.sha256!==source.capture.sha256||
      edition.captureId!==capture.id||lineage.edition.sha256!==edition.sha256||
      lineage.edition.snapshot!==prepared.description.snapshot||lineage.review.sha256!==review.sha256||
      identity(lineage.selection)!==identity(edition.selection))
    throw fault('SUPERSET_MERCHANT_REVIEW_CHANGED','The original source, edition and review binding differ.',409);
  const blobs=new Map();
  for(const entry of capture.entries){
    const name='superset/responses/'+entry.body.sha256+'.json';
    if(!prepared.sourceFiles.some(file=>file.path===name&&file.sha256===entry.body.sha256&&file.bytes===entry.body.bytes))
      throw fault('SUPERSET_MERCHANT_CAPTURE_MISSING','A native response is absent from the retained release closure.',409);
    if(!blobs.has(entry.body.sha256))blobs.set(entry.body.sha256,await readPrivate(join(prepared.directory,name),entry.body.bytes));
  }
  const rebuilt=buildEdition(capture,hash=>blobs.get(hash),edition.selection);
  if(digest(rebuilt.csv)!==prepared.dataset.csvSha256||digest(bytes(rebuilt.config))!==edition.config.sha256||
      digest(bytes(rebuilt.lineage))!==edition.lineage.sha256)
    throw fault('SUPERSET_MERCHANT_PROJECTION_CHANGED','The native response does not reconstruct the reviewed merchant dataset.',409);
  return{...prepared,source,lineage,capture,edition,review};
}
export async function initializeSupersetVersions(directory,{retentionMs=86400000,maxVersions=8,maxRetainedBytes=512*MiB}={}){
  const prepared=await readSupersetMerchant(directory),root=prepared.binding.datasetDirectory;
  const initialized=await exists(join(root,'state.json')),bound=initialized&&await exists(join(root,'superset-source-binding.json'));
  if(bound)await checkGroup(prepared);
  const versions=await openDatasetVersions({directory:root,...(!initialized?{
    initialConfig:join(prepared.directory,'dataset.json'),retentionMs,maxVersions,maxRetainedBytes}:{})});
  try{
    if(datasetContractSha256(versions.describe())!==prepared.binding.contractSha256)
      throw fault('SUPERSET_VERSION_CONTRACT','The existing original dataset store has a different field contract.',409);
    if(!bound&&versions.status().current!==prepared.description.snapshot)
      throw fault('SUPERSET_VERSION_SOURCE','The first native version differs from the reviewed edition.',409);
    await checkGroup(prepared,{create:!bound});return versions.status();
  }finally{await versions.close();}
}
export async function startSupersetMerchant({directory,stageDirectory,runtime={port:0},nativeFactory}={}){
  const prepared=await readSupersetMerchant(directory);
  stageDirectory=absolute(stageDirectory);separated(stageDirectory,prepared.directory);separated(stageDirectory,prepared.binding.datasetDirectory);
  await initializeSupersetVersions(directory);
  const staging=stageDirectory+'.receiving';await privateDirectory(staging,true);const unlock=await acquireWorkspace(staging);
  try{
    await saveExact(join(staging,'intent.json'),{schema:'stellar-forge.superset-stage-intent.v1',destination:stageDirectory,dataset:prepared.dataset});
    if(!await exists(join(stageDirectory,'manifest.json'))){
      if(await exists(stageDirectory))throw fault('SUPERSET_STAGE_EXISTS','Choose the original complete native stage or a new destination.',409);
      const ready=join(staging,'release');
      if(!await exists(join(ready,'manifest.json'))){
        if(await exists(ready))await rm(ready,{recursive:true});
        await stageDatasetRelease(ready,prepared.directory);
      }
      const staged=await inspectDatasetRelease(ready);
      if(identity(staged.dataset)!==identity(prepared.dataset))throw fault('SUPERSET_STAGE_CHANGED','The retained stage belongs to a different source.',409);
      await rename(ready,stageDirectory);await syncDirectory(dirname(stageDirectory));
    }
    const staged=await inspectDatasetRelease(stageDirectory);
    if(identity(staged.dataset)!==identity(prepared.dataset))throw fault('SUPERSET_STAGE_CHANGED','The native stage belongs to another source.',409);
  }finally{await unlock();}
  const service=await startDatasetRelease(stageDirectory,{runtime,nativeFactory});
  return{...service,edition:prepared.source.edition,resource:prepared.service.publicOrigin+prepared.service.routes[0].path,
    packageDirectory:prepared.directory,stageDirectory};
}
export async function publishSupersetMerchant({directory,expectedSnapshot,expectedRevision}={}){
  const prepared=await readSupersetMerchant(directory);await checkGroup(prepared);
  if(!/^[a-f0-9]{64}$/.test(expectedSnapshot??'')||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
    throw fault('SUPERSET_PUBLICATION_REVIEW','Supply the native current snapshot and revision.');
  const status=await datasetControl(prepared.binding.datasetDirectory,'status');
  if(status.current===prepared.description.snapshot)return{status:'ALREADY_CURRENT',snapshot:status.current,native:status};
  const result=await datasetControl(prepared.binding.datasetDirectory,'refresh',{
    configPath:join(prepared.directory,'dataset.json'),expectedSnapshot,expectedRevision});
  if(result.current!==prepared.description.snapshot)throw fault('SUPERSET_PUBLICATION_CHANGED','Inspect the native writer; its current snapshot differs.',409);
  return{status:'PUBLISHED',snapshot:result.current,editionId:prepared.source.edition.id,native:result};
}
export async function supersetMerchantStatus(directory){
  const prepared=await readSupersetMerchant(directory);
  return{...summary(prepared),native:await datasetControl(prepared.binding.datasetDirectory,'status')};
}
// Original supervised release activation/rollback/restart are retained verbatim.
export async function stageSupersetRelease({directory,releaseDirectory,id,label=id,runtime={port:0}}={}){
  const prepared=await readSupersetMerchant(directory),native=await import('../../sf82-seller-pilot/releases.mjs');
  releaseDirectory=absolute(releaseDirectory);separated(releaseDirectory,prepared.directory);separated(releaseDirectory,prepared.binding.datasetDirectory);
  await initializeSupersetVersions(directory);
  if(!await exists(releaseDirectory)){await privateDirectory(dirname(releaseDirectory),true);await native.initReleaseStore(releaseDirectory);}
  else await native.readReleaseState(releaseDirectory);
  let prior;try{prior=await native.inspectRelease(releaseDirectory,id);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(prior){
    if(identity(prior.dataset)!==identity(prepared.dataset)||prior.label!==label||
        identity(prior.runtime)!==identity(native.normalizeReleaseRuntime(runtime)))
      throw fault('SUPERSET_RELEASE_ID_CHANGED','The release ID retains different source, terms or runtime.',409);
    return{...prior,reused:true};
  }
  return{...await native.stageRelease(releaseDirectory,{id,label,datasetPackage:prepared.directory,runtime}),reused:false};
}
export async function activateSupersetRelease(directory,id,options){return(await import('../../sf82-seller-pilot/releases.mjs')).activateRelease(directory,id,options);}
export async function rollbackSupersetRelease(directory,options){return(await import('../../sf82-seller-pilot/releases.mjs')).rollbackRelease(directory,options);}
export async function runSupersetRelease(directory,options){return(await import('../../sf82-seller-pilot/releases.mjs')).runActiveRelease(directory,options);}
