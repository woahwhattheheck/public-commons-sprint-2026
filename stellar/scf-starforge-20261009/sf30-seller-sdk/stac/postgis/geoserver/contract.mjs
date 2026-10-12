// MIT. GeoServer publication over the original accepted PostGIS receiving contract.
import { isAbsolute, resolve } from 'node:path';
import { identity, object, fault } from '../../../postgres/publisher/files.mjs';
import { identifier, validateReceiving as validatePostgisReceiving, parseExactJSON, canonical } from '../contract.mjs';
export { parseExactJSON, canonical };
export const nativeBytes = value => Buffer.from(canonical(value) + '\n');

export const PROFILE_SCHEMA = 'starforge.geoserver-profile.v1';
export const REQUEST_SCHEMA = 'starforge.geoserver-publication-request.v1';
export const REVIEW_SCHEMA = 'starforge.geoserver-publication-review.v1';
export const RECEIVING_SCHEMA = 'starforge.geoserver-receiving.v1';
export const POSTGIS_SCHEMA = 'starforge.postgis-intake-receiving.v1';
export const HASH = /^[a-f0-9]{64}$/;
export const NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/;
export const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const ENV = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const MARKER = 'starforge.postgis.publication';
export const MiB = 1024 * 1024;
export function need(condition, code, message = code, status = 400) {
  if (!condition) throw fault(code, message, status);
}
export function keys(value, names, label) {
  need(object(value) && Object.keys(value).every(name => names.includes(name)),
    'GEOSERVER_FIELDS', 'Use the declared ' + label + ' fields.');
}
export function text(value, label, maximum = 4096, empty = false) {
  need(typeof value === 'string' && (empty || value.length > 0) &&
    value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),
    'GEOSERVER_TEXT', 'Use valid ' + label + '.');
  return value;
}
export function name(value, label = 'resource name') {
  need(typeof value === 'string' && NAME.test(value), 'GEOSERVER_NAME',
    'Use one explicit unqualified ' + label + ' with letters, digits, underscores or hyphens.');
  return value;
}
export function operationId(value) {
  need(typeof value === 'string' && KEY.test(value), 'GEOSERVER_OPERATION_ID');
  return value;
}
export function hash(value) {
  need(typeof value === 'string' && HASH.test(value), 'GEOSERVER_SHA256');
  return value;
}
export function absolute(value) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
    value !== '/' && !value.includes('\0'), 'GEOSERVER_ABSOLUTE_DIRECTORY');
  return value;
}
export function relativeFile(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
    !value.includes('\\') && !value.includes('\0') && !isAbsolute(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..'),
    'GEOSERVER_RELATIVE_FILE');
  return value;
}
export function natural(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  need(Number.isSafeInteger(value) && value >= 0 && value <= maximum,
    'GEOSERVER_INTEGER', 'Use an exact nonnegative integer for ' + label + '.');
  return value;
}
export function decimal(value) {
  need(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value), 'GEOSERVER_DECIMAL_COUNT');
  return value;
}
function roles(value, label) {
  need(Array.isArray(value) && value.length > 0 && value.length <= 64 &&
    value.every(role => typeof role === 'string' && /^[A-Za-z_][A-Za-z0-9_.:@-]{0,127}$/.test(role)) &&
    new Set(value).size === value.length, 'GEOSERVER_ROLES', 'Select the existing ' + label + ' explicitly.');
  return [...value].sort();
}
function auth(value) {
  keys(value, ['scheme','authorizationEnv'], 'source authentication reference');
  need(['Basic','Bearer','ApiKey'].includes(value.scheme) && ENV.test(value.authorizationEnv ?? ''),
    'GEOSERVER_AUTH_REFERENCE', 'Use the assigned private environment reference.');
  return {scheme:value.scheme, authorizationEnv:value.authorizationEnv};
}
export function normalizeProfile(input) {
  keys(input, ['schema','id','baseUrl','workspace','datastore','database','administrator','readers',
    'transport','allowLoopback','timeoutMs','pageBytes','totalBytes','maxPages','pageSize','python'], 'GeoServer profile');
  need(input.schema === PROFILE_SCHEMA, 'GEOSERVER_PROFILE_SCHEMA');
  const id = operationId(input.id);
  const base = new URL(input.baseUrl);
  need(!base.username && !base.password && !base.hash && !base.search &&
    (base.protocol === 'https:' || (input.allowLoopback === true &&
      base.protocol === 'http:' && base.hostname === '127.0.0.1')) &&
    !/%2f|%5c|%00/i.test(base.pathname), 'GEOSERVER_BASE_URL',
    'Select the actual HTTPS GeoServer context, or explicitly selected local HTTP server.');
  base.pathname = base.pathname.replace(/\/+$/, '');
  const baseUrl = base.href.replace(/\/$/, '');
  const workspace = name(input.workspace, 'workspace'), datastore = name(input.datastore, 'datastore');
  keys(input.database, ['profileId','host','port','name','schema','role','primaryKeyMetadataTable'], 'database binding');
  const database = {
    profileId:text(input.database.profileId, 'database profile reference', 256),
    host:text(input.database.host, 'observed database host', 255),
    port:natural(input.database.port ?? 5432, 'database port', 65535),
    name:text(input.database.name, 'database name', 63),
    schema:identifier(input.database.schema),
    role:identifier(input.database.role),
    primaryKeyMetadataTable:text(input.database.primaryKeyMetadataTable, 'primary-key metadata relation', 127),
  };
  need(database.port > 0 && database.primaryKeyMetadataTable.includes('.'),
    'GEOSERVER_PRIMARY_KEY_TABLE', 'Select the original schema-qualified GeoTools metadata table.');
  need(Array.isArray(input.readers) && input.readers.length > 0 && input.readers.length <= 32,
    'GEOSERVER_READERS', 'Select the existing service reader profiles.');
  const readers = input.readers.map(reader => {
    keys(reader, ['id','roles','authorization'], 'service reader');
    return {id:operationId(reader.id), roles:roles(reader.roles, 'service roles'), authorization:auth(reader.authorization)};
  });
  need(new Set(readers.map(reader => reader.id)).size === readers.length, 'GEOSERVER_READER_DUPLICATE');
  const timeoutMs = input.timeoutMs ?? 60000, pageBytes = input.pageBytes ?? 16 * MiB;
  const totalBytes = input.totalBytes ?? 512 * MiB, maxPages = input.maxPages ?? 100000;
  const pageSize = input.pageSize ?? 1000;
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300000 &&
    Number.isSafeInteger(pageBytes) && pageBytes >= MiB && pageBytes <= 64 * MiB &&
    Number.isSafeInteger(totalBytes) && totalBytes >= pageBytes && totalBytes <= 2 * 1024 * MiB &&
    Number.isSafeInteger(maxPages) && maxPages >= 1 && maxPages <= 1000000 &&
    Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 10000,
    'GEOSERVER_LIMITS');
  const result = {schema:PROFILE_SCHEMA,id,baseUrl,workspace,datastore,database,
    administrator:auth(input.administrator),readers,timeoutMs,pageBytes,totalBytes,maxPages,pageSize,
    allowLoopback:input.allowLoopback === true};
  if (input.transport !== undefined) result.transport = structuredClone(input.transport);
  if (input.python !== undefined) result.python = text(input.python, 'existing Python executable', 4096);
  return result;
}
export function publicProfile(profile) {
  return {schema:profile.schema,id:profile.id,baseUrl:profile.baseUrl,workspace:profile.workspace,
    datastore:profile.datastore,database:structuredClone(profile.database),
    readers:profile.readers.map(({id,roles}) => ({id,roles})),
    limits:{pageBytes:profile.pageBytes,totalBytes:profile.totalBytes,maxPages:profile.maxPages,pageSize:profile.pageSize}};
}
export function validateReceipt(receipt) {
  validatePostgisReceiving(receipt);
  need(object(receipt) && receipt.schema === POSTGIS_SCHEMA && Array.isArray(receipt.layers) &&
    receipt.layers.length > 0 && receipt.layers.length <= 10000, 'POSTGIS_RECEIVING_SCHEMA');
  text(receipt.projectId,'original PostGIS project',256); text(receipt.operationId,'original PostGIS operation',256);
  text(receipt.editionId,'accepted edition',256); hash(receipt.requestSha256); natural(receipt.revision,'accepted revision');
  need(object(receipt.database) && object(receipt.source) && object(receipt.mapping),
    'POSTGIS_RECEIVING_BINDING');
  text(receipt.database.profileId,'PostGIS profile',256);
  text(receipt.database.name,'observed database',63); identifier(receipt.database.schema);
  need(receipt.database.metadataRelation === '_sf_intake_projects', 'POSTGIS_CURRENT_EDITION_RELATION');
  hash(receipt.source.captureSha256); hash(receipt.source.selectionSha256);
  for (const file of [receipt.source.manifest,receipt.mapping]) {
    relativeFile(file.path); hash(file.sha256); natural(file.bytes,'original member size');
  }
  const seen = new Set();
  for (const layer of receipt.layers) {
    text(layer.id,'original layer identity',256);
    need(!seen.has(layer.id), 'POSTGIS_LAYER_DUPLICATE'); seen.add(layer.id);
    text(layer.sourceLayerId,'original source layer',256); identifier(layer.schema);
    identifier(layer.relation); need(layer.relationType === 'view' &&
      layer.keyColumn === 'sf_id' && layer.sourceKeyColumn === 'sf_key' && layer.geometryColumn === 'geom',
      'POSTGIS_STABLE_VIEW_REQUIRED');
    need(['POINT','MULTIPOINT','LINESTRING','MULTILINESTRING','POLYGON','MULTIPOLYGON',
      'GEOMETRY','GEOMETRYCOLLECTION'].includes(layer.geometryType) &&
      [2,3].includes(layer.dimension) && Number.isSafeInteger(layer.srid) && layer.srid > 0,
      'POSTGIS_GEOMETRY_BINDING');
    decimal(layer.rowCount); hash(layer.rowSha256);
    need(Array.isArray(layer.fields) && Array.isArray(layer.roles), 'POSTGIS_FIELDS_ROLES');
    const fields = new Set(['sf_id','sf_key','geom']);
    for (const field of layer.fields) {
      identifier(field.name); text(field.sourceName,'source field',1024);
      text(field.type,'PostgreSQL type',128);
      need(typeof field.nullable === 'boolean' && !fields.has(field.name), 'POSTGIS_FIELD_BINDING');
      fields.add(field.name);
    }
    for (const role of layer.roles) {
      text(role.name,'observed database role',63); decimal(role.visibleRows);
      need(Array.isArray(role.permissions) && object(role.observedPrivileges),
        'POSTGIS_ROLE_OBSERVATION');
    }
  }
  need(Array.isArray(receipt.files) && receipt.files.length <= 1000000, 'POSTGIS_MEMBER_LIST');
  const paths = new Set();
  for (const file of receipt.files) {
    relativeFile(file.path); hash(file.sha256); natural(file.bytes,'receiving member size');
    need(file.path !== 'postgis-receiving.json' && !paths.has(file.path), 'POSTGIS_MEMBER_DUPLICATE');
    paths.add(file.path);
  }
  for (const selected of [receipt.source.manifest,receipt.mapping]) {
    const file = receipt.files.find(row => row.path === selected.path);
    need(file && file.sha256 === selected.sha256 && file.bytes === selected.bytes, 'POSTGIS_SOURCE_MEMBER_CHANGED');
  }
  return receipt;
}
export function receiptBinding(receipt, manifestSha256) {
  return {projectId:receipt.projectId,editionId:receipt.editionId,revision:receipt.revision,
    operationId:receipt.operationId,requestSha256:receipt.requestSha256,manifestSha256,
    database:structuredClone(receipt.database),source:structuredClone(receipt.source),
    mapping:structuredClone(receipt.mapping)};
}
export function normalizeSelection(input, receipt, profile) {
  need(Array.isArray(input) && input.length > 0 && input.length <= 256, 'GEOSERVER_LAYER_SELECTION');
  const ids = new Set(), published = new Set();
  return input.map(value => {
    keys(value,['layerId','name','title','abstract','enabled','advertised','style','access','map'], 'published layer');
    const layer = receipt.layers.find(row => row.id === value.layerId);
    need(layer && !ids.has(layer.id), 'GEOSERVER_LAYER_ID'); ids.add(layer.id);
    const publishedName = name(value.name ?? layer.relation,'published feature type');
    need(!published.has(publishedName), 'GEOSERVER_PUBLISHED_NAME_DUPLICATE'); published.add(publishedName);
    const reader = layer.roles.find(role => role.name === profile.database.role);
    need(layer.schema === profile.database.schema && reader?.observedPrivileges?.select === true &&
      ['insert','update','delete'].every(permission => reader.observedPrivileges[permission] === false),
      'GEOSERVER_DATABASE_READER', 'Select the observed read-only database role for each stable view.');
    const metadata=layer.primaryKeyMetadata;
    need(metadata && metadata.exposePrimaryKeys === true &&
      metadata.schema+'.'+metadata.table === profile.database.primaryKeyMetadataTable &&
      Array.isArray(metadata.observedRows) && metadata.observedRows.length === 1 &&
      metadata.observedRows[0].table_schema === layer.schema && metadata.observedRows[0].table_name === layer.relation &&
      metadata.observedRows[0].pk_column === 'sf_id' && metadata.observedRows[0].pk_column_idx === null &&
      ['assigned','autogenerated'].includes(metadata.observedRows[0].pk_policy),
      'GEOSERVER_NATIVE_PRIMARY_KEY', 'Use the original accepted GeoTools mapping for this stable view.');
    keys(value.access,['read','write'],'layer access rules');
    const access = {read:roles(value.access.read,'read roles'),write:roles(value.access.write,'write roles')};
    need(profile.readers.every(readerProfile => readerProfile.roles.some(role => access.read.includes(role))),
      'GEOSERVER_READER_ACCESS', 'Each receiving profile must have an explicitly selected read role.');
    keys(value.style,['name','workspace','file','sha256','format'],'style selection');
    const style = {name:name(value.style.name,'style'),workspace:value.style.workspace === undefined ? profile.workspace : value.style.workspace};
    need(style.workspace === profile.workspace || style.workspace === null, 'GEOSERVER_STYLE_WORKSPACE');
    if (value.style.file !== undefined) {
      absolute(value.style.file); hash(value.style.sha256);
      need(style.workspace === profile.workspace && ['sld','se'].includes(value.style.format), 'GEOSERVER_STYLE_SOURCE');
      Object.assign(style,{file:value.style.file,sha256:value.style.sha256,format:value.style.format});
    } else need(value.style.sha256 === undefined && value.style.format === undefined, 'GEOSERVER_STYLE_REFERENCE');
    const result = {layerId:layer.id,name:publishedName,title:text(value.title ?? layer.title ?? publishedName,'layer title',1024),
      abstract:text(value.abstract ?? '', 'layer description',16384,true),
      enabled:value.enabled ?? true,advertised:value.advertised ?? true,style,access};
    need(typeof result.enabled === 'boolean' && typeof result.advertised === 'boolean','GEOSERVER_LAYER_FLAGS');
    if (value.map !== undefined) {
      keys(value.map,['bbox','width','height'],'native WMS map selection');
      need(Array.isArray(value.map.bbox) && value.map.bbox.length === 4 &&
        value.map.bbox.every(n => typeof n === 'string' && /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(n) &&
          Number.isFinite(Number(n))) && Number(value.map.bbox[0]) < Number(value.map.bbox[2]) &&
        Number(value.map.bbox[1]) < Number(value.map.bbox[3]), 'GEOSERVER_MAP_BOUNDS');
      const width = value.map.width ?? 800, height = value.map.height ?? 600;
      need(Number.isSafeInteger(width) && width >= 1 && width <= 4096 &&
        Number.isSafeInteger(height) && height >= 1 && height <= 4096, 'GEOSERVER_MAP_SIZE');
      result.map = {bbox:[...value.map.bbox],width,height};
    }
    return result;
  });
}
export function same(left,right) { return identity(left) === identity(right); }
export const segment = value => encodeURIComponent(value);
