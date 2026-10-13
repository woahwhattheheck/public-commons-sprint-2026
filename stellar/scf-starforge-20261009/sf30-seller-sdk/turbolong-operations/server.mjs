// MIT. Private Turbolong operator with complete source and archive transport.
import {createServer} from 'node:http';
import {promises as fs} from 'node:fs';
import {dirname,basename,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {openTurbolongOperationsOperator,loadTurbolongOperationsConfiguration,TURBOLONG_OPERATIONS_METHODS} from './operator.mjs';
import {streamTurbolongDelivery,unpackTurbolongDelivery} from './archive.mjs';
import {runTurbolongAcquisitionsWorker} from './worker.mjs';
import {readTurbolongRuntimeManifest,publicTurbolongRuntime} from './runtime.mjs';
import {need,plain,integer,identifier,hash,privateDirectory,inside,files,descriptor,canonical} from './common.mjs';
const HERE=dirname(fileURLToPath(import.meta.url)),CHUNK=196608;
const ASSETS={
 '/':['web/index.html','text/html; charset=utf-8'],
 '/app.mjs':['web/app.mjs','text/javascript; charset=utf-8'],
 '/journal.mjs':['web/journal.mjs','text/javascript; charset=utf-8'],
 '/source-sha256.mjs':['../../sf88-operator-buyer-cli/job-workspace/inputs/public/sha256.mjs','text/javascript; charset=utf-8'],
 '/styles.css':['web/styles.css','text/css; charset=utf-8']
};
function headers(response,type='application/json; charset=utf-8'){
 response.setHeader('Content-Type',type);response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
 response.setHeader('Referrer-Policy','no-referrer');response.setHeader('Cross-Origin-Opener-Policy','same-origin');
 response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
 response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
}
function json(response,status,value){const body=Buffer.from(JSON.stringify(value));headers(response);response.statusCode=status;response.setHeader('Content-Length',body.length);response.end(body);}
async function readJSON(request,limit=32*1024*1024){
 const declared=request.headers['content-length'];if(declared!==undefined)need(/^\d+$/.test(declared)&&Number(declared)<=limit,'REQUEST_TOO_LARGE','The request exceeds the supported JSON size; upload the original file separately.');
 const chunks=[];let bytes=0;for await(const chunk of request){bytes+=chunk.length;need(bytes<=limit,'REQUEST_TOO_LARGE','The JSON request exceeds the supported size.');chunks.push(chunk);}
 const value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));need(plain(value),'INVALID_ARGUMENT','Supply one complete JSON object.');return value;
}
function statusFor(error){
 if(['REVISION_CONFLICT','REQUEST_ID_CONFLICT','WORKSPACE_IDENTITY_MISMATCH','WORKSPACE_IDENTITY_REQUIRED','OPERATION_RUNNING',
  'OUTCOME_RECONCILIATION_REQUIRED','OPERATION_SOURCE_CHANGED','SOURCE_CHANGED','RUNTIME_SOURCE_CHANGED','RUNTIME_EXECUTION_ORIGIN_REQUIRED',
  'WORKSPACE_BUSY','ACQUISITION_RUNNING','SOURCE_CONFLICT'].includes(error?.code))return 409;
 if(error?.code==='UNAUTHORIZED')return 401;if(['UNTRUSTED_ORIGIN','UNTRUSTED_HOST'].includes(error?.code))return 403;
 if(error?.code==='NOT_FOUND'||error?.code==='ENOENT')return 404;if(error?.code==='REQUEST_TOO_LARGE')return 413;return error?.code?400:500;
}
function attachment(response,name){response.setHeader('Content-Disposition','attachment; filename="'+String(name).replace(/[^A-Za-z0-9._-]/g,'_')+'"');}
async function syncDirectory(directory){const fd=await fs.open(directory,'r');try{await fd.sync();}finally{await fd.close();}}
export async function startTurbolongOperationsServer({workspaceDirectory,configuration,connections={},profile={},runtimes=[],expectedWorkspaceId,
 host='127.0.0.1',port=8779,signal,connectionsFile=null,profileFile=null,deliveryDirectory,applicationDirectory,runtimeDirectory,expectedManifestSha256,installationDirectory}={}){
 need(['127.0.0.1','::1'].includes(host),'INVALID_HOST','Bind the operator to 127.0.0.1 or ::1.');integer(port,'port',0,65535);
 const directory=resolve(workspaceDirectory),controller=new AbortController();
 const forward=()=>controller.abort(signal?.reason);if(signal?.aborted)forward();else signal?.addEventListener('abort',forward,{once:true});
 const selectedConfiguration=configuration??await loadTurbolongOperationsConfiguration({workspaceDirectory:directory,connectionsFile,profileFile,connections,profile,runtimes,runtimeDirectory,expectedManifestSha256,installationDirectory});
 const operator=await openTurbolongOperationsOperator({workspaceDirectory:directory,configuration:selectedConfiguration,connections,profile,runtimes,
  expectedWorkspaceId,signal:controller.signal,applicationDirectory});
 const token=randomBytes(32).toString('base64url'),secret=Buffer.from(token),assets=new Map(),active=new Set(),allowedHosts=new Set(),allowedOrigins=new Set();
 let startup,closing=false,closePromise,worker;
 const inboxRoot=resolve(deliveryDirectory??join(dirname(directory),basename(directory)+'.receiving-inbox'));
 need(!inside(directory,inboxRoot)&&!inside(inboxRoot,directory),'INVALID_DIRECTORY','Keep the receiving inbox outside the operating workspace.');
 try{for(const [route,[file,type]]of Object.entries(ASSETS))assets.set(route,{body:await fs.readFile(join(HERE,file)),type});}
 catch(error){await operator.close();throw error;}
 function authorize(request){
  const raw=request.headers.authorization;need(typeof raw==='string'&&raw.startsWith('Bearer '),'UNAUTHORIZED','Open the private operator link printed by this host.');
  const supplied=Buffer.from(raw.slice(7));need(supplied.length===secret.length&&timingSafeEqual(supplied,secret),'UNAUTHORIZED','The operator token differs.');
 }
 async function requireWorkspace(request){
  need(request.headers['x-turbolong-workspace-id']===startup.workspaceId,'WORKSPACE_IDENTITY_REQUIRED','Use this host’s selected workspace identity.');
  need((await operator.workspace.readState()).workspaceId===startup.workspaceId,'WORKSPACE_IDENTITY_MISMATCH','The workspace at this directory changed.');
 }
 async function fileResponse(response,read,name){
  const first=await read(0,CHUNK),total=first.bytes,sha=first.sha256;integer(total,'source bytes',0);hash(sha);
  headers(response,first.contentType??'application/octet-stream');attachment(response,name??basename(first.path??'source.bin'));
  response.setHeader('Content-Length',total);response.setHeader('X-Content-SHA256',sha);
  async function* pieces(){let offset=0,part=first;
   while(offset<total){
    const bytes=part.content?Buffer.from(part.content):Buffer.from(part.contentBase64??'','base64');
    need(part.sha256===sha&&part.bytes===total&&bytes.length>0&&bytes.length<=total-offset,'SOURCE_CHANGED','The selected file changed during transfer.');
    yield bytes;offset+=bytes.length;if(offset<total)part=await read(offset,CHUNK);
   }
  }
  await pipeline(Readable.from(pieces()),response,{signal:controller.signal});
 }
 async function importUpload(request,url){
  const args=JSON.parse(url.searchParams.get('args')??'null');need(plain(args),'INVALID_ARGUMENT','Supply the complete source import arguments.');
  identifier(args.requestId);integer(args.expectedRevision,'expectedRevision',0);
  const header=request.headers['x-content-sha256'];need(typeof header==='string','SOURCE_HASH_REQUIRED','Bind the uploaded file to its complete SHA256.');hash(header);
  need(!args.expectedSha256||args.expectedSha256===header,'SOURCE_CHANGED','The source hash selections differ.');args.expectedSha256=header;
  const folder=join(inboxRoot,'source-uploads',args.requestId);await privateDirectory(folder);
  const original={...args};delete original.expectedRevision;
  const selection={schema:'stellar-forge.turbolong-operations.source-upload.v1',workspaceId:startup.workspaceId,args:original};
  try{const previous=await files.readJSON(folder,'selection.json');need(canonical(previous)===canonical(selection),'REQUEST_ID_CONFLICT','The upload request belongs to another file selection.');}
  catch(error){if(error.code!=='ENOENT')throw error;await files.writeNew(folder,'selection.json',Buffer.from(canonical(selection)+'\n'));await syncDirectory(folder);}
  const temporary=join(folder,'source.pending-'+randomUUID()),target=join(folder,'source.bin'),fd=await fs.open(temporary,'wx',0o600),digest=createHash('sha256');
  let bytes=0;
  try{
   for await(const chunk of request){need(!controller.signal.aborted,'SOURCE_UPLOAD_INTERRUPTED','The source upload was interrupted.');
    bytes+=chunk.length;need(Number.isSafeInteger(bytes),'SOURCE_TOO_LARGE','The source exceeds a safe exact byte count.');digest.update(chunk);await fd.writeFile(chunk);}
   need(digest.digest('hex')===header,'SOURCE_CHANGED','The complete uploaded file differs from its selected hash.');await fd.sync();await fd.close();
   try{await fs.link(temporary,target);}catch(error){if(error.code!=='EEXIST')throw error;
    const retained=await descriptor(folder,'source.bin');need(retained.sha256===header&&retained.bytes===bytes,'SOURCE_CONFLICT','A different source already belongs to this upload.');}
   await syncDirectory(folder);return operator.importSource(args,{file:target});
  }finally{await fd.close().catch(()=>{});await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 }
 async function handle(request,response){
  need(!closing,'OPERATOR_DRAINING','The operator is draining its retained work.');
  need(allowedHosts.has(request.headers.host),'UNTRUSTED_HOST','Use the selected local host address.');
  if(request.headers.origin)need(allowedOrigins.has(request.headers.origin),'UNTRUSTED_ORIGIN','Use this operator’s browser origin.');
  need(typeof request.url==='string'&&request.url.startsWith('/')&&!request.url.startsWith('//'),'INVALID_URL','Use a local operator route.');
  const url=new URL(request.url,startup.origin),path=url.pathname;
  if(request.method==='GET'&&assets.has(path)){const asset=assets.get(path);headers(response,asset.type);response.setHeader('Content-Length',asset.body.length);response.end(asset.body);return;}
  authorize(request);
  if(request.method==='GET'&&path==='/api/bootstrap'){json(response,200,{state:await operator.describe(),methods:operator.methods(),
   catalogue:await operator.workspace.catalog(),operator:{workspaceDirectory:directory,sourceDirectory:HERE,connectionsFile,profileFile,
    inboxDirectory:inboxRoot,origin:startup.origin,worker:'saved-read-only-acquisitions'}});return;}
  if(request.method==='GET'&&path==='/api/state'){json(response,200,await operator.describe());return;}
  if(request.method==='POST'&&path==='/api/invoke'){
   const input=await readJSON(request),method=TURBOLONG_OPERATIONS_METHODS.find(row=>row.name===input.method);
   need(method,'METHOD_NOT_FOUND','Choose an operator method.');if(method.mutates)await requireWorkspace(request);
   json(response,200,await operator.invoke(input));return;
  }
  if(request.method==='POST'&&path==='/api/source-import'){await requireWorkspace(request);json(response,200,await importUpload(request,url));return;}
  const match=path.match(/^\/api\/(sources|analyses|reports)\/([^/]+)\/file$/);
  if(request.method==='GET'&&match){
   const id=identifier(decodeURIComponent(match[2]));let method,args;
   if(match[1]==='sources'){method='source.file';args={sourceId:id,part:url.searchParams.get('part')??'source',
    ...(url.searchParams.has('path')?{path:url.searchParams.get('path')}:{}),
    ...(url.searchParams.has('index')?{index:Number(url.searchParams.get('index'))}:{})};}
   else if(match[1]==='analyses'){method='analysis.file';args={analysisId:id};}
   else{method='report.file';args={reportId:id,format:url.searchParams.get('format')??'html',...(url.searchParams.has('filename')?{filename:url.searchParams.get('filename')}:{})};}
   await fileResponse(response,(offset,length)=>operator.invoke({method,args:{...args,offset,length}}),url.searchParams.get('filename')??undefined);return;
  }
  const packagePath=path.match(/^\/api\/packages\/([^/]+)\/archive$/);
  if(request.method==='GET'&&packagePath){
   const selected=await operator.exported(decodeURIComponent(packagePath[1]));
   const stream=await streamTurbolongDelivery({sourceDirectory:selected.directory,expectedManifestSha256:selected.manifestSha256,signal:controller.signal});
   headers(response,'application/gzip');attachment(response,'turbolong-operations-'+selected.exportId+'.tar.gz');
   response.setHeader('X-Turbolong-Manifest-SHA256',selected.manifestSha256);await pipeline(stream,response,{signal:controller.signal});return;
  }
  if(request.method==='POST'&&path==='/api/packages/unpack'){
   await requireWorkspace(request);const requestId=identifier(url.searchParams.get('requestId')),queryHash=url.searchParams.get('manifestSha256')||undefined;
   const headerHash=request.headers['x-turbolong-manifest-sha256'];need(headerHash===undefined||typeof headerHash==='string','INVALID_ARGUMENT','Select one complete manifest hash.');
   need(!queryHash||!headerHash||queryHash===headerHash,'MANIFEST_MISMATCH','The archive manifest selections differ.');
   const expectedManifestSha256=headerHash||queryHash;if(expectedManifestSha256)hash(expectedManifestSha256);
   const destination=join(inboxRoot,'packages',requestId);await privateDirectory(dirname(destination));
   const original=await unpackTurbolongDelivery({input:request,destination,expectedManifestSha256,signal:controller.signal});
   json(response,200,{sourceDirectory:original.sourceDirectory??destination,manifest:original.manifest,manifestSha256:original.manifestSha256,
    bytes:original.bytes??original.manifest.files.reduce((count,item)=>count+item.bytes,0)});return;
  }
  json(response,404,{error:{code:'NOT_FOUND',message:'This operator route is unavailable.'}});
 }
 const server=createServer((request,response)=>{
  let task;task=handle(request,response).catch(error=>{
   if(response.destroyed){request.destroy();return;}if(response.headersSent){response.destroy(error);return;}
   if(!request.complete){response.setHeader('Connection','close');response.once('finish',()=>request.destroy());}
   const original=operator.publicError(error);
   if(error.code==='REVISION_CONFLICT'&&Number.isSafeInteger(error.details?.actualRevision))original.actualRevision=error.details.actualRevision;
   json(response,statusFor(error),{error:original});
  }).finally(()=>active.delete(task));active.add(task);
 });
 server.requestTimeout=0;server.headersTimeout=60000;
 server.on('clientError',(_error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
 try{
  const state=await operator.describe(),runtimeSelection=runtimeDirectory?await readTurbolongRuntimeManifest({directory:resolve(runtimeDirectory),expectedManifestSha256}):null;
  const runtimePin=runtimeSelection?publicTurbolongRuntime({id:runtimeSelection.manifest.id,manifestSha256:runtimeSelection.manifestSha256,manifest:runtimeSelection.manifest}):null;
  await new Promise((done,reject)=>{server.once('error',reject);server.listen({host,port},()=>{server.off('error',reject);done();});});
  const address=server.address(),origin='http://'+(host==='::1'?'[::1]':host)+':'+address.port;
  allowedHosts.add((host==='::1'?'[::1]':host)+':'+address.port);allowedHosts.add('localhost:'+address.port);
  for(const value of allowedHosts)allowedOrigins.add('http://'+value);
  startup={schema:'stellar-forge.turbolong-operations-workspace-startup.v1',status:'TURBOLONG_OPERATIONS_READY',
   url:origin+'/#token='+encodeURIComponent(token),origin,host,port:address.port,workspaceDirectory:directory,sourceDirectory:HERE,
   connectionsFile,profileFile,workspaceId:state.workspaceId,revision:state.revision,pid:process.pid,
   runtimeDirectory:runtimeDirectory?resolve(runtimeDirectory):null,expectedManifestSha256:runtimeSelection?.manifestSha256??null,
   installationDirectory:installationDirectory?resolve(installationDirectory):null,runtimes:runtimePin?[runtimePin]:[]};
  worker=runTurbolongAcquisitionsWorker({workspace:operator.workspace,signal:controller.signal,onProgress:()=>{}}).catch(error=>{
   if(!controller.signal.aborted)process.stderr.write(JSON.stringify({worker:'turbolong-acquisitions',error:operator.publicError(error)})+'\n');
  });
 }catch(error){server.close();await operator.close();signal?.removeEventListener('abort',forward);throw error;}
 async function close(){
  if(closePromise)return closePromise;closing=true;controller.abort(new Error('Turbolong operator draining'));
  closePromise=(async()=>{
   const stopped=new Promise((done,reject)=>server.close(error=>error?reject(error):done()));server.closeIdleConnections?.();
   await worker;await operator.close();server.closeAllConnections?.();while(active.size)await Promise.allSettled([...active]);
   await stopped;signal?.removeEventListener('abort',forward);
  })();return closePromise;
 }
 return {startup,url:startup.url,host,port:startup.port,operator,server,close};
}
