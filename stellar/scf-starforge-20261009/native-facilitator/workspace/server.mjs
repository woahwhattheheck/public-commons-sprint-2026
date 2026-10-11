#!/usr/bin/env node
// MIT. Authenticated local operator UI for the original native facilitator.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openProfileStore, requireValue, fail } from './store.mjs';
import { createFacilitatorController } from './controller.mjs';

const assets = new Map([['/','index.html'],['/browser.mjs','browser.mjs'],['/style.css','style.css']]);
const mime = {'index.html':'text/html; charset=utf-8','browser.mjs':'text/javascript; charset=utf-8','style.css':'text/css; charset=utf-8'};
const headers = {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'cross-origin-resource-policy':'same-origin','content-security-policy':"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
function fields(value, allowed) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key)), 'FACILITATOR_REQUEST_FIELDS_INVALID');
  return value;
}
async function body(req) {
  requireValue(/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '') && !req.headers['content-encoding'],
    'FACILITATOR_JSON_REQUEST_REQUIRED', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; requireValue(size <= 131072, 'FACILITATOR_REQUEST_TOO_LARGE', 413); chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); }
  catch { fail('FACILITATOR_REQUEST_JSON_INVALID'); }
}

export async function startWorkspace({directory, ownershipDirectory, create = false, port = 0,
  environment = process.env} = {}) {
  requireValue(Number.isInteger(port) && port >= 0 && port <= 65535, 'PORT_INVALID');
  const store = await openProfileStore({directory, ownershipDirectory, create});
  const controller = createFacilitatorController(store, {environment});
  const token = randomBytes(32).toString('hex');
  let origin, closing = false, closePromise;
  const snapshot = () => ({workspace:{directory, ownershipDirectory}, ...controller.view()});
  const server = createServer(async (req, res) => {
    const send = (status, value, extra = {}) => {
      if (res.destroyed || res.writableEnded) return;
      const data = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
      res.writeHead(status, {...headers,'content-type':'application/json; charset=utf-8','content-length':data.length,...extra});
      res.end(data);
    };
    try {
      requireValue(!closing, 'FACILITATOR_WORKSPACE_CLOSING', 503);
      requireValue(req.headers.host === new URL(origin).host &&
        (req.headers.origin === undefined || req.headers.origin === origin), 'FACILITATOR_LOCAL_ORIGIN_REQUIRED', 403);
      const url = new URL(req.url, origin), path = url.pathname;
      if (req.method === 'GET' && assets.has(path)) {
        const name = assets.get(path);
        return send(200, await readFile(new URL(name, import.meta.url)), {'content-type':mime[name]});
      }
      const supplied = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from('Bearer ' + token);
      requireValue(supplied.length === expected.length && timingSafeEqual(supplied, expected),
        'FACILITATOR_WORKSPACE_AUTH_REQUIRED', 401);
      if (req.method === 'GET') {
        if (path === '/api/status') return send(200, snapshot());
        if (path === '/api/profiles') return send(200, await store.list({after:url.searchParams.get('after') ?? ''}));
        if (path === '/api/profile' || path === '/api/download') {
          const profile = await store.read(url.searchParams.get('name'));
          if (path === '/api/profile') return send(200, profile);
          requireValue(url.searchParams.get('sha256') === profile.sha256, 'FACILITATOR_SELECTED_PROFILE_CHANGED', 409);
          return send(200, Buffer.from(JSON.stringify(profile.config,null,2)+'\n'),
            {'content-disposition':'attachment; filename="'+profile.name+'.json"'});
        }
        fail('NOT_FOUND',404);
      }
      requireValue(req.method === 'POST','METHOD_NOT_ALLOWED',405);
      const input = await body(req);
      requireValue(!req.aborted && !res.destroyed, 'FACILITATOR_CALLER_DISCONNECTED', 409);
      if (path === '/api/review') {fields(input,['config']);return send(200,store.review(input.config));}
      if (path === '/api/save') {fields(input,['name','config','expectedSha256']);return send(200,await store.save(input));}
      if (path === '/api/start') {
        fields(input,['name','sha256','port']);
        const result = await controller.start(input);return send(200,{...result,...snapshot()});
      }
      if (path === '/api/stop') {
        fields(input,['runtimeId']);const result=await controller.stop(input);return send(200,{...result,...snapshot()});
      }
      if (path === '/api/probe') {
        fields(input,Object.hasOwn(input,'runtimeId')?['runtimeId']:['name','sha256']);
        const result=await controller.probe(input);return send(200,{...result,...snapshot()});
      }
      fail('NOT_FOUND',404);
    } catch (error) {
      const code = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'FACILITATOR_WORKSPACE_REQUEST_FAILED';
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 400;
      send(status,{error:code});
    }
  });
  server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=1000;server.maxHeadersCount=32;
  try {await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes();});});}
  catch(error){await controller.close();throw error;}
  origin='http://127.0.0.1:'+server.address().port;
  const close=()=>closePromise??=(async()=>{
    closing=true;
    const stopped=new Promise(yes=>server.close(yes));server.closeIdleConnections();
    const timer=setTimeout(()=>server.closeAllConnections(),10000);
    try{await Promise.all([stopped,controller.close()]);}finally{clearTimeout(timer);}
    return snapshot();
  })();
  return {url:origin,operatorUrl:origin+'/#token='+token,store,controller,close};
}

async function main(args) {
  if(args.length===1&&args[0]==='--help') {
    process.stdout.write('node native-facilitator/workspace/server.mjs --directory PRIVATE_DIRECTORY --ownership-directory SHARED_SIGNER_DIRECTORY [--create] [--port 0]\n');return;
  }
  const options={};
  while(args.length){const flag=args.shift();
    if(flag==='--create'){requireValue(options.create===undefined,'ARGUMENTS_INVALID');options.create=true;continue;}
    const key={'--directory':'directory','--ownership-directory':'ownershipDirectory','--port':'port'}[flag],value=args.shift();
    requireValue(key&&value&&options[key]===undefined,'ARGUMENTS_INVALID');options[key]=key==='port'?Number(value):value;
  }
  requireValue(options.directory&&options.ownershipDirectory,'FACILITATOR_WORKSPACE_PATHS_REQUIRED');
  const running=await startWorkspace(options);
  process.stdout.write(JSON.stringify({mode:'NATIVE_FACILITATOR_OPERATOR',operatorUrl:running.operatorUrl,
    directory:options.directory,ownershipDirectory:options.ownershipDirectory})+'\n');
  const stop=()=>running.close().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'FACILITATOR_WORKSPACE_SHUTDOWN_FAILED'})+'\n');process.exitCode=1;});
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main(process.argv.slice(2)).catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'FACILITATOR_WORKSPACE_START_FAILED'})+'\n');process.exitCode=1;});
