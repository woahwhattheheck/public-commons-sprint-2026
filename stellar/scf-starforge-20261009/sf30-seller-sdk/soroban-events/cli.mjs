#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openSorobanEventsWorkspace } from './engine.mjs';
import { startSorobanEventsServer } from './server.mjs';
import { SorobanEventsError, requireValue } from './rpc.mjs';

const HELP = [
  'Soroban event workspace',
  '',
  'node cli.mjs <command> --workspace /absolute/private/events [options]',
  '',
  'Commands:',
  '  open                 Start the private industrial operator browser',
  '  state                List original plans, captures, editions and exports',
  '  plan-save            Save a plan version from --input JSON',
  '  capture-start        Capture the current version of --plan ID',
  '  capture-resume       Continue --capture ID from its native cursor',
  '  capture-status       Inspect --capture ID',
  '  events               Page retained events using --capture ID, --after ID, --limit N',
  '  edition-create       Freeze --capture ID using --name LABEL',
  '  edition              Inspect --edition ID',
  '  export               Export --edition ID as complete native source files',
  '  receive              Receive --source-directory PATH into this workspace',
  '  publisher-source     Print the exact event-array source for --edition ID',
  '  source-file          Download --export ID --path RELATIVE --output NEW_FILE',
  '',
  'Mutations require --request ID and --revision N. Reusing identical original',
  'request arguments recovers the saved result. Capture uses --connection-file JSON',
  'with rpcUrl/network and optional headers; the file remains local to the host.',
  'open accepts --port N and optional --token-file PRIVATE_FILE.',
  'receive accepts --manifest-sha256 HEX to bind the original source manifest.',
  'A missing plan range selects the latest observed ledger; endLedger is exclusive.',
  'Save plans with explicit startLedger/endLedger for a historical event window.',
].join('\n');

function parse(argv) {
  const command = argv.shift() ?? 'help', options = {};
  while (argv.length) {
    const key = argv.shift();
    requireValue(key.startsWith('--') && argv.length, 'INVALID_ARGUMENT', 'Options use --name VALUE');
    const name = key.slice(2);
    requireValue(!Object.hasOwn(options, name), 'INVALID_ARGUMENT', 'Repeated option ' + key);
    options[name] = argv.shift();
  }
  return { command, options };
}
async function jsonFile(path) { return JSON.parse(await fs.readFile(resolve(path), 'utf8')); }
export async function runSorobanEventsCLI(argv = process.argv.slice(2), io = { write: (text) => process.stdout.write(text) }) {
  const { command, options } = parse([...argv]);
  if (['help', '--help', '-h'].includes(command)) { io.write(HELP + '\n'); return; }
  requireValue(options.workspace, 'INVALID_ARGUMENT', '--workspace is required');
  const directory = resolve(options.workspace);
  const connectionFile = options['connection-file'] ?? options.connection;
  const connection = connectionFile ? await jsonFile(connectionFile) : undefined;
  if (command === 'open') {
    const token = options['token-file'] ? (await fs.readFile(resolve(options['token-file']), 'utf8')).trim() : undefined;
    requireValue(options['startup-format'] === undefined || options['startup-format'] === 'json', 'INVALID_ARGUMENT', 'Supported startup format is json');
    const server = await startSorobanEventsServer({ directory, connection, port: Number(options.port ?? 0), token, expectedWorkspaceId: options['expected-workspace-id'] });
    io.write(JSON.stringify({ schema: 'stellar-forge.soroban-events-workspace-startup.v1', status: 'SOROBAN_EVENTS_READY', directory,
      workspaceId: (await server.workspace.describe()).workspaceId, sourceDirectory: dirname(fileURLToPath(import.meta.url)),
      connectionFile: connectionFile ? resolve(connectionFile) : null, url: server.url, origin: server.origin, pid: process.pid }) + '\n');
    const stop = () => { server.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return server;
  }
  if (command === 'receive') requireValue(typeof options['source-directory'] === 'string' && options['source-directory'].trim().length > 0, 'INVALID_ARGUMENT', '--source-directory is required for receive');
  const workspace = await openSorobanEventsWorkspace({ directory, connection });
  try {
    const mutation = () => {
      requireValue(options.request && options.revision !== undefined, 'INVALID_ARGUMENT', '--request and --revision are required for a workspace change');
      return { requestId: options.request, expectedRevision: Number(options.revision) };
    };
    let result;
    if (command === 'state') result = await workspace.describe();
    else if (command === 'plan-save') result = await workspace.planSave({ ...await jsonFile(options.input), ...mutation() });
    else if (command === 'capture-start') result = await workspace.captureStart({ ...mutation(), planId: options.plan });
    else if (command === 'capture-resume') result = await workspace.captureResume({ ...mutation(), captureId: options.capture });
    else if (command === 'capture-status') result = await workspace.captureStatus({ captureId: options.capture });
    else if (command === 'events') result = await workspace.eventPage({ captureId: options.capture, after: options.after ?? null, limit: Number(options.limit ?? 100), contractId: options.contract ?? null, type: options.type ?? null });
    else if (command === 'edition-create') result = await workspace.editionCreate({ ...mutation(), captureId: options.capture, name: options.name });
    else if (command === 'edition') result = await workspace.edition({ editionId: options.edition });
    else if (command === 'export') result = await workspace.sourceExport({ ...mutation(), editionId: options.edition });
    else if (command === 'receive') result = await workspace.sourceReceive({ ...mutation(), sourceDirectory: resolve(options['source-directory']), ...(options['manifest-sha256'] === undefined ? {} : { expectedManifestSha256: options['manifest-sha256'] }) });
    else if (command === 'publisher-source') result = await workspace.publisherSource({ editionId: options.edition });
    else if (command === 'source-file') {
      requireValue(options.output, 'INVALID_ARGUMENT', '--output must select a new file');
      const file = await workspace.sourceFile({ exportId: options.export, path: options.path });
      const output = resolve(options.output), handle = await fs.open(output, 'wx', 0o600);
      try { await handle.writeFile(file.content); await handle.sync(); } finally { await handle.close(); }
      result = { path: output, bytes: file.bytes, sha256: file.sha256 };
    } else throw new SorobanEventsError('INVALID_COMMAND', 'Unknown command: ' + command);
    io.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally { await workspace.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runSorobanEventsCLI().catch((error) => {
    process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'WORKSPACE_ERROR', message: error.message, details: error.details ?? {} } }) + '\n');
    process.exitCode = 1;
  });
}
