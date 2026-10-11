// MIT. All provider HTTP, redirects, response limits and deadlines use the original SF30 exchange.
import {Agent as HttpsAgent} from 'node:https';
import {createUpstreamHandler,UPSTREAM_ATTEMPT} from '../upstream-handler.mjs';
import {ORIGIN,ENTITIES,LIST_PARAMETERS,requestFor,fail,object,sha256} from './config.mjs';
import {openOpenAlexBudget} from './budget.mjs';

const exposed=['content-type','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-credits-used','x-ratelimit-reset'];
function valid(product,body,query){
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{return false;}
  if(!object(value))return false;
  if(product.kind==='entity')return typeof value.id==='string'&&new RegExp('^https://openalex[.]org/'+ENTITIES[product.entity]+'[1-9][0-9]*$').test(value.id);
  if(!object(value.meta)||!Number.isSafeInteger(value.meta.count)||value.meta.count<0||
    !(value.meta.next_cursor===undefined||value.meta.next_cursor===null||typeof value.meta.next_cursor==='string'))return false;
  if(query.group_by)return Array.isArray(value.group_by)&&value.group_by.every(v=>object(v)&&
    (v.key===null||typeof v.key==='string'||typeof v.key==='number'||typeof v.key==='boolean')&&
    Number.isSafeInteger(v.count)&&v.count>=0);
  return Array.isArray(value.results)&&value.results.every(v=>object(v)&&typeof v.id==='string'&&
    new RegExp('^https://openalex[.]org/'+ENTITIES[product.entity]+'[1-9][0-9]*$').test(v.id));
}
function unavailable(error){return {status:error.status??503,headers:{'content-type':'application/json','cache-control':'no-store',...(error.retryAfter?{'retry-after':String(error.retryAfter)}:{})},
  body:{error:error.code??'OPENALEX_SOURCE_UNAVAILABLE',message:error.code?error.message:'The research source is unavailable.'}};}
export async function createOpenAlexSource(compiled,{budgetDirectory,env=process.env}={}){
  let budget,agent;
  try{
    budget=await openOpenAlexBudget({directory:budgetDirectory,account:compiled.config.provider.account,policy:compiled.config.budget});
    agent=new HttpsAgent({keepAlive:false,proxyEnv:env});
    let closed=false,accountingFailure=null;const pending=new Set();
    const headers=()=>{
      const name=compiled.config.provider.apiKeyEnv;
      if(!name)return {};
      const key=env[name];
      if(typeof key!=='string'||!key||key.length>8192||/[\r\n\0]/.test(key))fail('The configured OpenAlex key environment is unavailable.',503,'OPENALEX_KEY_UNAVAILABLE');
      return {authorization:'Bearer '+key};
    };
    const upstreams=new Map(compiled.products.map(product=>[product.id,createUpstreamHandler({
      baseUrl:ORIGIN,path:product.upstreamPath,method:'GET',
      query:product.kind==='entity'?['select']:LIST_PARAMETERS,headers,agent,
      responseHeaders:exposed,responseType:'json',timeoutMs:compiled.config.timeoutMs,
      maxResponseBytes:compiled.config.maxResponseBytes,maxInFlight:compiled.config.budget.requestsPerSecond
    })]));
    function request(id,input,{signal}={}){
      const operation=(async()=>{
        if(closed)fail('The research source is closed.',503);
        if(accountingFailure)fail('The provider response was retained, but its local budget update needs recovery.',503,'OPENALEX_BUDGET_WRITE_FAILED');
        const selected=requestFor(compiled,id,input);headers();signal?.throwIfAborted();
        const reservation=await budget.reserve(selected.estimatedCredits);
        let response;
        try{
          signal?.throwIfAborted();
          const url=new URL(selected.product.path,compiled.config.publicOrigin);
          for(const [k,v] of Object.entries(selected.query))url.searchParams.set(k,v);
          response=await upstreams.get(id)({method:'GET',url,query:selected.query,
            pathParams:selected.product.kind==='entity'?{entityId:selected.request.id}:{},headers:{},body:null,signal});
        }catch(error){
          await budget.observe(reservation,unavailable(error),{dispatched:false});throw error;
        }
        let observed;
        try{observed=await budget.observe(reservation,response,{dispatched:response[UPSTREAM_ATTEMPT]?.dispatched!==false});}
        catch(error){accountingFailure=error.code??'BUDGET_WRITE_FAILED';observed={id:reservation.id,day:reservation.day,status:'ACCOUNTING_WRITE_FAILED',error:accountingFailure};}
        if(response.status===200&&(!Buffer.isBuffer(response.body)||!valid(selected.product,response.body,selected.query)))
          return {status:502,headers:{'content-type':'application/json'},body:{error:'OPENALEX_RESPONSE_CONTRACT_CHANGED'},
            source:{url:selected.sourceUrl,product:id,request:selected.request,reservation,observed}};
        const source={url:selected.sourceUrl,entity:selected.product.entity,kind:selected.product.kind,product:id,
          request:selected.request,retrievedAt:new Date().toISOString(),reservation,observed,
          ...(Buffer.isBuffer(response.body)?{bytes:response.body.length,sha256:sha256(response.body)}:{})};
        return {...response,headers:{...response.headers,'cache-control':'no-store','x-data-provider':'OpenAlex',
          'x-openalex-source-url':selected.sourceUrl,...(source.sha256?{'x-openalex-source-sha256':source.sha256}:{})},source};
      })();
      pending.add(operation);operation.finally(()=>pending.delete(operation)).catch(()=>{});
      return operation;
    }
    const handlers=Object.create(null);
    for(const product of compiled.products){
      handlers[product.id+'Admission']=async context=>{
        try{
          if(closed)fail('The research source is closed.',503);
          if(accountingFailure)fail('The provider response was retained, but its local budget update needs recovery.',503,'OPENALEX_BUDGET_WRITE_FAILED');
          const selected=requestFor(compiled,product.id,context.query);headers();
          const current=await budget.snapshot(selected.estimatedCredits);
          if(!current.allowed)throw Object.assign(new Error('OpenAlex request capacity is unavailable.'),{status:429,code:'OPENALEX_BUDGET_EXHAUSTED',retryAfter:current.retryAfterSeconds});
          return true;
        }catch(error){return unavailable(error);}
      };
      handlers[product.id]=async context=>{
        try{const r=await request(product.id,context.query,{signal:context.signal});return {status:r.status,headers:r.headers,body:r.body};}
        catch(error){return unavailable(error);}
      };
    }
    return {handlers,request,budget,async snapshot(){return {budget:await budget.snapshot(),upstreams:Object.fromEntries([...upstreams].map(([id,h])=>[id,h.snapshot()]))};},
      async close(){closed=true;await Promise.allSettled([...pending]);agent.destroy();await budget.close();}};
  }catch(error){agent?.destroy();await budget?.close();throw error;}
}
