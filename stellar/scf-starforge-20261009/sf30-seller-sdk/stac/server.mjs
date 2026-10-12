import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';

const STATIC=new Map([['/',['ui.html','text/html; charset=utf-8']],['/ui.html',['ui.html','text/html; charset=utf-8']],['/ui.css',['ui.css','text/css; charset=utf-8']],['/ui.mjs',['ui.mjs','text/javascript; charset=utf-8']]]);
const randomToken=()=>randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fail=(status,message,code='REQUEST_FAILED')=>Object.assign(new Error(message),{status,code});
const copyJSON=value=>JSON.parse(JSON.stringify(value));
const tokenId=value=>{
  if(typeof value!=='string'||value.length<1||value.length>2048||/[\u0000-\u001f]/.test(value))throw fail(400,'A valid saved identifier is required.','INVALID_ID');
  return value;
};
const safeName=value=>String(value||'download').replace(/[\u0000-\u001f\u007f"\\/]/g,'_').slice(0,180)||'download';
function publicError(error){
  return {code:String(error?.code||'OPERATION_FAILED'),message:String(error?.message||error||'Operation failed').slice(0,6000)};
}
function json(res,status,value,headers={}){
  const bytes=Buffer.from(JSON.stringify(value));
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':bytes.length,...headers});res.end(bytes);
}
async function bodyJSON(req,maxBytes){
  const type=String(req.headers['content-type']||'').split(';')[0].trim();
  if(type!=='application/json')throw fail(415,'Send this request as application/json.','JSON_REQUIRED');
  const declared=Number(req.headers['content-length']);
  if(Number.isFinite(declared)&&declared>maxBytes)throw fail(413,'The import is larger than this server’s configured request limit.','REQUEST_TOO_LARGE');
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw fail(413,'The request is larger than this server’s configured limit.','REQUEST_TOO_LARGE');chunks.push(chunk);}
  try{const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('object');return parsed;}
  catch{throw fail(400,'The request must contain a JSON object.','INVALID_JSON');}
}
function binary(res,value,{attachment=true}={}){
  const raw=value?.bytes;
  if(raw==null||typeof raw==='number')throw fail(404,'Saved asset bytes are unavailable.','ASSET_BYTES_UNAVAILABLE');
  const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
  const metadata=value.metadata||value;
  const originalMime=String(value.mime||metadata.mime||metadata.type||'application/octet-stream').split(';')[0].toLowerCase();
  const inline=!attachment&&['image/png','image/jpeg','image/webp','image/gif'].includes(originalMime);
  const filename=safeName(value.filename||metadata.filename||metadata.assetKey||metadata.id||'stac-asset');
  res.writeHead(200,{'content-type':inline?originalMime:(value.mime||metadata.mime||'application/octet-stream'),'content-length':bytes.length,'content-disposition':(inline?'inline':'attachment')+'; filename="'+filename+'"','content-security-policy':"default-src 'none'; sandbox"});
  res.end(bytes);
}

async function streamAsset(req,res,workspace,assetId,{preview=false}={}){
  if(typeof workspace.getAssetFile!=='function'){binary(res,await workspace.getAsset(assetId),{attachment:!preview});return;}
  const value=await workspace.getAssetFile(assetId),metadata=value.metadata||{};
  const info=await stat(value.path);if(!info.isFile())throw fail(404,'The captured asset file is unavailable.','ASSET_BYTES_UNAVAILABLE');
  const size=info.size,originalMime=String(metadata.mime||'application/octet-stream').split(';')[0].toLowerCase();
  const mime=/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(originalMime)?originalMime:'application/octet-stream';
  const inline=preview&&['image/png','image/jpeg','image/webp','image/gif'].includes(mime);
  const filename=safeName(metadata.filename||metadata.assetKey||metadata.id||'stac-asset'),ascii=filename.replace(/[^\x20-\x7e]/g,'_');
  const etag=typeof metadata.sha256==='string'?'"'+metadata.sha256+'"':null;
  let start=0,end=Math.max(0,size-1),partial=false;
  const range=req.headers.range;
  if(range&&(!req.headers['if-range']||req.headers['if-range']===etag)){
    const match=String(range).match(/^bytes=(\d*)-(\d*)$/);
    if(!match||(!match[1]&&!match[2])||!size){res.setHeader('content-range','bytes */'+size);throw fail(416,'Choose a valid single byte range for this saved asset.','INVALID_RANGE');}
    if(!match[1]){const tail=Number(match[2]);if(!Number.isSafeInteger(tail)||tail<1){res.setHeader('content-range','bytes */'+size);throw fail(416,'The requested byte range is invalid.','INVALID_RANGE');}start=Math.max(0,size-tail);}
    else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start){res.setHeader('content-range','bytes */'+size);throw fail(416,'The requested byte range is outside this saved asset.','INVALID_RANGE');}
    partial=true;
  }
  const headers={'content-type':mime,'content-length':size?(end-start+1):0,'accept-ranges':'bytes','content-disposition':(inline?'inline':'attachment')+'; filename="'+ascii+'"; filename*=UTF-8\'\''+encodeURIComponent(filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()),'content-security-policy':"default-src 'none'; sandbox"};
  if(etag)headers.etag=etag;
  if(partial)headers['content-range']='bytes '+start+'-'+end+'/'+size;
  res.writeHead(partial?206:200,headers);
  if(req.method==='HEAD'){res.end();return;}
  await pipeline(createReadStream(value.path,size?{start,end}:{}),res);
}

/**
 * Authenticated loopback adapter for an already opened STAC workspace.
 * Getters are local views. Provider operations run only through explicit POST routes.
 * The returned URL carries a one-process session key in its fragment.
 */
export async function startStacServer({workspace,processing=null,host='127.0.0.1',port=0,maxRequestBytes=128*1024*1024}={}){
  if(!workspace||typeof workspace.getState!=='function')throw new TypeError('An initialized STAC workspace is required.');
  if(!['127.0.0.1','::1','localhost'].includes(host))throw new Error('The analyst server binds to loopback only.');
  if(!Number.isInteger(Number(port))||Number(port)<0||Number(port)>65535)throw new Error('Port must be an integer from 0 through 65535.');
  if(!Number.isSafeInteger(maxRequestBytes)||maxRequestBytes<1024)throw new Error('maxRequestBytes must be a positive byte limit.');
  const processingName=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(value);
  let processingView=null,processingCapabilities=null;
  const processingReads=processing?.reads||{},processingActions=processing?.actions||{};
  if(processing){
    if(typeof processing.getState!=='function')throw new TypeError('The configured processing controller needs getState.');
    for(const [kind,entries]of [['read',processingReads],['action',processingActions]]){
      if(!entries||typeof entries!=='object'||Array.isArray(entries))throw new TypeError('Processing '+kind+' handlers must be an explicit name-to-function map.');
      for(const [name,handler]of Object.entries(entries))if(!processingName(name)||typeof handler!=='function')throw new TypeError('Invalid declared processing '+kind+': '+name);
    }
    processingView=await readFile(new URL('processing/view.mjs',import.meta.url));
    processingCapabilities={enabled:true,reads:Object.keys(processingReads),actions:Object.keys(processingActions)};
  }
  const bootstrap=randomToken(),session=randomToken(),csrf=randomToken();
  let origin='',authority='',cookieName='',closing=false;
  const jobs=new Map();
  const staticCache=new Map();
  for(const [route,[filename,mime]] of STATIC){const prior=[...staticCache.values()].find(x=>x.filename===filename);staticCache.set(route,prior||{filename,mime,bytes:await readFile(new URL(filename,import.meta.url))});}
  const summarizeJob=job=>({id:job.id,kind:job.kind,status:job.status,createdAt:job.createdAt,finishedAt:job.finishedAt,...(job.error?{error:job.error}:{}),...(job.result===undefined?{}:{result:job.result})});
  function beginJob(kind,operationId,request,operation){
    const requestJSON=JSON.stringify(request);
    const id=typeof operationId==='string'&&operationId?tokenId(operationId):randomToken();
    const existing=jobs.get(id);if(existing){if(existing.kind!==kind||existing.requestJSON!==requestJSON)throw fail(409,'This operation identity already belongs to a different action.','OPERATION_ID_CONFLICT');return existing;}
    const job={id,kind,requestJSON,status:'RUNNING',createdAt:new Date().toISOString()};
    jobs.set(id,job);
    job.promise=Promise.resolve().then(()=>operation(id)).then(result=>{job.result=copyJSON(result??null);job.status='COMPLETE';},error=>{job.error=publicError(error);job.status='FAILED';}).finally(()=>{
      job.finishedAt=new Date().toISOString();
      const complete=[...jobs.values()].filter(x=>x.status!=='RUNNING');for(const old of complete.slice(0,Math.max(0,complete.length-200)))jobs.delete(old.id);
    });
    return job;
  }
  function authenticated(req){
    const cookies=String(req.headers.cookie||'').split(';').map(v=>v.trim()).map(v=>{const n=v.indexOf('=');return n<0?['','']:[v.slice(0,n),v.slice(n+1)];});
    return cookies.some(([name,value])=>name===cookieName&&equal(value,session));
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('cache-control','no-store');
    res.setHeader('x-content-type-options','nosniff');
    res.setHeader('referrer-policy','no-referrer');
    res.setHeader('x-frame-options','DENY');
    res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try{
      if(req.headers.host!==authority)throw fail(421,'This host does not match the local operator address.','HOST_MISMATCH');
      const url=new URL(req.url||'/',origin);
      if(url.origin!==origin)throw fail(400,'Invalid local request.','INVALID_ORIGIN');
      const path=url.pathname;
      const method=req.method||'GET';
      if((method==='GET'||method==='HEAD')&&STATIC.has(path)){
        const asset=staticCache.get(path);res.writeHead(200,{'content-type':asset.mime,'content-length':asset.bytes.length});res.end(method==='HEAD'?undefined:asset.bytes);return;
      }
      if((method==='GET'||method==='HEAD')&&path==='/favicon.ico'){res.writeHead(204);res.end();return;}
      if(method==='POST'&&path==='/api/session'){
        if(req.headers.origin!==origin)throw fail(403,'Open the session from its local operator address.','ORIGIN_REQUIRED');
        const body=await bodyJSON(req,4096);
        if(!equal(body.token,bootstrap))throw fail(401,'The session key is invalid. Reopen the local URL printed by the operator.','SESSION_REQUIRED');
        json(res,200,{csrfToken:csrf,maxRequestBytes},{'set-cookie':cookieName+'='+session+'; HttpOnly; SameSite=Strict; Path=/'});return;
      }
      if(!authenticated(req))throw fail(401,'Open the local URL printed by this operator to establish its browser session.','SESSION_REQUIRED');
      if(method==='GET'&&path==='/api/session'){json(res,200,{csrfToken:csrf,maxRequestBytes});return;}
      if(!['GET','HEAD'].includes(method)){
        if(closing)throw fail(503,'The local operator is closing.','SERVER_CLOSING');
        if(req.headers.origin!==origin||!equal(req.headers['x-csrf-token'],csrf))throw fail(403,'This action must come from the active local operator session.','CSRF_REQUIRED');
      }
      if(method==='GET'&&path==='/api/state'){json(res,200,{workspace:await workspace.getState(),jobs:[...jobs.values()].map(summarizeJob),capabilities:{processing:processingCapabilities||{enabled:false}}});return;}
      if(method==='GET'&&path==='/processing/view.mjs'){
        if(!processingView)throw fail(404,'Processing history is not configured for this workspace.','PROCESSING_NOT_CONFIGURED');
        res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','content-length':processingView.length});res.end(processingView);return;
      }
      if(method==='GET'&&path==='/api/processing/state'){
        if(!processing)throw fail(404,'Processing history is not configured for this workspace.','PROCESSING_NOT_CONFIGURED');
        json(res,200,await processing.getState({stacWorkspace:workspace}));return;
      }
      const processingReadPath=path.match(/^\/api\/processing\/reads\/([^/]+)$/);
      if(method==='GET'&&processingReadPath){
        const name=decodeURIComponent(processingReadPath[1]);
        if(!processing||!processingName(name)||!Object.hasOwn(processingReads,name))throw fail(404,'This processing read is not enabled by the configured controller.','PROCESSING_READ_NOT_FOUND');
        const query=Object.create(null);
        for(const [key,value]of url.searchParams){if(Object.hasOwn(query,key))query[key]=Array.isArray(query[key])?[...query[key],value]:[query[key],value];else query[key]=value;}
        json(res,200,await processingReads[name]({query,stacWorkspace:workspace}));return;
      }
      if(method==='GET'&&path==='/api/jobs'){json(res,200,{jobs:[...jobs.values()].map(summarizeJob)});return;}
      const jobPath=path.match(/^\/api\/jobs\/([^/]+)$/);
      if(method==='GET'&&jobPath){const job=jobs.get(tokenId(decodeURIComponent(jobPath[1])));if(!job)throw fail(404,'This local job is no longer in the recent job list. Refresh the saved workspace state.','JOB_NOT_FOUND');json(res,200,summarizeJob(job));return;}
      const editionPath=path.match(/^\/api\/editions\/([^/]+)$/);
      if(method==='GET'&&editionPath){json(res,200,await workspace.getEdition(tokenId(decodeURIComponent(editionPath[1]))));return;}
      const assetPath=path.match(/^\/api\/assets\/([^/]+)\/(download|preview)$/);
      if((method==='GET'||method==='HEAD')&&assetPath){
        await streamAsset(req,res,workspace,tokenId(decodeURIComponent(assetPath[1])),{preview:assetPath[2]==='preview'});return;
      }
      if(method==='GET'&&path==='/api/compare'){
        json(res,200,await workspace.compare({leftEditionId:tokenId(url.searchParams.get('left')),rightEditionId:tokenId(url.searchParams.get('right'))}));return;
      }
      if(method==='GET'&&path==='/api/report'){
        const format=url.searchParams.get('format')||'html';if(!['html','csv','json'].includes(format))throw fail(400,'Choose an HTML, CSV or JSON report.','INVALID_FORMAT');
        binary(res,await workspace.exportReport({editionId:tokenId(url.searchParams.get('editionId')),format}));return;
      }
      if(method==='POST'){
        const body=await bodyJSON(req,maxRequestBytes);
        const processingActionPath=path.match(/^\/api\/processing\/actions\/([^/]+)$/);
        if(processingActionPath){
          const name=decodeURIComponent(processingActionPath[1]);
          if(!processing||!processingName(name)||!Object.hasOwn(processingActions,name))throw fail(404,'This processing action is not enabled by the configured controller.','PROCESSING_ACTION_NOT_FOUND');
          const input=body.input===undefined?{}:body.input;
          if(input===null||typeof input!=='object'||Array.isArray(input))throw fail(400,'Processing action input must be a JSON object.','PROCESSING_INPUT_INVALID');
          const job=beginJob('processing-'+name,body.operationId,{name,input},operationId=>processingActions[name]({input,operationId,stacWorkspace:workspace}));
          json(res,202,summarizeJob(job));return;
        }
        if(path==='/api/discover'){const job=beginJob('discover',body.operationId,{expectedRevision:body.expectedRevision},id=>workspace.discover({operationId:id,expectedRevision:body.expectedRevision}));json(res,202,summarizeJob(job));return;}
        if(path==='/api/queries'){json(res,200,await workspace.saveQuery(body));return;}
        if(path==='/api/search/review'){json(res,200,await workspace.reviewSearch({queryId:tokenId(body.queryId)}));return;}
        if(path==='/api/search/acquire'){const job=beginJob('search-acquire',body.operationId,{reviewId:body.reviewId},id=>workspace.acquire({reviewId:tokenId(body.reviewId),operationId:id}));json(res,202,summarizeJob(job));return;}
        if(path==='/api/search/resume'){const editionId=tokenId(body.editionId);const job=beginJob('search-resume',body.operationId,{editionId},()=>workspace.resume({editionId}));json(res,202,summarizeJob(job));return;}
        if(path==='/api/search/cancel'){json(res,200,await workspace.cancel({editionId:tokenId(body.editionId)}));return;}
        if(path==='/api/assets/review'){json(res,200,await workspace.reviewAsset({editionId:tokenId(body.editionId),itemId:tokenId(body.itemId),assetKey:tokenId(body.assetKey),maxBytes:body.maxBytes}));return;}
        if(path==='/api/assets/acquire'){const job=beginJob('asset-acquire',body.operationId,{reviewId:body.reviewId},id=>workspace.acquireAsset({reviewId:tokenId(body.reviewId),operationId:id}));json(res,202,summarizeJob(job));return;}
        if(path==='/api/decisions'){json(res,200,await workspace.setDecision({editionId:tokenId(body.editionId),itemId:tokenId(body.itemId),status:body.status,actor:body.actor,note:body.note,assetKeys:body.assetKeys,expectedRevision:body.expectedRevision}));return;}
        if(path==='/api/handover/export'){
          const value=await workspace.exportHandover({...(Array.isArray(body.editionIds)?{editionIds:body.editionIds.map(tokenId)}:{}),includeAssets:body.includeAssets!==false});
          json(res,200,value,{'content-disposition':'attachment; filename="stac-workspace-handover.json"'});return;
        }
        if(path==='/api/handover/import'){json(res,200,await workspace.importHandover(body));return;}
      }
      throw fail(404,'This local operator route was not found.','NOT_FOUND');
    }catch(error){
      if(res.headersSent){res.destroy();return;}
      const nativeStatus=Number(error?.status);
      const status=Number.isInteger(nativeStatus)&&nativeStatus>=400&&nativeStatus<=599?nativeStatus:/REVISION|CONFLICT|STALE/.test(String(error?.code||''))?409:/NOT_FOUND/.test(String(error?.code||''))?404:400;
      json(res,status,{error:publicError(error)});
    }
  });
  server.requestTimeout=0;
  server.headersTimeout=30_000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(port),host,()=>{server.removeListener('error',reject);resolve();});});
  const address=server.address();
  const addressHost=address.family==='IPv6'?'['+address.address+']':address.address;
  authority=addressHost+':'+address.port;origin='http://'+authority;
  cookieName='stac_session_'+address.port;
  return {server,address,origin,url:origin+'/#session='+bootstrap,close:async()=>{closing=true;server.closeIdleConnections?.();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
