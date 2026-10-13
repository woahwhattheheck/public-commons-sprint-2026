// MIT. Private customer UI and one HTTP surface over the original Tyk workspace owner.
import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { openTykWorkspace } from './model.mjs';
import { TYK_WORKSPACE_ACTIONS, TYK_MAX_JSON_BYTES, validateTykAction } from './actions.mjs';
import { need } from '../../../distribution/runtime-workspace/storage.mjs';
export { TYK_WORKSPACE_ACTIONS } from './actions.mjs';

const equal = (a,b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const codeOf = error => typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,120}$/.test(error.code) ?
  error.code : 'TYK_WORKSPACE_REQUEST_FAILED';
function send(res,status,value) {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(value)+'\n');
}
async function jsonBody(req) {
  const chunks = []; let bytes=0;
  for await (const chunk of req) {
    bytes += chunk.length;
    need(bytes <= TYK_MAX_JSON_BYTES,'TYK_JSON_TOO_LARGE','The complete JSON request exceeds 128 MiB.',413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); }
  catch { throw Object.assign(new Error('Use a complete UTF-8 JSON request.'),{code:'TYK_JSON_REQUIRED',status:400}); }
}
async function streamOriginal(res,file,signal) {
  const handle = await open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const first=await handle.stat();
    need(first.isFile() && first.size===file.bytes,'TYK_DOWNLOAD_CHANGED');
    res.writeHead(200,{'content-type':file.mediaType??'application/octet-stream',
      'content-length':String(file.bytes),'x-content-sha256':file.sha256,
      'content-disposition':'attachment; filename="'+file.filename+'"',
      'x-workspace-file-sha256':file.sha256});
    async function* chunks() {
      const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let position=0;
      while(position<first.size) {
        signal.throwIfAborted();
        const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,first.size-position),position);
        need(bytesRead>0,'TYK_DOWNLOAD_TRUNCATED');
        const chunk=Buffer.from(buffer.subarray(0,bytesRead));hash.update(chunk);position+=bytesRead;yield chunk;
      }
      const last=await handle.stat();
      need(first.dev===last.dev && first.ino===last.ino && first.size===last.size &&
        first.mtimeMs===last.mtimeMs && first.ctimeMs===last.ctimeMs && hash.digest('hex')===file.sha256,
        'TYK_DOWNLOAD_CHANGED');
    }
    await pipeline(chunks(),res,{signal});
  } finally { await handle.close(); }
}
export async function startTykWorkspaceServer({
  directory,connections=[],environment=process.env,fetch=globalThis.fetch,signal,
  hostname='127.0.0.1',port=0,workspace,timeoutMs=120000,maximumResponseBytes=64*1024*1024,
}={}) {
  need(hostname==='127.0.0.1' && Number.isSafeInteger(port) && port>=0 && port<=65535,
    'TYK_WORKSPACE_LOOPBACK_REQUIRED','Use a private loopback listener and a valid port.');
  const declared=JSON.parse(await readFile(new URL('./browser-assets.json',import.meta.url),'utf8'));
  need(declared.schema==='stellar-forge.browser-assets.v1' && declared.root==='./' &&
    Array.isArray(declared.routes),'TYK_BROWSER_ASSETS_INVALID');
  const allowed=new Map([['/','index.html'],['/browser.mjs','browser.mjs'],['/style.css','style.css'],['/actions.mjs','actions.mjs'],['/commissioning-browser.mjs','commissioning-browser.mjs'],['/browser-request-store.mjs','browser-request-store.mjs']]);
  const assets=new Map();
  for(const [route,[filename,type]] of declared.routes) {
    need(allowed.get(route)===filename && !assets.has(route),'TYK_BROWSER_ASSETS_INVALID');
    assets.set(route,{bytes:await readFile(new URL('./'+filename,import.meta.url)),type});
  }
  need(assets.size===allowed.size,'TYK_BROWSER_ASSETS_MISSING');
  const owns=workspace===undefined;
  const model=workspace??await openTykWorkspace({directory,connections,environment,fetch,signal,timeoutMs,maximumResponseBytes});
  const token=randomBytes(32).toString('hex'),pending=new Set(),requests=new Set();
  const cookieName='tyk_download_'+model.workspaceId.replaceAll('-','');
  let origin,closing=false,closed=false,closePromise,listenerClosed=false;
  const cookieToken=req=>String(req.headers.cookie??'').split(';').map(part=>part.trim())
    .find(part=>part.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  async function respond(req,res) {
    const abort=new AbortController();requests.add(abort);
    const onClosed=()=>{if(!res.writableFinished)abort.abort(Object.assign(new Error('Original HTTP client disconnected.'),{code:'TYK_CLIENT_DISCONNECTED'}));};
    res.once('close',onClosed);
    res.setHeader('cache-control','no-store');
    res.setHeader('x-content-type-options','nosniff');
    res.setHeader('referrer-policy','no-referrer');
    res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    try {
      need(!closing,'TYK_WORKSPACE_CLOSING','The workspace is closing.',503);
      need(req.headers.host===new URL(origin).host && (!req.headers.origin || req.headers.origin===origin),
        'TYK_WORKSPACE_ORIGIN_REQUIRED','Use the original private workspace origin.',403);
      const url=new URL(req.url,origin);
      need(url.origin===origin && !url.username && !url.password,'TYK_WORKSPACE_ORIGIN_REQUIRED',undefined,403);
      if(assets.has(url.pathname)) {
        need(req.method==='GET','TYK_METHOD_REQUIRED',undefined,405);
        const asset=assets.get(url.pathname);res.writeHead(200,{'content-type':asset.type});res.end(asset.bytes);return;
      }
      need(url.pathname.startsWith('/api/'),'TYK_ROUTE_NOT_FOUND',undefined,404);
      const download=req.method==='GET' && ['/api/delivery','/api/source'].includes(url.pathname);
      need(equal(req.headers['x-workspace-token'],token) || download && equal(cookieToken(req),token),
        'TYK_WORKSPACE_TOKEN_REQUIRED','Open the original private workspace link.',401);
      need(!req.headers['x-workspace-id'] || equal(req.headers['x-workspace-id'],model.workspaceId),
        'TYK_WORKSPACE_ID_CHANGED','This connection now identifies another workspace.',409);
      if(equal(req.headers['x-workspace-token'],token))
        res.setHeader('set-cookie',cookieName+'='+token+'; Path=/api/; HttpOnly; SameSite=Strict');
      let result;
      if(req.method==='GET') {
        if(url.pathname==='/api/workspace') result=await model.view();
        else if(url.pathname==='/api/records') {
          const args={};
          for(const key of ['kind','snapshot']) if(url.searchParams.has(key))args[key]=url.searchParams.get(key);
          for(const key of ['offset','limit'])if(url.searchParams.has(key))args[key]=Number(url.searchParams.get(key));
          validateTykAction('listRecords',args);result=await model.listRecords(args);
        } else if(url.pathname==='/api/record') {
          const args={kind:url.searchParams.get('kind'),id:url.searchParams.get('id')};
          for(const key of ['revision','offset','limit'])if(url.searchParams.has(key))args[key]=Number(url.searchParams.get(key));
          validateTykAction('getRecord',args);result=await model.getRecord(args);
        } else if(url.pathname==='/api/delivery') {
          await streamOriginal(res,await model.deliveryFile({id:url.searchParams.get('id')}),abort.signal);return;
        } else if(url.pathname==='/api/source') {
          const reference={sha256:url.searchParams.get('sha256'),bytes:Number(url.searchParams.get('bytes')),
            mediaType:'application/octet-stream'};
          validateTykAction('readSource',{reference});
          await streamOriginal(res,await model.sourceFile({reference}),abort.signal);return;
        } else need(false,'TYK_ROUTE_NOT_FOUND',undefined,404);
      } else {
        need(req.method==='POST','TYK_METHOD_REQUIRED',undefined,405);
        need(equal(req.headers.origin,origin),'TYK_WORKSPACE_ORIGIN_REQUIRED',undefined,403);
        if(url.pathname==='/api/delivery/inspect') {
          need(/^application\/octet-stream(?:;.*)?$/i.test(req.headers['content-type']??''),
            'TYK_DELIVERY_CONTENT_TYPE_REQUIRED',undefined,415);
          let filename;
          try { filename = req.headers['x-delivery-name'] ? decodeURIComponent(req.headers['x-delivery-name']) : 'Imported workspace handover'; }
          catch { need(false,'TYK_DELIVERY_NAME_INVALID','Use a UTF-8 encoded delivery filename.',400); }
          need(typeof filename === 'string' && filename.trim() && filename.length <= 300 &&
            !/[\u0000-\u001f\u007f]/.test(filename),'TYK_DELIVERY_NAME_INVALID',undefined,400);
          const uploadRequestId = req.headers['x-request-id'];
          need(typeof uploadRequestId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(uploadRequestId),
            'TYK_REQUEST_ID_INVALID',undefined,400);
          const onAbort=()=>req.destroy(abort.signal.reason);
          abort.signal.addEventListener('abort',onAbort,{once:true});
          try {
            result=await model.stageDelivery(req,{requestId:uploadRequestId,filename});
          } finally {abort.signal.removeEventListener('abort',onAbort);}
        } else {
          need(url.pathname==='/api/action','TYK_ROUTE_NOT_FOUND',undefined,404);
          need(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''),
            'TYK_JSON_REQUIRED',undefined,415);
          const input=await jsonBody(req);
          need(input && typeof input==='object' && Object.keys(input).every(key=>['method','args'].includes(key)),
            'TYK_ACTION_INPUT_INVALID');
          validateTykAction(input.method,input.args??{});
          result=await model[input.method]({...input.args,signal:abort.signal});
        }
      }
      if(!res.destroyed)send(res,200,result);
    } catch(error) {
      if(!res.headersSent && !res.destroyed)send(res,
        Number.isInteger(error.status) && error.status>=400 && error.status<=599?error.status:error.code==='ENOENT'?404:
          typeof error.code==='string' && /^TYK_.*(?:INVALID|REQUIRED|UNSUPPORTED|MISMATCH|CHANGED|CONFLICT|ABSENT)$/.test(error.code)?400:500,
        {error:codeOf(error),message:String(error.message??'The original workspace request could not finish.').slice(0,2000),
          ...(error.recordId?{recordId:error.recordId}:{})});
      else res.destroy();
    } finally {
      requests.delete(abort);res.off('close',onClosed);
    }
  }
  const server=createServer((req,res)=>{
    const task=respond(req,res);pending.add(task);
    task.then(()=>pending.delete(task),()=>pending.delete(task));
  });
  server.requestTimeout=0;server.headersTimeout=15000;server.maxHeadersCount=60;
  try {
    await new Promise((done,reject)=>{
      const failed=error=>{server.off('listening',listening);reject(error);};
      const listening=()=>{server.off('error',failed);origin='http://127.0.0.1:'+server.address().port;done();};
      server.once('error',failed);server.once('listening',listening);server.listen(port,hostname);
    });
  } catch(error) {if(owns)await model.close();throw error;}
  async function close() {
    if(closed)return;
    if(closePromise)return closePromise;
    closing=true;
    for(const request of requests)request.abort(Object.assign(new Error('Workspace server close requested.'),{code:'TYK_WORKSPACE_CLOSING'}));
    closePromise=(async()=>{
      const listener=listenerClosed?Promise.resolve():new Promise((done,reject)=>{
        server.close(error=>{
          if(error && error.code!=='ERR_SERVER_NOT_RUNNING')reject(error);
          else {listenerClosed=true;done();}
        });
        server.closeIdleConnections();
      });
      const ownedClose=owns?model.close():Promise.resolve();
      await Promise.allSettled([...pending]);
      server.closeAllConnections();
      const settled=await Promise.allSettled([listener,ownedClose]);
      const failure=settled.find(item=>item.status==='rejected');
      if(failure)throw failure.reason;
      closed=true;
    })().catch(error=>{closePromise=undefined;throw error;});
    return closePromise;
  }
  return Object.freeze({origin,url:origin+'/#'+token,port:server.address().port,
    workspaceId:model.workspaceId,directory:model.directory,workspace:model,close});
}
