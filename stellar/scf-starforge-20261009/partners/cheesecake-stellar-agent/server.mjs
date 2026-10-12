#!/usr/bin/env node
// MIT. Loopback operator host composed with the maintained original MCP transport.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { loadApplication } from './configuration.mjs';
import { applicationTools } from './application.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ACTIONS = new Set(['review','execute','status','recover','read']);
const TYPES = { '/': ['index.html','text/html; charset=utf-8'],
  '/index.html': ['index.html','text/html; charset=utf-8'],
  '/app.js': ['app.js','text/javascript; charset=utf-8'],
  '/style.css': ['style.css','text/css; charset=utf-8'] };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
const fail = code => Object.assign(new Error(code), { code });
const need = (ok, code) => { if (!ok) throw fail(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function authorized(req, token) {
  const actual = Buffer.from(req.headers.authorization ?? '', 'utf8');
  const expected = Buffer.from('Bearer ' + token, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function common(res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',CSP);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
}
function send(res, status, data, type = 'application/json; charset=utf-8', extra = {}) {
  if (res.destroyed || res.writableEnded) return;
  const raw = Buffer.isBuffer(data) ? data : Buffer.from(type.startsWith('application/json') ?
    JSON.stringify(data) + '\n' : String(data), 'utf8');
  common(res); res.writeHead(status, { 'Content-Type':type, 'Content-Length':raw.length, ...extra });
  res.end(raw);
}
const messages = {
  APPLICATION_AUTHORIZATION_DENIED:'The host did not authorize this action for the current subject.',
  APPLICATION_REQUEST_NOT_PREPARED:'Run the original review before operating this request.',
  APPLICATION_OPERATION_RUNNING:'This request already has an operation in progress. Read status after it returns.',
  RESULT_NOT_AVAILABLE:'The original operation has no retained result yet. Review its current status.',
  MATCHING_REVIEW_REQUIRED:'Run the original review for this saved request before execution.',
  APPLICATION_HANDOFF_CHANGED:'The retained handoff changed. Reopen its original verified selection.',
  APPLICATION_SUBJECT_BINDING_CHANGED:'This saved operation belongs to a different receiving subject.',
  APPLICATION_BODY_TOO_LARGE:'The API request exceeds the 128 KiB input limit.',
  APPLICATION_BODY_INVALID:'Send one UTF-8 JSON object with the documented action fields.',
  APPLICATION_OPTIONS_INVALID:'This action received an unsupported option.',
};
function errorResponse(res, error) {
  const supplied = String(error?.code ?? '');
  const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(supplied) ? supplied : 'APPLICATION_SERVER_ERROR';
  const status = code === 'APPLICATION_AUTHORIZATION_DENIED' ? 403 :
    code === 'APPLICATION_REQUEST_NOT_SELECTED' ? 404 :
    code === 'APPLICATION_BODY_TOO_LARGE' ? 413 :
    /NOT_PREPARED|NOT_AVAILABLE|MATCHING_REVIEW|ALREADY|RUNNING|CHANGED|MISMATCH|BINDING/.test(code) ? 409 :
    /INVALID|REQUIRED|OPTIONS|LIMIT|NOT_SELECTED/.test(code) ? 400 :
    ['ENOENT','EACCES'].includes(code) ? 503 : 500;
  send(res,status,{error:{code,message:messages[code] ?? code.replaceAll('_',' ').toLowerCase()}});
}
async function body(req) {
  const kind = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  need(kind === 'application/json','APPLICATION_JSON_REQUIRED');
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length; need(length <= 128 * 1024,'APPLICATION_BODY_TOO_LARGE'); chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); }
  catch { throw fail('APPLICATION_BODY_INVALID'); }
  need(object(data),'APPLICATION_BODY_INVALID');
  return data;
}
function publicIdentity(application, context, info) {
  const {schema,applicationId,handoffId,manifestSha256} = application.identity;
  return {schema,applicationId,handoffId,manifestSha256,subject:context.subject,
    server:{id:info.id,startedAt:info.startedAt},
    operatorProfileConfigured:info.operatorProfileConfigured,
    mcp:{path:'/mcp',protocolVersion:info.protocolVersion,tools:info.tools},
    actions:[...ACTIONS]};
}

/**
 * Embed in an existing Node host after supplying its selected original application.
 * contextForRequest(req) may resolve the authenticated host's subject and grants.
 * It runs after the bearer/origin checks. Current action authority remains in
 * openApplication's authorize callback and is checked again before execute.
 */
export async function createApplicationHandler({application,context,bearerToken,sourceRoot,
  allowedOrigins = [],contextForRequest,operatorProfileConfigured = false,serverId = randomUUID(),
  startedAt = new Date().toISOString()} = {}) {
  need(application && typeof application.requests === 'function' && typeof application.call === 'function',
    'APPLICATION_INSTANCE_REQUIRED');
  need(typeof bearerToken === 'string' && bearerToken.length >= 24 && bearerToken.length <= 4096 &&
    !/[\r\n]/.test(bearerToken),'APPLICATION_ACCESS_TOKEN_REQUIRED');
  need(object(context) && typeof context.subject === 'string','APPLICATION_AUTHENTICATED_SUBJECT_REQUIRED');
  need(contextForRequest === undefined || typeof contextForRequest === 'function','APPLICATION_CONTEXT_PROVIDER_INVALID');
  const originSet = allowedOrigins instanceof Set ? allowedOrigins : new Set(allowedOrigins);
  const native = await import(pathToFileURL(join(sourceRoot,'stellar-forge/mcp-paid-agent/http-tools.mjs')).href);
  const files = new Map(await Promise.all(Object.entries(TYPES).map(async ([path,[file,type]]) =>
    [path,{raw:await readFile(join(here,'ui',file)),type}])));
  const controllers = new Set();
  const info = {id:serverId,startedAt,operatorProfileConfigured,protocolVersion:native.MCP_VERSION,
    tools:applicationTools(application,context).tools.map(tool=>tool.name)};
  let stopping = false;
  const handler = async (req,res) => {
    common(res);
    const controller = new AbortController();
    const interrupted = () => controller.abort();
    const disconnected = () => { if (!res.writableEnded) interrupted(); };
    controllers.add(controller); req.once('aborted',interrupted); res.once('close',disconnected);
    try {
      if (stopping) return send(res,503,{error:{code:'APPLICATION_DRAINING',message:'The operator server is stopping.'}});
      let url;
      try { url = new URL(req.url,'http://operator.invalid'); }
      catch { return send(res,400,{error:{code:'APPLICATION_URL_INVALID',message:'Invalid request URL.'}}); }
      const path = url.pathname;
      if (url.search) return send(res,400,{error:{code:'APPLICATION_QUERY_INVALID',message:'This endpoint takes no query parameters.'}});
      if (path === '/healthz' && req.method === 'GET') return send(res,200,{ready:true});
      if (Object.hasOwn(TYPES,path) && ['GET','HEAD'].includes(req.method)) {
        const file=files.get(path);
        if(req.method==='HEAD') { res.writeHead(200,{'Content-Type':file.type,'Content-Length':file.raw.length}); return res.end(); }
        return send(res,200,file.raw,file.type);
      }
      if (!(path === '/mcp' || path.startsWith('/api/')))
        return send(res,404,{error:{code:'APPLICATION_ROUTE_NOT_FOUND',message:'No such operator endpoint.'}});
      if (req.headers.origin && !originSet.has(req.headers.origin))
        return send(res,403,{error:{code:'APPLICATION_ORIGIN_DENIED',message:'The request origin is not configured for this host.'}});
      if (!authorized(req,bearerToken))
        return send(res,401,{error:{code:'APPLICATION_AUTHENTICATION_REQUIRED',message:'Enter the receiving operator access token.'}},
          'application/json; charset=utf-8',{'WWW-Authenticate':'Bearer realm="stellar-application"'});
      const current = contextForRequest ? await contextForRequest(req) : context;
      need(object(current) && typeof current.subject === 'string' && current.subject.length > 0,
        'APPLICATION_AUTHENTICATED_SUBJECT_REQUIRED');
      if (path === '/mcp') {
        // Preserve the original protocol, catalog validation, error contract and bearer implementation.
        const transport = native.createMcpToolHandler(applicationTools(application,current,{signal:controller.signal}),{
          bearerToken,allowedClientOrigins:[...originSet],serverName:'stellar-application-operator',serverVersion:'1.0.0',
          instructions:'Use the selected original intent throughout review, execution and recovery. Read retained results without another merchant call.'});
        return await transport(req,res);
      }
      if (path === '/api/application' && req.method === 'GET') {
        await application.requests(current); // Current host list authority is required for identity disclosure.
        return send(res,200,publicIdentity(application,current,info));
      }
      if (path === '/api/requests' && req.method === 'GET')
        return send(res,200,await application.requests(current));
      const route = path.match(/^\/api\/requests\/([^/]+)\/(review|execute|status|recover|read|download)$/);
      if (!route) return send(res,404,{error:{code:'APPLICATION_ROUTE_NOT_FOUND',message:'No such operator endpoint.'}});
      let intent;
      try { intent = decodeURIComponent(route[1]); } catch { throw fail('APPLICATION_ID_INVALID'); }
      const action = route[2];
      if(action === 'download') {
        if(req.method !== 'GET') return send(res,405,{error:{code:'METHOD_NOT_ALLOWED',message:'Use GET for a retained response download.'}},
          'application/json; charset=utf-8',{'Allow':'GET'});
        const artifact = await application.call(current,'read',intent,{format:'base64',limitBytes:1048576,signal:controller.signal});
        need(typeof artifact.data === 'string','APPLICATION_RESULT_FORMAT_INVALID');
        const raw = Buffer.from(artifact.data,'base64');
        const filename = intent.replaceAll(/[^A-Za-z0-9._-]/g,'_') + '.response';
        return send(res,200,raw,'application/octet-stream',{'Content-Disposition':'attachment; filename="' + filename + '"',
          'X-Response-SHA256':artifact.result?.file?.sha256 ?? ''});
      }
      if (req.method !== 'POST') return send(res,405,{error:{code:'METHOD_NOT_ALLOWED',message:'Use POST with a JSON object for this action.'}},
        'application/json; charset=utf-8',{'Allow':'POST'});
      const options = await body(req);
      const allowed = action === 'read' ? ['format','limitBytes'] : [];
      need(Object.keys(options).every(key=>allowed.includes(key)),'APPLICATION_OPTIONS_INVALID');
      const result = await application.call(current,action,intent,{...options,signal:controller.signal});
      return send(res,200,result);
    } catch(error) { errorResponse(res,error); }
    finally {
      controllers.delete(controller); req.removeListener('aborted',interrupted); res.removeListener('close',disconnected);
    }
  };
  return {handler,info,close(){stopping=true;for(const controller of controllers)controller.abort();}};
}

export async function createApplicationServer({configFile,bearerToken=process.env.STELLAR_APP_ACCESS_TOKEN,
  host='127.0.0.1',port=8767}={}) {
  need(typeof configFile==='string' && configFile.length>0,'APPLICATION_CONFIG_REQUIRED');
  need(['127.0.0.1','::1'].includes(host),'APPLICATION_LOOPBACK_HOST_REQUIRED');
  need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'APPLICATION_PORT_INVALID');
  const loaded=await loadApplication(configFile),origins=new Set();
  let component,server,closed;
  try {
    component=await createApplicationHandler({application:loaded.application,context:loaded.context,bearerToken,
      sourceRoot:loaded.sourceRoot,allowedOrigins:origins,operatorProfileConfigured:Boolean(loaded.config.operatorProfile)});
    server=createServer((req,res)=>{
      // Accept only this listener's selected host; DNS rebinding cannot grant the bearer or current host authority.
      if(req.headers.host!==server.operatorHost) return send(res,400,{error:{code:'APPLICATION_HOST_INVALID',message:'Use the selected loopback origin.'}});
      void component.handler(req,res);
    });
    server.requestTimeout=45000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
    await new Promise((resolveListen,reject)=>{
      server.once('error',reject);
      server.listen({host,port},()=>{server.removeListener('error',reject);resolveListen();});
    });
    const address=server.address(),authority=(host==='::1'?'[::1]':host)+':'+address.port;
    const origin='http://'+authority;
    server.operatorHost=authority;origins.add(origin);
    async function close() {
      if(closed)return closed;
      closed=(async()=>{
        component.close();
        const stopped=new Promise((done,reject)=>server.close(error=>error?reject(error):done()));
        server.closeIdleConnections?.();
        await Promise.all([stopped,loaded.close()]);
      })();
      return closed;
    }
    return {server,origin,address,identity:publicIdentity(loaded.application,loaded.context,component.info),close};
  } catch(error) {
    component?.close();if(server?.listening)await new Promise(done=>server.close(done));
    await loaded.close();throw error;
  }
}
function parse(args) {
  const out={};
  if(args.includes('--help'))return{help:true};
  need(args.length%2===0,'APPLICATION_SERVER_OPTIONS_INVALID');
  for(let i=0;i<args.length;i+=2) {
    const key=args[i].slice(2);
    need(args[i].startsWith('--')&&['config','host','port'].includes(key)&&!Object.hasOwn(out,key)&&args[i+1],
      'APPLICATION_SERVER_OPTIONS_INVALID');
    out[key]=args[i+1];
  }
  need(out.config,'APPLICATION_CONFIG_REQUIRED');
  return {configFile:resolve(out.config),host:out.host??'127.0.0.1',port:out.port===undefined?8767:Number(out.port)};
}
export async function main(args=process.argv.slice(2)) {
  const options=parse(args);
  if(options.help) {
    process.stdout.write('Usage: STELLAR_APP_ACCESS_TOKEN=<24+ character private token> node server.mjs --config /private/application.json [--host 127.0.0.1|::1] [--port 8767]\n');
    return;
  }
  const opened=await createApplicationServer(options);
  process.stdout.write(JSON.stringify({event:'ready',origin:opened.origin,serverId:opened.identity.server.id,
    applicationId:opened.identity.applicationId,handoffId:opened.identity.handoffId})+'\n');
  let stopping=false;
  const stop=async()=>{
    if(stopping)return;stopping=true;
    try{await opened.close();process.stdout.write(JSON.stringify({event:'closed',serverId:opened.identity.server.id})+'\n');}
    catch(error){process.stderr.write(JSON.stringify({error:'APPLICATION_CLOSE_FAILED'})+'\n');process.exitCode=1;}
  };
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{
  const code=/^[A-Z][A-Z0-9_]{1,100}$/.test(String(error.code??''))?error.code:'APPLICATION_SERVER_FAILED';
  process.stderr.write(JSON.stringify({error:code})+'\n');process.exitCode=1;
});
