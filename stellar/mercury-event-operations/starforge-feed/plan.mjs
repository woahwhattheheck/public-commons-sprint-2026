// MIT. Prepare a complete merchant bundle around the original Mercury application.
import { randomBytes, createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname, isAbsolute, sep } from 'node:path';
import { EventFeedStore } from '../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/store.mjs';
import { FeedError, integer, isRecord, requireId } from '../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/model.mjs';
import { BRIDGE_SCHEMA, SOURCE_KEY_ENV, HMAC_ENV, TOKEN_ENV, DELIVERY_PATH, validateMercuryScope } from './bridge.mjs';

export const BUNDLE_SCHEMA = 'stellar-forge.mercury-feed-bundle.v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const DEFAULT_BASE = { mainnet: 'https://mainnet.mercurydata.app/rest', testnet: 'https://testnet.mercurydata.app/rest' };
export async function readJsonDocument(path, maximum = 1048576) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw new FeedError('REGULAR_JSON_FILE_REQUIRED', 422);
  const bytes = await readFile(path);
  if (bytes.length > maximum) throw new FeedError('JSON_FILE_TOO_LARGE', 422);
  try { return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), bytes }; }
  catch { throw new FeedError('INVALID_JSON_FILE', 422); }
}
export async function readJson(path, maximum = 1048576) { return (await readJsonDocument(path, maximum)).value; }
export async function privateWrite(path, value) {
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
export function bundlePath(directory, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path)) throw new FeedError('RELATIVE_BUNDLE_PATH_REQUIRED', 422);
  const base = resolve(directory), target = resolve(base, path);
  if (!target.startsWith(base + sep)) throw new FeedError('PATH_OUTSIDE_BUNDLE', 422);
  return target;
}
export async function loadPrivateEnv(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.size > 65536) throw new FeedError('PRIVATE_ENV_FILE_REQUIRED', 422);
  const seen = new Set(), text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const delimiter = line.indexOf('='), name = line.slice(0, delimiter), value = line.slice(delimiter + 1);
    if (delimiter < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || seen.has(name) || /[\x00-\x1f\x7f]/.test(value))
      throw new FeedError('INVALID_PRIVATE_ENV_FILE', 422);
    seen.add(name);
    if (!Object.hasOwn(process.env, name)) process.env[name] = value;
  }
}
export async function readBundle(directory) {
  const base = resolve(directory), { value: config, bytes } = await readJsonDocument(resolve(base, 'bridge.json'));
  if (!isRecord(config) || config.schema !== BRIDGE_SCHEMA ||
      !/^[a-f0-9]{32}$/.test(config.storeId ?? '') || typeof config.allowLocalProvider !== 'boolean' ||
      !isRecord(config.ports) || !Array.isArray(config.feedIds) || !config.feedIds.length ||
      config.feedIds.length > 64 || new Set(config.feedIds).size !== config.feedIds.length)
    throw new FeedError('INVALID_BRIDGE_BUNDLE', 422);
  requireId(config.sourceId);
  for (const id of config.feedIds) requireId(id);
  for (const field of ['stateDirectory', 'mercuryConfig', 'bridgeEnvFile']) bundlePath(base, config[field]);
  for (const name of ['bridge', 'merchant', 'workspace', 'mercury']) integer(config.ports[name], 'ports.' + name, 1, 65535);
  if (new Set(Object.values(config.ports)).size !== 4) throw new FeedError('DISTINCT_SERVICE_PORTS_REQUIRED', 422);
  validateMercuryScope(config.scope, { allowLocalProvider: config.allowLocalProvider });
  return { directory: base, config, descriptorSha256: sha(bytes), descriptorBytes: bytes.length };
}
export async function openBundleStore(bundle, { secretResolver = name => process.env[name] } = {}) {
  const directory = bundlePath(bundle.directory, bundle.config.stateDirectory);
  const info = await lstat(resolve(directory, 'events.sqlite'));
  if (!info.isFile() || info.isSymbolicLink()) throw new FeedError('EXISTING_FEED_STORE_REQUIRED', 422);
  const store = new EventFeedStore(directory, { secretResolver });
  if (store.storeId !== bundle.config.storeId) { store.close(); throw new FeedError('BUNDLE_STORE_IDENTITY_CHANGED', 409); }
  return store;
}
function projection() {
  return [
    { name: 'network', pointer: '/network' }, { name: 'providerScope', pointer: '/provider_scope' },
    { name: 'providerRowId', pointer: '/provider_row_id' }, { name: 'contractId', pointer: '/canonical/contract_id' },
    { name: 'transaction', pointer: '/canonical/tx' }, { name: 'eventIndex', pointer: '/canonical/event_index' },
    { name: 'dataXdr', pointer: '/canonical/data' },
    ...Array.from({ length: 10 }, (_, index) => ({ name: 'topic' + (index + 1) + 'Xdr', pointer: '/canonical/topic' + (index + 1) })),
  ];
}

export async function prepareMercuryFeedBundle({ sourceConfig, directory, sourceId = 'mercury',
  feedId = 'mercury-events', payment, publicOrigin, ports = {}, python = 'python3' } = {}) {
  requireId(sourceId); requireId(feedId);
  if (!sourceConfig || !directory) throw new FeedError('SOURCE_CONFIG_AND_NEW_DIRECTORY_REQUIRED', 422);
  const { value: original, bytes: sourceBytes } = await readJsonDocument(resolve(sourceConfig), 262144);
  if (!isRecord(original) || original.schema !== undefined && original.schema !== 'mercury-event-operations/v1')
    throw new FeedError('ORIGINAL_MERCURY_CONFIG_REQUIRED', 422);
  if ((payment === undefined) !== (publicOrigin === undefined)) throw new FeedError('PAYMENT_AND_PUBLIC_ORIGIN_REQUIRED_TOGETHER', 422);
  const allowLocalProvider = original.allow_local_http === true;
  const network = original.network ?? 'mainnet';
  const scope = validateMercuryScope({ network, provider_scope: original.provider_scope ?? 'customer-primary',
    provider_base: original.api_base ?? DEFAULT_BASE[network], contracts: original.contracts }, { allowLocalProvider });
  const selectedPorts = { bridge: 8494, merchant: 8492, workspace: 8493, mercury: 8788, ...ports };
  for (const name of ['bridge', 'merchant', 'workspace', 'mercury']) integer(selectedPorts[name], name + ' port', 1, 65535);
  if (Object.keys(selectedPorts).length !== 4 || new Set(Object.values(selectedPorts)).size !== 4) throw new FeedError('DISTINCT_SERVICE_PORTS_REQUIRED', 422);
  const target = resolve(directory); await mkdir(target, { mode: 0o700 });
  let store;
  try {
    const source = { id: sourceId, label: ('Mercury ' + network + ' / ' + scope.provider_scope).slice(0, 128),
      secretEnv: SOURCE_KEY_ENV, typePointer: '/canonical/contract_id', occurredAtPointer: null,
      enabled: true, maxEventBytes: 262144, toleranceSeconds: 300 };
    store = new EventFeedStore(resolve(target, 'feed'));
    store.saveDefinition('source', source);
    const definitions = [];
    const chunks = Math.ceil(scope.contracts.length / 64);
    for (let index = 0; index < chunks; index++) {
      const id = chunks === 1 ? feedId : feedId + '-' + (index + 1); requireId(id);
      const definition = { id, label: 'Mercury contract events' + (chunks === 1 ? '' : ' ' + (index + 1)),
        description: 'Canonical Mercury contract events for ' + scope.network + ' / ' + scope.provider_scope + '. Original XDR strings and canonical row identities are retained.',
        sourceIds: [sourceId], types: scope.contracts.slice(index * 64, index * 64 + 64), projection: projection(),
        enabled: true, defaultPageSize: 50, maxPageSize: 100, maxPageBytes: 1048576 };
      definitions.push(definition); store.saveDefinition('feed', definition);
    }
    const destination = { kind: 'http', url: 'http://127.0.0.1:' + selectedPorts.bridge + DELIVERY_PATH,
      token_env: TOKEN_ENV, hmac_secret_env: HMAC_ENV, idempotency_supported: true };
    const mercury = { ...original, schema: 'mercury-event-operations/v1', workspace: './mercury',
      network: scope.network, provider_scope: scope.provider_scope, api_base: scope.provider_base,
      contracts: scope.contracts, destination, allow_local_http: true };
    const config = { schema: BRIDGE_SCHEMA, storeId: store.storeId, sourceId, feedIds: definitions.map(feed => feed.id),
      scope, allowLocalProvider, ports: selectedPorts, stateDirectory: 'feed', mercuryConfig: 'mercury-config.json',
      bridgeEnvFile: 'bridge-secrets.env' };
    const env = '# Private bridge credentials. Literal NAME=value lines; keep mode 600.\n' +
      TOKEN_ENV + '=' + randomBytes(32).toString('base64url') + '\n' +
      HMAC_ENV + '=' + randomBytes(32).toString('hex') + '\n' +
      SOURCE_KEY_ENV + '=whsec_' + randomBytes(32).toString('base64') + '\n';
    await privateWrite(resolve(target, 'bridge.json'), config);
    await privateWrite(resolve(target, 'mercury-config.json'), mercury);
    await privateWrite(resolve(target, 'bridge-secrets.env'), env);
    await privateWrite(resolve(target, 'source.json'), source);
    await privateWrite(resolve(target, 'feeds.json'), definitions);
    let merchant = null;
    if (payment !== undefined) {
      const plan = { schema: 'stellar-forge.webhook-feed-merchant.v1', publicOrigin,
        feeds: definitions.map(feed => ({ feedId: feed.id, ...(Array.isArray(payment) ? { paymentOptions: payment } : { payment }) })) };
      const { buildWebhookFeedService, prepareWebhookFeedRelease } = await import('../../scf-starforge-20261009/sf30-seller-sdk/webhook-feed/merchant.mjs');
      buildWebhookFeedService({ store, plan }); store.saveMerchantPlan(plan);
      await prepareWebhookFeedRelease({ store, plan, directory: resolve(target, 'seller-release') });
      merchant = { publicOrigin, feeds: definitions.map(feed => feed.id) };
    }
    const { callMercury } = await import('./native.mjs');
    const native = await callMercury({ configPath: resolve(target, 'mercury-config.json'), args: ['status'], python });
    const manifest = { schema: BUNDLE_SCHEMA, nativeVersion: native.version, createdAt: new Date().toISOString(), storeId: store.storeId,
      sourceConfig: { sha256: sha(sourceBytes), bytes: sourceBytes.length },
      sourceId, feedIds: config.feedIds, scope, destination, merchant,
      credentialVariables: [TOKEN_ENV, HMAC_ENV, SOURCE_KEY_ENV],
      providerCredentialVariables: [original.provider_token_env ?? 'MERCURY_JWT', original.webhook_secret_env ?? 'MERCURY_WEBHOOK_SECRET', original.operator_token_env ?? 'MERCURY_OPS_TOKEN'],
      files: ['bridge.json', 'mercury-config.json', 'source.json', 'feeds.json'] };
    await privateWrite(resolve(target, 'bundle.json'), manifest);
    return { directory: target, ...manifest };
  } catch (error) {
    store?.close(); store = null;
    await rm(target, { recursive: true, force: true }); throw error;
  } finally { store?.close(); }
}
