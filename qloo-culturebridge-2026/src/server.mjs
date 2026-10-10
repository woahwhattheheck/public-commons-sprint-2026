import http from 'node:http';import {readFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {cleanSeed,cleanKind,buildAgentResponse} from './engine.mjs';
import {buildLiveComparison,QlooError} from './qloo.mjs';import {demoResults} from './fixtures.mjs';
const publicRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const files=new Map([['/', ['index.html','text/html; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']],['/app.js',['app.js','application/javascript; charset=utf-8']]]);
const PORT=Number(process.env.PORT||8787);
const write=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
export async function route(req,res){const url=new URL(req.url,'http://localhost');
  if(req.method!=='GET')return write(res,405,{error:'Only GET requests are accepted'});
  if(url.pathname==='/health')return write(res,200,{status:'ok',qlooKeyConfigured:!!process.env.QLOO_API_KEY});
  if(url.pathname==='/api/bridge'){
    try{
      const seedA=cleanSeed(url.searchParams.get('a')),seedB=cleanSeed(url.searchParams.get('b')),kind=cleanKind(url.searchParams.get('kind'));
      if(seedA.toLowerCase()===seedB.toLowerCase())throw new Error('Choose two different taste seeds');
      const mode=url.searchParams.get('mode')==='live'?'live':'fixture';
      const sources=mode==='live'?await buildLiveComparison({seedA,seedB,kind}):demoResults(seedA,seedB,kind);
      return write(res,200,buildAgentResponse({seedA,seedB,kind,mode,...sources}));
    }catch(err){let status=err instanceof QlooError?(err.code==='RATE_LIMIT'?429:err.code==='AUTH'?502:err.code==='NOT_CONFIGURED'?503:err.code==='NO_MATCH'?422:err.code==='AMBIGUOUS_SEED'?409:502):400;
      const body={error:String(err.message||'Request failed').slice(0,300),code:err.code||'VALIDATION'};
      if(err instanceof QlooError && err.code==='NO_MATCH' && Array.isArray(err.suggestions))
        body.suggestions=err.suggestions.slice(0,3);
      return write(res,status,body);}
  }
  const f=files.get(url.pathname);if(!f)return write(res,404,{error:'Not found'});
  try{const contents=await readFile(path.join(publicRoot,f[0]));res.writeHead(200,{'Content-Type':f[1],'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(contents)}
  catch{return write(res,500,{error:'Static asset unavailable'})}
}
export function createServer(){return http.createServer((req,res)=>{route(req,res).catch(()=>write(res,500,{error:'Unexpected server error'}))})}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){createServer().listen(PORT,'127.0.0.1',()=>console.log(`CultureBridge at http://127.0.0.1:${PORT}`))}
