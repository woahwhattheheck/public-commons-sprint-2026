import {createHash} from 'node:crypto';
import {ExactNumber, parseExactJSON, stringifyExactJSON} from '../vector/json.mjs';

export {ExactNumber, parseExactJSON, stringifyExactJSON};
export const PROFILE = 'starforge.postgis-intake-profile.v1';
export const RECEIVING = 'starforge.postgis-intake-receiving.v1';
export const REVIEW = 'starforge.postgis-intake-review.v1';
export const BACKUP = 'starforge.postgis-intake-backup.v1';
export const META = Object.freeze({
  projects: '_sf_intake_projects', editions: '_sf_intake_editions',
  operations: '_sf_intake_operations', identities: '_sf_intake_identities'
});
export class IntakeError extends Error {
  constructor(code, detail) { super(code); this.name = 'IntakeError'; this.code = code; this.detail = detail; }
}
export function need(ok, code, detail) { if (!ok) throw new IntakeError(code, detail); }
export function sorted(value) {
  if (value === null || typeof value !== 'object' || value instanceof ExactNumber) return value;
  if (Array.isArray(value)) return value.map(sorted);
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, sorted(value[key])]));
}
export function canonical(value) { return stringifyExactJSON(sorted(value)); }
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function digest(value) { return sha256(canonical(value)); }
export function id(value, label = 'id') {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value), 'POSTGIS_ID_INVALID', label);
  return value;
}
export function hash(value, label = 'sha256') {
  need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'POSTGIS_SHA256_REQUIRED', label);
  return value;
}
export function identifier(value) {
  need(typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f]/.test(value) &&
    Buffer.byteLength(value) <= 63, 'POSTGIS_IDENTIFIER_INVALID', value);
  return value;
}
export function qi(value) { return '"' + identifier(value).replaceAll('"', '""') + '"'; }
export function ql(value) {
  need(typeof value === 'string' && !value.includes('\0'), 'POSTGIS_LITERAL_INVALID');
  return "'" + value.replaceAll("'", "''") + "'";
}
export function relation(schema, name) { return qi(schema) + '.' + qi(name); }
export function integer(value, label, minimum = 0) {
  need(Number.isSafeInteger(value) && value >= minimum, 'POSTGIS_INTEGER_INVALID', label); return value;
}
export const SQL_TYPES = new Set(['text', 'boolean', 'integer', 'bigint', 'numeric', 'double precision',
  'date', 'timestamp without time zone', 'timestamp with time zone', 'jsonb', 'bytea']);
const RESERVED = new Set(['sf_id', 'sf_key', 'geom', '_sf_source']);
const GEOMETRIES = new Set(['GEOMETRY', 'POINT', 'MULTIPOINT', 'LINESTRING', 'MULTILINESTRING',
  'POLYGON', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION']);
const PERMISSIONS = new Set(['select', 'insert', 'update', 'delete']);
export function normalizeProfile(input) {
  need(input && input.schema === PROFILE, 'POSTGIS_PROFILE_REQUIRED');
  const p = parseExactJSON(canonical(input));
  id(p.projectId, 'projectId');
  need(p.database && typeof p.database === 'object', 'POSTGIS_DATABASE_PROFILE_REQUIRED');
  id(p.database.profileId, 'database.profileId');
  identifier(p.database.name); identifier(p.database.schema);
  need(Array.isArray(p.layers) && p.layers.length > 0, 'POSTGIS_LAYERS_REQUIRED');
  const ids = new Set(), relations = new Set(), sources = new Set();
  for (const layer of p.layers) {
    id(layer.id, 'layer.id'); id(layer.sourceLayerId, 'sourceLayerId');
    identifier(layer.relation);
    need(!layer.relation.startsWith('_sf_') && !relations.has(layer.relation) &&
      !ids.has(layer.id) && !sources.has(layer.sourceLayerId), 'POSTGIS_LAYER_CONFLICT', layer.id);
    ids.add(layer.id); relations.add(layer.relation); sources.add(layer.sourceLayerId);
    layer.title ??= layer.id;
    need(typeof layer.title === 'string' && layer.title.length > 0, 'POSTGIS_LAYER_TITLE_REQUIRED');
    need(Array.isArray(layer.fields), 'POSTGIS_FIELDS_REQUIRED', layer.id);
    const targetNames = new Set(RESERVED), sourceNames = new Set();
    for (const field of layer.fields) {
      need(typeof field.sourceName === 'string' && field.sourceName.length > 0, 'POSTGIS_SOURCE_FIELD_REQUIRED');
      identifier(field.name);
      need(!targetNames.has(field.name) && !sourceNames.has(field.sourceName), 'POSTGIS_FIELD_CONFLICT', field.name);
      targetNames.add(field.name); sourceNames.add(field.sourceName);
      need(SQL_TYPES.has(field.type), 'POSTGIS_FIELD_TYPE_UNSUPPORTED', field.type);
      field.nullable ??= true; field.codec ??= 'native';
      need(typeof field.nullable === 'boolean' && ['native', 'json'].includes(field.codec), 'POSTGIS_FIELD_MAPPING_INVALID');
      need(field.codec !== 'json' || ['text', 'jsonb'].includes(field.type), 'POSTGIS_JSON_CODEC_TYPE_REQUIRED');
    }
    const g = layer.geometry;
    need(g && GEOMETRIES.has(g.type) && [2, 3].includes(g.dimension), 'POSTGIS_GEOMETRY_PROFILE_REQUIRED', layer.id);
    integer(g.sourceSrid, 'sourceSrid', 1); integer(g.targetSrid, 'targetSrid', 1);
    g.assignSourceCrs ??= false; g.acceptInvalid ??= false;
    need(typeof g.assignSourceCrs === 'boolean' && typeof g.acceptInvalid === 'boolean', 'POSTGIS_GEOMETRY_PROFILE_INVALID');
    if (g.assignSourceCrs) need(typeof g.assignmentReason === 'string' && g.assignmentReason.trim(), 'POSTGIS_CRS_ASSIGNMENT_REASON_REQUIRED');
    need(Array.isArray(layer.roles) && layer.roles.length > 0, 'POSTGIS_EXISTING_ROLE_PROFILE_REQUIRED', layer.id);
    const roles = new Set();
    for (const role of layer.roles) {
      identifier(role.name);
      need(!roles.has(role.name), 'POSTGIS_ROLE_DUPLICATE', role.name); roles.add(role.name);
      need(Array.isArray(role.permissions) && role.permissions.length > 0 &&
        new Set(role.permissions).size === role.permissions.length &&
        role.permissions.every(permission => PERMISSIONS.has(permission)) &&
        role.permissions.includes('select'), 'POSTGIS_ROLE_PERMISSIONS_INVALID', role.name);
      role.scope ??= null;
      if (role.scope !== null) {
        need(role.scope && targetNames.has(role.scope.column) && !RESERVED.has(role.scope.column) &&
          Array.isArray(role.scope.values) && role.scope.values.length > 0 &&
          role.scope.values.every(value => typeof value === 'string' && !value.includes('\0')) &&
          new Set(role.scope.values).size === role.scope.values.length,
          'POSTGIS_ROW_SCOPE_INVALID', role.name);
      }
    }
  }
  return p;
}
export function geometryType(layer) { return layer.geometry.type + (layer.geometry.dimension === 3 ? 'Z' : ''); }
export function viewContract(profile) {
  return profile.layers.map(layer => ({
    id: layer.id, sourceLayerId: layer.sourceLayerId, relation: layer.relation,
    fields: layer.fields.map(({name, type, nullable}) => ({name, type, nullable})),
    geometry: {type: layer.geometry.type, dimension: layer.geometry.dimension, targetSrid: layer.geometry.targetSrid}
  }));
}
export function physicalName(projectId, editionId, layerId, kind) {
  return '_sf_' + kind + '_' + sha256([projectId, editionId, layerId].join('\0')).slice(0, 40);
}
export function decimal(value, label = 'value') {
  const text = value instanceof ExactNumber ? value.lexeme :
    typeof value === 'bigint' ? value.toString() :
    typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)) ? String(value) : null;
  need(text !== null && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text), 'POSTGIS_EXACT_NUMBER_REQUIRED', label);
  return text;
}
export function fieldParameter(value, present, field) {
  if (!present || value === null) {
    need(field.nullable, 'POSTGIS_NON_NULL_SOURCE_FIELD_REQUIRED', field.sourceName); return null;
  }
  if (field.codec === 'json' || field.type === 'jsonb') return canonical(value);
  if (field.type === 'text') { need(typeof value === 'string' && !value.includes('\0'), 'POSTGIS_TEXT_REQUIRED', field.sourceName); return value; }
  if (field.type === 'boolean') { need(typeof value === 'boolean', 'POSTGIS_BOOLEAN_REQUIRED', field.sourceName); return value; }
  if (['integer', 'bigint'].includes(field.type)) {
    const text = decimal(value, field.sourceName);
    need(/^-?(?:0|[1-9]\d*)$/.test(text), 'POSTGIS_INTEGER_SOURCE_REQUIRED', field.sourceName);
    const n = BigInt(text), lo = field.type === 'integer' ? -2147483648n : -9223372036854775808n;
    const hi = field.type === 'integer' ? 2147483647n : 9223372036854775807n;
    need(n >= lo && n <= hi, 'POSTGIS_INTEGER_RANGE_EXCEEDED', field.sourceName); return text;
  }
  if (field.type === 'numeric') return decimal(value, field.sourceName);
  if (field.type === 'double precision') {
    const text = decimal(value, field.sourceName), n = Number(text);
    need(Number.isFinite(n), 'POSTGIS_DOUBLE_RANGE_EXCEEDED', field.sourceName);
    // Source values remain exact in _sf_source. A lossy target is an explicit profile choice.
    return text;
  }
  if (['date', 'timestamp without time zone', 'timestamp with time zone'].includes(field.type)) {
    need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value), 'POSTGIS_DATE_TEXT_REQUIRED', field.sourceName);
    if (field.type === 'date') need(/^\d{4}-\d{2}-\d{2}$/.test(value), 'POSTGIS_DATE_REQUIRED', field.sourceName);
    if (field.type === 'timestamp with time zone') need(/(?:Z|[+-]\d\d:\d\d)$/.test(value), 'POSTGIS_TIMESTAMP_OFFSET_REQUIRED', field.sourceName);
    return value;
  }
  if (field.type === 'bytea') {
    need(value && typeof value.$vector_binary === 'string' && Object.keys(value).length === 1 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.$vector_binary),
      'POSTGIS_BINARY_SOURCE_REQUIRED', field.sourceName);
    return Buffer.from(value.$vector_binary, 'base64');
  }
  throw new IntakeError('POSTGIS_FIELD_TYPE_UNSUPPORTED', field.type);
}
export function validateReceiving(value) {
  need(value?.schema === RECEIVING, 'POSTGIS_RECEIVING_REQUIRED');
  id(value.projectId); id(value.operationId); id(value.editionId); hash(value.requestSha256);
  integer(value.revision, 'revision', 1);
  need(value.database && Array.isArray(value.layers) && value.layers.length && Array.isArray(value.files), 'POSTGIS_RECEIVING_INCOMPLETE');
  identifier(value.database.schema); identifier(value.database.name); id(value.database.profileId);
  need(value.database.metadataRelation === META.projects, 'POSTGIS_RECEIVING_METADATA_CHANGED');
  const names = new Set();
  for (const layer of value.layers) {
    id(layer.id); id(layer.sourceLayerId); identifier(layer.relation);
    need(!names.has(layer.id), 'POSTGIS_RECEIVING_LAYER_DUPLICATE'); names.add(layer.id);
    need(layer.schema === value.database.schema && layer.relationType === 'view' &&
      layer.keyColumn === 'sf_id' && layer.sourceKeyColumn === 'sf_key' && layer.geometryColumn === 'geom' &&
      GEOMETRIES.has(layer.geometryType) && [2, 3].includes(layer.dimension), 'POSTGIS_RECEIVING_LAYER_INVALID');
    integer(layer.srid, 'srid', 1); hash(layer.rowSha256);
    need(typeof layer.rowCount === 'string' && /^\d+$/.test(layer.rowCount) &&
      Array.isArray(layer.fields) && Array.isArray(layer.roles), 'POSTGIS_RECEIVING_LAYER_INCOMPLETE');
  }
  return value;
}
