// MIT. Pollar partner operator, original SDK portal and complete source transport.
import {createServer} from 'node:http';
import {promises as fs} from 'node:fs';
import {dirname,basename,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {openPollarPartnerOperator,POLLAR_PARTNER_METHODS} from './operator.mjs';
import {readPollarBrowserAsset} from './runtime.mjs';
import {streamPollarDelivery,unpackPollarDelivery} from './archive.mjs';
import {need,plain,integer,identifier,hash,privateDirectory,inside} from './common.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)),CHUNK=196608;
const ASSETS={
 '/':['web/index.html','text/html; charset=utf-8'],
 '/app.mjs':['web/app.mjs','text/javascript; charset=utf-8'],
 '/portal':['web/portal.html','text/html; charset=utf-8'],
 '/portal/':['web/portal.html','text/html; charset=utf-8'],
 '/portal.mjs':['web/portal.mjs','text/javascript; charset=utf-8'],
 '/journal.mjs':['web/journal.mjs','text/javascript; charset=utf-8'],
 '/source-sha256.mjs':['../../sf88-operator-buyer-cli/job-workspace/inputs/public/sha256.mjs','text/javascript; charset=utf-8'],
 '/styles.css':['web/styles.css','text/css; charset=utf-8'],
 '/browser-bridge.mjs':['browser-bridge.mjs','text/javascript; charset=utf-8'],
 '/catalogue.mjs':['catalogue.mjs','text/javascript; charset=utf-8']
};
const COOKIE='pollar_partner_session';
function headers(response,type='application/json; charset=utf-8',{portal=false}={}){
 response.setHeader('Content-Type',type);response.setHeader('Cache-Control','no-store');
 response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
 response.setHeader('Content-Security-Policy',portal?
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:; img-src 'self' https: data: blob:; font-src 'self' https: data:; frame-src https: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self' https:; frame-ancestors 'none'":
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
 response.setHeader('Cross-Origin-Opener-Policy','same-origin-allow-popups');
 response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), publickey-credentials-create=(self), publickey-credentials-get=(self)');
}
function json(response,status,value){const body=Buffer.from(JSON.stringify(value));headers(response);response.statusCode=status;response.setHeader('Content-Length',body.length);response.end(body);}
async function readJSON(request,limit=32*1024*1024){
 const declared=request.headers['content-length'];if(declared!==undefined)need(/^\d+$/.test(declared)&&Number(declared)<=limit,'REQUEST_TOO_LARGE','The original request exceeds the supported size.');
 const chunks=[];let bytes=0;for await(const chunk of request){bytes+=chunk.length;need(bytes<=limit,'REQUEST_TOO_LARGE','The original request exceeds the supported size.');chunks.push(chunk);}
 const value=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));need(plain(value),'INVALID_ARGUMENT','Supply one original JSON request.');return value;
}
function statusFor(error){
 if(['REVISION_CONFLICT','REQUEST_ID_CONFLICT','WORKSPACE_IDENTITY_MISMATCH','WORKSPACE_IDENTITY_REQUIRED','OPERATION_RUNNING','OUTCOME_RECONCILIATION_REQUIRED','OPERATION_SOURCE_CHANGED','SOURCE_CHANGED','RUNTIME_SOURCE_CHANGED'].includes(error?.code))return 409;
 if(['UNAUTHORIZED','PORTAL_SESSION_REQUIRED','SESSION_NOT_VERIFIED'].includes(error?.code))return 401;
 if(['UNTRUSTED_ORIGIN','UNTRUSTED_HOST','PARTICIPANT_SCOPE_MISMATCH','PORTAL_METHOD_UNAVAILABLE'].includes(error?.code))return 403;
 if(error?.code==='NOT_FOUND'||error?.code==='ENOENT')return 404;
 if(error?.code==='REQUEST_TOO_LARGE')return 413;
 return error?.code?400:500;
}
function attachment(response,name){response.setHeader('Content-Disposition','attachment; filename="'+String(name).replace(/[^A-Za-z0-9._-]/g,'_')+'"');}
function cookieValue(request){for(const pair of String(request.headers.cookie??'').split(';')){const at=pair.indexOf('=');if(pair.slice(0,at).trim()===COOKIE)return pair.slice(at+1).trim();}return null;}
function expiresAt(value){
 if(typeof value==='number'&&Number.isFinite(value))return value<1e12?value*1000:value;
 if(typeof value==='string'&&/^\d+$/.test(value))return expiresAt(Number(value));
 const date=Date.parse(value);return Number.isFinite(date)?date:null;
}
export async function startPollarPartnerServer({
 workspaceDirectory,configuration,connections={},profile={},runtimes=[],portalConnections={},expectedWorkspaceId,
 host='127.0.0.1',port=8778,signal,connectionsFile=null,profileFile=null,deliveryDirectory,applicationDirectory
}={}){
 need(['127.0.0.1','::1'].includes(host),'INVALID_HOST','Bind the partner host to 127.0.0.1 or ::1.');
 integer(port,'port',0,65535);
 const directory=resolve(workspaceDirectory),controller=new AbortController();
 const forward=()=>controller.abort(signal?.reason);if(signal?.aborted)forward();else signal?.addEventListener('abort',forward,{once:true});
 const operator=await openPollarPartnerOperator({workspaceDirectory:directory,configuration,connections,profile,runtimes,portalConnections,
  expectedWorkspaceId,signal:controller.signal,applicationDirectory});
 const token=randomBytes(32).toString('base64url'),secret=Buffer.from(token),assets=new Map(),sessions=new Map(),active=new Set();
 let startup,closing=false,closePromise;const allowedHosts=new Set(),allowedOrigins=new Set();
 const inboxRoot=resolve(deliveryDirectory??join(dirname(directory),basename(directory)+'.receiving-inbox'));
 need(!inside(directory,inboxRoot)&&!inside(inboxRoot,directory),'INVALID_DIRECTORY','Select a receiving inbox outside the active workspace.');
 try{for(const [route,[file,type]]of Object.entries(ASSETS))assets.set(route,{body:await fs.readFile(join(HERE,file)),type});}
 catch(error){await operator.close();throw error;}
 function authorize(request){
  const raw=request.headers.authorization;need(typeof raw==='string'&&raw.startsWith('Bearer '),'UNAUTHORIZED','Open the complete private operator link.');
  const given=Buffer.from(raw.slice(7));need(given.length===secret.length&&timingSafeEqual(given,secret),'UNAUTHORIZED','The operator access token differs.');
 }
 function customer(request){
  const key=cookieValue(request),session=key?sessions.get(key):null;
  if(session&&session.expiresAt<=Date.now())sessions.delete(key);
  need(session&&session.expiresAt>Date.now(),'PORTAL_SESSION_REQUIRED','Verify the current original SDK session.');
  return session;
 }
 async function requireWorkspace(request,{portal=false}={}){
  need(request.headers['x-pollar-workspace-id']===startup.workspaceId,'WORKSPACE_IDENTITY_REQUIRED',
   'Use this host’s original workspace identity for the request.',{expectedWorkspaceId:startup.workspaceId});
  if(portal)need(typeof request.headers.origin==='string'&&allowedOrigins.has(request.headers.origin),'UNTRUSTED_ORIGIN','Use this customer portal’s original origin.');
  need((await operator.workspace.readState()).workspaceId===startup.workspaceId,'WORKSPACE_IDENTITY_MISMATCH','The original workspace at this directory changed.');
 }
 async function fileResponse(response,read,{name}={}){
  const first=await read(0,CHUNK),total=first.bytes,sha=first.sha256;integer(total,'original file bytes',0);hash(sha);
  headers(response,first.contentType??'application/octet-stream');if(name)attachment(response,name);
  response.setHeader('Content-Length',total);response.setHeader('X-Content-SHA256',sha);
  async function* pieces(){
   let offset=0,part=first;while(offset<total){
    const bytes=part.content?Buffer.from(part.content):Buffer.from(part.contentBase64??'','base64');
    need(part.sha256===sha&&part.bytes===total&&bytes.length>0&&bytes.length<=total-offset,'SOURCE_CHANGED','The selected original file changed during transfer.');
    yield bytes;offset+=bytes.length;if(offset<total)part=await read(offset,CHUNK);
   }
  }
  await pipeline(Readable.from(pieces()),response,{signal:controller.signal});
 }
 async function handle(request,response){
  need(!closing,'OPERATOR_DRAINING','The host is draining its original requests.');
  need(allowedHosts.has(request.headers.host),'UNTRUSTED_HOST','Use the original local host address.');
  if(request.headers.origin)need(allowedOrigins.has(request.headers.origin),'UNTRUSTED_ORIGIN','Use this host’s original browser origin.');
  need(typeof request.url==='string'&&request.url.startsWith('/'),'INVALID_REQUEST','Select a local partner route.');
  const url=new URL(request.url,startup.origin),path=url.pathname;
  if(request.method==='GET'&&assets.has(path)){
   const asset=assets.get(path);headers(response,asset.type,{portal:path==='/portal'||path==='/portal/'});response.setHeader('Content-Length',asset.body.length);response.end(asset.body);return;
  }
  if(path==='/favicon.ico'){response.statusCode=204;response.end();return;}
  const runtimePath=path.match(/^\/api\/runtimes\/([a-f0-9]{64})\/(.+)$/);
  if(request.method==='GET'&&runtimePath){
   const selected=await operator.runtime(runtimePath[1]),asset=decodeURIComponent(runtimePath[2]);
   await fileResponse(response,(offset,length)=>readPollarBrowserAsset({directory:selected.directory,expectedManifestSha256:selected.manifestSha256,asset,offset,length}));return;
  }
  if(request.method==='GET'&&path==='/pollar-runtime.mjs'){
   const application=await operator.portalApplication(url.searchParams.get('application')??undefined);
   response.statusCode=307;response.setHeader('Location',application.configuration.runtimeModuleUrl);response.end();return;
  }
  if(request.method==='GET'&&path==='/api/portal/bootstrap'){
   const application=await operator.portalApplication(url.searchParams.get('application')??undefined,url.searchParams.has('version')?Number(url.searchParams.get('version')):undefined),methods=await operator.methods();
   let session=null;try{const selected=customer(request);if(selected.applicationId===application.applicationId)session={participantId:selected.participantId,
    applicationId:selected.applicationId,applicationVersion:selected.applicationVersion,userId:selected.userId,expiresAt:selected.expiresAt};}catch{}
   json(response,200,{application,catalogue:methods.browser,configurationSchema:methods.publicConfiguration,session,origin:startup.origin});return;
  }
  if(request.method==='POST'&&path==='/api/portal/session'){
   await requireWorkspace(request,{portal:true});const input=await readJSON(request,65536);
   identifier(input.requestId);identifier(input.applicationId);
   const result=await operator.verifyPortal(input),now=Date.now(),verifiedExpiry=expiresAt(result.participant.verification.expiresAt);
   need(verifiedExpiry===null||verifiedExpiry>now,'PORTAL_SESSION_REQUIRED','The original SDK session has expired.');
   const key=randomBytes(32).toString('base64url'),expiry=Math.min(verifiedExpiry??now+60*60*1000,now+24*60*60*1000);
   const previous=cookieValue(request);if(previous)sessions.delete(previous);
   const session={workspaceId:startup.workspaceId,applicationId:result.application.applicationId,applicationVersion:result.application.applicationVersion,
    participantId:result.participant.id,userId:result.participant.userId,expiresAt:expiry};
   sessions.set(key,session);
   for(const [old,row]of sessions)if(row.expiresAt<=now)sessions.delete(old);
   response.setHeader('Set-Cookie',COOKIE+'='+key+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+Math.floor((expiry-now)/1000));
   json(response,200,{...result,session});return;
  }
  if(request.method==='DELETE'&&path==='/api/portal/session'){
   await requireWorkspace(request,{portal:true});const key=cookieValue(request);if(key)sessions.delete(key);
   response.setHeader('Set-Cookie',COOKIE+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');json(response,200,{closed:true});return;
  }
  if(request.method==='POST'&&path==='/api/portal/invoke'){
   const session=customer(request);await requireWorkspace(request,{portal:true});
   const input=await readJSON(request);json(response,200,await operator.portalInvoke({...input,session}));return;
  }
  const portalFile=path.match(/^\/api\/portal\/(sources|reports)\/([^/]+)\/([^/]+)$/);
  if(request.method==='GET'&&portalFile){
   const session=customer(request),id=decodeURIComponent(portalFile[2]),part=decodeURIComponent(portalFile[3]);
   const method=portalFile[1]==='sources'?'source.file':'report.file',base=portalFile[1]==='sources'?{sourceId:id,part}:{reportId:id,format:part};
   await fileResponse(response,(offset,length)=>operator.portalInvoke({method,args:{...base,offset,length},session}),
    {name:portalFile[1]+'-'+id+'.'+(part==='html'?'html':part==='csv'?'csv':part==='response'?'bin':'json')});return;
  }
  authorize(request);
  if(request.method==='GET'&&path==='/api/bootstrap'){
   json(response,200,{state:await operator.describe(),methods:await operator.methods(),operator:{workspaceDirectory:directory,sourceDirectory:HERE,
    connectionsFile,profileFile,inboxDirectory:inboxRoot,origin:startup.origin,portalUrl:startup.origin+'/portal'}});return;
  }
  if(request.method==='GET'&&path==='/api/state'){json(response,200,await operator.describe());return;}
  if(request.method==='POST'&&path==='/api/invoke'){
   const input=await readJSON(request),method=POLLAR_PARTNER_METHODS.find(row=>row.name===input.method);
   need(method,'METHOD_NOT_FOUND','Select an original operator method.');if(method.mutates)await requireWorkspace(request);
   json(response,200,await operator.invoke(input));return;
  }
  const privateFile=path.match(/^\/api\/(sources|reports)\/([^/]+)\/([^/]+)$/);
  if(request.method==='GET'&&privateFile){
   const id=decodeURIComponent(privateFile[2]),part=decodeURIComponent(privateFile[3]);
   const method=privateFile[1]==='sources'?'source.file':'report.file',base=privateFile[1]==='sources'?{sourceId:id,part}:{reportId:id,format:part};
   await fileResponse(response,(offset,length)=>operator.invoke({method,args:{...base,offset,length}}),
    {name:privateFile[1]+'-'+id+'.'+(part==='html'?'html':part==='csv'?'csv':part==='response'?'bin':'json')});return;
  }
  const packagePath=path.match(/^\/api\/packages\/([^/]+)\/archive$/);
  if(request.method==='GET'&&packagePath){
   const original=await operator.exported(decodeURIComponent(packagePath[1]));
   const stream=await streamPollarDelivery({sourceDirectory:original.directory,expectedManifestSha256:original.manifestSha256,signal:controller.signal});
   headers(response,'application/gzip');attachment(response,'pollar-partner-'+(original.exportId??original.id)+'.tar.gz');
   response.setHeader('X-Pollar-Manifest-SHA256',original.manifestSha256);await pipeline(stream,response,{signal:controller.signal});return;
  }
  if(request.method==='POST'&&path==='/api/packages/unpack'){
   await requireWorkspace(request);
   const requestId=identifier(url.searchParams.get('requestId')),queryHash=url.searchParams.get('manifestSha256')||undefined,headerHash=request.headers['x-pollar-manifest-sha256'];
   need(headerHash===undefined||typeof headerHash==='string','INVALID_ARGUMENT','Select one original manifest hash.');
   need(!queryHash||!headerHash||queryHash===headerHash,'MANIFEST_MISMATCH','The original manifest selections differ.');
   const expectedManifestSha256=headerHash||queryHash;if(expectedManifestSha256)hash(expectedManifestSha256);
   await privateDirectory(inboxRoot);const destination=join(inboxRoot,requestId);
   const original=await unpackPollarDelivery({input:request,destination,expectedManifestSha256,signal:controller.signal});
   json(response,200,{sourceDirectory:original.sourceDirectory??destination,manifest:original.manifest,
    manifestSha256:original.manifestSha256,bytes:original.bytes??original.manifest.files.reduce((n,file)=>n+file.bytes,0)});return;
  }
  json(response,404,{error:{code:'NOT_FOUND',message:'This partner route is unavailable.'}});
 }
 const server=createServer((request,response)=>{
  let task;task=handle(request,response).catch(error=>{
   if(response.destroyed){request.destroy();return;}if(response.headersSent){response.destroy(error);return;}
   if(!request.complete){response.setHeader('Connection','close');response.once('finish',()=>request.destroy());}
   json(response,statusFor(error),{error:operator.publicError(error)});
  }).finally(()=>active.delete(task));active.add(task);
 });
 server.requestTimeout=0;server.headersTimeout=60000;
 server.on('clientError',(_error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
 try{
  const state=await operator.describe();
  await new Promise((done,reject)=>{server.once('error',reject);server.listen({host,port},()=>{server.off('error',reject);done();});});
  const address=server.address(),origin='http://'+(host==='::1'?'[::1]':host)+':'+address.port;
  allowedHosts.add((host==='::1'?'[::1]':'127.0.0.1')+':'+address.port);allowedHosts.add('localhost:'+address.port);
  for(const value of allowedHosts)allowedOrigins.add('http://'+value);
  startup={schema:'stellar-forge.pollar-partner-workspace-startup.v1',status:'POLLAR_PARTNER_READY',
   url:origin+'/#token='+encodeURIComponent(token),portalUrl:origin+'/portal',origin,host,port:address.port,
   workspaceDirectory:directory,sourceDirectory:HERE,connectionsFile,profileFile,workspaceId:state.workspaceId,revision:state.revision,pid:process.pid,
   runtimes:state.runtimes};
 }catch(error){server.close();await operator.close();signal?.removeEventListener('abort',forward);throw error;}
 async function close(){
  if(closePromise)return closePromise;closing=true;controller.abort(new Error('Partner host draining'));sessions.clear();
  closePromise=(async()=>{
   const stopped=new Promise((done,reject)=>server.close(error=>error?reject(error):done()));server.closeIdleConnections?.();
   await operator.close();server.closeAllConnections?.();while(active.size)await Promise.allSettled([...active]);await stopped;signal?.removeEventListener('abort',forward);
  })();return closePromise;
 }
 return {startup,url:startup.url,portalUrl:startup.portalUrl,host,port:startup.port,operator,server,close};
}
