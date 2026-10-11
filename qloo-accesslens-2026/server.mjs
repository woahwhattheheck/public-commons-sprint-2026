import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fixtureCatalog,fixtureInsights,validateCatalog} from './src/catalog.mjs';
import {fixturePlan,normalizeRequest,planAuditedVenues} from './src/engine.mjs';
import {QlooClient,ProviderError} from './src/qloo.mjs';
import {AffinityCache} from './src/affinity-cache.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const files=new Map([['/','public/index.html'],['/index.html','public/index.html'],['/app.js','public/app.js'],['/style.css','public/style.css'],
  ['/modules/catalog.mjs','src/catalog.mjs'],['/modules/engine.mjs','src/engine.mjs'],['/modules/workspace.mjs','src/workspace.mjs']]);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};

export function createAccessLensServer({mode='fixture',key='',catalog,maxLivePerHour=30,maxAuditAgeDays=180,affinityReuseSeconds=120,shareVenues=false,clientFactory=options=>new QlooClient(options)}={}) {
  if(!['fixture','live'].includes(mode))throw new Error('ACCESSLENS_MODE must be fixture or live');
  if(mode==='live'&&!key)throw new Error('QLOO_API_KEY required for LIVE mode');
  const venues=validateCatalog(catalog??(mode==='fixture'?fixtureCatalog:undefined));
  if(!Number.isSafeInteger(maxLivePerHour)||maxLivePerHour<2||maxLivePerHour>500)throw new Error('invalid provider hourly budget');
  if(!Number.isSafeInteger(maxAuditAgeDays)||maxAuditAgeDays<1||maxAuditAgeDays>365)throw new Error('invalid access audit recency policy');
  if(!Number.isSafeInteger(affinityReuseSeconds)||affinityReuseSeconds<0||affinityReuseSeconds>300)throw new Error('invalid affinity reuse interval');
  const affinityCache=new AffinityCache({ttlMs:affinityReuseSeconds*1000}),perIP=new Map();
  let liveBudget={hour:0,requests:0},inflight=false;
  function answer(res,code,data,headers={}) {
    res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});
    res.end(JSON.stringify(data));
  }
  function allowed(ip) {
    const now=Date.now(),recent=(perIP.get(ip)||[]).filter(t=>now-t<60000);
    recent.push(now);perIP.set(ip,recent);
    if(perIP.size>400)for(const[k,v]of perIP)if(!v.length||now-v.at(-1)>60000)perIP.delete(k);
    return recent.length<=8;
  }
  async function body(req) {
    const chunks=[];let count=0;
    for await(const part of req){count+=part.length;if(count>12000)throw new Error('body exceeds 12KB');chunks.push(part);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  function reserve(count) {
    const hour=Math.floor(Date.now()/3600000);
    if(liveBudget.hour!==hour)liveBudget={hour,requests:0};
    if(liveBudget.requests+count>maxLivePerHour)throw new ProviderError('LIVE_QLOO_GLOBAL_BUDGET_EXHAUSTED');
    // Failed calls consume reserved allowance, as in the original operator API.
    liveBudget.requests+=count;
  }
  async function affinity(artist) {
    if(mode==='fixture')return {mode,artistQuery:artist,providerEvidence:'SYNTHETIC_OFFLINE_FIXTURE',providerCalls:0,
      affinity:{artist:{id:'demo-artist-id',name:artist},rankedPlaceIds:fixtureInsights,qlooRequests:0},providerCapture:null};
    if(inflight)throw new ProviderError('LIVE_SINGLE_FLIGHT_BUSY');
    const cached=affinityCache.lookup(artist);
    if(cached)return {mode,artistQuery:artist,providerEvidence:'LIVE_QLOO_RESPONSE',providerCalls:0,...cached};
    reserve(2);inflight=true;
    try {
      const client=clientFactory({apiKey:key,maxCalls:2});
      const value=await client.placesFromArtist(artist);
      return {mode,artistQuery:artist,providerEvidence:'LIVE_QLOO_RESPONSE',providerCalls:client.calls,...affinityCache.remember(artist,value)};
    } finally {inflight=false;}
  }
  async function search(query) {
    if(mode==='fixture')return {mode,providerEvidence:'SYNTHETIC_OFFLINE_FIXTURE',providerCalls:0,places:venues.filter(v=>v.name.toLowerCase().includes(query.toLowerCase())).map(v=>({id:v.qloo_id,name:v.name,details:{city:v.city}}))};
    if(inflight)throw new ProviderError('LIVE_SINGLE_FLIGHT_BUSY');
    reserve(1);inflight=true;
    try {const client=clientFactory({apiKey:key,maxCalls:1});return {mode,providerEvidence:'LIVE_QLOO_RESPONSE',places:await client.searchPlaces(query),providerCalls:client.calls};}
    finally {inflight=false;}
  }
  async function serve(req,res) {
    const url=new URL(req.url,'http://localhost');
    res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'");
    if(req.method==='GET'&&url.pathname==='/health')return answer(res,200,{status:'ok',mode,source:mode==='live'?'QLOO_KEY_CONFIGURED':'SYNTHETIC_FIXTURE',catalogVenues:venues.length});
    if(req.method==='GET'&&url.pathname==='/api/catalog')return answer(res,200,{schema:'accesslens-bootstrap/v1',mode,catalog:mode==='fixture'||shareVenues?venues:null,
      catalogLabel:mode==='fixture'?'Fictional demonstration venues':'Published operator venue catalog',catalogKind:mode==='fixture'?'fixture':'operator',
      auditAsOfUTC:mode==='fixture'?'2026-10-09':new Date().toISOString().slice(0,10),maxAuditAgeDays,
      affinityReuseSeconds,privacy:'The browser sends only artist or explicit venue-search text. Planning constraints and imported catalogs stay in this browser.'});
    if(req.method==='GET'&&files.has(url.pathname)) {
      const filename=files.get(url.pathname),data=await readFile(path.join(here,filename));
      res.writeHead(200,{'Content-Type':types[path.extname(filename)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});return res.end(data);
    }
    if(req.method==='POST'&&['/api/plan','/api/affinity','/api/places/search'].includes(url.pathname)) {
      if(req.headers.origin) {
        let same=false;try{same=new URL(req.headers.origin).host===req.headers.host;}catch{}
        if(!same)return answer(res,403,{error:'ORIGIN_NOT_ALLOWED'});
      }
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))return answer(res,415,{error:'JSON_REQUIRED'});
      if(!allowed(req.socket.remoteAddress||'unknown'))return answer(res,429,{error:'CLIENT_RATE_LIMIT'},{'Retry-After':'60'});
      let input,artist,query;
      try {
        const raw=await body(req);
        if(url.pathname==='/api/plan'){input=normalizeRequest(raw);artist=input.artist;}
        else if(url.pathname==='/api/affinity') {
          if(!raw||Array.isArray(raw)||Object.keys(raw).some(k=>k!=='artist'))throw new Error('artist only');
          artist=normalizeRequest({artist:raw.artist,groupSize:1,budgetUSD:0,required:[]}).artist;
        } else {
          if(!raw||Array.isArray(raw)||Object.keys(raw).some(k=>k!=='query')||typeof raw.query!=='string'||raw.query.trim().length<2||raw.query.length>180||/[\x00-\x1f]/.test(raw.query))throw new Error('invalid place query');
          query=raw.query.trim();
        }
      } catch {return answer(res,400,{error:'INVALID_PLANNING_INPUT'});}
      try {
        if(query)return answer(res,200,await search(query));
        if(url.pathname==='/api/plan'&&mode==='fixture')return answer(res,200,fixturePlan(input,venues));
        const snapshot=await affinity(artist);
        if(url.pathname==='/api/affinity')return answer(res,200,snapshot);
        const plan=planAuditedVenues(venues,input,snapshot.affinity,{mode:'live',maxAuditAgeDays});
        return answer(res,200,{...plan,providerCalls:snapshot.providerCalls,providerCapture:snapshot.providerCapture,
          notices:[...plan.notices,snapshot.providerCapture.reused?`Artist affinity reused from ${snapshot.providerCapture.capturedAtUTC}; all venue constraints and audit recency were checked again for this request.`:`Artist affinity retrieved at ${snapshot.providerCapture.capturedAtUTC}; no prior response substituted.`]});
      } catch(error) {
        const code=error instanceof ProviderError?error.code:'LIVE_PLANNING_UNAVAILABLE';
        const limited=['LIVE_SINGLE_FLIGHT_BUSY','LIVE_QLOO_GLOBAL_BUDGET_EXHAUSTED','QLOO_RATE_LIMITED'].includes(code);
        return answer(res,limited?429:502,{error:code,providerEvidence:'NONE'},limited?{'Retry-After':code==='LIVE_QLOO_GLOBAL_BUDGET_EXHAUSTED'?String(3600-Math.floor(Date.now()/1000)%3600):'10'}:{});
      }
    }
    answer(res,404,{error:'NOT_FOUND'});
  }
  return http.createServer((req,res)=>{serve(req,res).catch(()=>{if(!res.headersSent)answer(res,500,{error:'INTERNAL_ERROR'});else res.destroy();});});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode=process.env.ACCESSLENS_MODE??'fixture';
  if(mode==='live'&&!process.env.ACCESSLENS_VENUES_FILE)throw new Error('Audited operator venue catalog required for LIVE mode');
  const catalog=mode==='live'?JSON.parse(await readFile(process.env.ACCESSLENS_VENUES_FILE,'utf8')):fixtureCatalog;
  const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('invalid port');
  if(process.env.ACCESSLENS_SHARE_VENUES!==undefined&&!['0','1'].includes(process.env.ACCESSLENS_SHARE_VENUES))throw new Error('ACCESSLENS_SHARE_VENUES must be 0 or 1');
  const server=createAccessLensServer({mode,key:process.env.QLOO_API_KEY||'',catalog,maxLivePerHour:Number(process.env.ACCESSLENS_PROVIDER_HOURLY_BUDGET||30),
    maxAuditAgeDays:Number(process.env.ACCESSLENS_MAX_AUDIT_AGE_DAYS||180),affinityReuseSeconds:Number(process.env.ACCESSLENS_AFFINITY_REUSE_SECONDS??120),shareVenues:process.env.ACCESSLENS_SHARE_VENUES==='1'});
  server.listen(port,host,()=>console.log(`AccessLens ${mode} listening at http://${host}:${port}; catalog=${catalog.length}`));
}
