#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Installed entry and source-bound native reader for the original QGIS analyst.
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {constants} from 'node:os';
const execute = promisify(execFile);
export const QGIS_ANALYST_ROOT = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
export const QGIS_ANALYST_BINDING = 'starforge.stac-qgis-analyst-binding.v1';

export async function inspectAnalystBinding({pythonExecutable, workspaceDirectory, nativeRuntimeFile, sourceRoot = QGIS_ANALYST_ROOT, environment = process.env} = {}) {
  const args = ['-B', resolve(sourceRoot, 'analyst/binding.py'), '--workspace', resolve(workspaceDirectory), '--source-root', resolve(sourceRoot)];
  if (nativeRuntimeFile) args.push('--native-runtime-file', resolve(nativeRuntimeFile));
  const result = await execute(pythonExecutable, args, {env: environment, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000, windowsHide: true});
  const value = JSON.parse(result.stdout);
  if (value?.schema !== QGIS_ANALYST_BINDING || !/^[a-f0-9]{64}$/.test(value.sha256 ?? ''))
    throw new TypeError('The selected original Python did not return the complete QGIS workspace binding.');
  return value;
}
export const HELP = [
  'Original QGIS analyst workspace',
  '',
  '  starforge stac-qgis-analyst --workspace ORIGINAL_DIR --python EXISTING_PYTHON',
  '    [--native-runtime-file PRIVATE_RUNTIME_JSON] [--connection-file PRIVATE_NEW_JSON] [--port 0]',
  '',
  'Open the original private connection URL printed by the listener.',
  'Applications also exposes Review, Save, Start, Open and Stop for this same workspace.',
  'Native runtime JSON uses the existing QField contract:',
  '  {"native_command":["/absolute/existing/qgis-python"],"qfieldsync_path":"/existing/plugin/path","prefix_path":"/existing/qgis/prefix"}',
  'Optional paths are included only when the existing native environment needs them.',
  'Read ANALYST.md and FIELD_OPERATIONS.md for complete operation and receiving.',
].join('\n') + '\n';

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0])) {
    process.stdout.write(HELP); return {exitCode: 0};
  }
  const allowed = new Set(['--workspace', '--python', '--source-root', '--expected-binding', '--native-runtime-file', '--connection-file', '--port']);
  const options = new Map();
  if (argv.length % 2) throw new TypeError('Select the original workspace and named analyst options.');
  for (let index = 0; index < argv.length; index += 2) {
    const [name, value] = argv.slice(index, index + 2);
    if (!allowed.has(name) || options.has(name) || typeof value !== 'string' || !value || value.includes('\0'))
      throw new TypeError('Invalid or repeated analyst option: ' + name);
    options.set(name, value);
  }
  if (!options.has('--workspace')) throw new TypeError('--workspace is required.');
  const workspace = resolve(options.get('--workspace'));
  const python = options.get('--python') || process.env.STARFORGE_QGIS_OPERATOR_PYTHON || 'python3';
  const nativeFile = options.has('--native-runtime-file') ? resolve(options.get('--native-runtime-file')) : null;
  const expected = options.get('--expected-binding');
  if (expected && !/^[a-f0-9]{64}$/.test(expected)) throw new TypeError('Use the original reviewed binding SHA-256.');
  if (options.has('--source-root')) {
    const original = await inspectAnalystBinding({pythonExecutable: python, workspaceDirectory: workspace,
      nativeRuntimeFile: nativeFile, sourceRoot: resolve(options.get('--source-root'))});
    if (!expected || original.sha256 !== expected) throw new TypeError('The selected original QGIS launch binding changed.');
  }
  const args = ['-B', resolve(QGIS_ANALYST_ROOT, 'analyst/server.py'), '--workspace', workspace];
  if (nativeFile) args.push('--native-runtime-file', nativeFile);
  if (expected) args.push('--expected-binding', expected);
  if (options.has('--connection-file')) args.push('--connection-file', resolve(options.get('--connection-file')));
  if (options.has('--port')) {
    const port = options.get('--port');
    if (!/^(0|[1-9][0-9]*)$/.test(port) || Number(port) > 65535) throw new TypeError('Select a local port from 0 through 65535.');
    args.push('--port', port);
  }
  const answer = await new Promise((resolvePromise, reject) => {
    const child = spawn(python, args, {stdio: 'inherit'});
    let settled = false;
    const signals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => { if (child.exitCode === null) child.kill(signal); }]));
    for (const [signal, listener] of signals) process.on(signal, listener);
    const cleanup = () => { for (const [signal, listener] of signals) process.removeListener(signal, listener); };
    child.once('error', error => { if (!settled) { settled = true; cleanup(); reject(error); } });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true; cleanup();
      resolvePromise({exitCode: code ?? 128 + (constants.signals[signal] ?? 1), signal: signal ?? null});
    });
  });
  if (answer.exitCode) process.exitCode = answer.exitCode;
  return answer;
}
export const run = main;
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({error: error.code ?? error.name, message: error.message}) + '\n'); process.exitCode = 1; });
