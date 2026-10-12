// MIT. Receiving identity for original native operator profiles and catalog views.
import {createHash} from 'node:crypto';

export const NATIVE_OPERATOR_EXPORT_SCHEMA = 'stellar-forge.native-operator-export.v1';
export const NATIVE_OPERATOR_EXPORT_REQUEST_SCHEMA = 'stellar-forge.native-operator-export-request.v1';
export const NATIVE_OPERATOR_MANIFEST = 'native-operator-export.json';
export const NATIVE_OPERATOR_MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024;
export const NATIVE_OPERATOR_MAX_MANIFEST_BYTES = 128 * 1024;
export const nativeDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const nativeJSON = value => JSON.stringify(value, null, 2) + '\n';
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function requireNative(value, code, message = code) {
  if (!value) throw Object.assign(new Error(message), {code});
}
export function nativeAlias(value) {
  requireNative(typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value),
    'NATIVE_OPERATOR_ALIAS_INVALID', 'Use the original host alias or receiving export ID.');
  return value;
}
export function nativeProfileName(value) {
  requireNative(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value),
    'FACILITATOR_PROFILE_NAME_INVALID');
  return value;
}
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const nativeCanonicalJSON = value => JSON.stringify(canonical(value)) + '\n';
function fields(value, keys, required = keys) {
  requireNative(plain(value) && Object.keys(value).every(key => keys.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)), 'NATIVE_OPERATOR_EXPORT_INVALID');
}
export function nativeOperatorIdentity(value) {
  fields(value, ['schema','instanceId','directory','ownershipDirectory','pid','ppid','startedAt']);
  requireNative(value.schema === 'stellar-forge.native-operator-launch.v1' &&
    typeof value.instanceId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.instanceId) &&
    ['directory','ownershipDirectory'].every(key => typeof value[key] === 'string' &&
      value[key].startsWith('/') && !/[\0\r\n]/.test(value[key])) &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && Number.isSafeInteger(value.ppid) && value.ppid >= 0 &&
    typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt)),
  'NATIVE_OPERATOR_IDENTITY_INVALID', 'Use the original native operator instance and host directories.');
  return JSON.parse(JSON.stringify(value));
}
export function nativeCatalogQuery(query = '') {
  requireNative(typeof query === 'string' && query.length <= 4096, 'FACILITATOR_CATALOG_QUERY_INVALID');
  const params = new URLSearchParams(query);
  requireNative(!params.has('runtimeId') && !params.has('expectedVersion'), 'FACILITATOR_CATALOG_QUERY_INVALID');
  params.delete('cursor'); params.delete('offset'); params.set('limit','100'); params.sort();
  return params.toString();
}
/** This immutable request identifies a receiving operation before its source is read. */
export function nativeExportRequest({operator, exportId, kind, selection}) {
  nativeAlias(operator); nativeAlias(exportId);
  requireNative(kind === 'profile' || kind === 'catalog', 'NATIVE_OPERATOR_EXPORT_KIND_INVALID');
  let normalized;
  if (kind === 'profile') {
    fields(selection, ['name','sha256']);
    nativeProfileName(selection.name);
    requireNative(isDigest(selection.sha256), 'NATIVE_OPERATOR_EXPORT_INVALID');
    normalized = {name:selection.name, sha256:selection.sha256};
  } else {
    fields(selection, ['runtimeId','expectedVersion','query'], ['runtimeId','expectedVersion']);
    requireNative(typeof selection.runtimeId === 'string' && selection.runtimeId.length > 0 &&
      selection.runtimeId.length <= 128 && !/[\0\r\n]/.test(selection.runtimeId) &&
      Number.isSafeInteger(selection.expectedVersion) && selection.expectedVersion >= 0,
    'NATIVE_OPERATOR_EXPORT_INVALID', 'Select the original runtime and exact catalog resource version.');
    normalized = {runtimeId:selection.runtimeId, expectedVersion:selection.expectedVersion,
      query:nativeCatalogQuery(selection.query)};
  }
  return {schema:NATIVE_OPERATOR_EXPORT_REQUEST_SCHEMA, operator, exportId, kind, selection:normalized};
}
export function validateNativeOperatorManifest(value, exportId) {
  fields(value, ['schema','exportId','operator','kind','request','requestSha256','capturedAt','source','files']);
  requireNative(value.schema === NATIVE_OPERATOR_EXPORT_SCHEMA && value.exportId === exportId,
    'NATIVE_OPERATOR_EXPORT_INVALID');
  const request = nativeExportRequest(value.request);
  requireNative(value.request.schema === NATIVE_OPERATOR_EXPORT_REQUEST_SCHEMA &&
    nativeCanonicalJSON(request) === nativeCanonicalJSON(value.request) &&
    value.operator === request.operator && value.exportId === request.exportId && value.kind === request.kind &&
    nativeDigest(nativeCanonicalJSON(request)) === value.requestSha256 &&
    typeof value.capturedAt === 'string' && Number.isFinite(Date.parse(value.capturedAt)),
  'NATIVE_OPERATOR_EXPORT_INVALID');
  fields(value.source, ['operator','profile','network','catalog'], ['operator','profile','network']);
  nativeOperatorIdentity(value.source.operator);
  fields(value.source.profile, ['name','sha256']);
  nativeProfileName(value.source.profile.name);
  requireNative(isDigest(value.source.profile.sha256) &&
    ['stellar:testnet','stellar:pubnet'].includes(value.source.network), 'NATIVE_OPERATOR_EXPORT_INVALID');
  const names = value.kind === 'catalog' ? ['profile.json','catalog.json'] : ['profile.json'];
  requireNative(Array.isArray(value.files) && value.files.length === names.length,
    'NATIVE_OPERATOR_EXPORT_INVALID');
  for (let i = 0; i < names.length; i++) {
    const file = value.files[i];
    fields(file, ['name','bytes','sha256']);
    requireNative(file.name === names[i] && Number.isSafeInteger(file.bytes) && file.bytes > 0 &&
      file.bytes <= (file.name === 'profile.json' ? 65536 : NATIVE_OPERATOR_MAX_FILE_BYTES) && isDigest(file.sha256),
    'NATIVE_OPERATOR_EXPORT_INVALID');
  }
  requireNative(value.files[0].sha256 === value.source.profile.sha256, 'NATIVE_OPERATOR_EXPORT_INVALID');
  if (value.kind === 'profile') {
    requireNative(value.source.catalog === undefined && value.source.profile.name === request.selection.name &&
      value.source.profile.sha256 === request.selection.sha256, 'NATIVE_OPERATOR_EXPORT_INVALID');
  } else {
    const catalog = value.source.catalog;
    requireNative(plain(catalog) && catalog.schema === 'stellar-forge.native-catalog-export.v1' &&
      catalog.runtimeId === request.selection.runtimeId && catalog.catalog?.version === request.selection.expectedVersion &&
      catalog.query === request.selection.query && catalog.profile?.name === value.source.profile.name &&
      catalog.profile?.sha256 === value.source.profile.sha256 && catalog.network === value.source.network &&
      catalog.observedAt === value.capturedAt && Number.isSafeInteger(catalog.resourceCount) && catalog.resourceCount >= 0 &&
      Number.isSafeInteger(catalog.pages) && catalog.pages >= 1, 'NATIVE_OPERATOR_EXPORT_INVALID');
  }
  return value;
}
export function parseNativeOperatorManifest(bytes, exportId) {
  requireNative(bytes?.byteLength <= NATIVE_OPERATOR_MAX_MANIFEST_BYTES, 'NATIVE_OPERATOR_EXPORT_INVALID');
  let value;
  try {value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));}
  catch {requireNative(false, 'NATIVE_OPERATOR_EXPORT_INVALID', 'Read the complete original receiving manifest.');}
  return validateNativeOperatorManifest(value, exportId);
}
