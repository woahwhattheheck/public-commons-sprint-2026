// MIT. Private industrial supplier-order browser and complete original-file API.
import { createServer } from 'node:http';
import { readBrowserAssets } from '../../distribution/browser-assets.mjs';
import { createReadStream, constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openSupplierOrderWorkspace, MAX_SOURCE_BYTES, MAX_PACKAGE_BYTES } from './workspace.mjs';
import { data, fail } from './core.mjs';

const API='/api/supplier-orders',MAX_JSON_BYTES=256*1024*1024,TRANSFER_IDLE_MS=30000;
const outgoingTimeout=new WeakMap();
function responseTransfer(response){
  if(outgoingTimeout.has(response))return;
  const stalled=()=>response.destroy(Object.assign(new Error('The original file response stopped making progress.'),{code:'ORDER_HTTP_TRANSFER_IDLE'}));
  const clear=()=>{response.off('timeout',stalled);response.off('finish',clear);response.off('close',clear);response.setTimeout(0);outgoingTimeout.delete(response);};
  outgoingTimeout.set(response,clear);response.setTimeout(TRANSFER_IDLE_MS,stalled);response.once('finish',clear);response.once('close',clear);
}
function incomingTransfer(request,response){
  if(request.complete)return()=>{};
  const stalled=()=>{const error=Object.assign(new Error('The original request body stopped making progress.'),{code:'ORDER_HTTP_TRANSFER_IDLE'});request.destroy(error);response.destroy(error);};
  const clear=()=>{request.off('timeout',stalled);request.off('end',clear);request.off('close',clear);if(!outgoingTimeout.has(response))request.setTimeout(0);};
  request.setTimeout(TRANSFER_IDLE_MS,stalled);request.once('end',clear);request.once('close',clear);return clear;
}
const STATIC=new Map([...await readBrowserAssets(new URL('./browser-assets.json',import.meta.url))].map(([route,{url,type}])=>[route,{path:url,mime:type}]));
function commonHeaders(response){
  response.setHeader('Cache-Control','no-store');
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Referrer-Policy','no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy','same-origin');
  response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}
function json(response,value,status=200){
  if(response.destroyed||response.writableEnded)return;
  const content=JSON.stringify(value);responseTransfer(response);response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(content)});response.end(content);
}
function errorResponse(response,error){
  if(response.headersSent){response.destroy(error);return;}
  const status=Number.isInteger(error.status)&&error.status>=400&&error.status<600?error.status:500;
  json(response,{error:{code:error.code??'ORDER_HTTP_FAILED',message:error.message??String(error),...(error.details?{details:error.details}:{})}},status);
}
async function body(request,maximum){
  const expected=request.headers['content-length'];
  if(expected!==undefined&&(!/^\d+$/.test(expected)||Number(expected)>maximum))fail('ORDER_HTTP_INPUT_TOO_LARGE','The complete request exceeds the selected transfer limit.',413);
  const parts=[];let bytes=0;
  for await(const chunk of request){bytes+=chunk.length;if(bytes>maximum)fail('ORDER_HTTP_INPUT_TOO_LARGE','The complete request exceeds the selected transfer limit.',413);parts.push(chunk);}
  if(expected!==undefined&&Number(expected)!==bytes)fail('ORDER_HTTP_BODY_INCOMPLETE','The complete original request body was interrupted.',400);
  return Buffer.concat(parts,bytes);
}
async function jsonBody(request){
  const mime=String(request.headers['content-type']??'').split(';')[0].trim().toLowerCase();
  if(mime!=='application/json')fail('ORDER_HTTP_JSON_REQUIRED','Use application/json for this workspace action.',415);
  let value;try{value=JSON.parse((await body(request,MAX_JSON_BYTES)).toString('utf8'));}catch(error){if(error.code)throw error;fail('ORDER_HTTP_JSON_INVALID','Supply complete JSON for this workspace action.',400);}
  data(value);if(!value||typeof value!=='object'||Array.isArray(value))fail('ORDER_HTTP_JSON_OBJECT_REQUIRED','Supply a complete JSON object.',400);return value;
}
function metadata(request){
  let value=request.headers['x-supplier-order-metadata'];
  if(typeof value!=='string'||value.length>16000)fail('ORDER_HTTP_METADATA_REQUIRED','Retain the original request ID, file identity and selected revisions in x-supplier-order-metadata.',400);
  try{if(value.startsWith('%'))value=decodeURIComponent(value);value=JSON.parse(value);}catch{fail('ORDER_HTTP_METADATA_INVALID','The original file metadata is incomplete.',400);}
  data(value);if(!value||typeof value!=='object'||Array.isArray(value))fail('ORDER_HTTP_METADATA_INVALID','Supply the original file metadata object.',400);
  if(!Number.isSafeInteger(value.expectedBytes??value.bytes)||!String(value.expectedSha256??value.sha256??'').match(/^[a-f0-9]{64}$/i))fail('ORDER_HTTP_FILE_IDENTITY_REQUIRED','Include the complete original file byte length and SHA-256.',400);
  return value;
}
function query(url){return Object.fromEntries(['query','status','kind','orderId','offset','limit'].filter(key=>url.searchParams.has(key)).map(key=>[key,url.searchParams.get(key)]));}
function safeEqual(received,expected){
  const a=Buffer.from(received??''),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
function routePath(value){
  try{return value.split('/').filter(Boolean).map(decodeURIComponent);}catch{fail('ORDER_HTTP_PATH_INVALID','Invalid encoded original identifier.',400);}
}
function fileDisposition(name){
  const ascii=String(name).replace(/[^\x20-\x7e]|["\\]/g,'_');
  const original=encodeURIComponent(String(name)).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
  return 'attachment; filename="'+ascii+'"; filename*=UTF-8\'\''+original;
}
async function sendFile(request,response,file){
  const handle=await open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const info=await handle.stat();if(!info.isFile()||info.size!==file.bytes)fail('ORDER_FILE_CHANGED','The complete retained original file changed.',409);
    let start=0,end=file.bytes-1,status=200;
    const range=request.headers.range;
    if(range&&(!request.headers['if-range']||request.headers['if-range']==='"'+file.sha256+'"')){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match||!match[1]&&!match[2])fail('ORDER_FILE_RANGE_INVALID','Select one complete byte range.',416);
      if(match[1]){start=Number(match[1]);end=match[2]?Number(match[2]):end;}
      else{const last=Number(match[2]);start=Math.max(0,file.bytes-last);}
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=file.bytes||end<start){response.setHeader('Content-Range','bytes */'+file.bytes);fail('ORDER_FILE_RANGE_INVALID','The selected byte range is outside this original file.',416);}
      end=Math.min(end,file.bytes-1);status=206;
    }
    const headers={'Content-Type':file.mimeType??'application/octet-stream','Content-Length':Math.max(0,end-start+1),
      'Content-Disposition':fileDisposition(file.name),'Accept-Ranges':'bytes','ETag':'"'+file.sha256+'"',
      'X-Content-SHA256':file.sha256,'X-Supplier-Order-File-Id':file.id,'X-Supplier-Order-File-Bytes':String(file.bytes)};
    if(status===206)headers['Content-Range']='bytes '+start+'-'+end+'/'+file.bytes;
    responseTransfer(response);response.writeHead(status,headers);
    if(request.method==='HEAD'||!file.bytes){response.end();return;}
    const stream=handle.createReadStream({start,end,autoClose:false});await pipeline(stream,response);
  }finally{await handle.close();}
}
export async function serveSupplierOrderWorkspace({directory,workspace,host='127.0.0.1',port=0,token}={}){
  if(!['127.0.0.1','::1','localhost'].includes(host))fail('ORDER_SERVER_LOOPBACK_REQUIRED','Bind the private supplier-order operator to a loopback interface.');
  if(!Number.isSafeInteger(port)||port<0||port>65535)fail('ORDER_SERVER_PORT_INVALID','Choose an available TCP port.');
  if(token!==undefined&&(typeof token!=='string'||token.length<32||token.length>512))fail('ORDER_SERVER_TOKEN_INVALID','Use a private token of at least 32 characters.');
  const owned=!workspace,current=workspace??await openSupplierOrderWorkspace({directory}),secret=token??randomBytes(32).toString('base64url');
  let origin=null,closing=false,closePromise,stopped;
  const active=new Set();
  const handle=async(request,response)=>{
    commonHeaders(response);
    const clearIncoming=incomingTransfer(request,response);
    response.once('finish',()=>{if(!request.complete)request.destroy();});
    try{
      if(closing)fail('ORDER_SERVER_CLOSING','The workspace is closing.',503);
      const hostHeader=request.headers.host;
      if(hostHeader!==new URL(origin).host)fail('ORDER_SERVER_HOST_INVALID','Use the original private workspace address.',403);
      const url=new URL(request.url,origin);
      const requestOrigin=request.headers.origin;
      if(requestOrigin&&requestOrigin!==origin)fail('ORDER_SERVER_ORIGIN_INVALID','Use the original private workspace page.',403);
      if(['GET','HEAD'].includes(request.method)&&STATIC.has(url.pathname)){
        const selected=STATIC.get(url.pathname),bytes=await readFile(selected.path);
        responseTransfer(response);response.writeHead(200,{'Content-Type':selected.mime,'Content-Length':bytes.length});response.end(request.method==='HEAD'?undefined:bytes);return;
      }
      if(!url.pathname.startsWith(API+'/'))fail('ORDER_HTTP_NOT_FOUND','Workspace route not found.',404);
      if(!safeEqual(request.headers.authorization,'Bearer '+secret))fail('ORDER_SERVER_AUTH_REQUIRED','Open the original private workspace URL.',401);
      const parts=routePath(url.pathname.slice(API.length)),method=request.method;
      if(method==='GET'&&parts.length===1){
        if(parts[0]==='state')return json(response,current.state());
        if(parts[0]==='orders')return json(response,current.orders(query(url)));
        if(parts[0]==='documents')return json(response,current.documents(query(url)));
        if(parts[0]==='drafts')return json(response,current.drafts(query(url)));
      }
      if(method==='GET'&&parts.length===2){
        const [family,id]=parts;
        if(family==='orders')return json(response,current.order({orderId:id}));
        if(family==='documents')return json(response,current.document({id}));
        if(family==='drafts')return json(response,current.draft({draftId:id}));
        if(family==='operations')return json(response,current.operation({requestId:id}));
      }
      if(['GET','HEAD'].includes(method)&&parts[0]==='files'&&parts.length===2)return await sendFile(request,response,await current.file({id:parts[1]}));
      if(['GET','HEAD'].includes(method)&&parts[0]==='documents'&&parts[2]==='file'&&parts.length===3)return await sendFile(request,response,await current.exportFile({id:parts[1]}));
      if(method!=='POST')fail('ORDER_HTTP_NOT_FOUND','Workspace route not found.',404);
      if(parts.length===1&&parts[0]==='sources'||parts[0]==='packages'&&parts[1]==='import'&&parts.length===2){
        const selected=metadata(request),source=parts[0]==='sources',maximum=source?MAX_SOURCE_BYTES:MAX_PACKAGE_BYTES;
        const file=await current.retain(request,{name:selected.name??(source?'document.xml':'Supplier_Orders_Workspace.zip'),kind:source?'source':'package',mimeType:source?'application/xml':'application/zip',maxBytes:maximum});
        current.verifyInput(file,selected);
        const result=source?await current.importDocument({...selected,sourcePath:file.path}):await current.importWorkspace({...selected,path:file.path});
        return json(response,result);
      }
      const selected=await jsonBody(request);
      if(parts[0]==='drafts'&&parts[1]==='new'&&parts.length===2)return json(response,current.newDraft(selected));
      if(parts[0]==='drafts'&&parts.length===1)return json(response,current.saveDraft(selected));
      if(parts[0]==='drafts'&&parts[2]==='prepare'&&parts.length===3)return json(response,await current.prepareDocument({...selected,draftId:parts[1]}));
      if(parts[0]==='documents'&&parts[2]==='select'&&parts.length===3)return json(response,current.selectDocument({...selected,id:parts[1]}));
      if(parts[0]==='packages'&&parts[1]==='export'&&parts.length===2)return json(response,await current.exportWorkspace({requestId:selected.requestId}));
      fail('ORDER_HTTP_NOT_FOUND','Workspace route not found.',404);
    }catch(error){errorResponse(response,error);}
    finally{if(request.complete||request.destroyed)clearIncoming();}
  };
  const server=createServer({maxHeaderSize:32768},(request,response)=>{
    const task=handle(request,response);active.add(task);
    void task.catch(error=>response.destroy(error)).finally(()=>active.delete(task));
  });
  server.requestTimeout=0;server.headersTimeout=60000;server.keepAliveTimeout=5000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});}
  catch(error){if(owned)await current.close();throw error;}
  const address=server.address(),selectedHost=host==='::1'?'[::1]':host;
  origin='http://'+selectedHost+':'+address.port;
  const close=()=>{
    if(closePromise)return closePromise;
    closing=true;
    stopped??=new Promise((resolve,reject)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
    server.closeIdleConnections();
    const task=(async()=>{
      // A disconnected HTTP client can leave its original native operation running.
      // Retain that handler and store ownership through the actual original outcome.
      await Promise.all([stopped,(async()=>{while(active.size)await Promise.allSettled([...active]);})()]);
      if(owned)await current.close();
    })();
    closePromise=task.catch(error=>{closePromise=null;throw error;});return closePromise;
  };
  return{server,workspace:current,origin,token:secret,url:origin+'/public/index.html#token='+encodeURIComponent(secret),
    get activeRequests(){return active.size;},close};
}
