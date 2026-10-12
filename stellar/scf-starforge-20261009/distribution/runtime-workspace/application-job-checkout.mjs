// MIT. Paid-job customer entry through the original Applications managed lifecycle.
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need } from './storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli';
const STARTUP = 'stellar-forge.sf88.job-workspace-launch.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function jobCheckoutApplication(common) {
  return {
    id: 'job-checkout', command: 'job-workspace', title: 'Paid application jobs', terminal: true,
    requiredSource: SOURCE + '/job-workspace/checkout/controller.mjs',
    description: 'Review a prepared application job, follow its original execution, receive the verified result and reopen the customer library.',
    fields: [
      field('stateDirectory', 'Private job customer directory', 'path', true,
        'Reopen the same customer directory, or create one directory inside an existing private parent.'),
      field('operatorWorkspace', 'Original initialized operator workspace', 'path', false,
        'Choose this workspace or the private buyer profile below.'),
      field('operatorProfile', 'Original private Node buyer profile'),
      field('terminalPython', 'Terminal Python executable', 'path', false,
        'Defaults to /usr/bin/python3; the existing terminal carries the original buyer approval.'),
      ...common,
    ],
  };
}

export function validateJobCheckoutSelection(settings) {
  need(Boolean(settings.operatorWorkspace) !== Boolean(settings.operatorProfile),
    'APPLICATION_JOB_OPERATOR_SELECTION_REQUIRED',
    'Choose the existing original operator workspace or Node buyer profile');
}

export async function prepareJobCheckoutApplication(settings, runtimeDirectory, inputPath) {
  validateJobCheckoutSelection(settings);
  const state = await inputPath(settings.stateDirectory, 'directory', true, true);
  const inputs = [state], createDirectories = state.exists ? [] : [state.path];
  const args = ['serve', '--state', state.path];
  if (settings.operatorWorkspace) {
    const selected = await inputPath(settings.operatorWorkspace, 'directory', false, true);
    inputs.push(selected);
    for (const name of ['workspace.json', 'operator.json'])
      inputs.push(await inputPath(join(selected.path, name), 'file'));
    args.push('--operator-workspace', selected.path);
  } else {
    const selected = await inputPath(settings.operatorProfile, 'file');
    const profile = await lstat(selected.path);
    need(profile.isFile() && !profile.isSymbolicLink() && !(profile.mode & 0o077) &&
      (process.getuid === undefined || profile.uid === process.getuid()),
    'APPLICATION_JOB_PRIVATE_PROFILE_REQUIRED', 'Use the original private profile owned by this operator');
    inputs.push(selected);
    args.push('--operator-profile', selected.path);
  }
  // The application cannot select a different executable or customer runtime.
  // Its original SF88 source comes from the same reviewed merchant installation.
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false, source: false });
  const native = join(runtime.sourceRoot, SOURCE);
  for (const name of ['cli.mjs', 'job-workspace/launch.mjs', 'job-workspace/checkout/controller.mjs'])
    inputs.push(await inputPath(join(native, name), 'file'));
  args.push('--runtime', native);
  return { args, inputs, createDirectories };
}

function selectedValue(request, name, optional = false) {
  need(Array.isArray(request.args) && request.args[0] === 'serve', 'APPLICATION_JOB_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && !positions.length) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_JOB_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

export async function jobCheckoutStartup(request, text) {
  if (request.command !== 'job-workspace' || typeof text !== 'string' || text.length > 16384 ||
      !text.startsWith('{')) return null;
  let announcement;
  try { announcement = JSON.parse(text); } catch { return null; }
  if (!plain(announcement) || announcement.schema !== STARTUP || announcement.state !== 'LISTENING') return null;
  const directory = absolute(selectedValue(request, '--state'));
  const runtimeDirectory = absolute(selectedValue(request, '--runtime'));
  const operatorWorkspace = selectedValue(request, '--operator-workspace', true);
  const operatorProfile = selectedValue(request, '--operator-profile', true);
  validateJobCheckoutSelection({ operatorWorkspace, operatorProfile });
  if (operatorWorkspace !== undefined) absolute(operatorWorkspace);
  if (operatorProfile !== undefined) absolute(operatorProfile);
  const privateLaunch = join(directory, 'job-workspace-launch.json');
  need(announcement.directory === directory && announcement.runtimeDirectory === runtimeDirectory &&
    announcement.privateLaunch === privateLaunch && Number.isSafeInteger(announcement.pid) && announcement.pid > 0,
  'APPLICATION_JOB_STARTUP_CHANGED', 'The original customer startup must match the reviewed state and runtime');
  const { readJobWorkspaceLaunch } = await import(pathToFileURL(join(runtimeDirectory, 'job-workspace', 'launch.mjs')).href);
  need(typeof readJobWorkspaceLaunch === 'function', 'APPLICATION_JOB_LAUNCH_READER_REQUIRED');
  // Use the selected product's reader and its private launch record. A printed
  // URL alone never changes the Applications link or creates another customer.
  const ready = await readJobWorkspaceLaunch({ directory, runtimeDirectory, pid: announcement.pid,
    ...(operatorWorkspace === undefined ? {} : { operatorWorkspace }),
    ...(operatorProfile === undefined ? {} : { operatorProfile }) });
  need(ready.privateLaunch === privateLaunch && ready.instanceId === announcement.instanceId &&
    ready.checkoutUrl === announcement.checkoutUrl && ready.url === announcement.url &&
    ready.libraryUrl === announcement.libraryUrl && ready.collectionsUrl === announcement.collectionsUrl,
  'APPLICATION_JOB_STARTUP_CHANGED', 'Reopen the current original customer launch');
  const port = Number(selectedValue(request, '--port', true) ?? 0);
  need(Number.isInteger(port) && port >= 0 && port <= 65535 &&
    (port === 0 || Number(new URL(ready.checkoutUrl).port || 80) === port), 'APPLICATION_JOB_PORT_CHANGED');
  return { url: ready.checkoutUrl, original: { schema: STARTUP, directory, runtimeDirectory,
    operatorSelection: ready.operatorSelection, pid: ready.pid, instanceId: ready.instanceId, privateLaunch } };
}
