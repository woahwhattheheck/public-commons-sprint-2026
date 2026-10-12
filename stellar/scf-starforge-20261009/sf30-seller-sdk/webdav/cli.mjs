#!/usr/bin/env node
// MIT. One explicit source/publisher intent per command; no payment retry loop.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readPrivate } from '../postgres/publisher/files.mjs';
import { openWebDavWorkspace } from './workspace.mjs';
import { start } from './server.mjs';
import { importSourcePacket, inspectSourcePacket } from './packet.mjs';
import { fail } from './config.mjs';

const HELP = [
  'Stellar Forge WebDAV source workspace',
  '',
  '  node cli.mjs serve --directory ABS --port 0 [--python PYTHON]',
  '  node cli.mjs state --directory ABS',
  '  node cli.mjs operation --directory ABS --id UUID',
  '  node cli.mjs act ACTION --directory ABS --input PRIVATE_JSON_FILE',
  '      [--operation-id UUID] [--expected-revision INTEGER]',
  '  node cli.mjs export-source --directory ABS',
  '  node cli.mjs inspect-source --input ABS_ZIP',
  '  node cli.mjs import-source --input ABS_ZIP --directory NEW_ABS_DIRECTORY',
  '',
  'Source actions: source.save, source.catalogue, capture.start, capture.resume,',
  '  capture.sample, mapping.save, edition.build, merchant.save, edition.export,',
  '  source.packet, publisher.prepare, publisher.act.',
  '',
  'act input is the exact action input object, with atomic payment amounts as strings.',
  'Each new command reports its operation ID and reviewed revision before it starts.',
  'Supply the SAME operation ID and original input to reopen its retained result.',
  'A native publisher mutation with an unknown result requires original status review.',
  'Starting publisher.release.start through act keeps this process alive; Ctrl+C',
  'drains its own seller. The browser serve command manages that same lifecycle.',
  '',
  'export-source writes a create-only packet under the workspace packets/ directory.',
  'It includes exact source bytes, projections, editions and merchant exports.',
  'Original publisher/release/buyer/key/ledger directories are retained at this host.',
  'import-source creates a fresh private source workspace. Prepare a retained export',
  'with the original publisher there; it does not transplant an active buyer session.',
  '',
  'Runtime: Linux, Node 22+, Python 3 with Expat >=2.6, util-linux flock, and the',
  'complete matching Stellar Forge source/dependencies. See README.md.',
].join('\n');

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!/^--[a-z-]+$/.test(key ?? '') || !argv[i + 1] || Object.hasOwn(result, key.slice(2)))
      fail('WEBDAV_CLI_ARGUMENTS', HELP);
    result[key.slice(2)] = argv[i + 1];
  }
  return result;
}
function only(value, allowed) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('WEBDAV_CLI_ARGUMENTS', 'Unknown option --' + key + '.\n' + HELP);
}
function absolute(value, label) {
  if (typeof value !== 'string' || !value.startsWith('/') || resolve(value) !== value || value === '/')
    fail('WEBDAV_CLI_PATH', 'Use a normalized absolute ' + label + '.');
  return value;
}
function json(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }
async function signals(close) {
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    try { await close(); } catch (error) { process.stderr.write((error.code ?? 'WEBDAV_CLOSE_FAILED') + '\n'); process.exitCode = 1; }
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); };
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && ['--help', 'help'].includes(argv[0])) { process.stdout.write(HELP + '\n'); return; }
  const command = argv[0], action = command === 'act' ? argv[1] : null, args = options(argv.slice(command === 'act' ? 2 : 1));
  const python = args.python ?? 'python3';
  if (command === 'serve') {
    only(args, ['directory', 'port', 'python']);
    const service = await start({ directory: absolute(args.directory, 'workspace directory'), port: Number(args.port ?? 0), python });
    await signals(service.close);
    json({ status: 'WEBDAV_OPERATOR_READY', url: service.url, directory: service.directory, workspaceId: service.workspaceId,
      revision: service.revision, pid: service.pid }); return;
  }
  if (command === 'inspect-source' || command === 'import-source') {
    only(args, command === 'inspect-source' ? ['input', 'python'] : ['input', 'directory', 'python']);
    const controller = new AbortController(), remove = await signals(() => controller.abort());
    try {
      const value = { input: absolute(args.input, 'source packet file'), python, signal: controller.signal };
      json(command === 'inspect-source' ? await inspectSourcePacket(value)
        : await importSourcePacket({ ...value, directory: absolute(args.directory, 'fresh destination directory') }));
    } finally { remove(); }
    return;
  }
  if (!['state', 'operation', 'act', 'export-source'].includes(command)) fail('WEBDAV_CLI_ARGUMENTS', HELP);
  only(args, command === 'act' ? ['directory', 'input', 'operation-id', 'expected-revision', 'python']
    : command === 'operation' ? ['directory', 'id', 'python'] : ['directory', 'python']);
  const workspace = await openWebDavWorkspace({ directory: absolute(args.directory, 'workspace directory'), python });
  let retained = false;
  const remove = await signals(workspace.close);
  try {
    if (command === 'state') return json(await workspace.inspect());
    if (command === 'operation') return json(await workspace.operation(args.id));
    let input = {};
    if (command === 'act') {
      if (!action) fail('WEBDAV_CLI_ARGUMENTS', HELP);
      const bytes = await readPrivate(absolute(args.input, 'private JSON input file'), 1048576);
      try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { fail('WEBDAV_CLI_JSON', 'Use a complete UTF-8 JSON input object.'); }
    }
    const state = await workspace.inspect(), operationId = args['operation-id'] ?? randomUUID();
    const expectedRevision = args['expected-revision'] === undefined ? state.revision : Number(args['expected-revision']);
    process.stderr.write(JSON.stringify({ status: 'WEBDAV_INTENT', action: action ?? 'source.packet', operationId, expectedRevision }) + '\n');
    const result = await workspace.act(action ?? 'source.packet', { operationId, expectedRevision, input });
    json(result);
    if (command === 'act' && action === 'publisher.act' && input.action === 'publisher.release.start') retained = true;
    return result;
  } finally { if (!retained) { remove(); await workspace.close(); } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'WEBDAV_COMMAND_FAILED', message: error.message } }) + '\n'); process.exitCode = 1; });
