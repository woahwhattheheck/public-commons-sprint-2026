// MIT. The original paid-job receiver inside the maintained Applications lifecycle.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need } from './storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/jobs';
const SELECTION = 'stellar-forge.job-result-receiver-selection.v1';
const STARTUP = 'stellar-forge.job-result-receiver-ready.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });
const configurationDigest = config =>
  createHash('sha256').update(JSON.stringify(config)).digest('hex');

export function jobResultReceiverApplication(common) {
  return {
    id: 'job-result-receiver', command: 'jobs', title: 'Paid-job result receiver', terminal: false,
    requiredSource: SOURCE + '/result-receiver/cli.mjs',
    description: 'Receive original completed job files, inspect their merchant and payment lineage, verify bytes and export retained results.',
    fields: [
      field('stateDirectory', 'Initialized private receiver directory', 'path', true,
        'Use the original directory created by jobs receiver init. Received files and acknowledgments remain here across starts.'),
      field('operatorPort', 'Private operator port', 'port', false,
        'Use 0 for an available loopback port. Open connects to this separate private desk.'),
      ...common.map(item => item.name === 'port'
        ? { ...item, label: 'Receiving port',
          description: 'Loopback HTTP port behind the configured HTTPS destination. Use a fixed port for a retained proxy route or 0 for an available port.' }
        : item.name === 'environmentFile'
          ? { ...item, description: 'Private environment JSON containing the HMAC secret under the name selected in receiver.json.' }
          : item),
    ],
  };
}

export async function prepareJobResultReceiverApplication(settings, {
  inputPath, runtimeDirectory, applicationEnvironment,
}) {
  const state = await inputPath(settings.stateDirectory, 'directory', false, true);
  const configFile = join(state.path, 'receiver.json');
  const before = await inputPath(configFile, 'file');
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false, source: false });
  const original = join(runtime.sourceRoot, SOURCE);
  const inputs = [state, before];
  for (const name of ['cli.mjs', 'result-receiver/cli.mjs', 'result-receiver/store.mjs',
    'result-receiver/server.mjs', 'result-delivery/wire.mjs'])
    inputs.push(await inputPath(join(original, name), 'file'));

  // Load only the selected runtime's receiver after this application is chosen.
  // Its reader supplies the canonical private root and normalized configuration.
  const { openResultReceiver } = await import(pathToFileURL(join(original, 'result-receiver/store.mjs')).href);
  const { validateSecret } = await import(pathToFileURL(join(original, 'result-delivery/wire.mjs')).href);
  need(typeof openResultReceiver === 'function' && typeof validateSecret === 'function',
    'APPLICATION_JOB_RECEIVER_SOURCE_REQUIRED', 'Choose a runtime containing the original completed-result receiver');
  const receiver = await openResultReceiver(state.path);
  const after = await inputPath(configFile, 'file');
  need(receiver.root === state.path && ['dev', 'ino', 'bytes', 'mtimeMs', 'ctimeMs', 'sha256'].every(
    key => before[key] === after[key]), 'APPLICATION_JOB_RECEIVER_CONFIG_CHANGED',
  'Review the current original receiver configuration');
  for (const name of ['results', 'incoming'])
    inputs.push(await inputPath(join(receiver.root, name), 'directory', false, true));
  const { environment } = await applicationEnvironment(settings.environmentFile);
  validateSecret(environment[receiver.config.secretEnv]);
  const operatorPort = settings.operatorPort ?? 0;
  need(Number.isInteger(operatorPort) && operatorPort >= 0 && operatorPort <= 65535,
    'APPLICATION_JOB_RECEIVER_PORT_INVALID');
  return {
    args: ['receiver', 'serve', '--root', receiver.root, '--host', '127.0.0.1',
      '--operator-port', String(operatorPort)],
    inputs,
    identity: {
      schema: SELECTION, root: receiver.root, configSha256: configurationDigest(receiver.config),
      destination: receiver.config.destination,
    },
  };
}

function selected(request, name) {
  need(Array.isArray(request.args) && request.args[0] === 'receiver' && request.args[1] === 'serve',
    'APPLICATION_JOB_RECEIVER_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_JOB_RECEIVER_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
function port(request, name) {
  const value = selected(request, name);
  need(/^(0|[1-9][0-9]*)$/.test(value), 'APPLICATION_JOB_RECEIVER_PORT_INVALID');
  const number = Number(value);
  need(Number.isInteger(number) && number >= 0 && number <= 65535, 'APPLICATION_JOB_RECEIVER_PORT_INVALID');
  return number;
}
function localAddress(value, pathname, { token = false } = {}) {
  let address;
  try { address = new URL(value); } catch { need(false, 'APPLICATION_JOB_RECEIVER_URL_INVALID'); }
  need(address.protocol === 'http:' && address.hostname === '127.0.0.1' &&
    !address.username && !address.password && !address.search && address.pathname === pathname &&
    Number(address.port || 80) >= 1 && Number(address.port || 80) <= 65535,
  'APPLICATION_JOB_RECEIVER_URL_INVALID');
  if (token) {
    need(address.hash.startsWith('#access='), 'APPLICATION_JOB_RECEIVER_URL_INVALID');
    let secret;
    try { secret = decodeURIComponent(address.hash.slice('#access='.length)); }
    catch { need(false, 'APPLICATION_JOB_RECEIVER_URL_INVALID'); }
    need(Buffer.byteLength(secret) >= 32 && Buffer.byteLength(secret) <= 512,
      'APPLICATION_JOB_RECEIVER_URL_INVALID');
  } else need(!address.hash, 'APPLICATION_JOB_RECEIVER_URL_INVALID');
  return address;
}

export async function jobResultReceiverStartup(request, text) {
  if (request.command !== 'jobs' || request.args?.[0] !== 'receiver' || request.args?.[1] !== 'serve' ||
      typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let ready;
  try { ready = JSON.parse(text); } catch { return null; }
  if (!plain(ready) || ready.schema !== STARTUP) return null;
  const original = request.jobResultReceiver;
  need(plain(original) && original.schema === SELECTION &&
    /^[a-f0-9]{64}$/.test(original.configSha256) && plain(original.destination),
  'APPLICATION_JOB_RECEIVER_SELECTION_REQUIRED');
  const root = absolute(selected(request, '--root'));
  need(original.root === root && ready.root === root && ready.configSha256 === original.configSha256 &&
    plain(ready.destination) && ready.destination.id === original.destination.id &&
    ready.destination.url === original.destination.url && Number.isSafeInteger(ready.pid) && ready.pid > 0 &&
    selected(request, '--host') === '127.0.0.1',
  'APPLICATION_JOB_RECEIVER_STARTUP_CHANGED', 'The original receiver must match the reviewed directory and configuration');
  const receiver = localAddress(ready.receiverUrl, new URL(original.destination.url).pathname);
  const operator = localAddress(ready.operatorUrl, '/', { token: true });
  const receivingPort = port(request, '--port'), operatorPort = port(request, '--operator-port');
  need((receivingPort === 0 || Number(receiver.port || 80) === receivingPort) &&
    (operatorPort === 0 || Number(operator.port || 80) === operatorPort) &&
    receiver.origin !== operator.origin, 'APPLICATION_JOB_RECEIVER_PORT_CHANGED');
  return {
    url: operator.href,
    original: {
      schema: STARTUP, root, configSha256: original.configSha256, pid: ready.pid,
      destination: original.destination, receiverUrl: receiver.href,
    },
  };
}
