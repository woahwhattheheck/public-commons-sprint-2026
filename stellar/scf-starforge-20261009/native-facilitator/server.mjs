// MIT. Private native x402 HTTP transport for the original SF58 frontdoor / SF30 seller.
import { createServer } from 'node:http';
import { FacilitatorError, requireValue } from './config.mjs';

const BODY_LIMIT = 1024 * 1024;
const json = (res, status, value) => {
  if (res.destroyed || res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','content-length':body.length});
  res.end(body);
};
async function readBody(req) {
  requireValue(/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''), 'JSON_CONTENT_TYPE_REQUIRED');
  requireValue(!req.headers['content-encoding'], 'ENCODED_BODY_UNSUPPORTED');
  if (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) ||
    Number(req.headers['content-length']) > BODY_LIMIT)) throw new FacilitatorError('BODY_TOO_LARGE',413);
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > BODY_LIMIT) throw new FacilitatorError('BODY_TOO_LARGE',413);
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); }
  catch { throw new FacilitatorError('INVALID_JSON'); }
  requireValue(body !== null && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).every(k => ['x402Version','paymentPayload','paymentRequirements'].includes(k)) &&
    (body.x402Version === undefined || body.x402Version === 2), 'REQUEST_FIELDS_INVALID');
  return body;
}

export async function startFacilitatorServer({facilitator, port = 4020} = {}) {
  requireValue(facilitator && ['verify','settle','getSupported','drain','status'].every(k =>
    typeof facilitator[k] === 'function'), 'NATIVE_FACILITATOR_REQUIRED');
  requireValue(Number.isInteger(port) && port >= 0 && port <= 65535, 'PORT_INVALID');
  let closing;
  const sockets = new Set();
  const responses = new Set();
  const server = createServer(async (req,res) => {
    let ended;
    const responseDone = new Promise(resolve => { ended = resolve; });
    responses.add(responseDone);
    const finish = () => { responses.delete(responseDone); ended(); };
    res.once('finish',finish); res.once('close',finish);
    try {
      const authority = `127.0.0.1:${server.address()?.port}`;
      if (req.headers.host !== authority || req.headers.origin !== undefined)
        throw new FacilitatorError('LOCAL_OPERATOR_CLIENT_REQUIRED',403);
      if (req.method === 'GET' && req.url === '/healthz') return json(res,200,facilitator.status());
      if (req.method === 'GET' && req.url === '/supported') return json(res,200,await facilitator.getSupported());
      if (!['/verify','/settle'].includes(req.url)) throw new FacilitatorError('NOT_FOUND',404);
      if (req.method !== 'POST') throw new FacilitatorError('METHOD_NOT_ALLOWED',405);
      const body = await readBody(req);
      if (req.aborted || res.destroyed) return;
      const result = await facilitator[req.url.slice(1)](body.paymentPayload,body.paymentRequirements);
      json(res,200,result);
    } catch (error) {
      const known = error instanceof FacilitatorError;
      json(res,known ? error.status : 500,{error:known ? error.code : 'FACILITATOR_REQUEST_FAILED',
        ...(req.url === '/settle' ? {retry:'RECONCILE_ORIGINAL_OPERATION'} : {})});
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 32;
  server.on('connection', socket => { sockets.add(socket); socket.once('close',() => sockets.delete(socket)); });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',resolve); });
  const close = () => closing ??= (async () => {
    const deadline = Date.now() + facilitator.drainGraceMs;
    let listenerClosed = false;
    const stopped = new Promise(resolve => server.close(() => { listenerClosed = true; resolve(); }));
    server.closeIdleConnections();
    const nativeDrain = facilitator.drain();
    let timer;
    let result;
    try {
      result = await Promise.race([
        Promise.all([nativeDrain,Promise.allSettled([...responses]),stopped])
          .then(([native]) => ({...native,httpDrained:true})),
        new Promise(resolve => { timer = setTimeout(() => resolve({drained:false,
          ...facilitator.status(),httpDrained:listenerClosed && responses.size === 0}),
          Math.max(0,deadline-Date.now())); }),
      ]);
    } finally { clearTimeout(timer); }
    // Include accepted TCP sockets whose partial headers never emitted 'request'.
    if (!result.drained || !result.httpDrained) for (const socket of sockets) socket.destroy();
    server.closeIdleConnections();
    await stopped;
    return {...result,drained:result.drained && result.httpDrained};
  })();
  return {url:`http://127.0.0.1:${server.address().port}`,server,close};
}
