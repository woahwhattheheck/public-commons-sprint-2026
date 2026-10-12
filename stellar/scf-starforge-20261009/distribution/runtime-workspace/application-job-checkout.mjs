// MIT. Paid-job Request, approval and results through the original Applications lifecycle.
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need } from './storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli';
const STARTUP = 'stellar-forge.sf88.job-workspace-launch.v1';
const CAPABILITIES = 'stellar-forge.sf88.job-workspace-applications.v1';
const MODES = Object.freeze(['browser', 'terminal']);
const LANDINGS = Object.freeze(['request', 'checkout', 'jobs', 'library', 'collections']);
const LINKS = Object.freeze([
  ['request', 'Request a job', 'intakeUrl'],
  ['checkout', 'Checkout and approval', 'checkoutUrl'],
  ['jobs', 'Purchased jobs', 'url'],
  ['library', 'Resource library', 'libraryUrl'],
  ['collections', 'Collections', 'collectionsUrl'],
]);
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function jobCheckoutApplication(common) {
  return {
    id: 'job-checkout', command: 'job-workspace', title: 'Paid application jobs', terminal: true,
    requiredSource: SOURCE + '/job-workspace/intake/controller.mjs',
    description: 'Request a merchant job, review and approve its original checkout, follow execution, then receive and reopen its verified result in the customer library.',
    fields: [
      field('stateDirectory', 'Private job customer directory', 'path', true,
        'Reopen the same customer directory, or create one directory inside an existing private parent.'),
      field('operatorWorkspace', 'Original initialized operator workspace', 'path', false,
        'Choose this workspace or the private buyer profile below.'),
      field('operatorProfile', 'Original private Node buyer profile'),
      field('approvalMode', 'Approval interface', 'text', false,
        'browser (default) opens the original approval panel; terminal uses the original managed terminal.'),
      field('landing', 'Open page', 'text', false,
        'request (default), checkout, jobs, library or collections. Every page uses the same private customer.'),
      field('terminalPython', 'Terminal Python executable', 'path', false,
        'Defaults to /usr/bin/python3. The same managed terminal retains lifecycle output and supports explicit terminal approval.'),
      ...common,
    ],
  };
}

export function validateJobCheckoutSelection(settings) {
  need(Boolean(settings.operatorWorkspace) !== Boolean(settings.operatorProfile),
    'APPLICATION_JOB_OPERATOR_SELECTION_REQUIRED',
    'Choose the existing original operator workspace or Node buyer profile');
  need(MODES.includes(settings.approvalMode ?? 'browser'), 'APPLICATION_JOB_APPROVAL_MODE_INVALID',
    'Choose browser or terminal approval');
  need(LANDINGS.includes(settings.landing ?? 'request'), 'APPLICATION_JOB_LANDING_INVALID',
    'Choose request, checkout, jobs, library or collections');
}

async function selectedReader(runtimeDirectory) {
  const original = await import(pathToFileURL(join(runtimeDirectory, 'job-workspace', 'launch.mjs')).href);
  const capabilities = original.JOB_WORKSPACE_APPLICATIONS;
  need(typeof original.readJobWorkspaceLaunch === 'function' &&
    plain(capabilities) && capabilities.schema === CAPABILITIES && capabilities.launchSchema === STARTUP &&
    Array.isArray(capabilities.approvalModes) && Array.isArray(capabilities.landings),
  'APPLICATION_JOB_INTERFACE_SOURCE_REQUIRED',
  'Select an installed paid-jobs release with the Request and approval Applications interface');
  return original;
}

export async function prepareJobCheckoutApplication(settings, runtimeDirectory, inputPath) {
  validateJobCheckoutSelection(settings);
  const approvalMode = settings.approvalMode ?? 'browser', landing = settings.landing ?? 'request';
  const state = await inputPath(settings.stateDirectory, 'directory', true, true);
  const inputs = [state], createDirectories = state.exists ? [] : [state.path];
  const args = ['serve', '--state', state.path, '--approval-mode', approvalMode, '--landing', landing];
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
  // Read the selected installation's own interface. The application never
  // supplies an alternate source root, CLI or buyer implementation.
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false, source: false });
  const native = join(runtime.sourceRoot, SOURCE);
  for (const name of ['cli.mjs', 'node/client.mjs', 'job-workspace/cli.mjs', 'job-workspace/server.mjs',
    'job-workspace/launch.mjs', 'job-workspace/intake/controller.mjs', 'job-workspace/checkout/controller.mjs'])
    inputs.push(await inputPath(join(native, name), 'file'));
  const original = await selectedReader(native);
  need(original.JOB_WORKSPACE_APPLICATIONS.approvalModes.includes(approvalMode) &&
    original.JOB_WORKSPACE_APPLICATIONS.landings.includes(landing),
  'APPLICATION_JOB_INTERFACE_UNAVAILABLE', 'Review a page and approval mode supported by this selected installation');
  if (approvalMode === 'browser')
    inputs.push(await inputPath(join(runtime.sourceRoot,
      'stellar/scf-starforge-20261009/sf81-buyer-operator-bridge/browser-approval.mjs'), 'file'));
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
  const approvalMode = selectedValue(request, '--approval-mode');
  const landing = selectedValue(request, '--landing');
  validateJobCheckoutSelection({ operatorWorkspace, operatorProfile, approvalMode, landing });
  if (operatorWorkspace !== undefined) absolute(operatorWorkspace);
  if (operatorProfile !== undefined) absolute(operatorProfile);
  const privateLaunch = join(directory, 'job-workspace-launch.json');
  need(announcement.directory === directory && announcement.runtimeDirectory === runtimeDirectory &&
    announcement.privateLaunch === privateLaunch && Number.isSafeInteger(announcement.pid) && announcement.pid > 0 &&
    announcement.approvalMode === approvalMode && announcement.landing === landing,
  'APPLICATION_JOB_STARTUP_CHANGED', 'The original startup must match the reviewed customer, runtime and interface');
  const original = await selectedReader(runtimeDirectory);
  const ready = await original.readJobWorkspaceLaunch({ directory, runtimeDirectory, pid: announcement.pid,
    approvalMode, landing,
    ...(operatorWorkspace === undefined ? {} : { operatorWorkspace }),
    ...(operatorProfile === undefined ? {} : { operatorProfile }) });
  need(ready.privateLaunch === privateLaunch && ready.instanceId === announcement.instanceId &&
    ready.approvalMode === approvalMode && ready.landing === landing &&
    ready.entryUrl === announcement.entryUrl &&
    LINKS.every(([, , name]) => typeof ready[name] === 'string' && ready[name] === announcement[name]),
  'APPLICATION_JOB_STARTUP_CHANGED', 'Reopen the current original customer launch');
  const port = Number(selectedValue(request, '--port', true) ?? 0);
  need(Number.isInteger(port) && port >= 0 && port <= 65535 &&
    (port === 0 || Number(new URL(ready.entryUrl).port || 80) === port), 'APPLICATION_JOB_PORT_CHANGED');
  return {
    url: ready.entryUrl,
    links: LINKS.map(([id, label, name]) => ({ id, label, url: ready[name] })),
    original: { schema: STARTUP, directory, runtimeDirectory, operatorSelection: ready.operatorSelection,
      pid: ready.pid, instanceId: ready.instanceId, privateLaunch, approvalMode, landing },
  };
}
