// MIT. Local industrial operator UI and complete streamed delivery transport.
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { openInvoiceSettlementOperator } from './operator.mjs';
import { streamInvoiceDelivery, unpackInvoiceDelivery } from './archive.mjs';
import { need, plain, integer, identifier, selected, readDescriptor, privateDirectory } from './common.mjs';

const SOURCE_DIRECTORY=dirname(fileURLToPath(import.meta.url));
const ASSETS={'/':['web/index.html','text/html; charset=utf-8'],
  '/app.mjs':['web/app.mjs','text/javascript; charset=utf-8'],
  '/styles.css':['web/styles.css','text/css; charset=utf-8']};
const CSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
function headers(response,type='application/json; charset=utf-8'){
  response.setHeader('Content-Type',type);response.setHeader('Cache-Control','no-store');
  response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
  response.setHeader('Content-Security-Policy',CSP);response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
}
function json(response,status,value){
  const body=Buffer.from(JSON.stringify(value),'utf8');headers(response);response.statusCode=status;
  response.setHeader('Content-Length',body.length);response.end(body);
}
async function bytes(request,maximumBytes){
  const length=request.headers['content-length'];
  if(length!==undefined)need(/^\d+$/.test(length)&&Number(length)<=maximumBytes,'REQUEST_TOO_LARGE','The request exceeds the supported source size.');
  const chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;need(size<=maximumBytes,'REQUEST_TOO_LARGE','The request exceeds the supported source size.');chunks.push(chunk);}
  return Buffer.concat(chunks,size);
}
function statusFor(error){
  if(['PROGRAMME_VERSION_CONFLICT','REVISION_CONFLICT','CAPTURE_INFLIGHT','CAPTURE_RUN_ACTIVE','DELIVERY_INFLIGHT','DELIVERY_RUN_CHANGED','REQUEST_ID_CONFLICT','WORKSPACE_DIVERGED','WORKSPACE_IDENTITY_MISMATCH','WORKSPACE_IDENTITY_REQUIRED'].includes(error?.code))return 409;
  if(error?.code==='ENOENT'||error?.code==='NOT_FOUND')return 404;
  if(['UNAUTHORIZED','UNTRUSTED_ORIGIN','UNTRUSTED_HOST'].includes(error?.code))return 403;
  if(error?.code==='REQUEST_TOO_LARGE')return 413;
  return error?.code?400:500;
}
function attachment(response,name){
  const safe=String(name).replace(/[^A-Za-z0-9._-]/g,'_');
  response.setHeader('Content-Disposition','attachment; filename="'+safe+'"');
}
export async function startInvoiceSettlementServer({workspaceDirectory,connections={},profile={},expectedWorkspaceId,
  host='127.0.0.1',port=0,signal,connectionsFile=null,profileFile=null,deliveryDirectory}={}){
  need(['127.0.0.1','::1'].includes(host),'INVALID_HOST','Bind the private operator to 127.0.0.1 or ::1.');
  integer(port,'port',0,65535);
  const directory=resolve(workspaceDirectory),controller=new AbortController();
  const forward=()=>controller.abort(signal?.reason);
  if(signal?.aborted)forward();else signal?.addEventListener('abort',forward,{once:true});
  const operator=await openInvoiceSettlementOperator({workspaceDirectory:directory,connections,profile,expectedWorkspaceId,signal:controller.signal});
  const assetBodies=new Map();
  try{for(const [path,[file,type]] of Object.entries(ASSETS))assetBodies.set(path,{body:await fs.readFile(join(SOURCE_DIRECTORY,file)),type});}
  catch(error){await operator.close();throw error;}
  const token=randomBytes(32).toString('base64url'),secret=Buffer.from(token),active=new Set();
  let closing=false,closePromise,startup,allowedHosts=new Set(),allowedOrigins=new Set();
  const inboxRoot=resolve(deliveryDirectory??join(dirname(directory),basename(directory)+'.receiving-inbox'));
  need(inboxRoot!==directory&&!inboxRoot.startsWith(directory+'/'),'INVALID_DIRECTORY','Use an operator receiving inbox outside the active workspace.');
  function authorized(request){
    const value=request.headers.authorization;
    need(typeof value==='string'&&value.startsWith('Bearer '),'UNAUTHORIZED','Open the complete private workspace link.');
    const given=Buffer.from(value.slice(7));
    need(given.length===secret.length&&timingSafeEqual(given,secret),'UNAUTHORIZED','Open the complete private workspace link.');
  }
  async function requireOriginalWorkspace(request){
    const expected=request.headers['x-invoice-workspace-id'];
    need(typeof expected==='string'&&expected===startup.workspaceId,'WORKSPACE_IDENTITY_REQUIRED',
      'Supply this operator’s original workspace identity with the write request.',
      {expectedWorkspaceId:startup.workspaceId});
    const current=await operator.describe();
    need(current.workspaceId===startup.workspaceId,'WORKSPACE_IDENTITY_MISMATCH',
      'The selected directory no longer has this operator’s original workspace identity.',
      {expectedWorkspaceId:startup.workspaceId,actualWorkspaceId:current.workspaceId});
  }
  async function handle(request,response){
    need(!closing,'OPERATOR_DRAINING','The operator is finishing its active requests.');
    need(allowedHosts.has(request.headers.host),'UNTRUSTED_HOST','Use this operator’s local workspace address.');
    if(request.headers.origin)need(allowedOrigins.has(request.headers.origin),'UNTRUSTED_ORIGIN','Use this operator’s own workspace page.');
    need(typeof request.url==='string'&&request.url.startsWith('/'),'INVALID_REQUEST','Use an operator route.');
    const url=new URL(request.url,startup.origin),path=url.pathname;
    if(request.method==='GET'&&assetBodies.has(path)){
      const asset=assetBodies.get(path);headers(response,asset.type);response.setHeader('Content-Length',asset.body.length);response.end(asset.body);return;
    }
    if(path==='/favicon.ico'){response.statusCode=204;response.end();return;}
    authorized(request);
    if(request.method==='GET'&&path==='/api/bootstrap'){
      json(response,200,{state:await operator.describe(),methods:operator.methods(),
        catalog:await operator.invoke({method:'source.catalog'}),
        operator:{workspaceDirectory:directory,sourceDirectory:SOURCE_DIRECTORY,connectionsFile,profileFile,
          inboxDirectory:inboxRoot,origin:startup.origin}});return;
    }
    if(request.method==='GET'&&path==='/api/state'){json(response,200,await operator.describe());return;}
    if(request.method==='POST'&&path==='/api/invoke'){
      const input=JSON.parse((await bytes(request,512*1024*1024)).toString('utf8'));need(plain(input),'INVALID_ARGUMENT','Supply one operator request.');
      if(operator.methods().find(entry=>entry.method===input.method)?.mutates)await requireOriginalWorkspace(request);
      json(response,200,await operator.invoke(input));return;
    }
    if(request.method==='POST'&&path==='/api/sources/import'){
      await requireOriginalWorkspace(request);
      const encoded=request.headers['x-invoice-source'];
      need(typeof encoded==='string'&&encoded.length<=16000,'INVALID_ARGUMENT','Supply the source import selection.');
      const args=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
      need(plain(args),'INVALID_ARGUMENT','Supply the original source metadata.');
      const body=await bytes(request,256*1024*1024);
      json(response,200,await operator.invoke({method:'source.import',args:{...args,bodyBase64:body.toString('base64')}}));return;
    }
    const sourceMatch=path.match(/^\/api\/sources\/([^/]+)\/original$/);
    if(request.method==='GET'&&sourceMatch){
      const sourceId=decodeURIComponent(sourceMatch[1]);identifier(sourceId);
      const state=await operator.describe(),source=selected(state.sources,sourceId,'Source'),body=await readDescriptor(directory,source.bodyFile);
      headers(response,'application/octet-stream');attachment(response,'source-'+sourceId+'.'+(source.provider==='document'?'bin':'json'));
      response.setHeader('Content-Length',body.length);response.setHeader('X-Content-SHA256',source.bodyFile.sha256);response.end(body);return;
    }
    const reportMatch=path.match(/^\/api\/reports\/([^/]+)\/files\/([^/]+)$/);
    if(request.method==='GET'&&reportMatch){
      const result=await operator.reportBody({reportId:decodeURIComponent(reportMatch[1]),format:decodeURIComponent(reportMatch[2])});
      headers(response,result.member.contentType);attachment(response,result.member.filename);
      response.setHeader('Content-Length',result.body.length);response.setHeader('X-Content-SHA256',result.member.sha256);response.end(result.body);return;
    }
    const listenerFileMatch=path.match(/^\/api\/listener\/([^/]+)\/files\/(request|manifest|response|attempt)$/);
    if(request.method==='GET'&&listenerFileMatch){
      const deliveryId=decodeURIComponent(listenerFileMatch[1]),part=listenerFileMatch[2],attemptId=url.searchParams.get('attemptId')||undefined;
      const data=await operator.invoke({method:'delivery.file',args:{deliveryId,attemptId,part,length:1}});
      const body=await readDescriptor(directory,data.file);headers(response,data.contentType);attachment(response,data.filename);
      response.setHeader('Content-Length',body.length);response.setHeader('X-Content-SHA256',data.file.sha256);response.end(body);return;
    }
    const listenerMatch=path.match(/^\/api\/listener\/([^/]+)\/attempts\/([^/]+)\/response$/);
    if(request.method==='GET'&&listenerMatch){
      const deliveryId=decodeURIComponent(listenerMatch[1]),attemptId=decodeURIComponent(listenerMatch[2]);
      const data=await operator.invoke({method:'delivery.file',args:{deliveryId,attemptId,part:'response',length:1}});
      const body=await readDescriptor(directory,data.file);headers(response,data.contentType);attachment(response,data.filename);
      response.setHeader('Content-Length',body.length);response.setHeader('X-Content-SHA256',data.file.sha256);response.end(body);return;
    }
    const deliveryMatch=path.match(/^\/api\/packages\/([^/]+)\/archive$/);
    if(request.method==='GET'&&deliveryMatch){
      const exportId=decodeURIComponent(deliveryMatch[1]);identifier(exportId);
      const {record}=await operator.exported({exportId});
      const source=await streamInvoiceDelivery({sourceDirectory:record.directory,expectedManifestSha256:record.manifestSha256,signal:controller.signal});
      headers(response,'application/gzip');attachment(response,'invoice-workspace-'+exportId+'.tar.gz');
      response.setHeader('X-Invoice-Manifest-SHA256',record.manifestSha256);
      await pipeline(source,response,{signal:controller.signal});return;
    }
    if(request.method==='POST'&&path==='/api/packages/unpack'){
      await requireOriginalWorkspace(request);
      const requestId=url.searchParams.get('requestId');identifier(requestId);
      const expectedManifestSha256=url.searchParams.get('manifestSha256')||undefined;
      await privateDirectory(inboxRoot);
      const destination=join(inboxRoot,requestId);
      const result=await unpackInvoiceDelivery({input:request,destination,expectedManifestSha256,signal:controller.signal});
      json(response,200,{sourceDirectory:result.sourceDirectory??destination,manifest:result.manifest,
        manifestSha256:result.manifestSha256,bytes:typeof result.bytes==='number'?result.bytes:result.manifest.files.reduce((sum,file)=>sum+file.bytes,0)});return;
    }
    json(response,404,{error:{code:'NOT_FOUND',message:'This operator route is unavailable.'}});
  }
  const server=createServer((request,response)=>{
    let running;
    running=handle(request,response).catch(error=>{
      if(response.destroyed){request.destroy();return;}
      if(response.headersSent){response.destroy(error);return;}
      if(!request.complete){response.setHeader('Connection','close');response.once('finish',()=>request.destroy());}
      json(response,statusFor(error),{error:operator.publicError(error)});
    }).finally(()=>active.delete(running));
    active.add(running);
  });
  server.requestTimeout=0;server.headersTimeout=60000;
  server.on('clientError',(_error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
  try{
    const state=await operator.describe();
    await new Promise((done,reject)=>{server.once('error',reject);server.listen({host,port},()=>{server.off('error',reject);done();});});
    const address=server.address(),origin='http://'+(host==='::1'?'[::1]':host)+':'+address.port;
    allowedHosts=new Set([host==='::1'?'[::1]:'+address.port:'127.0.0.1:'+address.port,'localhost:'+address.port]);
    allowedOrigins=new Set([...allowedHosts].map(value=>'http://'+value));
    startup={url:origin+'/#token='+encodeURIComponent(token),origin,host,port:address.port,workspaceDirectory:directory,
      workspaceId:state.workspaceId,revision:state.revision,pid:process.pid};
  }catch(error){server.close();await operator.close();signal?.removeEventListener('abort',forward);throw error;}
  async function close(){
    if(closePromise)return closePromise;
    closing=true;controller.abort(new Error('Server draining'));
    closePromise=(async()=>{
      const stopped=new Promise((done,reject)=>server.close(error=>error?reject(error):done()));
      server.closeIdleConnections?.();
      await operator.close();
      server.closeAllConnections?.();
      while(active.size)await Promise.allSettled([...active]);
      await stopped;signal?.removeEventListener('abort',forward);
    })();return closePromise;
  }
  return {url:startup.url,host,port:startup.port,startup,operator,server,close};
}

export async function startInvoiceWebhookServer({workspaceDirectory,connections={},profile={},expectedWorkspaceId,
  programmeId,programmeVersion,connectionAlias,host='127.0.0.1',port=0,maximumBodyBytes=16*1024*1024,
  allowedHosts=[],signal}={}){
  need(typeof host==='string'&&host.length>0,'INVALID_HOST','Select the customer webhook ingress host.');
  integer(port,'port',0,65535);integer(maximumBodyBytes,'maximum webhook body bytes',1,256*1024*1024);
  identifier(programmeId,'programme ID');
  need(connections[connectionAlias]?.provider==='customer-webhook','INVALID_CONNECTION','Select the original customer webhook signature configuration.');
  need(Array.isArray(allowedHosts)&&allowedHosts.every(value=>typeof value==='string'&&value.length),'INVALID_HOST','Supply exact ingress Host values.');
  const controller=new AbortController(),forward=()=>controller.abort(signal?.reason);
  if(signal?.aborted)forward();else signal?.addEventListener('abort',forward,{once:true});
  const operator=await openInvoiceSettlementOperator({workspaceDirectory:resolve(workspaceDirectory),connections,profile,expectedWorkspaceId,signal:controller.signal});
  await operator.invoke({method:'programme.read',args:{programmeId,version:programmeVersion}});
  const active=new Set();let closing=false,closePromise,startup;
  async function handle(request,response){
    need(!closing,'OPERATOR_DRAINING','The webhook receiver is finishing its active requests.');
    if(allowedHosts.length)need(allowedHosts.includes(request.headers.host),'UNTRUSTED_HOST','Use the configured customer webhook endpoint.');
    const path=new URL(request.url,'http://localhost').pathname;
    if(request.method==='GET'&&path==='/health'){json(response,200,{status:'ready'});return;}
    if(request.method!=='POST'||path!=='/webhooks/elementpay'){json(response,404,{error:{code:'NOT_FOUND',message:'This webhook route is unavailable.'}});return;}
    const body=await bytes(request,maximumBodyBytes);
    const result=await operator.receiveWebhook({programmeId,programmeVersion,connectionAlias,rawBody:body,headers:request.headers,receivedAt:new Date().toISOString()});
    json(response,result.accepted?200:409,result);
  }
  const server=createServer((request,response)=>{
    let pending;pending=handle(request,response).catch(error=>{
      if(response.destroyed){request.destroy();return;}
      if(response.headersSent){response.destroy(error);return;}
      if(!request.complete){response.setHeader('Connection','close');response.once('finish',()=>request.destroy());}
      const authentication=/WEBHOOK.*(SIGNATURE|TIMESTAMP|SECRET)|SIGNATURE.*(INVALID|MISSING)|TIMESTAMP/.test(error?.code??'');
      json(response,authentication?401:statusFor(error),{error:operator.publicError(error)});
    }).finally(()=>active.delete(pending));active.add(pending);
  });
  server.requestTimeout=120000;server.headersTimeout=30000;
  server.on('clientError',(_error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
  try{
    const state=await operator.describe();
    await new Promise((done,reject)=>{server.once('error',reject);server.listen({host,port},()=>{server.off('error',reject);done();});});
    const address=server.address();
    startup={schema:'stellar-forge.invoice-webhook-startup.v1',status:'INVOICE_WEBHOOK_READY',host,port:address.port,
      path:'/webhooks/elementpay',workspaceDirectory:resolve(workspaceDirectory),workspaceId:state.workspaceId,
      programmeId,programmeVersion:programmeVersion??null,connectionAlias,pid:process.pid};
  }catch(error){server.close();await operator.close();signal?.removeEventListener('abort',forward);throw error;}
  async function close(){
    if(closePromise)return closePromise;closing=true;controller.abort(new Error('Webhook receiver draining'));
    closePromise=(async()=>{
      const stopped=new Promise((done,reject)=>server.close(error=>error?reject(error):done()));
      server.closeIdleConnections?.();await operator.close();server.closeAllConnections?.();
      while(active.size)await Promise.allSettled([...active]);await stopped;signal?.removeEventListener('abort',forward);
    })();return closePromise;
  }
  return {startup,server,operator,close,host,port:startup.port};
}
