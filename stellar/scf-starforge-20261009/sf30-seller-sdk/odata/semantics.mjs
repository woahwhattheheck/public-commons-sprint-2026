// MIT. CSDL meaning for the original OData capture and typed CSV publication.
import { parseMetadata, getEntitySet, underlyingType } from './schema.mjs';
import { digest, stable, formatted, fault } from './state.mjs';
import { datasetSemanticIdentity, validateDatasetSemantics } from '../dataset-semantics.mjs';

export const ODATA_SEMANTICS_SCHEMA = 'stellar-forge.odata-semantics.v1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => object(value) && Object.hasOwn(value, key);
const clone = value => structuredClone(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function need(value, message) {
  if (!value) throw fault('ODATA_SEMANTICS_INVALID', message, 409);
}
function physicalColumns(columns) {
  if (Array.isArray(columns)) return columns.map(({ name, type, nullable }) => ({ name, type, nullable }));
  need(object(columns), 'Use the original declared dataset columns.');
  return Object.entries(columns).map(([name, item]) =>
    typeof item === 'string' ? { name, type: item, nullable: false } :
      { name, type: item.type, nullable: item.nullable ?? false });
}
function sourceCatalog(edition, metadataBytes) {
  need(edition?.catalog && edition.query && Array.isArray(edition.pages),
    'Choose an original retained OData edition.');
  const receipt = edition.catalog.receipts?.metadata;
  need(hash(receipt?.sha256) && digest(metadataBytes) === receipt.sha256,
    'The CSDL must match the original retained metadata bytes.');
  const model = parseMetadata(metadataBytes, { contentType: receipt.headers?.['content-type'] ?? '',
    identifierDialect: edition.catalog.identifierDialect ?? 'odata' });
  const selected = getEntitySet(model, edition.query.plan.entitySet);
  need(selected.entityType === edition.query.entityType &&
    stable(selected.keyFields) === stable(edition.query.keyFields),
    'The retained CSDL entity type or complete keys differ from the reviewed query.');
  return { model, selected };
}
export function odataCaptureManifest(edition) {
  need(edition?.status === 'COMPLETE' && edition.nextLink === null && hash(edition.contentHash) &&
    Array.isArray(edition.pages) && edition.pages.reduce((count, page) => count + page.rowCount, 0) === edition.rowCount,
    'Finish the original source edition before publishing its semantic capture.');
  const receipts = edition.catalog.receipts;
  need(hash(receipts?.service?.sha256) && hash(receipts?.metadata?.sha256),
    'Retain the original service document and CSDL receipt.');
  return {
    schema: 'stellar-forge.odata-capture-manifest.v1',
    editionId: edition.id, serviceUrl: edition.catalog.serviceUrl,
    entitySet: edition.query.plan.entitySet, entityType: edition.query.entityType,
    catalogHash: edition.catalogHash, query: clone(edition.query.plan), queryUrl: edition.query.url,
    keyFields: clone(edition.query.keyFields), sourceCount: edition.sourceCount, rowCount: edition.rowCount,
    completedAt: edition.completedAt, contentHash: edition.contentHash,
    receipts: clone(receipts), pages: clone(edition.pages),
  };
}
function typeClosure(model, selected, fields) {
  const structuredTypes = {}, typeDefinitions = {}, enumTypes = {}, visiting = new Set();
  function include(name) {
    if (!name || name.startsWith('Edm.') || visiting.has(name)) return;
    visiting.add(name);
    const structure = model.entityTypes[name] ?? model.complexTypes[name];
    if (structure) {
      structuredTypes[name] = clone(structure);
      include(structure.baseType);
      // Structural members may carry nested types; navigation targets are separate entity sets.
      for (const property of structure.properties) include(property.type);
    } else if (model.typeDefinitions[name]) {
      typeDefinitions[name] = clone(model.typeDefinitions[name]);
      include(model.typeDefinitions[name].underlyingType);
    } else if (model.enumTypes[name]) enumTypes[name] = clone(model.enumTypes[name]);
  }
  include(selected.entityType);
  for (const field of fields) include(field.type);
  const inheritance = [];
  for (let name = selected.entityType; name; name = model.entityTypes[name]?.baseType ?? null) {
    need(!inheritance.includes(name), 'The retained entity inheritance contains a cycle.');
    inheritance.push(name);
  }
  return { entityType: selected.entityType, inheritance, structuredTypes, typeDefinitions, enumTypes };
}
/** A source preview from the original CSDL; raw metadata remains the authoritative companion. */
export function describeODataSemantics({ edition, metadataBytes }) {
  const { model, selected } = sourceCatalog(edition, metadataBytes);
  const available = new Map(selected.fields.map(field => [field.path, field]));
  const fields = edition.query.fields.map(selectedField => {
    const original = available.get(selectedField.path || selectedField.name);
    need(original, 'A reviewed field is absent from the retained CSDL.');
    return { ...clone(original), underlyingType: underlyingType(model, original.type),
      kind: model.complexTypes[original.type] ? 'complex' : model.enumTypes[original.type] ? 'enum' : 'scalar' };
  });
  return {
    schema: 'stellar-forge.odata-source-semantics.v1',
    source: { provider: 'odata4', serviceUrl: edition.catalog.serviceUrl,
      schemaUrl: edition.catalog.metadataUrl, schemaSha256: edition.catalog.receipts.metadata.sha256,
      protocolVersion: model.version, entityContainer: selected.container,
      entitySet: selected.name, entityType: selected.entityType },
    keyFields: clone(selected.keyFields), fields, csdl: typeClosure(model, selected, fields),
  };
}
function csvwDatatype(type) {
  return type === 'number' ? 'double' : type;
}
function valueMeaning(field, mapping) {
  const primitive = field.underlyingType;
  const structured = field.kind === 'complex';
  const encoding = mapping.collection || structured || /^Edm\.(Geography|Geometry)/.test(primitive) ? 'json' :
    ['Edm.Decimal', 'Edm.Int64'].includes(primitive) ? 'text' : 'native';
  let note = 'Original ' + field.type + ' property ' + field.path + '. ';
  if (encoding === 'json') note += 'The source value is retained as JSON text. ';
  else if (['Edm.Decimal', 'Edm.Int64'].includes(primitive))
    note += 'The exact source number text is retained, including decimal scale. ';
  else if (['Edm.Date', 'Edm.DateTimeOffset', 'Edm.TimeOfDay', 'Edm.Duration'].includes(primitive))
    note += 'The original temporal text is retained. ';
  note += mapping.name + '_state distinguishes value, null and missing.';
  return { encoding, note };
}
/** One dictionary describes every physical value and state column in the actual export. */
export function projectODataSemantics({ edition, metadataBytes, mapping, columns }) {
  const described = describeODataSemantics({ edition, metadataBytes });
  const capture = odataCaptureManifest(edition), captureManifestSha256 = digest(formatted(capture));
  need(Array.isArray(mapping) && mapping.length > 0 && mapping.length <= 32,
    'Use the reviewed OData value-to-column mapping.');
  const fields = new Map(described.fields.map(field => [field.path, field]));
  const physical = physicalColumns(columns), byName = new Map(physical.map(column => [column.name, column]));
  const used = new Set(), projected = [], aliases = new Map(), issues = [];
  for (const item of mapping) {
    const field = fields.get(item.path), column = byName.get(item.name), state = byName.get(item.name + '_state');
    need(field && column && state && !used.has(item.name) && !used.has(state.name) &&
      column.type === item.type && field.type === item.odataType && field.collection === item.collection &&
      state.type === 'string' && state.nullable === false,
      'The physical columns differ from their original OData projection.');
    used.add(item.name); used.add(state.name); aliases.set(item.path, item.name);
    const meaning = valueMeaning(field, item);
    const sourceDefinition = { ...clone(field), sourcePath: field.path,
      sourceEntityType: described.source.entityType };
    const definition = { name: item.name, titles: field.name, datatype: csvwDatatype(column.type),
      required: !column.nullable, null: column.nullable ? [''] : [],
      'dc:description': meaning.note };
    projected.push({
      ...column, sourceField: item.path, role: 'value', stateColumn: state.name,
      encoding: meaning.encoding, dictionary: { label: field.name, notes: meaning.note },
      sourceDefinition, projectedDefinition: definition, issues: [],
    });
    const presence = 'Presence of source property ' + item.path +
      ': value is present and non-null; null means the property or a traversed parent is null; missing means the property or a traversed parent is absent.';
    projected.push({
      ...state, sourceField: item.path, role: 'state', valueColumn: item.name,
      encoding: 'native', dictionary: { label: field.name + ' state', notes: presence },
      sourceDefinition: { sourcePath: item.path, role: 'source-presence',
        values: ['value', 'null', 'missing'], sourceNullable: field.nullable },
      projectedDefinition: { name: state.name, titles: field.name + ' state',
        datatype: { base: 'string', format: 'value|null|missing' }, required: true, null: [],
        'dc:description': presence }, issues: [],
    });
  }
  need(used.size === physical.length &&
    projected.every((column, index) => column.name === physical[index].name),
    'The semantic dictionary must cover the original physical columns in order.');
  const sourceKey = described.keyFields;
  const primaryKey = { source: sourceKey, projected: sourceKey.filter(path => aliases.has(path)).map(path => aliases.get(path)),
    complete: sourceKey.length > 0 && sourceKey.every(path => aliases.has(path)) };
  for (const field of sourceKey.filter(path => !aliases.has(path)))
    issues.push({ code: 'PRIMARY_KEY_FIELD_NOT_SELECTED', field, property: 'primaryKey',
      message: 'Retain every original CSDL key field to preserve complete entity identity.' });
  const tableSchema = { columns: projected.map(column => column.projectedDefinition),
    ...(primaryKey.complete ? { primaryKey: primaryKey.projected } : {}) };
  const { schemaSha256, ...sourceMeaning } = described.source;
  const definition = { schema: ODATA_SEMANTICS_SCHEMA, source: sourceMeaning,
    columns: projected, primaryKey, aboutUrl: { source: null, projected: null },
    virtualColumns: [], issues, csdl: described.csdl,
    csvw: { '@context': 'http://www.w3.org/ns/csvw', url: 'dataset.csv', tableSchema } };
  const definitionSha256 = datasetSemanticIdentity(definition);
  const payload = { ...definition, source: { ...sourceMeaning, schemaSha256, captureManifestSha256 },
    definitionSha256 };
  const document = { ...payload, sha256: datasetSemanticIdentity(payload) };
  validateDatasetSemantics(document, physical);
  return document;
}
export function compareODataSemantics(before, after) {
  const names = new Set([...before.columns, ...after.columns].map(column => column.name));
  const left = new Map(before.columns.map(column => [column.name, column]));
  const right = new Map(after.columns.map(column => [column.name, column]));
  return {
    changed: before.definitionSha256 !== after.definitionSha256,
    beforeDefinitionSha256: before.definitionSha256, afterDefinitionSha256: after.definitionSha256,
    fields: [...names].filter(name => stable(left.get(name) ?? null) !== stable(right.get(name) ?? null))
      .map(name => ({ name, before: left.get(name) ?? null, after: right.get(name) ?? null })),
    primaryKey: { before: clone(before.primaryKey), after: clone(after.primaryKey) },
    sourceDocumentChanged: before.source.schemaSha256 !== after.source.schemaSha256,
  };
}
