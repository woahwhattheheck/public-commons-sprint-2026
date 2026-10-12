#!/usr/bin/env node
// MIT. Original supplier account setup, source review, recovery and complete receiving.
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { privateDirectory, readPrivateJson, atomicJson } from '../../routescan/quota.mjs';
import { openSupplierAccountWorkspace, restoreSupplierAccountWorkspace, inspectSupplierAccountSource } from './model.mjs';
import { startSupplierAccountWorkspace } from './server.mjs';
import { need, json, digest } from './plan.mjs';

export const SUPPLIER_ACCOUNT_STARTUP_SCHEMA = 'stellar-forge.supplier-account-workspace-startup.v1';
const HELP = [
  'Starforge supplier accounts',
  '  supplier-accounts init --state PRIVATE_STATE --upstreams ORIGINAL_UPSTREAMS.json',
  '  supplier-accounts serve --state PRIVATE_STATE [--upstreams ORIGINAL_UPSTREAMS.json] [--port 0]',
  '  supplier-accounts show --state PRIVATE_STATE [--offset 0] [--limit 50]',
  '  supplier-accounts proposal --state PRIVATE_STATE --out NEW_PRIVATE_DRAFT.json',
  '  supplier-accounts prepare --state PRIVATE_STATE --draft PRIVATE_DRAFT.json',
  '  supplier-accounts review --state PRIVATE_STATE --id CHANGE_ID',
  '  supplier-accounts apply|recover --state PRIVATE_STATE --id CHANGE_ID --revision N --review-sha256 SHA256',
  '  supplier-accounts cancel --state PRIVATE_STATE --id CHANGE_ID --revision N',
  '  supplier-accounts restore-change|rebase --state PRIVATE_STATE --id CHANGE_ID --source-sha256 SHA256 [--note-file FILE]',
  '  supplier-accounts inspect --state PRIVATE_STATE',
  '  supplier-accounts report --state PRIVATE_STATE --out NEW_PRIVATE_REPORT.json',
  '  supplier-accounts backup --state PRIVATE_STATE --out NEW_PRIVATE_BACKUP.json',
  '  supplier-accounts receive --state NEW_OR_EMPTY_PRIVATE_STATE --upstreams ORIGINAL_UPSTREAMS.json --backup PRIVATE_BACKUP.json',
  '',
  'Create the workspace once with init or serve --upstreams, then reopen the same state.',
  'Proposals edit supplier declarations and assignments in the original source.',
  'Saving retains account identities, usage and cooldowns; the merchant loads changes on its next normal start.',
  'Source files and output parents are private; credential values are never expanded.',
].join('\n');
const COMMANDS = {
  init: ['--upstreams'],
  serve: ['--upstreams', '--port', '--managed-source-sha256'],
  show: ['--offset', '--limit'], proposal: ['--out'], prepare: ['--draft'],
  review: ['--id'], apply: ['--id', '--revision', '--review-sha256'], recover: ['--id', '--revision', '--review-sha256'],
  cancel: ['--id', '--revision'], 'restore-change': ['--id', '--source-sha256', '--note-file'],
  rebase: ['--id', '--source-sha256', '--note-file'], inspect: [], report: ['--out'], backup: ['--out'],
  receive: ['--upstreams', '--backup'],
};
function parse(args) {
  const [command, ...rest] = args;
  need(Object.hasOwn(COMMANDS, command ?? ''), 'SUPPLIER_ACCOUNTS_COMMAND_REQUIRED');
  const options = Object.create(null), permitted = new Set(['--state', ...COMMANDS[command]]);
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index], value = rest[index + 1];
    need(permitted.has(name) && !Object.hasOwn(options, name) && typeof value === 'string' && value && !value.startsWith('--'),
      'SUPPLIER_ACCOUNTS_ARGUMENT_INVALID');
    options[name] = value;
  }
  need(options['--state'], 'SUPPLIER_WORKSPACE_DIRECTORY_REQUIRED');
  return { command, options };
}
const required = (options, name) => { need(options[name], 'SUPPLIER_ACCOUNTS_ARGUMENT_REQUIRED'); return options[name]; };
function number(value, fallback) {
  if (value === undefined) return fallback;
  need(/^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)), 'SUPPLIER_ACCOUNTS_INTEGER_REQUIRED');
  return Number(value);
}
async function privateInput(path, maximum) {
  const filename = resolve(path); await privateDirectory(dirname(filename));
  return readPrivateJson(filename, maximum);
}
async function output(path, value) {
  const filename = resolve(path), directory = dirname(filename), bytes = Buffer.from(json(value));
  await privateDirectory(directory);
  await atomicJson(directory, basename(filename), value, { exclusive: true });
  return { path: filename, bytes: bytes.length, sha256: digest(bytes) };
}
async function note(options) {
  if (!options['--note-file']) return '';
  const value = await privateInput(options['--note-file'], 16384);
  need(typeof value === 'string', 'SUPPLIER_NOTE_FILE_REQUIRES_JSON_STRING');
  return value;
}

async function serve(directory, options) {
  const upstreamsFile = options['--upstreams'] ? resolve(options['--upstreams']) : undefined;
  const expected = options['--managed-source-sha256'];
  need(expected === undefined || /^[a-f0-9]{64}$/.test(expected) && upstreamsFile, 'SUPPLIER_MANAGED_SOURCE_INVALID');
  let host = null, stopped = null, stopRequested = false;
  const remove = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
  function stop() {
    stopRequested = true;
    if (host) return stopped ??= host.close().finally(remove);
    return Promise.resolve();
  }
  const interrupt = () => { process.exitCode = 130; stop().catch(() => { process.exitCode = 1; }); };
  const terminate = () => { process.exitCode = 143; stop().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    if (expected) {
      const original = await inspectSupplierAccountSource(upstreamsFile);
      need(original.sha256 === expected, 'SUPPLIER_MANAGED_SOURCE_CHANGED', 409);
    }
    if (stopRequested) { remove(); return null; }
    const requestedPort = number(options['--port'], 0);
    host = await startSupplierAccountWorkspace({ directory, upstreamsFile, port: requestedPort });
    if (stopRequested) { await stop(); return null; }
    const view = await host.workspace.view();
    need(view.source && (!expected || view.source.sha256 === expected), 'SUPPLIER_MANAGED_SOURCE_CHANGED', 409);
    if (stopRequested) { await stop(); return null; }
    const startup = { schema: SUPPLIER_ACCOUNT_STARTUP_SCHEMA, status: 'SUPPLIER_ACCOUNTS_READY',
      instanceId: randomUUID(), workspaceId: view.id, pid: process.pid, startedAt: new Date().toISOString(),
      directory, upstreamsFile: view.source.path, sourceSha256: view.source.sha256,
      requestedPort, port: host.port, url: host.url };
    process.stdout.write(JSON.stringify(startup) + '\n');
    return { ...host, close: stop };
  } catch (error) { try { await stop(); } finally { remove(); } throw error; }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args.length === 1 && ['--help', 'help'].includes(args[0])) {
    process.stdout.write(HELP + '\n'); return null;
  }
  const { command, options } = parse(args), directory = resolve(options['--state']);
  if (command === 'serve') return serve(directory, options);
  if (command === 'receive') {
    const result = await restoreSupplierAccountWorkspace({ directory,
      upstreamsFile: resolve(required(options, '--upstreams')),
      backup: await privateInput(required(options, '--backup'), 65 * 1024 * 1024) });
    process.stdout.write(json(result)); return result;
  }
  const workspace = await openSupplierAccountWorkspace({ directory,
    ...(command === 'init' ? { upstreamsFile: resolve(required(options, '--upstreams')) } : {}) });
  let result;
  try {
    if (command === 'init') result = await workspace.view();
    else if (command === 'show') result = await workspace.view({ offset: number(options['--offset'], 0), limit: number(options['--limit'], 50) });
    else if (command === 'proposal') {
      const view = await workspace.view();
      need(view.source && view.configuration, view.sourceError ?? 'SUPPLIER_SOURCE_UNAVAILABLE');
      result = await output(required(options, '--out'), { sourceSha256: view.source.sha256,
        accounts: view.configuration.accounts.map(({ bindings, ...row }) => row),
        assignments: view.configuration.bindings.map(row => ({ binding: row.name, account: row.supplierAccount })), note: '' });
    } else if (command === 'prepare') result = await workspace.prepare(await privateInput(required(options, '--draft'), 2 * 1024 * 1024));
    else if (command === 'review') result = await workspace.read(required(options, '--id'));
    else if (['apply', 'recover'].includes(command)) result = await workspace[command]({
      id: required(options, '--id'), revision: number(required(options, '--revision')),
      reviewSha256: required(options, '--review-sha256') });
    else if (command === 'cancel') result = await workspace.cancel({
      id: required(options, '--id'), revision: number(required(options, '--revision')) });
    else if (command === 'restore-change' || command === 'rebase') result = await workspace[
      command === 'rebase' ? 'prepareRebase' : 'prepareRestore']({ id: required(options, '--id'),
      sourceSha256: required(options, '--source-sha256'), note: await note(options) });
    else if (command === 'inspect') result = await workspace.inspectQuota();
    else if (command === 'report') result = await output(required(options, '--out'), await workspace.report());
    else if (command === 'backup') result = await output(required(options, '--out'), await workspace.backup());
  } finally { await workspace.close(); }
  process.stdout.write(json(result)); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write((error.code ?? (error instanceof TypeError ? error.message : 'SUPPLIER_WORKSPACE_OPERATION_FAILED')) + '\n');
    process.exitCode = 1;
  });
}
