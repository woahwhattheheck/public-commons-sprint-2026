// MIT. Private loopback operator over the retained workspace; no credential entry or payment engine.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
import {inspectGeocodePackage} from './merchant.mjs';
import {readBundle,relativeFile} from '../twelvedata/files.mjs';
import {DELIVERY} from './customer.mjs';
import {inspectCsvSource} from './batch.mjs';
import {identifier,fail} from './config.mjs';
const UI=new URL('./ui/',import.meta.url);
const STATIC=new Map([['/','index.html'],['/app.js','app.js'],['/style.css','style.css'],['/batch.js','batch.js']]);
const TYPES={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
function code(error){return typeof error?.code==='string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(error.code)?error.code:'GEOCODE_OPERATION_FAILED';}
async function readInput(request,maxBytes=2097152) {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))fail('GEOCODE_JSON_REQUIRED');
  const parts=[];let size=0;
  for await(const part of request){size+=part.length;if(size>maxBytes)fail('GEOCODE_HTTP_INPUT_TOO_LARGE');parts.push(part);}
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}
  catch{fail('GEOCODE_JSON_INVALID');}
  if(!value || typeof value!=='object' || Array.isArray(value))fail('GEOCODE_JSON_OBJECT_REQUIRED');
  return value;
}
export async function createGeocodeServer({workspace=null,delivery=null,batchDelivery=null,port=0,managedLaunch=null}={}) {
  if([workspace,delivery,batchDelivery].filter(Boolean).length!==1)throw new TypeError('Choose one workspace or one reopened customer delivery');
  if(!Number.isInteger(port)||port<0||port>65535)throw new TypeError('Invalid loopback port');
  if(managedLaunch!==null&&(!workspace||typeof managedLaunch!=='object'||Array.isArray(managedLaunch)))
    throw new TypeError('Managed launch needs the original operator workspace');
  const managedStartup=managedLaunch===null?null:Object.freeze({...structuredClone(managedLaunch),instanceId:randomUUID(),pid:process.pid});
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
  function pageNumber(url,key,fallback,max=Number.MAX_SAFE_INTEGER){
    const value=url.searchParams.get(key);
    if(value===null)return fallback;
    if(!/^[0-9]+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)fail('GEOCODE_BATCH_PAGE_INVALID');
    return Number(value);
  }
  const pageFor=url=>({offset:pageNumber(url,'offset',0),limit:pageNumber(url,'limit',50,100)});
  async function selectedBatch(url){
    const id=url.searchParams.get('exportId');
    if(batchDelivery){
      if(id!==null&&id!==batchDelivery.manifest.exportId)fail('GEOCODE_CSV_DELIVERY_CHANGED');
      return batchDelivery;
    }
    return (await workspace.batches()).openDelivery(identifier(id));
  }
  async function sendBatchFile(response,selected,name){
    const {handle,file}=await selected.openFile(relativeFile(name));
    try{
      response.writeHead(200,{'content-type':'application/octet-stream','content-length':String(file.bytes),
        'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
        'content-disposition':'attachment; filename="'+file.name.split('/').at(-1).replace(/[^A-Za-z0-9._-]/g,'_')+'"'});
      if(file.bytes===0)response.end();
      else await pipeline(handle.createReadStream({autoClose:false,start:0,end:file.bytes-1}),response);
    }finally{await handle.close();}
  }
  function csvInput(input){
    if(typeof input.csvBase64!=='string')fail('GEOCODE_CSV_BYTES_REQUIRED');
    const {csvBase64,...selection}=input,bytes=Buffer.from(csvBase64,'base64');
    if(bytes.toString('base64')!==csvBase64)fail('GEOCODE_CSV_BASE64_INVALID');
    return {...selection,bytes};
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
      if(url.pathname==='/api/managed-launch'&&managedStartup){send(response,200,managedStartup);return;}
      if(url.pathname==='/api/workspace'){
        send(response,200,batchDelivery?{readOnly:true,batchDelivery:batchDelivery.inspect()}:
          delivery?{readOnly:true,delivery:delivery.inspect()}:await workspace.overview({
            offset:pageNumber(url,'offset',0),limit:pageNumber(url,'limit',100,1000)}));return;
      }
      if(!delivery){
        if(url.pathname==='/api/batch-delivery'){
          send(response,200,(await selectedBatch(url)).inspect(pageFor(url)));return;
        }
        if(url.pathname==='/api/batch-delivery-row'){
          send(response,200,await (await selectedBatch(url)).row(pageNumber(url,'ordinal',0,10000)));return;
        }
        if(url.pathname==='/api/batch-delivery-file'){
          await sendBatchFile(response,await selectedBatch(url),url.searchParams.get('name'));return;
        }
      }
      if(batchDelivery){send(response,404,{error:'GEOCODE_ROUTE_UNKNOWN'});return;}
      if(delivery){
        if(url.pathname==='/api/delivery'){send(response,200,delivery.inspect());return;}
        if(url.pathname==='/api/response'){send(response,200,delivery.bytes(),'application/json','response.json');return;}
        send(response,404,{error:'GEOCODE_ROUTE_UNKNOWN'});return;
      }
      if(url.pathname==='/api/batches'){send(response,200,await (await workspace.batches()).list());return;}
      if(url.pathname==='/api/batch'){
        send(response,200,await (await workspace.batches()).status(url.searchParams.get('batchId'),
          {...pageFor(url),...(url.searchParams.get('status')?{status:url.searchParams.get('status')}:{})}));return;
      }
      if(url.pathname==='/api/batch-row'){
        send(response,200,await (await workspace.batches()).row(url.searchParams.get('batchId'),pageNumber(url,'ordinal',0,10000)));return;
      }
      if(url.pathname==='/api/batch-source'){
        send(response,200,await (await workspace.batches()).source(url.searchParams.get('batchId')),'text/csv; charset=utf-8','source.csv');return;
      }
      if(url.pathname==='/api/batch-deliveries'){
        send(response,200,await (await workspace.batches()).deliveries(url.searchParams.has('batchId')?{batchId:url.searchParams.get('batchId')}:{}));return;
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
    if(delivery||batchDelivery){send(response,409,{error:'GEOCODE_DELIVERY_READ_ONLY'});return;}
    const input=await readInput(request,['/api/batch/source','/api/batch/review','/api/batch/prepare'].includes(url.pathname)?5242880:2097152);let result;
    switch(url.pathname){
      case '/api/batch/source':result=inspectCsvSource(csvInput(input).bytes);break;
      case '/api/batch/review':result=await (await workspace.batches()).review(csvInput(input));break;
      case '/api/batch/prepare':result=await (await workspace.batches()).prepare(csvInput(input));break;
      case '/api/batch/start':result=await (await workspace.batches()).start(input);break;
      case '/api/batch/stop':result=await (await workspace.batches()).stop(input);break;
      case '/api/batch/reconcile':result=await (await workspace.batches()).reconcile(input);break;
      case '/api/batch/select':result=await (await workspace.batches()).select(input);break;
      case '/api/batch/retry':result=await (await workspace.batches()).retry(input);break;
      case '/api/batch/export':result=await (await workspace.batches()).export(input);break;
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
  origin=new URL('http://127.0.0.1:'+server.address().port).origin;
  const close=()=>closePromise??=(async()=>{
    closing=true;const stopped=new Promise(done=>server.close(done));
    try {await Promise.allSettled([...pending]);await workspace?.close();await batchDelivery?.close();}
    finally {for(const socket of sockets)socket.destroy();await stopped;}
  })();
  return {server,origin,url:origin+'/#'+token,token,close,managedStartup};
}
