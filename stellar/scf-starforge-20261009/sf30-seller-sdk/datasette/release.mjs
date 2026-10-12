// MIT. The original published Datasette edition in the maintained SF82 release store.
import { mkdir,lstat,realpath,rename,rm } from 'node:fs/promises';
import { dirname,join,relative,sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { DATASET_SNAPSHOT_PARAMETER } from '../dataset-refresh/versions.mjs';
import { absolute,object,bytes,digest,identity,readPrivate,createFile,privateDirectory,syncDirectory,fault } from '../postgres/publisher/files.mjs';
import { readDatasetteEdition } from './editions.mjs';
import { datasetteMember } from './capture.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SOURCE_SCHEMA='stellar-forge.datasette-dataset-source.v1';
const MiB=1024*1024;
const same=(left,right)=>identity(left)===identity(right);
const parsed=content=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content));}catch{throw fault('DATASETTE_RELEASE_JSON_INVALID');}};
async function absent(path){try{await lstat(path);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
const descriptor=(path,raw)=>({path,bytes:raw.length,sha256:digest(raw)});
export async function prepareDatasetteRelease({publisher,runId,outputDirectory,payment,origin,path='/data'}={}) {
  if(!['stellar-forge.datasette-publisher-workspace.v1','stellar-forge.datasette-publisher-workspace.v2'].includes(publisher?.settings?.schema)||
      typeof publisher.candidate!=='function'||!UUID.test(runId??''))throw fault('DATASETTE_PUBLISHER_REQUIRED');
  const directory=absolute(publisher.directory),targetDirectory=absolute(publisher.settings.targetDirectory);
  outputDirectory=absolute(outputDirectory,'prepared release directory');
  await privateDirectory(directory);await privateDirectory(targetDirectory);
  for(const protectedPath of [directory,targetDirectory])for(const relation of [relative(outputDirectory,protectedPath),relative(protectedPath,outputDirectory)])
    if(!relation||relation!=='..'&&!relation.startsWith('..'+sep))throw fault('DATASETTE_RELEASE_LOCATION','Keep the prepared release outside the publisher and original dataset store.');
  const saved=publisher.run(runId),plan=publisher.plan(saved.plan),candidate=await publisher.candidate(runId),description=candidate.dataset.describe();
  if(saved.state!=='PUBLISHED'||saved.data.publication?.snapshot!==description.snapshot)throw fault('DATASETTE_EDITION_NOT_PUBLISHED','Publish this original candidate before preparing its merchant release.',409);
  if(!UUID.test(plan.folder??'')||plan.data.schema!=='stellar-forge.datasette-dataset-plan.v1'||identity(plan.data.sourceQuery)!==plan.data.queryHash)throw fault('DATASETTE_RELEASE_PLAN_CHANGED');
  const planBase='plans/'+plan.folder,runBase='runs/'+runId,editionPath=planBase+'/edition/edition.json';
  const edition=await readDatasetteEdition(join(directory,editionPath),{expectedSha256:plan.data.retainedEdition.sha256});
  if(edition.captureSha256!==plan.data.retainedEdition.captureSha256||edition.review.digest!==plan.data.retainedEdition.reviewDigest||
      candidate.manifest.extraction.editionSha256!==edition.editionSha256||
      candidate.manifest.extraction.captureSha256!==edition.captureSha256||
      candidate.manifest.extraction.reviewDigest!==edition.review.digest)throw fault('DATASETTE_RELEASE_SOURCE_CHANGED');
  const sourceFiles=[];
  for(const [name,maximum] of [[planBase+'/plan.json',8*MiB],[planBase+'/source.json',MiB],[planBase+'/original-source.json',MiB],
    [runBase+'/candidate.json',8*MiB],[runBase+'/dataset.json',MiB],[editionPath,16*MiB]])
    sourceFiles.push(descriptor(name,await readPrivate(join(directory,name),maximum)));
  const seen=new Set();
  for(const item of edition.edition.files){
    const name=datasetteMember(item.file);
    if(seen.has(name)||name==='edition.json')throw fault('DATASETTE_RELEASE_DUPLICATE_SOURCE_FILE');seen.add(name);
    const file=planBase+'/edition/'+name,raw=await readPrivate(join(directory,file),64*MiB);
    if(raw.length!==item.bytes||digest(raw)!==item.sha256)throw fault('DATASETTE_RELEASE_SOURCE_FILE_CHANGED');
    sourceFiles.push(descriptor(file,raw));
  }
  sourceFiles.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const nativeConfig=await readPrivate(candidate.configPath,MiB);
  if(digest(nativeConfig)!==candidate.manifest.configHash)throw fault('DATASETTE_RELEASE_CONFIG_CHANGED');
  const datasetConfig=bytes({...parsed(nativeConfig),file:'dataset.csv'});
  const seller=await buildDatasetSellerConfig(candidate.dataset,{payment,origin,path});
  seller.routes[0].definition.queryParameters.push(DATASET_SNAPSHOT_PARAMETER);
  const sellerBytes=bytes(seller);
  const source={schema:SOURCE_SCHEMA,sourceType:'Datasette',sourceSelection:edition.capture.selection,
    sourceVersion:edition.capture.sourceVersion??null,metadata:edition.capture.selection.metadata??null,
    consistency:edition.capture.consistency,
    edition:{path:editionPath,sha256:edition.editionSha256,name:edition.edition.name,
      reviewDigest:edition.review.digest,rowCount:edition.rows.length,pageCount:edition.pages.length},
    capture:{path:planBase+'/edition/'+edition.edition.captureFile,sha256:edition.captureSha256,
      selectionHash:edition.capture.selectionHash,columnSource:edition.capture.columnSource,
      columns:edition.columns,files:edition.capture.files.length},
    sourceReview:edition.review,
    plan:{id:plan.id,path:planBase+'/plan.json',digest:plan.data.digest,sourceHash:plan.data.sourceHash,queryHash:plan.data.queryHash},
    query:plan.data.query,sourceQuery:plan.data.sourceQuery,extraction:candidate.manifest.extraction,
    candidate:{run:runId,path:runBase+'/candidate.json',digest:candidate.manifest.candidateDigest,
      csvSha256:candidate.manifest.csvHash,csvBytes:candidate.manifest.csvBytes,snapshot:description.snapshot},
    review:saved.data.review,publication:saved.data.publication,sourceFiles};
  const sourceBytes=bytes(source);
  const {DATASET_BINDING_SCHEMA,DATASET_SOURCE_FILE_LIMITS,datasetContractSha256,prepareDatasetRelease,copyDatasetSourceFiles}
    =await import('../../sf82-seller-pilot/release-dataset.mjs');
  if(sourceBytes.length>DATASET_SOURCE_FILE_LIMITS.sourceBytes)throw fault('DATASETTE_RELEASE_SOURCE_LIMIT',undefined,413);
  const binding={schema:DATASET_BINDING_SCHEMA,datasetDirectory:targetDirectory,
    contractSha256:datasetContractSha256(description),baselineSnapshot:description.snapshot,sourceSha256:digest(sourceBytes)};
  const expected={'dataset.json':datasetConfig,'seller.json':sellerBytes,'source.json':sourceBytes,'binding.json':bytes(binding)};
  const reused=!await absent(outputDirectory);
  if(!reused){
    await mkdir(dirname(outputDirectory),{recursive:true,mode:0o700});
    if(await realpath(dirname(outputDirectory))!==dirname(outputDirectory))throw fault('DATASETTE_RELEASE_LOCATION');
    const temporary=outputDirectory+'.stage-'+randomUUID();await privateDirectory(temporary,true);
    try{
      await copyDatasetSourceFiles(directory,temporary,{sourceFiles:[...sourceFiles,
        {path:runBase+'/data.csv',bytes:candidate.manifest.csvBytes,sha256:candidate.manifest.csvHash}]});
      await rename(join(temporary,runBase,'data.csv'),join(temporary,'dataset.csv'));await syncDirectory(join(temporary,runBase));
      for(const [name,raw] of Object.entries(expected))await createFile(join(temporary,name),raw);
      await prepareDatasetRelease(temporary);await syncDirectory(temporary);
      if(!await absent(outputDirectory))throw fault('DATASETTE_RELEASE_EXISTS_CHANGED',undefined,409);
      await rename(temporary,outputDirectory);await syncDirectory(dirname(outputDirectory));
    }catch(e){await rm(temporary,{recursive:true,force:true});throw e;}
  }
  const prepared=await prepareDatasetRelease(outputDirectory);
  for(const [name,raw] of Object.entries(expected))if(!prepared.retained[name].equals(raw))throw fault('DATASETTE_RELEASE_EXISTS_CHANGED','This destination contains a different original edition or merchant.',409);
  if(prepared.dataset.csvSha256!==candidate.manifest.csvHash||prepared.description.snapshot!==description.snapshot||!same(prepared.sourceFiles,sourceFiles))throw fault('DATASETTE_RELEASE_EXISTS_CHANGED',undefined,409);
  return {schema:'stellar-forge.datasette-release-preparation.v1',directory:outputDirectory,runId,planId:plan.id,
    editionSha256:edition.editionSha256,captureSha256:edition.captureSha256,snapshot:description.snapshot,rowCount:description.rowCount,
    binding:prepared.binding,dataset:prepared.dataset,sourceFiles:prepared.sourceFiles,offers:prepared.offers,reused};
}
export async function stageDatasetteRelease({packageDirectory,releaseDirectory,id,label=id,runtime={port:0}}={}) {
  packageDirectory=absolute(packageDirectory,'prepared release package');releaseDirectory=absolute(releaseDirectory,'release store');
  const [{prepareDatasetRelease},{initReleaseStore,readReleaseState,inspectRelease,stageRelease,normalizeReleaseRuntime}]
    =await Promise.all([import('../../sf82-seller-pilot/release-dataset.mjs'),import('../../sf82-seller-pilot/releases.mjs')]);
  const prepared=await prepareDatasetRelease(packageDirectory);
  if(parsed(prepared.retained['source.json']).schema!==SOURCE_SCHEMA)throw fault('DATASETTE_RELEASE_SOURCE_REQUIRED');
  if(!object(runtime)||Object.keys(runtime).some(key=>!['port','facilitator','allowLocalFacilitator'].includes(key)))throw fault('DATASETTE_RELEASE_RUNTIME');
  const selectedRuntime=normalizeReleaseRuntime(runtime);
  if(await absent(releaseDirectory)){
    await mkdir(dirname(releaseDirectory),{recursive:true,mode:0o700});
    if(await realpath(dirname(releaseDirectory))!==dirname(releaseDirectory))throw fault('DATASETTE_RELEASE_LOCATION');
    await initReleaseStore(releaseDirectory);
  }else await readReleaseState(releaseDirectory);
  let previous;try{previous=await inspectRelease(releaseDirectory,id);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(previous){
    if(!same(previous.dataset,prepared.dataset)||previous.label!==label||!same(previous.runtime,selectedRuntime)||
      previous.publicOrigin!==prepared.service.publicOrigin||previous.source?.serviceConfigSha256!==digest(prepared.serviceBytes))throw fault('DATASETTE_RELEASE_ID_CHANGED',undefined,409);
    return {...previous,reused:true};
  }
  return {...await stageRelease(releaseDirectory,{id,label,datasetPackage:packageDirectory,runtime}),reused:false};
}
export async function activateDatasetteRelease(directory,id,options){return(await import('../../sf82-seller-pilot/releases.mjs')).activateRelease(directory,id,options);}
export async function rollbackDatasetteRelease(directory,options){return(await import('../../sf82-seller-pilot/releases.mjs')).rollbackRelease(directory,options);}
export async function runDatasetteRelease(directory,options){return(await import('../../sf82-seller-pilot/releases.mjs')).runActiveRelease(directory,options);}
