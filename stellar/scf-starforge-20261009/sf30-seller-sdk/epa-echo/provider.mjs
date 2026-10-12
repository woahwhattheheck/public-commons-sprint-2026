// MIT. Original public EPA service requests, exact JSON tokens and source packages.
import {createHash} from 'node:crypto';
import {parseExactJSON} from '../stellar-expert/exact-json.mjs';
import {SOURCE_CONTRACT,SOURCE_PACKAGE_SCHEMA,SEARCH_FIELDS} from './schema.mjs';
export const hashBytes=b=>createHash('sha256').update(b).digest('hex');
export const fault=(code,message,status=400,details={})=>Object.assign(new Error(message),{code,status,...details});
export function text(value,label,max=300,empty=false){
 if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||(!empty&&!value.trim()))
  throw fault('ECHO_INPUT','Supply '+label+' of at most '+max+' characters.');
 return value;
}
export function facilityIds(values){
 if(!Array.isArray(values)||!values.length||values.length>1000||values.some(v=>typeof v!=='string'||!/^\d{12}$/.test(v))||new Set(values).size!==values.length)
  throw fault('ECHO_FACILITY_SELECTION','Choose one to1000 distinct original12-digit FRS RegistryIDs in the intended order.');
 return [...values];
}
export function normalisePortfolio(input){
 const ids=facilityIds(input.facilityIds);
 if(input.active!==undefined&&typeof input.active!=='boolean')throw fault('ECHO_INPUT','Portfolio active must be true or false.');
 return {label:text(input.label,'a portfolio name'),facilityIds:ids,customer:text(input.customer??'','a customer',300,true),
  owner:text(input.owner??'','an owner',300,true),note:text(input.note??'','a portfolio note',12000,true),active:input.active??true};
}
export function normaliseQuery(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!SEARCH_FIELDS.some(f=>f.id===k)))
  throw fault('ECHO_SEARCH_INPUT','Use the advertised original EPA search fields.');
 const result={};
 for(const field of SEARCH_FIELDS){
  const value=raw[field.id];if(value===undefined||value==='')continue;
  if(field.type==='integer'){
   if(!Number.isSafeInteger(value)||value<field.minimum||value>field.maximum)throw fault('ECHO_SEARCH_INPUT','Choose a source page size from1 through1000.');
   result[field.id]=value;
  }else result[field.id]=text(value,field.label,field.maxLength);
 }
 if(!Object.keys(result).some(k=>k!=='responseset'))throw fault('ECHO_SEARCH_INPUT','Select at least one source search criterion.');
 result.responseset??=100;
 if(result.p_reg&&!/^(?:0[1-9]|10)$/.test(result.p_reg))throw fault('ECHO_SEARCH_INPUT','Use the source region code01 through10.');
 if(result.p_ncs&&!/^\d{2,6}$/.test(result.p_ncs))throw fault('ECHO_SEARCH_INPUT','Use an original two-to-six-digit NAICS prefix.');
 if(result.p_fips&&!/^\d{5}$/.test(result.p_fips))throw fault('ECHO_SEARCH_INPUT','Use the original five-digit county FIPS code.');
 return result;
}
const PATHS=new Set(['/echo/echo_rest_services.get_facilities','/echo/echo_rest_services.get_qid',
 '/echo/echo_rest_services.metadata','/echo/dfr_rest_services.get_dfr','/echo/swaggerx.swagger_json']);
export function checkedSourceUrl(value){
 let u;try{u=new URL(value);}catch{throw fault('ECHO_SOURCE_URL','Use an original EPA ECHO service URL.');}
 if(u.origin!=='https://echodata.epa.gov'||!PATHS.has(u.pathname)||u.username||u.password||u.hash||u.href.length>8192)
  throw fault('ECHO_SOURCE_URL','Use the original public EPA ECHO service host and a supported source endpoint.');
 return u.href;
}
export function queryUrl(query){
 const u=new URL('/echo/echo_rest_services.get_facilities',SOURCE_CONTRACT.baseUrl);u.searchParams.set('output','JSON');
 for(const[k,v]of Object.entries(normaliseQuery(query)))u.searchParams.set(k,String(v));return u.href;
}
export function pageUrl(queryId,page){
 if(!/^\d+$/.test(queryId??'')||!Number.isSafeInteger(page)||page<1||page>1000000)throw fault('ECHO_SOURCE_PAGING','Use the retained source QID and a positive page number.');
 const u=new URL('/echo/echo_rest_services.get_qid',SOURCE_CONTRACT.baseUrl);
 for(const[k,v]of Object.entries({output:'JSON',qid:queryId,pageno:page}))u.searchParams.set(k,String(v));return u.href;
}
export function reportUrl(facilityId){
 facilityIds([facilityId]);return SOURCE_CONTRACT.baseUrl+'/dfr_rest_services.get_dfr?output=JSON&p_id='+facilityId;
}
export function metadataUrl(){return SOURCE_CONTRACT.baseUrl+'/echo_rest_services.metadata?output=JSON';}
export function contractUrl(){return SOURCE_CONTRACT.baseUrl+'/swaggerx.swagger_json?p_prefix=ECHO';}
export const urlKey=url=>hashBytes(Buffer.from(checkedSourceUrl(url)));
export function sourceCounter(value,label){
 if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw fault('ECHO_SOURCE_SHAPE','The original '+label+' is not a safe nonnegative count.',502);
 return Number(value);
}
export function sourceFacilityId(row){
 const id=row?.RegistryID;
 if(typeof id!=='string'||!/^\d{12}$/.test(id))throw fault('ECHO_SOURCE_SHAPE','A facility result lacks its original12-digit RegistryID.',502);
 return id;
}
function canonicalValue(value){
 return Array.isArray(value)?value.map(canonicalValue):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalValue(value[key])])):value;
}
function primitiveTypes(value){
 return value===null?'null':Array.isArray(value)?value.map(primitiveTypes):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,primitiveTypes(value[key])])):typeof value;
}
export function decodeSource(body,kind,{facilityId}={}){
 let data,typed;const duplicates=[];
 try{
  const source=new TextDecoder('utf-8',{fatal:true}).decode(body);
  data=parseExactJSON(source,{onDuplicate:entry=>{
   const previousTyped=JSON.parse(entry.previousRaw),nextTyped=JSON.parse(entry.valueRaw);
   if(JSON.stringify(canonicalValue(entry.previous))!==JSON.stringify(canonicalValue(entry.value))||
     JSON.stringify(primitiveTypes(previousTyped))!==JSON.stringify(primitiveTypes(nextTyped)))return false;
   duplicates.push({path:'/'+entry.path.map(x=>String(x).replaceAll('~','~0').replaceAll('/','~1')).join('/'),
    value:entry.value,typed:nextTyped,occurrence:entry.occurrence,
    previousStart:entry.previousStart,previousEnd:entry.previousEnd,start:entry.start,end:entry.end,
    offsetUnit:'UTF-16 code units in the complete original decoded source'});
   return true;
  }});typed=JSON.parse(source);
 }catch(error){throw fault('ECHO_SOURCE_JSON','The retained response is not valid unambiguous UTF-8 JSON: '+error.message,502);}
 if(!data||typeof data!=='object'||Array.isArray(data))throw fault('ECHO_SOURCE_SHAPE','The original source response must be an object.',502);
 if(kind==='service-contract'){
  if(data.swagger!=='2.0'||data.host!=='echodata.epa.gov'||data.basePath!=='/echo'||!data.paths)
   throw fault('ECHO_SOURCE_SHAPE','The retained service specification is not the original EPA ECHO contract.',502);
  return {data,typed,duplicates,records:Object.keys(data.paths).length};
 }
 const r=data.Results;
 if(!r||typeof r!=='object'||Array.isArray(r))throw fault('ECHO_SOURCE_SHAPE','The source has no original Results object.',502);
 if(kind==='facility-report'){
  if(r.RegistryID!==facilityId||!Array.isArray(r.Permits))throw fault('ECHO_SOURCE_FACILITY','The detailed report does not match the selected original FRS RegistryID and Permits array.',502);
  return {data,typed,duplicates,records:1,facilityId,message:r.Message??null};
 }
 if(kind==='source-metadata'){
  if(!Array.isArray(r.ResultColumns))throw fault('ECHO_SOURCE_SHAPE','The original metadata response has no ResultColumns array.',502);
  return {data,typed,duplicates,records:r.ResultColumns.length};
 }
 if(kind!=='search')throw fault('ECHO_SOURCE_KIND','Choose an original source response kind.');
 if(typeof r.Message==='string'&&/(?:query|qid).*(?:expir|invalid|not found)|(?:expir|invalid).*(?:query|qid)/i.test(r.Message))
  throw fault('ECHO_QUERY_EXPIRED','The provider reports that this retained query identifier is expired or invalid. Its original criteria and pages remain saved.',410,{retryable:false,providerMessage:r.Message});
 const queryRows=sourceCounter(r.QueryRows,'QueryRows'),rows=r.Facilities??[];
 if(!Array.isArray(rows)||rows.some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw fault('ECHO_SOURCE_SHAPE','The original facility page does not contain a Facilities array.',502);
 const ids=rows.map(sourceFacilityId);
 if(new Set(ids).size!==ids.length)throw fault('ECHO_SOURCE_PAGING','A source page repeated a RegistryID.',502);
 const queryId=r.QueryID===undefined?null:text(r.QueryID,'the source QueryID',40);
 if(queryId!==null&&!/^\d+$/.test(queryId))throw fault('ECHO_SOURCE_PAGING','The source query identifier is invalid.',502);
 return {data,typed,duplicates,records:rows.length,rows,facilityIds:ids,queryRows,queryId,message:r.Message??null,
  pageNo:r.PageNo===undefined?null:sourceCounter(r.PageNo,'PageNo')};
}
export function retryTime(value,now=Date.now()){
 if(typeof value==='string'&&/^\d+$/.test(value))return new Date(now+Math.min(Number(value),86400)*1000).toISOString();
 const parsed=Date.parse(value);return new Date(Number.isFinite(parsed)?Math.max(now,parsed):now+60000).toISOString();
}
export async function fetchEchoResponse(task,{fetchImpl=fetch,signal,userAgent}={}){
 const url=checkedSourceUrl(task.url),startedAt=new Date().toISOString(),timeout=AbortSignal.timeout(45000);
 const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{accept:'application/json',
  'user-agent':userAgent??'StellarForgeECHO/1.0 (+https://echo.epa.gov/tools/web-services)'},
  signal:signal?AbortSignal.any([signal,timeout]):timeout});
 const chunks=[];let count=0;
 for await(const part of response.body??[]){count+=part.length;if(count>32*1024*1024)throw fault('ECHO_SOURCE_CAPACITY','This source response exceeds32 MiB.',413);chunks.push(Buffer.from(part));}
 const body=Buffer.concat(chunks),finishedAt=new Date().toISOString(),sha256=hashBytes(body);
 const receipt={url,status:response.status,startedAt,finishedAt,sourceObservedAt:finishedAt,bytes:body.length,sha256,
  responseSha256:sha256,contentType:response.headers.get('content-type'),etag:response.headers.get('etag'),
  lastModified:response.headers.get('last-modified'),retryAfter:response.headers.get('retry-after'),transport:'native-https',parseState:'RETAINED'};
 if(!response.ok)return {body,wire:body,receipt,error:{code:response.status===429?'ECHO_SOURCE_RATE_LIMIT':'ECHO_SOURCE_HTTP',
  message:'EPA ECHO returned HTTP '+response.status+'.',status:response.status,retryable:response.status===429||response.status>=500,
  ...(response.status===429||response.status===503?{retryAt:retryTime(receipt.retryAfter)}:{})}};
 return {body,wire:body,receipt,error:null};
}
export function normaliseBundle(bundle){
 if(!bundle||typeof bundle!=='object'||Array.isArray(bundle)||bundle.schema!==SOURCE_PACKAGE_SCHEMA||
  !Array.isArray(bundle.responses)||!bundle.responses.length||bundle.responses.length>4005)
  throw fault('ECHO_IMPORT_FORMAT','Choose a complete EPA ECHO source package.');
 const selection={facilityIds:facilityIds(bundle.selection?.facilityIds)},seen=new Set(),reports=new Set();let total=0;
 const responses=bundle.responses.map((entry,index)=>{
  if(!entry||!['search','facility-report','service-contract','source-metadata'].includes(entry.kind)||
    typeof entry.bodyBase64!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256??'')||
    !Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>32*1024*1024)
   throw fault('ECHO_IMPORT_RESPONSE','An original source response has invalid metadata.');
  const url=checkedSourceUrl(entry.url),u=new URL(url),body=Buffer.from(entry.bodyBase64,'base64');
  if(body.toString('base64')!==entry.bodyBase64||body.length!==entry.bytes||hashBytes(body)!==entry.sha256)
   throw fault('ECHO_IMPORT_BYTES','The original source bytes differ from the package manifest.',409);
  total+=body.length;if(total>256*1024*1024)throw fault('ECHO_IMPORT_CAPACITY','The source package exceeds256 MiB decoded.',413);
  const identity=entry.kind+'|'+url;
  if(seen.has(identity))throw fault('ECHO_IMPORT_DUPLICATE','An original response appears more than once.');seen.add(identity);
  const expectedPath={'facility-report':'/echo/dfr_rest_services.get_dfr','source-metadata':'/echo/echo_rest_services.metadata',
   'service-contract':'/echo/swaggerx.swagger_json'}[entry.kind];
  if(expectedPath&&u.pathname!==expectedPath||entry.kind==='search'&&!['/echo/echo_rest_services.get_facilities','/echo/echo_rest_services.get_qid'].includes(u.pathname))
   throw fault('ECHO_IMPORT_SOURCE','The response kind does not match its original EPA endpoint.');
  if(entry.kind==='facility-report'){
   if(!selection.facilityIds.includes(entry.facilityId)||reports.has(entry.facilityId)||u.searchParams.get('p_id')!==entry.facilityId)
    throw fault('ECHO_IMPORT_SELECTION','The report response does not match one selected original facility.');
   reports.add(entry.facilityId);
  }
  decodeSource(body,entry.kind,{facilityId:entry.facilityId});
  return {...entry,url,index};
 });
 if(reports.size!==selection.facilityIds.length)throw fault('ECHO_IMPORT_INCOMPLETE','Include each selected complete original facility report in the source package.');
 if(bundle.reviews!==undefined&&!Array.isArray(bundle.reviews))throw fault('ECHO_IMPORT_REVIEWS','Original review records must be an array.');
 return {schema:SOURCE_PACKAGE_SCHEMA,selection,label:text(bundle.label??'Imported EPA portfolio','a source package label'),
  sourceMetadata:bundle.sourceMetadata??null,responses,reviews:bundle.reviews??[],decodedBytes:total};
}
export function importedResponse(bundle,task){
 const entry=bundle.responses.find(r=>r.index===task.sourceIndex&&r.kind===task.kind&&r.url===task.url);
 if(!entry)throw fault('ECHO_IMPORT_RESPONSE','The retained source task is missing from its original package.',409);
 const body=Buffer.from(entry.bodyBase64,'base64'),original=entry.receipt??{};
 const sourceObservedAt=original.sourceObservedAt??original.finishedAt??original.retrievedAt??original.acquiredAt??null;
 return {body,wire:body,receipt:{url:entry.url,sha256:entry.sha256,bytes:entry.bytes,responseSha256:entry.sha256,
   sourceObservedAt,sourceAcquisitionDate:original.acquisitionDate??null,
   status:original.originHTTP?.status??(Number.isInteger(original.status)?original.status:Number.isInteger(original.httpStatus)?original.httpStatus:null),
   contentType:original.contentType??original.originHTTP?.headers?.['content-type']??null,
   startedAt:original.startedAt??null,finishedAt:original.finishedAt??null,
   transport:'retained-source-package',originalReceipt:original,parseState:'RETAINED'},error:null};
}
