// MIT. Original source/report workflow in the existing managed Applications lifecycle.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { absolute, canonical, digest, json, need, plain, regular } from './storage.mjs';
import { DATASETTE_ANALYSIS_SOURCE, inspectDatasetteAnalysisInstallation,
  parseDatasetteAnalysisCommand, datasetteAnalysisOption } from '../../sf30-seller-sdk/datasette-analysis/cli.mjs';

const SCHEMA = 'stellar-forge.source-workflow.v1';
const CONFIGURATION = 'stellar-forge.source-workflow-configuration.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function datasetteWorkflowApplication(common = []) {
  return {
    id: 'datasette-workflow', command: 'datasette-analysis', terminal: false,
    title: 'Datasette source workflow',
    description: 'Run original source requests, paired supplier reports and reviewed delivery; reopen complete projects and continue customer work.',
    requiredSource: DATASETTE_ANALYSIS_SOURCE + 'workflow_server.py',
    fields: [
      field('installationId', 'Installed Python environment', 'text', true,
        'Select the original Python installation with its workbooks extra.'),
      field('workflowDirectory', 'Original request workspace', 'path', true,
        'Use the existing workflow or received project directory, or an absent directory inside a private parent.'),
      field('configurationFile', 'Installed source and report configuration', 'path', false,
        'Select the complete configured profile for new requests. Leave empty to inspect and re-export an existing received project.'),
      field('providersFile', 'Installed source-provider connections', 'path', false,
        'Select the private provider configuration with existing host credential references and original acquisition inputs.'),
      ...common,
    ],
  };
}

export function datasetteWorkflowResource(settings) {
  return digest(json(canonical({ family: 'datasette-source-workflow',
    directory: absolute(settings.workflowDirectory) })));
}

async function selectedConfiguration(path) {
  const bytes = await regular(absolute(path), 32 * 1024 * 1024);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  need(plain(value) && value.schema === CONFIGURATION &&
    typeof value.profile === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(value.profile) &&
    plain(value.source) && plain(value.analysis) &&
    /^[a-f0-9]{32}$/.test(value.analysis.operationId ?? ''),
    'DATASETTE_WORKFLOW_CONFIGURATION_REQUIRED',
    'Select the complete profile produced by the installed workflow configure command.');
  absolute(value.analysis.workspace);
  return { value, descriptor: { path: absolute(path), bytes: bytes.length, sha256: digest(bytes) } };
}

async function selectedProviders(path) {
  const bytes = await regular(absolute(path), 32 * 1024 * 1024);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  need(plain(value) && value.schema === 'stellar-forge.provider-workflows.v1' &&
    typeof value.node === 'string',
    'DATASETTE_WORKFLOW_PROVIDERS_REQUIRED',
    'Select the original installed provider configuration and its Node executable.');
  absolute(value.node);
  return { value, descriptor: { path: absolute(path), bytes: bytes.length, sha256: digest(bytes) } };
}

export async function prepareDatasetteWorkflowApplication(settings, {
  root, runtimeId, runtimeDirectory, inputPath, selectedExecutable,
} = {}) {
  const selected = await inspectDatasetteAnalysisInstallation(root, {
    runtimeId, runtimeDirectory, installationId: settings.installationId,
  });
  const directory = await inputPath(settings.workflowDirectory, 'directory', true, true);
  const python = await selectedExecutable(selected.installation.python);
  const inputs = [directory, ...python.inputs];
  const command = ['workflow', 'serve', '--workspace', directory.path];
  if (settings.configurationFile) {
    const input = await inputPath(settings.configurationFile, 'file', false, true);
    const configuration = await selectedConfiguration(input.path);
    need(input.bytes === configuration.descriptor.bytes &&
      (input.sha256 === undefined || input.sha256 === configuration.descriptor.sha256),
      'DATASETTE_WORKFLOW_CONFIGURATION_CHANGED');
    inputs.push(input);
    command.push('--configuration', input.path);
  }
  if (settings.providersFile) {
    const input = await inputPath(settings.providersFile, 'file', false, true);
    const providers = await selectedProviders(input.path);
    need(input.bytes === providers.descriptor.bytes &&
      (input.sha256 === undefined || input.sha256 === providers.descriptor.sha256),
      'DATASETTE_WORKFLOW_PROVIDERS_CHANGED');
    const node = await selectedExecutable(providers.value.node);
    inputs.push(input, ...node.inputs);
    command.push('--providers', input.path);
  }
  for (const member of selected.selection.sourceFiles) {
    const input = await inputPath(join(selected.binding.sourceRoot, member.path), 'file');
    need(input.sha256 === member.sha256 && input.bytes === member.bytes,
      'DATASETTE_ANALYSIS_SOURCE_CHANGED');
    inputs.push(input);
  }
  const port = settings.port ?? 0;
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'DATASETTE_WORKFLOW_PORT_INVALID');
  command.push('--port', String(port));
  return {
    args: ['--runtime-workspace', absolute(root), '--runtime-directory', absolute(runtimeDirectory),
      '--runtime-id', runtimeId, '--installation-id', settings.installationId,
      '--expected-binding-sha256', selected.fingerprint, '--', ...command],
    inputs, createDirectories: [], resourceKey: datasetteWorkflowResource(settings),
  };
}

async function privateControl(path) {
  const handle = await open(absolute(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.nlink === 1 && !(before.mode & 0o077) &&
      before.size > 0 && before.size <= 65536 &&
      (process.getuid === undefined || before.uid === process.getuid()),
      'DATASETTE_WORKFLOW_PRIVATE_LAUNCH_REQUIRED');
    const bytes = await handle.readFile(), after = await handle.stat();
    need(bytes.length === before.size && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      'DATASETTE_WORKFLOW_PRIVATE_LAUNCH_CHANGED');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await handle.close(); }
}

async function liveWorkflow(url) {
  const response = await fetch(new URL('/api/health', url), {
    headers: { 'X-Workflow-Capability': url.hash.slice(1),
      origin: url.origin, accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  need(response.status === 200 && /^application\/json\b/i.test(response.headers.get('content-type') ?? ''),
    'DATASETTE_WORKFLOW_LISTENER_UNAVAILABLE');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    need(bytes <= 262144, 'DATASETTE_WORKFLOW_STARTUP_RESPONSE_LIMIT');
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function datasetteWorkflowStartup(request, text, { pid } = {}) {
  if (request.command !== 'datasette-analysis' || typeof text !== 'string' ||
    text.length > 16384 || !text.startsWith('{')) return null;
  let ready;
  try { ready = JSON.parse(text); } catch { return null; }
  if (!plain(ready) || ready.schema !== SCHEMA || ready.status !== 'LISTENING') return null;
  const { selection, originalArgs } = parseDatasetteAnalysisCommand(request.args);
  need(originalArgs[0] === 'workflow' && originalArgs[1] === 'serve',
    'DATASETTE_WORKFLOW_STARTUP_CHANGED');
  const directory = absolute(datasetteAnalysisOption(originalArgs, '--workspace'));
  const configurationPath = datasetteAnalysisOption(originalArgs, '--configuration');
  const providersPath = datasetteAnalysisOption(originalArgs, '--providers');
  const selectedPort = datasetteAnalysisOption(originalArgs, '--port') ?? '0';
  const controlFile = join(directory, 'source-workflow-launch.json');
  need(ready.privateLaunch === controlFile && ready.workspace === directory &&
    Number.isInteger(pid) && pid > 0 && ready.pid === pid &&
    /^[a-f0-9]{32}$/.test(ready.workspaceId ?? ''),
    'DATASETTE_WORKFLOW_STARTUP_CHANGED');
  const control = await privateControl(controlFile);
  let url;
  try { url = new URL(control.url); } catch { need(false, 'DATASETTE_WORKFLOW_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(/^(0|[1-9]\d*)$/.test(selectedPort) && Number(selectedPort) <= 65535 &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/' &&
    !url.username && !url.password && !url.search && /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)) &&
    port >= 1 && port <= 65535 && (selectedPort === '0' || port === Number(selectedPort)) &&
    control.schema === SCHEMA && control.status === 'LISTENING' && control.pid === pid &&
    control.workspace === directory && control.workspaceId === ready.workspaceId &&
    control.privateLaunch === controlFile && control.url === ready.url &&
    control.profile === ready.profile,
    'DATASETTE_WORKFLOW_STARTUP_CHANGED', 'Open this original request workspace and listener.');
  let configured = null;
  if (configurationPath) configured = await selectedConfiguration(configurationPath);
  const expected = configured?.descriptor ?? null;
  const matchesConfiguration = value => expected === null ? value === null :
    plain(value) && ['path', 'bytes', 'sha256'].every(key => value[key] === expected[key]);
  need(matchesConfiguration(control.configuration) && matchesConfiguration(ready.configuration) &&
    control.profile === (configured?.value.profile ?? null),
    'DATASETTE_WORKFLOW_CONFIGURATION_CHANGED');
  const providerSelection = providersPath ? await selectedProviders(providersPath) : null;
  const expectedProviders = providerSelection?.descriptor ?? null;
  const matchesProviders = value => expectedProviders === null ? value == null :
    plain(value) && ['path', 'bytes', 'sha256'].every(key => value[key] === expectedProviders[key]);
  need(matchesProviders(control.providerConfiguration) && matchesProviders(ready.providerConfiguration),
    'DATASETTE_WORKFLOW_PROVIDERS_CHANGED');
  const live = await liveWorkflow(url);
  need(live?.schema === SCHEMA && live.ready === true && live.status === 'READY' &&
    live.pid === pid && live.workspace === directory && live.workspaceId === control.workspaceId &&
    live.profile === control.profile && matchesConfiguration(live.configuration) &&
    matchesProviders(live.providerConfiguration),
    'DATASETTE_WORKFLOW_WORKSPACE_CHANGED', 'Reopen the selected original workflow project.');
  return { url: url.href, workspaceId: control.workspaceId, connectionFile: controlFile,
    original: { schema: SCHEMA, directory, workspaceId: control.workspaceId,
      privateLaunch: controlFile, originalPid: pid, profile: control.profile,
      configuration: expected, providerConfiguration: expectedProviders, analysis: live.analysis,
      pythonInstallation: selection.installationId, bindingSha256: selection.expectedBindingSha256 } };
}
