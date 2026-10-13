// MIT. Authenticated loopback transport for the original curriculum store and model.
import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {constants} from 'node:fs';
import {open,realpath,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {failure} from './store.mjs';

const MAX_BODY=160*1024*1024;
const MIME={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.cjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8','.md':'text/plain; charset=utf-8','.py':'text/plain; charset=utf-8'};
const FILES=new Set(["CURRICULUM_COVERAGE.md","CURRICULUM_MIGRATION.md","LICENSE.OAK","README.md","SDK_GUIDE.md","cli.mjs","complete-receiving.mjs","curriculum-coverage.mjs","curriculum-migration-workbench-bootstrap.html","curriculum-migration-workbench.html","curriculum-migration.mjs","curriculum-panel.mjs","generate-sdk.mjs","initial-workspace.json","model.mjs","public-source.json.gz.json","run-receiving.py","styles.css","ui.js","zip.js","source-selection.json"]);
import {inspectSource} from './binding.mjs';
const safeMessage=e=>String(e?.message??e).slice(0,1600);
function need(ok,code,message,status=400){if(!ok)throw failure(code,message,status);}
function clone(value){return JSON.parse(JSON.stringify(value));}
function eq(a,b){return typeof a==='string'&&typeof b==='string'&&timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());}
function single(req,name){const all=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()===name);need(all.length<=1,'HEADERS_INVALID','Use one '+name+' header.');return req.headers[name];}
function expectedQuery(url){
 const raw=url.searchParams.get('revision');
 need(raw!==null&&/^(0|[1-9]\d*)$/.test(raw),'INVALID','A reviewed revision is required.');
 return {workspaceId:url.searchParams.get('workspaceId'),revision:Number(raw),snapshotSha256:url.searchParams.get('snapshotSha256')};
}
function requestId(body){return body&&typeof body.requestId==='string'?body.requestId:null;}
async function bodyJSON(req){
 const encoding=req.headers['content-encoding'];need(!encoding||encoding==='identity','BODY_INVALID','Compressed request bodies are unsupported.',415);
 const type=req.headers['content-type'];need(typeof type==='string'&&/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type),'BODY_INVALID','Use application/json with UTF-8 bytes.',415);
 const length=req.headers['content-length'];if(length!==undefined)need(/^\d+$/.test(length)&&Number(length)<=MAX_BODY,'CAPACITY','Complete request body exceeds 160 MiB.',413);
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;need(size<=MAX_BODY,'CAPACITY','Complete request body exceeds 160 MiB.',413);chunks.push(chunk);}
 need(length===undefined||Number(length)===size,'BODY_INVALID','Request body length differs.');
 try{const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));need(result&&typeof result==='object'&&!Array.isArray(result),'BODY_INVALID','Use a JSON object.');return result;}catch(e){if(e.code)throw e;throw failure('BODY_INVALID','Request is not complete UTF-8 JSON.');}
}
function send(res,status,result,headers={}){
 const b=Buffer.from(JSON.stringify(result));
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':String(b.length),'cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(b);
}
async function sourceFile(root,name){
 need(FILES.has(name),'MISSING','Published application source is absent.',404);
 const path=join(root,name);need(await realpath(path)===path,'SOURCE_INVALID','Published source path is not a real file.');
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await f.stat();need(before.isFile()&&before.size<=16*1024*1024,'SOURCE_INVALID','Published source exceeds its file bound.');const b=await f.readFile(),after=await f.stat(),named=await lstat(path);need(before.dev===named.dev&&before.ino===named.ino&&before.size===b.length&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'SOURCE_CHANGED','Published source changed while reading.');return b;}finally{await f.close();}
}
export async function startServer({store,sourceDirectory,token,port=0,sourceSha256,renderPage}){
 need(store&&typeof store.directory==='string'&&store.identity?.id,'STORE_INVALID','Open the original owned curriculum store first.');
 need(typeof token==='string'&&token.length>=32&&token.length<=512&&!/[\u0000-\u0020]/.test(token),'TOKEN_INVALID','Use the original private service token.');
 need(typeof sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(sourceSha256),'SOURCE_INVALID','The selected complete source SHA-256 is required.');
 need(Number.isInteger(port)&&port>=0&&port<=65535,'PORT_INVALID','Port must be zero or a valid loopback port.');
 const root=resolve(sourceDirectory);need(root===sourceDirectory&&await realpath(root)===root,'SOURCE_INVALID','Use the selected original real app directory.');
 const source=await inspectSource(root),sourceMap=new Map(source.selection.files.map(f=>[f.path,f]));
 need(source.selection.sha256===sourceSha256,'SOURCE_INVALID','Actual original source selection differs.');
 async function exactSource(name){const body=await sourceFile(root,name);const ref=sourceMap.get(name);need(ref&&body.length===ref.bytes&&createHash('sha256').update(body).digest('hex')===ref.sha256,'SOURCE_CHANGED','Selected original source bytes changed.');return {body,ref};}
 let origin=null,closing=false,closePromise=null;const active=new Set(),sockets=new Set();
 function authorize(req,url){
  const host=single(req,'host');need(origin&&host===new URL(origin).host,'HOST_INVALID','Use this exact loopback service origin.',403);
  const observed=single(req,'origin');need(!observed||observed===origin,'ORIGIN_INVALID','Cross-origin requests are unsupported.',403);
  const auth=single(req,'authorization');need(eq(auth,'Bearer '+token),'UNAUTHORIZED','The original application bearer token is required.',401);
  if(url.pathname!=='/api/identity'&&url.pathname!=='/api/state'){
   need(single(req,'x-curriculum-store-id')===store.identity.id&&single(req,'x-curriculum-store-directory')===store.directory,'STORE_MISMATCH','Reopen the exact physical store before reading or changing its branches.',409);
  }
 }
 async function handle(req,res){
  let body=null,isMutation=false;
  try{
   need(!closing,'CLOSING','The original service is closing.',503);
   need(typeof req.url==='string'&&!req.url.includes('#'),'URL_INVALID','Invalid request URL.');
   const url=new URL(req.url,origin??'http://127.0.0.1');
   need(origin&&url.origin===origin,'ORIGIN_INVALID','Use the exact original application origin.',403);
   need(single(req,'host')===new URL(origin).host,'HOST_INVALID','Use the exact loopback service host.',403);
   if(!url.pathname.startsWith('/api/')){
    need(req.method==='GET'||req.method==='HEAD','METHOD_INVALID','Read-only application source route.',405);
    const name=url.pathname==='/'?'curriculum-migration-workbench.html':decodeURIComponent(url.pathname.replace(/^\/app\//,'').replace(/^\//,''));
    let data;
    if(url.pathname==='/'&&renderPage){const value=await renderPage();need(typeof value==='string'||Buffer.isBuffer(value),'SOURCE_INVALID','Managed page renderer must return complete HTML bytes.');data=Buffer.from(value);}
    else if(name==='source-selection.json'){data=await sourceFile(root,name);need(JSON.stringify(JSON.parse(data))===JSON.stringify(source.selection),'SOURCE_CHANGED','Source selection changed.');}
    else data=(await exactSource(name)).body;
    const type=MIME[Object.keys(MIME).find(ext=>name.endsWith(ext))]??'text/plain; charset=utf-8';
    res.writeHead(200,{'content-type':type,'content-length':String(data.length),'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:data);return;
   }
   authorize(req,url);
   let result,match;
   if(req.method==='GET'&&(url.pathname==='/api/identity'||url.pathname==='/api/state'))result={...clone(store.identity),sourceSha256};
   else if(req.method==='GET'&&url.pathname==='/api/branches')result=await store.list();
   else if(req.method==='GET'&&(match=/^\/api\/application-source\/(.+)$/.exec(url.pathname))){
    const name=decodeURIComponent(match[1]),{body:data,ref}=await exactSource(name);
    res.writeHead(200,{'content-type':'application/octet-stream','content-length':String(data.length),'content-disposition':'attachment; filename="'+name.replace(/[^A-Za-z0-9._-]/g,'_')+'"','cache-control':'no-store','x-content-type-options':'nosniff','x-curriculum-source-sha256':ref.sha256,'x-curriculum-source-bytes':String(ref.bytes)});res.end(data);return;
   }
   else if(req.method==='GET'&&(match=/^\/api\/branches\/([^/]+)\/assets\/([^/]+)$/.exec(url.pathname))){
    const source=await store.source({id:decodeURIComponent(match[1]),assetId:decodeURIComponent(match[2]),expected:expectedQuery(url)});
    const filename=source.descriptor.name.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,180)||'original-source.bin';
    res.writeHead(200,{'content-type':'application/octet-stream','content-length':String(source.bytes.length),'content-disposition':'attachment; filename="'+filename+'"','cache-control':'no-store','x-content-type-options':'nosniff','x-curriculum-source-sha256':source.descriptor.sha256,'x-curriculum-source-bytes':String(source.bytes.length),'x-curriculum-branch-id':source.branch.id,'x-curriculum-snapshot-sha256':source.branch.snapshotSha256});res.end(source.bytes);return;
   }
   else if(req.method==='GET'&&(match=/^\/api\/branches\/([^/]+)$/.exec(url.pathname)))result=await store.read(decodeURIComponent(match[1]));
   else if(req.method==='GET'&&(match=/^\/api\/requests\/([^/]+)$/.exec(url.pathname)))result=await store.request(decodeURIComponent(match[1]));
   else if(req.method==='POST'){
    body=await bodyJSON(req);
    const mutationRoutes={'/api/branches/create':'create','/api/branches/command':'command'};
    if(Object.prototype.hasOwnProperty.call(mutationRoutes,url.pathname)){isMutation=true;result=await store[mutationRoutes[url.pathname]](body);}
    else if(url.pathname==='/api/branches/export')result=await store.exportBranch(body);
    else if(url.pathname==='/api/download'){
     const file=await store.download(body),d=file.descriptor;
     res.writeHead(200,{'content-type':d.mediaType,'content-length':String(d.bytes),'content-disposition':'attachment; filename="'+d.name.replace(/[^A-Za-z0-9._-]/g,'_')+'"','cache-control':'no-store','x-content-type-options':'nosniff','x-curriculum-source-sha256':d.sha256,'x-curriculum-source-bytes':String(d.bytes),'x-curriculum-branch-id':file.branch.id,'x-curriculum-snapshot-sha256':file.branch.snapshotSha256});res.end(file.bytes);return;
    }
    else if(url.pathname==='/api/history')result=await store.history(body);
    else if(url.pathname==='/api/report')result=await store.report(body);
    else throw failure('MISSING','Unknown original curriculum API route.',404);
   }else throw failure('MISSING','Unknown original curriculum API route.',404);
   send(res,200,{ok:true,result});
  }catch(error){
   if(res.headersSent){res.destroy(error);return;}
   // Only the serialized original writer can establish definite absence.
   let notCommitted=false;const id=error.requestId??requestId(body);
   if(isMutation&&error.notCommitted===true&&id){
    try{notCommitted=await store.request(id)===null;}catch{}
   }
   const code=typeof error.code==='string'?error.code:'INTERNAL';
   const status=error.status??(['CONFLICT','REQUEST_REUSED','CREATE_CONFLICT','CLOSED','STORE_REOPEN_REQUIRED'].includes(code)?409:['MISSING','ENOENT'].includes(code)?404:code==='INTERNAL'?500:400);
   send(res,status,{ok:false,error:{code,message:safeMessage(error)},notCommitted,...(id?{requestId:id}:{})});
  }
 }
 const server=createServer((req,res)=>{
  const running=handle(req,res);active.add(running);running.finally(()=>active.delete(running)).catch(()=>{});
 });
 server.requestTimeout=60000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 server.on('clientError',(_,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
 await new Promise((accept,reject)=>{
  const fail=error=>{server.removeListener('listening',ready);reject(error);},ready=()=>{server.removeListener('error',fail);accept();};
  server.once('error',fail);server.once('listening',ready);server.listen({host:'127.0.0.1',port});
 });
 origin='http://127.0.0.1:'+server.address().port;
 return {origin,close(){
  if(closePromise)return closePromise;closing=true;
  closePromise=(async()=>{
   const stopped=new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()));
   server.closeIdleConnections?.();
   const timer=setTimeout(()=>{for(const socket of sockets)socket.destroy();},15000);
   try{await stopped;await Promise.allSettled([...active]);}finally{clearTimeout(timer);}
  })();return closePromise;
 }};
}
