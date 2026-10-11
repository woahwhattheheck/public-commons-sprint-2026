// MIT. One configuration and the maintained ORIGINAL SF30 service/operations UI.
import { readFile, open, unlink, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPythonMerchant } from './config.mjs';
import { createPythonSource } from './source.mjs';
import { startSellerService } from '../serve.mjs';

const USAGE = `Usage: node python/merchant.mjs inspect --config MERCHANT.json
       node python/merchant.mjs diagnose --config MERCHANT.json
       node python/merchant.mjs preview --config MERCHANT.json --function NAME --input INPUT.json --out NEW_FILE
       node python/merchant.mjs serve --config MERCHANT.json [--port 8423] [--operations-port 8424]
         [--facilitator HTTPS_URL] [--allow-local-facilitator]
         [--max-in-flight 64] [--drain-grace-ms 60000]

inspect reads configuration only. diagnose initializes and closes the configured
Python workers without invoking a public function. preview runs the selected local Python function
without payment and saves its result privately. serve uses the original SF30
payment and operations service; without a facilitator it only returns challenges
and does not import or execute Python. See python/README.md.`;

export function previewContext(definition, values) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Input must be an object');
  return { method: definition.method, url: new URL(definition.offer.resource.url), pathParams: {}, headers: {},
    query: definition.method === 'POST' ? {} : Object.fromEntries(Object.entries(values).map(([key, value]) =>
      [key, typeof value === 'object' || value === undefined ? value : String(value)])),
    body: definition.method === 'POST' ? values : null };
}

/** Embedding keeps nativeFactory and all actual payment authority with SF30. */
export async function startPythonMerchant(compiled, { port = 8423, nativeFactory = null,
  maxInFlight = 64, drainGraceMs = 60000, operationsPort, env } = {}) {
  let source = null, seller = null, operations = null, closing;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      let failure, sellerShutdown = null, pythonShutdown = null;
      // Keep observers and workers alive while original responses drain.
      try { sellerShutdown = await seller?.close() ?? null; } catch (caught) { failure = caught; }
      try { await operations?.close(); } catch (caught) { failure ??= caught; }
      try { pythonShutdown = await source?.close() ?? null; } catch (caught) { failure ??= caught; }
      if (failure) throw failure;
      return { clean: pythonShutdown?.clean !== false, seller: sellerShutdown, python: pythonShutdown };
    })();
    return closing;
  }
  try {
    const handlers = Object.create(null);
    if (nativeFactory) source = await createPythonSource(compiled, { env });
    for (const name of Object.keys(compiled.functions)) {
      const route = source?.route(name);
      handlers[name] = route?.handler ?? (() => { throw new Error('CHALLENGE_ONLY'); });
      handlers[name + 'Admission'] = route?.admit ?? (() => true);
    }
    seller = await startSellerService({ config: compiled.service, port, handlers, nativeFactory, maxInFlight, drainGraceMs });
    if (operationsPort !== undefined) {
      const { startSellerOperations } = await import('../operations/server.mjs');
      operations = await startSellerOperations(seller, { port: operationsPort });
    }
    return { seller, source, operations, close };
  } catch (failure) { await close().catch(() => {}); throw failure; }
}

function parse(args) {
  const action = args[0];
  if (!['inspect', 'diagnose', 'preview', 'serve'].includes(action)) throw new TypeError(USAGE);
  const values = new Map();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (values.has(flag)) throw new TypeError('Duplicate option');
    if (flag === '--allow-local-facilitator') { values.set(flag, true); continue; }
    if (!['--config', '--function', '--input', '--out', '--port', '--operations-port', '--facilitator', '--max-in-flight', '--drain-grace-ms'].includes(flag) ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(USAGE);
    values.set(flag, args[++i]);
  }
  if (!values.has('--config')) throw new TypeError(USAGE);
  const allowed = new Set(['inspect', 'diagnose'].includes(action) ? ['--config'] : action === 'preview' ?
    ['--config', '--function', '--input', '--out'] :
    ['--config', '--port', '--operations-port', '--facilitator', '--allow-local-facilitator', '--max-in-flight', '--drain-grace-ms']);
  if ([...values.keys()].some(flag => !allowed.has(flag))) throw new TypeError('Option does not apply to this action');
  if (action === 'preview' && ['--function', '--input', '--out'].some(flag => !values.has(flag))) throw new TypeError(USAGE);
  if (values.has('--allow-local-facilitator') && !values.has('--facilitator')) throw new TypeError('Local facilitator option requires a URL');
  for (const flag of ['--port', '--operations-port']) if (values.has(flag) &&
      (!/^\d{1,5}$/.test(values.get(flag)) || Number(values.get(flag)) > 65535)) throw new TypeError('Port must be 0–65535');
  return { action, values };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return null; }
  const { action, values } = parse(args);
  const compiled = await readPythonMerchant(resolve(values.get('--config')));
  if (action === 'inspect') {
    const summary = { status: 'CONFIG_VALID', pythonImported: false,
      workerCount: compiled.options.workerCount, maxPending: compiled.options.maxPending,
      lifecycle: compiled.options.lifecycle, eventLoop: 'persistent',
      startupTimeoutMs: compiled.options.startupTimeoutMs, shutdownTimeoutMs: compiled.options.shutdownTimeoutMs,
      routes: compiled.service.routes.map(route => ({ id: route.id, path: route.path,
        offer: route.offer, maxInputBytes: compiled.functions[route.id].maxInputBytes,
        maxOutputBytes: compiled.functions[route.id].maxOutputBytes, timeoutMs: compiled.functions[route.id].timeoutMs })) };
    process.stdout.write(JSON.stringify(summary) + '\n'); return summary;
  }
  if (action === 'diagnose') {
    const source = await createPythonSource(compiled);
    const ready = source.stats();
    const shutdown = await source.close();
    const summary = { status: shutdown.clean ? 'PYTHON_LIFECYCLE_READY' : 'PYTHON_SHUTDOWN_INCOMPLETE',
      pythonImported: true, functionsInvoked: 0, ready, shutdown, pool: source.stats() };
    process.stdout.write(JSON.stringify(summary) + '\n');
    if (!shutdown.clean) process.exitCode = 1;
    return summary;
  }
  if (action === 'preview') {
    const name = values.get('--function'), definition = compiled.functions[name];
    if (!definition) throw new TypeError('Unknown function');
    const path = resolve(values.get('--input'));
    if (!(await stat(path)).isFile() || (await stat(path)).size > definition.maxInputBytes) throw new TypeError('Input file exceeds limit');
    const bytes = await readFile(path);
    if (bytes.length > definition.maxInputBytes) throw new TypeError('Input exceeds limit');
    const context = previewContext(definition, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    const destination = resolve(values.get('--out'));
    const output = await open(destination, 'wx', 0o600);
    let source, written = false;
    try {
      source = await createPythonSource(compiled);
      const body = await source.call(name, context);
      await output.writeFile(body); await output.sync(); written = true;
      const shutdown = await source.close();
      const summary = { status: 'LOCAL_PREVIEW_SAVED', function: name, destination,
        bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'),
        contentType: definition.output.contentType, shutdown, pool: source.stats() };
      process.stdout.write(JSON.stringify(summary) + '\n');
      if (!shutdown.clean) process.exitCode = 1;
      return summary;
    } finally {
      await source?.close(); await output.close();
      if (!written) await unlink(destination).catch(() => {});
    }
  }
  let nativeFactory = null;
  if (values.has('--facilitator')) {
    const url = new URL(values.get('--facilitator'));
    const local = values.has('--allow-local-facilitator') && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw new TypeError('Facilitator requires HTTPS; loopback HTTP needs explicit local option');
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('../native-factory.mjs'),
    ]);
    nativeFactory = routes => createNativeSellerServer(routes, { facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
  }
  const session = await startPythonMerchant(compiled, { nativeFactory,
    port: Number(values.get('--port') ?? 8423), maxInFlight: Number(values.get('--max-in-flight') ?? 64),
    drainGraceMs: Number(values.get('--drain-grace-ms') ?? 60000),
    ...(values.has('--operations-port') ? { operationsPort: Number(values.get('--operations-port')) } : {}) });
  process.stdout.write(JSON.stringify({ mode: session.seller.mode, url: session.seller.url,
    health: session.seller.url + '/_seller/health', docs: session.seller.url + '/_seller/docs',
    operations: session.operations?.url ?? null, pythonStarted: Boolean(session.source) }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    session.close().then(shutdown => {
      process.stdout.write(JSON.stringify({ status: shutdown.clean ? 'MERCHANT_STOPPED' : 'MERCHANT_STOP_INCOMPLETE', shutdown }) + '\n');
      if (!shutdown.clean) process.exitCode = 1;
    }).catch(() => { process.stderr.write('PYTHON_MERCHANT_SHUTDOWN_FAILED\n'); process.exitCode = 1; });
  });
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('PYTHON_MERCHANT_COMMAND_FAILED\n'); process.exitCode = 1; });
}
