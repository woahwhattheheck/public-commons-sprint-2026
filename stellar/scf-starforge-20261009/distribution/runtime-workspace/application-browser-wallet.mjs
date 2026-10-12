// MIT. Existing native browser-wallet binding for the original Applications lifecycle.
import { join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { readWallet, readPrivate, readJson, digest as walletDigest, LAUNCH_SCHEMA }
  from '../../sf103-native-buyer-signer/browser-wallet/common.mjs';
import { absolute, plain, need, recordId, operationId, readJSON, regular, digest } from './storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf103-native-buyer-signer';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function browserWalletApplication(common) {
  return {
    id: 'browser-wallet', command: 'browser-wallet', title: 'Freighter buyer wallet', terminal: false,
    requiredSource: 'stellar/scf-starforge-20261009/distribution/runtime-workspace/application-browser-wallet.mjs',
    description: 'Connect the original payer account, review its exact native authorization and recover retained wallet requests. The existing buyer still owns approval, execution and delivery.',
    fields: [
      field('workspaceDirectory', 'Existing private browser-wallet workspace', 'path', true,
        'The original browser-wallet prepare output, containing wallet.json, provider.mjs and native/. Keep its initialized SF88 operator workspace at the original path.'),
      ...common,
    ],
  };
}

export async function prepareBrowserWalletApplication(settings, inputPath, runtimeDirectory) {
  const directory = absolute(settings.workspaceDirectory);
  const inputs = [await inputPath(directory, 'directory', false, true)];
  const runtime = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const commonFile = join(runtime.sourceRoot, SOURCE, 'browser-wallet/common.mjs');
  const operatorFile = join(runtime.sourceRoot, SOURCE, 'operator.mjs');
  const { readWallet: readSelectedWallet, readPrivate: readSelectedPrivate,
    readJson: readSelectedJson, digest } = await import(pathToFileURL(commonFile).href);
  const walletFile = join(directory, 'wallet.json');
  const walletSha256 = digest(await readSelectedPrivate(walletFile));
  const config = await readSelectedWallet(directory);
  const sourceBytes = await readSelectedPrivate(config.sourceBuyerConfig, 65536);
  need(digest(sourceBytes) === config.sourceBuyerSha256, 'APPLICATION_WALLET_OPERATOR_CHANGED',
    'The original operator configuration changed. Prepare and review its new wallet binding.');
  const original = await readSelectedJson(config.sourceBuyerConfig, 65536);
  const derived = await readSelectedJson(config.nativeBuyerConfig, 65536);
  need(typeof derived.signerModule === 'string' &&
    isDeepStrictEqual(derived, { ...original, signerModule: derived.signerModule }),
    'APPLICATION_WALLET_OPERATION_CHANGED', 'Keep the complete original operator request and terms.');
  const { inspectOperatorConfig } = await import(pathToFileURL(operatorFile).href);
  const bound = await inspectOperatorConfig(config.nativeSignerConfig);
  need(bound.config.buyerConfig === config.nativeBuyerConfig &&
    bound.summary.buyerConfigSha256 === config.buyerSha256 &&
    bound.config.signerProvider === config.provider && bound.expected.payer === config.payer &&
    isDeepStrictEqual(bound.expected.operation, config.operation) &&
    isDeepStrictEqual(bound.expected.body, config.body),
    'APPLICATION_WALLET_NATIVE_BINDING_CHANGED');
  const files = new Set([walletFile, config.sourceBuyerConfig,
    config.nativeBuyerConfig, config.nativeSignerConfig, config.provider,
    commonFile, operatorFile, derived.signerModule]);
  inputs.push(await inputPath(join(directory, 'native'), 'directory', false, true));
  const expected = new Map([[walletFile, walletSha256],
    [config.sourceBuyerConfig, config.sourceBuyerSha256],
    [config.nativeBuyerConfig, config.buyerSha256],
    [config.nativeSignerConfig, config.nativeSignerSha256],
    [config.provider, config.providerSha256]]);
  for (const file of files) {
    const input = await inputPath(file, 'file');
    need(!expected.has(file) || input.sha256 === expected.get(file), 'APPLICATION_WALLET_INPUT_CHANGED');
    inputs.push(input);
  }
  return { args: ['serve', '--workspace', directory], inputs };
}

/** Reuse the original immutable start review at actual child dispatch. */
export async function verifyBrowserWalletLaunch(request, operationDirectory) {
  if (request.command !== 'browser-wallet' || !request.applicationId) return;
  need(request.args?.[0] === 'serve', 'APPLICATION_WALLET_SERVE_REQUIRED');
  const directory = absolute(operationDirectory), root = dirname(dirname(directory));
  const applicationId = recordId(request.applicationId), id = operationId(basename(directory));
  const run = await readJSON(join(root, 'applications', applicationId, 'runs', id + '.json'));
  need(run.applicationId === applicationId && run.id === id &&
    run.request.command === request.command && isDeepStrictEqual(run.request.args, request.args),
    'APPLICATION_WALLET_START_REVIEW_CHANGED');
  const review = await readJSON(join(root, 'application-reviews', recordId(run.reviewId) + '.json'));
  need(review.schema === 'stellar-forge.application-start-review.v1' &&
    review.applicationId === applicationId && review.command.command === request.command &&
    isDeepStrictEqual(review.command.args, request.args) && Array.isArray(review.command.inputs),
    'APPLICATION_WALLET_START_REVIEW_CHANGED');
  for (const input of review.command.inputs) {
    if (input.kind !== 'file') continue;
    need(typeof input.sha256 === 'string' &&
      digest(await regular(absolute(input.path), 4 * 1024 * 1024)) === input.sha256,
      'APPLICATION_WALLET_INPUT_CHANGED',
      'Review the current original wallet files before launching this retained application.');
  }
}

function selectedValue(request, name, optional = false) {
  need(Array.isArray(request.args), 'APPLICATION_WALLET_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return null;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_WALLET_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

/** The original CLI prints a bounded pretty JSON object, not one JSON line. */
export function browserWalletOutputReader(request) {
  if (request.command !== 'browser-wallet' || request.args?.[0] !== 'serve') return null;
  let lines = [], bytes = 0;
  return text => {
    if (!lines.length && !text.startsWith('{')) return [];
    lines.push(text); bytes += Buffer.byteLength(text) + 1;
    if (bytes > 16384 || lines.length > 64) { lines = []; bytes = 0; return []; }
    let value;
    try { value = JSON.parse(lines.join('\n')); } catch { return []; }
    lines = []; bytes = 0;
    return plain(value) && value.state === 'LISTENING' ? [value] : [];
  };
}

export async function browserWalletStartup(request, value, operationDirectory) {
  if (request.command !== 'browser-wallet' || request.args?.[0] !== 'serve' ||
      !plain(value) || value.state !== 'LISTENING') return null;
  await verifyBrowserWalletLaunch(request, operationDirectory);
  const directory = absolute(selectedValue(request, '--workspace'));
  const config = await readWallet(directory);
  need(walletDigest(await readPrivate(config.sourceBuyerConfig, 65536)) === config.sourceBuyerSha256,
    'APPLICATION_WALLET_OPERATOR_CHANGED');
  const launch = await readJson(join(directory, 'launch.json'), 16384);
  const lock = await readJson(join(directory, 'wallet.lock'), 16384);
  need(launch.schema === LAUNCH_SCHEMA && launch.state === 'LISTENING' &&
    value.workspace === directory && value.walletId === config.walletId &&
    launch.walletId === config.walletId && launch.buyerSha256 === config.buyerSha256 &&
    value.instanceId === launch.instanceId && lock.instanceId === launch.instanceId &&
    lock.walletId === config.walletId && lock.pid === launch.pid &&
    typeof value.url === 'string' && value.url === launch.url,
    'APPLICATION_WALLET_STARTUP_CHANGED', 'Open only the original wallet instance started for this application.');
  const port = Number(selectedValue(request, '--port', true) ?? 0);
  let url;
  try { url = new URL(value.url); } catch { need(false, 'APPLICATION_WALLET_STARTUP_CHANGED'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^#session=[a-f0-9]{64}$/.test(url.hash) &&
    url.hash === '#session=' + launch.browserToken && url.origin === launch.origin &&
    Number.isInteger(port) && port >= 0 && port <= 65535 &&
    (port === 0 || Number(url.port || 80) === port), 'APPLICATION_WALLET_STARTUP_CHANGED');
  return { url: url.href, original: {
    schema: LAUNCH_SCHEMA, directory, walletId: config.walletId, instanceId: launch.instanceId,
    buyerSha256: config.buyerSha256, sourceBuyerSha256: config.sourceBuyerSha256,
    network: config.network, payer: config.payer,
    freighterVersion: launch.freighterVersion, bundleSha256: launch.bundleSha256,
  } };
}
