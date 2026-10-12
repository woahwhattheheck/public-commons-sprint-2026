// MIT. Provider-controlled CoinGecko routes on the original SF61/SF30 runtime.
import {CONTRACTS,contractFor,contractSchema,requestFromContext} from './contracts.mjs';
import {need,plain,text,origin,prefix,clone,LIMITS,errorView} from './common.mjs';

const HANDLERS=Object.freeze({
  'simple-price':'coinSimplePrice','token-prices':'coinTokenPrices',
  'search-pools':'coinSearchPools','trending-pools':'coinTrendingPools','token-data':'coinTokenData'
});
function paymentOptions(value,label) {
  need(Array.isArray(value)&&value.length>=1&&value.length<=16,'INVALID_PAYMENT_OPTIONS',label+' needs one to16 ordered requirements');
  for(const accepted of value)need(plain(accepted)&&accepted.scheme==='exact'&&
    ['stellar:testnet','stellar:pubnet'].includes(accepted.network),'STELLAR_PAYMENT_OPTION_REQUIRED','Choose original exact Stellar requirements for this added route');
  return clone(value);
}
export function normalizeProviderPlan(input) {
  need(plain(input),'INVALID_PROVIDER_PLAN');
  const endpointIds=input.endpointIds;
  need(Array.isArray(endpointIds)&&endpointIds.length>=1&&endpointIds.length<=5&&new Set(endpointIds).size===endpointIds.length,
    'INVALID_ENDPOINT_SELECTION','Select one to five distinct endpoint families');
  endpointIds.forEach(contractFor);
  const accepts=paymentOptions(input.accepts,'Default payment options'),overrides={};
  need(input.endpointAccepts===undefined||plain(input.endpointAccepts),'INVALID_ENDPOINT_OPTIONS');
  for(const [key,value]of Object.entries(input.endpointAccepts??{})){
    need(endpointIds.includes(key),'UNSELECTED_ENDPOINT_OVERRIDE');
    overrides[key]=paymentOptions(value,key);
  }
  const upstream=input.upstream??{};
  need(plain(upstream),'INVALID_UPSTREAM');
  const optional=(value,fallback)=>value===undefined||value===null||value===''?fallback:value;
  const apiKeyEnv=optional(upstream.apiKeyEnv,'COINGECKO_PRO_API_KEY');
  need(typeof apiKeyEnv==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(apiKeyEnv),'INVALID_ENVIRONMENT_NAME','Use an environment variable name, never its secret value');
  const result={name:text(input.name,'provider plan name',240),publicOrigin:origin(input.publicOrigin),
    pathPrefix:prefix(input.pathPrefix),endpointIds:clone(endpointIds),accepts,endpointAccepts:overrides,
    upstream:{origin:origin(optional(upstream.origin,'https://pro-api.coingecko.com')),
      basePath:prefix(optional(upstream.basePath,'/api/v3')),apiKeyEnv}};
  need(!(result.upstream.origin===result.publicOrigin&&result.upstream.basePath===result.pathPrefix),
    'RECURSIVE_UPSTREAM','The additional paid route cannot call itself as its upstream');
  need(!/(?:^|\/)x402(?:\/|$)/.test(result.upstream.basePath),'NESTED_PAYMENT_UPSTREAM',
    'Use the provider’s own or licensed API implementation, not its already-paid x402 route');
  return result;
}
function parameter(field,location,contract) {
  const schema=contractSchema([field]).properties[field.name];
  const example=contract.example[location==='path'?'path':'query'][field.name]??field.default;
  return {name:field.name,in:location,required:field.required===true,
    description:field.description??field.label,schema,
    ...(example===undefined?{}:{example})};
}
/** Compile without calling an endpoint, signer, facilitator or external registry. */
export async function prepareCoinGeckoProduct(input) {
  const plan=normalizeProviderPlan(input),paths={},selections=[],bindings=[];
  for(const endpoint of plan.endpointIds){
    const c=contractFor(endpoint),handler=HANDLERS[endpoint];
    paths[c.pathTemplate]={get:{operationId:handler,summary:c.name,description:c.description,
      parameters:[...c.pathFields.map(f=>parameter(f,'path',c)),...c.queryFields.map(f=>parameter(f,'query',c))],
      responses:{'200':{description:'Original provider JSON bytes. Prices, nulls and included entity identities retain their native representation.',
        content:{'application/json':{schema:{type:'object',additionalProperties:true}}}}}}};
    selections.push({method:'GET',path:c.pathTemplate,serviceName:'CoinGecko '+endpoint,
      accepts:clone(plan.endpointAccepts[endpoint]??plan.accepts)});
    bindings.push({method:'GET',path:c.pathTemplate,id:'coingecko-'+endpoint,
      handler,admit:handler+'Admission',validateInput:true});
  }
  const spec={openapi:'3.1.0',info:{title:plan.name,version:'1.0.0',
    description:'Provider-operated additional Stellar access for five documented CoinGecko endpoint families.'},
    servers:[{url:plan.publicOrigin+plan.pathPrefix+'/'}],paths};
  const [{importOpenApi},{createSellerServiceConfig}]=await Promise.all([
    import('../../sf61-openapi-seller-import/importer.mjs'),import('../../sf61-openapi-seller-import/service-config.mjs')
  ]);
  const imported=importOpenApi(spec,selections),service=createSellerServiceConfig(imported,bindings);
  return {schema:'stellar-forge.coingecko-provider.v1',plan,spec,selections,bindings,service,
    operations:imported.offers.map((offer,index)=>({endpoint:plan.endpointIds[index],...offer})),
    execution:{entry:'node stellar/scf-starforge-20261009/partners/coingecko-stellar-market/cli.mjs',
      compile:'provider compile --plan PLAN.json --out DEPLOYMENT.json',
      serve:'provider serve --plan PLAN.json --port 8423 --facilitator HTTPS_FACILITATOR',
      data:'Pass --data-module TRUSTED_LOCAL_MODULE for the provider’s own resolveData callback, or set the named API-key environment variable for the licensed upstream adapter.'}};
}
const retainedHeaders=headers=>{
  const source=new Headers(headers),result={};
  for(const key of ['content-type','cache-control','etag','last-modified','retry-after'])
    if(source.has(key))result[key]=source.get(key);
  result['content-type']??='application/json';return result;
};
export async function readResponseBytes(response,{signal,maximum=LIMITS.responseBytes}={}) {
  const declared=response.headers?.get?.('content-length');
  if(declared!==null&&declared!==undefined&&/^\d+$/.test(declared))
    need(BigInt(declared)<=BigInt(maximum),'RESPONSE_TOO_LARGE','Response exceeds the retained source limit');
  const parts=[];let count=0;
  if(response.body?.getReader){
    const reader=response.body.getReader();
    const cancel=()=>reader.cancel(signal?.reason).catch(()=>{});
    signal?.addEventListener('abort',cancel,{once:true});
    try{
      while(true){
        signal?.throwIfAborted();const{done,value}=await reader.read();if(done)break;
        count+=value.byteLength;need(count<=maximum,'RESPONSE_TOO_LARGE','Response exceeds the retained source limit');parts.push(Buffer.from(value));
      }
    }catch(error){await reader.cancel(error).catch(()=>{});throw error}
    finally{signal?.removeEventListener('abort',cancel);reader.releaseLock()}
  }else{
    const bytes=Buffer.from(await response.arrayBuffer());need(bytes.length<=maximum,'RESPONSE_TOO_LARGE');parts.push(bytes);
  }
  signal?.throwIfAborted();return Buffer.concat(parts);
}
async function exactApplicationResponse(result,signal) {
  if(result instanceof Response)return{status:result.status,headers:retainedHeaders(result.headers),body:await readResponseBytes(result,{signal})};
  need(plain(result)&&Number.isInteger(result.status)&&result.status>=200&&result.status<=599,
    'INVALID_PROVIDER_RESULT','Provider callback must return an HTTP status and exact response bytes');
  need(Buffer.isBuffer(result.body)||result.body instanceof Uint8Array||typeof result.body==='string',
    'EXACT_PROVIDER_BYTES_REQUIRED','Return original JSON bytes or text instead of parsing prices into floating-point numbers');
  const body=Buffer.from(result.body);need(body.length<=LIMITS.responseBytes,'RESPONSE_TOO_LARGE');
  return {status:result.status,headers:retainedHeaders(result.headers),body};
}
/** Callbacks serve provider-owned data; default transport uses its licensed API. */
export function createCoinGeckoHandlers({product,fetchImpl=globalThis.fetch,environment=process.env,resolveData}={}) {
  need(product?.schema==='stellar-forge.coingecko-provider.v1','INVALID_COMPILED_PROVIDER');
  need(typeof fetchImpl==='function'&&(resolveData===undefined||typeof resolveData==='function'),'INVALID_PROVIDER_TRANSPORT');
  const handlers={};
  for(const endpoint of product.plan.endpointIds){
    const name=HANDLERS[endpoint];
    handlers[name+'Admission']=context=>{
      try{requestFromContext(endpoint,context)}
      catch(error){return{status:400,headers:{'content-type':'application/json'},body:{error:errorView(error).code,message:errorView(error).message}}}
      if(resolveData===undefined)need(typeof environment[product.plan.upstream.apiKeyEnv]==='string'&&
        environment[product.plan.upstream.apiKeyEnv].length>0,'PROVIDER_UPSTREAM_UNCONFIGURED','The provider’s upstream environment is not configured',503);
      return true;
    };
    handlers[name]=async context=>{
      context.signal?.throwIfAborted();
      const request=requestFromContext(endpoint,context);
      if(resolveData)return exactApplicationResponse(await resolveData({endpoint,request,context,signal:context.signal}),context.signal);
      const c=contractFor(endpoint),relative=c.pathTemplate.replace(/\{([^}]+)\}/g,(_,key)=>encodeURIComponent(request.path[key]).replace(/%2C/gi,','));
      const url=new URL(product.plan.upstream.basePath+relative,product.plan.upstream.origin);
      for(const[key,value]of Object.entries(request.query))url.searchParams.set(key,String(value));
      const key=environment[product.plan.upstream.apiKeyEnv];
      need(typeof key==='string'&&key.length>0,'PROVIDER_UPSTREAM_UNCONFIGURED','The provider’s upstream environment is not configured',503);
      const response=await fetchImpl(url,{method:'GET',headers:{Accept:'application/json','x-cg-pro-api-key':key},
        redirect:'manual',signal:context.signal});
      return exactApplicationResponse(response,context.signal);
    };
  }
  return handlers;
}
export async function startCoinGeckoService({plan,product,port=8423,nativeFactory=null,fetchImpl,environment,resolveData,...runtime}={}) {
  const compiled=product??await prepareCoinGeckoProduct(plan);
  const handlers=createCoinGeckoHandlers({product:compiled,fetchImpl,environment,resolveData});
  const{startSellerService}=await import('../../sf30-seller-sdk/serve.mjs');
  return startSellerService({config:compiled.service,port,handlers,nativeFactory,...runtime});
}
