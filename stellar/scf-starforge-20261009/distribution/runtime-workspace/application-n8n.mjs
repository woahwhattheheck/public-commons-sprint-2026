// MIT. Complete n8n merchant onboarding through the existing installed Applications lifecycle.
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need, digest } from './storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/n8n';
const STARTUP = 'stellar-forge.n8n-merchant-launch.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });
const sourceFiles = ['config.mjs', 'store.mjs', 'client.mjs', 'runtime.mjs', 'prepare.mjs', 'merchant.mjs',
  'launch.mjs', 'cli.mjs', 'workspace/server.mjs'];
const preparedFiles = ['n8n-merchant.json', 'merchant.json', 'application.mjs', 'n8n-prepared.json'];

export function n8nApplication(common) {
  return {
    id: 'n8n-merchant', command: 'n8n-merchant', title: 'n8n automation merchant', terminal: false,
    requiredSource: SOURCE + '/launch.mjs',
    description: 'Prepare selected automations, operate the original paid jobs and customer results, and recover retained n8n executions.',
    fields: [
      field('directory', 'Private merchant directory', 'path', true,
        'Select the original prepared merchant, or a new directory below an existing private parent.'),
      field('configurationFile', 'Original n8n merchant configuration', 'path', false,
        'Required for a new merchant. Reopening retains the same configuration and prepared application.'),
      field('nativeFactory', 'Original native payment factory', 'path', false,
        'Optional existing factory module for this configured seller.'),
      field('startWorker', 'Start the original job worker', 'boolean', false,
        'When selected, the original worker resumes eligible settled jobs from this merchant.'),
      field('sellerPort', 'Local seller port', 'port'),
      field('customerPort', 'Local customer port', 'port'),
      field('operationsPort', 'Local seller operations port', 'port'),
      field('jobsOperatorPort', 'Local jobs operations port', 'port'),
      ...common,
    ],
  };
}

export async function prepareN8nApplication(settings, inputPath, runtimeDirectory) {
  const workspace = await inputPath(settings.directory, 'directory', Boolean(settings.configurationFile), true);
  const inputs = [workspace];
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false, source: false });
  const native = join(runtime.sourceRoot, SOURCE);
  for (const name of sourceFiles) inputs.push(await inputPath(join(native, name), 'file'));
  const original = await import(pathToFileURL(join(native, 'prepare.mjs')).href);
  const configuration = await import(pathToFileURL(join(native, 'config.mjs')).href);
  need(typeof original.inspectN8nMerchant === 'function' && typeof original.prepareN8nMerchant === 'function' &&
    typeof configuration.readN8nConfiguration === 'function', 'APPLICATION_N8N_SOURCE_REQUIRED');
  let configured;
  if (settings.configurationFile) {
    const source = await inputPath(settings.configurationFile, 'file');
    inputs.push(source);
    configured = await configuration.readN8nConfiguration(source.path);
    need(configured.path === source.path && digest(configured.bytes) === source.sha256,
      'APPLICATION_N8N_CONFIGURATION_CHANGED', 'Review the current original n8n configuration');
  }
  let initialized = false;
  if (workspace.exists) {
    for (const name of preparedFiles) {
      const path = join(workspace.path, name);
      try {
        const info = await lstat(path);
        need(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077),
          'APPLICATION_N8N_PRIVATE_PREPARATION_REQUIRED');
        inputs.push(await inputPath(path, 'file'));
        if (name === 'n8n-prepared.json') initialized = true;
        if (name === 'n8n-merchant.json' && configured)
          need((await readFile(path)).equals(configured.bytes), 'APPLICATION_N8N_CONFIGURATION_CHANGED',
            'Continue this preparation with its original configuration');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  if (initialized) {
    const retained = await original.inspectN8nMerchant(workspace.path);
    if (configured) need(retained.record.inputSha256 === digest(configured.bytes) &&
      retained.configurationSha256 === configured.configurationSha256, 'APPLICATION_N8N_CONFIGURATION_CHANGED',
    'Reopen the original prepared merchant with its saved configuration');
  } else need(configured, 'APPLICATION_N8N_CONFIGURATION_REQUIRED', 'Choose the original configuration to initialize this merchant');
  const args = ['serve', '--directory', workspace.path, '--managed-source', native];
  if (settings.configurationFile) args.push('--initialize', settings.configurationFile);
  if (settings.nativeFactory) {
    const factory = await inputPath(settings.nativeFactory, 'file');
    inputs.push(factory); args.push('--native-factory', factory.path);
  }
  if (settings.startWorker) args.push('--start-worker');
  for (const [name, option] of [['sellerPort', '--seller-port'], ['customerPort', '--customer-port'],
    ['operationsPort', '--operations-port'], ['jobsOperatorPort', '--jobs-operator-port']])
    if (settings[name] !== undefined) args.push(option, String(settings[name]));
  // The original preparation owns directory creation and interrupted-file
  // recovery. Review and Save retain its selected path without creating it.
  return { args, inputs, createDirectories: [] };
}

function option(request, name, optional = false) {
  need(Array.isArray(request.args) && request.args[0] === 'serve', 'APPLICATION_N8N_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && !positions.length) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_N8N_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

export async function n8nStartup(request, text, context = {}) {
  if (request.command !== 'n8n-merchant' || typeof text !== 'string' || text.length > 16384 ||
      !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let announcement; try { announcement = JSON.parse(text); } catch { return null; }
  if (!plain(announcement) || announcement.schema !== STARTUP || announcement.state !== 'LISTENING') return null;
  const directory = absolute(option(request, '--directory'));
  const sourceDirectory = absolute(option(request, '--managed-source'));
  const launchSourceDirectory = join(absolute(request.releaseDirectory), 'source', SOURCE);
  const nativeFactory = option(request, '--native-factory', true);
  const startWorker = request.args.includes('--start-worker');
  need(Number.isSafeInteger(context.pid) && context.pid > 0 &&
    Number.isSafeInteger(announcement.pid) && announcement.pid > 0 && announcement.pid !== context.pid &&
    announcement.ppid === context.pid && announcement.directory === directory &&
    announcement.sourceDirectory === sourceDirectory && announcement.launchSourceDirectory === launchSourceDirectory,
  'APPLICATION_N8N_STARTUP_CHANGED', 'Read the original merchant child of this managed command');
  const { readN8nMerchantLaunch } = await import(pathToFileURL(join(sourceDirectory, 'launch.mjs')).href);
  need(typeof readN8nMerchantLaunch === 'function', 'APPLICATION_N8N_LAUNCH_READER_REQUIRED');
  const ready = await readN8nMerchantLaunch({ directory, sourceDirectory, launchSourceDirectory,
    pid: announcement.pid, instanceId: announcement.instanceId, nativeFactoryPath: nativeFactory ?? null, startWorker });
  need(ready.url === announcement.url && ready.privateLaunch === announcement.privateLaunch &&
    ready.configurationSha256 === announcement.configurationSha256 &&
    ready.applicationSha256 === announcement.applicationSha256 && ready.ppid === context.pid,
  'APPLICATION_N8N_STARTUP_CHANGED');
  const port = Number(option(request, '--port', true) ?? 0);
  need(Number.isInteger(port) && port >= 0 && port <= 65535 &&
    (port === 0 || Number(new URL(ready.url).port || 80) === port), 'APPLICATION_N8N_PORT_CHANGED');
  for (const [name, flag] of [['sellerPort', '--seller-port'], ['customerPort', '--customer-port'],
    ['operationsPort', '--operations-port'], ['jobsOperatorPort', '--jobs-operator-port']])
    need(ready.requestedPorts[name] === Number(option(request, flag, true) ?? 0), 'APPLICATION_N8N_PORT_CHANGED');
  need(ready.requestedPorts.operatorPort === port, 'APPLICATION_N8N_PORT_CHANGED');
  return { url: ready.url, original: { schema: STARTUP, directory, sourceDirectory, launchSourceDirectory,
    configurationSha256: ready.configurationSha256, applicationSha256: ready.applicationSha256,
    sourceFiles: ready.sourceFiles, nativeFactoryPath: ready.nativeFactoryPath, startWorker,
    pid: ready.pid, ppid: ready.ppid, instanceId: ready.instanceId, privateLaunch: ready.privateLaunch } };
}
