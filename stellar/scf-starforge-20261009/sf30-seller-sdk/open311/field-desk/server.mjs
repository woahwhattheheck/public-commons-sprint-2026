// MIT. Loopback HTTP field desk with saved-workspace identity and retained mutations.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openWorkspace } from './workspace.mjs';
import { digest,fail,parseJson,MAX_PACKAGE_BYTES } from '../gis/shared.mjs';

export const STARTUP_SCHEMA='stellar-forge.open311-field-desk-startup.v1';
export const BINDING_SCHEMA='stellar-forge.open311-field-desk-binding.v1';
export const workspaceBinding=(directory,workspaceId)=>digest(JSON.stringify({directory,schema:BINDING_SCHEMA,workspaceId}));
const assetRoot=fileURLToPath(new URL('./',import.meta.url));
const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/index.html',['index.html','text/html; charset=utf-8']],['/app.mjs',['app.mjs','text/javascript; charset=utf-8']],['/styles.css',['styles.css','text/css; charset=utf-8']]]);
const safeHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'};
function json(response,status,value){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...safeHeaders});response.end(JSON.stringify(value));}
async function body(request){
  let size=0;const chunks=[],maximum=MAX_PACKAGE_BYTES*2;
  for await(const chunk of request){size+=chunk.length;if(size>maximum)fail('REQUEST_TOO_LARGE','The complete local field action exceeds 512 MiB.',413);chunks.push(chunk);}
  let source;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks));}catch{fail('INVALID_UTF8','The local action must be complete valid UTF-8.');}
  return parseJson(source,'Local field-desk action');
}
function sendFile(response,file){
  const filename=file.filename.replace(/["\r\n\\]/g,'_').replace(/[^\x20-\x7e]/g,'_');
  response.writeHead(200,{...safeHeaders,'Content-Type':file.contentType,'Content-Disposition':'attachment; filename="'+filename+'"','Content-Length':file.bytes,'X-Content-SHA256':file.sha256});
  response.end(file.body);
}
export async function serveFieldDesk({directory,host='127.0.0.1',port=0,expectedWorkspaceId,expectedBindingSha256}={}){
  if(!['127.0.0.1','::1'].includes(host))fail('PRIVATE_HOST_REQUIRED','The field desk listens on a loopback address.');
  port=Number(port);if(!Number.isInteger(port)||port<0||port>65535)fail('INVALID_PORT','Port must be between 0 and 65535.');
  const workspace=openWorkspace(directory,{create:false}),initial=workspace.state(),initialBinding=workspaceBinding(workspace.directory,initial.workspaceId);
  if(expectedWorkspaceId&&expectedWorkspaceId!==initial.workspaceId||expectedBindingSha256&&expectedBindingSha256!==initialBinding){workspace.close();fail('WORKSPACE_BINDING_MISMATCH','The selected field workspace differs from the saved Application identity.',409);}
  const startedAt=new Date().toISOString(),instanceId=randomUUID();let origin='',closing=null;
  const launch=()=>{
    const current=workspace.state(),bindingSha256=workspaceBinding(workspace.directory,current.workspaceId);
    return {schema:STARTUP_SCHEMA,state:'LISTENING',directory:workspace.directory,workspaceId:current.workspaceId,bindingSha256,binding:{schema:BINDING_SCHEMA,directory:workspace.directory,workspaceId:current.workspaceId,sha256:bindingSha256},instanceId,startedAt,url:origin+'/'};
  };
  const server=createServer(async(request,response)=>{
    try{
      if(request.headers.host!==new URL(origin).host)fail('HOST_MISMATCH','Use this field desk through its exact loopback host and port.',403);
      const incomingOrigin=request.headers.origin;if(incomingOrigin!==undefined&&incomingOrigin!==origin)fail('ORIGIN_MISMATCH','Use the field desk from its own loopback origin.',403);
      if(request.headers['sec-fetch-site']==='cross-site')fail('CROSS_SITE_REQUEST','Use the field desk from its own page or configured local client.',403);
      const url=new URL(request.url,origin),params=url.searchParams,id=params.get('id');
      const paging={q:params.get('q')??'',...(params.has('offset')?{offset:Number(params.get('offset'))}:{}),...(params.has('limit')?{limit:Number(params.get('limit'))}:{})};
      if(request.method==='GET'){
        if(assets.has(url.pathname)){
          const [filename,contentType]=assets.get(url.pathname),content=await readFile(join(assetRoot,filename));
          response.writeHead(200,{...safeHeaders,'Content-Type':contentType,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});response.end(content);return;
        }
        let value;
        if(url.pathname==='/health'){const current=workspace.state();value={schema:'commons.open311.field-desk-health.v1',state:'READY',workspaceId:current.workspaceId,revision:current.revision};}
        else if(url.pathname==='/api/launch')value=launch();
        else if(url.pathname==='/api/state')value=workspace.state();
        else if(url.pathname==='/api/operation')value=workspace.operation(params.get('requestId'));
        else if(url.pathname==='/api/source')value=workspace.source(id);
        else if(url.pathname==='/api/source-rows')value=workspace.sourceRows({sourceId:params.get('sourceId'),...paging});
        else if(url.pathname==='/api/crew')value=workspace.crew(id);
        else if(url.pathname==='/api/visits')value=workspace.visits({...paging,sourceId:params.get('sourceId')??'',crewId:params.get('crewId')??'',status:params.get('status')??''});
        else if(url.pathname==='/api/visit')value=workspace.visit(id);
        else if(url.pathname==='/api/package')value=workspace.package(id);
        else if(url.pathname==='/api/return')value=workspace.returned(id);
        else if(url.pathname==='/api/update')value=workspace.update(id);
        else if(url.pathname==='/api/attachment'){sendFile(response,workspace.attachment(id));return;}
        else if(url.pathname==='/api/export'){
          const selection={kind:params.get('kind')??'workspace'};
          for(const key of ['sourceId','packageId','returnId','updateId','crewId','status','q'])if(params.has(key)&&params.get(key))selection[key]=params.get(key);
          if(params.has('expectedRevision'))selection.expectedRevision=Number(params.get('expectedRevision'));
          sendFile(response,workspace.exportFile(selection));return;
        }else fail('ROUTE_NOT_FOUND','This field-desk route was not found.',404);
        json(response,200,value);return;
      }
      if(request.method==='POST'){
        if(!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type']??'')))fail('JSON_CONTENT_TYPE_REQUIRED','Field-desk actions use application/json.',415);
        const input=await body(request),current=workspace.state(),suppliedId=request.headers['x-open311-field-desk-workspace'];
        let allowed=suppliedId===current.workspaceId;
        if(!allowed&&url.pathname==='/api/receive'&&typeof input.requestId==='string'){
          const prior=workspace.operation(input.requestId);
          allowed=prior?.kind==='workspace-receive'&&prior.result.receivedFrom?.destinationWorkspaceId===suppliedId;
        }
        if(!allowed)fail('WORKSPACE_IDENTITY_MISMATCH','Refresh this page for the current field workspace identity.',409,{workspaceId:current.workspaceId});
        let value;
        if(url.pathname==='/api/source-inspect')value=workspace.inspectSource(input.originalText,input);
        else if(url.pathname==='/api/sources')value=workspace.importSource(input);
        else if(url.pathname==='/api/crews')value=workspace.putCrew(input);
        else if(url.pathname==='/api/visits')value=workspace.putVisit(input);
        else if(url.pathname==='/api/attachments')value=workspace.putAttachment(input);
        else if(url.pathname==='/api/packages')value=workspace.createPackage(input);
        else if(url.pathname==='/api/returns')value=workspace.importReturn(input);
        else if(url.pathname==='/api/decisions')value=workspace.applyDecisions(input);
        else if(url.pathname==='/api/visit-reviews')value=workspace.reviewVisits(input);
        else if(url.pathname==='/api/updates')value=workspace.createUpdate(input);
        else if(url.pathname==='/api/receive')value=workspace.receive(input);
        else fail('ROUTE_NOT_FOUND','This field-desk action was not found.',404);
        json(response,200,value);return;
      }
      response.setHeader('Allow','GET, POST');fail('METHOD_NOT_ALLOWED','Use GET or POST for this field-desk route.',405);
    }catch(error){
      if(!response.headersSent)json(response,Number.isInteger(error.status)?error.status:500,{error:{code:error.code??'FIELD_DESK_ERROR',message:error.message,details:error.details??null}});
      else response.destroy(error);
    }
  });
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
    origin='http://'+(host==='::1'?'['+host+']':host)+':'+server.address().port;
    return {server,workspace,url:origin+'/',startup:launch(),get launch(){return launch();},close(){if(!closing)closing=new Promise((resolve,reject)=>{server.close(error=>{workspace.close();error?reject(error):resolve();});server.closeIdleConnections?.();});return closing;}};
  }catch(error){workspace.close();throw error;}
}
export function startFieldDeskServer({workspace,...options}={}){return serveFieldDesk({directory:workspace,...options});}
