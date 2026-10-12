// MIT. Local PMTiles authoring application and original native preview transport.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {need,plain,identifier,hash,clone} from './model.mjs';
import {openPMTilesWorkspace} from './workspace.mjs';
import {createPMTilesController} from './controller.mjs';
import {acquireNativeLease} from './native.mjs';
import {MAX_METADATA_BYTES} from './files.mjs';

const MIME={js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',html:'text/html; charset=utf-8'};
function secretEqual(a,b){
  return typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
async function jsonBody(request,limit=MAX_METADATA_BYTES){
  need(request.headers['content-type']?.split(';')[0]==='application/json','PMTILES_JSON_CONTENT_TYPE_REQUIRED');
  let bytes=0;const parts=[];
  for await(const part of request){bytes+=part.length;need(bytes<=limit,'PMTILES_REQUEST_TOO_LARGE');parts.push(part);}
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
  need(plain(value),'PMTILES_JSON_OBJECT_REQUIRED');return value;
}
function common(response){
  response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Referrer-Policy','no-referrer');
  response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}
function sendJson(response,status,value,{close=false}={}){
  common(response);if(close){response.shouldKeepAlive=false;response.setHeader('Connection','close');}
  const bytes=Buffer.from(JSON.stringify(value));response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length});response.end(bytes);
}
async function sendFile(response,file,contentType,{signal,download}={}){
  const observed=await file.verify({signal});
  const headers={'Content-Type':contentType,'Content-Length':observed.bytes};
  if(download)headers['Content-Disposition']='attachment; filename="'+download.replace(/[^A-Za-z0-9._-]/g,'_')+'"';
  common(response);response.writeHead(200,headers);
  for await(const chunk of file.chunks({signal})){signal?.throwIfAborted();if(!response.write(chunk))await once(response,'drain',{signal});}
  response.end();
}
export async function servePMTilesWorkspace({directory,runtime,port=0,expectedWorkspaceId=null,title='Map release operations'}={}){
  runtime=typeof runtime==='string'?runtime:clone(runtime);
  need(Number.isInteger(port)&&port>=0&&port<=65535,'PMTILES_PORT_INVALID');
  const workspace=await openPMTilesWorkspace({directory,expectedWorkspaceId,title});
  let lease,controller,server,closing=null;
  const shutdown=new AbortController(),token=randomBytes(32).toString('hex'),session=randomUUID();
  const sockets=new Set(),pending=new Set();let origin,closedResolve;
  const closed=new Promise(resolve=>{closedResolve=resolve;});
  async function close(){
    if(closing)return closing;
    closing=(async()=>{
      shutdown.abort(new Error('PMTILES_AUTHORING_STOPPED'));
      let nativeClose=Promise.resolve();
      if(server){nativeClose=new Promise(resolve=>server.close(resolve));server.closeIdleConnections();}
      try{
        if(controller)await controller.close();else await workspace.close();
        for(const socket of sockets)socket.destroy();
        await Promise.allSettled([...pending]);await nativeClose;
      }finally{await lease?.close();closedResolve();}
    })();return closing;
  }
  try{
    lease=await acquireNativeLease(workspace.directory+'/locks','authoring-server');
    controller=await createPMTilesController({workspace,runtime});
    const assetDefinitions={
      '/':{source:new URL('./web/index.html',import.meta.url),type:MIME.html},
      '/app.js':{source:new URL('./web/app.js',import.meta.url),type:MIME.js},
      '/app.css':{source:new URL('./web/app.css',import.meta.url),type:MIME.css},
      '/runtime/preview.js':{source:controller.runtime.previewScript.path,type:MIME.js,descriptor:controller.runtime.previewScript},
      '/runtime/preview.css':{source:controller.runtime.previewCss.path,type:MIME.css,descriptor:controller.runtime.previewCss},
      '/runtime/maplibre-gl-worker.mjs':{source:controller.runtime.previewWorker.path,type:MIME.js,descriptor:controller.runtime.previewWorker}
    };
    const assets=new Map();
    for(const [path,row] of Object.entries(assetDefinitions)){
      const bytes=await readFile(row.source);
      if(row.descriptor)need(bytes.length===row.descriptor.bytes&&hash(bytes)===row.descriptor.sha256,'PMTILES_RUNTIME_FILE_CHANGED');
      assets.set(path,{bytes,type:row.type});
    }
    async function handle(request,response){
      try{
        need(request.headers.host===new URL(origin).host,'PMTILES_HOST_CHANGED');
        if(request.headers.origin)need(request.headers.origin===origin,'PMTILES_ORIGIN_CHANGED');
        const url=new URL(request.url,origin),path=url.pathname;
        if(request.method==='GET'&&assets.has(path)){
          const asset=assets.get(path);common(response);response.writeHead(200,{'Content-Type':asset.type,'Content-Length':asset.bytes.length});response.end(asset.bytes);return;
        }
        const preview=path.match(/^\/preview\/([a-f0-9]{64})\/(.+)$/);
        if(request.method==='GET'&&preview){
          const result=await controller.previewResource(preview[1],preview[2]);
          if(result.kind==='json'){sendJson(response,200,result.value);return;}
          if(result.kind==='file'){await sendFile(response,result.file,result.contentType,{signal:shutdown.signal});return;}
          const native=result.response;common(response);
          const headers={'Content-Type':native.headers['content-type']??'application/octet-stream','Content-Length':native.body.length};
          if(native.headers['content-encoding'])headers['Content-Encoding']=native.headers['content-encoding'];
          response.writeHead(native.status,headers);response.end(native.body);return;
        }
        need(secretEqual(request.headers.authorization,'Bearer '+token),'PMTILES_AUTH_REQUIRED');
        if(request.method==='GET'&&(path==='/api/bootstrap'||path==='/api/state')){sendJson(response,200,controller.state());return;}
        if(request.method==='GET'&&path==='/api/resources'){
          sendJson(response,200,workspace.listResources({offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??100),kind:url.searchParams.get('kind')}));return;
        }
        let match=path.match(/^\/api\/editions\/([A-Za-z0-9._-]+)\/(\d+)$/);
        if(request.method==='GET'&&match){sendJson(response,200,workspace.getEdition(match[1],Number(match[2])));return;}
        match=path.match(/^\/api\/(requests|reviews|releases|resources)\/([A-Za-z0-9._-]+)$/);
        if(request.method==='GET'&&match){
          const readers={requests:workspace.getRequest,reviews:workspace.getReview,releases:workspace.getRelease,resources:workspace.getResource};
          const value=readers[match[1]](match[2]);need(value,'PMTILES_RECORD_NOT_FOUND');sendJson(response,200,value);return;
        }
        match=path.match(/^\/api\/resources\/([A-Za-z0-9._-]+)\/download$/);
        if(request.method==='GET'&&match){
          const resource=workspace.getResource(match[1]);
          await sendFile(response,workspace.resourceFile(resource.id),'application/octet-stream',{signal:shutdown.signal,download:resource.name});return;
        }
        if(request.method==='POST'&&path==='/api/package-download'){
          const selected=await controller.packageFile(await jsonBody(request));
          await sendFile(response,selected.file,'application/zip',{signal:shutdown.signal,download:selected.result.packageId+'.zip'});return;
        }
        if(request.method==='POST'&&path==='/api/uploads'){
          sendJson(response,201,await controller.uploads.prepare(await jsonBody(request)));return;
        }
        match=path.match(/^\/api\/uploads\/([A-Za-z0-9._-]+)$/);
        if(match&&request.method==='GET'){sendJson(response,200,await controller.uploads.status(match[1]));return;}
        if(match&&request.method==='PUT'){
          need(request.headers['content-type']==='application/octet-stream','PMTILES_BINARY_CONTENT_TYPE_REQUIRED');
          sendJson(response,200,await controller.uploads.receive(match[1],request,{signal:shutdown.signal,contentLength:request.headers['content-length']}));return;
        }
        match=path.match(/^\/api\/uploads\/([A-Za-z0-9._-]+)\/finish$/);
        if(match&&request.method==='POST'){
          const input=await jsonBody(request);need(input.expectedWorkspaceId===workspace.state().id,'PMTILES_WORKSPACE_ID_CHANGED');
          sendJson(response,200,await controller.uploads.finish(match[1],{signal:shutdown.signal}));return;
        }
        match=path.match(/^\/api\/actions\/([a-z-]+)$/);
        if(match&&request.method==='POST'){
          const input=await jsonBody(request),value=await controller.execute(match[1],input,{signal:shutdown.signal});
          sendJson(response,200,value);return;
        }
        sendJson(response,404,{error:{code:'PMTILES_ROUTE_NOT_FOUND',message:'The selected operation is unavailable.'}},{close:request.method!=='GET'});
      }catch(error){
        if(response.headersSent){response.destroy(error);return;}
        const code=error.code??'PMTILES_OPERATION_FAILED';
        const status=code==='PMTILES_AUTH_REQUIRED'?401:/NOT_FOUND|EXPIRED/.test(code)?404:
          /CHANGED|ACTIVE|INCOMPLETE|CLOSING/.test(code)?409:400;
        sendJson(response,status,{error:{code,message:String(error.message??error).slice(0,4000)}},{close:true});
      }
    }
    server=createServer((request,response)=>{
      const task=handle(request,response);pending.add(task);task.finally(()=>pending.delete(task)).catch(()=>{});
    });
    server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
    server.requestTimeout=0;server.headersTimeout=30000;
    const before=workspace.state().authoringPort,selectedPort=port||before||0;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(selectedPort,'127.0.0.1',resolve);});
    const actualPort=server.address().port;origin='http://127.0.0.1:'+actualPort;
    await workspace.rememberPort({requestId:'authoring-'+session,expectedWorkspaceId:workspace.state().id,expectedPort:before,port:actualPort});
    return Object.freeze({origin,url:origin+'/#token='+token,token,port:actualPort,workspaceId:workspace.state().id,controller,closed,close});
  }catch(error){await close();throw error;}
}
