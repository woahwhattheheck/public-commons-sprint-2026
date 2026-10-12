#!/usr/bin/env node
// MIT. One host-owned continuation of the original NocoDB receiving operation.
// Original SF88, SF81, SF36, SF43, SF82 and SF30 own purchase, consent, accounting,
// chain observations, release selection and dataset delivery.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { readFile, open, mkdir, lstat, realpath, rename, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { createServer as netServer, connect } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const HASH = /^[a-f0-9]{64}$/;
const SCF = 'stellar/scf-starforge-20261009';
const SDK = SCF + '/sf30-seller-sdk';
const RELEASE = SCF + '/sf82-seller-pilot';
const BUYER = SCF + '/sf88-operator-buyer-cli';
const RPC = 'https://soroban-testnet.stellar.org';
const HORIZON = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const NETWORK = 'stellar:testnet';
const PAYER_ENV = 'NOCODB_RECEIVING_PAYER_SECRET';
const MERCHANT_ENV = 'NOCODB_RECEIVING_MERCHANT_SECRET';
const PROXY_ENV = 'NOCODB_RECEIVING_HTTPS_PROXY';
const LOCK_ENV = 'NOCODB_RECEIVING_LEASE_FD';
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const time = () => new Date().toISOString();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message = code) => Object.assign(new Error(message), { code });
const requireValue = (value, code, message) => { if (!value) throw fail(code, message); };
const abs = (value, name) => {
  requireValue(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    !/[\0\r\n]/.test(value), 'ABSOLUTE_PRIVATE_PATH_REQUIRED', name);
  return value;
};
const contains = (parent, child) => {
  const value = relative(parent, child);
  return value === '' || !isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep);
};
async function privateDirectory(path, create = false) {
  if (create) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const info = await lstat(path);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && !(info.mode & 0o077) &&
    await realpath(path) === path, 'PRIVATE_DIRECTORY_REQUIRED', path);
}
async function privateBytes(path, optional = false, maximum = 16 * 1024 * 1024) {
  let file;
  try { file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  try {
    const info = await file.stat();
    requireValue(info.isFile() && info.nlink === 1 && !(info.mode & 0o077) && info.size <= maximum,
      'PRIVATE_REGULAR_FILE_REQUIRED', path);
    const bytes = await file.readFile();
    requireValue(bytes.length <= maximum, 'PRIVATE_FILE_LIMIT_EXCEEDED', path);
    return bytes;
  } finally { await file.close(); }
}
async function readJson(path, optional = false) {
  const bytes = await privateBytes(path, optional);
  return bytes === null ? null : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
async function saveBytes(path, bytes, { createOnly = false } = {}) {
  await privateDirectory(dirname(path));
  const temporary = path + '.' + randomUUID() + '.partial';
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY |
    (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  if (createOnly) {
    // The inherited kernel operation lease serializes these owned private names.
    // Publish complete bytes atomically; an existing retained record is never replaced.
    try { await lstat(path); throw fail('RETAINED_OPERATION_RECORD_EXISTS', path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(temporary, path);
  } else {
    const old = await privateBytes(path, true);
    if (old !== null) requireValue(!(await lstat(path)).isSymbolicLink(), 'PRIVATE_TARGET_CHANGED');
    await rename(temporary, path);
  }
  const parent = await open(dirname(path), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}
const save = (path, value, options) => saveBytes(path, jsonBytes(value), options);
async function retain(path, value) {
  const bytes = jsonBytes(value), previous = await privateBytes(path, true);
  if (previous) assert.deepEqual(previous, bytes, 'Retained operation input changed: ' + path);
  else await saveBytes(path, bytes, { createOnly: true });
  return { file: path, sha256: hash(bytes), bytes: bytes.length };
}
async function waitFor(action, code, milliseconds = 120000) {
  const deadline = Date.now() + milliseconds;
  do {
    const result = await action(); if (result) return result;
    await new Promise(done => setTimeout(done, 250));
  } while (Date.now() < deadline);
  throw fail(code);
}
async function availablePort() {
  const server = netServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  return port;
}
async function checkedSource(template) {
  const root = abs(template.sourceRoot, 'sourceRoot');
  const manifestBytes = await readFile(abs(template.sourceManifest.file, 'sourceManifest.file'));
  assert.equal(hash(manifestBytes), template.sourceManifest.sha256);
  const manifest = JSON.parse(manifestBytes), selected = new Set();
  requireValue(Array.isArray(manifest.files) && manifest.files.length, 'SOURCE_MANIFEST_REQUIRED');
  for (const item of manifest.files) {
    requireValue(typeof item.path === 'string' && !isAbsolute(item.path) && HASH.test(item.sha256),
      'SOURCE_MANIFEST_ENTRY_INVALID');
    const file = resolve(root, item.path), canonical = relative(root, file).split(sep).join('/');
    requireValue(contains(root, file) && canonical === item.path && !selected.has(canonical),
      'SOURCE_MANIFEST_PATH_INVALID');
    selected.add(canonical);
    assert.equal(hash(await readFile(file)), item.sha256, 'Executed original source: ' + canonical);
  }
  const required = [
    SCF + '/native-facilitator/runtime.mjs', SCF + '/native-facilitator/server.mjs',
    RELEASE + '/release-facilitator.mjs', RELEASE + '/release-console.mjs', RELEASE + '/releases.mjs',
    BUYER + '/workspace.mjs', BUYER + '/execute.mjs', BUYER + '/dataset-session.mjs',
    SCF + '/sf81-buyer-operator-bridge/browser-approval.mjs',
    SCF + '/sf43-agent-commerce/verify.mjs', SCF + '/sf82-checkout-evidence/evidence.mjs',
    SDK + '/dataset-refresh/buyer-handoff.mjs', SDK + '/dataset-refresh/service.mjs',
    SDK + '/nocodb/receiving/native-consumer.mjs', SDK + '/nocodb/receiving/testnet-consumer.mjs',
    SDK + '/nocodb/receiving/applications-consumer.mjs',
    SCF + '/distribution/runtime-workspace/applications.mjs',
    SCF + '/distribution/runtime-workspace/application-nocodb.mjs',
    SCF + '/distribution/runtime-workspace/application-command.mjs',
  ];
  for (const path of required) requireValue(selected.has(path), 'ORIGINAL_NATIVE_SOURCE_MISSING', path);
  return { root, manifest, files: selected.size, manifestSha256: template.sourceManifest.sha256 };
}
async function loadInput(path) {
  abs(path, 'input');
  const raw = await privateBytes(path), input = JSON.parse(raw);
  requireValue(input.schema === 'stellar-forge.nocodb-testnet-receiving-input.v1' &&
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.operationId ?? ''), 'TESTNET_RECEIVING_INPUT_INVALID');
  requireValue(input.authorization?.network === NETWORK &&
    input.authorization?.purpose === 'NOCODB_RECEIVING' && input.authorization?.maxPages === 4 &&
    /^[1-9][0-9]{0,8}$/.test(input.authorization?.maxTotalAtomic ?? ''), 'EXPLICIT_TESTNET_AUTHORIZATION_REQUIRED');
  assert.equal(hash(await readFile(SELF)), input.consumerSha256, 'Exact testnet consumer selection.');
  const templateBytes = await privateBytes(abs(input.receivingInput.file, 'receivingInput.file'));
  assert.equal(hash(templateBytes), input.receivingInput.sha256, 'Exact core receiving template.');
  const template = JSON.parse(templateBytes);
  requireValue(template.schema === 'stellar-forge.nocodb-native-receiving-input.v1' &&
    template.operationId === input.operationId, 'ORIGINAL_RECEIVING_INPUT_REQUIRED');
  const output = abs(input.outputDirectory, 'outputDirectory');
  requireValue(!contains(template.sourceRoot, output) && !contains(output, template.sourceRoot),
    'KEEP_PRIVATE_STATE_OUTSIDE_PUBLIC_SOURCE');
  const origin = new URL(template.merchant.origin);
  requireValue(origin.protocol === 'https:' && origin.origin === template.merchant.origin &&
    !origin.port && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.test$/.test(origin.hostname),
    'OWNED_TEST_HTTPS_ORIGIN_REQUIRED');
  requireValue(template.merchant.payment.network === NETWORK &&
    template.merchant.payment.scheme === 'exact' &&
    /^[1-9][0-9]{0,7}$/.test(template.merchant.payment.amount) &&
    /^[1-9][0-9]{0,7}$/.test(template.merchant.nextAmount) &&
    BigInt(input.authorization.maxTotalAtomic) === 4n * BigInt(template.merchant.nextAmount),
    'EXACT_FOUR_PAGE_TESTNET_CAP_REQUIRED');
  requireValue(Number.isSafeInteger(template.merchant.payment.maxTimeoutSeconds) &&
    template.merchant.payment.maxTimeoutSeconds >= 1 && template.merchant.payment.maxTimeoutSeconds <= 120,
    'EXPLICIT_PAYMENT_TIMEOUT_REQUIRED');
  abs(input.python, 'python'); abs(input.openssl, 'openssl');
  abs(input.applications?.runtimeDirectory, 'applications.runtimeDirectory');
  requireValue(process.platform !== 'win32', 'POSIX_NATIVE_HOST_REQUIRED');
  requireValue(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'VERIFIED_TLS_REQUIRED');
  return { input, inputFile: path, inputSha256: hash(raw), template, templateBytes, output, origin };
}

// Hold one kernel-owned lease for account setup and every child phase. No PID
// guesses, stale lock deletion, second native operation, or account rotation.
const PYTHON_LEASE = String.raw`import fcntl, os, stat, sys
lock, node, script, input_path = sys.argv[1:]
fd = os.open(lock, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
s = os.fstat(fd)
if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_mode & 0o077:
    raise SystemExit("PRIVATE_OPERATION_LEASE_REQUIRED")
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit("ORIGINAL_RECEIVING_OPERATION_ACTIVE")
os.set_inheritable(fd, True)
os.environ["NOCODB_RECEIVING_LEASE_FD"] = str(fd)
os.execv(node, [node, script, "--locked-input", input_path])
`;
function subprocess(command, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, options);
    const forward = signal => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
    const term = () => forward('SIGTERM'), interrupt = () => forward('SIGINT');
    process.on('SIGTERM', term); process.on('SIGINT', interrupt);
    child.once('error', error => {
      process.off('SIGTERM', term); process.off('SIGINT', interrupt); reject(error);
    });
    child.once('exit', (code, signal) => {
      process.off('SIGTERM', term); process.off('SIGINT', interrupt);
      done({ code, signal });
    });
  });
}
async function leaseDescriptor(output) {
  const number = Number(process.env[LOCK_ENV]);
  requireValue(Number.isSafeInteger(number) && number >= 3, 'ORIGINAL_OPERATION_LEASE_REQUIRED');
  const { fstatSync } = await import('node:fs');
  const inherited = fstatSync(number), saved = await lstat(join(output, 'operation.lock'));
  requireValue(inherited.isFile() && inherited.dev === saved.dev && inherited.ino === saved.ino &&
    !(inherited.mode & 0o077), 'ORIGINAL_OPERATION_LEASE_CHANGED');
  return number;
}
async function runChild(ctx, mode, logName, extraEnvironment = {}) {
  const descriptor = await leaseDescriptor(ctx.output);
  const log = await open(join(ctx.output, logName), 'a', 0o600);
  try {
    const result = await subprocess(process.execPath,
      ['--use-system-ca', SELF, mode, ctx.inputFile], {
        env: { ...process.env, ...extraEnvironment, [LOCK_ENV]: '3', NODE_TLS_REJECT_UNAUTHORIZED: '1' },
        stdio: ['ignore', log.fd, log.fd, descriptor],
      });
    requireValue(result.code === 0, 'ORIGINAL_RECEIVING_CHILD_NOT_COMPLETE',
      'Inspect the retained same-operation ' + logName + ' and native result before continuation.');
  } finally { await log.close(); }
}
async function accountObservation(address) {
  const response = await fetch(HORIZON + '/accounts/' + address,
    { redirect: 'error', signal: AbortSignal.timeout(30000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status === 404) return null;
  requireValue(response.status === 200, 'TESTNET_ACCOUNT_READ_FAILED');
  const value = JSON.parse(bytes);
  requireValue(value.account_id === address && Array.isArray(value.balances), 'TESTNET_ACCOUNT_IDENTITY_CHANGED');
  return { address, observedAt: time(), responseSha256: hash(bytes), responseBytes: bytes.length,
    ledger: value.last_modified_ledger, sequence: value.sequence,
    nativeBalance: value.balances.find(item => item.asset_type === 'native')?.balance ?? null };
}
async function prepareAccounts(ctx, nativeSdk, intent) {
  const path = join(ctx.output, 'dedicated-testnet-accounts.private.json');
  let accounts = await readJson(path, true);
  if (!accounts) {
    const payer = nativeSdk.Keypair.random(), merchant = nativeSdk.Keypair.random();
    accounts = { schema: 'stellar-forge.nocodb-dedicated-testnet-accounts.v1',
      operationId: ctx.input.operationId, createdAt: time(), network: NETWORK,
      payer: { address: payer.publicKey(), secret: payer.secret() },
      merchant: { address: merchant.publicKey(), secret: merchant.secret() } };
    await save(path, accounts, { createOnly: true });
  }
  requireValue(accounts.schema === 'stellar-forge.nocodb-dedicated-testnet-accounts.v1' &&
    accounts.operationId === ctx.input.operationId && accounts.network === NETWORK &&
    accounts.payer.address !== accounts.merchant.address, 'DEDICATED_ACCOUNT_BINDING_CHANGED');
  for (const role of ['payer', 'merchant']) {
    assert.equal(nativeSdk.Keypair.fromSecret(accounts[role].secret).publicKey(), accounts[role].address);
    intent.funding ??= {};
    if (intent.funding[role]) {
      assert.equal(intent.funding[role].address, accounts[role].address);
      if (intent.funding[role].state === 'ACCOUNT_OBSERVED') continue;
    }
    let observed = await accountObservation(accounts[role].address);
    if (!observed && !intent.funding[role]) {
      intent.funding[role] = { address: accounts[role].address, state: 'DISPATCHED', requestedAt: time() };
      await save(join(ctx.output, 'intent.json'), intent); // before the state-changing free faucet GET
      try {
        const response = await fetch(FRIENDBOT + '/?addr=' + encodeURIComponent(accounts[role].address),
          { redirect: 'error', signal: AbortSignal.timeout(90000) });
        const bytes = Buffer.from(await response.arrayBuffer());
        await saveBytes(join(ctx.output, role + '-original-friendbot-response.json'), bytes);
        Object.assign(intent.funding[role], { responseAt: time(), httpStatus: response.status,
          responseSha256: hash(bytes), responseBytes: bytes.length });
        await save(join(ctx.output, 'intent.json'), intent);
      } catch (error) {
        intent.funding[role].observation = 'FUNDING_RESPONSE_UNRESOLVED';
        await save(join(ctx.output, 'intent.json'), intent);
      }
    }
    if (!observed) observed = await waitFor(() => accountObservation(accounts[role].address),
      'FUNDING_RESPONSE_UNRESOLVED_KEEP_SAME_ACCOUNTS', 120000);
    intent.funding[role] = { ...intent.funding[role], address: accounts[role].address,
      state: 'ACCOUNT_OBSERVED', observed };
    await save(join(ctx.output, 'intent.json'), intent);
  }
  return accounts;
}
async function openssl(ctx, args, logFile) {
  const log = await open(logFile, 'a', 0o600);
  try {
    const result = await subprocess(ctx.input.openssl, args, {
      env: process.env, stdio: ['ignore', log.fd, log.fd],
    });
    requireValue(result.code === 0, 'OWNED_TLS_CERTIFICATE_SETUP_FAILED');
  } finally { await log.close(); }
}
async function prepareTls(ctx) {
  const directory = join(ctx.output, 'tls'); await privateDirectory(directory, true);
  const manifestFile = join(directory, 'manifest.json');
  let manifest = await readJson(manifestFile, true);
  if (!manifest) {
    const generation = 'generation-' + randomUUID(), selected = join(directory, generation);
    await privateDirectory(selected, true);
    const config = [
      '[req]', 'distinguished_name=dn', 'prompt=no', '[dn]', 'CN=' + ctx.origin.hostname,
      '[server]', 'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth', 'subjectAltName=DNS:' + ctx.origin.hostname, '',
    ].join('\n');
    await saveBytes(join(selected, 'server.cnf'), Buffer.from(config));
    const log = join(selected, 'openssl.log');
    await openssl(ctx, ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '30', '-nodes',
      '-subj', '/CN=NocoDB receiving private ingress CA', '-keyout', join(selected, 'ca-key.pem'),
      '-out', join(selected, 'ca.pem'), '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], log);
    await openssl(ctx, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
      '-config', join(selected, 'server.cnf'), '-keyout', join(selected, 'server-key.pem'),
      '-out', join(selected, 'server.csr')], log);
    await openssl(ctx, ['x509', '-req', '-in', join(selected, 'server.csr'),
      '-CA', join(selected, 'ca.pem'), '-CAkey', join(selected, 'ca-key.pem'), '-CAcreateserial',
      '-out', join(selected, 'server.pem'), '-days', '7', '-sha256',
      '-extfile', join(selected, 'server.cnf'), '-extensions', 'server'], log);
    await openssl(ctx, ['verify', '-CAfile', join(selected, 'ca.pem'),
      '-verify_hostname', ctx.origin.hostname, join(selected, 'server.pem')], log);
    const inherited = process.env.NODE_EXTRA_CA_CERTS ? await readFile(process.env.NODE_EXTRA_CA_CERTS) : Buffer.alloc(0);
    requireValue(inherited.length <= 16 * 1024 * 1024, 'INHERITED_CA_BUNDLE_TOO_LARGE');
    await saveBytes(join(selected, 'trust.pem'), Buffer.concat([inherited, Buffer.from('\n'), await readFile(join(selected, 'ca.pem'))]));
    const files = [];
    for (const name of ['ca-key.pem', 'ca.pem', 'server-key.pem', 'server.pem', 'trust.pem']) {
      await chmod(join(selected, name), 0o600);
      const file = await open(join(selected, name), 'r');
      try { await file.sync(); } finally { await file.close(); }
      const bytes = await privateBytes(join(selected, name));
      files.push({ name, sha256: hash(bytes), bytes: bytes.length });
    }
    manifest = { schema: 'stellar-forge.nocodb-owned-tls.v1', operationId: ctx.input.operationId,
      hostname: ctx.origin.hostname, generation, createdAt: time(), files };
    await save(manifestFile, manifest, { createOnly: true });
  }
  requireValue(manifest.operationId === ctx.input.operationId && manifest.hostname === ctx.origin.hostname &&
    /^generation-[a-f0-9-]{36}$/.test(manifest.generation), 'OWNED_TLS_IDENTITY_CHANGED');
  const selected = join(directory, manifest.generation);
  await privateDirectory(selected);
  for (const file of manifest.files) {
    requireValue(['ca-key.pem', 'ca.pem', 'server-key.pem', 'server.pem', 'trust.pem'].includes(file.name),
      'OWNED_TLS_FILE_INVALID');
    const bytes = await privateBytes(join(selected, file.name));
    assert.equal(hash(bytes), file.sha256); assert.equal(bytes.length, file.bytes);
  }
  return { directory: selected, manifest, trustFile: join(selected, 'trust.pem') };
}

async function openIngress({ tls, hostname, merchantPort, tlsPort, proxyPort }) {
  // This is the existing fleet host-ingress pattern, outside original SF31.
  // TLS terminates only for the reviewed owned .test name. The explicit proxy
  // also tunnels the fixed public RPC destination; SF31 still verifies its TLS.
  const sockets = new Set(), tunnels = { merchant: 0, rpc: 0 };
  const track = socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); };
  const ingress = httpsServer({ key: await privateBytes(join(tls.directory, 'server-key.pem')),
    cert: await privateBytes(join(tls.directory, 'server.pem')), minVersion: 'TLSv1.2' }, (req, res) => {
    if (req.headers.host !== hostname && req.headers.host !== hostname + ':443') {
      res.writeHead(421); res.end(); return;
    }
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: merchantPort,
      method: req.method, path: req.url, headers: req.headers }, incoming => {
      res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
    });
    outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('aborted', () => outgoing.destroy()); res.on('close', () => outgoing.destroy());
    req.pipe(outgoing);
  });
  const proxy = httpServer((_req, res) => { res.writeHead(405); res.end(); });
  for (const server of [ingress, proxy]) server.on('connection', track);
  const rpcHost = new URL(RPC).hostname;
  proxy.on('connect', (req, socket, head) => {
    const merchant = req.url === hostname + ':443', rpc = req.url === rpcHost + ':443';
    if ((!merchant && !rpc) || head.length || req.headers['proxy-authorization']) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const destination = connect({ host: merchant ? '127.0.0.1' : rpcHost, port: merchant ? tlsPort : 443 }, () => {
      tunnels[merchant ? 'merchant' : 'rpc']++;
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socket.pipe(destination); destination.pipe(socket);
    });
    track(destination);
    destination.setTimeout(180000, () => destination.destroy());
    destination.on('error', () => socket.destroy()); socket.on('error', () => destination.destroy());
    destination.on('close', () => socket.destroy()); socket.on('close', () => destination.destroy());
  });
  const listen = (server, port) => new Promise((done, reject) => {
    server.once('error', reject); server.listen(port, '127.0.0.1', done);
  });
  let closing;
  const close = () => closing ??= (async () => {
    const pending = [proxy, ingress].map(server => new Promise(done => {
      if (!server.listening) { done(); return; }
      server.close(done); server.closeIdleConnections?.();
    }));
    // Original buyer, merchant and facilitator are drained before this owner closes.
    for (const socket of sockets) socket.destroy();
    await Promise.all(pending);
  })();
  try { await listen(ingress, tlsPort); await listen(proxy, proxyPort); }
  catch (error) { await close(); throw error; }
  return { url: 'http://127.0.0.1:' + proxyPort, tunnels, close };
}
async function corePhase(ctx, template, lease, tls) {
  const driver = join(template.sourceRoot, SDK, 'nocodb/receiving/native-consumer.mjs');
  assert.equal(hash(await readFile(driver)), template.consumerSha256);
  const resultPath = join(template.outputDirectory, 'result.json');
  const previous = await readJson(resultPath, true);
  const selected = await retain(join(ctx.output, 'core-input.json'), template);
  if (previous?.state === 'PASS') {
    assert.equal(previous.inputSha256, selected.sha256);
    return { file: resultPath, sha256: hash(await privateBytes(resultPath)), value: previous };
  }
  const log = await open(join(ctx.output, 'original-core.log'), 'a', 0o600);
  try {
    const environment = { ...process.env, [LOCK_ENV]: '3', NODE_EXTRA_CA_CERTS: tls.trustFile,
      NODE_TLS_REJECT_UNAUTHORIZED: '1' };
    delete environment[PAYER_ENV]; delete environment[MERCHANT_ENV];
    const result = await subprocess(process.execPath, ['--use-system-ca', driver, '--input', selected.file],
      { env: environment, stdio: ['ignore', log.fd, log.fd, lease] });
    requireValue(result.code === 0, 'ORIGINAL_CORE_RECEIVING_NOT_COMPLETE');
  } finally { await log.close(); }
  const value = await readJson(resultPath);
  requireValue(value.state === 'PASS' && value.inputSha256 === selected.sha256, 'ORIGINAL_CORE_RESULT_REQUIRED');
  return { file: resultPath, sha256: hash(await privateBytes(resultPath)), value };
}
async function selectedNativeSdk(sourceRoot) {
  const require = createRequire(join(sourceRoot, SCF, 'native-facilitator/runtime.mjs'));
  const requested = [
    ['@x402/core/server', '@x402/core', '2.28.0'],
    ['@x402/stellar/exact/facilitator', '@x402/stellar', '2.28.0'],
    ['@x402/extensions/bazaar', '@x402/extensions', '2.28.0'],
    ['@stellar/stellar-sdk', '@stellar/stellar-sdk', '16.3.0'],
  ];
  const identities = [];
  for (const [entry, name, version] of requested) {
    let directory = dirname(require.resolve(entry)), found = null;
    for (;;) {
      try {
        const bytes = await readFile(join(directory, 'package.json')), value = JSON.parse(bytes);
        if (value.name === name) {
          requireValue(value.version === version, 'ORIGINAL_NATIVE_PACKAGE_PIN_CHANGED',
            name + ' must use the selected original ' + version + ' package.');
          found = { name, version, packageJsonSha256: hash(bytes) }; break;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const parent = dirname(directory); if (parent === directory) break; directory = parent;
    }
    requireValue(found !== null, 'ORIGINAL_NATIVE_PACKAGE_IDENTITY_MISSING', name);
    identities.push(found);
  }
  return { sdk: require('@stellar/stellar-sdk'), identities };
}
async function lockedPhase(ctx) {
  const lease = await leaseDescriptor(ctx.output);
  const source = await checkedSource(ctx.template);
  let intent = await readJson(join(ctx.output, 'intent.json'), true);
  if (intent) {
    requireValue(intent.schema === 'stellar-forge.nocodb-testnet-receiving-intent.v1' &&
      intent.inputSha256 === ctx.inputSha256 && intent.operationId === ctx.input.operationId,
      'ORIGINAL_TESTNET_RECEIVING_INTENT_CHANGED');
  } else {
    intent = { schema: 'stellar-forge.nocodb-testnet-receiving-intent.v1',
      operationId: ctx.input.operationId, inputSha256: ctx.inputSha256, createdAt: time(),
      sourceManifestSha256: source.manifestSha256 };
    await save(join(ctx.output, 'intent.json'), intent, { createOnly: true });
  }
  const old = await readJson(join(ctx.output, 'result.json'), true);
  if (old?.state === 'PASS') {
    assert.equal(old.inputSha256, ctx.inputSha256);
    for (const file of old.completedFiles)
      assert.equal(hash(await privateBytes(file.file)), file.sha256, 'Retained complete native result.');
    console.log(JSON.stringify({ phase: 'RETAINED_COMPLETE', operationId: ctx.input.operationId,
      result: join(ctx.output, 'result.json'), payments: old.payment.completedPayments,
      amountAtomic: old.payment.actualTotalAtomic }));
    return;
  }
  const { sdk: nativeSdk, identities: nativePackages } = await selectedNativeSdk(source.root);
  await retain(join(ctx.output, 'native-package-selection.json'), nativePackages);
  const { inspectMerchantRuntime } = await import(pathToFileURL(join(source.root,
    SCF + '/sf46-release/runtime-package.mjs')).href);
  const installed = await inspectMerchantRuntime(ctx.input.applications.runtimeDirectory, {
    expectedManifest: source.manifestSha256, load: false,
  });
  requireValue(installed.sourceRoot === source.root && installed.sourceManifestSha256 === source.manifestSha256,
    'ORIGINAL_APPLICATIONS_READY_RUNTIME_REQUIRED');
  await retain(join(ctx.output, 'applications-runtime-selection.json'), {
    directory: installed.directory, sourceRoot: installed.sourceRoot, sourceCommit: installed.sourceCommit,
    installationId: installed.installationId, profileId: installed.profileId,
    sourceManifestSha256: installed.sourceManifestSha256, lockSha256: installed.lockSha256,
  });
  const accounts = await prepareAccounts(ctx, nativeSdk, intent);
  const asset = nativeSdk.Asset.native().contractId(nativeSdk.Networks.TESTNET);
  requireValue(/^C[A-Z2-7]{55}$/.test(asset), 'ORIGINAL_NATIVE_XLM_CONTRACT_REQUIRED');
  const tls = await prepareTls(ctx);
  const template = { ...ctx.template, outputDirectory: join(ctx.output, 'core'),
    merchant: { ...ctx.template.merchant, payment: {
      ...ctx.template.merchant.payment, scheme: 'exact', network: NETWORK,
      asset, payTo: accounts.merchant.address,
    } } };
  const terms = { operationId: ctx.input.operationId, network: NETWORK, asset,
    assetCode: 'XLM', payer: accounts.payer.address, recipient: accounts.merchant.address,
    amountPerPageAtomic: template.merchant.nextAmount,
    maxPages: 4, maxTotalAtomic: ctx.input.authorization.maxTotalAtomic,
    origin: ctx.origin.origin, path: template.merchant.path,
    dedicatedAccounts: true, funding: intent.funding };
  await retain(join(ctx.output, 'public-testnet-terms.json'), terms);
  console.log(JSON.stringify({ phase: 'DEDICATED_TESTNET_ACCOUNTS_OBSERVED',
    operationId: ctx.input.operationId, payer: terms.payer, recipient: terms.recipient,
    network: NETWORK, asset, maxTotalAtomic: terms.maxTotalAtomic }));
  const core = await corePhase(ctx, template, lease, tls);
  await retain(join(ctx.output, 'core-completion.json'), { file: core.file, sha256: core.sha256,
    inputSha256: core.value.inputSha256, sourceManifestSha256: source.manifestSha256 });
  await runChild(ctx, '--paid-input', 'original-testnet.log', { NODE_EXTRA_CA_CERTS: tls.trustFile });
  const paymentFile = join(ctx.output, 'payment-result.json'), payment = await readJson(paymentFile);
  requireValue(payment.state === 'PASS' && payment.inputSha256 === ctx.inputSha256,
    'ORIGINAL_TESTNET_PAYMENT_NOT_COMPLETE');
  const { receiveNocoDBApplications } = await import(pathToFileURL(join(source.root,
    SDK + '/nocodb/receiving/applications-consumer.mjs')).href);
  const applications = await receiveNocoDBApplications({
    operationId: ctx.input.operationId, inputSha256: ctx.inputSha256,
    sourceRoot: source.root, sourceManifestSha256: source.manifestSha256,
    runtimeDirectory: ctx.input.applications.runtimeDirectory,
    coreDirectory: join(ctx.output, 'core'), outputDirectory: join(ctx.output, 'applications'),
    browser: ctx.template.browser,
  });
  requireValue(applications.value.state === 'PASS', 'ORIGINAL_APPLICATIONS_RECEIVING_NOT_COMPLETE');
  await checkedSource(ctx.template);
  const result = { schema: 'stellar-forge.nocodb-testnet-receiving-result.v1',
    operationId: ctx.input.operationId, inputSha256: ctx.inputSha256,
    consumerSha256: ctx.input.consumerSha256, sourceManifestSha256: source.manifestSha256,
    state: 'PASS', completedAt: time(), runtime: process.version,
    core: { resultSha256: core.sha256, actorRows: core.value.actor.rows,
      filmRows: core.value.film.second.rows, customer: core.value.customer },
    payment: { network: NETWORK, asset, assetCode: 'XLM', payer: terms.payer, recipient: terms.recipient,
      completedPayments: payment.completedPayments, actualTotalAtomic: payment.actualTotalAtomic,
      snapshot: payment.snapshot, rows: payment.rows, valuesSha256: payment.valuesSha256,
      transactions: payment.pages.map(page => page.transaction),
      datasetDelivery: payment.datasetDelivery, resultSha256: hash(await privateBytes(paymentFile)) },
    applications: { resultSha256: applications.sha256, applicationId: applications.value.applicationId,
      originalRunIds: applications.value.originalRunIds, originalInstanceIds: applications.value.originalInstanceIds,
      sameSourceVersion: applications.value.sameSourceVersion,
      publishedSnapshot: applications.value.publishedSnapshot,
      lostStartReplyRecovered: applications.value.lostStartReplyRecovered,
      consoleReopenedWithoutNewRun: applications.value.consoleReopenedWithoutNewRun,
      finalPhase: applications.value.finalPhase },
    completedFiles: [{ file: core.file, sha256: core.sha256 },
      { file: paymentFile, sha256: hash(await privateBytes(paymentFile)) },
      { file: applications.file, sha256: applications.sha256 }],
    sourceScope: 'The original two complete provider captures are unchanged; no second NocoDB extraction.',
    paymentScope: 'Actual dedicated-account Stellar testnet payments; original approvals, ledger finalization, transfer observations and full delivered dataset.',
  };
  await save(join(ctx.output, 'result.json'), result);
  console.log(JSON.stringify({ phase: 'COMPLETE', operationId: ctx.input.operationId,
    result: join(ctx.output, 'result.json'), payments: result.payment.completedPayments,
    amountAtomic: result.payment.actualTotalAtomic, rows: result.payment.rows,
    transactions: result.payment.transactions }));
}
async function originalPageValues(datasetControl, directory, snapshot, rowCount) {
  const rows = []; let cursor = null;
  do {
    const query = new URLSearchParams({ limit: '250', ...(cursor ? { cursor } : { snapshot }) });
    const page = await datasetControl(directory, 'preview', { query: query.toString() });
    assert.equal(page.dataset.snapshot, snapshot);
    rows.push(...page.rows); requireValue(rows.length <= rowCount, 'ORIGINAL_DATASET_PAGE_LIMIT');
    cursor = page.page.nextCursor;
  } while (cursor);
  assert.equal(rows.length, rowCount);
  return rows;
}
async function inspectAccountsFile(ctx) {
  const accounts = await readJson(join(ctx.output, 'dedicated-testnet-accounts.private.json'));
  requireValue(accounts.operationId === ctx.input.operationId && accounts.network === NETWORK,
    'DEDICATED_ACCOUNT_BINDING_CHANGED');
  return accounts;
}
async function settleOriginalPages({ dataset, broker, directory, workspace, environment,
  terms, output, signal, progress }) {
  let report = await dataset.recoverDatasetSession(directory);
  let latest = report, done = false, actionError = null;
  if (report.status !== 'READY') return report;
  const operation = dataset.runDatasetSession(directory, { workspace, environment, signal,
    emitPageSummaries: false,
    onPage: async value => {
      latest = value;
      await save(join(output, 'original-session-progress.json'), value);
      await progress('Original paid dataset page returned', {
        completedPages: value.completedPages, rows: value.acquiredRows, state: value.status });
    },
  }).then(value => { report = value; }, error => { actionError = error; })
    .finally(() => { done = true; });
  try {
    while (!done) {
      if (latest.status === 'READY' && latest.nextPage) {
        const intentId = latest.nextPage.intentId, review = broker.snapshot(intentId);
        if (review?.state === 'AWAITING_OPERATOR') {
          const accepted = review.review.complete_original_accepted_terms;
          requireValue(review.intentId === intentId && review.review.request_id === intentId &&
            review.current_native_budget_estimate.approved === true &&
            review.review.resource === latest.nextPage.url && review.review.method === 'GET' &&
            review.review.body_present === false &&
            review.review.max_atomic_units_to_reserve === terms.amountPerPageAtomic &&
            accepted.scheme === 'exact' && accepted.network === NETWORK &&
            accepted.asset === terms.asset && accepted.payTo === terms.recipient &&
            accepted.amount === terms.amountPerPageAtomic &&
            accepted.extra?.areFeesSponsored === true &&
            (accepted.extra?.paymentFlow ?? 'authorization') === 'authorization' &&
            accepted.maxTimeoutSeconds <= 120 && HASH.test(review.review.request_sha256),
            'ORIGINAL_PAGE_APPROVAL_TERMS_CHANGED');
          const number = latest.nextPage.index;
          const decision = { schema: 'stellar-forge.nocodb-native-page-review.v1',
            index: number, intentId, approvalId: review.id,
            requestSha256: review.review.request_sha256, review,
            authorization: { operationId: terms.operationId, network: NETWORK,
              maxTotalAtomic: terms.maxTotalAtomic, maxPages: terms.maxPages },
            decision: 'approve', reviewedAt: time() };
          await retain(join(output, 'approval-' + String(number).padStart(6, '0') + '.json'), decision);
          broker.decide({ intent: intentId, approvalId: review.id,
            requestSha256: review.review.request_sha256, decision: 'approve' });
        }
      }
      await new Promise(done => setTimeout(done, 100));
    }
    await operation;
    if (actionError) throw actionError;
    return report;
  } catch (error) {
    // Stop admission through the original channel. A dispatched attempt is kept
    // for native reconciliation, never replaced with another intent or payment.
    if (latest.nextPage) broker.revoke(latest.nextPage.intentId);
    await operation;
    throw error;
  }
}
async function observePaidPages({ ctx, terms, report, verify, expectedRows, progress }) {
  const observationsDirectory = join(ctx.output, 'chain-observations');
  await privateDirectory(observationsDirectory, true);
  const rows = [], pages = [], transactions = new Set();
  const decoder = await verify.createOfficialEventDecoder();
  for (const page of report.pages) {
    const evidenceBytes = await privateBytes(page.evidencePath);
    assert.equal(hash(evidenceBytes), page.evidenceSha256);
    const evidence = JSON.parse(evidenceBytes), buyer = evidence.observation.buyer;
    requireValue(evidence.intentId === page.intentId && buyer.status === 'DELIVERED_REPORTED_SETTLED' &&
      buyer.httpStatus >= 200 && buyer.httpStatus < 300 && buyer.receipt?.success === true &&
      buyer.receipt.network === NETWORK && HASH.test(buyer.receipt.transaction) &&
      buyer.requirement.network === NETWORK && buyer.requirement.asset === terms.asset &&
      buyer.requirement.payTo === terms.recipient && buyer.requirement.amount === terms.amountPerPageAtomic,
      'ORIGINAL_PAID_DELIVERY_REQUIRED');
    const originalReservation = page.operatorReservation;
    requireValue(originalReservation?.outcome === 'FRESH_RESERVATION_APPROVED' &&
      originalReservation.requestId === page.intentId &&
      originalReservation.reservedAtomicUnits === terms.amountPerPageAtomic,
      'ORIGINAL_GOVERNOR_RESERVATION_REQUIRED');
    const body = await privateBytes(page.responsePath);
    const value = JSON.parse(body); assert.equal(value.dataset.snapshot, report.snapshot);
    requireValue(Array.isArray(value.rows), 'ORIGINAL_PAID_DATASET_BODY_REQUIRED');
    rows.push(...value.rows);
    let chain = evidence.observation.chain;
    if (chain?.status !== 'TOKEN_TRANSFER_MATCHED_TESTNET') {
      // Repeat only the original read-only RPC observation of this same receipt.
      // The original checkout record is immutable and is not rewritten.
      const deadline = Date.now() + 180000;
      do {
        chain = await verify.checkStellarTestnetTransaction({
          receipt: { ...buyer.receipt, payer: terms.payer },
          expected: { network: NETWORK, asset: terms.asset, payTo: terms.recipient,
            amount: terms.amountPerPageAtomic, payer: terms.payer },
          rpcEndpoint: RPC, decodeContractEvent: decoder,
        });
        await save(join(observationsDirectory, page.intentId.replaceAll(':', '-') + '.json'), {
          schema: 'stellar-forge.nocodb-original-rpc-observation.v1',
          evidencePath: page.evidencePath, evidenceSha256: page.evidenceSha256,
          intentId: page.intentId, observedAt: time(), observation: chain,
          buyerInvocations: 0, signerInvocations: 0 });
        if (chain.status === 'TOKEN_TRANSFER_MATCHED_TESTNET') break;
        await new Promise(done => setTimeout(done, 3000));
      } while (Date.now() < deadline);
    }
    requireValue(chain?.status === 'TOKEN_TRANSFER_MATCHED_TESTNET' &&
      chain.transaction === buyer.receipt.transaction && chain.payer === terms.payer &&
      chain.recipient === terms.recipient && chain.contractId === terms.asset &&
      chain.amountAtomic === terms.amountPerPageAtomic, 'ORIGINAL_TRANSFER_OBSERVATION_NOT_COMPLETE');
    requireValue(!transactions.has(chain.transaction), 'ONE_ORIGINAL_TRANSACTION_PER_PAGE_REQUIRED');
    transactions.add(chain.transaction);
    pages.push({ index: page.index, intentId: page.intentId, transaction: chain.transaction,
      ledger: chain.ledger, eventId: chain.eventId, amountAtomic: chain.amountAtomic,
      payer: chain.payer, recipient: chain.recipient, asset: chain.contractId,
      originalEvidenceSha256: page.evidenceSha256, originalEvidencePath: page.evidencePath,
      responseSha256: hash(body), responseBytes: body.length, responsePath: page.responsePath,
      rows: value.rows.length, snapshot: value.dataset.snapshot,
      chainObservation: chain });
    await progress('Original transfer and delivered page matched', {
      index: page.index, transaction: chain.transaction, rows: value.rows.length,
      amountAtomic: chain.amountAtomic, responseSha256: hash(body) });
  }
  assert.deepEqual(rows, expectedRows, 'Every paid film value and row order matches the original reviewed edition.');
  return { pages, rows: rows.length, valuesSha256: hash(jsonBytes(rows)),
    actualTotalAtomic: pages.reduce((sum, page) => sum + BigInt(page.amountAtomic), 0n).toString() };
}

async function paidPhase(ctx) {
  await leaseDescriptor(ctx.output);
  const source = await checkedSource(ctx.template);
  const coreBasis = await readJson(join(ctx.output, 'core-completion.json'));
  const core = await readJson(coreBasis.file);
  assert.equal(hash(await privateBytes(coreBasis.file)), coreBasis.sha256);
  requireValue(core.state === 'PASS' && core.source.manifestSha256 === source.manifestSha256,
    'ORIGINAL_CORE_RESULT_REQUIRED');
  const originalInput = await readJson(join(ctx.output, 'core-input.json'));
  assert.equal(hash(jsonBytes(originalInput)), core.inputSha256);
  const coreOutput = join(ctx.output, 'core');
  assert.equal(originalInput.outputDirectory, coreOutput);
  const old = await readJson(join(ctx.output, 'payment-result.json'), true);
  if (old?.state === 'PASS') {
    assert.equal(old.inputSha256, ctx.inputSha256);
    for (const file of old.completedFiles)
      assert.equal(hash(await privateBytes(file.file)), file.sha256, 'Retained paid delivery file.');
    return;
  }
  const accounts = await inspectAccountsFile(ctx);
  const { sdk: nativeSdk, identities: nativePackages } = await selectedNativeSdk(source.root);
  assert.deepEqual(nativePackages, await readJson(join(ctx.output, 'native-package-selection.json')));
  for (const role of ['payer', 'merchant'])
    assert.equal(nativeSdk.Keypair.fromSecret(accounts[role].secret).publicKey(), accounts[role].address);
  const terms = await readJson(join(ctx.output, 'public-testnet-terms.json'));
  assert.equal(terms.asset, nativeSdk.Asset.native().contractId(nativeSdk.Networks.TESTNET));
  assert.equal(terms.payer, accounts.payer.address); assert.equal(terms.recipient, accounts.merchant.address);
  assert.equal(terms.network, NETWORK); assert.equal(terms.maxTotalAtomic, ctx.input.authorization.maxTotalAtomic);
  // This privileged receiving worker is the sole custodian. The generated
  // original SF103 adapter reads this worker's selected named environment.
  process.env[PAYER_ENV] = accounts.payer.secret;
  process.env[MERCHANT_ENV] = accounts.merchant.secret;
  const tls = await prepareTls(ctx);
  assert.equal(process.env.NODE_EXTRA_CA_CERTS, tls.trustFile,
    'Start this worker with the owned CA bundle; never disable TLS verification.');
  const importAt = path => import(pathToFileURL(join(source.root, path)).href);
  const [{ createNativeFacilitator }, { startFacilitatorServer }, facilitatorRelease,
    { startReleaseConsole }, releases, workspace, dataset, { createBrowserApprovalBroker },
    buyerHandoff, { datasetControl }, verify, evidence] = await Promise.all([
    importAt(SCF + '/native-facilitator/runtime.mjs'), importAt(SCF + '/native-facilitator/server.mjs'),
    importAt(RELEASE + '/release-facilitator.mjs'), importAt(RELEASE + '/release-console.mjs'),
    importAt(RELEASE + '/releases.mjs'), importAt(BUYER + '/workspace.mjs'),
    importAt(BUYER + '/dataset-session.mjs'), importAt(SCF + '/sf81-buyer-operator-bridge/browser-approval.mjs'),
    importAt(SDK + '/dataset-refresh/buyer-handoff.mjs'), importAt(SDK + '/dataset-refresh/service.mjs'),
    importAt(SCF + '/sf43-agent-commerce/verify.mjs'), importAt(SCF + '/sf82-checkout-evidence/evidence.mjs'),
  ]);
  const originalIntent = await readJson(join(coreOutput, 'intent.json'));
  const publisher = originalIntent.authoring.film.publisher;
  requireValue(contains(coreOutput, publisher.directory) && contains(coreOutput, publisher.targetDirectory),
    'ORIGINAL_PUBLISHER_LOCATION_CHANGED');
  const releaseRoot = join(coreOutput, 'merchant', 'releases');
  const exportRoot = join(coreOutput, 'merchant', 'customer-exports');
  const sourceRelease = await releases.inspectRelease(releaseRoot, 'nocodb-b');
  const sourceDeployment = await readJson(join(coreOutput, 'nocodb-b-deployment.json'));
  assert.equal(sourceRelease.digest, sourceDeployment.release.digest);
  assert.equal(sourceDeployment.prepared.dataset.datasetDirectory, publisher.targetDirectory);
  const snapshot = core.film.second.snapshot;
  const expectedRows = await originalPageValues(datasetControl, publisher.targetDirectory, snapshot, 1000);
  assert.equal(hash(jsonBytes(expectedRows)), core.film.second.valuesSha256);
  const nativeReleaseId = 'nocodb-testnet', operatorDirectory = join(ctx.output, 'buyer-operator');
  const sessionDirectory = join(ctx.output, 'paid-dataset-session');
  let intent = await readJson(join(ctx.output, 'payment-intent.json'), true);
  if (!intent) {
    intent = { schema: 'stellar-forge.nocodb-testnet-payment-intent.v1',
      operationId: ctx.input.operationId, inputSha256: ctx.inputSha256,
      coreResultSha256: coreBasis.sha256, snapshot, originalReleaseDigest: sourceRelease.digest,
      payer: terms.payer, recipient: terms.recipient, asset: terms.asset,
      ports: { merchant: originalIntent.sellerPort, facilitator: await availablePort(),
        tls: await availablePort(), proxy: await availablePort() }, createdAt: time() };
    requireValue(new Set(Object.values(intent.ports)).size === 4, 'DISTINCT_OWNED_LISTENER_PORTS_REQUIRED');
    await save(join(ctx.output, 'payment-intent.json'), intent, { createOnly: true });
  }
  requireValue(intent.inputSha256 === ctx.inputSha256 && intent.coreResultSha256 === coreBasis.sha256 &&
    intent.snapshot === snapshot && intent.originalReleaseDigest === sourceRelease.digest &&
    intent.payer === terms.payer && intent.recipient === terms.recipient && intent.asset === terms.asset &&
    intent.ports.merchant === originalIntent.sellerPort, 'ORIGINAL_PAYMENT_INTENT_CHANGED');
  const report = { schema: 'stellar-forge.nocodb-testnet-payment-result.v1',
    operationId: ctx.input.operationId, inputSha256: ctx.inputSha256, coreResultSha256: coreBasis.sha256,
    state: 'RUNNING', startedAt: time(), network: NETWORK, sourceManifestSha256: source.manifestSha256,
    payer: terms.payer, recipient: terms.recipient, asset: terms.asset, checks: [],
    scope: 'Same original provider capture, publisher target, SF82 release store and customer source; dedicated free testnet accounts.' };
  const progress = async (name, value = {}) => {
    report.checks.push({ name, at: time(), ...value });
    await save(join(ctx.output, 'payment-progress.json'), report);
    console.log('NOCODB_TESTNET', name, JSON.stringify(value));
  };
  const abort = new AbortController();
  const interrupt = () => abort.abort(fail('ORIGINAL_OPERATION_INTERRUPTED'));
  process.on('SIGTERM', interrupt); process.on('SIGINT', interrupt);
  let facilitator, facilitatorHost, ingress, consoleHost, broker;
  const consoleApi = async (path, body) => {
    const response = await fetch(consoleHost.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-release-token': consoleHost.token,
        ...(body === undefined ? {} : { origin: consoleHost.url, 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120000),
    });
    const value = await response.json();
    requireValue(response.ok, 'ORIGINAL_RELEASE_OPERATION_FAILED', JSON.stringify(value));
    return value;
  };
  try {
    const configuration = {
      schema: 'stellar-forge.native-facilitator.v1', network: NETWORK, rpcUrl: RPC,
      signers: [{ address: terms.recipient, secretEnv: MERCHANT_ENV }],
      payments: { assets: [terms.asset], recipients: [terms.recipient],
        maxAtomic: terms.amountPerPageAtomic, paymentFlows: ['authorization'] },
      limits: { maxTransactionFeeStroops: 50000, inclusionFeeStroops: 100,
        maxVerifyInFlight: 4, maxSettleInFlight: 1, drainGraceMs: 60000 },
      operations: { ownershipDirectory: join(ctx.output, 'facilitator-ownership'),
        rpcTimeoutMs: 30000, readinessMaxAgeMs: 30000, maxLedgerAgeSeconds: 120, requireReady: true },
    };
    await retain(join(ctx.output, 'native-facilitator.json'), configuration);
    facilitator = await createNativeFacilitator(configuration, { environment: process.env });
    facilitatorHost = await startFacilitatorServer({ facilitator, port: intent.ports.facilitator });
    ingress = await openIngress({ tls, hostname: ctx.origin.hostname, merchantPort: intent.ports.merchant,
      tlsPort: intent.ports.tls, proxyPort: intent.ports.proxy });
    process.env[PROXY_ENV] = ingress.url;
    const profiles = facilitatorRelease.normalizeFacilitatorProfiles({
      schema: 'stellar-forge.seller-facilitators.v1',
      providers: { native: { label: 'Dedicated NocoDB testnet facilitator', url: facilitatorHost.url,
        allowLocalFacilitator: true, timeoutMs: 30000 } },
    });
    await retain(join(ctx.output, 'facilitator-profiles.json'), profiles);
    const reviewFile = join(ctx.output, 'original-facilitator-review.json');
    let review = await readJson(reviewFile, true), nativeRelease = null;
    try { nativeRelease = await releases.inspectRelease(releaseRoot, nativeReleaseId); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!review) {
      requireValue(nativeRelease === null, 'ORIGINAL_FACILITATOR_REVIEW_REQUIRED');
      review = await facilitatorRelease.reviewReleaseFacilitator(releaseRoot, { profiles, provider: 'native',
        releaseId: sourceRelease.id, id: nativeReleaseId, label: 'Reviewed NocoDB dedicated testnet release' });
      requireValue(review.compatible, 'NATIVE_FACILITATOR_REVIEW_NOT_COMPATIBLE');
      await save(reviewFile, review, { createOnly: true });
    }
    assert.equal(review.source.releaseDigest, sourceRelease.digest);
    assert.equal(review.proposed.provider.url, facilitatorHost.url);
    if (!nativeRelease) {
      const staged = await facilitatorRelease.stageReleaseFacilitator(releaseRoot, { profiles, review });
      nativeRelease = staged.release;
    }
    requireValue(nativeRelease.derivedFrom?.reviewId === review.id, 'ORIGINAL_FACILITATOR_RELEASE_CHANGED');
    await retain(join(ctx.output, 'native-release.json'), nativeRelease);
    consoleHost = await startReleaseConsole(releaseRoot, { port: 0, clientExportsDirectory: exportRoot });
    let state = await consoleApi('/api/status');
    requireValue(state.runtime.state === 'STOPPED', 'ORIGINAL_MERCHANT_OWNER_RECONCILIATION_REQUIRED',
      'A fresh console cannot stop a prior seller by listener address. Reconcile the retained original owner before continuing this same operation.');
    if (state.state.active !== nativeRelease.id)
      state = await consoleApi('/api/activate', { id: nativeRelease.id,
        expectedGeneration: state.state.generation, reason: 'Run the reviewed dedicated testnet facilitator with the same NocoDB dataset.' });
    requireValue(state.runtime.state === 'STOPPED', 'ORIGINAL_MERCHANT_MUST_BE_STOPPED');
    state = await consoleApi('/api/run', { expectedGeneration: state.state.generation });
    requireValue(state.runtime.state === 'RUNNING' &&
      state.runtime.observed.listener === 'http://127.0.0.1:' + intent.ports.merchant,
      'ORIGINAL_NATIVE_MERCHANT_NOT_RUNNING');
    await progress('Original retained release starts with the actual dedicated facilitator', {
      releaseId: nativeRelease.id, releaseDigest: nativeRelease.digest,
      reviewId: review.id, sourceRelease: sourceRelease.id, snapshot,
      merchantListener: state.runtime.observed.listener, facilitator: facilitatorHost.url });
    let handoff = await readJson(join(ctx.output, 'original-paid-buyer-handoff.json'), true);
    if (!handoff) {
      const offer = await buyerHandoff.readDatasetBuyerOffer({
        seller: 'http://127.0.0.1:' + intent.ports.merchant,
        resource: terms.origin + terms.path, snapshot, query: 'limit=250' });
      const prepared = buyerHandoff.prepareDatasetBuyer(offer, {
        intentId: ctx.input.operationId + '-paid-film', acceptIndex: 0, offerSha256: offer.offerSha256 });
      handoff = { offer, prepared };
      await save(join(ctx.output, 'original-paid-buyer-handoff.json'), handoff, { createOnly: true });
    }
    requireValue(handoff.offer.snapshot === snapshot && handoff.prepared.config.operation.expect.network === NETWORK &&
      handoff.prepared.config.operation.expect.asset === terms.asset &&
      handoff.prepared.config.operation.expect.payTo === terms.recipient &&
      handoff.prepared.config.operation.expect.maxAtomic === terms.amountPerPageAtomic,
      'ORIGINAL_BUYER_HANDOFF_TERMS_CHANGED');
    const selectedConfig = { ...handoff.prepared.config, requestTimeoutMs: 120000 };
    await retain(join(ctx.output, 'paid-buyer-config.json'), selectedConfig);
    broker = await createBrowserApprovalBroker();
    const environment = { ...process.env, ...broker.environment };
    const initArgs = ['--config', join(ctx.output, 'paid-buyer-config.json'), '--dir', operatorDirectory,
      '--actor', 'nocodb-native-receiving', '--service', 'nocodb-paid-film',
      '--payer', terms.payer, '--python', ctx.input.python, '--secret-env', PAYER_ENV, '--rpc', RPC,
      '--https-proxy-env', PROXY_ENV, '--total-atomic', terms.maxTotalAtomic, '--daily-atomic', terms.maxTotalAtomic];
    let operatorExists = true;
    try { await lstat(operatorDirectory); } catch (error) { if (error.code !== 'ENOENT') throw error; operatorExists = false; }
    await workspace.initializeWorkspace(initArgs, { environment, resume: operatorExists });
    let session;
    try { await lstat(sessionDirectory); session = await dataset.recoverDatasetSession(sessionDirectory); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      session = await dataset.createDatasetSession({ directory: sessionDirectory,
        workspaceDirectory: operatorDirectory, maxPages: 4, maxTotalAtomic: terms.maxTotalAtomic,
        maxRows: 1000, maxPageBytes: 2 * 1024 * 1024, expectedSnapshot: snapshot });
    }
    const recoverRetainedCheckout = async current => {
      if (current.status !== 'RECONCILIATION_REQUIRED' || !current.stoppedPage?.intentId) return current;
      try {
        const result = await evidence.recoverCheckoutEvidence({ outputDir: join(sessionDirectory, 'evidence'),
          intentId: current.stoppedPage.intentId, trustedPayer: terms.payer, rpcEndpoint: RPC });
        await save(join(ctx.output, 'original-checkout-recovery.json'), result);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return dataset.recoverDatasetSession(sessionDirectory);
    };
    session = await recoverRetainedCheckout(session);
    const completedBeforeThisWorker = session.completedPages;
    let remaining = 5;
    while (session.status === 'READY' && remaining-- > 0) {
      session = await settleOriginalPages({ dataset, broker, directory: sessionDirectory,
        workspace: operatorDirectory, environment, terms, output: ctx.output,
        signal: abort.signal, progress });
      session = await recoverRetainedCheckout(session);
    }
    await save(join(ctx.output, 'original-session-report.json'), session);
    requireValue(session.status === 'COMPLETE' && session.completedPages === 4 &&
      session.acquiredRows === 1000 && session.snapshot === snapshot,
      'ORIGINAL_PAID_SESSION_NOT_COMPLETE',
      'Inspect the retained original session, checkpoint and Governor request IDs. No uncertain attempt was replayed.');
    const observed = await observePaidPages({ ctx, terms, report: session, verify, expectedRows, progress });
    assert.equal(observed.actualTotalAtomic, terms.maxTotalAtomic);
    const accounting = await dataset.accountDatasetSession(sessionDirectory, {
      workspace: operatorDirectory, finalize: true, offset: 0, limit: 100, signal: abort.signal });
    requireValue(accounting.entries.length === 4 && accounting.entries.every(entry =>
      ['FINALIZED', 'IDEMPOTENT_FINALIZED'].includes(entry.outcome) &&
      String(entry.actualAtomicUnits) === terms.amountPerPageAtomic), 'ORIGINAL_GOVERNOR_FINALIZATION_NOT_COMPLETE');
    for (const entry of accounting.entries)
      requireValue(observed.pages.some(page => page.intentId === entry.intentId), 'ORIGINAL_ACCOUNTING_INTENT_CHANGED');
    await save(join(ctx.output, 'original-accounting.json'), accounting);
    const delivery = await dataset.deliverDatasetSession(sessionDirectory, join(ctx.output, 'received-paid-data'));
    requireValue(delivery.nativeStatus.finalized === true, 'ORIGINAL_SF100_DELIVERY_NOT_COMPLETE');
    const jsonl = await privateBytes(delivery.outputs['dataset.jsonl'].path);
    const deliveredRows = jsonl.toString('utf8').trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.deepEqual(deliveredRows, expectedRows, 'Original received JSONL contains all paid film rows.');
    for (const file of Object.values(delivery.outputs)) {
      const bytes = await privateBytes(file.path);
      assert.equal(hash(bytes), file.sha256); assert.equal(bytes.length, file.bytes);
    }
    await save(join(ctx.output, 'original-dataset-delivery.json'), delivery);
    await broker.close(); broker = null;
    const reopened = await workspace.openWorkspace(['--dir', operatorDirectory], { accounting: true });
    assert.equal(reopened.manifest.payer, terms.payer);
    const readback = await dataset.recoverDatasetSession(sessionDirectory);
    assert.equal(readback.status, 'COMPLETE');
    assert.deepEqual(readback.pages.map(page => page.intentId), observed.pages.map(page => page.intentId));
    const accountingReadback = await dataset.accountDatasetSession(sessionDirectory, {
      workspace: operatorDirectory, offset: 0, limit: 100 });
    assert.deepEqual(accountingReadback.entries.map(({ intentId, actualAtomicUnits, receipt }) =>
      ({ intentId, actualAtomicUnits, receipt })), accounting.entries.map(({ intentId, actualAtomicUnits, receipt }) =>
      ({ intentId, actualAtomicUnits, receipt })));
    const deliveredAgain = await dataset.deliverDatasetSession(sessionDirectory, delivery.directory);
    assert.equal(deliveredAgain.appendedPages, 0);
    assert.deepEqual(deliveredAgain.outputs, delivery.outputs);
    await progress('Original buyer, ledger and data room reopen without another payment', {
      pages: 4, rows: 1000, actualTotalAtomic: observed.actualTotalAtomic,
      snapshot, valuesSha256: observed.valuesSha256,
      dataRoomManifestSha256: delivery.outputs['manifest.json'].sha256 });
    state = await consoleApi('/api/status');
    state = await consoleApi('/api/stop', { expectedGeneration: state.state.generation,
      instanceId: state.runtime.observed.instanceId });
    requireValue(state.runtime.state === 'STOPPED', 'ORIGINAL_MERCHANT_DRAIN_NOT_COMPLETE');
    const facilitatorStatus = facilitator.status();
    await consoleHost.close(); consoleHost = null;
    const facilitatorShutdown = await facilitatorHost.close(); facilitatorHost = null; facilitator = null;
    requireValue(facilitatorShutdown.drained === true, 'ORIGINAL_FACILITATOR_DRAIN_NOT_COMPLETE');
    const transport = { mode: 'ORIGINAL_SF31_EXPLICIT_CONNECT_TLS_VERIFIED',
      ingressSource: 'D173 original host pattern', merchantConnects: ingress.tunnels.merchant,
      rpcConnects: ingress.tunnels.rpc, tlsHostname: ctx.origin.hostname,
      caSha256: tls.manifest.files.find(file => file.name === 'ca.pem').sha256 };
    transport.pagesRetainedBeforeThisWorker = completedBeforeThisWorker;
    requireValue(transport.merchantConnects >= 2 * (4 - completedBeforeThisWorker),
      'ORIGINAL_BUYER_HTTPS_REQUESTS_REQUIRED');
    await ingress.close(); ingress = null;
    await checkedSource(ctx.template);
    Object.assign(report, observed, { state: 'PASS', completedAt: time(), completedPayments: observed.pages.length,
      snapshot, originalReleaseId: nativeRelease.id, originalReleaseDigest: nativeRelease.digest,
      originalPublisherDirectory: publisher.directory, originalDatasetDirectory: publisher.targetDirectory,
      datasetDelivery: { directory: delivery.directory, nativeBlob: delivery.nativeBlob,
        sourceBindingSha256: delivery.sourceBindingSha256, paymentStatus: delivery.paymentStatus, outputs: delivery.outputs },
      originalAccounting: accounting, facilitatorStatus, facilitatorShutdown, transport,
      completedFiles: [
        ...observed.pages.flatMap(page => [
          { file: page.originalEvidencePath, sha256: page.originalEvidenceSha256 },
          { file: page.responsePath, sha256: page.responseSha256 },
        ]),
        ...Object.values(delivery.outputs).map(file => ({ file: file.path, sha256: file.sha256 })),
        { file: join(ctx.output, 'original-accounting.json'), sha256: hash(await privateBytes(join(ctx.output, 'original-accounting.json'))) },
      ] });
    await save(join(ctx.output, 'payment-result.json'), report);
    process.exitCode = 0;
  } catch (error) {
    report.state = 'FAIL'; report.failedAt = time();
    report.error = { code: /^[A-Z0-9_]{1,120}$/.test(error.code ?? '') ? error.code : 'ORIGINAL_TESTNET_RECEIVING_FAILED',
      message: String(error.message).replace(/S[A-Z2-7]{55}/g, '[private signing key]') };
    await save(join(ctx.output, 'payment-result.json'), report);
    throw error;
  } finally {
    const errors = [];
    for (const [name, action] of [
      ['approval', () => broker?.close()], ['merchant', () => consoleHost?.close()],
      ['facilitator', () => facilitatorHost ? facilitatorHost.close() : facilitator?.drain()],
      ['ingress', () => ingress?.close()],
    ]) try {
      const outcome = await action();
      if (outcome?.drained === false) errors.push(name + ': drain incomplete');
    } catch { errors.push(name + ': close failed'); }
    process.off('SIGTERM', interrupt); process.off('SIGINT', interrupt);
    delete process.env[PAYER_ENV]; delete process.env[MERCHANT_ENV]; delete process.env[PROXY_ENV];
    if (errors.length) {
      report.state = 'FAIL'; report.cleanupErrors = errors; process.exitCode = 2;
      await save(join(ctx.output, 'payment-result.json'), report);
    }
  }
}

const args = process.argv.slice(2);
try {
  if (args.length !== 2 || !['--input', '--locked-input', '--paid-input'].includes(args[0]))
    throw fail('USAGE', 'node testnet-consumer.mjs --input /absolute/private/testnet-input.json');
  const ctx = await loadInput(args[1]);
  await privateDirectory(ctx.output, args[0] === '--input');
  process.umask(0o077);
  if (args[0] === '--input') {
    const result = await subprocess(ctx.input.python, ['-I', '-B', '-c', PYTHON_LEASE,
      join(ctx.output, 'operation.lock'), process.execPath, SELF, ctx.inputFile],
      { env: process.env, stdio: 'inherit' });
    process.exitCode = result.code ?? 2;
  } else if (args[0] === '--locked-input') await lockedPhase(ctx);
  else await paidPhase(ctx);
} catch (error) {
  console.error(JSON.stringify({ state: 'NOT_COMPLETE',
    code: /^[A-Z0-9_]{1,120}$/.test(error.code ?? '') ? error.code : 'NOCODB_TESTNET_RECEIVING_FAILED',
    message: String(error.message).replace(/S[A-Z2-7]{55}/g, '[private signing key]'),
    continuation: 'Keep the same private input, account custody and native output directory. Inspect the original result and request identity before resuming.' }));
  process.exitCode = 2;
}
