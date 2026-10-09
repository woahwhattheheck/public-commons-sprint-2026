import {validId} from './core.mjs';
const HOST='https://api-m.sandbox.paypal.com';
const MAX_BYTES=1024*1024;
async function boundedJson(response) {
  const len=Number(response.headers?.get?.('content-length') || 0);
  if (len>MAX_BYTES) throw Error('PayPal response size exceeds demo limit');
  const reader=response.body?.getReader?.();
  if (!reader) {
    const value=await response.json();
    if(Buffer.byteLength(JSON.stringify(value))>MAX_BYTES)throw Error('PayPal response too large');
    return value;
  }
  const chunks=[];let size=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES){await reader.cancel().catch(()=>{});throw Error('PayPal response too large');}
      chunks.push(Buffer.from(value));
    }
  } finally {reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
}
export class PayPalDisputes {
  constructor({id=process.env.PAYPAL_CLIENT_ID,secret=process.env.PAYPAL_CLIENT_SECRET,transport=fetch}={}) {
    this.id=id;this.secret=secret;this.transport=transport;
    this.token=null;this.until=0;this.pending=null;
  }
  get configured(){return !!(this.id&&this.secret);}
  async auth(){
    if(!this.configured)throw Error('PayPal sandbox app credentials not configured');
    if(this.token&&Date.now()<this.until)return this.token;
    if(this.pending)return this.pending;
    const request=(async()=>{
      const response=await this.transport(HOST+'/v1/oauth2/token',{
        method:'POST',redirect:'error',
        headers:{Authorization:'Basic '+Buffer.from(this.id+':'+this.secret).toString('base64'),
          'Content-Type':'application/x-www-form-urlencoded'},
        body:'grant_type=client_credentials',signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw Error('PayPal sandbox OAuth HTTP '+response.status);
      const body=await boundedJson(response);
      if(typeof body.access_token!=='string'||!body.access_token)throw Error('PayPal sandbox OAuth token missing');
      const life=Number(body.expires_in)||0;
      if(life>20 && Number.isFinite(life)){
        this.token=body.access_token;this.until=Date.now()+life*1000-15000;
      }
      return body.access_token;
    })();
    this.pending=request;
    try{return await request;}finally{if(this.pending===request)this.pending=null;}
  }
  async get(path){
    if(!path.startsWith('/v1/customer/disputes'))throw Error('Disputes read endpoint required');
    const token=await this.auth();
    const response=await this.transport(HOST+path,{
      method:'GET',redirect:'error',
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(16000)});
    if(response.status===401 && this.token===token){this.token=null;this.until=0;}
    if(!response.ok)throw Error('PayPal sandbox dispute read HTTP '+response.status);
    return boundedJson(response);
  }
  async list(){
    const data=await this.get('/v1/customer/disputes?page_size=10');
    if(!data || !Array.isArray(data.items))throw Error('Disputes list schema not recognized');
    return data.items.slice(0,10);
  }
  async detail(id){
    if(!validId(id)||id.startsWith('DEMO-'))throw Error('A real PayPal sandbox dispute ID is required');
    return this.get('/v1/customer/disputes/'+encodeURIComponent(id));
  }
}
