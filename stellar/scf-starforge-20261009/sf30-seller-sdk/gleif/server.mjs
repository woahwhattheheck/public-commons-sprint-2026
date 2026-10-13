// SPDX-License-Identifier: MIT
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readBrowserAssets } from '../../distribution/browser-assets.mjs';
import { privateDirectory, atomicJson, identity } from '../postgres/publisher/files.mjs';
import { SCHEMA, need } from './core.mjs';
const MAX=256*1024*1024;
async function body(request) {
  need(/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''),'GLEIF_JSON_REQUIRED','Send JSON.',415);
  const parts=[];let count=0;
  for await(const part of request){count+=part.length;need(count<=MAX,'GLEIF_REQUEST_TOO_LARGE','Use a source package within 256 MiB.',413);parts.push(part);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch(error){if(error.code)throw error;need(false,'GLEIF_JSON_REQUIRED','The request JSON is invalid.');}
}
export async function startGleifServer({workspace,port=0,sourceIdentity,connectionFile=join(workspace.directory,'connection.json')}={}) {
  need(workspace&&Number.isInteger(port)&&port>=0&&port<=65535,'GLEIF_SERVER');
  const token=randomBytes(32).toString('base64url'),instanceId=randomUUID(),assets=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url));
  let origin,closing=null,draining=false;const tasks=new Set();
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'x-gleif-instance':instanceId};
  const send=(res,status,value)=>{const data=Buffer.from(JSON.stringify(value));res.writeHead(status,{...headers,'content-type':'application/json; charset=utf-8','content-length':data.length});res.end(data);};
  const identityValue=()=>({schema:SCHEMA+'.identity',workspaceId:workspace.metadata.id,workspaceIdentity:identity(workspace.metadata),instanceId,sourceIdentity});
  const authenticate=req=>{const provided=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
    const a=Buffer.from(provided),b=Buffer.from(token);need(a.length===b.length&&timingSafeEqual(a,b),'GLEIF_AUTH','Open the private application URL.',403);};
  const server=createServer((req,res)=>{
    const task=(async()=>{
      try{
        need(!draining,'GLEIF_CLOSING','The project is closing.',503);
        need(req.headers.host===new URL(origin).host,'GLEIF_HOST','Use the original local application URL.',403);
        if(req.headers.origin)need(req.headers.origin===origin,'GLEIF_ORIGIN','Use the original local application.',403);
        const url=new URL(req.url,origin),path=url.pathname;
        if(req.method==='GET'&&assets.has(path)){const asset=assets.get(path),data=await readFile(asset.url);res.writeHead(200,{...headers,'content-type':asset.type,'content-length':data.length});res.end(data);return;}
        authenticate(req);
        if(req.method==='GET'&&path==='/api/identity'){send(res,200,identityValue());return;}
        if(req.method==='GET'&&path==='/api/status'){send(res,200,workspace.status());return;}
        if(req.method==='GET'&&path==='/api/compare'){send(res,200,await workspace.compare(url.searchParams.get('before'),url.searchParams.get('after')));return;}
        if(req.method==='GET'&&path==='/api/package'){const pkg=await workspace.portable();res.setHeader('content-disposition','attachment; filename="gleif-project.json"');send(res,200,pkg);return;}
        let match;
        if(req.method==='GET'&&(match=path.match(/^\/api\/captures\/([A-Za-z0-9._-]+)\/rows$/))){send(res,200,await workspace.rows(match[1],{offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??50),search:url.searchParams.get('search')??''}));return;}
        if(req.method==='GET'&&(match=path.match(/^\/api\/captures\/([A-Za-z0-9._-]+)$/))){send(res,200,await workspace.entities(match[1]));return;}
        if(req.method==='GET'&&(match=path.match(/^\/api\/operations\/([A-Za-z0-9._-]+)$/))){send(res,200,workspace.operation(match[1]));return;}
        if(req.method==='GET'&&(match=path.match(/^\/api\/datasets\/([A-Za-z0-9._-]+)\/query$/))){const result=await workspace.datasetQuery(match[1],url.search.slice(1));send(res,result.status,result.body);return;}
        if(req.method==='GET'&&(match=path.match(/^\/api\/objects\/([a-f0-9]{64})$/))){
          const data=await workspace.object(match[1]);const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??data.length);
          need(Number.isSafeInteger(offset)&&offset>=0&&offset<=data.length&&Number.isSafeInteger(limit)&&limit>=0&&limit<=MAX,'GLEIF_FILE_RANGE');
          if(url.searchParams.has('offset')||url.searchParams.has('limit')){const selected=data.subarray(offset,Math.min(offset+limit,data.length));send(res,200,{sha256:match[1],bytes:data.length,offset,returned:selected.length,nextOffset:offset+selected.length<data.length?offset+selected.length:null,base64:selected.toString('base64')});return;}
          res.writeHead(200,{...headers,'content-type':'application/octet-stream','content-length':data.length,'x-content-sha256':match[1],
            'content-disposition':'attachment; filename="'+match[1]+'.bin"'});res.end(data);return;
        }
        if(req.method==='POST'&&path==='/api/package-file'){await body(req);send(res,200,await workspace.packageFile());return;}
        if(req.method==='POST'&&path==='/api/monitoring-preview'){send(res,200,await workspace.monitoringPreview(await body(req)));return;}
        if(req.method==='POST'&&path==='/api/start'){send(res,202,await workspace.start(await body(req)));return;}
        if(req.method==='POST'&&(match=path.match(/^\/api\/pause\/([A-Za-z0-9._-]+)$/))){await body(req);send(res,200,await workspace.pause(match[1]));return;}
        need(false,'GLEIF_ROUTE','Choose an available project operation.',404);
      }catch(error){if(res.headersSent){res.destroy();return;}send(res,error.status??400,{error:error.code??'GLEIF_REQUEST_FAILED',message:error.message,notBefore:error.notBefore??null});}
    })();tasks.add(task);task.finally(()=>tasks.delete(task)).catch(()=>{});
  });
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
    origin='http://127.0.0.1:'+server.address().port;
    const connection={schema:SCHEMA+'.connection',origin,token,instanceId,workspaceId:workspace.metadata.id,workspaceIdentity:identity(workspace.metadata),sourceIdentity};
    await privateDirectory(dirname(connectionFile));await atomicJson(dirname(connectionFile),connectionFile.slice(dirname(connectionFile).length+1),connection);
    return {schema:SCHEMA+'.startup',state:'READY',workspaceId:workspace.metadata.id,workspaceIdentity:connection.workspaceIdentity,instanceId,sourceIdentity,
      connectionFile,url:origin+'/#token='+token,
      async close(){if(closing)return closing;draining=true;closing=(async()=>{
        server.closeIdleConnections?.();const stopped=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
        await workspace.close();await Promise.allSettled([...tasks]);server.closeAllConnections?.();await stopped;
      })();return closing;}};
  }catch(error){server.closeAllConnections?.();server.close();await workspace.close();throw error;}
}
