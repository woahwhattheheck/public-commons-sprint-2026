#!/usr/bin/env node
// MIT. Original Starforge dispatcher entry for native QGIS receiving.
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {exportQgisReceiving,openQgisReceiving} from './bridge.mjs';

export const QGIS_HELP = [
  'QGIS receiving for an original STAC customer delivery',
  '',
  'starforge stac-qgis export --directory ORIGINAL_RECEIVED_DIR --out NEW_QGIS_SOURCE_DIR',
  'starforge stac-qgis open --directory QGIS_SOURCE_DIR [--expected-manifest-sha256 SHA256]',
  'starforge stac-qgis plugin --out PLUGIN_ZIP [--python EXISTING_PYTHON]',
  '',
  'The export preserves and verifies the complete native customer delivery.',
  'Install the generated ZIP through QGIS Plugins > Manage and Install Plugins > Install from ZIP.',
  'Open Starforge STAC Receiving to import qgis-receiving.json into a private GIS workspace.',
  'The complete native project, analyst choices, source editions and recovery archive are operated there.',
  '',
  'The equivalent original stac command names are qgis-export, qgis-open and qgis-plugin.',
  'QGIS supplies its own Python, Qt, GDAL and projection libraries. This command installs none.',
  'See qgis/OPERATIONS.md for layer choices, later-edition review and complete receiving.'
].join('\n') + '\n';

function flags(argv) {
  const values = {}, args = [];
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith('--')) { args.push(value); continue; }
    const at = value.indexOf('='), key = at < 0 ? value.slice(2) : value.slice(2, at);
    if (at >= 0) values[key] = value.slice(at + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) values[key] = argv[++i];
    else values[key] = true;
  }
  return {values, args};
}
function required(values, key) {
  if (typeof values[key] !== 'string' || !values[key]) throw new TypeError('--' + key + ' is required.');
  return values[key];
}
export async function runQgisCommand({command, flags: values = {}} = {}) {
  command = command?.replace(/^qgis-/, '');
  if (command === 'help' || !command) return {text: QGIS_HELP};
  if (command === 'export') return {result: await exportQgisReceiving({
    directory: resolve(required(values, 'directory')), out: resolve(required(values, 'out'))})};
  if (command === 'open') {
    const opened = await openQgisReceiving({directory: resolve(required(values, 'directory')),
      expectedManifestSha256: values['expected-manifest-sha256']});
    return {result: {directory: opened.directory, source: opened.manifest.source,
      summary: opened.manifest.summary, manifest: opened.manifestFile.record}};
  }
  if (command === 'plugin') {
    const python = values.python ?? process.env.STARFORGE_QGIS_PYTHON ?? 'python3';
    if (typeof python !== 'string' || !python) throw new TypeError('Select an existing Python executable.');
    const script = fileURLToPath(new URL('./plugin-package.py', import.meta.url));
    const out = resolve(required(values, 'out'));
    return {result: await new Promise((resolvePromise, reject) => {
      const child = spawn(python, ['-B', script, '--out', out], {stdio: ['ignore', 'pipe', 'pipe']});
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', value => {stdout += value; if (stdout.length > 1024 * 1024) child.kill();});
      child.stderr.on('data', value => {stderr = (stderr + value).slice(-65536);});
      child.once('error', reject);
      child.once('close', code => {
        if (code !== 0) return reject(new Error(stderr || 'QGIS plugin packaging exited ' + code));
        try {resolvePromise(JSON.parse(stdout));} catch {reject(new Error('Invalid native plugin packaging response.'));}
      });
    })};
  }
  throw new TypeError('Unknown QGIS receiving command: ' + command);
}
export async function main(argv = process.argv.slice(2)) {
  const parsed = flags(argv), answer = await runQgisCommand({command: parsed.args[0] ?? 'help', flags: parsed.values});
  if (answer.text) process.stdout.write(answer.text); else process.stdout.write(JSON.stringify(answer.result, null, 2) + '\n');
}
export const run = main;
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {process.stderr.write(JSON.stringify({error: error.code ?? error.name, message: error.message}) + '\n');process.exitCode = 1;});
