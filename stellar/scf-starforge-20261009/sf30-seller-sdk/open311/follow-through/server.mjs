// MIT. Private loopback municipal follow-through operating desk with explicit saved-workspace binding.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { openWorkspace } from './workspace.mjs';
import { digest, fail, parseJson, MAX_PACKAGE_BYTES } from '../gis/shared.mjs';

export const STARTUP_SCHEMA='stellar-forge.open311-follow-through-startup.v1';
export const BINDING_SCHEMA='stellar-forge.open311-follow-through-binding.v1';
export const workspaceBinding=(directory,workspaceId)=>digest(JSON.stringify({directory,schema:BINDING_SCHEMA,workspaceId}));
const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/index.html',['index.html','text/html; charset=utf-8']],['/app.mjs',['app.mjs','text/javascript; charset=utf-8']],['/styles.css',['styles.css','text/css; charset=utf-8']]]);
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
function json(response,status,value){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});response.end(JSON.stringify(value));}
async function body(request){
  const maximum=MAX_PACKAGE_BYTES*2,chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>maximum)fail('REQUEST_TOO_LARGE','The complete local action exceeds 512 MiB.',413);chunks.push(chunk);}
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks));}catch{fail('INVALID_UTF8','The local JSON action is not valid UTF-8.');}
  return parseJson(text,'Local action');
}
export async function serveFollowThrough({directory,host='127.0.0.1',port=0,expectedWorkspaceId,expectedBindingSha256}={}){
  if(!['127.0.0.1','::1'].includes(host))fail('PRIVATE_HOST_REQUIRED','The follow-through desk listens on a loopback address.');
  port=Number(port);if(!Number.isInteger(port)||port<0||port>65535)fail('INVALID_PORT','Port must be 0–65535.');
  const workspace=openWorkspace(directory,{create:false}),initial=workspace.state(),bindingSha256=workspaceBinding(workspace.directory,initial.workspaceId);
  if(expectedWorkspaceId&&expectedWorkspaceId!==initial.workspaceId||expectedBindingSha256&&expectedBindingSha256!==bindingSha256){workspace.close();fail('WORKSPACE_BINDING_MISMATCH','The selected FollowThrough workspace differs from the original saved launch selection.',409);}
  const session=randomBytes(32).toString('hex'),cookieName='open311_follow_through_'+randomBytes(6).toString('hex'),instanceId=randomUUID(),startedAt=new Date().toISOString();
  const assetRoot=fileURLToPath(new URL('.',import.meta.url));let origin,closing=null;
  const launch=()=>{
    const current=workspace.state(),sha256=workspaceBinding(workspace.directory,current.workspaceId);
    return {schema:STARTUP_SCHEMA,state:'LISTENING',directory:workspace.directory,workspaceId:current.workspaceId,bindingSha256:sha256,
      binding:{schema:BINDING_SCHEMA,directory:workspace.directory,workspaceId:current.workspaceId,sha256},instanceId,startedAt,url:origin+'/'};
  };
  const server=createServer(async(request,response)=>{
    try{
      if(!origin||request.headers.host!==new URL(origin).host)fail('INVALID_HOST','Use the selected local FollowThrough address.',403);
      if(request.headers.origin&&request.headers.origin!==origin)fail('INVALID_ORIGIN','This action must originate in the selected follow-through desk.',403);
      const url=new URL(request.url,origin),params=url.searchParams;
      if(request.method==='GET'&&url.pathname==='/health'){json(response,200,{ok:true,application:'open311-follow-through',workspaceId:workspace.state().workspaceId});return;}
      if(request.method==='GET'&&url.pathname==='/api/launch'){json(response,200,launch());return;}
      if(request.method==='GET'&&assets.has(url.pathname)){
        const [filename,contentType]=assets.get(url.pathname),data=await readFile(join(assetRoot,filename));
        response.writeHead(200,{'Content-Type':contentType,...headers,
          'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          ...(url.pathname==='/'||url.pathname==='/index.html'?{'Set-Cookie':cookieName+'='+session+'; HttpOnly; SameSite=Strict; Path=/'}:{})});
        response.end(data);return;
      }
      const cookies=String(request.headers.cookie??'').split(';').map(value=>value.trim());
      if(!cookies.includes(cookieName+'='+session))fail('FOLLOW_THROUGH_SESSION_REQUIRED','Open the follow-through desk to begin a private local session.',403);
      const id=params.get('id'),paging={q:params.get('q')??'',...(params.has('offset')?{offset:Number(params.get('offset'))}:{}),...(params.has('limit')?{limit:Number(params.get('limit'))}:{})};
      if(request.method==='GET'){
        let value;
        if(url.pathname==='/api/state')value=workspace.state();
        else if(url.pathname==='/api/source')value=workspace.source(id);
        else if(url.pathname==='/api/source-rows')value=workspace.sourceRows({id,...paging});
        else if(url.pathname==='/api/profile')value=workspace.profile(id);
        else if(url.pathname==='/api/edition')value=workspace.edition(id);
        else if(url.pathname==='/api/requests')value=workspace.requests({editionId:params.get('editionId'),...paging,discrepancy:params.get('discrepancy')??'',assignee:params.get('assignee')??'',workStatus:params.get('workStatus')??''});
        else if(url.pathname==='/api/request')value=workspace.request({editionId:params.get('editionId'),key:params.get('key')});
        else if(url.pathname==='/api/orders')value=workspace.orders({editionId:params.get('editionId'),...paging});
        else if(url.pathname==='/api/changes')value=workspace.changes({before:params.get('before'),after:params.get('after'),entity:params.get('entity')??'requests',...paging});
        else if(url.pathname==='/api/work')value=workspace.work(id);
        else if(url.pathname==='/api/work-queue')value=workspace.workQueue({editionId:params.get('editionId'),approval:params.get('approval')??'',assignee:params.get('assignee')??'',status:params.get('status')??'',...paging});
        else if(url.pathname==='/api/return')value=workspace.returned(id,{...(params.has('targetEditionId')?{targetEditionId:params.get('targetEditionId')}:{})});
        else if(url.pathname==='/api/dispatch')value=workspace.dispatch(id);
        else if(url.pathname==='/api/operation')value=workspace.operation(params.get('requestId'));
        else if(url.pathname==='/api/export'){
          const input={kind:params.get('kind')??'workspace'};
          for(const key of ['editionId','dispatchId','sourceId','fileId','returnId'])if(params.has(key)&&params.get(key))input[key]=params.get(key);
          if(params.has('expectedRevision'))input.expectedRevision=Number(params.get('expectedRevision'));
          const file=workspace.exportFile(input);
          response.writeHead(200,{'Content-Type':file.contentType,...headers,'Content-Disposition':'attachment; filename="'+file.filename.replace(/["\r\n]/g,'_')+'"',
            'Content-Length':file.bytes,'X-Content-SHA256':file.sha256});
          response.end(file.body);return;
        }else fail('ROUTE_NOT_FOUND','This follow-through route was not found.',404);
        json(response,200,{ok:true,value});return;
      }
      if(request.method==='POST'){
        if(!String(request.headers['content-type']??'').toLowerCase().startsWith('application/json'))fail('JSON_CONTENT_TYPE_REQUIRED','Follow-through actions use application/json.',415);
        const input=await body(request);let value;
        if(url.pathname==='/api/inspect-source')value=workspace.inspectSource(input.originalText,input);
        else if(url.pathname==='/api/import')value=workspace.importSource(input);
        else if(url.pathname==='/api/profile')value=workspace.putProfile(input);
        else if(url.pathname==='/api/build')value=workspace.build(input);
        else if(url.pathname==='/api/link')value=workspace.putLink(input);
        else if(url.pathname==='/api/work')value=workspace.putWork(input);
        else if(url.pathname==='/api/review-import')value=workspace.importReview(input);
        else if(url.pathname==='/api/review-apply')value=workspace.applyReview(input);
        else if(url.pathname==='/api/dispatch')value=workspace.putDispatch(input);
        else if(url.pathname==='/api/receive')value=workspace.receive(input);
        else fail('ROUTE_NOT_FOUND','This follow-through route was not found.',404);
        json(response,200,{ok:true,value});return;
      }
      fail('METHOD_NOT_ALLOWED','Choose GET or POST for this follow-through route.',405);
    }catch(error){
      if(!response.headersSent)json(response,Number.isInteger(error.status)?error.status:500,{ok:false,error:{code:error.code??'FOLLOW_THROUGH_ERROR',message:error.message,details:error.details??null}});
      else response.destroy(error);
    }
  });
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
    origin='http://'+(host==='::1'?'['+host+']':host)+':'+server.address().port;
    const startup=launch();
    return {server,workspace,url:origin+'/',startup,get launch(){return launch();},
      close(){if(!closing)closing=new Promise((resolve,reject)=>{server.close(error=>{workspace.close();error?reject(error):resolve();});server.closeIdleConnections?.();});return closing;}};
  }catch(error){workspace.close();throw error;}
}
export function startFollowThroughServer({workspace,...options}={}){return serveFollowThrough({directory:workspace,...options});}
