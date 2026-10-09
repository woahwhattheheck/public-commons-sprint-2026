import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {makeAgent} from './agent.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url));
const clients=new Map(); // Separate demo visitors; bounded map, no persistence or credentials.
const LIMIT=100;
function respond(res,status,body,extra={}){
  res.writeHead(status,{'cache-control':'no-store','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',...extra});
  res.end(JSON.stringify(body));
}
function session(req,res){
  const raw=(req.headers.cookie||'').match(/(?:^|;\s*)gridkind_sid=([a-f0-9-]{36})(?:;|$)/)?.[1];
  const current=raw&&clients.get(raw);
  if(current){clients.delete(raw);clients.set(raw,current);return current;}
  if(clients.size>=LIMIT)clients.delete(clients.keys().next().value);
  const id=randomUUID();const next=makeAgent();clients.set(id,next);
  res.setHeader('set-cookie',`gridkind_sid=${id}; HttpOnly; SameSite=Strict; Path=/`);
  return next;
}
async function readBody(req){
  const chunks=[];let bytes=0;
  for await (const chunk of req){bytes+=chunk.length;if(bytes>12000)throw Error('JSON body too large');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
}
export function start({port=Number(process.env.PORT||'4181'),host=process.env.HOST||'127.0.0.1'}={}){
  const server=http.createServer(async(req,res)=>{
    try{
      const path=new URL(req.url,'http://localhost').pathname;
      if(req.method==='GET'&&['/','/app.js'].includes(path)){
        const file=path==='/'?'index.html':'app.js';
        res.writeHead(200,{'content-type':path==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
        return res.end(await readFile(join(ROOT,file)));
      }
      if(!path.startsWith('/api/'))return respond(res,404,{error:'Not found'});
      const agent=session(req,res);
      if(req.method==='GET'&&path==='/api/state')return respond(res,200,agent.view());
      if(req.method!=='POST'||path!=='/api/action')return respond(res,405,{error:'Unsupported operation'});
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return respond(res,403,{error:'Cross-origin disabled'});
      const {action,id,command,input}=await readBody(req);
      const operations={propose:()=>agent.offer(input),approve:()=>agent.approve(id),execute:()=>agent.execute(id),cancel:()=>agent.cancel(),say:()=>agent.say(command)};
      if(!Object.hasOwn(operations,action))throw Error('Unknown action');
      return respond(res,200,operations[action]());
    }catch(e){return respond(res,400,{error:e instanceof Error?e.message:'Invalid request'});}
  });
  server.listen(port,host,()=>console.log(`GridKind simulated Alexa+ agent listening on http://${host}:${server.address().port}`));
  return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])start();
