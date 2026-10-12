// MIT. HUD prepared datasets join the ORIGINAL SF82 dataset release lifecycle.
import { join,dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstat,mkdir,rename,rm } from 'node:fs/promises';
import { bytes,digest,identity,readJson,readPrivate,createFile,privateDirectory,syncDirectory,fault } from '../postgres/publisher/files.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { datasetContractSha256,prepareDatasetRelease } from '../../sf82-seller-pilot/release-dataset.mjs';
import { initReleaseStore,stageRelease,readReleaseState,activateRelease,rollbackRelease,runActiveRelease,releaseStatus } from '../../sf82-seller-pilot/releases.mjs';
import { hudPublicationHandoff } from './delivery.mjs';
const exists=async path=>{try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
export async function prepareHudDatasetPackage(publisher,runId,directory,sellerConfig){
  const handoff=await hudPublicationHandoff(publisher,runId),candidate=await publisher.candidate(runId);
  const selected=handoff.source;
  const provenance={schema:'stellar-forge.hud-dataset-release-source.v1',
    release:selected.release,selection:selected.selection,selectionHash:selected.selectionHash,
    publication:handoff.publication,runId,candidateDigest:handoff.candidate.candidateDigest,
    snapshot:handoff.candidate.snapshot,receiver:handoff.receiver};
  const sourceBytes=bytes(provenance),sourceSha256=digest(sourceBytes);
  if(await exists(directory)){
    const prepared=await prepareDatasetRelease(directory);
    if(prepared.binding.sourceSha256!==sourceSha256||digest(await readPrivate(join(directory,'seller.json'),1048576))!==digest(bytes(sellerConfig)))
      throw fault('HUD_PREPARED_PACKAGE_CHANGED');
    return {directory,snapshot:prepared.description.snapshot,sourceSha256,prepared,reused:true};
  }
  // A stopped process can leave only an explicitly temporary, rebuildable
  // package; its complete retained publisher candidate remains the source.
  const pending=join(dirname(directory),'.prepare-'+randomUUID());let moved=false;
  await mkdir(pending,{mode:0o700});
  try{
    const original=await readJson(candidate.configPath,65536),config={...original,file:'dataset.csv'};
    const csv=await readPrivate(join(publisher.directory,'runs',runId,'data.csv'),candidate.manifest.csvBytes);
    if(digest(csv)!==candidate.manifest.csvHash)throw fault('HUD_PUBLICATION_CSV_CHANGED');
    await createFile(join(pending,'dataset.csv'),csv);await createFile(join(pending,'dataset.json'),bytes(config));
    await createFile(join(pending,'seller.json'),bytes(sellerConfig));await createFile(join(pending,'source.json'),sourceBytes);
    const dataset=await loadDatasetConfig(join(pending,'dataset.json')),description=dataset.describe();
    if(description.snapshot!==candidate.manifest.dataset.snapshot)throw fault('HUD_DATASET_SNAPSHOT_CHANGED');
    const binding={schema:'stellar-forge.dataset-release-binding.v1',datasetDirectory:publisher.settings.targetDirectory,
      contractSha256:datasetContractSha256(description),baselineSnapshot:description.snapshot,sourceSha256};
    await createFile(join(pending,'binding.json'),bytes(binding));await syncDirectory(pending);
    await prepareDatasetRelease(pending);
    await rename(pending,directory);moved=true;await syncDirectory(dirname(directory));
    const prepared=await prepareDatasetRelease(directory);
    return {directory,snapshot:description.snapshot,sourceSha256,prepared,reused:false};
  }finally{if(!moved)await rm(pending,{recursive:true,force:true});}
}
export async function openHudReleaseLifecycle({directory,publisher,sellerConfig}){
  const root=join(directory,'seller-releases'),packages=join(directory,'dataset-packages');
  await privateDirectory(packages,true);
  if(!await exists(root))await initReleaseStore(root);
  let running=null;
  return {
    root,status:()=>releaseStatus(root),
    async stage(runId,{id,label,runtime={port:0}}){
      if(typeof id!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))throw fault('HUD_SELLER_RELEASE_ID_INVALID');
      const p=await publisher(),config=await sellerConfig();
      const prepared=await prepareHudDatasetPackage(p,runId,join(packages,id),config);
      const staged=await stageRelease(root,{id,label:label??id,datasetPackage:prepared.directory,runtime});
      return {staged,package:prepared.directory,baselineSnapshot:prepared.snapshot};
    },
    activate:(id,options)=>activateRelease(root,id,options),
    rollback:options=>rollbackRelease(root,options),
    async start(input={}){
      if(running)throw fault('HUD_RELEASE_ALREADY_RUNNING');
      const state=await readReleaseState(root);
      running=await runActiveRelease(root,{expectedGeneration:input.expectedGeneration??state.generation,handleSignals:false});
      return {url:running.url,mode:running.mode,release:running.release,observation:running.observation};
    },
    async stop(){await running?.close();running=null;return releaseStatus(root);},
    async close(){await running?.close();running=null;}
  };
}
