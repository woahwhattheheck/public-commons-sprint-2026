// MIT. Loopback Standard Webhooks receiver; publish only webhook paths through TLS.
import { createServer } from 'node:http';
import { FeedError } from './model.mjs';

export function sendJson(response, status, body, extra = {}) {
  if (response.destroyed || response.writableEnded) return;
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff', 'content-length': String(bytes.length), ...extra }); response.end(bytes);
}
export async function readRequestBody(request, maximum) {
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new FeedError('EVENT_BODY_TOO_LARGE', 413);
  const parts = []; let length = 0;
  for await (const part of request) { length += part.length; if (length > maximum) throw new FeedError('EVENT_BODY_TOO_LARGE', 413); parts.push(part); }
  return Buffer.concat(parts, length);
}
export async function startWebhookReceiver({ store, port = 8491 } = {}) {
  if (!store || !Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Store and valid port required');
  let inFlight = 0;
  const server = createServer((request, response) => {
    const action = async () => {
      if (inFlight >= 32) { request.resume(); return sendJson(response, 429, { error: 'RECEIVER_BUSY' }, { 'retry-after': '1' }); }
      inFlight++;
      try {
        if (request.url === '/_feed/health' && request.method === 'GET') return sendJson(response, 200, { schema: 'stellar-forge.webhook-receiver.v1', ready: true });
        const match = /^\/webhooks\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/.exec(request.url ?? '');
        if (!match) throw new FeedError('NOT_FOUND', 404);
        if (request.method !== 'POST') throw new FeedError('POST_REQUIRED', 405);
        const source = store.definition('source', match[1], { enabled: true });
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '') || request.headers['content-encoding']) throw new FeedError('RAW_JSON_REQUIRED', 415);
        for (const header of ['webhook-id', 'webhook-timestamp', 'webhook-signature']) {
          let count = 0;
          for (let index = 0; index < request.rawHeaders.length; index += 2) if (request.rawHeaders[index].toLowerCase() === header) count++;
          if (count !== 1) throw new FeedError('INVALID_WEBHOOK_HEADERS', 401);
        }
        const rawBody = await readRequestBody(request, source.maxEventBytes);
        return sendJson(response, 200, store.acceptWebhook(source.id, request.headers, rawBody));
      } catch (error) {
        request.resume();
        const known = error instanceof FeedError;
        return sendJson(response, known ? error.status : 503, { error: known ? error.code : 'RECEIVER_UNAVAILABLE', ...(known ? error.details : {}) });
      } finally { inFlight--; }
    };
    action().catch(() => { if (!response.headersSent) sendJson(response, 503, { error: 'RECEIVER_UNAVAILABLE' }); else response.destroy(); });
  });
  server.headersTimeout = 10000; server.requestTimeout = 15000; server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let closing;
  return { server, url: `http://127.0.0.1:${server.address().port}`,
    close: () => closing ??= new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}
