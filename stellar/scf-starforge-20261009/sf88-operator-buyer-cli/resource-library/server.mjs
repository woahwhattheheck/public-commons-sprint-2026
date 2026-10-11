// MIT — Private foreground resource review over the original buyer inbox.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { requireValue } from './files.mjs';

async function body(request, maximum = 65536) {
  requireValue(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 4*1024*1024,'BODY_LIMIT_INVALID');
  requireValue((request.headers['content-type'] ?? '').split(';')[0] === 'application/json', 'JSON_REQUIRED',415);
  let count = 0; const parts = [];
  for await (const part of request) {
    count += part.length; requireValue(count <= maximum,'REQUEST_TOO_LARGE',413); parts.push(part);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { requireValue(false,'INVALID_JSON'); }
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value),'JSON_OBJECT_REQUIRED');
  return value;
}
export async function serveLibrary(library,{port=0,additionalAssets=[],authenticatedRoute=[]} = {}) {
  requireValue(Number.isInteger(port) && port >= 0 && port <= 65535,'PORT_INVALID');
  const token = randomBytes(32).toString('hex'), transfers = new Map(), controllers = new Set(), ownedTransfers = new Set();
  let transferSlots = 0;
  const assets = new Map(await Promise.all([['/','index.html','text/html'],['/app.js','app.js','text/javascript'],
    ['/style.css','style.css','text/css']].map(async ([route,file,type]) =>
      [route,{bytes:await readFile(new URL(file,import.meta.url)),type}])));
  requireValue(Array.isArray(additionalAssets),'EXTENSION_ASSETS_INVALID');
  for (const {route,bytes,type} of additionalAssets) {
    requireValue(typeof route==='string' && /^\/[A-Za-z0-9/_.-]+$/.test(route) &&
      !route.startsWith('/api/') && !route.startsWith('/transfer/') && !assets.has(route) &&
      Buffer.isBuffer(bytes) && ['text/html','text/javascript','text/css','text/plain'].includes(type),
      'EXTENSION_ASSET_INVALID');
    assets.set(route,{bytes,type});
  }
  const handlers=typeof authenticatedRoute==='function' ? [authenticatedRoute] : authenticatedRoute;
  requireValue(Array.isArray(handlers) && handlers.every(handler=>typeof handler==='function'),'EXTENSION_HANDLER_INVALID');
  let origin, lastScan = null, scanWork = null, closing = false;
  const server = createServer((request,response) => {
    const controller = new AbortController(); controllers.add(controller);
    const deadline = setTimeout(() => controller.abort(new Error('REQUEST_DEADLINE')),120000);
    const disconnected = () => { if (!response.writableFinished) controller.abort(new Error('CLIENT_DISCONNECTED')); };
    response.on('close',disconnected);
    const send = (value,status=200) => {
      const bytes = Buffer.from(JSON.stringify(value));
      response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length});
      response.end(bytes);
    };
    const registerDownload = async produce => {
      requireValue(transferSlots < 4,'DOWNLOAD_CAPACITY_REACHED',429);
      transferSlots++;
      let saved, published = false;
      try {
        saved = await produce(controller.signal);
        controller.signal.throwIfAborted(); requireValue(!closing,'SERVER_CLOSING',503);
        const key = randomBytes(24).toString('hex');
        let released = false;
        const transfer = {saved,async release() {
          if(released)return;released=true;transferSlots--;ownedTransfers.delete(transfer);
          transfers.delete(key);clearTimeout(transfer.timer);await saved.dispose();
        }};
        transfer.timer = setTimeout(() => {void transfer.release().catch(() => {});},60000);
        transfer.timer.unref();transfers.set(key,transfer);ownedTransfers.add(transfer);published=true;
        return {url:'/transfer/' + key,bytes:saved.bytes,sha256:saved.sha256};
      } finally {if(!published){transferSlots--;if(saved)await saved.dispose();}}
    };
    const run = async () => {
      response.setHeader('Cache-Control','no-store');
      response.setHeader('X-Content-Type-Options','nosniff');
      response.setHeader('Referrer-Policy','no-referrer');
      response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      requireValue(!closing,'SERVER_CLOSING',503);
      requireValue(request.headers.host === new URL(origin).host,'HOST_REFUSED',403);
      requireValue(!request.headers.origin || request.headers.origin === origin,'ORIGIN_REFUSED',403);
      requireValue(!request.headers['sec-fetch-site'] || ['none','same-origin'].includes(request.headers['sec-fetch-site']),
        'CROSS_ORIGIN_REFUSED',403);
      const url = new URL(request.url,origin), asset = assets.get(url.pathname);
      if (asset && request.method === 'GET') {
        response.writeHead(200,{'Content-Type':asset.type + '; charset=utf-8','Content-Length':asset.bytes.length});
        response.end(asset.bytes); return;
      }
      // A single-use, short-lived capability addresses only already-verified
      // bytes. Native browser downloads stream to disk without buffering a Blob.
      if (url.pathname.startsWith('/transfer/') && request.method === 'GET') {
        const key = url.pathname.slice('/transfer/'.length), transfer = transfers.get(key);
        requireValue(transfer,'DOWNLOAD_EXPIRED',404);
        transfers.delete(key); clearTimeout(transfer.timer);
        try {
          response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':transfer.saved.bytes,
            'Content-Disposition':`attachment; filename="resource-${transfer.saved.resource.id.slice(0,12)}"; filename*=UTF-8''${encodeURIComponent(transfer.saved.resource.name).replaceAll("'",'%27')}`});
          await pipeline(transfer.saved.file.createReadStream({start:0,autoClose:false}),response,{signal:controller.signal});
        } finally { await transfer.release(); }
        return;
      }
      requireValue(request.headers.authorization === 'Bearer ' + token,'PRIVATE_SESSION_REQUIRED',401);
      const route = url.pathname, method = request.method;
      if (method === 'GET' && route === '/api/status') return send({...library.status(),lastScan,
        pages:[...assets].filter(([,asset])=>asset.type==='text/html').map(([path])=>path)});
      if (method === 'GET' && route === '/api/resources') return send(library.search({
        q:url.searchParams.get('q') ?? '', offset:Number(url.searchParams.get('offset') ?? 0),
        limit:Number(url.searchParams.get('limit') ?? 50),status:url.searchParams.get('status') ?? '',
        starred:url.searchParams.get('starred') === 'true'}));
      if (method === 'GET' && route === '/api/export') {
        response.setHeader('Content-Disposition','attachment; filename="resource-review.json"');
        return send(library.exportReview());
      }
      if (method === 'POST' && route === '/api/scan') {
        await body(request);
        requireValue(!scanWork,'SCAN_ALREADY_RUNNING',409);
        lastScan = {state:'RUNNING'};
        scanWork = library.scan().then(result => {lastScan = {state:'COMPLETE',result};},
          e => {lastScan = {state:'FAILED',error:e.code ?? e.message};}).finally(() => {scanWork = null;});
        return send({...library.status(),lastScan},202);
      }
      if (method === 'POST' && route === '/api/scan/cancel') { await body(request); return send(library.cancelScan()); }
      if (method === 'PUT' && route === '/api/selection') return send(library.select((await body(request)).id));
      for (const handler of handlers) {
        if (await handler({request,response,url,send,signal:controller.signal,
          body:(maximum)=>body(request,maximum),registerDownload})) return;
      }
      const selected = /^\/api\/resources\/([a-f0-9]{64})(?:\/(preview|download|note|revisions))?$/.exec(route);
      requireValue(selected,'ROUTE_NOT_FOUND',404);
      const [,id,action] = selected;
      if (method === 'GET' && !action) return send(library.resource(id));
      if (method === 'GET' && action === 'revisions') return send(library.revisions(id));
      if (method === 'GET' && action === 'preview') return send(await library.preview(id,{signal:controller.signal}));
      if (method === 'PATCH' && action === 'note') return send(library.saveAnnotation(id,await body(request)));
      if (method === 'POST' && action === 'download') {
        await body(request);
        return send(await registerDownload(signal=>library.download(id,{signal})));
      }
      requireValue(false,'METHOD_NOT_ALLOWED',405);
    };
    run().catch(e => {
      if (response.headersSent || response.destroyed) response.destroy();
      else send({error:typeof e.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(e.code) ? e.code : 'RESOURCE_OPERATION_FAILED'},e.status ?? 500);
    }).finally(() => {clearTimeout(deadline); controllers.delete(controller); response.off('close',disconnected);});
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.maxRequestsPerSocket = 100;
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin = `http://127.0.0.1:${server.address().port}`;
  return {origin,url:origin + '/#' + token,token,server,
    async close() {
      if (closing) return;
      closing = true;
      for (const controller of controllers) controller.abort(new Error('SERVER_CLOSED'));
      library.cancelScan();
      for (const transfer of ownedTransfers) await transfer.release();
      transfers.clear();
      await new Promise(resolve => {server.close(resolve);server.closeAllConnections();});
      if (scanWork) await scanWork;
    }};
}
