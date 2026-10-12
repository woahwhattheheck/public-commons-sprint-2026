// MIT. The original grant planner and delivery operations in managed Applications.
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need } from './storage.mjs';

const SOURCE = 'stellar/scf_2026/sf47_budget_model/workspace';
const STARTUP = 'stellar-forge.sf47.workspace-launch.v1';
const field = (name, label, required = false, description = '') =>
  ({name, label, type:'path', required, description});

export function grantApplication(common = []) {
  return {
    id:'grant-workspace', command:'grant-workspace', title:'Grant planning and delivery', terminal:false,
    requiredSource:SOURCE + '/launch.mjs',
    description:'Reopen saved grant plans, compare staffing and cash alternatives, track contributor delivery, invoices and allocations, and retain complete planning and operations exports.',
    fields:[
      field('workspaceDirectory', 'Private grant workspace', true,
        'Reopen the original planning and delivery records, or select one new folder in an existing private parent.'),
      field('scenarioFile', 'Original planning scenario', false,
        'Optional original SF47 JSON used for an empty workspace. Existing saved plans keep their own source and history.'),
      field('pythonExecutable', 'Python executable', false,
        'Defaults to /usr/bin/python3. The original grant operator uses the Python standard library.'),
      ...common,
    ],
  };
}

export async function prepareGrantApplication(settings, {inputPath, selectedExecutable, runtimeDirectory} = {}) {
  need(typeof inputPath === 'function' && typeof selectedExecutable === 'function',
    'APPLICATION_GRANT_ORIGINAL_INPUTS_REQUIRED');
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), {load:false, source:false});
  const native = await realpath(join(runtime.sourceRoot, SOURCE));
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', true, true);
  const python = await selectedExecutable(settings.pythonExecutable ?? '/usr/bin/python3');
  const inputs = [workspace, ...python.inputs];
  const launchPath = join(native, 'launch.mjs');
  const original = await import(pathToFileURL(launchPath).href);
  need(typeof original.inspectGrantWorkspaceSelection === 'function',
    'APPLICATION_GRANT_LAUNCH_READER_REQUIRED', 'Choose an installed runtime with the managed grant workspace.');
  const selected = await original.inspectGrantWorkspaceSelection({
    workspaceDirectory:workspace.path, scenarioFile:settings.scenarioFile, pythonExecutable:python.executable,
  });
  need(selected.selection?.sourceDirectory === native && selected.selection?.workspaceDirectory === workspace.path &&
    selected.selection?.pythonExecutable === python.executable &&
    /^[a-f0-9]{64}$/.test(selected.selectionSha256 ?? '') && Array.isArray(selected.sourceFiles),
  'APPLICATION_GRANT_SOURCE_SELECTION_CHANGED');
  for (const path of [...selected.sourceFiles, selected.selection.scenarioFile])
    inputs.push(await inputPath(path, 'file'));
  // Mutable plan revisions and operation records deliberately stay in the original
  // workspace. Only the workspace directory, selected source and launch inputs bind.
  return {
    args:['--python', python.executable, 'serve', '--workspace', workspace.path,
      '--scenario', selected.selection.scenarioFile, '--source-directory', native,
      '--startup-format', 'managed', '--expected-selection-sha256', selected.selectionSha256],
    inputs, createDirectories:workspace.exists ? [] : [workspace.path],
  };
}

function flags(request) {
  need(Array.isArray(request.args) && request.args[0] === '--python' &&
    typeof request.args[1] === 'string' && request.args[2] === 'serve',
  'APPLICATION_GRANT_STARTUP_CHANGED');
  const selected = new Map([['--python', request.args[1]]]);
  const allowed = new Set(['--workspace', '--scenario', '--source-directory', '--startup-format',
    '--expected-selection-sha256', '--port']);
  for (let index = 3; index < request.args.length; index += 2) {
    const name = request.args[index], value = request.args[index + 1];
    need(allowed.has(name) && !selected.has(name) && typeof value === 'string' && value.length > 0,
      'APPLICATION_GRANT_STARTUP_CHANGED');
    selected.set(name, value);
  }
  for (const name of ['--workspace', '--scenario', '--source-directory', '--startup-format', '--expected-selection-sha256'])
    need(selected.has(name), 'APPLICATION_GRANT_STARTUP_CHANGED');
  need(selected.get('--startup-format') === 'managed' &&
    /^[a-f0-9]{64}$/.test(selected.get('--expected-selection-sha256')), 'APPLICATION_GRANT_STARTUP_CHANGED');
  return selected;
}

export async function grantStartup(request, text) {
  if (request.command !== 'grant-workspace' || typeof text !== 'string' || text.length > 32768 ||
    !text.startsWith('{')) return null;
  let announcement;
  try { announcement = JSON.parse(text); } catch { return null; }
  if (!plain(announcement) || announcement.schema !== STARTUP || announcement.state !== 'LISTENING') return null;
  const selected = flags(request), native = absolute(selected.get('--source-directory'));
  const portText = selected.get('--port') ?? '0';
  need(/^(0|[1-9][0-9]*)$/.test(portText) && Number(portText) <= 65535,
    'APPLICATION_GRANT_PORT_CHANGED');
  const original = await import(pathToFileURL(join(native, 'launch.mjs')).href);
  need(typeof original.readGrantWorkspaceLaunch === 'function', 'APPLICATION_GRANT_LAUNCH_READER_REQUIRED');
  return original.readGrantWorkspaceLaunch({
    workspaceDirectory:absolute(selected.get('--workspace')),
    scenarioFile:absolute(selected.get('--scenario')),
    pythonExecutable:absolute(selected.get('--python')),
    selectionSha256:selected.get('--expected-selection-sha256'),
    executionSourceDirectory:join(absolute(request.releaseDirectory), 'source', SOURCE),
    pid:announcement.pid, instanceId:announcement.instanceId,
    port:Number(portText), announcement,
  });
}
