// SPDX-License-Identifier: MIT
// Serial original GET acquisition; every received response is retained before advancing its page.
import { digest } from '../postgres/publisher/files.mjs';
import { API, plan, queryUrl, decodePage, nextPage, sameRequest, need, SCHEMA, clone } from './core.mjs';
const MAX_PAGE=16*1024*1024;
const retainedHeaders=['content-type','date','etag','last-modified','retry-after','content-length'];
function retryAfter(value,now) {
  if(!value)return null;
  if(/^[0-9]+$/.test(value))return new Date(now+Number(value)*1000).toISOString();
  const parsed=Date.parse(value);return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
}
export function newCapture(id,input,createdAt) {
  return {schema:SCHEMA+'.capture',id,plan:plan(input),createdAt,state:'PENDING',pages:[],attempts:[],next:queryUrl(input),notBefore:null};
}
async function responseBytes(response) {
  const chunks=[];let size=0;
  for await(const chunk of response.body??[]) { size+=chunk.length;need(size<=MAX_PAGE,'GLEIF_PAGE_TOO_LARGE','The provider page exceeds 16 MiB; its source query must be resumed with an appropriate original page size.');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}
export async function captureSource(capture,{put,save,fetchImpl=globalThis.fetch,signal,clock=()=>new Date()}={}) {
  need(capture.schema===SCHEMA+'.capture','GLEIF_CAPTURE','Open the retained source capture.');
  if(capture.state==='COMPLETE')return capture;
  const first=queryUrl(capture.plan);
  if(capture.notBefore)need(clock().getTime()>=Date.parse(capture.notBefore),'GLEIF_PROVIDER_COOLDOWN','Resume this capture after '+capture.notBefore+'.',429);
  capture.state='FETCHING';capture.error=null;await save(capture);
  const seen=new Set(capture.pages.map(p=>p.url));
  while(capture.next!==null) {
    signal?.throwIfAborted();const url=capture.next;
    need(!seen.has(url),'GLEIF_SOURCE_LOOP','This source page is already retained.');
    // Only the selected official resource can be fetched; redirects are returned as source observations.
    const selected=new URL(url);need(selected.origin===new URL(API).origin&&selected.pathname===new URL(first).pathname&&!selected.username&&!selected.password,'GLEIF_SOURCE_ORIGIN','Select the original official source.');
    const startedAt=clock().toISOString();let response,raw;
    try {
      response=await fetchImpl(url,{headers:{accept:'application/vnd.api+json'},redirect:'manual',
        signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});
      raw=await responseBytes(response);
    } catch(error) {
      capture.state='INTERRUPTED';capture.error={code:signal?.aborted?'GLEIF_CAPTURE_PAUSED':'GLEIF_TRANSPORT',message:String(error?.message??error),url,startedAt};
      await save(capture);throw Object.assign(new Error(capture.error.message),capture.error);
    }
    const observedAt=clock().toISOString(),sha256=digest(raw);await put(raw);
    const observation={url,startedAt,observedAt,status:response.status,headers:Object.fromEntries(retainedHeaders.flatMap(k=>response.headers.has(k)?[[k,response.headers.get(k)]]:[])),sha256,bytes:raw.length};
    capture.attempts.push(observation);
    if(!response.ok) {
      capture.notBefore=retryAfter(response.headers.get('retry-after'),clock().getTime());
      capture.state='INTERRUPTED';capture.error={code:'GLEIF_PROVIDER_RESPONSE',message:'GLEIF returned HTTP '+response.status+'.',status:response.status,url,sha256,notBefore:capture.notBefore};
      await save(capture);throw Object.assign(new Error(capture.error.message),capture.error);
    }
    let decoded,next;
    try {
      const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
      decoded=decodePage(text,url);next=nextPage(decoded.next,first,url);
      if(capture.plan.kind==='lei')need(decoded.resources.every(r=>r.id===capture.plan.query),'GLEIF_SOURCE_IDENTITY','The exact-LEI response contains another entity.');
    } catch(error) {
      capture.state='INTERRUPTED';capture.error={code:error.code??'GLEIF_SOURCE_RESPONSE',message:error.message,url,sha256};
      await save(capture);throw error;
    }
    capture.pages.push({...observation,records:decoded.resources.length});
    capture.next=next;capture.notBefore=null;capture.error=null;seen.add(url);
    if(next===null){capture.state='COMPLETE';capture.completedAt=observedAt;}
    await save(capture);
    if(next!==null)await new Promise((resolve,reject)=>{
      const done=()=>{signal?.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,1000);
      const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason??new Error('Capture paused.'));};
      if(signal){signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}
    });
  }
  return capture;
}
export function importCapture(id,input,createdAt) {
  const result=newCapture(id,input.plan,createdAt),objects=[];
  need(Array.isArray(input.pages)&&input.pages.length>0,'GLEIF_IMPORT','Provide the original source pages.');
  let expected=queryUrl(result.plan);
  for(const page of input.pages) {
    need(expected!==null&&sameRequest(page.url,expected),'GLEIF_IMPORT_SEQUENCE','Imported pages must follow the original query in source order.');
    need(typeof page.observedAt==='string'&&Number.isFinite(Date.parse(page.observedAt))&&typeof page.body==='string',
      'GLEIF_IMPORT_OBSERVATION','Retain the original observed time and complete UTF-8 body.');
    const raw=Buffer.from(page.body),decoded=decodePage(page.body,page.url);need(raw.length<=MAX_PAGE,'GLEIF_PAGE_TOO_LARGE');
    if(page.status!==200){
      const acquisition=page.acquisition,receipt=acquisition?.receipt;
      need(page.status===null&&page.headers===null&&acquisition?.kind==='SOURCE_URL_ATTACHMENT'&&sameRequest(acquisition.sourceUrl,page.url)&&
        acquisition.sha256===digest(raw)&&receipt?.status==='uploaded'&&typeof receipt.file_upload_id==='string'&&receipt.file_upload_id.length>0&&
        receipt.content_length===raw.length&&typeof receipt.content_type==='string'&&/json/i.test(receipt.content_type),
        'GLEIF_IMPORT_OBSERVATION','Retain the original HTTP response or the complete source URL attachment acquisition receipt.');
    }
    if(result.plan.kind==='lei')need(decoded.resources.every(r=>r.id===result.plan.query),'GLEIF_SOURCE_IDENTITY');
    const entry={url:page.url,observedAt:page.observedAt,startedAt:page.startedAt??page.observedAt,status:page.status,
      headers:clone(page.headers??null),sha256:digest(raw),bytes:raw.length,records:decoded.resources.length,acquisition:clone(page.acquisition??{kind:'IMPORTED_HTTP_RESPONSE'})};
    result.pages.push(entry);result.attempts.push(entry);objects.push(raw);
    expected=nextPage(decoded.next,queryUrl(result.plan),page.url);
  }
  result.next=expected;result.state=expected===null?'COMPLETE':'INTERRUPTED';
  if(result.state==='COMPLETE')result.completedAt=result.pages.at(-1).observedAt;
  result.importedAt=createdAt;return {capture:result,objects};
}
