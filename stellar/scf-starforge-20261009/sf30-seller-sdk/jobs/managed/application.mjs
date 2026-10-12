// MIT. Merchant Applications selection and startup over the original installed jobs command.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../../sf46-release/runtime-package.mjs';
import { absolute, plain, need } from '../../../distribution/runtime-workspace/storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/jobs';
const SELECTION = 'stellar-forge.job-service-selection.v1';
const STARTUP = 'stellar-forge.job-service-launch.v1';
export const JOB_MERCHANT_APPLICATION_ID = 'paid-job-merchant';
const LANDINGS = Object.freeze(['jobs', 'inputs', 'resolutions', 'deliveries']);
const PATHS = Object.freeze([
  ['configurationFile', 'configPath', '--config', true],
  ['nativeFactoryFile', 'nativeFactoryPath', '--native-factory', false],
  ['intakeConfigurationFile', 'intakeConfigPath', '--intake-config', false],
  ['deliveryConfigurationFile', 'deliveryConfigPath', '--delivery-config', false],
]);
const PORTS = Object.freeze([
  ['sellerPort', 'sellerPort', '--seller-port'], ['customerPort', 'customerPort', '--customer-port'],
  ['port', 'operatorPort', '--operator-port'], ['operationsPort', 'operationsPort', '--operations-port'],
]);
const BOOLEAN = Object.freeze([['startWorker', '--start-worker'], ['startDelivery', '--start-delivery']]);
const LINKS = Object.freeze([
  ['jobs', 'Application jobs', 'operator'],
  ['inputs', 'Input receiving', 'inputReceiving'],
  ['resolutions', 'Job resolution', 'resolution'],
  ['deliveries', 'Result delivery', 'deliveries'],
]);
const FILES = Object.freeze([
  'cli.mjs', 'config.mjs', 'source-binding.mjs', 'model.mjs', 'store.mjs', 'merchant.mjs',
  'customer.mjs', 'execution.mjs', 'runner.mjs', 'workspace/server.mjs', 'workspace/identity.mjs',
  'managed/application.mjs', 'managed/selection.mjs', 'managed/launch.mjs', 'managed/service.mjs',
  'intake/config.mjs', 'intake/service.mjs', 'result-delivery/config.mjs', 'result-delivery/dispatcher.mjs',
]);
const digest = value => createHash('sha256').update(value).digest('hex');

export function jobMerchantApplication({ common, field }) {
  return {
    id: JOB_MERCHANT_APPLICATION_ID, command: 'jobs', title: 'Paid-job merchant', terminal: false,
    requiredSource: SOURCE + '/managed/service.mjs',
    description: 'Operate your original paid application jobs, file intake, worker, customer listener and resolution desk from one retained merchant.',
    fields: [
      field('stateDirectory', 'Private merchant directory', 'path', true,
        'Reopen the original merchant, or create one directory inside an existing private parent. Jobs, settlement records and received files stay here.'),
      field('configurationFile', 'Original merchant configuration', 'path', true,
        'The existing job-merchant JSON selects the trusted application, functions, prices, limits and public HTTPS origin.'),
      field('nativeFactoryFile', 'Original native payment factory', 'path', false,
        'Optional existing .mjs module exporting the nativeFactory function. It is read during review and loaded only when this merchant starts.'),
      field('intakeConfigurationFile', 'Public intake override', 'path', false,
        'Optional original intake JSON selecting which configured functions customers can request.'),
      field('deliveryConfigurationFile', 'Completed-result destinations', 'path', false,
        'Optional original result-delivery JSON containing selected destinations and secret environment names.'),
      field('deliveryDirectory', 'Existing custom result-delivery queue', 'path', false,
        'Leave empty for result-delivery inside the merchant directory. Reopen the same queue when one was already selected.'),
      field('sellerPort', 'Seller port', 'port', false,
        'Loopback HTTP port for the existing HTTPS purchase route. Use its configured proxy port, or 0 for an available port.'),
      field('customerPort', 'Customer port', 'port', false,
        'Loopback HTTP port for public intake, status, inputs and results behind the original HTTPS origin.'),
      field('operationsPort', 'Seller operations port', 'port', false,
        'Loopback port for the original seller operations view. Use 0 for an available port.'),
      field('startWorker', 'Start the original job worker', 'boolean', false,
        'Process already paid and queued jobs with the configured worker and memory limits.'),
      field('startDelivery', 'Start result delivery', 'boolean', false,
        'Start the existing signed dispatcher over the selected destination configuration and queue.'),
      field('landing', 'Open page', 'text', false,
        'jobs (default), inputs, resolutions or configured deliveries. All pages use this same merchant.'),
      ...common.map(item => item.name === 'port'
        ? { ...item, label: 'Private operator port', description: 'Use 0 for an available loopback port. Open connects to this authenticated operator.' }
        : item.name === 'environmentFile'
          ? { ...item, description: 'Private environment JSON for the original factory, application, intake access or destination secrets. Values remain on this host.' }
          : item),
    ],
  };
}
export function validateJobMerchantSettings(settings) {
  need(plain(settings), 'APPLICATION_JOB_MERCHANT_SETTINGS_REQUIRED');
  need(LANDINGS.includes(settings.landing ?? 'jobs'), 'APPLICATION_JOB_MERCHANT_LANDING_INVALID');
  need(settings.deliveryConfigurationFile || !settings.startDelivery && !settings.deliveryDirectory &&
    settings.landing !== 'deliveries', 'APPLICATION_JOB_MERCHANT_DELIVERY_REQUIRED',
  'Select the original delivery configuration for its queue, dispatcher or page.');
  const ports = PORTS.map(([name]) => settings[name] ?? 0);
  need(ports.every(value => Number.isInteger(value) && value >= 0 && value <= 65535),
    'APPLICATION_JOB_MERCHANT_PORT_INVALID');
  need(new Set(ports.filter(Boolean)).size === ports.filter(Boolean).length,
    'APPLICATION_JOB_MERCHANT_PORT_CONFLICT', 'Each fixed service port must be different.');
}

async function selectedReaders(runtimeDirectory) {
  absolute(runtimeDirectory);
  const [selection, launch] = await Promise.all([
    import(pathToFileURL(join(runtimeDirectory, 'managed/selection.mjs')).href),
    import(pathToFileURL(join(runtimeDirectory, 'managed/launch.mjs')).href),
  ]);
  need(selection.JOB_SERVICE_SELECTION_SCHEMA === SELECTION &&
    launch.JOB_SERVICE_LAUNCH_SCHEMA === STARTUP &&
    typeof selection.readJobServiceSelection === 'function' &&
    typeof selection.assertJobServiceSelection === 'function' &&
    typeof launch.readJobServiceLaunch === 'function' &&
    typeof launch.jobServiceLaunchPath === 'function',
  'APPLICATION_JOB_MERCHANT_SOURCE_REQUIRED', 'Choose the complete original merchant Applications release.');
  return { selection, launch };
}

export async function prepareJobMerchantApplication(settings, { inputPath, runtimeDirectory }) {
  validateJobMerchantSettings(settings);
  const state = await inputPath(settings.stateDirectory, 'directory', true, true);
  const inputs = [state], createDirectories = state.exists ? [] : [state.path];
  const options = { directory: state.path, landing: settings.landing ?? 'jobs' };
  const args = ['serve', '--state', state.path, '--landing', options.landing];
  for (const [setting, name, flag, required] of PATHS) {
    if (!settings[setting]) { need(!required, 'APPLICATION_JOB_MERCHANT_CONFIG_REQUIRED'); continue; }
    const chosen = await inputPath(settings[setting], 'file');
    inputs.push(chosen); options[name] = chosen.path; args.push(flag, chosen.path);
  }
  if (settings.deliveryDirectory) {
    const chosen = await inputPath(settings.deliveryDirectory, 'directory', true, true);
    inputs.push(chosen); options.deliveryDirectory = chosen.path;
    if (!chosen.exists) createDirectories.push(chosen.path);
    args.push('--delivery-state', chosen.path);
  }
  for (const [setting, name, flag] of PORTS) {
    options[name] = settings[setting] ?? 0; args.push(flag, String(options[name]));
  }
  for (const [name, flag] of BOOLEAN) {
    options[name] = settings[name] === true;
    if (options[name]) args.push(flag);
  }
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false, source: false });
  const native = join(runtime.sourceRoot, SOURCE);
  for (const name of FILES) inputs.push(await inputPath(join(native, name), 'file'));
  const original = await selectedReaders(native);
  const selected = original.selection.assertJobServiceSelection(
    await original.selection.readJobServiceSelection(options));
  need(selected.runtimeDirectory === native, 'APPLICATION_JOB_MERCHANT_RUNTIME_CHANGED');
  for (const file of selected.files) {
    const current = await inputPath(file.path, 'file');
    need(current.bytes === file.bytes && current.sha256 === file.sha256,
      'APPLICATION_JOB_MERCHANT_SOURCE_CHANGED', 'Review the original current source and service configuration.');
    if (!inputs.some(value => value.path === current.path)) inputs.push(current);
  }
  args.push('--managed-runtime', native, '--expected-selection', selected.selectionSha256);
  return {
    args, inputs, createDirectories,
    resourceKey: digest(JSON.stringify({ family: JOB_MERCHANT_APPLICATION_ID, directory: state.path })),
    jobMerchant: {
      schema: SELECTION, directory: selected.directory, configPath: selected.configPath,
      runtimeDirectory: selected.runtimeDirectory, source: selected.source,
      applicationPath: selected.applicationPath, sourceBinding: selected.sourceBinding,
      selectionSha256: selected.selectionSha256, summary: selected.summary,
      ports: selected.ports, startWorker: selected.startWorker, startDelivery: selected.startDelivery,
      landing: selected.landing,
    },
  };
}

function requestSelection(request) {
  need(request.command === 'jobs' && Array.isArray(request.args) && request.args[0] === 'serve' &&
    request.terminal !== true && !request.pythonCommand, 'APPLICATION_JOB_MERCHANT_REQUEST_CHANGED');
  const pairs = new Map([
    ['--state', 'directory'], ['--landing', 'landing'], ['--managed-runtime', 'runtimeDirectory'],
    ['--expected-selection', 'expectedSelection'],
    ...PATHS.map(([, name, flag]) => [flag, name]), ['--delivery-state', 'deliveryDirectory'],
    ...PORTS.map(([, name, flag]) => [flag, name]),
  ]);
  const booleans = new Map(BOOLEAN.map(([name, flag]) => [flag, name]));
  const values = Object.create(null), flags = new Set();
  for (let index = 1; index < request.args.length; index++) {
    const flag = request.args[index];
    need(!flags.has(flag), 'APPLICATION_JOB_MERCHANT_REQUEST_CHANGED'); flags.add(flag);
    if (booleans.has(flag)) { values[booleans.get(flag)] = true; continue; }
    need(pairs.has(flag), 'APPLICATION_JOB_MERCHANT_REQUEST_CHANGED');
    const value = request.args[++index];
    need(typeof value === 'string' && value && !value.startsWith('--'),
      'APPLICATION_JOB_MERCHANT_REQUEST_CHANGED');
    values[pairs.get(flag)] = value;
  }
  for (const name of ['directory', 'configPath', 'runtimeDirectory']) absolute(values[name]);
  need(/^[a-f0-9]{64}$/.test(values.expectedSelection ?? '') && LANDINGS.includes(values.landing),
    'APPLICATION_JOB_MERCHANT_REQUEST_CHANGED');
  for (const [, name] of PORTS) {
    need(/^(?:0|[1-9][0-9]*)$/.test(values[name] ?? ''), 'APPLICATION_JOB_MERCHANT_PORT_INVALID');
    values[name] = Number(values[name]);
    need(Number.isInteger(values[name]) && values[name] <= 65535, 'APPLICATION_JOB_MERCHANT_PORT_INVALID');
  }
  const { runtimeDirectory, expectedSelection, ...options } = values;
  return { runtimeDirectory, expectedSelection, options };
}
export async function verifyJobMerchantLaunch(request) {
  const selected = requestSelection(request);
  const original = await selectedReaders(selected.runtimeDirectory);
  const selection = original.selection.assertJobServiceSelection(
    await original.selection.readJobServiceSelection(selected.options), selected.expectedSelection);
  need(selection.runtimeDirectory === selected.runtimeDirectory, 'APPLICATION_JOB_MERCHANT_RUNTIME_CHANGED');
  return selection;
}
export async function prepareJobMerchantChild(request, directory, originalArgs, environment) {
  requestSelection(request);
  need(Array.isArray(originalArgs) && originalArgs.every(value => typeof value === 'string') &&
    !originalArgs.includes('--managed-launch'), 'APPLICATION_JOB_MERCHANT_REQUEST_CHANGED');
  const original = await selectedReaders(absolute(requestSelection(request).runtimeDirectory));
  const file = original.launch.jobServiceLaunchPath(absolute(directory));
  return {
    executable: process.execPath, args: [...originalArgs, '--managed-launch', file],
    options: { cwd: request.homeDirectory, shell: false, env: environment,
      stdio: ['ignore', request.applicationId ? 'pipe' : 'inherit', request.applicationId ? 'pipe' : 'inherit', 3] },
  };
}

export async function jobMerchantStartup(request, text, directory) {
  if (request.command !== 'jobs' || request.args?.[0] !== 'serve' || typeof text !== 'string' ||
    text.length > 16384 || !text.startsWith('{')) return null;
  let announcement;
  try { announcement = JSON.parse(text); } catch { return null; }
  if (!plain(announcement) || announcement.schema !== STARTUP || announcement.state !== 'LISTENING') return null;
  const selected = requestSelection(request);
  const original = await selectedReaders(selected.runtimeDirectory);
  const privateLaunch = original.launch.jobServiceLaunchPath(absolute(directory));
  need(announcement.privateLaunch === privateLaunch && Number.isSafeInteger(announcement.pid) &&
    announcement.pid > 0 && typeof announcement.instanceId === 'string' &&
    announcement.selectionSha256 === selected.expectedSelection,
  'APPLICATION_JOB_MERCHANT_STARTUP_CHANGED');
  const ready = await original.launch.readJobServiceLaunch({ file: privateLaunch, expected: {
    directory: selected.options.directory, configPath: selected.options.configPath,
    runtimeDirectory: selected.runtimeDirectory, selectionSha256: selected.expectedSelection,
    pid: announcement.pid, instanceId: announcement.instanceId,
  } });
  need(ready.landing === selected.options.landing && ready.entryUrl === announcement.entryUrl &&
    ['seller', 'customer', 'operator', 'operations', 'intake', 'mode', 'inputReceiving', 'resolution',
      'deliveries', 'deliveryState'].every(name => ready[name] === announcement[name]),
  'APPLICATION_JOB_MERCHANT_STARTUP_CHANGED', 'Reopen the current original merchant launch.');
  for (const [, name] of PORTS) {
    const link = { sellerPort: 'seller', customerPort: 'customer', operatorPort: 'operator',
      operationsPort: 'operations' }[name];
    need(selected.options[name] === 0 || Number(new URL(ready[link]).port || 80) === selected.options[name],
      'APPLICATION_JOB_MERCHANT_PORT_CHANGED');
  }
  return {
    url: ready.entryUrl,
    links: LINKS.filter(([, , key]) => ready[key] !== null).map(([id, label, key]) => ({ id, label, url: ready[key] })),
    original: {
      schema: STARTUP, directory: ready.directory, configPath: ready.configPath,
      runtimeDirectory: ready.runtimeDirectory, source: ready.source,
      selectionSha256: ready.selectionSha256, pid: ready.pid, instanceId: ready.instanceId,
      privateLaunch, landing: ready.landing,
    },
  };
}
