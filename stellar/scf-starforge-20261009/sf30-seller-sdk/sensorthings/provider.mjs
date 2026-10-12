// MIT. Retained read-only SensorThings requests; no automatic provider retries.
import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {readOwned,privateDirectory} from '../stellar-expert/store.mjs';
import {sha,identity,json,now,fault,sourceURL,sourceDocument,plain} from './contract.mjs';
const HEADER_NAMES=['content-type','content-length','content-encoding','date','etag','last-modified','location','retry-after','cache-control','vary','warning','server'];
const cleanHeaders=headers=>Object.fromEntries(HEADER_NAMES.flatMap(k=>{const v=typeof headers?.get==='function'?headers.get(k):headers?.[k];return v===null||v===undefined?[]:[[k,String(v)]];}));
export const RESPONSE_RECEIPT_MAX_BYTES=1024*1024;
export const CONNECTOR_TEXT_MAX_BYTES=200*1024;
const readJson=async(path,max=RESPONSE_RECEIPT_MAX_BYTES)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(path,max)));
async function maybe(path){try{return await readJson(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export function retryAfter(value,observedAt){
  if(typeof value!=='string')return null;
  let time;if(/^\d+$/.test(value))time=Date.parse(observedAt)+Number(value)*1000;else time=Date.parse(value);
  return Number.isFinite(time)&&time>Date.parse(observedAt)?new Date(time).toISOString():null;
}

export const CONNECTOR_TEXT_REPRESENTATION='RETAINED_CONNECTOR_UTF8_TEXT';
const CONNECTOR_BUNDLE_SCHEMA='stellar-forge.sensorthings-connector-responses.v1';
const CONNECTOR_RECEIPT_SCHEMA='stellar-forge.sensorthings-connector-source-receipt.v1';
function toolDocument(value,label){
  if(!plain(value)||value.isError===true||!Array.isArray(value.content)||value.content.length!==1||
      value.content[0]?.type!=='text'||typeof value.content[0].text!=='string')
    throw fault('CONNECTOR_RECEIPT','Retain the complete successful '+label+' tool response.',422);
  let parsed;try{parsed=JSON.parse(value.content[0].text);}catch{throw fault('CONNECTOR_RECEIPT','The original '+label+' tool response is not JSON.',422);}
  if(!plain(parsed))throw fault('CONNECTOR_RECEIPT','The original '+label+' tool response is not an object.',422);
  return parsed;
}
function verifyConnectorReceipt(record,body,url,capturedAt){
  if(body.length>CONNECTOR_TEXT_MAX_BYTES)throw fault('CONNECTOR_TEXT_LIMIT','The declared connector only returns complete UTF-8 attachments up to 200 KiB.',413);
  if(!plain(record)||record.schema!==CONNECTOR_RECEIPT_SCHEMA||record.sourceUrl!==url||
      record.receivedAt!==capturedAt||record.representation!=='COMPLETE_CONNECTOR_UTF8_TEXT'||
      record.sourceHttpStatus!==null||record.sourceHttpHeaders!==null||
      record.method!=='Notion create_attachment(source_url), then download_attachment(file_upload_id)'||
      !plain(record.request)||record.request.source_url!==url||record.request.content_type!=='application/json'||
      !plain(record.body)||record.body.filename!==record.request.filename||
      record.body.bytes!==body.length||record.body.sha256!==sha(body)||!plain(record.connector))
    throw fault('CONNECTOR_RECEIPT','The received text must retain its exact source URL, bytes and connector provenance without invented HTTP metadata.',422);
  const upload=toolDocument(record.connector.attachment,'attachment upload'),
    download=toolDocument(record.connector.download,'attachment download');
  if(upload.status!=='uploaded'||typeof upload.file_upload_id!=='string'||!upload.file_upload_id||
      download.file_upload_id!==upload.file_upload_id||upload.filename!==record.request.filename||
      download.filename!==upload.filename||upload.content_length!==body.length||download.content_length!==body.length||
      typeof upload.content_type!=='string'||typeof download.content_type!=='string'||
      !/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(upload.content_type)||
      download.content_type!==upload.content_type||typeof download.content!=='string')
    throw fault('CONNECTOR_RECEIPT','The successful upload and complete download must name the same original text attachment.',422);
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(body);}catch{throw fault('CONNECTOR_UTF8','The retained connector text is not valid UTF-8.',422);}
  if(text!==download.content||!Buffer.from(download.content,'utf8').equals(body))
    throw fault('CONNECTOR_BYTES','The received UTF-8 text differs from the complete original connector download.',409);
  return {schema:'stellar-forge.sensorthings-connector-text.v1',connector:'Notion attachment',
    fileUploadId:upload.file_upload_id,filename:upload.filename,contentType:download.content_type,
    bytes:body.length,sha256:sha(body),receivedAt:capturedAt,
    timestampBasis:record.timestampBasis??'Clock read after the complete connector download returned.',
    httpStatusObserved:false,httpHeadersObserved:false,httpMethodObserved:false,
    contentTypeBasis:'Connector attachment metadata; not an observed provider HTTP header.'};
}

function checkConnectorReceiptCapacity(response,requestId){
  const {body,...metadata}=response;
  const retained={schema:'stellar-forge.sensorthings-response.v1',requestId:requestId??'0'.repeat(64),
    requestSha256:'0'.repeat(64),...metadata,sha256:sha(body),bytes:body.length,retryNotBefore:null};
  if(json(retained).length>RESPONSE_RECEIPT_MAX_BYTES)
    throw fault('CONNECTOR_RECEIPT_LIMIT','Both complete original tool responses must fit the same 1 MiB native receipt read/seal limit. No provenance is truncated.',413);
}

export async function originalRequest(config,url,{signal,requestId=null,fetchImpl=fetch,environment=process.env,transport}={}){
  url=sourceURL(url,config);const startedAt=now();
  if(transport){
    const source=await transport.request(url,{signal,requestId});
    if(!plain(source)||source.url!==url||!Buffer.isBuffer(source.body)||source.body.length>config.maxPageBytes||
        typeof source.capturedAt!=='string'||!Number.isFinite(Date.parse(source.capturedAt)))
      throw fault('RECORDING','The host-selected recording is not a complete retained response.',422);
    if(source.representation===CONNECTOR_TEXT_REPRESENTATION){
      if(source.status!==null||!plain(source.headers)||Object.keys(source.headers).length)
        throw fault('CONNECTOR_HTTP_METADATA','This connector did not expose provider HTTP status or headers; retain them as unobserved.',422);
      const connectorTransfer=verifyConnectorReceipt(source.connectorReceipt,source.body,url,source.capturedAt);
      const retained={body:source.body,url,requestedUrl:url,status:null,headers:{},startedAt,completedAt:now(),
        sourceCapturedAt:source.capturedAt,representation:CONNECTOR_TEXT_REPRESENTATION,connectorTransfer,
        originalReceipt:{...(source.originalReceipt??{}),connectorReceipt:source.connectorReceipt},complete:true,error:null};
      checkConnectorReceiptCapacity(retained,requestId);return retained;
    }
    if(!Number.isInteger(source.status)||source.status<100||source.status>599)
      throw fault('RECORDING','An original HTTP response must retain its observed HTTP status.',422);
    return {body:source.body,url,requestedUrl:url,status:source.status,headers:cleanHeaders(source.headers),startedAt,
      completedAt:now(),sourceCapturedAt:source.capturedAt,representation:'RECORDED_ORIGINAL_APPLICATION_BODY',
      originalReceipt:source.originalReceipt??null,complete:true,error:null};
  }
  const headers={Accept:'application/json','User-Agent':'StellarForge-SensorThings/1.0'};
  if(config.authorizationEnv){
    const value=environment[config.authorizationEnv];
    if(typeof value!=='string'||!value||/[\r\n]/.test(value))throw fault('CREDENTIAL_UNAVAILABLE','The host-selected authorization environment value is unavailable.',503);
    headers.Authorization=value;
  }
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(config.requestTimeoutMs)]):AbortSignal.timeout(config.requestTimeoutMs);
  let response,chunks=[],length=0,complete=false,error=null;
  try{
    response=await fetchImpl(url,{method:'GET',headers,redirect:'manual',signal:combined});
    const reader=response.body?.getReader();
    if(reader){
      try{while(true){const part=await reader.read();if(part.done){complete=true;break;}
        const available=config.maxPageBytes-length;
        if(part.value.length>available){if(available>0){chunks.push(Buffer.from(part.value.subarray(0,available)));length+=available;}
          error={code:'BODY_LIMIT',message:'The original response exceeds the selected page limit. Its received prefix is retained.'};await reader.cancel();break;}
        chunks.push(Buffer.from(part.value));length+=part.value.length;
      }}finally{reader.releaseLock();}
    }else complete=true;
  }catch(e){error={code:combined.aborted?'INTERRUPTED':'TRANSPORT',message:'The provider read did not return a complete body.'};}
  return {body:Buffer.concat(chunks,length),url:response?.url||url,requestedUrl:url,status:response?.status??null,
    headers:cleanHeaders(response?.headers),startedAt,completedAt:now(),sourceCapturedAt:now(),
    representation:'ORIGINAL_APPLICATION_BODY_AFTER_HTTP_CONTENT_DECODING',complete,error};
}
/** A request identity is bound before HTTP. A complete retained receipt reopens
 * without HTTP. An interrupted request needs a distinct, explicitly resumed
 * attempt; this function never silently reuses its identity for another read. */
export async function retainedGet(store,config,{requestId,url,cause,signal,fetchImpl,environment,transport}={}){
  if(!/^[a-f0-9]{64}$/.test(requestId??''))throw fault('REQUEST_ID','Use the original deterministic request identity.');
  url=sourceURL(url,config);const directory=join(store.root,'receipts');
  await privateDirectory(directory);
  const requestPath=join(directory,'sensorthings-'+requestId+'-request.json'),responsePath=join(directory,'sensorthings-'+requestId+'-response.json');
  const selection={schema:'stellar-forge.sensorthings-request.v1',requestId,url,method:'GET',
    sourceConfigurationSha256:identity(config),authorizationEnv:config.authorizationEnv??null,cause:cause??null};
  let recorded=await maybe(responsePath);
  if(recorded){
    if(recorded.schema!=='stellar-forge.sensorthings-response.v1'||recorded.requestId!==requestId||
      recorded.requestSha256!==identity(selection)||recorded.requestedUrl!==url)throw fault('RECEIPT_CHANGED','The original response binding differs.',409);
    const body=await store.object(recorded.sha256);if(body.length!==recorded.bytes)throw fault('RECEIPT_CHANGED','The original response length differs.',409);
    return {receipt:recorded,body,reused:true};
  }
  const prior=await maybe(requestPath);
  if(prior){
    if(prior.requestSha256!==identity(selection))throw fault('REQUEST_CHANGED','The request identity belongs to another selection.',409);
    throw fault('REQUEST_INTERRUPTED','This original request began without a finalized response. Resume the capture explicitly to retain a new read attempt.',409,{requestId});
  }
  const request={...selection,requestSha256:identity(selection),startedAt:now()};
  await store.immutable(requestPath,json(request));
  let response;
  try{response=await originalRequest(config,url,{signal,requestId,fetchImpl,environment,transport});}
  catch(e){response={body:Buffer.alloc(0),url,requestedUrl:url,status:null,headers:{},startedAt:request.startedAt,completedAt:now(),
      sourceCapturedAt:null,representation:transport?.mode==='RECORDED_CONNECTOR_UTF8_TEXT'?CONNECTOR_TEXT_REPRESENTATION:transport?'RECORDED_ORIGINAL_APPLICATION_BODY':'ORIGINAL_APPLICATION_BODY_AFTER_HTTP_CONTENT_DECODING',
      complete:false,error:{code:e.code??'REQUEST_UNAVAILABLE',message:e.message}};}
  const object=await store.putObject(response.body);
  const {body,...metadata}=response;
  recorded={schema:'stellar-forge.sensorthings-response.v1',requestId,requestSha256:request.requestSha256,...metadata,
    ...object,retryNotBefore:retryAfter(response.headers['retry-after'],response.completedAt)};
  await store.immutable(responsePath,json(recorded));
  return {receipt:recorded,body,reused:false};
}
export function decodeResponse(response){
  const r=response.receipt;
  if(!r.complete)throw fault('INCOMPLETE_RESPONSE','The original response body is incomplete; its prefix and error remain retained.',502,{requestId:r.requestId,error:r.error});
  if(r.representation===CONNECTOR_TEXT_REPRESENTATION){
    if(r.status!==null||!plain(r.headers)||Object.keys(r.headers).length)throw fault('CONNECTOR_HTTP_METADATA','Provider HTTP metadata was not exposed by this connector.',422);
    const checked=verifyConnectorReceipt(r.originalReceipt?.connectorReceipt,response.body,r.requestedUrl,r.sourceCapturedAt);
    if(identity(checked)!==identity(r.connectorTransfer))throw fault('CONNECTOR_RECEIPT','The retained connector transfer summary differs.',409);
  }else{
  if(r.status!==200)throw fault('HTTP_RESPONSE','The provider returned HTTP '+r.status+'. Its original body and headers remain retained.',r.status===429?429:502,
    {requestId:r.requestId,httpStatus:r.status,retryNotBefore:r.retryNotBefore,location:r.headers.location??null});
  if(!/\b(?:application|text)\/(?:[a-z0-9.-]+\+)?json\b/i.test(r.headers['content-type']??''))
    throw fault('RESPONSE_TYPE','The provider did not identify this response as JSON; the complete original body remains retained.',422,{requestId:r.requestId});
  }
  try{return sourceDocument(response.body);}catch(e){if(e.code?.startsWith('SENSORTHINGS_'))throw e;
    throw fault('RESPONSE_JSON','The provider returned ambiguous, malformed or unsupported JSON; its complete original body remains retained.',422,{requestId:r.requestId});}
}
export async function recordedTransport(path){
  const bytes=await readOwned(path,128*1024*1024),bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),
    connector=bundle?.schema===CONNECTOR_BUNDLE_SCHEMA,bundleSha256=sha(bytes);
  if(![CONNECTOR_BUNDLE_SCHEMA,'stellar-forge.sensorthings-original-responses.v1'].includes(bundle?.schema)||!Array.isArray(bundle.responses))
    throw fault('RECORDING_SCHEMA','Use a complete original HTTP-response or connector-text bundle.');
  const pages=new Map(),all=[];
  for(let index=0;index<bundle.responses.length;index++){
    const item=bundle.responses[index];
    if(!plain(item)||typeof item.url!=='string'||typeof item.bodyBase64!=='string')throw fault('RECORDING_SCHEMA','A retained response is incomplete.');
    const body=Buffer.from(item.bodyBase64,'base64');
    if(body.toString('base64')!==item.bodyBase64||sha(body)!==item.sha256||body.length!==item.bytes)
      throw fault('RECORDING_HASH','An original recorded response differs from its declared bytes.',409);
    if(connector){
      if(item.status!==null||!plain(item.headers)||Object.keys(item.headers).length||
          typeof item.capturedAt!=='string'||!Number.isFinite(Date.parse(item.capturedAt)))
        throw fault('CONNECTOR_HTTP_METADATA','Retain unknown HTTP metadata and the actual connector receipt time.',422);
      verifyConnectorReceipt(item.connectorReceipt,body,item.url,item.capturedAt);
    }else if(item.representation===CONNECTOR_TEXT_REPRESENTATION){
      throw fault('RECORDING_SCHEMA','Connector text requires its explicit connector bundle schema.',422);
    }
    const row={...item,body,recordingIndex:index,
      ...(connector?{representation:CONNECTOR_TEXT_REPRESENTATION}:{}),
      originalReceipt:{bundleSha256,source:bundle.source??null,sourceRequestId:item.requestId??null,
        responseIndex:index,sha256:item.sha256,bytes:item.bytes,capturedAt:item.capturedAt}};
    if(connector){
      // Fixed-width placeholders reserve the complete native IDs/timestamps.
      // This is receipt sizing only; no original source field is replaced.
      checkConnectorReceiptCapacity({body,url:item.url,requestedUrl:item.url,status:null,headers:{},
        startedAt:'9999-12-31T23:59:59.999Z',completedAt:'9999-12-31T23:59:59.999Z',
        sourceCapturedAt:item.capturedAt,representation:CONNECTOR_TEXT_REPRESENTATION,
        connectorTransfer:verifyConnectorReceipt(item.connectorReceipt,body,item.url,item.capturedAt),
        originalReceipt:{...row.originalReceipt,connectorReceipt:item.connectorReceipt},complete:true,error:null},'0'.repeat(64));
    }
    const rows=pages.get(item.url)??[];rows.push(row);pages.set(item.url,rows);all.push(row);
  }
  const used=new Set(),bindings=new Map();let boundRoot=null;
  return {mode:connector?'RECORDED_CONNECTOR_UTF8_TEXT':'RECORDED_ORIGINAL_RESPONSES',sha256:bundleSha256,
    async bindStore(store){
      if(boundRoot!==null&&boundRoot!==store.root)throw fault('RECORDING_WORKSPACE','This recording instance is already bound to another native workspace.',409);
      boundRoot=store.root;used.clear();bindings.clear();
      let names;try{names=await readdir(join(store.root,'receipts'));}catch(e){if(e.code==='ENOENT')return;throw e;}
      for(const name of names.sort()){
        const match=/^sensorthings-([a-f0-9]{64})-response\.json$/.exec(name);if(!match)continue;
        const receipt=await readJson(join(store.root,'receipts',name));
        if(receipt.originalReceipt?.bundleSha256!==bundleSha256)continue;
        if(receipt.schema!=='stellar-forge.sensorthings-response.v1'||receipt.requestId!==match[1]||receipt.complete!==true)
          throw fault('RECORDING_RECEIPT','A saved recording receipt is incomplete or has a different native identity.',409);
        let row;
        if(Number.isSafeInteger(receipt.originalReceipt.responseIndex))row=all[receipt.originalReceipt.responseIndex];
        else{
          const candidates=(pages.get(receipt.requestedUrl)??[]).filter(x=>x.sha256===receipt.sha256&&x.bytes===receipt.bytes&&
            x.capturedAt===receipt.sourceCapturedAt&&(x.requestId??null)===(receipt.originalReceipt.sourceRequestId??null));
          if(candidates.length!==1)throw fault('RECORDING_RECEIPT_AMBIGUOUS','The old saved receipt does not identify one exact original response occurrence.',409);
          row=candidates[0];
        }
        if(!row||row.url!==receipt.requestedUrl||row.sha256!==receipt.sha256||row.bytes!==receipt.bytes||
            row.capturedAt!==receipt.sourceCapturedAt||used.has(row.recordingIndex))
          throw fault('RECORDING_RECEIPT','A saved request does not match one unused original response occurrence.',409);
        const request=await readJson(join(store.root,'receipts','sensorthings-'+receipt.requestId+'-request.json')),
          {requestSha256,startedAt,...selection}=request;
        if(selection.requestId!==receipt.requestId||selection.url!==row.url||selection.method!=='GET'||
            identity(selection)!==requestSha256||requestSha256!==receipt.requestSha256)
          throw fault('RECORDING_RECEIPT','The saved original request and response bindings differ.',409);
        if(connector&&(receipt.representation!==CONNECTOR_TEXT_REPRESENTATION||
            identity(receipt.originalReceipt.connectorReceipt)!==identity(row.connectorReceipt)))
          throw fault('CONNECTOR_RECEIPT','The saved native receipt differs from the original connector evidence.',409);
        used.add(row.recordingIndex);bindings.set(receipt.requestId,row);
      }
    },
    inspect(){return {schema:'stellar-forge.sensorthings-recording-selection.v1',bundleSha256,
      selectionBasis:'Current process selections; rebuilt from finalized native response receipts when the same workspace reopens.',
      total:all.length,consumed:used.size,remaining:all.filter(x=>!used.has(x.recordingIndex)).map(x=>({
        responseIndex:x.recordingIndex,requestId:x.requestId??null,url:x.url,sha256:x.sha256,bytes:x.bytes,capturedAt:x.capturedAt}))};},
    async request(url,{requestId=null}={}){
      if(requestId!==null&&(!/^[a-f0-9]{64}$/.test(requestId)))throw fault('REQUEST_ID','Use the original native request identity.');
      const previous=requestId===null?null:bindings.get(requestId);
      if(previous){if(previous.url!==url)throw fault('RECORDING_REQUEST','This native request is already bound to another original URL.',409);return previous;}
      const row=(pages.get(url)??[]).find(x=>!used.has(x.recordingIndex));
      if(!row)throw fault('RECORDING_URL','No unused original response is retained for this exact URL. No substitute response will be generated.',404,{url});
      used.add(row.recordingIndex);if(requestId!==null)bindings.set(requestId,row);return row;
    }};
}
export async function requestReceipt(store,requestId){
  const r=await readJson(join(store.root,'receipts','sensorthings-'+requestId+'-response.json'));
  const body=await store.object(r.sha256);if(body.length!==r.bytes)throw fault('RECEIPT_CHANGED','The original response length differs.',409);return {receipt:r,body};
}
