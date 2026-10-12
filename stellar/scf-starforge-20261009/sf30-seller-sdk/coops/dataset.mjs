// MIT. Coastal projections use the original SF30 dataset and original publisher.
import {join} from 'node:path';
import {privateDirectory,jsonBytes} from '../stellar-expert/store.mjs';
import {csvBytes} from '../stellar-expert/domain.mjs';
import {editionRows} from './domain.mjs';
import {text,hashBytes,fault} from './provider.mjs';
import {SOURCE_CONTRACT} from './schema.mjs';
export {
  queryNativeDataset,nativePublishers,prepareNativeRelease,inspectNativeRelease,controlNativeRelease,
  inspectBuyer,receiveBuyer,readBuyerOutput
} from '../stellar-expert/dataset.mjs';
export async function prepareCoastalDataset(store,{edition,table,name,beginDate,endDate,products,id}){
  name=text(name,'a dataset name',128);
  const directory=join(store.root,'datasets',id),packageDirectory=join(directory,'package');
  await privateDirectory(packageDirectory,{create:true});
  const {columns,rows,total}=await editionRows(store,edition,{table,limit:250000,beginDate,endDate,products});
  if(total>250000)throw fault('COOPS_DATASET_CAPACITY','This complete coastal table exceeds the original dataset’s 250000-row capacity. Choose another edition or table; the complete source remains retained.',413);
  const csv=csvBytes(columns,rows);
  if(csv.length>256*1024*1024)throw fault('COOPS_DATASET_CAPACITY','The complete projected CSV exceeds the original 256 MiB dataset capacity.',413);
  const config={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name,
    columns:Object.fromEntries(columns.map(k=>[k,'string'])),
    filters:['profileId','table','product','field','stationId','quality','datum','timeZone','recordId','unit'],
    ranges:['timestampUtc'],sorts:['timestampUtc','product','field','stationId'],
    maxBytes:256*1024*1024,maxRows:250000,defaultLimit:50,maxLimit:200};
  await store.immutable(join(packageDirectory,'dataset.csv'),csv);
  await store.immutable(join(packageDirectory,'dataset.json'),jsonBytes(config));
  await privateDirectory(join(packageDirectory,'provenance'),{create:true});
  const sourceFiles=[];
  for(let i=0;i<(edition.pages.length+(edition.failedResponses?.length??0));i++){
    const page=[...edition.pages,...(edition.failedResponses??[])][i],path='provenance/'+String(i).padStart(5,'0')+'-'+page.sha256+'.json',
      bytes=await store.object(page.sha256);
    await store.immutable(join(packageDirectory,path),bytes);sourceFiles.push({path,bytes:bytes.length,sha256:page.sha256});
    if(page.responseSha256&&page.responseSha256!==page.sha256){
      const wire=await store.object(page.responseSha256),wirePath='provenance/'+String(i).padStart(5,'0')+'-'+page.responseSha256+'.response';
      await store.immutable(join(packageDirectory,wirePath),wire);sourceFiles.push({path:wirePath,bytes:wire.length,sha256:page.responseSha256});
    }
  }
  if(edition.sourcePackageSha256){
    const original=await store.object(edition.sourcePackageSha256),path='provenance/original-capture-package.json';
    await store.immutable(join(packageDirectory,path),original);sourceFiles.push({path,bytes:original.length,sha256:edition.sourcePackageSha256});
  }
  const editionBytes=jsonBytes(edition),editionPath='provenance/source-edition.json';
  await store.immutable(join(packageDirectory,editionPath),editionBytes);
  const editionFile={path:editionPath,bytes:editionBytes.length,sha256:hashBytes(editionBytes)};sourceFiles.push(editionFile);
  const {pages,failedResponses,...editionMetadata}=edition;
  const source={schema:'stellar-forge.coops-dataset-source.v1',provider:SOURCE_CONTRACT,edition:editionMetadata,editionFile,table,selection:{beginDate:beginDate??edition.query.beginDate,endDate:endDate??edition.query.endDate,products:products??edition.query.products},
    projection:{columns,values:'Original provider values are represented as strings with separate valueType, unit, quality and native flag meanings. Source null, an empty string and an absent field remain distinct; no numerical or datum conversion is performed.',
      intervals:'Original NOAA timestamps and the explicit request time basis remain attached. Only GMT timestamps receive a UTC projection. Local-standard and local-daylight timestamps are never silently assigned a UTC offset.',
      scope:'Only records inside the declared inclusive source dates are projected; prediction and observation tables remain separate. Every accepted response and retained failed attempt remains in provenance.'},
    sourceFiles};
  const sourceBytes=jsonBytes(source);await store.immutable(join(packageDirectory,'source.json'),sourceBytes);
  const {loadDatasetConfig}=await import('../dataset-handler.mjs'),dataset=await loadDatasetConfig(join(packageDirectory,'dataset.json')),description=dataset.describe();
  const receipt={id,editionId:edition.id,profileId:edition.profile.id,table,name,selection:{beginDate:beginDate??edition.query.beginDate,endDate:endDate??edition.query.endDate,products:products??edition.query.products},snapshot:description.snapshot,
    sourceSha256:edition.sourceSha256,createdAt:edition.createdAt,rows:description.rowCount,
    columns:description.columns,description,csvSha256:hashBytes(csv),sourceConfigSha256:hashBytes(jsonBytes(config)),
    sourceManifestSha256:hashBytes(sourceBytes),versionState:null,relativeDirectory:'datasets/'+id,
    relativePublisherDirectory:'datasets/'+id+'/publisher',mode:'ORIGINAL_SF30_DATASET'};
  await store.immutable(join(directory,'dataset-receipt.json'),jsonBytes(receipt));return receipt;
}
