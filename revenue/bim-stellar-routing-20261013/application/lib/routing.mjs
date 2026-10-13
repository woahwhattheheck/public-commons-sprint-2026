// MIT. Parallel source discovery and simulated fallback proposals, using original provider contexts.
import {canonical,compareQuotes,quoteRows,fail} from './exchange-domain.mjs';
const errorValue=e=>({code:e?.code??'PROVIDER_ERROR',message:e?.message??String(e),details:e?.details??null});
export function createRoutingAdapter({adapters}){
 const providers=['soroswap','aqua','sushi'];
 const owner=id=>{const found=adapters.filter(a=>a.catalogue?.some(x=>x.id===id));if(found.length!==1)fail('ADAPTER_REGISTRY','Select exactly one installed adapter for '+id+'.');return found[0];};
 const executeProvider=(id,input,ctx)=>owner(id).execute(id,input,ctx);
 const childOrigins=[...new Set(adapters.flatMap(a=>(a.catalogue??[]).flatMap(d=>d.origins??[])))];
 const catalogue=[
 {id:'exchange.discover',title:'Discover routes in parallel',provider:'exchange',mode:'read',origins:childOrigins,description:'Query each configured venue concurrently and retain every original result, failure and comparable route.'},
 {id:'exchange.prepareBest',title:'Simulate best available route',provider:'exchange',mode:'prepare',origins:childOrigins,description:'Simulate the ranked routes in order and propose the first executable original route, retaining all fallback reasons.'}
 ];
 return{catalogue,async execute(actionId,input,ctx){
 if(typeof ctx.fork!=='function')fail('HTTP_LANES_REQUIRED','Use the installed original request store with deterministic parallel provider lanes.');
 if(actionId==='exchange.discover'){
 const selected=input.providers??providers;if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some(p=>!providers.includes(p)))fail('SOURCE_SELECTION','Choose distinct installed liquidity sources.');
 const request={...input};delete request.providers;
 const results=await Promise.allSettled(selected.map(provider=>{const own=provider==='soroswap'?Object.fromEntries(['tokenIn','tokenOut','amount','mode','slippageBps','ttlSeconds'].filter(k=>request[k]!==undefined).map(k=>[k,request[k]])):request;return executeProvider(provider+'.quote',own,ctx.fork('discovery-'+provider));}));
 const sources=results.map((r,k)=>r.status==='fulfilled'?{provider:selected[k],status:r.value.status,value:r.value}:{provider:selected[k],status:'FAILED',error:errorValue(r.reason)}),quotes=sources.flatMap(s=>s.value?.quotes??[]);
 return{schema:'bim.route-discovery.v1',status:quotes.length?'QUOTED':'NO_EXECUTABLE_QUOTE',createdAt:ctx.now,input:request,providers:selected,sources,quotes,exchangeIds:[...new Set(sources.flatMap(s=>s.value?.exchangeIds??[]))]};
 }
 if(actionId==='exchange.prepareBest'){
 if(!Array.isArray(input.quoteIds)||!input.quoteIds.length)fail('QUOTE_REFERENCES','Select complete retained quote discovery records.');
 const rows=input.quoteIds.map(id=>{const row=(ctx.evidence??[]).find(x=>x.id===id);if(!row)fail('QUOTE_EVIDENCE','Missing original quote discovery '+id);return row;});
 const comparison=compareQuotes(rows,{now:ctx.now,config:ctx.config}),attempts=[];
 if(input.preferred){const pos=comparison.routes.findIndex(r=>r.quoteId===input.preferred.quoteId&&r.routeIndex===String(input.preferred.routeIndex));if(pos<0)fail('PREFERRED_ROUTE','The preferred original route is unavailable or expired.');const [first]=comparison.routes.splice(pos,1);comparison.routes.unshift(first);}
 for(const [index,candidate]of comparison.routes.entries()){
 const id=candidate.quote.provider+'.prepare';let prepared;
 try{prepared=await executeProvider(id,{quoteId:candidate.quoteId,routeIndex:candidate.routeIndex},ctx.fork('preparation-'+index+'-'+candidate.quote.provider));
 if(prepared.status==='PREPARED'&&!prepared.simulation)prepared={...prepared,status:'NEEDS_REVIEW',reviewReason:'This original transaction lacks a completed pre-signature simulation.'};
 const item={provider:candidate.quote.provider,quoteId:candidate.quoteId,routeIndex:candidate.routeIndex,status:prepared.status,value:prepared};attempts.push(item);
 if(prepared.status==='PREPARED'&&prepared.unsignedPayload&&prepared.simulation&&!prepared.simulation.error&&!prepared.simulation.restorePreamble){return{...prepared,schema:'bim.route-preparation.v1',selectedSourceLane:(ctx.lane?ctx.lane+'/':'')+'preparation-'+index+'-'+candidate.quote.provider,selectedExchangeIds:[...new Set((prepared.exchangeIds??[]).filter(id=>!(candidate.quote.exchangeIds??[]).includes(id)))].sort(),comparison,attempts,selected:{provider:candidate.quote.provider,quoteId:candidate.quoteId,routeIndex:candidate.routeIndex},fallback:{used:index>0,failedRoutes:attempts.slice(0,-1),requiresReview:index>0},selection:{...prepared.selection,routing:{selected:{provider:candidate.quote.provider,quoteId:candidate.quoteId,routeIndex:candidate.routeIndex},fallbackUsed:index>0}},exchangeIds:[...new Set(attempts.flatMap(a=>a.value?.exchangeIds??[]))]};}
 }catch(e){attempts.push({provider:candidate.quote.provider,quoteId:candidate.quoteId,routeIndex:candidate.routeIndex,status:'FAILED',error:errorValue(e),value:prepared??null});}
 }
 return{schema:'bim.route-preparation.v1',status:'NEEDS_REVIEW',unsignedPayload:null,comparison,attempts,selected:null,fallback:{used:attempts.length>1,failedRoutes:attempts,requiresReview:true},exchangeIds:[...new Set(attempts.flatMap(a=>a.value?.exchangeIds??[]))]};
 }
 fail('ACTION_UNAVAILABLE','Unsupported routing action: '+actionId);
 }};
}
