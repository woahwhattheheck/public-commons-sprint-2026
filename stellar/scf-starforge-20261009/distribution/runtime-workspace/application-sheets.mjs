// MIT. Complete original Sheets authoring through the maintained Applications lifecycle.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need } from './storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/workspace';
const STARTUP = 'stellar-forge.sheets-authoring-startup.v1';
const SOURCE_FILES = ['launch.mjs', 'model.mjs', 'cli.mjs', 'server.mjs'];
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function sheetsApplication(common) {
  return {
    id: 'sheets-authoring', command: 'sheets-source', title: 'Google Sheets source authoring', terminal: false,
    requiredSource: SOURCE + '/launch.mjs',
    description: 'Review original workbook observations and typed projections, publish through the saved dataset publisher, operate the original merchant release and reopen the same private workspace.',
    fields: [
      field('workspaceDirectory', 'Initialized private Sheets workspace', 'path', true,
        'Use the existing original workspace. Initialize a new one with sheets-source workspace init before reviewing this application.'),
      field('connectionsFile', 'Private Google connections file', 'path', false,
        'Optional original alias-to-grant references. Leave empty for retained observations; reopening makes no Google request.'),
      field('seller', 'Original seller origin', 'text', false,
        'Optional original buyer handoff origin; supply its resource URL as well.'),
      field('resource', 'Original paid resource URL', 'text', false,
        'The matching resource for the original publisher buyer handoff.'),
      ...common,
    ],
  };
}

function buyerSelection(settings) {
  need(Boolean(settings.seller) === Boolean(settings.resource), 'APPLICATION_SHEETS_BUYER_PAIR_REQUIRED',
    'Choose both the original seller origin and its resource, or leave both empty.');
  if (!settings.seller) return [];
  let seller, resource;
  try { seller = new URL(settings.seller); resource = new URL(settings.resource); }
  catch { need(false, 'APPLICATION_SHEETS_BUYER_URL_REQUIRED'); }
  need([seller, resource].every(url => ['http:', 'https:'].includes(url.protocol) && !url.username &&
    !url.password && !url.hash) && seller.pathname === '/' && !seller.search,
  'APPLICATION_SHEETS_BUYER_URL_REQUIRED', 'Use a credential-free seller origin and its original paid resource URL.');
  return ['--seller', seller.origin, '--resource', resource.href];
}

export async function prepareSheetsApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_SHEETS_INPUT_READER_REQUIRED');
  const directory = absolute(settings.workspaceDirectory);
  const inputs = [await inputPath(directory, 'directory', false, true)];
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const sourceDirectory = join(runtime.sourceRoot, SOURCE);
  const pinned = [];
  for (const name of SOURCE_FILES) pinned.push(await inputPath(join(sourceDirectory, name), 'file'));
  const native = await import(pathToFileURL(join(sourceDirectory, 'launch.mjs')).href);
  need(typeof native.inspectSheetsAuthoring === 'function' && typeof native.inspectSheetsLaunchSource === 'function' &&
    typeof native.readSheetsLaunchConnections === 'function', 'APPLICATION_SHEETS_NATIVE_READER_REQUIRED');
  const workspace = await native.inspectSheetsAuthoring(directory);
  const source = await native.inspectSheetsLaunchSource(sourceDirectory);
  for (const [index, file] of source.files.entries())
    need(file.name === SOURCE_FILES[index] && file.sha256 === pinned[index]?.sha256,
      'APPLICATION_SHEETS_SOURCE_CHANGED');
  need(source.files.length === SOURCE_FILES.length, 'APPLICATION_SHEETS_SOURCE_CHANGED');
  inputs.push(...pinned);
  const args = ['workspace', 'serve', '--directory', directory,
    '--expected-workspace-identity', workspace.sha256, '--managed-source', sourceDirectory,
    '--expected-source-sha256', source.sha256, '--startup-format', 'json'];
  if (settings.connectionsFile) {
    const connection = await inputPath(settings.connectionsFile, 'file');
    await native.readSheetsLaunchConnections(settings.connectionsFile, { expectedSha256: connection.sha256 });
    inputs.push(connection);
    args.push('--connections', settings.connectionsFile, '--expected-connections-sha256', connection.sha256);
  }
  args.push(...buyerSelection(settings));
  // The original workspace and native source are pinned. sources.sqlite changes
  // during normal edits; its byte hash/mtime must not become a saved launch input.
  return { args, inputs, createDirectories: [] };
}

function option(request, name, optional = false) {
  need(Array.isArray(request.args), 'APPLICATION_SHEETS_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_SHEETS_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

export async function sheetsStartup(request, text) {
  if (request.command !== 'sheets-source' || typeof text !== 'string' || text.length > 32768 ||
      !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'SHEETS_AUTHORING_READY') return null;
  need(request.args?.[0] === 'workspace' && request.args?.[1] === 'serve' &&
    !request.args.includes('--create') && option(request, '--startup-format') === 'json',
  'APPLICATION_SHEETS_STARTUP_CHANGED');
  const directory = absolute(option(request, '--directory'));
  const sourceDirectory = absolute(option(request, '--managed-source'));
  const launchSourceDirectory = join(absolute(request.releaseDirectory), 'source', SOURCE);
  const workspaceIdentity = option(request, '--expected-workspace-identity');
  const sourceSha256 = option(request, '--expected-source-sha256');
  need(HASH.test(workspaceIdentity) && HASH.test(sourceSha256) &&
    value.directory === directory && value.workspaceIdentity === workspaceIdentity &&
    value.sourceDirectory === sourceDirectory && value.launchSourceDirectory === launchSourceDirectory &&
    value.sourceSha256 === sourceSha256 && UUID.test(value.instanceId ?? '') &&
    Number.isSafeInteger(value.pid) && value.pid > 0, 'APPLICATION_SHEETS_STARTUP_CHANGED');
  const native = await import(pathToFileURL(join(sourceDirectory, 'launch.mjs')).href);
  const source = await native.inspectSheetsLaunchSource(sourceDirectory, { expectedSha256: sourceSha256 });
  await native.inspectSheetsLaunchSource(launchSourceDirectory, { expectedSha256: sourceSha256 });
  const workspace = await native.inspectSheetsAuthoring(directory, { expectedIdentity: workspaceIdentity });
  need(value.settingsSha256 === workspace.settingsSha256 &&
    value.sourceFile === workspace.settings.sourceFile &&
    value.publisherDirectory === workspace.settings.publisherDirectory &&
    value.targetDirectory === workspace.settings.targetDirectory &&
    JSON.stringify(value.sourceFiles) === JSON.stringify(source.files), 'APPLICATION_SHEETS_STARTUP_CHANGED');
  const connectionsFile = option(request, '--connections', true);
  const connectionsSha256 = option(request, '--expected-connections-sha256', true);
  need(Boolean(connectionsFile) === Boolean(connectionsSha256), 'APPLICATION_SHEETS_STARTUP_CHANGED');
  const connection = await native.readSheetsLaunchConnections(connectionsFile, { expectedSha256: connectionsSha256 });
  need(value.connectionsFile === connection.file && value.connectionsSha256 === connection.sha256,
    'APPLICATION_SHEETS_STARTUP_CHANGED');
  const port = Number(option(request, '--port', true) ?? 8453);
  let url;
  try { url = new URL(value.sheetsWorkspace); }
  catch { need(false, 'APPLICATION_SHEETS_STARTUP_CHANGED'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^#token=[a-f0-9]{64}$/.test(url.hash) && Number.isInteger(port) && port >= 0 && port <= 65535 &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
    (port === 0 || Number(url.port || 80) === port), 'APPLICATION_SHEETS_STARTUP_CHANGED');
  return { url: url.href, original: {
    schema: STARTUP, directory, workspaceIdentity, settingsSha256: workspace.settingsSha256,
    sourceDirectory, launchSourceDirectory, sourceSha256, sourceFiles: source.files,
    sourceFile: workspace.settings.sourceFile, publisherDirectory: workspace.settings.publisherDirectory,
    targetDirectory: workspace.settings.targetDirectory, connectionsFile: connection.file,
    connectionsSha256: connection.sha256, instanceId: value.instanceId, pid: value.pid,
  } };
}

