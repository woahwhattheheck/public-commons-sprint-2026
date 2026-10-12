// MIT. The original Study operator in the maintained Applications registry.
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup }
  from '../../distribution/runtime-workspace/application-provider.mjs';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, canonical, need, plain, sha } from './agent-local.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/study-source-refresh';
const STARTUP = 'stellar-forge.study-operator-startup.v1';
const field = (name, label, required = false, description = '') =>
  ({name, label, type:'path', required, description});

export async function prepareStudyApplication(settings, {inputPath, selectedExecutable, runtimeDirectory} = {}) {
  need(typeof inputPath === 'function' && typeof selectedExecutable === 'function',
    'APPLICATION_STUDY_ORIGINAL_INPUTS_REQUIRED');
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), {load:false, source:false});
  const native = await realpath(join(runtime.sourceRoot, SOURCE));
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', true, true);
  const python = await selectedExecutable(settings.pythonExecutable ?? '/usr/bin/python3');
  const original = await import(pathToFileURL(join(native, 'agent-local.mjs')).href);
  const binding = await original.inspectStudyBinding({
    directory:workspace.path, pythonExecutable:python.executable, allowStart:false,
  });
  need(binding.selection.source_directory === native &&
    binding.selection.workspace_directory === workspace.path &&
    binding.pythonExecutable === python.executable && plain(binding.selection.source_files),
  'APPLICATION_STUDY_SOURCE_SELECTION_CHANGED', 'Select the complete original installed Study workspace.');
  sha(binding.selectionSha256);
  const inputs = [workspace, ...python.inputs];
  for (const name of Object.keys(binding.selection.source_files))
    inputs.push(await inputPath(join(native, name), 'file'));
  return {
    args:['--python', python.executable, '--workspace', workspace.path, 'serve',
      '--source-directory', native, '--expected-selection-sha256', binding.selectionSha256],
    inputs, createDirectories:workspace.exists ? [] : [workspace.path],
  };
}

function flags(request) {
  need(Array.isArray(request.args) && request.args[0] === '--python' &&
    typeof request.args[1] === 'string' && request.args[2] === '--workspace' &&
    typeof request.args[3] === 'string' && request.args[4] === 'serve',
  'APPLICATION_STUDY_STARTUP_CHANGED', 'Use the original retained Study command.');
  const selected = new Map([['--python', request.args[1]], ['--workspace', request.args[3]]]);
  const allowed = new Set(['--source-directory', '--expected-selection-sha256', '--port']);
  for (let index = 5; index < request.args.length; index += 2) {
    const name = request.args[index], value = request.args[index + 1];
    need(allowed.has(name) && !selected.has(name) && typeof value === 'string' && value.length > 0,
      'APPLICATION_STUDY_STARTUP_CHANGED', 'The retained Study command arguments changed.');
    selected.set(name, value);
  }
  need(selected.has('--source-directory') && selected.has('--expected-selection-sha256'),
    'APPLICATION_STUDY_STARTUP_CHANGED', 'The original Study source selection is required.');
  sha(selected.get('--expected-selection-sha256'));
  const port = selected.get('--port') ?? '0';
  need(/^(0|[1-9][0-9]*)$/.test(port) && Number(port) <= 65535,
    'APPLICATION_STUDY_PORT_CHANGED', 'Use the reviewed local port.');
  return {selected, port:Number(port)};
}

export async function readStudyApplicationStartup(request, text) {
  if (request.command !== 'study-source-refresh' || typeof text !== 'string' || text.length > 16384)
    return null;
  let announcement;
  try { announcement = JSON.parse(text); } catch { return null; }
  if (!plain(announcement) || announcement.schema !== STARTUP || announcement.state !== 'LISTENING')
    return null;
  const {selected, port} = flags(request), native = absolute(selected.get('--source-directory'));
  const workspace = absolute(selected.get('--workspace'));
  const execution = await realpath(join(absolute(request.releaseDirectory), 'source', SOURCE));
  const original = await import(pathToFileURL(join(native, 'agent-client.mjs')).href);
  const binding = await original.inspectStudyBinding({
    directory:workspace, pythonExecutable:absolute(selected.get('--python')), allowStart:false,
  });
  need(binding.selectionSha256 === selected.get('--expected-selection-sha256'),
    'APPLICATION_STUDY_SOURCE_SELECTION_CHANGED', 'The reviewed original Study source changed.');
  const release = await import(pathToFileURL(join(execution, 'agent-local.mjs')).href);
  const executed = await release.sourceSelection(workspace);
  need(canonical(executed.selection.source_files) === canonical(binding.selection.source_files),
    'APPLICATION_STUDY_EXECUTION_CHANGED', 'The managed release differs from the reviewed Study source.');
  const client = new original.StudyWorkspaceClient(binding);
  try {
    const opened = await client.open({expectedSelectionSha256:binding.selectionSha256});
    const browser = await client.browser(), identity = opened.original;
    const url = new URL(browser.url);
    need(identity.pid === announcement.pid && identity.instance_id === announcement.instance_id &&
      identity.selection_sha256 === announcement.selection_sha256 &&
      identity.source_sha256 === announcement.source_sha256 &&
      identity.execution.source_directory === execution &&
      identity.execution.source_sha256 === binding.sourceSha256 &&
      announcement.execution_source_directory === execution &&
      announcement.connection_file === join(workspace, 'connection.json') &&
      announcement.base_url === identity.base_url &&
      url.origin === new URL(identity.base_url).origin && (port === 0 || Number(url.port || 80) === port) &&
      canonical(browser.original) === canonical(identity),
    'APPLICATION_STUDY_LISTENER_CHANGED', 'Authenticate the exact original managed Study listener.');
    return {url:browser.url, original:identity, connectionFile:announcement.connection_file};
  } finally {
    // This reader only borrows the original Applications child.
    await client.close();
  }
}

export default {
  schema:APPLICATION_PROVIDER_SCHEMA, id:'study-source-refresh', order:345,
  catalog({common}) {
    return [{
      id:'study-source-refresh', command:'study-source-refresh',
      title:'Study source refresh and property research', terminal:false,
      requiredSource:SOURCE + '/agent-client.mjs',
      description:'Retain source editions and acquisitions, freeze portfolio mappings, review changes, survey properties, select comparables and reopen complete analyst packages.',
      fields:[
        field('workspaceDirectory', 'Private study workspace', true,
          'Open the existing source and property records, or select one new folder in an existing private parent.'),
        field('pythonExecutable', 'Python executable', false,
          'Defaults to /usr/bin/python3. Source intake uses the installed original provider modules.'),
        ...common,
      ],
    }];
  },
  prepare(_type, settings, context) { return prepareStudyApplication(settings, context); },
  matchRequest(request) { return !request.pythonCommand && request.command === 'study-source-refresh'; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{') || !text.includes(STARTUP)) return null;
      return () => readStudyApplicationStartup(request, text);
    });
  },
};
