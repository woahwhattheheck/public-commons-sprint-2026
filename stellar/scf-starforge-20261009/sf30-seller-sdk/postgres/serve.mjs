// MIT. Compose this data source into ORIGINAL seller; no second payment server.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSellerConfig, startSellerService } from '../serve.mjs';
import { createNativeSellerServer } from '../native-factory.mjs';
import { openPostgresQueryFile } from './config.mjs';

export async function startPostgresSeller({ configFile, sourceFile, bindings, port = 8423,
  nativeFactory = null, maxInFlight = 64, drainGraceMs = 60000, env = process.env } = {}) {
  const config = await readSellerConfig(configFile);
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw new TypeError('Explicit route-ID to query bindings required');
  const ids = config.routes.map(route => route.id);
  if (Object.keys(bindings).length !== ids.length || Object.keys(bindings).some(id => !ids.includes(id)))
    throw new TypeError('Bindings must cover exactly the configured seller route IDs');
  const source = await openPostgresQueryFile(sourceFile, { env });
  let seller;
  try {
    const handlers = Object.create(null);
    for (const route of config.routes) {
      const binding = bindings[route.id];
      if (!binding || typeof binding.query !== 'string' || !['query', 'body'].includes(binding.input)) throw new TypeError('Each binding needs query and query/body input');
      if (!route.handler || !route.admit || Object.hasOwn(route, 'response') || Object.hasOwn(route, 'responseFile'))
        throw new TypeError('Each PostgreSQL route requires original handler and admit exports');
      if (Object.hasOwn(handlers, route.handler) || Object.hasOwn(handlers, route.admit) || route.handler === route.admit)
        throw new TypeError('Each handler/admit export name must be distinct');
      const method = (route.definition?.method ?? route.offer?.extensions?.bazaar?.info?.input?.method ?? '').toUpperCase();
      if (binding.input === 'query' && !['GET', 'HEAD'].includes(method) || binding.input === 'body' && !['POST', 'PUT', 'PATCH'].includes(method))
        throw new TypeError('Binding input must match the configured seller method');
      const pair = source.route(binding.query, { input: binding.input });
      handlers[route.handler] = pair.handler; handlers[route.admit] = pair.admit;
    }
    seller = await startSellerService({ config, handlers, port, nativeFactory, maxInFlight, drainGraceMs });
    const originalClose = seller.close;
    let closing;
    const close = () => closing ??= (async () => { try { await originalClose(); } finally { await source.close(); } })();
    return { ...seller, source, close };
  } catch (error) { await source.close(); throw error; }
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node postgres/serve.mjs --config SERVICE --source SOURCE --bindings BINDINGS [--port 8423] [--facilitator HTTPS_URL] [--max-in-flight 64] [--drain-grace-ms 60000]\n'); return;
  }
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (flags.has(key) || !['--config', '--source', '--bindings', '--port', '--facilitator', '--allow-local-facilitator', '--max-in-flight', '--drain-grace-ms'].includes(key)) throw new TypeError('Unknown or duplicate option');
    if (key === '--allow-local-facilitator') flags.set(key, true);
    else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError('Option value required'); flags.set(key, args[++i]); }
  }
  for (const key of ['--config', '--source', '--bindings']) if (!flags.has(key)) throw new TypeError('config, source and bindings are required');
  const { readPrivateFile } = await import('./config.mjs');
  const bindings = JSON.parse(await readPrivateFile(flags.get('--bindings')));
  let nativeFactory = null;
  if (flags.has('--facilitator')) {
    const url = new URL(flags.get('--facilitator'));
    const local = flags.has('--allow-local-facilitator') && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) throw new TypeError('Facilitator requires HTTPS or explicit loopback permission');
    const { HTTPFacilitatorClient } = await import('@x402/core/server');
    nativeFactory = compiled => createNativeSellerServer(compiled, {
      facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }),
    });
  } else if (flags.has('--allow-local-facilitator')) throw new TypeError('Local facilitator flag needs a facilitator URL');
  const session = await startPostgresSeller({ configFile: flags.get('--config'), sourceFile: flags.get('--source'), bindings,
    port: Number(flags.get('--port') ?? 8423), maxInFlight: Number(flags.get('--max-in-flight') ?? 64),
    drainGraceMs: Number(flags.get('--drain-grace-ms') ?? 60000), nativeFactory });
  process.stdout.write(JSON.stringify({ url: session.url, mode: session.mode, routes: session.compiled.routes.length }) + '\n');
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; session.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return session;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  process.stderr.write('{"error":"POSTGRES_SELLER_START_FAILED"}\n'); process.exitCode = 1;
});
