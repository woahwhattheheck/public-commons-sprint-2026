#!/usr/bin/env node
// MIT. Open the original customer runtime workflow in a private operator browser.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRuntimeWorkspace, openRuntimeWorkspace } from './model.mjs';
import { startRuntimeWorkspace } from './server.mjs';
import { readJSON } from './storage.mjs';
import { fail, json } from './storage.mjs';

const HELP = `Starforge customer runtime workspace

  runtime-workspace init --workspace NEW_DIRECTORY [--runtime-home PRIVATE_DIRECTORY]
  runtime-workspace attach --workspace DIRECTORY --runtime EXISTING_RUNTIME [--label NAME]
  runtime-workspace serve --workspace DIRECTORY [--port 8465]
  runtime-workspace status --workspace DIRECTORY [--runtime-id ID]
  runtime-workspace python-status --workspace DIRECTORY --runtime-id ID
  runtime-workspace python-review --workspace DIRECTORY --runtime-id ID --python ABS [--extras workbooks,agents|base]
  runtime-workspace python-operation --workspace DIRECTORY --request ABSOLUTE_JSON_FILE
  runtime-workspace python-continue --workspace DIRECTORY --operation-id UUID
  runtime-workspace python-command --workspace DIRECTORY --runtime-id ID --installation-id SHA --command NAME --args ABSOLUTE_JSON_FILE
  runtime-workspace handoff --workspace DIRECTORY --runtime-id ID
  runtime-workspace transfers --workspace DIRECTORY [--transfer-id ID]
  runtime-workspace transfer-review --workspace DIRECTORY --runtime-id ID
  runtime-workspace transfer-attach --workspace DIRECTORY --directory TRANSFER_DIRECTORY [--label NAME]
  runtime-workspace transfer-operation --workspace DIRECTORY --request ABSOLUTE_JSON_FILE
  runtime-workspace transfer-continue --workspace DIRECTORY --operation-id UUID
  runtime-workspace managed-open --workspace DIRECTORY --home HOME [--label NAME]
  runtime-workspace managed-status --workspace DIRECTORY [--home-id ID]
  runtime-workspace managed-review --workspace DIRECTORY --home-id ID --runtime-id ID
  runtime-workspace managed-operation --workspace DIRECTORY --request ABSOLUTE_JSON_FILE
  runtime-workspace managed-recover --workspace DIRECTORY --operation-id UUID
  runtime-workspace managed-stop --workspace DIRECTORY --operation-id UUID
  runtime-workspace managed-config --workspace DIRECTORY --home-id ID [--path RELATIVE_FILE]

The private browser receives an original archive or reuses an existing runtime,
reviews exact dependency profiles, prepares and resumes original installations,
compares upgrades, recovers into a new directory and exports the original
source/dependency roots for the existing host and SF46 release controls.
Install workers retain progress and continue across browser/server restarts.
Linux, Node22.16+, Python3.11+, npm and flock are the original installer requirements.
`;
const allowed = {
  'python-status': ['--workspace', '--runtime-id'],
  'python-review': ['--workspace', '--runtime-id', '--python', '--extras'],
  'python-operation': ['--workspace', '--request'], 'python-continue': ['--workspace', '--operation-id'],
  'python-command': ['--workspace', '--runtime-id', '--installation-id', '--command', '--args'],
  transfers: ['--workspace', '--transfer-id'], 'transfer-review': ['--workspace', '--runtime-id'],
  'transfer-attach': ['--workspace', '--directory', '--label'],
  'transfer-operation': ['--workspace', '--request'], 'transfer-continue': ['--workspace', '--operation-id'],
  'managed-open': ['--workspace', '--home', '--label'], 'managed-status': ['--workspace', '--home-id'],
  'managed-review': ['--workspace', '--home-id', '--runtime-id'], 'managed-operation': ['--workspace', '--request'],
  'managed-recover': ['--workspace', '--operation-id'], 'managed-stop': ['--workspace', '--operation-id'],
  'managed-config': ['--workspace', '--home-id', '--path'],
  init: ['--workspace', '--runtime-home'], attach: ['--workspace', '--runtime', '--label'],
  serve: ['--workspace', '--port'], status: ['--workspace', '--runtime-id'], handoff: ['--workspace', '--runtime-id'],
};
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP); return; }
  const [command, ...rest] = argv, options = {};
  if (!allowed[command] || rest.length % 2) fail('RUNTIME_WORKSPACE_ARGUMENTS_INVALID');
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!allowed[command].includes(key) || Object.hasOwn(options, key) || !rest[i + 1] || rest[i + 1].startsWith('--'))
      fail('RUNTIME_WORKSPACE_ARGUMENTS_INVALID');
    options[key] = rest[i + 1];
  }
  if (!options['--workspace']) fail('RUNTIME_WORKSPACE_DIRECTORY_REQUIRED');
  const directory = resolve(options['--workspace']);
  if (command === 'init') {
    process.stdout.write(json(await createRuntimeWorkspace({ directory,
      ...(options['--runtime-home'] ? { runtimeHome: resolve(options['--runtime-home']) } : {}) })));
    return;
  }
  if (command === 'serve') {
    if (options['--port'] !== undefined && !/^(0|[1-9][0-9]{0,4})$/.test(options['--port'])) fail('RUNTIME_WORKSPACE_PORT_INVALID');
    const server = await startRuntimeWorkspace({ directory, port: options['--port'] === undefined ? 8465 : Number(options['--port']) });
    process.stdout.write('Runtime workspace: ' + server.url + '\nOriginal install workers retain their progress when this browser server closes.\n');
    let closing = false;
    const stop = async () => {
      if (closing) return; closing = true;
      try { await server.close(); }
      catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
      finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    return;
  }
  const model = await openRuntimeWorkspace({ directory });
  let result;
  if (command === 'python-status') result = await model.pythonState({ runtimeId: options['--runtime-id'] });
  else if (command === 'python-review') {
    if (!options['--python']) fail('PYTHON_INTERPRETER_REQUIRED', 'Select an absolute Python executable.');
    result = await model.pythonReview({ runtimeId: options['--runtime-id'], python: resolve(options['--python']),
      extras: options['--extras'] === 'base' ? [] : (options['--extras'] ?? 'workbooks').split(',') });
  } else if (command === 'python-operation') {
    if (!options['--request']) fail('PYTHON_REQUEST_FILE_REQUIRED');
    const request = await readJSON(resolve(options['--request']));
    if (!request?.operation?.startsWith('python-')) fail('PYTHON_OPERATION_INVALID');
    result = await model.begin(request);
  } else if (command === 'python-continue') result = await model.recoverPythonOperation(options['--operation-id']);
  else if (command === 'python-command') {
    if (!options['--args']) fail('PYTHON_ARGUMENT_FILE_REQUIRED');
    result = await model.pythonCommand({ runtimeId: options['--runtime-id'], installationId: options['--installation-id'],
      command: options['--command'], args: await readJSON(resolve(options['--args'])) });
  } else if (command === 'transfers') result = await model.transfersState({ cacheTransferId: options['--transfer-id'] ?? null });
  else if (command === 'transfer-review') result = await model.transfersReview({ runtimeId: options['--runtime-id'] });
  else if (command === 'transfer-attach') {
    if (!options['--directory']) fail('RUNTIME_TRANSFER_DIRECTORY_REQUIRED');
    result = await model.transfersAttach({ directory: resolve(options['--directory']), label: options['--label'] });
  } else if (command === 'transfer-operation') {
    if (!options['--request']) fail('RUNTIME_TRANSFER_REQUEST_FILE_REQUIRED');
    const request = await readJSON(resolve(options['--request']));
    if (!request?.operation?.startsWith('transfer-')) fail('RUNTIME_TRANSFER_OPERATION_INVALID');
    result = await model.begin(request);
  } else if (command === 'transfer-continue') result = await model.recoverTransferOperation(options['--operation-id']);
  else if (command === 'managed-open') {
    if (!options['--home']) fail('MANAGED_HOME_REQUIRED');
    result = await model.openManagedHome({ directory: resolve(options['--home']), label: options['--label'] });
  } else if (command === 'managed-status') result = await model.managedState({ homeId: options['--home-id'] ?? null });
  else if (command === 'managed-review') result = await model.reviewManagedAdoption({
    homeId: options['--home-id'], runtimeId: options['--runtime-id'] });
  else if (command === 'managed-config') result = await model.managedConfig({
    homeId: options['--home-id'], ...(options['--path'] ? { path: options['--path'] } : {}) });
  else if (command === 'managed-operation') {
    if (!options['--request']) fail('MANAGED_REQUEST_FILE_REQUIRED');
    result = await model.begin(await readJSON(resolve(options['--request'])));
  } else if (command === 'managed-recover') result = await model.recoverManagedOperation(options['--operation-id']);
  else if (command === 'managed-stop') result = await model.stopManagedCommand(options['--operation-id']);
  else if (command === 'attach') {
    if (!options['--runtime']) fail('RUNTIME_WORKSPACE_RUNTIME_REQUIRED');
    result = await model.attach({ directory: resolve(options['--runtime']), label: options['--label'] });
  } else if (command === 'handoff') {
    if (!options['--runtime-id']) fail('RUNTIME_WORKSPACE_RUNTIME_ID_REQUIRED');
    result = await model.handoff(options['--runtime-id']);
  } else result = await model.state({ runtimeId: options['--runtime-id'] ?? null });
  process.stdout.write(json(result));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { process.stderr.write(json({ error: error.code ?? 'RUNTIME_WORKSPACE_ERROR', message: error.message })); process.exitCode = 1; });
