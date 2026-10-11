// MIT. Host configuration; MCP arguments never select files or executable modules.
import { readFile, lstat, mkdir, open } from 'node:fs/promises';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { initReleaseStore, readReleaseState } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';
import { readReleaseWorkspace, inspectUpstreamConfiguration } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-upstreams.mjs';
import { readReleaseCatalogConfig } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-catalog.mjs';
import { importOpenApi } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/importer.mjs';
import { createSellerServiceConfig } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-config.mjs';

export const CONFIG_SCHEMA = 'stellar-forge.merchant-mcp.v1';
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const failure = (code, message) => Object.assign(new Error(message), { code });
export function exact(value, keys, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw failure('INVALID_PARAMS', 'Supply only the declared fields, including every required field.');
}
export function identifier(value, label = 'Identifier') {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
    throw failure('INVALID_PARAMS', label + ' must use 1–64 lowercase letters, digits, underscores or hyphens.');
  return value;
}
export function line(value, label = 'Text') {
  if (typeof value !== 'string' || !value.trim() || value.length > 240 || /[\x00-\x1f\x7f]/.test(value))
    throw failure('INVALID_PARAMS', label + ' must be nonempty single-line text up to 240 characters.');
  return value.trim();
}
export async function fileBytes(path, maximum = 4 * 1024 * 1024) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > maximum) throw failure('SOURCE_INVALID', 'Expected a regular source file within its size limit.');
  const bytes = await readFile(path);
  if (bytes.length > maximum) throw failure('SOURCE_INVALID', 'Source file grew beyond its size limit.');
  return bytes;
}
export async function writePrivate(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw failure('CONFIGURATION_ERROR', 'Host paths must be nonempty strings.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
function sourceDefinition(source, base, alias) {
  exact(source, ['label', 'spec', 'selections', 'bindings', 'workspace', 'upstreams', 'runtime']);
  const runtime = structuredClone(source.runtime ?? {});
  exact(runtime, ['port', 'handlers', 'facilitator', 'allowLocalFacilitator', 'allowLoopbackUpstream']);
  for (const flag of ['allowLocalFacilitator', 'allowLoopbackUpstream'])
    if (runtime[flag] !== undefined && typeof runtime[flag] !== 'boolean')
      throw failure('CONFIGURATION_ERROR', flag + ' must be a boolean.');
  if (runtime.port !== undefined && (!Number.isInteger(runtime.port) || runtime.port < 0 || runtime.port > 65535))
    throw failure('CONFIGURATION_ERROR', 'Seller port must be 0–65535.');
  const result = { alias, label: line(source.label ?? alias, 'Source label'), runtime };
  if (source.workspace !== undefined) {
    if (['spec', 'selections', 'bindings', 'upstreams'].some(key => source[key] !== undefined) || runtime.handlers !== undefined)
      throw failure('CONFIGURATION_ERROR', 'Choose a saved API workspace package or explicit source files.');
    result.workspace = hostPath(source.workspace, base);
  } else {
    for (const [key, target] of [['spec', 'spec'], ['selections', 'config'], ['bindings', 'bindings']])
      result[target] = hostPath(source[key], base);
    if (source.upstreams !== undefined) result.upstreams = hostPath(source.upstreams, base);
    if (runtime.handlers !== undefined) runtime.handlers = hostPath(runtime.handlers, base);
    if (result.upstreams && runtime.handlers)
      throw failure('CONFIGURATION_ERROR', 'Choose upstream bindings or a trusted handler module.');
    if (runtime.allowLoopbackUpstream && !result.upstreams)
      throw failure('CONFIGURATION_ERROR', 'Loopback upstream permission requires upstream bindings.');
  }
  return result;
}
/** Inspect configured source through the ORIGINAL workspace and upstream readers. */
export async function inspectMerchantSource(source) {
  const workspace = source.workspace ? await readReleaseWorkspace(source.workspace) : null;
  const inputs = workspace?.inputs ?? source;
  const [spec, selections, bindings] = await Promise.all([inputs.spec, inputs.config, inputs.bindings].map(path => fileBytes(path)));
  const sourceDigests = { spec: hash(spec), selections: hash(selections), bindings: hash(bindings) };
  const imported = importOpenApi(parse(spec), parse(selections));
  const service = createSellerServiceConfig(imported, parse(bindings));
  let upstream = null, application = null;
  if (inputs.upstreams) {
    const bytes = await fileBytes(inputs.upstreams, 1024 * 1024);
    sourceDigests.upstreams = hash(bytes);
    upstream = inspectUpstreamConfiguration(bytes, service,
      workspace?.allowLoopbackUpstream === true || source.runtime.allowLoopbackUpstream === true);
  }
  if (workspace) {
    for (const [key, file] of [['spec', 'facade-openapi.json'], ['selections', 'selections.json'],
      ['bindings', 'route-bindings.json'], ['upstreams', 'upstreams.json']])
      if (sourceDigests[key] !== workspace.hashes[file])
        throw failure('SOURCE_CHANGED', 'Saved API package changed during inspection. Reopen the original package.');
  }
  if (source.runtime.handlers) {
    const bytes = await fileBytes(source.runtime.handlers);
    application = { type: 'TRUSTED_MODULE', entrySha256: hash(bytes), bytes: bytes.length };
  }
  if (service.routes.some(route => route.handler || route.admit) && !upstream && !application)
    throw failure('CONFIGURATION_ERROR', 'Application routes require configured upstream bindings or a trusted handler module.');
  return { source: source.alias, label: source.label,
    sourceType: workspace ? 'SAVED_API_WORKSPACE' : upstream ? 'OPENAPI_UPSTREAM' : 'OPENAPI',
    mode: source.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY', sourceDigests,
    inputPackage: workspace?.provenance ?? null, application,
    environment: upstream?.environment ?? [], credentialValuesChecked: false,
    routes: imported.offers.map((row, index) => ({ method: row.method, path: row.path,
      publicPath: service.routes[index].path, resource: row.seller.resource, accepts: row.seller.accepts,
      ...(upstream ? { upstream: upstream.bindings[service.routes[index].handler] ?? null } : {}) })) };
}
export async function readMerchantConfig(path) {
  path = resolve(path);
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(path, 1024 * 1024)));
  exact(raw, ['schema', 'name', 'releaseStore', 'exportsDirectory', 'sources', 'catalogConnection'], ['schema', 'name', 'releaseStore', 'exportsDirectory', 'sources']);
  if (raw.schema !== CONFIG_SCHEMA || !plain(raw.sources) || Object.keys(raw.sources).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Expected a merchant MCP configuration with up to 32 named sources.');
  const base = dirname(path), sources = Object.create(null);
  for (const [alias, source] of Object.entries(raw.sources)) {
    identifier(alias, 'Source alias');
    sources[alias] = sourceDefinition(source, base, alias);
  }
  const config = { schema: CONFIG_SCHEMA, name: line(raw.name, 'Merchant name'),
    releaseStore: hostPath(raw.releaseStore, base), exportsDirectory: hostPath(raw.exportsDirectory, base), sources,
    catalog: raw.catalogConnection === undefined ? null
      : await readReleaseCatalogConfig(hostPath(raw.catalogConnection, base)) };
  await readReleaseState(config.releaseStore);
  if (!(await lstat(config.exportsDirectory)).isDirectory()) throw failure('CONFIGURATION_ERROR', 'Customer export directory must be a real directory.');
  return config;
}
export async function initializeMerchant({ directory, name = 'Starforge merchant', spec, selections, bindings, workspace, upstreams, runtime = {}, catalog }) {
  const root = resolve(directory);
  name = line(name, 'Merchant name');
  const source = sourceDefinition({ label: 'Initial merchant configuration', spec, selections, bindings, workspace, upstreams, runtime }, process.cwd(), 'initial');
  const preview = await inspectMerchantSource(source);
  const catalogConnection = catalog === undefined ? undefined : hostPath(catalog, process.cwd());
  if (catalogConnection) await readReleaseCatalogConfig(catalogConnection);
  await mkdir(root, { mode: 0o700 });
  await initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const path = join(root, 'merchant-mcp.json');
  await writePrivate(path, { schema: CONFIG_SCHEMA, name,
    releaseStore: './releases', exportsDirectory: './customer-exports',
    ...(catalogConnection ? { catalogConnection } : {}), sources: {
      initial: { label: source.label, runtime: source.runtime,
        ...(source.workspace ? { workspace: source.workspace } : { spec: source.spec, selections: source.config,
          bindings: source.bindings, ...(source.upstreams ? { upstreams: source.upstreams } : {}) }) },
    } });
  await readMerchantConfig(path);
  return { schema: CONFIG_SCHEMA, configuration: path, sourceAlias: 'initial', state: 'INITIALIZED',
    catalogConfigured: Boolean(catalogConnection),
    sourceType: preview.sourceType, sourceDigests: preview.sourceDigests, inputPackage: preview.inputPackage,
    environment: preview.environment, credentialValuesChecked: false };
}
