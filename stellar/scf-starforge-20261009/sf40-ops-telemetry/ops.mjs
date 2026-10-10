// MIT. SF-40: bounded, non-custodial operations adapter for actual Bazaar read routes.
// It never calls a ledger, wallet, RPC, seller, or external telemetry endpoint.
import { performance } from 'node:perf_hooks';

const KNOWN_ROUTES = new Set(['/discovery/resources','/discovery/search','/healthz','/readyz','/metrics']);
const LOCAL = new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
const validNumber=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const sortLatency=items=>items.slice().sort((a,b)=>a-b);
const quantile=(values,p)=>values.length?Number(sortLatency(values)[Math.ceil(p*values.length)-1].toFixed(3)):null;
const send=(res,status,body,extra={})=>{
  if(res.headersSent || res.writableEnded)return;
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra});
  res.end(JSON.stringify(body));
};
const routeOf=req=>{try{const path=new URL(req.url,'http://localhost').pathname;return KNOWN_ROUTES.has(path)?path:'other';}catch{return 'other';}};
const classify=status=>status>=500?'5xx':status>=400?'4xx':status>=300?'3xx':'2xx';

/**
 * Wrap an existing real createDiscoveryServer(catalog) handler. No mutation routes.
 * Status / readiness / local telemetry are additive, not claims of RPC availability.
 * `nowMs` and `observe` injection permit deterministic focused validation.
 */
export function createOpsHandler({catalog, discoveryHandler, nowMs=()=>performance.now(), observe, requestsPerWindow=120, windowMs=60_000, maxClients=2048, maxInFlight=64, sampleCap=512, readyCheck=()=>true, readyTimeoutMs=2_000}={}) {
  if (typeof discoveryHandler!=='function'||typeof nowMs!=='function'||typeof readyCheck!=='function'||(observe!==undefined&&typeof observe!=='function'))throw new TypeError('Trusted catalog/handler and clock required');
  for(const [v,lo,hi] of [[requestsPerWindow,1,1_000_000],[windowMs,100,3_600_000],[maxClients,1,50_000],[maxInFlight,1,100_000],[sampleCap,10,10_000],[readyTimeoutMs,25,30_000]])
    if(!validNumber(v,lo,hi))throw new RangeError('Invalid bounded operations policy');
  let active=0, completed=0, rejectedRate=0, rejectedLoad=0;
  const clients=new Map(), summary=new Map();
  const bucketFor=(ip,t)=>{
    let b=clients.get(ip);
    if(b&&t-b.started>=windowMs){clients.delete(ip);b=null;}
    if(!b){
      if(clients.size>=maxClients){
        // Expire old buckets, but never evict active ones to admit attackers for free.
        for(const [key,value] of clients)if(t-value.started>=windowMs)clients.delete(key);
        if(clients.size>=maxClients)return null;
      }
      b={started:t,used:0};clients.set(ip,b);
    }
    return b;
  };
  const record=(route,status,ms)=>{
    const q=summary.get(route)??{total:0,classes:{'2xx':0,'3xx':0,'4xx':0,'5xx':0},samples:[]};
    q.total++;q.classes[classify(status)]++;
    q.samples.push(Math.max(0,ms));if(q.samples.length>sampleCap)q.samples.shift();
    summary.set(route,q);completed++;
    try{observe?.({route,status,durationMs:Number(Math.max(0,ms).toFixed(3))});}catch{/* observers never affect requests */}
  };
  const localOnly=(req)=>LOCAL.has(req.socket?.remoteAddress??'');
  const snapshot=()=>{
    const routes={};
    for(const [k,v] of summary)routes[k]={requests:v.total,statusClasses:{...v.classes},p50Ms:quantile(v.samples,0.5),p95Ms:quantile(v.samples,0.95),sampleCount:v.samples.length};
    return {kind:'bazaar-local-process-telemetry',uptime:'not_measured_by_this_adapter',completedRequests:completed,inFlight:active,rateLimited:rejectedRate,overloaded:rejectedLoad,routeMetrics:routes};
  };
  const checkReady=async()=>{
    let timer;
    try{
      return Boolean(await Promise.race([
        Promise.resolve().then(()=>readyCheck()),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(false),readyTimeoutMs);})
      ]));
    }catch{
      return false;
    }finally{
      clearTimeout(timer);
    }
  };
  async function handler(req,res){
    const started=nowMs(), route=routeOf(req), ip=req.socket?.remoteAddress??'unknown';
    let finished=false, admitted=false;
    const done=()=>{
      if(finished)return;finished=true;
      if(admitted)active--;
      record(route,res.statusCode||500,nowMs()-started);
    };
    res.once('finish',done);res.once('close',done);
    try {
      if(['/readyz','/healthz','/metrics'].includes(route)){
        if(!localOnly(req)){send(res,403,{error:'LOCAL_ONLY'});return;}
        if(req.method!=='GET'){send(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
        if(route==='/healthz'){send(res,200,{alive:true,detail:'process-only'});return;}
        if(route==='/metrics'){send(res,200,snapshot());return;}
        const applicationReady=await checkReady();
        const catalogShape=Boolean(catalog && typeof catalog.search==='function' && typeof catalog.list==='function');
        const ready=applicationReady&&catalogShape;
        send(res,ready?200:503,{ready,scope:'discovery-process-only',catalog:{size:Number(catalog?.size??0),version:Number(catalog?.version??0)},rpc:'unchecked',ledger:'unchecked',settlement:'unchecked'});
        return;
      }
      const b=bucketFor(ip,started);
      if(!b || b.used>=requestsPerWindow){rejectedRate++;send(res,429,{error:'RATE_LIMITED'},{'retry-after':String(Math.max(1,Math.ceil(windowMs/1000)))});return;}
      b.used++;
      if(active>=maxInFlight){rejectedLoad++;send(res,503,{error:'OVERLOADED'},{'retry-after':'1'});return;}
      admitted=true;active++;
      await discoveryHandler(req,res);
    } catch {
      if(!res.headersSent){send(res,500,{error:'INTERNAL_ERROR'});return;}
      if(!res.writableEnded)res.end();
    }
  }
  return {handler,snapshot};
}
