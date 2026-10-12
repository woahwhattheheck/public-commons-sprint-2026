// MIT. Crossref application handlers on the original SF30 payment and operations lifecycle.
import {startSellerService} from '../serve.mjs';
import {createCrossrefSource} from './source.mjs';
import {need,requestFor} from './metadata.mjs';
function unavailable(error){return {status:error.status??503,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    ...(error.retryAfter?{'retry-after':String(error.retryAfter)}:{})},
  body:{error:typeof error.code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(error.code)?error.code:'CROSSREF_SOURCE_UNAVAILABLE'}};}
export async function crossrefNativeFactory(facilitator,{allowLocalFacilitator=false}={}){
  if(!facilitator)return null;
  let url;try{url=new URL(facilitator);}catch{need(false,'CROSSREF_FACILITATOR_URL_INVALID');}
  const local=allowLocalFacilitator&&url.protocol==='http:'&&url.hostname==='127.0.0.1';
  need((local||url.protocol==='https:')&&!url.username&&!url.password&&!url.search&&!url.hash,'CROSSREF_FACILITATOR_URL_INVALID');
  const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([import('@x402/core/server'),import('../native-factory.mjs')]);
  return routes=>createNativeSellerServer(routes,{facilitatorClient:new HTTPFacilitatorClient({url:url.href.replace(/\/$/,'')})});
}
export function crossrefSourceOptions(compiled,{sourceDirectory,env=process.env}={}){
  const name=compiled.config.provider.mailtoEnv,mailto=name?env[name]:null;
  if(name)need(typeof mailto==='string'&&mailto.length>0,'CROSSREF_CONTACT_ENV_UNAVAILABLE',503);
  return {directory:sourceDirectory,account:compiled.config.provider.account,mailto,
    timeoutMs:compiled.config.timeoutMs,maxResponseBytes:compiled.config.maxSourceBytes,
    cacheSeconds:compiled.config.cacheSeconds,env};
}
export async function startCrossrefMerchant(compiled,{sourceDirectory,nativeFactory=null,port=8437,operationsPort,
  maxInFlight=32,drainGraceMs=60000,availabilityDirectory,historyDirectory,navigationOrigin,env=process.env}={}){
  let source=null,seller=null,operations=null,closing;
  async function close(){return closing??=(async()=>{
    let failure,result;
    try{result=await seller?.close();}catch(error){failure=error;}
    try{await operations?.close();}catch(error){failure??=error;}
    try{await source?.close();}catch(error){failure??=error;}
    if(failure)throw failure;return {seller:result??null,sourceClosed:true};
  })();}
  try{
    if(nativeFactory)source=await createCrossrefSource(crossrefSourceOptions(compiled,{sourceDirectory,env}));
    const handlers=Object.create(null);
    for(const product of compiled.products){
      handlers[product.id+'Admission']=async context=>{
        try{requestFor(product.kind,context.query);return true;}catch(error){return unavailable(error);}
      };
      handlers[product.id]=async context=>{
        if(!source)return unavailable({code:'CROSSREF_SOURCE_NOT_CONFIGURED',status:503});
        try{
          const result=await source.edition(product.kind,context.query,{signal:context.signal});
          return {status:result.capture.status===200&&result.envelope.usage.coverage==='UNAVAILABLE'?502:result.capture.status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
            'x-data-provider':'Crossref','x-crossref-source-sha256':result.capture.bodySha256,
            'x-crossref-capture-id':result.captureId,'x-crossref-cache':result.cached?'HIT':'MISS',
            ...(result.capture.headers['retry-after']?{'retry-after':result.capture.headers['retry-after']}:{})},
            body:result.envelope};
        }catch(error){return unavailable(error);}
      };
    }
    seller=await startSellerService({config:compiled.service,handlers,nativeFactory,port,maxInFlight,drainGraceMs,availabilityDirectory});
    if(operationsPort!==undefined){
      const {startSellerOperations}=await import('../operations/server.mjs');
      operations=await startSellerOperations(seller,{port:operationsPort,historyDirectory,...(navigationOrigin?{navigationOrigin}:{})});
    }
    return {seller,source,operations,close,inputSha256:compiled.inputSha256,
      async snapshot(){return {inputSha256:compiled.inputSha256,merchantUrl:seller.url,mode:seller.mode,
        operationsUrl:operations?.url??null,lifecycle:seller.lifecycle.snapshot(),source:source?await source.snapshot():null};}};
  }catch(error){await close().catch(()=>{});throw error;}
}
