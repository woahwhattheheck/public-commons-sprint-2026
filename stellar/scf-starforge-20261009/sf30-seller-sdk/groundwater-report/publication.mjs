// SPDX-License-Identifier: MIT
// The original SF30 file-product compiler owns routes, exact terms and immutable delivery.
import {join,resolve,dirname} from 'node:path';
import {mkdir,readdir,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createAssetBundle,verifyAssetBundle,exportAssetCatalog} from '../asset-cli.mjs';
import {compileAssetRouteOffer,MAX_ASSET_BYTES,MAX_ASSET_BUDGET} from '../response-asset.mjs';
import {compileHttpSellerOffer} from '../seller.mjs';
import {readSellerConfig,startSellerService} from '../serve.mjs';
import {prepareReview} from '../../sf88-operator-buyer-cli/prepare.mjs';
import {SCHEMA,MAX_FILE,sha,json,canonical,now,need,fields,text,ident,digest,absolute,
  read,readJSON,put,exists,checkFile,directory,inventory,ownedOperation,phase,finish,operation,core} from './common.mjs';

const FORMATS={zip:{mime:'application/zip',name:'report.zip'},json:{mime:'application/json',name:'report.json'},
  html:{mime:'text/html',name:'report.html'},csv:{mime:'text/csv',name:'results.csv'}};
export function sourceBinding(source){
  return {workspaceId:source.workspaceId,projectId:source.project.id,reportId:source.report.id,
    reportSha256:source.report.sha256,runId:source.run.id,sourceSha256:source.run.sourceSha256,
    editionSha256:source.run.editionSha256,resultSha256:source.run.resultSha256,
    manifestSha256:source.manifest.sha256,archiveSha256:source.exports.zip.sha256,archiveBytes:source.exports.zip.bytes};
}
function selection(input){
  fields(input,['reportId','expectedReportSha256','expectedManifestSha256','expectedArchiveSha256','title','description',
    'license','reason','formats','origin','routePrefix','payment'],'report publication');
  ident(input.reportId,'original report ID');for(const key of ['expectedReportSha256','expectedManifestSha256','expectedArchiveSha256'])digest(input[key],key);
  for(const [key,max]of [['title',32],['description',1400],['license',1500],['reason',8000]])text(input[key],key,max);
  need(/^[\x20-\x7e]+$/.test(input.title),'PUBLIC_TITLE','Use 1–32 printable ASCII characters for the maintained service title.',422);
  const formats=input.formats;
  need(Array.isArray(formats)&&formats.length>=1&&formats.length<=4&&new Set(formats).size===formats.length&&formats.every(x=>FORMATS[x])&&formats.includes('zip'),
    'FORMAT_SELECTION','Select the complete ZIP and any explicitly priced companion formats.',422);
  const u=new URL(input.origin);
  need(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&u.origin===input.origin,
    'PUBLIC_ORIGIN','Select the actual public HTTPS origin.',422);
  need(typeof input.routePrefix==='string'&&/^\/[A-Za-z0-9_.~/-]+$/.test(input.routePrefix)&&!input.routePrefix.endsWith('/')&&
    !input.routePrefix.includes('//')&&!input.routePrefix.startsWith('/_seller')&&new URL(input.routePrefix,u).pathname===input.routePrefix,
    'PUBLIC_PATH','Use an explicit fixed versioned route prefix.',422);
  need(['stellar:testnet','stellar:pubnet'].includes(input.payment?.network),'SUPPORTED_BUYER_NETWORK','Use the original Stellar network supported by this SF88-to-SF47 receiving contract.',422);
  fields(input.payment,['scheme','network','asset','amount','payTo','maxTimeoutSeconds','extra'],'public payment terms');
  need(typeof input.payment.amount==='string'&&/^[0-9]+$/.test(input.payment.amount),'EXACT_PAYMENT_AMOUNT','Retain the original atomic amount as a decimal string.',422);
  return structuredClone(input);
}
function verifySelection(source,input){
  need(source.report.id===input.reportId&&source.report.sha256===input.expectedReportSha256&&source.manifest.sha256===input.expectedManifestSha256&&
    source.exports.zip.sha256===input.expectedArchiveSha256,'REPORT_CHANGED','The selected frozen report differs from the reviewed identity.');
  for(const format of input.formats)need(source.exports[format].bytes<=MAX_ASSET_BYTES,'REPORT_FILE_LIMIT',
    'This complete file exceeds the maintained 16 MiB file-product limit. Keep it whole and use the separately maintained large-object workflow.',413);
  need(input.formats.reduce((n,k)=>n+source.exports[k].bytes,0)<=MAX_ASSET_BUDGET,'REPORT_BUDGET','The selected file snapshots exceed the maintained aggregate bound.',413);
}
export async function describeReport(workspace,reportId,runtime){
  absolute(workspace,'original groundwater workspace');ident(reportId,'original report ID');
  return core('describe',{workspace,reportId},runtime);
}
export async function listReports(workspace,runtime){absolute(workspace,'original groundwater workspace');return core('list',{workspace},runtime);}
async function catalogFor(bundle){
  const config=await readSellerConfig(join(bundle,'seller.json')),verified=await verifyAssetBundle(bundle);
  const origin=config.publicOrigin;
  need(origin,'PUBLIC_ORIGIN','The frozen file product has no public origin.');
  const manifest=(await readJSON(join(bundle,'manifest.json'))).value;
  const resources=config.routes.filter(r=>r.definition.method==='GET').map(route=>{
    const offer=compileAssetRouteOffer(route,origin,compileHttpSellerOffer);
    const row=manifest.assets.find(a=>a.routeId===route.id);
    return {...offer,type:'http',extensions:{...offer.extensions,'stellar-forge-asset':{
      schema:'stellar-forge.asset-product.v1',sha256:row.sha256,bytes:row.bytes,contentType:row.contentType,downloadName:row.downloadName}}};
  });
  return {config,verified,catalog:{resources}};
}
function sellerConfig(op,selected,chosen){
  const largest=Math.max(1024*1024,...chosen.formats.map(k=>selected.exports[k].bytes));
  return {schema:'stellar-forge.seller-service.v1',publicOrigin:chosen.origin,maxResponseBytes:largest,
    assetBudgetBytes:Math.max(1,chosen.formats.reduce((n,k)=>n+selected.exports[k].bytes,0)),
    routes:chosen.formats.map(format=>({id:'groundwater_'+format,path:chosen.routePrefix+'/'+FORMATS[format].name,
      definition:{method:'GET',description:chosen.description+'\nUsage and attribution: '+chosen.license+' ['+format.toUpperCase()+']',
        serviceName:chosen.title,tags:['groundwater','frozen-report'],payment:chosen.payment},
      responseAsset:{file:join(op.root,'frozen',FORMATS[format].name),sha256:selected.exports[format].sha256,
        contentType:FORMATS[format].mime,downloadName:FORMATS[format].name}}))};
}
function portable(config){
  const result=structuredClone(config);
  for(const route of result.routes)route.responseAsset.file='assets/'+route.responseAsset.sha256+'.blob';
  return result;
}
async function verifyFrozenBundle(target,config){
  const verified=await verifyAssetBundle(target),actual=(await readJSON(join(target,'seller.json'))).value;
  need(canonical(actual)===canonical(portable(config)),'FROZEN_BUNDLE_CONFLICT',
    'The valid retained bundle names different routes, payment terms or report asset bytes.');
  for(let i=0;i<config.routes.length;i++){
    const expected=compileAssetRouteOffer(config.routes[i],config.publicOrigin,compileHttpSellerOffer),
      observed=compileAssetRouteOffer(actual.routes[i],actual.publicOrigin,compileHttpSellerOffer);
    need(canonical(expected)===canonical(observed),'FROZEN_OFFER_CONFLICT','The native public offer differs from its frozen report selection.');
  }
  return verified;
}
async function exactBundle(op,config){
  const target=join(op.root,'bundle');
  if(await exists(target)){
    let valid=false;try{await verifyAssetBundle(target);valid=true;}catch{}
    if(valid)return verifyFrozenBundle(target,config);
  }
  // A fresh native build derives only the already frozen, digest-checked bytes.
  // The original writer lease excludes a still-running earlier build. Repair fills
  // missing identical members; it never overwrites or removes a retained member.
  const candidate=join(op.root,'bundle-build-'+randomUUID());
  await createAssetBundle(config,{configDir:op.root,out:candidate});
  const expected=await inventory(candidate),byPath=new Map(expected.map(row=>[row.path,row]));
  await directory(target,{create:true});
  for(const old of await inventory(target)){
    const wanted=byPath.get(old.path);need(wanted&&wanted.bytes===old.bytes&&wanted.sha256===old.sha256,
      'PARTIAL_BUNDLE_CONFLICT','The retained partial bundle contains different original bytes.');
  }
  for(const row of [...expected].sort((a,b)=>(a.path==='manifest.json')-(b.path==='manifest.json'))){
    await put(join(target,row.path),await checkFile(join(candidate,row.path),row,MAX_FILE));
  }
  const result=await verifyFrozenBundle(target,config);
  need(canonical(await inventory(target))===canonical(expected),'BUNDLE_CLOSURE','The complete original bundle member set differs.');
  await rm(candidate,{recursive:true,force:false});
  return result;
}
export async function publishReport({desk,operationId,actor,workspace,input,runtime={}}){
  const chosen=selection(input);absolute(workspace,'original groundwater workspace');
  return ownedOperation(desk,operationId,'publish',actor,{workspace,...chosen},async op=>{
    if(await exists(join(op.root,'result.json')))return inspectPublication(desk,operationId,runtime);
    const selected=(await phase(op,'source',()=>describeReport(workspace,chosen.reportId,runtime))).value;
    verifySelection(selected,chosen);
    await directory(join(op.root,'frozen'),{create:true});
    // The full ZIP is retained once, even when companions are sold separately.
    for(const format of chosen.formats){
      const original=selected.exports[format],destination=join(op.root,'frozen',FORMATS[format].name);
      if(await exists(destination))await checkFile(destination,original);
      else await put(destination,await checkFile(original.path,original));
    }
    await core('inspect',{archive:join(op.root,'frozen','report.zip'),expected:sourceBinding(selected)},runtime);
    const config=sellerConfig(op,selected,chosen);
    // Compile and validate every term through the maintained original compiler.
    for(const route of config.routes)compileAssetRouteOffer(route,chosen.origin,compileHttpSellerOffer);
    await phase(op,'seller-config',async()=>({config,sha256:sha(json(config))}));
    await exactBundle(op,config);
    const catalogPath=join(op.root,'catalog.json');
    if(!await exists(catalogPath)){
      const candidate=join(op.root,'catalog-build-'+randomUUID()+'.json');
      await exportAssetCatalog(join(op.root,'bundle'),candidate);
      await put(catalogPath,await read(candidate,1024*1024));await rm(candidate);
    }
    const native=await catalogFor(join(op.root,'bundle')),catalog=await readJSON(catalogPath);
    need(canonical(catalog.value)===canonical(native.catalog),'CATALOG_IDENTITY','The retained catalog differs from the original native file offers.');
    const artifacts=await inventory(join(op.root,'bundle'));
    const publication={schema:'stellar-forge.groundwater-report-publication.v1',id:operationId,deskId:desk.meta.id,
      operationSha256:op.request.bodySha256,createdAt:op.request.createdAt,actor,
      public:{title:chosen.title,description:chosen.description,license:chosen.license,origin:chosen.origin},
      review:{reason:chosen.reason,reportSha256:selected.report.sha256,manifestSha256:selected.manifest.sha256},
      source:selected,binding:sourceBinding(selected),formats:chosen.formats.map(format=>({format,...FORMATS[format],
        sha256:selected.exports[format].sha256,bytes:selected.exports[format].bytes,
        route:chosen.routePrefix+'/'+FORMATS[format].name,url:chosen.origin+chosen.routePrefix+'/'+FORMATS[format].name})),
      bundle:{path:'bundle',files:artifacts,configSha256:native.verified.configSha256},
      catalog:{path:'catalog.json',sha256:catalog.sha256,bytes:catalog.bytes},
      paymentInterpretation:'The configured terms are a seller offer. This publication records no payment, purchase, useful-use decision or customer acceptance.'};
    await put(join(op.root,'publication.json'),publication);
    await finish(op,{kind:'publication',publication:'publication.json',publicationSha256:sha(json(publication)),
      reportId:chosen.reportId,bundleConfigSha256:native.verified.configSha256,catalogSha256:catalog.sha256});
    return inspectPublication(desk,operationId,runtime);
  });
}
export async function inspectPublication(desk,id,runtime={}){
  const op=await operation(desk,id);need(op.request.body.action==='publish'&&op.result,'PUBLICATION_INCOMPLETE','The original publication is incomplete.');
  const saved=await readJSON(join(op.root,'publication.json')),p=saved.value;
  need(p.schema==='stellar-forge.groundwater-report-publication.v1'&&p.id===id&&p.operationSha256===op.request.bodySha256&&
    op.result.result.publicationSha256===saved.sha256,'PUBLICATION_IDENTITY','The publication receipt differs from its original operation.');
  verifySelection(p.source,op.request.body.input);
  const selected=(await readJSON(join(op.root,'source.phase.json'))).value,
    frozen=(await readJSON(join(op.root,'seller-config.phase.json'))).value;
  need(selected.operationSha256===op.request.bodySha256&&canonical(selected.value)===canonical(p.source)&&
    frozen.operationSha256===op.request.bodySha256&&frozen.value.sha256===sha(json(frozen.value.config)),
    'FROZEN_SOURCE_CONFLICT','The original source or seller-config phase differs.');
  const expected=sellerConfig(op,p.source,op.request.body.input);
  need(canonical(portable(frozen.value.config))===canonical(portable(expected)),
    'FROZEN_CONFIG_CONFLICT','The native configuration differs from the original source, formats and publication review.');
  await verifyFrozenBundle(join(op.root,p.bundle.path),expected);
  need(canonical(p.binding)===canonical(sourceBinding(p.source)),'REPORT_BINDING','The original report binding differs.');
  await core('inspect',{archive:join(op.root,'frozen','report.zip'),expected:p.binding},runtime);
  for(const row of p.formats)await checkFile(join(op.root,'frozen',row.name),row);
  const native=await catalogFor(join(op.root,p.bundle.path));
  need(native.verified.configSha256===p.bundle.configSha256&&canonical(await inventory(join(op.root,p.bundle.path)))===canonical(p.bundle.files),
    'BUNDLE_IDENTITY','The original complete asset bundle is unavailable or changed.');
  const catalog=await checkFile(join(op.root,p.catalog.path),p.catalog,1024*1024);
  need(canonical(JSON.parse(catalog))===canonical(native.catalog),'CATALOG_IDENTITY','The catalog differs from its original bundle.');
  return {state:'COMPLETE',operationId:id,root:op.root,publication:p,publicationSha256:saved.sha256,
    originalResult:op.result,availability:'VERIFIED',catalog:native.catalog};
}
export async function prepareBuyer({desk,operationId,actor,publicationId,format,acceptIndex,intentId,responseOut,runtime={}}){
  text(intentId,'original buyer intent',128);absolute(responseOut,'buyer-selected response destination');
  need(Number.isSafeInteger(acceptIndex)&&acceptIndex>=0,'PAYMENT_SELECTION','Select the original accepted payment option.',422);
  return ownedOperation(desk,operationId,'buyer-prepare',actor,{publicationId,format,acceptIndex,intentId,responseOut},async op=>{
    const publication=await inspectPublication(desk,publicationId,runtime);
    const rowIndex=publication.publication.formats.findIndex(x=>x.format===format);
    need(rowIndex>=0,'FORMAT_SELECTION','Select a format from this exact publication.',422);
    const raw=await checkFile(join(publication.root,'catalog.json'),publication.publication.catalog,1024*1024);
    const route=publication.publication.formats[rowIndex];
    const prepared=prepareReview(raw,{rowIndex,acceptIndex,intentId,url:route.url,method:'GET',responseOut});
    await put(join(op.root,'buyer-review.json'),prepared.data);
    const result={kind:'buyer-preparation',publicationId,publicationSha256:publication.publicationSha256,
      format,intentId,config:{path:'buyer-review.json',bytes:prepared.data.length,sha256:prepared.configSha256},
      review:prepared.draft,execution:'NOT_DISPATCHED'};
    await finish(op,result);return {...result,operationId,root:op.root};
  });
}
export async function startPublication({desk,publicationId,runtime={},nativeFactory=null,port=0,maxInFlight=4,handleSignals=true}){
  const original=await inspectPublication(desk,publicationId,runtime);
  const config=await readSellerConfig(join(original.root,'bundle','seller.json'));
  const service=await startSellerService({config,port,nativeFactory,maxInFlight});
  let closing;
  const close=()=>closing??=(async()=>{try{return await service.close();}finally{for(const signal of ['SIGINT','SIGTERM'])process.off(signal,onSignal);}})();
  const onSignal=()=>{void close().catch(()=>{process.exitCode=1;});};
  if(handleSignals)for(const signal of ['SIGINT','SIGTERM'])process.on(signal,onSignal);
  return {...service,close,publicationId,publicationSha256:original.publicationSha256};
}

export async function prepareCatalogBuyer({desk,operationId,actor,catalog,rowIndex,acceptIndex,intentId,responseOut}){
  absolute(responseOut,'buyer-selected response path');text(intentId,'original buyer intent',128);
  need(Buffer.isBuffer(catalog)&&catalog.length>0&&catalog.length<=1048576,'CATALOG_BOUND','Select the complete original public catalog.',413);
  const original={rowIndex,acceptIndex,intentId,responseOut,catalog:{bytes:catalog.length,sha256:sha(catalog)}};
  return ownedOperation(desk,operationId,'catalog-buyer-prepare',actor,original,async op=>{
    await put(join(op.root,'catalog.json'),catalog);
    if(await exists(join(op.root,'result.json'))){
      const saved=(await operation(desk,operationId)).result;
      await checkFile(join(op.root,'buyer-review.json'),saved.result.config,1048576);return {...saved.result,operationId,root:op.root};
    }
    const prepared=prepareReview(catalog,{rowIndex,acceptIndex,intentId,responseOut});
    const asset=prepared.draft.preparedFrom.originalListing.extensions?.['stellar-forge-asset'];
    need(asset&&asset.contentType==='application/zip','COMPLETE_REPORT_REQUIRED','Select the exact complete ZIP file offer.');
    await put(join(op.root,'buyer-review.json'),prepared.data);
    const result={kind:'buyer-preparation',source:'ORIGINAL_PUBLIC_CATALOG',intentId,catalog:original.catalog,asset,
      config:{path:'buyer-review.json',bytes:prepared.data.length,sha256:prepared.configSha256},review:prepared.draft,execution:'NOT_DISPATCHED'};
    await finish(op,result);return {...result,operationId,root:op.root};
  });
}
