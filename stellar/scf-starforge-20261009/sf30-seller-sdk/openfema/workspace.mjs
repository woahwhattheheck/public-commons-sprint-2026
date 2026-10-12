// MIT. Local OpenFEMA operator using the original private workspace and asset distribution.
import {createServer} from 'node:http';
import {readFile,open} from 'node:fs/promises';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readBrowserAssets} from '../../distribution/browser-assets.mjs';
import {inspectWorkspaceIdentity,readOwned} from '../stellar-expert/store.mjs';
import {openOpenFemaWorkspace} from './core.mjs';
import {WORKSPACE_SCHEMA} from './schema.mjs';
import {fault} from './domain.mjs';
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function startOpenFemaWorkspace({directory,inboxDirectory,port=0,releaseRuntime,fetchImpl,userAgent,expectedWorkspaceId}={}){
  if(!Number.isInteger(port)||port<0||port>65535)throw fault('OPENFEMA_PORT','Choose a local port from0 to65535.');
  if(expectedWorkspaceId!==undefined){
    const prior=await inspectWorkspaceIdentity(directory,{schema:WORKSPACE_SCHEMA});
    if(prior.workspaceId!==expectedWorkspaceId)throw fault('OPENFEMA_WORKSPACE_IDENTITY_CHANGED','Open the originally selected workspace.',409);
  }
  const app=await openOpenFemaWorkspace({directory,inboxDirectory,releaseRuntime,fetchImpl,userAgent});
  if(expectedWorkspaceId!==undefined&&app.schema().workspaceId!==expectedWorkspaceId){await app.close();throw fault('OPENFEMA_WORKSPACE_IDENTITY_CHANGED','Open the originally selected workspace.',409);}
  let assets;try{assets=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url));}catch(error){await app.close();throw error;}
  const token=randomBytes(32).toString('base64url'),authorization=Buffer.from('Bearer '+token),tickets=new Map(),archives=new Map();
  let origin,closePromise=null;
  const headers=(type,extra={})=>({'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':CSP,...extra});
  async function readJSON(req,max){
    if(!/^application\/json(?:; *charset=utf-8)?$/i.test(req.headers['content-type']??''))throw fault('OPENFEMA_JSON_REQUIRED','Send application/json.',415);
    let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw fault('OPENFEMA_REQUEST_SIZE','This request exceeds its receiving capacity.',413);parts.push(chunk);}
    try{return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts))),size};}
    catch(error){if(error.code)throw error;throw fault('OPENFEMA_JSON','Use a complete UTF-8 JSON request.');}
  }
  async function selection(path){
    let match;
    if((match=/^\/api\/objects\/([a-f0-9]{64})$/.exec(path))){const selected=await app.raw(match[1]);return{...selected,item:{name:'OpenFEMA_Source_'+match[1]+'.json',type:selected.type,sha256:match[1],bytes:selected.bytes.length}};}
    if((match=/^\/api\/exports\/(export-[a-f0-9]{24})$/.exec(path)))return app.exported(match[1]);
    if((match=/^\/api\/receipts\/(buyer-[a-f0-9]{24})\/(dataset\.csv|dataset\.jsonl|review\.html|delivery\.json|manifest\.json)$/.exec(path)))return app.received(match[1],match[2]);
    if(path==='/api/workspace.zip'){
      const revision=app.store.read().revision,cached=archives.get(revision);
      if(cached)return cached;
      const archive=await app.archive(),selected={bytes:archive.bytes,item:{name:archive.name,type:archive.type,bytes:archive.bytes.length,sha256:hash(archive.bytes),revision}};
      archives.clear();archives.set(revision,selected);return selected;
    }
    throw fault('OPENFEMA_DOWNLOAD','Choose an original source, report, customer file or complete workspace.',404);
  }
  const server=createServer({maxHeaderSize:16384,requestTimeout:120000,headersTimeout:10000,keepAliveTimeout:1000},async(req,res)=>{
    const reply=(status,value,type='application/json; charset=utf-8',extra={})=>{if(res.destroyed)return;const body=Buffer.isBuffer(value)?value:type.startsWith('application/json')?JSON.stringify(value):String(value);res.writeHead(status,headers(type,extra));res.end(body);};
    const deliver=selected=>{
      const {item,bytes}=selected,etag='"'+(item.sha256??hash(bytes))+'"';
      const extra={'content-disposition':'attachment; filename="'+item.name.replace(/["\r\n]/g,'_')+'"','accept-ranges':'bytes','etag':etag,'x-content-sha256':item.sha256??hash(bytes),'content-length':String(bytes.length)};
      let start=0,end=bytes.length-1,status=200;
      if(req.headers.range&&(!req.headers['if-range']||req.headers['if-range']===etag)){
        const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        start=range?Number(range[1]):-1;end=range&&range[2]?Number(range[2]):end;
        if(!range||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=bytes.length||end<start)return reply(416,{error:'OPENFEMA_RANGE',message:'Choose bytes within the retained complete file.'},'application/json; charset=utf-8',{'content-range':'bytes */'+bytes.length});
        end=Math.min(end,bytes.length-1);status=206;extra['content-range']='bytes '+start+'-'+end+'/'+bytes.length;extra['content-length']=String(end-start+1);
      }
      return reply(status,bytes.subarray(start,end+1),item.type,extra);
    };
    try{
      if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'OPENFEMA_LOCAL_ORIGIN',message:'Use the original local workspace session.'});
      const url=new URL(req.url,origin),path=url.pathname;
      if(req.method==='GET'&&assets.has(path)&&!url.search){const asset=assets.get(path);return reply(200,await readFile(asset.url),asset.type);}
      const ticketMatch=/^\/api\/download\/([a-f0-9]{48})$/.exec(path);
      if(req.method==='GET'&&ticketMatch&&!url.search){
        const ticket=tickets.get(ticketMatch[1]);tickets.delete(ticketMatch[1]);
        if(!ticket||ticket.expiresAt<Date.now())return reply(410,{error:'OPENFEMA_DOWNLOAD_EXPIRED',message:'Prepare this download again.'});
        return deliver(ticket.selected);
      }
      const auth=Buffer.from(req.headers.authorization??'');
      if(auth.length!==authorization.length||!timingSafeEqual(auth,authorization))return reply(401,{error:'OPENFEMA_SESSION_REQUIRED',message:'Open the private session URL printed by the original command.'});
      if(req.method==='GET'){
        if(path==='/api/schema'&&!url.search)return reply(200,app.schema());
        if(path==='/api/view'&&!url.search)return reply(200,await app.view());
        if(path==='/api/editions'&&!url.search)return reply(200,await app.editions());
        if(path==='/api/edition')return reply(200,await app.capture.readEdition(url.searchParams.get('editionId')));
        if(path==='/api/operation')return reply(200,await app.operation(url.searchParams.get('operationId')));
        if(path==='/api/rows')return reply(200,await app.rows(url.searchParams.get('versionId'),{
          table:url.searchParams.get('table')??'projects',search:url.searchParams.get('search')??'',sort:url.searchParams.get('sort')??'',direction:url.searchParams.get('direction')??'asc',offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??100)}));
        if(path==='/api/detail')return reply(200,await app.detail(url.searchParams.get('versionId'),url.searchParams.get('table'),url.searchParams.get('id')));
        if(path==='/api/release-terms')return reply(200,await app.releaseTerms(url.searchParams.get('releaseId')));
        if(!url.search&&/^\/api\/(?:objects\/|exports\/|receipts\/|workspace\.zip$)/.test(path))return deliver(await selection(path));
      }
      if(req.method==='POST'&&path==='/api/download-ticket'&&!url.search){
        const {value}=await readJSON(req,8192);
        if(!value||Object.keys(value).length!==1||typeof value.path!=='string')throw fault('OPENFEMA_DOWNLOAD','Select one original download path.');
        const selected=await selection(value.path);for(const [id,ticket]of tickets)if(ticket.expiresAt<Date.now())tickets.delete(id);
        if(tickets.size>=24)throw fault('OPENFEMA_DOWNLOAD_CAPACITY','Finish the prepared downloads before opening more.',429);
        const id=randomBytes(24).toString('hex'),expiresAt=Date.now()+120000;tickets.set(id,{selected,expiresAt});
        return reply(200,{url:'/api/download/'+id,expiresAt:new Date(expiresAt).toISOString(),item:selected.item});
      }
      if(req.method==='POST'&&path==='/api/action'&&!url.search){
        const {value,size}=await readJSON(req,256*1024*1024);
        if(value?.action!=='source.import'&&size>128*1024)throw fault('OPENFEMA_REQUEST_SIZE','Use a complete source bundle for large source receiving; operator actions fit128KiB.',413);
        return reply(200,await app.action(value));
      }
      return reply(404,{error:'OPENFEMA_NOT_FOUND',message:'This workspace route is not available.'});
    }catch(error){
      const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:['ENOSPC','EDQUOT'].includes(error.code)?507:503;
      return reply(status,{error:typeof error.code==='string'?error.code:'OPENFEMA_OPERATION_FAILED',message:error.message||'The original workspace could not complete this operation.',operationId:error.operationId??null,currentRevision:app.store.read().revision,retryAt:error.retryAt??null});
    }
  });
  server.maxRequestsPerSocket=100;
  server.on('clientError',(_error,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  try{await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes();});});}catch(error){await app.close();throw error;}
  origin=new URL('http://127.0.0.1:'+server.address().port).origin;
  return {origin,url:origin+'/#'+token,token,app,close(){
    if(!closePromise){
      tickets.clear();archives.clear();
      closePromise=(async()=>{
        if(server.listening)await new Promise((yes,no)=>{server.close(e=>e?no(e):yes());server.closeIdleConnections?.();});
        await app.close();
      })().catch(error=>{closePromise=null;throw error;});
    }
    return closePromise;
  }};
}
export async function readReleaseRuntime(filename){
  const bytes=await readOwned(resolve(filename),65536),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['port','facilitator','allowLocalFacilitator'].includes(k)))throw fault('OPENFEMA_RUNTIME','Use the original release runtime JSON with port, facilitator and allowLocalFacilitator.');
  const {normalizeReleaseRuntime}=await import('../../sf82-seller-pilot/releases.mjs');
  return normalizeReleaseRuntime({port:0,...value});
}
export async function main(args=process.argv.slice(2)){
  if(args.includes('--help')){console.log('openfema-workspace --workspace PRIVATE_DIR [--inbox ORIGINAL_PRIVATE_INBOX] [--port 0] [--user-agent IDENTIFIER] [--release-runtime PRIVATE_JSON] [--startup-format json] [--expected-workspace-id UUID]');return;}
  const options={};for(let i=0;i<args.length;i+=2){if(!['--workspace','--inbox','--port','--release-runtime','--user-agent','--startup-format','--expected-workspace-id'].includes(args[i])||Object.hasOwn(options,args[i])||!args[i+1]||args[i+1].startsWith('--'))throw fault('OPENFEMA_OPTIONS','Use paired supported options; see --help.');options[args[i]]=args[i+1];}
  if(!options['--workspace'])throw fault('OPENFEMA_WORKSPACE_REQUIRED','--workspace is required.');
  if(options['--startup-format']!==undefined&&options['--startup-format']!=='json')throw fault('OPENFEMA_STARTUP_FORMAT','Use startup format json.');
  if(options['--expected-workspace-id']!==undefined&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(options['--expected-workspace-id']))throw fault('OPENFEMA_WORKSPACE_ID','Select the original workspace UUID.');
  const started=await startOpenFemaWorkspace({directory:resolve(options['--workspace']),inboxDirectory:options['--inbox']?resolve(options['--inbox']):undefined,port:options['--port']===undefined?0:Number(options['--port']),releaseRuntime:options['--release-runtime']?await readReleaseRuntime(options['--release-runtime']):undefined,userAgent:options['--user-agent'],expectedWorkspaceId:options['--expected-workspace-id']});
  if(options['--startup-format']==='json')console.log(JSON.stringify({schema:'stellar-forge.openfema-workspace-startup.v1',status:'OPENFEMA_READY',directory:started.app.store.root,workspaceId:started.app.schema().workspaceId,inboxDirectory:options['--inbox']?resolve(options['--inbox']):null,releaseRuntimeFile:options['--release-runtime']?resolve(options['--release-runtime']):null,sourceDirectory:dirname(fileURLToPath(import.meta.url)),userAgent:started.app.schema().userAgent,pid:process.pid,url:started.url}));
  else console.log('OpenFEMA Public Assistance\n'+started.url+'\nStop with Ctrl+C.');
  const close=()=>{void started.close().catch(e=>{console.error(e.message);process.exitCode=1;});};process.once('SIGINT',close);process.once('SIGTERM',close);
  return started;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error('OpenFEMA: '+e.message);process.exitCode=1;});
