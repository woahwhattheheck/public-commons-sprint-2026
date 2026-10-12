// MIT. OData editions use the existing dataset seller and SF82 release lifecycle.
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from '../dataset-refresh/versions.mjs';
import { DATASET_BINDING_SCHEMA, datasetContractSha256, prepareDatasetRelease } from '../../sf82-seller-pilot/release-dataset.mjs';
import { initReleaseStore, readReleaseState, stageRelease, releaseStatus, activateRelease, rollbackRelease, runActiveRelease } from '../../sf82-seller-pilot/releases.mjs';
import { digest, formatted, writeNew, identifier, fault } from './state.mjs';

export async function openODataPublisher({ workspace }) {
  const directory=join(workspace.directory,'publisher'),releases=join(directory,'releases');
  await mkdir(directory,{recursive:true,mode:0o700});
  try{await readReleaseState(releases);}catch(error){if(error.code!=='ENOENT')throw error;await initReleaseStore(releases);}
  async function prepare({exportId,releaseId,label,runtime={port:0}}){
    identifier(exportId);identifier(releaseId,'release ID');
    const record=(await workspace.state()).exports.find(value=>value.id===exportId);
    if(!record?.merchant)throw fault('ODATA_MERCHANT_EXPORT','Export this edition with public payment terms and origin first.');
    const sourceDirectory=join(workspace.directory,'exports',exportId),packageDirectory=join(directory,'packages',exportId);
    const datasetDirectory=join(directory,'datasets',exportId);
    await mkdir(packageDirectory,{recursive:true,mode:0o700});
    const dataset=await loadDatasetConfig(join(sourceDirectory,'dataset.json')),description=dataset.describe();
    const seller=JSON.parse(await readFile(join(sourceDirectory,'seller.json'),'utf8'));
    if(!seller.routes[0].definition.queryParameters.some(value=>value.name==='snapshot'))
      seller.routes[0].definition.queryParameters.push(DATASET_SNAPSHOT_PARAMETER);
    const source=await readFile(join(sourceDirectory,'source.json'));
    const binding={schema:DATASET_BINDING_SCHEMA,datasetDirectory,contractSha256:datasetContractSha256(description),
      baselineSnapshot:description.snapshot,sourceSha256:digest(source)};
    const files={'dataset.csv':await readFile(join(sourceDirectory,'dataset.csv')),'dataset.json':await readFile(join(sourceDirectory,'dataset.json')),
      'source.json':source,'seller.json':formatted(seller),'binding.json':formatted(binding)};
    for(const [name,body]of Object.entries(files)){
      try{await writeNew(join(packageDirectory,name),body);}catch(error){if(error.code!=='EEXIST')throw error;
        if(digest(await readFile(join(packageDirectory,name)))!==digest(body))throw fault('ODATA_PACKAGE_CHANGED','A retained merchant package differs.',409);}
    }
    const versions=await openDatasetVersions({directory:datasetDirectory,initialConfig:join(packageDirectory,'dataset.json')});
    try{if(versions.describe().snapshot!==description.snapshot)throw fault('ODATA_VERSION_CHANGED','The retained dataset version differs from this edition.',409);}finally{await versions.close();}
    const prepared=await prepareDatasetRelease(packageDirectory);
    const staged=await stageRelease(releases,{id:releaseId,label:label||description.name,datasetPackage:packageDirectory,runtime});
    return {exportId,releaseId,packageDirectory,datasetDirectory,dataset:prepared.description,staged};
  }
  return {directory,releases,prepare,status:()=>releaseStatus(releases),
    activate:({id,expectedGeneration,reason})=>activateRelease(releases,identifier(id),{expectedGeneration,reason}),
    rollback:({to,expectedGeneration,reason})=>rollbackRelease(releases,{to,expectedGeneration,reason}),
    run:options=>runActiveRelease(releases,options)};
}
