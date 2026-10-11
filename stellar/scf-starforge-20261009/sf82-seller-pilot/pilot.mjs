#!/usr/bin/env node
// MIT. One operator command, using the ORIGINAL SF61 importer and SF30 seller service.
// No new payment middleware, application, HTTP router, or facilitator is implemented.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = `SF82: import an existing OpenAPI seller and launch its native SF30 HTTP service.
Usage: node pilot.mjs --spec OPENAPI_JSON --config SELECTIONS_JSON \\
  --bindings ROUTE_BINDINGS_JSON --out NEW_DIRECTORY \\
  [--handlers TRUSTED_ESM] [--facilitator HTTPS_URL] [--port 8423]
  [--allow-local-facilitator]

The directory must not exist. Without --facilitator, the real HTTP service
advertises 402 challenges only. --handlers is your trusted existing application.
The service listens on 127.0.0.1; deploy with your own HTTPS reverse proxy.
The SF61 original compiler, SF30 original server, payment gates and checks run
unchanged. No wallet, checkout, settlement or registration is created here.`;

const VALUE_OPTIONS = new Set(['--spec', '--config', '--bindings', '--out',
  '--handlers', '--facilitator', '--port']);
const REQUIRED = ['--spec', '--config', '--bindings', '--out'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function optionsFrom(args) {
  if (args.length === 1 && args[0] === '--help') return null;
  const opt = new Map();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (opt.has(flag)) throw new TypeError(`Duplicate ${flag}\n${USAGE}`);
    if (flag === '--allow-local-facilitator') { opt.set(flag, true); continue; }
    if (!VALUE_OPTIONS.has(flag) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new TypeError(USAGE);
    opt.set(flag, args[++i]);
  }
  if (!REQUIRED.every(flag => opt.has(flag)) ||
      (opt.has('--allow-local-facilitator') && !opt.has('--facilitator')))
    throw new TypeError(USAGE);
  return opt;
}
function offersDigest(offers) {
  if (!Array.isArray(offers) || offers.length === 0) throw new TypeError('No seller offers');
  const normalized = offers.map(offer => {
    if (!offer || !offer.resource || typeof offer.resource.url !== 'string' ||
        typeof offer?.extensions?.bazaar?.info?.input?.method !== 'string')
      throw new TypeError('Invalid original seller offer');
    return JSON.stringify(offer);
  }).sort();
  return hash(Buffer.from(normalized.join('\n')));
}

/** Compile and launch unchanged original modules, then read back their real listener. */
export async function launch(args = process.argv.slice(2), deps = {}) {
  const opts = optionsFrom(args);
  if (!opts) { process.stdout.write(USAGE + '\n'); return null; }
  const out = resolve(opts.get('--out'));
  const srcArgs = ['--spec', resolve(opts.get('--spec')),
    '--config', resolve(opts.get('--config')), '--service-bindings', resolve(opts.get('--bindings')),
    '--out', out];
  // Injection is for command integration in other operator applications;
  // the normal executable always imports the source modules themselves.
  const compile = deps.compile ?? (await import('../sf61-openapi-seller-import/cli.mjs')).run;
  const serve = deps.serve ?? (await import('../sf30-seller-sdk/serve.mjs')).main;
  // Exact SF61 validation and original atomic-no-clobber export.
  const manifest = await compile(srcArgs);
  if (!manifest || typeof manifest.offersSha256 !== 'string' ||
      typeof manifest.serviceConfigSha256 !== 'string')
    throw new TypeError('Original seller importer returned no complete service manifest');
  const serveArgs = ['--config', join(out, 'seller-service.json')];
  if (opts.has('--port')) serveArgs.push('--port', opts.get('--port'));
  if (opts.has('--handlers')) serveArgs.push('--handlers', resolve(opts.get('--handlers')));
  if (opts.has('--facilitator')) serveArgs.push('--facilitator', opts.get('--facilitator'));
  if (opts.has('--allow-local-facilitator')) serveArgs.push('--allow-local-facilitator');

  const session = await serve(serveArgs);
  try {
    if (!session || typeof session.url !== 'string' || typeof session.close !== 'function')
      throw new TypeError('Original seller runtime returned no live session');
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(session.url))
      throw new TypeError('Original seller runtime did not report loopback-only listener');
    const [healthResponse, offersResponse] = await Promise.all([
      fetch(session.url + '/_seller/health', { signal: AbortSignal.timeout(4000) }),
      fetch(session.url + '/_seller/offers', { signal: AbortSignal.timeout(4000) }),
    ]);
    if (!healthResponse.ok || !offersResponse.ok) throw new Error('Native seller readback failed');
    const [health, servedOffers, originalBytes] = await Promise.all([
      healthResponse.json(), offersResponse.json(), readFile(join(out, 'offers.json')),
    ]);
    const originalOffers = JSON.parse(originalBytes.toString('utf8'));
    if (hash(originalBytes) !== manifest.offersSha256 ||
        !Array.isArray(originalOffers.offers) ||
        health?.schema !== 'stellar-forge.seller-service.v1' ||
        health?.mode !== (opts.has('--facilitator') ? 'NATIVE_X402' : 'CHALLENGE_ONLY') ||
        !Array.isArray(health.routes) || health.routes.length !== originalOffers.offers.length ||
        offersDigest(originalOffers.offers.map(o => o.seller)) !== offersDigest(servedOffers))
      throw new Error('Compiled source / running original offers diverged');

    // This file is an operational readback, not payment, customer, chain, or grant proof.
    const receipt = {
      schema: 'stellar-forge.seller-pilot-readiness.v1',
      observedAt: new Date().toISOString(),
      originalOffersSha256: manifest.offersSha256,
      originalServiceConfigSha256: manifest.serviceConfigSha256,
      nativeOfferDigestSha256: offersDigest(servedOffers),
      runtimeMode: health.mode, routeCount: health.routes.length,
      listener: session.url, healthEndpoint: session.url + '/_seller/health',
      offersEndpoint: session.url + '/_seller/offers',
      paidRequestsSent: 0, settlementVerified: false, buyerAdoptionVerified: false,
    };
    await writeFile(join(out, 'runtime-readiness.json'), JSON.stringify(receipt, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ pilotReady: true, ...receipt, output: out }) + '\n');
    return session;
  } catch (error) {
    await session?.close?.().catch(() => {});
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  launch().catch(error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exitCode = 1; });
}