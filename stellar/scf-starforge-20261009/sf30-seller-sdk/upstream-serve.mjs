// MIT. Existing API launcher composed with the original SF30 seller service.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUpstreamBindings, createUpstreamApplication } from './upstream.mjs';
import { validateAvailabilityDirectory } from './availability/store.mjs';

const USAGE = `Usage: node upstream-serve.mjs --config SELLER.json --upstreams BINDINGS.json
  [--port 8423] [--allow-loopback-upstream] [--check]
  [--facilitator HTTPS_URL] [--allow-local-facilitator]
  [--max-in-flight 64] [--drain-grace-ms 60000]
  [--availability-dir PRIVATE_ABSOLUTE_DIRECTORY]

Wrap existing GET/HEAD/DELETE and JSON or multipart POST/PUT/PATCH APIs with the original SF30 payment lifecycle.
Both JSON paths resolve from the current directory. Backend origins are fixed;
credential headers name environment variables, not values in JSON.
--check validates both configs and their route bindings without network/listening.
Without --facilitator, requests return payment challenges and never call a backend.
See UPSTREAM.md for merchant setup, upstream-tls/README.md for client certificates,
UPSTREAM_TRANSPORT.md for named host egress, OAUTH.md for client credentials, and
oauth-connections/README.md for reviewed authorization-code connections.`;

function parse(args) {
  const options = new Map(), switches = new Set(['--allow-loopback-upstream','--allow-local-facilitator','--check']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (options.has(key)) throw new TypeError('Duplicate option: ' + key);
    if (switches.has(key)) { options.set(key,true); continue; }
    if (!['--config','--upstreams','--port','--facilitator','--max-in-flight','--drain-grace-ms','--availability-dir'].includes(key) || !args[i+1] || args[i+1].startsWith('--')) throw new TypeError(USAGE);
    options.set(key,args[++i]);
  }
  if (!options.has('--config') || !options.has('--upstreams') || options.has('--allow-local-facilitator') && !options.has('--facilitator')) throw new TypeError(USAGE);
  const port = options.get('--port') ?? '8423';
  if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) throw new TypeError('port must be 0–65535');
  const maxInFlight = Number(options.get('--max-in-flight') ?? 64);
  const drainGraceMs = Number(options.get('--drain-grace-ms') ?? 60000);
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 1024 ||
      !Number.isSafeInteger(drainGraceMs) || drainGraceMs < 1000 || drainGraceMs > 300000) {
    throw new RangeError('Invalid request capacity or drain grace');
  }
  let facilitator;
  if (options.has('--facilitator')) {
    let url;
    try { url = new URL(options.get('--facilitator')); } catch { throw new TypeError('Invalid facilitator URL'); }
    const local = options.has('--allow-local-facilitator') && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) throw new TypeError('Facilitator requires HTTPS; loopback HTTP needs --allow-local-facilitator');
    facilitator = url.href.replace(/\/$/,'');
  }
  return {configPath:resolve(options.get('--config')), upstreamPath:resolve(options.get('--upstreams')),
    port:Number(port), allowLoopback:options.has('--allow-loopback-upstream'), check:options.has('--check'),
    availabilityDirectory:options.has('--availability-dir') ? validateAvailabilityDirectory(options.get('--availability-dir')) : undefined,
    facilitator, maxInFlight, drainGraceMs};
}

export async function main(args = process.argv.slice(2), {env=process.env}={}) {
  if(env===null||typeof env!=='object'||Array.isArray(env))throw new TypeError('Use the host environment object for the original upstream launcher');
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return null; }
  let options;
  try { options = parse(args); } catch (error) { error.cliMessage = error.message; throw error; }
  // Use the maintained original reader/runtime; no cloned configuration or payment engine.
  const {readSellerConfig,startSellerService} = await import('./serve.mjs');
  let config,bindings,application;
  try {
    [config,bindings] = await Promise.all([readSellerConfig(options.configPath),readUpstreamBindings(options.upstreamPath)]);
    // Capture environment values once for a stable launch-time credential snapshot.
    const environment = {...env};
    application = createUpstreamApplication(config,bindings,{allowLoopback:options.allowLoopback,env:environment,
      deferCredentials:!options.facilitator && !options.check});
    if (options.check) {
      const {compileSellerRoutes} = await import('./resource-server.mjs');
      const origin = config.publicOrigin ? new URL(config.publicOrigin).origin : 'http://127.0.0.1:8423';
      // Compile original offers too; JSON shape alone misses invalid payment metadata.
      // No handler is invoked and no placeholder origin is published by --check.
      compileSellerRoutes(config.routes.map(route => ({id:route.id,
        ...(route.offer ? {offer:route.offer} : {definition:{...route.definition,url:origin+route.path}}),
        handler:route.handler ? application.handlers[route.handler] : () => { throw new Error('Validation does not invoke handlers'); },
      })),{allowLocalhost:!config.publicOrigin});
    }
  } catch (error) {
    error.cliMessage = error instanceof TypeError ? error.message :
      /^UPSTREAM_TLS_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'Cannot read valid seller/upstream JSON files';
    throw error;
  }
  if (options.check) {
    const upstreams = application.snapshot().bindings;
    process.stdout.write(JSON.stringify({status:'CONFIG_VALID',routes:config.routes.length,
      upstreamBindings:upstreams.length,protectedUpstreamBindings:upstreams.filter(row => row.protected).length,
      cachedUpstreamBindings:upstreams.filter(row => row.cache).length,
      oauthUpstreamBindings:upstreams.filter(row => row.oauth2||row.oauthConnection).length,
      tlsUpstreamBindings:upstreams.filter(row => row.tls).length,
      supplierQuotaBindings:upstreams.filter(row => row.supplierAccount).length,
      upstreamTransports:upstreams.filter(row => row.transport).map(row => ({binding:row.name,...row.transport}))}) + '\n');
    await application.close();
    return null;
  }
  let nativeFactory = null;
  if (options.facilitator) {
    const [{HTTPFacilitatorClient},{createNativeSellerServer}] = await Promise.all([
      import('@x402/core/server'),import('./native-factory.mjs'),
    ]);
    nativeFactory = routes => createNativeSellerServer(routes,{
      facilitatorClient:new HTTPFacilitatorClient({url:options.facilitator}),
    });
  }
  let session;
  try {
    session = await startSellerService({config:application.config,port:options.port,
      handlers:application.handlers,nativeFactory,
      availabilityDirectory:options.availabilityDirectory,
      maxInFlight:options.maxInFlight,drainGraceMs:options.drainGraceMs});
  } catch(error) { await application.close(); throw error; }
  session.upstreamSnapshot = application.snapshot;
  if (application.supplierQuotaSnapshot) session.supplierQuotaSnapshot = application.supplierQuotaSnapshot;
  session.operationControl = application.operationControl;
  session.invalidateUpstreamCache = application.invalidateCache;
  session.cacheBinding = application.cacheBinding;
  session.cacheManagement = application.cacheManagement;
  const nativeClose = session.close.bind(session);
  let closing, cleanup;
  const closeApplication = () => cleanup ??= session.lifecycle.whenIdle().then(() => application.close());
  session.close = () => closing ??= (async () => {
    try {
      const result = await nativeClose();
      await closeApplication();
      return result;
    } catch (error) {
      // Preserve the bounded drain failure while late original work still owns
      // its durable records. Its eventual idle signal performs resource cleanup.
      closeApplication().catch(() => {});
      throw error;
    }
  })();
  process.stdout.write(JSON.stringify({url:session.url,mode:session.mode,
    health:session.url + '/_seller/health',ready:session.url + '/_seller/ready',
    offers:session.url + '/_seller/offers',
    upstreamBindings:application.snapshot().bindings.length}) + '\n');
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,() => {
    session.close().then(() => { process.exitCode = 0; },() => { process.exitCode = 1; });
  });
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // File/system/SDK exceptions can contain credentials or private local paths.
    process.stderr.write(typeof error?.cliMessage === 'string' ? error.cliMessage + '\n' : 'UPSTREAM_SELLER_START_FAILED\n');
    process.exitCode = 1;
  });
}
