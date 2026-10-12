// MIT. One local native seller and client-certificate operating journey.
import assert from 'node:assert/strict';
import { createServer, Agent as HttpsAgent } from 'node:https';
import { createServer as createProxyServer } from 'node:http';
import { connect } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { createUpstreamApplication, compileUpstreamBindings, upstreamCredentialReferences } from '../upstream.mjs';
import { createUpstreamHandler, UPSTREAM_ATTEMPT } from '../upstream-handler.mjs';
import { startSellerService } from '../serve.mjs';
import { createNativeSellerServer, NATIVE_SDK_VERSION } from '../native-factory.mjs';
import { stageReleaseUpstreams, inspectReleaseUpstreams } from '../../sf82-seller-pilot/release-upstreams.mjs';
import { loadUpstreamTls, deferUpstreamTls } from './profile.mjs';
import { compileUpstreamTls } from './config.mjs';

const work = await mkdtemp(join(tmpdir(), 'sf30-mtls-'));
let server, session, application, proxy, sharedAgent;
const proxySockets = new Set(); let proxyTunnels = 0;
const observed = [], phases = [];
let nativeVerifies = 0, nativeSettlements = 0;
const openssl = (...args) => {
  const result = spawnSync('openssl', args, { cwd: work, encoding: 'utf8', timeout: 20000 });
  if (result.status !== 0) throw new Error('Local certificate preparation failed: ' + args[0]);
};
const fingerprint = bytes => createHash('sha256').update(new X509Certificate(bytes).raw).digest('hex');
const facade = { schema: 'stellar-forge.seller-service.v1', publicOrigin: 'https://merchant.example',
  routes: [{ id: 'inventory', path: '/inventory', handler: 'inventory', definition: {
    method: 'GET', serviceName: 'Supplier inventory', description: 'Client-authenticated supplier inventory',
    payment: { scheme: 'exact', network: 'stellar:testnet', amount: '20000',
      asset: 'DEMO_NONPAYABLE_ASSET', payTo: 'DEMO_NONPAYABLE_RECIPIENT', maxTimeoutSeconds: 60 },
  } }] };
const facilitatorClient = {
  getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: ['bazaar'], signers: {} }),
  verify: async () => { nativeVerifies++; return { isValid: true, payer: 'LOCAL_TLS_JOURNEY' }; },
  settle: async () => ({ success: true, network: 'stellar:testnet', payer: 'LOCAL_TLS_JOURNEY', transaction: 'LOCAL_TLS_' + ++nativeSettlements }),
};
const closeSeller = async () => {
  await session?.close(); session = undefined;
  await application?.close(); application = undefined;
};
const start = async (bindings, env, { deferCredentials = false } = {}) => {
  application = createUpstreamApplication(facade, bindings, { allowLoopback: true, env, deferCredentials });
  session = await startSellerService({ config: application.config, handlers: application.handlers, port: 0,
    nativeFactory: compiled => createNativeSellerServer(compiled, { facilitatorClient }) });
};
const buy = async () => {
  const unsigned = await fetch(session.url + '/inventory');
  assert.equal(unsigned.status, 402);
  const challenge = JSON.parse(Buffer.from(unsigned.headers.get('payment-required'), 'base64'));
  await unsigned.arrayBuffer();
  const response = await fetch(session.url + '/inventory', { headers: { 'payment-signature': encodePaymentSignatureHeader({
    x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], extensions: challenge.extensions,
    payload: { localClientCertificateJourney: true },
  }) } });
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('payment-response'));
  return response.json();
};
const context = () => ({ method: 'GET', url: new URL('https://merchant.example/inventory'), headers: {}, body: null });

try {
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=SF30 Local Journey CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', 'ca.key', '-out', 'ca.crt');
  for (const [name, serial, usage] of [['server', '1', 'serverAuth'], ['client-one', '2', 'clientAuth'], ['client-two', '3', 'clientAuth']]) {
    openssl('req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=' + name, '-keyout', name + '.key', '-out', name + '.csr');
    await writeFile(join(work, name + '.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=' + usage +
      (name === 'server' ? '\nsubjectAltName=IP:127.0.0.1\n' : '\n'), { mode: 0o600 });
    openssl('x509', '-req', '-in', name + '.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-set_serial', serial,
      '-days', '2', '-extfile', name + '.ext', '-out', name + '.crt');
    await chmod(join(work, name + '.key'), 0o600);
  }
  openssl('pkcs12', '-export', '-inkey', 'client-one.key', '-in', 'client-one.crt', '-certfile', 'ca.crt',
    '-passout', 'pass:local-journey-password', '-out', 'client.p12');
  await chmod(join(work, 'client.p12'), 0o600);
  const firstFingerprint = fingerprint(await readFile(join(work, 'client-one.crt')));
  const secondFingerprint = fingerprint(await readFile(join(work, 'client-two.crt')));
  server = createServer({ key: await readFile(join(work, 'server.key')), cert: await readFile(join(work, 'server.crt')),
    ca: await readFile(join(work, 'ca.crt')), requestCert: true, rejectUnauthorized: true }, (request, response) => {
    assert.equal(request.socket.authorized, true);
    const peer = request.socket.getPeerX509Certificate();
    const identity = createHash('sha256').update(peer.raw).digest('hex');
    observed.push({ path: request.url, identity });
    response.setHeader('content-type', request.url === '/stream' ? 'application/x-ndjson' : 'application/json');
    response.setHeader('cache-control', 'public, max-age=60');
    response.end(JSON.stringify({ identity, record: 'supplier-inventory', quantity: 17 }) + (request.url === '/stream' ? '\n' : ''));
  });
  server.on('tlsClientError', () => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'https://127.0.0.1:' + server.address().port;
  proxy = createProxyServer((_request,response) => { response.writeHead(405); response.end(); });
  proxy.on('connect', (request, downstream, head) => {
    if (request.url !== '127.0.0.1:' + server.address().port) { downstream.destroy(); return; }
    const upstream = connect(server.address().port, '127.0.0.1');
    for (const socket of [downstream, upstream]) {
      proxySockets.add(socket); socket.on('close', () => proxySockets.delete(socket));
    }
    downstream.on('error', () => upstream.destroy());
    upstream.on('error', () => downstream.destroy());
    downstream.on('close', () => upstream.destroy());
    upstream.on('close', () => downstream.destroy());
    upstream.once('connect', () => {
      proxyTunnels++;
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      downstream.pipe(upstream); upstream.pipe(downstream);
    });
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const env = { MTLS_PROXY: 'http://127.0.0.1:' + proxy.address().port, MTLS_CA_FILE: join(work, 'ca.crt'), MTLS_CERT_FILE: join(work, 'client-one.crt'),
    MTLS_KEY_FILE: join(work, 'client-one.key'), MTLS_PFX_FILE: join(work, 'client.p12'), MTLS_PASSWORD: 'local-journey-password' };
  const tls = { caFileEnv: 'MTLS_CA_FILE', certFileEnv: 'MTLS_CERT_FILE', keyFileEnv: 'MTLS_KEY_FILE' };
  const bindings = { schema: 'stellar-forge.seller-upstreams.v1',
    transports: { source: { mode: 'environment-proxy', proxyEnv: 'MTLS_PROXY' } }, bindings: { inventory: {
    origin, path: '/inventory', tls, transport: 'source', cache: { shareAcrossBuyers: true, ttlMs: 60000, maxEntries: 8, maxBytes: 65536,
      maxEntryBytes: 8192, maxSourceInFlight: 4, maxWaiters: 8, sourceTimeoutMs: 10000 },
  } } };
  const references = upstreamCredentialReferences(bindings);
  assert.deepEqual(references, ['MTLS_CA_FILE', 'MTLS_CERT_FILE', 'MTLS_KEY_FILE', 'MTLS_PROXY']);
  compileUpstreamBindings(bindings, { allowLoopback: true, env: {} });
  assert.throws(() => compileUpstreamBindings(bindings, { env: {} }), /public HTTPS/);
  assert.throws(() => compileUpstreamTls({ ...tls, rejectUnauthorized: false }));
  assert.throws(() => loadUpstreamTls(tls, { env: { ...env, MTLS_KEY_FILE: join(work, 'client-two.key') }, origin }),
    { code: 'UPSTREAM_TLS_KEY_CERTIFICATE_MISMATCH' });
  const loaded = loadUpstreamTls(tls, { env, origin });
  assert.equal(loaded.snapshot().certificate.sha256, firstFingerprint);
  assert.ok(!JSON.stringify(loaded).includes(work));
  const unavailable = createUpstreamHandler({ baseUrl: origin, path: '/unavailable', tls: deferUpstreamTls(tls, { env: {}, origin }) });
  const refused = await unavailable(context());
  assert.equal(refused.status, 503); assert.equal(refused[UPSTREAM_ATTEMPT].dispatched, false);
  assert.equal(observed.length, 0);
  phases.push('reference review and local identity inspection');

  const store = join(work, 'release'); await mkdir(store, { mode: 0o700 });
  const input = join(work, 'upstreams.json'); await writeFile(input, JSON.stringify(bindings), { mode: 0o600 });
  const retained = await stageReleaseUpstreams(store, input, facade, { allowLoopback: true });
  const review = await inspectReleaseUpstreams(store, retained, facade, { allowLoopback: true });
  assert.deepEqual(review.bindings.inventory.tls, tls);
  assert.deepEqual(review.environment, references);
  assert.equal(review.credentialValuesChecked, false);
  assert.ok(!(await readFile(join(store, retained.file), 'utf8')).includes(work));
  await unlink(input);

  application = createUpstreamApplication(facade, bindings, { allowLoopback: true, env: { MTLS_PROXY: env.MTLS_PROXY }, deferCredentials: true });
  session = await startSellerService({ config: application.config, handlers: application.handlers, port: 0 });
  const preview = await fetch(session.url + '/inventory');
  assert.equal(preview.status, 402); await preview.arrayBuffer();
  assert.equal(application.snapshot().bindings[0].tls.state, 'DEFERRED');
  assert.equal(observed.length, 0);
  await closeSeller();
  phases.push('challenge-only receiving with absent certificate environment');

  await start(bindings, env, { deferCredentials: true });
  assert.equal(application.snapshot().bindings[0].tls.state, 'DEFERRED');
  const unpaid = await fetch(session.url + '/inventory'); assert.equal(unpaid.status, 402); await unpaid.arrayBuffer();
  assert.equal(observed.length, 0);
  assert.equal((await buy()).identity, firstFingerprint);
  assert.equal((await buy()).identity, firstFingerprint);
  assert.equal(observed.length, 1);
  assert.equal(application.snapshot().bindings[0].tls.certificate.sha256, firstFingerprint);
  assert.equal(proxyTunnels, 1);
  assert.equal(application.snapshot().bindings[0].transport.profile, 'source');
  assert.equal(application.cacheBinding.inspect('inventory').inventory.policy.ttlMs, 60000);
  phases.push('original native seller, named host proxy, authenticated supplier and managed paid cache reuse');

  sharedAgent = new HttpsAgent({ keepAlive: true, maxSockets: 1, maxCachedSessions: 10 });
  const secondIdentity = loadUpstreamTls(tls, { env: { ...env,
    MTLS_CERT_FILE: join(work, 'client-two.crt'), MTLS_KEY_FILE: join(work, 'client-two.key') }, origin });
  for (const [path, profile, identity] of [
    ['/pooled-first', loaded, firstFingerprint], ['/pooled-second', secondIdentity, secondFingerprint],
  ]) {
    const pooled = createUpstreamHandler({ baseUrl: origin, path, tls: profile, agent: sharedAgent });
    assert.equal(JSON.parse((await pooled(context())).body).identity, identity);
  }
  phases.push('distinct certificate identities on one shared native HTTPS agent');

  const stream = createUpstreamHandler({ baseUrl: origin, path: '/stream', responseType: 'ndjson', tls: loaded, agent: sharedAgent });
  const output = await stream(context()); assert.equal(output.status, 200);
  const chunks = []; for await (const chunk of output.stream.body) chunks.push(Buffer.from(chunk));
  assert.equal(JSON.parse(Buffer.concat(chunks)).identity, firstFingerprint);
  await output.stream.close();
  assert.equal(stream.snapshot().inFlight, 0);
  phases.push('original NDJSON transport with native client authentication');

  const pfx = loadUpstreamTls({ pfxFileEnv: 'MTLS_PFX_FILE', passphraseEnv: 'MTLS_PASSWORD', caFileEnv: 'MTLS_CA_FILE' }, { env, origin });
  assert.equal(pfx.snapshot().authentication, 'PKCS12');
  const pfxHandler = createUpstreamHandler({ baseUrl: origin, path: '/pfx', tls: pfx });
  assert.equal(JSON.parse((await pfxHandler(context())).body).identity, firstFingerprint);
  const withoutIdentity = loadUpstreamTls({ caFileEnv: 'MTLS_CA_FILE' }, { env, origin });
  const unauthenticated = createUpstreamHandler({ baseUrl: origin, path: '/missing-client', tls: withoutIdentity });
  assert.equal((await unauthenticated(context())).status, 502);
  const wrongName = createUpstreamHandler({ baseUrl: origin.replace('127.0.0.1', 'localhost'), path: '/wrong-name', tls: loaded,
    lookup(_host, options, callback) { if (options?.all) callback(null, [{ address: '127.0.0.1', family: 4 }]); else callback(null, '127.0.0.1', 4); } });
  assert.equal((await wrongName(context())).status, 502);
  assert.ok(!observed.some(row => ['/missing-client', '/wrong-name'].includes(row.path)));
  phases.push('PKCS12 authentication and certificate/hostname refusal');

  env.MTLS_CERT_FILE = join(work, 'client-two.crt'); env.MTLS_KEY_FILE = join(work, 'client-two.key');
  assert.equal(loadUpstreamTls(tls, { env, origin }).snapshot().certificate.sha256, secondFingerprint);
  assert.equal(application.snapshot().bindings[0].tls.certificate.sha256, firstFingerprint);
  await closeSeller();
  const reopened = JSON.parse(await readFile(join(store, retained.file), 'utf8'));
  await start(reopened, env);
  assert.equal((await buy()).identity, secondFingerprint);
  assert.equal(application.snapshot().bindings[0].tls.certificate.sha256, secondFingerprint);
  assert.deepEqual(observed.filter(row => row.path === '/inventory').map(row => row.identity), [firstFingerprint, secondFingerprint]);
  phases.push('retained release reopen with explicit credential rotation');
  assert.equal(nativeVerifies, 3); assert.equal(nativeSettlements, 3);
  assert.equal(proxyTunnels, 2); assert.equal(observed.length, 6);
  console.log(JSON.stringify({ result: 'PASS', nativeSdk: NATIVE_SDK_VERSION, nativeVerifies, nativeSettlements,
    authenticatedSupplierCalls: observed.length, clientCertificateGenerations: 2, proxyTunnels, phases }));
} finally {
  await closeSeller();
  sharedAgent?.destroy();
  for (const socket of proxySockets) socket.destroy();
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(work, { recursive: true, force: true });
}
