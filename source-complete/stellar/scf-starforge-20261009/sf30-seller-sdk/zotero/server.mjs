// MIT. Authenticated loopback operator and owned independent receivers.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {privateDirectory,readJson,writeJson} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {SCHEMA,LIMIT,need,plain,parse,json,sha256,requestId,safeCode,safeFilename} from './contracts.mjs';
import {openZoteroWorkspace,receiveWorkspace} from './workspace.mjs';

const PUBLIC=fileURLToPath(new URL('./public/',import.meta.url));
const ASSETS={'/':'index.html','/app.mjs':'app.mjs','/style.css':'style.css'};
const TYPES={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
async function body(req,limit) {
  const length=req.headers['content-length'];
  if(length!==undefined)need(/^[0-9]+$/.test(length)&&Number(length)<=limit,'ZOTERO_HTTP_BODY_LIMIT');
  need((req.headers['content-type']??'').split(';')[0]==='application/json','ZOTERO_HTTP_JSON_REQUIRED');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;need(size<=limit,'ZOTERO_HTTP_BODY_LIMIT');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
const reply=(res,status,value)=>{const bytes=json(value);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);};
const download=(res,value)=>{
  const bytes=Buffer.from(value.bytes);safeFilename(value.filename);
  res.writeHead(200,{'Content-Type':value.mediaType??'application/json','Content-Length':bytes.length,
    'Content-Disposition':'attachment; filename="'+value.filename+'"','X-Content-SHA256':sha256(bytes),'Cache-Control':'no-store'});
  res.end(bytes);
};
export async function startZoteroWorkspace({directory,researchDirectory=null,dossierStore=null,port=0,connectionFile=null,fetchImpl,environment,transport=null}={}) {
  need(isAbsolute(directory)&&resolve(directory)===directory,'ZOTERO_ABSOLUTE_DIRECTORY_REQUIRED');
  need(Number.isInteger(port)&&port>=0&&port<=65535,'ZOTERO_PORT_INVALID');
  const workspace=await openZoteroWorkspace({directory,researchDirectory,dossierStore,fetchImpl,environment,transport});
  const instanceId=randomUUID(),token=randomBytes(32).toString('hex'),requests=new Set(),children=new Map(),opening=new Map();
  let server,origin,url,closing=false,closed,connectionPath=connectionFile??join(directory,'connection.json');
  try{
    need(isAbsolute(connectionPath)&&resolve(connectionPath)===connectionPath,'ZOTERO_CONNECTION_PATH_INVALID');
    const authenticate=req=>{
      need(req.headers.host===new URL(origin).host,'ZOTERO_HTTP_HOST_INVALID');
      need(!req.headers.origin||req.headers.origin===origin,'ZOTERO_HTTP_ORIGIN_INVALID');
      const actual=req.headers.authorization??'',expected='Bearer '+token;
      need(typeof actual==='string'&&Buffer.byteLength(actual)===Buffer.byteLength(expected)&&
        timingSafeEqual(Buffer.from(actual),Buffer.from(expected)),'ZOTERO_AUTH_REQUIRED');
    };
    async function openReceiver(name) {
      need(!closing,'ZOTERO_WORKSPACE_CLOSING');
      if(children.has(name)){const existing=children.get(name);if(existing.active)return existing;await existing.close();children.delete(name);}
      if(opening.has(name))return opening.get(name);
      need(!closing,'ZOTERO_WORKSPACE_CLOSING');
      const childDirectory=join(directory,'received',name);
      const work=(async()=>{
        const marker=await readJson(join(childDirectory,'receiving.json'));
        need(marker.status==='COMPLETE','ZOTERO_RECEIVING_INCOMPLETE');
        const child=await startZoteroWorkspace({directory:childDirectory,
          researchDirectory:marker.research?.length?join(childDirectory,'research'):null});
        if(closing){await child.close();throw Object.assign(new Error('ZOTERO_WORKSPACE_CLOSING'),{code:'ZOTERO_WORKSPACE_CLOSING'});}
        children.set(name,child);return child;
      })();opening.set(name,work);work.finally(()=>opening.delete(name)).catch(()=>{});return work;
    }
    async function route(req,res) {
      need(!closing,'ZOTERO_WORKSPACE_CLOSING');
      const parsed=new URL(req.url,'http://127.0.0.1');need(parsed.origin==='http://127.0.0.1','ZOTERO_HTTP_PATH_INVALID');
      const path=parsed.pathname;
      need(req.headers.host===new URL(origin).host,'ZOTERO_HTTP_HOST_INVALID');
      if(req.method==='GET'&&path==='/health')return reply(res,200,{schema:SCHEMA.connection,instanceId,
        workspaceId:workspace.identity.workspaceId,active:true});
      if(req.method==='GET'&&Object.hasOwn(ASSETS,path)){
        const asset=ASSETS[path],bytes=await readFile(join(PUBLIC,asset));
        res.writeHead(200,{'Content-Type':TYPES[asset.slice(asset.lastIndexOf('.'))],'Content-Length':bytes.length,
          'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
          'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(bytes);return;
      }
      authenticate(req);
      if(req.method==='GET'&&path==='/api/state')return reply(res,200,await workspace.snapshot());
      if(req.method==='POST'&&path==='/api/invoke'){
        const value=parse(await body(req,LIMIT.control));need(!closing,'ZOTERO_WORKSPACE_CLOSING');need(plain(value)&&typeof value.method==='string'&&plain(value.input??{}),'ZOTERO_HTTP_INVOKE_INVALID');
        return reply(res,200,await workspace.invoke(value.method,value.input??{},value.requestId??null));
      }
      if(req.method==='POST'&&path==='/api/import'){
        const bytes=await body(req,LIMIT.transfer),op=requestId(req.headers['x-zotero-request-id']);need(!closing,'ZOTERO_WORKSPACE_CLOSING');
        const input={profileId:parsed.searchParams.get('profileId'),profileRevision:Number(parsed.searchParams.get('profileRevision')),bytes};
        return reply(res,200,await workspace.invoke('documents.import',input,op));
      }
      if(req.method==='GET'&&path==='/api/download'){
        const input={kind:parsed.searchParams.get('kind'),id:parsed.searchParams.get('id'),
          role:parsed.searchParams.get('role'),name:parsed.searchParams.get('name')};
        if(parsed.searchParams.has('revision'))input.revision=Number(parsed.searchParams.get('revision'));
        return download(res,await workspace.download(input));
      }
      if(req.method==='GET'&&path==='/api/export'){
        return download(res,await workspace.exportWorkspace(requestId(parsed.searchParams.get('requestId'))));
      }
      if(req.method==='POST'&&path==='/api/receive'){
        const name=safeFilename(parsed.searchParams.get('name'));need(!name.includes('.'),'ZOTERO_RECEIVER_NAME_INVALID');
        const op=requestId(req.headers['x-zotero-request-id']),bytes=await body(req,LIMIT.transfer);
        await privateDirectory(join(directory,'received'));need(!closing,'ZOTERO_WORKSPACE_CLOSING');
        const childDirectory=join(directory,'received',name),activeChild=children.get(name);
        let receipt;
        if(activeChild?.active){
          const marker=await readJson(join(childDirectory,'receiving.json'));
          need(marker.status==='COMPLETE'&&marker.requestId===op&&marker.packetSha256===sha256(bytes)&&
            marker.workspaceId===activeChild.workspace.identity.workspaceId,'ZOTERO_RECEIVING_INPUT_CHANGED');
          receipt={...marker,replayed:true};
        }else receipt=await receiveWorkspace(bytes,{directory:childDirectory,requestId:op});
        const child=await openReceiver(name);
        return reply(res,200,{receipt,name,connection:{schema:SCHEMA.connection,instanceId:child.instanceId,
          workspaceId:child.workspace.identity.workspaceId,url:child.url,active:true}});
      }
      if(req.method==='POST'&&path==='/api/receiver/open'){
        const value=parse(await body(req,LIMIT.control)),name=safeFilename(value.name);need(!closing,'ZOTERO_WORKSPACE_CLOSING');
        need(!name.includes('.'),'ZOTERO_RECEIVER_NAME_INVALID');
        const child=await openReceiver(name);
        return reply(res,200,{name,connection:{schema:SCHEMA.connection,instanceId:child.instanceId,
          workspaceId:child.workspace.identity.workspaceId,url:child.url,active:true}});
      }
      if(req.method==='POST'&&path==='/api/shutdown'){
        reply(res,200,{closing:true,instanceId});setImmediate(()=>close().catch(()=>{process.exitCode=1;}));return;
      }
      reply(res,404,{error:'ZOTERO_ROUTE_NOT_FOUND'});
    }
    server=createServer((req,res)=>{
      const promise=route(req,res).catch(error=>{
        if(!res.headersSent)reply(res,error.code==='ZOTERO_AUTH_REQUIRED'?401:
          error.code==='ZOTERO_REVISION_CONFLICT'||error.code==='ZOTERO_REQUEST_INPUT_CHANGED'?409:400,
          {error:safeCode(error),...(plain(error.details)?{details:error.details}: {})});
        else res.destroy();
      });
      requests.add(promise);promise.finally(()=>requests.delete(promise)).catch(()=>{});
    });
    server.requestTimeout=120000;server.headersTimeout=15000;server.keepAliveTimeout=1000;
    await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes();});});
    origin='http://127.0.0.1:'+server.address().port;url=origin+'/#token='+token;
    const connection={schema:SCHEMA.connection,mode:'ZOTERO_LIBRARY_WORKSPACE',instanceId,
      workspaceId:workspace.identity.workspaceId,directory,url,active:true};
    await writeJson(connectionPath,connection);
    async function close() {
      if(closed)return closed;closing=true;
      closed=(async()=>{
        const errors=[];
        const stopped=new Promise((yes,no)=>server.close(error=>error?no(error):yes()));
        server.closeIdleConnections?.();
        const timer=setTimeout(()=>server.closeAllConnections?.(),5000);timer.unref();
        const settled=await Promise.allSettled([...requests,...opening.values()]);
        errors.push(...settled.filter(r=>r.status==='rejected').map(r=>r.reason));
        for(const child of children.values()){try{await child.close();}catch(error){errors.push(error);}}
        try{await stopped;}catch(error){errors.push(error);}finally{clearTimeout(timer);}
        try{
          const current=await readJson(connectionPath);
          if(current.instanceId===instanceId)await writeJson(connectionPath,{...connection,url:origin+'/',active:false,closedAt:new Date().toISOString()});
        }catch(error){errors.push(error);}
        try{await workspace.close();}catch(error){errors.push(error);}
        if(errors.length)throw new AggregateError(errors,'ZOTERO_SERVER_CLOSE_FAILED');
      })();return closed;
    }
    return {workspace,instanceId,origin,url,connectionFile:connectionPath,get active(){return !closing;},close};
  }catch(error){server?.closeAllConnections?.();server?.close();await workspace.close().catch(()=>{});throw error;}
}
