// MIT. Explicit material, reference, text-join and quantity-unit mapping.
import { WorkspaceError, clone, digest, canonical } from '../workspace/store.mjs';
import { catalogField, readCatalogRows } from './input.mjs';

export const CATALOG_MAPPING_SCHEMA = 'stellar-forge.material-catalog-mapping.v1';
export const MATERIAL_SCHEMA = 'stellar-forge.material-catalog-record.v1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, status = 422) => { throw new WorkspaceError(code, message, status); };
const allowedFields = ['materialId', 'title', 'description', 'partNumber', 'manufacturer', 'category', 'unit', 'salesUnit', 'numerator', 'denominator'];
export function catalogText(value, label, maximum = 1024, optional = false) {
  if (value === null || value === undefined || value === '') {
    if (optional) return null;
    fail('CATALOG_VALUE_REQUIRED', label + ' is required.');
  }
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0'))
    fail('CATALOG_TEXT_INVALID', label + ' must be nonempty text, at most ' + maximum + ' characters.');
  return value;
}
function keys(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)))
    fail('CATALOG_MAPPING_INVALID', label + ' has an unsupported field.');
}
function descriptor(value, depth = 0) {
  if (depth > 5) fail('CATALOG_MAPPING_DEPTH', 'A mapping expression is nested too deeply.');
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return catalogText(value, 'Source field', 512);
  if (!object(value)) fail('CATALOG_MAPPING_EXPRESSION_INVALID', 'Use a source field, a declared constant, a text join, or a retained lookup.');
  if (Object.hasOwn(value, 'constant')) {
    keys(value, ['constant', 'reason'], 'Constant');
    return { constant: catalogText(value.constant, 'Constant value', 65536),
      reason: catalogText(value.reason, 'Reason for the operator constant', 1600) };
  }
  if (Object.hasOwn(value, 'join')) {
    keys(value, ['join', 'separator'], 'Text join');
    if (!Array.isArray(value.join) || !value.join.length || value.join.length > 16)
      fail('CATALOG_MAPPING_JOIN_INVALID', 'Join between one and sixteen declared text fields.');
    const separator = value.separator ?? ' ';
    if (typeof separator !== 'string' || separator.length > 16 || separator.includes('\0'))
      fail('CATALOG_MAPPING_JOIN_INVALID', 'Use a short text separator.');
    return { join: value.join.map(part => descriptor(part, depth + 1)), separator };
  }
  if (Object.hasOwn(value, 'lookup')) {
    keys(value, ['lookup'], 'Lookup');
    const row = value.lookup;
    keys(row, ['sourceId', 'key', 'from', 'value', 'where'], 'Lookup declaration');
    const list = (input, label) => {
      const fields = Array.isArray(input) ? input : [input];
      if (!fields.length || fields.length > 8) fail('CATALOG_MAPPING_LOOKUP_INVALID', 'Choose one to eight ' + label + ' fields.');
      return fields.map(field => catalogText(field, label, 512));
    };
    const key = list(row.key, 'lookup key'), from = list(row.from, 'source key');
    if (key.length !== from.length) fail('CATALOG_MAPPING_LOOKUP_INVALID', 'Source and lookup keys must have the same number of fields.');
    const where = row.where ?? {};
    if (!object(where) || Object.keys(where).length > 16)
      fail('CATALOG_MAPPING_LOOKUP_INVALID', 'Use explicit equality filters for the selected lookup edition.');
    return { lookup: { sourceId: catalogText(row.sourceId, 'Lookup source ID', 96), key, from,
      value: catalogText(row.value, 'Lookup value field', 512),
      where: Object.fromEntries(Object.entries(where).map(([name, expected]) => [
        catalogText(name, 'Lookup filter field', 512), catalogText(expected, 'Lookup filter value', 512)])) } };
  }
  fail('CATALOG_MAPPING_EXPRESSION_INVALID', 'The mapping expression is not supported.');
}
export function normalizeCatalogMapping(value) {
  keys(value, ['schema', 'fields', 'references', 'attributes', 'identifierPolicy', 'unitAliases', 'delta'], 'Catalog mapping');
  if (value.schema !== CATALOG_MAPPING_SCHEMA) fail('CATALOG_MAPPING_SCHEMA_INVALID', 'Choose the material-catalog mapping schema.');
  keys(value.fields, allowedFields, 'Mapped fields');
  if (!value.fields.materialId) fail('CATALOG_MAPPING_ID_REQUIRED', 'Select the original material identifier field.');
  const fields = Object.fromEntries(allowedFields.map(name => [name, descriptor(value.fields[name])]));
  const identifierPolicy = value.identifierPolicy ?? 'exact';
  if (!['exact', 'casefold'].includes(identifierPolicy))
    fail('CATALOG_IDENTIFIER_POLICY_INVALID', 'Select exact identifiers or explicitly case-insensitive lookup.');
  const references = value.references ?? [];
  if (!Array.isArray(references) || references.length > 32)
    fail('CATALOG_REFERENCES_INVALID', 'Select at most thirty-two original reference fields.');
  const mappedReferences = references.map(row => {
    keys(row, ['kind', 'value', 'delimiter'], 'Reference mapping');
    const result = { kind: catalogText(row.kind, 'Reference kind', 80), value: descriptor(row.value) };
    if (!result.value) fail('CATALOG_REFERENCE_FIELD_REQUIRED', 'Choose the original reference field.');
    if (row.delimiter !== undefined)
      result.delimiter = catalogText(row.delimiter, 'Reference separator', 8);
    return result;
  });
  const attributes = value.attributes ?? {};
  if (!object(attributes) || Object.keys(attributes).length > 128)
    fail('CATALOG_ATTRIBUTES_INVALID', 'Use up to 128 explicitly selected original attributes.');
  const unitAliases = value.unitAliases ?? {};
  if (!object(unitAliases) || Object.keys(unitAliases).length > 1024)
    fail('CATALOG_UNIT_ALIASES_INVALID', 'Use an explicit original-unit to selected-unit map.');
  const units = Object.fromEntries(Object.entries(unitAliases).map(([from, to]) =>
    [catalogText(from, 'Original unit', 80), catalogText(to, 'Selected unit', 80)]));
  let delta = null;
  if (value.delta !== undefined && value.delta !== null) {
    keys(value.delta, ['operation', 'upsertValues', 'deleteValues'], 'Delta declaration');
    const values = (rows, label) => {
      if (!Array.isArray(rows) || !rows.length || rows.length > 32)
        fail('CATALOG_DELTA_VALUES_INVALID', 'Declare the original ' + label + ' values.');
      return [...new Set(rows.map(row => catalogText(row, label, 80)))];
    };
    delta = { operation: descriptor(value.delta.operation),
      upsertValues: values(value.delta.upsertValues ?? ['upsert'], 'upsert operation'),
      deleteValues: values(value.delta.deleteValues ?? ['delete'], 'delete operation') };
    if (!delta.operation || delta.upsertValues.some(item => delta.deleteValues.includes(item)))
      fail('CATALOG_DELTA_MAPPING_INVALID', 'Delta operations must distinguish complete upsert rows from explicit deletes.');
  }
  const result = { schema: CATALOG_MAPPING_SCHEMA, fields, references: mappedReferences,
    attributes: Object.fromEntries(Object.entries(attributes).map(([name, field]) =>
      [catalogText(name, 'Attribute name', 128), descriptor(field)])),
    identifierPolicy, unitAliases: units, delta };
  if (Buffer.byteLength(JSON.stringify(result)) > 262144)
    fail('CATALOG_MAPPING_TOO_LARGE', 'The complete mapping exceeds 256 KiB.');
  return result;
}

export function catalogIdentifier(value, policy = 'exact') {
  const text = catalogText(value, 'Identifier', 1024);
  return policy === 'casefold' ? text.toLowerCase() : text;
}
function scalar(value, label, optional = false, limit = 262144) {
  if (value === null || value === undefined || value === '') return optional ? null : catalogText(value, label, limit);
  if (typeof value !== 'string') fail('CATALOG_SCALAR_REQUIRED', label + ' must map to original text or numeric-token text.');
  return catalogText(value, label, limit, optional);
}
function gcd(a, b) { while (b) { const next = a % b; a = b; b = next; } return a; }
export function catalogDecimal(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,39})(?:\.\d{1,18})?$/.test(value))
    fail('CATALOG_DECIMAL_INVALID', 'Use nonnegative plain decimal text with at most eighteen fractional places.');
  const [whole, fraction = ''] = value.split('.');
  let numerator = BigInt(whole + fraction), denominator = 10n ** BigInt(fraction.length);
  const common = gcd(numerator, denominator); numerator /= common; denominator /= common;
  return { numerator: numerator.toString(), denominator: denominator.toString() };
}
function ratio(numerator, denominator) {
  const a = catalogDecimal(numerator), b = catalogDecimal(denominator);
  let n = BigInt(a.numerator) * BigInt(b.denominator), d = BigInt(a.denominator) * BigInt(b.numerator);
  if (n <= 0n || d <= 0n) fail('CATALOG_UNIT_RATIO_INVALID', 'A quantity-unit ratio must be positive.');
  const common = gcd(n, d); n /= common; d /= common;
  return { numerator: n.toString(), denominator: d.toString() };
}
export function catalogQuantity(material, quantity, requestedUnit) {
  const amount = catalogDecimal(quantity);
  if (!material.unit) fail('CATALOG_UNIT_REQUIRED', 'Select a source-supported quantity unit before exporting a quantity.');
  let factor;
  if (requestedUnit === material.unit) factor = { numerator: '1', denominator: '1' };
  else if (requestedUnit === material.salesUnit && material.salesToBase) factor = material.salesToBase;
  else fail('CATALOG_UNIT_CONVERSION_REQUIRED', 'This material has no declared conversion from the selected unit.');
  let numerator = BigInt(amount.numerator) * BigInt(factor.numerator);
  let denominator = BigInt(amount.denominator) * BigInt(factor.denominator);
  const common = gcd(numerator, denominator); numerator /= common; denominator /= common;
  let remainder = denominator, twos = 0, fives = 0;
  while (remainder % 2n === 0n) { remainder /= 2n; twos++; }
  while (remainder % 5n === 0n) { remainder /= 5n; fives++; }
  let decimal = null;
  if (remainder === 1n && Math.max(twos, fives) <= 36) {
    const places = Math.max(twos, fives);
    const scaled = numerator * 2n ** BigInt(places - twos) * 5n ** BigInt(places - fives);
    const digits = scaled.toString().padStart(places + 1, '0');
    decimal = places ? (digits.slice(0, -places) + '.' + digits.slice(-places)).replace(/\.?0+$/, '') : digits;
  }
  return { quantity, requestedUnit, baseUnit: material.unit,
    baseQuantity: { numerator: numerator.toString(), denominator: denominator.toString(), decimal } };
}

export async function compileCatalogMapping(value, resolveSource) {
  const mapping = normalizeCatalogMapping(value), lookups = new Map(), dependencies = new Map();
  async function prepare(expression) {
    if (!expression || typeof expression === 'string' || Object.hasOwn(expression, 'constant')) return;
    if (expression.join) { for (const part of expression.join) await prepare(part); return; }
    const selected = expression.lookup, key = digest(selected);
    if (lookups.has(key)) return;
    const source = await resolveSource(selected.sourceId), values = new Map();
    for await (const { record } of readCatalogRows(source.path, source.format)) {
      if (!Object.entries(selected.where).every(([field, expected]) => catalogField(record, field) === expected)) continue;
      const tuple = selected.key.map(field => scalar(catalogField(record, field), 'Lookup key', false, 1024));
      const identity = canonical(tuple);
      if (values.has(identity))
        fail('CATALOG_LOOKUP_AMBIGUOUS', 'Lookup source ' + source.name + ' has repeated selected keys; choose its language/client filters.');
      const result = catalogField(record, selected.value);
      if (result === undefined) fail('CATALOG_LOOKUP_VALUE_MISSING', 'The selected lookup value field is absent.');
      values.set(identity, clone(result));
    }
    lookups.set(key, values);
    dependencies.set(source.id, { id: source.id, sha256: source.sha256, bytes: source.bytes, name: source.name });
  }
  for (const expression of [...Object.values(mapping.fields), ...Object.values(mapping.attributes),
    ...mapping.references.map(row => row.value), mapping.delta?.operation]) await prepare(expression);
  function read(expression, row, label) {
    if (!expression) return null;
    if (typeof expression === 'string') return catalogField(row, expression);
    if (Object.hasOwn(expression, 'constant')) return expression.constant;
    if (expression.join) return expression.join.map(part => scalar(read(part, row, label), label, true))
      .filter(part => part !== null).join(expression.separator);
    const selected = expression.lookup;
    const tuple = selected.from.map(field => scalar(catalogField(row, field), 'Source lookup key', false, 1024));
    const values = lookups.get(digest(selected)), identity = canonical(tuple);
    if (!values.has(identity)) fail('CATALOG_LOOKUP_MISSING', label + ' has no matching row in the selected retained lookup.');
    return clone(values.get(identity));
  }
  function material(row, tenantId) {
    const field = (name, optional = true, limit) => scalar(read(mapping.fields[name], row, name), name, optional, limit);
    const materialId = field('materialId', false, 1024);
    const title = field('title', true, 8192) ?? materialId;
    const description = field('description', true) ?? title;
    const originalUnit = field('unit', true, 80);
    const originalSalesUnit = field('salesUnit', true, 80);
    const selectUnit = unit => unit === null ? null : (Object.hasOwn(mapping.unitAliases, unit) ? mapping.unitAliases[unit] : unit);
    const unit = selectUnit(originalUnit), salesUnit = selectUnit(originalSalesUnit);
    const numerator = field('numerator', true, 80), denominator = field('denominator', true, 80);
    let salesToBase = null;
    if (numerator !== null || denominator !== null) {
      if (!unit || !salesUnit || numerator === null || denominator === null)
        fail('CATALOG_UNIT_RATIO_INCOMPLETE', 'A conversion needs both units and the original numerator and denominator.');
      salesToBase = ratio(numerator, denominator);
      if (unit === salesUnit && (salesToBase.numerator !== '1' || salesToBase.denominator !== '1'))
        fail('CATALOG_UNIT_RATIO_CONFLICT', 'Equal selected units require a one-to-one conversion.');
    } else if (unit && unit === salesUnit) salesToBase = { numerator: '1', denominator: '1' };
    const references = [];
    for (const selected of mapping.references) {
      const original = read(selected.value, row, selected.kind);
      const values = Array.isArray(original) ? original : selected.delimiter && typeof original === 'string'
        ? original.split(selected.delimiter) : [original];
      for (const item of values) {
        const reference = scalar(item, 'Material reference', true, 1024);
        if (reference !== null) references.push({ kind: selected.kind, value: reference });
      }
    }
    const uniqueReferences = [...new Map(references.map(reference => [canonical(reference), reference])).values()]
      .sort((a, b) => canonical(a).localeCompare(canonical(b), 'en'));
    const attributes = Object.fromEntries(Object.entries(mapping.attributes).map(([name, expression]) => {
      const value = read(expression, row, name);
      if (value !== null && value !== undefined && typeof value !== 'string' && typeof value !== 'boolean' && !Array.isArray(value) && !object(value))
        fail('CATALOG_ATTRIBUTE_INVALID', 'A selected attribute has an unsupported value.');
      return [name, value === undefined ? null : clone(value)];
    }));
    const result = { schema: MATERIAL_SCHEMA, key: digest([tenantId, materialId]), tenantId, materialId,
      title, description, partNumber: field('partNumber', true, 1024),
      manufacturer: field('manufacturer', true, 4096), category: field('category', true, 4096),
      unit, originalUnit, salesUnit, originalSalesUnit, salesToBase,
      references: uniqueReferences, attributes };
    if (Buffer.byteLength(JSON.stringify(result)) > 2097152)
      fail('CATALOG_MATERIAL_TOO_LARGE', 'The normalized material exceeds 2 MiB.');
    return { ...result, sha256: digest(result) };
  }
  function operation(row, mode) {
    if (mode === 'full') return 'upsert';
    if (!mapping.delta) fail('CATALOG_DELTA_MAPPING_REQUIRED', 'Declare the original delta operation field and its upsert/delete values.');
    const original = read(mapping.delta.operation, row, 'Delta operation');
    const value = scalar(typeof original === 'boolean' ? String(original) : original, 'Delta operation', false, 80);
    if (mapping.delta.upsertValues.includes(value)) return 'upsert';
    if (mapping.delta.deleteValues.includes(value)) return 'delete';
    fail('CATALOG_DELTA_OPERATION_INVALID', 'The source row has an undeclared delta operation.');
  }
  return { mapping, sha256: digest(mapping), dependencies: [...dependencies.values()],
    material, operation, materialId: row => scalar(read(mapping.fields.materialId, row, 'materialId'), 'materialId', false, 1024) };
}

export function catalogMaterialFields(before, after) {
  const fields = ['title', 'description', 'partNumber', 'manufacturer', 'category', 'unit',
    'originalUnit', 'salesUnit', 'originalSalesUnit', 'salesToBase', 'references', 'attributes'];
  return fields.filter(name => canonical(before?.[name] ?? null) !== canonical(after?.[name] ?? null));
}
export function verifyCatalogMaterial(value, tenantId) {
  if (!object(value) || value.schema !== MATERIAL_SCHEMA || value.tenantId !== tenantId ||
      value.key !== digest([tenantId, value.materialId]))
    fail('CATALOG_MATERIAL_IDENTITY_INVALID', 'The retained material has a different catalog tenant or identity.');
  const { sha256, ...record } = value;
  if (digest(record) !== sha256) fail('CATALOG_MATERIAL_CHANGED', 'The retained material checksum changed.', 409);
  return value;
}
