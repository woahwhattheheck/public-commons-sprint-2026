#!/usr/bin/env node
// MIT — Run with the maintained Node package and the complete native runtime.
// Each stage is explicit. This example never removes, moves or executes state.
import { lstat, realpath } from 'node:fs/promises';
import { relative, isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Buyer, BuyerError, WorkspaceRecovery, WorkspaceRecoveryError } from '../index.mjs';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runtime: { type: 'string' }, operator: { type: 'string' },
    'state-root': { type: 'string' }, 'app-dir': { type: 'string' },
    inbox: { type: 'string', multiple: true, default: [] },
    include: { type: 'string', multiple: true, default: [] },
    object: { type: 'string', multiple: true, default: [] },
    dataset: { type: 'string', multiple: true, default: [] },
    out: { type: 'string' }, bundle: { type: 'string' }, expect: { type: 'string' },
    'pass-env': { type: 'string', default: 'SF88_BACKUP_PASSPHRASE' },
    python: { type: 'string', default: '/usr/bin/python3' },
    quiesced: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
const usage = `Usage: node examples/recover_workspace.mjs STAGE --runtime /absolute/native/runtime [options]

Stages:
  inspect   --operator DIR --state-root DIR [--inbox DIR] [--include DIR] [--app-dir DIR]
  snapshot  same selection, plus --out NEW_BACKUP_DIR --quiesced
  verify    --bundle BACKUP_DIR --expect SAVED_RECORD_SHA256
  restore   --bundle BACKUP_DIR --expect SAVED_RECORD_SHA256 [--app-dir DIR]
  reopen    --app-dir EXISTING_NODE_APP [--object SAVED_ID] [--dataset SAVED_ID]

Set the selected --pass-env variable privately before launching this process.
It supplies a variable NAME only. --python selects the trusted verification interpreter.
Repeat --inbox/--include for every retained native dependency inside --state-root.
The existing Node app directory is included automatically when --app-dir is supplied.
Include attached native object/dataset directories explicitly; their paths are not rewritten.
Restore requires the original root to be absent or empty; this example never removes it.
Optional object/dataset IDs reopen existing Node application bindings; they do not acquire data.
See ../RECOVERY.md for stopping writers and preserving newer state before recovery.`;

function required(name) {
  if (!options[name]) throw new BuyerError('RECOVERY_EXAMPLE_OPTION_REQUIRED', { option: name });
  return options[name];
}
function within(root, path) {
  const suffix = relative(root, path);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('../'));
}
async function existingBuyer(restoredRoot) {
  const directory = required('app-dir');
  if (!isAbsolute(directory) || resolve(directory) !== directory || await realpath(directory) !== directory)
    throw new BuyerError('RECOVERY_EXAMPLE_CANONICAL_APP_REQUIRED');
  if (restoredRoot && !within(restoredRoot, directory))
    throw new BuyerError('RECOVERY_EXAMPLE_APP_OUTSIDE_RESTORED_ROOT');
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new BuyerError('RECOVERY_EXAMPLE_EXISTING_APP_REQUIRED');
  return new Buyer({ runtimeDirectory: required('runtime'), stateDirectory: directory,
    environment: process.env });
}
const selected = (value, names) => Object.fromEntries(names.filter(name => value[name] !== undefined)
  .map(name => [name, value[name]]));

async function reopen(restoredRoot) {
  const buyer = await existingBuyer(restoredRoot);
  const operations = [], objects = [], datasets = [];
  for await (const operation of buyer.list()) {
    operations.push(selected(await operation.inspect(),
      ['intentId', 'state', 'resultRecoverable', 'nativeStatus', 'deliveryStatus']));
  }
  // Inspect the original native sessions. Never call run(), execute(), download()
  // or finalize() as an automatic consequence of restoring an application.
  for (const id of options.object) {
    const object = buyer.object(id);
    const view = await object.inspect();
    const accounting = await object.accounting();
    objects.push({ id, native: selected(view.native,
      ['directory', 'sessionId', 'status', 'bytes', 'chunkCount']),
      process: view.process, accounting: accounting.native,
      accountingProcess: accounting.process });
  }
  for (const id of options.dataset) {
    const view = await buyer.dataset(id).inspect();
    datasets.push({ id, native: selected(view.native,
      ['directory', 'sessionId', 'status', 'snapshot', 'rows', 'pages', 'finalized']),
      process: view.process });
  }
  return { applicationDirectory: buyer.stateDirectory, operations, objects, datasets };
}

let completedRecovery = null;
async function main() {
  if (options.help) { console.log(usage); return; }
  const [stage] = positionals;
  if (positionals.length !== 1 || !['inspect', 'snapshot', 'verify', 'restore', 'reopen'].includes(stage))
    throw new BuyerError('RECOVERY_EXAMPLE_STAGE_REQUIRED');
  if ((options.object.length || options.dataset.length) && !options['app-dir'])
    throw new BuyerError('RECOVERY_EXAMPLE_EXISTING_APP_REQUIRED');
  if ((options.object.length || options.dataset.length) && !['restore', 'reopen'].includes(stage))
    throw new BuyerError('RECOVERY_EXAMPLE_SESSION_REOPEN_STAGE_REQUIRED');
  if (stage === 'reopen') {
    console.log(JSON.stringify({ stage, reopened: await reopen() }, null, 2));
    return;
  }
  // A standalone handle never recreates the absent original state before restore.
  let recovery = new WorkspaceRecovery({ runtimeDirectory: required('runtime'), environment: process.env });
  let result;
  if (stage === 'inspect' || stage === 'snapshot') {
    if (options['app-dir']) recovery = (await existingBuyer()).workspaceRecovery();
    const selection = { directory: required('operator'), stateRoot: required('state-root'),
      inboxes: options.inbox, include: options.include };
    result = stage === 'inspect' ? await recovery.inspect(selection)
      : await recovery.snapshot({ ...selection, output: required('out'),
        quiesced: options.quiesced, passphraseEnv: options['pass-env'] });
  } else {
    const archive = { bundle: required('bundle'), expectedRecordSha256: required('expect'),
      python: options.python, passphraseEnv: options['pass-env'] };
    result = stage === 'verify' ? await recovery.verify(archive) : await recovery.restore(archive);
  }
  completedRecovery = result;
  const output = { stage, native: result.native, process: result.process,
    completionReported: result.completionReported };
  if (stage === 'restore' && options['app-dir']) output.reopened = await reopen(result.native.stateRoot);
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  const recovery = error instanceof WorkspaceRecoveryError ? error.result : completedRecovery;
  console.error(JSON.stringify({ error: error.code ?? 'RECOVERY_EXAMPLE_FAILED',
    option: error.option,
    // Preserve a reported native publication even if subsequent app reopen fails.
    recovery: recovery ? { native: recovery.native, process: recovery.process,
      completionReported: recovery.completionReported } : null }, null, 2));
  process.exitCode = 1;
});
