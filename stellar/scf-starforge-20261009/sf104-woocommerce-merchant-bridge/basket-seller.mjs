// MIT. Frozen Woo basket quotes composed through the original SF30/native engine.
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {need} from '../sf88-operator-buyer-cli/config.mjs';
import {compileHttpSellerOffer} from '../sf30-seller-sdk/seller.mjs';
import {compileSellerRoutes,createSellerResourceHandler} from '../sf30-seller-sdk/resource-server.mjs';
import {compileServicePath,orderServiceRoutes,selectServiceRoute} from '../sf30-seller-sdk/route-path.mjs';
import {createSellerLifecycle} from '../sf30-seller-sdk/lifecycle.mjs';
import {startSellerOperations} from '../sf30-seller-sdk/operations/server.mjs';
import {createPublicHttpsFetch} from '../sf31-buyer-client/public-transport.mjs';
import {openOutbox,instrumentNativeSettlement} from '../sf98-merchant-delivery/outbox.mjs';
import {validateHandoff,reference,generation,sha256} from './buyer.mjs';
import {matchBasketCatalog,BASKET_ADMISSION_SCHEMA} from './basket.mjs';

const RESULT_SCHEMA = 'stellar-forge.sf104.checkout-admission-result.v1';
const QUOTE_SCHEMA = 'stellar-forge.sf104.checkout-basket-quote.v1';
const MAX_CACHE = 128;
function reply(req,res,status,body) {
  if(res.destroyed || res.writableEnded) return;
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','content-length':String(bytes.length)});
  res.end(req.method === 'HEAD' ? undefined : bytes);
}
async function responseJson(response) {
  need(response instanceof Response,'WOO_ADMISSION_SERVICE_UNAVAILABLE');
  if(response.status >= 400 && response.status < 500) need(false,'WOO_ORDER_UNAVAILABLE');
  need(response.status === 200 && response.body,'WOO_ADMISSION_SERVICE_UNAVAILABLE');
  const reader=response.body.getReader(),chunks=[];let length=0;
  try {
    for(;;) { const part=await reader.read();if(part.done)break;
      length+=part.value.byteLength;need(length<=131072,'WOO_BASKET_RESPONSE_TOO_LARGE');chunks.push(part.value); }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  } catch(error) { await reader.cancel().catch(()=>{});throw error; }
  finally { reader.releaseLock(); }
}
function wordpress(compiled,{env,fetchImpl}) {
  const secret=env[compiled.secretEnv];
  need(typeof secret==='string' && Buffer.byteLength(secret)>=32 && Buffer.byteLength(secret)<=1024,
    'WOO_PRIVATE_SHARED_SECRET_REQUIRED');
  need(fetchImpl===undefined || typeof fetchImpl==='function','WOO_TRUSTED_FETCH_REQUIRED');
  const fetchOrder=fetchImpl ?? createPublicHttpsFetch({timeoutMs:compiled.timeoutMs});
  return async (payload,signal) => {
    const body=JSON.stringify(payload),stamp=String(Math.floor(Date.now()/1000));
    const digest=createHmac('sha256',secret).update(stamp+'.'+body).digest('hex');
    const deadline=AbortSignal.timeout(compiled.timeoutMs);
    let response;
    try {
      response=await fetchOrder(compiled.admissionUrl,{method:'POST',redirect:'manual',body,
        signal:signal?AbortSignal.any([signal,deadline]):deadline,
        headers:{'content-type':'application/json','x-sf98-timestamp':stamp,'x-sf98-signature':'sha256='+digest}});
      return await responseJson(response);
    } finally {
      if(response?.body && !response.body.locked && !response.bodyUsed) await response.body.cancel().catch(()=>{});
    }
  };
}
function quoteIdentity(req,catalog) {
  need(typeof req.url==='string' && req.url.startsWith('/') && !req.url.startsWith('//') &&
    req.url.length<=2048 && req.method===catalog.method,'WOO_BASKET_REQUEST_MISMATCH');
  const url=new URL(req.url,catalog.url),ref=url.searchParams.get('sf98_order');
  const gen=Number(url.searchParams.get('sf104_attempt')),digest=url.searchParams.get('sf104_basket');
  need(reference(ref) && generation(gen) && url.searchParams.get('sf104_attempt')===String(gen) &&
    /^[a-f0-9]{64}$/.test(digest) && url.href===catalog.url+'?sf98_order='+ref+'&sf104_attempt='+gen+'&sf104_basket='+digest &&
    new Headers(req.headers).get('x-sf98-order-id')===ref,'WOO_BASKET_REQUEST_MISMATCH');
  return {schema:BASKET_ADMISSION_SCHEMA,phase:'quote',orderReference:ref,attemptGeneration:gen,
    routeId:catalog.routeId,resourceUrl:url.href,basketDigest:digest};
}
function admissionPayload(h,context,phase) {
  need(context.url instanceof URL && context.url.href===h.operation.url && context.method===h.operation.method &&
    new Headers(context.headers).get('x-sf98-order-id')===h.orderReference,'WOO_BASKET_REQUEST_MISMATCH');
  const expect=h.operation.expect;
  const p={schema:BASKET_ADMISSION_SCHEMA,phase,orderReference:h.orderReference,attemptGeneration:h.attemptGeneration,
    routeId:h.routeId,resourceUrl:h.operation.url,basketDigest:h.basketDigest,catalogDigest:h.catalogDigest,
    method:h.operation.method,network:expect.network,amountAtomic:expect.maxAtomic,
    assetDigest:sha256(expect.asset),recipientDigest:sha256(expect.payTo)};
  if(phase==='reserve') {
    const signature=new Headers(context.headers).get('payment-signature') || new Headers(context.headers).get('x-payment');
    need(typeof signature==='string' && signature.length>=1 && signature.length<=65536,'WOO_VERIFIED_NATIVE_REQUEST_REQUIRED');
    p.attemptDigest=sha256(signature);
  }
  return p;
}
async function compileQuote(h,{call,nativeFactory,outbox,timeoutMs}) {
  const admit=async context => {
    try {
      const result=await call(admissionPayload(h,context,'inspect'),context.signal);
      need(result.schema===RESULT_SCHEMA && result.status==='READY' && result.orderReference===h.orderReference,
        'WOO_ORDER_ADMISSION_MISMATCH');
      return true;
    } catch(error) {
      if(['WOO_ORDER_UNAVAILABLE','WOO_BASKET_REQUEST_MISMATCH'].includes(error.code))
        return {status:409,body:{error:'WOO_PENDING_ORDER_NOT_AVAILABLE'}};
      throw error;
    }
  };
  const application=async context => {
    // The original SF30 invokes this only after its original native verification.
    const result=await call(admissionPayload(h,context,'reserve'),context.signal);
    need(result.schema===RESULT_SCHEMA && result.status==='RESERVED' && result.orderReference===h.orderReference,
      'WOO_ORDER_ADMISSION_MISMATCH');
    return {status:200,headers:{'content-type':'application/json'},body:{
      schema:'stellar-forge.sf104.order-result.v2',orderReference:h.orderReference,storeOrigin:h.storeOrigin,
      basketDigest:h.basketDigest,items:h.items.map(({lineId,productId,quantity})=>({lineId,productId,quantity})),
      status:'ORDER_RESERVED_FOR_NATIVE_SETTLEMENT',delivery:'WOO_MERCHANT_REVIEW_REQUIRED'}};
  };
  const payment={...h.operation.expect,amount:h.operation.expect.maxAtomic};delete payment.maxAtomic;
  const offerUrl=new URL(h.operation.url);offerUrl.search='';
  const offer=compileHttpSellerOffer({url:offerUrl.href,method:h.operation.method,payment,
    description:'One exact payment for the frozen WooCommerce digital basket. Merchant settlement review releases the original order.',
    serviceName:'Stellar Woo digital basket',
    queryParameters:[{name:'sf98_order',type:'string',required:true,example:h.orderReference,description:'The exact frozen Woo order.'},
      {name:'sf104_attempt',type:'string',required:true,example:String(h.attemptGeneration),description:'The original merchant-approved attempt generation.'},
      {name:'sf104_basket',type:'string',required:true,example:h.basketDigest,description:'Digest of the frozen basket lines and exact payment terms.'}]});
  const compiled=compileSellerRoutes([{id:h.routeId,offer,admit,handler:application}]);
  const native=nativeFactory ? instrumentNativeSettlement(await nativeFactory(compiled),{compiled,outbox,
    onWriteFailure:()=>process.stderr.write('WOO_NATIVE_OUTBOX_RECONCILIATION_REQUIRED\n')}) : null;
  need(!nativeFactory || native,'WOO_NATIVE_FACTORY_INVALID');
  const handler=createSellerResourceHandler({compiled,nativeServer:native,maxRequestBytes:1024,maxResponseBytes:65536,
    admissionTimeoutMs:timeoutMs+500,handlerTimeoutMs:timeoutMs+1000});
  return {handoff:h,compiled,handler,admit};
}
/** Same original native handler owns verification, cancellation and settlement.
 * Cache retirement waits for its complete dispatch promise, not HTTP finish. */
export async function startWooBasketMerchant(compiled,{nativeFactory=null,env=process.env,fetchImpl,
  port=8423,operationsPort=8424,maxInFlight=64,drainGraceMs=60000}={}) {
  need(Array.isArray(compiled.baskets) && compiled.baskets.length>=1,'WOO_BASKET_CONFIG_REQUIRED');
  need(Number.isInteger(port) && port>=0 && port<=65535,'WOO_PORT_INVALID');
  const outbox=await openOutbox(compiled.outbox),call=wordpress(compiled,{env,fetchImpl});
  const catalogByDigest=new Map(compiled.baskets.map(c=>[c.catalogDigest,c])),base=compiled.baskets[0];
  const cache=new Map(),counts={initialized:0,hits:0,misses:0,retired:0,quoteFailures:0};
  let fixed=null,operations,closing;
  if(compiled.routes.length) {
    const {createWooApplication}=await import('./seller.mjs');
    const app=createWooApplication(compiled,{env,fetchImpl});
    const routes=compileSellerRoutes(compiled.routes.map(r=>({id:r.routeId,offer:r.offer,
      handler:app[r.handler],admit:app[r.admit]})));
    const native=nativeFactory ? instrumentNativeSettlement(await nativeFactory(routes),{compiled:routes,outbox,
      onWriteFailure:()=>process.stderr.write('WOO_NATIVE_OUTBOX_RECONCILIATION_REQUIRED\n')}) : null;
    fixed={compiled:routes,handler:createSellerResourceHandler({compiled:routes,nativeServer:native,
      admissionTimeoutMs:compiled.timeoutMs+500,handlerTimeoutMs:compiled.timeoutMs+1000})};
  }
  // Routing/traffic metadata intentionally has no invented aggregate payment offer.
  const basketRoute={id:base.routeId,path:new URL(base.url).pathname,method:base.method,
    binding:compileServicePath({resource:{url:base.url}})};
  const observed={routes:orderServiceRoutes([...(fixed?.compiled.routes??[]),basketRoute])};
  const mode=nativeFactory?'NATIVE_X402':'CHALLENGE_ONLY';
  let dispatch=(_req,res)=>{res.writeHead(503);res.end();};
  const server=createServer((req,res)=>Promise.resolve().then(()=>dispatch(req,res)).catch(error=>{
    const unavailable=['WOO_ORDER_UNAVAILABLE','WOO_BASKET_REQUEST_MISMATCH','WOO_BASKET_CATALOG_UNAVAILABLE',
      'WOO_BASKET_CATALOG_MISMATCH','WOO_BASKET_UNIT_MAPPING_CHANGED'].includes(error.code);
    reply(req,res,unavailable?409:503,{error:unavailable?'WOO_PENDING_BASKET_NOT_AVAILABLE':'WOO_BASKET_SERVICE_UNAVAILABLE'});
  }));
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  const lifecycle=createSellerLifecycle(server,{maxInFlight,drainGraceMs});
  const close=()=>closing??=(async()=>{
    let error;
    try{await lifecycle.close();}catch(e){error=e;}
    try{await operations?.close();}catch(e){error??=e;}
    if(error)throw error; cache.clear();
  })();
  async function basket(req,res) {
    const identity=quoteIdentity(req,base),key=identity.resourceUrl;
    let entry=cache.get(key);
    if(entry){counts.hits++;}
    else {
      if(cache.size>=MAX_CACHE) {
        const eligible=[...cache.entries()].filter(([,v])=>v.users===0 && v.ready).sort((a,b)=>a[1].used-b[1].used)[0];
        need(eligible,'WOO_BASKET_CACHE_AT_CAPACITY');cache.delete(eligible[0]);counts.retired++;
      }
      counts.misses++; entry={users:0,ready:false,used:Date.now(),failed:false,promise:null};cache.set(key,entry);
      entry.promise=(async()=>{
        const response=await call(identity);
        need(response.schema===QUOTE_SCHEMA && response.status==='READY' && response.orderReference===identity.orderReference,
          'WOO_BASKET_QUOTE_INVALID');
        const h=validateHandoff(response.handoff),catalog=catalogByDigest.get(h.catalogDigest);
        need(catalog,'WOO_BASKET_CATALOG_UNAVAILABLE');matchBasketCatalog(h,catalog);
        need(h.operation.url===identity.resourceUrl && h.basketDigest===identity.basketDigest &&
          h.attemptGeneration===identity.attemptGeneration,'WOO_BASKET_QUOTE_MISMATCH');
        const value=await compileQuote(h,{call,nativeFactory,outbox,timeoutMs:compiled.timeoutMs});
        entry.ready=true;counts.initialized++;return value;
      })().catch(error=>{entry.failed=true;counts.quoteFailures++;throw error;});
    }
    entry.users++;entry.used=Date.now();
    try {
      const current=await entry.promise;
      if(req.aborted || res.destroyed || res.writableEnded)return;
      if(!nativeFactory) {
        const context={url:new URL(current.handoff.operation.url),method:req.method,headers:req.headers,
          signal:AbortSignal.timeout(compiled.timeoutMs)};
        const admitted=await current.admit(context);
        if(admitted!==true)return reply(req,res,admitted.status,admitted.body);
      }
      await current.handler(req,res);
    } finally {
      entry.users--;entry.used=Date.now();
      if(entry.failed && entry.users===0 && cache.get(key)===entry)cache.delete(key);
    }
  }
  try {
    await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});
    const url='http://127.0.0.1:'+server.address().port;
    const session={server,url,mode,compiled:observed,lifecycle,close};
    dispatch=(req,res)=>{
      if(['/_seller/ready','/_seller/health','/_seller/offers'].includes(req.url)) {
        if(!['GET','HEAD'].includes(req.method))return reply(req,res,405,{error:'METHOD_NOT_ALLOWED'});
        const state=lifecycle.snapshot();
        if(req.url==='/_seller/ready')return reply(req,res,state.accepting?200:503,{state:state.state,accepting:state.accepting});
        if(req.url==='/_seller/offers')return reply(req,res,200,fixed?.compiled.routes.map(r=>r.offer)??[]);
        return reply(req,res,200,{schema:'stellar-forge.sf104.basket-service.v1',mode,lifecycle:state,
          basket:{routeId:base.routeId,url:base.url,method:base.method,catalogs:[...catalogByDigest.keys()],
            cached:cache.size,maxCached:MAX_CACHE,...counts,nativeRequirements:'EXACT_FROZEN_ORDER'},
          fixedRoutes:compiled.routes.map(r=>({routeId:r.routeId,url:r.url,method:r.method}))});
      }
      return lifecycle.handle(req,res,async()=>{
        need(typeof req.url==='string' && req.url.startsWith('/') && !req.url.startsWith('//'),'WOO_BASKET_REQUEST_MISMATCH');
        const selected=selectServiceRoute(observed.routes,req.url.split('?')[0],req.method);
        if(!selected)return reply(req,res,404,{error:'RESOURCE_NOT_FOUND'});
        if(!selected.route)return reply(req,res,405,{error:'METHOD_NOT_ALLOWED'});
        if(selected.route.id===basketRoute.id)return basket(req,res);
        return fixed.handler(req,res);
      });
    };
    operations=await startSellerOperations(session,{port:operationsPort,deliveryOutbox:outbox});
    return {seller:session,operations,outbox,close};
  } catch(error){await close().catch(()=>{});throw error;}
}

