// MIT. Private loopback operator over the retained workspace; no credential entry or payment engine.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import {inspectGeocodePackage} from './merchant.mjs';
import {readBundle,relativeFile} from '../twelvedata/files.mjs';
import {DELIVERY} from './customer.mjs';
import {identifier,fail} from './config.mjs';
const UI=new URL('./ui/',import.meta.url);
const STATIC=new Map([['/','index.html'],['/app.js','app.js'],['/style.css','style.css']]);
const TYPES={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
function code(error){return typeof error?.code==='string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(error.code)?error.code:'GEOCODE_OPERATION_FAILED';}
async function readInput(request) {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))fail('GEOCODE_JSON_REQUIRED');
  const parts=[];let size=0;
  for await(const part of request){size+=part.length;if(size>2097152)fail('GEOCODE_HTTP_INPUT_TOO_LARGE');parts.push(part);}
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}
  catch{fail('GEOCODE_JSON_INVALID');}
  if(!value || typeof value!=='object' || Array.isArray(value))fail('GEOCODE_JSON_OBJECT_REQUIRED');
  return value;
}
export async function createGeocodeServer({workspace=null,delivery=null,port=0}={}) {
  if(Boolean(workspace)===Boolean(delivery))throw new TypeError('Choose one workspace or one reopened customer delivery');
  if(!Number.isInteger(port)||port<0||port>65535)throw new TypeError('Invalid loopback port');
  const token=randomBytes(32).toString('hex'),tokenBytes=Buffer.from('Bearer '+token);
  let origin,closing=false,closePromise;
  const sockets=new Set(),pending=new Set();
  function authenticated(request){
    const actual=Buffer.from(request.headers.authorization??'');
    return actual.length===tokenBytes.length && timingSafeEqual(actual,tokenBytes);
  }
  function send(response,status,body,type='application/json; charset=utf-8',filename=null){
    const bytes=Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body));
    response.writeHead(status,{'content-type':type,'content-length':String(bytes.length),'cache-control':'no-store',
      'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
      'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      ...(filename?{'content-disposition':'attachment; filename="'+filename.replace(/[^A-Za-z0-9._-]/g,'_')+'"'}:{})});
    response.end(bytes);
  }
  async function dispatch(request,response){
    if(closing){send(response,503,{error:'GEOCODE_OPERATOR_CLOSING'});return;}
    let url;
    try{url=new URL(request.url,origin);}catch{send(response,400,{error:'GEOCODE_URL_INVALID'});return;}
    if(request.headers.host!==new URL(origin).host || url.origin!==origin){send(response,403,{error:'GEOCODE_ORIGIN_REFUSED'});return;}
    if(request.method==='GET' && STATIC.has(url.pathname)){
      const file=STATIC.get(url.pathname);send(response,200,await readFile(new URL(file,UI)),TYPES[file.split('.').at(-1)]);return;
    }
    if(!authenticated(request) || request.headers['sec-fetch-site']==='cross-site'){
      send(response,401,{error:'GEOCODE_OPERATOR_SESSION_REQUIRED'});return;
    }
    const id=url.searchParams.get('id');
    if(request.method==='GET'){
      if(url.pathname==='/api/workspace'){
        send(response,200,delivery?{readOnly:true,delivery:delivery.inspect()}:await workspace.overview());return;
      }
      if(delivery){
        if(url.pathname==='/api/delivery'){send(response,200,delivery.inspect());return;}
        if(url.pathname==='/api/response'){send(response,200,delivery.bytes(),'application/json','response.json');return;}
        send(response,404,{error:'GEOCODE_ROUTE_UNKNOWN'});return;
      }
      if(url.pathname==='/api/packages'){send(response,200,await workspace.listPackages());return;}
      if(url.pathname==='/api/package'){
        const packageId=identifier(url.searchParams.get('packageId'));
        const bundle=await inspectGeocodePackage(join(workspace.directory,'merchant-packages',packageId));
        send(response,200,{manifest:bundle.manifest,plan:bundle.built.plan,terms:bundle.built.terms});return;
      }
      if(url.pathname==='/api/request'){send(response,200,await workspace.get(id));return;}
      if(url.pathname==='/api/deliveries'){send(response,200,await workspace.listDeliveries());return;}
      if(url.pathname==='/api/export'){const value=await workspace.openExport(id);send(response,200,value.delivery.inspect());return;}
      if(url.pathname==='/api/export-file'){
        const value=await workspace.openExport(id),bundle=await readBundle(value.directory,{schema:DELIVERY});
        const name=relativeFile(url.searchParams.get('name')),bytes=bundle.files.get(name);
        if(!bytes)fail('GEOCODE_ARTIFACT_UNKNOWN');send(response,200,bytes,'application/octet-stream',name.split('/').at(-1));return;
      }
      if(url.pathname==='/api/capture-file'){
        const name=relativeFile(url.searchParams.get('name')),bytes=await workspace.readCaptureFile(id,name);
        send(response,200,bytes,'application/octet-stream',name.split('/').at(-1));return;
      }
      if(url.pathname==='/api/merchant-file'){
        const packageId=identifier(url.searchParams.get('packageId'));
        const bundle=await inspectGeocodePackage(join(workspace.directory,'merchant-packages',packageId));
        const name=relativeFile(url.searchParams.get('name')),bytes=bundle.files.get(name);
        if(!bytes)fail('GEOCODE_ARTIFACT_UNKNOWN');send(response,200,bytes,'application/octet-stream',name.split('/').at(-1));return;
      }
      if(url.pathname==='/api/release-diff'){
        send(response,200,await workspace.releaseDiff(url.searchParams.get('before'),url.searchParams.get('after')));return;
      }
      send(response,404,{error:'GEOCODE_ROUTE_UNKNOWN'});return;
    }
    if(request.method!=='POST'){send(response,405,{error:'GEOCODE_METHOD_NOT_ALLOWED'});return;}
    if(request.headers.origin!==origin){send(response,403,{error:'GEOCODE_ORIGIN_REQUIRED'});return;}
    if(delivery){send(response,409,{error:'GEOCODE_DELIVERY_READ_ONLY'});return;}
    const input=await readInput(request);let result;
    switch(url.pathname){
      case '/api/capture': result=await workspace.capture(input);break;
      case '/api/select': result=await workspace.select(input);break;
      case '/api/export': result=await workspace.export(input);break;
      case '/api/package': result=await workspace.package(input);break;
      case '/api/stage': result=await workspace.stage(input);break;
      case '/api/activate': result=await workspace.activate(input);break;
      case '/api/rollback': result=await workspace.rollback(input);break;
      case '/api/start': result=await workspace.start(input);break;
      case '/api/stop': result=await workspace.stop();break;
      case '/api/import-response': {
        if(typeof input.responseBase64!=='string')fail('GEOCODE_RESPONSE_BYTES_REQUIRED');
        const {responseBase64,...rest}=input,bytes=Buffer.from(responseBase64,'base64');
        if(bytes.toString('base64')!==responseBase64)fail('GEOCODE_RESPONSE_BASE64_INVALID');
        result=await workspace.importResponse({...rest,bytes});break;
      }
      default: send(response,404,{error:'GEOCODE_ROUTE_UNKNOWN'});return;
    }
    send(response,200,result);
  }
  const server=createServer((request,response)=>{
    const operation=dispatch(request,response).catch(error=>{
      if(!response.headersSent)send(response,code(error).includes('CONFLICT')||code(error).includes('CHANGED')?409:400,
        {error:code(error),message:typeof error?.message==='string'?error.message.slice(0,400):code(error)});
      else response.destroy();
    });
    pending.add(operation);void operation.finally(()=>pending.delete(operation));
  });
  server.requestTimeout=20000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
  origin='http://127.0.0.1:'+server.address().port;
  const close=()=>closePromise??=(async()=>{
    closing=true;const stopped=new Promise(done=>server.close(done));
    await Promise.allSettled([...pending]);await workspace?.close();
    for(const socket of sockets)socket.destroy();await stopped;
  })();
  return {server,origin,url:origin+'/#'+token,token,close};
}
