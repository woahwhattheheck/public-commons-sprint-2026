import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {MatchEngine,SYNTHETIC_EVENTS} from './engine.mjs';
import {draftFoundryExplanation,foundryConfigured} from './foundry.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const engine=new MatchEngine();
let nextIndex=0;
const FILES={'/':'index.html','/app.mjs':'app.mjs','/styles.css':'styles.css'};
const TYPES={'index.html':'text/html;charset=utf-8','app.mjs':'text/javascript;charset=utf-8','styles.css':'text/css;charset=utf-8'};
const SECURITY={'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-store',
 'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
function json(res,status,body){res.writeHead(status,{...SECURITY,'content-type':'application/json'});res.end(JSON.stringify(body));}
function options(url){const params=new URL(url,'http://localhost').searchParams;return {audience:params.get('audience')||'analyst',favorite:params.get('favorite')||'Harbor FC'};}
async function readJson(req){
 let bytes=0,chunks=[];
 for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)throw new Error('Payload exceeds 8 KiB');chunks.push(chunk);}
 try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('Invalid JSON');}
}

export const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 try{
  if(req.method==='GET'&&Object.hasOwn(FILES,url.pathname)){
   const name=FILES[url.pathname],data=await readFile(join(ROOT,name));
   res.writeHead(200,{...SECURITY,'content-type':TYPES[name]});res.end(data);return;
  }
  if(req.method==='GET'&&url.pathname==='/api/state'){
   json(res,200,{...engine.snapshot(options(req.url)),foundryConfigured:foundryConfigured(),demoRemaining:SYNTHETIC_EVENTS.length-nextIndex});return;
  }
  if(req.method==='POST'&&url.pathname==='/api/next'){
   if(nextIndex<SYNTHETIC_EVENTS.length)engine.ingest(SYNTHETIC_EVENTS[nextIndex++]);
   json(res,200,{...engine.snapshot(options(req.url)),foundryConfigured:foundryConfigured(),demoRemaining:SYNTHETIC_EVENTS.length-nextIndex});return;
  }
  if(req.method==='POST'&&url.pathname==='/api/reset'){
   engine.reset();nextIndex=0;json(res,200,{...engine.snapshot(options(req.url)),demoRemaining:SYNTHETIC_EVENTS.length});return;
  }
  if(req.method==='POST'&&url.pathname==='/api/events'){
   const body=await readJson(req);const result=engine.ingest(body);
   json(res,200,{result,...engine.snapshot(options(req.url))});return;
  }
  if(req.method==='POST'&&url.pathname==='/api/explain'){
   // Model call is opt-in, never replay-triggered or billed silently.
   const snapshot=engine.snapshot(options(req.url));
   const result=await draftFoundryExplanation(snapshot);json(res,200,result);return;
  }
  json(res,404,{error:'Not found'});
 }catch(error){
  const invalid=/^(Invalid|Event|Team|Unknown|Unsupported|Duration|Events must|Event limit|Payload exceeds)/.test(error.message);
  json(res,invalid?422:502,{error:invalid?error.message:'Request could not be completed'});
 }
});

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||8789);
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid PORT');
 server.listen(port,'127.0.0.1',()=>console.log(`PitchPulse demo at http://127.0.0.1:${port}`));
}