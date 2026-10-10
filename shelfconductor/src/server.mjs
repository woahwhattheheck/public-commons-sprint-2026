// SPDX-License-Identifier: MIT
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {InputError,validatePlan,planBooks} from './core.mjs';
import {makeQlooClient,UpstreamError} from './qloo.mjs';
import {inventory as demoInventory,insights as demoInsights} from './demo.mjs';
const staticDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const assets=new Map([['/', ['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
const client=makeQlooClient({apiKey:process.env.QLOO_API_KEY,maxCalls:Number(process.env.QLOO_CALLS_PER_MINUTE||24)});
function reply(res,code,data){const body=JSON.stringify(data);res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"});res.end(body);}
async function bodyJson(req){
  if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new InputError('INVALID_INPUT','Content-Type must be application/json');
  let size=0,s='';for await(const chunk of req){size+=chunk.length;if(size>150000)throw new InputError('TOO_LARGE','body exceeds 150KB');s+=chunk.toString('utf8');}
  try{return JSON.parse(s);}catch{throw new InputError('INVALID_JSON','Malformed JSON');}
}
export function createHandler({qloo=client}={}){return async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&assets.has(u.pathname)){
      const [filename,type]=assets.get(u.pathname);
      const data=await readFile(path.join(staticDir,filename));
      res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'"});res.end(data);return;
    }
    if(req.method==='GET'&&u.pathname==='/api/demo-inventory'){reply(res,200,{synthetic:true,inventory:demoInventory});return;}
    if(req.method==='GET'&&u.pathname==='/api/health'){reply(res,200,{ok:true,live_key_configured:Boolean(process.env.QLOO_API_KEY),mode:'demo available; live requires key'});return;}
    if(req.method==='POST'&&u.pathname==='/api/plan'){
      const p=validatePlan(await bodyJson(req));
      let result;
      if(p.mode==='demo')result=planBooks(p,demoInsights,{synthetic:true});
      else{
        const seedResolved=[];for(const title of p.seedTitles)seedResolved.push(await qloo.resolveBook(title));
        const insights=await qloo.recommendBooks(seedResolved.map(x=>x.qloo_id));
        result=planBooks(p,insights);
        result.provenance.resolved_seed_ids=seedResolved;
      }
      reply(res,200,result);return;
    }
    reply(res,404,{error:'NOT_FOUND',message:'Unknown endpoint'});
  }catch(e){
    const code=e.code??'INTERNAL_ERROR';const safe=e instanceof InputError||e instanceof UpstreamError;
    reply(res,e instanceof InputError?400:e instanceof UpstreamError?503:500,{error:code,message:safe?e.message:'Unexpected server failure'});
  }
};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT??3000);
 if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('PORT must be 1..65535');
 http.createServer(createHandler()).listen(port,'0.0.0.0',()=>console.log(`ShelfConductor: http://localhost:${port}`));
}
