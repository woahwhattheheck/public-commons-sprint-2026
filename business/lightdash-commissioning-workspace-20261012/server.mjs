import http from 'node:http';
import {promises as fs,createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import {parseArgs} from 'node:util';
import {pipeline} from 'node:stream/promises';
import {CommissioningWorkspace,problem,relativeFile,VERSION} from './workspace.mjs';
import * as nativeEngine from './native/index.mjs';
import {prepareHandover,inspectHandover,resumeHandover,readHandover} from './packaging.mjs';
const appRoot=path.dirname(fileURLToPath(import.meta.url));
const webRoot=path.join(appRoot,'web');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.zip':'application/zip','.csv':'text/csv; charset=utf-8'};
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req,limit){
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)throw problem('This complete request exceeds the configured upload allowance. Use the CLI for this source file.',413,'REQUEST_TOO_LARGE');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw problem('Send a complete JSON object.');}
}
function query(url,name,required=true){const value=url.searchParams.get(name);if(required&&!value)throw problem(name+' is required.');return value;}
async function sendFile(res,filename,{name,contentType,inline=false,expectedBytes}={}){
  const stat=await fs.stat(filename);if(!stat.isFile())throw problem('Select a regular artifact.',404,'FILE_NOT_FOUND');
  if(expectedBytes!==undefined&&Number(expectedBytes)!==stat.size)throw problem('The retained artifact changed.',409,'ARTIFACT_CHANGED');
  res.writeHead(200,{'Content-Type':contentType??MIME[path.extname(filename)]??'application/octet-stream','Content-Length':stat.size,
    'Content-Disposition':(inline?'inline':'attachment')+'; filename="'+String(name??path.basename(filename)).replace(/["\r\n\\]/g,'_')+'"','Cache-Control':'no-store'});
  await pipeline(createReadStream(filename),res);
}
async function nativeArtifact(workspace,operationId,artifactId){
  const op=workspace.operation(operationId),artifacts=op.nativeResult?.artifacts;
  const artifact=Array.isArray(artifacts)?artifacts.find(a=>a.id===artifactId):null;
  if(!artifact)throw problem('This operation has no such retained artifact.',404,'ARTIFACT_NOT_FOUND');
  const root=await fs.realpath(path.join(workspace.root,'operations',operationId,'native'));
  const selected=artifact.relativePath?path.join(root,relativeFile(artifact.relativePath)):artifact.path;
  const real=await fs.realpath(selected);
  if(!real.startsWith(root+path.sep))throw problem('The artifact is outside this original operation.',409,'ARTIFACT_CHANGED');
  return {artifact,file:real};
}
export async function createWorkspaceServer({workspace,port=8846,maxRequestBytes=64*1024*1024}={}){
  if(!workspace)throw new TypeError('An opened commissioning workspace is required.');
  const token=crypto.randomBytes(32).toString('hex'),packaging=new Map(),packagingJobs=new Map();
  let authority='',closing=false,closePromise=null;
  function beginHandover(id,fn,inspection=false){
    if(packagingJobs.has(id))return;
    const startedAt=new Date().toISOString();packaging.set(id,{id,state:'RUNNING',startedAt,inspection,localPending:true});
    const promise=Promise.resolve().then(fn).then(
      result=>packaging.set(id,{id,state:result.state,startedAt,inspection,result,localPending:false}),
      error=>packaging.set(id,{id,state:'INTERRUPTED',startedAt,inspection,error:{message:error.message,code:error.code??null},localPending:false})
    ).finally(()=>packagingJobs.delete(id));
    packagingJobs.set(id,promise);
  }
  function validHandoverId(id){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw problem('Select the original handover UUID.');return id;}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try{
      if(closing)throw problem('This workspace is closing after its original work finishes.',503,'WORKSPACE_CLOSING');
      const hosts=new Set([authority,authority.replace('127.0.0.1','localhost')]);
      if(!hosts.has(req.headers.host))throw problem('Open the local workspace address printed by this process.',403,'HOST_MISMATCH');
      const url=new URL(req.url,'http://'+authority);
      if(req.headers.origin){const origin=new URL(req.headers.origin);if(origin.protocol!=='http:'||!hosts.has(origin.host))throw problem('Use this workspace’s own local page.',403,'ORIGIN_MISMATCH');}
      if(!['GET','HEAD'].includes(req.method)&&req.headers['x-workspace-token']!==token)throw problem('Reload the local workspace page before making changes.',403,'SESSION_CHANGED');
      if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,await workspace.state());
      if(req.method==='GET'&&url.pathname==='/api/manifest')return json(res,200,url.searchParams.get('draft')==='true'?await workspace.draftManifest({expectedDraftId:query(url,'expectedDraftId',false)??undefined}):await workspace.editionManifest(query(url,'editionId')));
      if(req.method==='GET'&&url.pathname==='/api/compare')return json(res,200,await workspace.compare(query(url,'baselineId'),query(url,'candidateId')));
      if(req.method==='GET'&&url.pathname==='/api/source'){
        const source=await workspace.readSource({editionId:query(url,'editionId',false),draft:url.searchParams.get('draft')==='true',expectedDraftId:query(url,'expectedDraftId',false)??undefined,path:query(url,'path')});
        if(url.searchParams.get('download')==='true'){
          if(source.absolutePath)return await sendFile(res,source.absolutePath,{name:path.basename(source.path),expectedBytes:source.bytes});
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+path.basename(source.path).replace(/["\r\n\\]/g,'_')+'"','Content-Length':source.bytes});return res.end(source.content);
        }
        let content=source.content;
        if(content===undefined){const complete=await fs.readFile(source.absolutePath);try{content=new TextDecoder('utf-8',{fatal:true}).decode(complete);}catch{throw problem('This is a binary file. Download its complete original bytes.',415,'BINARY_SOURCE');}if(content.includes('\0'))throw problem('This is a binary file. Download its complete original bytes.',415,'BINARY_SOURCE');}
        return json(res,200,{path:source.path,draftId:source.draftId,editionId:source.editionId,bytes:source.bytes,sha256:source.sha256,content});
      }
      if(req.method==='GET'&&url.pathname==='/api/operation'){
        const id=query(url,'id'),receivingContentExports=await workspace.contentExports(id);
        return json(res,200,{...workspace.operation(id),receivingContentExports,pending:workspace.inflight.has(id)});
      }
      if(req.method==='GET'&&url.pathname==='/api/artifact'){const {artifact,file}=await nativeArtifact(workspace,query(url,'operationId'),query(url,'id'));return await sendFile(res,file,{name:path.basename(artifact.relativePath??artifact.path),expectedBytes:artifact.bytes});}
      if(req.method==='GET'&&url.pathname==='/api/handover'){
        const id=validHandoverId(query(url,'id'));
        if(url.searchParams.get('download')==='true'){
          const result=JSON.parse(await fs.readFile(path.join(workspace.root,'handover',id,'result.json'),'utf8'));
          if(result.state!=='SUCCEEDED')throw problem('The complete handover is not yet available.',409,'HANDOVER_INCOMPLETE');
          return await sendFile(res,path.join(workspace.root,'handover',id,'Lightdash_Commissioning_Handover.zip'),{name:'Lightdash_Commissioning_Handover.zip',expectedBytes:result.archive.bytes});
        }
        if(packagingJobs.has(id))return json(res,200,{...packaging.get(id),localPending:true});
        let retained;try{retained=await readHandover({workspace,id});}catch(error){if(!packaging.has(id))throw error;}
        if(retained?.state==='SUCCEEDED')return json(res,200,retained);
        const local=packaging.get(id);
        return json(res,200,local?.error?{...retained,...local,localPending:false}:retained??local);
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/')){
        const data=await body(req,maxRequestBytes),revision=data.expectedRevision===undefined?undefined:Number(data.expectedRevision);
        if(url.pathname==='/api/configure')return json(res,200,workspace.configure(data,revision));
        if(url.pathname==='/api/intake')return json(res,201,await workspace.captureProject(data,revision));
        if(url.pathname==='/api/selection')return json(res,200,workspace.selectEditions(data,revision));
        if(url.pathname==='/api/draft')return json(res,201,await workspace.createDraft(data.editionId,revision));
        if(url.pathname==='/api/draft/select')return json(res,200,workspace.selectDraft(data.id,revision));
        if(url.pathname==='/api/draft/file')return json(res,200,await workspace.editDraft(data,revision));
        if(url.pathname==='/api/seal')return json(res,201,await workspace.sealDraft(data,revision));
        if(url.pathname==='/api/review')return json(res,201,workspace.saveReview(data,revision));
        if(url.pathname==='/api/plan')return json(res,201,await workspace.plan(data,revision));
        if(url.pathname==='/api/execute'||url.pathname==='/api/inspect'){
          const operation=workspace.operation(data.operationId);workspace.execute(data.operationId,{inspect:url.pathname==='/api/inspect'}).catch(()=>{});
          return json(res,202,{operationId:operation.id,state:'ACCEPTED',inspect:url.pathname==='/api/inspect'});
        }
        if(url.pathname==='/api/handover/inspect'||url.pathname==='/api/handover/resume'){
          const id=validHandoverId(data.id),inspection=url.pathname==='/api/handover/inspect';
          await readHandover({workspace,id});
          if(!inspection)await prepareHandover({workspace,appRoot,id,resume:true});
          beginHandover(id,()=>inspection?inspectHandover({workspace,appRoot,id}):resumeHandover({workspace,appRoot,id}),inspection);
          return json(res,202,{id,state:'ACCEPTED',inspection});
        }
        if(url.pathname==='/api/handover'){
          const id=validHandoverId(data.id??crypto.randomUUID());
          const request=await prepareHandover({workspace,appRoot,id,includeOperatorPrivate:data.includeOperatorPrivate===true,expectedRevision:revision});
          beginHandover(id,()=>resumeHandover({workspace,appRoot,id}));
          return json(res,202,{id,state:'ACCEPTED',workspaceRevision:request.workspaceRevision});
        }
      }
      if(req.method==='GET'&&url.pathname==='/'){const html=(await fs.readFile(path.join(webRoot,'index.html'),'utf8')).replace('__WORKSPACE_TOKEN__',token);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(html);}
      if(req.method==='GET'&&['/app.js','/style.css'].includes(url.pathname))return await sendFile(res,path.join(webRoot,url.pathname.slice(1)),{inline:true});
      if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{application:'lightdash-commissioning-workspace',version:VERSION,workspaceId:workspace.metadata().id});
      throw problem('This workspace route does not exist.',404,'NOT_FOUND');
    }catch(error){if(res.headersSent){res.destroy(error);return;}json(res,Number(error.status)||500,{error:{message:String(error.message??error),code:error.code??'WORKSPACE_ERROR'}});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(port),'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  authority='127.0.0.1:'+server.address().port;
  function close(){
    if(closePromise)return closePromise;
    closing=true;
    closePromise=(async()=>{
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
      while(workspace.inflight.size||packagingJobs.size)await Promise.allSettled([...workspace.inflight.values(),...packagingJobs.values()]);
    })();
    return closePromise;
  }
  return {server,url:'http://'+authority,workspace,close};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const {values}=parseArgs({options:{workspace:{type:'string'},port:{type:'string',default:'8846'},create:{type:'boolean',default:false},label:{type:'string',default:'Lightdash commissioning'}}});
  if(!values.workspace)throw new Error('Use --workspace /absolute/receiving-directory [--create] [--port 8846].');
  const workspace=await CommissioningWorkspace.open(values.workspace,{create:values.create,label:values.label,engine:nativeEngine});
  const running=await createWorkspaceServer({workspace,port:Number(values.port)});
  process.stdout.write(JSON.stringify({state:'LISTENING',url:running.url,workspaceId:workspace.metadata().id,workspace:workspace.root})+'\n');
  let stopping=false;
  const stop=async()=>{
    if(stopping)return;stopping=true;
    try{await running.close();workspace.close();}
    catch(error){process.stderr.write(JSON.stringify({state:'SHUTDOWN_ERROR',error:error.message})+'\n');process.exitCode=1;}
  };
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
