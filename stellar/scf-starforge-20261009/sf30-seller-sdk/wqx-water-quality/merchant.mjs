// MIT. WQX editions use the maintained SF30 dataset/assets and SF88 buyer.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { readCapture, retainedFiles } from './provider.mjs';
import { joinCapture } from './samples.mjs';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { compileAssetRouteOffer, MAX_ASSET_BYTES, MAX_ASSET_BUDGET } from '../response-asset.mjs';
import { compileHttpSellerOffer } from '../seller.mjs';
import { readSellerConfig, startSellerService } from '../serve.mjs';
import { createWaterNativeFactory } from '../usgs-water/merchant.mjs';
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { writeBytes as writeNativeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { validateDatasetQuery, inspectDatasetPage } from '../../sf88-operator-buyer-cli/dataset-page.mjs';

const EDITION='starforge.wqx-water-quality-edition.v1', PLAN='starforge.wqx-water-quality-merchant.v1';
const PURCHASE='starforge.wqx-water-quality-purchase.v1', PROJECTION='wqx-result-csv.v1';
const MAX_FILE=256*1024*1024, PAGE_BYTES=900*1024;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(condition,message)=>{if(!condition)throw Object.assign(new Error(message),{code:'WQX_MERCHANT_INVALID',status:409});};
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function canonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  need(object(value),'Edition metadata must contain JSON values.');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
const digest=value=>hash(canonical(value));
const copy=value=>JSON.parse(JSON.stringify(value));
const descriptor=(path,bytes,role)=>({path,sha256:hash(bytes),bytes:bytes.length,role});
function memberPath(directory,relative){
  need(typeof relative==='string'&&relative.length>0&&relative.length<=1024&&!relative.includes('\\')&&!relative.includes('\0')&&relative.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Use an original relative edition member.');
  const path=resolve(directory,relative);need(path.startsWith(resolve(directory)+sep),'Member leaves its edition.');return path;
}
async function readBytes(path,max=MAX_FILE){
  need(await realpath(dirname(path))===dirname(path),'The retained parent must be canonical.');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const a=await handle.stat();need(a.isFile()&&a.nlink===1&&!(a.mode&0o077)&&a.size<=max,'Retained files must be private, regular and within the byte ceiling.');
    const bytes=await handle.readFile(),b=await handle.stat();
    need(bytes.length===a.size&&b.size===a.size&&b.mtimeMs===a.mtimeMs&&b.ctimeMs===a.ctimeMs,'Retained file changed while reading.');return bytes;
  }finally{await handle.close();}
}
async function readMember(directory,item){
  need(object(item)&&/^[a-f0-9]{64}$/.test(item.sha256)&&Number.isSafeInteger(item.bytes)&&item.bytes>=0&&item.bytes<=MAX_FILE,'Invalid retained member.');
  const bytes=await readBytes(memberPath(directory,item.path),Math.max(1,item.bytes));
  need(bytes.length===item.bytes&&hash(bytes)===item.sha256,'Original edition member changed: '+item.path);return bytes;
}
async function writeMember(directory,path,bytes){
  bytes=Buffer.from(bytes);need(bytes.length<=MAX_FILE,'A native edition member cannot exceed 256 MiB.');
  const target=memberPath(directory,path);await privateDirectory(dirname(target));
  try{await writeNativeBytes(target,bytes,{exclusive:true});}catch(error){if(error.code!=='EEXIST')throw error;need((await readBytes(target)).equals(bytes),'Existing immutable member differs: '+path);}
}
async function optional(path){try{return await readPrivateJson(path,64*1024*1024);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const scalarFields=['id','resultKey','activityKey','stationKey','provider','organizationId','locationId','locationName','activityId','resultId','activityType','media','mediaSubdivision','date','time','timeZone','characteristic','parameterCode','sampleFraction','methodSpeciation','value','valueState','unit','detectionCondition','valueType','qualifier','status','statisticalBase','weightBasis','timeBasis','temperatureBasis','particleSizeBasis','methodIdentifier','methodContext','methodName'];
const fields=[...scalarFields,'duplicate','conflictingDuplicate','values_json','record_json','source_json','limits_json','station_records_json','activity_records_json','issues_json'];
const columns=Object.fromEntries(fields.map(name=>[name,['duplicate','conflictingDuplicate'].includes(name)?'boolean':{type:'string',nullable:!name.endsWith('_json')&&!['id','valueState'].includes(name)}]));
const cell=value=>'"'+String(value).replace(/"/g,'""')+'"';
function csvProjection(row){
  const values={...row,duplicate:row.duplicate===true,conflictingDuplicate:row.conflictingDuplicate===true,
    values_json:JSON.stringify(Object.fromEntries(scalarFields.map(name=>[name,row[name]??null]))),record_json:JSON.stringify(row.record),source_json:JSON.stringify(row.source),limits_json:JSON.stringify(row.limits??[]),
    station_records_json:JSON.stringify(row.stationRecords??[]),activity_records_json:JSON.stringify(row.activityRecords??[]),issues_json:JSON.stringify(row.issues??[])};
  return fields.map(name=>cell(values[name]==null?'':values[name])).join(',');
}
function mime(path){return path.endsWith('.csv')?'text/csv':path.endsWith('.jsonl')?'application/x-ndjson':path.endsWith('.html')?'text/html':'application/json';}
function editionIdentity(value){
  return {schema:EDITION,projection:PROJECTION,captureSha256:value.captureSha256,operationId:value.operationId,selection:value.selection,summary:value.summary,files:value.files,dataset:value.dataset,rowCount:value.rowCount};
}
export async function prepareQualityEdition({directory,capture,analysis,review}={}){
  directory=await privateDirectory(resolve(directory));
  const source=await readCapture(typeof capture==='string'?capture:capture?.directory);
  need(source.status==='COMPLETE','Complete the original capture before preparing its edition.');
  if(capture?.captureSha256)need(source.captureSha256===capture.captureSha256,'Capture identity changed.');
  const model=await joinCapture(source),rows=model.rows,sourceFiles=await retainedFiles(source);
  need(Array.isArray(rows)&&rows.length<=1000000,'The original native dataset supports up to 1,000,000 result rows.');
  const csv=Buffer.from([fields.map(cell).join(','),...rows.map(csvProjection)].join('\n')+'\n');
  const datasetConfig={schema:'stellar-forge.csv-dataset.v1',file:'observations.csv',name:'WQX Water Quality '+source.captureSha256.slice(0,16),columns,
    filters:['provider','organizationId','locationId','characteristic','sampleFraction','unit','detectionCondition','qualifier'],
    ranges:['date'],sorts:['date','id','characteristic'],maxBytes:MAX_FILE,maxRows:Math.max(1,rows.length),maxCellChars:1024*1024,defaultLimit:25,maxLimit:100,maxPageBytes:PAGE_BYTES};
  return withPrivateLock(directory,'edition.lock',async()=>{
    const members=[];
    for(const item of sourceFiles){const bytes=await readMember(source.directory,item),path='capture/'+item.path;await writeMember(directory,path,bytes);members.push({...descriptor(path,bytes,'CAPTURE_MEMBER'),contentType:String(item.contentType??mime(item.path)).split(';')[0].trim()});}
    for(const [path,bytes,role] of [['observations.csv',csv,'QUERY_PROJECTION'],['observations.jsonl',Buffer.from(rows.map(row=>JSON.stringify(row)+'\n').join('')),'JOINED_RESULTS'],['dataset.json',json(datasetConfig),'NATIVE_DATASET_CONFIG'],['analysis.json',json(analysis??{}),'ANALYSIS'],['review.json',json(review??{}),'ANALYST_REVIEW']]){
      await writeMember(directory,path,bytes);members.push(descriptor(path,bytes,role));
    }
    const retained=await readCapture(join(directory,'capture'));need(retained.captureSha256===source.captureSha256,'The portable capture changed.');
    const dataset=await loadDatasetConfig(join(directory,'dataset.json')),description=dataset.describe();need(description.rowCount===rows.length,'Projected row count changed.');
    const manifest={schema:EDITION,projection:PROJECTION,status:'READY',captureSha256:source.captureSha256,operationId:source.operationId,selection:copy(source.selection),
      summary:copy(model.summary??source.summary??{}),rowCount:rows.length,dataset:description,snapshot:description.snapshot,files:members.sort((a,b)=>a.path.localeCompare(b.path))};
    manifest.editionId='wqx-'+digest(editionIdentity(manifest));
    manifest.downloads=manifest.files.filter(item=>['CAPTURE_MEMBER','ANALYSIS','ANALYST_REVIEW'].includes(item.role)).map(item=>({...item,contentType:item.contentType??mime(item.path)}));
    const previous=await optional(join(directory,'edition.json'));
    if(previous)need(canonical(previous)===canonical(manifest),'This edition directory retains different content.');else await atomicJson(directory,'edition.json',manifest,{exclusive:true});
    return {...manifest,directory};
  });
}
export async function readQualityEdition(directory){
  directory=resolve(directory);const manifest=await readPrivateJson(join(directory,'edition.json'),64*1024*1024);
  need(manifest.schema===EDITION&&manifest.projection===PROJECTION&&manifest.status==='READY'&&Array.isArray(manifest.files)&&new Set(manifest.files.map(item=>item.path)).size===manifest.files.length&&manifest.editionId==='wqx-'+digest(editionIdentity(manifest))&&manifest.dataset?.snapshot===manifest.snapshot&&manifest.dataset?.rowCount===manifest.rowCount,'Edition manifest changed.');
  for(const item of manifest.files)await readMember(directory,item);
  const capture=await readCapture(join(directory,'capture'));need(capture.status==='COMPLETE'&&capture.captureSha256===manifest.captureSha256,'Portable source binding changed.');
  const downloads=manifest.files.filter(item=>['CAPTURE_MEMBER','ANALYSIS','ANALYST_REVIEW'].includes(item.role)).map(item=>({...item,contentType:item.contentType??mime(item.path)}));
  need(canonical(downloads)===canonical(manifest.downloads),'Edition download map changed.');return {...manifest,directory};
}
function location(origin,path){
  const url=new URL(origin);need(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'&&origin.replace(/\/$/,'')===url.origin,'Use a canonical public HTTPS origin.');
  need(typeof path==='string'&&/^\/[A-Za-z0-9_.~/-]+$/.test(path)&&!path.includes('//')&&new URL(path,url).pathname===path&&!/^\/_seller(?:\/|$)/.test(path),'Use a canonical application path.');
  return {origin:url.origin,path:path.replace(/\/$/,'')};
}
function planIdentity(plan){return {schema:PLAN,editionId:plan.editionId,snapshot:plan.snapshot,origin:plan.origin,path:plan.path,payment:plan.payment,paths:plan.paths,downloadRoutes:plan.downloadRoutes,configSha256:plan.configSha256,offersSha256:plan.offersSha256};}
export async function stageQualityMerchant({editionDirectory,origin,path='/water-quality',payment}={}){
  const edition=await readQualityEdition(editionDirectory),where=location(origin,path),dataset=await loadDatasetConfig(join(edition.directory,'dataset.json'));
  need(dataset.describe().snapshot===edition.snapshot,'Native dataset snapshot changed.');
  const base=where.path+'/'+edition.editionId,paths={observations:base+'/observations',edition:base+'/edition'};
  const generated=await buildDatasetSellerConfig(dataset,{payment,origin:where.origin,path:paths.observations});
  const query=generated.routes[0];query.id='wqx-observations';query.handler='queryQuality';query.admit='admitQuality';
  query.definition.serviceName='WQX Water Quality';query.definition.queryParameters.push({name:'snapshot',type:'string',description:'Exact edition snapshot.',example:edition.snapshot});
  const downloadRoutes={},routes=[query];
  const editionBytes=await readBytes(join(edition.directory,'edition.json'),MAX_ASSET_BYTES);
  const assets=[...edition.downloads,{path:'edition.json',bytes:editionBytes.length,sha256:hash(editionBytes),contentType:'application/json'}];
  let total=0,maxResponseBytes=PAGE_BYTES;
  for(const item of assets){
    need(item.bytes<=MAX_ASSET_BYTES,'This original file exceeds the native 16 MiB response ceiling: '+item.path);total+=item.bytes;need(total<=MAX_ASSET_BUDGET,'Original assets exceed the native 64 MiB retained budget.');
    maxResponseBytes=Math.max(maxResponseBytes,item.bytes);
    const assetPath=item.path==='edition.json'?paths.edition:base+'/files/'+hash(item.path).slice(0,32);
    if(item.path!=='edition.json')downloadRoutes[item.path]=assetPath;
    routes.push({id:'wqx-file-'+hash(item.path).slice(0,16),path:assetPath,
      definition:{method:'GET',serviceName:'WQX Water Quality',description:'Exact retained '+item.path,payment},
      responseAsset:{file:item.path,sha256:item.sha256,contentType:item.contentType,downloadName:basename(item.path)}});
  }
  const config={...generated,publicOrigin:where.origin,routes,maxResponseBytes,assetBudgetBytes:MAX_ASSET_BUDGET};
  const offers=routes.map(route=>route.responseAsset?compileAssetRouteOffer(route,where.origin,compileHttpSellerOffer):compileHttpSellerOffer({...route.definition,url:where.origin+route.path}));
  const configBytes=json(config),offersBytes=json({resources:offers});
  const candidate={schema:PLAN,editionId:edition.editionId,snapshot:edition.snapshot,...where,payment:copy(payment),paths,downloadRoutes,configSha256:hash(configBytes),offersSha256:hash(offersBytes)};
  candidate.planSha256=digest(planIdentity(candidate));candidate.status='STAGED';
  return withPrivateLock(edition.directory,'merchant.lock',async()=>{
    const previous=await optional(join(edition.directory,'merchant-plan.json'));
    if(previous)need(canonical(previous)===canonical(candidate),'This edition already has different merchant terms. Prepare a new edition name for a changed offer.');
    await writeMember(edition.directory,'merchant-config.json',configBytes);await writeMember(edition.directory,'offers.json',offersBytes);
    await readSellerConfig(join(edition.directory,'merchant-config.json'));
    if(!previous)await atomicJson(edition.directory,'merchant-plan.json',candidate,{exclusive:true});
    return {...candidate,directory:edition.directory,offers:offers.length};
  });
}
async function readMerchant(directory){
  const edition=await readQualityEdition(directory),plan=await readPrivateJson(join(edition.directory,'merchant-plan.json'),4*1024*1024);
  need(plan.schema===PLAN&&plan.status==='STAGED'&&plan.planSha256===digest(planIdentity(plan))&&plan.editionId===edition.editionId&&plan.snapshot===edition.snapshot,'Stage the original immutable edition before operating it.');
  const configBytes=await readBytes(join(edition.directory,'merchant-config.json'),4*1024*1024),offersBytes=await readBytes(join(edition.directory,'offers.json'),4*1024*1024);
  need(hash(configBytes)===plan.configSha256&&hash(offersBytes)===plan.offersSha256,'Saved merchant configuration changed.');
  return {edition,plan,config:await readSellerConfig(join(edition.directory,'merchant-config.json')),offersBytes,offers:JSON.parse(offersBytes).resources};
}
function entries(query={}){
  const values=new Map();
  for(const [key,value] of query instanceof URLSearchParams?query:Object.entries(query)){
    need(typeof value==='string'&&!values.has(key),'Query values must be unique string parameters.');values.set(key,value);
  }return values;
}
export async function startQualityMerchant({editionDirectory,port=0,nativeFactory,facilitator,allowLocalFacilitator=false,challengeOnly=false}={}){
  need(!(nativeFactory&&facilitator)&&!(challengeOnly&&(nativeFactory||facilitator)),'Select one original native factory, facilitator or challenge mode.');
  const {edition,plan,config}=await readMerchant(editionDirectory),dataset=await loadDatasetConfig(join(edition.directory,'dataset.json'));
  need(dataset.describe().snapshot===edition.snapshot,'Original dataset changed.');
  const clean=context=>{const query=entries(context.query);if(query.has('snapshot')){need(query.get('snapshot')===edition.snapshot,'Snapshot differs from this edition.');query.delete('snapshot');}return {...context,query:new URLSearchParams([...query])};};
  const handlers={admitQuality(context){try{return dataset.admit(clean(context));}catch(error){return {status:400,body:{error:'WQX_QUERY_INVALID',message:error.message}};}},queryQuality:context=>dataset.handle(clean(context))};
  const factory=nativeFactory??(facilitator?await createWaterNativeFactory({facilitator,allowLocalFacilitator}):null);
  const session=await startSellerService({config,handlers,port,nativeFactory:factory});
  return {...session,merchantUrl:session.url,editionId:edition.editionId,snapshot:edition.snapshot,paths:plan.paths,downloadRoutes:plan.downloadRoutes,publicOrigin:plan.origin};
}
export async function qualityMerchantStatus(directory){const {edition,plan,offers}=await readMerchant(directory);return {editionId:edition.editionId,status:plan.status,snapshot:edition.snapshot,paths:plan.paths,offers:offers.length};}
function purchaseIdentity(p){
  return {schema:PURCHASE,editionId:p.editionId,captureSha256:p.captureSha256,snapshot:p.snapshot,planSha256:p.planSha256,kind:p.kind,file:p.file,intentId:p.intentId,url:p.url,previous:p.previous,expected:p.expected,configSha256:p.configSha256};
}
export async function prepareQualityPurchase({editionDirectory,intentId,query={},file,kind=file===undefined?'observations':'source',previous=null,acceptIndex=0}={}){
  need(typeof intentId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(intentId),'Use a stable original buyer intent.');
  const {edition,plan,offersBytes,offers}=await readMerchant(editionDirectory);
  need(['observations','source','edition'].includes(kind),'Choose observations, source or edition.');
  let route,expected=null;
  if(kind==='source'){need(file&&plan.downloadRoutes[file],'Select an exact edition source file.');route=plan.downloadRoutes[file];expected=edition.downloads.find(item=>item.path===file);}
  else{route=plan.paths[kind];if(kind==='edition'){const bytes=await readBytes(join(edition.directory,'edition.json'),MAX_ASSET_BYTES);expected={path:'edition.json',sha256:hash(bytes),bytes:bytes.length,contentType:'application/json'};}}
  const url=new URL(plan.origin+route);
  if(kind==='observations'){
    need(file===undefined,'A result query takes query parameters.');
    const selected=entries(query);need(!selected.has('snapshot')||selected.get('snapshot')===edition.snapshot,'The snapshot pin differs.');selected.set('snapshot',edition.snapshot);
    for(const [key,value]of selected)url.searchParams.append(key,value);url.searchParams.sort();validateDatasetQuery(url.href,{initial:previous===null});
    if(previous!==null)need(previous.snapshot===edition.snapshot&&previous.nextCursor!==null&&previous.nextCursor===url.searchParams.get('cursor'),'Continue with the preceding native metadata and next cursor.');
    const dataset=await loadDatasetConfig(join(edition.directory,'dataset.json')),params=new URLSearchParams(url.searchParams);params.delete('snapshot');const admission=dataset.admit({query:params});need(admission===true,admission?.body?.message??'Original dataset declined this query.');
  }else{need(entries(query).size===0&&previous===null,'Whole-file delivery takes no dataset query.');if(kind==='edition')need(file===undefined,'Edition delivery selects its manifest directly.');}
  const rowIndex=offers.findIndex(offer=>(typeof offer.resource==='string'?offer.resource:offer.resource.url)===plan.origin+route);
  const review=prepareReview(offersBytes,{rowIndex,acceptIndex,intentId,url:url.href,method:'GET'});
  const config={...review.draft,responseFile:expected?{maxBytes:Math.max(1,expected.bytes),expectedSha256:expected.sha256,expectedBytes:expected.bytes,expectedContentType:expected.contentType}:{maxBytes:PAGE_BYTES}};
  const prepared={schema:PURCHASE,editionId:edition.editionId,captureSha256:edition.captureSha256,snapshot:edition.snapshot,planSha256:plan.planSha256,kind,file:file??null,intentId,url:url.href,previous:previous===null?null:copy(previous),expected:expected===null?null:copy(expected),configSha256:hash(json(config)),config};
  prepared.purchaseSha256=digest(purchaseIdentity(prepared));
  const directory=join(edition.directory,'buyer-preparations',hash(intentId));await privateDirectory(directory);await writeMember(directory,'prepared.json',json(prepared));
  return {...prepared,editionDirectory:edition.directory,directory};
}
async function validatePrepared(prepared,directory){
  need(prepared?.schema===PURCHASE&&prepared.purchaseSha256===digest(purchaseIdentity(prepared))&&hash(json(prepared.config))===prepared.configSha256,'Prepared original buyer request changed.');
  const current=await prepareQualityPurchase({editionDirectory:directory,intentId:prepared.intentId,kind:prepared.kind,...(prepared.file===null?{}:{file:prepared.file}),query:prepared.kind==='observations'?new URL(prepared.url).searchParams:{},previous:prepared.previous,acceptIndex:prepared.config.preparedFrom.acceptIndex});
  need(current.purchaseSha256===prepared.purchaseSha256,'The prepared request belongs to another edition.');return current;
}
async function inspectDelivery(result,pin){
  result.raiseForStatus();const bytes=await result.bytes({limit:pin.expected?Math.max(1,pin.expected.bytes):PAGE_BYTES});
  if(pin.expected)need(bytes.length===pin.expected.bytes&&hash(bytes)===pin.expected.sha256,'Delivered file differs from the retained original.');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const isJson=pin.kind==='observations'||pin.expected?.contentType==='application/json';
  const value=isJson?JSON.parse(text):undefined;
  const metadata=pin.kind==='observations'?inspectDatasetPage(bytes,{url:pin.url,expectedSnapshot:pin.snapshot,previous:pin.previous}):{path:pin.expected.path,sha256:hash(bytes),bytes:bytes.length,contentType:pin.expected.contentType};
  return {result,intentId:pin.intentId,editionId:pin.editionId,captureSha256:pin.captureSha256,snapshot:pin.snapshot,kind:pin.kind,file:pin.file,url:pin.url,metadata,...(isJson?{value}: {textPreview:text.slice(0,4096),previewTruncated:text.length>4096}),...(pin.kind==='observations'?{rows:value.rows}:{})};
}
export async function purchaseQualityEdition({buyer,prepared,editionDirectory=prepared?.editionDirectory,signal}={}){
  need(buyer&&typeof buyer.fromConfig==='function'&&typeof buyer.operation==='function','Supply the original SF88 Buyer.');signal?.throwIfAborted();
  const current=await validatePrepared(prepared,editionDirectory),operation=await buyer.fromConfig(current.config),review=await operation.review();
  const binding={...purchaseIdentity(current),purchaseSha256:current.purchaseSha256,nativeConfigSha256:review.configSha256};
  const bindingFile=join(operation.directory,'wqx-edition.json'),retainedBinding=await optional(bindingFile);
  if(retainedBinding)need(canonical(retainedBinding)===canonical(binding),'This original intent has different WQX terms.');
  else {try{await atomicJson(operation.directory,'wqx-edition.json',binding,{exclusive:true});}catch(error){if(error.code!=='EEXIST')throw error;need(canonical(await readPrivateJson(bindingFile))===canonical(binding),'This original intent has different WQX terms.');}}
  return inspectDelivery(await operation.execute({review,signal}),binding);
}
export async function reopenQualityPurchase({buyer,intentId,editionDirectory}={}){
  need(buyer&&typeof buyer.operation==='function','Supply the original SF88 Buyer.');
  const operation=buyer.operation(intentId),binding=await readPrivateJson(join(operation.directory,'wqx-edition.json'),1048576);
  need(binding.schema===PURCHASE&&binding.intentId===intentId&&binding.purchaseSha256===digest(purchaseIdentity(binding)),'Original WQX buyer binding changed.');
  const {edition,plan}=await readMerchant(editionDirectory);
  need(binding.editionId===edition.editionId&&binding.captureSha256===edition.captureSha256&&binding.snapshot===edition.snapshot&&binding.planSha256===plan.planSha256,'Select the original purchased edition.');
  const configBytes=await readBytes(operation.configPath,65536),config=JSON.parse(configBytes);
  need(hash(configBytes)===binding.nativeConfigSha256&&config.operation.intentId===intentId&&config.operation.url===binding.url&&config.operation.method==='GET','Original buyer config changed.');
  const prepared=await prepareQualityPurchase({editionDirectory,intentId,kind:binding.kind,...(binding.file===null?{}:{file:binding.file}),query:binding.kind==='observations'?new URL(binding.url).searchParams:{},previous:binding.previous,acceptIndex:config.preparedFrom.acceptIndex});
  need(prepared.purchaseSha256===binding.purchaseSha256,'Original offer or selection changed.');
  const result=await operation.recover();if(result===null)return {state:'AWAITING_NATIVE_RESULT',intentId,editionId:edition.editionId};
  need(result.record.configSha256===binding.nativeConfigSha256,'Original result has another config.');return inspectDelivery(result,binding);
}
export async function exportQualityPurchase(args){
  const value=await reopenQualityPurchase(args);need(value.result,'This original intent has no retained delivery yet.');
  const bytes=await value.result.bytes({limit:value.metadata.bytes??PAGE_BYTES});
  return {bytes,mime:value.metadata.contentType??'application/json',filename:value.metadata.path?basename(value.metadata.path):args.intentId+'.json'};
}
