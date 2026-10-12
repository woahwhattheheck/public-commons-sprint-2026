// MIT. Datasette customer Analysis in the original installed Applications lifecycle.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { absolute, need, plain } from './storage.mjs';
import { pythonApplicationResource } from '../python-runtime/application-lifecycle.mjs';
import { DATASETTE_ANALYSIS_SOURCE, inspectDatasetteAnalysisInstallation,
  parseDatasetteAnalysisCommand, datasetteAnalysisOption } from '../../sf30-seller-sdk/datasette-analysis/cli.mjs';

const SCHEMA = 'stellar-forge.datasette-operator.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function datasetteAnalysisApplication(common = []) {
  return {
    id: 'datasette-analysis', command: 'datasette-analysis', terminal: false,
    title: 'Datasette customer Analysis',
    description: 'Receive reviewed source editions, explore complete data, compare changes, edit queries and workbooks, and deliver the original editable workspace.',
    requiredSource: DATASETTE_ANALYSIS_SOURCE + 'cli.py',
    fields: [
      field('installationId', 'Installed Python environment', 'text', true,
        'Select the original Python installation with its workbooks extra from the Python workspace.'),
      field('databaseDirectory', 'Analysis database directory', 'path', true,
        'Select the existing customer Analysis directory, or an absent directory inside a private parent.'),
      field('operationId', 'Analysis operation ID', 'text', true,
        'Keep the same 32-character lowercase hexadecimal ID when reopening these editions and deliveries.'),
      field('nodeExecutable', 'Original Node executable', 'path', false,
        'Defaults to this installed merchant runtime’s Node executable.'),
      ...common,
    ],
  };
}

export function datasetteAnalysisResource(settings) {
  return pythonApplicationResource({ command: 'analysis' }, { databaseDirectory: settings.databaseDirectory });
}

export async function prepareDatasetteAnalysisApplication(settings, {
  root, runtimeId, runtimeDirectory, inputPath, selectedExecutable,
} = {}) {
  need(/^[a-f0-9]{32}$/.test(settings.operationId ?? ''), 'DATASETTE_ANALYSIS_OPERATION_REQUIRED',
    'Use the original 32-character lowercase hexadecimal Analysis operation ID.');
  const selected = await inspectDatasetteAnalysisInstallation(root, {
    runtimeId, runtimeDirectory, installationId: settings.installationId,
  });
  const database = await inputPath(settings.databaseDirectory, 'directory', true, true);
  const node = await selectedExecutable(settings.nodeExecutable ?? process.execPath);
  const python = await selectedExecutable(selected.installation.python);
  const inputs = [database, ...node.inputs, ...python.inputs];
  for (const member of selected.selection.sourceFiles) {
    const input = await inputPath(join(selected.binding.sourceRoot, member.path), 'file');
    need(input.sha256 === member.sha256 && input.bytes === member.bytes,
      'DATASETTE_ANALYSIS_SOURCE_CHANGED');
    inputs.push(input);
  }
  const port = settings.port ?? 0;
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'DATASETTE_ANALYSIS_PORT_INVALID');
  return {
    args: ['--runtime-workspace', absolute(root), '--runtime-directory', absolute(runtimeDirectory),
      '--runtime-id', runtimeId, '--installation-id', settings.installationId,
      '--expected-binding-sha256', selected.fingerprint, '--',
      'serve', '--workspace', database.path, '--operation-id', settings.operationId,
      '--checkout', selected.binding.sourceRoot, '--node', node.executable, '--port', String(port)],
    inputs, createDirectories: [], resourceKey: datasetteAnalysisResource(settings),
  };
}

async function privateControl(path) {
  const handle = await open(absolute(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.nlink === 1 && !(before.mode & 0o077) &&
      before.size > 0 && before.size <= 65536 &&
      (process.getuid === undefined || before.uid === process.getuid()),
      'DATASETTE_ANALYSIS_PRIVATE_LAUNCH_REQUIRED');
    const bytes = await handle.readFile(), after = await handle.stat();
    need(bytes.length === before.size && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      'DATASETTE_ANALYSIS_PRIVATE_LAUNCH_CHANGED');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await handle.close(); }
}

async function liveOperator(url) {
  const response = await fetch(new URL('/api/datasette/status', url), {
    headers: { 'X-Analysis-Capability': url.hash.slice(1), accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  need(response.status === 200 && /^application\/json\b/i.test(response.headers.get('content-type') ?? ''),
    'DATASETTE_ANALYSIS_LISTENER_UNAVAILABLE', 'Open the original authenticated Analysis listener.');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    need(bytes <= 32 * 1024 * 1024, 'DATASETTE_ANALYSIS_STARTUP_RESPONSE_LIMIT');
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function datasetteAnalysisStartup(request, text, { pid } = {}) {
  if (request.command !== 'datasette-analysis' || typeof text !== 'string' ||
    text.length > 16384 || !text.startsWith('{')) return null;
  let ready;
  try { ready = JSON.parse(text); } catch { return null; }
  if (!plain(ready) || ready.schema !== SCHEMA || ready.status !== 'LISTENING') return null;
  const { selection, originalArgs } = parseDatasetteAnalysisCommand(request.args);
  need(originalArgs[0] === 'serve', 'DATASETTE_ANALYSIS_STARTUP_CHANGED');
  const directory = absolute(datasetteAnalysisOption(originalArgs, '--workspace'));
  const operationId = datasetteAnalysisOption(originalArgs, '--operation-id');
  const selectedPort = datasetteAnalysisOption(originalArgs, '--port') ?? '0';
  const controlFile = join(directory, 'datasette-operator-launch.json');
  need(ready.private_launch === controlFile && ready.operation_id === operationId &&
    Number.isInteger(pid) && pid > 0, 'DATASETTE_ANALYSIS_STARTUP_CHANGED');
  const control = await privateControl(controlFile);
  const analysis = await privateControl(join(directory, 'analysis-launch.json'));
  let url;
  try { url = new URL(control.url); } catch { need(false, 'DATASETTE_ANALYSIS_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(/^(0|[1-9]\d*)$/.test(selectedPort) && Number(selectedPort) <= 65535 &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/datasette' &&
    !url.username && !url.password && !url.search && /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)) &&
    port >= 1 && port <= 65535 && (selectedPort === '0' || port === Number(selectedPort)) &&
    control.schema === SCHEMA && control.pid === pid && control.operation_id === operationId &&
    control.workspace_id === ready.workspace_id && control.url === ready.url &&
    analysis.schema === 'stellar-forge.customer-analysis.v1' && analysis.pid === pid &&
    analysis.workspace_id === control.workspace_id && analysis.url === control.analysis_url,
    'DATASETTE_ANALYSIS_STARTUP_CHANGED', 'The opened application must be this original Analysis process.');
  const analysisUrl = new URL(control.analysis_url);
  need(analysisUrl.origin === url.origin && analysisUrl.pathname === '/' &&
    analysisUrl.hash === url.hash && !analysisUrl.search && !analysisUrl.username && !analysisUrl.password,
    'DATASETTE_ANALYSIS_STARTUP_CHANGED');
  const live = await liveOperator(url);
  need(live?.schema === SCHEMA && live.workspace_id === control.workspace_id &&
    live.operation_id === operationId && live.workspace === directory &&
    live.operator_path === '/datasette' && live.analysis_path === '/',
    'DATASETTE_ANALYSIS_WORKSPACE_CHANGED', 'Reopen the selected original customer workspace.');
  return { url: url.href, workspaceId: control.workspace_id, connectionFile: controlFile,
    original: { schema: SCHEMA, directory, operationId, workspaceId: control.workspace_id,
      privateLaunch: controlFile, originalPid: pid, analysisUrl: analysisUrl.href,
      pythonInstallation: selection.installationId, bindingSha256: selection.expectedBindingSha256 } };
}
