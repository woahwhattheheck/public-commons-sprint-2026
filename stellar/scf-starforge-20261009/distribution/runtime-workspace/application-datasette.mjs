// MIT. Datasette source editions in the original managed Applications launcher.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, need, plain } from './storage.mjs';
import {inspectDatasetteBinding, readDatasetteAnnouncement} from '../../sf30-seller-sdk/datasette/managed-binding.mjs';
const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/';
const BINDING = 'stellar-forge.datasette-workspace-binding.v1';
const STARTUP = 'stellar-forge.datasette-server.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function datasetteApplication(common) {
  return {id: 'datasette', command: 'datasette-application', title: 'Datasette source and dataset publisher',
    terminal: false, requiredSource: ROOT + 'managed-launch.mjs',
    description: 'Capture complete source pages, review exact values and keys, publish datasets and receive complete source editions.',
    fields: [
      {name: 'workspaceDirectory', label: 'Original Datasette workspace', type: 'path', required: true,
        description: 'Choose the workspace created with datasette serve --directory PATH --create.'},
      {name: 'connectionFile', label: 'Private connection file', type: 'path', required: false,
        description: 'Defaults to connection.json inside this workspace. Clients use this file to reconnect after restart.'},
      ...common]};
}

export async function prepareDatasetteApplication(settings, inputPath, runtimeDirectory) {
  const directory = absolute(settings.workspaceDirectory);
  const {inspectMerchantRuntime} = await import('../../sf46-release/runtime-package.mjs');
  const runtime = await inspectMerchantRuntime(runtimeDirectory, {load: false});
  const helper = await inputPath(join(runtime.sourceRoot, ROOT + 'managed-binding.mjs'), 'file');
  const cli = await inputPath(join(runtime.sourceRoot, ROOT + 'cli.mjs'), 'file');
  const launcher = await inputPath(join(runtime.sourceRoot, ROOT + 'managed-launch.mjs'), 'file');
  const {inspectDatasetteBinding} = await import(pathToFileURL(helper.path).href);
  need(typeof inspectDatasetteBinding === 'function', 'APPLICATION_DATASETTE_BINDING_UNAVAILABLE',
    'Choose the complete installed Datasette runtime.');
  const binding = await inspectDatasetteBinding({directory});
  need(plain(binding) && binding.schema === BINDING && binding.directory === directory &&
    UUID.test(binding.workspaceId ?? '') && HASH.test(binding.bindingSha256 ?? '') &&
    plain(binding.workspaceFile) && binding.workspaceFile.path === join(directory, 'workspace.json') &&
    HASH.test(binding.workspaceFile.sha256 ?? '') && Number.isSafeInteger(binding.workspaceFile.bytes) &&
    binding.workspaceFile.bytes > 0 && binding.publisherDirectory === join(directory, 'publisher') &&
    binding.targetDirectory === join(directory, 'dataset'), 'APPLICATION_DATASETTE_BINDING_CHANGED');
  const declaration = await inputPath(binding.workspaceFile.path, 'file', false, true);
  need(declaration.sha256 === binding.workspaceFile.sha256 && declaration.bytes === binding.workspaceFile.bytes,
    'APPLICATION_DATASETTE_BINDING_CHANGED', 'The original workspace declaration changed during review.');
  const port = settings.port ?? 0;
  need(Number.isSafeInteger(port) && port >= 0 && port <= 65535, 'APPLICATION_DATASETTE_PORT_INVALID');
  const connectionFile = settings.connectionFile ? absolute(settings.connectionFile) : join(directory, 'connection.json');
  return {
    args: ['serve', '--directory', directory, '--expected-workspace-id', binding.workspaceId,
      '--connection-file', connectionFile, '--startup-format', 'managed', '--port', String(port),
      '--expected-binding-sha256', binding.bindingSha256],
    // Only immutable source and declaration files belong to the launch review.
    // Captures, editions, publisher history and the connection file remain operational.
    inputs: [helper, cli, launcher, declaration], createDirectories: [], binding,
  };
}
function selected(request, flag) {
  const indices = request.args.flatMap((value, index) => value === flag ? [index] : []);
  need(indices.length === 1 && typeof request.args[indices[0] + 1] === 'string',
    'APPLICATION_DATASETTE_STARTUP_CHANGED');
  return request.args[indices[0] + 1];
}

export async function datasetteStartup(request, text) {
  if (request.command !== 'datasette-application' || !Array.isArray(request.args) || request.args[0] !== 'serve' ||
      typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let value; try {value = JSON.parse(text);} catch {return null;}
  if (!plain(value) || value.schema !== STARTUP) return null;
  const directory = absolute(selected(request, '--directory'));
  const workspaceId = selected(request, '--expected-workspace-id');
  const connectionFile = absolute(selected(request, '--connection-file')), port = selected(request, '--port');
  need(UUID.test(workspaceId) && value.directory === directory && value.workspaceId === workspaceId &&
    UUID.test(value.instanceId ?? '') && Number.isSafeInteger(value.pid) && value.pid > 0,
    'APPLICATION_DATASETTE_STARTUP_CHANGED', 'The startup must identify this reviewed original workspace.');
  let url; try {url = new URL(value.url);} catch {need(false, 'APPLICATION_DATASETTE_STARTUP_CHANGED');}
  const actualPort = Number(url.port || 80);
  need(/^(0|[1-9]\d*)$/.test(port) && Number(port) <= 65535 &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/' &&
    !url.username && !url.password && !url.search && !url.hash &&
    actualPort >= 1 && actualPort <= 65535 && (port === '0' || actualPort === Number(port)),
    'APPLICATION_DATASETTE_STARTUP_CHANGED', 'Use the original loopback browser listener.');
  const expected = selected(request, '--expected-binding-sha256');
  const binding = await inspectDatasetteBinding({directory});
  need(HASH.test(expected) && binding.workspaceId === workspaceId && binding.bindingSha256 === expected,
    'APPLICATION_DATASETTE_BINDING_CHANGED',
    'The workspace declaration changed after application review.');
  await readDatasetteAnnouncement(connectionFile, value);
  return {url: url.href, workspaceId, connectionFile,
    original: {...value, bindingSha256: binding.bindingSha256,
      workspaceFile: binding.workspaceFile, publisherDirectory: binding.publisherDirectory,
      targetDirectory: binding.targetDirectory}};
}
