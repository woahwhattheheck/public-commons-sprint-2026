// MIT. Local operator interface over the maintained PostgreSQL/dataset engines.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fault } from './files.mjs';

async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
    throw fault('JSON_REQUIRED', 'Send application/json.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 262144) throw fault('REQUEST_TOO_LARGE', 'The request exceeds 256 KiB.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw fault('JSON_INVALID'); }
}
export async function startPostgresPublisherServer({ publisher, port = 8442 } = {}) {
  if (!publisher || typeof publisher.startExtraction !== 'function' || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new TypeError('Open publisher and valid port required');
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'], ['/app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([url, file, type]) => [url, { bytes: await readFile(new URL('./public/' + file, import.meta.url)), type }])));
  let origin, closing;
  const server = createServer((req, res) => {
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      const output = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
      res.writeHead(status, { 'content-type': type, 'content-length': output.length, 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
      res.end(output);
    };
    const action = async () => {
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin ||
          req.headers['sec-fetch-site'] === 'cross-site') throw fault('LOCAL_ORIGIN_REQUIRED', 'Open this workspace on its printed local address.', 403);
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) throw fault('INVALID_REQUEST_TARGET');
      const url = new URL(req.url, origin), path = url.pathname;
      if (req.method === 'GET' && !url.search && assets.has(path)) {
        const file = assets.get(path); return send(200, file.bytes, file.type);
      }
      if (req.method === 'GET') {
        if (path === '/api/status') {
          const options = {};
          for (const key of ['limit', 'plansOffset', 'runsOffset', 'historyOffset'])
            if (url.searchParams.has(key)) options[key] = Number(url.searchParams.get(key));
          return send(200, publisher.status(options));
        }
        if (path === '/api/source') return send(200, await publisher.source());
        if (path === '/api/target') return send(200, await publisher.target());
        if (/^\/api\/plans\/\d+$/.test(path)) return send(200, publisher.plan(Number(path.split('/').at(-1))));
        if (path === '/api/run') return send(200, await publisher.inspect(url.searchParams.get('id'), url.searchParams.get('query') ?? undefined));
        if (path === '/api/buyer') return send(200, await publisher.buyerOffer(url.searchParams.get('id'), url.searchParams.get('query') ?? ''));
        throw fault('NOT_FOUND', 'Page not found.', 404);
      }
      if (req.method !== 'POST') throw fault('NOT_FOUND', 'Action not found.', 404);
      const input = await body(req);
      if (path === '/api/plans') return send(201, await publisher.savePlan(input));
      if (path === '/api/extract') {
        const started = publisher.startExtraction(input.plan);
        return send(202, { id: started.id });
      }
      if (path === '/api/cancel') return send(200, publisher.cancel(input.id));
      if (path === '/api/review') return send(200, await publisher.review(input.id, input));
      if (path === '/api/publish') return send(200, await publisher.publish(input.id, input.reviewId));
      if (path === '/api/recover') return send(200, await publisher.recover(input.id));
      if (path === '/api/buyer') return send(200, await publisher.prepareBuyer(input.id, input));
      throw fault('NOT_FOUND', 'Action not found.', 404);
    };
    action().catch(issue => {
      const code = [issue.code, issue.message].find(value => typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value));
      if (!res.headersSent && !res.destroyed) send([400, 403, 404, 409, 413, 415, 422, 502].includes(issue.status) ? issue.status : 422,
        { error: code ?? 'PUBLISHER_INPUT_INVALID', message: issue.code ? issue.message : code ?? 'Review the selected input and retry this action.' });
      else if (!res.writableEnded) res.end();
    });
  });
  server.requestTimeout = 330000; server.headersTimeout = 15000; server.keepAliveTimeout = 1000;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin, server, publisher, close() {
    closing ??= (async () => {
      const stop = new Promise((done, reject) => {
        server.close(issue => issue ? reject(issue) : done()); server.closeIdleConnections?.();
      });
      const running = publisher.status().active;
      if (running?.kind === 'extraction') publisher.cancel(running.id);
      try { await stop; } finally { await publisher.close(); }
    })();
    return closing;
  } };
}
