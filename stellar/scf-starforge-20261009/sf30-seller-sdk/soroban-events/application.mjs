// MIT. Soroban contract-event operations through the original Applications lifecycle.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need, regular } from '../../distribution/runtime-workspace/storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/soroban-events';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const SOROBAN_EVENTS_READY_SCHEMA = 'stellar-forge.soroban-events-workspace-startup.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function sorobanEventsApplication(common) {
  return {
    id: 'soroban-contract-events',
    command: 'soroban-events-workspace',
    title: 'Soroban contract events',
    terminal: false,
    requiredSource: SOURCE + '/server.mjs',
    description: 'Save native contract and topic filters, capture a fixed ledger range, resume original RPC cursors, review complete event sources, and prepare editions for paid delivery or full customer receiving.',
    fields: [
      field('workspaceDirectory', 'Private event workspace', 'path', true,
        'Reopen the original event workspace, or create a directory in an existing private parent. Saved filters, captures and editions remain selected.'),
      field('connectionFile', 'Private Stellar RPC connection', 'path', false,
        'JSON containing rpcUrl, network and optional headers. Leave empty to review a received workspace without a network connection.'),
      ...common,
    ],
  };
}

export async function prepareSorobanEventsApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(plain(settings) && typeof inputPath === 'function', 'APPLICATION_SOROBAN_INPUT_READER_REQUIRED');
  const directory = absolute(settings.workspaceDirectory);
  const selected = await inputPath(directory, 'directory', true, true);
  const inputs = [selected], createDirectories = selected.exists ? [] : [directory];
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const sourceDirectory = join(runtime.sourceRoot, SOURCE);
  for (const name of ['server.mjs', 'cli.mjs', 'engine.mjs', 'rpc.mjs', 'browser-assets.json'])
    inputs.push(await inputPath(join(sourceDirectory, name), 'file'));
  const native = await import(pathToFileURL(join(sourceDirectory, 'engine.mjs')).href);
  need(typeof native.inspectSorobanEventsWorkspace === 'function', 'APPLICATION_SOROBAN_SOURCE_REQUIRED',
    'Choose a runtime containing the complete Soroban event application.');
  const identity = selected.exists
    ? await native.inspectSorobanEventsWorkspace(directory, { allowMissing: true }) : null;
  const args = ['--workspace', directory, '--startup-format', 'json'];
  if (identity?.exists) {
    need(UUID.test(identity.workspaceId ?? ''), 'APPLICATION_SOROBAN_WORKSPACE_ID_REQUIRED');
    args.push('--expected-workspace-id', identity.workspaceId);
  }
  if (settings.connectionFile) {
    const file = await inputPath(absolute(settings.connectionFile), 'file', false, true);
    const bytes = await regular(file.path, 65536);
    let connection;
    try { connection = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { need(false, 'APPLICATION_SOROBAN_CONNECTION_JSON_REQUIRED'); }
    need(plain(connection), 'APPLICATION_SOROBAN_CONNECTION_JSON_REQUIRED');
    // The selected native RPC adapter remains authoritative for network, URL,
    // provider headers and local development settings. Keep these private bytes
    // in the existing reviewed input set rather than duplicating credentials.
    inputs.push(file);
    args.push('--connection-file', file.path);
  }
  // Workspace metadata changes during normal capture and review. Preserve its
  // stable identity in the saved command instead of pinning mutable bytes.
  return { args, inputs, createDirectories };
}

function option(request, name, optional = false) {
  need(Array.isArray(request.args), 'APPLICATION_SOROBAN_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_SOROBAN_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

export async function sorobanEventsStartup(request, text) {
  if (request.command !== 'soroban-events-workspace' || !request.args?.includes('--workspace') ||
    typeof text !== 'string' || text.length > 16384 ||
    !text.startsWith('{"schema":"' + SOROBAN_EVENTS_READY_SCHEMA + '",')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== SOROBAN_EVENTS_READY_SCHEMA || value.status !== 'SOROBAN_EVENTS_READY')
    return null;
  need(option(request, '--startup-format') === 'json', 'APPLICATION_SOROBAN_STARTUP_CHANGED');
  const directory = absolute(option(request, '--workspace'));
  const connectionOption = option(request, '--connection-file', true);
  const connectionFile = connectionOption ? absolute(connectionOption) : null;
  const sourceDirectory = join(absolute(request.releaseDirectory), 'source', SOURCE);
  const expectedWorkspaceId = option(request, '--expected-workspace-id', true);
  need(value.directory === directory && value.connectionFile === connectionFile &&
    value.sourceDirectory === sourceDirectory && UUID.test(value.workspaceId ?? '') &&
    (expectedWorkspaceId === undefined || value.workspaceId === expectedWorkspaceId) &&
    Number.isSafeInteger(value.pid) && value.pid > 0, 'APPLICATION_SOROBAN_STARTUP_CHANGED');
  const native = await import(pathToFileURL(join(sourceDirectory, 'engine.mjs')).href);
  const identity = await native.inspectSorobanEventsWorkspace(directory);
  need(identity.workspaceId === value.workspaceId, 'APPLICATION_SOROBAN_STARTUP_CHANGED');
  const port = Number(option(request, '--port', true) ?? 0);
  let url;
  try { url = new URL(value.url); }
  catch { need(false, 'APPLICATION_SOROBAN_STARTUP_CHANGED'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^#token=[A-Za-z0-9_-]{43}$/.test(url.hash) &&
    Number.isInteger(port) && port >= 0 && port <= 65535 &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
    (port === 0 || Number(url.port || 80) === port), 'APPLICATION_SOROBAN_STARTUP_CHANGED');
  return {
    url: url.href,
    original: {
      schema: SOROBAN_EVENTS_READY_SCHEMA,
      directory,
      workspaceId: identity.workspaceId,
      connectionFile,
      sourceDirectory,
      pid: value.pid,
    },
  };
}
