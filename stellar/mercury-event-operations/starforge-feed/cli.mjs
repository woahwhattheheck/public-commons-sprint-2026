#!/usr/bin/env node
// MIT. Operate the original Mercury service and paid event feed as one bundle.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeedError, integer } from '../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/model.mjs';
import { startMercuryFeedBridge } from './bridge.mjs';
import { prepareMercuryFeedBundle, readBundle, readJson, bundlePath, openBundleStore, loadPrivateEnv, privateWrite } from './plan.mjs';
import { callMercury, mercuryConfiguration, startMercuryApplication } from './native.mjs';
import { snapshotMercuryFeedBundle, restoreMercuryFeedBundle } from './continuity.mjs';

const HELP = [
  'Mercury → Starforge paid event feed',
  '',
  'prepare  --source-config ORIGINAL_JSON --out NEW_DIRECTORY',
  '         [--payment JSON --public-origin HTTPS_ORIGIN] [--source-id ID] [--feed-id ID]',
  '         [--bridge-port 8494] [--merchant-port 8492] [--workspace-port 8493] [--mercury-port 8788]',
  'status   --bundle DIRECTORY [--out NEW_JSON]',
  'bridge   --bundle DIRECTORY',
  'run      --bundle DIRECTORY [--external-mercury] [--facilitator HTTPS_URL] [--allow-local-facilitator]',
  'mercury  --bundle DIRECTORY -- NATIVE_COMMAND [NATIVE_ARGS]',
  'snapshot --bundle DIRECTORY --out NEW_DIRECTORY',
  'restore  --snapshot DIRECTORY --out NEW_DIRECTORY',
  '',
  'All commands accept --python EXECUTABLE and --provider-env-file PRIVATE_FILE.',
  'Bridge credentials are loaded from the private bundle; existing environment values take precedence.',
  'Run starts the original Mercury operator service, the retained feed desk and its saved paid merchant.',
  'Use --external-mercury only when an existing supervisor runs this exact bundle Mercury configuration.',
  'Without a saved payment plan, run starts ingestion and the desk; save actual terms there and restart.',
  'Native commands retain the original engine, provider requests, jobs, retries, exports and event keys.',
  'See README.md for scope selection, exact signature mapping, source-first recovery and deployment.',
].join('\n');
const VALUES = new Set(['bundle', 'source-config', 'out', 'payment', 'public-origin', 'source-id', 'feed-id',
  'bridge-port', 'merchant-port', 'workspace-port', 'mercury-port', 'provider-env-file', 'python', 'facilitator', 'snapshot']);
const SWITCHES = new Set(['external-mercury', 'allow-local-facilitator']);
const NATIVE_COMMANDS = new Set(['status', 'run-once', 'catchup', 'reconcile', 'list', 'show', 'retry', 'cancel', 'recover', 'export', 'backup']);
function parseOptions(args) {
  const result = {}, native = [];
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === '--') { native.push(...args.slice(index + 1)); break; }
    if (!token.startsWith('--')) throw new FeedError('OPTION_REQUIRED', 422);
    const name = token.slice(2);
    if (Object.hasOwn(result, name)) throw new FeedError('DUPLICATE_OPTION', 422, { name });
    if (SWITCHES.has(name)) { result[name] = true; continue; }
    if (!VALUES.has(name) || args[index + 1] === undefined || args[index + 1].startsWith('--'))
      throw new FeedError('INVALID_OPTION', 422, { name });
    result[name] = args[++index];
  }
  return { option: result, native };
}
function requireOption(option, name) {
  if (!option[name]) throw new FeedError('OPTION_REQUIRED', 422, { name });
  return option[name];
}
async function output(value, path) {
  if (path) await privateWrite(resolve(path), value);
  else process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  return value;
}
async function nativeFactoryFor(value, allowLocal) {
  if (!value) { if (allowLocal) throw new FeedError('FACILITATOR_REQUIRED', 422); return null; }
  let url;
  try { url = new URL(value); } catch { throw new FeedError('INVALID_FACILITATOR', 422); }
  if ((url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && url.hostname === '127.0.0.1')) ||
      url.username || url.password || url.search || url.hash) throw new FeedError('INVALID_FACILITATOR', 422);
  const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
    import('@x402/core/server'), import('../../scf-starforge-20261009/sf30-seller-sdk/native-factory.mjs'),
  ]);
  return compiled => createNativeSellerServer(compiled, {
    facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }),
  });
}
export async function startMercuryFeedBundle({ bundle, python = 'python3', externalMercury = false, nativeFactory = null } = {}) {
  await mercuryConfiguration(bundle);
  const store = await openBundleStore(bundle), sessions = [];
  let closing, shuttingDown = false;
  const onSignal = () => { close().catch(() => { process.exitCode = 1; }); };
  const close = () => closing ??= (async () => {
    shuttingDown = true;
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, onSignal);
    const errors = [];
    for (const session of [...sessions].reverse()) {
      try { await session.close(); } catch (error) { errors.push(error); }
    }
    try { store.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Bundle shutdown failed');
  })();
  try {
    const bridge = await startMercuryFeedBridge({ store, sourceId: bundle.config.sourceId,
      scope: bundle.config.scope, port: bundle.config.ports.bridge, allowLocalProvider: bundle.config.allowLocalProvider });
    sessions.push(bridge);
    const { startWebhookFeedWorkspace } = await import('../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/workspace.mjs');
    const workspace = await startWebhookFeedWorkspace({ store, port: bundle.config.ports.workspace });
    sessions.push(workspace);
    const result = { schema: 'stellar-forge.mercury-feed-session.v1', storeId: store.storeId,
      bridge: bridge.url, feedWorkspace: workspace.url, feedIds: bundle.config.feedIds };
    const plan = store.merchantPlan().plan;
    if (plan) {
      const { startWebhookFeedMerchant } = await import('../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/merchant.mjs');
      const merchant = await startWebhookFeedMerchant({ store, plan, port: bundle.config.ports.merchant, nativeFactory });
      sessions.push(merchant); result.merchant = { url: merchant.url, mode: merchant.mode, feeds: merchant.feeds };
    }
    if (externalMercury) result.mercury = { managed: false, config: bundlePath(bundle.directory, bundle.config.mercuryConfig) };
    else {
      const mercury = await startMercuryApplication({ bundle, python });
      sessions.push(mercury); result.mercury = { managed: true, url: mercury.origin };
      mercury.exited.then(status => {
        if (shuttingDown) return;
        process.stderr.write(JSON.stringify({ error: 'MERCURY_PROCESS_EXITED', ...status }) + '\n');
        process.exitCode = 1; close().catch(() => { process.exitCode = 1; });
      });
    }
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, onSignal);
    return { store, sessions, result, close };
  } catch (error) { await close(); throw error; }
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === 'help' || args[0] === '--help') { process.stdout.write(HELP + '\n'); return null; }
  const [command, ...rest] = args, { option, native } = parseOptions(rest);
  if (native.length && command !== 'mercury') throw new FeedError('NATIVE_ARGUMENTS_REQUIRE_MERCURY_COMMAND', 422);
  const python = option.python ?? 'python3';
  if (option['provider-env-file']) await loadPrivateEnv(resolve(option['provider-env-file']));
  if (command === 'prepare') {
    const ports = {};
    for (const name of ['bridge', 'merchant', 'workspace', 'mercury'])
      if (option[name + '-port']) ports[name] = integer(option[name + '-port'], name + '-port', 1, 65535);
    return output(await prepareMercuryFeedBundle({ sourceConfig: requireOption(option, 'source-config'),
      directory: requireOption(option, 'out'), sourceId: option['source-id'] ?? 'mercury', feedId: option['feed-id'] ?? 'mercury-events',
      ...(option.payment ? { payment: await readJson(option.payment) } : {}),
      ...(option['public-origin'] ? { publicOrigin: option['public-origin'] } : {}), ports, python }));
  }
  if (command === 'restore') return output(await restoreMercuryFeedBundle({
    directory: requireOption(option, 'snapshot'), destination: requireOption(option, 'out'), python,
  }));
  const bundle = await readBundle(requireOption(option, 'bundle'));
  await loadPrivateEnv(bundlePath(bundle.directory, bundle.config.bridgeEnvFile));
  if (command === 'snapshot') return output(await snapshotMercuryFeedBundle({
    directory: bundle.directory, destination: requireOption(option, 'out'), python,
  }));
  if (command === 'mercury') {
    if (!native.length || !NATIVE_COMMANDS.has(native[0]) || native.some(token => /^--(?:config|env-file)(?:=|$)/.test(token)))
      throw new FeedError('ORIGINAL_MERCURY_SUBCOMMAND_REQUIRED', 422, { commands: [...NATIVE_COMMANDS] });
    const configuration = await mercuryConfiguration(bundle);
    return callMercury({ configPath: configuration.path, args: native, python, inherit: true });
  }
  if (command === 'run') {
    const session = await startMercuryFeedBundle({ bundle, python, externalMercury: option['external-mercury'] === true,
      nativeFactory: await nativeFactoryFor(option.facilitator, option['allow-local-facilitator']) });
    await output(session.result); return session;
  }
  const store = await openBundleStore(bundle);
  let retained = false;
  try {
    if (command === 'status') {
      const configuration = await mercuryConfiguration(bundle);
      const mercury = await callMercury({ configPath: configuration.path, args: ['status'], python });
      return output({ schema: 'stellar-forge.mercury-feed-status.v1', directory: bundle.directory,
        scope: bundle.config.scope, feed: store.status(), mercury }, option.out);
    }
    if (command !== 'bridge') throw new FeedError('UNKNOWN_COMMAND', 422);
    const bridge = await startMercuryFeedBridge({ store, sourceId: bundle.config.sourceId, scope: bundle.config.scope,
      port: bundle.config.ports.bridge, allowLocalProvider: bundle.config.allowLocalProvider });
    let closing;
    const onSignal = () => { close().catch(() => { process.exitCode = 1; }); };
    const close = () => closing ??= (async () => {
      for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, onSignal);
      try { await bridge.close(); } finally { store.close(); }
    })();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, onSignal);
    retained = true; await output({ schema: 'stellar-forge.mercury-feed-session.v1', storeId: store.storeId, bridge: bridge.url });
    return { store, bridge, close };
  } finally { if (!retained) store.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(JSON.stringify({ error: error instanceof FeedError ? error.code : error.code ?? 'MERCURY_FEED_COMMAND_FAILED',
    ...(error instanceof FeedError ? error.details : {}) }) + '\n'); process.exitCode = 1;
});
