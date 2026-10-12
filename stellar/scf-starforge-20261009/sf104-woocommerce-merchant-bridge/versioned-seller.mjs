// MIT. Retained Woo terms select the same original seller/payment lifecycle.
import {createServer} from 'node:http';
import {need} from '../sf88-operator-buyer-cli/config.mjs';
import {fields,publicUrl,reference,generation,sha256,validateHandoff,HANDOFF_SCHEMA} from './buyer.mjs';
import {canonical,BASKET_SCHEMA,validateBasketCatalog,matchBasketCatalog} from './basket.mjs';
import {compileSellerRoutes,createSellerResourceHandler} from '../sf30-seller-sdk/resource-server.mjs';
import {compileServicePath,orderServiceRoutes} from '../sf30-seller-sdk/route-path.mjs';
import {createSellerLifecycle} from '../sf30-seller-sdk/lifecycle.mjs';
import {startSellerOperations} from '../sf30-seller-sdk/operations/server.mjs';
import {openOutbox,instrumentNativeSettlement} from '../sf98-merchant-delivery/outbox.mjs';
import {createWooAdmissionCall,compileWooBasketQuote} from './basket-seller.mjs';

export const VERSIONED_MERCHANT_SCHEMA = 'stellar-forge.sf104.merchant.v3';
export const WOO_MERCHANT_MAX_BYTES = 16 * 1024 * 1024;
export const CATALOG_ORDER_REQUEST = 'stellar-forge.sf104.catalog-order-request.v1';
export const CATALOG_ORDER_RESULT = 'stellar-forge.sf104.catalog-order-result.v1';
const ADMISSION_ENDPOINT = '/wp-json/stellar-forge/v1/checkout-admission';
const CATALOG_ENDPOINT = '/wp-json/stellar-forge/v1/catalog-order';
const HASH = /^[a-f0-9]{64}$/;
const MAX_VERSIONS = 256;
const MAX_CACHE = 128;
const routeFields = ['productId','routeId','url','method','expect','description'];
const own = (value,key) => Object.hasOwn(value,key);
const exact = (value,keys,code) => {
  fields(value,keys,code);need(keys.every(key=>own(value,key)),code);return value;
};
function routeTerms(route) {
  return {productId:route.productId,routeId:route.routeId,
    url:publicUrl(route.url,'WOO_ROUTE_URL_INVALID').href,method:route.method,
    expect:structuredClone(route.expect)};
}
/** Description is presentation; these are the exact original binding fields. */
export function wooRouteVersion(route) {
  return sha256(canonical(routeTerms(route)));
}
/** Reuse the original compiler for every declaration and its SF30 offer. */
export function compileVersionedMerchant(raw,compileLegacy) {
  fields(raw,['schema','storeOrigin','admissionUrl','secretEnv','outbox','routes',
    'timeoutMs','routeVersions','baskets'],'WOO_MERCHANT_FIELDS_INVALID');
  need(raw.schema===VERSIONED_MERCHANT_SCHEMA && typeof compileLegacy==='function' &&
    Array.isArray(raw.routes) && raw.routes.length<=64 &&
    Array.isArray(raw.routeVersions) && raw.routeVersions.length<=MAX_VERSIONS &&
    Array.isArray(raw.baskets) && raw.baskets.length<=MAX_VERSIONS &&
    raw.routes.length+raw.routeVersions.length+raw.baskets.length>0,'WOO_VERSIONED_CONFIG_INVALID');
  need(Buffer.byteLength(JSON.stringify(raw))<=WOO_MERCHANT_MAX_BYTES,'WOO_MERCHANT_CONFIG_TOO_LARGE');
  const shared={storeOrigin:raw.storeOrigin,outbox:raw.outbox,
    ...(raw.admissionUrl===undefined?{}:{admissionUrl:raw.admissionUrl}),
    ...(raw.secretEnv===undefined?{}:{secretEnv:raw.secretEnv}),
    ...(raw.timeoutMs===undefined?{}:{timeoutMs:raw.timeoutMs})};
  const compileRoutes=routes=>compileLegacy({...shared,schema:'stellar-forge.sf104.merchant.v1',routes});
  const current=raw.routes.length?compileRoutes(raw.routes):null;
  const firstRoute=raw.routeVersions[0];
  const base=current ?? (firstRoute?compileRoutes([firstRoute]):
    compileLegacy({...shared,schema:'stellar-forge.sf104.merchant.v2',routes:[],baskets:[raw.baskets[0]]}));
  const byVersion=new Map(),origins=new Set();
  for(const input of [...raw.routeVersions,...raw.routes]) {
    const route=compileRoutes([input]).routes[0],version=wooRouteVersion(route);
    // Deduplication also joins a current description without changing terms.
    byVersion.set(version,{...route,version});
    origins.add(new URL(route.url).origin);
  }
  need(byVersion.size<=MAX_VERSIONS,'WOO_ROUTE_VERSIONS_TOO_LARGE');
  const byCatalog=new Map();
  for(const input of raw.baskets) {
    const catalog=validateBasketCatalog(input);
    need(catalog.storeOrigin===base.storeOrigin,'WOO_BASKET_CATALOG_IDENTITY_INVALID');
    byCatalog.set(catalog.catalogDigest,catalog);origins.add(new URL(catalog.url).origin);
  }
  need(origins.size===1,'WOO_ROUTES_REQUIRE_ONE_SELLER_ORIGIN');
  const routes=current?.routes??[],routeVersions=[...byVersion.values()],baskets=[...byCatalog.values()];
  const endpoint=new URL(base.admissionUrl);
  need(endpoint.pathname.endsWith(ADMISSION_ENDPOINT),'WOO_ADMISSION_URL_INVALID');
  const catalogOrderUrl=endpoint.origin+endpoint.pathname.slice(0,-ADMISSION_ENDPOINT.length)+CATALOG_ENDPOINT;
  return {...base,schema:VERSIONED_MERCHANT_SCHEMA,versioned:true,catalogOrderUrl,
    routes,routeVersions,baskets,
    service:{...base.service,publicOrigin:[...origins][0],
      routes:routes.map(route=>({id:route.routeId,path:new URL(route.url).pathname,
        offer:route.offer,handler:route.handler,admit:route.admit}))}};
}
function reply(req,res,status,body,headers={}) {
  if(res.destroyed||res.writableEnded)return;
  const bytes=Buffer.from(JSON.stringify(body));
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','content-length':String(bytes.length),...headers});
  res.end(req.method==='HEAD'?undefined:bytes);
}
/** Exact incoming URL/order identity is checked before the private store lookup. */
export function wooCatalogRequest(req,compiled) {
  need(typeof req.url==='string'&&req.url.startsWith('/')&&!req.url.startsWith('//')&&
    req.url.length<=2048&&['GET','HEAD'].includes(req.method),'WOO_VERSION_REQUEST_MISMATCH');
  const url=new URL(req.url,compiled.service.publicOrigin);
  need(url.origin===compiled.service.publicOrigin&&!url.hash&&req.url===url.pathname+url.search,
    'WOO_VERSION_REQUEST_MISMATCH');
  const orderReference=url.searchParams.get('sf98_order');
  const attemptGeneration=Number(url.searchParams.get('sf104_attempt'));
  const basketDigest=url.searchParams.get('sf104_basket');
  const keys=[...url.searchParams.keys()];
  need(reference(orderReference)&&generation(attemptGeneration)&&
    url.searchParams.get('sf104_attempt')===String(attemptGeneration)&&
    keys.length===(basketDigest===null?2:3)&&
    keys.every(key=>['sf98_order','sf104_attempt','sf104_basket'].includes(key))&&
    new Set(keys).size===keys.length&&(basketDigest===null||HASH.test(basketDigest))&&
    new Headers(req.headers).get('x-sf98-order-id')===orderReference,
    'WOO_VERSION_REQUEST_MISMATCH');
  return {url:url.href,method:req.method,basketDigest,
    payload:{schema:CATALOG_ORDER_REQUEST,orderReference,attemptGeneration}};
}
/** Authenticated WordPress data may select only an operator-retained version. */
export function selectWooCatalogOrder(result,request,compiled) {
  exact(result,['schema','status','orderReference','attemptGeneration','snapshotSha256',
    'handoff','route','catalog'],'WOO_CATALOG_ORDER_RESULT_INVALID');
  need(result.schema===CATALOG_ORDER_RESULT&&result.status==='READY'&&
    result.orderReference===request.payload.orderReference&&
    result.attemptGeneration===request.payload.attemptGeneration&&HASH.test(result.snapshotSha256),
    'WOO_CATALOG_ORDER_RESULT_INVALID');
  const h=validateHandoff(result.handoff);
  need(h.storeOrigin===compiled.storeOrigin&&h.orderReference===result.orderReference&&
    h.attemptGeneration===result.attemptGeneration&&h.operation.url===request.url&&
    h.operation.method===request.method,'WOO_VERSION_REQUEST_MISMATCH');
  let route=null,catalog=null,version;
  if(h.schema===HANDOFF_SCHEMA) {
    need(result.catalog===null&&request.basketDigest===null,'WOO_CATALOG_ORDER_RESULT_INVALID');
    fields(result.route,routeFields,'WOO_ROUTE_FIELDS_INVALID');
    version=wooRouteVersion(result.route);
    route=compiled.routeVersions.find(value=>value.version===version);
    need(route&&canonical(routeTerms(result.route))===canonical(routeTerms(route)),
      'WOO_ROUTE_VERSION_UNAVAILABLE');
    const base=new URL(h.operation.url);base.search='';
    need(h.productId===route.productId&&h.routeId===route.routeId&&
      base.href===route.url&&h.operation.method===route.method&&
      canonical(h.operation.expect)===canonical(route.expect),'WOO_ROUTE_VERSION_MISMATCH');
  } else {
    need(h.schema===BASKET_SCHEMA&&result.route===null&&
      request.basketDigest===h.basketDigest,'WOO_CATALOG_ORDER_RESULT_INVALID');
    const returned=validateBasketCatalog(result.catalog);
    catalog=compiled.baskets.find(value=>value.catalogDigest===returned.catalogDigest);
    need(catalog&&canonical(catalog)===canonical(returned),'WOO_BASKET_CATALOG_UNAVAILABLE');
    matchBasketCatalog(h,catalog);version=catalog.catalogDigest;
  }
  return {handoff:h,route,catalog,version,snapshotSha256:result.snapshotSha256,
    key:[h.orderReference,h.attemptGeneration,h.schema,version,result.snapshotSha256].join(':')};
}
async function compileFixed(selected,compiled,{env,fetchImpl,nativeFactory,outbox}) {
  const {createWooApplication}=await import('./seller.mjs');
  const route=selected.route;
  const app=createWooApplication({...compiled,routes:[route]},{env,fetchImpl});
  const routes=compileSellerRoutes([{id:route.routeId,offer:route.offer,
    handler:app[route.handler],admit:app[route.admit]}]);
  const native=nativeFactory?instrumentNativeSettlement(await nativeFactory(routes),{compiled:routes,outbox,
    onWriteFailure:()=>process.stderr.write('WOO_NATIVE_OUTBOX_RECONCILIATION_REQUIRED\n')}):null;
  need(!nativeFactory||native,'WOO_NATIVE_FACTORY_INVALID');
  return {handoff:selected.handoff,compiled:routes,admit:app[route.admit],
    handler:createSellerResourceHandler({compiled:routes,nativeServer:native,
      admissionTimeoutMs:compiled.timeoutMs+500,handlerTimeoutMs:compiled.timeoutMs+1000})};
}
/** One original seller lifecycle drains every complete native dispatch promise.
 * The lookup is read-only; original inspect/reserve/outbox code remains the writer. */
export async function startWooVersionedMerchant(compiled,{nativeFactory=null,env=process.env,fetchImpl,
  port=8423,operationsPort=8424,operationsNavigationOrigin=null,maxInFlight=64,drainGraceMs=60000}={}) {
  need(compiled.schema===VERSIONED_MERCHANT_SCHEMA&&compiled.versioned&&
    Array.isArray(compiled.routeVersions)&&Array.isArray(compiled.baskets),'WOO_VERSIONED_CONFIG_REQUIRED');
  need(Number.isInteger(port)&&port>=0&&port<=65535,'WOO_PORT_INVALID');
  const options={env,fetchImpl};
  const lookup=createWooAdmissionCall({...compiled,admissionUrl:compiled.catalogOrderUrl},
    {...options,responseBytes:2097152,unavailableStatuses:[409]});
  const admission=createWooAdmissionCall(compiled,options);
  const outbox=await openOutbox(compiled.outbox);
  const endpoints=new Map();
  for(const item of [...compiled.routeVersions,...compiled.baskets]) {
    const url=new URL(item.url),key=item.method+' '+url.pathname;
    if(!endpoints.has(key))endpoints.set(key,{id:'woo-version-'+sha256(key).slice(0,20),
      path:url.pathname,method:item.method,binding:compileServicePath({resource:{url:item.url}})});
  }
  const observed={routes:orderServiceRoutes([...endpoints.values()])};
  const cache=new Map(),counts={initialized:0,hits:0,misses:0,retired:0,lookups:0,lookupFailures:0};
  const mode=nativeFactory?'NATIVE_X402':'CHALLENGE_ONLY';
  let dispatch=(_req,res)=>{res.writeHead(503);res.end();},operations,closing;
  const server=createServer((req,res)=>Promise.resolve().then(()=>dispatch(req,res)).catch(error=>{
    const unavailable=['WOO_ORDER_UNAVAILABLE','WOO_VERSION_REQUEST_MISMATCH','WOO_ROUTE_VERSION_UNAVAILABLE',
      'WOO_ROUTE_VERSION_MISMATCH','WOO_BASKET_CATALOG_UNAVAILABLE','WOO_BASKET_CATALOG_MISMATCH',
      'WOO_BASKET_UNIT_MAPPING_CHANGED'].includes(error.code);
    reply(req,res,unavailable?409:503,{error:unavailable?
      'WOO_PENDING_ORDER_VERSION_NOT_AVAILABLE':'WOO_CATALOG_SERVICE_UNAVAILABLE'});
  }));
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  const lifecycle=createSellerLifecycle(server,{maxInFlight,drainGraceMs});
  const close=()=>closing??=(async()=>{
    let error;
    try{await lifecycle.close();}catch(e){error=e;}
    try{await operations?.close();}catch(e){error??=e;}
    if(error)throw error;
    cache.clear();
  })();
  async function order(req,res) {
    const request=wooCatalogRequest(req,compiled);
    let selected;
    try {
      counts.lookups++;
      // Do not share a mutable order-read result across requests or generations.
      selected=selectWooCatalogOrder(await lookup(request.payload),request,compiled);
    } catch(error){counts.lookupFailures++;throw error;}
    if(req.aborted||res.destroyed||res.writableEnded)return;
    let entry=cache.get(selected.key);
    if(entry)counts.hits++;
    else {
      if(cache.size>=MAX_CACHE) {
        const eligible=[...cache.entries()].filter(([,value])=>value.users===0&&value.ready)
          .sort((a,b)=>a[1].used-b[1].used)[0];
        need(eligible,'WOO_VERSION_CACHE_AT_CAPACITY');
        cache.delete(eligible[0]);counts.retired++;
      }
      counts.misses++;
      entry={users:0,ready:false,failed:false,used:Date.now(),promise:null};
      cache.set(selected.key,entry);
      entry.promise=(async()=>{
        const value=selected.catalog?
          await compileWooBasketQuote(selected.handoff,{call:admission,nativeFactory,outbox,timeoutMs:compiled.timeoutMs}):
          await compileFixed(selected,compiled,{env,fetchImpl,nativeFactory,outbox});
        entry.ready=true;counts.initialized++;return value;
      })().catch(error=>{entry.failed=true;throw error;});
    }
    entry.users++;entry.used=Date.now();
    try {
      const current=await entry.promise;
      if(req.aborted||res.destroyed||res.writableEnded)return;
      if(!nativeFactory) {
        const url=new URL(current.handoff.operation.url);
        const admitted=await current.admit({url,method:req.method,headers:req.headers,
          query:Object.fromEntries(url.searchParams),signal:AbortSignal.timeout(compiled.timeoutMs)});
        if(admitted!==true)return reply(req,res,admitted.status,admitted.body);
      }
      await current.handler(req,res);
    } finally {
      // HTTP finish/disconnect is not the end of native verification/settlement.
      entry.users--;entry.used=Date.now();
      if(entry.failed&&entry.users===0&&cache.get(selected.key)===entry)cache.delete(selected.key);
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
        if(req.url==='/_seller/offers')return reply(req,res,200,compiled.routes.map(route=>route.offer));
        return reply(req,res,200,{schema:'stellar-forge.sf104.versioned-service.v1',mode,lifecycle:state,
          retained:{routeVersions:compiled.routeVersions.length,basketCatalogs:compiled.baskets.length,endpoints:endpoints.size},
          cache:{cached:cache.size,maxCached:MAX_CACHE,...counts},nativeRequirements:'EXACT_FROZEN_ORDER'});
      }
      return lifecycle.handle(req,res,async()=>{
        need(typeof req.url==='string'&&req.url.startsWith('/')&&!req.url.startsWith('//'),
          'WOO_VERSION_REQUEST_MISMATCH');
        const path=req.url.split('?')[0],methods=[...endpoints.values()].filter(value=>value.path===path).map(value=>value.method);
        if(!methods.length)return reply(req,res,404,{error:'RESOURCE_NOT_FOUND'});
        if(!endpoints.has(req.method+' '+path))return reply(req,res,405,{error:'METHOD_NOT_ALLOWED'},{allow:methods.join(', ')});
        return order(req,res);
      });
    };
    operations=await startSellerOperations(session,{port:operationsPort,deliveryOutbox:outbox,
      navigationOrigin:operationsNavigationOrigin});
    return {seller:session,operations,outbox,close};
  } catch(error){await close().catch(()=>{});throw error;}
}
