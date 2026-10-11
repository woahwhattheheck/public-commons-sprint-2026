// MIT. Local Redis authoring UI over the original retained workspace and release console.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const ASSETS = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/app.mjs',['app.mjs','text/javascript; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']],
  ['/local-draft-store.mjs',['../../../python/workspace/local-draft-store.mjs','text/javascript; charset=utf-8']],
]);
const failure=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const clean=value=>String(value??'Workspace operation failed.').toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').slice(0,600);
function json(res,status,value){
  const body=Buffer.from(JSON.stringify(value));
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':body.length,
    'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
  res.end(body);
}
async function body(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw failure('JSON_REQUIRED','Send a JSON object.');
  const parts=[];let size=0;
  for await(const part of req){size+=part.length;if(size>524288)throw failure('INPUT_TOO_LARGE','Keep this request within 512 KiB.',413);parts.push(part);}
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}
  catch{throw failure('INVALID_JSON','Correct the JSON input.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw failure('OBJECT_REQUIRED','Send a JSON object.');
  return value;
}
function exactQuery(url,allowed){
  const seen=new Set();
  for(const key of url.searchParams.keys()){
    if(!allowed.includes(key)||seen.has(key))throw failure('QUERY_INVALID','Use the supported query parameters.');
    seen.add(key);
  }
}
function exactFields(input,names){
  if(Object.keys(input).some(name=>!names.includes(name)))throw failure('INPUT_INVALID','Use the supported operation fields.');
}
export async function startRedisAuthoringServer({workspace,port=8438}={}){
  if(!workspace||typeof workspace.state!=='function'||typeof workspace.close!=='function')throw new TypeError('An open Redis authoring workspace is required.');
  if(!Number.isInteger(port)||port<0||port>65535)throw new RangeError('Port must be 0–65535.');
  const assets=new Map(await Promise.all([...ASSETS].map(async([path,[file,type]])=>
    [path,{bytes:await readFile(new URL('./public/'+file,import.meta.url)),type}])));
  const token=randomBytes(32).toString('hex'),tokenBytes=Buffer.from(token);
  let origin,authority,closing;
  const connections=new Set();
  const server=createServer((req,res)=>{
    Promise.resolve().then(async()=>{
      if(closing)return json(res,503,{error:'WORKSPACE_CLOSING',message:'The workspace is closing.'});
      if(req.headers.host!==authority||(req.headers.origin&&req.headers.origin!==origin))
        return json(res,403,{error:'LOCAL_WORKSPACE_REQUIRED',message:'Open the workspace using its original local URL.'});
      if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//'))
        throw failure('REQUEST_TARGET_INVALID','Use a local workspace path.',400);
      const url=new URL(req.url,origin);
      if(req.method==='GET'&&assets.has(url.pathname)&&!url.search){
        const file=assets.get(url.pathname);
        res.writeHead(200,{'content-type':file.type,'content-length':file.bytes.length,'cache-control':'no-store',
          'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
          'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
        return res.end(file.bytes);
      }
      const supplied=req.headers['x-workspace-token'];
      if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==tokenBytes.length||!timingSafeEqual(Buffer.from(supplied),tokenBytes))
        return json(res,403,{error:'WORKSPACE_TOKEN_REQUIRED',message:'Reopen the original operator link printed by this workspace process.'});
      if(req.method==='GET'&&url.pathname==='/api/state'){
        exactQuery(url,[]);return json(res,200,workspace.state());
      }
      if(req.method==='GET'&&['/api/revisions','/api/operations'].includes(url.pathname)){
        exactQuery(url,['after','limit']);const table=url.pathname.slice(5);
        const page=workspace.page(table,{after:url.searchParams.get('after')??'',limit:Number(url.searchParams.get('limit')??'30')});
        return json(res,200,{...page,items:page.items.map(item=>table==='revisions'?workspace.summary(item):workspace.operationSummary(item))});
      }
      if(req.method==='GET'&&url.pathname==='/api/revision'){
        exactQuery(url,['id']);return json(res,200,workspace.revision(url.searchParams.get('id')));
      }
      if(req.method==='GET'&&url.pathname==='/api/operation'){
        exactQuery(url,['id']);return json(res,200,workspace.operation(url.searchParams.get('id')));
      }
      if(req.method==='GET'&&url.pathname==='/api/customer-file'){
        exactQuery(url,['package','name']);
        const file=await workspace.file(url.searchParams.get('package'),url.searchParams.get('name'));
        res.writeHead(200,{'content-type':file.type+'; charset=utf-8','content-length':file.bytes.length,
          'content-disposition':'attachment; filename="'+file.name+'"','cache-control':'no-store',
          'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
        return res.end(file.bytes);
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/')&&!url.search){
        if(req.headers.origin!==origin)throw failure('WORKSPACE_ORIGIN_REQUIRED','Send the operation from this workspace origin.',403);
        const input=await body(req),command=url.pathname.slice(5);
        if(['review','save','restore','preview','prepare','stage'].includes(command)){
          const result=await workspace[command](input);
          return json(res,result?.status==='FAILED'?422:200,result);
        }
        if(command==='resume'){
          exactFields(input,['requestId']);const result=await workspace.resume(input.requestId);
          return json(res,result?.status==='FAILED'?422:200,result);
        }
        if(command==='release-console'){
          exactFields(input,[]);return json(res,200,await workspace.openReleases());
        }
      }
      return json(res,404,{error:'WORKSPACE_ROUTE_NOT_FOUND',message:'That workspace action does not exist.'});
    }).catch(error=>{
      if(res.writableEnded||res.destroyed)return;
      if(res.headersSent)return res.destroy();
      json(res,error.status??422,{error:error.code??'WORKSPACE_OPERATION_FAILED',message:clean(error.message)});
    });
  });
  server.on('connection',socket=>{connections.add(socket);socket.once('close',()=>connections.delete(socket));});
  server.requestTimeout=150000;server.headersTimeout=10000;server.keepAliveTimeout=2000;
  try{
    await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});
  }catch(error){await workspace.close();throw error;}
  authority='127.0.0.1:'+server.address().port;origin='http://'+authority;
  function close(){
    if(closing)return closing;
    closing=(async()=>{
      const listener=new Promise((done,fail)=>server.close(error=>error?fail(error):done()));
      server.closeIdleConnections();
      try{await workspace.close();}
      finally{for(const socket of connections)socket.destroy();await listener;}
    })();
    return closing;
  }
  return {workspace,server,url:origin,operatorUrl:origin+'/#'+token,token,close};
}
