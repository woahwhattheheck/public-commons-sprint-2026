// MIT. Local authenticated HTTP surface for original API-pass customer work.
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {readBrowserAssets} from '../../../distribution/browser-assets.mjs';
import {MAX_BODY_BYTES,check,fail,uuid} from './configuration.mjs';

const ASSETS=await readBrowserAssets(new URL('./browser-assets.json',import.meta.url));
const same=(left,right)=>typeof left==='string'&&Buffer.byteLength(left)===Buffer.byteLength(right)&&timingSafeEqual(Buffer.from(left),Buffer.from(right));
const jsonBytes=value=>Buffer.from(JSON.stringify(value));
const codeOf=error=>typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{1,140}$/.test(error.code)?error.code:'WORKSPACE_REQUEST_FAILED';
async function body(request){
 const type=(request.headers['content-type']??'').split(';')[0].trim();
 check(type==='application/json','JSON_REQUEST_REQUIRED',415);
 let size=0;const chunks=[];
 for await(const chunk of request){size+=chunk.length;check(size<=Math.ceil(MAX_BODY_BYTES/3)*4+131072,'WORKSPACE_REQUEST_TOO_LARGE',413);chunks.push(chunk);}
 let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('JSON_REQUEST_INVALID');}
 check(value&&typeof value==='object'&&!Array.isArray(value),'JSON_OBJECT_REQUIRED');return value;
}
function preview(bytes){
 const sample=bytes.subarray(0,65536);let text,binary=false;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(sample);}catch{
  binary=true;
  if(bytes.length>sample.length)for(let trim=1;trim<=3;trim++){
   try{text=new TextDecoder('utf-8',{fatal:true}).decode(sample.subarray(0,sample.length-trim));binary=false;break;}catch{}
  }
 }
 if(!binary&&/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text??''))binary=true;
 return {text:binary?'':text,truncated:bytes.length>sample.length,binary,bytes:bytes.length};
}
export async function startApiPassWorkspace({model,port=0,host='127.0.0.1'}){
 check(model&&typeof model.snapshot==='function'&&typeof model.enqueue==='function','ORIGINAL_CUSTOMER_MODEL_REQUIRED');
 check(host==='127.0.0.1','LOOPBACK_BIND_REQUIRED');check(Number.isInteger(port)&&port>=0&&port<=65535,'INVALID_PORT');
 const token=randomBytes(32).toString('base64url'),pending=new Set(),sockets=new Set(),hosts=new Set();
 let closing=false,closingPromise,origin;
 const send=(response,status,value,{type='application/json; charset=utf-8',filename,headers={}}={})=>{
  if(response.destroyed||response.writableEnded)return;
  const bytes=Buffer.isBuffer(value)?value:jsonBytes(value);
  response.writeHead(status,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
   'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
   ...(filename?{'Content-Disposition':'attachment; filename="'+filename.replace(/[^A-Za-z0-9._-]/g,'_')+'"'}:{}),...headers});
  response.end(bytes);
 };
 const authorized=request=>check(same(request.headers.authorization,'Bearer '+token),'WORKSPACE_AUTHENTICATION_REQUIRED',401);
 async function serve(request,response){
  try{
   check(!closing,'WORKSPACE_CLOSING',503);check(hosts.has(request.headers.host),'WORKSPACE_HOST_INVALID',403);
   const url=new URL(request.url,origin),path=url.pathname;
   const asset=ASSETS.get(path);
   if(request.method==='GET'&&asset){
    if(path.startsWith('/original-approval/'))check(model.approvals,'ORIGINAL_APPROVAL_ASSET_UNAVAILABLE',404);
    send(response,200,await readFile(asset.url),{type:asset.type});return;
   }
   check(path.startsWith('/api/'),'WORKSPACE_ROUTE_NOT_FOUND',404);authorized(request);
   check(['GET','POST'].includes(request.method),'WORKSPACE_METHOD_NOT_ALLOWED',405);
   if(request.method==='POST')check(request.headers.origin===origin,'WORKSPACE_ORIGIN_REQUIRED',403);
   if(request.method==='GET'&&path==='/api/session'){
    const state=await model.snapshot();send(response,200,{schema:'stellar-forge.sf101.api-pass-workspace-session.v1',workspaceId:state.id,title:state.title,
     approvalMode:state.approvalMode,purchaseEnabled:state.purchaseEnabled});return;
   }
   if(request.method==='GET'&&path==='/api/state'){send(response,200,await model.snapshot());return;}
   let match;
   if(request.method==='GET'&&(match=/^\/api\/profiles\/([^/]+)$/.exec(path))){
    send(response,200,await model.detail(uuid(match[1]),{offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??100)}));return;
   }
   if(request.method==='GET'&&(match=/^\/api\/profiles\/([^/]+)\/remote-calls$/.exec(path))){
    send(response,200,await model.remoteCalls(uuid(match[1]),{...(url.searchParams.has('after')?{after:url.searchParams.get('after')}:{ }),
     limit:Number(url.searchParams.get('limit')??100)}));return;
   }
   if(request.method==='GET'&&(match=/^\/api\/profiles\/([^/]+)\/approval$/.exec(path))){send(response,200,await model.approval(uuid(match[1])));return;}
   if(request.method==='GET'&&(match=/^\/api\/profiles\/([^/]+)\/review$/.exec(path))){
    const value=await model.reviewDocument(uuid(match[1]));send(response,200,value.bytes,{filename:value.name,
     headers:{'X-SF101-Result-Sha256':value.metadata.sha256}});return;
   }
   if(request.method==='GET'&&(match=/^\/api\/profiles\/([^/]+)\/export$/.exec(path))){
    const value=await model.exportMetadata(uuid(match[1]));send(response,200,Buffer.from(JSON.stringify(value,null,2)+'\n'),{filename:'api-pass-customer-history.json'});return;
   }
   if(request.method==='GET'&&(match=/^\/api\/calls\/([^/]+)$/.exec(path))){send(response,200,await model.callDetail(uuid(match[1])));return;}
   if(request.method==='GET'&&(match=/^\/api\/calls\/([^/]+)\/(result|preview|body)$/.exec(path))){
    const id=uuid(match[1]),kind=match[2];
    if(kind==='body'){const value=await model.body(id);send(response,200,{...preview(value.bytes),present:value.present});return;}
    const value=await model.result(id);
    if(kind==='preview')send(response,200,{...preview(value.bytes),metadata:value.metadata});
    else send(response,200,value.bytes,{type:'application/octet-stream',filename:value.name,headers:{'X-SF101-Result-Sha256':value.metadata.sha256}});
    return;
   }
   if(request.method==='GET'&&(match=/^\/api\/tasks\/([^/]+)\/proof$/.exec(path))){
    const value=await model.proof(uuid(match[1]));send(response,200,value.bytes,{filename:value.name,
     headers:{'X-SF101-Result-Sha256':value.metadata.sha256}});return;
   }
   if(request.method==='GET'&&(match=/^\/api\/tasks\/([^/]+)\/report$/.exec(path))){
    const value=await model.report(uuid(match[1]));send(response,200,value.bytes,{type:'text/html; charset=utf-8',filename:value.name,
     headers:{'X-SF101-Result-Sha256':value.metadata.sha256}});return;
   }
   if(request.method==='POST'){
    const value=await body(request);let result;
    if(path==='/api/passes/connect')result=await model.connectPass(value);
    else if(path==='/api/purchases/prepare')result=await model.preparePurchase(value);
    else if(path==='/api/purchases/attach')result=await model.attachPurchase(value);
    else if((match=/^\/api\/profiles\/([^/]+)\/update$/.exec(path)))result=await model.editPass(uuid(match[1]),value);
    else if((match=/^\/api\/profiles\/([^/]+)\/calls$/.exec(path)))result=await model.prepareCall(uuid(match[1]),value);
    else if((match=/^\/api\/profiles\/([^/]+)\/tasks$/.exec(path)))result=await model.enqueue(uuid(match[1]),value);
    else if((match=/^\/api\/profiles\/([^/]+)\/adopt-request$/.exec(path)))result=await model.recoverRemote(uuid(match[1]),value);
    else if((match=/^\/api\/profiles\/([^/]+)\/approval$/.exec(path)))result=await model.decide(uuid(match[1]),value);
    else if((match=/^\/api\/tasks\/([^/]+)\/cancel$/.exec(path)))result=await model.cancelTask(uuid(match[1]),value);
    else fail('WORKSPACE_ROUTE_NOT_FOUND',404);
    send(response,200,{result,state:await model.snapshot()});return;
   }
   fail('WORKSPACE_ROUTE_NOT_FOUND',404);
  }catch(error){
   request.resume();send(response,Number.isInteger(error.status)?error.status:400,{error:codeOf(error)});
  }
 }
 const server=createServer((request,response)=>{
  const task=serve(request,response).finally(()=>pending.delete(task));pending.add(task);
 });
 server.requestTimeout=30000;server.headersTimeout=15000;
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});}
 catch(error){await model.close();throw error;}
 const actual=server.address().port;origin=new URL('http://127.0.0.1:'+actual).origin;
 hosts.add('127.0.0.1:'+actual);hosts.add(new URL(origin).host);
 return {server,model,url:origin+'/#'+token,origin,port:actual,workspaceId:model.state.id,
  close(){
   if(closingPromise)return closingPromise;closing=true;
   closingPromise=(async()=>{
    const stopped=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    server.closeIdleConnections?.();
    const timer=setTimeout(()=>{for(const socket of sockets)socket.destroy();},20000);timer.unref?.();
    try{
     await model.close();await Promise.allSettled([...pending]);await stopped;
    }finally{clearTimeout(timer);}
   })();return closingPromise;
  }
 };
}
