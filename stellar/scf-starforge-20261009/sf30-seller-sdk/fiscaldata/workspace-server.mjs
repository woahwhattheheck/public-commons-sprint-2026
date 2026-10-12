// MIT. Local operator surface for the original Fiscal Data workspace.
import {createServer} from 'node:http';
import {readFile,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {openFiscalWorkspace} from './workspace-model.mjs';

const fault=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const assetTypes={'index.html':'text/html; charset=utf-8','app.js':'text/javascript; charset=utf-8','style.css':'text/css; charset=utf-8'};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const headers={'cache-control':'no-store','x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin',
  'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};

export async function createFiscalWorkspaceHandler({model,origins,basePath='',token=randomBytes(32).toString('hex')}={}) {
  if(!model||!Array.isArray(origins)||!origins.length||!/^(?:\/[A-Za-z0-9_-]+)*$/.test(basePath))
    throw fault('WORKSPACE_ORIGIN_REQUIRED','Provide the original model and an explicit local workspace origin.');
  const allowed=new Set(origins.map(value=>new URL(value).origin));
  const hosts=new Set([...allowed].map(value=>new URL(value).host));
  const assets=new Map(await Promise.all(Object.entries(assetTypes).map(async([name,type])=>
    [name,{type,bytes:await readFile(new URL('./workspace-ui/'+name,import.meta.url))}])));
  const cookieName='sf_fiscal_'+new URL([...allowed][0]).port;
  const cookie=()=>cookieName+'='+token+'; Path='+(basePath?basePath+'/':'/')+'; HttpOnly; SameSite=Strict';
  const validToken=value=>{const provided=Buffer.from(String(value??'')),expected=Buffer.from(token);
    return provided.length===expected.length&&timingSafeEqual(provided,expected);};
  const authenticated=req=>validToken(req.headers['x-fiscaldata-session'])||
    validToken(String(req.headers.cookie??'').split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))?.slice(cookieName.length+1));
  const reading=new Set(); let closing=false;
  const handler=async(req,res)=>{
    function reply(status,type,value,extra={}) {
      if(res.destroyed)return;
      const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value));
      res.writeHead(status,{...headers,'content-type':type,'content-length':String(bytes.length),...extra});
      res.end(req.method==='HEAD'?undefined:bytes);
    }
    const json=(status,value,extra={})=>reply(status,'application/json; charset=utf-8',value,extra);
    try {
      if(closing)throw fault('WORKSPACE_CLOSING','The workspace is closing.',503);
      if(!hosts.has(req.headers.host)||req.headers.origin&&!allowed.has(req.headers.origin)||
        ['cross-site','same-site'].includes(req.headers['sec-fetch-site']))
        throw fault('WORKSPACE_ORIGIN_REQUIRED','Open this workspace through its local address.',403);
      const url=new URL(req.url,'http://'+req.headers.host),pathname=url.pathname;
      if(basePath&&pathname!==basePath&&!pathname.startsWith(basePath+'/'))return false;
      const route=pathname.slice(basePath.length)||'/';
      if(url.search)throw fault('INVALID_WORKSPACE_URL','This route does not accept query parameters.');
      if(basePath&&pathname===basePath) {
        if(!['GET','HEAD'].includes(req.method))throw fault('NOT_FOUND','Route not found.',404);
        reply(307,'text/plain','Open the Fiscal Data workspace.',{location:basePath+'/'});return true;
      }
      if(['GET','HEAD'].includes(req.method)) {
        const asset=assets.get(route==='/'?'index.html':route.slice(1));
        if(asset){reply(200,asset.type,asset.bytes,asset.type.startsWith('text/html')?{'set-cookie':cookie()}:{});return true;}
        if(route==='/api/state'){json(200,{...await model.snapshot(),sessionToken:token},{'set-cookie':cookie()});return true;}
        const match=/^\/api\/files\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(route);
        if(match) {
          if(!authenticated(req))throw fault('WORKSPACE_SESSION_REQUIRED','Open this workspace before downloading its retained files.',403);
          const parts=match.slice(1).map(value=>{
            let decoded;try{decoded=decodeURIComponent(value);}catch{throw fault('INVALID_FILE','Invalid file selection.');}
            if(!decoded||decoded.length>256||/[\/\\\u0000-\u001f\u007f]/.test(decoded)||decoded==='.'||decoded==='..')
              throw fault('INVALID_FILE','Select a retained workspace file.');
            return decoded;
          });
          const file=await model.file(...parts);
          if(!file||typeof file.path!=='string'||typeof file.name!=='string'||
            !Number.isSafeInteger(file.size)||file.size<0||!/^[a-f0-9]{64}$/.test(file.sha256??''))
            throw fault('INVALID_FILE_RECORD','The selected file has no complete retained identity.',409);
          const handle=await open(file.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
          try {
            const info=await handle.stat();
            if(!info.isFile()||info.size!==file.size)throw fault('FILE_CHANGED','The selected file changed. Refresh its edition.',409);
            const name=file.name.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,200)||'fiscal-data-download';
            const mime=typeof file.mime==='string'&&/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:; charset=utf-8)?$/i.test(file.mime)?
              file.mime:'application/octet-stream';
            res.writeHead(200,{...headers,'content-type':mime,'content-length':String(file.size),
              'content-disposition':'attachment; filename="'+name+'"','x-content-sha256':file.sha256,
              etag:'"sha256-'+file.sha256+'"'});
            if(req.method==='HEAD')res.end();
            else await pipeline(handle.createReadStream({autoClose:false}),res);
          } finally {await handle.close();}
          return true;
        }
        throw fault('NOT_FOUND','Route not found.',404);
      }
      if(req.method!=='POST'){reply(405,'text/plain','Use GET or POST.',{allow:'GET, HEAD, POST'});return true;}
      if(route!=='/api/action')throw fault('NOT_FOUND','Route not found.',404);
      const provided=Buffer.from(String(req.headers['x-fiscaldata-session']??'')),expected=Buffer.from(token);
      if(provided.length!==expected.length||!timingSafeEqual(provided,expected))
        throw fault('WORKSPACE_SESSION_REQUIRED','Refresh the workspace before applying this action.',403);
      if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')
        throw fault('JSON_REQUIRED','Send an application/json action.',415);
      const max=256*1024;
      if(Number(req.headers['content-length']??0)>max)throw fault('REQUEST_TOO_LARGE','The action exceeds 256 KiB.',413);
      const chunks=[];let size=0;
      reading.add(req);
      try {for await(const chunk of req){size+=chunk.length;if(size>max)throw fault('REQUEST_TOO_LARGE','The action exceeds 256 KiB.',413);chunks.push(chunk);}}
      finally{reading.delete(req);}
      let input;
      try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
      catch{throw fault('INVALID_JSON','Enter a valid JSON action.');}
      if(!object(input)||typeof input.action!=='string'||!input.action||input.action.length>80||
        !object(input.payload??{}))throw fault('INVALID_ACTION','Select an action with an object payload.');
      json(200,await model.dispatch(input.action,input.payload??{}));
    } catch(error) {
      if(res.headersSent){res.destroy();return true;}
      const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:
        error.code==='ENOENT'?404:error instanceof TypeError||error instanceof RangeError?400:500;
      json(status,{code:typeof error.code==='string'?error.code:'FISCAL_WORKSPACE_ERROR',
        message:status===500?'The operation could not finish. Review the retained job and retry from this workspace.':
          error.message||'The operation could not finish.'});
    }
    return true;
  };
  handler.close=()=>{closing=true;for(const request of reading)request.destroy();};
  return handler;
}

export async function startFiscalWorkspace({port=0,host='127.0.0.1',basePath='',...options}={}) {
  if(host!=='127.0.0.1')throw fault('INVALID_HOST','The operator listener uses 127.0.0.1.');
  if(!Number.isInteger(port)||port<0||port>65535)throw fault('INVALID_PORT','Choose a port from 0 through 65535.');
  const model=await openFiscalWorkspace(options);
  let handler,closing;
  const server=createServer((req,res)=>{
    if(!handler){res.writeHead(503);res.end();return;}
    handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}})
      .catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
  });
  server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=2000;
  try {
    await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',()=>{server.off('error',fail);done();});});
    const assigned=server.address().port,origin='http://127.0.0.1:'+assigned;
    handler=await createFiscalWorkspaceHandler({model,basePath,origins:[origin,'http://localhost:'+assigned]});
    await model.startWorker();
    return {model,workspace:model,server,url:origin+basePath+'/',
      close(){return closing??=(async()=>{handler.close();const stopped=new Promise(done=>server.close(done));
        server.closeIdleConnections?.();try{await model.close();}finally{server.closeAllConnections?.();await stopped;}})();}};
  } catch(error){server.close();await model.close();throw error;}
}
