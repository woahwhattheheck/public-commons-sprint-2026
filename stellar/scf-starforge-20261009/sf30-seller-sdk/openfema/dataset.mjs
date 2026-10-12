// MIT. OpenFEMA portfolios use the maintained SF30 dataset, SF82 publisher and SF88/SF100 customer engines.
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {privateDirectory,jsonBytes} from '../stellar-expert/store.mjs';
import {datasetProjection,fault,string} from './domain.mjs';
export {queryNativeDataset,nativePublishers,prepareNativeRelease,inspectNativeRelease,controlNativeRelease,inspectBuyer,receiveBuyer,readBuyerOutput} from '../stellar-expert/dataset.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function preparePortfolioDataset(store,{edition,portfolio,portfolioVersion,table='projects',name,id}){
  name=string(name,'dataset name',128);
  if(!/^dataset-[a-f0-9]{24}$/.test(id))throw fault('OPENFEMA_DATASET_ID','Use the retained dataset operation.');
  const projection=datasetProjection(portfolio,table);
  if(projection.rows.length>1000000)throw fault('OPENFEMA_DATASET_SIZE','The original dataset supports one million rows. Save a narrower portfolio for publication.',413);
  const directory=join(store.root,'datasets',id),packageDirectory=join(directory,'package');
  await privateDirectory(directory,{create:true});await privateDirectory(packageDirectory,{create:true});await privateDirectory(join(packageDirectory,'provenance'),{create:true});
  const csv=Buffer.from(projection.csv,'utf8');
  if(csv.length>256*1024*1024)throw fault('OPENFEMA_DATASET_SIZE','The selected table exceeds the original dataset’s 256 MiB CSV capacity.',413);
  const config={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name,columns:projection.declaration,
    filters:projection.filters,ranges:projection.ranges,sorts:projection.sorts,
    maxBytes:256*1024*1024,maxRows:1000000,defaultLimit:50,maxLimit:250};
  await store.immutable(join(packageDirectory,'dataset.csv'),csv);
  await store.immutable(join(packageDirectory,'dataset.json'),jsonBytes(config));
  const sourceFiles=[],seen=new Set();
  async function save(path,bytes){
    if(seen.has(path))return;seen.add(path);await store.immutable(join(packageDirectory,path),bytes);
    sourceFiles.push({path,bytes:bytes.length,sha256:sha(bytes)});
  }
  await save('provenance/portfolio.json',jsonBytes(portfolio));
  await save('provenance/portfolio-version.json',jsonBytes(portfolioVersion));
  await save('provenance/source-edition.json',jsonBytes(edition));
  for(const [kind,dataset]of Object.entries(edition.datasets)){
    for(const field of ['metadataReceipt','metadataEndReceipt','fieldsReceipt']){
      const receipt=dataset[field];if(receipt?.sha256)await save('provenance/'+kind+'-'+field+'.json',await store.object(receipt.sha256));
    }
    for(const [index,page]of dataset.pages.entries())await save('provenance/'+kind+'-'+String(index).padStart(6,'0')+'-'+page.sha256+'.json',await store.object(page.sha256));
  }
  const source={schema:'stellar-forge.openfema-dataset-source.v1',provider:'FEMA OpenFEMA',editionId:edition.id,
    portfolioId:portfolioVersion.portfolioId,portfolioVersionId:portfolioVersion.id,table,scope:edition.scope,criteria:portfolio.criteria,
    datasets:Object.fromEntries(Object.entries(edition.datasets).map(([k,d])=>[k,{entity:d.entity,version:d.version,rowCount:d.rowCount,sourceCount:d.sourceCount,metadataReceipt:d.metadataReceipt,metadataEndReceipt:d.metadataEndReceipt,fieldsReceipt:d.fieldsReceipt}])),
    projection:projection.meaning,summary:portfolio.summary,methodology:portfolio.methodology,sourceFiles};
  const sourceBytes=jsonBytes(source);await store.immutable(join(packageDirectory,'source.json'),sourceBytes);
  const {loadDatasetConfig}=await import('../dataset-handler.mjs'),native=await loadDatasetConfig(join(packageDirectory,'dataset.json')),description=native.describe();
  const result={id,editionId:edition.id,portfolioId:portfolioVersion.portfolioId,portfolioVersionId:portfolioVersion.id,table,name,
    snapshot:description.snapshot,sourceSha256:edition.sourceSha256,createdAt:portfolioVersion.createdAt,rows:description.rowCount,
    columns:description.columns,description,csvSha256:sha(csv),sourceConfigSha256:sha(jsonBytes(config)),sourceManifestSha256:sha(sourceBytes),
    versionState:null,relativeDirectory:'datasets/'+id,relativePublisherDirectory:'datasets/'+id+'/publisher',mode:'ORIGINAL_SF30_DATASET'};
  await store.immutable(join(directory,'dataset-receipt.json'),jsonBytes(result));return result;
}
