// MIT. Preserve original response bytes, native challenges and exact analysis.
import {need,plain,text,sha,uuid,now,jsonBytes,utf8,LIMITS,errorView} from '../common.mjs';
import {parseExactJSON,originalJSONFragment} from '../exact-json.mjs';
import {analyzeMarketResponse} from '../market.mjs';

export function parseSourceJSON(bytes) {
  try{return JSON.parse(utf8(bytes))}catch(error){need(false,'INVALID_SOURCE_JSON','Source is not a valid JSON document')}
}
export function headerEntries(value={}) {
  if(value instanceof Headers)return Object.fromEntries(value.entries());
  need(plain(value),'INVALID_HEADERS','Original HTTP headers must be an object');
  const result={};
  for(const[key,item]of Object.entries(value)){
    need(typeof key==='string'&&typeof item==='string','INVALID_HEADERS');
    result[key]=item;
  }
  return result;
}
export function headerValue(headers,name) {
  return Object.entries(headers).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1]??null;
}
function displayChallenge(bytes) {
  const parsed=parseExactJSON(bytes),view=parsed.value;
  need(plain(view),'INVALID_CHALLENGE');
  // Protocol counts retain their native integer types. Market numbers in the
  // retained example remain exact lexical strings; compilation uses raw bytes.
  if(typeof view.x402Version==='string'&&/^[12]$/.test(view.x402Version))view.x402Version=Number(view.x402Version);
  if(Array.isArray(view.accepts))for(const requirement of view.accepts){
    const count=requirement?.maxTimeoutSeconds;
    if(typeof count==='string'&&/^[0-9]{1,8}$/.test(count))requirement.maxTimeoutSeconds=Number(count);
  }
  return view;
}
export function challengeBytes(headers,body) {
  const encoded=headerValue(headers,'payment-required');
  if(encoded!==null){
    need(encoded.length<=1048576&&/^[A-Za-z0-9+/]*={0,2}$/.test(encoded),'INVALID_CHALLENGE_HEADER');
    const raw=Buffer.from(encoded,'base64');
    need(raw.length>0&&raw.length<=1048576&&raw.toString('base64').replace(/=+$/,'')===encoded.replace(/=+$/,''),
      'INVALID_CHALLENGE_HEADER');
    return raw;
  }
  if(body?.length){
    let value;try{value=parseSourceJSON(body)}catch{return null}
    if(plain(value)&&value.x402Version!==undefined&&Array.isArray(value.accepts))return Buffer.from(body);
  }
  return null;
}
export function originalBazaarExample(rawChallenge) {
  const parsed=parseExactJSON(rawChallenge);
  for(const pointer of ['/extensions/bazaar/info/output/example','/extensions/bazaar/output/example']){
    if(Object.hasOwn(parsed.spans,pointer))return{bytes:originalJSONFragment(parsed,pointer),sourcePointer:pointer};
  }
  need(false,'PROVIDER_EXAMPLE_UNAVAILABLE','This original challenge contains no inline Bazaar output example',404);
}
function sourceTime(value,label) {
  text(value,label,100);need(Number.isFinite(Date.parse(value)),'INVALID_SOURCE_TIME',label+' must identify an actual date and time');return value;
}
export function retainCapture(store,{projectId,request,name,basis,httpStatus,requestUrl,observedAt=now(),
  body=null,headers={},bodyFileId=null,headersFileId=null,sourceFileId=null,parentCaptureId=null,
  rawBodyReference=null,originalOutcome=null,originalQueue=null,sourcePointer=null,transportError=null}) {
  need(request?.id&&request.projectId===projectId,'REQUEST_REQUIRED');
  need(Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599,'INVALID_HTTP_STATUS');
  const captureId=uuid(),notices=[],normalizedHeaders=headerEntries(headers);
  let raw=body===null?null:Buffer.from(body),challenge=null,challengeFileId=null;
  if(bodyFileId){
    const f=store.fileInfo(bodyFileId);need(f.projectId===projectId,'WRONG_PROJECT');
    raw=store.fileBytes(bodyFileId);
  }else if(raw!==null){
    need(raw.length<=LIMITS.responseBytes,'RESPONSE_TOO_LARGE');
    bodyFileId=store.file(projectId,(name??request.name)+' — original response.bin',
      headerValue(normalizedHeaders,'content-type')??'application/octet-stream',raw).id;
  }
  if(rawBodyReference&&raw!==null)need(rawBodyReference.sha256===sha(raw)&&rawBodyReference.bytes===raw.length,
    'ORIGINAL_BODY_HASH_MISMATCH','The selected body differs from its original HTTP metadata');
  if(headersFileId)need(store.fileInfo(headersFileId).projectId===projectId,'WRONG_PROJECT');
  else headersFileId=store.file(projectId,(name??request.name)+' — headers.json','application/json',jsonBytes(normalizedHeaders)).id;
  if(sourceFileId)need(store.fileInfo(sourceFileId).projectId===projectId,'WRONG_PROJECT');
  try{
    const decoded=challengeBytes(normalizedHeaders,raw);
    if(decoded){
      challenge=displayChallenge(decoded);
      challengeFileId=store.file(projectId,(name??request.name)+' — payment-required.json','application/json',decoded).id;
      need(Array.isArray(challenge.accepts)&&challenge.accepts.length>0,'CHALLENGE_WITHOUT_OPTIONS');
    }
  }catch(error){notices.push({code:errorView(error).code,message:'The original payment challenge could not be interpreted: '+errorView(error).message})}
  const kind=httpStatus===402||challenge!==null?'challenge':'response';
  let rows=[],analysis={rowCount:0,kinds:{},missing:[],sourceTimes:[]};
  if(kind==='response'&&raw!==null&&httpStatus>=200&&httpStatus<=299){
    try{
      const result=analyzeMarketResponse(raw,request,captureId);
      rows=result.rows;analysis=result.analysis;notices.push(...result.notices);
    }catch(error){analysis.error=errorView(error);notices.push({code:'UNINDEXED_ORIGINAL_RESPONSE',message:'Original bytes are retained; this endpoint’s analysis could not index the response'})}
  }
  if(transportError)notices.push({code:'ORIGINAL_RESPONSE_BODY_INCOMPLETE',message:transportError.message,originalError:transportError});
  if(basis==='provider_bazaar_example')notices.unshift({code:'RETAINED_PROVIDER_EXAMPLE',
    message:'This is the provider’s retained Bazaar example, not an observed current market quote'});
  const advertised=typeof challenge?.resource==='string'?challenge.resource:challenge?.resource?.url??null;
  if(advertised&&advertised!==requestUrl)notices.push({code:'ADVERTISED_RESOURCE_DIFFERS_FROM_REQUEST',
    message:'The original advertised resource and actual request URL are retained separately. The native buyer’s existing URL binding still applies.'});
  const value=store.put('captures',{id:captureId,projectId,name:text(name??request.name,'capture name',240),
    requestId:request.id,requestVersion:request.version,requestReference:request.reference??request.id,request:structuredClone(request),
    endpoint:request.endpoint,path:structuredClone(request.path),query:structuredClone(request.query),
    requestUrl:text(requestUrl,'original request URL',65536),advertisedResourceUrl:advertised,kind,basis,
    observedAt:sourceTime(observedAt,'observed time'),receivedAt:now(),httpStatus,bodyFileId,headersFileId,challengeFileId,
    sourceFileId,parentCaptureId,sourcePointer,challenge,notices,analysis,
    rawBodyReference:raw===null?(rawBodyReference?{...rawBodyReference,available:false}:null):{sha256:sha(raw),bytes:raw.length,available:true},
    ...(originalOutcome===null?{}:{originalOutcome}),...(originalQueue===null?{}:{originalQueue})});
  store.setRows(value.id,projectId,rows);return value;
}
export function importCapture(store,projectId,request,body) {
  const file=store.fileInfo(body.fileId);need(file.projectId===projectId,'WRONG_PROJECT');
  const bytes=store.fileBytes(file.id);let metadata;
  try{metadata=parseSourceJSON(bytes)}catch{}
  let headers={},headersFileId=body.headersFileId??null;
  if(headersFileId){
    const info=store.fileInfo(headersFileId);need(info.projectId===projectId,'WRONG_PROJECT');
    const source=parseSourceJSON(store.fileBytes(headersFileId));headers=headerEntries(source.headers??source);
  }
  if(plain(metadata)&&plain(metadata.headers)&&typeof metadata.url==='string'&&Number.isInteger(metadata.status)){
    const originalBody=body.responseBodyFileId?store.fileBytes(body.responseBodyFileId):null;
    return retainCapture(store,{projectId,request,name:body.name,basis:'operator_response',
      httpStatus:metadata.status,requestUrl:metadata.url,observedAt:metadata.observed_at??body.observedAt??now(),
      body:originalBody,bodyFileId:body.responseBodyFileId??null,headers:metadata.headers,sourceFileId:file.id,
      rawBodyReference:typeof metadata.body_sha256==='string'&&Number.isSafeInteger(metadata.bytes)?
        {sha256:metadata.body_sha256,bytes:metadata.bytes,available:originalBody!==null}:null});
  }
  return retainCapture(store,{projectId,request,name:body.name,basis:'operator_response',
    httpStatus:body.httpStatus??200,requestUrl:body.sourceUrl??request.urls.vendor,observedAt:body.observedAt??now(),
    bodyFileId:file.id,headers,headersFileId,sourceFileId:file.id});
}
