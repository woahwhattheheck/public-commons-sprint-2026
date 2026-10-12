// MIT. Request collections in the original installed Applications lifecycle.
import { join } from 'node:path';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, regular, plain, need } from './storage.mjs';
import { collectionsWorkspaceSelection, matchCollectionsWorkspaceLaunch,
  COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA, collectionsWorkspaceUrl } from '../../sf88-operator-buyer-cli/collections/launch.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/';
const field = (name, label, required = false, description = '') =>
  ({ name, label, type: 'path', required, description });

export function collectionsApplication(common = []) {
  return {
    id: 'buyer-collections', command: 'buyer-collections-workspace',
    requiredSource: SOURCE + 'server.mjs',
    title: 'Request collections', terminal: false,
    description: 'Review grouped requests, run through the original buyer approval, and reopen received results and delivery exports.',
    fields: [
      field('stateDirectory', 'Private collection workspace', true,
        'Reopen an existing collection store, or create one folder in an existing private parent.'),
      field('queueRoot', 'Original buyer inbox', false,
        'Choose the existing initialized private inbox for a new collection store. An existing store remembers its inbox.'),
      ...common,
    ],
  };
}
async function selectedRecord(path, inputPath, inputs) {
  const file = await inputPath(path, 'file');
  inputs.push(file);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regular(file.path, 65536))); }
  catch { need(false, 'APPLICATION_COLLECTION_RECORD_INVALID', 'Choose the original collection store and initialized buyer inbox.'); }
  need(plain(value), 'APPLICATION_COLLECTION_RECORD_INVALID');
  return value;
}
export async function prepareCollectionsApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(plain(settings) && typeof inputPath === 'function', 'APPLICATION_COLLECTION_INPUTS_REQUIRED');
  const inputs = [], createDirectories = [];
  const state = await inputPath(absolute(settings.stateDirectory), 'directory', true, true);
  inputs.push(state);
  if (!state.exists) createDirectories.push(state.path);

  let retained = null;
  if (state.exists) {
    try { retained = await selectedRecord(join(state.path, 'collections.json'), inputPath, inputs); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (retained) need(retained.schema === 'stellar-forge.sf88.collections.v1' &&
      typeof retained.queueRoot === 'string', 'APPLICATION_COLLECTION_STORE_INVALID');
  }
  need(!retained || settings.queueRoot === undefined || settings.queueRoot === retained.queueRoot,
    'APPLICATION_COLLECTION_INBOX_CHANGED', 'This collection store belongs to its recorded original inbox.');
  const queueRoot = retained?.queueRoot ?? settings.queueRoot;
  need(typeof queueRoot === 'string' && queueRoot.length > 0, 'APPLICATION_COLLECTION_INBOX_REQUIRED',
    'Select the existing initialized buyer inbox when creating a collection store.');
  const inbox = await inputPath(absolute(queueRoot), 'directory', false, true);
  inputs.push(inbox, await inputPath(join(inbox.path, 'jobs'), 'directory', false, true));
  const inboxRecord = await selectedRecord(join(inbox.path, 'inbox.json'), inputPath, inputs);
  need(inboxRecord.schema === 'stellar-forge.sf88.buyer-inbox.v1',
    'APPLICATION_COLLECTION_INBOX_INVALID', 'Select an inbox initialized by the original buyer-inbox command.');

  // Applications already verifies the selected runtime's complete source binding.
  // This selects its actual original CLI and structured listener contract.
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false, source: false });
  inputs.push(await inputPath(join(runtime.sourceRoot, SOURCE, 'server.mjs'), 'file'));
  const feature = async path => {
    try { const file = await inputPath(path, 'file'); inputs.push(file); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  const launch = await feature(join(runtime.sourceRoot, SOURCE, 'launch.mjs'));
  const runner = await feature(join(runtime.sourceRoot, SOURCE, 'browser-run.mjs'));
  const args = ['--directory', state.path, '--queue-root', inbox.path];
  if (launch || runner) {
    const broker = await feature(join(runtime.sourceRoot,
      'stellar/scf-starforge-20261009/sf81-buyer-operator-bridge/browser-approval.mjs'));
    need(launch && runner && broker, 'APPLICATION_COLLECTION_BROWSER_SOURCE_REQUIRED',
      'Select the complete collection browser and original approval source edition.');
    args.push('--approval-mode', 'browser', '--startup-format', 'json');
  }
  // Earlier original collection editions retain their existing terminal command.
  // Their server does not accept the new browser or structured-startup flags.
  return { args, inputs, createDirectories };
}

export function collectionsStartup(request, text) {
  if (request?.command !== 'buyer-collections-workspace' || !Array.isArray(request.args) ||
      typeof text !== 'string' || text.length > 16384) return null;
  const flags = new Map(), allowed = new Set([
    '--directory', '--queue-root', '--port', '--approval-mode', '--startup-format',
  ]);
  for (let index = 0; index < request.args.length; index += 2) {
    const flag = request.args[index], value = request.args[index + 1];
    if (!allowed.has(flag) || flags.has(flag) || typeof value !== 'string' || !value) return null;
    flags.set(flag, value);
  }
  if (!flags.has('--directory') || !flags.has('--queue-root')) return null;
  const portText = flags.get('--port') ?? '0';
  if (!/^\d{1,5}$/.test(portText)) return null;
  const port = Number(portText);
  if (port > 65535) return null;
  const structured = flags.has('--startup-format') || flags.has('--approval-mode');
  if (structured && (flags.get('--startup-format') !== 'json' ||
      flags.get('--approval-mode') !== 'browser' ||
      !text.startsWith('{"schema":"' + COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA + '",'))) return null;
  try {
    const expected = collectionsWorkspaceSelection({
      directory: flags.get('--directory'), queueRoot: flags.get('--queue-root'),
      approvalMode: structured ? 'BROWSER' : 'TERMINAL',
    });
    if (!structured) {
      const prefix = 'Request collections: ';
      const url = text.startsWith(prefix) && collectionsWorkspaceUrl(text.slice(prefix.length), port);
      return url ? { url, original: {
        schema: 'stellar-forge.sf88.collections-legacy-selection.v1', ...expected,
      } } : null;
    }
    const announcement = JSON.parse(text);
    const url = matchCollectionsWorkspaceLaunch(announcement, expected, port);
    if (!url) return null;
    return { url, original: { schema: COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA,
      ...expected, pid: announcement.pid } };
  } catch { return null; }
}
