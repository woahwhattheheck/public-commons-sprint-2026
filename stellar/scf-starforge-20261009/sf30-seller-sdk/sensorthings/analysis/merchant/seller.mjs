// SPDX-License-Identifier: MIT
// Native SF30 file products over exact, already approved SensorThings publications.
import {join,dirname} from 'node:path';
import {readdir,lstat,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createAssetBundle,verifyAssetBundle,exportAssetCatalog} from '../../../asset-cli.mjs';
import {compileAssetRouteOffer,MAX_ASSET_BYTES,MAX_ASSET_BUDGET} from '../../../response-asset.mjs';
import {compileHttpSellerOffer} from '../../../seller.mjs';
import {readSellerConfig,startSellerService} from '../../../serve.mjs';
import {prepareReview} from '../../../../sf88-operator-buyer-cli/prepare.mjs';
import {privateDirectory} from '../../../stellar-expert/store.mjs';
import {identity,json,stable,sha,need,text,hash,absolute,fields,selected,descriptor,exactPath,exactFile,fileJSON,
  retainedPath,phase,freeze,makeRecord,verifyRecord,operationRoot,uniqueFiles} from './common.mjs';
import {describeFrozenSource,sourceBinding,verifyPublicationFiles,inspectIncomingProject,currentReviewMatches} from './source.mjs';
function chosenTerms(p){
  for(const [name,limit] of [['title',32],['description',1400],['license',1500],['reason',12000]])text(p[name],name,limit);
  need(/^[\x20-\x7e]+$/.test(p.title),'TITLE','The original SF30 service title requires 1–32 printable ASCII characters.',422);
  const u=new URL(p.origin);
  need(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&u.origin===p.origin,
    'ORIGIN','Select the actual public HTTPS origin.',422);
  need(typeof p.routePrefix==='string'&&/^\/[A-Za-z0-9_.~/-]+$/.test(p.routePrefix)&&!p.routePrefix.endsWith('/')&&
    !p.routePrefix.includes('//')&&!p.routePrefix.startsWith('/_seller')&&new URL(p.routePrefix,u).pathname===p.routePrefix,
    'ROUTE','Use an explicit fixed versioned native route prefix.',422);
  fields(p.payment,['scheme','network','asset','amount','payTo','maxTimeoutSeconds','extra']);
  need(['stellar:testnet','stellar:pubnet'].includes(p.payment.network),'NETWORK','Use an original SF88/SF47-supported Stellar network.',422);
  need(typeof p.payment.amount==='string'&&/^[0-9]+$/.test(p.payment.amount),'AMOUNT','Retain the exact atomic amount as a decimal string.',422);
  need(Array.isArray(p.companions)&&p.companions.length<=40&&new Set(p.companions).size===p.companions.length,
    'COMPANIONS','Select explicit distinct original publication files.',422);
  return {title:p.title,description:p.description,license:p.license,reason:p.reason,origin:p.origin,routePrefix:p.routePrefix,
    payment:structuredClone(p.payment),companions:[...p.companions]};
}
function routesFor(source,terms){
  const files=[{key:'project',name:'project.ndjson.gz',type:'application/gzip',file:source.exported.file},
    ...terms.companions.map((name,index)=>({key:'publication-'+index,name:'publication-'+name,
      type:source.publication.files.find(f=>f.name===name)?.type,
      file:source.publication.files.find(f=>f.name===name)}))];
  // Publication files have names, not record IDs.
  for(let i=1;i<files.length;i++)need(files[i].file,'COMPANION','The selected companion is absent from the original publication.',422);
  need(files.every(x=>x.file.bytes<=MAX_ASSET_BYTES)&&files.reduce((n,x)=>n+x.file.bytes,0)<=MAX_ASSET_BUDGET,
    'COMPLETE_FILE_CAPACITY','The complete selected files exceed the maintained native file-product limit. Preserve the full archive and use its original receiving route.',413);
  return files.map(x=>({...x,path:terms.routePrefix+'/'+encodeURIComponent(x.name),url:terms.origin+terms.routePrefix+'/'+encodeURIComponent(x.name)}));
}
function nativeConfig(store,source,terms){
  const routes=routesFor(source,terms),largest=Math.max(1024*1024,...routes.map(r=>r.file.bytes));
  return {schema:'stellar-forge.seller-service.v1',publicOrigin:terms.origin,maxResponseBytes:largest,
    assetBudgetBytes:Math.max(1,routes.reduce((n,r)=>n+r.file.bytes,0)),
    routes:routes.map(r=>({id:'analysis_'+r.key,path:r.path,definition:{method:'GET',serviceName:terms.title,
      description:terms.description+'\nUsage and attribution: '+terms.license+' ['+r.name+']',
      tags:['sensorthings','approved-analysis'],payment:structuredClone(terms.payment)},
      responseAsset:{file:retainedPath(store,r.file),sha256:r.file.sha256,contentType:r.type,downloadName:r.name}}))};
}
function portable(config){const value=structuredClone(config);for(const r of value.routes)r.responseAsset.file='assets/'+r.responseAsset.sha256+'.blob';return value;}
async function inventory(root,prefix=''){
  const found=[];
  for(const entry of (await readdir(join(root,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    need(entry.name!=='.'&&entry.name!=='..'&&!/[\\/\0]/.test(entry.name),'BUNDLE_PATH','The native bundle contains an invalid path.');
    const path=prefix?prefix+'/'+entry.name:entry.name,absolutePath=join(root,path),stat=await lstat(absolutePath);
    need(!stat.isSymbolicLink(),'BUNDLE_PATH','The complete native bundle contains a link.');
    if(stat.isDirectory())found.push(...await inventory(root,path));
    else{need(stat.isFile()&&stat.size<=MAX_ASSET_BYTES,'BUNDLE_FILE','The complete native bundle contains an unsupported file.');
      const raw=await readFile(absolutePath);await exactPath(absolutePath,{bytes:raw.length,sha256:sha(raw)},MAX_ASSET_BYTES);
      found.push({path,bytes:raw.length,sha256:sha(raw)});}
  }
  need(found.length<=10000,'BUNDLE_CAPACITY','The complete native bundle exceeds its file bound.',413);return found;
}
async function verifyConfig(root,config){
  const verified=await verifyAssetBundle(root),actual=JSON.parse((await readFile(join(root,'seller.json'))).toString('utf8'));
  need(stable(actual)===stable(portable(config)),'BUNDLE_CONFIG','The native bundle has different reviewed routes, payment terms or file identities.');
  for(let i=0;i<config.routes.length;i++)need(stable(compileAssetRouteOffer(config.routes[i],config.publicOrigin,compileHttpSellerOffer))===
    stable(compileAssetRouteOffer(actual.routes[i],actual.publicOrigin,compileHttpSellerOffer)),
    'NATIVE_OFFER','The compiled native offer differs from its original reviewed selection.');
  return verified;
}
async function catalogFor(root){
  const config=await readSellerConfig(join(root,'seller.json')),manifest=JSON.parse((await readFile(join(root,'manifest.json'))).toString('utf8'));
  return {resources:config.routes.filter(r=>r.definition.method==='GET').map(route=>{
    const native=compileAssetRouteOffer(route,config.publicOrigin,compileHttpSellerOffer),asset=manifest.assets.find(a=>a.routeId===route.id);
    need(asset,'NATIVE_CATALOG','The native manifest omits a compiled route.');
    const {file,routeId,...metadata}=asset;
    return {...native,type:'http',extensions:{...native.extensions,'stellar-forge-asset':{schema:'stellar-forge.asset-product.v1',...metadata}}};
  })};
}
export async function materializeBundle(store,record){
  const bundle=record.value.bundle,target=join(store.root,'merchant-runtime',record.id);
  await privateDirectory(target,{create:true});
  for(const row of bundle.files){
    need(typeof row.path==='string'&&/^(?:seller\.json|manifest\.json|assets\/[a-f0-9]{64}\.blob)$/.test(row.path),
      'BUNDLE_PATH','The retained native bundle has another path.');
    const raw=await exactFile(store,row.file,MAX_ASSET_BYTES);
    await privateDirectory(dirname(join(target,row.path)),{create:true});await store.immutable(join(target,row.path),raw);
  }
  const expected=bundle.files.map(x=>({path:x.path,bytes:x.file.bytes,sha256:x.file.sha256})).sort((a,b)=>a.path.localeCompare(b.path));
  need(stable(await inventory(target))===stable(expected),'BUNDLE_CLOSURE','The reconstructed native bundle differs from its retained complete files.');
  const config=nativeConfig(store,record.value.source,record.value.terms),verified=await verifyConfig(target,config);
  need(verified.configSha256===bundle.configSha256,'BUNDLE_IDENTITY','The native bundle config changed.');
  return {directory:target,verified,config:await readSellerConfig(join(target,'seller.json'))};
}
export async function publishOffer(store,op){
  const terms=chosenTerms(op.payload),selection=op.context.analysis.merchant.source;
  currentReviewMatches(store.read(),selection);
  const source=await phase(store,op,'source',()=>describeFrozenSource(store,selection));
  need(identity(source.publication)===op.payload.expectedPublicationSha256&&source.exported.file.sha256===op.payload.expectedArchiveSha256,
    'SOURCE_CHANGED','The original frozen source differs from this request.');
  const config=nativeConfig(store,source,terms);
  for(const route of config.routes)compileAssetRouteOffer(route,terms.origin,compileHttpSellerOffer);
  await phase(store,op,'seller-config',async()=>({config:portable(config)}));
  const built=await phase(store,op,'native-bundle',async()=>{
    const root=operationRoot(store,op);await privateDirectory(root,{create:true});
    const candidate=join(root,'merchant-native-build-'+randomUUID());
    await createAssetBundle(config,{configDir:root,out:candidate});
    // A bounded deterministic native build is local derivation, never a new capture or payment.
    // Incomplete prior candidates remain retained; only this fully checked owned candidate is retired.
    const verified=await verifyConfig(candidate,config),files=[];
    for(const row of await inventory(candidate)){
      const raw=await exactPath(join(candidate,row.path),row,MAX_ASSET_BYTES),
        file=await freeze(store,op,'bundle-'+sha(row.path)+'.bin',raw,'application/octet-stream',{nativePath:row.path});
      files.push({path:row.path,file});
    }
    const catPath=join(candidate,'catalog.json');await exportAssetCatalog(candidate,catPath);
    const raw=await readFile(catPath),actual=JSON.parse(raw);
    need(stable(actual)===stable(await catalogFor(candidate)),'NATIVE_CATALOG','The actual catalog differs from the compiled native file offers.');
    const catalog=await freeze(store,op,'catalog.json',raw,'application/json',{nativeConfigSha256:verified.configSha256});
    await rm(candidate,{recursive:true,force:false});
    return {files,configSha256:verified.configSha256,catalog};
  });
  currentReviewMatches(store.read(),selection);
  const routes=routesFor(source,terms).map(r=>({key:r.key,name:r.name,type:r.type,path:r.path,url:r.url,bytes:r.file.bytes,sha256:r.file.sha256})),
    value={source,binding:sourceBinding(source),terms,routes,bundle:{files:built.files,configSha256:built.configSha256},catalog:built.catalog,
      execution:'OFFER_PREPARED',meaning:'Original native file offer. No payment, buyer execution or customer acceptance was performed.'};
  const record=await makeRecord(store,op,{kind:'offer',projectId:source.publication.projectId,versionId:source.publication.versionId,
    publicationId:source.publication.id,value,files:[source.exported.file,...source.publication.files,...built.files.map(x=>x.file),built.catalog]});
  await inspectOffer(store,record);return record;
}
export async function inspectOffer(store,record){
  const proof=await verifyRecord(store,record);need(record.kind==='offer'&&proof.action==='analysis.merchant.offer','OFFER','Select the original seller offer.');
  const {source,terms}=record.value;
  need(stable(terms)===stable(chosenTerms(proof.payload))&&identity(source.publication)===proof.payload.expectedPublicationSha256&&
    source.exported.file.sha256===proof.payload.expectedArchiveSha256&&source.publication.id===record.publicationId&&
    source.publication.projectId===record.projectId&&source.publication.versionId===record.versionId&&
    stable(record.value.binding)===stable(sourceBinding(source)),'OFFER_SOURCE','The offer differs from its original publication/export/terms selection.');
  await verifyPublicationFiles(store,source.publication);
  const incoming=await inspectIncomingProject(store,{path:retainedPath(store,source.exported.file),expectedSha256:source.exported.file.sha256,
    expectedBytes:source.exported.file.bytes,publicationId:record.publicationId,expectedPublicationSha256:identity(source.publication)});
  need(stable(incoming.binding)===stable(record.value.binding),'OFFER_ARCHIVE','The offered complete project archive has another original binding.');
  const native=await materializeBundle(store,record),catalog=await fileJSON(store,record.value.catalog,1024*1024);
  need(stable(catalog.value)===stable(await catalogFor(native.directory)),'NATIVE_CATALOG','The retained catalog differs from its original native bundle.');
  return {record,recordSha256:identity(record),availability:'VERIFIED',catalog:catalog.value,bundle:native.verified};
}
export async function prepareBuyer(store,op,offer){
  const inspected=await inspectOffer(store,offer);
  need(identity(offer)===op.payload.expectedOfferSha256,'OFFER_CHANGED','The selected offer changed after review.');
  const route=offer.value.routes.find(r=>r.key===op.payload.file);
  need(route&&Number.isSafeInteger(op.payload.rowIndex)&&offer.value.routes[op.payload.rowIndex]?.key===route.key,
    'BUYER_FILE','Select an exact original native catalog row and file.',422);
  text(op.payload.intentId,'the original buyer intent ID',128);absolute(op.payload.responseOut,'buyer response destination');
  need(Number.isSafeInteger(op.payload.acceptIndex)&&op.payload.acceptIndex>=0,'BUYER_TERMS','Select the original payment option.',422);
  const raw=await exactFile(store,offer.value.catalog,1024*1024),
    prepared=prepareReview(raw,{rowIndex:op.payload.rowIndex,acceptIndex:op.payload.acceptIndex,intentId:op.payload.intentId,
      url:route.url,method:'GET',responseOut:op.payload.responseOut});
  const file=await freeze(store,op,'buyer-review.json',prepared.data,'application/json',{offerId:offer.id,configSha256:prepared.configSha256});
  return makeRecord(store,op,{kind:'buyer-preparation',projectId:offer.projectId,versionId:offer.versionId,publicationId:offer.publicationId,
    value:{offerId:offer.id,offerSha256:identity(offer),file:route.key,catalog:offer.value.catalog,review:prepared.draft,
      configSha256:prepared.configSha256,config:file,intentId:op.payload.intentId,execution:'NOT_DISPATCHED'},
    files:[file,offer.value.catalog]});
}
export async function startOffer(store,offer,runtime={}){
  await inspectOffer(store,offer);const native=await materializeBundle(store,offer);
  const service=await startSellerService({config:native.config,port:runtime.port??0,nativeFactory:runtime.nativeFactory??null,
    maxInFlight:runtime.maxInFlight??4,drainGraceMs:runtime.drainGraceMs??60000});
  return service;
}
