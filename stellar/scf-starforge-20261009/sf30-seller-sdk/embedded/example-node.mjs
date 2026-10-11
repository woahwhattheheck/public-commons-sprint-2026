// MIT. Existing HTTP app plus original seller, one listener and one shutdown path.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createEmbeddedSeller, getEmbeddedRequestContext } from './index.mjs';

const original = JSON.parse(await readFile(new URL('../examples/service.json', import.meta.url), 'utf8'));
const product = original.routes[0];
const merchant = await createEmbeddedSeller({
  routes: [{ id: product.id,
    definition: { ...product.definition, url: 'https://merchant.example/api/dataset' },
    handler: async () => ({ body: { ...product.response,
      requestId: getEmbeddedRequestContext()?.requestId } }),
  }],
  contextFromRequest: req => ({ requestId: req.headers['x-request-id'] ?? null }),
});

const server = createServer(async (req, res) => {
  if (await merchant.handle(req, res)) return;
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ application: 'ready' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'APPLICATION_ROUTE_NOT_FOUND' }));
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`,
  free: '/health', merchant: '/api/dataset', docs: '/_seller/docs', mode: merchant.mode }));

let stopping;
function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    let failure;
    try { await merchant.close(); } catch (error) { failure = error; }
    try {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } catch (error) { failure ??= error; }
    if (failure) throw failure;
  })();
  return stopping;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  stop().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
});
