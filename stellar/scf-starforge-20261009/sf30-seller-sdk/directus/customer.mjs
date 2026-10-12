// MIT. Directus customers use the original SF88 acquisition and SF100 data room.
import {join,resolve} from 'node:path';
import {readdir} from 'node:fs/promises';
import {scan as scanOriginalDataset} from '../../sf100-buyer-dataset-delivery/deliver.mjs';
import {readDirectusMerchant} from './merchant.mjs';
import {readDatasetBuyerOffer,prepareDatasetBuyer} from '../dataset-refresh/buyer-handoff.mjs';
import {inspectDatasetSession,deliverDatasetSession} from '../../sf88-operator-buyer-cli/dataset-session.mjs';
import {absolute,object,bytes,digest,identity,readJson,hashPrivate,privateDirectory,acquireWorkspace,
  fault,separated,saveExact,copyExact,descriptor,MiB} from '../dspace/merchant-files.mjs';

function queryString(query){
  if(!object(query)||Object.entries(query).some(([key,value])=>typeof value!=='string'||['cursor','snapshot'].includes(key)))
    throw fault('DIRECTUS_BUYER_QUERY','Use original first-page string query parameters; the approved edition supplies snapshot.');
  const value=new URLSearchParams(Object.entries(query)).toString();
  if(value.length>8192)throw fault('DIRECTUS_BUYER_QUERY','The query exceeds the original buyer limit.');
  return value;
}
function editionSummary(prepared){
  return {workspace_id:prepared.source.workspace_id,id:prepared.source.edition.id,
    sha256:prepared.source.edition.sha256,snapshot:prepared.description.snapshot,
    row_count:prepared.description.rowCount,rights:prepared.source.rights,
    source_index_sha256:prepared.binding.sourceSha256,review:prepared.lineage.review};
}
export async function reviewDirectusBuyer({directory,seller,query={}}={}){
  const prepared=await readDirectusMerchant(directory);
  const resource=prepared.service.publicOrigin+prepared.service.routes[0].path;
  const review=await readDatasetBuyerOffer({seller,resource,snapshot:prepared.description.snapshot,query:queryString(query)});
  return {...review,edition:editionSummary(prepared)};
}
export async function prepareDirectusBuyer({directory,seller,query={},intentId,acceptIndex,offerSha256,destination}={}){
  const review=await reviewDirectusBuyer({directory,seller,query});
  const prepared=prepareDatasetBuyer(review,{intentId,acceptIndex,offerSha256});
  const content=Buffer.from(prepared.configText,'utf8');
  if(digest(content)!==prepared.configSha256)throw fault('DIRECTUS_BUYER_CONFIG','The original configuration identity differs.',409);
  const saved=await saveExact(absolute(destination,'buyer configuration file'),content);
  await saveExact(saved.path+'.directus.json',{schema:'stellar-forge.directus-buyer-selection.v1',
    edition:review.edition,url:prepared.url,offer_sha256:offerSha256,configuration_sha256:prepared.configSha256});
  return {...prepared,edition:review.edition,saved};
}

/** Complete original paid/free responses become a portable native data room.
 * The requested snapshot and original URL must match this exact approved edition.
 * Source captures are optional because they can include unpurchased collection items. */
export async function receiveDirectusBuyer({directory,sessionDirectory,destination,includeSourceCaptures=false}={}){
  if(typeof includeSourceCaptures!=='boolean')throw new TypeError('includeSourceCaptures must be a boolean.');
  const prepared=await readDirectusMerchant(directory);
  sessionDirectory=absolute(sessionDirectory,'original buyer session');
  destination=absolute(destination,'customer delivery directory');
  separated(destination,prepared.directory);separated(destination,sessionDirectory);
  const report=await inspectDatasetSession(sessionDirectory);
  if(report.status!=='COMPLETE'||report.snapshot!==prepared.description.snapshot||!report.pages.length)
    throw fault('DIRECTUS_BUYER_COMPLETE','Complete the original acquisition of this exact retained edition.',409);
  const resource=prepared.service.publicOrigin+prepared.service.routes[0].path;
  for(const page of report.pages){
    const url=new URL(page.requestUrl);
    if(url.origin+url.pathname!==resource||url.searchParams.get('snapshot')!==prepared.description.snapshot)
      throw fault('DIRECTUS_BUYER_SOURCE_CHANGED','The acquisition belongs to another original resource or edition.',409);
  }
  await privateDirectory(destination,true);const unlock=await acquireWorkspace(destination);
  try{
    const intent={schema:'stellar-forge.directus-customer-intent.v1',session_directory:sessionDirectory,
      session_id:report.sessionId,configuration_sha256:report.configurationSha256,
      edition:editionSummary(prepared),include_source_captures:includeSourceCaptures};
    await saveExact(join(destination,'receiving-intent.json'),intent);
    const native=await deliverDatasetSession(sessionDirectory,join(destination,'dataset'));
    const first=report.pages[0];
    const lineage={schema:'stellar-forge.directus-customer-lineage.v1',
      edition:editionSummary(prepared),mode:prepared.source.mode,
      acquisition:{session_id:report.sessionId,snapshot:report.snapshot,pages:report.completedPages,
        rows:report.acquiredRows,configuration_sha256:report.configurationSha256,
        first_request_url:first.requestUrl,source_binding_sha256:native.sourceBindingSha256,
        original_exporter_blob:native.nativeBlob},
      sources:prepared.source.sources.map(({id,sha256,bytes,name,base_url,scope})=>({id,sha256,bytes,name,base_url,scope})),
      source_captures_included:includeSourceCaptures,
      review:prepared.lineage.review,rights:prepared.lineage.rights,
      payment_status:native.paymentStatus,
      original_outputs:Object.fromEntries(Object.entries(native.outputs).map(([name,file])=>
        [name,{path:'dataset/'+name,bytes:file.bytes,sha256:file.sha256}]))};
    const sources=[];
    if(includeSourceCaptures){
      // Explicit complete-source receiving preserves every reviewed provenance file
      // through the original descriptor list, including its original projection.
      for(const file of prepared.sourceFiles){
        const relative='source/'+file.path;
        await copyExact(join(prepared.directory,file.path),join(destination,relative),file);
        sources.push({...file,path:relative});
      }
      const originalSource=prepared.retained['source.json'];
      await saveExact(join(destination,'source/source.json'),originalSource);
      sources.push({path:'source/source.json',bytes:originalSource.length,sha256:digest(originalSource)});
    }
    await saveExact(join(destination,'directus-lineage.json'),lineage);
    const nativeArchiveFiles=['dataset/session.json',...(await readdir(join(destination,'dataset/pages'))).sort().map(name=>'dataset/pages/'+name)];
    const archiveDescriptors=[];
    for(const name of nativeArchiveFiles)archiveDescriptors.push(await descriptor(destination,name));
    const files=[...archiveDescriptors,...Object.entries(native.outputs).map(([name,file])=>
      ({path:'dataset/'+name,bytes:file.bytes,sha256:file.sha256})),
      await descriptor(destination,'directus-lineage.json'),...sources];
    files.sort((a,b)=>a.path.localeCompare(b.path));
    const manifest={schema:'stellar-forge.directus-customer-delivery.v1',
      edition:editionSummary(prepared),source_binding_sha256:native.sourceBindingSha256,
      acquisition:{session_id:report.sessionId,pages:report.completedPages,rows:report.acquiredRows,
        native_buyer_statuses:[...new Set(report.pages.map(page=>page.nativeBuyerStatus))]},
      native_exporter_blob:native.nativeBlob,payment_status:native.paymentStatus,
      include_source_captures:includeSourceCaptures,files};
    manifest.sha256=identity(manifest);
    await saveExact(join(destination,'delivery.json'),manifest);
    return {...await inspectDirectusDelivery(destination),native};
  }finally{await unlock();}
}
export async function inspectDirectusDelivery(directory){
  directory=absolute(directory,'original delivery directory');await privateDirectory(directory);
  const manifest=await readJson(join(directory,'delivery.json'),8*MiB),unsigned={...manifest};delete unsigned.sha256;
  if(manifest.schema!=='stellar-forge.directus-customer-delivery.v1'||identity(unsigned)!==manifest.sha256||
      !Array.isArray(manifest.files)||manifest.files.length>25000)
    throw fault('DIRECTUS_DELIVERY_FORMAT','Choose a complete original repository customer delivery.');
  const names=new Set();
  for(const file of manifest.files){
    if(typeof file.path!=='string'||file.path.includes('\\')||file.path.startsWith('/')||
        file.path.split('/').some(p=>!p||p==='.'||p==='..')||names.has(file.path))
      throw fault('DIRECTUS_DELIVERY_PATH','The original delivery contains an invalid or duplicate file path.');
    names.add(file.path);
    const actual=await hashPrivate(join(directory,file.path),512*MiB);
    if(actual.bytes!==file.bytes||actual.hash!==file.sha256)
      throw fault('DIRECTUS_DELIVERY_CHANGED','A retained original customer file differs from its digest.',409);
  }
  const lineage=await readJson(join(directory,'directus-lineage.json'),16*MiB);
  if(lineage.edition.sha256!==manifest.edition.sha256||lineage.acquisition.snapshot!==manifest.edition.snapshot||
      lineage.acquisition.source_binding_sha256!==manifest.source_binding_sha256)
    throw fault('DIRECTUS_DELIVERY_CHANGED','The customer lineage differs from the original source binding.',409);
  const native=await scanOriginalDataset(join(directory,'dataset'),{retainPayload:false});
  const originalManifest=await readJson(join(directory,'dataset/manifest.json'),4*MiB);
  if(native.snapshot!==manifest.edition.snapshot||native.pages.length!==manifest.acquisition.pages||native.count!==manifest.acquisition.rows||native.total!==manifest.acquisition.rows||
      native.chain!==originalManifest.chainDigest||!native.finalized)
    throw fault('DIRECTUS_NATIVE_DELIVERY_CHANGED','The original buyer page chain differs from this complete delivery.',409);
  return {directory,manifest,lineage,native:{snapshot:native.snapshot,pages:native.pages.length,rows:native.count,chain:native.chain},bytes:manifest.files.reduce((sum,file)=>sum+file.bytes,0)};
}

/** These entrypoints retain the original operator, signer, budgets and per-page review. */
export async function runDirectusBuyer(args){return(await import('../../sf88-operator-buyer-cli/dataset-cli.mjs')).main(args);}
