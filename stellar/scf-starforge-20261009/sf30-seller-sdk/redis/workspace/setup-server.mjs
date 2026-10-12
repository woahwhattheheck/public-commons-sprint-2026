// MIT. Local connection setup hands the operator to the original Redis workspace.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createRedisConnectionSetup } from './setup-model.mjs';
import { startRedisAuthoringServer } from './server.mjs';
import { openRedisAuthoringWorkspace } from './model.mjs';
const ASSETS = new Map([
  ['/', ['setup.html','text/html; charset=utf-8']],
  ['/setup.mjs',['setup.mjs','text/javascript; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']],
  ['/setup.css',['setup.css','text/css; charset=utf-8']],
]);
const failure=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
function json(res,status,value) {
  const bytes=Buffer.from(JSON.stringify(value));
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':bytes.length,
    'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
  res.end(bytes);
}
async function readBody(req) {
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw failure('JSON_REQUIRED','Send a JSON object.');
  const parts=[];let total=0;
  for await(const part of req) {
    total+=part.length;
    if(total>3145728)throw failure('REDIS_SETUP_INPUT_TOO_LARGE','Keep source and plan within 256 KiB each, and each certificate within 1 MiB.',413);
    parts.push(part);
  }
  try {
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
    return value;
  } catch { throw failure('JSON_REQUIRED','Send a valid JSON object.'); }
}
export async function startRedisConnectionSetupServer({directory,initial,environment=process.env,port=8437,setup}={}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw new RangeError('Port must be 0–65535.');
  const assets=new Map(await Promise.all([...ASSETS].map(async([path,[name,type]])=>
    [path,{bytes:await readFile(new URL('./public/'+name,import.meta.url)),type}])));
  const model=setup??await createRedisConnectionSetup({directory,initial,environment});
  const token=randomBytes(32).toString('hex'),tokenBytes=Buffer.from(token);
  let origin,authority,closing,workspaceServer,opening;
  const connections=new Set();
  async function openWorkspace() {
    if(closing)throw failure('REDIS_SETUP_CLOSING','Connection setup is closing.',503);
    if(workspaceServer)return workspaceServer;
    if(!model.workspace)throw failure('REDIS_SETUP_WORKSPACE_REQUIRED','Create this workspace before opening it.',409);
    if(!opening)opening=(async()=>{
      if(model.workspace.closed)model.workspace=await openRedisAuthoringWorkspace(model.directory,{
        environment:model.environment,expectedWorkspaceId:model.created.workspaceId,
        expectedProfileSha256:model.created.profileSha256});
      const value=await startRedisAuthoringServer({workspace:model.workspace,port:0});
      workspaceServer=value;return value;
    })().finally(()=>{opening=null;});
    return opening;
  }
  const server=createServer((req,res)=>{
    Promise.resolve().then(async()=>{
      if(closing)return json(res,503,{error:'REDIS_SETUP_CLOSING',message:'Connection setup is closing.'});
      if(req.headers.host!==authority||(req.headers.origin&&req.headers.origin!==origin))
        return json(res,403,{error:'LOCAL_WORKSPACE_REQUIRED',message:'Open the original local setup URL.'});
      if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//'))
        throw failure('REQUEST_TARGET_INVALID','Use a local setup path.',400);
      const url=new URL(req.url,origin);
      if(req.method==='GET'&&assets.has(url.pathname)&&!url.search) {
        const item=assets.get(url.pathname);
        res.writeHead(200,{'content-type':item.type,'content-length':item.bytes.length,'cache-control':'no-store',
          'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
          'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
        return res.end(item.bytes);
      }
      const supplied=req.headers['x-workspace-token'];
      if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==tokenBytes.length||!timingSafeEqual(Buffer.from(supplied),tokenBytes))
        return json(res,403,{error:'WORKSPACE_TOKEN_REQUIRED',message:'Reopen the setup link printed by the original process.'});
      if(url.search)throw failure('QUERY_INVALID','Setup actions do not take URL parameters.');
      if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,{
        ...model.state(),operatorUrl:workspaceServer?.operatorUrl??null});
      if(req.method==='POST'&&req.headers.origin!==origin)
        throw failure('WORKSPACE_ORIGIN_REQUIRED','Send the operation from this setup window.',403);
      if(req.method==='POST'&&['/api/review','/api/preview','/api/create'].includes(url.pathname)) {
        const input=await readBody(req),action=url.pathname.slice(5);
        const result=await model[action](input);
        if(action==='create') {
          const authoring=await openWorkspace();
          return json(res,200,{...result,operatorUrl:authoring.operatorUrl});
        }
        return json(res,200,result);
      }
      if(req.method==='POST'&&url.pathname==='/api/open') {
        const input=await readBody(req);
        if(Object.keys(input).length)throw failure('INPUT_INVALID','Open takes no additional fields.');
        const authoring=await openWorkspace();
        return json(res,200,{...model.state().created,operatorUrl:authoring.operatorUrl});
      }
      return json(res,404,{error:'REDIS_SETUP_ROUTE_NOT_FOUND',message:'That setup action does not exist.'});
    }).catch(error=>{
      if(res.writableEnded||res.destroyed)return;
      if(res.headersSent)return res.destroy();
      const message=String(error.message??'Connection setup could not complete.').toWellFormed()
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,' ').slice(0,600);
      json(res,error.status??422,{error:error.code??'REDIS_SETUP_FAILED',message});
    });
  });
  server.on('connection',socket=>{connections.add(socket);socket.once('close',()=>connections.delete(socket));});
  server.requestTimeout=150000;server.headersTimeout=10000;server.keepAliveTimeout=2000;
  try { await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);}); }
  catch(error) {await model.close();throw error;}
  const address=new URL('http://127.0.0.1:'+server.address().port);origin=address.origin;authority=address.host;
  function close() {
    if(closing)return closing;
    closing=(async()=>{
      const listener=new Promise((done,fail)=>server.close(error=>error?fail(error):done()));
      server.closeIdleConnections();
      try {
        await opening?.catch(()=>{});
        await model.close();
        await workspaceServer?.close();
      } finally {for(const socket of connections)socket.destroy();await listener;}
    })();
    return closing;
  }
  return {setup:model,server,url:origin,operatorUrl:origin+'/#'+token,token,close,
    get workspaceServer(){return workspaceServer;}};
}
