#!/usr/bin/env node
// MIT. Operate the ORIGINAL SF61 compiler and SF30 server; no payment middleware.
import { readFile, writeFile, lstat, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { prepareUpstreamSnapshot, verifyUpstreamSnapshot } from './upstream-state.mjs';

const USAGE = `SF82: compile, run and resume an existing OpenAPI seller.
First run: node pilot.mjs --spec OPENAPI_JSON --config SELECTIONS_JSON \\
  --bindings ROUTE_BINDINGS_JSON --out NEW_DIRECTORY [runtime options]
Restart:   node pilot.mjs --resume DIRECTORY [runtime overrides]
Status:    node pilot.mjs --status DIRECTORY

Runtime options: --handlers TRUSTED_ESM | --upstreams BINDINGS_JSON
                 --allow-loopback-upstream | --disallow-loopback-upstream
                 --port 8423 --facilitator HTTPS_URL
                 --allow-local-facilitator --challenge-only

Resume uses the saved runtime options; supplied options override them.
--challenge-only removes a saved facilitator. Port 0 chooses a new free port.
Ctrl-C stops the service. Status checks the current local listener.
Upstream JSON is saved privately; resume uses that exact snapshot and fresh env credentials.
Compiled source files are never overwritten. Trusted handlers remain your app.
The original SF30 listener binds to 127.0.0.1; deploy with your HTTPS proxy.`;
const VALUES = new Set(['--spec', '--config', '--bindings', '--out', '--resume',
  '--status', '--handlers', '--upstreams', '--facilitator', '--port']);
const FLAGS = new Set(['--allow-local-facilitator', '--challenge-only',
  '--allow-loopback-upstream', '--disallow-loopback-upstream']);
const INPUTS = ['--spec', '--config', '--bindings', '--out'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const shellQuote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const entry = fileURLToPath(import.meta.url);
const command = (flag, out) => `node ${shellQuote(entry)} ${flag} ${shellQuote(out)}`;
const runtimeFailure = (error, out) => new Error(`${error.message}\nCompiled seller preserved. Correct the runtime option and resume:\n${command('--resume', out)}${error.code === 'EADDRINUSE' ? ' --port 0' : ''}`, { cause: error });

function optionsFrom(args) {
  if (args.length === 1 && args[0] === '--help') return null;
  const opts = new Map();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (opts.has(flag)) throw new TypeError(`Duplicate ${flag}\n${USAGE}`);
    if (FLAGS.has(flag)) { opts.set(flag, true); continue; }
    if (!VALUES.has(flag) || !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError(USAGE);
    opts.set(flag, args[++i]);
  }
  const saved = opts.has('--resume') || opts.has('--status');
  if (saved ? INPUTS.some(k => opts.has(k)) || opts.has('--resume') && opts.has('--status') :
      !INPUTS.every(k => opts.has(k))) throw new TypeError(USAGE);
  if (opts.has('--status') && opts.size !== 1) throw new TypeError('Status takes only DIRECTORY\n' + USAGE);
  if (opts.has('--challenge-only') && (opts.has('--facilitator') || opts.has('--allow-local-facilitator')))
    throw new TypeError('Choose --challenge-only or a facilitator');
  if (opts.has('--handlers') && opts.has('--upstreams'))
    throw new TypeError('Choose --handlers or --upstreams for this seller');
  if (opts.has('--allow-loopback-upstream') && opts.has('--disallow-loopback-upstream'))
    throw new TypeError('Choose whether this seller allows a loopback upstream');
  if (opts.has('--port') && (!/^\d{1,5}$/.test(opts.get('--port')) || Number(opts.get('--port')) > 65535))
    throw new TypeError('--port must be 0–65535; use --port 0 for a free local port');
  return opts;
}
async function readJson(path, limit) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw new TypeError(`Expected a regular JSON file up to ${limit} bytes: ${path}`);
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new RangeError(`File grew beyond its limit: ${path}`);
  return { bytes, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
}
async function optionalJson(path, limit) {
  try { return (await readJson(path, limit)).value; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeRuntime(out, name, value) {
  const target = join(out, name), temp = join(out, `.${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temp, target);
  } finally { await unlink(temp).catch(() => {}); }
}
function offersDigest(offers) {
  if (!Array.isArray(offers) || !offers.length) throw new TypeError('No seller offers');
  return hash(Buffer.from(offers.map(offer => {
    if (typeof offer?.resource?.url !== 'string' ||
        typeof offer?.extensions?.bazaar?.info?.input?.method !== 'string')
      throw new TypeError('Invalid original seller offer');
    return JSON.stringify(offer);
  }).sort().join('\n')));
}
async function compiledSource(out) {
  const [manifest, offers, service] = await Promise.all([
    readJson(join(out, 'manifest.json'), 64 * 1024),
    readJson(join(out, 'offers.json'), 4 * 1024 * 1024),
    readJson(join(out, 'seller-service.json'), 1024 * 1024),
  ]);
  if (manifest.value?.schema !== 'stellar.open-api-seller-manifest.v1' ||
      offers.value?.schema !== 'stellar.open-api-seller-import.v1' ||
      hash(offers.bytes) !== manifest.value.offersSha256 ||
      hash(service.bytes) !== manifest.value.serviceConfigSha256)
    throw new Error('Compiled seller differs from manifest.json. Restore the original files or compile changed inputs into a new --out directory.');
  const digest = offersDigest(offers.value.offers?.map(o => o.seller));
  return { manifest: manifest.value, offers: offers.value.offers, digest };
}
function identity(source) {
  return { offersSha256: source.manifest.offersSha256, serviceConfigSha256: source.manifest.serviceConfigSha256 };
}
function sameSource(saved, source) {
  return saved?.offersSha256 === source.manifest.offersSha256 &&
    saved?.serviceConfigSha256 === source.manifest.serviceConfigSha256;
}
async function runtimeOptions(opts, out, source) {
  const saved = await optionalJson(join(out, 'pilot-runtime.json'), 16 * 1024);
  if (saved && (saved.schema !== 'stellar-forge.seller-pilot-runtime.v1' || !sameSource(saved.source, source)))
    throw new Error('Saved runtime settings belong to a different compiled seller');
  const runtime = { port: '8423', ...(saved?.options ?? {}) };
  for (const key of ['port', 'handlers', 'facilitator']) if (opts.has('--' + key))
    runtime[key] = key === 'handlers' ? resolve(opts.get('--' + key)) : opts.get('--' + key);
  if (opts.has('--handlers')) { delete runtime.upstreams; delete runtime.allowLoopbackUpstream; }
  if (opts.has('--upstreams')) delete runtime.handlers;
  if (opts.has('--allow-loopback-upstream')) runtime.allowLoopbackUpstream = true;
  if (opts.has('--disallow-loopback-upstream')) runtime.allowLoopbackUpstream = false;
  if (opts.has('--allow-local-facilitator')) runtime.allowLocalFacilitator = true;
  if (opts.has('--challenge-only')) { delete runtime.facilitator; delete runtime.allowLocalFacilitator; }
  if (!/^\d{1,5}$/.test(runtime.port) || Number(runtime.port) > 65535 ||
      runtime.handlers !== undefined && (typeof runtime.handlers !== 'string' || resolve(runtime.handlers) !== runtime.handlers) ||
      runtime.allowLocalFacilitator !== undefined && typeof runtime.allowLocalFacilitator !== 'boolean' ||
      runtime.allowLoopbackUpstream !== undefined && typeof runtime.allowLoopbackUpstream !== 'boolean')
    throw new TypeError('Invalid saved runtime settings; supply a valid --port or --handlers override');
  if (!opts.has('--upstreams') && !runtime.upstreams && runtime.allowLoopbackUpstream !== undefined)
    throw new TypeError('Upstream loopback options require --upstreams or a saved upstream seller');
  if (runtime.handlers && runtime.upstreams)
    throw new TypeError('Saved settings select both handlers and upstreams; select one explicitly');
  if (runtime.allowLocalFacilitator && !runtime.facilitator) throw new TypeError('--allow-local-facilitator requires --facilitator');
  if (runtime.facilitator !== undefined) {
    const url = new URL(runtime.facilitator);
    const local = runtime.allowLocalFacilitator === true && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw new TypeError('Facilitator requires a credential-free HTTPS URL; local HTTP needs --allow-local-facilitator');
  }
  if (opts.has('--resume') && !saved && !opts.has('--facilitator') && !opts.has('--challenge-only')) {
    const previous = await optionalJson(join(out, 'runtime-readiness.json'), 64 * 1024);
    if (previous?.runtimeMode === 'NATIVE_X402')
      throw new Error('This older pilot has no saved facilitator. Supply --facilitator URL or explicitly --challenge-only.');
  }
  if (opts.has('--upstreams') || runtime.upstreams) {
    const { readSellerConfig } = await import('../sf30-seller-sdk/serve.mjs');
    runtime.upstreams = await prepareUpstreamSnapshot({ out,
      input: opts.has('--upstreams') ? resolve(opts.get('--upstreams')) : undefined,
      saved: runtime.upstreams, config: await readSellerConfig(join(out, 'seller-service.json')),
      allowLoopback: runtime.allowLoopbackUpstream === true, deferCredentials: !runtime.facilitator });
  }
  return runtime;
}
async function readListener(url, source, mode) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new TypeError('Original seller runtime did not report a loopback-only listener');
  const [healthResponse, offersResponse] = await Promise.all([
    fetch(url + '/_seller/health', { signal: AbortSignal.timeout(4000), redirect: 'error' }),
    fetch(url + '/_seller/offers', { signal: AbortSignal.timeout(4000), redirect: 'error' }),
  ]);
  if (!healthResponse.ok || !offersResponse.ok) throw new Error('Native seller readback failed');
  const [health, offers] = await Promise.all([healthResponse.json(), offersResponse.json()]);
  if (health?.schema !== 'stellar-forge.seller-service.v1' || health.mode !== mode ||
      !Array.isArray(health.routes) || health.routes.length !== source.offers.length || offersDigest(offers) !== source.digest)
    throw new Error('Compiled source / running original offers diverged');
  return health;
}
async function status(out, source) {
  const receipt = await optionalJson(join(out, 'runtime-readiness.json'), 64 * 1024);
  const result = { state: 'NOT_STARTED', output: out, resume: command('--resume', out) };
  if (receipt) {
    if (receipt.originalOffersSha256 !== source.manifest.offersSha256 ||
        receipt.originalServiceConfigSha256 !== source.manifest.serviceConfigSha256)
      throw new Error('Last runtime observation belongs to another compiled seller');
    result.lastObservedAt = receipt.observedAt;
    try {
      if (receipt.runtime?.upstreams) await verifyUpstreamSnapshot(out, receipt.runtime.upstreams);
      const health = await readListener(receipt.listener, source, receipt.runtimeMode);
      Object.assign(result, { state: 'RUNNING', mode: health.mode, listener: receipt.listener,
        health: receipt.listener + '/_seller/health', offers: receipt.listener + '/_seller/offers',
        lastSuccessfulRuntime: receipt.runtime, routes: health.routes });
    } catch (error) {
      result.state = 'UNAVAILABLE'; result.message = 'Last listener is unreachable or no longer matches this seller. Stop any old process before resuming.';
      result.reason = error.message;
    }
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  return result;
}

/** First compile or resume a saved seller, always using original SF30 serving. */
export async function launch(args = process.argv.slice(2), deps = {}) {
  const opts = optionsFrom(args);
  if (!opts) { process.stdout.write(USAGE + '\n'); return null; }
  const out = resolve(opts.get('--resume') ?? opts.get('--status') ?? opts.get('--out'));
  if (!opts.has('--resume') && !opts.has('--status')) {
    const compile = deps.compile ?? (await import('../sf61-openapi-seller-import/cli.mjs')).run;
    try {
      await compile(['--spec', resolve(opts.get('--spec')), '--config', resolve(opts.get('--config')),
        '--service-bindings', resolve(opts.get('--bindings')), '--out', out]);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Output already exists. To use its compiled seller:\n${command('--resume', out)}\nFor changed source inputs, choose a new --out directory.`, { cause: error });
      throw error;
    }
  }
  // Before trusted handlers are imported or a socket is opened, bind both
  // exported artifacts to the original compiler manifest, including on resume.
  const source = await compiledSource(out);
  if (opts.has('--status')) return status(out, source);
  let runtime;
  try { runtime = await runtimeOptions(opts, out, source); }
  catch (error) { throw runtimeFailure(error, out); }
  await writeRuntime(out, 'pilot-runtime.json', { schema: 'stellar-forge.seller-pilot-runtime.v1',
    source: identity(source), options: runtime });
  const serveArgs = ['--config', join(out, 'seller-service.json'), '--port', runtime.port];
  if (runtime.handlers) serveArgs.push('--handlers', runtime.handlers);
  if (runtime.upstreams) serveArgs.push('--upstreams', join(out, runtime.upstreams.file));
  if (runtime.allowLoopbackUpstream) serveArgs.push('--allow-loopback-upstream');
  if (runtime.facilitator) serveArgs.push('--facilitator', runtime.facilitator);
  if (runtime.allowLocalFacilitator) serveArgs.push('--allow-local-facilitator');
  let session;
  try {
    const serve = runtime.upstreams
      ? deps.upstreamServe ?? (await import('../sf30-seller-sdk/upstream-serve.mjs')).main
      : deps.serve ?? (await import('../sf30-seller-sdk/serve.mjs')).main;
    session = await serve(serveArgs);
    if (!session || typeof session.url !== 'string' || typeof session.close !== 'function')
      throw new TypeError('Original seller runtime returned no live session');
    const health = await readListener(session.url, source, runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY');
    const receipt = { schema: 'stellar-forge.seller-pilot-readiness.v1', observedAt: new Date().toISOString(),
      originalOffersSha256: source.manifest.offersSha256,
      originalServiceConfigSha256: source.manifest.serviceConfigSha256,
      nativeOfferDigestSha256: source.digest, runtimeMode: health.mode, runtime, routeCount: health.routes.length,
      listener: session.url, healthEndpoint: session.url + '/_seller/health', offersEndpoint: session.url + '/_seller/offers',
      paidRequestsSent: 0, settlementVerified: false, buyerAdoptionVerified: false };
    await writeRuntime(out, 'runtime-readiness.json', receipt);
    process.stdout.write(JSON.stringify({ pilotReady: true, ...receipt, output: out, runtime,
      routes: health.routes, resume: command('--resume', out), status: command('--status', out), stop: 'Ctrl-C' }) + '\n');
    process.stderr.write(`Seller running (${health.mode}): ${session.url}\nHealth: ${receipt.healthEndpoint}\nOffers: ${receipt.offersEndpoint}\nStop: Ctrl-C\nRestart: ${command('--resume', out)}\nStatus: ${command('--status', out)}\n`);
    return session;
  } catch (error) {
    try { await session?.close?.(); } catch {}
    throw runtimeFailure(error, out);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  launch().catch(error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exitCode = 1; });
