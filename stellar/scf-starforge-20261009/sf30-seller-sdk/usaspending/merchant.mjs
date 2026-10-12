// MIT. Prepare an immutable award dataset for the original SF30 merchant and adopt original SF100 deliveries.
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { VERSION, COLUMNS, canonical, sha, requireThat, plain, csv, publicRow, now, integer } from './core.mjs';
import { readJsonFile } from './source-import.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { startSellerService } from '../serve.mjs';
import { scan as scanDelivery } from '../../sf100-buyer-dataset-delivery/deliver.mjs';

const FILTERS=['recipient_uei','parent_recipient_uei','awarding_agency','funding_agency','naics','psc','set_aside','award_type'];
const RANGES=['signed_date','performance_end','potential_end'];
const SORTS=['recipient_name','signed_date','performance_end','piid'];
async function put(path,content){await writeFile(path,content,{flag:'wx',mode:0o600});}
function objectText(value){return JSON.stringify(value,null,2)+'\n';}

export async function prepareMerchant(workspace,editionId,{payment,origin,path='/federal-awards',defaultLimit=50,maxLimit=100}={}){
  integer(defaultLimit,'Default page size',1,250);integer(maxLimit,'Maximum page size',defaultLimit,250);
  requireThat((payment===undefined)===(origin===undefined),'PAYMENT_AND_ORIGIN_TOGETHER');
  const edition=workspace.edition(editionId),rows=workspace.rows(editionId).map(publicRow);
  requireThat(rows.length>0,'EMPTY_EDITION','Choose an edition containing awards');
  const pid='M-'+randomUUID(),parent=join(workspace.directory,'merchant'),directory=join(parent,pid),staging=join(parent,'.'+pid+'.preparing');
  await mkdir(parent,{recursive:true,mode:0o700});await mkdir(staging,{mode:0o700});
  const csvBytes=Buffer.from(csv(rows)),datasetConfig={schema:'stellar-forge.csv-dataset.v1',file:'awards.csv',name:edition.name,
    columns:Object.fromEntries(COLUMNS.map(k=>[k,{type:'string',nullable:k!=='award_key'&&k!=='source_url'}])),
    filters:FILTERS,ranges:RANGES,sorts:SORTS,defaultLimit,maxLimit,maxRows:250000,maxBytes:64*1024*1024,maxCellChars:65536};
  requireThat(csvBytes.length<=datasetConfig.maxBytes,'MERCHANT_DATASET_CAPACITY','Narrow the published edition or configure the original dataset capacity explicitly');
  await put(join(staging,'awards.csv'),csvBytes);await put(join(staging,'dataset.json'),objectText(datasetConfig));
  const dataset=await loadDatasetConfig(join(staging,'dataset.json')),description=dataset.describe();
  const source=workspace.exportEdition(editionId,{includeSourceBytes:false,includeReviews:false});
  const provenance={schema:VERSION+'.merchant-source',edition:Object.fromEntries(['id','name','created_at','kind','parent_id','capture_id','row_count','sha256'].map(k=>[k,source.edition[k]])),coverage:source.coverage,warnings:source.warnings,
    sourcePages:source.sourcePages,details:source.details,columns:source.columns,sourceEditionSha256:edition.sha256,generatedAt:now()};
  await put(join(staging,'source-manifest.json'),objectText(provenance));
  const files={'awards.csv':{bytes:csvBytes.length,sha256:sha(csvBytes)},'dataset.json':{sha256:sha(objectText(datasetConfig))},'source-manifest.json':{sha256:sha(objectText(provenance))}};
  let seller;
  if(payment!==undefined){seller=await buildDatasetSellerConfig(dataset,{payment,origin,path});await put(join(staging,'seller.json'),objectText(seller));files['seller.json']={sha256:sha(objectText(seller))};}
  const bundle={schema:VERSION+'.merchant',id:pid,createdAt:now(),editionId,sourceEditionSha256:edition.sha256,dataset:description,files,
    seller:seller?{origin:seller.publicOrigin,path,config:'seller.json'}:null,
    launch:{command:'merchant-serve',directory:'.',dataset:'dataset.json'},publicationKind:seller?'configured_merchant':'research_dataset'};
  await put(join(staging,'bundle.json'),objectText(bundle));await rename(staging,directory);
  const saved=workspace.recordPublication(editionId,{merchantId:pid,directory,bundleSha256:sha(objectText(bundle)),snapshot:description.snapshot,rows:rows.length,configured:!!seller});
  return {...saved,bundle,files:{bundle:join(directory,'bundle.json'),dataset:join(directory,'dataset.json'),csv:join(directory,'awards.csv'),source:join(directory,'source-manifest.json'),...(seller?{seller:join(directory,'seller.json')}:{})}};
}
export async function loadMerchant(directory){
  directory=resolve(directory);const {value:bundle}=await readJsonFile(join(directory,'bundle.json'),2*1024*1024);
  requireThat(bundle.schema===VERSION+'.merchant'&&plain(bundle.files),'MERCHANT_BUNDLE_INVALID');
  const allowed=new Set(['awards.csv','dataset.json','source-manifest.json','seller.json']);
  for(const [name,expected]of Object.entries(bundle.files)){requireThat(allowed.has(name),'MERCHANT_FILE_INVALID');const info=await stat(join(directory,name));requireThat(info.isFile()&&info.size<=64*1024*1024,'MERCHANT_FILE_TOO_LARGE');const bytes=await readFile(join(directory,name));requireThat(sha(bytes)===expected.sha256&&(expected.bytes===undefined||expected.bytes===bytes.length),'MERCHANT_FILE_CHANGED',name+' no longer matches the retained edition');}
  const dataset=await loadDatasetConfig(join(directory,'dataset.json'));
  requireThat(dataset.describe().snapshot===bundle.dataset.snapshot,'MERCHANT_SNAPSHOT_CHANGED');
  return {directory,bundle,dataset};
}
export async function previewMerchant(directory,query={}){
  const merchant=await loadMerchant(directory),context={query};
  const admission=await merchant.dataset.admit(context);requireThat(admission===true,'DATASET_QUERY_REJECTED',admission?.body?.message??'Original dataset admission rejected this query');
  const result=await merchant.dataset.handle(context);requireThat(result.status===200,'DATASET_QUERY_REJECTED',result.body?.message);
  return {mode:'local_dataset_read',snapshot:merchant.bundle.dataset.snapshot,result};
}
export async function serveMerchant(directory,{port=8423,facilitator,allowLocalFacilitator=false,nativeFactory=null,availabilityDirectory}={}){
  const {directory:root,bundle,dataset}=await loadMerchant(directory);
  requireThat(bundle.seller,'MERCHANT_PAYMENT_CONFIG_REQUIRED','Prepare the package with the operator’s public payment terms and HTTPS origin');
  const {value:config}=await readJsonFile(join(root,bundle.seller.config),65536);
  requireThat(!nativeFactory||!facilitator,'ONE_NATIVE_FACTORY_REQUIRED');
  if(facilitator){
    const endpoint=new URL(facilitator);requireThat(!endpoint.username&&!endpoint.password&&!endpoint.hash&&!endpoint.search&&(endpoint.protocol==='https:'||allowLocalFacilitator&&endpoint.protocol==='http:'&&endpoint.hostname==='127.0.0.1'),'FACILITATOR_URL_INVALID');
    const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([import('@x402/core/server'),import('../native-factory.mjs')]);
    nativeFactory=compiled=>createNativeSellerServer(compiled,{facilitatorClient:new HTTPFacilitatorClient({url:endpoint.href.replace(/\/$/,'')})});
  }
  const session=await startSellerService({config,port,handlers:{queryDataset:context=>dataset.handle(context),admitDataset:context=>dataset.admit(context)},nativeFactory,availabilityDirectory});
  return Object.assign(session,{merchantId:bundle.id,sourceEditionId:bundle.editionId,snapshot:bundle.dataset.snapshot});
}
export async function adoptDelivery(workspace,directory){
  directory=resolve(directory);const state=await scanDelivery(directory,{retainPayload:true});
  requireThat(state.finalized&&state.count===state.total&&state.nextCursor===null&&state.pages.length>0,'FINALIZED_NATIVE_DELIVERY_REQUIRED','Finish the original SF88/SF100 delivery before adopting it');
  const {value:manifest,bytes:manifestBytes}=await readJsonFile(join(directory,'manifest.json'),4*1024*1024);
  requireThat(manifest.schema==='stellar-forge.buyer-delivery-manifest.v1'&&manifest.dataset.snapshot===state.snapshot&&manifest.dataset.rows===state.count&&manifest.chainDigest===state.chain,'DELIVERY_MANIFEST_MISMATCH');
  requireThat(manifest.dataset.originalQueryHash===state.queryHash&&canonical(manifest.dataset.projectedFields)===canonical(state.fields),'DELIVERY_QUERY_MISMATCH');
  const expectedPages=state.pages.map(x=>({index:x.index,intent:x.intent,sourceSha256:x.sourceSha256,evidenceSha256:x.evidenceSha256,recordDigest:x.chain,rows:x.returned,requestedCursor:x.requestCursor}));
  requireThat(canonical(manifest.sourcePages)===canonical(expectedPages),'DELIVERY_SOURCE_MANIFEST_MISMATCH');
  const rows=state.pages.flatMap(page=>page.payload.rows),rawOutput=Buffer.from(rows.map(row=>JSON.stringify(row)+'\n').join(''));
  const info=await stat(join(directory,'dataset.jsonl'));requireThat(info.isFile()&&info.size<=256*1024*1024,'DELIVERY_OUTPUT_TOO_LARGE');
  const output=await readFile(join(directory,'dataset.jsonl')),record=manifest.outputs?.['dataset.jsonl'];
  requireThat(record&&record.bytes===output.length&&record.sha256===sha(output)&&sha(rawOutput)===sha(output),'DELIVERY_OUTPUT_CHANGED');
  const archives=[];
  for(const page of state.pages){const bytes=await readFile(join(directory,'pages',String(page.index).padStart(5,'0')+'.json'));requireThat(bytes.length<=2*1024*1024+4096,'NATIVE_ARCHIVE_TOO_LARGE');archives.push({index:page.index,intent:page.intent,sourceSha256:page.sourceSha256,evidenceSha256:page.evidenceSha256,recordDigest:page.chain,bytes:bytes.length,sha256:sha(bytes),bytesBase64:bytes.toString('base64')});}
  const sourceArchive={schema:VERSION+'.native-delivery',manifestSha256:sha(manifestBytes),manifestBytes:manifestBytes.length,manifestBase64:manifestBytes.toString('base64'),chainDigest:state.chain,archives};
  const result=workspace.adoptBuyerRows({rows,manifest,sourcePages:expectedPages,sourceArchive});
  return {...result,sourceSnapshot:state.snapshot,originalIntentIds:state.pages.map(page=>page.intent),sourceChain:state.chain};
}
