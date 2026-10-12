// MIT. Attach a retained SensorThings workspace to the maintained merchant host.
import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir, rename, link, unlink } from 'node:fs/promises';
import { dirname, basename, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { exact, failure, line, writePrivate } from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { acquireStateLease } from '../../merchant-fleet-gateway/state-lease.mjs';
import { initReleaseStore, readReleaseState } from '../../sf82-seller-pilot/releases.mjs';
import { CONNECTION_SCHEMA } from './schema.mjs';
import { ALIAS, UUID } from './mcp-protocol.mjs';

export const SENSORTHINGS_SETUP_SCHEMA = 'stellar-forge.sensorthings-merchant-setup.v1';
const COMPLETE_SCHEMA = 'stellar-forge.sensorthings-merchant-setup-complete.v1';
const PROVIDER_ID = 'sensorthings-workspaces';
const LIMIT = 1024 * 1024;
const FILES = { intent: 'sensorthings-setup.json', complete: 'sensorthings-setup-complete.json',
  configuration: 'merchant-mcp.json', client: 'merchant-client.json' };
const references = ['consoleUrlFile', 'consoleUrlEnv', 'applicationUrlFile'];
const sha = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(Array.isArray(value) ? value.map(normalize) : normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  return value;
}
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
function need(ok, code, message) { if (!ok) throw failure('SENSORTHINGS_SETUP_' + code, message); }
function hostPath(value, base = process.cwd()) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value),
    'PATH', 'Choose a local file or directory path without control characters.');
  return resolve(base, value);
}
async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function noLinks(path) {
  let current = resolve(path);
  for (;;) {
    const info = await lstat(current);
    need(!info.isSymbolicLink(), 'SYMLINK', 'Use original files and directories without symbolic links.');
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
async function privateDirectory(path) {
  await noLinks(path);
  const info = await lstat(path);
  need(info.isDirectory() && (process.platform === 'win32' || !(info.mode & 0o077)),
    'PRIVATE_DIRECTORY', 'The selected host directory and its immediate parent must be private directories (0700).');
  return path;
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function folder(path) {
  await privateDirectory(dirname(path));
  try { await mkdir(path, { mode: 0o700 }); await syncDirectory(dirname(path)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return privateDirectory(path);
}
const sameStat = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
async function privateBytes(path, maximum = LIMIT) {
  await noLinks(path); await privateDirectory(dirname(path));
  const named = await lstat(path, { bigint: true });
  need(named.isFile() && named.size >= 0n && named.size <= BigInt(maximum) &&
    (process.platform === 'win32' || !(named.mode & 0o077n)),
  'PRIVATE_FILE', 'Use a complete private regular file within the declared size limit (0600).');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    need(sameStat(named, before), 'FILE_CHANGED', 'The original setup file changed before it could be read.');
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      need(read.bytesRead > 0, 'FILE_CHANGED', 'The original setup file ended before its retained length.');
      offset += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    need(sameStat(before, after) && sameStat(after, current), 'FILE_CHANGED', 'The original setup file changed during its read.');
    return bytes;
  } finally { await handle.close(); }
}
function decode(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw failure('SENSORTHINGS_SETUP_JSON', 'Use a complete original UTF-8 JSON file.'); }
}
async function json(path) { return decode(await privateBytes(path)); }
async function publish(path, value) {
  const bytes = Buffer.isBuffer(value) ? value : encoded(value);
  need(bytes.length <= LIMIT, 'FILE_LIMIT', 'The setup record exceeds its one-MiB limit.');
  await privateDirectory(dirname(path));
  if (await exists(path)) {
    need((await privateBytes(path)).equals(bytes), 'EXISTING_FILE_CHANGED',
      'The retained setup file has different original bytes. Preserve it and select a new output.');
    return { reused: true, sha256: sha(bytes), bytes: bytes.length };
  }
  const temporary = join(dirname(path), '.sensorthings-' + basename(path) + '-next-' + randomUUID());
  try {
    await writePrivate(temporary, bytes);
    let reused = false;
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need((await privateBytes(path)).equals(bytes), 'EXISTING_FILE_CHANGED',
        'Another writer published different setup bytes. Preserve that original file.');
      reused = true;
    }
    await syncDirectory(dirname(path));
    return { reused, sha256: sha(bytes), bytes: bytes.length };
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
function connectionDefinition(workspaces, base) {
  need(plain(workspaces) && Object.keys(workspaces).length >= 1 && Object.keys(workspaces).length <= 32,
    'CONNECTION', 'Declare one to 32 original SensorThings workspace connections.');
  const selected = Object.create(null);
  for (const alias of Object.keys(workspaces).sort()) {
    const item = workspaces[alias];
    need(ALIAS.test(alias), 'ALIAS', 'Use the original lowercase workspace alias.');
    exact(item, ['label', 'workspaceId', ...references], ['workspaceId']);
    need(typeof item.workspaceId === 'string' && UUID.test(item.workspaceId), 'WORKSPACE_ID',
      'Use the actual persistent UUID from the original SensorThings workspace.');
    const keys = references.filter(key => Object.hasOwn(item, key));
    need(keys.length === 1, 'CONNECTION', 'Choose exactly one private URL file, environment name or managed Applications URL file.');
    const key = keys[0], label = item.label ?? alias;
    need(typeof label === 'string' && label.trim().length > 0 && label.length <= 200 && !/[\x00-\x1f\x7f]/.test(label),
      'LABEL', 'Use a readable workspace label up to 200 characters.');
    if (key === 'consoleUrlEnv') need(typeof item[key] === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(item[key]),
      'ENVIRONMENT', 'Supply the name of the original session environment variable.');
    selected[alias] = { label, workspaceId: item.workspaceId,
      [key]: key === 'consoleUrlEnv' ? item[key] : hostPath(item[key], base) };
  }
  return { schema: CONNECTION_SCHEMA, workspaces: selected };
}
function summaries(definition) {
  return Object.entries(definition.workspaces).map(([workspace, item]) => ({
    workspace, label: item.label, workspaceId: item.workspaceId,
    connection: item.applicationUrlFile ? 'ORIGINAL_APPLICATIONS_RECORD'
      : item.consoleUrlFile ? 'ORIGINAL_PRIVATE_URL_FILE' : 'ORIGINAL_PRIVATE_URL_ENV',
  }));
}
async function selectedConnection(file) {
  const bytes = await privateBytes(file), raw = decode(bytes);
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  need(raw.schema === CONNECTION_SCHEMA, 'CONNECTION', 'Use the original SensorThings connection schema.');
  const expected = connectionDefinition(raw.workspaces, dirname(file));
  const current = await (await import('./mcp.mjs')).readSensorThingsWorkspaceConfiguration(file);
  need(canonical(current) === canonical(expected) && (await privateBytes(file)).equals(bytes),
    'CONNECTION_CHANGED', 'The selected connection changed while its original reader was validating it.');
  return { definition: current, bytes, sha256: sha(bytes), bindingSha256: sha(canonical(current)) };
}

/** Publish only workspace identities and references; no listener, token or provider call. */
export async function createSensorThingsWorkspaceConnection(options = {}) {
  exact(options, ['file', 'workspaces'], ['file', 'workspaces']);
  const file = hostPath(options.file), value = connectionDefinition(options.workspaces, dirname(file));
  await privateDirectory(dirname(file));
  const publication = await publish(file, value), selected = await selectedConnection(file);
  return { schema: CONNECTION_SCHEMA, file, ...publication, bindingSha256: selected.bindingSha256,
    workspaces: summaries(selected.definition), sessionChecked: false };
}
async function originalReleaseStore(path) {
  await privateDirectory(path); await privateDirectory(join(path, 'releases'));
  await privateBytes(join(path, 'state.json'), 4 * LIMIT);
  return readReleaseState(path);
}
async function pristineStage(path) {
  await privateDirectory(path);
  const names = await readdir(path);
  need(names.every(name => ['releases', 'state.json'].includes(name)), 'STAGE_CHANGED',
    'The retained setup stage contains files outside the original empty SF82 initialization.');
  if (names.includes('releases')) {
    await privateDirectory(join(path, 'releases'));
    need((await readdir(join(path, 'releases'))).length === 0, 'STAGE_CHANGED',
      'The original release stage contains activity. Preserve it and reopen its original owner.');
  }
  if (!names.includes('state.json')) return false;
  const bytes = await privateBytes(join(path, 'state.json'), 4 * LIMIT);
  let state;
  try { state = decode(bytes); } catch (error) { if (error.code === 'SENSORTHINGS_SETUP_JSON') return false; throw error; }
  need(state.schema === 'stellar-forge.seller-release-store.v1' && state.generation === 0 &&
    state.active === null && state.previous === null && Array.isArray(state.history) && state.history.length === 0,
  'STAGE_CHANGED', 'The retained original release stage is no longer an empty initialization.');
  need(names.includes('releases'), 'STAGE_CHANGED', 'The original release stage is missing its retained releases directory.');
  await readReleaseState(path); return true;
}
async function prepareReleaseStore(root, intent, lease) {
  const target = intent.releaseStore;
  if (await exists(target)) { await originalReleaseStore(target); return; }
  need(intent.releaseMode === 'CREATE_PRIVATE_SF82', 'RELEASE_STORE_MISSING',
    'The selected existing SF82 release store is missing. Restore that original store before reopening this host.');
  const stage = join(root, 'sensorthings-release-setup-' + intent.stageId);
  if (await exists(stage)) {
    if (!(await pristineStage(stage))) {
      // A partial native init is evidence, not an initialized replacement store.
      const retained = stage + '-incomplete-' + randomUUID();
      lease.assertHeld(); await rename(stage, retained); await syncDirectory(root);
    }
  }
  if (!(await exists(stage))) {
    lease.assertHeld(); await initReleaseStore(stage);
  }
  need(await pristineStage(stage), 'STAGE_INCOMPLETE', 'Resume this original initialization after its complete write succeeds.');
  need(!(await exists(target)), 'RELEASE_STORE_CHANGED', 'Another original release store appeared during setup.');
  lease.assertHeld(); await rename(stage, target); await syncDirectory(root);
  await originalReleaseStore(target);
}
function matchingIntent(saved, expected) {
  exact(saved, [...Object.keys(expected), 'stageId'], [...Object.keys(expected), 'stageId']);
  need(typeof saved.stageId === 'string' && UUID.test(saved.stageId), 'INTENT', 'The retained setup intent has no original stage identity.');
  need(canonical(Object.fromEntries(Object.keys(expected).map(key => [key, saved[key]]))) === canonical(expected),
    'INTENT_CHANGED', 'This merchant directory belongs to another connection, workspace binding, name or release store.');
  return saved;
}
function clientMatchesConfiguration(value, configuration) {
  const servers = value?.mcpServers;
  if (!plain(value) || Object.keys(value).length !== 1 || !plain(servers) ||
      Object.keys(servers).length !== 1 || !Object.hasOwn(servers, 'starforge-sensorthings')) return false;
  const selected = servers['starforge-sensorthings'];
  return plain(selected) && Object.keys(selected).sort().join(',') === 'args,command,env' &&
    typeof selected.command === 'string' && Array.isArray(selected.args) && selected.args.length === 1 &&
    typeof selected.args[0] === 'string' && plain(selected.env) &&
    Object.keys(selected.env).length === 1 && selected.env.MCP_MERCHANT_CONFIG === configuration;
}

/** Initialize/reopen the original merchant host around the same declared workspace. */
export async function initializeSensorThingsWorkspaceMerchant(options = {}) {
  exact(options, ['directory', 'connection', 'name', 'releaseStore'], ['directory', 'connection']);
  const root = hostPath(options.directory), connection = hostPath(options.connection);
  const name = line(options.name ?? 'Starforge SensorThings operator', 'Merchant name');
  const releaseStore = options.releaseStore === undefined ? join(root, 'releases') : hostPath(options.releaseStore);
  need(root !== releaseStore, 'DIRECTORY_CONFLICT', 'Keep the merchant host and its original SF82 store in separate directories.');
  const selected = await selectedConnection(connection);
  const { MERCHANT_PROVIDER_REGISTRY } = await import('../../../../stellar-forge/mcp-merchant-operator/providers.mjs');
  const provider = MERCHANT_PROVIDER_REGISTRY.providers.sensorthingsWorkspaces;
  need(provider?.configKey === 'sensorthingsWorkspaces' &&
    provider.configuration?.input === 'sensorthingsWorkspaceConnection' && typeof provider.initialize === 'function',
  'SOURCE_REQUIRED', 'Select the normal installed source containing the SensorThings distribution contribution and setup hook.');
  const { CONFIG_SCHEMA, readMerchantConfig } = await import('../../../../stellar-forge/mcp-merchant-operator/config.mjs');
  const { createMerchantMcpClientConfiguration } = await import('../../../../stellar-forge/mcp-merchant-operator/client-config.mjs');
  await folder(root);
  const lease = await acquireStateLease(root);
  try {
    const intentPath = join(root, FILES.intent), configuration = join(root, FILES.configuration);
    const clientConfiguration = join(root, FILES.client), completionPath = join(root, FILES.complete);
    const expected = { schema: SENSORTHINGS_SETUP_SCHEMA, directory: root, connection, name, releaseStore,
      releaseMode: options.releaseStore === undefined ? 'CREATE_PRIVATE_SF82' : 'SELECT_EXISTING_SF82',
      connectionBindingSha256: selected.bindingSha256, workspaces: selected.definition.workspaces };
    const reopening = Boolean(await exists(intentPath));
    let intent;
    if (reopening) intent = matchingIntent(await json(intentPath), expected);
    else {
      const allowedTemporary = /^\.sensorthings-[A-Za-z0-9_.-]+-next-[a-f0-9-]{36}$/;
      need((await readdir(root)).every(item => item === 'lease.lock' || allowedTemporary.test(item)),
        'DIRECTORY_IN_USE', 'Use a new private merchant directory, or reopen this setup’s original directory.');
      intent = { ...expected, stageId: randomUUID() };
      lease.assertHeld(); await publish(intentPath, intent);
    }
    await prepareReleaseStore(root, intent, lease);
    await folder(join(root, 'customer-exports'));
    const configValue = { schema: CONFIG_SCHEMA, name, releaseStore, exportsDirectory: './customer-exports',
      sources: {}, sensorthingsWorkspaceConnection: connection };
    lease.assertHeld(); await publish(configuration, configValue);
    const verified = await readMerchantConfig(configuration);
    need(canonical(verified.sensorthingsWorkspaces) === canonical(selected.definition),
      'CONNECTION_CHANGED', 'The original merchant reader returned a different SensorThings connection.');
    need((await privateBytes(connection)).equals(selected.bytes), 'CONNECTION_CHANGED',
      'The selected connection changed before setup completed. Preserve this intent and restore the original binding.');
    const completed = Boolean(await exists(completionPath));
    const currentClient = createMerchantMcpClientConfiguration({ configPath: configuration, name: 'starforge-sensorthings' });
    let clientValue;
    if (await exists(clientConfiguration)) {
      clientValue = await json(clientConfiguration);
      need(clientMatchesConfiguration(clientValue, configuration) &&
        (completed || canonical(clientValue) === canonical(currentClient)), 'CLIENT_CHANGED',
        'The retained MCP client registration belongs to different original configuration.');
    } else {
      lease.assertHeld(); await publish(clientConfiguration, currentClient); clientValue = currentClient;
    }
    const configBytes = await privateBytes(configuration), clientBytes = await privateBytes(clientConfiguration);
    const receiptValue = { schema: COMPLETE_SCHEMA, setupSchema: SENSORTHINGS_SETUP_SCHEMA,
      provider: PROVIDER_ID, configuration, configurationSha256: sha(configBytes),
      connection, connectionBindingSha256: selected.bindingSha256,
      clientConfiguration, clientConfigurationSha256: sha(clientBytes),
      releaseStore, workspaceIds: summaries(selected.definition).map(item => ({ workspace: item.workspace, workspaceId: item.workspaceId })),
      ownership: 'EXISTING_SENSORTHINGS_WORKSPACE', sessionChecked: false };
    need((await privateBytes(connection)).equals(selected.bytes), 'CONNECTION_CHANGED',
      'The selected connection changed before its complete receipt was published.');
    let completedAt;
    if (completed) {
      const receipt = await json(completionPath);
      exact(receipt, [...Object.keys(receiptValue), 'completedAt'], [...Object.keys(receiptValue), 'completedAt']);
      completedAt = receipt.completedAt;
      need(typeof completedAt === 'string' && Number.isFinite(Date.parse(completedAt)) &&
        canonical(Object.fromEntries(Object.keys(receiptValue).map(key => [key, receipt[key]]))) === canonical(receiptValue),
      'COMPLETION_CHANGED', 'The original completion receipt differs. Preserve all original files before correcting the selected input.');
    } else {
      completedAt = new Date().toISOString();
      lease.assertHeld(); await publish(completionPath, { ...receiptValue, completedAt });
    }
    lease.assertHeld();
    return { ...receiptValue, completedAt, state: completed ? 'REOPENED' : reopening ? 'RESUMED' : 'INITIALIZED',
      reused: completed, workspaces: summaries(selected.definition),
      clientSourceMatchesCurrentInstallation: canonical(clientValue) === canonical(currentClient),
      next: 'Use the original merchant_sensorthings_schema and view tools against the running declared workspace.' };
  } finally { await lease.close(); }
}

const HELP = 'SensorThings normal merchant setup\n\n' +
  '  starforge sensorthings-setup connection --options PRIVATE_JSON\n' +
  '  starforge sensorthings-setup merchant --options PRIVATE_JSON\n\n' +
  'connection options: {file,workspaces:{alias:{workspaceId,label?, exactly one of consoleUrlFile|consoleUrlEnv|applicationUrlFile}}}\n' +
  'merchant options: {directory,connection,name?,releaseStore?}\n' +
  'Paths select original local files. References inside a connection resolve beside that connection file.\n' +
  'Setup retains identities and private configuration; it does not start a listener or call a provider.\n' +
  'The normal registry also exposes: starforge merchant-providers init sensorthings-workspaces --options PRIVATE_JSON\n';
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(HELP); return;
  }
  need(args.length === 3 && ['connection', 'merchant'].includes(args[0]) && args[1] === '--options',
    'CLI', 'Use connection or merchant with one --options private JSON file.');
  const input = await json(hostPath(args[2]));
  const result = args[0] === 'connection'
    ? await createSensorThingsWorkspaceConnection(input) : await initializeSensorThingsWorkspaceMerchant(input);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    const code = typeof error.code === 'string' ? error.code : 'SETUP_FAILED';
    const message = code.startsWith('SENSORTHINGS_SETUP_') || code === 'INVALID_PARAMS'
      ? error.message : 'The original setup did not complete. Reopen the same directory after resolving its native file or lease error.';
    process.stderr.write(JSON.stringify({ error: { code, message } }) + '\n'); process.exitCode = 2;
  });
