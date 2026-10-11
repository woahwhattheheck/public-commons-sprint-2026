// MIT. Host configuration; MCP arguments never select files or executable modules.
import { readFile, lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, basename, resolve, isAbsolute, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { initReleaseStore, readReleaseState } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';
import { readReleaseWorkspace, inspectUpstreamConfiguration } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-upstreams.mjs';
import { readReleaseCatalogConfig } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-catalog.mjs';
import { importOpenApi } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/importer.mjs';
import { createSellerServiceConfig } from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-config.mjs';
import { preparePythonRelease } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-python.mjs';
import { prepareDuckdbRelease, selectDuckdbInterpreter } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-duckdb.mjs';
import { prepareS3Release } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-s3.mjs';
import { prepareJsonrpcRelease } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-jsonrpc.mjs';
import { prepareSqliteRelease, sqliteSnapshotOptions } from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-sqlite.mjs';
import { readFleetReleasePlan } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/release-operator.mjs';
import { normalizeAccountingConfig, readAccountingConfig } from './accounting.mjs';

export const CONFIG_SCHEMA = 'stellar-forge.merchant-mcp.v1';
export const SUPPORT_CONFIG_SCHEMA = 'stellar-forge.merchant-support-connection.v1';
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
async function fleetDefinition(raw, base, releaseStore) {
  if (raw === undefined) return null;
  exact(raw, ['planFile', 'directory', 'gatewayStateDirectory'], ['planFile', 'directory']);
  const fleet = { planFile: hostPath(raw.planFile, base), directory: hostPath(raw.directory, base),
    ...(raw.gatewayStateDirectory === undefined ? {} : { gatewayStateDirectory: hostPath(raw.gatewayStateDirectory, base) }) };
  const plan = await readFleetReleasePlan(fleet.planFile);
  const individualStore = await realpath(releaseStore);
  if (fleet.directory === individualStore || plan.tenants.some(row => Object.values(row.slots).some(slot => slot.store === individualStore)))
    throw failure('CONFIGURATION_ERROR', 'The individual merchant release store and fleet stores must have separate ownership.');
  return fleet;
}
export async function privateSupportDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && (info.mode & 0o077))
    throw failure('CONFIGURATION_ERROR', 'Support storage and exports require an existing private directory (0700).');
  return path;
}
/** Host-only references to the original case and incident stores; never MCP arguments. */
export async function readSupportConfiguration(path) {
  path = resolve(path);
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(path, 1024 * 1024)));
  exact(raw, ['schema', 'casesDirectory', 'incidentsDirectory', 'handoffs', 'workspaces', 'profiles'], ['schema', 'casesDirectory']);
  if (raw.schema !== SUPPORT_CONFIG_SCHEMA) throw failure('CONFIGURATION_ERROR', 'Expected an original merchant support connection.');
  const base = dirname(path), aliases = kind => {
    const source = raw[kind] ?? {};
    if (!plain(source) || Object.keys(source).length > 32) throw failure('CONFIGURATION_ERROR', 'Use up to 32 named support inputs per kind.');
    return Object.fromEntries(Object.entries(source).map(([name, value]) => {
      identifier(name, 'Support source alias'); exact(value, ['label', 'file'], ['file']);
      return [name, { label: line(value.label ?? name, 'Support source label'), file: hostPath(value.file, base) }];
    }));
  };
  return { casesDirectory: await privateSupportDirectory(hostPath(raw.casesDirectory, base)),
    incidentsDirectory: raw.incidentsDirectory === undefined ? null
      : await privateSupportDirectory(hostPath(raw.incidentsDirectory, base)),
    handoffs: aliases('handoffs'), workspaces: aliases('workspaces'), profiles: aliases('profiles') };
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
export function pythonSourceView(python) {
  if (!python) return null;
  const { interpreter, ...metadata } = python;
  return { ...metadata, interpreter: { configured: true, selectionSha256: hash(interpreter) } };
}
export function duckdbSourceView(duckdb) {
  if (!duckdb) return null;
  const { interpreter, ...metadata } = duckdb;
  return { ...metadata, interpreter: { configured: true, selectionSha256: hash(interpreter) } };
}
function sourceDefinition(source, base, alias) {
  exact(source, ['label', 'spec', 'selections', 'bindings', 'workspace', 'upstreams', 'python', 'pythonRoot', 'duckdbPackage', 'duckdbPython', 's3Package', 'jsonrpcPackage', 'sqlitePackage', 'sqliteSnapshotMaxBytes', 'sqliteSnapshotTimeoutMs', 'runtime']);
  const runtime = structuredClone(source.runtime ?? {});
  exact(runtime, ['port', 'handlers', 'facilitator', 'allowLocalFacilitator', 'allowLoopbackUpstream']);
  for (const flag of ['allowLocalFacilitator', 'allowLoopbackUpstream'])
    if (runtime[flag] !== undefined && typeof runtime[flag] !== 'boolean')
      throw failure('CONFIGURATION_ERROR', flag + ' must be a boolean.');
  if (runtime.port !== undefined && (!Number.isInteger(runtime.port) || runtime.port < 0 || runtime.port > 65535))
    throw failure('CONFIGURATION_ERROR', 'Seller port must be 0–65535.');
  const result = { alias, label: line(source.label ?? alias, 'Source label'), runtime };
  if (source.pythonRoot !== undefined && source.python === undefined)
    throw failure('CONFIGURATION_ERROR', 'A Python source root requires a Python merchant declaration.');
  if (source.duckdbPython !== undefined && source.duckdbPackage === undefined)
    throw failure('CONFIGURATION_ERROR', 'A DuckDB interpreter selection requires a prepared DuckDB package.');
  if (source.sqlitePackage === undefined && (source.sqliteSnapshotMaxBytes !== undefined || source.sqliteSnapshotTimeoutMs !== undefined))
    throw failure('CONFIGURATION_ERROR', 'SQLite snapshot selections require a SQLite workbench package.');
  if (source.sqlitePackage !== undefined) {
    if (['workspace', 'spec', 'selections', 'bindings', 'upstreams', 'python', 'pythonRoot', 'duckdbPackage', 'duckdbPython', 's3Package', 'jsonrpcPackage'].some(key => source[key] !== undefined) ||
        runtime.handlers !== undefined || runtime.allowLoopbackUpstream)
      throw failure('CONFIGURATION_ERROR', 'Choose the original SQLite workbench package or another source; SQLite owns its query bindings.');
    const limits = sqliteSnapshotOptions({ maxBytes: source.sqliteSnapshotMaxBytes, timeoutMs: source.sqliteSnapshotTimeoutMs });
    result.sqlitePackage = hostPath(source.sqlitePackage, base);
    result.sqliteSnapshotMaxBytes = limits.maxBytes; result.sqliteSnapshotTimeoutMs = limits.timeoutMs;
  } else if (source.jsonrpcPackage !== undefined) {
    if (['workspace', 'spec', 'selections', 'bindings', 'upstreams', 'python', 'pythonRoot', 'duckdbPackage', 'duckdbPython', 's3Package'].some(key => source[key] !== undefined) ||
        runtime.handlers !== undefined)
      throw failure('CONFIGURATION_ERROR', 'Choose the original prepared RPC package or another source. RPC owns its method and provider bindings.');
    result.jsonrpcPackage = hostPath(source.jsonrpcPackage, base);
  } else if (source.s3Package !== undefined) {
    if (['workspace', 'spec', 'selections', 'bindings', 'upstreams', 'python', 'pythonRoot', 'duckdbPackage', 'duckdbPython'].some(key => source[key] !== undefined) ||
        runtime.handlers !== undefined || runtime.allowLoopbackUpstream)
      throw failure('CONFIGURATION_ERROR', 'Choose the original S3 configured package or another source. S3 owns its pinned object bindings.');
    result.s3Package = hostPath(source.s3Package, base);
  } else if (source.duckdbPackage !== undefined) {
    if (['workspace', 'spec', 'selections', 'bindings', 'upstreams', 'python', 'pythonRoot'].some(key => source[key] !== undefined) ||
        runtime.handlers !== undefined || runtime.allowLoopbackUpstream)
      throw failure('CONFIGURATION_ERROR', 'Choose a prepared DuckDB package or another source. The package owns its original query bindings.');
    result.duckdbPackage = hostPath(source.duckdbPackage, base);
    result.duckdbPython = selectDuckdbInterpreter(source.duckdbPython, base);
  } else if (source.python !== undefined) {
    if (['workspace', 'spec', 'selections', 'bindings', 'upstreams'].some(key => source[key] !== undefined) ||
        runtime.handlers !== undefined || runtime.allowLoopbackUpstream)
      throw failure('CONFIGURATION_ERROR', 'Choose a Python merchant declaration or an OpenAPI source. Python owns its application bindings.');
    result.python = hostPath(source.python, base);
    if (source.pythonRoot !== undefined) result.pythonRoot = hostPath(source.pythonRoot, base);
  } else if (source.workspace !== undefined) {
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
  if (source.sqlitePackage) {
    const prepared = await prepareSqliteRelease(source.sqlitePackage);
    return { source: source.alias, label: source.label, sourceType: 'SQLITE_MERCHANT_PACKAGE',
      mode: source.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
      sourceDigests: { package: hash(prepared.originals.get('manifest.json')), declaration: hash(prepared.originals.get('source.json')) },
      inputPackage: { schema: prepared.manifest.schema, manifestSha256: hash(prepared.originals.get('manifest.json')) },
      application: { type: 'SQLITE_MERCHANT_PACKAGE', snapshot: 'CAPTURE_ON_STAGE', queryCount: prepared.service.routes.length,
        maxBytes: source.sqliteSnapshotMaxBytes, timeoutMs: source.sqliteSnapshotTimeoutMs },
      environment: [], credentialValuesChecked: false,
      routes: prepared.service.routes.map(route => ({ method: route.offer.extensions.bazaar.info.input.method,
        path: route.path, publicPath: route.path, resource: route.offer.resource, accepts: route.offer.accepts })) };
  }
  if (source.jsonrpcPackage) {
    const prepared = await prepareJsonrpcRelease(source.jsonrpcPackage), { jsonrpc } = prepared;
    return { source: source.alias, label: source.label, sourceType: 'JSONRPC_MERCHANT_PACKAGE',
      mode: source.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
      sourceDigests: { plan: jsonrpc.planSha256, package: jsonrpc.packageManifestSha256, execution: jsonrpc.executionSha256 },
      inputPackage: { schema: jsonrpc.schema, manifestSha256: jsonrpc.packageManifestSha256 },
      application: { type: 'JSONRPC_MERCHANT_PACKAGE', ...jsonrpc },
      environment: prepared.environment, credentialValuesChecked: false,
      routes: prepared.service.routes.map(route => ({ method: 'POST', path: route.path, publicPath: route.path,
        resource: route.offer.resource, accepts: route.offer.accepts })) };
  }
  if (source.s3Package) {
    const prepared = await prepareS3Release(source.s3Package), { s3 } = prepared;
    return { source: source.alias, label: source.label, sourceType: 'S3_OBJECT_PACKAGE',
      mode: source.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
      sourceDigests: { declaration: s3.sourceConfigSha256, objects: s3.objectsSha256, execution: s3.executionSha256 },
      inputPackage: { schema: s3.schema, sourceConfigSha256: s3.sourceConfigSha256 },
      application: { type: 'S3_OBJECT_PACKAGE', ...s3 },
      environment: s3.credentialProvider === 'environment' ? ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'] : [],
      credentialValuesChecked: false,
      routes: prepared.service.routes.map(route => ({ method: 'GET', path: route.path, publicPath: route.path,
        resource: route.offer.resource, accepts: route.offer.accepts })) };
  }
  if (source.duckdbPackage) {
    const { bundle, duckdb } = await prepareDuckdbRelease(source.duckdbPackage, { python: source.duckdbPython });
    return { source: source.alias, label: source.label, sourceType: 'DUCKDB_PACKAGE',
      mode: source.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
      sourceDigests: { package: duckdb.packageManifestSha256, declaration: duckdb.sourceConfigSha256,
        plan: duckdb.planSha256, dataset: duckdb.datasetSha256, execution: duckdb.executionSha256 },
      inputPackage: { schema: bundle.schema, manifestSha256: duckdb.packageManifestSha256 },
      application: { type: 'DUCKDB_PACKAGE', ...duckdbSourceView(duckdb) },
      environment: [], credentialValuesChecked: false,
      routes: bundle.service.routes.map(route => ({ method: route.offer.extensions.bazaar.info.input.method,
        path: route.path, publicPath: route.path, resource: route.offer.resource, accepts: route.offer.accepts })) };
  }
  if (source.python) {
    const prepared = await preparePythonRelease(source.python, { sourceRoot: source.pythonRoot });
    const { compiled, python } = prepared;
    return { source: source.alias, label: source.label, sourceType: 'PYTHON_APPLICATION',
      mode: source.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
      sourceDigests: { declaration: python.configSha256, application: python.applicationSha256,
        source: python.sourceSha256, execution: python.executionSha256 }, inputPackage: null,
      application: { type: 'PYTHON_APPLICATION', ...pythonSourceView(python) },
      environment: compiled.options.environment, credentialValuesChecked: false,
      routes: compiled.service.routes.map(route => ({ method: compiled.functions[route.id].method,
        path: route.path, publicPath: route.path, resource: route.offer.resource, accepts: route.offer.accepts })) };
  }
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
  exact(raw, ['schema', 'name', 'releaseStore', 'exportsDirectory', 'sources', 'catalogConnection', 'fleet', 'accounting', 'supportConnection'], ['schema', 'name', 'releaseStore', 'exportsDirectory', 'sources']);
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
      : await readReleaseCatalogConfig(hostPath(raw.catalogConnection, base)),
    support: raw.supportConnection === undefined ? null
      : await readSupportConfiguration(hostPath(raw.supportConnection, base)) };
  await readReleaseState(config.releaseStore);
  config.fleet = await fleetDefinition(raw.fleet, base, config.releaseStore);
  config.accounting = normalizeAccountingConfig(raw.accounting, base);
  if (!(await lstat(config.exportsDirectory)).isDirectory()) throw failure('CONFIGURATION_ERROR', 'Customer export directory must be a real directory.');
  if (config.support) await privateSupportDirectory(config.exportsDirectory);
  return config;
}
export async function initializeMerchant({ directory, name = 'Starforge merchant', spec, selections, bindings, workspace, upstreams, python, pythonRoot, duckdbPackage, duckdbPython, s3Package, jsonrpcPackage, sqlitePackage, sqliteSnapshotMaxBytes, sqliteSnapshotTimeoutMs, runtime = {}, catalog, fleetPlan, accounting, support }) {
  const root = resolve(directory);
  name = line(name, 'Merchant name');
  const source = sourceDefinition({ label: 'Initial merchant configuration', spec, selections, bindings, workspace, upstreams, python, pythonRoot, duckdbPackage, duckdbPython, s3Package, jsonrpcPackage, sqlitePackage, sqliteSnapshotMaxBytes, sqliteSnapshotTimeoutMs, runtime }, process.cwd(), 'initial');
  if (source.pythonRoot) {
    const sourceRoot = await realpath(source.pythonRoot);
    const destination = join(await realpath(dirname(root)), basename(root));
    const within = relative(sourceRoot, destination);
    if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
      throw failure('CONFIGURATION_ERROR', 'Keep the merchant operator directory outside its selected Python source root.');
  }
  const preview = await inspectMerchantSource(source);
  const catalogConnection = catalog === undefined ? undefined : hostPath(catalog, process.cwd());
  if (catalogConnection) await readReleaseCatalogConfig(catalogConnection);
  const planFile = fleetPlan === undefined ? undefined : hostPath(fleetPlan, process.cwd());
  if (planFile) await readFleetReleasePlan(planFile);
  const accountingConfig = accounting === undefined ? null : await readAccountingConfig(accounting);
  const supportConnection = support === undefined ? undefined : hostPath(support, process.cwd());
  if (supportConnection) await readSupportConfiguration(supportConnection);
  await mkdir(root, { mode: 0o700 });
  await initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const path = join(root, 'merchant-mcp.json');
  await writePrivate(path, { schema: CONFIG_SCHEMA, name,
    releaseStore: './releases', exportsDirectory: './customer-exports',
    ...(catalogConnection ? { catalogConnection } : {}),
    ...(accountingConfig ? { accounting: accountingConfig } : {}),
    ...(supportConnection ? { supportConnection } : {}),
    ...(planFile ? { fleet: { planFile, directory: './fleet' } } : {}), sources: {
      initial: { label: source.label, runtime: source.runtime,
        ...(source.sqlitePackage ? { sqlitePackage: source.sqlitePackage, sqliteSnapshotMaxBytes: source.sqliteSnapshotMaxBytes,
          sqliteSnapshotTimeoutMs: source.sqliteSnapshotTimeoutMs }
          : source.jsonrpcPackage ? { jsonrpcPackage: source.jsonrpcPackage }
          : source.s3Package ? { s3Package: source.s3Package }
          : source.duckdbPackage ? { duckdbPackage: source.duckdbPackage, duckdbPython: source.duckdbPython }
          : source.python ? { python: source.python, ...(source.pythonRoot ? { pythonRoot: source.pythonRoot } : {}) }
          : source.workspace ? { workspace: source.workspace } : { spec: source.spec, selections: source.config,
          bindings: source.bindings, ...(source.upstreams ? { upstreams: source.upstreams } : {}) }) },
    } });
  await readMerchantConfig(path);
  return { schema: CONFIG_SCHEMA, configuration: path, sourceAlias: 'initial', state: 'INITIALIZED',
    catalogConfigured: Boolean(catalogConnection), fleetConfigured: Boolean(planFile), accountingConfigured: Boolean(accountingConfig), supportConfigured: Boolean(supportConnection),
    sourceType: preview.sourceType, sourceDigests: preview.sourceDigests, inputPackage: preview.inputPackage,
    environment: preview.environment, credentialValuesChecked: false };
}

/** Configure the same provider for an existing fleet without an individual source. */
export async function initializeFleetMerchant({ directory, planFile, fleetDirectory, name = 'Starforge merchant fleet', accounting }) {
  const root = resolve(directory);
  name = line(name, 'Merchant fleet name');
  planFile = hostPath(planFile, process.cwd());
  const plan = await readFleetReleasePlan(planFile);
  const fleet = { planFile, directory: fleetDirectory === undefined ? './fleet' : hostPath(fleetDirectory, process.cwd()) };
  const accountingConfig = accounting === undefined ? null : await readAccountingConfig(accounting);
  await mkdir(root, { mode: 0o700 });
  await initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, fleet,
    ...(accountingConfig ? { accounting: accountingConfig } : {}) });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', fleetConfigured: true,
    planDigest: plan.digest, tenants: plan.tenants.length, fleetDirectory: hostPath(fleet.directory, root),
    fleet: 'STARTED_ONLY_BY_EXPLICIT_TOOL', accountingConfigured: Boolean(accountingConfig) };
}

/** Use the same merchant provider for existing accounting sources, without staging a seller. */
export async function initializeAccountingMerchant({ directory, accounting, name = 'Starforge merchant accounting' }) {
  const root = resolve(directory), accountingConfig = await readAccountingConfig(accounting);
  name = line(name, 'Merchant accounting name');
  if (!accountingConfig || !Object.keys(accountingConfig.workspaces).length)
    throw failure('CONFIGURATION_ERROR', 'Declare at least one original accounting workspace.');
  await mkdir(root, { mode: 0o700 });
  await initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, accounting: accountingConfig });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED',
    accountingWorkspaces: Object.keys(accountingConfig.workspaces), accounting: 'OPENED_ONLY_BY_EXPLICIT_TOOL' };
}
