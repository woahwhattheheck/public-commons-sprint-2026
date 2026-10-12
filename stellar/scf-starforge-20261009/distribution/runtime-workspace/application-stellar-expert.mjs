// MIT. StellarExpert investigation through the original Applications lifecycle.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need, regular } from './storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-expert';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const STELLAR_EXPERT_READY_SCHEMA = 'stellar-forge.stellar-expert-workspace-startup.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function stellarExpertApplication(common) {
  return {
    id: 'stellar-expert', command: 'dataset-workspace', title: 'Stellar asset investigation', terminal: false,
    requiredSource: SOURCE + '/workspace.mjs',
    description: 'Capture original StellarExpert observations, compare exact editions, review findings, prepare datasets, operate native merchant releases and receive purchased dataset pages.',
    fields: [
      field('workspaceDirectory', 'Private StellarExpert workspace', 'path', true,
        'Reopen the original workspace, or create one directory in an existing private parent. Saved captures and pending operation identities remain selected.'),
      field('inboxDirectory', 'Original buyer inbox', 'path', false,
        'Optional existing SF88 inbox containing the purchased page intents to inspect and receive.'),
      field('releaseRuntimeFile', 'Private merchant runtime JSON', 'path', false,
        'Optional original port/facilitator/allowLocalFacilitator settings. Leave empty for the original challenge-only runtime.'),
      ...common,
    ],
  };
}

export async function prepareStellarExpertApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_STELLAR_INPUT_READER_REQUIRED');
  const directory = absolute(settings.workspaceDirectory);
  const selected = await inputPath(directory, 'directory', true, true);
  const inputs = [selected], createDirectories = selected.exists ? [] : [directory];
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const sourceDirectory = join(runtime.sourceRoot, SOURCE);
  for (const name of ['workspace.mjs', 'store.mjs', 'core.mjs'])
    inputs.push(await inputPath(join(sourceDirectory, name), 'file'));
  const native = await import(pathToFileURL(join(sourceDirectory, 'store.mjs')).href);
  need(typeof native.inspectStellarExpertIdentity === 'function', 'APPLICATION_STELLAR_SOURCE_REQUIRED',
    'Choose the original runtime containing the complete StellarExpert application launcher.');
  const identity = selected.exists
    ? await native.inspectStellarExpertIdentity(directory, { allowMissing: true }) : null;
  const args = ['--stellar-expert', directory, '--startup-format', 'json'];
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
    catch { need(false, 'APPLICATION_STELLAR_RUNTIME_JSON_REQUIRED'); }
    need(plain(value), 'APPLICATION_STELLAR_RUNTIME_JSON_REQUIRED');
    inputs.push(file); args.push('--release-runtime', file.path);
  }
  // workspace.json is mutable operator state. Pin its stable identity in argv,
  // while normal captures, notes and receipts remain valid across restart.
  return { args, inputs, createDirectories };
}

function option(request, name, optional = false) {
  need(Array.isArray(request.args), 'APPLICATION_STELLAR_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_STELLAR_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

export async function stellarExpertStartup(request, text) {
  if (request.command !== 'dataset-workspace' || !request.args?.includes('--stellar-expert') ||
    typeof text !== 'string' || text.length > 16384 ||
    !text.startsWith('{"schema":"' + STELLAR_EXPERT_READY_SCHEMA + '",')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STELLAR_EXPERT_READY_SCHEMA || value.status !== 'STELLAR_EXPERT_READY')
    return null;
  need(option(request, '--startup-format') === 'json', 'APPLICATION_STELLAR_STARTUP_CHANGED');
  const directory = absolute(option(request, '--stellar-expert'));
  const inboxOption = option(request, '--inbox', true);
  const runtimeOption = option(request, '--release-runtime', true);
  const inboxDirectory = inboxOption ? absolute(inboxOption) : null;
  const releaseRuntimeFile = runtimeOption ? absolute(runtimeOption) : null;
  const sourceDirectory = join(absolute(request.releaseDirectory), 'source', SOURCE);
  const expectedWorkspaceId = option(request, '--expected-workspace-id', true);
  need(value.directory === directory && value.inboxDirectory === inboxDirectory &&
    value.releaseRuntimeFile === releaseRuntimeFile && value.sourceDirectory === sourceDirectory &&
    UUID.test(value.workspaceId ?? '') &&
    (expectedWorkspaceId === undefined || value.workspaceId === expectedWorkspaceId) &&
    Number.isSafeInteger(value.pid) && value.pid > 0, 'APPLICATION_STELLAR_STARTUP_CHANGED');
  const native = await import(pathToFileURL(join(sourceDirectory, 'store.mjs')).href);
  const identity = await native.inspectStellarExpertIdentity(directory);
  need(identity.workspaceId === value.workspaceId, 'APPLICATION_STELLAR_STARTUP_CHANGED');
  const port = Number(option(request, '--port', true) ?? 8436);
  let url;
  try { url = new URL(value.url); }
  catch { need(false, 'APPLICATION_STELLAR_STARTUP_CHANGED'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
    !url.search && url.pathname === '/' && /^#[A-Za-z0-9_-]{43}$/.test(url.hash) &&
    Number.isInteger(port) && port >= 0 && port <= 65535 &&
    Number(url.port || 80) >= 1 && Number(url.port || 80) <= 65535 &&
    (port === 0 || Number(url.port || 80) === port), 'APPLICATION_STELLAR_STARTUP_CHANGED');
  return { url: url.href, original: {
    schema: STELLAR_EXPERT_READY_SCHEMA, directory, workspaceId: identity.workspaceId,
    inboxDirectory, releaseRuntimeFile, sourceDirectory, pid: value.pid,
  } };
}
