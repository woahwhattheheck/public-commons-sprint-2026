// MIT. Private industrial browser surface over the same WFS application.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { atomicJson, withPrivateLock } from '../routescan/quota.mjs';
import { openWfsApplication } from './application.mjs';
import { need, plain, jsonBytes, hash, LIMITS } from './model.mjs';
import { durableDirectory, optionalJson } from './source.mjs';

const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
function send(response,status,value,type='application/json; charset=utf-8',name){
  const bytes=Buffer.isBuffer(value)?value:jsonBytes(value);
  response.writeHead(status,{...headers,'content-type':type,'content-length':bytes.length,
    ...(name?{'content-disposition':'attachment; filename="'+name.replace(/[^A-Za-z0-9_.-]/g,'_')+'"'}:{})});
  response.end(bytes);
}
async function requestBody(request){
  need(/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''),'Use complete JSON.','WFS_JSON_REQUIRED',415);
  const stated=request.headers['content-length'];
  need(stated===undefined||/^\d+$/.test(stated)&&Number(stated)<=LIMITS.projectBytes,
    'Request exceeds the complete project capacity.','WFS_REQUEST_TOO_LARGE',413);
  const chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;need(size<=LIMITS.projectBytes,'Request exceeds the complete project capacity.','WFS_REQUEST_TOO_LARGE',413);chunks.push(chunk);}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));
}
export async function retainWfsConnection(path,startup){
  path=resolve(path);
  need(startup?.schema==='stellar-forge.wfs-workspace-startup.v1'&&startup.state==='LISTENING','Retain the actual original application startup.');
  const parent=await durableDirectory(dirname(path));
  return withPrivateLock(parent,basename(path)+'.lock',async()=>{
    const previous=await optionalJson(path,131072);
    need(!previous||previous.schema==='stellar-forge.wfs-workspace-connection.v1'&&
      previous.startup.binding.sha256===startup.binding.sha256,'This connection file belongs to another project/operator selection.','WFS_CONNECTION_CHANGED',409);
    const value={schema:'stellar-forge.wfs-workspace-connection.v1',startup,
      previousInstance:previous?.startup.instanceId===startup.instanceId?previous.previousInstance:previous?.startup.instanceId??null};
    await atomicJson(parent,basename(path),value);return value;
  });
}
export async function startWfsWorkspace(options={}){
  const port=options.port??0;need(Number.isInteger(port)&&port>=0&&port<=65535,'Choose an available loopback port.');
  const token=randomBytes(32).toString('hex'),assets=new Map();
  for(const [route,name,type] of [['/','index.html','text/html; charset=utf-8'],
    ['/app.js','app.js','text/javascript; charset=utf-8'],['/style.css','style.css','text/css; charset=utf-8']]){
    assets.set(route,{bytes:await readFile(new URL('./ui/'+name,import.meta.url)),type});
  }
  const owned=!options.application,application=options.application??await openWfsApplication(options);
  let origin,closing=false,closePromise;
  const server=createServer((request,response)=>{
    (async()=>{
      need(!closing,'The original browser session is closing.','WFS_BROWSER_CLOSING',503);
      need(request.headers.host===new URL(origin).host&&(!request.headers.origin||request.headers.origin===origin),
        'Use the original private loopback origin.','WFS_LOCAL_ORIGIN_REQUIRED',403);
      const url=new URL(request.url,origin),asset=assets.get(url.pathname);
      if(request.method==='GET'&&asset&&!url.search)return send(response,200,asset.bytes,asset.type);
      const expected='Bearer '+token,supplied=request.headers.authorization;
      need(typeof supplied==='string'&&Buffer.byteLength(supplied)===expected.length&&
        timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)),'Use the original private browser session.','WFS_SESSION_REQUIRED',403);
      if(request.method==='GET'&&url.pathname==='/api/state')return send(response,200,await application.query('state'));
      if(request.method==='GET'&&url.pathname==='/api/launch')return send(response,200,{...application.startup(),url:origin+'/#'+token});
      if(request.method==='POST'&&url.pathname==='/api/query'){
        const body=await requestBody(request);need(plain(body)&&typeof body.kind==='string'&&Object.keys(body).every(k=>['kind','input'].includes(k)),'Select an application read.');
        return send(response,200,await application.query(body.kind,body.input??{}));
      }
      if(request.method==='POST'&&url.pathname==='/api/action')return send(response,200,await application.action(await requestBody(request)));
      if(request.method==='POST'&&url.pathname==='/api/cancel'){
        const body=await requestBody(request);need(plain(body)&&Object.keys(body).length===1&&typeof body.id==='string','Select the exact running action.');
        return send(response,200,application.cancel(body.id));
      }
      if(request.method==='POST'&&url.pathname==='/api/download'){
        const body=await requestBody(request);need(plain(body)&&Object.keys(body).every(k=>['kind','input'].includes(k)),'Select an original complete file.');
        const file=await application.download(body.kind,body.input??{});
        response.setHeader('x-content-sha256',hash(file.bytes));return send(response,200,file.bytes,file.type,file.name);
      }
      send(response,404,{code:'WFS_ROUTE_UNKNOWN',message:'Application route not found.'});
    })().catch(error=>{
      if(!response.writableEnded&&!response.destroyed)send(response,Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:400,
        {code:error.code??'WFS_APPLICATION_ERROR',message:String(error.message).slice(0,4096),...(error.retryAt?{retryAt:error.retryAt}:{})});
    });
  });
  server.headersTimeout=10000;server.requestTimeout=120000;server.keepAliveTimeout=1000;
  try{await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});}
  catch(error){if(owned)await application.close();throw error;}
  origin=new URL('http://127.0.0.1:'+server.address().port).origin;
  const startup={...application.startup(),url:origin+'/#'+token};
  const session={server,application,origin,url:startup.url,startup,
    close(){return closePromise??=(async()=>{
      closing=true;
      const listener=new Promise((done,reject)=>{server.close(error=>error?reject(error):done());server.closeIdleConnections?.();});
      const results=await Promise.allSettled([owned?Promise.resolve().then(()=>application.close()):Promise.resolve(),listener]);
      const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
    })();}};
  if(options.connectionFile)try{await retainWfsConnection(options.connectionFile,startup);}catch(error){await session.close();throw error;}
  return session;
}
