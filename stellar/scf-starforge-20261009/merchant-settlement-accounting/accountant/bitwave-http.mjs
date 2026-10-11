// MIT. Small native Bitwave Data Fusion transport. No automatic write retry.
import {bitwaveCheck,bitwaveTargetId} from './bitwave.mjs';

export const BITWAVE_API_BASE='https://api4.bitwave.io';
export const BITWAVE_TOKEN_ENV='BITWAVE_ACCESS_TOKEN';
export class BitwaveHttpClient{
  constructor({fetchImpl=globalThis.fetch,token=()=>process.env[BITWAVE_TOKEN_ENV],intervalMs=700,timeoutMs=20000}={}){
    this.fetch=fetchImpl;this.token=token;this.intervalMs=intervalMs;this.timeoutMs=timeoutMs;this.lastRequestAt=0;this.controllers=new Set();
  }
  available(){const token=this.token();return typeof token==='string'&&token.length>0;}
  async request({orgId,dataSourceId,kind,body,pageToken}){
    bitwaveTargetId(orgId,'organization ID');if(dataSourceId!==undefined)bitwaveTargetId(dataSourceId);
    bitwaveCheck(['create','add','rows'].includes(kind),'INVALID_BITWAVE_REQUEST','Choose an original Data Fusion operation.');
    bitwaveCheck(kind==='create'||dataSourceId,'BITWAVE_SOURCE_REQUIRED','Bind a native data source first.');
    const token=this.token();bitwaveCheck(typeof token==='string'&&token.length>0&&!/[\r\n]/.test(token),'BITWAVE_TOKEN_REQUIRED','Configure BITWAVE_ACCESS_TOKEN in this merchant host, then retry the selected operation.');
    const root=BITWAVE_API_BASE+'/v3/orgs/'+encodeURIComponent(orgId)+'/data-sources';
    const url=new URL(kind==='create'?root:root+'/'+encodeURIComponent(dataSourceId)+(kind==='add'?'/add-rows':'/table-rows'));
    if(kind==='rows'){url.searchParams.set('pageSize','250');if(pageToken)url.searchParams.set('pageToken',pageToken);}
    const delay=this.lastRequestAt+this.intervalMs-Date.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
    this.lastRequestAt=Date.now();const controller=new AbortController();this.controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(new Error('Bitwave response deadline exceeded.')),this.timeoutMs);
    try{
      const response=await this.fetch(url,{method:kind==='rows'?'GET':'POST',headers:{Authorization:'Bearer '+token,Accept:'application/json',...(kind==='rows'?{}:{'Content-Type':'application/json'})},
        body:kind==='rows'?undefined:body,redirect:'error',signal:controller.signal});
      let size=0;const chunks=[];
      for await(const chunk of response.body??[]){size+=chunk.length;bitwaveCheck(size<=64*1024*1024,'BITWAVE_RESPONSE_LIMIT','The native response exceeds 64 MiB.');chunks.push(Buffer.from(chunk));}
      const bytes=Buffer.concat(chunks);let value=null;
      try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{}
      const headers={};for(const key of ['content-type','date','retry-after','x-request-id','x-trace-id']){const value=response.headers.get(key);if(value!==null)headers[key]=value;}
      return {status:response.status,headers,bytes,value,receivedAt:new Date().toISOString(),url:url.toString()};
    }finally{clearTimeout(timer);this.controllers.delete(controller);}
  }
  abort(){for(const controller of this.controllers)controller.abort(new Error('Merchant workspace is closing.'));}
}
