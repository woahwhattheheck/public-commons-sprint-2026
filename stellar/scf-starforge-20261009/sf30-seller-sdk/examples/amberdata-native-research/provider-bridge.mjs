// MIT. One application-owned child using the ORIGINAL SF30 upstream handlers.
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

const root = dirname(fileURLToPath(import.meta.url));
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
let handlers, closeHandlers, active, closing;
async function close() {
  return closing ??= (async () => { active?.abort(); if (handlers) await closeHandlers(handlers); })();
}
try {
  const plan = JSON.parse(await readFile(join(root, 'product.json'), 'utf8'));
  const sourceRoot = process.env.AMBERDATA_SOURCE_ROOT;
  if (!sourceRoot || !isAbsolute(sourceRoot) || resolve(sourceRoot) !== sourceRoot) throw new Error('SOURCE_ROOT');
  const native = await import(pathToFileURL(join(sourceRoot, 'stellar/scf-starforge-20261009/sf30-seller-sdk/upstream.mjs')).href);
  closeHandlers = native.closeUpstreamHandlers;
  const bindings = JSON.parse(await readFile(join(root, 'upstreams.json'), 'utf8'));
  handlers = native.createUpstreamHandlers(bindings, { env: { ...process.env, AMBERDATA_API_VERSION: plan.provider.apiVersion } });
  emit({ ready: true });
  process.once('SIGTERM', () => { close().finally(() => process.exit(0)); });
  process.once('SIGINT', () => { close().finally(() => process.exit(0)); });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (Buffer.byteLength(line) > 20000) throw new Error('INPUT_LIMIT');
    const input = JSON.parse(line);
    if (input?.action === 'close') break;
    const operation = input?.operation;
    if (input?.action !== 'read' || !/^[a-f0-9]{32}$/.test(input.id ?? '') || !['spot_instruments', 'spot_ohlcv'].includes(operation) || !input.query || typeof input.query !== 'object' || Array.isArray(input.query)) throw new Error('INPUT');
    active = new AbortController();
    const context = { method: 'GET', query: input.query, body: null, headers: {}, signal: active.signal,
      pathParams: operation === 'spot_ohlcv' ? { instrument: plan.provider.instrument } : {},
      url: new URL(operation === 'spot_ohlcv' ? '/spot/ohlcv' : '/spot/instruments', plan.publicOrigin) };
    const result = await handlers[operation](context);
    active = null;
    if (result.status !== 200 || !Buffer.isBuffer(result.body)) {
      emit({ id: input.id, ok: false, error: 'ORIGINAL_UPSTREAM_FAILED', nativeStatus: result.status });
      continue;
    }
    emit({ id: input.id, ok: true, bodyBase64: result.body.toString('base64'),
      nativeUpstream: { status: result.status, ...handlers[operation].snapshot() } });
  }
} catch {
  emit({ error: 'AMBERDATA_NATIVE_SOURCE_FAILED' });
  process.exitCode = 1;
} finally { await close().catch(() => { process.exitCode = 1; }); }
