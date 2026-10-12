// MIT. Superset customer receiving through the original SF88 acquisition and SF100 export.
import {join,resolve,relative,sep} from 'node:path';
import {readdir,realpath} from 'node:fs/promises';
import {readSupersetMerchant} from './merchant.mjs';
import {readDatasetBuyerOffer,prepareDatasetBuyer} from '../dataset-refresh/buyer-handoff.mjs';
import {inspectDatasetSession,deliverDatasetSession} from '../../sf88-operator-buyer-cli/dataset-session.mjs';
import {scan as scanOriginalDataset} from '../../sf100-buyer-dataset-delivery/deliver.mjs';
import {absolute,object,bytes,digest,identity,readJson,readPrivate,hashPrivate,privateDirectory,
  acquireWorkspace,saveExact,separated,fault,MiB} from './files.mjs';
function firstQuery(query={}){
  if(!object(query)||Object.entries(query).some(([key,value])=>typeof value!=='string'||['snapshot','cursor'].includes(key)))
    throw fault('SUPERSET_CUSTOMER_QUERY','Use original first-page query parameters; the approved edition supplies its snapshot.');
  const text=new URLSearchParams(Object.entries(query)).toString();
  if(text.length>8192)throw fault('SUPERSET_CUSTOMER_QUERY','The original query exceeds its URL limit.');
  return text;
}
function selected(prepared){
  return{workspaceId:prepared.source.workspaceId,edition:prepared.source.edition,snapshot:prepared.description.snapshot,
    source:prepared.source.capture.source,query:prepared.lineage.query,selection:prepared.lineage.selection,
    sourceSha256:prepared.binding.sourceSha256,review:prepared.source.review};
}
export async function reviewSupersetBuyer({directory,seller,query={}}={}){
  const prepared=await readSupersetMerchant(directory);
  const resource=prepared.service.publicOrigin+prepared.service.routes[0].path;
  const review=await readDatasetBuyerOffer({seller,resource,snapshot:prepared.description.snapshot,query:firstQuery(query)});
  return{...review,selected:selected(prepared)};
}
export async function prepareSupersetBuyer({directory,seller,query={},intentId,acceptIndex,offerSha256,destination}={}){
  const review=await reviewSupersetBuyer({directory,seller,query});
  const prepared=prepareDatasetBuyer(review,{intentId,acceptIndex,offerSha256});
  const raw=Buffer.from(prepared.configText);
  if(digest(raw)!==prepared.configSha256)throw fault('SUPERSET_BUYER_CONFIG_CHANGED','The original prepared buyer configuration differs.',409);
  const saved=await saveExact(absolute(destination),raw);
  await saveExact(saved.path+'.superset.json',{schema:'stellar-forge.superset-buyer-selection.v1',
    selected:review.selected,url:prepared.url,offerSha256,configurationSha256:prepared.configSha256});
  return{...prepared,selected:review.selected,saved};
}
async function descriptor(root,name){
  if(await realpath(join(root,name))!==join(root,name))throw fault('SUPERSET_DELIVERY_PATH','Use original delivery files without symlink components.');
  const file=await hashPrivate(join(root,name),512*MiB);
  return{path:name,bytes:file.bytes,sha256:file.hash};
}
export async function receiveSupersetBuyer({directory,sessionDirectory,destination,includeSourceCaptures=false}={}){
  if(typeof includeSourceCaptures!=='boolean')throw new TypeError('includeSourceCaptures must be a boolean.');
  const prepared=await readSupersetMerchant(directory);
  sessionDirectory=absolute(sessionDirectory);destination=absolute(destination);
  separated(destination,prepared.directory);separated(destination,sessionDirectory);
  const report=await inspectDatasetSession(sessionDirectory);
  if(report.status!=='COMPLETE'||report.snapshot!==prepared.description.snapshot||!report.pages.length)
    throw fault('SUPERSET_BUYER_COMPLETE','Complete the original acquisition of the selected snapshot.',409);
  const resource=prepared.service.publicOrigin+prepared.service.routes[0].path;
  for(const page of report.pages){
    const url=new URL(page.requestUrl);
    if(url.origin+url.pathname!==resource||url.searchParams.get('snapshot')!==prepared.description.snapshot||
        (url.searchParams.has('semantics')&&url.searchParams.get('semantics')!==prepared.edition.semanticsSha256))
      throw fault('SUPERSET_BUYER_BINDING','An acquired page belongs to another resource, snapshot or reviewed meaning.',409);
  }
  await privateDirectory(destination,true);const unlock=await acquireWorkspace(destination);
  try{
    await saveExact(join(destination,'receiving-intent.json'),{schema:'stellar-forge.superset-customer-intent.v1',
      sessionId:report.sessionId,configurationSha256:report.configurationSha256,selected:selected(prepared),includeSourceCaptures});
    const native=await deliverDatasetSession(sessionDirectory,join(destination,'dataset'));
    const lineage={schema:'stellar-forge.superset-customer-lineage.v1',selected:selected(prepared),
      acquisition:{sessionId:report.sessionId,configurationSha256:report.configurationSha256,snapshot:report.snapshot,
        firstRequestUrl:report.pages[0].requestUrl,pages:report.completedPages,rows:report.acquiredRows,
        sourceBindingSha256:native.sourceBindingSha256,paymentStatus:native.paymentStatus,nativeExporterBlob:native.nativeBlob},
      includeSourceCaptures,
      outputs:Object.fromEntries(Object.entries(native.outputs).map(([name,file])=>[name,{path:'dataset/'+name,bytes:file.bytes,sha256:file.sha256}]))};
    await saveExact(join(destination,'superset-lineage.json'),lineage);
    const files=[],names=new Set();
    const add=async name=>{if(!names.has(name)){names.add(name);files.push(await descriptor(destination,name));}};
    await add('dataset/session.json');
    for(const name of (await readdir(join(destination,'dataset/pages'))).sort())await add('dataset/pages/'+name);
    for(const name of Object.keys(native.outputs))await add('dataset/'+name);
    await add('superset-lineage.json');
    if(includeSourceCaptures){
      for(const member of prepared.sourceFiles){
        const name='source/'+member.path,raw=await readPrivate(join(prepared.directory,member.path),member.bytes);
        if(raw.length!==member.bytes||digest(raw)!==member.sha256)throw fault('SUPERSET_DELIVERY_SOURCE_CHANGED','An original source member changed.',409);
        await saveExact(join(destination,name),raw);await add(name);
      }
      await saveExact(join(destination,'source/source.json'),prepared.retained['source.json']);await add('source/source.json');
    }
    files.sort((a,b)=>a.path.localeCompare(b.path));
    const manifest={schema:'stellar-forge.superset-customer-delivery.v1',selected:selected(prepared),
      sourceBindingSha256:native.sourceBindingSha256,sessionId:report.sessionId,rows:report.acquiredRows,pages:report.completedPages,
      nativeBuyerStatuses:[...new Set(report.pages.map(page=>page.nativeBuyerStatus))],paymentStatus:native.paymentStatus,
      includeSourceCaptures,files};
    manifest.sha256=identity(manifest);
    await saveExact(join(destination,'delivery.json'),manifest);
    return{...await inspectSupersetDelivery(destination),native};
  }finally{await unlock();}
}
export async function inspectSupersetDelivery(directory){
  directory=absolute(directory);await privateDirectory(directory);
  const manifest=await readJson(join(directory,'delivery.json'),16*MiB),{sha256,...unsigned}=manifest;
  if(manifest.schema!=='stellar-forge.superset-customer-delivery.v1'||identity(unsigned)!==sha256||
      !Array.isArray(manifest.files)||manifest.files.length>25000)
    throw fault('SUPERSET_DELIVERY_FORMAT','Choose a complete original Superset customer delivery.');
  const names=new Set();
  for(const member of manifest.files){
    if(typeof member.path!=='string'||member.path.includes('\\')||member.path.startsWith('/')||
        member.path.split('/').some(part=>!part||part==='.'||part==='..')||names.has(member.path))
      throw fault('SUPERSET_DELIVERY_PATH','An original delivery member path is invalid.');
    names.add(member.path);
    const actual=await descriptor(directory,member.path);
    if(actual.bytes!==member.bytes||actual.sha256!==member.sha256)throw fault('SUPERSET_DELIVERY_CHANGED','An original delivered file failed its digest.',409);
  }
  const lineage=await readJson(join(directory,'superset-lineage.json'),8*MiB);
  if(identity(lineage.selected)!==identity(manifest.selected)||lineage.acquisition.sourceBindingSha256!==manifest.sourceBindingSha256||
      lineage.acquisition.snapshot!==manifest.selected.snapshot||lineage.includeSourceCaptures!==manifest.includeSourceCaptures)
    throw fault('SUPERSET_DELIVERY_CHANGED','The delivered source and acquisition bindings differ.',409);
  const original=await scanOriginalDataset(join(directory,'dataset'),{retainPayload:false});
  const originalManifest=await readJson(join(directory,'dataset/manifest.json'),4*MiB);
  if(original.snapshot!==manifest.selected.snapshot||original.pages.length!==manifest.pages||
      original.count!==manifest.rows||original.total!==manifest.rows||!original.finalized||original.chain!==originalManifest.chainDigest)
    throw fault('SUPERSET_NATIVE_DELIVERY_CHANGED','The native complete page chain differs from this customer delivery.',409);
  return{directory,manifest,lineage,native:{snapshot:original.snapshot,pages:original.pages.length,rows:original.count,chain:original.chain},
    bytes:manifest.files.reduce((total,file)=>total+file.bytes,0)};
}
export async function runSupersetBuyer(args){return(await import('../../sf88-operator-buyer-cli/dataset-cli.mjs')).main(args);}
