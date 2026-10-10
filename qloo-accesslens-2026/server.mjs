import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureCatalog,validateCatalog} from './src/catalog.mjs';
import {fixturePlan, normalizeRequest,planAuditedVenues} from './src/engine.mjs';
import {QlooClient,ProviderError} from './src/qloo.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mode=process.env.ACCESSLENS_MODE==='live'?'live':'fixture';
const key=process.env.QLOO_API_KEY||'';
if (mode==='live' && !key) throw new Error('QLOO_API_KEY required for LIVE mode; never silently downgrade to fixture');
if (mode==='live' && !process.env.ACCESSLENS_VENUES_FILE) throw new Error('Audited operator venue catalog required for LIVE mode');
const catalog=mode==='fixture' ? validateCatalog(fixtureCatalog) : validateCatalog(JSON.parse(await readFile(process.env.ACCESSLENS_VENUES_FILE,'utf8')));
const port=Number(process.env.PORT||3000);
const host=process.env.HOST||'127.0.0.1';
if (!Number.isSafeInteger(port)||port<1||port>65535) throw new Error('invalid port');
const publicFiles=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/style.css','style.css']]);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const perIP=new Map();
let liveBudget={hour:0,requests:0};
const maxLivePerHour=Number(process.env.ACCESSLENS_PROVIDER_HOURLY_BUDGET||30);
if (!Number.isSafeInteger(maxLivePerHour)||maxLivePerHour<2||maxLivePerHour>500) throw new Error('invalid provider hourly budget');
const maxAuditAgeDays=Number(process.env.ACCESSLENS_MAX_AUDIT_AGE_DAYS||180);
if(!Number.isSafeInteger(maxAuditAgeDays)||maxAuditAgeDays<1||maxAuditAgeDays>365) throw new Error('invalid access audit recency policy');
let inflight=false;
function answer(res,code,data){const bytes=Buffer.from(JSON.stringify(data));res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);}
function allowed(ip){const now=Date.now();const existing=perIP.get(ip)||[];const future=existing.filter(t=>now-t<60000);future.push(now);perIP.set(ip,future);if(perIP.size>400){for(const[k,v]of perIP) if(!v.length||now-v.at(-1)>60000) perIP.delete(k);}return future.length<=8;}
async function body(req){let chunks=[],count=0;for await (const part of req){count+=part.length;if(count>12000)throw new Error('body exceeds 12KB');chunks.push(part);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
async function serve(req,res){
 const url=new URL(req.url,'http://localhost');
 res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'");
 if(req.method==='GET'&&url.pathname==='/health')return answer(res,200,{status:'ok',mode,source:mode==='live'?'QLOO_KEY_CONFIGURED':'SYNTHETIC_FIXTURE',catalogVenues:catalog.length});
 if(req.method==='GET'&&publicFiles.has(url.pathname)){
   const filename=publicFiles.get(url.pathname);const data=await readFile(path.join(here,'public',filename));
   res.writeHead(200,{'Content-Type':types[path.extname(filename)],'Cache-Control':'public, max-age=60'});return res.end(data);
 }
 if(req.method==='POST'&&url.pathname==='/api/plan'){
   if(!allowed(req.socket.remoteAddress||'unknown'))return answer(res,429,{error:'CLIENT_RATE_LIMIT'});
   let input;try {input=normalizeRequest(await body(req));}catch{return answer(res,400,{error:'INVALID_PLANNING_INPUT'});}
   if(mode==='fixture')return answer(res,200,fixturePlan(input,catalog));
   if(inflight)return answer(res,429,{error:'LIVE_SINGLE_FLIGHT_BUSY'});
   const hour=Math.floor(Date.now()/3600000);
   if(liveBudget.hour!==hour)liveBudget={hour,requests:0};
   // Reserve all two needed requests before touching provider; failed requests still burn budget.
   if(liveBudget.requests+2>maxLivePerHour)return answer(res,429,{error:'LIVE_QLOO_GLOBAL_BUDGET_EXHAUSTED'});
   liveBudget.requests+=2;inflight=true;
   try{const client=new QlooClient({apiKey:key,maxCalls:2});const affinity=await client.placesFromArtist(input.artist);
     return answer(res,200,{...planAuditedVenues(catalog,input,affinity,{mode:'live',maxAuditAgeDays}),providerCalls:client.calls});
   }catch(e){return answer(res,502,{error:e instanceof ProviderError?e.code:'LIVE_PLANNING_UNAVAILABLE',providerEvidence:'NONE'});}finally{inflight=false;}
 }
 answer(res,404,{error:'NOT_FOUND'});
}
http.createServer((req,res)=>{serve(req,res).catch(()=>{if(!res.headersSent)answer(res,500,{error:'INTERNAL_ERROR'});else res.destroy();});}).listen(port,host,()=>{console.log(`AccessLens ${mode} listening at http://${host}:${port}; catalog=${catalog.length}`);});
