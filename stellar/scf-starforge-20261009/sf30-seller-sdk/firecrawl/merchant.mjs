// MIT. Firecrawl product composition over unchanged SF30 transport and native seller.
import {native} from './runtime.mjs';
import {PRODUCT_SCHEMA,OPERATIONS,plain,need,policy,requestContext,responseSchema} from './contract.mjs';
const {createUpstreamHandlers,closeUpstreamHandlers}=await native('sf30-seller-sdk/upstream.mjs');
const {normalizeSellerPaymentOptions}=await native('sf30-seller-sdk/seller.mjs');
export function compileProduct(input){
  need(plain(input)&&input.schema===PRODUCT_SCHEMA&&Object.keys(input).every(k=>
    ['schema','publicOrigin','auth','policy','payment','prices'].includes(k)),'PRODUCT_CONFIG_INVALID');
  const p=policy(input.policy);
  need(plain(input.auth)&&Object.keys(input.auth).every(k=>['mode','apiKeyEnv'].includes(k))&&
    ['account','public-starter'].includes(input.auth.mode),'PRODUCT_AUTH_INVALID');
  if(input.auth.mode==='account')need(/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.auth.apiKeyEnv??''),'API_KEY_REFERENCE_REQUIRED');
  else need(input.auth.apiKeyEnv===undefined,'PUBLIC_STARTER_HAS_NO_ACCOUNT_KEY');
  if(input.publicOrigin!==undefined){
    const url=new URL(input.publicOrigin);
    need(url.protocol==='https:'&&url.origin===input.publicOrigin&&!url.username&&!url.password,'PUBLIC_ORIGIN_INVALID');
  }
  need(plain(input.prices)&&Object.keys(input.prices).length===3&&
    Object.keys(OPERATIONS).every(k=>Object.hasOwn(input.prices,k)),'THREE_ROUTE_PRICES_REQUIRED');
  const routes=[],bindings={};
  for(const [id,op]of Object.entries(OPERATIONS)){
    const payment=normalizeSellerPaymentOptions({payment:{...input.payment,amount:input.prices[id]}})[0];
    need((payment.extra?.paymentFlow??'authorization')==='authorization','FIRECRAWL_BUFFERED_AUTHORIZATION_REQUIRED');
    routes.push({id,path:op.path,handler:op.handler,admit:'admit'+op.handler[0].toUpperCase()+op.handler.slice(1),
      definition:{method:'POST',bodyType:'json',serviceName:'Firecrawl research',tags:['search','research','content'],
        description:op.kind==='read'?'One selected public page as original content and metadata':
          'Firecrawl '+op.kind+'; up to '+p.maxResultsPerSource+' results per selected source, maximum '+p.maxSources+' sources',
        body:op.kind==='read'?{url:'https://developers.stellar.org/'}:{query:'Stellar smart contracts documentation',limit:3,sources:['web']},
        outputExample:{success:true,data:op.kind==='read'?{markdown:'Example page content'}:{web:[]}},payment}});
    bindings[op.handler]={origin:'https://api.firecrawl.dev',path:op.upstream,method:'POST',query:[],requestHeaders:[],
      ...(input.auth.mode==='account'?{headerEnv:{authorization:'FIRECRAWL_AUTHORIZATION'}}:{}),
      responseHeaders:['content-type'],responseMode:'json',timeoutMs:Math.min(120000,p.sourceTimeoutMs+5000),
      maxRequestBytes:65536,maxResponseBytes:p.maxResponseBytes,maxInFlight:p.maxInFlight,
      availability:{failureThreshold:3,resetAfterMs:30000,maxResetAfterMs:300000},
      responseContract:{schema:'stellar-forge.upstream-response-contract.v1',method:'POST',
        responses:{'200':{content:{'application/json':responseSchema(id)}}}}};
  }
  const service={schema:'stellar-forge.seller-service.v1',...(input.publicOrigin?{publicOrigin:input.publicOrigin}:{}),
    maxRequestBytes:65536,handlerTimeoutMs:Math.min(130000,p.sourceTimeoutMs+10000),
    requestTimeoutMs:Math.min(180000,p.sourceTimeoutMs+30000),routes};
  return {product:structuredClone(input),policy:p,service,upstreams:{schema:'stellar-forge.seller-upstreams.v1',bindings}};
}
export function createProduct(input,{env=process.env,sourceOrigin,allowLoopbackSource=false}={}){
  const compiled=compileProduct(input),privateEnv={...env};
  if(input.auth.mode==='account'){
    const key=env[input.auth.apiKeyEnv];
    need(typeof key==='string'&&key.length>0&&key.length<=4000&&!/[\s\x00-\x1f\x7f]/.test(key),'FIRECRAWL_ACCOUNT_KEY_UNAVAILABLE');
    privateEnv.FIRECRAWL_AUTHORIZATION='Bearer '+key;
  }
  if(sourceOrigin!==undefined){
    const source=new URL(sourceOrigin);
    need(allowLoopbackSource===true&&source.origin===sourceOrigin&&source.protocol==='http:'&&
      source.hostname==='127.0.0.1','LOCAL_SOURCE_EXERCISE_ONLY');
    for(const binding of Object.values(compiled.upstreams.bindings))binding.origin=sourceOrigin;
  }
  const upstreams=createUpstreamHandlers(compiled.upstreams,{env:privateEnv,allowLoopback:allowLoopbackSource});
  const handlers={};
  for(const[id,op]of Object.entries(OPERATIONS)){
    const original=upstreams[op.handler];
    const invalid=error=>({status:400,headers:{'content-type':'application/json; charset=utf-8'},
      body:{error:error.code??'FIRECRAWL_INPUT_INVALID'}});
    handlers['admit'+op.handler[0].toUpperCase()+op.handler.slice(1)]=context=>{
      try{return original.admit?.(requestContext(id,context,compiled.policy))??true;}catch(error){return invalid(error);}
    };
    handlers[op.handler]=context=>{
      try{return original(requestContext(id,context,compiled.policy));}catch(error){return invalid(error);}
    };
  }
  return Object.freeze({config:compiled.service,handlers:Object.freeze(handlers),policy:compiled.policy,
    snapshot:()=>({schema:'stellar-forge.firecrawl-health.v1',authMode:input.auth.mode,
      source:'https://api.firecrawl.dev',policy:compiled.policy,
      operations:Object.fromEntries(Object.entries(upstreams).map(([name,handler])=>[name,handler.snapshot()]))}),
    close:()=>closeUpstreamHandlers(upstreams)});
}
