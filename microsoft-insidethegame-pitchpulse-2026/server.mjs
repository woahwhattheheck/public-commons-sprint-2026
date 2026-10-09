import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {SYNTHETIC_EVENTS} from './engine.mjs';
import {draftFoundryExplanation,foundryConfigured} from './foundry.mjs';
import {SessionStore,sessionCookie,FoundryBudget} from './demo_sessions.mjs';
import {exportReplay,validateReplay,MAX_REPLAY_BYTES} from './replay.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const FILES={'/':'index.html','/app.mjs':'app.mjs','/styles.css':'styles.css',
 '/broadcast':'broadcast.html','/broadcast.mjs':'broadcast.mjs','/broadcast.css':'broadcast.css'};
const TYPES={'index.html':'text/html;charset=utf-8','app.mjs':'text/javascript;charset=utf-8','styles.css':'text/css;charset=utf-8',
 'broadcast.html':'text/html;charset=utf-8','broadcast.mjs':'text/javascript;charset=utf-8','broadcast.css':'text/css;charset=utf-8'};
const ROUTES=new Set(['GET /api/state','GET /api/replay','POST /api/replay',
 'POST /api/next','POST /api/reset','POST /api/events','POST /api/explain']);
const SECURITY={'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-store',
 'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
function json(res,status,body){res.writeHead(status,{...SECURITY,'content-type':'application/json'});res.end(JSON.stringify(body));}
function options(url){
 const params=url.searchParams;
 const audience=params.get('audience')||'analyst',favorite=params.get('favorite')||'Harbor FC';
 if(!['analyst','fan'].includes(audience))throw new Error('Unknown audience');
 if(!['Harbor FC','Valley FC'].includes(favorite))throw new Error('Invalid favorite');
 return {audience,favorite};
}
function readJson(req,limit){
 return new Promise((resolve,reject)=>{
  let bytes=0,chunks=[],failed=false;
  req.on('data',chunk=>{
   if(failed)return;
   bytes+=chunk.length;
   if(bytes>limit){failed=true;chunks=[];reject(Object.assign(new Error('Payload exceeds allowed size'),{status:413}));return;}
   chunks.push(chunk);
  });
  req.on('end',()=>{
   if(failed)return;
   try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
   catch{reject(new Error('Invalid JSON'));}
  });
  req.on('error',reject);
  req.on('aborted',()=>reject(new Error('Invalid incomplete request')));
 });
}
function checkOrigin(req){
 if(req.headers['sec-fetch-site']==='cross-site')throw Object.assign(new Error('Cross-site mutation rejected'),{status:403});
 if(req.headers.origin){
  let origin;
  try{origin=new URL(req.headers.origin);}catch{throw Object.assign(new Error('Invalid request origin'),{status:403});}
  if(!['http:','https:'].includes(origin.protocol)||origin.host!==req.headers.host){
   throw Object.assign(new Error('Cross-origin mutation rejected'),{status:403});
  }
 }
}

export function createPitchPulseServer({store=new SessionStore(),budget=new FoundryBudget(),secureCookie=process.env.COOKIE_SECURE==='1'}={}){
 return createServer({requestTimeout:15000,headersTimeout:10000,maxHeaderSize:8192},async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   if(req.method==='GET'&&url.pathname==='/healthz'){
    json(res,200,{status:'ok',service:'pitchpulse',state:'single-process-memory'});return;
   }
   if(req.method==='GET'&&Object.hasOwn(FILES,url.pathname)){
    const name=FILES[url.pathname],data=await readFile(join(ROOT,name));
    res.writeHead(200,{...SECURITY,'content-type':TYPES[name]});res.end(data);return;
   }
   if(!ROUTES.has(`${req.method} ${url.pathname}`)){json(res,404,{error:'Not found'});return;}
   const view=options(url); // Reject malformed view options before any state mutation.
   if(req.method==='POST')checkOrigin(req);
   const session=store.acquire(req.headers.cookie);
   res.setHeader('set-cookie',sessionCookie(session,secureCookie));
   const snapshot=(projection={})=>({...session.engine.snapshot({...view,...projection}),
    lastLedgerSecond:session.engine.events.at(-1)?.second??0,foundryConfigured:foundryConfigured()&&budget.enabled,
    demoRemaining:session.nextIndex===null?0:SYNTHETIC_EVENTS.length-session.nextIndex,
    replayMode:session.nextIndex===null?'custom':'built-in'});
   // Clock review projects existing session state without mutating the event ledger.
   // Reject the parameter on mutation routes so a POST cannot imply a historical action.
   if(url.searchParams.has('asOfSecond')&&!(req.method==='GET'&&url.pathname==='/api/state'))
    throw new Error('Invalid snapshot clock parameter');
   if(req.method==='GET'&&url.pathname==='/api/state'){
    const raw=url.searchParams.get('asOfSecond');
    if(raw!==null&&!/^(0|[1-9][0-9]{0,3})$/.test(raw))throw new Error('Invalid snapshot clock');
    const asOfSecond=raw===null?undefined:Number(raw);
    if(asOfSecond!==undefined&&asOfSecond>5400)throw new Error('Invalid snapshot clock');
    json(res,200,snapshot(asOfSecond===undefined?{}:{asOfSecond}));return;
   }
   if(req.method==='GET'&&url.pathname==='/api/replay'){json(res,200,exportReplay(session));return;}
   if(req.method==='POST'&&url.pathname==='/api/replay'){
    const replacement=validateReplay(await readJson(req,MAX_REPLAY_BYTES));
    session.engine=replacement.engine;session.nextIndex=replacement.nextIndex;
    json(res,200,snapshot());return;
   }
   if(req.method==='POST'&&url.pathname==='/api/next'){
    if(session.nextIndex===null)throw new Error('Invalid built-in continuation: restart the custom ledger first');
    if(session.nextIndex<SYNTHETIC_EVENTS.length){
     session.engine.ingest(SYNTHETIC_EVENTS[session.nextIndex]);session.nextIndex++;
    }
    json(res,200,snapshot());return;
   }
   if(req.method==='POST'&&url.pathname==='/api/reset'){
    session.engine.reset();session.nextIndex=0;json(res,200,snapshot());return;
   }
   if(req.method==='POST'&&url.pathname==='/api/events'){
    const result=session.engine.ingest(await readJson(req,8192));
    if(!result.duplicate)session.nextIndex=null;
    json(res,200,{result,...snapshot()});return;
   }
   if(req.method==='POST'&&url.pathname==='/api/explain'){
    // Model call remains explicit opt-in, never triggered by replay, import or health checks.
    if(!budget.enabled){json(res,200,{status:'budget-disabled',text:'Foundry demo calls are disabled. An authorized operator must configure an explicit hourly budget.'});return;}
    const match=session.engine.snapshot(view);
    const result=foundryConfigured()?await budget.run(()=>draftFoundryExplanation(match)):await draftFoundryExplanation(match);
    json(res,200,result);return;
   }
  }catch(error){
   const invalid=/^(Invalid|Event|Team|Unknown|Unsupported|Duration|Payload exceeds)/.test(error.message);
   const status=error.status||(invalid?422:502);
   if(status===503||status===429)res.setHeader('retry-after',String(error.retryAfter||60));
   if(!res.destroyed&&!res.writableEnded)json(res,status,{error:status===502?'Request could not be completed':error.message});
  }
 });
}
export const server=createPitchPulseServer();

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||8789),host=process.env.HOST||'127.0.0.1';
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid PORT');
 if(!['127.0.0.1','0.0.0.0','::1','::'].includes(host))throw new Error('Invalid HOST: use a supported bind address');
 server.listen(port,host,()=>console.log(`PitchPulse listening on ${host}:${port}`));
}
