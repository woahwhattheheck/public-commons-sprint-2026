// SPDX-License-Identifier: MIT
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { openGraviteeWorkspace } from './workspace.mjs';
import { requireValue,publicError } from './contract.mjs';
const ASSETS=new Map([
  ['/',['./web/index.html','text/html; charset=utf-8']],
  ['/browser.mjs',['./web/browser.mjs','text/javascript; charset=utf-8']],
  ['/style.css',['./web/style.css','text/css; charset=utf-8']],
  ['/client.mjs',['./client.mjs','text/javascript; charset=utf-8']],
]);
export async function startGraviteeServer({directory,port=0,environment=process.env,fetch=globalThis.fetch,workspace}={}) {
  requireValue(Number.isSafeInteger(port)&&port>=0&&port<=65535,'PORT_INVALID');
  const model=workspace??await openGraviteeWorkspace({directory,environment,fetch}),token=randomBytes(32).toString('hex');
  let origin=null,closing=false;const handlers=new Set();
  const assetBodies=new Map();for(const [path,[file,type]]of ASSETS)assetBodies.set(path,{bytes:await readFile(new URL(file,import.meta.url)),type});
  function authenticate(request){
    const supplied=Buffer.from(String(request.headers['x-workspace-token']??'')),expected=Buffer.from(token);
    requireValue(supplied.length===expected.length&&timingSafeEqual(supplied,expected),'WORKSPACE_ACCESS_REQUIRED','Open the original workspace link.',401);
    if(request.headers['x-workspace-id'])requireValue(request.headers['x-workspace-id']===model.workspaceId,'WORKSPACE_ID_CHANGED','The requested workspace differs from this process.',409);
  }
  async function readBody(request){
    requireValue(String(request.headers['content-type']??'').split(';')[0]==='application/json','JSON_REQUEST_REQUIRED',undefined,415);
    const chunks=[];let length=0;for await(const chunk of request){length+=chunk.length;requireValue(length<=256*1024*1024,'REQUEST_TOO_LARGE',undefined,413);chunks.push(chunk);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const headers=response=>{
    response.setHeader('cache-control','no-store');
    response.setHeader('x-content-type-options','nosniff');
    response.setHeader('referrer-policy','no-referrer');
    response.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    response.setHeader('cross-origin-resource-policy','same-origin');
  };
  const reply=(response,status,value)=>{
    if(response.destroyed)return;headers(response);response.writeHead(status,{'content-type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));
  };
  const server=createServer((request,response)=>{
    const task=(async()=>{
      try{
        requireValue(!closing,'WORKSPACE_CLOSING',undefined,503);
        requireValue(origin&&request.headers.host===new URL(origin).host,'WORKSPACE_HOST_INVALID','Use this local workspace origin.',403);
        requireValue(!request.headers.origin||request.headers.origin===origin,'WORKSPACE_ORIGIN_INVALID',undefined,403);
        const url=new URL(request.url,origin);
        const asset=assetBodies.get(url.pathname);
        if(asset&&request.method==='GET'){headers(response);response.writeHead(200,{'content-type':asset.type,'content-length':asset.bytes.length});response.end(asset.bytes);return;}
        authenticate(request);
        if(url.pathname==='/api/action'&&request.method==='POST'){
          const input=await readBody(request);const result=await model.action(input.method,input.input??{});
          reply(response,200,{ok:true,result});return;
        }
        if(url.pathname==='/api/object'&&request.method==='GET'){
          const reference={sha256:url.searchParams.get('sha256'),bytes:Number(url.searchParams.get('bytes'))};
          const saved=await model.action('readObject',{reference}),bytes=Buffer.from(saved.base64,'base64');
          headers(response);response.writeHead(200,{'content-type':'application/octet-stream','content-length':bytes.length,
            'content-disposition':'attachment; filename="gravitee-'+reference.sha256.slice(0,12)+'.json"'});response.end(bytes);return;
        }
        reply(response,404,{ok:false,error:{code:'ROUTE_NOT_FOUND',message:'This workspace route does not exist.'}});
      }catch(error){reply(response,Number.isInteger(error.status)?error.status:500,{ok:false,error:publicError(error)});}
    })();handlers.add(task);task.then(()=>handlers.delete(task),()=>handlers.delete(task));
  });
  server.requestTimeout=0;server.headersTimeout=30000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;
  let shutdown;
  async function close(){if(shutdown)return shutdown;closing=true;shutdown=(async()=>{
    const listening=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await Promise.allSettled([...handlers]);await model.close();server.closeIdleConnections();await listening;
  })();return shutdown;}
  return{url:origin+'/#'+token,origin,workspaceId:model.workspaceId,model,close};
}
