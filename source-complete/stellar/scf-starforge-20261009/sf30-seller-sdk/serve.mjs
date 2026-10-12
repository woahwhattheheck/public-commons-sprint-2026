// MIT. Runnable SF30 seller service using the original compiler and native x402 adapter.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { compileSellerRoutes, createSellerResourceHandler } from './resource-server.mjs';
import { validateAdmissionTimeout } from './admission.mjs';
import { validateHandlerTimeout } from './handler-execution.mjs';
import { validateRequestTimeout, DEFAULT_REQUEST_TIMEOUT_MS } from './request-lifetime.mjs';
import { createConfiguredAdmission, validateInputOption } from './configured-admission.mjs';
import { compileServicePath } from './route-path.mjs';
import { readJsonResponseFile, validateResponseFile } from './response-file.mjs';
import { createSellerDeveloperPortal } from './developer-portal.mjs';
import { createSellerLifecycle } from './lifecycle.mjs';
import { createSellerAvailability } from './availability/gate.mjs';
import { validateMaxStreamBytes } from './stream-response.mjs';
import { validateAvailabilityDirectory } from './availability/store.mjs';
import { compileHttpSellerOffer } from './seller.mjs';
import { responseAssetLimits, validateResponseAssetRoute, prepareResponseAssets,
  composeAssetAdmission, compileAssetRouteOffer } from './response-asset.mjs';

const SCHEMA = 'stellar-forge.seller-service.v1';
const HOST = '127.0.0.1';
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const USAGE = `Usage: node serve.mjs --config FILE [--port 8423] [--handlers FILE]
                     [--facilitator HTTPS_URL] [--allow-local-facilitator]
                     [--max-in-flight 64] [--drain-grace-ms 60000] [--request-timeout-ms 120000]
                     [--availability-dir PRIVATE_ABSOLUTE_DIRECTORY]

Without --facilitator the server serves real SF30 payment challenges only.
--handlers loads application functions from a trusted local ESM module.
The listener binds to 127.0.0.1. Use an operator-managed HTTPS proxy for deployment.
Inspect GET /_seller/health and GET /_seller/offers to see the running configuration.
Open /_seller/docs for the developer explorer or /_seller/openapi.json for OpenAPI.
File products: node asset-cli.mjs --help (operator guide: ASSETS.md).`;

function validateConfig(config) {
  if (!object(config) || config.schema !== SCHEMA || !Array.isArray(config.routes) ||
      config.routes.length < 1 || config.routes.length > 64) {
    throw new TypeError('Expected seller-service.v1 config with 1–64 routes');
  }
  validateAdmissionTimeout(config.admissionTimeoutMs ?? 2000);
  validateHandlerTimeout(config.handlerTimeoutMs ?? 30000);
  validateRequestTimeout(config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  if (config.maxRequestBytes!==undefined&&(!Number.isSafeInteger(config.maxRequestBytes)||config.maxRequestBytes<1||config.maxRequestBytes>16*1024*1024)) throw new TypeError('Invalid service request byte limit');
  validateMaxStreamBytes(config.maxStreamBytes);
  responseAssetLimits(config);
  const seen = new Set();
  for (const route of config.routes) {
    if (!object(route) || !/^[A-Za-z0-9_-]{1,64}$/.test(route.id ?? '') ||
        seen.has(route.id) || OWN(route, 'definition') === OWN(route, 'offer') ||
        !(OWN(route, 'offer') ? object(route.offer) : object(route.definition)) ||
        typeof route.path !== 'string' || !/^\/[A-Za-z0-9_.~/:-]*$/.test(route.path) ||
        route.path.startsWith('/_seller/') || route.path.includes('//') ||
        new URL(route.path, 'https://seller.example').pathname !== route.path) {
      throw new TypeError('Each route needs a unique ID, canonical path and SF30 definition or imported offer');
    }
    seen.add(route.id);
    validateInputOption(route);
    if (route.definition && OWN(route.definition, 'url')) throw new TypeError('Use route.path and publicOrigin instead of definition.url');
    if (route.offer) {
      const binding = compileServicePath(route.offer);
      if (!config.publicOrigin || new URL(route.offer.resource.url).origin !== new URL(config.publicOrigin).origin ||
          binding.path !== route.path) {
        throw new TypeError('Compiled offer must exactly match publicOrigin and its exact service path');
      }
    } else if (route.path.includes(':')) {
      throw new TypeError('Dynamic service paths require an imported offer with pathParams schema');
    }
    if (['handler', 'response', 'responseFile', 'responseAsset'].filter(key => OWN(route, key)).length !== 1) {
      throw new TypeError('Each route must choose exactly one handler export, response, responseFile or responseAsset');
    }
    if (OWN(route, 'responseFile')) validateResponseFile(route.responseFile);
    if (OWN(route, 'responseAsset')) validateResponseAssetRoute(route);
    if (OWN(route, 'handler') && !/^[A-Za-z_$][\w$]{0,127}$/.test(route.handler)) {
      throw new TypeError('Invalid application handler export name');
    }
    if (OWN(route, 'admit') && (typeof route.admit !== 'string' ||
        !/^[A-Za-z_$][\w$]{0,127}$/.test(route.admit))) {
      throw new TypeError('Invalid admission export name');
    }
  }
  if (config.publicOrigin !== undefined) {
    const origin = new URL(config.publicOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password ||
        origin.search || origin.hash || origin.pathname !== '/' ||
        origin.origin !== config.publicOrigin.replace(/\/$/, '')) {
      throw new TypeError('publicOrigin must be an HTTPS origin without path or credentials');
    }
  }
  return config;
}

export { validateConfig as validateSellerServiceConfig };

export function resolveSellerConfigPaths(config, path) {
  for (const route of config.routes) {
    if (OWN(route, 'responseFile')) route.responseFile = resolve(dirname(resolve(path)), route.responseFile);
    if (OWN(route, 'responseAsset')) route.responseAsset.file = resolve(dirname(resolve(path)), route.responseAsset.file);
  }
  return config;
}

export async function readSellerConfig(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > 1024 * 1024) throw new TypeError('Config must be a regular JSON file up to 1 MiB');
  const bytes = await readFile(path);
  if (bytes.length > 1024 * 1024) throw new RangeError('Config exceeds 1 MiB');
  const config = validateConfig(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  return resolveSellerConfigPaths(config, path);
}

function facilitatorEndpoint(raw, allowLocal) {
  const url = new URL(raw);
  const local = allowLocal === true && url.protocol === 'http:' && url.hostname === HOST;
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Facilitator requires HTTPS; local HTTP needs --allow-local-facilitator');
  }
  return url.href.replace(/\/$/, '');
}

/** Start one service. An embedding app can supply a nativeFactory for its own facilitator. */
export async function startSellerService({ config, port = 8423, handlers = {},
  nativeFactory = null, maxInFlight = 64, drainGraceMs = 60000, requestTimeoutMs, availabilityDirectory } = {}) {
  validateConfig(config);
  if (availabilityDirectory !== undefined) validateAvailabilityDirectory(availabilityDirectory);
  const totalTimeout = validateRequestTimeout(requestTimeoutMs ?? config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('port must be 0–65535');
  if (!object(handlers) || nativeFactory !== null && typeof nativeFactory !== 'function') {
    throw new TypeError('Invalid handler map or nativeFactory');
  }
  for (const route of config.routes) {
    if (route.handler && (!OWN(handlers, route.handler) || typeof handlers[route.handler] !== 'function')) {
      throw new TypeError(`Application handler export missing: ${route.handler}`);
    }
    if (route.admit && (!OWN(handlers, route.admit) || typeof handlers[route.admit] !== 'function')) {
      throw new TypeError(`Admission export missing: ${route.admit}`);
    }
  }
  const { assets, retainedBytes, maxResponseBytes } = await prepareResponseAssets(config);
  const admissions = new Map(config.routes.map(route => {
    const application = createConfiguredAdmission(route, handlers);
    return [route.id, assets.has(route.id) ? composeAssetAdmission(application) : application];
  }));
  const inputValidation = new Set(config.routes.filter(route => route.validateInput === true).map(route => route.id));
  const fileResponses = new Map();
  for (const route of config.routes) {
    if (!OWN(route, 'responseFile')) continue;
    try {
      fileResponses.set(route.id, (await readJsonResponseFile(route.responseFile)).body);
    } catch (error) {
      throw new Error(`Route ${route.id} responseFile: ${error.message}`, { cause: error });
    }
  }
  let dispatch = (_req, res) => { res.writeHead(503, { 'retry-after': '1' }); res.end(); };
  const server = createServer((req, res) => {
    return Promise.resolve().then(() => dispatch(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      if (!res.writableEnded) res.end('{"error":"SELLER_REQUEST_FAILED"}');
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  const lifecycle = createSellerLifecycle(server, { maxInFlight, drainGraceMs });
  let availability, closing;
  const close = () => closing ??= (async () => {
    const result = await lifecycle.close();
    // Keep the private writer lease while original native work drains. A forced
    // drain failure retains it until process exit.
    await availability?.close();
    return result;
  })();
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(port, HOST, done); });
    const url = `http://${HOST}:${server.address().port}`;
    const origin = config.publicOrigin ? new URL(config.publicOrigin).origin : url;
    const compiled = compileSellerRoutes(config.routes.map(route => ({
      id: route.id,
      maxRequestBytes:route.maxRequestBytes,
      ...(admissions.get(route.id) ? { admit: admissions.get(route.id) } : {}),
      ...(assets.has(route.id) ? { offer: compileAssetRouteOffer(route, origin,
        compileHttpSellerOffer, !config.publicOrigin) } :
        route.offer ? { offer: route.offer } : { definition: { ...route.definition, url: origin + route.path } }),
      handler: assets.has(route.id) ? assets.get(route.id).handler : route.handler ? handlers[route.handler] : async () => ({
        status: 200, headers: { 'content-type': 'application/json' },
        body: fileResponses.has(route.id) ? Buffer.from(fileResponses.get(route.id)) : structuredClone(route.response),
      }),
    })), { allowLocalhost: !config.publicOrigin });
    if (availabilityDirectory !== undefined)
      availability = await createSellerAvailability(compiled, availabilityDirectory);
    const nativeServer = nativeFactory ? await nativeFactory(compiled) : null;
    if (nativeFactory && !nativeServer) throw new TypeError('Native factory did not return a resource server');
    const resources = createSellerResourceHandler({ compiled, nativeServer, maxResponseBytes,
      maxRequestBytes: config.maxRequestBytes ?? 1048576,
      maxStreamBytes: config.maxStreamBytes,
      admissionTimeoutMs: config.admissionTimeoutMs ?? 2000,
      handlerTimeoutMs: config.handlerTimeoutMs ?? 30000, requestTimeoutMs: totalTimeout });
    const mode = nativeServer ? 'NATIVE_X402' : 'CHALLENGE_ONLY';
    const developerPortal = createSellerDeveloperPortal({ compiled, mode });
    const info = { schema: SCHEMA, mode,
      ...(assets.size ? { assetSnapshotBytes: retainedBytes, maxResponseBytes } : {}),
      routes: compiled.routes.map(route => ({
      id: route.id, method: route.method, url: route.offer.resource.url,
      admission: typeof route.admit === 'function',
      inputValidation: inputValidation.has(route.id),
      ...(assets.has(route.id) ? { asset: assets.get(route.id).metadata } : {}),
      ...(route.binding.dynamic ? { routeTemplate: route.path } : {}),
    })) };
    dispatch = (req, res) => {
      if (developerPortal(req, res)) return;
      if (req.url === '/_seller/ready') {
        if (!['GET', 'HEAD'].includes(req.method)) {
          res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return;
        }
        const ready = lifecycle.snapshot();
        const payload = JSON.stringify({ state: ready.state, accepting: ready.accepting });
        res.writeHead(ready.accepting ? 200 : 503, {
          'content-type': 'application/json', 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'content-length': String(Buffer.byteLength(payload)),
        });
        res.end(req.method === 'HEAD' ? undefined : payload);
        return;
      }
      if (req.url === '/_seller/health' || req.url === '/_seller/offers') {
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return; }
        const payload = req.url === '/_seller/health' ?
          { ...info, lifecycle: lifecycle.snapshot(), requestLifetime: resources.lifetimeSnapshot() } : compiled.routes.map(route => route.offer);
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff' });
        res.end(req.method === 'HEAD' ? '' : JSON.stringify(payload));
        return;
      }
      return lifecycle.handle(req, res, () => availability
        ? availability.handle(req, res, () => resources(req, res)) : resources(req, res));
    };
    return { server, url, mode, compiled, lifecycle, close, ...(availability ? { availability } : {}) };
  } catch (error) {
    if (server.listening) await close();
    else await availability?.close();
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return null; }
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (options.has(flag)) throw new TypeError('Duplicate option: ' + flag);
    if (flag === '--allow-local-facilitator') { options.set(flag, true); continue; }
    if (!['--config', '--port', '--handlers', '--facilitator', '--max-in-flight', '--drain-grace-ms', '--request-timeout-ms', '--availability-dir'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new TypeError(USAGE);
    }
    options.set(flag, args[++i]);
  }
  if (!options.has('--config') || options.has('--allow-local-facilitator') && !options.has('--facilitator')) throw new TypeError(USAGE);
  const configPath = resolve(options.get('--config'));
  const config = await readSellerConfig(configPath);
  const portText = options.get('--port') ?? '8423';
  if (!/^\d{1,5}$/.test(portText)) throw new TypeError('port must be 0–65535');
  const handlers = options.has('--handlers') ?
    await import(pathToFileURL(resolve(dirname(configPath), options.get('--handlers'))).href) : {};
  let nativeFactory = null;
  if (options.has('--facilitator')) {
    const url = facilitatorEndpoint(options.get('--facilitator'), options.get('--allow-local-facilitator'));
    const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
      import('@x402/core/server'), import('./native-factory.mjs'),
    ]);
    nativeFactory = compiled => createNativeSellerServer(compiled, {
      facilitatorClient: new HTTPFacilitatorClient({ url }),
    });
  }
  const session = await startSellerService({ config, port: Number(portText), handlers, nativeFactory,
    availabilityDirectory: options.get('--availability-dir'),
    ...(options.has('--request-timeout-ms') ? { requestTimeoutMs: validateRequestTimeout(Number(options.get('--request-timeout-ms'))) } : {}),
    maxInFlight: Number(options.get('--max-in-flight') ?? 64),
    drainGraceMs: Number(options.get('--drain-grace-ms') ?? 60000) });
  process.stdout.write(JSON.stringify({ url: session.url, mode: session.mode,
    health: session.url + '/_seller/health', ready: session.url + '/_seller/ready',
    offers: session.url + '/_seller/offers',
    docs: session.url + '/_seller/docs', openapi: session.url + '/_seller/openapi.json' }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  });
  return session;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exitCode = 1; });
}

