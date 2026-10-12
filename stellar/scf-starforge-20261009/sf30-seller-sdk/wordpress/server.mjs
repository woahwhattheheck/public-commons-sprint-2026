// MIT. Local WordPress operator over the original source, publisher and buyer lifecycle.
import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { openWordPressWorkspace } from './workspace.mjs';
import { fail, only, directory as absolute } from './config.mjs';
import { packet } from './packet.mjs';
import { responseBytes } from './transport.mjs';
const ROOT=new URL('./',import.meta.url),HEADER='x-workspace-token';
const assets=new Map([
  ['/',[new URL('public/index.html',ROOT),'text/html; charset=utf-8']],
  ['/app.mjs',[new URL('public/app.mjs',ROOT),'text/javascript; charset=utf-8']],
  ['/style.css',[new URL('public/style.css',ROOT),'text/css; charset=utf-8']],
  ['/publisher.mjs',[new URL('../socrata/public/publisher.mjs',ROOT),'text/javascript; charset=utf-8']]
]);
const cleanFilename=value=>String(value).replace(/[^\w.()-]/g,'_').slice(0,160)||'wordpress-download';
function send(response,status,value) {
  const body=Buffer.from(JSON.stringify(value));
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(body);
}
async function body(request,maximum=1048576) {
  const declared=request.headers['content-length'];
  if(declared&&(!/^\d+$/.test(declared)||Number(declared)>maximum))fail('WORDPRESS_REQUEST_BYTES','The operator request exceeds one MiB.',413);
  const chunks=[];let bytes=0;
  for await(const chunk of request){bytes+=chunk.length;if(bytes>maximum)fail('WORDPRESS_REQUEST_BYTES','The operator request exceeds one MiB.',413);chunks.push(chunk);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));}
  catch{fail('WORDPRESS_REQUEST_JSON','Supply a complete UTF-8 JSON request.');}
}
function matches(value,token) {
  if(typeof value!=='string')return false;const a=Buffer.from(value),b=Buffer.from(token);
  return a.length===b.length&&timingSafeEqual(a,b);
}
const integerParam=(url,name,fallback)=>Number(url.searchParams.get(name)??fallback);
export async function start({directory,port=0,environment=process.env,python='python3',fetchImpl=fetch,onEvent,expectedWorkspaceId,expectedWorkspaceIdentity}={}) {
  if(!Number.isSafeInteger(port)||port<0||port>65535)fail('WORDPRESS_PORT','Choose a valid local listening port.');
  const workspace=await openWordPressWorkspace({directory,environment,python,fetchImpl,onEvent,expectedWorkspaceId,expectedWorkspaceIdentity});
  const token=randomBytes(32).toString('hex'),instanceId=randomUUID();let origin,closing,stopped;
  const server=http.createServer(async(request,response)=>{
    let authorized=false;
    try {
      if(request.headers.host!==new URL(origin).host)fail('WORDPRESS_HOST','Use the original local operator address.',403);
      if(request.headers.origin&&request.headers.origin!==origin)fail('WORDPRESS_ORIGIN','Use this local operator page.',403);
      const url=new URL(request.url,origin),path=url.pathname;
      if(request.method==='GET'&&path==='/api/health')return send(response,200,{status:'ok',...await workspace.health(),pid:process.pid,instanceId});
      if(path.startsWith('/api/')) {
        if(!matches(request.headers[HEADER],token))fail('WORDPRESS_TOKEN','Reload this original local operator page.',403);
        authorized=true;
        if(request.method==='GET') {
          if(path==='/api/state')return send(response,200,await workspace.inspect());
          if(path==='/api/operation')return send(response,200,await workspace.operation(url.searchParams.get('id')));
          if(path==='/api/job')return send(response,200,await workspace.job(url.searchParams.get('sourceId'),url.searchParams.get('id')));
          if(path==='/api/records')return send(response,200,await workspace.records(url.searchParams.get('sourceId'),url.searchParams.get('id'),{
            offset:integerParam(url,'offset',0),limit:integerParam(url,'limit',25),collection:url.searchParams.get('collection')||null}));
          if(path==='/api/source')return send(response,200,await workspace.source(url.searchParams.get('id')));
          if(path==='/api/mapping')return send(response,200,await workspace.mapping(url.searchParams.get('id')));
          if(path==='/api/edition')return send(response,200,await workspace.edition(url.searchParams.get('id')));
          if(path==='/api/projection')return send(response,200,await workspace.suggestedProjection(url.searchParams.get('sourceId'),url.searchParams.get('id')));
          if(path==='/api/compare')return send(response,200,await workspace.compare(url.searchParams.get('before'),url.searchParams.get('after'),{
            offset:integerParam(url,'offset',0),limit:integerParam(url,'limit',50)}));
          if(path==='/api/response') {
            const retained=await workspace.response(url.searchParams.get('sourceId'),url.searchParams.get('id'),integerParam(url,'sequence',1));
            const bytes=responseBytes(retained),maximum=262144;
            const {bodyBase64,...metadata}=retained.response;
            return send(response,200,{...retained,response:{...metadata,bodyText:bytes.subarray(0,maximum).toString('utf8'),
              previewBytes:Math.min(bytes.length,maximum),clipped:bytes.length>maximum}});
          }
          if(path==='/api/file') {
            const value=await workspace.download(url.searchParams.get('kind'),url.searchParams.get('id'),url.searchParams.get('name'),url.searchParams.get('sourceId'));
            try {
              response.writeHead(200,{'Content-Type':value.contentType,'Content-Length':value.size,
                'Content-Disposition':'attachment; filename="'+cleanFilename(value.filename)+'"','X-Content-SHA256':value.sha256,
                'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
              await pipeline(value.handle.createReadStream({autoClose:false}),response);
            } finally{await value.handle.close();}
            return;
          }
          if(path==='/api/publisher-file') {
            const value=await workspace.publisherDownload(url.searchParams.get('productId'),url.searchParams.get('kind'),url.searchParams.get('id'));
            response.writeHead(200,{'Content-Type':value.contentType,'Content-Length':value.bytes.length,
              'Content-Disposition':'attachment; filename="'+cleanFilename(value.filename)+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
            response.end(value.bytes);return;
          }
          if(path==='/api/handbook') {
            const content=await readFile(new URL('README.md',ROOT));
            response.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Length':content.length,'Cache-Control':'no-store'});
            response.end(content);return;
          }
        }
        if(request.method==='POST') {
          if(request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')
            fail('WORDPRESS_CONTENT_TYPE','Use application/json for an operator command.',415);
          const value=await body(request);
          if(path==='/api/act'){only(value,['action','operationId','expectedRevision','input'],'operator action');const {action,...input}=value;
            return send(response,200,await workspace.act(action,input));}
          if(path==='/api/cancel'){only(value,['operationId'],'operation cancellation');return send(response,200,await workspace.cancel(value.operationId));}
          if(path==='/api/preview')return send(response,200,await workspace.preview(value));
          if(path==='/api/dataset-preview')return send(response,200,await workspace.datasetPreview(value));
          if(path==='/api/receive') {
            only(value,['input','directory'],'source packet receiving');
            const result=await packet('restore',{input:absolute(value.input),directory:absolute(value.directory),python});
            return send(response,200,{...result,directory:value.directory,entrypoint:'wordpress/cli.mjs serve --dir <received-directory>'});
          }
        }
        fail('WORDPRESS_ENDPOINT','This operator endpoint does not exist.',404);
      }
      if(request.method!=='GET')fail('WORDPRESS_METHOD','Choose an original operator command.',405);
      const asset=assets.get(path);if(!asset)fail('WORDPRESS_PAGE','This operator page does not exist.',404);
      let content=await readFile(asset[0]);
      if(path==='/')content=Buffer.from(content.toString('utf8').replace('__WORKSPACE_TOKEN__',token));
      response.writeHead(200,{'Content-Type':asset[1],'Content-Length':content.length,'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
      response.end(content);
    } catch(error) {
      if(response.headersSent||response.destroyed){response.destroy();return;}
      const status=Number.isSafeInteger(error.status)&&error.status>=400&&error.status<600?error.status:500;
      let state;if(authorized&&(status===409||request.method==='POST')){try{state=await workspace.inspect();}catch{}}
      send(response,status,{error:{code:error.code??'WORDPRESS_OPERATION_FAILED',message:error.message??'The original operation did not complete.',
        details:error.details??null},...(state?{state}:{})});
    }
  });
  server.requestTimeout=0;server.headersTimeout=15000;server.keepAliveTimeout=5000;
  server.on('clientError',(_,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    origin=new URL('http://127.0.0.1:'+server.address().port).origin;
  }catch(error){await workspace.close();throw error;}
  const close=()=>{
    if(closing)return closing;
    if(!stopped){
      const stopping=new Promise((resolve,reject)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
      stopped=stopping;server.closeIdleConnections?.();
      void stopping.catch(()=>{if(stopped===stopping)stopped=null;});
    }
    const disposing=(async()=>{
      const results=await Promise.allSettled([stopped,workspace.close()]);
      const errors=results.filter(row=>row.status==='rejected').map(row=>row.reason);
      if(errors.length)throw new AggregateError(errors,'The original WordPress operator is still closing.');
    })();
    closing=disposing;
    void disposing.catch(()=>{if(closing===disposing)closing=null;});
    return disposing;
  };
  return {url:origin,directory,token,workspace,close,pid:process.pid,instanceId,...await workspace.health()};
}
