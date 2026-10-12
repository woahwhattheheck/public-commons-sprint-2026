// MIT. The host borrows the existing private browser owner over direct loopback HTTP.
import { request as httpRequest } from 'node:http';
import { need, plain, jsonBytes, LIMITS } from './model.mjs';

export function gdeltLoopbackUrl(value) {
  let url;try{url=new URL(value);}catch{need(false,'Open the original private GDELT URL.');}
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&!url.search&&
    url.pathname==='/'&&/^[a-f0-9]{64}$/.test(url.hash.slice(1))&&Number(url.port)>=1&&Number(url.port)<=65535,
    'Use the exact original private loopback URL.','GDELT_CONNECTION_INVALID');
  return url;
}
/** Does not consult environment proxies, redirect, acquire source or own the server. */
export async function gdeltLoopbackRequest({url,path,body,maxBytes=8*1024*1024,signal,timeout=300000}={}) {
  const base=gdeltLoopbackUrl(url);
  need(['/api/state','/api/launch','/api/query','/api/action','/api/download','/api/cancel'].includes(path),
    'Select the original GDELT application endpoint.');
  need(Number.isSafeInteger(maxBytes)&&maxBytes>=1&&maxBytes<=LIMITS.projectBytes&&
    Number.isSafeInteger(timeout)&&timeout>=1&&timeout<=3600000,'Use the declared local response capacity.');
  const payload=body===undefined?null:jsonBytes(body);
  need(!payload||payload.length<=LIMITS.projectBytes,'The request exceeds the original project capacity.');
  signal?.throwIfAborted();
  const result=await new Promise((resolve,reject)=>{
    let finished=false,response=null,timer;
    const finish=(error,value)=>{
      if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      error?reject(error):resolve(value);
    };
    const req=httpRequest({protocol:'http:',hostname:'127.0.0.1',port:base.port,path,
      method:payload?'POST':'GET',agent:false,headers:{authorization:'Bearer '+base.hash.slice(1),
        accept:path==='/api/download'?'*/*':'application/json','accept-encoding':'identity',
        ...(payload?{'content-type':'application/json','content-length':payload.length}:{})}},res=>{
      response=res;const chunks=[];let size=0;
      const rejectResponse=error=>{res.destroy(error);req.destroy(error);};
      res.on('error',error=>finish(error));
      res.on('aborted',()=>finish(Object.assign(new Error('The original local response was interrupted.'),{code:'GDELT_LOCAL_INTERRUPTED'})));
      try{
        const length=res.headers['content-length'];
        need(length===undefined||/^\d+$/.test(length)&&Number(length)<=maxBytes,'The original local response exceeds capacity.','GDELT_LOCAL_RESPONSE_TOO_LARGE');
        need(!res.headers['content-encoding']||res.headers['content-encoding']==='identity','The original local response encoding changed.');
      }catch(error){rejectResponse(error);return;}
      res.on('data',chunk=>{
        size+=chunk.length;
        if(size>maxBytes)return rejectResponse(Object.assign(new Error('The original local response exceeds capacity.'),{code:'GDELT_LOCAL_RESPONSE_TOO_LARGE'}));
        chunks.push(chunk);
      });
      res.on('end',()=>{
        if(finished)return;
        const bytes=Buffer.concat(chunks,size),length=res.headers['content-length'];
        if(length!==undefined&&Number(length)!==size)return finish(Object.assign(new Error('The original local response length changed.'),{code:'GDELT_LOCAL_INTERRUPTED'}));
        finish(null,{status:res.statusCode,headers:res.headers,bytes});
      });
    });
    const abort=()=>{const error=signal?.reason??Object.assign(new Error('The borrowed request was cancelled.'),{code:'GDELT_LOCAL_CANCELLED'});response?.destroy(error);req.destroy(error);};
    req.on('error',error=>finish(error));
    req.on('close',()=>{if(!finished&&!response)finish(Object.assign(new Error('The local request ended before a response.'),{code:'GDELT_LOCAL_INTERRUPTED'}));});
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{const error=Object.assign(new Error('The original local request timed out; recover its same operation.'),{code:'GDELT_LOCAL_TIMEOUT'});response?.destroy(error);req.destroy(error);},timeout);
    if(signal?.aborted)abort();else req.end(payload??undefined);
  });
  if(result.status!==200){
    let original;try{original=JSON.parse(result.bytes.toString('utf8'));}catch{}
    throw Object.assign(new Error(typeof original?.message==='string'?original.message:'The original local application returned HTTP '+result.status),
      {code:original?.code??'GDELT_LOCAL_APPLICATION_ERROR',status:result.status,...(original?.retryAt?{retryAt:original.retryAt}:{})});
  }
  return result;
}
export async function gdeltLoopbackJson(options) {
  const result=await gdeltLoopbackRequest(options);
  need(/^application\/json(?:\s*;|$)/i.test(result.headers['content-type']??''),'The original local JSON response changed.');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.bytes));
}
