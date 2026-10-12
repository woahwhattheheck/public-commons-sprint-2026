#!/usr/bin/env node
// MIT. Launch the original Datasette Analysis command with its installed Python environment.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPythonInstallation } from '../../distribution/python-runtime/workspace.mjs';
import { absolute, canonical, digest, json, need, plain, regular } from '../../distribution/runtime-workspace/storage.mjs';

export const DATASETTE_ANALYSIS_SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/';
const SCHEMA = 'stellar-forge.datasette-analysis-python-selection.v1';
const HASH = /^[a-f0-9]{64}$/;
const CORE = ['cli.mjs', 'cli.py', 'model.py', 'source.py', 'recipes.py',
  'operator_server.py', 'operator_client.py', 'operator.html', 'operator.css', 'operator.mjs'];
const OPTIONS = new Map([
  ['--runtime-workspace', 'root'], ['--runtime-directory', 'runtimeDirectory'],
  ['--runtime-id', 'runtimeId'], ['--installation-id', 'installationId'],
  ['--expected-binding-sha256', 'expectedBindingSha256'],
]);
const COMMANDS = new Set(['serve', 'status', 'prepare', 'rows', 'compare', 'export',
  'call', 'request', 'download', 'receive']);
const fingerprint = value => digest(json(canonical(value)));

export function parseDatasetteAnalysisCommand(args) {
  need(Array.isArray(args) && args.length <= 160 &&
    args.every(value => typeof value === 'string' && !value.includes('\0') && Buffer.byteLength(value) <= 8192),
    'DATASETTE_ANALYSIS_ARGUMENTS_INVALID');
  const separator = args.indexOf('--');
  need(separator >= 0 && separator < args.length - 1, 'DATASETTE_ANALYSIS_COMMAND_REQUIRED',
    'Select the installed Python environment, then use -- followed by the original Analysis command.');
  const selection = {};
  for (let index = 0; index < separator; index += 2) {
    const name = OPTIONS.get(args[index]);
    need(name && index + 1 < separator && !Object.hasOwn(selection, name),
      'DATASETTE_ANALYSIS_SELECTION_INVALID', 'Select each installation field once.');
    selection[name] = args[index + 1];
  }
  for (const name of ['root', 'runtimeDirectory', 'runtimeId', 'installationId'])
    need(typeof selection[name] === 'string', 'DATASETTE_ANALYSIS_INSTALLATION_REQUIRED',
      'Select runtime workspace, original runtime, runtime ID and installed Python environment.');
  absolute(selection.root); absolute(selection.runtimeDirectory);
  need(/^[a-f0-9]{24}$/.test(selection.runtimeId) && HASH.test(selection.installationId),
    'DATASETTE_ANALYSIS_INSTALLATION_INVALID');
  if (selection.expectedBindingSha256 !== undefined)
    need(HASH.test(selection.expectedBindingSha256), 'DATASETTE_ANALYSIS_BINDING_INVALID');
  const originalArgs = args.slice(separator + 1);
  need(COMMANDS.has(originalArgs[0]), 'DATASETTE_ANALYSIS_COMMAND_INVALID');
  return { selection, originalArgs };
}

export function datasetteAnalysisOption(args, name) {
  const values = [];
  for (let index = 1; index < args.length; index++) {
    if (args[index] === name) {
      need(index + 1 < args.length, 'DATASETTE_ANALYSIS_ARGUMENTS_INVALID');
      values.push(args[index + 1]);
    } else if (args[index].startsWith(name + '=')) values.push(args[index].slice(name.length + 1));
  }
  need(values.length <= 1, 'DATASETTE_ANALYSIS_ARGUMENTS_INVALID', 'Select ' + name + ' once.');
  return values[0];
}

/** Reuse the retained original Python source/wheel installation and its inspection. */
export async function inspectDatasetteAnalysisInstallation(root, {
  runtimeId, runtimeDirectory, installationId, leaseFd,
} = {}) {
  const { binding, installation } = await inspectPythonInstallation(absolute(root), {
    runtimeId, runtimeDirectory: absolute(runtimeDirectory), installationId, leaseFd,
  });
  need(installation.extras?.includes('workbooks') &&
    installation.modules?.analysis === 'stellar_forge_buyer.analysis_workspace',
    'DATASETTE_ANALYSIS_WORKBOOKS_REQUIRED',
    'Install the workbooks extra for this original Python source in the Python workspace.');
  need(HASH.test(installation.id ?? '') && HASH.test(installation.source?.id ?? '') &&
    HASH.test(installation.lockSha256 ?? '') && typeof installation.python === 'string',
    'DATASETTE_ANALYSIS_INSTALLATION_INVALID');
  absolute(installation.python);
  await access(installation.python, constants.X_OK);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    await regular(join(binding.directory, 'package', 'manifest.json'), 16 * 1024 * 1024)));
  need(manifest.sourceCommit === binding.sourceCommit && Array.isArray(manifest.files),
    'DATASETTE_ANALYSIS_SOURCE_CHANGED');
  const files = new Map(manifest.files.map(file => [file.path, file]));
  need(files.size === manifest.files.length, 'DATASETTE_ANALYSIS_SOURCE_CHANGED');
  const sourceFiles = [];
  for (const name of CORE) {
    const path = DATASETTE_ANALYSIS_SOURCE + name, member = files.get(path);
    need(plain(member) && HASH.test(member.sha256 ?? '') && Number.isSafeInteger(member.bytes) &&
      member.bytes > 0 && member.bytes <= 4 * 1024 * 1024,
      'DATASETTE_ANALYSIS_SOURCE_REQUIRED', 'Install the complete Datasette Analysis source: ' + path);
    const bytes = await regular(join(binding.sourceRoot, path), member.bytes);
    need(bytes.length === member.bytes && digest(bytes) === member.sha256,
      'DATASETTE_ANALYSIS_SOURCE_CHANGED', 'Reopen the same installed Analysis source edition.');
    sourceFiles.push({ path, bytes: member.bytes, sha256: member.sha256 });
  }
  const selection = { schema: SCHEMA, runtime: binding, installationId: installation.id,
    sourceId: installation.source.id, lockSha256: installation.lockSha256,
    python: installation.python, extras: ['workbooks'], sourceFiles };
  return { binding, installation, selection, fingerprint: fingerprint(selection) };
}

/** Complete argv for the existing managed worker; the child keeps its original lease. */
export async function resolveDatasetteAnalysisCommand(args, { leaseFd } = {}) {
  const { selection, originalArgs } = parseDatasetteAnalysisCommand(args);
  const selected = await inspectDatasetteAnalysisInstallation(selection.root, { ...selection, leaseFd });
  if (selection.expectedBindingSha256 !== undefined)
    need(selected.fingerprint === selection.expectedBindingSha256,
      'DATASETTE_ANALYSIS_INSTALLATION_CHANGED', 'Review the current original Python environment and source.');
  const commandArgs = [...originalArgs];
  if (commandArgs[0] !== 'receive') {
    const checkout = datasetteAnalysisOption(commandArgs, '--checkout');
    need(checkout === undefined || checkout === selected.binding.sourceRoot,
      'DATASETTE_ANALYSIS_CHECKOUT_CHANGED', 'Use the source carried by the selected original installation.');
    if (checkout === undefined) commandArgs.push('--checkout', selected.binding.sourceRoot);
  }
  const entry = join(selected.binding.sourceRoot, DATASETTE_ANALYSIS_SOURCE, 'cli.py');
  return { executable: selected.installation.python, args: ['-I', entry, ...commandArgs],
    cwd: selected.binding.directory, binding: selected.selection, fingerprint: selected.fingerprint };
}

function usage() {
  return 'Datasette customer Analysis with an installed original Python environment\n\n' +
    'starforge datasette-analysis --runtime-workspace /private/operator \\\n' +
    '  --runtime-directory /private/runtime --runtime-id RUNTIME_ID \\\n' +
    '  --installation-id PYTHON_INSTALLATION_ID -- serve \\\n' +
    '  --workspace /private/analysis --operation-id OPERATION_ID --port 0\n\n' +
    'Commands after -- are the original cli.py commands: serve, status, prepare,\n' +
    'rows, compare, export, call, request, download and receive.\n' +
    'Use the same workspace and operation ID when reopening existing work.\n' +
    'Install workbooks in the existing Python workspace before launch.\n';
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || ['--help', '-h', 'help'].includes(args[0])) {
    process.stdout.write(usage()); return 0;
  }
  const command = await resolveDatasetteAnalysisCommand(args);
  const child = spawn(command.executable, command.args, {
    cwd: command.cwd, env: process.env, shell: false, stdio: 'inherit',
  });
  const forward = signal => child.kill(signal);
  const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    return await new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => accept(code ?? (signal === 'SIGINT' ? 130 : 143)));
    });
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(JSON.stringify({ schema: SCHEMA,
      error: error.code ?? error.name, message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
