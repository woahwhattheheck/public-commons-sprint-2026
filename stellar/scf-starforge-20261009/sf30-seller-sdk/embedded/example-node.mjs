// MIT. Existing HTTP app plus original seller, one listener and one shutdown path.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbeddedSeller, getEmbeddedRequestContext } from './index.mjs';
import { startSellerOperations } from '../operations/server.mjs';

const HELP = 'Usage: node embedded/example-node.mjs [--port 0]\n' +
  '       [--availability-dir PRIVATE_ABSOLUTE_DIRECTORY] [--operations-port 8424]\n' +
  'Uses the original example product and starts the private operator desk when availability is configured.';
function optionsFrom(args) {
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], value = args[++i];
    if (!['--port', '--operations-port', '--availability-dir'].includes(flag) ||
        options.has(flag) || !value || value.startsWith('--')) throw new TypeError(HELP);
    options.set(flag, value);
  }
  const port = (flag, fallback) => {
    const value = options.get(flag);
    if (value === undefined) return fallback;
    if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) throw new TypeError('Invalid example listener port');
    return Number(value);
  };
  return { port: port('--port', 0), availabilityDirectory: options.get('--availability-dir'),
    operationsPort: port('--operations-port', options.has('--availability-dir') ? 8424 : null) };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return null; }
  const options = optionsFrom(args);
  const original = JSON.parse(await readFile(new URL('../examples/service.json', import.meta.url), 'utf8'));
  const product = original.routes[0];
  const merchant = await createEmbeddedSeller({
    routes: [{ id: product.id,
      definition: { ...product.definition, url: 'https://merchant.example/api/dataset' },
      handler: async () => ({ body: { ...product.response,
        requestId: getEmbeddedRequestContext()?.requestId } }),
    }],
    contextFromRequest: req => ({ requestId: req.headers['x-request-id'] ?? null }),
    availabilityDirectory: options.availabilityDirectory,
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

  let operations, stopping;
  function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      let failure;
      try { await merchant.close(); } catch (error) { failure = error; }
      try { await operations?.close(); } catch (error) { failure ??= error; }
      try {
        if (server.listening)
          await new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
      } catch (error) { failure ??= error; }
      for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, onSignal);
      if (failure) throw failure;
    })();
    return stopping;
  }
  function onSignal() {
    stop().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
  }

  try {
    await new Promise((done, fail) => {
      server.once('error', fail);
      server.listen(options.port, '127.0.0.1', done);
    });
    if (options.operationsPort !== null) {
      // Reuse the original private desk and its observer with the real host
      // server. Neither the embedded seller nor operations.close owns this host.
      operations = await startSellerOperations({ ...merchant, server },
        { port: options.operationsPort });
    }
  } catch (error) {
    await stop();
    throw error;
  }

  const url = 'http://127.0.0.1:' + server.address().port;
  console.log(JSON.stringify({ url, free: '/health', merchant: '/api/dataset',
    routeId: product.id, docs: '/_seller/docs', mode: merchant.mode,
    ...(operations ? { operations: operations.url,
      availability: operations.availabilityUrl,
      availabilityControl: operations.availabilityControlUrl } : {}) }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, onSignal);
  return { merchant, server, operations, url, close: stop };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
}

