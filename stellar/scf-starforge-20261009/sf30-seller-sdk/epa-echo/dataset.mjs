// MIT. EPA projections compose the original SF30 dataset and original SF82/SF88 lifecycle.
import {join} from 'node:path';
import {privateDirectory,jsonBytes} from '../stellar-expert/store.mjs';
import {csvBytes} from '../stellar-expert/domain.mjs';
import {editionRows} from './domain.mjs';
import {text,hashBytes,fault} from './provider.mjs';
import {SOURCE_CONTRACT,COLUMNS} from './schema.mjs';
export {
  queryNativeDataset,nativePublishers,prepareNativeRelease,inspectNativeRelease,controlNativeRelease,
  inspectBuyer,receiveBuyer,readBuyerOutput
} from '../stellar-expert/dataset.mjs';

const MAX_BYTES=256*1024*1024,MAX_ROWS=250000;
const FILTERS={
  facilities:['facilityId','state','city','county','zip','programmes','facilityName'],
  permits:['facilityId','statute','epaSystem','sourceId','facilityStatus','universe','naics','sic'],
  compliance:['facilityId','statute','sourceId','currentSNC','description'],
  quarters:['facilityId','statute','sourceId','section','field','valueType','recordId'],
  inspections:['facilityId','statute','epaSystem','sourceId','section','type','agency','recordId'],
  enforcement:['facilityId','statute','epaSystem','sourceId','section','type','agency','caseNumber'],
  metadata:['facilityId','section','epaSystem','field','valueType'],
  'source-fields':['facilityId','statute','sourceId','section','field','valueType','sourcePath']
};
const DATES={
  facilities:[],permits:['expirationDateIso'],
  compliance:['currentAsOfIso','periodStartIso','periodEndIso','systemExtractDateIso'],
  quarters:['periodStartIso','periodEndIso'],
  inspections:['dateIso','periodStartIso','periodEndIso'],
  enforcement:['dateIso','periodStartIso','periodEndIso'],
  metadata:[],'source-fields':[]
};
const SORTS={
  facilities:['facilityId','facilityName','state','city'],
  permits:['expirationDateIso','facilityId','statute','epaSystem','sourceId'],
  compliance:['currentAsOfIso','periodStartIso','periodEndIso','facilityId','statute','sourceId'],
  quarters:['periodStartIso','periodEndIso','facilityId','sourceId','section','field'],
  inspections:['dateIso','facilityId','statute','sourceId','type'],
  enforcement:['dateIso','facilityId','statute','sourceId','caseNumber'],
  metadata:['facilityId','section','epaSystem','field'],
  'source-fields':['facilityId','statute','sourceId','section','sourcePath']
};
function selected(names,columns){return [...new Set(names)].filter(k=>columns.includes(k)).slice(0,8);}
function identifier(id){
  if(typeof id!=='string'||!/^dataset-[a-f0-9]{24}$/.test(id))
    throw fault('ECHO_DATASET_ID','Use the original retained dataset operation identity.',409);
  return id;
}
export async function prepareEchoDataset(store,{edition,table='facilities',name,id}) {
  name=text(name,'a dataset name',128);identifier(id);
  if(!Object.hasOwn(COLUMNS,table))throw fault('ECHO_TABLE','Choose a retained EPA table.');
  const directory=join(store.root,'datasets',id),packageDirectory=join(directory,'package');
  const projection=await editionRows(store,edition,{table,limit:MAX_ROWS});
  if(projection.total>MAX_ROWS||projection.rows.length!==projection.total)
    throw fault('ECHO_DATASET_CAPACITY','The complete selected table exceeds the original 250000-row dataset capacity. Its full original source remains retained.',413);
  const {columns,rows}=projection,csv=csvBytes(columns,rows);
  if(csv.length>MAX_BYTES)
    throw fault('ECHO_DATASET_CAPACITY','The complete selected CSV exceeds the original 256 MiB dataset capacity.',413);
  const config={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name,
    columns:Object.fromEntries(columns.map(k=>[k,'string'])),
    filters:selected(FILTERS[table]??[],columns),
    ranges:selected(DATES[table]??[],columns),
    sorts:selected(SORTS[table]??[],columns),
    maxBytes:MAX_BYTES,maxRows:MAX_ROWS,defaultLimit:50,maxLimit:200};
  await privateDirectory(packageDirectory,{create:true});
  await store.immutable(join(packageDirectory,'dataset.csv'),csv);
  const configBytes=jsonBytes(config);
  await store.immutable(join(packageDirectory,'dataset.json'),configBytes);
  await privateDirectory(join(packageDirectory,'provenance'),{create:true});
  const sourceFiles=[],saved=new Set();
  async function retain(path,bytes,expected){
    if(bytes.length>MAX_BYTES)throw fault('ECHO_SOURCE_CAPACITY','One retained source object exceeds the original file capacity.',413);
    const sha256=hashBytes(bytes);
    if(expected&&sha256!==expected)throw fault('ECHO_SOURCE_CHANGED','A source object changed while preparing the dataset.',409);
    if(saved.has(path))throw fault('ECHO_SOURCE_MANIFEST','A source filename is repeated in this dataset.',409);
    await store.immutable(join(packageDirectory,path),bytes);saved.add(path);
    const record={path,bytes:bytes.length,sha256};sourceFiles.push(record);return record;
  }
  for(const [i,page]of edition.pages.entries()){
    const bytes=await store.object(page.sha256);
    if(page.bytes!==undefined&&bytes.length!==page.bytes)
      throw fault('ECHO_SOURCE_CHANGED','The response length differs from its edition receipt.',409);
    const prefix='provenance/'+String(i).padStart(5,'0')+'-';
    await retain(prefix+page.sha256+'.json',bytes,page.sha256);
    if(page.responseSha256&&page.responseSha256!==page.sha256){
      const wire=await store.object(page.responseSha256);
      await retain(prefix+page.responseSha256+'.response',wire,page.responseSha256);
    }
  }
  let originalSourcePackage=null;
  if(edition.sourcePackageSha256)
    originalSourcePackage=await retain('provenance/original-source-package.json',
      await store.object(edition.sourcePackageSha256),edition.sourcePackageSha256);
  const editionFile=await retain('provenance/source-edition.json',jsonBytes(edition));
  const {pages,...editionMetadata}=edition;
  const source={schema:'stellar-forge.epa-echo-dataset-source.v1',provider:SOURCE_CONTRACT,
    edition:editionMetadata,editionFile,originalSourcePackage,table,selection:edition.selection,
    projection:{columns,
      identifiers:'Native FRS, statute, EPA system and source identifiers remain strings, including explicit empty values.',
      numbers:'Original numeric tokens and numeric strings remain exact text. No numeric ranges or numeric sorts are advertised for them.',
      dates:'Date literals remain in their original columns. Only separately validated Gregorian YYYY-MM-DD columns are exposed as chronological ranges and sorts; blank normalized dates stay blank.',
      values:'Source-fields and quarterly rows retain valueType with exact text, including explicit null and empty array/object values. Original complete response bytes remain in provenance.',
      repeatedRecords:'Every original row is preserved. No identifier is assumed unique across programme rows or reporting periods.',
      csv:'This machine dataset retains exact projected strings. The workspace review-CSV export separately neutralizes spreadsheet-leading formulas.',
      reviews:'Operator review notes are separate workspace records and never rewrite agency source values.'},
    sourceFiles};
  const sourceBytes=jsonBytes(source);
  await store.immutable(join(packageDirectory,'source.json'),sourceBytes);
  const {loadDatasetConfig}=await import('../dataset-handler.mjs');
  const dataset=await loadDatasetConfig(join(packageDirectory,'dataset.json')),description=dataset.describe();
  if(description.rowCount!==rows.length)
    throw fault('ECHO_DATASET_ROWS','The original dataset row count differs from the complete selected EPA table.',409);
  const receipt={id,editionId:edition.id,portfolioId:edition.portfolio?.id??edition.portfolioId??null,
    table,name,snapshot:description.snapshot,sourceSha256:edition.sourceSha256??edition.sourcePackageSha256,
    sourcePackageSha256:edition.sourcePackageSha256??null,createdAt:edition.createdAt,rows:description.rowCount,
    columns:description.columns,description,csvSha256:hashBytes(csv),sourceConfigSha256:hashBytes(configBytes),
    sourceManifestSha256:hashBytes(sourceBytes),versionState:null,relativeDirectory:'datasets/'+id,
    relativePublisherDirectory:'datasets/'+id+'/publisher',mode:'ORIGINAL_SF30_DATASET'};
  await store.immutable(join(directory,'dataset-receipt.json'),jsonBytes(receipt));return receipt;
}
