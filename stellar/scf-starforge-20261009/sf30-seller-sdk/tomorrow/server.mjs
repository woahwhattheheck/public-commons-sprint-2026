import http from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const ASSETS=new Map([['/',['ui.html','text/html; charset=utf-8']],['/ui.html',['ui.html','text/html; charset=utf-8']],['/ui.mjs',['ui.mjs','text/javascript; charset=utf-8']],['/ui.css',['ui.css','text/css; charset=utf-8']]]);
const token=()=>randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const failure=(status,message,code)=>Object.assign(new Error(message),{status,code});
function identifier(text){
  let value;
  try{value=decodeURIComponent(text);}catch{throw failure(400,'Invalid identifier.','INVALID_ID');}
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value))throw failure(400,'Invalid identifier.','INVALID_ID');
  return value;
}
function json(res,status,body,headers={}){
  if(res.destroyed||res.writableEnded)return;
  const bytes=Buffer.from(JSON.stringify(body));
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,...headers});
  res.end(bytes);
}
async function readJSON(req,limit=20*1024*1024){
  if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw failure(415,'Send application/json.','CONTENT_TYPE');
  const declared=Number(req.headers['content-length']);
  if(Number.isFinite(declared)&&declared>limit)throw failure(413,'This handover is too large.','BODY_LIMIT');
  const chunks=[];let length=0;
  for await(const chunk of req){
    length+=chunk.length;
    if(length>limit)throw failure(413,'This handover is too large.','BODY_LIMIT');
    chunks.push(chunk);
  }
  let body;
  try{body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw failure(400,'The request must contain valid JSON.','INVALID_JSON');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw failure(400,'The request must be a JSON object.','INVALID_JSON');
  return body;
}

/**
 * Original WeatherWorkspace HTTP adapter.
 *
 * POST /api/session exchanges the private URL-fragment bootstrap token for
 * an HttpOnly SameSite cookie. Other mutations require exact Origin and
 * X-CSRF-Token. GET reads /api/session, /api/workspace, /api/editions/:id,
 * /api/editions/:id/tile and /api/compare?before=:id&after=:id.
 *
 * POST routes: /api/work; /api/work/:id/editions; /api/editions/:id/review;
 * /api/editions/:id/acquire; /api/editions/:id/recover; /api/decisions;
 * /api/handover; /api/import; /api/logout.
 *
 * Acquisition awaits the original workspace operation while the browser
 * polls local GET state. A same-edition concurrent request joins the
 * current promise; restart recovery belongs to WeatherWorkspace.
 */
export async function startWeatherServer({workspace,host='127.0.0.1',port=0}={}){
  if(!workspace||typeof workspace.view!=='function')throw new TypeError('An initialized WeatherWorkspace is required.');
  if(!['127.0.0.1','::1'].includes(host))throw new TypeError('Use a loopback host.');
  const bootstrap=token(),sessions=new Map(),active=new Map();
  let origin,authority,COOKIE;
  function checkOrigin(req){
    if(req.headers.origin!==origin)throw failure(403,'Open the operator application at its server URL.','ORIGIN');
    const site=req.headers['sec-fetch-site'];
    if(site&&site!=='same-origin')throw failure(403,'Use the same-origin operator application.','ORIGIN');
  }
  function sessionFor(req){
    const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
    const session=cookie&&sessions.get(cookie.slice(COOKIE.length+1));
    if(!session||session.expiresAt<Date.now())throw failure(401,'Open the private server URL to reconnect this browser.','SESSION');
    return session;
  }
  async function onceEdition(id,method,input){
    if(active.has(id))return active.get(id);
    const promise=Promise.resolve().then(()=>workspace[method](id,input));
    active.set(id,promise);
    try{return await promise;}finally{if(active.get(id)===promise)active.delete(id);}
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try{
      if(req.headers.host!==authority)throw failure(403,'Use the exact loopback server URL.','HOST');
      const url=new URL(req.url,origin),path=url.pathname,method=req.method||'GET';
      if((method==='GET'||method==='HEAD')&&ASSETS.has(path)){
        const[name,mime]=ASSETS.get(path),bytes=await readFile(new URL(name,import.meta.url));
        res.writeHead(200,{'Content-Type':mime,'Content-Length':bytes.length});
        return res.end(method==='HEAD'?undefined:bytes);
      }
      if(path==='/api/session'&&method==='POST'){
        checkOrigin(req);
        const body=await readJSON(req,16384);
        if(!equal(body.token,bootstrap))throw failure(401,'This browser connection token is not current.','SESSION');
        const key=token(),session={csrfToken:token(),expiresAt:Date.now()+12*60*60*1000};
        sessions.set(key,session);
        for(const[k,v]of sessions)if(v.expiresAt<Date.now())sessions.delete(k);
        return json(res,200,{csrfToken:session.csrfToken},{'Set-Cookie':COOKIE+'='+key+'; Path=/; HttpOnly; SameSite=Strict'});
      }
      const session=sessionFor(req);
      if(method==='GET'){
        if(path==='/api/session')return json(res,200,{csrfToken:session.csrfToken});
        if(path==='/api/workspace')return json(res,200,await workspace.view());
        let match=path.match(/^\/api\/editions\/([^/]+)$/);
        if(match)return json(res,200,await workspace.editionView(identifier(match[1])));
        match=path.match(/^\/api\/editions\/([^/]+)\/tile$/);
        if(match){
          const tile=await workspace.tile(identifier(match[1]));
          if(!tile||!tile.bytes)throw failure(404,'The map tile is not available for this edition.','TILE_UNAVAILABLE');
          const bytes=Buffer.from(tile.bytes),mime=tile.mime==='image/png'?tile.mime:'application/octet-stream';
          res.writeHead(200,{'Content-Type':mime,'Content-Length':bytes.length});
          return res.end(bytes);
        }
        if(path==='/api/compare')return json(res,200,await workspace.compare(identifier(url.searchParams.get('before')||''),identifier(url.searchParams.get('after')||'')));
        throw failure(404,'This operator route does not exist.','NOT_FOUND');
      }
      if(method!=='POST')throw failure(405,'Use the documented operator action.','METHOD');
      checkOrigin(req);
      if(!equal(req.headers['x-csrf-token'],session.csrfToken))throw failure(403,'Refresh the browser session before saving.','CSRF');
      const body=await readJSON(req);
      if(path==='/api/logout'){
        const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
        if(cookie)sessions.delete(cookie.slice(COOKIE.length+1));
        return json(res,200,{closed:true},{'Set-Cookie':COOKIE+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});
      }
      if(path==='/api/work')return json(res,200,await workspace.saveWork(body));
      let match=path.match(/^\/api\/work\/([^/]+)\/editions$/);
      if(match)return json(res,200,await workspace.prepareEdition(identifier(match[1]),{label:body.label,requestId:body.requestId}));
      match=path.match(/^\/api\/editions\/([^/]+)\/(review|acquire|recover)$/);
      if(match){
        const id=identifier(match[1]);
        if(match[2]==='review')return json(res,200,await workspace.reviewEdition(id));
        if(match[2]==='acquire'){
          if(typeof body.reviewSha256!=='string'||!/^[a-f0-9]{64}$/i.test(body.reviewSha256))throw failure(400,'Review this exact request before acquisition.','REVIEW_REQUIRED');
          return json(res,200,await onceEdition(id,'acquireEdition',{reviewSha256:body.reviewSha256}));
        }
        return json(res,200,await onceEdition(id,'recoverEdition'));
      }
      if(path==='/api/decisions')return json(res,200,await workspace.decide(body));
      if(path==='/api/handover')return json(res,200,await workspace.handover({editionIds:body.editionIds,includeRaw:body.includeRaw===true}),{'Content-Disposition':'attachment; filename="weather-operations-handover.json"'});
      if(path==='/api/import')return json(res,200,await workspace.importHandover(body.bundle));
      throw failure(404,'This operator action does not exist.','NOT_FOUND');
    }catch(error){
      const candidate=Number(error.status||error.statusCode||error.httpStatus),status=candidate>=400&&candidate<=599?candidate:400,headers={};
      if(status===429&&error.retryAfter!==undefined&&/^[0-9]+$/.test(String(error.retryAfter)))headers['Retry-After']=String(error.retryAfter);
      json(res,status,{error:{code:error.code||'OPERATION_FAILED',message:error.message||'The operation could not be completed.'}},headers);
    }
  });
  server.requestTimeout=5*60*1000;
  await new Promise((resolveListen,reject)=>{
    server.once('error',reject);
    server.listen(port,host,()=>{server.off('error',reject);resolveListen();});
  });
  const address=server.address();
  authority=(host.includes(':')?'['+host+']':host)+':'+address.port;
  origin='http://'+authority;
  COOKIE='sf_tomorrow_session_'+address.port;
  return{
    server,address,url:origin+'/#session='+bootstrap,
    close:()=>new Promise((resolveClose,reject)=>{
      server.close(error=>error?reject(error):resolveClose());
      server.closeIdleConnections?.();
    })
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=(flag,fallback)=>{const i=args.indexOf(flag);return i>=0?args[i+1]:fallback;},directory=value('--workspace');
  if(!directory){
    process.stderr.write('Usage: node tomorrow/server.mjs --workspace /absolute/weather-workspace [--port 8874]\n');
    process.exitCode=2;
  }else{
    const{WeatherWorkspace}=await import('./workspace.mjs');
    const workspace=await WeatherWorkspace.open(resolve(directory));
    const running=await startWeatherServer({workspace,port:Number(value('--port','8874'))});
    process.stdout.write('Weather operations: '+running.url+'\n');
    const stop=async()=>{await running.close();process.exit(0);};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }
}
