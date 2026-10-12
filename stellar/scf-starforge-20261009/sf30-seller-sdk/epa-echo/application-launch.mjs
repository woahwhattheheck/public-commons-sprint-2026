// MIT. EPA ECHO investigation through the original Applications lifecycle.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need, regular } from '../../distribution/runtime-workspace/storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo';
const STORE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-expert/store.mjs';
const WORKSPACE_SCHEMA = 'stellar-forge.epa-echo-workspace.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const ECHO_READY_SCHEMA = 'stellar-forge.epa-echo-workspace-startup.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function echoApplication(common) {
  return {
    id: 'epa-echo-portfolios', command: 'epa-echo-workspace', title: 'EPA ECHO facility portfolios', terminal: false,
    requiredSource: SOURCE + '/workspace.mjs',
    description: 'Operate multi-facility portfolios with original EPA ECHO reports, dated comparisons, staff reviews, native datasets and customer files; receive complete portable workspaces.',
    fields: [
      field('workspaceDirectory', 'Private EPA ECHO workspace', 'path', true,
        'Reopen the original workspace, or create one directory in an existing private parent. Saved captures and pending operation identities remain selected.'),
      field('inboxDirectory', 'Original buyer inbox', 'path', false,
        'Optional existing SF88 inbox containing the purchased page intents to inspect and receive.'),
      field('releaseRuntimeFile', 'Private merchant runtime JSON', 'path', false,
        'Optional original port/facilitator/allowLocalFacilitator settings. Leave empty for the original challenge-only runtime.'),
      field('userAgent', 'Identifying User-Agent', 'text', false,
        'Optional provider identification for this operator; the original application supplies its maintained default when omitted.'),
      ...common,
    ],
  };
}

export async function prepareEchoApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_ECHO_INPUT_READER_REQUIRED');
  const directory = absolute(settings.workspaceDirectory);
  const selected = await inputPath(directory, 'directory', true, true);
  const inputs = [selected], createDirectories = selected.exists ? [] : [directory];
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const sourceDirectory = join(runtime.sourceRoot, SOURCE);
  for (const name of ['workspace.mjs', 'schema.mjs', 'core.mjs'])
    inputs.push(await inputPath(join(sourceDirectory, name), 'file'));
  inputs.push(await inputPath(join(runtime.sourceRoot, STORE), 'file'));
  const native = await import(pathToFileURL(join(runtime.sourceRoot, STORE)).href);
  need(typeof native.inspectWorkspaceIdentity === 'function', 'APPLICATION_ECHO_SOURCE_REQUIRED',
    'Choose the original runtime containing the complete EPA ECHO application launcher.');
  const identity = selected.exists
    ? await native.inspectWorkspaceIdentity(directory, { allowMissing: true, schema: WORKSPACE_SCHEMA }) : null;
  const args = ['--workspace', directory, '--startup-format', 'json'];
  if (identity) args.push('--expected-workspace-id', identity.workspaceId);
  if (settings.inboxDirectory) {
    const inbox = await inputPath(absolute(settings.inboxDirectory), 'directory', false, true);
    inputs.push(inbox); args.push('--inbox', inbox.path);
  }
  if (settings.releaseRuntimeFile) {
    const file = await inputPath(absolute(settings.releaseRuntimeFile), 'file');
    // Keep the exact private settings file in the original reviewed input set.
    // The selected native SF82 normalizer remains authoritative at startup.
    const bytes = await regular(file.path, 65536);
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { need(false, 'APPLICATION_ECHO_RUNTIME_JSON_REQUIRED'); }
    need(plain(value), 'APPLICATION_ECHO_RUNTIME_JSON_REQUIRED');
    inputs.push(file); args.push('--release-runtime', file.path);
  }
  if (settings.userAgent !== undefined) {
    need(typeof settings.userAgent === 'string' && settings.userAgent.trim() && settings.userAgent.length <= 512 &&
      !/[\x00-\x1f\x7f]/.test(settings.userAgent), 'APPLICATION_ECHO_USER_AGENT',
      'Use a printable identifying User-Agent of at most512 characters.');
    args.push('--user-agent', settings.userAgent);
  }
  // workspace.json is mutable operator state. Pin its stable identity in argv,
  // while normal captures, notes and receipts remain valid across restart.
  return { args, inputs, createDirectories };
}

function option(request, name, optional = false) {
  need(Array.isArray(request.args), 'APPLICATION_ECHO_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_ECHO_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

export async function echoStartup(request, text) {
  if (request.command !== 'epa-echo-workspace' || !request.args?.includes('--workspace') ||
    typeof text !== 'string' || text.length > 16384 ||
    !text.startsWith('{"schema":"' + ECHO_READY_SCHEMA + '",')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== ECHO_READY_SCHEMA || value.status !== 'EPA_ECHO_READY')
    return null;
  need(option(request, '--startup-format') === 'json', 'APPLICATION_ECHO_STARTUP_CHANGED');
  const directory = absolute(option(request, '--workspace'));
  const inboxOption = option(request, '--inbox', true);
  const runtimeOption = option(request, '--release-runtime', true);
  const inboxDirectory = inboxOption ? absolute(inboxOption) : null;
  const releaseRuntimeFile = runtimeOption ? absolute(runtimeOption) : null;
  const sourceDirectory = join(absolute(request.releaseDirectory), 'source', SOURCE);
  const expectedWorkspaceId = option(request, '--expected-workspace-id', true);
  const userAgent = option(request, '--user-agent', true);
  need(value.directory === directory && value.inboxDirectory === inboxDirectory &&
    value.releaseRuntimeFile === releaseRuntimeFile && value.sourceDirectory === sourceDirectory &&
    UUID.test(value.workspaceId ?? '') &&
    (expectedWorkspaceId === undefined || value.workspaceId === expectedWorkspaceId) &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.userAgent === 'string' &&
    (userAgent === undefined || value.userAgent === userAgent), 'APPLICATION_ECHO_STARTUP_CHANGED');
  const native = await import(pathToFileURL(join(absolute(request.releaseDirectory), 'source', STORE)).href);
  const identity = await native.inspectWorkspaceIdentity(directory, { schema: WORKSPACE_SCHEMA });
  need(identity.workspaceId === value.workspaceId, 'APPLICATION_ECHO_STARTUP_CHANGED');
  const port = Number(option(request, '--port', true) ?? 0);
  let url;
  try { url = new URL(value.url); }
  catch { need(false, 'APPLICATION_ECHO_STARTUP_CHANGED'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
    !url.search && url.pathname === '/' && /^#[A-Za-z0-9_-]{43}$/.test(url.hash) &&
    Number.isInteger(port) && port >= 0 && port <= 65535 &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
    (port === 0 || Number(url.port || 80) === port), 'APPLICATION_ECHO_STARTUP_CHANGED');
  return { url: url.href, original: {
    schema: ECHO_READY_SCHEMA, directory, workspaceId: identity.workspaceId,
    inboxDirectory, releaseRuntimeFile, sourceDirectory, userAgent: value.userAgent, pid: value.pid,
  } };
}
