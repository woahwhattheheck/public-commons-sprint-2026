// MIT. Import already retained official source bytes, preserving their acquisition record.
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, basename, join } from 'node:path';
import { VERSION, ORIGIN, SEARCH_PATH, requireThat, plain, canonical, sha, now, queryDefinition, sourceFilters } from './core.mjs';

export async function readJsonFile(path,maxBytes=32*1024*1024){
  const p=resolve(path),info=await stat(p);requireThat(info.isFile()&&info.size<=maxBytes,'INPUT_FILE_TOO_LARGE','Input must be a regular file up to '+maxBytes+' bytes');
  const bytes=await readFile(p);requireThat(bytes.length<=maxBytes,'INPUT_FILE_TOO_LARGE');return {path:p,bytes,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
}
function child(directory,name){
  requireThat(typeof name==='string'&&name===basename(name)&&name!=='.'&&name!=='..','SOURCE_FILENAME_INVALID','Source filenames must be direct children of the manifest directory');return join(directory,name);
}
export function definitionFromRequest(request,{name='Federal contract research',maxRows=50000}={}){
  requireThat(plain(request)&&plain(request.filters),'SOURCE_REQUEST_REQUIRED');
  const f=request.filters,known=['award_type_codes','time_period','keywords','recipient_search_text','award_ids','naics_codes','psc_codes','agencies','description','award_amounts'];
  requireThat(Object.keys(f).every(k=>known.includes(k)),'SOURCE_FILTER_NOT_EDITABLE','This source query contains a filter outside the current saved-query editor');
  requireThat(Array.isArray(f.time_period)&&f.time_period.length===1,'SINGLE_SOURCE_PERIOD_REQUIRED');
  const period=f.time_period[0],amount=f.award_amounts?.[0]??{};
  requireThat(!f.award_amounts||f.award_amounts.length===1,'SINGLE_AMOUNT_INTERVAL_REQUIRED');
  const q=queryDefinition({name,startDate:period.start_date,endDate:period.end_date,dateType:period.date_type??'new_awards_only',
    keywords:f.keywords??[],recipient:f.recipient_search_text??[],awardIds:f.award_ids??[],naics:f.naics_codes??[],psc:f.psc_codes??[],agencies:f.agencies??[],
    description:f.description??'',awardTypes:f.award_type_codes,pageSize:request.limit,maxRows,...(amount.lower_bound===undefined?{}:{minimumAwardUsd:amount.lower_bound}),...(amount.upper_bound===undefined?{}:{maximumAwardUsd:amount.upper_bound})});
  requireThat(canonical(sourceFilters(q))===canonical(f),'SOURCE_FILTER_RECONSTRUCTION_FAILED','Original query filters must remain exact');return q;
}
export function searchReceipt(original,requestBytes,responseBytes,request){
  requireThat(plain(original)&&original.http_status===200,'SUCCESSFUL_SOURCE_REQUIRED');
  requireThat(original.url===ORIGIN+SEARCH_PATH&&(!original.final_url||original.final_url===original.url)&&original.method==='POST','SOURCE_ENDPOINT_MISMATCH');
  requireThat(original.request_sha256===sha(requestBytes)&&original.response_sha256===sha(responseBytes)&&original.response_bytes===responseBytes.length,'SOURCE_FILE_DIGEST_MISMATCH');
  requireThat(typeof original.retrieved_at==='string'&&Number.isFinite(Date.parse(original.retrieved_at)),'SOURCE_TIME_REQUIRED');
  return {request:{method:'POST',url:original.url,body:request,bodySha256:sha(requestBytes),bodyBase64:requestBytes.toString('base64')},
    startedAt:original.requested_at??null,finishedAt:original.retrieved_at,url:original.final_url??original.url,status:original.http_status,headers:original.headers??(original.mime?{'content-type':original.mime}:{}),
    bytes:responseBytes.length,sha256:sha(responseBytes),originalAcquisition:original};
}
export function detailReceipt(original,bytes){
  requireThat(plain(original)&&original.http_status===200&&original.sha256===sha(bytes)&&original.bytes===bytes.length,'SOURCE_FILE_DIGEST_MISMATCH');
  const url=new URL(original.url);requireThat(url.origin===ORIGIN&&/^\/api\/v2\/awards\/[^/]+\/$/.test(url.pathname)&&!url.search&&!url.hash,'DETAIL_ENDPOINT_MISMATCH');
  requireThat(!original.final_url||original.final_url===original.url,'SOURCE_REDIRECT_MISMATCH');
  requireThat(typeof original.retrieved_at==='string'&&Number.isFinite(Date.parse(original.retrieved_at)),'SOURCE_TIME_REQUIRED');
  return {request:{method:'GET',url:original.url,body:null,bodySha256:null,bodyBase64:null},startedAt:original.requested_at??null,finishedAt:original.retrieved_at,url:original.url,status:200,
    bytes:bytes.length,sha256:sha(bytes),headers:original.headers??(original.mime?{'content-type':original.mime}:{}),originalAcquisition:original};
}
export async function loadRetainedCapture(manifestPath,{name,maxRows}={}){
  const {path,value:manifest}=await readJsonFile(manifestPath);
  requireThat(manifest.version==='commons.usaspending.source-capture.v1'&&manifest.complete===true&&Array.isArray(manifest.source_pages)&&manifest.source_pages.length>0,'COMPLETE_SOURCE_CAPTURE_REQUIRED');
  const directory=dirname(path),pages=[];
  for(const receipt of manifest.source_pages){
    const requestSource=await readJsonFile(child(directory,receipt.request_file),1024*1024),response=await readFile(child(directory,receipt.response_file));
    requireThat(response.length<=16*1024*1024,'SOURCE_RESPONSE_TOO_LARGE');
    pages.push({request:requestSource.value,receipt:searchReceipt(receipt,requestSource.bytes,response,requestSource.value),responseBase64:response.toString('base64')});
  }
  const definition=definitionFromRequest(pages[0].request,{name:name??'Retained federal contract cohort',maxRows:maxRows??50000});
  requireThat(manifest.query&&canonical(manifest.query)===canonical(pages[0].request),'SOURCE_MANIFEST_QUERY_MISMATCH');
  return {name:definition.name,definition,pages,sourceManifest:manifest};
}
export async function importRetainedCapture(workspace,path,options={}){
  const packet=await loadRetainedCapture(path,options),result=workspace.importCapturedPages(packet);
  const edition=workspace.edition(result.editionId);
  requireThat(edition.row_count===packet.sourceManifest.unique_award_count,'SOURCE_MANIFEST_COUNT_MISMATCH');
  return result;
}
export async function importRetainedDetail(workspace,sourcePath,receiptPath,{name}={}){
  const [source,record]=await Promise.all([readFile(resolve(sourcePath)),readJsonFile(receiptPath,1024*1024)]);
  requireThat(source.length<=16*1024*1024,'SOURCE_RESPONSE_TOO_LARGE');
  return workspace.importDetail({bytes:source,receipt:detailReceipt(record.value,source),name:name??'Retained public award detail'});
}
export async function importSourceCollection(workspace,manifestPath,{name,maxRows}={}){
  const {path,value}=await readJsonFile(manifestPath),directory=dirname(path);
  const original=value.version==='commons.usaspending.award-details.v1';
  requireThat((value.schema===VERSION+'.source-collection'||original&&value.complete===true)&&typeof (original?value.query_manifest:value.captureManifest)==='string'&&Array.isArray(value.details),'SOURCE_COLLECTION_REQUIRED');
  requireThat(value.details.length<=1000,'DETAIL_COLLECTION_LIMIT');
  const captured=await importRetainedCapture(workspace,child(directory,original?value.query_manifest:value.captureManifest),{name:name??value.name??'Federal AI and IT awards — September–October 2026',maxRows});
  if(original)requireThat(value.award_count===value.details.length&&value.award_count===workspace.edition(captured.editionId).row_count,'DETAIL_COLLECTION_COUNT_MISMATCH');
  const detailIds=[],failures=[];
  for(const item of value.details){
    try{const added=await importRetainedDetail(workspace,child(directory,item.file),child(directory,item.receipt),{name:item.name});detailIds.push(added.detailId);}
    catch(error){failures.push({file:item.file,code:error.code??'DETAIL_IMPORT_FAILED',message:error.message});}
  }
  const attached=detailIds.length?workspace.attachDetails(captured.editionId,detailIds,{failures}):{editionId:captured.editionId,completed:0,failures};
  return {...attached,captureId:captured.captureId,searchEditionId:captured.editionId,sourceCollectionSha256:sha(value),importedAt:now()};
}
