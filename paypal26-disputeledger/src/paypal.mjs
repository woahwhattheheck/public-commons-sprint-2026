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
    // The merchant review store retains up to 80 cases. Follow the official
    // Disputes next-page cursor up to 8 x 10 records, never a provider URL.
    let path='/v1/customer/disputes?page_size=10';
    const items=[], seenIds=new Set(), seenCursors=new Set();
    const allowed=new Set(['page_size','next_page_token','start_time',
      'dispute_state','update_time_before','update_time_after']);
    for(let page=1;page<=8;page++){
      const data=await this.get(path);
      if(!data || !Array.isArray(data.items) || data.items.length>10)
        throw Error('Disputes list page schema not recognized');
      for(const item of data.items){
        if(!validId(item?.dispute_id))throw Error('PayPal dispute list has invalid identity');
        if(seenIds.has(item.dispute_id))throw Error('PayPal dispute list repeated an ID; refresh the review');
        seenIds.add(item.dispute_id);items.push(item);
      }
      if(data.links!==undefined && !Array.isArray(data.links))
        throw Error('Disputes list links schema not recognized');
      const nextLinks=(data.links || []).filter(link=>link?.rel==='next');
      if(nextLinks.length>1)throw Error('Multiple PayPal next links in a dispute page');
      if(!nextLinks.length)return {items,pages_read:page,incomplete:false};
      let next;
      try {next=new URL(nextLinks[0].href)}
      catch {throw Error('Invalid PayPal dispute cursor URL')}
      const q=next.searchParams, cursor=q.get('next_page_token');
      if(next.origin!==HOST || next.pathname!=='/v1/customer/disputes' ||
        next.username || next.password || next.hash ||
        (nextLinks[0].method && nextLinks[0].method!=='GET') ||
        (q.has('page_size') && q.get('page_size')!=='10') ||
        [...q.keys()].some(key=>!allowed.has(key) || q.getAll(key).length!==1) ||
        typeof cursor!=='string' || !cursor.length || cursor.length>2048)
        throw Error('Unexpected PayPal dispute next-page cursor');
      if(seenCursors.has(cursor))throw Error('PayPal dispute next-page cursor repeated');
      seenCursors.add(cursor);
      if(page===8)return {items,pages_read:page,incomplete:true};
      path=next.pathname+next.search;
    }
    throw Error('PayPal dispute pagination did not terminate');
  }
  async detail(id){
    if(!validId(id)||id.startsWith('DEMO-'))throw Error('A real PayPal sandbox dispute ID is required');
    return this.get('/v1/customer/disputes/'+encodeURIComponent(id));
  }
}
