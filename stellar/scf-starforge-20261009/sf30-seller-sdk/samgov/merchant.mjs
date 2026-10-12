// MIT. SAM selections use the original CSV dataset, version publisher and SF88 buyer.
import { lstat } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { privateDirectory,writeBytes,writeJson,readBytes,readJson,jsonBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { COLUMNS,MAX_SOURCE_BYTES,MAX_PACKET_BYTES,SOURCE_BASIS,sha,canonical,copy,
  plain,text,integer,identifier,requireThat,SamError,now,csv,noticeDatasetRow } from './core.mjs';

const SCHEMA='stellar-forge.samgov-merchant.v1';
const FILES=['intent.json','notices.csv','dataset.json','source-manifest.json','seller.json'];
async function put(path,bytes){
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;
    requireThat((await readBytes(path,MAX_PACKET_BYTES)).equals(bytes),'MERCHANT_FILE_CHANGED',
      'An original immutable merchant preparation has different source bytes.',409);}
}
function queryText(value={}){
  if(typeof value==='string'){text(value,'Dataset query',8192,true);return value.replace(/^\?/,'');}
  requireThat(plain(value),'DATASET_QUERY_INVALID');
  const parameters=new URLSearchParams();
  for(const [name,item] of Object.entries(value)){
    requireThat(typeof item==='string' || typeof item==='number' && Number.isFinite(item),'DATASET_QUERY_INVALID',
      'Dataset query values must be scalar strings or numbers.');
    parameters.append(name,String(item));
  }
  const encoded=parameters.toString();text(encoded,'Dataset query',8192,true);return encoded;
}
export async function prepareSamMerchant({
  directory,publicationId,workspaceId,sourceRevision,selection,edition,rows,sources=[],capture=null,
  payment,origin,path='/procurement-notices',defaultLimit=50,maxLimit=100,
}={}){
  identifier(publicationId,'Publication ID');identifier(workspaceId,'Workspace ID');
  integer(sourceRevision,'Source revision',1,Number.MAX_SAFE_INTEGER);
  requireThat(plain(selection) && plain(edition) && selection.editionId===edition.id &&
    Array.isArray(rows) && rows.length>0 && rows.length<=1000000 &&
    rows.length===selection.noticeIds.length,'MERCHANT_SELECTION_REQUIRED',
    'Select one to one million original notices for the maintained CSV dataset.');
  integer(defaultLimit,'Default dataset page',1,1000);integer(maxLimit,'Maximum dataset page',defaultLimit,1000);
  requireThat((payment===undefined)===(origin===undefined),'PAYMENT_AND_ORIGIN_TOGETHER',
    'Supply original public payment terms and the public resource origin together.');
  const wanted=new Set(selection.noticeIds);
  requireThat(new Set(rows.map(row=>row.noticeId)).size===rows.length &&
    rows.every(row=>wanted.has(row.noticeId)),'MERCHANT_SELECTION_CHANGED');
  const input={publicationId,workspaceId,sourceRevision,selection,edition,
    rowsSha256:sha(rows),sources,capture,payment:payment??null,origin:origin??null,path,defaultLimit,maxLimit},
    inputSha256=sha(input);
  directory=await privateDirectory(resolve(text(directory,'Merchant directory',4000)));
  let intent;
  try{
    intent=await readJson(join(directory,'intent.json'),65536);
    requireThat(intent.schema==='stellar-forge.samgov-merchant-intent.v1' &&
      intent.inputSha256===inputSha256 && intent.publicationId===publicationId,'MERCHANT_INTENT_CHANGED');
  }catch(error){if(error.code!=='ENOENT')throw error;
    intent={schema:'stellar-forge.samgov-merchant-intent.v1',publicationId,inputSha256,createdAt:now()};
    await put(join(directory,'intent.json'),jsonBytes(intent));
  }
  const data=Buffer.from(csv(rows.map(row=>noticeDatasetRow(row,edition.id))),'utf8');
  requireThat(data.length<=MAX_SOURCE_BYTES,'MERCHANT_DATASET_CAPACITY',
    'Narrow this selected edition to fit the original 64 MiB dataset publication capacity.',413);
  const name=selection.name.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,128).trim();
  requireThat(name,'MERCHANT_NAME_REQUIRED');
  const config={schema:'stellar-forge.csv-dataset.v1',file:'notices.csv',name,
    columns:Object.fromEntries(COLUMNS.map(column=>[column,{type:'string',
      nullable:!['notice_id','source_url','notice_sha256','source_sha256','observed_at','edition_id'].includes(column)}])),
    filters:['notice_id','solicitation_number','organization_code','notice_type','active','naics','classification','set_aside'],
    ranges:['posted_date','archive_date'],sorts:['notice_id','title','posted_date','solicitation_number'],
    defaultLimit,maxLimit,maxRows:Math.max(1,rows.length),maxBytes:MAX_SOURCE_BYTES,maxCellChars:1024*1024};
  await put(join(directory,'notices.csv'),data);
  await put(join(directory,'dataset.json'),jsonBytes(config));
  const {loadDatasetConfig}=await import('../dataset-handler.mjs');
  const dataset=await loadDatasetConfig(join(directory,'dataset.json')),description=dataset.describe();
  const provenance={schema:'stellar-forge.samgov-merchant-source.v1',workspaceId,sourceRevision,
    selection:copy(selection),edition:copy(edition),noticeIds:rows.map(row=>row.noticeId),
    sourceBasis:edition.sourceBasis??SOURCE_BASIS,capture:copy(capture),sources:copy(sources),
    createdAt:intent.createdAt,columns:COLUMNS,sourceRowsSha256:sha(rows),
    numericRepresentation:'Original source number lexemes and deadlines remain strings.',
    queryMeaning:'String ranges use original dataset lexical ordering; raw response deadlines retain their source time-zone status.'};
  await put(join(directory,'source-manifest.json'),jsonBytes(provenance));
  let seller=null;
  if(payment!==undefined){
    const [{buildDatasetSellerConfig},{DATASET_SNAPSHOT_PARAMETER}]=await Promise.all([
      import('../dataset-cli.mjs'),import('../dataset-refresh/versions.mjs')]);
    seller=await buildDatasetSellerConfig(dataset,{payment,origin,path});
    for(const route of seller.routes)if(route.handler==='queryDataset'){
      requireThat(route.definition.queryParameters.length<32,'DATASET_QUERY_CAPACITY');
      route.definition.queryParameters.push(copy(DATASET_SNAPSHOT_PARAMETER));
    }
    await put(join(directory,'seller.json'),jsonBytes(seller));
  }
  const files=[];
  for(const filename of FILES){
    if(filename==='seller.json' && !seller)continue;
    const bytes=await readBytes(join(directory,filename),MAX_PACKET_BYTES);
    files.push({path:filename,sha256:sha(bytes),bytes:bytes.length,absolutePath:join(directory,filename)});
  }
  const bundle={schema:SCHEMA,id:publicationId,workspaceId,sourceRevision,inputSha256,createdAt:intent.createdAt,
    selectionId:selection.id,selectionRevision:selection.revision,editionId:edition.id,
    sourceEditionSha256:edition.sha256,sourceRowsSha256:sha(rows),dataset:description,
    sourceBasis:edition.sourceBasis??SOURCE_BASIS,complete:edition.complete,
    files:Object.fromEntries(files.map(file=>[file.path,{sha256:file.sha256,bytes:file.bytes}])),
    seller:seller?{origin:seller.publicOrigin,path,resource:seller.publicOrigin+path,config:'seller.json'}:null,
    publisher:{kind:'original_dataset_versions',directory:'runtime/versions',snapshotSelection:true},
    publicationKind:seller?'configured_merchant':'retained_dataset'};
  await put(join(directory,'bundle.json'),jsonBytes(bundle));
  const bundleBytes=await readBytes(join(directory,'bundle.json'),MAX_PACKET_BYTES);
  files.push({path:'bundle.json',sha256:sha(bundleBytes),bytes:bundleBytes.length,absolutePath:join(directory,'bundle.json')});
  return {directory,bundle,files,launch:{module:'sf30-seller-sdk/samgov/merchant.mjs',
    function:'serveSamMerchant',publicationId,relativeDirectory:'merchant/'+publicationId,
    dataset:'dataset.json',seller:seller?'seller.json':null}};
}
export async function loadSamMerchant(directory){
  directory=await privateDirectory(resolve(text(directory,'Merchant directory',4000)),{create:false});
  const bundle=await readJson(join(directory,'bundle.json'),2*1024*1024);
  requireThat(bundle.schema===SCHEMA && plain(bundle.files) && /^[a-f0-9]{64}$/.test(bundle.dataset?.snapshot??''),
    'MERCHANT_BUNDLE_INVALID');
  requireThat(Object.keys(bundle.files).every(name=>FILES.includes(name)) &&
    ['intent.json','notices.csv','dataset.json','source-manifest.json'].every(name=>Object.hasOwn(bundle.files,name)),
    'MERCHANT_FILE_SET_CHANGED');
  for(const [filename,expected] of Object.entries(bundle.files)){
    const bytes=await readBytes(join(directory,filename),MAX_PACKET_BYTES);
    requireThat(bytes.length===expected.bytes && sha(bytes)===expected.sha256,'MERCHANT_FILE_CHANGED',
      'The selected original merchant file differs from its retained publication.',409);
  }
  const config=await readJson(join(directory,'dataset.json'),65536);
  requireThat(config.file==='notices.csv','MERCHANT_SOURCE_PATH_CHANGED');
  const {loadDatasetConfig}=await import('../dataset-handler.mjs');
  const dataset=await loadDatasetConfig(join(directory,'dataset.json'));
  requireThat(dataset.describe().snapshot===bundle.dataset.snapshot &&
    canonical(dataset.describe())===canonical(bundle.dataset),'MERCHANT_SNAPSHOT_CHANGED');
  if(bundle.seller)requireThat(Object.hasOwn(bundle.files,'seller.json'),'MERCHANT_SELLER_MISSING');
  return {directory,bundle,dataset};
}
export async function previewSamMerchant(directory,query={}){
  const merchant=await loadSamMerchant(directory),context={query:new URLSearchParams(queryText(query))};
  const admission=await merchant.dataset.admit(context),
    response=admission===true?await merchant.dataset.handle(context):admission;
  return {mode:'LOCAL_ORIGINAL_DATASET',publicationId:merchant.bundle.id,
    snapshot:merchant.bundle.dataset.snapshot,response};
}
export async function serveSamMerchant(directory,{port=0,nativeFactory=null,control=true,
  controlTransport='loopback',maxInFlight=64,drainGraceMs=60000}={}){
  const merchant=await loadSamMerchant(directory);
  requireThat(merchant.bundle.seller,'MERCHANT_PAYMENT_CONFIG_REQUIRED',
    'Prepare this selection with the original public payment terms and resource origin.',409);
  integer(port,'Original seller port',0,65535);
  const [{openDatasetVersions},{startVersionedDatasetSeller}]=await Promise.all([
    import('../dataset-refresh/versions.mjs'),import('../dataset-refresh/service.mjs')]);
  const versionsDirectory=await privateDirectory(join(merchant.directory,'runtime','versions'));
  let initialized=false;
  try{await lstat(join(versionsDirectory,'state.json'));initialized=true;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const versions=await openDatasetVersions({directory:versionsDirectory,
    ...(initialized?{}:{initialConfig:join(merchant.directory,'dataset.json')}),
    maxResidentRows:1000000,collectOnOpen:false});
  try{
    requireThat(versions.status().versions.some(version=>version.snapshot===merchant.bundle.dataset.snapshot),
      'MERCHANT_PUBLISHER_SOURCE_CHANGED','The original publisher no longer retains this selected source snapshot.',409);
    const config=await readJson(join(merchant.directory,'seller.json'),65536);
    const service=await startVersionedDatasetSeller({versions,config,port,nativeFactory,control,
      controlTransport,maxInFlight,drainGraceMs});
    const originalClose=service.close.bind(service);let closePromise=null;
    return Object.assign(service,{publicationId:merchant.bundle.id,
      sourceEditionId:merchant.bundle.editionId,snapshot:merchant.bundle.dataset.snapshot,
      close(){return closePromise??(closePromise=originalClose());}});
  }catch(error){await versions.close();throw error;}
}
export async function reviewSamBuyer({directory,seller,query={}}={}){
  const merchant=await loadSamMerchant(directory);
  requireThat(merchant.bundle.seller,'MERCHANT_PAYMENT_CONFIG_REQUIRED');
  const inputQuery=queryText(query);
  const {readDatasetBuyerOffer}=await import('../dataset-refresh/buyer-handoff.mjs');
  const review=await readDatasetBuyerOffer({seller,resource:merchant.bundle.seller.resource,
    snapshot:merchant.bundle.dataset.snapshot,query:inputQuery});
  return {...review,inputQuery,publicationId:merchant.bundle.id,editionId:merchant.bundle.editionId};
}
export async function prepareSamBuyer({directory,review,intentId,acceptIndex,offerSha256}={}){
  requireThat(plain(review),'BUYER_REVIEW_REQUIRED');
  const fresh=await reviewSamBuyer({directory,seller:review.seller,query:review.inputQuery});
  requireThat(fresh.publicationId===review.publicationId && fresh.snapshot===review.snapshot &&
    fresh.offerSha256===review.offerSha256,'SELLER_OFFER_CHANGED',
    'The original seller offer or selected source changed; review its current terms.',409);
  const {prepareDatasetBuyer}=await import('../dataset-refresh/buyer-handoff.mjs');
  return prepareDatasetBuyer(fresh,{intentId,acceptIndex,offerSha256});
}

