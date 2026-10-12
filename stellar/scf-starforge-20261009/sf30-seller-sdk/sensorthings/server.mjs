// MIT. Same-workspace authenticated API and native file delivery.
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import {readOwned} from '../stellar-expert/store.mjs';
import {openSensorThingsWorkspace} from './core.mjs';
import {createFileAccess} from './files.mjs';
import {plain,fields,integer,text,json,sha,identity,fault} from './contract.mjs';
const JSON_LIMIT=2*1024*1024,RESPONSE_LIMIT=24*1024*1024;
const HASH=/^[a-f0-9]{64}$/;
const errorBody=e=>({error:e.code??'SENSORTHINGS_API_FAILURE',message:e.message??'The native operation could not complete.',
  details:e.details??{},operationId:e.operationId??null,currentRevision:e.currentRevision??null});
function matchToken(actual,expected){
  if(typeof actual!=='string'||!actual.startsWith('Bearer ')||typeof expected!=='string')return false;
  const a=Buffer.from(actual.slice(7)),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
function headers(res,workspaceId){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-SensorThings-Workspace',workspaceId);
}
function send(res,status,value,workspaceId){
  const bytes=json(value);
  if(bytes.length>RESPONSE_LIMIT)throw fault('API_PAGE_CAPACITY','Use an original paged view or retained file read for this complete large result.',413);
  headers(res,workspaceId);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length});res.end(bytes);
}
async function body(req,maximum=JSON_LIMIT){
  const type=String(req.headers['content-type']??'').split(';')[0].trim().toLowerCase();
  if(type!=='application/json')throw fault('API_CONTENT_TYPE','Send the declared JSON request body.',415);
  const length=req.headers['content-length'];
  if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>maximum))throw fault('API_BODY_LIMIT','The request body exceeds the native action capacity.',413);
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>maximum)throw fault('API_BODY_LIMIT','The request body exceeds the native action capacity.',413);chunks.push(chunk);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));}
  catch{throw fault('API_JSON','Use complete UTF-8 JSON for the original operation.');}
}
function parameter(url,key,fallback){
  const values=url.searchParams.getAll(key);if(values.length>1)throw fault('API_PARAMETER','Do not repeat a native query parameter.');
  return values.length?values[0]:fallback;
}
function numberParameter(url,key,fallback,maximum=Number.MAX_SAFE_INTEGER){
  const value=parameter(url,key,null);if(value===null)return fallback;
  if(!/^(0|[1-9]\d*)$/.test(value))throw fault('API_PARAMETER','Use a nonnegative integer '+key+'.');
  return integer(Number(value),key,0,maximum);
}
function selectionParameter(url){
  const value=parameter(url,'selection',null);
  if(typeof value!=='string'||value.length>8192)throw fault('FILE_SELECTION','Supply one original file selection.');
  try{const selected=JSON.parse(value);if(!plain(selected))throw Error();return selected;}
  catch{throw fault('FILE_SELECTION','Supply one original manifest-bound JSON file selection.');}
}
function selectedMetadata(value,selection){
  const files=Array.isArray(value)?value:value?.files;
  if(!Array.isArray(files))throw fault('FILE_MANIFEST','The original file owner returned an incomplete selection.',409);
  if(files.length===1)return files[0];
  const wanted=files.filter(f=>f.selection&&identity(f.selection)===identity(selection));
  if(wanted.length!==1)throw fault('FILE_SELECTION','Select one exact file from the original returned file list.');
  return wanted[0];
}
function rangeFor(header,size){
  if(header===undefined)return {start:0,end:size-1,status:200};
  if(typeof header!=='string'||!/^bytes=(?:\d+-\d*|-\d+)$/.test(header)||!size)throw fault('RANGE','Choose one byte range in the complete retained file.',416,{bytes:size});
  const [left,right]=header.slice(6).split('-');let start,end;
  if(!left){const suffix=Number(right);if(!Number.isSafeInteger(suffix)||suffix<1)throw fault('RANGE','Choose a positive suffix length.',416,{bytes:size});start=Math.max(0,size-suffix);end=size-1;}
  else{start=Number(left);end=right?Number(right):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)
    throw fault('RANGE','The requested byte range is outside the original file.',416,{bytes:size});
  return {start,end:Math.min(end,size-1),status:206};
}
async function waitDrain(res){
  if(res.destroyed)throw fault('CLIENT_CLOSED','The original download connection closed.',499);
  await new Promise((resolve,reject)=>{
    const cleanup=()=>{res.off('drain',drain);res.off('close',closed);res.off('error',error);};
    const drain=()=>{cleanup();resolve();},closed=()=>{cleanup();reject(fault('CLIENT_CLOSED','The original download connection closed.',499));},
      error=e=>{cleanup();reject(e);};
    res.once('drain',drain);res.once('close',closed);res.once('error',error);
    if(res.destroyed)closed();
  });
}
async function download(req,res,url,files,workspaceId){
  const selection=selectionParameter(url),expected=parameter(url,'expectedSha256',null);
  if(!HASH.test(expected??''))throw fault('FILE_IDENTITY','Download an exact selected SHA256 from the original file list.');
  const listed=await files.list(selection),metadata=selectedMetadata(listed,selection);
  if(metadata.sha256!==expected)throw fault('FILE_CHANGED','The original file selection differs from the requested SHA256.',409);
  const size=metadata.bytes;if(!Number.isSafeInteger(size)||size<0)throw fault('FILE_IDENTITY','The original file length is invalid.',409);
  const range=rangeFor(req.headers['if-range']&&req.headers['if-range']!=='"'+expected+'"'?undefined:req.headers.range,size);
  let readId=null,offset=range.start,finished=false;
  try{
    // Verify the complete original through its held descriptor before promising
    // response headers. The same descriptor supplies every later chunk.
    let chunk=await files.read({selection,expectedSha256:expected,offset,limit:Math.min(65536,Math.max(1,range.end-offset+1))});
    readId=chunk.readId;
    if(chunk.file?.sha256!==expected||chunk.file?.bytes!==size)throw fault('FILE_CHANGED','The native file reader returned another original identity.',409);
    const name=metadata.name??metadata.filename??'source.bin';
    if(typeof name!=='string'||/[\\/\u0000-\u001f\u007f]/.test(name)||name.length>255)throw fault('FILE_NAME','The native download filename is invalid.',409);
    headers(res,workspaceId);
    const resultHeaders={'Content-Type':metadata.type??'application/octet-stream','Content-Length':Math.max(0,range.end-range.start+1),
      'ETag':'"'+expected+'"','Accept-Ranges':'bytes','X-Source-SHA256':expected,
      'Content-Disposition':'attachment; filename="'+name.replace(/[^\x20-\x7e]|["\\]/g,'_')+'"; filename*=UTF-8\'\''+encodeURIComponent(name)};
    if(range.status===206)resultHeaders['Content-Range']='bytes '+range.start+'-'+range.end+'/'+size;
    res.writeHead(range.status,resultHeaders);
    while(true){
      if(chunk.offset!==offset||chunk.encoding!=='base64'||typeof chunk.data!=='string')throw fault('FILE_CHUNK','The native original chunk changed.',409);
      const bytes=Buffer.from(chunk.data,'base64'),remaining=Math.max(0,range.end-offset+1);
      if(bytes.length!==chunk.bytesRead||bytes.length>remaining||bytes.length===0&&remaining>0)throw fault('FILE_CHUNK','The retained byte range is incomplete.',409);
      if(bytes.length&&!res.write(bytes))await waitDrain(res);
      offset+=bytes.length;if(offset>range.end){finished=true;res.end();break;}
      chunk=await files.read({selection,readId,expectedSha256:expected,offset,limit:Math.min(65536,range.end-offset+1)});
    }
  }finally{if(readId)await files.release(readId).catch(()=>{});if(!finished&&res.headersSent)res.destroy();}
}
/** Trusted UI code may be served by staticHandler. It never receives the token.
 * The handler owns only HTTP/file reads; it does not open or close another store. */
export function createSensorThingsHandler({workspace,token,origin,staticHandler=null,files=createFileAccess(workspace)}){
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,200}$/.test(token))throw fault('API_TOKEN','Use the original host-selected private session token.');
  const allowed=new URL(origin),workspaceId=workspace.schema().workspaceId,pending=new Set();let closing=false,closePromise=null;
  async function route(req,res){
    if(closing)throw fault('API_CLOSING','The original workspace API is closing.',503);
    if(req.headers.host!==allowed.host)throw fault('API_HOST','Use the original selected workspace origin.',403);
    if(req.headers.origin!==undefined&&req.headers.origin!==allowed.origin)throw fault('API_ORIGIN','The request origin is not this original workspace.',403);
    if(typeof req.url!=='string'||req.url.length>16384||!req.url.startsWith('/'))throw fault('API_PATH','Use a native relative request path.');
    const url=new URL(req.url,allowed);
    if(url.origin!==allowed.origin)throw fault('API_ORIGIN','Use this original workspace URL.',403);
    if(!url.pathname.startsWith('/api/')){
      if(req.method!=='GET'&&req.method!=='HEAD')throw fault('API_METHOD','Use the advertised application route.',405);
      if(staticHandler&&await staticHandler(req,res,{url,workspaceId}))return;
      if(url.pathname==='/'){headers(res,workspaceId);res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('SensorThings native workspace API. Open the maintained Operations Desk or use the original CLI/MCP connection.');return;}
      throw fault('API_ROUTE','The requested application route is not available.',404);
    }
    if(!matchToken(req.headers.authorization,token))throw fault('API_AUTH','Open the original private workspace session.',401);
    if(url.pathname!=='/api/schema'&&req.headers['x-sensorthings-workspace']!==workspaceId)
      throw fault('API_WORKSPACE','Bind the request to the original workspace UUID from its schema.',409);
    headers(res,workspaceId);
    if(req.method==='GET'){
      if(url.pathname==='/api/schema')return send(res,200,workspace.schema(),workspaceId);
      if(url.pathname==='/api/view')return send(res,200,await workspace.view(),workspaceId);
      if(url.pathname==='/api/files')return send(res,200,await files.list(selectionParameter(url)),workspaceId);
      if(url.pathname==='/api/files/download')return download(req,res,url,files,workspaceId);
      let m;
      if((m=/^\/api\/catalogs\/([a-f0-9]{64})\/rows$/.exec(url.pathname)))
        return send(res,200,await workspace.catalogRows(m[1],{offset:numberParameter(url,'offset',0),limit:numberParameter(url,'limit',100,500)}),workspaceId);
      if((m=/^\/api\/editions\/([a-f0-9]{64})\/(metadata|rows|summary)$/.exec(url.pathname))){
        const value=m[2]==='metadata'?await workspace.edition(m[1]):m[2]==='summary'?await workspace.summary(m[1]):
          await workspace.rows(m[1],{table:parameter(url,'table','observations'),offset:numberParameter(url,'offset',0),limit:numberParameter(url,'limit',100,500)});
        return send(res,200,value,workspaceId);
      }
      if((m=/^\/api\/captures\/([a-f0-9]{24})$/.exec(url.pathname)))return send(res,200,workspace.capture(m[1]),workspaceId);
      if((m=/^\/api\/releases\/([a-z][a-z0-9-]{0,100})$/.exec(url.pathname)))return send(res,200,await workspace.release(m[1]),workspaceId);
      if((m=/^\/api\/publishers\/(dataset-[a-f0-9]{24})$/.exec(url.pathname)))return send(res,200,await workspace.publisher(m[1]),workspaceId);
      if((m=/^\/api\/operations\/([A-Za-z0-9_-]{8,100})$/.exec(url.pathname))){
        const op=workspace.store.read().operations[m[1]];
        if(!op)throw fault('OPERATION','No original operation with this identity is retained.',404);
        const {payload,context,...view}=op;
        const result=op.resultSha256?JSON.parse((await workspace.store.object(op.resultSha256)).toString('utf8')):null;
        return send(res,200,{...view,result},workspaceId);
      }
      throw fault('API_ROUTE','Choose a declared native read route.',404);
    }
    if(req.method==='POST'){
      const input=await body(req);
      if(url.pathname==='/api/action')return send(res,200,await workspace.action(input),workspaceId);
      if(url.pathname==='/api/files/read'){
        fields(input,['selection','readId','expectedSha256','offset','limit'],['selection']);
        return send(res,200,await files.read(input),workspaceId);
      }
      if(url.pathname==='/api/files/release'){
        fields(input,['readId'],['readId']);await files.release(input.readId);return send(res,200,{released:true,readId:input.readId},workspaceId);
      }
      throw fault('API_ROUTE','Choose a declared native operation route.',404);
    }
    throw fault('API_METHOD','Use the advertised GET or POST method.',405);
  }
  function handle(req,res){
    const call=route(req,res).catch(e=>{
      if(res.headersSent){res.destroy();return;}
      if(e.status===416)res.setHeader('Content-Range','bytes */'+(e.details?.bytes??'*'));
      try{send(res,Number.isInteger(e.status)?e.status:500,errorBody(e),workspaceId);}catch{res.destroy();}
    });pending.add(call);void call.finally(()=>pending.delete(call));return call;
  }
  function close(){
    if(closePromise)return closePromise;closing=true;
    closePromise=(async()=>{await Promise.allSettled([...pending]);await files.close();})();
    void closePromise.catch(()=>{closePromise=null;});return closePromise;
  }
  return {handle,close,workspaceId,origin:allowed.origin};
}
async function sessionToken(workspace,supplied){
  const path=join(workspace.directory,'operator-session.json');
  try{
    const prior=JSON.parse((await readOwned(path,16384)).toString('utf8'));
    if(prior.schema!=='stellar-forge.sensorthings-private-session.v1'||prior.workspaceId!==workspace.schema().workspaceId||
        !/^[A-Za-z0-9_-]{32,200}$/.test(prior.token??'')||supplied!==undefined&&supplied!==prior.token)
      throw fault('API_SESSION','The saved private session belongs to another original workspace or token.',409);
    return prior.token;
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const token=supplied??randomBytes(32).toString('base64url');
  if(!/^[A-Za-z0-9_-]{32,200}$/.test(token))throw fault('API_TOKEN','Use a private host-selected token of at least32 characters.');
  await workspace.store.immutable(path,json({schema:'stellar-forge.sensorthings-private-session.v1',workspaceId:workspace.schema().workspaceId,token}));
  return token;
}
export async function serveSensorThingsWorkspace({host='127.0.0.1',port=0,token,expectedWorkspaceId,staticHandler,workspace:provided,...options}={}){
  if(!['127.0.0.1','::1'].includes(host))throw fault('API_BIND','The native session listener binds an explicit loopback address.');
  integer(port,'port',0,65535);
  const workspace=provided??await openSensorThingsWorkspace(options),owned=!provided;
  let server,api,closePromise=null;
  try{
    if(expectedWorkspaceId!==undefined&&workspace.schema().workspaceId!==expectedWorkspaceId)throw fault('API_WORKSPACE','The selected original workspace UUID changed.',409);
    const selectedToken=await sessionToken(workspace,token);
    server=createServer({maxHeaderSize:16384},(req,res)=>api?api.handle(req,res):(res.writeHead(503),res.end()));
    server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
    const address=server.address(),origin='http://'+(host==='::1'?'[::1]':host)+':'+address.port;
    api=createSensorThingsHandler({workspace,token:selectedToken,origin,staticHandler});
    function close(){
      if(closePromise)return closePromise;
      closePromise=(async()=>{const stopped=new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
        server.closeIdleConnections?.();await api.close();await stopped;if(owned)await workspace.close();})();
      void closePromise.catch(()=>{closePromise=null;});return closePromise;
    }
    return {workspace,server,handler:api.handle,workspaceId:api.workspaceId,origin,url:origin+'/#'+selectedToken,close};
  }catch(e){if(server)await new Promise(resolve=>server.close(()=>resolve())).catch(()=>{});if(api)await api.close().catch(()=>{});if(owned)await workspace.close().catch(()=>{});throw e;}
}
