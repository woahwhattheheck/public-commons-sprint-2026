#!/usr/bin/env node
// MIT. Original configured native host for the retained FRED receiver.
import { readFile, realpath } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { createServer as netServer, connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { spawn } from 'node:child_process';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { readBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/client.mjs';
import { openWorkspace } from '../../sf88-operator-buyer-cli/workspace.mjs';
import { need, canonical, operationId } from './model.mjs';
import { digest, hash, optionalJson } from './source.mjs';
import { runFredReceiver, readFredReceiver } from './receiver.mjs';

const CONFIG = 'stellar-forge.fred-native-host-config.v1';
const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SELF = fileURLToPath(import.meta.url);
const roles = ['page1', 'page2', 'source', 'csv'];
const check = (value, code) => need(value, code, code);
const now = () => new Date().toISOString();
const print = value => process.stdout.write(JSON.stringify(value) + '\n');
const same = (left, right, code) => check(canonical(left) === canonical(right), code);
const stopServer = server => new Promise(done => {
  if (!server?.listening) return done();
  server.close(done); server.closeIdleConnections?.();
});
const listen = (server, port = 0) => new Promise((done, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); done(server.address().port); });
});
async function retained(directory, name, value) {
  const original = await optionalJson(join(directory, name), 4 * 1024 * 1024);
  if (original) same(original, value, 'FRED_HOST_ORIGINAL_SELECTION_CHANGED');
  else await atomicJson(directory, name, value, { exclusive: true });
  return original ?? value;
}
async function configuration(configFile, projectDirectory) {
  configFile = resolve(configFile);
  const input = await readPrivateJson(configFile, 131072), base = dirname(configFile);
  const allowed = ['schema', 'directory', 'originalDirectory', 'receiverConfigFile', 'buyerStateDirectory',
    'buyerRuntimeDirectory', 'caFile', 'terminalScript', 'receiver', 'browser'];
  check(input?.schema === CONFIG && Object.keys(input).every(key => allowed.includes(key)), 'FRED_NATIVE_HOST_CONFIG_REQUIRED');
  const path = (value, label) => {
    check(typeof value === 'string' && value.length > 0 && !value.includes('\0'), label);
    return resolve(base, value);
  };
  const directory = await privateDirectory(path(input.directory, 'FRED_NATIVE_HOST_DIRECTORY_REQUIRED'));
  const originalDirectory = await realpath(path(input.originalDirectory, 'FRED_ORIGINAL_OPERATOR_DIRECTORY_REQUIRED'));
  const receiver = input.receiver ?? {};
  const receiverKeys = ['id', 'title', 'sources', 'path', 'policy', 'note', 'publicationId', 'query', 'intents', 'acceptIndex'];
  check(receiver && typeof receiver === 'object' && !Array.isArray(receiver) &&
    Object.keys(receiver).every(key => receiverKeys.includes(key)), 'FRED_HOST_RECEIVER_OPTIONS_CHANGED');
  if (receiver.sources) {
    check(Array.isArray(receiver.sources), 'FRED_ORIGINAL_SOURCE_LIST_REQUIRED');
    receiver.sources = receiver.sources.map(value => path(value, 'FRED_ORIGINAL_SOURCE_REQUIRED'));
  }
  if (receiver.id) operationId(receiver.id);
  return { input, configFile, directory, originalDirectory, projectDirectory: resolve(projectDirectory),
    receiver, receiverConfigFile: input.receiverConfigFile ? path(input.receiverConfigFile, 'FRED_RECEIVER_FILE_REQUIRED')
      : join(directory, 'receiver-config.json'),
    buyerStateDirectory: input.buyerStateDirectory ? path(input.buyerStateDirectory, 'FRED_BUYER_STATE_REQUIRED')
      : join(directory, 'buyer-state'),
    buyerRuntimeDirectory: input.buyerRuntimeDirectory ? path(input.buyerRuntimeDirectory, 'FRED_BUYER_RUNTIME_REQUIRED')
      : join(SOURCE, 'sf88-operator-buyer-cli'),
    caFile: input.caFile ? path(input.caFile, 'FRED_ORIGINAL_CA_REQUIRED') : join(originalDirectory, 'tls', 'extra-ca.pem'),
    terminalScript: input.terminalScript ? path(input.terminalScript, 'FRED_TERMINAL_SCRIPT_REQUIRED') : '/usr/bin/script' };
}
async function updateBrowser(selected, input) {
  if (selected.input.browser === undefined) return input;
  const next = { ...input, browser: selected.input.browser };
  if (canonical(next) !== canonical(input))
    await atomicJson(dirname(selected.receiverConfigFile), basename(selected.receiverConfigFile), next);
  return next;
}
async function transport({ originalDirectory: ORIGINAL, host: HOST, rpcHost: authority, merchantPort, exchanges }) {
  let tls, proxy;
  const tunnels = new Set(), counters = { merchantConnect: 0, rpcConnect: 0, refusedConnect: 0 };
  const close = async () => {
    for (const socket of tunnels) socket.destroy();
    await stopServer(proxy); await stopServer(tls);
  };
  try {
    tls = httpsServer({ key: await readFile(join(ORIGINAL, 'tls/server-key.pem')),
      cert: await readFile(join(ORIGINAL, 'tls/server.pem')) }, (req, res) => {
      const event = { method: req.method, path: req.url,
        paidHeaderPresent: Boolean(req.headers['payment-signature']), at: now() };
      exchanges.push(event);
      const outgoing = httpRequest({ hostname: '127.0.0.1', port: merchantPort, path: req.url,
        method: req.method, headers: req.headers, agent: false }, incoming => {
        event.status = incoming.statusCode;
        res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
        incoming.once('error', () => res.destroy());
      });
      outgoing.once('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.once('aborted', () => outgoing.destroy()); req.pipe(outgoing);
    });
    const tlsPort = await listen(tls);
    async function bridgeRpc(socket, head, targetAuthority) {
      const selected = new URL(process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy);
      check(['http:', 'https:'].includes(selected.protocol) && !selected.username && !selected.password,
        'FRED_ORIGINAL_EGRESS_PROXY_REQUIRED');
      const upstream = selected.protocol === 'https:'
        ? tlsConnect({ host: selected.hostname, port: Number(selected.port || 443), servername: selected.hostname })
        : netConnect({ host: selected.hostname, port: Number(selected.port || 80) });
      tunnels.add(upstream); upstream.once('close', () => tunnels.delete(upstream));
      upstream.once('error', () => socket.destroy()); socket.once('error', () => upstream.destroy());
      socket.once('close', () => upstream.destroy());
      upstream.once(selected.protocol === 'https:' ? 'secureConnect' : 'connect',
        () => upstream.write('CONNECT ' + targetAuthority + ' HTTP/1.1\r\nHost: ' + targetAuthority + '\r\n\r\n'));
      let buffer = Buffer.alloc(0);
      const handshake = data => {
        buffer = Buffer.concat([buffer, data]);
        if (buffer.length > 16384) { upstream.destroy(); socket.destroy(); return; }
        const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return;
        upstream.removeListener('data', handshake);
        if (!/^HTTP\/1\.[01] 200(?: |\r)/.test(buffer.toString('latin1', 0, end))) {
          upstream.destroy(); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return;
        }
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (buffer.length > end + 4) socket.write(buffer.subarray(end + 4));
        if (head.length) upstream.write(head);
        socket.pipe(upstream); upstream.pipe(socket);
      };
      upstream.on('data', handshake);
    }
    proxy = httpServer((req, res) => { res.writeHead(405); res.end(); });
    proxy.on('connect', (req, socket, head) => {
      tunnels.add(socket); socket.once('close', () => tunnels.delete(socket));
      if (req.url === HOST + ':443' && !head.length) {
        counters.merchantConnect++;
        const target = netConnect({ host: '127.0.0.1', port: tlsPort }, () => {
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); socket.pipe(target); target.pipe(socket);
        });
        tunnels.add(target); target.once('close', () => tunnels.delete(target));
        target.once('error', () => socket.destroy()); socket.once('error', () => target.destroy());
        socket.once('close', () => target.destroy());
      } else if (req.url === authority + ':443' && !head.length) {
        counters.rpcConnect++; bridgeRpc(socket, head, req.url).catch(() => socket.destroy());
      } else { counters.refusedConnect++; socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); }
    });
    return { proxyUrl: 'http://127.0.0.1:' + await listen(proxy), tlsPort, counters, close };
  } catch (error) { await close(); throw error; }
}
async function finalizeDeliveries({ state, buyer, workspace, directory, signal }) {
  const record = await optionalJson(join(directory, 'accounting.json'), 4 * 1024 * 1024)
    ?? { schema: 'stellar-forge.fred-native-accounting.v1', receiverId: state.id, workspace, entries: {} };
  check(record.receiverId === state.id && record.workspace === workspace, 'FRED_ORIGINAL_ACCOUNTING_SELECTION_CHANGED');
  for (const role of roles) {
    const delivered = state.results[role]; if (!delivered) continue;
    const intentId = delivered.intentId;
    if (['FINALIZED', 'IDEMPOTENT_FINALIZED'].includes(record.entries[intentId]?.result?.outcome)) continue;
    const operation = buyer.operation(intentId);
    const result = await operation.recover();
    check(result?.record.intentId === intentId, 'FRED_ORIGINAL_NATIVE_RESULT_REQUIRED');
    const metadata = await readPrivateJson(join(operation.directory, 'operation.json'), 131072);
    const attempt = await readPrivateJson(join(operation.directory, 'attempt.json'), 131072);
    const config = await readPrivateJson(operation.configPath, 65536);
    check(metadata.configSha256 === result.record.configSha256 && attempt.configSha256 === metadata.configSha256 &&
      attempt.intentId === intentId && config.operation.intentId === intentId,
      'FRED_ORIGINAL_ACCOUNTING_ATTEMPT_CHANGED');
    const body = config.operation.bodyFile ? await readBytes(config.operation.bodyFile, 16 * 1024 * 1024) : null;
    const { finalizeOriginalAttempt } = await import('../../sf88-operator-buyer-cli/finalization.mjs');
    const finalized = await finalizeOriginalAttempt({ configurationPath: operation.configPath,
      configSha256: metadata.configSha256, intentId,
      evidencePath: join(config.evidenceDir, hash(intentId) + '.json'),
      sourceEvidenceDirectory: config.evidenceDir, bodySha256: body ? hash(body) : null,
      bodyBytes: body?.length ?? 0, attemptStartedAt: attempt.startedAt, workspace, signal });
    record.entries[intentId] = { role, ...finalized };
    await atomicJson(directory, 'accounting.json', record);
    check(['FINALIZED', 'IDEMPOTENT_FINALIZED'].includes(finalized.result.outcome), 'FRED_ORIGINAL_ACCOUNTING_CONTINUATION_REQUIRED');
    print({ phase: 'ORIGINAL_ACCOUNTING_FINALIZED', role, intentId, outcome: finalized.result.outcome });
  }
  return record;
}

export async function runFredNativeHost({ directory, configFile, phase = 'run', signal } = {}) {
  check(['run', 'browser', 'status'].includes(phase), 'FRED_NATIVE_HOST_PHASE_REQUIRED');
  const selected = await configuration(configFile, directory);
  check(process.env.NODE_EXTRA_CA_CERTS === selected.caFile &&
    (process.execArgv.includes('--use-system-ca') || /(?:^|\s)--use-system-ca(?:\s|$)/.test(process.env.NODE_OPTIONS ?? '')),
    'FRED_NATIVE_HOST_TRUST_LAUNCH_REQUIRED');
  return withPrivateLock(selected.directory, 'native-host.lock', async () => {
    let receiverConfig = await optionalJson(selected.receiverConfigFile, 131072);
    if (phase !== 'run') {
      check(receiverConfig?.schema === 'stellar-forge.fred-receiver-config.v1', 'FRED_ORIGINAL_RECEIVER_CONFIG_REQUIRED');
      if (phase === 'status') return readFredReceiver({ directory: selected.projectDirectory, id: receiverConfig.id });
      receiverConfig = await updateBrowser(selected, receiverConfig);
      return runFredReceiver({ directory: selected.projectDirectory, configFile: selected.receiverConfigFile, phase, signal, onProgress: print });
    }
    const workspace = join(selected.originalDirectory, 'operator-workspace');
    const active = await openWorkspace(['--dir', workspace], { accounting: true });
    const accounts = await readPrivateJson(join(selected.originalDirectory, 'accounts.public.json'), 65536);
    check(active.manifest.network === 'stellar:testnet' && active.config.trustedPayer === accounts.buyer &&
      active.config.operation.expect.network === 'stellar:testnet' &&
      active.config.operation.expect.asset === accounts.asset &&
      active.config.operation.expect.payTo === accounts.merchant, 'FRED_ORIGINAL_TESTNET_TERMS_CHANGED');
    const origin = active.config.buyerTransport?.origin, url = new URL(origin);
    check(url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.password &&
      !url.search && !url.hash && !url.port && active.config.buyerTransport.mode === 'explicit-connect' &&
      typeof active.config.buyerTransport.proxyEnv === 'string', 'FRED_ORIGINAL_BUYER_TRANSPORT_REQUIRED');
    const rpc = new URL(active.manifest.signer.rpcUrl);
    check(rpc.origin === 'https://soroban-testnet.stellar.org' && rpc.pathname === '/' &&
      !rpc.search && !rpc.hash && !rpc.username && !rpc.password, 'FRED_ORIGINAL_TESTNET_RPC_REQUIRED');
    const certificate = new X509Certificate(await readFile(join(selected.originalDirectory, 'tls/server.pem')));
    check(certificate.checkHost(url.hostname) !== undefined, 'FRED_ORIGINAL_TLS_HOST_CHANGED');
    const originalWorkspace = await readPrivateJson(join(workspace, 'workspace.json'), 65536);
    const originalSource = await realpath(dirname(dirname(originalWorkspace.sourceCli)));
    const originalModule = path => import(pathToFileURL(join(originalSource, path)).href);
    const [{ createNativeFacilitator }, { startFacilitatorServer }] = await Promise.all([
      originalModule('native-facilitator/runtime.mjs'), originalModule('native-facilitator/server.mjs')]);
    const policy = await readPrivateJson(join(selected.originalDirectory, 'facilitator.json'), 65536);
    check(policy.network === 'stellar:testnet' && policy.rpcUrl === rpc.origin &&
      policy.operations.ownershipDirectory === join(selected.originalDirectory, 'signer-ownership') &&
      policy.payments.maxAtomic === '10000' && policy.signers.length === 1 &&
      policy.signers[0].address === accounts.fee, 'FRED_ORIGINAL_FACILITATOR_CHANGED');
    const operatorProfile = Object.fromEntries(['operator', 'signerModule', 'trustedPayer', 'buyerTransport',
      'requestTimeoutMs', 'bodyCaptureTimeoutMs'].filter(key => active.config[key] !== undefined).map(key => [key, active.config[key]]));
    await retained(selected.directory, 'host-plan.json', { schema: 'stellar-forge.fred-native-host-plan.v1',
      projectDirectory: selected.projectDirectory, originalDirectory: selected.originalDirectory,
      receiverConfigFile: selected.receiverConfigFile, workspace, origin, rpc: rpc.origin,
      payer: accounts.buyer, merchant: accounts.merchant, asset: accounts.asset,
      operatorProfileSha256: digest(operatorProfile) });
    const environmentBefore = new Map();
    const setEnv = (key, value) => { if (!environmentBefore.has(key)) environmentBefore.set(key, process.env[key]); process.env[key] = value; };
    const restoreEnvironment = () => {
      for (const [key, value] of environmentBefore) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      environmentBefore.clear();
    };
    const exchanges = await optionalJson(join(selected.directory, 'exchanges.json'), 4 * 1024 * 1024) ?? [];
    let facilitator, facilitatorHttp, bridge, reservation, buyer, drained = false, accounting;
    let closePromise;
    const close = () => closePromise ??= (async () => {
      const result = { at: now() }; let failure;
      try {
        if (facilitatorHttp) result.facilitator = await facilitatorHttp.close();
        else if (facilitator) result.facilitator = await facilitator.drain();
      } catch (error) { failure = error; result.error = error.code ?? 'FRED_FACILITATOR_DRAIN_INTERRUPTED'; }
      finally {
        try { await bridge?.close(); }
        finally { try { await stopServer(reservation); } finally { restoreEnvironment(); } }
      }
      await atomicJson(selected.directory, 'shutdown.json', result);
      if (failure) throw failure;
      drained = true;
      print({ phase: 'ORIGINAL_NATIVE_SERVICES_DRAINED', at: result.at });
    })();
    try {
      const custody = await readPrivateJson(join(selected.originalDirectory, 'accounts.private.json'), 65536);
      setEnv(active.manifest.signer.secretEnv, custody.accounts.buyer.secret);
      setEnv(policy.signers[0].secretEnv, custody.accounts.fee.secret);
      for (const [key, value] of Object.entries(active.operatorEnvironment)) setEnv(key, value);
      setEnv('SF36_OBSERVER_USE_SYSTEM_CA', '1');
      // SF88 starts a new Node executable without inheriting this process's execArgv.
      // Carry the original host's trust selection into native signer/RPC children.
      setEnv('NODE_OPTIONS', ((process.env.NODE_OPTIONS ?? '') + ' --use-system-ca').trim());
      facilitator = await createNativeFacilitator(policy, { environment: process.env });
      const listener = await optionalJson(join(selected.directory, 'facilitator-listener.json'), 65536);
      let requestedPort = listener?.port ?? 0;
      if (receiverConfig) {
        const configured = new URL(receiverConfig.facilitator);
        check(configured.protocol === 'http:' && configured.hostname === '127.0.0.1' &&
          !configured.username && !configured.password && !configured.search && !configured.hash,
          'FRED_ORIGINAL_FACILITATOR_LISTENER_REQUIRED');
        requestedPort = Number(configured.port);
      }
      facilitatorHttp = await startFacilitatorServer({ facilitator, port: requestedPort });
      await retained(selected.directory, 'facilitator-listener.json', {
        url: facilitatorHttp.url, port: Number(new URL(facilitatorHttp.url).port) });
      if (!receiverConfig) {
        check(selected.receiver.id, 'FRED_RECEIVER_ID_REQUIRED');
        reservation = netServer();
        const merchantPort = await listen(reservation);
        const buyerConfig = join(selected.directory, 'buyer-settings.json');
        await retained(selected.directory, 'buyer-settings.json', { runtimeDirectory: selected.buyerRuntimeDirectory,
          stateDirectory: selected.buyerStateDirectory, operatorProfile, timeoutMs: 600000 });
        receiverConfig = { ...selected.receiver, schema: 'stellar-forge.fred-receiver-config.v1',
          buyerConfig, origin, merchantPort, facilitator: facilitatorHttp.url, allowLocalFacilitator: true,
          payment: { scheme: 'exact', network: 'stellar:testnet', asset: accounts.asset,
            payTo: accounts.merchant, amount: '10000', maxTimeoutSeconds: 600 },
          ...(selected.input.browser ? { browser: selected.input.browser } : {}) };
        await atomicJson(dirname(selected.receiverConfigFile), basename(selected.receiverConfigFile), receiverConfig, { exclusive: true });
      }
      check(receiverConfig.schema === 'stellar-forge.fred-receiver-config.v1' && new URL(receiverConfig.origin).origin === url.origin &&
        new URL(receiverConfig.facilitator).href === new URL(facilitatorHttp.url).href && receiverConfig.allowLocalFacilitator === true &&
        Number.isInteger(receiverConfig.merchantPort) && receiverConfig.merchantPort >= 1 && receiverConfig.merchantPort <= 65535,
        'FRED_ORIGINAL_RECEIVER_TRANSPORT_CHANGED');
      receiverConfig = await updateBrowser(selected, receiverConfig);
      const buyerConfigFile = resolve(dirname(selected.receiverConfigFile), receiverConfig.buyerConfig);
      const buyerSettings = await readPrivateJson(buyerConfigFile, 65536);
      const savedProfile = typeof buyerSettings.operatorProfile === 'string'
        ? await readPrivateJson(buyerSettings.operatorProfile, 65536) : buyerSettings.operatorProfile;
      for (const key of ['operator', 'signerModule', 'trustedPayer', 'buyerTransport'])
        same(savedProfile?.[key], operatorProfile[key], 'FRED_ORIGINAL_BUYER_PROFILE_CHANGED');
      buyer = await new Buyer(buyerSettings).ready();
      bridge = await transport({ originalDirectory: selected.originalDirectory, host: url.hostname, rpcHost: rpc.hostname,
        merchantPort: receiverConfig.merchantPort, exchanges });
      setEnv(active.config.buyerTransport.proxyEnv, bridge.proxyUrl);
      await atomicJson(selected.directory, 'running-services.json', { origin, merchantPort: receiverConfig.merchantPort,
        facilitator: facilitatorHttp.url, tlsPort: bridge.tlsPort, proxyUrl: bridge.proxyUrl,
        receiverConfigFile: selected.receiverConfigFile, buyerConfigFile, recordedAt: now() });
      await stopServer(reservation); reservation = null;
      const result = await runFredReceiver({ directory: selected.projectDirectory, configFile: selected.receiverConfigFile,
        phase: 'run', signal, onProgress: async progress => {
          print(progress);
          const state = await readFredReceiver({ directory: selected.projectDirectory, id: receiverConfig.id });
          accounting = await finalizeDeliveries({ state, buyer, workspace, directory: selected.directory, signal });
          if (progress.phase === 'browser' && state.results.nativeComplete) await close();
        } });
      if (!drained) accounting = await finalizeDeliveries({ state: result, buyer, workspace, directory: selected.directory, signal });
      const output = { schema: 'stellar-forge.fred-native-host-result.v1', state: result.state, at: now(),
        projectDirectory: selected.projectDirectory, receiverDirectory: result.directory,
        receiverConfigFile: selected.receiverConfigFile, buyerConfigFile, native: result.results.nativeComplete,
        browser: result.results.browser ?? null, accounting, transport: bridge.counters,
        facilitator: facilitator.status() };
      await atomicJson(selected.directory, 'host-result.json', output);
      return output;
    } catch (error) {
      await atomicJson(selected.directory, 'host-error.json', { at: now(), code: error.code ?? 'FRED_NATIVE_HOST_INTERRUPTED',
        receiverConfigFile: selected.receiverConfigFile, projectDirectory: selected.projectDirectory }).catch(() => {});
      throw error;
    } finally {
      await close().catch(async error => atomicJson(selected.directory, 'shutdown-error.json',
        { at: now(), code: error.code ?? 'FRED_HOST_DRAIN_INTERRUPTED' }).catch(() => {}));
      await atomicJson(selected.directory, 'exchanges.json', exchanges).catch(() => {});
      restoreEnvironment();
    }
  });
}

/** Start the same worker in a genuine controlling PTY with original CA selection. */
export async function launchFredNativeHost({ directory, configFile, phase = 'run' } = {}) {
  const selected = await configuration(configFile, directory);
  await realpath(selected.caFile);
  const args = ['--use-system-ca', SELF, '--worker', '--project', selected.projectDirectory,
    '--config', selected.configFile, '--phase', phase];
  const env = { ...process.env, NODE_EXTRA_CA_CERTS: selected.caFile, SF36_OBSERVER_USE_SYSTEM_CA: '1' };
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const executable = phase === 'run' ? selected.terminalScript : process.execPath;
  const invocation = phase === 'run'
    ? ['--quiet', '--return', '--flush', '--append', '--command', [process.execPath, ...args].map(quote).join(' '),
      join(selected.directory, 'native-terminal.log')] : args;
  return new Promise((done, reject) => {
    const mask = process.umask(0o077); let child;
    try { child = spawn(executable, invocation, { shell: false, env, stdio: 'inherit' }); }
    finally { process.umask(mask); }
    const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
    const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => {
      cleanup();
      if (code !== 0) { const error = new Error('Continue the original FRED host checkpoint.'); error.code = 'FRED_NATIVE_HOST_WORKER_INTERRUPTED'; error.exitCode = code; error.signal = signal; reject(error); }
      else done({ state: 'WORKER_EXITED', directory: selected.directory, receiverConfigFile: selected.receiverConfigFile, exitCode: code });
    });
  });
}
export async function main(args = process.argv.slice(2)) {
  process.umask(0o077);
  const worker = args[0] === '--worker'; if (worker) args = args.slice(1);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    check(['--project', '--config', '--phase'].includes(key) && typeof value === 'string' && value.length > 0 &&
      !Object.hasOwn(options, key), 'FRED_NATIVE_HOST_ARGUMENTS_REQUIRED');
    options[key] = value;
  }
  check(options['--project'] && options['--config'], 'FRED_NATIVE_HOST_ARGUMENTS_REQUIRED');
  const selected = { directory: resolve(options['--project']), configFile: resolve(options['--config']), phase: options['--phase'] ?? 'run' };
  if (!worker) return launchFredNativeHost(selected);
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { const result = await runFredNativeHost({ ...selected, signal: controller.signal }); print(result); return result; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { print({ code: error.code ?? 'FRED_NATIVE_HOST_INTERRUPTED' }); process.exitCode = 1; });
