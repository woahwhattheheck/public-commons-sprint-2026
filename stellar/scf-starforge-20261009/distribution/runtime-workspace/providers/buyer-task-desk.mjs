// MIT. InboxTask desk in the original installed Applications lifecycle.
import { join, relative, isAbsolute, sep } from 'node:path';
import { inspectMerchantRuntime } from '../../../sf46-release/runtime-package.mjs';
import { validateCustomerDirectory } from '../../../sf88-operator-buyer-cli/node/agents/task-desk/customer-delivery.mjs';
import { Buyer } from '../../../sf88-operator-buyer-cli/node/client.mjs';
import { selectRetainedTask, validateRetainedTaskStorage } from '../../../sf88-operator-buyer-cli/node/agents/task-desk/retained-task.mjs';
import {
  APPLICATION_PROVIDER_SCHEMA, applicationField, observeApplicationStartup,
} from '../application-provider.mjs';
import { absolute, regular, plain, need, digest, json, canonical } from '../storage.mjs';

const COMMAND = 'buyer-task-desk';
const STARTUP = 'stellar-forge.inbox-task-desk-launch.v1';
const STATUS = 'stellar-forge.inbox-task-desk.v1';
const SOURCE = 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/';
const DESK = SOURCE + 'node/agents/task-desk/';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_STARTUP = 32768;
const MAX_STATUS = 65536;
const field = (name, label, required, description) =>
  applicationField(name, label, 'path', required, description);
const resource = directory => digest(json(canonical({
  family: 'buyer-task-desk-directory', directory,
})));

function contains(parent, candidate) {
  const value = relative(parent, candidate);
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep));
}
function separateResults(tasksDirectory, inboxDirectory, outputsDirectory) {
  need(!contains(tasksDirectory, outputsDirectory) && !contains(inboxDirectory, outputsDirectory) &&
    !contains(outputsDirectory, tasksDirectory) && !contains(outputsDirectory, inboxDirectory),
  'APPLICATION_TASK_DESK_OUTPUT_DIRECTORY',
  'Keep complete results in a separate private directory outside the task and Inbox roots.');
}

export function taskDeskApplication(common = []) {
  return {
    id: 'buyer-task-desk', command: COMMAND, title: 'Inbox tasks', terminal: false,
    requiredSource: DESK + 'cli.mjs',
    description: 'Select original Inbox jobs, review and operate a saved task revision, and receive its complete response packet.',
    fields: [
      field('nativeRuntimeDirectory', 'Original SF88 runtime', true,
        'The complete original sf88-operator-buyer-cli directory used by these buyer requests.'),
      field('stateDirectory', 'Private Node buyer state', true,
        'The existing private application-state directory used by the original Node buyer.'),
      field('inboxDirectory', 'Original buyer Inbox', true,
        'The existing initialized Inbox at its original absolute path.'),
      field('tasksDirectory', 'Saved task revisions', true,
        'Keep the original task root when reopening. A new child folder in an existing private parent is supported; place it below the Node buyer state for backup.'),
      field('outputsDirectory', 'Complete result packets', true,
        'A separate private root outside the task and Inbox directories. Keep the same root when continuing receiving.'),
      field('existingTaskDirectory', 'Existing task revision', false,
        'Optional original directory containing task.json. Select its original receiving destination or delivered packet below.'),
      field('existingOutputDirectory', 'Original receiving or delivered packet', false,
        'The exact destination recorded by that task, or its complete delivered packet. A moved complete packet opens for reading and download.'),
      field('commerceDirectory', 'Original RPC commerce session', false,
        'Optional existing commerce session for listing and selecting its saved RPC read editions. It must contain the selected original Inbox.'),
      field('customerDeliveryDirectory', 'Reviewed customer deliveries', false,
        'Optional separate private store for complete task deliveries, their original review and replay. Keep this root when reopening delivery history.'),
      field('workspaceDirectory', 'Original operator workspace', false,
        'Optional original native operator workspace used by explicit execution.'),
      ...common,
    ],
  };
}

export async function prepareTaskDeskApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(plain(settings) && typeof inputPath === 'function',
    'APPLICATION_TASK_DESK_INPUTS_REQUIRED');
  const inputs = [], createDirectories = [];
  const directory = async (name, { missing = false, privateOnly = true } = {}) => {
    const selected = await inputPath(absolute(settings[name]), 'directory', missing, privateOnly);
    inputs.push(selected);
    if (!selected.exists) createDirectories.push(selected.path);
    return selected.path;
  };
  const nativeRuntimeDirectory = await directory('nativeRuntimeDirectory', { privateOnly: false });
  const stateDirectory = await directory('stateDirectory');
  const inboxDirectory = await directory('inboxDirectory');
  const tasksDirectory = await directory('tasksDirectory', { missing: true });
  const outputsDirectory = await directory('outputsDirectory', { missing: true });
  const commerceDirectory = settings.commerceDirectory === undefined
    ? undefined : await directory('commerceDirectory');
  if (commerceDirectory !== undefined) {
    need(join(commerceDirectory, 'inbox') === inboxDirectory,
      'APPLICATION_TASK_DESK_COMMERCE_INBOX_CHANGED', 'Choose the original commerce session that contains this Inbox.');
    inputs.push(await inputPath(join(commerceDirectory, 'session.json'), 'file'));
    for (const name of ['commerce.mjs', 'commerce-jsonrpc-recovery.mjs'])
      inputs.push(await inputPath(join(nativeRuntimeDirectory, '..', 'sf66-demo-launcher', name), 'file'));
  }
  const workspaceDirectory = settings.workspaceDirectory === undefined
    ? undefined : await directory('workspaceDirectory');
  separateResults(tasksDirectory, inboxDirectory, outputsDirectory);

  inputs.push(await inputPath(join(inboxDirectory, 'jobs'), 'directory', false, true));
  const marker = await inputPath(join(inboxDirectory, 'inbox.json'), 'file');
  const markerBytes = await regular(marker.path, MAX_STATUS);
  need(marker.sha256 === digest(markerBytes), 'APPLICATION_TASK_DESK_INBOX_CHANGED');
  let retained;
  try { retained = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(markerBytes)); }
  catch { need(false, 'APPLICATION_TASK_DESK_INBOX_INVALID', 'Select an initialized original buyer Inbox.'); }
  need(plain(retained) && retained.schema === 'stellar-forge.sf88.buyer-inbox.v1',
    'APPLICATION_TASK_DESK_INBOX_INVALID', 'Select an Inbox initialized by the original buyer-inbox command.');
  inputs.push(marker);

  let retainedTask = null;
  if (settings.existingTaskDirectory !== undefined || settings.existingOutputDirectory !== undefined) {
    need(typeof settings.existingTaskDirectory === 'string' && settings.existingTaskDirectory &&
      typeof settings.existingOutputDirectory === 'string' && settings.existingOutputDirectory,
    'APPLICATION_TASK_DESK_RETAINED_PAIR_REQUIRED',
    'Select both the existing task revision and its original receiving or complete delivered packet.');
    const originalTask = await inputPath(absolute(settings.existingTaskDirectory), 'directory', false, true);
    const originalOutput = await inputPath(absolute(settings.existingOutputDirectory), 'directory', true, true);
    inputs.push(originalTask, originalOutput);
    const originalInbox = new Buyer({ runtimeDirectory: nativeRuntimeDirectory,
      stateDirectory }).inbox(inboxDirectory);
    retainedTask = await selectRetainedTask({ inbox: originalInbox,
      taskDirectory: originalTask.path, outputDirectory: originalOutput.path });
    await validateRetainedTaskStorage({ selection: retainedTask, inbox: originalInbox,
      tasksDirectory, outputsDirectory });
    inputs.push(await inputPath(join(originalTask.path, 'task.json'), 'file'));
    if (retainedTask.receivingRecordPath) {
      inputs.push(await inputPath(join(originalTask.path, 'receivings'), 'directory', false, true));
      inputs.push(await inputPath(retainedTask.receivingRecordPath, 'file'));
    } else {
      for (const name of ['task.json', 'receiving.json', 'review.html', 'manifest.json'])
        inputs.push(await inputPath(join(originalOutput.path, name), 'file'));
    }
  }

  const customerDeliveryDirectory = settings.customerDeliveryDirectory === undefined
    ? undefined : await directory('customerDeliveryDirectory', { missing: true });
  if (customerDeliveryDirectory !== undefined) validateCustomerDirectory(customerDeliveryDirectory,
    [tasksDirectory, outputsDirectory, inboxDirectory, workspaceDirectory, commerceDirectory,
      retainedTask?.taskDirectory, retainedTask?.outputDirectory]);

  // The original runtime remains a separate operator-selected root. These are
  // the native entries consumed by the existing buyer and Inbox commands.
  for (const name of ['cli.mjs', 'queue-cli.mjs', 'request-body.mjs', 'workspace.mjs'])
    inputs.push(await inputPath(join(nativeRuntimeDirectory, name), 'file'));

  // The managed release supplies this desk's code and all of its served assets.
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false, source: false });
  for (const name of ['cli.mjs', 'server.mjs', 'retained-task.mjs', 'customer-delivery.mjs', 'client.mjs', 'browser-assets.json',
    'public/index.html', 'public/app.mjs', 'public/customer-delivery.mjs', 'public/style.css'])
    inputs.push(await inputPath(join(runtime.sourceRoot, DESK, name), 'file'));

  const args = ['--runtime', nativeRuntimeDirectory, '--state', stateDirectory,
    '--inbox', inboxDirectory, '--tasks', tasksDirectory, '--outputs', outputsDirectory];
  if (workspaceDirectory !== undefined) args.push('--workspace', workspaceDirectory);
  if (commerceDirectory !== undefined) args.push('--commerce', commerceDirectory);
  if (customerDeliveryDirectory !== undefined) args.push('--delivery', customerDeliveryDirectory);
  if (retainedTask) args.push('--existing-task', retainedTask.taskDirectory,
    '--existing-output', retainedTask.outputDirectory);
  const resourceKey = resource(tasksDirectory);
  return { args, inputs, createDirectories, resourceKey,
    resourceKeys: [...new Set([resourceKey, resource(outputsDirectory),
      ...(customerDeliveryDirectory ? [resource(customerDeliveryDirectory)] : []),
      ...(retainedTask ? [resource(retainedTask.taskDirectory), resource(retainedTask.outputDirectory)] : [])])].sort() };
}

function launchSelection(request) {
  need(request?.command === COMMAND && !request.pythonCommand && Array.isArray(request.args),
    'APPLICATION_TASK_DESK_STARTUP_CHANGED');
  const allowed = new Set(['--runtime', '--state', '--inbox', '--tasks', '--outputs', '--workspace', '--commerce', '--delivery', '--port',
    '--existing-task', '--existing-output']);
  const values = new Map();
  need(request.args.length % 2 === 0, 'APPLICATION_TASK_DESK_STARTUP_CHANGED');
  for (let index = 0; index < request.args.length; index += 2) {
    const flag = request.args[index], value = request.args[index + 1];
    need(allowed.has(flag) && !values.has(flag) && typeof value === 'string' && value.length > 0,
      'APPLICATION_TASK_DESK_STARTUP_CHANGED');
    values.set(flag, value);
  }
  const selected = {};
  for (const [flag, name] of [
    ['--runtime', 'nativeRuntimeDirectory'], ['--state', 'stateDirectory'],
    ['--inbox', 'inboxDirectory'], ['--tasks', 'tasksDirectory'], ['--outputs', 'outputsDirectory'],
  ]) selected[name] = absolute(values.get(flag));
  if (values.has('--workspace')) selected.workspaceDirectory = absolute(values.get('--workspace'));
  if (values.has('--commerce')) selected.commerceDirectory = absolute(values.get('--commerce'));
  if (values.has('--delivery')) selected.customerDeliveryDirectory = absolute(values.get('--delivery'));
  need(values.has('--existing-task') === values.has('--existing-output'), 'APPLICATION_TASK_DESK_STARTUP_CHANGED');
  if (values.has('--existing-task')) {
    selected.existingTaskDirectory = absolute(values.get('--existing-task'));
    selected.existingOutputDirectory = absolute(values.get('--existing-output'));
  }
  const port = values.get('--port') ?? '0';
  need(/^(0|[1-9][0-9]*)$/.test(port) && Number(port) <= 65535,
    'APPLICATION_TASK_DESK_STARTUP_CHANGED');
  selected.port = Number(port);
  separateResults(selected.tasksDirectory, selected.inboxDirectory, selected.outputsDirectory);
  return selected;
}

async function liveStatus(origin) {
  const response = await fetch(new URL('/api/status', origin), {
    headers: { Accept: 'application/json' }, redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  need(response.status === 200 &&
    /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') && response.body,
  'APPLICATION_TASK_DESK_STARTUP_UNAVAILABLE', 'The original task desk did not return its current status.');
  const declared = response.headers.get('content-length');
  need(declared === null || /^[0-9]+$/.test(declared) && Number(declared) <= MAX_STATUS,
    'APPLICATION_TASK_DESK_STARTUP_UNAVAILABLE');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    need(bytes <= MAX_STATUS, 'APPLICATION_TASK_DESK_STARTUP_UNAVAILABLE');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { need(false, 'APPLICATION_TASK_DESK_STARTUP_UNAVAILABLE', 'The original task desk returned unreadable status.'); }
}

export async function taskDeskStartup(request, announcement, context = {}) {
  if (!plain(announcement) || announcement.schema !== STARTUP) return null;
  const selected = launchSelection(request);
  need(UUID.test(announcement.instanceId ?? '') &&
    announcement.inbox === selected.inboxDirectory &&
    announcement.tasks === selected.tasksDirectory && announcement.outputs === selected.outputsDirectory &&
    announcement.commerce === selected.commerceDirectory &&
    announcement.customerDelivery === selected.customerDeliveryDirectory &&
    announcement.existingTask === selected.existingTaskDirectory &&
    announcement.existingOutput === selected.existingOutputDirectory,
  'APPLICATION_TASK_DESK_STARTUP_CHANGED', 'The task desk announcement differs from the saved application roots.');
  let url;
  try { url = new URL(announcement.url); }
  catch { need(false, 'APPLICATION_TASK_DESK_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
    port >= 1 && port <= 65535 && (!selected.port || selected.port === port),
  'APPLICATION_TASK_DESK_STARTUP_CHANGED', 'Use the private URL announced by this original task desk.');
  const status = await liveStatus(url.origin);
  need(status?.schema === STATUS && status.instanceId === announcement.instanceId &&
    status.roots?.inbox === selected.inboxDirectory &&
    status.roots?.tasks === selected.tasksDirectory && status.roots?.outputs === selected.outputsDirectory &&
    status.roots?.commerce === selected.commerceDirectory &&
    status.roots?.customerDelivery === selected.customerDeliveryDirectory &&
    status.roots?.existingTask === selected.existingTaskDirectory &&
    status.roots?.existingOutput === selected.existingOutputDirectory &&
    typeof status.csrfToken === 'string' && status.csrfToken.length > 0,
  'APPLICATION_TASK_DESK_STARTUP_CHANGED', 'The live desk differs from the original application selection.');
  return { url: url.href, original: {
    schema: STARTUP, ...selected, instanceId: announcement.instanceId,
    ...(Number.isSafeInteger(context.pid) && context.pid > 0 ? { pid: context.pid } : {}),
  } };
}

/** The native CLI emits one formatted JSON announcement, sometimes across chunks. */
function startupReader(request, context) {
  let pending = '';
  return text => {
    if (!pending && !text.startsWith('{')) return null;
    pending += (pending ? '\n' : '') + text;
    if (Buffer.byteLength(pending) > MAX_STARTUP) { pending = ''; return null; }
    let announcement;
    try { announcement = JSON.parse(pending); } catch { return null; }
    pending = '';
    if (!plain(announcement) || announcement.schema !== STARTUP) return null;
    return () => taskDeskStartup(request, announcement, context);
  };
}

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'buyer-task-desk', order: 325,
  catalog({ common }) { return [taskDeskApplication(common)]; },
  prepare(type, settings, context) { return prepareTaskDeskApplication(settings, context); },
  matchRequest(request) { return !request.pythonCommand && request.command === COMMAND; },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, startupReader(request, context), {
      lineLimit: MAX_STARTUP,
    });
  },
};
