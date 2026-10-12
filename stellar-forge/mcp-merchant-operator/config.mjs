

// MIT. Host configuration; MCP arguments never select files or executable modules.
import { failure, identifier, privateSupportDirectory, writePrivate, plain, exact, line, fileBytes } from './host-files.mjs';
export { failure, identifier, privateSupportDirectory, writePrivate, plain, exact, line, fileBytes } from './host-files.mjs';
import { readFile, lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, basename, resolve, isAbsolute, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';


import { datasetReleaseView } from './catalog/dataset-lifecycle.mjs';


export async function initializeApiPassWorkspaceMerchant(options) {
  return (await import('./api-pass-setup.mjs')).initializeApiPassWorkspaceMerchant(options);
}

export const CONFIG_SCHEMA = 'stellar-forge.merchant-mcp.v1';
export const SUPPORT_CONFIG_SCHEMA = 'stellar-forge.merchant-support-connection.v1';
export const PUBLISHER_CONFIG_SCHEMA = 'stellar-forge.merchant-publisher-connection.v1';
export const ARCGIS_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.arcgis-workspace-connection.v1';

function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw failure('CONFIGURATION_ERROR', 'Host paths must be nonempty strings.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}
async function fleetDefinition(raw, base, releaseStore) {
  if (raw === undefined) return null;
  exact(raw, ['planFile', 'directory', 'gatewayStateDirectory'], ['planFile', 'directory']);
  const fleet = { planFile: hostPath(raw.planFile, base), directory: hostPath(raw.directory, base),
    ...(raw.gatewayStateDirectory === undefined ? {} : { gatewayStateDirectory: hostPath(raw.gatewayStateDirectory, base) }) };
  const plan = await (await import('../../stellar/scf-starforge-20261009/merchant-fleet-gateway/release-operator.mjs')).readFleetReleasePlan(fleet.planFile);
  const individualStore = await realpath(releaseStore);
  if (fleet.directory === individualStore || plan.tenants.some(row => Object.values(row.slots).some(slot => slot.store === individualStore)))
    throw failure('CONFIGURATION_ERROR', 'The individual merchant release store and fleet stores must have separate ownership.');
  return fleet;
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
/** Bind existing native workspaces without opening their database or scheduler. */
export async function readPublisherConfiguration(path) {
  path = resolve(path);
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(path, 65536)));
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== PUBLISHER_CONFIG_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Declare between 1 and 32 original publisher workspaces.');
  const base = dirname(path), workspaces = Object.create(null), directories = new Set();
  for (const [alias, input] of Object.entries(raw.workspaces)) {
    identifier(alias, 'Publisher alias');
    exact(input, ['label', 'kind', 'directory', 'seller', 'resource'], ['kind', 'directory']);
    if (!['postgres', 'sqlite', 'mysql', 'mongodb', 'sheets', 'sheetbest', 'nocodb', 'sftp', 'arcgis', 'census-acs', 'bls-labor'].includes(input.kind))
      throw failure('CONFIGURATION_ERROR', 'Publisher kind must be postgres, sqlite, mysql, mongodb, sheets, sheetbest, nocodb, sftp, arcgis, census-acs or bls-labor.');
    const directory = hostPath(input.directory, base), info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && (info.mode & 0o077))
      throw failure('CONFIGURATION_ERROR', 'Bind an existing private original publisher directory (0700).');
    const canonical = await realpath(directory);
    if (directories.has(canonical)) throw failure('CONFIGURATION_ERROR', 'Each publisher workspace must have one declared alias.');
    directories.add(canonical);
    const saved = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(join(directory, 'workspace.json'), 4096)));
    if (saved.schema !== 'stellar-forge.' + input.kind + '-publisher-workspace.v1')
      throw failure('CONFIGURATION_ERROR', 'The declared kind must match the original retained publisher workspace.');
    let buyer = {};
    if (input.seller !== undefined || input.resource !== undefined) {
      const { datasetBuyerEndpoint } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/buyer-handoff.mjs');
      buyer = datasetBuyerEndpoint(input.seller, input.resource);
    }
    workspaces[alias] = { label: line(input.label ?? alias, 'Publisher label'), kind: input.kind,
      directory: canonical, ...buyer };
  }
  return { workspaces };
}

/** Join host-declared ArcGIS inputs to the existing publisher and common release store.
 * Reading configuration opens no native workspace, scheduler or provider connection. */
export async function readArcgisWorkspaceConfiguration(path, { publishers, releaseStore } = {}) {
  path = resolve(path);
  if (await realpath(path) !== path) throw failure('CONFIGURATION_ERROR', 'Use the canonical ArcGIS connection file.');
  const info = await lstat(path);
  if (!info.isFile() || info.size > 1024 * 1024 || process.platform !== 'win32' &&
      ((info.mode & 0o077) || process.getuid && info.uid !== process.getuid()))
    throw failure('CONFIGURATION_ERROR', 'Use an owned private ArcGIS connection JSON file up to one MiB.');
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(path, 1024 * 1024)));
  exact(raw, ['schema','workspaces'], ['schema','workspaces']);
  if (raw.schema !== ARCGIS_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32 || !releaseStore)
    throw failure('CONFIGURATION_ERROR', 'Declare 1–32 ArcGIS workspaces and the original merchant release store.');
  const { arcgisLayerUrl } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/capture.mjs');
  const base = dirname(path), workspaces = Object.create(null), usedPublishers = new Set();
  const entries = (value, maximum, name) => {
    if (value === undefined) return [];
    if (!plain(value) || Object.keys(value).length > maximum)
      throw failure('CONFIGURATION_ERROR', 'Too many declared ArcGIS ' + name + '.');
    return Object.entries(value);
  };
  const count = (value, minimum, maximum, name) => {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      throw failure('CONFIGURATION_ERROR', 'ArcGIS ' + name + ' must be an integer from ' + minimum + ' to ' + maximum + '.');
    return value;
  };
  for (const [workspace, input] of Object.entries(raw.workspaces)) {
    identifier(workspace, 'ArcGIS workspace alias');
    exact(input, ['label','publisher','files','connections','runtime'], ['publisher']);
    const publisher = identifier(input.publisher, 'Publisher alias'), original = publishers?.workspaces?.[publisher];
    if (!original || original.kind !== 'arcgis' || usedPublishers.has(publisher))
      throw failure('CONFIGURATION_ERROR', 'Bind each ArcGIS workspace to one distinct existing publisher alias of kind arcgis.');
    usedPublishers.add(publisher);
    const files = Object.create(null), connections = Object.create(null);
    for (const [alias, file] of entries(input.files, 4096, 'file aliases')) {
      identifier(alias, 'ArcGIS file alias'); exact(file, ['label','file','kind'], ['file','kind']);
      if (!['layer','attributes','geometry','seller'].includes(file.kind))
        throw failure('CONFIGURATION_ERROR', 'An ArcGIS file is layer metadata, attributes, geometry or a seller configuration.');
      const selected = hostPath(file.file, base), canonical = await realpath(selected), observed = await lstat(selected);
      if (selected !== canonical || !observed.isFile() || observed.isSymbolicLink() || observed.size > 67108864)
        throw failure('CONFIGURATION_ERROR', 'Use an exact canonical regular ArcGIS file up to 64 MiB.');
      files[alias] = { label: line(file.label ?? alias, 'ArcGIS file label'), file: canonical, kind: file.kind };
    }
    for (const [alias, profile] of entries(input.connections, 32, 'connection profiles')) {
      identifier(alias, 'ArcGIS connection profile'); exact(profile, ['label','connection'], ['connection']);
      const c = profile.connection;
      exact(c, ['layerUrl','tokenEnv','pageSize','maxRows','maxSourceBytes','maxPageBytes','timeoutMs'], ['layerUrl']);
      if (c.tokenEnv !== undefined && (typeof c.tokenEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.tokenEnv)))
        throw failure('CONFIGURATION_ERROR', 'Use a host environment-variable name for the ArcGIS bearer token.');
      connections[alias] = { label: line(profile.label ?? alias, 'ArcGIS connection label'), connection: {
        layerUrl: arcgisLayerUrl(c.layerUrl), ...(c.tokenEnv === undefined ? {} : {tokenEnv:c.tokenEnv}),
        pageSize: count(c.pageSize ?? 250,1,1000,'page size'),
        maxRows: count(c.maxRows ?? 250000,1,1000000,'row limit'),
        maxSourceBytes: count(c.maxSourceBytes ?? 67108864,1024,268435456,'capture byte limit'),
        maxPageBytes: count(c.maxPageBytes ?? 16777216,1024,67108864,'page byte limit'),
        timeoutMs: count(c.timeoutMs ?? 120000,100,300000,'timeout'),
      }};
    }
    exact(input.runtime ?? {}, ['port','facilitator','allowLocalFacilitator']);
    const runtime = (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).normalizeReleaseRuntime({ ...(input.runtime ?? {}), port: input.runtime?.port ?? 0 });
    workspaces[workspace] = { label: line(input.label ?? workspace, 'ArcGIS workspace label'),
      publisher, files, connections, runtime, releaseDirectory: resolve(releaseStore) };
  }
  return { workspaces };
}

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
async function sourceDefinition(source, base, alias) {
  exact(source, ['label', 'spec', 'selections', 'bindings', 'workspace', 'upstreams', 'python', 'pythonRoot', 'duckdbPackage', 'duckdbPython', 'datasetPackage', 's3Package', 'jsonrpcPackage', 'sqlitePackage', 'sqliteSnapshotMaxBytes', 'sqliteSnapshotTimeoutMs', 'postgresPackage', 'mysqlPackage', 'clickhousePackage', 'clickhouseColumnTypes', 'runtime']);
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
  if (source.clickhouseColumnTypes !== undefined && source.clickhousePackage === undefined)
    throw failure('CONFIGURATION_ERROR', 'A reviewed ClickHouse column map requires its original prepared package.');
  if (source.datasetPackage !== undefined) {
    if (Object.keys(source).some(key => !['label', 'datasetPackage', 'runtime'].includes(key) && source[key] !== undefined) ||
        runtime.handlers !== undefined || runtime.allowLoopbackUpstream)
      throw failure('CONFIGURATION_ERROR', 'Choose the original dataset package or another source. The versioned dataset owns its native controller and query bindings.');
    result.datasetPackage = hostPath(source.datasetPackage, base);
  } else if (source.clickhousePackage !== undefined) {
    if (Object.keys(source).some(key => !['label', 'clickhousePackage', 'clickhouseColumnTypes', 'runtime'].includes(key) && source[key] !== undefined) ||
        runtime.handlers !== undefined || runtime.allowLoopbackUpstream)
      throw failure('CONFIGURATION_ERROR', 'Choose the original prepared ClickHouse package or another source. ClickHouse owns its native typed query bindings.');
    result.clickhousePackage = hostPath(source.clickhousePackage, base);
    if (source.clickhouseColumnTypes !== undefined) result.clickhouseColumnTypes = structuredClone(source.clickhouseColumnTypes);
  } else if (source.postgresPackage !== undefined) {
    if (Object.keys(source).some(key => !['label', 'postgresPackage', 'runtime'].includes(key) && source[key] !== undefined) ||
        runtime.handlers !== undefined || runtime.allowLoopbackUpstream)
      throw failure('CONFIGURATION_ERROR', 'Choose the original PostgreSQL package or another source. PostgreSQL owns its named query bindings.');
    result.postgresPackage = hostPath(source.postgresPackage, base);
  } else if (source.mysqlPackage !== undefined) {
    if (Object.keys(source).some(key => !['label', 'mysqlPackage', 'runtime'].includes(key) && source[key] !== undefined) ||
        runtime.handlers !== undefined || runtime.allowLoopbackUpstream)
      throw failure('CONFIGURATION_ERROR', 'Choose a prepared MySQL package or another source. The package owns its original query bindings.');
    result.mysqlPackage = hostPath(source.mysqlPackage, base);
  } else if (source.sqlitePackage !== undefined) {
    if (['workspace', 'spec', 'selections', 'bindings', 'upstreams', 'python', 'pythonRoot', 'duckdbPackage', 'duckdbPython', 's3Package', 'jsonrpcPackage'].some(key => source[key] !== undefined) ||
        runtime.handlers !== undefined || runtime.allowLoopbackUpstream)
      throw failure('CONFIGURATION_ERROR', 'Choose the original SQLite workbench package or another source; SQLite owns its query bindings.');
    const limits = (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-sqlite.mjs')).sqliteSnapshotOptions({ maxBytes: source.sqliteSnapshotMaxBytes, timeoutMs: source.sqliteSnapshotTimeoutMs });
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
    result.duckdbPython = (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-duckdb.mjs')).selectDuckdbInterpreter(source.duckdbPython, base);
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
  if (source.datasetPackage) {
    const prepared = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-dataset.mjs')).prepareDatasetRelease(source.datasetPackage), { dataset, service } = prepared;
    return { source: source.alias, label: source.label, sourceType: 'DATASET_RELEASE_PACKAGE',
      mode: source.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
      sourceDigests: { source: dataset.sourceSha256, binding: dataset.bindingSha256,
        config: dataset.sourceConfigSha256, csv: dataset.csvSha256, execution: dataset.executionSha256 },
      inputPackage: { schema: dataset.schema, baselineSnapshot: dataset.baselineSnapshot, contractSha256: dataset.contractSha256 },
      application: { type: 'DATASET_RELEASE_PACKAGE', ...datasetReleaseView(dataset) },
      environment: [], credentialValuesChecked: false,
      routes: service.routes.map(route => ({ method: 'GET', path: route.path, publicPath: route.path,
        resource: route.offer.resource, accepts: route.offer.accepts })) };
  }
  if (source.clickhousePackage) {
    const prepared = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-clickhouse.mjs')).prepareClickHouseRelease(source.clickhousePackage, { columnTypes: source.clickhouseColumnTypes }), { clickhouse } = prepared;
    return { source: source.alias, label: source.label, sourceType: 'CLICKHOUSE_MERCHANT_PACKAGE',
      mode: source.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
      sourceDigests: { package: clickhouse.packageSha256, declaration: clickhouse.sourceConfigSha256,
        plan: clickhouse.planSha256, queries: clickhouse.querySha256, execution: clickhouse.executionSha256 },
      inputPackage: { schema: clickhouse.schema, packageSha256: clickhouse.packageSha256 },
      application: { type: 'CLICKHOUSE_MERCHANT_PACKAGE', ...clickhouse },
      environment: Object.values(prepared.environment), credentialValuesChecked: false,
      routes: prepared.service.routes.map(route => ({ method: route.offer.extensions.bazaar.info.input.method,
        path: route.path, publicPath: route.path, resource: route.offer.resource, accepts: route.offer.accepts })) };
  }
  if (source.postgresPackage) {
    const { postgres, service } = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-postgres.mjs')).preparePostgresRelease(source.postgresPackage);
    return { source: source.alias, label: source.label, sourceType: 'POSTGRES_MERCHANT_PACKAGE',
      mode: source.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
      sourceDigests: { package: postgres.inputManifestSha256, declaration: postgres.sourceConfigSha256,
        originalSource: postgres.originalSourceConfigSha256, originalService: postgres.originalServiceConfigSha256,
        queries: postgres.queryDefinitionSha256, bindings: postgres.bindingsSha256,
        connectionPolicy: postgres.connectionPolicySha256, databaseCa: postgres.databaseCaSha256,
        execution: postgres.executionSha256 },
      inputPackage: { inputKind: postgres.inputKind, manifestSha256: postgres.inputManifestSha256 },
      application: { type: 'POSTGRES_MERCHANT_PACKAGE', ...postgres },
      environment: postgres.credentialReferences, credentialValuesChecked: false,
      routes: service.routes.map(route => ({ method: route.offer.extensions.bazaar.info.input.method,
        path: route.path, publicPath: route.path, resource: route.offer.resource, accepts: route.offer.accepts })) };
  }
  if (source.sqlitePackage) {
    const prepared = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-sqlite.mjs')).prepareSqliteRelease(source.sqlitePackage);
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
    const prepared = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-jsonrpc.mjs')).prepareJsonrpcRelease(source.jsonrpcPackage), { jsonrpc } = prepared;
    return { source: source.alias, label: source.label, sourceType: 'JSONRPC_MERCHANT_PACKAGE',
      mode: source.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
      sourceDigests: { plan: jsonrpc.planSha256, package: jsonrpc.packageManifestSha256, execution: jsonrpc.executionSha256 },
      inputPackage: { schema: jsonrpc.schema, manifestSha256: jsonrpc.packageManifestSha256 },
      application: { type: 'JSONRPC_MERCHANT_PACKAGE', ...jsonrpc },
      environment: prepared.environment, credentialValuesChecked: false,
      routes: prepared.service.routes.map(route => ({ method: 'POST', path: route.path, publicPath: route.path,
        resource: route.offer.resource, accepts: route.offer.accepts })) };
  }
  if (source.mysqlPackage) {
    const prepared = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-mysql.mjs')).prepareMysqlRelease(source.mysqlPackage), { mysql } = prepared;
    return { source: source.alias, label: source.label, sourceType: 'MYSQL_MERCHANT_PACKAGE',
      mode: source.runtime.facilitator ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
      sourceDigests: { package: mysql.packageManifestSha256, declaration: mysql.sourceConfigSha256,
        plan: mysql.planSha256, queries: mysql.queryDefinitionSha256, execution: mysql.executionSha256 },
      inputPackage: { schema: prepared.bundle.schema, manifestSha256: mysql.packageManifestSha256 },
      application: { type: 'MYSQL_MERCHANT_PACKAGE', ...mysql },
      environment: mysql.credentialReferences, credentialValuesChecked: false,
      routes: prepared.service.routes.map(route => ({ method: route.offer.extensions.bazaar.info.input.method,
        path: route.path, publicPath: route.path, resource: route.offer.resource, accepts: route.offer.accepts })) };
  }
  if (source.s3Package) {
    const prepared = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-s3.mjs')).prepareS3Release(source.s3Package), { s3 } = prepared;
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
    const { bundle, duckdb } = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-duckdb.mjs')).prepareDuckdbRelease(source.duckdbPackage, { python: source.duckdbPython });
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
    const prepared = await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-python.mjs')).preparePythonRelease(source.python, { sourceRoot: source.pythonRoot });
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
  const workspace = source.workspace ? await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-upstreams.mjs')).readReleaseWorkspace(source.workspace) : null;
  const inputs = workspace?.inputs ?? source;
  const [spec, selections, bindings] = await Promise.all([inputs.spec, inputs.config, inputs.bindings].map(path => fileBytes(path)));
  const sourceDigests = { spec: hash(spec), selections: hash(selections), bindings: hash(bindings) };
  const imported = (await import('../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/importer.mjs')).importOpenApi(parse(spec), parse(selections));
  const service = (await import('../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-config.mjs')).createSellerServiceConfig(imported, parse(bindings));
  let upstream = null, application = null;
  if (inputs.upstreams) {
    const bytes = await fileBytes(inputs.upstreams, 1024 * 1024);
    sourceDigests.upstreams = hash(bytes);
    upstream = (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-upstreams.mjs')).inspectUpstreamConfiguration(bytes, service,
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
  exact(raw, ['schema', 'name', 'releaseStore', 'exportsDirectory', 'sources', 'catalogConnection', 'facilitatorConnection', 'fleet', 'accounting', 'supportConnection', 'receivingConnection', 'pythonWorkspaceConnection', 'graphqlWorkspaceConnection', 'publisherConnection', 'arcgisWorkspaceConnection', 's3WorkspaceConnection', 'worldbankWorkspaceConnection', 'opensearchWorkspaceConnection', 'socrataWorkspaceConnection', 'odataWorkspaceConnection', 'fiscalDataWorkspaceConnection', 'geocodioWorkspaceConnection', 'webdavWorkspaceConnection', 'edgarWorkspaceConnection', 'sheetsWorkspaceConnection', 'nocodbWorkspaceConnection', 'ckanWorkspaceConnection', 'tenderlyWorkspaceConnection', 'opencageWorkspaceConnection', 'coingeckoWorkspaceConnection', 'redisWorkspaceConnection', 'usaSpendingWorkspaceConnection', 'researchWorkspaceConnection', 'grantsWorkspaceConnection', 'stellarExpertWorkspaceConnection', 'sourceWorkspaceConnection', 'clinicalTrialsWorkspaceConnection', 'baserowWorkspaceConnection', 'usgsWorkspaceConnection', 'feedsWorkspaceConnection', 'dspaceOperatorConnection', 'grpcWorkspaceConnection', 'openapiWorkspaceConnection', 'harWorkspaceConnection', 'pricingConnection', 'woocommerceConnection', 'cocartWorkspaceConnection', 'mppConnection', 'grantWorkspaceConnection', 'buyerExpenseConnection', 'apiPassWorkspaceConnection'], ['schema', 'name', 'releaseStore', 'exportsDirectory', 'sources']);
  if (raw.schema !== CONFIG_SCHEMA || !plain(raw.sources) || Object.keys(raw.sources).length > 32)
    throw failure('CONFIGURATION_ERROR', 'Expected a merchant MCP configuration with up to 32 named sources.');
  const base = dirname(path), sources = Object.create(null);
  for (const [alias, source] of Object.entries(raw.sources)) {
    identifier(alias, 'Source alias');
    sources[alias] = await sourceDefinition(source, base, alias);
  }
  const config = { schema: CONFIG_SCHEMA, name: line(raw.name, 'Merchant name'),
    releaseStore: hostPath(raw.releaseStore, base), exportsDirectory: hostPath(raw.exportsDirectory, base), sources,
    catalog: raw.catalogConnection === undefined ? null
      : await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-catalog.mjs')).readReleaseCatalogConfig(hostPath(raw.catalogConnection, base)),
    facilitators: raw.facilitatorConnection === undefined ? null
      : await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-facilitator.mjs')).readFacilitatorProfiles(hostPath(raw.facilitatorConnection, base)),
    support: raw.supportConnection === undefined ? null
      : await readSupportConfiguration(hostPath(raw.supportConnection, base)),
    receiving: raw.receivingConnection === undefined ? null
      : await (await import('./receiving.mjs')).readReceivingConfiguration(hostPath(raw.receivingConnection, base)),
    pythonWorkspaces: raw.pythonWorkspaceConnection === undefined ? null
      : await (await import('./python-workspace.mjs')).readPythonWorkspaceConfiguration(hostPath(raw.pythonWorkspaceConnection, base)),
    worldbankWorkspaces: raw.worldbankWorkspaceConnection === undefined ? null
      : await (await import('./worldbank-workspace.mjs')).readWorldBankWorkspaceConfiguration(hostPath(raw.worldbankWorkspaceConnection, base)),
    fiscalDataWorkspaces: raw.fiscalDataWorkspaceConnection === undefined ? null
      : await (await import('./fiscaldata-workspace.mjs')).readFiscalDataWorkspaceConfiguration(hostPath(raw.fiscalDataWorkspaceConnection, base)),
    graphqlWorkspaces: raw.graphqlWorkspaceConnection === undefined ? null
      : await (await import('./graphql-workspace.mjs')).readGraphqlWorkspaceConfiguration(hostPath(raw.graphqlWorkspaceConnection, base)),
    odataWorkspaces: raw.odataWorkspaceConnection === undefined ? null
      : await (await import('./odata-workspace.mjs')).readODataWorkspaceConfiguration(hostPath(raw.odataWorkspaceConnection, base)),
    socrataWorkspaces: raw.socrataWorkspaceConnection === undefined ? null
      : await (await import('./socrata-workspace.mjs')).readSocrataWorkspaceConfiguration(hostPath(raw.socrataWorkspaceConnection, base)),
    webdavWorkspaces: raw.webdavWorkspaceConnection === undefined ? null
      : await (await import('./webdav-tools.mjs')).readWebDavWorkspaceConfiguration(hostPath(raw.webdavWorkspaceConnection, base)),
    edgarWorkspaces: raw.edgarWorkspaceConnection === undefined ? null
      : await (await import('./sec-edgar-tools.mjs')).readEdgarWorkspaceConfiguration(hostPath(raw.edgarWorkspaceConnection, base)),
    geocodioWorkspaces: raw.geocodioWorkspaceConnection === undefined ? null
      : await (await import('./geocodio-workspace.mjs')).readGeocodioWorkspaceConfiguration(hostPath(raw.geocodioWorkspaceConnection, base)),
    publishers: raw.publisherConnection === undefined ? null
      : await readPublisherConfiguration(hostPath(raw.publisherConnection, base)),
    pricing: raw.pricingConnection === undefined ? null
      : await (await import('./pricing.mjs')).readPricingConfiguration(hostPath(raw.pricingConnection, base)),
    cocartWorkspaces: raw.cocartWorkspaceConnection === undefined ? null
      : await (await import('./cocart-workspace.mjs')).readCocartWorkspaceConfiguration(hostPath(raw.cocartWorkspaceConnection, base)),
    woocommerce: raw.woocommerceConnection === undefined ? null
      : await (await import('./woocommerce.mjs')).readWooCommerceConfiguration(hostPath(raw.woocommerceConnection, base)),
    mpp: raw.mppConnection === undefined ? null : await (await import('./mpp-config.mjs')).readMppConfiguration(hostPath(raw.mppConnection, base)),
    grantWorkspaces: raw.grantWorkspaceConnection === undefined ? null
      : await (await import('./grant-workspace.mjs')).readGrantWorkspaceConfiguration(hostPath(raw.grantWorkspaceConnection, base)),
    buyerExpenses: raw.buyerExpenseConnection === undefined ? null
      : await (await import('./buyer-expenses.mjs')).readBuyerExpenseConfiguration(hostPath(raw.buyerExpenseConnection, base)) };
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).readReleaseState(config.releaseStore);
  config.s3Workspaces = raw.s3WorkspaceConnection === undefined ? null
    : await (await import('./s3-workspace.mjs')).readS3WorkspaceConfiguration(hostPath(raw.s3WorkspaceConnection, base), { releaseStore: config.releaseStore });
  config.opensearchWorkspaces = raw.opensearchWorkspaceConnection === undefined ? null
    : await (await import('./opensearch-workspace.mjs')).readOpenSearchWorkspaceConfiguration(hostPath(raw.opensearchWorkspaceConnection, base));
  config.sheetsWorkspaces = raw.sheetsWorkspaceConnection === undefined ? null
    : await (await import('./sheets-workspace.mjs')).readSheetsWorkspaceConfiguration(hostPath(raw.sheetsWorkspaceConnection, base));
  config.nocodbWorkspaces = raw.nocodbWorkspaceConnection === undefined ? null
    : await (await import('./nocodb-workspace.mjs')).readNocoDBWorkspaceConfiguration(hostPath(raw.nocodbWorkspaceConnection, base));
  config.ckanWorkspaces = raw.ckanWorkspaceConnection === undefined ? null
    : await (await import('./ckan-workspace.mjs')).readCkanWorkspaceConfiguration(hostPath(raw.ckanWorkspaceConnection, base));
  config.tenderlyWorkspaces = raw.tenderlyWorkspaceConnection === undefined ? null
    : await (await import('./tenderly-workspace.mjs')).readTenderlyWorkspaceConfiguration(hostPath(raw.tenderlyWorkspaceConnection, base));
  config.redisWorkspaces = raw.redisWorkspaceConnection === undefined ? null
    : await (await import('./redis-workspace.mjs')).readRedisWorkspaceConfiguration(hostPath(raw.redisWorkspaceConnection, base), { releaseStore: config.releaseStore });
  config.stellarExpertWorkspaces = raw.stellarExpertWorkspaceConnection === undefined ? null
    : await (await import('./stellar-expert-workspace.mjs')).readStellarExpertWorkspaceConfiguration(hostPath(raw.stellarExpertWorkspaceConnection, base));
  config.coingeckoWorkspaces = raw.coingeckoWorkspaceConnection === undefined ? null
    : await (await import('./coingecko-workspace.mjs')).readCoinGeckoWorkspaceConfiguration(hostPath(raw.coingeckoWorkspaceConnection, base));
  config.grantsWorkspaces = raw.grantsWorkspaceConnection === undefined ? null
    : await (await import('./grantsgov-workspace.mjs')).readGrantsWorkspaceConfiguration(hostPath(raw.grantsWorkspaceConnection, base));
  config.usaSpendingWorkspaces = raw.usaSpendingWorkspaceConnection === undefined ? null
    : await (await import('./usaspending-workspace.mjs')).readUSASpendingWorkspaceConfiguration(hostPath(raw.usaSpendingWorkspaceConnection, base));
  config.researchWorkspaces = raw.researchWorkspaceConnection === undefined ? null
    : await (await import('./research-workspace.mjs')).readResearchWorkspaceConfiguration(hostPath(raw.researchWorkspaceConnection, base));
  config.arcgisWorkspaces = raw.arcgisWorkspaceConnection === undefined ? null
    : await readArcgisWorkspaceConfiguration(hostPath(raw.arcgisWorkspaceConnection, base),
      { publishers: config.publishers, releaseStore: config.releaseStore });
  config.sourceWorkspaces = raw.sourceWorkspaceConnection === undefined ? null
    : await (await import('./source-workspace.mjs')).readSourceWorkspaceConfiguration(hostPath(raw.sourceWorkspaceConnection, base));
  config.clinicalTrialsWorkspaces = raw.clinicalTrialsWorkspaceConnection === undefined ? null
    : await (await import('./clinicaltrials-workspace.mjs')).readClinicalTrialsWorkspaceConfiguration(hostPath(raw.clinicalTrialsWorkspaceConnection, base));
  config.usgsWorkspaces = raw.usgsWorkspaceConnection === undefined ? null
    : await (await import('./usgs-workspace.mjs')).readUSGSWorkspaceConfiguration(hostPath(raw.usgsWorkspaceConnection, base));
  config.baserowWorkspaces = raw.baserowWorkspaceConnection === undefined ? null
    : await (await import('./baserow-workspace.mjs')).readBaserowWorkspaceConfiguration(hostPath(raw.baserowWorkspaceConnection, base));
  config.grpcWorkspaces = raw.grpcWorkspaceConnection === undefined ? null
    : await (await import('./grpc-workspace.mjs')).readGrpcWorkspaceConfiguration(hostPath(raw.grpcWorkspaceConnection, base));
  config.openapiWorkspaces = raw.openapiWorkspaceConnection === undefined ? null
    : await (await import('./openapi-workspace.mjs')).readOpenApiWorkspaceConfiguration(hostPath(raw.openapiWorkspaceConnection, base));
  config.harWorkspaces = raw.harWorkspaceConnection === undefined ? null
    : await (await import('./har-workspace.mjs')).readHarWorkspaceConfiguration(hostPath(raw.harWorkspaceConnection, base));
  config.feedsWorkspaces = raw.feedsWorkspaceConnection === undefined ? null
    : await (await import('./feeds-workspace.mjs')).readFeedsWorkspaceConfiguration(hostPath(raw.feedsWorkspaceConnection, base));
  config.dspaceOperators = raw.dspaceOperatorConnection === undefined ? null
    : await (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/dspace/merchant-provider.mjs')).readDspaceOperatorConfiguration(hostPath(raw.dspaceOperatorConnection, base));
  config.opencageWorkspaces = raw.opencageWorkspaceConnection === undefined ? null
    : await (await import('./opencage-workspace.mjs')).readOpenCageWorkspaceConfiguration(hostPath(raw.opencageWorkspaceConnection, base));
  config.apiPassWorkspaces = raw.apiPassWorkspaceConnection === undefined ? null
    : await (await import('./api-pass-connection.mjs')).readApiPassWorkspaceConfiguration(hostPath(raw.apiPassWorkspaceConnection, base));
  config.fleet = await fleetDefinition(raw.fleet, base, config.releaseStore);
  config.accounting = (raw.accounting == null ? null : (await import('./accounting.mjs')).normalizeAccountingConfig(raw.accounting, base));
  if (!(await lstat(config.exportsDirectory)).isDirectory()) throw failure('CONFIGURATION_ERROR', 'Customer export directory must be a real directory.');
  if (config.stellarExpertWorkspaces || config.arcgisWorkspaces || config.support || config.receiving || config.pythonWorkspaces || config.graphqlWorkspaces || config.s3Workspaces || config.worldbankWorkspaces || config.opensearchWorkspaces || config.socrataWorkspaces || config.odataWorkspaces || config.fiscalDataWorkspaces || config.geocodioWorkspaces || config.webdavWorkspaces || config.edgarWorkspaces || config.sheetsWorkspaces || config.nocodbWorkspaces || config.ckanWorkspaces || config.tenderlyWorkspaces || config.opencageWorkspaces || config.coingeckoWorkspaces || config.redisWorkspaces || config.usaSpendingWorkspaces || config.researchWorkspaces || config.grantsWorkspaces || config.sourceWorkspaces || config.clinicalTrialsWorkspaces || config.baserowWorkspaces || config.usgsWorkspaces || config.feedsWorkspaces || config.dspaceOperators || config.grantWorkspaces || config.grpcWorkspaces || config.openapiWorkspaces || config.harWorkspaces || config.woocommerce || config.cocartWorkspaces || config.mpp || config.buyerExpenses || config.apiPassWorkspaces) await privateSupportDirectory(config.exportsDirectory);
  return config;
}
export async function initializeMerchant({ directory, name = 'Starforge merchant', spec, selections, bindings, workspace, upstreams, python, pythonRoot, duckdbPackage, duckdbPython, datasetPackage, s3Package, postgresPackage, mysqlPackage, jsonrpcPackage, sqlitePackage, sqliteSnapshotMaxBytes, sqliteSnapshotTimeoutMs, clickhousePackage, clickhouseColumnTypes, runtime = {}, catalog, facilitators, fleetPlan, accounting, support, receiving, pythonWorkspaces, graphqlWorkspaces, stellarExpertWorkspaces, sourceWorkspaces, clinicalTrialsWorkspaces, baserowWorkspaces, usgsWorkspaces, feedsWorkspaces, dspaceOperators, grpcWorkspaces, openapiWorkspaces, harWorkspaces, ckanWorkspaces, pricing, woocommerce, cocartWorkspaces, mpp, buyerExpenses, apiPassWorkspaces, releaseStore }) {
  const root = resolve(directory);
  name = line(name, 'Merchant name');
  const source = await sourceDefinition({ label: 'Initial merchant configuration', spec, selections, bindings, workspace, upstreams, python, pythonRoot, duckdbPackage, duckdbPython, datasetPackage, s3Package, postgresPackage, mysqlPackage, jsonrpcPackage, sqlitePackage, sqliteSnapshotMaxBytes, sqliteSnapshotTimeoutMs, clickhousePackage, clickhouseColumnTypes, runtime }, process.cwd(), 'initial');
  if (source.pythonRoot) {
    const sourceRoot = await realpath(source.pythonRoot);
    const destination = join(await realpath(dirname(root)), basename(root));
    const within = relative(sourceRoot, destination);
    if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
      throw failure('CONFIGURATION_ERROR', 'Keep the merchant operator directory outside its selected Python source root.');
  }
  const preview = await inspectMerchantSource(source);
  const catalogConnection = catalog === undefined ? undefined : hostPath(catalog, process.cwd());
  if (catalogConnection) await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-catalog.mjs')).readReleaseCatalogConfig(catalogConnection);
  const facilitatorConnection = facilitators === undefined ? undefined : hostPath(facilitators, process.cwd());
  if (facilitatorConnection) await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-facilitator.mjs')).readFacilitatorProfiles(facilitatorConnection);
  const planFile = fleetPlan === undefined ? undefined : hostPath(fleetPlan, process.cwd());
  if (planFile) await (await import('../../stellar/scf-starforge-20261009/merchant-fleet-gateway/release-operator.mjs')).readFleetReleasePlan(planFile);
  const accountingConfig = accounting === undefined ? null : await (await import('./accounting.mjs')).readAccountingConfig(accounting);
  const supportConnection = support === undefined ? undefined : hostPath(support, process.cwd());
  if (supportConnection) await readSupportConfiguration(supportConnection);
  const receivingConnection = receiving === undefined ? undefined : hostPath(receiving, process.cwd());
  if (receivingConnection) await (await import('./receiving.mjs')).readReceivingConfiguration(receivingConnection);
  const pythonWorkspaceConnection = pythonWorkspaces === undefined ? undefined : hostPath(pythonWorkspaces, process.cwd());
  if (pythonWorkspaceConnection) await (await import('./python-workspace.mjs')).readPythonWorkspaceConfiguration(pythonWorkspaceConnection);
  const stellarExpertWorkspaceConnection = stellarExpertWorkspaces === undefined ? undefined : hostPath(stellarExpertWorkspaces, process.cwd());
  if (stellarExpertWorkspaceConnection) await (await import('./stellar-expert-workspace.mjs')).readStellarExpertWorkspaceConfiguration(stellarExpertWorkspaceConnection);
  const sourceWorkspaceConnection = sourceWorkspaces === undefined ? undefined : hostPath(sourceWorkspaces, process.cwd());
  const baserowWorkspaceConnection = baserowWorkspaces === undefined ? undefined : hostPath(baserowWorkspaces, process.cwd());
  if (baserowWorkspaceConnection) await (await import('./baserow-workspace.mjs')).readBaserowWorkspaceConfiguration(baserowWorkspaceConnection);
  const grpcWorkspaceConnection = grpcWorkspaces === undefined ? undefined : hostPath(grpcWorkspaces, process.cwd());
  if (sourceWorkspaceConnection) await (await import('./source-workspace.mjs')).readSourceWorkspaceConfiguration(sourceWorkspaceConnection);
  const clinicalTrialsWorkspaceConnection = clinicalTrialsWorkspaces === undefined ? undefined : hostPath(clinicalTrialsWorkspaces, process.cwd());
  if (clinicalTrialsWorkspaceConnection) await (await import('./clinicaltrials-workspace.mjs')).readClinicalTrialsWorkspaceConfiguration(clinicalTrialsWorkspaceConnection);
  const usgsWorkspaceConnection = usgsWorkspaces === undefined ? undefined : hostPath(usgsWorkspaces, process.cwd());
  if (usgsWorkspaceConnection) await (await import('./usgs-workspace.mjs')).readUSGSWorkspaceConfiguration(usgsWorkspaceConnection);
  const feedsWorkspaceConnection = feedsWorkspaces === undefined ? undefined : hostPath(feedsWorkspaces, process.cwd());
  if (feedsWorkspaceConnection) await (await import('./feeds-workspace.mjs')).readFeedsWorkspaceConfiguration(feedsWorkspaceConnection);
  const dspaceOperatorConnection = dspaceOperators === undefined ? undefined : hostPath(dspaceOperators, process.cwd());
  if (dspaceOperatorConnection) await (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/dspace/merchant-provider.mjs')).readDspaceOperatorConfiguration(dspaceOperatorConnection);
  if (grpcWorkspaceConnection) await (await import('./grpc-workspace.mjs')).readGrpcWorkspaceConfiguration(grpcWorkspaceConnection);
  const openapiWorkspaceConnection = openapiWorkspaces === undefined ? undefined : hostPath(openapiWorkspaces, process.cwd());
  if (openapiWorkspaceConnection) await (await import('./openapi-workspace.mjs')).readOpenApiWorkspaceConfiguration(openapiWorkspaceConnection);
  const harWorkspaceConnection = harWorkspaces === undefined ? undefined : hostPath(harWorkspaces, process.cwd());
  if (harWorkspaceConnection) await (await import('./har-workspace.mjs')).readHarWorkspaceConfiguration(harWorkspaceConnection);
  const graphqlWorkspaceConnection = graphqlWorkspaces === undefined ? undefined : hostPath(graphqlWorkspaces, process.cwd());
  if (graphqlWorkspaceConnection) await (await import('./graphql-workspace.mjs')).readGraphqlWorkspaceConfiguration(graphqlWorkspaceConnection);
  const ckanWorkspaceConnection = ckanWorkspaces === undefined ? undefined : hostPath(ckanWorkspaces, process.cwd());
  const ckanWorkspaceSelection = ckanWorkspaceConnection ? await (await import('./ckan-workspace.mjs')).readCkanWorkspaceConfiguration(ckanWorkspaceConnection) : null;
  const pricingConnection = pricing === undefined ? undefined : hostPath(pricing, process.cwd());
  if (pricingConnection) await (await import('./pricing.mjs')).readPricingConfiguration(pricingConnection);
  const woocommerceConnection = woocommerce === undefined ? undefined : hostPath(woocommerce, process.cwd());
  if (woocommerceConnection) await (await import('./woocommerce.mjs')).readWooCommerceConfiguration(woocommerceConnection);
  const cocartWorkspaceConnection = cocartWorkspaces === undefined ? undefined : hostPath(cocartWorkspaces, process.cwd());
  if (cocartWorkspaceConnection) await (await import('./cocart-workspace.mjs')).readCocartWorkspaceConfiguration(cocartWorkspaceConnection);
  const mppConnection = mpp === undefined ? undefined : hostPath(mpp, process.cwd());
  if (mppConnection) await (await import('./mpp-config.mjs')).readMppConfiguration(mppConnection);
  const buyerExpenseConnection = buyerExpenses === undefined ? undefined : hostPath(buyerExpenses, process.cwd());
  if (buyerExpenseConnection) await (await import('./buyer-expenses.mjs')).readBuyerExpenseConfiguration(buyerExpenseConnection);
  const apiPassWorkspaceConnection = apiPassWorkspaces === undefined ? undefined : hostPath(apiPassWorkspaces, process.cwd());
  if (apiPassWorkspaceConnection) await (await import('./api-pass-connection.mjs')).readApiPassWorkspaceConfiguration(apiPassWorkspaceConnection);
  const existingReleaseStore = releaseStore === undefined ? undefined : hostPath(releaseStore, process.cwd());
  if (ckanWorkspaceConnection && !existingReleaseStore)
    throw failure('CONFIGURATION_ERROR', 'Attach CKAN with its existing project seller-releases as --release-store, or use init-ckan-workspaces.');
  if (ckanWorkspaceSelection) {
    const selectedStore = await realpath(existingReleaseStore);
    const originalStores = await Promise.all(Object.values(ckanWorkspaceSelection.workspaces)
      .map(async entry => join(await realpath(entry.directory), 'seller-releases')));
    if (!originalStores.includes(selectedStore))
      throw failure('CONFIGURATION_ERROR', 'CKAN --release-store must be an original seller-releases store belonging to a configured CKAN project.');
  }
  if (existingReleaseStore) await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).readReleaseState(existingReleaseStore);
  await mkdir(root, { mode: 0o700 });
  if (!existingReleaseStore) await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const path = join(root, 'merchant-mcp.json');
  await writePrivate(path, { schema: CONFIG_SCHEMA, name,
    releaseStore: existingReleaseStore ?? './releases', exportsDirectory: './customer-exports',
    ...(catalogConnection ? { catalogConnection } : {}),
    ...(facilitatorConnection ? { facilitatorConnection } : {}),
    ...(accountingConfig ? { accounting: accountingConfig } : {}),
    ...(supportConnection ? { supportConnection } : {}),
    ...(receivingConnection ? { receivingConnection } : {}),
    ...(pythonWorkspaceConnection ? { pythonWorkspaceConnection } : {}),
    ...(stellarExpertWorkspaceConnection ? { stellarExpertWorkspaceConnection } : {}),
    ...(sourceWorkspaceConnection ? { sourceWorkspaceConnection } : {}),
    ...(clinicalTrialsWorkspaceConnection ? { clinicalTrialsWorkspaceConnection } : {}),
    ...(baserowWorkspaceConnection ? { baserowWorkspaceConnection } : {}),
    ...(usgsWorkspaceConnection ? { usgsWorkspaceConnection } : {}),
    ...(feedsWorkspaceConnection ? { feedsWorkspaceConnection } : {}),
    ...(dspaceOperatorConnection ? { dspaceOperatorConnection } : {}),
    ...(grpcWorkspaceConnection ? { grpcWorkspaceConnection } : {}),
    ...(openapiWorkspaceConnection ? { openapiWorkspaceConnection } : {}),
    ...(harWorkspaceConnection ? { harWorkspaceConnection } : {}),
    ...(graphqlWorkspaceConnection ? { graphqlWorkspaceConnection } : {}),
    ...(ckanWorkspaceConnection ? { ckanWorkspaceConnection } : {}),
    ...(pricingConnection ? { pricingConnection } : {}),
    ...(woocommerceConnection ? { woocommerceConnection } : {}),
    ...(cocartWorkspaceConnection ? { cocartWorkspaceConnection } : {}),
    ...(mppConnection ? { mppConnection } : {}),
    ...(buyerExpenseConnection ? { buyerExpenseConnection } : {}),
    ...(apiPassWorkspaceConnection ? { apiPassWorkspaceConnection } : {}),
    ...(planFile ? { fleet: { planFile, directory: './fleet' } } : {}), sources: {
      initial: { label: source.label, runtime: source.runtime,
        ...(source.datasetPackage ? { datasetPackage: source.datasetPackage }
          : source.clickhousePackage ? { clickhousePackage: source.clickhousePackage,
          ...(source.clickhouseColumnTypes === undefined ? {} : { clickhouseColumnTypes: source.clickhouseColumnTypes }) }
          : source.postgresPackage ? { postgresPackage: source.postgresPackage }
          : source.mysqlPackage ? { mysqlPackage: source.mysqlPackage }
          : source.sqlitePackage ? { sqlitePackage: source.sqlitePackage, sqliteSnapshotMaxBytes: source.sqliteSnapshotMaxBytes,
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
    catalogConfigured: Boolean(catalogConnection), facilitatorsConfigured: Boolean(facilitatorConnection), fleetConfigured: Boolean(planFile), accountingConfigured: Boolean(accountingConfig), supportConfigured: Boolean(supportConnection), receivingConfigured: Boolean(receivingConnection), pythonWorkspacesConfigured: Boolean(pythonWorkspaceConnection), graphqlWorkspacesConfigured: Boolean(graphqlWorkspaceConnection), stellarExpertWorkspacesConfigured: Boolean(stellarExpertWorkspaceConnection), sourceWorkspacesConfigured: Boolean(sourceWorkspaceConnection), clinicalTrialsWorkspacesConfigured: Boolean(clinicalTrialsWorkspaceConnection), baserowWorkspacesConfigured: Boolean(baserowWorkspaceConnection), usgsWorkspacesConfigured: Boolean(usgsWorkspaceConnection), feedsWorkspacesConfigured: Boolean(feedsWorkspaceConnection), dspaceOperatorsConfigured: Boolean(dspaceOperatorConnection), grpcWorkspacesConfigured: Boolean(grpcWorkspaceConnection), openapiWorkspacesConfigured: Boolean(openapiWorkspaceConnection), harWorkspacesConfigured: Boolean(harWorkspaceConnection), ckanWorkspacesConfigured: Boolean(ckanWorkspaceConnection), pricingConfigured: Boolean(pricingConnection), woocommerceConfigured: Boolean(woocommerceConnection), cocartWorkspacesConfigured: Boolean(cocartWorkspaceConnection), mppConfigured: Boolean(mppConnection), buyerExpensesConfigured: Boolean(buyerExpenseConnection), apiPassWorkspacesConfigured: Boolean(apiPassWorkspaceConnection),
    sourceType: preview.sourceType, sourceDigests: preview.sourceDigests, inputPackage: preview.inputPackage,
    environment: preview.environment, credentialValuesChecked: false };
}

/** Bind saved original pricing work to the same explicitly selected release store. */
export async function initializePricingMerchant({ directory, pricing, releaseStore, name = 'Starforge merchant pricing' }) {
  const root = resolve(directory), pricingConnection = hostPath(pricing, process.cwd());
  const configured = await (await import('./pricing.mjs')).readPricingConfiguration(pricingConnection), stores = new Set();
  for (const value of Object.values(configured.workspaces)) if (value.releaseStore) stores.add(await realpath(value.releaseStore));
  let selected = releaseStore === undefined ? null : await realpath(hostPath(releaseStore, process.cwd()));
  if (selected === null && stores.size === 1) selected = [...stores][0];
  if (selected === null)
    throw failure('CONFIGURATION_ERROR', 'Select an existing original --release-store when pricing aliases have multiple stores or no staging store.');
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).readReleaseState(selected);
  name = line(name, 'Merchant name');
  await mkdir(root, { mode: 0o700 });
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const path = join(root, 'merchant-mcp.json');
  await writePrivate(path, { schema: CONFIG_SCHEMA, name, releaseStore: selected,
    exportsDirectory: './customer-exports', sources: {}, pricingConnection });
  await readMerchantConfig(path);
  return { schema: CONFIG_SCHEMA, configuration: path, state: 'INITIALIZED', pricingConfigured: true,
    workspaces: Object.keys(configured.workspaces), releaseStore: selected };
}

/** Configure the same provider for an existing fleet without an individual source. */
export async function initializeFleetMerchant({ directory, planFile, fleetDirectory, name = 'Starforge merchant fleet', accounting }) {
  const root = resolve(directory);
  name = line(name, 'Merchant fleet name');
  planFile = hostPath(planFile, process.cwd());
  const plan = await (await import('../../stellar/scf-starforge-20261009/merchant-fleet-gateway/release-operator.mjs')).readFleetReleasePlan(planFile);
  const fleet = { planFile, directory: fleetDirectory === undefined ? './fleet' : hostPath(fleetDirectory, process.cwd()) };
  const accountingConfig = accounting === undefined ? null : await (await import('./accounting.mjs')).readAccountingConfig(accounting);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
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

/** Attach the same host to original buyer expense work without creating a seller. */
export async function initializeBuyerExpenseMerchant({ directory, connection, name = 'Starforge buyer expenses' }) {
  const root = resolve(directory), buyerExpenseConnection = hostPath(connection, process.cwd());
  name = line(name, 'Buyer expense operator name');
  const selected = await (await import('./buyer-expenses.mjs')).readBuyerExpenseConfiguration(buyerExpenseConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, buyerExpenseConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED',
    buyerExpenseWorkspaces: Object.keys(selected.workspaces), buyerExpenses: 'OPENED_ONLY_BY_EXPLICIT_TOOL' };
}

/** Use the original grant application and workspace authority through this merchant. */
export async function initializeGrantWorkspaceMerchant({ directory, connection, name = 'Starforge grant planning and delivery' }) {
  const root = resolve(directory), grantWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Grant operator name');
  const selected = await (await import('./grant-workspace.mjs')).readGrantWorkspaceConfiguration(grantWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, grantWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED',
    grantWorkspaces: Object.entries(selected.workspaces).map(([workspace, binding]) => ({
      workspace, label: binding.label, selectionSha256: binding.selectionSha256, allowStart: binding.allowStart })),
    grantApplication: 'OPENED_ONLY_BY_EXPLICIT_TOOL' };
}

/** Use the same merchant provider for existing accounting sources, without staging a seller. */
export async function initializeAccountingMerchant({ directory, accounting, name = 'Starforge merchant accounting' }) {
  const root = resolve(directory), accountingConfig = await (await import('./accounting.mjs')).readAccountingConfig(accounting);
  name = line(name, 'Merchant accounting name');
  if (!accountingConfig || !Object.keys(accountingConfig.workspaces).length)
    throw failure('CONFIGURATION_ERROR', 'Declare at least one original accounting workspace.');
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, accounting: accountingConfig });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED',
    accountingWorkspaces: Object.keys(accountingConfig.workspaces), accounting: 'OPENED_ONLY_BY_EXPLICIT_TOOL' };
}

/** Open the same provider for retained receiving work before a seller is deployed. */
export async function initializeReceivingMerchant({ directory, receiving, name = 'Starforge receiving' }) {
  const root = resolve(directory), receivingConnection = hostPath(receiving, process.cwd());
  name = line(name, 'Merchant name');
  await (await import('./receiving.mjs')).readReceivingConfiguration(receivingConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, receivingConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', receivingConfigured: true };
}

/** Attach the same provider to existing saved Python authoring workspaces. */
export async function initializePythonWorkspaceMerchant({ directory, pythonWorkspaces, name = 'Starforge Python authoring' }) {
  const root = resolve(directory), pythonWorkspaceConnection = hostPath(pythonWorkspaces, process.cwd());
  name = line(name, 'Merchant name');
  const connection = await (await import('./python-workspace.mjs')).readPythonWorkspaceConfiguration(pythonWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, pythonWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED',
    pythonWorkspaces: Object.keys(connection.workspaces), python: 'OPENED_ONLY_BY_EXPLICIT_TOOL' };
}

/** Configure the same MCP provider for retained data authoring and maintenance. */
export async function initializePublisherMerchant({ directory, connection, arcgisWorkspaces, releaseStore,
  name = 'Starforge data publisher' }) {
  const root = resolve(directory);
  name = line(name, 'Merchant publisher name');
  const publisherConnection = hostPath(connection, process.cwd());
  const publishers = await readPublisherConfiguration(publisherConnection);
  const selectedStore = releaseStore === undefined ? join(root, 'releases') : hostPath(releaseStore, process.cwd());
  if (releaseStore !== undefined) await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).readReleaseState(selectedStore);
  const arcgisWorkspaceConnection = arcgisWorkspaces === undefined ? undefined : hostPath(arcgisWorkspaces, process.cwd());
  const arcgis = arcgisWorkspaceConnection ? await readArcgisWorkspaceConfiguration(arcgisWorkspaceConnection,
    { publishers, releaseStore: selectedStore }) : null;
  await mkdir(root, { mode: 0o700 });
  if (releaseStore === undefined) await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(selectedStore);
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: selectedStore,
    exportsDirectory: './customer-exports', sources: {}, publisherConnection,
    ...(arcgisWorkspaceConnection ? { arcgisWorkspaceConnection } : {}) });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', publishersConfigured: true,
    arcgisWorkspacesConfigured: Boolean(arcgis),
    ...(arcgis ? { arcgisWorkspaces: Object.entries(arcgis.workspaces).map(([workspace, entry]) =>
      ({ workspace, label: entry.label, publisher: entry.publisher })) } : {}),
    publishers: Object.entries(publishers.workspaces).map(([publisher, entry]) =>
      ({ publisher, label: entry.label, kind: entry.kind, buyerConfigured: Boolean(entry.seller) })) };
}
/** Configure full ArcGIS authoring on the same retained publisher and release owner. */
export async function initializeArcgisWorkspaceMerchant({ directory, publishers, connection, releaseStore,
  name = 'Starforge ArcGIS merchant' }) {
  if (!publishers || !connection) throw failure('CONFIGURATION_ERROR', 'Supply the publisher and ArcGIS connection files.');
  return initializePublisherMerchant({ directory, connection: publishers, arcgisWorkspaces: connection, releaseStore, name });
}

/** Attach retained OpenSearch queries and relevance to the original merchant operator. */
export async function initializeOpenSearchWorkspaceMerchant({ directory, connection, releaseStore, name = 'Starforge OpenSearch merchant' }) {
  const root = resolve(directory), opensearchWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selection = await (await import('./opensearch-workspace.mjs')).readOpenSearchWorkspaceConfiguration(opensearchWorkspaceConnection);
  const existingStore = releaseStore === undefined ? null : hostPath(releaseStore, process.cwd());
  if (existingStore) await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).readReleaseState(existingStore);
  await mkdir(root, { mode: 0o700 });
  const selectedStore = existingStore ?? join(root, 'releases');
  if (!existingStore) await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(selectedStore);
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: selectedStore,
    exportsDirectory: './customer-exports', sources: {}, opensearchWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', opensearchWorkspacesConfigured: true,
    workspaces: Object.entries(selection.workspaces).map(([workspace, entry]) => ({ workspace, label: entry.label })),
    authoring: 'OPENED_BY_MERCHANT_OPENSEARCH_OPEN', existingReleaseStore: Boolean(existingStore) };
}

/** Join original S3 authoring and the existing merchant lifecycle in one provider. */
export async function initializeS3WorkspaceMerchant({ directory, connection, name = 'Starforge S3 merchant' }) {
  const root = resolve(directory), s3WorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selection = await (await import('./s3-workspace.mjs')).readS3WorkspaceConfiguration(s3WorkspaceConnection);
  if (selection.releaseStore) await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).readReleaseState(selection.releaseStore);
  await mkdir(root, { mode: 0o700 });
  const releaseStore = selection.releaseStore ?? join(root, 'releases');
  if (!selection.releaseStore) await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(releaseStore);
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore,
    exportsDirectory: './customer-exports', sources: {}, s3WorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', s3WorkspacesConfigured: true,
    workspaces: Object.entries(selection.workspaces).map(([workspace, entry]) => ({ workspace, label: entry.label })),
    authoring: 'OPENED_BY_MERCHANT_S3_OPEN' };
}

/** Attach the original Sheets source model and browser to this same merchant operator. */
export async function initializeSheetsWorkspaceMerchant({ directory, connection, name = 'Starforge Sheets authoring' }) {
  const root = resolve(directory), sheetsWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selection = await (await import('./sheets-workspace.mjs')).readSheetsWorkspaceConfiguration(sheetsWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, sheetsWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', sheetsWorkspacesConfigured: true,
    workspaces: Object.entries(selection.workspaces).map(([workspace, entry]) => ({ workspace, label: entry.label })),
    authoring: 'OPENED_BY_MERCHANT_SHEETS_OPEN' };
}


/** Initialize MCP access to the existing original NocoDB authoring workspace. */
export async function initializeNocoDBWorkspaceMerchant({ directory, connection, name = 'Starforge NocoDB authoring' }) {
  const root = resolve(directory), nocodbWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selection = await (await import('./nocodb-workspace.mjs')).readNocoDBWorkspaceConfiguration(nocodbWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, nocodbWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', nocodbWorkspacesConfigured: true,
    workspaces: Object.entries(selection.workspaces).map(([workspace, entry]) => ({ workspace, label: entry.label })),
    authoring: 'OPENED_BY_MERCHANT_NOCODB_OPEN' };
}

/** Initialize a merchant MCP around original host-declared Tenderly operator workspaces. */
export async function initializeTenderlyWorkspaceMerchant({ directory, connection, name = 'Starforge Tenderly merchant' }) {
  const root = resolve(directory), tenderlyWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selection = await (await import('./tenderly-workspace.mjs')).readTenderlyWorkspaceConfiguration(tenderlyWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, tenderlyWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', tenderlyWorkspacesConfigured: true,
    workspaces: Object.entries(selection.workspaces).map(([workspace, entry]) => ({ workspace, label: entry.label })),
    authoring: 'OPENED_BY_MERCHANT_TENDERLY_OPEN' };
}


/** Connect the complete original Grants.gov workspace and receiving tools. */
export async function initializeGrantsWorkspaceMerchant({ directory, connection, name = 'Starforge grant opportunity research' }) {
  const root = resolve(directory), grantsWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selection = await (await import('./grantsgov-workspace.mjs')).readGrantsWorkspaceConfiguration(grantsWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, grantsWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', grantsWorkspacesConfigured: true,
    workspaces: Object.entries(selection.workspaces).map(([workspace, entry]) => ({ workspace, label: entry.label })),
    authoring: 'OPENED_BY_MERCHANT_GRANTS_OPEN' };
}

/** Initialize the merchant MCP around original federal award research and dossier workspaces. */
export async function initializeUSASpendingWorkspaceMerchant({ directory, connection, name = 'Starforge federal research merchant' }) {
  const root = resolve(directory), usaSpendingWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selection = await (await import('./usaspending-workspace.mjs')).readUSASpendingWorkspaceConfiguration(usaSpendingWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, usaSpendingWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', usaSpendingWorkspacesConfigured: true,
    workspaces: Object.entries(selection.workspaces).map(([workspace, entry]) => ({ workspace, label: entry.label })),
    authoring: 'OPENED_BY_MERCHANT_USASPENDING_OPEN' };
}

/** Attach the existing authenticated Research application to the original merchant. */
export async function initializeResearchWorkspaceMerchant({directory,connection,name='Starforge research merchant'}){
  const root=resolve(directory),researchWorkspaceConnection=hostPath(connection,process.cwd());
  name=line(name,'Merchant name');
  const selection=await (await import('./research-workspace.mjs')).readResearchWorkspaceConfiguration(researchWorkspaceConnection);
  await mkdir(root,{mode:0o700});
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root,'releases'));
  await mkdir(join(root,'customer-exports'),{mode:0o700});
  const configuration=join(root,'merchant-mcp.json');
  await writePrivate(configuration,{schema:CONFIG_SCHEMA,name,releaseStore:'./releases',
    exportsDirectory:'./customer-exports',sources:{},researchWorkspaceConnection});
  await readMerchantConfig(configuration);
  return {schema:CONFIG_SCHEMA,configuration,state:'INITIALIZED',researchWorkspacesConfigured:true,
    workspaces:Object.entries(selection.workspaces).map(([workspace,entry])=>({workspace,label:entry.label})),
    attachment:'MERCHANT_RESEARCH_ATTACH',listenerOwnership:'ORIGINAL_APPLICATIONS_WORKSPACE'};
}

/** Attach the existing retained source consoles to the same MCP provider. */
/** Attach the existing ClinicalTrials console and retain its original Python workspace owner. */
export async function initializeClinicalTrialsWorkspaceMerchant({ directory, connection, name = 'Starforge ClinicalTrials workspaces' }) {
  const root = resolve(directory), clinicalTrialsWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const configured = await (await import('./clinicaltrials-workspace.mjs')).readClinicalTrialsWorkspaceConfiguration(clinicalTrialsWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, clinicalTrialsWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', clinicalTrialsWorkspacesConfigured: true,
    workspaces: Object.entries(configured.workspaces).map(([workspace, value]) => ({ workspace, label: value.label })),
    ownership: 'EXISTING_CLINICALTRIALS_CONSOLE' };
}

export async function initializeSourceWorkspaceMerchant({ directory, connection, name = 'Starforge source workspaces' }) {
  const root = resolve(directory), sourceWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const configured = await (await import('./source-workspace.mjs')).readSourceWorkspaceConfiguration(sourceWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, sourceWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', sourceWorkspacesConfigured: true,
    workspaces: Object.entries(configured.workspaces).map(([workspace, value]) => ({ workspace, label: value.label, format: value.format })),
    ownership: 'EXISTING_SOURCE_CONSOLE' };
}


/** Attach existing OpenAPI/HAR consoles to this original merchant MCP provider. */
export async function initializeOpenApiWorkspaceMerchant({ directory, connection, name = 'Starforge OpenAPI merchant', releaseStore }) {
  const root = resolve(directory), openapiWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const configured = await (await import('./openapi-workspace.mjs')).readOpenApiWorkspaceConfiguration(openapiWorkspaceConnection);
  const selectedStore = releaseStore === undefined ? join(root, 'releases') : hostPath(releaseStore, process.cwd());
  if (releaseStore !== undefined) await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).readReleaseState(selectedStore);
  await mkdir(root, { mode: 0o700 });
  if (releaseStore === undefined) await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(selectedStore);
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: selectedStore,
    exportsDirectory: './customer-exports', sources: {}, openapiWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', openapiWorkspacesConfigured: true,
    workspaces: Object.entries(configured.workspaces).map(([workspace, value]) => ({ workspace, label: value.label })),
    ownership: 'ORIGINAL_SF61_CONSOLE' };
}

/** Attach original gRPC consoles to the existing merchant MCP provider. */
export async function initializeGrpcWorkspaceMerchant({ directory, connection, name = 'Starforge gRPC workspaces' }) {
  const root = resolve(directory), grpcWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const configured = await (await import('./grpc-workspace.mjs')).readGrpcWorkspaceConfiguration(grpcWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, grpcWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', grpcWorkspacesConfigured: true,
    workspaces: Object.entries(configured.workspaces).map(([workspace, value]) => ({ workspace, label: value.label })),
    ownership: 'ORIGINAL_GRPC_WORKSPACE' };
}

/** Attach original CoCart customer workspaces to the shared merchant provider. */
export async function initializeCocartWorkspaceMerchant({ directory, connection, name = 'Starforge CoCart merchant' }) {
  const root = resolve(directory), cocartWorkspaceConnection = hostPath(connection, process.cwd());
  const configured = await (await import('./cocart-workspace.mjs')).readCocartWorkspaceConfiguration(cocartWorkspaceConnection);
  name = line(name, 'Merchant name');
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, cocartWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED',
    workspaces: Object.entries(configured.workspaces).map(([workspace, row]) => ({ workspace, label: row.label })),
    ownership: 'ORIGINAL_COCART_WORKSPACE' };
}

/** Attach existing Woo stores to the original provider without a separate seller. */
export async function initializeWooCommerceMerchant({ directory, connection, name = 'Starforge Woo merchant' }) {
  const root = resolve(directory), woocommerceConnection = hostPath(connection, process.cwd());
  const configured = await (await import('./woocommerce.mjs')).readWooCommerceConfiguration(woocommerceConnection);
  name = line(name, 'Merchant name');
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, woocommerceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED',
    woocommerceStores: Object.keys(configured.stores), credentials: 'RESOLVED_BY_EXPLICIT_NATIVE_OPERATION' };
}


/** Bind CKAN authoring and merchant release controls to the same original project store. */
export async function initializeCkanWorkspaceMerchant({ directory, connection, workspace, name = 'Starforge CKAN authoring' }) {
  const root = resolve(directory), ckanWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selection = await (await import('./ckan-workspace.mjs')).readCkanWorkspaceConfiguration(ckanWorkspaceConnection);
  const aliases = Object.keys(selection.workspaces);
  const selected = workspace === undefined && aliases.length === 1 ? aliases[0] : workspace;
  if (typeof selected !== 'string' || !Object.hasOwn(selection.workspaces, selected))
    throw failure('CONFIGURATION_ERROR', 'Choose --workspace from the configured CKAN aliases when the connection has more than one workspace.');
  identifier(selected, 'CKAN workspace alias');
  const releaseStore = join(await realpath(selection.workspaces[selected].directory), 'seller-releases');
  await mkdir(root, { mode: 0o700 });
  try { await lstat(releaseStore); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(releaseStore); }
    catch (created) { if (created.code !== 'EEXIST') throw created; }
  }
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).readReleaseState(releaseStore);
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore,
    exportsDirectory: './customer-exports', sources: {}, ckanWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', ckanWorkspacesConfigured: true,
    workspace: selected, releaseStore,
    workspaces: Object.entries(selection.workspaces).map(([workspace, entry]) => ({ workspace, label: entry.label })),
    authoring: 'OPENED_BY_MERCHANT_CKAN_OPEN' };
}

/** Bind the original Redis browser, agent and merchant controls to one saved release store. */
export async function initializeRedisWorkspaceMerchant({ directory, connection, workspace, name = 'Starforge Redis merchant' }) {
  const root = resolve(directory), redisWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selection = await (await import('./redis-workspace.mjs')).readRedisWorkspaceConfiguration(redisWorkspaceConnection);
  const aliases = Object.keys(selection.workspaces);
  const selected = workspace === undefined && aliases.length === 1 ? aliases[0] : workspace;
  if (typeof selected !== 'string' || !Object.hasOwn(selection.workspaces, selected))
    throw failure('CONFIGURATION_ERROR', 'Choose --workspace from the configured Redis aliases when more than one workspace is declared.');
  const { openRedisAuthoringWorkspace } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/model.mjs');
  const binding = selection.workspaces[selected];
  const original = await openRedisAuthoringWorkspace(binding.directory, { expectedWorkspaceId: binding.workspaceId, expectedProfileSha256: binding.profileSha256 });
  let releaseStore;
  try { releaseStore = await original.ensureReleaseStore(); }
  finally { await original.close(); }
  await mkdir(root, { mode: 0o700 });
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore,
    exportsDirectory: './customer-exports', sources: {}, redisWorkspaceConnection });
  const configured = await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', redisWorkspacesConfigured: true,
    workspace: selected, releaseStore,
    workspaces: Object.entries(configured.redisWorkspaces.workspaces).map(([workspace, entry]) =>
      ({ workspace, label: entry.label, workspaceId: entry.workspaceId, profileSha256: entry.profileSha256, releaseBound: entry.releaseBound })) };
}

/** Connect original Socrata source, publisher and customer workspaces to this MCP. */
export async function initializeSocrataWorkspaceMerchant({ directory, connection, name = 'Starforge Socrata operator' }) {
  const root = resolve(directory), socrataWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selected = await (await import('./socrata-workspace.mjs')).readSocrataWorkspaceConfiguration(socrataWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, socrataWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', socrataWorkspacesConfigured: true,
    workspaces: Object.entries(selected.workspaces).map(([workspace, item]) => ({ workspace, label: item.label })),
    authoring: 'OPENED_BY_MERCHANT_SOCRATA_OPEN' };
}

/** Connect the original OData source, dataset merchant and live customer workspace. */
export async function initializeODataWorkspaceMerchant({ directory, connection, name = 'Starforge OData operator' }) {
  const root = resolve(directory), odataWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selected = await (await import('./odata-workspace.mjs')).readODataWorkspaceConfiguration(odataWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, odataWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', odataWorkspacesConfigured: true,
    workspaces: Object.entries(selected.workspaces).map(([workspace, item]) => ({ workspace, label: item.label })),
    authoring: 'OPENED_BY_MERCHANT_ODATA_OPEN' };
}

/** Connect original WebDAV source, publisher and customer workspaces to this MCP. */
export async function initializeWebDavWorkspaceMerchant({ directory, connection, name = 'Starforge WebDAV operator' }) {
  const root = resolve(directory), webdavWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selected = await (await import('./webdav-tools.mjs')).readWebDavWorkspaceConfiguration(webdavWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, webdavWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', webdavWorkspacesConfigured: true,
    workspaces: Object.entries(selected.workspaces).map(([workspace, item]) => ({ workspace, label: item.label })),
    authoring: 'OPENED_BY_MERCHANT_WEBDAV_OPEN' };
}

/** Connect original Geocodio source, publisher and customer workspaces to this MCP. */
export async function initializeGeocodioWorkspaceMerchant({ directory, connection, name = 'Starforge Geocodio operator' }) {
  const root = resolve(directory), geocodioWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selected = await (await import('./geocodio-workspace.mjs')).readGeocodioWorkspaceConfiguration(geocodioWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, geocodioWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', geocodioWorkspacesConfigured: true,
    workspaces: Object.entries(selected.workspaces).map(([workspace, item]) => ({ workspace, label: item.label })),
    authoring: 'OPENED_BY_MERCHANT_GEOCODIO_OPEN' };
}


/** Attach original captured API consoles to the existing merchant provider. */
export async function initializeHarWorkspaceMerchant({directory,connection,openapiWorkspaces,name='Starforge HAR workspaces'}) {
  const root=resolve(directory),harWorkspaceConnection=hostPath(connection,process.cwd());
  name=line(name,'Merchant name');
  const configured=await (await import('./har-workspace.mjs')).readHarWorkspaceConfiguration(harWorkspaceConnection);
  const openapiWorkspaceConnection=openapiWorkspaces===undefined?undefined:hostPath(openapiWorkspaces,process.cwd());
  if(openapiWorkspaceConnection)await (await import('./openapi-workspace.mjs')).readOpenApiWorkspaceConfiguration(openapiWorkspaceConnection);
  await mkdir(root,{mode:0o700});
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root,'releases'));
  await mkdir(join(root,'customer-exports'),{mode:0o700});
  const configuration=join(root,'merchant-mcp.json');
  await writePrivate(configuration,{schema:CONFIG_SCHEMA,name,releaseStore:'./releases',
    exportsDirectory:'./customer-exports',sources:{},harWorkspaceConnection,
    ...(openapiWorkspaceConnection?{openapiWorkspaceConnection}:{})});
  await readMerchantConfig(configuration);
  return {schema:CONFIG_SCHEMA,configuration,state:'INITIALIZED',harWorkspacesConfigured:true,
    openapiWorkspacesConfigured:Boolean(openapiWorkspaceConnection),
    workspaces:Object.entries(configured.workspaces).map(([workspace,v])=>({workspace,label:v.label})),
    ownership:'EXISTING_SF61_MERCHANT_CONSOLE'};
}

/** Attach original native MPP consoles without taking another workspace lease. */
export async function initializeMppMerchant({ directory, connection, name = 'Starforge native MPP' }) {
  const root = resolve(directory), mppConnection = hostPath(connection, process.cwd());
  const configured = await (await import('./mpp-config.mjs')).readMppConfiguration(mppConnection);
  name = line(name, 'Merchant name');
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, mppConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED',
    mppConsoles: Object.keys(configured.consoles), consoleOwnership: 'ORIGINAL_HOST' };
}


/** Attach the original saved GraphQL authoring and native release workflow. */
export async function initializeGraphqlWorkspaceMerchant({ directory, connection, name = 'Starforge GraphQL authoring' }) {
  const root = resolve(directory), graphqlWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selection = await (await import('./graphql-workspace.mjs')).readGraphqlWorkspaceConfiguration(graphqlWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, graphqlWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', graphqlWorkspacesConfigured: true,
    workspaces: Object.entries(selection.workspaces).map(([workspace, value]) => ({ workspace, label: value.label })),
    authoring: 'OPENED_BY_MERCHANT_GRAPHQL_OPEN' };
}

/** Connect original SEC source, merchant and complete buyer exports to this MCP. */
export async function initializeEdgarWorkspaceMerchant({ directory, connection, name = 'Starforge SEC EDGAR operator' }) {
  const root = resolve(directory), edgarWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selected = await (await import('./sec-edgar-tools.mjs')).readEdgarWorkspaceConfiguration(edgarWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, edgarWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', edgarWorkspacesConfigured: true,
    workspaces: Object.entries(selected.workspaces).map(([workspace, entry]) => ({ workspace, label: entry.label })),
    authoring: 'OPENED_BY_MERCHANT_EDGAR_OPEN' };
}

/** Initialize the existing merchant MCP around original CoinGecko browser/research workspaces. */
export async function initializeCoinGeckoWorkspaceMerchant({ directory, connection, name = 'Starforge CoinGecko research' }) {
  const root = resolve(directory), coingeckoWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selection = await (await import('./coingecko-workspace.mjs')).readCoinGeckoWorkspaceConfiguration(coingeckoWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, coingeckoWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', coingeckoWorkspacesConfigured: true,
    workspaces: Object.entries(selection.workspaces).map(([workspace, entry]) => ({ workspace, label: entry.label })),
    authoring: 'OPENED_BY_MERCHANT_COINGECKO_OPEN' };
}

/** Connect the original Fiscal source/review/publisher workspace to this Merchant host. */
export async function initializeFiscalDataWorkspaceMerchant({ directory, connection, name = 'Starforge Fiscal Data operator' }) {
  const root = resolve(directory), fiscalDataWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selected = await (await import('./fiscaldata-workspace.mjs')).readFiscalDataWorkspaceConfiguration(fiscalDataWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, fiscalDataWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', fiscalDataWorkspacesConfigured: true,
    operator: selected.operator,
    workspaces: Object.entries(selected.workspaces).map(([workspace, item]) => ({ workspace, label: item.label })),
    authoring: 'OPENED_BY_MERCHANT_FISCALDATA_OPEN' };
}

/** Connect the original World Bank model and borrowed browser to this MCP host. */
export async function initializeWorldBankWorkspaceMerchant({ directory, connection, name = 'Starforge World Bank operator' }) {
  const root = resolve(directory), worldbankWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selected = await (await import('./worldbank-workspace.mjs')).readWorldBankWorkspaceConfiguration(worldbankWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, worldbankWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', worldbankWorkspacesConfigured: true,
    workspaces: Object.entries(selected.workspaces).map(([workspace,item]) => ({workspace,label:item.label})),
    authoring: 'OPENED_BY_MERCHANT_WORLDBANK_OPEN' };
}


/** Attach the original RSS/Atom/OPML console and native merchant/customer workflow. */
export async function initializeFeedsWorkspaceMerchant({ directory, connection, name = 'Starforge feed collections' }) {
  const root = resolve(directory), feedsWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const configured = await (await import('./feeds-workspace.mjs')).readFeedsWorkspaceConfiguration(feedsWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, feedsWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', feedsWorkspacesConfigured: true,
    workspaces: Object.entries(configured.workspaces).map(([workspace, entry]) => ({ workspace, label: entry.label })),
    ownership: 'EXISTING_FEED_CONSOLE' };
}

/** Connect the original OpenCage workspaces to this merchant MCP atomically. */
export async function initializeOpenCageWorkspaceMerchant({ directory, connection, name = 'Starforge OpenCage operator' }) {
  const root = resolve(directory), opencageWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selected = await (await import('./opencage-workspace.mjs')).readOpenCageWorkspaceConfiguration(opencageWorkspaceConnection);
  const configuration = join(root, 'merchant-mcp.json');
  const raw = { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, opencageWorkspaceConnection };
  const complete = async reused => {
    await readMerchantConfig(configuration);
    return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', reused,
      opencageWorkspacesConfigured: true,
      workspaces: Object.entries(selected.workspaces).map(([workspace, item]) => ({ workspace, label: item.label })),
      authoring: 'OPENED_BY_MERCHANT_OPENCAGE_OPEN' };
  };
  try {
    await lstat(root);
    if (await realpath(root) !== root) throw failure('CONFIGURATION_ERROR', 'Use the canonical original MCP directory.');
    const prior = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fileBytes(configuration, 1048576)));
    if (Object.keys(prior).length !== Object.keys(raw).length || Object.keys(raw).some(key => JSON.stringify(prior[key]) !== JSON.stringify(raw[key])))
      throw failure('CONFIGURATION_ERROR', 'The selected MCP directory contains a different configuration.');
    return complete(true);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (await realpath(dirname(root)) !== dirname(root))
    throw failure('CONFIGURATION_ERROR', 'Use the canonical parent of the new private MCP directory.');
  const { mkdtemp, rename, rm } = await import('node:fs/promises');
  const temporary = await mkdtemp(join(dirname(root), '.opencage-mcp-'));
  try {
    await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(temporary, 'releases'));
    await mkdir(join(temporary, 'customer-exports'), { mode: 0o700 });
    await writePrivate(join(temporary, 'merchant-mcp.json'), raw);
    await readMerchantConfig(join(temporary, 'merchant-mcp.json'));
    await rename(temporary, root);
    const parent = await open(dirname(root), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
    return complete(false);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

/** Attach original Water projects and native DSS receiving to the maintained merchant. */
export async function initializeUSGSWorkspaceMerchant({ directory, connection, name = 'Starforge USGS water' }) {
  const root = resolve(directory), usgsWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const configured = await (await import('./usgs-workspace.mjs')).readUSGSWorkspaceConfiguration(usgsWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, usgsWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', usgsWorkspacesConfigured: true,
    workspaces: Object.entries(configured.workspaces).map(([workspace, value]) => ({ workspace, label: value.label })),
    ownership: 'ORIGINAL_WATER_WORKSPACE' };
}
/** Attach original Baserow source browsers, publishers and retained customer files. */
export async function initializeBaserowWorkspaceMerchant({ directory, connection, name = 'Starforge Baserow merchant' }) {
  const root = resolve(directory), baserowWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const configured = await (await import('./baserow-workspace.mjs')).readBaserowWorkspaceConfiguration(baserowWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, baserowWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', baserowWorkspacesConfigured: true,
    workspaces: Object.entries(configured.workspaces).map(([workspace, value]) => ({ workspace, label: value.label })),
    ownership: 'ORIGINAL_BASEROW_SOURCE_CONSOLE' };
}

/** Attach existing original StellarExpert sessions to this authenticated Merchant MCP. */
export async function initializeStellarExpertWorkspaceMerchant({ directory, connection, name = 'Starforge Stellar asset operator' }) {
  const root = resolve(directory), stellarExpertWorkspaceConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const selected = await (await import('./stellar-expert-workspace.mjs')).readStellarExpertWorkspaceConfiguration(stellarExpertWorkspaceConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, stellarExpertWorkspaceConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', stellarExpertWorkspacesConfigured: true,
    workspaces: Object.entries(selected.workspaces).map(([workspace, item]) => ({ workspace, label: item.label, workspaceId: item.workspaceId })),
    authoring: 'ORIGINAL_STELLAR_EXPERT_WORKSPACE' };
}

/** Attach named original DSpace operators; the original browser or Applications owns their processes. */
export async function initializeDspaceOperatorMerchant({ directory, connection, name = 'Starforge repository data' }) {
  const root = resolve(directory), dspaceOperatorConnection = hostPath(connection, process.cwd());
  name = line(name, 'Merchant name');
  const configured = await (await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/dspace/merchant-provider.mjs')).readDspaceOperatorConfiguration(dspaceOperatorConnection);
  await mkdir(root, { mode: 0o700 });
  await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(join(root, 'releases'));
  await mkdir(join(root, 'customer-exports'), { mode: 0o700 });
  const configuration = join(root, 'merchant-mcp.json');
  await writePrivate(configuration, { schema: CONFIG_SCHEMA, name, releaseStore: './releases',
    exportsDirectory: './customer-exports', sources: {}, dspaceOperatorConnection });
  await readMerchantConfig(configuration);
  return { schema: CONFIG_SCHEMA, configuration, state: 'INITIALIZED', dspaceOperatorsConfigured: true,
    operators: Object.entries(configured.operators).map(([operator, entry]) => ({ operator, label: entry.label })),
    ownership: 'EXISTING_DSPACE_OPERATOR' };
}
