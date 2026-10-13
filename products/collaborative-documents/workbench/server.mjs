import { createServer } from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { acquireWorkspaceLease, privateDirectory as originalPrivateDirectory } from './vendor/stellar-expert/store.mjs';
import { Store } from './core/store.mjs';
import { Workspace } from './core/workspace.mjs';
import { Auth, permissions, requireOperator } from './core/auth.mjs';
import { Jobs } from './core/jobs.mjs';
import { Archives } from './core/archive.mjs';
import { UPLOAD_LIMIT, CHUNK_LIMIT, DOCUMENT_LIMIT } from './core/uploads.mjs';
import { NativeRuntime } from './native/runtime.mjs';
import { selectRuntime, publicSelection, SOURCE_ROOT } from './native/selection.mjs';
import { hashFile } from './core/objects.mjs';
import { DomainError, requireValue, id, integer, canonical, sha, now, publicError, safeFilename, fsyncDirectory, collectSourceFiles, identity } from './core/common.mjs';

// Retain the complete source selected when this original server module was loaded.
const APPLICATION_SOURCE=collectSourceFiles(SOURCE_ROOT);
const APPLICATION_MANIFEST=APPLICATION_SOURCE.map(({path,bytes,sha256})=>({path,bytes,sha256}));
const APPLICATION_SOURCE_SHA256=identity(APPLICATION_MANIFEST);

function matchId(value,label){return id(decodeURIComponent(value),label);}
function revisionOf(url){if(!url.searchParams.has('revision'))return undefined;const raw=url.searchParams.get('revision');requireValue(/^\d+$/.test(raw),'INVALID_REVISION','Use a nonnegative original revision.');return integer(Number(raw),'revision');}
async function body(request,limit){
  const chunks=[];let total=0;for await(const piece of request){total+=piece.length;requireValue(total<=limit,'REQUEST_SIZE','This request exceeds its supported source size.',413);chunks.push(piece);}return Buffer.concat(chunks,total);
}
async function json(request,limit=4*1024*1024){
  requireValue((request.headers['content-type']??'').split(';')[0].trim()==='application/json','CONTENT_TYPE','Use application/json for this original API action.',415);
  const bytes=await body(request,limit);try{return JSON.parse(bytes.toString('utf8'));}catch{throw new DomainError('INVALID_JSON','The original API request is not valid JSON.',400);}
}
function sendJson(response,status,value){
  const bytes=Buffer.from(JSON.stringify(value));response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(bytes);
}
function namedHeaders(filename,mediaType,info){
  safeFilename(filename);return {'Content-Type':mediaType,'Content-Length':info.bytes,'X-Content-SHA256':info.sha256,
    'ETag':'"'+info.sha256+'"','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(filename),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
}
async function sendObject(store,response,file){const stream=store.objects.stream(file.sha256,file.bytes);response.writeHead(200,namedHeaders(file.filename,file.mediaType,file));await pipeline(stream,response);}
async function sendFile(response,path,{filename,mediaType,attachment=true}){
  const info=hashFile(path),headers=namedHeaders(filename,mediaType,info);if(!attachment)delete headers['Content-Disposition'];
  response.writeHead(200,headers);await pipeline(createReadStream(path),response);
}
function choose(rows,value,label){const row=rows.find(r=>r.id===value);requireValue(row,label.toUpperCase()+'_NOT_FOUND','The selected retained '+label+' does not exist.',404);return row;}

export async function createApplicationServer({directory,authFile,contextForRequest,host='127.0.0.1',port=8785,runtimeReadyFile,publicOrigin}={}){
  requireValue(typeof directory==='string'&&directory,'WORKSPACE_REQUIRED','Choose the original private application workspace directory.');
  integer(port,'port',{min:0,max:65535});
  const root=await originalPrivateDirectory(resolve(directory),{create:true});
  const lease=await acquireWorkspaceLease(join(root,'workspace.lock'));
  let store,runtime,workspace,server,closing=false,closed=false,closePromise=null;
  let listenerAttempt=null,listenerClosed=false,leaseClosed=false;
  const pending=new Set(),sockets=new Set(),socketClosures=new Map(),checkpoints=new Map();
  const beginListenerClose=()=>{
    if(!server||listenerClosed||listenerAttempt)return;
    listenerAttempt=new Promise((resolve,reject)=>{
      try{server.close(error=>{
        if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')reject(error);
        else{listenerClosed=true;resolve();}
      });}catch(error){if(error.code==='ERR_SERVER_NOT_RUNNING'){listenerClosed=true;resolve();}else reject(error);}
    });
    listenerAttempt.catch(()=>{});
  };
  const close=()=>{
    if(closed)return Promise.resolve();
    if(closePromise)return closePromise;
    closing=true;
    closePromise=(async()=>{
      beginListenerClose();
      let first=null;
      try{server?.closeIdleConnections();}catch(error){first=error;}
      while(pending.size)await Promise.allSettled([...pending]);
      while(checkpoints.size)await Promise.allSettled([...checkpoints.values()]);
      // A failed runtime/store close deliberately keeps the original lease.
      // The next attempt closes these same acquired objects.
      if(workspace)await workspace.close();
      else{if(runtime)await runtime.close();if(store)store.close();}
      for(const socket of sockets)socket.destroy();
      while(socketClosures.size)await Promise.allSettled([...socketClosures.values()]);
      if(listenerAttempt){
        try{await listenerAttempt;}catch(error){listenerAttempt=null;throw error;}
      }
      if(!leaseClosed){await lease.close();leaseClosed=true;}
      closed=true;
      if(first)throw first;
    })().catch(error=>{closePromise=null;throw error;});
    return closePromise;
  };
  const failedApplication={close};
  try{
    const selected=await selectRuntime({runtimeReadyFile});
    for(const file of APPLICATION_MANIFEST){const current=hashFile(join(SOURCE_ROOT,file.path));requireValue(current.sha256===file.sha256&&current.bytes===file.bytes,'APPLICATION_SOURCE_CHANGED','The complete source changed after this server module was loaded. Reopen the original selected application.',409,{path:file.path});}
    const buildPath=join(SOURCE_ROOT,'dist/build-manifest.json');requireValue(existsSync(buildPath),'BROWSER_BUILD_MISSING','Run the original installed browser build before opening this application.',503);
    const build=JSON.parse(readFileSync(buildPath,'utf8'));requireValue(build.schema==='tjlabs.tiptap-browser-build.v1'&&build.runtimeSelectionSha256===selected.selectionSha256,'BROWSER_BUILD_SELECTION','The browser bundle belongs to another selected runtime.',409);
    for(const file of [...build.inputs,build.output]){requireValue(typeof file.path==='string'&&!file.path.startsWith('/')&&!file.path.split('/').includes('..'),'BROWSER_BUILD_PATH','A selected browser source path is invalid.',409);const observed=hashFile(join(SOURCE_ROOT,file.path));requireValue(observed.sha256===file.sha256&&observed.bytes===file.bytes,'BROWSER_BUILD_CHANGED','Rebuild the exact selected browser source before starting the application.',409,{path:file.path});}
    try{store=new Store(root,{lease});}catch(error){if(error.store)store=error.store;throw error;}
    const auth=new Auth({directory:root,authFile:authFile?resolve(authFile):undefined,contextForRequest});
    if(authFile)auth.config();
    runtime=new NativeRuntime({store,auth,selection:{...publicSelection(selected),applicationSourceSha256:APPLICATION_SOURCE_SHA256}});
    workspace=new Workspace({store,runtime,sourceRoot:SOURCE_ROOT,sourceFiles:APPLICATION_SOURCE});workspace.jobs=new Jobs(workspace);workspace.archives=new Archives(workspace);
    const checkpointDownload=async(projectId,checkpoint)=>{
      const key=projectId+':'+checkpoint.id;if(checkpoints.has(key))return checkpoints.get(key);
      const task=(async()=>{
        const output=join(root,'derived-downloads');mkdirSync(output,{recursive:true,mode:0o700});
        const filename=checkpoint.id+'.ndjson.gz',path=join(output,filename),binding=join(output,checkpoint.id+'.json');
        const expected=sha(Buffer.from(canonical(checkpoint)));
        if(existsSync(path)&&existsSync(binding)){
          const retained=JSON.parse(readFileSync(binding,'utf8')),actual=hashFile(path);
          requireValue(retained.checkpointSha256===expected&&retained.sha256===actual.sha256&&retained.bytes===actual.bytes,'CHECKPOINT_DOWNLOAD_CHANGED','The exact retained checkpoint download changed.',409);
          return {path,filename,mediaType:'application/gzip',...actual};
        }
        if(existsSync(path))unlinkSync(path);
        const partial=path+'.pending',digest=createHash('sha256');let count=0;
        async function* rows(){
          const add=row=>{const bytes=Buffer.from(canonical(row)+'\n');digest.update(bytes);count++;return bytes;};
          yield add({type:'checkpoint',schema:'tjlabs.tiptap-checkpoint.v1',projectId,checkpoint});
          for(const file of checkpoint.files){const bytes=store.objects.read(file.sha256,file.bytes);
            yield add({type:'file',...file,encoding:'base64',content:bytes.toString('base64')});}
          yield Buffer.from(canonical({type:'end',records:count,sha256:digest.digest('hex')})+'\n');
        }
        await pipeline(Readable.from(rows()),createGzip({level:6,mtime:0}),createWriteStream(partial,{flags:'w',mode:0o600}));
        const fd=await open(partial,'r');try{await fd.sync();}finally{await fd.close();}
        lease.assert();renameSync(partial,path);fsyncDirectory(output);const info=hashFile(path);
        const {atomicJson}=await import('./core/common.mjs');atomicJson(binding,{checkpointSha256:expected,...info},{immutable:true});
        return {path,filename,mediaType:'application/gzip',...info};
      })();checkpoints.set(key,task);try{return await task;}finally{if(checkpoints.get(key)===task)checkpoints.delete(key);}
    };
    const handle=async(request,response)=>{
      requireValue(!closing,'APPLICATION_CLOSING','The original application is closing.',503);
      lease.assert();const url=new URL(request.url,'http://localhost'),path=url.pathname,method=request.method;
      if(method==='GET'&&(path==='/'||path==='/operator')){
        response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        return sendFile(response,join(SOURCE_ROOT,'web/index.html'),{filename:'index.html',mediaType:'text/html; charset=utf-8',attachment:false});
      }
      if(method==='GET'&&path==='/assets/app.js'){
        requireValue(existsSync(join(SOURCE_ROOT,'dist/app.js')),'BROWSER_BUILD_MISSING','Run the original installer/build command before serving the editor.',503);
        return sendFile(response,join(SOURCE_ROOT,'dist/app.js'),{filename:'app.js',mediaType:'text/javascript; charset=utf-8',attachment:false});
      }
      if(method==='GET'&&path==='/assets/style.css')return sendFile(response,join(SOURCE_ROOT,'web/style.css'),{filename:'style.css',mediaType:'text/css; charset=utf-8',attachment:false});
      if(method==='GET'&&path==='/operator-guide')return sendFile(response,join(SOURCE_ROOT,'OPERATOR.md'),{filename:'OPERATOR.md',mediaType:'text/markdown; charset=utf-8'});
      if(method==='GET'&&path==='/health')return sendJson(response,200,{status:'ready'});
      const actor=await auth.actor(request);
      if(method==='GET'&&path==='/api/session')return sendJson(response,200,{instanceId:store.instanceId,actor,permissions:permissions(actor),limits:{uploadBytes:UPLOAD_LIMIT,chunkBytes:CHUNK_LIMIT,documentBytes:DOCUMENT_LIMIT},runtime:publicSelection(selected)});
      if(path==='/api/projects'){
        if(method==='GET')return sendJson(response,200,await workspace.list(actor));
        if(method==='POST')return sendJson(response,201,workspace.create(actor,await json(request)));
      }
      const requestMatch=/^\/api\/requests\/([^/]+)$/.exec(path);
      if(method==='GET'&&requestMatch)return sendJson(response,200,workspace.requestReceipt(actor,matchId(requestMatch[1],'requestId')));
      if(method==='POST'&&path==='/api/actions')return sendJson(response,200,await workspace.dispatch(actor,await json(request,16*1024*1024)));
      if(method==='POST'&&path==='/api/uploads'){requireOperator(actor);return sendJson(response,200,await workspace.uploads.start(actor,await json(request)));}
      let match=/^\/api\/uploads\/([^/]+)(\/finish)?$/.exec(path);
      if(match){
        requireOperator(actor);const uploadId=matchId(match[1],'uploadId');
        if(method==='GET'&&!match[2])return sendJson(response,200,await workspace.uploads.status(actor,uploadId));
        if(method==='PATCH'&&!match[2]){
          const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(request.headers['content-range']??'');
          requireValue(range,'UPLOAD_RANGE','Use the exact original Content-Range for this chunk.',400);
          const value={start:Number(range[1]),end:Number(range[2]),total:Number(range[3]),sha256:request.headers['x-chunk-sha256']};
          return sendJson(response,200,await workspace.uploads.chunk(actor,uploadId,value,await body(request,CHUNK_LIMIT)));
        }
        if(method==='POST'&&match[2]){await body(request,1024);return sendJson(response,200,await workspace.uploads.finish(actor,uploadId));}
      }
      match=/^\/api\/projects\/([^/]+)$/.exec(path);
      if(match&&method==='GET')return sendJson(response,200,await workspace.read(actor,matchId(match[1],'projectId'),revisionOf(url)));
      match=/^\/api\/projects\/([^/]+)\/documents$/.exec(path);
      if(match&&method==='GET'){const view=await workspace.read(actor,matchId(match[1],'projectId'),revisionOf(url));return sendJson(response,200,{documents:view.documents});}
      match=/^\/api\/projects\/([^/]+)\/documents\/([^/]+)\/(session|persistence)$/.exec(path);
      if(match){
        const projectId=matchId(match[1],'projectId'),documentId=matchId(match[2],'documentId');
        const {project,document}=workspace.document(actor,projectId,documentId);
        if(method==='POST'&&match[3]==='session'){
          const input=await json(request);requireValue(input&&Object.keys(input).length===0,'SESSION_INPUT','A native session is issued for the current original document; no alternate fields are accepted.');
          const deployment=project.deployments.find(d=>d.id===project.activeDeploymentId);
          requireValue(deployment&&runtime.has(projectId)&&runtime.status(projectId).state==='running','DEPLOYMENT_NOT_RUNNING','Start the selected original deployment before opening its live editor.',409);
          const session=auth.issue(project,document,actor,deployment.id,request),base=new URL(runtime.origin);base.protocol=base.protocol==='https:'?'wss:':'ws:';base.pathname='/collaboration/'+projectId;base.search='';base.hash='';
          return sendJson(response,200,{projectId,documentId,tenantId:document.tenantId,documentName:document.documentName,epochId:document.epochId,
            schemaId:document.schemaId,field:document.field,websocketUrl:base.href,actor:{id:actor.id,name:actor.name},deploymentId:deployment.id,...session});
        }
        if(method==='GET'&&match[3]==='persistence'){
          const persisted=store.nativeReceipt(projectId,documentId,document.epochId);
          return sendJson(response,200,{projectId,documentId,epochId:document.epochId,documentName:document.documentName,persisted,deploymentState:runtime.status(projectId).state,observedAt:now()});
        }
      }
      match=/^\/api\/projects\/([^/]+)\/(sources|handoffs|checkpoints)\/([^/]+)\/(content|download)$/.exec(path);
      if(match&&method==='GET'){
        requireOperator(actor);const projectId=matchId(match[1],'projectId'),view=store.get(projectId,revisionOf(url)),kind=match[2],item=choose(view[kind],matchId(match[3],'itemId'),kind.slice(0,-1));
        if(kind==='sources'&&match[4]==='content')return sendObject(store,response,item);
        if(kind==='handoffs'&&match[4]==='download')return sendObject(store,response,{...item,filename:item.filename??item.id+'.ndjson.gz',mediaType:'application/gzip'});
        if(kind==='checkpoints'&&match[4]==='download'){const file=await checkpointDownload(projectId,item);return sendFile(response,file.path,file);}
      }
      match=/^\/api\/projects\/([^/]+)\/jobs\/([^/]+)\/files\/([^/]+)$/.exec(path);
      if(match&&method==='GET'){
        requireOperator(actor);const project=store.get(matchId(match[1],'projectId'),revisionOf(url)),job=choose(project.jobs,matchId(match[2],'jobId'),'job'),file=choose(job.files,matchId(match[3],'fileId'),'file');return sendObject(store,response,file);
      }
      throw new DomainError('ROUTE_NOT_FOUND','The selected application route does not exist.',404);
    };
    server=createServer((request,response)=>{
      const task=handle(request,response).catch(error=>{
        if(!response.headersSent)sendJson(response,error.status??500,{error:publicError(error)});
        else response.destroy(error);
      });pending.add(task);task.finally(()=>pending.delete(task)).catch(()=>{});
    });
    server.requestTimeout=120000;server.headersTimeout=30000;
    server.on('connection',socket=>{
      let done;const ended=new Promise(resolve=>{done=resolve;});
      sockets.add(socket);socketClosures.set(socket,ended);
      socket.once('close',()=>{sockets.delete(socket);socketClosures.delete(socket);done();});
    });
    server.on('upgrade',(request,socket,head)=>{
      if(closing){socket.destroy();return;}
      const task=runtime.upgrade(request,socket,head).catch(()=>socket.destroy());
      pending.add(task);task.finally(()=>pending.delete(task)).catch(()=>{});
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
    const address=server.address(),origin=publicOrigin??'http://'+(host.includes(':')?'['+host+']':host)+':'+address.port;
    const parsedOrigin=new URL(origin);requireValue(['http:','https:'].includes(parsedOrigin.protocol)&&parsedOrigin.origin===origin&&!parsedOrigin.username&&!parsedOrigin.password,'PUBLIC_ORIGIN','Use one exact HTTP(S) public origin without a path or credentials.');
    runtime.setOrigin(origin);
    return {origin,instanceId:store.instanceId,close,workspace,identity:{sourceRoot:SOURCE_ROOT,runtime:publicSelection(selected)}};
  }catch(error){
    try{await close();}catch(cleanupError){
      // The caller can register/retry the exact failed startup owner.
      error.application=failedApplication;error.closeFailedApplication=close;
      error.applicationCleanupError=cleanupError;
    }
    throw error;
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];requireValue(key.startsWith('--'),'CLI_ARGUMENT','Use named original server arguments.');args[key.slice(2)]=process.argv[++i];}
  const app=await createApplicationServer({directory:args.directory,authFile:args.auth,host:args.host??'127.0.0.1',port:args.port===undefined?8785:Number(args.port),runtimeReadyFile:args['runtime-ready'],publicOrigin:args['public-origin']});
  process.stdout.write(JSON.stringify({origin:app.origin,instanceId:app.instanceId})+'\n');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)).catch(error=>{process.stderr.write(JSON.stringify({error:publicError(error)})+'\n');process.exitCode=1;}));
}
