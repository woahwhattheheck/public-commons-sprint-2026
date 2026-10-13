import http from 'node:http';
import { createReadStream,existsSync,readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { Workspace } from './core/workspace.mjs';
import { Auth,permissions,requireOperator } from './core/auth.mjs';
import { CHUNK_LIMIT,UPLOAD_LIMIT } from './core/uploads.mjs';
import { DomainError,requireValue,id,integer,sha,publicError } from './core/common.mjs';
import { listAirbyteConnections,MigrationError } from './migration/index.mjs';
import { hashFile } from './core/objects.mjs';

const HERE=resolve(fileURLToPath(new URL('.',import.meta.url)));
const TYPES={'.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.md':'text/markdown; charset=utf-8'};
async function bytes(request,max){
  const chunks=[];let n=0;for await(const b of request){n+=b.length;requireValue(n<=max,'REQUEST_SIZE','The selected request exceeds the installed request limit.',413);chunks.push(b);}return Buffer.concat(chunks);
}
async function json(request,max=32*1024*1024){const body=await bytes(request,max);try{return JSON.parse(body.toString('utf8'));}catch{throw new DomainError('INVALID_JSON','Supply a complete JSON request.',400);}}
function reply(response,code,value,headers={}){
  const body=Buffer.from(JSON.stringify(value));response.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store',...headers});response.end(body);
}
function revision(url){if(!url.searchParams.has('revision'))return undefined;return integer(Number(url.searchParams.get('revision')),'revision');}
function artifact(response,descriptor,path,filename,mediaType){
  const actual=hashFile(path);requireValue(actual.sha256===descriptor.sha256&&actual.bytes===descriptor.bytes,'DOWNLOAD_IDENTITY','The exact retained download differs from its selected manifest.',409);
  response.writeHead(200,{'Content-Type':mediaType,'Content-Length':actual.bytes,'Content-Disposition':'attachment; filename="'+filename.replace(/["\r\n]/g,'_')+'"','X-Content-SHA256':actual.sha256,'ETag':'"'+actual.sha256+'"','Cache-Control':'no-store'});
  return pipeline(createReadStream(path),response);
}
async function consumer(workspace,projectId,url){
  await workspace.reconcile(projectId);const selection=workspace.consumerSelection(workspace.store.get(projectId));
  requireValue(selection,'CONSUMER_UNBOUND','A reviewed consumer selection is required before querying its actual database.',409);
  const streamId=url.searchParams.get('streamId')??selection.tables[0]?.streamId;
  requireValue(selection.tables.some(s=>s.streamId===streamId),'STREAM_NOT_SELECTED','The stream is not in the actual consumer binding.',404);
  const offset=integer(Number(url.searchParams.get('offset')??0),'offset'),limit=integer(Number(url.searchParams.get('limit')??100),'limit',{min:1,max:1000});
  return new Promise((yes,no)=>{
    const args=[join(workspace.sourceRoot,'native/consumer.py'),'--directory',workspace.directory,'--project',projectId,'--stream',streamId,'--offset',String(offset),'--limit',String(limit)];
    const child=spawn(workspace.runtime.python,args,{cwd:workspace.sourceRoot,stdio:['ignore','pipe','pipe']});let out='',err='';
    child.stdout.on('data',b=>{out+=b;if(out.length>32*1024*1024)child.kill();});child.stderr.on('data',b=>{err=(err+b).slice(-8000);});
    child.once('error',no);child.once('exit',code=>{try{requireValue(code===0,'CONSUMER_READ_FAILED','The selected actual consumer query did not complete.',409,{exitCode:code,detail:err});yes(JSON.parse(out));}catch(e){no(e);}});
  });
}
export async function createApplicationServer({directory,authFile,contextForRequest,runtimeReadyFile,python='python3',sourceRoot=HERE,sourceFiles,consumerRoot}={}){
  sourceRoot=resolve(sourceRoot);requireValue(sourceRoot===HERE,'SOURCE_BINDING','Run the original server from the selected complete source root.',409);
  const auth=new Auth({authFile,contextForRequest}),workspace=await Workspace.open({directory,sourceRoot,runtimeReadyFile,python,sourceFiles,consumerRoot});let origin=null,listenerClosed=false,workspaceClosed=false,closing=null;
  const server=http.createServer(async(request,response)=>{
    response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      const url=new URL(request.url,origin??'http://127.0.0.1'),parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if(request.method==='GET'&&(url.pathname==='/'||url.pathname==='/assets/app.js'||url.pathname==='/assets/style.css'||url.pathname==='/assets/sha256.mjs'||url.pathname==='/operator-guide')){
        const names={'/':'web/index.html','/assets/app.js':'web/app.mjs','/assets/style.css':'web/style.css','/assets/sha256.mjs':'web/sha256.mjs','/operator-guide':'OPERATOR.md'},path=join(sourceRoot,names[url.pathname]);requireValue(existsSync(path),'ASSET_MISSING','The selected complete source is missing an operator file.',404);
        const body=readFileSync(path),suffix='.'+path.split('.').at(-1);response.writeHead(200,{'Content-Type':TYPES[suffix]??'text/plain; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-cache'});response.end(body);return;
      }
      if(url.pathname==='/health'&&request.method==='GET'){reply(response,200,{status:closing||listenerClosed||workspaceClosed?'closing':'ready'});return;}
      requireValue(parts[0]==='api','ROUTE_NOT_FOUND','The selected application route does not exist.',404);
      if(!['GET','HEAD'].includes(request.method)&&request.headers.origin)requireValue(request.headers.origin===origin,'ORIGIN_REJECTED','Use this installation origin for an operator mutation.',403);
      const actor=await auth.actor(request);requireValue(permissions(actor).read,'READ_REQUIRED','Read permission is required.',403);
      if(parts[1]==='info'&&request.method==='GET'){reply(response,200,{schema:'tjlabs.sling-installation.v1',instanceId:workspace.store.instanceId,actor,permissions:permissions(actor),runtime:workspace.runtime.publicSelection(),limits:{upload:UPLOAD_LIMIT,chunk:CHUNK_LIMIT,json:32*1024*1024},guide:'/operator-guide'});return;}
      if(parts[1]==='projects'&&parts.length===2){
        if(request.method==='GET'){reply(response,200,workspace.list(actor));return;}
        if(request.method==='POST'){reply(response,200,workspace.create(actor,await json(request)));return;}
      }
      if(parts[1]==='uploads'){
        requireOperator(actor);
        if(parts.length===2&&request.method==='POST'){reply(response,200,await workspace.uploads.start(actor,await json(request)));return;}
        const uploadId=id(parts[2],'uploadId');
        if(parts.length===3&&request.method==='GET'){reply(response,200,await workspace.uploads.status(actor,uploadId));return;}
        if(parts.length===3&&request.method==='PUT'){
          const range=/^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/.exec(request.headers['content-range']??'');requireValue(range,'UPLOAD_RANGE','Supply the exact original Content-Range.',409);
          reply(response,200,await workspace.uploads.chunk(actor,uploadId,{start:Number(range[1]),end:Number(range[2]),total:Number(range[3]),sha256:request.headers['x-chunk-sha256']},await bytes(request,CHUNK_LIMIT)));return;
        }
        if(parts.length===4&&parts[3]==='finish'&&request.method==='POST'){reply(response,200,await workspace.uploads.finish(actor,uploadId));return;}
      }
      if(parts[1]==='projects'&&parts.length>=3){
        const projectId=id(parts[2],'projectId'),rev=revision(url);
        if(parts.length===3&&request.method==='GET'){reply(response,200,await workspace.get(actor,projectId,rev));return;}
        if(parts[3]==='actions'&&parts.length===4&&request.method==='POST'){
          const input=await json(request);requireValue(input.projectId===undefined||input.projectId===projectId,'PROJECT_SCOPE','The body identifies another project.',409);reply(response,200,await workspace.dispatch(actor,{...input,projectId}));return;
        }
        if(parts[3]==='sources'&&parts.length>=5&&request.method==='GET'){
          const source=workspace.sourceDescriptor(actor,projectId,id(parts[4]),rev);
          if(parts[5]==='connections'){
            requireValue(source.bytes<=32*1024*1024,'SOURCE_SIZE','Download the full source for larger structured data.',413);const document=JSON.parse(workspace.store.objects.read(source.sha256,source.bytes));reply(response,200,{sourceId:source.id,sourceSha256:source.sha256,connections:listAirbyteConnections(document).map(({document,...row})=>row)});return;
          }
          if(parts.length===5){await artifact(response,source,workspace.store.objects.path(source.sha256),source.filename,source.mediaType);return;}
        }
        if(parts[3]==='outputs'&&parts.length===6&&request.method==='GET'){
          const item=await workspace.readObject(actor,projectId,parts[4],id(parts[5]),rev);await artifact(response,item.descriptor,item.path,item.filename,item.mediaType);return;
        }
        if(parts[3]==='downstream'&&parts.length===5&&request.method==='GET'){
          const item=workspace.readDownstream(actor,projectId,id(parts[4]),url.searchParams.get('path'),rev);await artifact(response,item.descriptor,item.path,item.filename,item.mediaType);return;
        }
        if(parts[3]==='native'&&parts.length===5&&request.method==='GET'){
          const item=workspace.readNative(actor,projectId,id(parts[4]),url.searchParams.get('path'),rev);await artifact(response,item.descriptor,item.path,item.filename,item.mediaType);return;
        }
        if(parts[3]==='consumer'&&parts.length===4&&request.method==='GET'){
          requireValue(rev===undefined,'CURRENT_CONSUMER_REQUIRED','The consumer endpoint reads its actual current binding. Use historical snapshots for earlier revisions.',409);
          reply(response,200,await workspace.serial(projectId,()=>consumer(workspace,projectId,url)));return;
        }
      }
      throw new DomainError('ROUTE_NOT_FOUND','The selected application route does not exist.',404);
    }catch(error){
      if(response.headersSent){response.destroy(error);return;}
      const detail=error instanceof MigrationError?{code:error.code,message:error.message,details:error.details}:publicError(error);
      reply(response,error.status??(error instanceof MigrationError?400:500),{error:detail});
    }
  });
  server.requestTimeout=120000;server.headersTimeout=30000;server.keepAliveTimeout=5000;
  return{server,workspace,async listen({host='127.0.0.1',port=0}={}){
    await new Promise((yes,no)=>{server.once('error',no);server.listen(port,host,yes);});
    const address=server.address();origin='http://'+(host.includes(':')?'['+host+']':host)+':'+address.port;return{origin,host,port:address.port,instanceId:workspace.store.instanceId};
  },async close(){
    if(listenerClosed&&workspaceClosed)return;
    if(closing)return closing;
    closing=(async()=>{
      if(!listenerClosed){await new Promise((yes,no)=>{server.close(error=>{if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')no(error);else yes();});server.closeIdleConnections();});listenerClosed=true;}
      if(!workspaceClosed){await workspace.close();workspaceClosed=true;}
    })();
    try{return await closing;}finally{closing=null;}
  }};
}
