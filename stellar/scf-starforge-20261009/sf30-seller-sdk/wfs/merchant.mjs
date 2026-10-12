// MIT. WFS merchant editions use the original SF30 seller, SF88 Buyer and SF100 delivery.
import { resolve, join, basename } from 'node:path';
import { readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from '../dataset-refresh/versions.mjs';
import { startVersionedDatasetSeller } from '../dataset-refresh/service.mjs';
import { compileHttpSellerOffer } from '../seller.mjs';
import { readSellerConfig } from '../serve.mjs';
import { compileAssetRouteOffer, MAX_ASSET_BYTES, MAX_ASSET_BUDGET } from '../response-asset.mjs';
import { createNativeHttpFactory } from '../native-http-factory.mjs';
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { validateDatasetQuery, inspectDatasetPage } from '../../sf88-operator-buyer-cli/dataset-page.mjs';
import { readBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { need, canonical, clone, hash, digest, jsonBytes, operationId, LIMITS } from './model.mjs';
import { durableDirectory, exactFile as retainFile, optionalJson } from './source.mjs';
import { getWfsPublication } from './project.mjs';
import { exportWfsProject, inspectWfsProjectBundle } from './portable.mjs';
import { reopenExport } from '../ogc/project.mjs';

const EDITION='stellar-forge.wfs-merchant-edition.v1', PLAN='stellar-forge.wfs-merchant.v1';
const PURCHASE='stellar-forge.wfs-purchase.v1';
export const SOURCE_FILES='stellar-forge.wfs-source-files.v1';
export const CHUNK_BYTES=49152;
export const SOURCE_COLUMNS=Object.freeze(['capture_id','source_set_id','path','file_sha256','file_bytes',
  'chunk_index','chunk_count','chunk_sha256','content_base64']);
const PAGE_BYTES=LIMITS.pageBytes, SOURCE_ALLOWANCE=128*1024*1024;
const exactFile=(directory,name,bytes)=>retainFile(join(directory,name),bytes);
const member=(path,bytes,contentType,role)=>({path,bytes:bytes.length,sha256:hash(bytes),contentType,role});
const isHash=value=>/^[a-f0-9]{64}$/.test(value??'');
function sourceFileCsv(sourceSetId,manifestBytes,inventory) {
  const cell=value=>'"'+String(value).replaceAll('"','""')+'"';
  const rows=[SOURCE_COLUMNS.map(cell).join(',')],captureId=hash(manifestBytes);
  for(const [path,bytes] of [['sources-manifest.json',manifestBytes],...inventory]) {
    const fileSha256=hash(bytes),count=Math.max(1,Math.ceil(bytes.length/CHUNK_BYTES));
    for(let index=0;index<count;index++){
      const chunk=bytes.subarray(index*CHUNK_BYTES,(index+1)*CHUNK_BYTES);
      rows.push([captureId,sourceSetId,path,fileSha256,bytes.length,index,count,hash(chunk),chunk.toString('base64')].map(cell).join(','));
    }
  }
  const csv=Buffer.from(rows.join('\r\n')+'\r\n');
  need(csv.length<=256*1024*1024,'Complete source-file dataset exceeds the original256 MiB dataset capacity.','WFS_SOURCE_DATASET_TOO_LARGE',413);
  return {csv,captureId,rows:rows.length-1};
}
function editionIdentity(value) {
  const {editionId,directory,datasetPath,publicationDirectory,...body}=value;return body;
}
function planIdentity(value){const{planSha256,...body}=value;return body;}
export async function stageWfsMerchant({directory,publicationId}={}) {
  const selected=await getWfsPublication(directory,publicationId),root=await durableDirectory(join(selected.directory,'commerce'));
  return withPrivateLock(root,'merchant.lock',async()=>{
    if(await optionalJson(join(root,'merchant-plan.json')))return (await readWfsMerchant(selected.directory)).plan;
    need(selected.publication.merchantConfigured,'Publish this edition with its original public origin and payment configuration.','WFS_MERCHANT_TERMS_REQUIRED');
    // The source product is the explicitly selected complete project as it stood
    // when this merchant was first staged. Later project edits do not replace it.
    let bundle=await optionalJson(join(root,'project-bundle.json'),SOURCE_ALLOWANCE);
    if(!bundle){
      bundle=await exportWfsProject({directory,maxBytes:SOURCE_ALLOWANCE});
      const bytes=jsonBytes(bundle);
      need(bytes.length<=SOURCE_ALLOWANCE,'This complete project exceeds the128 MiB native source product capacity. Export its full portable project separately.','WFS_SOURCE_PRODUCT_TOO_LARGE',413);
      await exactFile(root,'project-bundle.json',bytes);
    }
    const sourceSummary=await inspectWfsProjectBundle(bundle,{maxBytes:SOURCE_ALLOWANCE});
    need(isHash(bundle.bundleSha256),'The original complete project bundle changed.');
    const bundleBytes=await readBytes(join(root,'project-bundle.json'),SOURCE_ALLOWANCE);
    const sourceManifest={schema:SOURCE_FILES,sourceSetId:bundle.bundleSha256,publicationId,
      snapshot:selected.edition.dataset.snapshot,originalProjectId:sourceSummary.project.id,
      files:[{path:'project-bundle.json',bytes:bundleBytes.length,sha256:hash(bundleBytes)}]};
    const manifestBytes=jsonBytes(sourceManifest),sourceProjection=sourceFileCsv(bundle.bundleSha256,manifestBytes,[['project-bundle.json',bundleBytes]]);
    const sourceConfig={schema:'stellar-forge.csv-dataset.v1',file:'source-files.csv',name:'WFS complete project source files',
      columns:Object.fromEntries(SOURCE_COLUMNS.map(name=>[name,{type:['file_bytes','chunk_index','chunk_count'].includes(name)?'integer':'string',nullable:false}])),
      filters:['path'],ranges:[],sorts:['path','chunk_index'],defaultLimit:4,maxLimit:12,maxRows:LIMITS.rows,
      maxBytes:256*1024*1024,maxCellChars:65536,maxPageBytes:PAGE_BYTES};
    for(const[name,bytes]of[['sources-manifest.json',manifestBytes],['source-files.csv',sourceProjection.csv],['source-dataset.json',jsonBytes(sourceConfig)]])
      await exactFile(root,name,bytes);
    const sources=await loadDatasetConfig(join(root,'source-dataset.json'));
    need(sources.describe().rowCount===sourceProjection.rows,'The original source-file dataset changed its row count.');
    const edition={schema:EDITION,publicationId,sourceSetId:bundle.bundleSha256,sourceManifestSha256:sourceProjection.captureId,
      originalExportOperationId:selected.edition.operationId,sourceId:selected.edition.sourceId,
      snapshot:selected.edition.dataset.snapshot,sourceSnapshot:sources.describe().snapshot,
      rowCount:selected.edition.dataset.rowCount,sourceFileRows:sourceProjection.rows,
      projectRevision:sourceSummary.project.revision,files:[
        member('project-bundle.json',bundleBytes,'application/json','COMPLETE_PROJECT'),
        member('sources-manifest.json',manifestBytes,'application/json','SOURCE_MANIFEST'),
        member('source-files.csv',sourceProjection.csv,'text/csv','NATIVE_SOURCE_FILE_DATASET'),
        member('source-dataset.json',jsonBytes(sourceConfig),'application/json','SOURCE_DATASET_CONFIGURATION')]};
    edition.editionId='wfs-'+digest(editionIdentity(edition));await exactFile(root,'edition.json',jsonBytes(edition));
    const config=await readPrivateJson(join(selected.directory,'seller.json'),4*1024*1024);
    need(config.routes?.length===1,'Use the original single dataset publication.');
    const row=config.routes[0],payment=row.definition.payment;
    row.id='wfs-rows';row.definition.serviceName='WFS feature workspace';
    row.definition.description='The selected complete WFS download order, with its original source geometry and properties.';
    row.definition.queryParameters.push(clone(DATASET_SNAPSHOT_PARAMETER));
    const sourcePath=row.path.replace(/\/$/,'')+'/source-files';
    const sourceConfigSeller=await buildDatasetSellerConfig(sources,{payment,origin:config.publicOrigin,path:sourcePath});
    const sourceRoute=sourceConfigSeller.routes[0];sourceRoute.id='wfs-source-files';
    sourceRoute.handler='queryWfsSources';sourceRoute.admit='admitWfsSources';
    sourceRoute.definition.serviceName='WFS complete project source files';
    sourceRoute.definition.description='Every retained project source, schema, original feature page, query, comparison and publication at the displayed project revision.';
    sourceRoute.definition.queryParameters.push(clone(DATASET_SNAPSHOT_PARAMETER));config.routes.push(sourceRoute);
    let used=0,maxResponseBytes=PAGE_BYTES;const downloads=[];
    for(const file of edition.files.filter(item=>['project-bundle.json','sources-manifest.json'].includes(item.path))) {
      if(file.bytes>MAX_ASSET_BYTES||used+file.bytes>MAX_ASSET_BUDGET)continue;
      used+=file.bytes;maxResponseBytes=Math.max(maxResponseBytes,file.bytes);
      const path=row.path.replace(/\/$/,'')+'/files/'+file.path;
      downloads.push({...file,resource:config.publicOrigin+path});
      config.routes.push({id:'wfs-'+file.path.replaceAll('.','-'),path,
        definition:{method:'GET',serviceName:'WFS feature workspace',description:file.role.replaceAll('_',' '),payment},
        responseAsset:{file:file.path,sha256:file.sha256,contentType:file.contentType,downloadName:file.path}});
    }
    config.maxResponseBytes=maxResponseBytes;config.assetBudgetBytes=MAX_ASSET_BUDGET;
    const offers=config.routes.map(item=>item.responseAsset
      ?compileAssetRouteOffer(item,config.publicOrigin,compileHttpSellerOffer)
      :compileHttpSellerOffer({...item.definition,url:config.publicOrigin+item.path}));
    const configBytes=jsonBytes(config),offersBytes=jsonBytes({resources:offers});
    const plan={schema:PLAN,editionId:edition.editionId,publicationId,snapshot:edition.snapshot,sourceSnapshot:edition.sourceSnapshot,
      sourceSetId:edition.sourceSetId,sourceManifestSha256:edition.sourceManifestSha256,
      origin:config.publicOrigin,path:row.path,payment:clone(payment),resource:config.publicOrigin+row.path,
      sourceResource:config.publicOrigin+sourcePath,downloads,configSha256:hash(configBytes),offersSha256:hash(offersBytes)};
    plan.planSha256=digest(planIdentity(plan));
    await exactFile(root,'merchant-config.json',configBytes);await exactFile(root,'offers.json',offersBytes);
    await readSellerConfig(join(root,'merchant-config.json'));
    await exactFile(root,'merchant-plan.json',jsonBytes(plan));return plan;
  });
}
export async function readWfsMerchant(directory) {
  directory=resolve(directory);
  const original=await reopenExport(directory),root=join(directory,'commerce');
  const edition=await readPrivateJson(join(root,'edition.json'),4*1024*1024);
  need(edition?.schema===EDITION&&edition.editionId==='wfs-'+digest(editionIdentity(edition))&&
    edition.originalExportOperationId===original.operationId&&edition.snapshot===original.dataset.snapshot&&
    edition.sourceId===original.sourceId,'The original WFS merchant edition changed.');
  const names=['project-bundle.json','sources-manifest.json','source-files.csv','source-dataset.json'];
  need(Array.isArray(edition.files)&&edition.files.length===names.length&&new Set(edition.files.map(x=>x.path)).size===names.length&&
    edition.files.every(x=>names.includes(x.path)),'The complete merchant inventory changed.');
  for(const file of edition.files){
    need(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=256*1024*1024&&isHash(file.sha256),'Invalid original merchant member.');
    const bytes=await readBytes(join(root,file.path),Math.max(1,file.bytes));
    need(bytes.length===file.bytes&&hash(bytes)===file.sha256,'The original merchant member changed: '+file.path);
  }
  const plan=await readPrivateJson(join(root,'merchant-plan.json'),4*1024*1024);
  need(plan?.schema===PLAN&&plan.planSha256===digest(planIdentity(plan))&&plan.editionId===edition.editionId&&
    plan.sourceSetId===edition.sourceSetId&&plan.sourceManifestSha256===edition.sourceManifestSha256&&
    plan.snapshot===edition.snapshot&&plan.sourceSnapshot===edition.sourceSnapshot,'The original merchant selection changed.');
  const configBytes=await readBytes(join(root,'merchant-config.json'),4*1024*1024),offersBytes=await readBytes(join(root,'offers.json'),4*1024*1024);
  need(hash(configBytes)===plan.configSha256&&hash(offersBytes)===plan.offersSha256,'The original payment terms changed.');
  return{edition:{...edition,directory:root,publicationDirectory:directory,datasetPath:join(directory,'dataset.json')},
    plan,config:await readSellerConfig(join(root,'merchant-config.json')),offersBytes,offers:JSON.parse(offersBytes).resources};
}
export async function startWfsMerchant({directory,port=0,nativeFactory,facilitator,allowLocalFacilitator=false,maxInFlight=64,drainGraceMs=60000}={}) {
  need(!(nativeFactory&&facilitator),'Select the original native factory or facilitator.');
  const {edition,plan,config}=await readWfsMerchant(directory);
  const sources=await loadDatasetConfig(join(edition.directory,'source-dataset.json'));
  need(sources.describe().snapshot===edition.sourceSnapshot,'Original source-file dataset changed.');
  const location=join(edition.directory,'dataset-state'),retained=await optionalJson(join(location,'state.json'),4*1024*1024);
  const versions=await openDatasetVersions({directory:location,maxCachedVersions:1,maxResidentRows:LIMITS.rows,
    ...(retained?{}:{initialConfig:edition.datasetPath,maxVersions:4,maxRetainedBytes:256*1024*1024,retentionMs:3600000})});
  try {
    need(versions.describe().snapshot===edition.snapshot,'Original immutable dataset snapshot changed.');
    const contexts=new WeakMap();
    const selected=context=>{
      let value=contexts.get(context);
      if(value)return value;
      const query=new URLSearchParams(context.query);
      need(!query.has('snapshot')||query.get('snapshot')===edition.sourceSnapshot,'Original source-file snapshot changed.','DATASET_SNAPSHOT_CHANGED',409);
      query.delete('snapshot');value={...context,query};contexts.set(context,value);return value;
    };
    const admit=context=>{
      try{return sources.admit(selected(context));}
      catch(error){if(error.status===409)return{status:409,body:{error:error.code,message:error.message}};throw error;}
    };
    const factory=nativeFactory??(facilitator?await createNativeHttpFactory({facilitator,allowLocalFacilitator}):null);
    const session=await startVersionedDatasetSeller({versions,config,port,nativeFactory:factory,
      handlers:{admitWfsSources:admit,queryWfsSources:context=>sources.handle(selected(context))},
      controlTransport:'loopback',maxInFlight,drainGraceMs});
    return {...session,editionId:edition.editionId,snapshot:edition.snapshot,sourceSnapshot:edition.sourceSnapshot,
      resource:plan.resource,sourceResource:plan.sourceResource,mode:factory?'NATIVE_SELLER':'CHALLENGE_ONLY'};
  } catch(error){await versions.close();throw error;}
}
function queryEntries(query) {
  const entries=query instanceof URLSearchParams?[...query]:Object.entries(query??{});
  need(entries.every(([key,value])=>typeof key==='string'&&typeof value==='string')&&new Set(entries.map(([key])=>key)).size===entries.length,
    'Query parameters must have unique string values.');return entries;
}
function purchaseIdentity(value) {
  const {purchaseSha256,config,...body}=value;return body;
}
export async function prepareWfsPurchase({directory,intentId,query={},kind='rows',file=null,previous=null,acceptIndex=0}={}) {
  operationId(intentId);need(['rows','sources'].includes(kind),'Choose rows or sources.');
  const {edition,plan,offersBytes,offers}=await readWfsMerchant(directory);
  const snapshot=kind==='sources'?edition.sourceSnapshot:edition.snapshot;
  let resource=kind==='sources'?plan.sourceResource:plan.resource,expected=null;
  if(file!==null) {
    const download=plan.downloads.find(item=>item.path===file);
    need(download&&queryEntries(query).length===0&&previous===null&&kind==='rows','Choose an advertised complete file without dataset query parameters.');
    resource=download.resource;expected=clone(download);
  }
  const url=new URL(resource);
  if(file===null) {
    const params=new URLSearchParams(queryEntries(query));
    need(!params.has('snapshot')||params.get('snapshot')===snapshot,'Keep the original selected snapshot.');
    params.set('snapshot',snapshot);url.search=params.toString();url.searchParams.sort();
    validateDatasetQuery(url.href,{initial:previous===null});
    if(previous)need(previous.snapshot===snapshot&&previous.nextCursor&&previous.nextCursor===url.searchParams.get('cursor'),
      'Use the preceding original page and its next cursor.');
    const dataset=await loadDatasetConfig(kind==='sources'?join(edition.directory,'source-dataset.json'):edition.datasetPath);
    params.delete('snapshot');
    const admission=dataset.admit({query:params});
    need(admission===true,admission?.body?.message??'Original dataset declined the selected query.');
  }
  const rowIndex=offers.findIndex(offer=>(typeof offer.resource==='string'?offer.resource:offer.resource.url)===resource);
  need(rowIndex>=0,'Original merchant offer is unavailable.');
  const root=await durableDirectory(join(edition.directory,'customer-requests',intentId)),destination=join(root,'response.bin');
  const prepared=prepareReview(offersBytes,{rowIndex,acceptIndex,intentId,url:url.href,method:'GET',responseOut:destination});
  const config={...prepared.draft,responseFile:expected
    ?{destination,maxBytes:Math.max(1,expected.bytes),expectedSha256:expected.sha256,expectedBytes:expected.bytes,expectedContentType:expected.contentType}
    :{destination,maxBytes:PAGE_BYTES}};
  const purchase={schema:PURCHASE,editionId:edition.editionId,sourceSetId:edition.sourceSetId,
    sourceManifestSha256:edition.sourceManifestSha256,snapshot,planSha256:plan.planSha256,
    intentId,kind,url:url.href,file,previous:clone(previous),expected,configSha256:hash(jsonBytes(config)),config};
  purchase.purchaseSha256=digest(purchaseIdentity(purchase));
  await withPrivateLock(root,'request.lock',()=>exactFile(root,'prepared.json',jsonBytes(purchase)));
  return purchase;
}
async function originalPurchase(directory,purchase) {
  need(purchase?.schema===PURCHASE&&purchase.purchaseSha256===digest(purchaseIdentity(purchase))&&
    hash(jsonBytes(purchase.config))===purchase.configSha256,'Prepared WFS purchase changed.');
  const current=await prepareWfsPurchase({directory,intentId:purchase.intentId,kind:purchase.kind,
    query:purchase.file===null?new URL(purchase.url).searchParams:{},file:purchase.file,previous:purchase.previous,
    acceptIndex:purchase.config.preparedFrom.acceptIndex});
  need(current.purchaseSha256===purchase.purchaseSha256,'Purchase belongs to another original edition.');return current;
}
async function receivedResult(result,binding) {
  result.raiseForStatus();
  const bytes=await result.bytes({limit:binding.expected?Math.max(1,binding.expected.bytes):PAGE_BYTES});
  if(binding.expected)need(bytes.length===binding.expected.bytes&&hash(bytes)===binding.expected.sha256,'Delivered source file changed.');
  const metadata=binding.file===null?inspectDatasetPage(bytes,{url:binding.url,expectedSnapshot:binding.snapshot,previous:binding.previous}):clone(binding.expected);
  return {state:'DELIVERED',intentId:binding.intentId,kind:binding.kind,editionId:binding.editionId,
    metadata,bytes:bytes.length,sha256:hash(bytes),...(binding.file===null?{page:JSON.parse(bytes.toString('utf8'))}:{}),result};
}
async function bindNativePurchase(operation,current) {
  const bytes=await readBytes(operation.configPath,65536),config=JSON.parse(bytes.toString('utf8'));
  const metadata=await readPrivateJson(join(operation.directory,'operation.json'),65536);
  need(metadata.intentId===current.intentId&&metadata.state==='PREPARED'&&metadata.configSha256===hash(bytes)&&
    canonical(config.operation)===canonical(current.config.operation)&&canonical(config.preparedFrom)===canonical(current.config.preparedFrom)&&
    config.captureBody===false,'Existing native intent belongs to another original request.');
  for(const key of ['maxBytes','expectedSha256','expectedBytes','expectedContentType'])
    need(config.responseFile?.[key]===current.config.responseFile?.[key],'Original customer response policy changed.');
  const binding={...purchaseIdentity(current),purchaseSha256:current.purchaseSha256,nativeConfigSha256:hash(bytes)};
  await withPrivateLock(operation.directory,'wfs-binding.lock',()=>exactFile(operation.directory,'wfs-edition.json',jsonBytes(binding)));
  return binding;
}
export async function executeWfsPurchase({directory,buyer,purchase,signal}={}) {
  need(buyer&&typeof buyer.fromConfig==='function','Supply the maintained SF88 Buyer.');
  const current=await originalPurchase(directory,purchase);let operation;
  try{operation=await buyer.fromConfig(current.config,{signal});}
  catch(error){if(error.code!=='INTENT_ALREADY_EXISTS_USE_RECOVER')throw error;operation=buyer.operation(current.intentId);}
  const binding=await bindNativePurchase(operation,current),retained=await operation.recover();
  if(retained!==null)return receivedResult(retained,binding);
  if(await optionalJson(join(operation.directory,'attempt.json')))return{state:'AWAITING_NATIVE_RESULT',intentId:current.intentId,editionId:current.editionId};
  const review=await operation.review({signal});
  need(review.configSha256===binding.nativeConfigSha256,'Original reviewed customer configuration changed.');
  try{return receivedResult(await operation.execute({review,signal}),binding);}
  catch(error){if(error.code==='ATTEMPT_ALREADY_RECORDED_USE_RECOVER')return recoverWfsPurchase({directory,buyer,intentId:current.intentId});throw error;}
}
export async function recoverWfsPurchase({directory,buyer,intentId}={}) {
  operationId(intentId);
  const operation=buyer.operation(intentId),prepared=await readPrivateJson(join((await readWfsMerchant(directory)).edition.directory,'customer-requests',intentId,'prepared.json'),131072);
  const current=await originalPurchase(directory,prepared),metadata=await optionalJson(join(operation.directory,'operation.json'));
  if(!metadata)return{state:'PREPARED_NOT_STARTED',intentId,editionId:current.editionId};
  if(metadata.state!=='PREPARED')return{state:'NATIVE_PREPARATION_INCOMPLETE',intentId};
  const binding=await bindNativePurchase(operation,current),result=await operation.recover();
  if(result===null)return{state:'AWAITING_NATIVE_RESULT',intentId,editionId:binding.editionId};
  need(result.record.configSha256===binding.nativeConfigSha256,'Original customer result changed.');
  return receivedResult(result,binding);
}
export async function exportWfsPurchase(args) {
  const delivered=await recoverWfsPurchase(args);
  need(delivered.result,'The selected intent has no completed saved delivery.');
  return {bytes:await delivered.result.bytes({limit:delivered.bytes}),contentType:delivered.metadata.contentType??'application/json',
    filename:delivered.metadata.path?basename(delivered.metadata.path):args.intentId+'.json'};
}
