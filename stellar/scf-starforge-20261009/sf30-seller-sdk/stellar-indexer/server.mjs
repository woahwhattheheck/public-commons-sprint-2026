// MIT. Industrial client operator over the original Indexer and Soroban engines.
import {createServer} from 'node:http';
import {promises as fs} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readBrowserAssets} from '../../distribution/browser-assets.mjs';
import {openStellarIndexerOperator,need,plain,exactInteger,publicOperatorError} from './operator.mjs';

const ASSETS=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url));
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const STATUS={NOT_FOUND:404,REVISION_CONFLICT:409,REQUEST_CONFLICT:409,SOURCE_CONFLICT:409,
  WORKSPACE_BUSY:409,WATCH_BUSY:409,WATCH_REQUEST_PENDING:409,CAPTURE_BUSY:409,CONNECTION_REQUIRED:409,CAPTURE_INCOMPLETE:409,WORKSPACE_ID_MISMATCH:409,
  WORKSPACE_CLOSED:503,WATCH_CLOSED:503,BODY_TOO_LARGE:413,CONTENT_TYPE:415};
const numeric=(args,key,fallback)=>args[key]===undefined?fallback:exactInteger(Number(args[key]),key);
function send(res,status,value,type='application/json; charset=utf-8',headers={}){
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
  res.writeHead(status,{'content-type':type,'content-length':bytes.length,'cache-control':'no-store',
    'x-content-type-options':'nosniff','content-security-policy':CSP,...headers});res.end(bytes);
}
async function json(req){
  need((req.headers['content-type']??'').split(';')[0].trim()==='application/json','CONTENT_TYPE','Use application/json for an operator operation.');
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;need(bytes<=4*1024*1024,'BODY_TOO_LARGE','The operator input exceeds 4 MiB.');chunks.push(chunk);}
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{need(false,'INVALID_JSON','Send complete UTF-8 JSON.');}
  need(plain(value),'INVALID_ARGUMENT','Send one complete JSON object.');return value;
}
function authenticated(req,token){
  const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+token);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
function rangeArgs(args){return {exportId:args.exportId,path:args.path,
  ...(args.offset===undefined?{}:{offset:numeric(args,'offset')}),
  ...(args.length===undefined?{}:{length:numeric(args,'length')})};}
async function sourceResponse(res,source,args){
  const result=await source.sourceFile(rangeArgs(args));
  need(Buffer.isBuffer(result.content),'SOURCE_FILE_CHANGED','The original reader did not return complete source bytes.');
  const name=String(result.path??args.path).split('/').at(-1).replace(/[^A-Za-z0-9._-]/g,'_')||'source';
  send(res,200,result.content,result.contentType??'application/octet-stream',
    {'content-disposition':'attachment; filename="'+name+'"','x-source-sha256':result.sha256,
      'x-source-bytes':String(result.bytes),'x-source-offset':String(result.offset??0)});
}
function watchInput(host,body){
  const value={...body};
  if(Object.hasOwn(value,'publicationAlias')){
    need(value.publication===undefined,'INVALID_ARGUMENT','Select the publication destination once.');
    value.publication=host.publication(value.publicationAlias);delete value.publicationAlias;
  }
  if(value.publication!==undefined&&value.publication!==null)
    need(Object.values(host.eventPublications).some(p=>p.directory===value.publication.directory),
      'INVALID_ARGUMENT','Select a configured host publication destination.');
  return value;
}
async function checkWorkspaceSelection(req,host,path){
  const operatorWorkspaceId=req.headers['x-stellar-indexer-workspace'];
  const sourceWorkspaceId=req.headers['x-stellar-source-workspace'];
  // Existing native clients keep their current API. A browser retry supplies
  // both original identities so a reused port cannot redirect its operation.
  if(operatorWorkspaceId===undefined&&sourceWorkspaceId===undefined)return;
  need(typeof operatorWorkspaceId==='string'&&typeof sourceWorkspaceId==='string',
    'WORKSPACE_ID_MISMATCH','Supply both original workspace identities for this request.');
  const scope=path.startsWith('/api/watch/')?'watches':path.startsWith('/api/event/')?'events':'indexer';
  const current=await host.describe();
  need(current.indexer.workspaceId===operatorWorkspaceId&&current[scope].workspaceId===sourceWorkspaceId,
    'WORKSPACE_ID_MISMATCH','Open the original workspace for this retained request.');
}
export async function startStellarIndexerServer(options={}){
  const hostname=options.host??'127.0.0.1',port=options.port??0;
  need(['127.0.0.1','localhost','::1'].includes(hostname),'INVALID_HOST','The private operator binds to the local host.');
  exactInteger(port,'port',0,65535);
  const token=options.token??randomBytes(32).toString('base64url');
  need(typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token),'INVALID_ARGUMENT','Use the generated private operator session link.');
  const host=options.operator??await openStellarIndexerOperator(options),owned=!options.operator;
  const tasks=new Set();let origin,closing;
  const server=createServer((req,res)=>{
    const task=(async()=>{
      const url=new URL(req.url,origin??'http://127.0.0.1');
      if(!origin||req.headers.host!==new URL(origin).host)return send(res,421,{error:{code:'HOST_MISMATCH',message:'Open the original operator address.'}});
      if(req.headers.origin&&req.headers.origin!==origin)return send(res,403,{error:{code:'ORIGIN_MISMATCH',message:'Use the original operator page.'}});
      const asset=ASSETS.get(url.pathname);
      if(req.method==='GET'&&asset)return send(res,200,await fs.readFile(asset.url),asset.type);
      if(!url.pathname.startsWith('/api/'))return send(res,404,{error:{code:'NOT_FOUND',message:'Unknown operator route.'}});
      if(!authenticated(req,token))return send(res,401,{error:{code:'AUTH_REQUIRED',message:'Open the private operator session link.'}});
      const args=Object.fromEntries(url.searchParams),workspace=host.workspace;
      if(req.method==='GET'){
        if(url.pathname==='/api/state')return send(res,200,await host.describe());
        if(url.pathname==='/api/indexer')return send(res,200,await workspace.describe());
        if(url.pathname==='/api/capture')return send(res,200,await workspace.status({captureId:args.captureId}));
        if(url.pathname==='/api/edition')return send(res,200,await workspace.edition({editionId:args.editionId}));
        if(url.pathname==='/api/rows')return send(res,200,await workspace.rows({
          ...(args.captureId?{captureId:args.captureId}:{}),...(args.editionId?{editionId:args.editionId}:{}),
          offset:numeric(args,'offset',0),limit:numeric(args,'limit',100)}));
        if(url.pathname==='/api/compare')return send(res,200,await workspace.compare({
          beforeEditionId:args.beforeEditionId,afterEditionId:args.afterEditionId,
          offset:numeric(args,'offset',0),limit:numeric(args,'limit',100)}));
        if(url.pathname==='/api/source-file')return sourceResponse(res,workspace,args);
        if(url.pathname==='/api/event/source-file')return sourceResponse(res,host.events,args);
        if(url.pathname==='/api/watch/source-file')return sourceResponse(res,host.watches,args);
        if(url.pathname==='/api/event/capture')return send(res,200,await host.events.captureStatus({captureId:args.captureId}));
        if(url.pathname==='/api/event/rows')return send(res,200,await host.events.eventPage({
          captureId:args.captureId,after:args.after??null,limit:numeric(args,'limit',100),
          contractId:args.contractId||null,type:args.type||null}));
        if(url.pathname==='/api/event/edition')return send(res,200,await host.events.edition({editionId:args.editionId}));
        if(url.pathname==='/api/watch')return send(res,200,await host.watches.watchStatus({watchId:args.watchId}));
      }
      if(req.method==='POST'){
        await checkWorkspaceSelection(req,host,url.pathname);
        const body=await json(req);
        const simple=new Map([
          ['/api/query/save','querySave'],['/api/query/configure','queryConfigure'],
          ['/api/capture/pause','capturePause'],['/api/source/export','sourceExport'],
          ['/api/source/receive','sourceReceive'],['/api/delivery/export','deliveryExport'],
          ['/api/delivery/receive','deliveryReceive']
        ]);
        if(simple.has(url.pathname))return send(res,200,await workspace[simple.get(url.pathname)](body));
        if(url.pathname==='/api/capture/start'||url.pathname==='/api/capture/resume'){
          const method=url.pathname.endsWith('/start')?'captureStart':'captureResume';
          const result=await workspace[method](body),captureId=result.capture.id;
          return send(res,202,{...result,runner:host.startCapture(captureId)});
        }
        if(url.pathname==='/api/capture/run'){
          need(typeof body.captureId==='string','INVALID_ARGUMENT','Select the original capture.');
          const observed=await workspace.status({captureId:body.captureId});
          return send(res,202,{...observed,runner:host.startCapture(body.captureId,
            body.maxPages===undefined?{}:{maxPages:exactInteger(body.maxPages,'maxPages',1)})});
        }
        const eventMethods=new Map([
          ['/api/event/plan','planSave'],['/api/event/capture/start','captureStart'],
          ['/api/event/capture/resume','captureResume'],['/api/event/edition','editionCreate'],
          ['/api/event/export','sourceExport'],['/api/event/receive','sourceReceive']
        ]);
        if(eventMethods.has(url.pathname))return send(res,200,await host.events[eventMethods.get(url.pathname)](body));
        const watchMethods=new Map([
          ['/api/watch/save','watchSave'],['/api/watch/configure','watchConfigure'],
          ['/api/watch/start','watchStart'],['/api/watch/pause','watchPause'],
          ['/api/watch/repair','watchRepair'],['/api/watch/export','watchExport'],
          ['/api/watch/receive','watchReceive']
        ]);
        if(watchMethods.has(url.pathname)){
          const method=watchMethods.get(url.pathname);
          const result=await host.watches[method](watchInput(host,body));
          if(method==='watchStart'||method==='watchConfigure')host.startWatchRunner();
          return send(res,200,result);
        }
        if(url.pathname==='/api/watch/run')return send(res,200,await host.watches.watchRun(body));
        if(url.pathname==='/api/watch/runner/start')return send(res,200,{runner:host.startWatchRunner()});
      }
      send(res,404,{error:{code:'NOT_FOUND',message:'Unknown operator route.'}});
    })();
    tasks.add(task);
    task.catch(error=>{
      if(!res.headersSent)send(res,STATUS[error.code]??(typeof error.code==='string'?400:500),{error:publicOperatorError(error)});
      else res.destroy();
    }).finally(()=>tasks.delete(task));
  });
  try{await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,hostname,accept);});}
  catch(error){if(owned)await host.close();throw error;}
  const address=server.address();origin='http://'+(hostname==='::1'?'[::1]':hostname)+':'+address.port;
  host.startWatchRunner();
  return {operator:host,workspace:host.workspace,events:host.events,watches:host.watches,
    origin,url:origin+'/#token='+encodeURIComponent(token),token,address,
    close(){
      if(!closing)closing=(async()=>{
        const stopped=new Promise(accept=>server.close(accept));server.closeIdleConnections?.();
        // The native host drains its exact source runners and retains their original progress.
        if(owned)await host.close();
        await Promise.allSettled([...tasks]);await stopped;
      })();return closing;
    }
  };
}
export const startStellarIndexerWorkspaceServer=startStellarIndexerServer;
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  import('./cli.mjs').then(({runStellarIndexerCLI})=>runStellarIndexerCLI(['open',...process.argv.slice(2)]))
    .catch(error=>{process.stderr.write(JSON.stringify({error:publicOperatorError(error)})+'\n');process.exitCode=1;});
}
