#!/usr/bin/env node
// MIT. Create, author, run explicit previews, and reopen the original Python merchant workspace.
import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace, openWorkspace, importWorkspace } from './model.mjs';
import { startPythonWorkspace } from './server.mjs';
import { runActiveRelease } from '../../../sf82-seller-pilot/releases.mjs';

const HELP = `Python merchant workspace (Node 22.13+)

  create --workspace NEW_DIR --config MERCHANT.json [--python-root SOURCE_DIR] [--label TEXT]
  serve --workspace DIR [--port 8431]
  status --workspace DIR
  revision --workspace DIR [--id REVISION]
  file --workspace DIR --revision REVISION --path RELATIVE_PATH [--out NEW_FILE]
  save --workspace DIR --input SOURCE_CHANGE.json
  restore --workspace DIR --revision REVISION --expect HEAD [--note TEXT]
  refresh-source --workspace DIR --expect HEAD [--note TEXT]
  preview --workspace DIR --revision REVISION --function NAME --input INPUT.json --operation UNIQUE_ID [--out NEW_FILE]
  stage --workspace DIR --revision REVISION --id RELEASE [--label TEXT] [--port 8423]
        [--facilitator URL] [--allow-local-facilitator]
  diff --workspace DIR --to RELEASE [--from RELEASE]
  activate --workspace DIR --id RELEASE --expect GENERATION [--reason TEXT]
  rollback --workspace DIR [--to RELEASE] --expect GENERATION [--reason TEXT]
  run --workspace DIR --expect GENERATION
  export --workspace DIR --out NEW_BUNDLE.json
  import --workspace NEW_DIR --bundle BUNDLE.json

Source changes are the same JSON object accepted by POST /api/revisions: expectedHead,
baseRevision, note, entry, declarationText, changed files [{path,text}|{path,base64}], remove[].
Previews explicitly execute retained Python source privately and wait for their own worker shutdown.
Staging only retains original SF82 release sources. Activation selects a version; Run starts it.
Without a facilitator, the original running seller stays CHALLENGE_ONLY and imports no Python app.
The browser owns its seller instance and provides stop/restart, customer SDK export, and download controls.
Ctrl+C closes the foreground console or original release manager and its owned Python workers.
All output files and imported workspace directories are create-only.
`;
function parse(argv) {
  const command = argv[0] ?? 'help', values = {};
  for (let index = 1; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith('--') || key.length < 3 || Object.hasOwn(values, key.slice(2))) throw new Error('Use unique --name value arguments.');
    if (key === '--allow-local-facilitator') values[key.slice(2)] = true;
    else { if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) throw new Error('Missing value for ' + key + '.'); values[key.slice(2)] = argv[++index]; }
  }
  return { command, values };
}
function requireValue(values, key) { if (!values[key]) throw new Error('--' + key + ' is required.'); return values[key]; }
function integer(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Expected a nonnegative integer, received ' + value + '.');
  return Number(value);
}
async function json(path) { return JSON.parse(await readFile(resolve(path), 'utf8')); }
async function writeNew(path, bytes) {
  const file = await open(resolve(path), 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || ['help', '--help', '-h'].includes(argv[0])) { process.stdout.write(HELP); return; }
  const { command, values } = parse(argv), root = resolve(requireValue(values, 'workspace'));
  const allowed = {
    create: ['workspace', 'config', 'python-root', 'label'], serve: ['workspace', 'port'], status: ['workspace'],
    revision: ['workspace', 'id'], file: ['workspace', 'revision', 'path', 'out'], save: ['workspace', 'input'],
    restore: ['workspace', 'revision', 'expect', 'note'], 'refresh-source': ['workspace', 'expect', 'note'],
    preview: ['workspace', 'revision', 'function', 'input', 'operation', 'out'],
    stage: ['workspace', 'revision', 'id', 'label', 'port', 'facilitator', 'allow-local-facilitator'],
    diff: ['workspace', 'from', 'to'], activate: ['workspace', 'id', 'expect', 'reason'],
    rollback: ['workspace', 'to', 'expect', 'reason'], run: ['workspace', 'expect'],
    export: ['workspace', 'out'], import: ['workspace', 'bundle'],
  }[command];
  if (!allowed) throw new Error('Unknown command ' + command + '. Run with --help.');
  for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new Error('Unknown option --' + key + ' for ' + command + '.');
  let workspace, consoleServer;
  try {
    if (command === 'create') workspace = await createWorkspace(root, { config: requireValue(values, 'config'), pythonRoot: values['python-root'], label: values.label });
    else if (command === 'import') workspace = await importWorkspace(root, requireValue(values, 'bundle'));
    else workspace = await openWorkspace(root);
    if (command === 'serve') {
      consoleServer = await startPythonWorkspace(workspace, { port: integer(values.port, 8431) });
      const onSignal = () => { void consoleServer.close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }); };
      process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
      print({ schema: 'stellar-forge.python-workspace-console.v1', workspace: root, operatorUrl: consoleServer.operatorUrl });
      try { await consoleServer.closed; } finally { process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); }
      return;
    }
    if (['create', 'import', 'status'].includes(command)) print(await workspace.state());
    else if (command === 'revision') print(workspace.revision(values.id ?? workspace.metadata().head));
    else if (command === 'file') {
      const result = await workspace.file(requireValue(values, 'revision'), requireValue(values, 'path'));
      if (values.out) { await writeNew(values.out, await workspace.blob(result.sha256)); print({ path: resolve(values.out), bytes: result.bytes, sha256: result.sha256 }); }
      else print(result);
    } else if (command === 'save') print(await workspace.save(await json(requireValue(values, 'input'))));
    else if (command === 'restore') print(await workspace.restore({ expectedHead: requireValue(values, 'expect'), revisionId: requireValue(values, 'revision'), note: values.note }));
    else if (command === 'refresh-source') print(await workspace.refreshSource({ expectedHead: requireValue(values, 'expect'), note: values.note }));
    else if (command === 'preview') {
      let interrupted = false;
      const onSignal = () => {
        interrupted = true;
        for (const active of workspace.jobs.values()) active.controller.abort(new Error('Foreground preview interrupted.'));
      };
      process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
      try {
        const started = await workspace.preview({ revisionId: requireValue(values, 'revision'), function: requireValue(values, 'function'),
          input: await json(requireValue(values, 'input')), operationId: requireValue(values, 'operation') });
        const owned = workspace.jobs.get(started.id);
        if (interrupted) owned?.controller.abort(new Error('Foreground preview interrupted.'));
        if (owned) await owned.completion;
        const result = await workspace.previewDetail(started.id);
        if (values.out) { const output = await workspace.previewOutput(started.id); await writeNew(values.out, output.bytes); print({ ...result, output: { path: resolve(values.out), bytes: output.bytes.length, sha256: output.sha256 } }); }
        else print(result);
        if (['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(result.status)) process.exitCode = 1;
      } finally { process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); }
    } else if (command === 'stage') print(await workspace.stage({ revisionId: requireValue(values, 'revision'), id: requireValue(values, 'id'), label: values.label,
      runtime: { port: integer(values.port, 8423), ...(values.facilitator ? { facilitator: values.facilitator } : {}), ...(values['allow-local-facilitator'] ? { allowLocalFacilitator: true } : {}) } }));
    else if (command === 'diff') print(await workspace.diff(values.from ?? null, requireValue(values, 'to')));
    else if (command === 'activate') print(await workspace.activate({ id: requireValue(values, 'id'), expectedGeneration: integer(requireValue(values, 'expect')), reason: values.reason }));
    else if (command === 'rollback') print(await workspace.rollback({ to: values.to, expectedGeneration: integer(requireValue(values, 'expect')), reason: values.reason }));
    else if (command === 'run') {
      const session = await runActiveRelease(workspace.releaseRoot, { expectedGeneration: integer(requireValue(values, 'expect')) });
      print({ schema: 'stellar-forge.python-workspace-running.v1', release: session.release, url: session.url, mode: session.mode, instanceId: session.observation.instanceId });
      try { await session.completion; } finally { await session.close(); }
    } else if (command === 'export') {
      const result = await workspace.exportBundle(); await writeNew(requireValue(values, 'out'), result.bytes);
      print({ schema: 'stellar-forge.python-workspace-export-written.v1', path: resolve(values.out), bytes: result.bytes.length, sha256: result.sha256 });
    }
  } finally { if (consoleServer) await consoleServer.close(); else if (workspace) await workspace.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(JSON.stringify({ error: error.code ?? 'WORKSPACE_ERROR', message: error.message }) + '\n'); process.exitCode = 1;
});
