// MIT. Private original Central operator and streaming source-file delivery.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { fault } from '../odata/state.mjs';
import { verifyFile } from './store.mjs';

const assets=new Map([['/',{file:'index.html',type:'text/html; charset=utf-8'}],
  ['/ui.mjs',{file:'ui.mjs',type:'text/javascript; charset=utf-8'}],['/ui.css',{file:'ui.css',type:'text/css; charset=utf-8'}]]);
const actions=new Set(['connect','projects','forms','createPlan','capture','resume','pause','wait','edition','rows','row',
  'resources','quality','review','compare','sourceFile','exportFile','exportDataset','report','backup','prepareRelease','releaseStatus','activateRelease','rollbackRelease','capturePublisher','receivePublisher','publisherTransfers']);
const same=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const filename=value=>String(value||'source').replace(/[^\p{L}\p{N}_. -]/gu,'_').slice(0,180)||'source';
const errorRecord=(error,operationId)=>({code:error.code||'CENTRAL_HTTP',message:error.message||'The operation could not finish.',
  status:Number.isInteger(error.status)?error.status:500,operationId:operationId??null,
  details:{...(error.details??{}),...(error.providerStatus?{providerStatus:error.providerStatus}:{}),
    ...(error.receipt?{receipt:error.receipt}:{}),...(error.retryAfter?{retryAfter:error.retryAfter}:{})}});
export async function createCentralServer({workspace,host='127.0.0.1',port=0,token=randomBytes(32).toString('hex'),extensions=[]}={}) {
  if(!workspace?.directory)throw fault('CENTRAL_SERVER_WORKSPACE','Open the original Central workspace before starting its operator.');
  if(!['127.0.0.1','::1','localhost'].includes(host))throw fault('CENTRAL_SERVER_HOST','Bind the private Central operator to a loopback host.');
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw fault('CENTRAL_SERVER_PORT','Choose an available local port.');
  if(typeof token!=='string'||Buffer.byteLength(token)<32||/[\r\n]/.test(token))throw fault('CENTRAL_SERVER_TOKEN','Use a private operator token of at least 32 bytes.');
  if(!Array.isArray(extensions))throw fault('CENTRAL_SERVER_EXTENSIONS','Compose an array of trusted operator extensions.');
  const mountedAssets=new Map([...assets].map(([path,asset])=>[path,{url:new URL('./'+asset.file,import.meta.url),type:asset.type}]));
  const mountedExtensions=extensions.map(extension=>{
    if(!extension||typeof extension.handle!=='function'||!(extension.assets instanceof Map))
      throw fault('CENTRAL_SERVER_EXTENSION','Use a trusted extension with fixed assets and an authenticated handler.');
    for(const [path,asset]of extension.assets){
      if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||/[?#\\\u0000-\u001f\u007f]/.test(path)||
        mountedAssets.has(path)||!(asset?.url instanceof URL)||asset.url.protocol!=='file:'||
        typeof asset.type!=='string'||/[\r\n]/.test(asset.type))
        throw fault('CENTRAL_SERVER_EXTENSION_ASSET','Keep each trusted asset at its unique fixed local URL.');
      mountedAssets.set(path,{url:new URL(asset.url.href),type:asset.type});
    }
    return extension;
  });
  let origin=null,closed=false;const tickets=new Map();
  const authorize=request=>same(request.headers.authorization,'Bearer '+token);
  const json=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
  async function body(request){
    const chunks=[];let bytes=0;
    for await(const chunk of request){bytes+=chunk.length;if(bytes>16*1024*1024)throw fault('CENTRAL_REQUEST_SIZE','This operator request exceeds 16 MiB.',413);chunks.push(chunk);}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));}
    catch{throw fault('CENTRAL_REQUEST_JSON','Send a UTF-8 JSON request.');}
  }
  async function selectedFile(input) {
    if(input.kind==='source'){const file=await workspace.sourceFile({hash:input.hash});return {...file,name:filename(input.name||input.hash)};}
    if(input.kind==='export'){const file=await workspace.exportFile({id:input.id,path:input.path});
      return {...file,...await verifyFile(file.path,file.sha256),name:filename(file.name)};}
    throw fault('CENTRAL_DOWNLOAD','Choose an original source or export file.');
  }
  async function streamFile(request,response,file) {
    const handle=await open(file.path,'r');
    try{
      const info=await handle.stat();if(info.size!==file.bytes)throw fault('CENTRAL_FILE_CHANGED','The retained file size changed.',409);
      const etag='"'+file.sha256+'"',headers={'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+filename(file.name)+'"',
        'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','ETag':etag};
      let start=0,end=file.bytes-1,status=200;
      const range=request.headers.range;
      if(range&&(!request.headers['if-range']||request.headers['if-range']===etag)){
        const match=/^bytes=(\d*)-(\d*)$/.exec(range);
        if(!match||!match[1]&&!match[2])throw fault('CENTRAL_RANGE','Choose one byte range.',416);
        if(match[1]){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
        else {const suffix=Number(match[2]);start=Math.max(0,file.bytes-suffix);}
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=file.bytes){
          response.writeHead(416,{'Content-Range':'bytes */'+file.bytes});response.end();return;}
        status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+file.bytes;
      }
      headers['Content-Length']=String(Math.max(0,end-start+1));response.writeHead(status,headers);
      if(request.method==='HEAD'||file.bytes===0){response.end();return;}
      await pipeline(handle.createReadStream({start,end,autoClose:false}),response);
    }finally{await handle.close();}
  }
  const server=createServer(async(request,response)=>{
    let operationId=null;
    try{
      const address=new URL(request.url,origin||'http://127.0.0.1');
      if(request.headers.origin&&request.headers.origin!==origin)throw fault('CENTRAL_ORIGIN','Use this operator origin for workspace requests.',403);
      if(origin&&request.headers.host!==new URL(origin).host)throw fault('CENTRAL_HOST','Use the original private operator address.',403);
      if(['GET','HEAD'].includes(request.method)&&mountedAssets.has(address.pathname)){
        const asset=mountedAssets.get(address.pathname),bytes=await readFile(asset.url);
        response.writeHead(200,{'Content-Type':asset.type,'Content-Length':String(bytes.length),'Cache-Control':'no-store',
          'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
          'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'self'"});
        response.end(request.method==='HEAD'?undefined:bytes);return;
      }
      const ticketMatch=/^\/api\/downloads\/([a-f0-9]{48})$/.exec(address.pathname);
      if(ticketMatch&&['GET','HEAD'].includes(request.method)){
        const ticket=tickets.get(ticketMatch[1]);
        if(!ticket||ticket.expiresAt<Date.now())throw fault('CENTRAL_DOWNLOAD_EXPIRED','Reopen this original file from the operator.',404);
        await streamFile(request,response,ticket.file);return;
      }
      if(!authorize(request)){json(response,401,{ok:false,error:{code:'CENTRAL_OPERATOR_AUTH',message:'Open the private operator link from this workspace host.',status:401}});return;}
      if(request.method==='GET'&&address.pathname==='/api/state'){json(response,200,await workspace.state());return;}
      if(request.method==='GET'&&address.pathname==='/api/health'){const state=await workspace.state();json(response,200,{schema:state.schema,id:state.id,revision:state.revision});return;}
      const captureMatch=/^\/api\/captures\/([^/]+)$/.exec(address.pathname);
      if(request.method==='GET'&&captureMatch){json(response,200,await workspace.edition({id:decodeURIComponent(captureMatch[1])}));return;}
      if(request.method==='POST'&&address.pathname==='/api/downloads'){
        const input=await body(request),file=await selectedFile(input);
        for(const [id,ticket]of tickets)if(ticket.expiresAt<Date.now())tickets.delete(id);
        if(tickets.size>=2048)throw fault('CENTRAL_DOWNLOAD_CAPACITY','Close earlier download sessions and retry.',429);
        const id=randomBytes(24).toString('hex');tickets.set(id,{file,expiresAt:Date.now()+60*60*1000});
        json(response,201,{url:'/api/downloads/'+id,name:file.name,sha256:file.sha256,bytes:file.bytes});return;
      }
      const sourceMatch=/^\/api\/files\/source\/([a-f0-9]{64})$/.exec(address.pathname);
      if(sourceMatch&&['GET','HEAD'].includes(request.method)){
        await streamFile(request,response,await selectedFile({kind:'source',hash:sourceMatch[1],name:address.searchParams.get('name')}));return;}
      const exportMatch=/^\/api\/files\/export\/([^/]+)$/.exec(address.pathname);
      if(exportMatch&&['GET','HEAD'].includes(request.method)){
        await streamFile(request,response,await selectedFile({kind:'export',id:decodeURIComponent(exportMatch[1]),path:address.searchParams.get('path')}));return;}
      const action=/^\/api\/actions\/([A-Za-z]+)$/.exec(address.pathname);
      if(request.method==='POST'&&action&&actions.has(action[1])){
        const input=await body(request);
        if(!input||typeof input!=='object'||Array.isArray(input))throw fault('CENTRAL_REQUEST_OBJECT','Send a workspace action object.');
        operationId=input.reportId??input.exportId??(['capture','backup','capturePublisher','receivePublisher'].includes(action[1])?input.id:null);
        if(['capture','backup','capturePublisher','receivePublisher'].includes(action[1])&&!input.id)throw fault('CENTRAL_OPERATION_ID','Retain a caller-generated id before starting this operation.');
        const result=await workspace[action[1]](input);
        json(response,['capture','resume'].includes(action[1])?202:200,['capture','resume'].includes(action[1])?{ok:true,result,operationId:result.id}:{ok:true,result,operationId});return;
      }
      for(const extension of mountedExtensions)if(await extension.handle({request,response,address,json,
        body:async original=>{
          const input=await body(original);
          if(input&&typeof input==='object'&&!Array.isArray(input))
            operationId=input.requestId??input.reportId??input.exportId??input.id??input.captureId??null;
          return input;
        }}))return;
      throw fault('CENTRAL_HTTP_ROUTE','This operator route does not exist.',404);
    }catch(error){
      if(response.headersSent){response.destroy(error);return;}
      const record=errorRecord(error,operationId);json(response,Math.min(599,Math.max(400,record.status)),{ok:false,error:record});
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
  const address=server.address(),selectedHost=host.includes(':')?'['+host+']':host;
  origin='http://'+selectedHost+':'+address.port;
  return {directory:workspace.directory,origin,url:origin+'/#token='+encodeURIComponent(token),token,
    async close(){if(closed)return;closed=true;await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections?.();});tickets.clear();}};
}
