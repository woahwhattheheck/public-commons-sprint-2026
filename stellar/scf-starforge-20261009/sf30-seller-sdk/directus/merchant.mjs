// MIT. Approved Directus editions through the original SF30/SF82 publisher.
import {join,resolve,dirname} from 'node:path';
import {rename,rm} from 'node:fs/promises';
import {loadDatasetConfig} from '../dataset-handler.mjs';
import {buildDatasetSellerConfig} from '../dataset-cli.mjs';
import {openDatasetVersions,DATASET_SNAPSHOT_PARAMETER} from '../dataset-refresh/versions.mjs';
import {datasetControl} from '../dataset-refresh/service.mjs';
import {DATASET_BINDING_SCHEMA,DATASET_SOURCE_FILE_LIMITS,datasetContractSha256,
  prepareDatasetRelease,stageDatasetRelease,inspectDatasetRelease,startDatasetRelease} from '../../sf82-seller-pilot/release-dataset.mjs';
import {WORKSPACE_SCHEMA} from './workspace.mjs';
import {absolute,object,bytes,digest,identity,readJson,privateDirectory,acquireWorkspace,
  fault,exists,separated,saveExact,copyExact,descriptor,syncDirectory,MiB} from '../dspace/merchant-files.mjs';

export const DIRECTUS_MERCHANT_SOURCE_SCHEMA='stellar-forge.directus-dataset-source.v1';
const HASH=/^[a-f0-9]{64}$/;
function exactReview(workspace,editionId,editionSha256,reviewId){
  if(!workspace||workspace.state?.().schema!==WORKSPACE_SCHEMA)
    throw fault('DIRECTUS_WORKSPACE_REQUIRED','Open the original Directus collection workspace.');
  const edition=workspace.read('editions',editionId,{limit:1}),review=workspace.read('reviews',reviewId);
  if(!HASH.test(editionSha256??'')||edition.sha256!==editionSha256||review.edition_id!==editionId||
      review.edition_sha256!==editionSha256||review.decision!=='approved')
    throw fault('DIRECTUS_APPROVED_EDITION_REQUIRED','Select the named approval of this exact repository edition.',409);
  return {edition,review};
}
function sourceBinding(prepared){
  return {schema:'stellar-forge.directus-version-binding.v1',workspace_id:prepared.source.workspace_id,
    mode:prepared.source.mode,contract_sha256:prepared.binding.contractSha256,
    seller_sha256:digest(prepared.retained['seller.json'])};
}
async function checkVersionBinding(prepared,{create=false}={}){
  const directory=prepared.binding.datasetDirectory,file=join(directory,'directus-source-binding.json');
  if(create)await saveExact(file,sourceBinding(prepared));
  else if(identity(await readJson(file))!==identity(sourceBinding(prepared)))
    throw fault('DIRECTUS_VERSION_BINDING_CHANGED','Use the original repository project, field contract, route and payment terms.',409);
}
function publicResult(prepared){
  return {schema:'stellar-forge.directus-merchant-preparation.v1',directory:prepared.directory,
    workspace_id:prepared.source.workspace_id,edition:prepared.source.edition,review:prepared.source.review,
    snapshot:prepared.description.snapshot,row_count:prepared.description.rowCount,
    resource:prepared.service.publicOrigin+prepared.service.routes[0].path,
    binding:prepared.binding,dataset:prepared.dataset,sourceFiles:prepared.sourceFiles,offers:prepared.offers};
}

/** Preserve the exact approved source closure beside the native five-file package.
 * Repeating preparation at the same path fills only identical original files. */
export async function prepareDirectusMerchant({workspace,editionId,editionSha256,reviewId,
  directory,versionDirectory,payment,origin,path='/directus-data'}={}){
  const {edition,review}=exactReview(workspace,editionId,editionSha256,reviewId);
  directory=absolute(directory,'prepared package directory');
  versionDirectory=absolute(versionDirectory,'original dataset version directory');
  separated(directory,workspace.directory);separated(directory,versionDirectory);separated(versionDirectory,workspace.directory);
  await privateDirectory(directory,true);
  const release=await acquireWorkspace(directory);
  try{
    const intent={schema:'stellar-forge.directus-merchant-intent.v1',workspace_id:workspace.state().id,
      editionId,editionSha256,reviewId,versionDirectory,payment,origin,path};
    await saveExact(join(directory,'directus-merchant-intent.json'),intent);
    const projectionDirectory=join(directory,'directus');
    const exported=await workspace.exportDataset(editionId,projectionDirectory);
    if(exported.snapshot!==edition.snapshot||exported.edition.sha256!==editionSha256||exported.lineage.review?.id!==reviewId)
      throw fault('DIRECTUS_EDITION_CHANGED','The exported source differs from the reviewed edition.',409);
    const native=await loadDatasetConfig(exported.datasetPath),description=native.describe();
    if(description.snapshot!==edition.snapshot)throw fault('DIRECTUS_SNAPSHOT_CHANGED','The original dataset engine returned another snapshot.',409);
    const sourceFiles=[];
    for(const name of ['data.csv','dataset.json','directus-lineage.json'])
      sourceFiles.push(await descriptor(directory,'directus/'+name));
    const sourceRecords=[];
    for(const sourceId of edition.source_ids){
      const source=workspace.read('sources',sourceId,{limit:1});
      const file=await workspace.exportFile('source',sourceId);
      if(file.sha256!==source.sha256||file.bytes!==source.bytes)
        throw fault('DIRECTUS_SOURCE_CHANGED','An original capture differs from its retained source identity.',409);
      const name='directus/sources/'+sourceId+'.json';
      await copyExact(file.path,join(directory,name),file);
      sourceFiles.push({path:name,bytes:file.bytes,sha256:file.sha256});
      sourceRecords.push({id:sourceId,sha256:source.sha256,bytes:source.bytes,path:name,
        name:source.name,base_url:source.base_url,scope:source.scope});
    }
    for(const [kind,id,name] of [['editions',editionId,'directus/edition.json'],['reviews',reviewId,'directus/review.json']]){
      const file=await workspace.exportFile(kind,id);
      await copyExact(file.path,join(directory,name),file);sourceFiles.push({path:name,bytes:file.bytes,sha256:file.sha256});
    }
    const nativeHistory=[];
    for(const ref of edition.native_event_refs??[]){
      const record=workspace.read('native-events',ref.id);
      if(record.sha256!==ref.sha256)throw fault('DIRECTUS_NATIVE_HISTORY_CHANGED','The selected native history differs from its immutable edition.',409);
      const file=await workspace.exportFile('native-events',ref.id),name='directus/native-events/'+ref.id+'.json';
      await copyExact(file.path,join(directory,name),file);sourceFiles.push({path:name,bytes:file.bytes,sha256:file.sha256});
      nativeHistory.push({...ref,path:name});
    }
    sourceFiles.sort((a,b)=>a.path.localeCompare(b.path));
    const config=await readJson(exported.datasetPath,65536);
    const seller=await buildDatasetSellerConfig(native,{payment,origin,path});
    if(seller.routes[0].definition.queryParameters.length>=32)
      throw fault('DIRECTUS_QUERY_BUDGET','Retain a query-parameter slot for the original edition selector.');
    seller.routes[0].definition.queryParameters.push({...DATASET_SNAPSHOT_PARAMETER});
    const source={schema:DIRECTUS_MERCHANT_SOURCE_SCHEMA,sourceType:'Reviewed Directus collection data',
      workspace_id:workspace.state().id,mode:edition.mode,edition:exported.edition,review,
      rights:exported.lineage.rights,sources:sourceRecords,lineage:'directus/directus-lineage.json',
      original_edition:'directus/edition.json',original_review:'directus/review.json',
      native_operation_ids:edition.native_operation_ids??[],native_history:nativeHistory,sourceFiles};
    const sourceBytes=bytes(source);
    if(sourceBytes.length>DATASET_SOURCE_FILE_LIMITS.sourceBytes)
      throw fault('DIRECTUS_SOURCE_INDEX_LIMIT','The complete source index exceeds the original release limit.',413);
    const binding={schema:DATASET_BINDING_SCHEMA,datasetDirectory:versionDirectory,
      contractSha256:datasetContractSha256(description),baselineSnapshot:description.snapshot,
      sourceSha256:digest(sourceBytes)};
    await copyExact(join(projectionDirectory,'data.csv'),join(directory,'dataset.csv'),exported.lineage.files['data.csv'],{maximum:256*MiB});
    await saveExact(join(directory,'dataset.json'),{...config,file:'dataset.csv'});
    await saveExact(join(directory,'seller.json'),seller);
    await saveExact(join(directory,'source.json'),sourceBytes);
    await saveExact(join(directory,'binding.json'),binding);
    return publicResult(await readDirectusMerchant(directory));
  }finally{await release();}
}

export async function readDirectusMerchant(directory){
  const prepared=await prepareDatasetRelease(absolute(directory,'prepared package directory'));
  const source=JSON.parse(prepared.retained['source.json'].toString('utf8'));
  if(source.schema!==DIRECTUS_MERCHANT_SOURCE_SCHEMA||source.edition?.snapshot!==prepared.description.snapshot||
      source.review?.edition_id!==source.edition?.id||source.review?.edition_sha256!==source.edition?.sha256||
      source.review?.decision!=='approved'||!Array.isArray(source.sources)||!source.sources.length)
    throw fault('DIRECTUS_MERCHANT_SOURCE','Select a complete original approved Directus collection package.');
  const lineage=await readJson(join(prepared.directory,source.lineage),16*MiB);
  const edition=await readJson(join(prepared.directory,source.original_edition),256*MiB);
  const review=await readJson(join(prepared.directory,source.original_review),MiB);
  if(lineage.schema!=='stellar-forge.directus-lineage.v1'||lineage.snapshot!==prepared.description.snapshot||
      lineage.edition.sha256!==edition.sha256||edition.sha256!==source.edition.sha256||
      identity(review)!==identity(source.review)||lineage.review?.id!==review.id||edition.csv_sha256!==prepared.dataset.csvSha256||
      identity(lineage.rights)!==identity(source.rights))
    throw fault('DIRECTUS_MERCHANT_SOURCE_CHANGED','The original edition, approval and data differ from this merchant package.',409);
  const unsigned={...edition};delete unsigned.sha256;
  if(identity(unsigned)!==edition.sha256)
    throw fault('DIRECTUS_MERCHANT_EDITION_CHANGED','The immutable edition differs from its original field review.',409);
  for(const entry of source.sources)
    if(!prepared.sourceFiles.some(file=>file.path===entry.path&&file.sha256===entry.sha256&&file.bytes===entry.bytes))
      throw fault('DIRECTUS_MERCHANT_SOURCE_CHANGED','A native source capture is absent from the original release closure.',409);
  return {...prepared,source,lineage,edition,review};
}

export async function initializeDirectusVersions(directory,{retentionMs=3600000,maxVersions=4,maxRetainedBytes=268435456}={}){
  const prepared=await readDirectusMerchant(directory),root=prepared.binding.datasetDirectory;
  const initialized=await exists(join(root,'state.json'));
  const bound=initialized&&await exists(join(root,'directus-source-binding.json'));
  if(bound)await checkVersionBinding(prepared);
  const versions=await openDatasetVersions({directory:root,...(!initialized?{
    initialConfig:join(prepared.directory,'dataset.json'),retentionMs,maxVersions,maxRetainedBytes}: {})});
  try{
    if(datasetContractSha256(versions.describe())!==prepared.binding.contractSha256)
      throw fault('DIRECTUS_VERSION_CONTRACT_CHANGED','The existing original store has a different dataset field contract.',409);
    if(!bound&&versions.status().current!==prepared.description.snapshot)
      throw fault('DIRECTUS_VERSION_SOURCE_CHANGED','The first native dataset snapshot differs from this edition.',409);
    await checkVersionBinding(prepared,{create:!bound});
    return versions.status();
  }finally{await versions.close();}
}

/** The original SF82 installed release is the serving entrypoint. */
export async function startDirectusMerchant({directory,stageDirectory,runtime={port:0},nativeFactory}={}){
  const prepared=await readDirectusMerchant(directory);
  stageDirectory=absolute(stageDirectory,'native staged release directory');
  separated(stageDirectory,prepared.directory);separated(stageDirectory,prepared.binding.datasetDirectory);
  await initializeDirectusVersions(directory);
  let staged;
  if(await exists(join(stageDirectory,'manifest.json')))staged=await inspectDatasetRelease(stageDirectory);
  else{
    const receiving=stageDirectory+'.directus-receiving';
    await privateDirectory(receiving,true);const unlock=await acquireWorkspace(receiving);
    try{
      await saveExact(join(receiving,'intent.json'),{schema:'stellar-forge.directus-stage-intent.v1',
        destination:stageDirectory,dataset:prepared.dataset});
      if(await exists(join(stageDirectory,'manifest.json')))staged=await inspectDatasetRelease(stageDirectory);
      else{
        if(await exists(stageDirectory))throw fault('DIRECTUS_STAGE_EXISTS','Select the original complete native stage or a new destination.',409);
        const ready=join(receiving,'release');
        if(!await exists(join(ready,'manifest.json'))){
          // This derived stage is owned by the exact retained intent and held lease.
          // Native source and the approved package remain intact across a killed copy.
          if(await exists(ready))await rm(ready,{recursive:true});
          await stageDatasetRelease(ready,prepared.directory);
        }
        const selected=await inspectDatasetRelease(ready);
        if(identity(selected.dataset)!==identity(prepared.dataset))
          throw fault('DIRECTUS_STAGED_EDITION_CHANGED','The retained stage belongs to another source.',409);
        await rename(ready,stageDirectory);await syncDirectory(dirname(stageDirectory));staged=selected;
      }
    }finally{await unlock();}
  }
  if(identity(staged.dataset)!==identity(prepared.dataset))
    throw fault('DIRECTUS_STAGED_EDITION_CHANGED','This native stage belongs to another retained repository edition.',409);
  const service=await startDatasetRelease(stageDirectory,{runtime,nativeFactory});
  return {...service,edition:prepared.source.edition,review:prepared.source.review,source:prepared.source,
    packageDirectory:prepared.directory,stageDirectory};
}

/** Refresh the original running writer with its exact current generation. */
export async function publishDirectusMerchant({directory,expectedSnapshot,expectedRevision}={}){
  const prepared=await readDirectusMerchant(directory);await checkVersionBinding(prepared);
  if(!HASH.test(expectedSnapshot??'')||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
    throw fault('DIRECTUS_PUBLICATION_REVIEW','Supply the original current snapshot and revision.');
  const current=await datasetControl(prepared.binding.datasetDirectory,'status');
  if(current.current===prepared.description.snapshot)
    return {schema:'stellar-forge.directus-publication-result.v1',snapshot:current.current,
      edition_id:prepared.source.edition.id,status:'ALREADY_CURRENT',native:current};
  const result=await datasetControl(prepared.binding.datasetDirectory,'refresh',{
    configPath:join(prepared.directory,'dataset.json'),expectedSnapshot,expectedRevision});
  if(result.current!==prepared.description.snapshot)
    throw fault('DIRECTUS_PUBLICATION_CHANGED','Inspect the original writer; its selected snapshot differs.',409);
  return {schema:'stellar-forge.directus-publication-result.v1',snapshot:result.current,
    edition_id:prepared.source.edition.id,status:'PUBLISHED',native:result};
}

/** Original SF82 supervised activation, rollback and restart remain available. */
export async function stageDirectusRelease({directory,releaseDirectory,id,label=id,runtime={port:0}}={}){
  const prepared=await readDirectusMerchant(directory);
  releaseDirectory=absolute(releaseDirectory,'release store directory');
  separated(releaseDirectory,prepared.directory);separated(releaseDirectory,prepared.binding.datasetDirectory);
  if(!object(runtime)||Object.keys(runtime).some(key=>!['port','facilitator','allowLocalFacilitator'].includes(key)))
    throw fault('DIRECTUS_RELEASE_RUNTIME','Use the original dataset seller runtime options.');
  const native=await import('../../sf82-seller-pilot/releases.mjs');
  const selectedRuntime=native.normalizeReleaseRuntime(runtime);
  await initializeDirectusVersions(directory);
  if(!await exists(releaseDirectory)){
    await privateDirectory(dirname(releaseDirectory),true);await native.initReleaseStore(releaseDirectory);
  }else await native.readReleaseState(releaseDirectory);
  let previous;try{previous=await native.inspectRelease(releaseDirectory,id);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(previous){
    if(identity(previous.dataset)!==identity(prepared.dataset)||previous.label!==label||
        identity(previous.runtime)!==identity(selectedRuntime)||
        previous.source?.serviceConfigSha256!==digest(prepared.serviceBytes))
      throw fault('DIRECTUS_RELEASE_ID_CHANGED','This release ID belongs to different source, terms or runtime.',409);
    return {...previous,reused:true};
  }
  return {...await native.stageRelease(releaseDirectory,{id,label,datasetPackage:prepared.directory,runtime:selectedRuntime}),reused:false};
}
export async function activateDirectusRelease(directory,id,options){return(await import('../../sf82-seller-pilot/releases.mjs')).activateRelease(directory,id,options);}
export async function rollbackDirectusRelease(directory,options){return(await import('../../sf82-seller-pilot/releases.mjs')).rollbackRelease(directory,options);}
export async function runDirectusRelease(directory,options){return(await import('../../sf82-seller-pilot/releases.mjs')).runActiveRelease(directory,options);}
