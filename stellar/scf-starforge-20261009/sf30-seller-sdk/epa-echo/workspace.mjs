// MIT. EPA ECHO operator console over the original retained workspace and merchant engines.
import {createServer} from 'node:http';
import {readFile,open} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {openEchoWorkspace} from './core.mjs';
import {fault} from './provider.mjs';
import {inspectWorkspaceIdentity} from '../stellar-expert/store.mjs';
import {WORKSPACE_SCHEMA} from './schema.mjs';
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
export async function startEchoWorkspace({directory,inboxDirectory,port=0,releaseRuntime,fetchImpl,userAgent,expectedWorkspaceId}={}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw new TypeError('Invalid workspace port.');
  if(expectedWorkspaceId!==undefined){
    const identity=await inspectWorkspaceIdentity(directory,{schema:WORKSPACE_SCHEMA});
    if(identity.workspaceId!==expectedWorkspaceId)throw fault('ECHO_WORKSPACE_IDENTITY_CHANGED','Reopen the originally selected workspace.',409);
  }
  const app=await openEchoWorkspace({directory,inboxDirectory,releaseRuntime,fetchImpl,userAgent});
  if(expectedWorkspaceId!==undefined&&app.schema().workspaceId!==expectedWorkspaceId){
    await app.close();throw fault('ECHO_WORKSPACE_IDENTITY_CHANGED','Reopen the originally selected workspace.',409);
  }
  let files;try{files=await Promise.all(['index.html','app.js','style.css'].map(p=>readFile(new URL('./web/'+p,import.meta.url))));}
  catch(e){await app.close();throw e;}
  const token=randomBytes(32).toString('base64url'),authorization=Buffer.from('Bearer '+token);
  let origin,closing=false,closePromise=null,httpClosed=false;
  const attachment=name=>'attachment; filename="'+basename(String(name)).replace(/["\\\x00-\x1f\x7f]/g,'_')+'"';
  const server=createServer({maxHeaderSize:16384,requestTimeout:120000,headersTimeout:10000,keepAliveTimeout:1000},async(req,res)=>{
    const reply=(status,value,type='application/json; charset=utf-8',extra={})=>{
      if(res.destroyed)return;
      const body=Buffer.isBuffer(value)?value:type.startsWith('application/json')?JSON.stringify(value):value;
      res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff',
        'referrer-policy':'no-referrer','content-security-policy':CSP,...extra});res.end(body);
    };
    try{
      if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')
        return reply(403,{error:'LOCAL_ORIGIN_REQUIRED',message:'Use the original local workspace session.'});
      if(req.method==='GET'&&req.url==='/')return reply(200,files[0],'text/html; charset=utf-8');
      if(req.method==='GET'&&req.url==='/workspace.js')return reply(200,files[1],'text/javascript; charset=utf-8');
      if(req.method==='GET'&&req.url==='/workspace.css')return reply(200,files[2],'text/css; charset=utf-8');
      const auth=Buffer.from(req.headers.authorization??'');
      if(auth.length!==authorization.length||!timingSafeEqual(auth,authorization))
        return reply(401,{error:'SESSION_REQUIRED',message:'Reopen the private session URL printed by the original command.'});
      const url=new URL(req.url,origin);
      if(closing)return reply(503,{error:'ECHO_CLOSING',message:'The original workspace is closing. Reopen the same selected workspace to continue retained operations.'});
      if(req.method==='GET'){
        if(url.pathname==='/api/schema')return reply(200,app.schema());
        if(url.pathname==='/api/view')return reply(200,await app.view());
        if(url.pathname==='/api/editions')return reply(200,await app.editions({
          offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??100),portfolioId:url.searchParams.get('portfolioId')??undefined}));
        if(url.pathname==='/api/edition')return reply(200,await app.edition(url.searchParams.get('editionId')));
        if(url.pathname==='/api/rows'){
          const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??100);
          if(!Number.isInteger(limit)||limit<1||limit>500)throw fault('ECHO_ROWS_RANGE','Display from one to 500 rows per page.');
          return reply(200,await app.rows(url.searchParams.get('editionId'),{offset,limit,table:url.searchParams.get('table')??undefined,
            facilityId:url.searchParams.get('facilityId')??undefined,section:url.searchParams.get('section')??undefined}));
        }
        if(url.pathname==='/api/facility')return reply(200,await app.facility(url.searchParams.get('editionId'),url.searchParams.get('facilityId')));
        if(url.pathname==='/api/search')return reply(200,await app.search(url.searchParams.get('searchId'),{
          offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??100)}));
        if(url.pathname==='/api/received-workspace')return reply(200,await app.receivedWorkspace(url.searchParams.get('receiptId')));
        if(url.pathname==='/api/received-workspace-file'){
          const selected=await app.receivedWorkspaceFile(url.searchParams.get('receiptId'),url.searchParams.get('path'));
          return reply(200,selected.bytes,selected.item.type,{'content-disposition':attachment(selected.item.name??url.searchParams.get('path'))});
        }
        if(url.pathname==='/api/raw'){
          const selected=await app.raw(url.searchParams.get('editionId'),Number(url.searchParams.get('page')??0),{wire:url.searchParams.get('wire')==='true'});
          return reply(200,selected.bytes,selected.type,{'content-disposition':'attachment; filename="echo-source-'+(url.searchParams.get('wire')==='true'?selected.receipt.responseSha256??selected.receipt.sha256:selected.receipt.sha256).slice(0,12)+(selected.type.startsWith('application/json')?'.json':'.txt')+'"'});
        }
        const customer=/^\/api\/receipts\/(buyer-[a-f0-9]{24})\/(dataset\.csv|dataset\.jsonl|review\.html|delivery\.json|manifest\.json)$/.exec(url.pathname);
        if(customer&&!url.search){
          const selected=await app.received(customer[1],customer[2]);
          return reply(200,selected.bytes,selected.item.type,{'content-disposition':attachment(selected.item.name)});
        }
        if(/^\/api\/exports\/[a-z0-9-]{8,100}$/.test(url.pathname)){
          const selected=await app.exported(url.pathname.split('/').at(-1));
          return reply(200,selected.bytes,selected.item.type,{'content-disposition':attachment(selected.item.name)});
        }
      }
      if(req.method!=='POST'||url.pathname!=='/api/action'||url.search)return reply(404,{error:'NOT_FOUND'});
      if(!/^application\/json(?:; *charset=utf-8)?$/i.test(req.headers['content-type']??''))
        return reply(415,{error:'JSON_REQUIRED'});
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>257*1024*1024)return reply(413,{error:'ACTION_TOO_LARGE'});chunks.push(chunk);}
      let request;try{request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
      catch{return reply(400,{error:'INVALID_JSON'});}
      if(!request||typeof request!=='object'||Array.isArray(request)||
        Object.keys(request).some(k=>!['action','payload','expectedRevision','operationId'].includes(k)))
        return reply(400,{error:'ACTION_FIELDS_REQUIRED'});
      if(!['capture.import','workspace.receive'].includes(request.action)&&size>128*1024)return reply(413,{error:'ACTION_TOO_LARGE'});
      return reply(200,await app.action(request));
    }catch(error){
      const known=typeof error.code==='string'&&(/^(ECHO_|EPA_|STELLAR_|DATASET_|SOCRATA_|SELLER_|RELEASE_)/.test(error.code)||error.code==='INVALID_DATASET_QUERY');
      const status=known&&Number.isInteger(error.status)?error.status:503;
      let currentRevision=null;try{currentRevision=app.store.read().revision;}catch{}
      const result={error:known?error.code:'ECHO_WORKSPACE_UNAVAILABLE',
        message:known?error.message:'The original workspace could not complete this request. Its retained operation can be inspected after storage and runtime recover.',
        operationId:error.operationId??null,currentRevision,retryAt:error.retryAt??null};
      if(status===409)try{result.view=await app.view();}catch{}
      return reply(status,result);
    }
  });
  server.maxRequestsPerSocket=100;
  server.on('clientError',(_e,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  try{await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes();});});}
  catch(e){await app.close();throw e;}
  origin='http://127.0.0.1:'+server.address().port;
  return {origin,url:origin+'/#'+token,token,app,
    close(){
      if(!closePromise){
        closing=true;
        closePromise=(async()=>{
          if(!httpClosed)await new Promise((yes,no)=>{server.close(error=>{if(error)return no(error);httpClosed=true;yes();});server.closeIdleConnections?.();});
          await app.close();
        })().catch(error=>{closePromise=null;throw error;});
      }
      return closePromise;
    }};
}
export async function readReleaseRuntime(filename) {
  const file=await open(resolve(filename),'r');
  let bytes;
  try{const stat=await file.stat();if(!stat.isFile()||stat.size>65536)throw new TypeError('Use a release runtime JSON file of up to64 KiB.');bytes=await file.readFile();}
  finally{await file.close();}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).some(key=>!['port','facilitator','allowLocalFacilitator'].includes(key)))
    throw new TypeError('Release runtime accepts port, facilitator and allowLocalFacilitator.');
  const {normalizeReleaseRuntime}=await import('../../sf82-seller-pilot/releases.mjs');
  return normalizeReleaseRuntime({port:0,...value});
}
export async function main(args=process.argv.slice(2)){
  const options={};if(args.includes('--help')){console.log('node workspace.mjs --workspace PRIVATE_DIR [--inbox ORIGINAL_PRIVATE_INBOX] [--port 0] [--user-agent IDENTIFIER] [--release-runtime PRIVATE_JSON] [--startup-format json] [--expected-workspace-id UUID]');return;}
  for(let i=0;i<args.length;i+=2){
    if(!['--workspace','--inbox','--port','--release-runtime','--user-agent','--startup-format','--expected-workspace-id'].includes(args[i])||Object.hasOwn(options,args[i])||!args[i+1]||args[i+1].startsWith('--'))
      throw new TypeError('Use --workspace PRIVATE_DIR with paired supported options; see --help.');
    options[args[i]]=args[i+1];
  }
  if(!options['--workspace'])throw new TypeError('--workspace is required.');
  if(options['--startup-format']!==undefined&&options['--startup-format']!=='json')throw new TypeError('Startup format must be json.');
  if(options['--expected-workspace-id']!==undefined&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(options['--expected-workspace-id']))
    throw new TypeError('Expected workspace identity must be the original UUID.');
  const app=await startEchoWorkspace({directory:resolve(options['--workspace']),
    inboxDirectory:options['--inbox']?resolve(options['--inbox']):undefined,
    port:options['--port']===undefined?0:Number(options['--port']),
    releaseRuntime:options['--release-runtime']?await readReleaseRuntime(options['--release-runtime']):undefined,
    userAgent:options['--user-agent'],expectedWorkspaceId:options['--expected-workspace-id']});
  if(options['--startup-format']==='json')console.log(JSON.stringify({
    schema:'stellar-forge.epa-echo-workspace-startup.v1',status:'EPA_ECHO_READY',
    directory:app.app.store.root,workspaceId:app.app.schema().workspaceId,
    inboxDirectory:options['--inbox']?resolve(options['--inbox']):null,
    releaseRuntimeFile:options['--release-runtime']?resolve(options['--release-runtime']):null,
    sourceDirectory:dirname(fileURLToPath(import.meta.url)),userAgent:app.app.schema().userAgent,pid:process.pid,url:app.url,
  }));
  else console.log('EPA ECHO Facility Portfolios\n'+app.url+'\nKeep this session URL private. Stop with Ctrl+C.');
  const close=()=>{void app.close().catch(()=>{process.exitCode=1;});};process.once('SIGINT',close);process.once('SIGTERM',close);
  return app;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(e=>{console.error('EPA ECHO workspace: '+e.message);process.exitCode=1;});
