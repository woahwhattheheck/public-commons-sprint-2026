// MIT. GDELT merchant editions use the original SF30, dataset versions and SF88 Buyer.
import { resolve, join, basename } from 'node:path';
import { atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
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
import { need, plain, canonical, clone, hash, digest, jsonBytes, isHash, operationId, LIMITS,
  ATTRIBUTION, NOTICE, CODEBOOK_URL, TERMS_URL, columnMeaning, projectionPolicy, projectionCsv, schemaDocument } from './model.mjs';
import { GKG_CODEBOOK_URL, GKG_NOTICE, isGkgTable } from './gkg.mjs';
import { durableDirectory, exactFile, optionalJson, inspectGdeltCapture, verifyGdeltCapture, gdeltCaptureCodebook } from './source.mjs';

const EDITION='stellar-forge.gdelt-edition.v1', PLAN='stellar-forge.gdelt-merchant.v1';
const PURCHASE='stellar-forge.gdelt-purchase.v1';
export const SOURCE_SET='stellar-forge.gdelt-source-set.v1';
export const SOURCE_FILES='stellar-forge.gdelt-source-files.v1';
export const CHUNK_BYTES=49152;
export const SOURCE_COLUMNS=Object.freeze(['capture_id','source_set_id','path','file_sha256','file_bytes',
  'chunk_index','chunk_count','chunk_sha256','content_base64']);
const PAGE_BYTES=LIMITS.pageBytes;
const member=(path,bytes,contentType,role)=>({path,bytes:bytes.length,sha256:hash(bytes),contentType,role});
const setIdentity=value=>({schema:SOURCE_SET,captures:value.captures,attribution:ATTRIBUTION,codebookUrl:value.codebookUrl});
export function makeGdeltSourceSet(captures) {
  need(Array.isArray(captures)&&captures.length>=1&&captures.length<=LIMITS.captures,'Select complete original source captures.');
  captures=[...captures].sort((a,b)=>a.batch.localeCompare(b.batch)||a.captureId.localeCompare(b.captureId));
  captures.forEach(inspectGdeltCapture);
  need(new Set(captures.map(item=>item.batch)).size===captures.length,'A source set retains one selected edition per update timestamp.');
  const codebookUrl=gdeltCaptureCodebook(captures[0]);
  need(captures.every(capture=>gdeltCaptureCodebook(capture)===codebookUrl),'A reviewed source set uses one original source family.');
  const set={schema:SOURCE_SET,captures,attribution:ATTRIBUTION,codebookUrl};
  set.sourceSetId=digest(setIdentity(set));
  need(jsonBytes(set).length<=80*1024*1024,'A merchant source set supports80 MiB of complete original capture data. Select fewer retained updates.','GDELT_SOURCE_SET_TOO_LARGE',413);
  return set;
}
export async function verifyGdeltSourceSet(set,options={}) {
  need(set?.schema===SOURCE_SET&&set.sourceSetId===digest(setIdentity(set))&&set.attribution===ATTRIBUTION&&
    [CODEBOOK_URL,GKG_CODEBOOK_URL].includes(set.codebookUrl),'Original GDELT source-set identity changed.');
  const expected=makeGdeltSourceSet(set.captures);
  need(canonical(expected)===canonical(set),'Original source-set inventory changed.');
  for(const capture of set.captures)await verifyGdeltCapture(capture,options);
  return set;
}
function sourceFileCsv(sourceSetId,manifestBytes,inventory) {
  const fields=SOURCE_COLUMNS,cell=value=>'"'+String(value).replaceAll('"','""')+'"';
  const rows=[fields.map(cell).join(',')],captureId=hash(manifestBytes);
  const files=[['sources-manifest.json',manifestBytes],...inventory];
  for(const [path,bytes] of files) {
    const fileSha256=hash(bytes),count=Math.max(1,Math.ceil(bytes.length/CHUNK_BYTES));
    for(let index=0;index<count;index++) {
      const chunk=bytes.subarray(index*CHUNK_BYTES,(index+1)*CHUNK_BYTES);
      const row=[captureId,sourceSetId,path,fileSha256,bytes.length,index,count,hash(chunk),chunk.toString('base64')];
      rows.push(row.map(cell).join(','));
    }
  }
  const csv=Buffer.from(rows.join('\r\n')+'\r\n');
  need(csv.length<=256*1024*1024,'Complete source-file projection exceeds256 MiB.','GDELT_SOURCE_SET_TOO_LARGE',413);
  return {csv,captureId,rows:rows.length-1};
}
function editionIdentity(value) {
  const {editionId,directory,...body}=value;return body;
}
export async function prepareGdeltEdition({directory,captures,review}={}) {
  directory=await durableDirectory(directory);
  const sourceSet=makeGdeltSourceSet(captures),captureIds=sourceSet.captures.map(item=>item.captureId);
  const policy=projectionPolicy(review?.policy);
  need(review?.schema==='stellar-forge.gdelt-review.v1'&&canonical(review.captureIds)===canonical(captureIds)&&
    review.id===digest({captureIds,policy,note:review.note,name:review.name}),'Use the original retained source review.');
  return withPrivateLock(directory,'edition.lock',async()=>{
    const models=sourceSet.captures.map(inspectGdeltCapture);
    const projected=projectionCsv(models,policy),csv=Buffer.from(projected.csv);
    need(projected.rows.length===review.rowCount&&projected.sourceRows===review.sourceRows,'Reviewed source selection changed.');
    need(csv.length<=256*1024*1024,'Native dataset source exceeds256 MiB.');
    const semantics=schemaDocument(policy,captureIds);
    need(canonical(semantics)===canonical(review.semantics),'The original reviewed field meanings changed.');
    const config={schema:'stellar-forge.csv-dataset.v1',file:'data.csv',name:review.name,
      columns:Object.fromEntries(policy.fields.map(name=>{const {type,nullable}=columnMeaning(name,{table:policy.table});return[name,{type,nullable}];})),
      filters:policy.filters,ranges:policy.ranges,sorts:policy.sorts,defaultLimit:policy.defaultLimit,maxLimit:policy.maxLimit,
      maxRows:LIMITS.rows,maxBytes:256*1024*1024,maxCellChars:LIMITS.cellChars,maxPageBytes:PAGE_BYTES};
    const sourceBytes=jsonBytes(sourceSet),semanticsBytes=jsonBytes(semantics),reviewBytes=jsonBytes(review);
    const originals=[['source-set.json',sourceBytes],['gdelt-schema.json',semanticsBytes],['review.json',reviewBytes]];
    const sourceManifest={schema:SOURCE_FILES,sourceSetId:sourceSet.sourceSetId,reviewId:review.id,attribution:ATTRIBUTION,
      codebookUrl:sourceSet.codebookUrl,files:originals.map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}))};
    const manifestBytes=jsonBytes(sourceManifest),sourceProjection=sourceFileCsv(sourceSet.sourceSetId,manifestBytes,originals);
    const sourceConfig={schema:'stellar-forge.csv-dataset.v1',file:'source-files.csv',name:'GDELT original source files',
      columns:Object.fromEntries(SOURCE_COLUMNS.map(name=>[name,{type:['file_bytes','chunk_index','chunk_count'].includes(name)?'integer':'string',nullable:false}])),
      filters:['path'],ranges:[],sorts:['path','chunk_index'],defaultLimit:4,maxLimit:12,maxRows:LIMITS.rows,
      maxBytes:256*1024*1024,maxCellChars:65536,maxPageBytes:PAGE_BYTES};
    const retained=[...originals,['data.csv',csv],['dataset.json',jsonBytes(config)],['sources-manifest.json',manifestBytes],
      ['source-files.csv',sourceProjection.csv],['source-dataset.json',jsonBytes(sourceConfig)]];
    for(const [name,bytes] of retained)await exactFile(directory,name,bytes);
    const dataset=await loadDatasetConfig(join(directory,'dataset.json')),sources=await loadDatasetConfig(join(directory,'source-dataset.json'));
    need(dataset.describe().rowCount===review.rowCount&&sources.describe().rowCount===sourceProjection.rows,'Original dataset parser changed the reviewed row count.');
    const files=retained.map(([path,bytes])=>member(path,bytes,path.endsWith('.csv')?'text/csv':'application/json',
      path==='data.csv'?'CUSTOMER_PROJECTION':path==='source-set.json'?'ORIGINAL_SOURCE':'SOURCE_CONTRACT'));
    const edition={schema:EDITION,sourceSetId:sourceSet.sourceSetId,sourceManifestSha256:sourceProjection.captureId,
      reviewId:review.id,captureIds,batches:sourceSet.captures.map(item=>item.batch),table:policy.table,policy,
      snapshot:dataset.describe().snapshot,sourceSnapshot:sources.describe().snapshot,rowCount:review.rowCount,
      sourceFileRows:sourceProjection.rows,sourceRows:review.sourceRows,attribution:ATTRIBUTION,notice:isGkgTable(policy.table)?GKG_NOTICE:NOTICE,files};
    edition.editionId='gdelt-'+digest(editionIdentity(edition));
    await exactFile(directory,'edition.json',jsonBytes(edition));
    return {...edition,directory};
  });
}
export async function readGdeltEdition(directory) {
  directory=resolve(directory);
  const edition=await readPrivateJson(join(directory,'edition.json'),4*1024*1024);
  need(edition?.schema===EDITION&&edition.editionId==='gdelt-'+digest(editionIdentity(edition))&&
    edition.attribution===ATTRIBUTION&&Array.isArray(edition.files),'Original GDELT edition identity changed.');
  const names=['source-set.json','gdelt-schema.json','review.json','data.csv','dataset.json','sources-manifest.json','source-files.csv','source-dataset.json'];
  need(edition.files.length===names.length&&new Set(edition.files.map(item=>item.path)).size===names.length&&edition.files.every(item=>names.includes(item.path)),'Edition member inventory changed.');
  for(const file of edition.files) {
    need(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=256*1024*1024&&isHash(file.sha256),'Invalid edition member identity.');
    const bytes=await readBytes(join(directory,file.path),Math.max(1,file.bytes));
    need(bytes.length===file.bytes&&hash(bytes)===file.sha256,'Original merchant file changed: '+file.path);
  }
  const sourceSet=await readPrivateJson(join(directory,'source-set.json'),80*1024*1024);
  need(sourceSet.sourceSetId===edition.sourceSetId&&makeGdeltSourceSet(sourceSet.captures).sourceSetId===edition.sourceSetId,'Original edition source-set binding changed.');
  const review=await readPrivateJson(join(directory,'review.json'),2*1024*1024);
  need(review.id===edition.reviewId&&canonical(review.captureIds)===canonical(edition.captureIds),'Original edition review changed.');
  return {...edition,directory};
}
function planIdentity(plan) {
  const {planSha256,...body}=plan;return body;
}
export async function stageGdeltMerchant({directory,origin,path='/gdelt',payment}={}) {
  const edition=await readGdeltEdition(directory);
  need(typeof path==='string'&&/^\/[A-Za-z0-9/_-]{0,128}$/.test(path)&&!path.includes('//'),'Choose a plain merchant route prefix.');
  const dataset=await loadDatasetConfig(join(edition.directory,'dataset.json'));
  const sources=await loadDatasetConfig(join(edition.directory,'source-dataset.json'));
  const base=path.replace(/\/$/,'')+'/'+edition.editionId,resourcePath=base+'/rows',sourcePath=base+'/source-files';
  const config=await buildDatasetSellerConfig(dataset,{payment,origin,path:resourcePath});
  const sourceConfig=await buildDatasetSellerConfig(sources,{payment,origin,path:sourcePath});
  const route=config.routes[0];route.id='gdelt-rows';
  route.definition.serviceName=isGkgTable(edition.table)?'GDELT article desk':'GDELT event desk';
  route.definition.description=ATTRIBUTION+'; '+edition.table+'; explicit source coverage '+edition.batches[0]+'–'+edition.batches.at(-1)+'.';
  route.definition.queryParameters.push(clone(DATASET_SNAPSHOT_PARAMETER));
  const sourceRoute=sourceConfig.routes[0];
  sourceRoute.id='gdelt-source-files';sourceRoute.handler='queryGdeltSources';sourceRoute.admit='admitGdeltSources';
  sourceRoute.definition.serviceName='GDELT original source files';
  sourceRoute.definition.description=ATTRIBUTION+'; complete original source set, field meanings and saved review through native dataset chunks.';
  sourceRoute.definition.queryParameters.push(clone(DATASET_SNAPSHOT_PARAMETER));
  config.routes.push(sourceRoute);
  const editionBytes=await readBytes(join(edition.directory,'edition.json'),4*1024*1024);
  const candidates=[member('edition.json',editionBytes,'application/json','EDITION_MANIFEST'),
    ...edition.files.filter(file=>['source-set.json','data.csv','gdelt-schema.json','review.json','sources-manifest.json'].includes(file.path))];
  let used=0,maxResponseBytes=PAGE_BYTES;const downloads=[];
  for(const file of candidates) {
    // All complete sources remain available through source-files, regardless of
    // the original seller's single-asset memory allowance.
    if(file.bytes>MAX_ASSET_BYTES||used+file.bytes>MAX_ASSET_BUDGET)continue;
    used+=file.bytes;maxResponseBytes=Math.max(maxResponseBytes,file.bytes);
    const assetPath=base+'/files/'+file.path;
    downloads.push({...file,resource:config.publicOrigin+assetPath});
    config.routes.push({id:'gdelt-'+file.path.replaceAll('.','-'),path:assetPath,
      definition:{method:'GET',serviceName:isGkgTable(edition.table)?'GDELT article desk':'GDELT event desk',description:ATTRIBUTION+'; exact '+file.role.toLowerCase().replaceAll('_',' '),payment},
      responseAsset:{file:file.path,sha256:file.sha256,contentType:file.contentType,downloadName:file.path}});
  }
  config.maxResponseBytes=maxResponseBytes;config.assetBudgetBytes=MAX_ASSET_BUDGET;
  const offers=config.routes.map(item=>item.responseAsset
    ?compileAssetRouteOffer(item,config.publicOrigin,compileHttpSellerOffer)
    :compileHttpSellerOffer({...item.definition,url:config.publicOrigin+item.path}));
  const configBytes=jsonBytes(config),offersBytes=jsonBytes({resources:offers});
  const plan={schema:PLAN,editionId:edition.editionId,snapshot:edition.snapshot,sourceSnapshot:edition.sourceSnapshot,
    sourceSetId:edition.sourceSetId,sourceManifestSha256:edition.sourceManifestSha256,
    origin:config.publicOrigin,path,payment:clone(payment),resource:config.publicOrigin+resourcePath,
    sourceResource:config.publicOrigin+sourcePath,downloads,configSha256:hash(configBytes),offersSha256:hash(offersBytes),attribution:ATTRIBUTION};
  plan.planSha256=digest(planIdentity(plan));
  return withPrivateLock(edition.directory,'merchant.lock',async()=>{
    await exactFile(edition.directory,'merchant-config.json',configBytes);
    await exactFile(edition.directory,'offers.json',offersBytes);
    await readSellerConfig(join(edition.directory,'merchant-config.json'));
    await exactFile(edition.directory,'merchant-plan.json',jsonBytes(plan));
    return plan;
  });
}
export async function readGdeltMerchant(directory) {
  const edition=await readGdeltEdition(directory),root=edition.directory;
  const plan=await readPrivateJson(join(root,'merchant-plan.json'),4*1024*1024);
  need(plan?.schema===PLAN&&plan.planSha256===digest(planIdentity(plan))&&plan.editionId===edition.editionId&&
    plan.snapshot===edition.snapshot&&plan.sourceSnapshot===edition.sourceSnapshot&&plan.sourceSetId===edition.sourceSetId&&
    plan.sourceManifestSha256===edition.sourceManifestSha256,'Retained merchant plan changed.');
  const configBytes=await readBytes(join(root,'merchant-config.json'),4*1024*1024),offersBytes=await readBytes(join(root,'offers.json'),4*1024*1024);
  need(hash(configBytes)===plan.configSha256&&hash(offersBytes)===plan.offersSha256,'Original seller terms changed.');
  return {edition,plan,config:await readSellerConfig(join(root,'merchant-config.json')),offersBytes,offers:JSON.parse(offersBytes).resources};
}
export async function startGdeltMerchant({directory,port=0,nativeFactory,facilitator,allowLocalFacilitator=false,maxInFlight=64,drainGraceMs=60000}={}) {
  need(!(nativeFactory&&facilitator),'Select the original native factory or facilitator.');
  const {edition,plan,config}=await readGdeltMerchant(directory);
  const sources=await loadDatasetConfig(join(edition.directory,'source-dataset.json'));
  need(sources.describe().snapshot===edition.sourceSnapshot,'Original source-file dataset changed.');
  const location=join(edition.directory,'dataset-state'),retained=await optionalJson(join(location,'state.json'),4*1024*1024);
  const versions=await openDatasetVersions({directory:location,maxCachedVersions:1,maxResidentRows:LIMITS.rows,
    ...(retained?{}:{initialConfig:join(edition.directory,'dataset.json'),maxVersions:4,maxRetainedBytes:256*1024*1024,retentionMs:3600000})});
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
      handlers:{admitGdeltSources:admit,queryGdeltSources:context=>sources.handle(selected(context))},
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
export async function prepareGdeltPurchase({directory,intentId,query={},kind='rows',file=null,previous=null,acceptIndex=0}={}) {
  operationId(intentId);need(['rows','sources'].includes(kind),'Choose rows or sources.');
  const {edition,plan,offersBytes,offers}=await readGdeltMerchant(directory);
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
    const dataset=await loadDatasetConfig(join(edition.directory,kind==='sources'?'source-dataset.json':'dataset.json'));
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
    hash(jsonBytes(purchase.config))===purchase.configSha256,'Prepared GDELT purchase changed.');
  const current=await prepareGdeltPurchase({directory,intentId:purchase.intentId,kind:purchase.kind,
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
  await withPrivateLock(operation.directory,'gdelt-binding.lock',()=>exactFile(operation.directory,'gdelt-edition.json',jsonBytes(binding)));
  return binding;
}
export async function executeGdeltPurchase({directory,buyer,purchase,signal}={}) {
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
  catch(error){if(error.code==='ATTEMPT_ALREADY_RECORDED_USE_RECOVER')return recoverGdeltPurchase({directory,buyer,intentId:current.intentId});throw error;}
}
export async function recoverGdeltPurchase({directory,buyer,intentId}={}) {
  operationId(intentId);
  const operation=buyer.operation(intentId),prepared=await readPrivateJson(join(resolve(directory),'customer-requests',intentId,'prepared.json'),131072);
  const current=await originalPurchase(directory,prepared),metadata=await optionalJson(join(operation.directory,'operation.json'));
  if(!metadata)return{state:'PREPARED_NOT_STARTED',intentId,editionId:current.editionId};
  if(metadata.state!=='PREPARED')return{state:'NATIVE_PREPARATION_INCOMPLETE',intentId};
  const binding=await bindNativePurchase(operation,current),result=await operation.recover();
  if(result===null)return{state:'AWAITING_NATIVE_RESULT',intentId,editionId:binding.editionId};
  need(result.record.configSha256===binding.nativeConfigSha256,'Original customer result changed.');
  return receivedResult(result,binding);
}
export async function exportGdeltPurchase(args) {
  const delivered=await recoverGdeltPurchase(args);
  need(delivered.result,'The selected intent has no completed saved delivery.');
  return {bytes:await delivered.result.bytes({limit:delivered.bytes}),contentType:delivered.metadata.contentType??'application/json',
    filename:delivered.metadata.path?basename(delivered.metadata.path):args.intentId+'.json'};
}
