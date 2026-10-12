#!/usr/bin/env node
// MIT. One CLI over the original Datasette workspace, publisher and receiving operations.
import {open, rename, unlink, link} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createDatasetteClient, DATASETTE_OPERATIONS, DatasetteClientError} from './client.mjs';

const USAGE = `Datasette source editions

  datasette serve --directory /private/workspace --create
  datasette --directory /private/workspace --operation source.capture --input-file capture.json
  datasette --url http://127.0.0.1:PORT --operation editions.list --input '{}'
  datasette status --url-file /private/datasette-connection.json
  datasette operations --directory /private/workspace
  datasette export-workspace --directory /private/workspace --archive-file /private/workspace.zip
  datasette receive-workspace --archive-file /private/workspace.zip --sha256 SHA256 --destination /private/restored
  datasette receive --directory /private/workspace --archive-file source.datasette.json.gz --sha256 SHA256 --destination /private/received

Options:
  --directory ABS             Original local workspace directory
  --create                    Create that workspace if absent; reopen it if present
  --url URL / --url-file PATH  Connect to the existing original HTTP workspace
  --operation NAME            One operation from the workspace's operation catalog
  --input JSON                Complete operation input, as one JSON object
  --input-file PATH           Complete operation input from a retained JSON file
  --out PATH                  Save the complete result to a new private JSON file
  --port NUMBER               Local server port, default 0 (available port)
  --connection-file PATH      Atomically save the same workspace's current server announcement
  --startup-format managed    Emit the original JSON server announcement
  --expected-workspace-id ID  Bind remote access to the original workspace
  --seller URL                Original local dataset seller http://127.0.0.1:PORT
  --resource URL              Exact advertised HTTPS dataset resource
  --seller-file PATH          Read that seller URL from a private JSON string file
  --resource-file PATH        Read that resource URL from a private JSON string file
  --environment-file PATH     Original environment object for local workspace creation
  --archive-file PATH         Complete source/workspace archive for export or receiving
  --sha256 SHA256             Expected SHA256 of that original archive
  --destination ABS           Separate source or workspace receiving directory
  --help                     Show this guide

Resume a capture with the same operationId and selection. Inspect status after an
interrupted response. Publisher extraction takes its original planId and UUID
runId; publishing takes that same runId and the saved reviewId.
`;
const valued = new Set(['directory','url','url-file','operation','input','input-file','out',
  'port','connection-file','startup-format','expected-workspace-id','seller-file','resource-file',
  'environment-file','archive-file','sha256','destination','seller','resource']);
const switches = new Set(['create','help']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => Object.assign(new Error(message), {code: 'DATASETTE_CLI_INPUT'});

export function parseDatasetteArguments(argv) {
  const result = {command: 'operation'}, seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      if (index !== 0 || !['serve','receive','export-workspace','receive-workspace','status','operations','health'].includes(value)) throw fail('Choose one declared Datasette command.');
      result.command = value; continue;
    }
    const name = value.slice(2);
    if (seen.has(name) || !valued.has(name) && !switches.has(name)) throw fail('Unknown or repeated option: --' + name);
    seen.add(name);
    if (switches.has(name)) {result[name] = true; continue;}
    const supplied = argv[++index];
    if (typeof supplied !== 'string' || !supplied.length || supplied.startsWith('--')) throw fail('A value is required for --' + name);
    result[name] = supplied;
  }
  if (result.help) return result;
  if (result.url && result['url-file'] || result.input && result['input-file']) throw fail('Choose one connection and one operation input.');
  if (result['startup-format'] && result['startup-format'] !== 'managed') throw fail('The startup format is managed.');
  if (result.port !== undefined && (!/^(0|[1-9][0-9]*)$/.test(result.port) || Number(result.port) > 65535)) throw fail('Port must be an integer from 0 to 65535.');
  for (const name of ['seller','resource'])
    if (result[name] && result[name + '-file']) throw fail('Choose one --' + name + ' or --' + name + '-file.');
  const sellerGiven = Boolean(result.seller || result['seller-file']);
  const resourceGiven = Boolean(result.resource || result['resource-file']);
  if (sellerGiven !== resourceGiven) throw fail('Configure the original seller URL and its exact advertised resource together.');
  const remote = Boolean(result.url || result['url-file']);
  if (remote && (result.directory || result.create || result.command === 'serve' ||
      ['seller','resource','seller-file','resource-file','environment-file'].some(key => result[key])))
    throw fail('Remote access uses the original running workspace URL. Local creation uses --directory.');
  const offlineReceive = result.command === 'receive-workspace' && !remote && !result.directory;
  if (!remote && !result.directory && !offlineReceive) throw fail('Supply the original --directory, --url or --url-file.');
  if (offlineReceive && (result.create || result['expected-workspace-id'] ||
      ['seller','resource','seller-file','resource-file','environment-file'].some(key => result[key])))
    throw fail('Offline workspace receiving uses its archive, SHA256 and separate destination.');
  if (result.command !== 'serve' && ['port','connection-file','startup-format'].some(key => result[key]))
    throw fail('Server launch options belong to the serve command.');
  if (result.command === 'operation' && !DATASETTE_OPERATIONS.includes(result.operation)) throw fail('Choose a declared --operation; use the operations command for its input catalog.');
  if (result.command !== 'operation' && result.operation) throw fail('--operation is used without a separate command.');
  if (['receive','receive-workspace'].includes(result.command) && (!result['archive-file'] || !result.destination ||
      !/^[a-f0-9]{64}$/.test(result.sha256 ?? '') || result.input || result['input-file']))
    throw fail('Receive requires --archive-file, --sha256 (64 lowercase hexadecimal characters) and --destination.');
  if (!['receive','receive-workspace'].includes(result.command) && (result.sha256 || result.destination))
    throw fail('SHA256 and destination options belong to source or workspace receiving.');
  if (!['receive','receive-workspace','export-workspace'].includes(result.command) && result['archive-file'])
    throw fail('An archive file belongs to an export or receiving command.');
  if (['serve','status','operations','health','export-workspace'].includes(result.command) && (result.input || result['input-file']))
    throw fail('This command reads its original state without an operation input.');
  return result;
}
async function privateFile(path, maximum = 1024 * 1024) {
  const handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) throw fail('Use a regular input file within its 1 MiB limit.');
    const raw = await handle.readFile();
    if (raw.length > maximum) throw fail('The input file grew beyond its 1 MiB limit.');
    return new TextDecoder('utf-8', {fatal: true}).decode(raw);
  } finally {await handle.close();}
}
async function jsonFile(path) {
  const result = JSON.parse(await privateFile(path));
  if (!object(result)) throw fail('The selected JSON file must contain an object.');
  return result;
}
async function resultOutput(value, path, stdout) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (path) {
    path = resolve(path);
    const temporary = path + '.pending-' + randomUUID();
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(text); await handle.sync(); await handle.close(); handle = null;
      await link(temporary, path);
      const parent = await open(dirname(path), 'r');
      try {await parent.sync();} finally {await parent.close();}
    } finally {
      await handle?.close();
      await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;});
    }
  }
  stdout.write(text);
}
async function writeConnection(file, announcement) {
  file = resolve(file);
  let previous;
  try {previous = JSON.parse(await privateFile(file, 16384));}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  if (previous && (previous.schema !== announcement.schema || previous.workspaceId !== announcement.workspaceId ||
      previous.directory !== announcement.directory)) throw fail('The connection file belongs to a different original workspace.');
  const temporary = file + '.pending-' + randomUUID();
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(announcement) + '\n'); await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, file);
    const parent = await open(dirname(file), 'r');
    try {await parent.sync();} finally {await parent.close();}
  } finally {await handle?.close(); await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;});}
}

export async function runDatasetteCLI(argv = process.argv.slice(2), {
  stdout = process.stdout, stderr = process.stderr,
} = {}) {
  let workspace, server, failed = false;
  const reportError = (error, phase) => {
    stderr.write(JSON.stringify({error: error?.code ?? 'DATASETTE_CLI_FAILURE',
      message: error?.message ?? String(error), ...(phase ? {phase} : {}),
      ...(error instanceof DatasetteClientError ? {operation: error.operation, operationId: error.operationId,
        status: error.status, uncertain: error.uncertain} : {}),
      ...(typeof error?.uncertain === 'boolean' ? {uncertain: error.uncertain} : {}),
      ...(typeof error?.directory === 'string' ? {directory: error.directory} : {})}) + '\n');
  };
  try {
    const args = parseDatasetteArguments(argv);
    if (args.help) {stdout.write(USAGE); return 0;}
    if (args.command === 'receive-workspace' && !args.directory && !args.url && !args['url-file']) {
      const {receiveDatasetteWorkspace} = await import('./archive.mjs');
      const result = await receiveDatasetteWorkspace({archiveFile: resolve(args['archive-file']),
        sha256: args.sha256, directory: resolve(args.destination)});
      await resultOutput(result, args.out, stdout);
      return 0;
    }
    let remote, connection;
    if (args.url || args['url-file']) {
      connection = args.url;
      let expectedWorkspaceId = args['expected-workspace-id'];
      if (args['url-file']) {
        const raw = (await privateFile(args['url-file'], 16384)).trim();
        if (raw.startsWith('{')) {
          const record = JSON.parse(raw);
          if (!object(record) || record.schema !== 'stellar-forge.datasette-server.v1' ||
              typeof record.url !== 'string' || typeof record.workspaceId !== 'string') throw fail('Use the original server connection file.');
          if (expectedWorkspaceId && expectedWorkspaceId !== record.workspaceId) throw fail('The connection file selects a different workspace.');
          connection = record.url; expectedWorkspaceId ??= record.workspaceId;
        } else connection = raw;
      }
      remote = createDatasetteClient({url: connection, expectedWorkspaceId});
    } else {
      const {openDatasetteWorkspace} = await import('./workspace.mjs');
      const configuration = {};
      for (const field of ['seller', 'resource']) {
        if (args[field]) configuration[field] = args[field];
        else if (args[field + '-file']) {
          configuration[field] = JSON.parse(await privateFile(args[field + '-file'], 16384));
          if (typeof configuration[field] !== 'string') throw fail('The ' + field + ' file must contain its original URL as a JSON string.');
        }
      }
      if (args['environment-file']) configuration.environment = await jsonFile(args['environment-file']);
      workspace = await openDatasetteWorkspace({directory: resolve(args.directory), create: Boolean(args.create), ...configuration});
      if (args['expected-workspace-id'] && workspace.workspaceId !== args['expected-workspace-id'])
        throw fail('The selected directory belongs to a different workspace.');
    }
    if (args.command === 'serve') {
      const {startDatasetteServer} = await import('./server.mjs');
      server = await startDatasetteServer({workspace, port: Number(args.port ?? 0), host: '127.0.0.1'});
      const announcement = {schema: 'stellar-forge.datasette-server.v1', url: server.url,
        workspaceId: server.workspaceId, instanceId: server.instanceId,
        directory: server.directory, pid: process.pid};
      if (args['connection-file']) await writeConnection(args['connection-file'], announcement);
      stdout.write(JSON.stringify(announcement) + '\n');
      await new Promise((done, reject) => {
        let stopping = false;
        const stop = () => {
          if (stopping) return; stopping = true;
          process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
          // The CLI owns both the listener and its borrowed workspace. Close
          // them together so an active capture or idle upload is cancelled and
          // cannot keep the managed application's shutdown waiting forever.
          const closing = [Promise.resolve().then(() => server.close()),
            Promise.resolve().then(() => workspace.close())];
          Promise.allSettled(closing).then(results => {
            const failure = results.find(result => result.status === 'rejected');
            if (failure) reject(failure.reason);
            else done();
          });
        };
        process.once('SIGINT', stop); process.once('SIGTERM', stop);
      });
      server = null; return 0;
    }
    let value;
    if (args.command === 'health') value = remote ? await remote.health()
      : {schema: 'stellar-forge.datasette-workspace-health.v1', workspaceId: workspace.workspaceId, directory: workspace.directory};
    else if (args.command === 'status') value = await (remote ?? workspace).status();
    else if (args.command === 'operations') value = await (remote ?? workspace).operations();
    else {
      const receiving = ['receive','receive-workspace'].includes(args.command);
      const operation = args.command === 'receive' ? 'source.receive'
        : args.command === 'receive-workspace' ? 'workspace.receive'
        : args.command === 'export-workspace' ? 'workspace.export' : args.operation;
      const input = receiving ? {archiveFile: resolve(args['archive-file']), sha256: args.sha256, directory: resolve(args.destination)}
        : args.command === 'export-workspace' ? (args['archive-file'] ? {outputFile: resolve(args['archive-file'])} : {})
        : args['input-file'] ? await jsonFile(args['input-file']) : args.input ? JSON.parse(args.input) : {};
      if (!object(input)) throw fail('Operation input must be a complete JSON object.');
      value = await (remote ?? workspace).dispatch(operation, input);
    }
    await resultOutput(value, args.out, stdout);
    return 0;
  } catch (error) {
    failed = true; reportError(error); return 1;
  } finally {
    let closeError;
    try {await server?.close();} catch (error) {closeError = error;}
    try {await workspace?.close();} catch (error) {closeError ??= error;}
    if (closeError) {
      if (!failed) reportError(closeError, 'close');
      return 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await runDatasetteCLI();
