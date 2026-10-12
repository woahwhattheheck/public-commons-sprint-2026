// MIT. Preserve reviewed CKAN source meaning beside the unchanged dataset engine.
import { object, identity, digest, fault } from '../postgres/publisher/files.mjs';
import { parseCkanJson, ExactCkanNumber } from './capture.mjs';
import { compileQueries } from './declaration.mjs';

export const CKAN_SEMANTICS_SCHEMA = 'stellar-forge.ckan-semantics.v1';
const INHERITED = ['aboutUrl', 'propertyUrl', 'valueUrl', 'datatype', 'default',
  'lang', 'null', 'ordered', 'required', 'separator', 'textDirection'];
const POSITION_VARIABLES = new Set(['_row', '_sourceRow', '_column', '_sourceColumn']);
const RESERVED_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value, key) => object(value) && Object.hasOwn(value, key);
const meaningful = value => typeof value === 'string' ? Boolean(value.trim()) :
  Array.isArray(value) ? value.length > 0 : object(value) ? Object.keys(value).length > 0 : value !== null && value !== undefined;
const plain = value => {
  if (value instanceof ExactCkanNumber) return { exactJsonNumber: value.source };
  if (Array.isArray(value)) return value.map(plain);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  return value;
};
function issue(code, message, field, property) {
  return { code, message, ...(field ? { field } : {}), ...(property ? { property } : {}) };
}
function columnNames(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  if (!list.length || list.some(name => typeof name !== 'string' || !name || name.length > 512) ||
      new Set(list).size !== list.length) throw fault('CKAN_SEMANTIC_KEY_INVALID');
  return list;
}
function sourceAttribution(capture) {
  const pkg = capture.package ?? {}, resource = capture.resource ?? {};
  const text = value => typeof value === 'string' && value.trim() ? value : null;
  const translations = value => {
    const entries = object(value) ? Object.entries(value).filter(([, value]) => text(value) !== null) : [];
    return entries.length ? Object.fromEntries(entries) : null;
  };
  const packageDescription = text(pkg.notes), packageDescriptions = translations(pkg.notes_translated);
  const resourceDescription = text(resource.description);
  const resourceDescriptions = translations(resource.description_translated);
  const descriptionLanguage = packageDescription ? null :
    packageDescriptions?.en ? 'en' : Object.keys(packageDescriptions ?? {})[0] ?? null;
  return { catalogOrigin: capture.manifest.catalogOrigin, packageId: capture.manifest.packageId,
    resourceId: capture.manifest.resourceId, title: pkg.title ?? pkg.name ?? null,
    publisher: pkg.organization?.title ?? pkg.organization?.name ?? null,
    publisherDefinitions: pkg.dcat_publisher ?? null, creatorDefinitions: pkg.creator ?? null,
    license: { id: pkg.license_id ?? null, title: pkg.license_title ?? null, url: pkg.license_url ?? null },
    description: packageDescription ?? packageDescriptions?.[descriptionLanguage] ?? resourceDescription,
    descriptionLanguage, packageDescription, packageDescriptions, resourceDescription, resourceDescriptions };
}
function selectTable(document) {
  if (!object(document)) throw fault('CKAN_SEMANTIC_SCHEMA_INVALID', 'The retained CSVW document must be an object.');
  if (Array.isArray(document.tables)) {
    if (document.tables.length !== 1 || !object(document.tables[0]))
      throw fault('CKAN_SEMANTIC_TABLE_SELECTION_REQUIRED', 'Use a CSVW document containing the selected resource table.');
    return { document, table: document.tables[0] };
  }
  return { document, table: document };
}
export function describeCkanSemantics(capture) {
  const reference = capture.manifest.semanticSchema ?? null;
  let document = null, table = {}, schema = {}, definitions = [], issues = [];
  if (reference) {
    const raw = capture.rawFiles.get(reference.file);
    if (!raw || digest(raw) !== reference.sha256) throw fault('CKAN_SEMANTIC_SOURCE_CHANGED');
    ({ document, table } = selectTable(parseCkanJson(raw)));
    schema = object(table.tableSchema) ? table.tableSchema : {};
    if (!Array.isArray(schema.columns))
      throw fault('CKAN_SEMANTIC_COLUMNS_REQUIRED', 'The CSVW table needs an embedded tableSchema.columns array.');
    if (schema.columns.length > 1024) throw fault('CKAN_SEMANTIC_SCHEMA_TOO_LARGE');
    const seen = new Set();
    definitions = schema.columns.map(column => {
      if (!object(column) || typeof column.name !== 'string' || !column.name || column.name.length > 512 ||
          RESERVED_NAMES.has(column.name) || seen.has(column.name))
        throw fault('CKAN_SEMANTIC_COLUMN_INVALID', 'CSVW columns need unique explicit names.');
      seen.add(column.name);
      const inherited = {};
      for (const property of INHERITED) {
        for (const level of [document, table, schema, column]) {
          if (own(level, property)) inherited[property] = level[property];
        }
      }
      return { ...inherited, ...column };
    });
  }
  if (capture.manifest.semanticConsistency === 'semantics-changed')
    issues.push(issue('SOURCE_SCHEMA_CHANGED_DURING_CAPTURE', 'The provider changed its schema between the retained before and after responses.'));
  const byName = new Map(definitions.map(column => [column.name, column]));
  const fields = capture.fields.map(field => {
    const dictionary = object(field.info) ? plain(field.info) : null;
    const definition = byName.get(field.id);
    if (definition?.virtual === true) throw fault('CKAN_SEMANTIC_VIRTUAL_FIELD_CONFLICT');
    return { sourceField: field.id, providerType: field.type ?? null, dictionary,
      sourceDefinition: definition ? plain(definition) : null };
  });
  const names = new Set(fields.map(field => field.sourceField));
  for (const definition of definitions) {
    if (definition.virtual !== true && !names.has(definition.name))
      issues.push(issue('SOURCE_COLUMN_NOT_IN_CAPTURE', 'The CSVW column is absent from the retained DataStore fields.', definition.name));
  }
  const primaryKey = columnNames(schema.primaryKey ?? table.primaryKey ?? document?.primaryKey);
  for (const name of primaryKey) if (!names.has(name))
    issues.push(issue('SOURCE_KEY_NOT_IN_CAPTURE', 'The declared source key is absent from the retained DataStore fields.', name));
  const aboutUrl = schema.aboutUrl ?? table.aboutUrl ?? document?.aboutUrl ?? null;
  const context = document?.['@context'] ?? 'http://www.w3.org/ns/csvw';
  const value = { schema: 'stellar-forge.ckan-source-semantics.v1',
    hasDefinitions: Boolean(reference) || fields.some(field => field.dictionary && Object.values(field.dictionary).some(meaningful)),
    source: { ...plain(sourceAttribution(capture)), schemaUrl: reference?.url ?? null,
      schemaSha256: reference?.sha256 ?? null, dataUrl: typeof table.url === 'string' ? table.url : null },
    fields, primaryKey, aboutUrl, context: plain(context),
    virtualColumns: definitions.filter(column => column.virtual === true).map(plain), issues };
  // Metadata meaning has its own identity: row values, capture time and JSON whitespace do not alter it.
  value.definitionSha256 = identity({ ...value, source: { ...value.source, schemaSha256: undefined } });
  return value;
}
function rewriteTemplate(value, aliases, field, property, issues, baseUrl) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 16384) {
    issues.push(issue('SOURCE_TEMPLATE_INVALID', 'The source URI template is retained as an annotation only.', field, property));
    return null;
  }
  let valid = true;
  const rewritten = value.replace(/\{([^{}]*)\}/g, (_match, expression) => {
    let operator = '';
    if (/^[+#./;?&]/.test(expression)) { operator = expression[0]; expression = expression.slice(1); }
    if (!expression) { valid = false; return _match; }
    const variables = expression.split(',').map(variable => {
      const match = /^([^:*]+)(\*|:\d+)?$/.exec(variable);
      if (!match) { valid = false; return variable; }
      let source;
      try { source = decodeURIComponent(match[1]); } catch { valid = false; return variable; }
      if (POSITION_VARIABLES.has(source) || source === '_name') {
        valid = false;
        issues.push(issue('SOURCE_POSITION_TEMPLATE', 'The template depends on original source positions or names and remains source-only.', field, property));
        return variable;
      }
      const binding = aliases.get(source)?.[0], name = binding?.name;
      if (!name) {
        valid = false;
        issues.push(issue('TEMPLATE_FIELD_NOT_SELECTED', 'Select source field ' + source + ' to carry this URI template into the product schema.', field, property));
        return variable;
      }
      if (binding.encoding === 'json') {
        valid = false;
        issues.push(issue('JSON_TEMPLATE_VALUE_SOURCE_ONLY', 'The template refers to a JSON-encoded source value and remains source-only.', field, property));
        return variable;
      }
      if (name !== source && ['?', '&', ';'].includes(operator)) {
        valid = false;
        issues.push(issue('NAMED_TEMPLATE_ALIAS', 'Renaming this named URI parameter would change the source identifier; its template remains source-only.', field, property));
        return variable;
      }
      return name + (match[2] ?? '');
    });
    return '{' + operator + variables.join(',') + '}';
  });
  if (rewritten.replace(/\{[^{}]*\}/g, '').match(/[{}]/)) valid = false;
  if (!valid) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(rewritten)) return rewritten;
  if (!baseUrl || rewritten.startsWith('{')) {
    issues.push(issue('SOURCE_DYNAMIC_BASE_TEMPLATE', 'The source-relative template is retained for a consumer that expands the original source context.', field, property));
    return null;
  }
  try {
    const variables = [];
    const protectedUrl = rewritten.replace(/\{[^{}]*\}/g, value => {
      const name = 'CKANURIVARIABLE' + variables.length + 'END';
      variables.push([name, value]); return name;
    });
    let absolute = new URL(protectedUrl, baseUrl).href;
    for (const [name, value] of variables) absolute = absolute.replaceAll(name, value);
    return absolute;
  } catch {
    issues.push(issue('SOURCE_TEMPLATE_BASE_INVALID', 'The source template could not be resolved against its original table URL.', field, property));
    return null;
  }
}
function sourceTableUrl(context, schemaUrl, dataUrl) {
  const contexts = Array.isArray(context) ? context : [context];
  const base = contexts.find(value => object(value) && typeof value['@base'] === 'string')?.['@base'];
  try {
    const originalBase = base ? new URL(base, schemaUrl).href : schemaUrl;
    return dataUrl ? new URL(dataUrl, originalBase).href : originalBase;
  } catch { return null; }
}
function projectedContext(context) {
  // The projected table is package-local; URI templates are resolved against the original table separately.
  const contexts = (Array.isArray(context) ? context : [context]).map(value =>
    object(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== '@base')) : value
  ).filter(value => !object(value) || Object.keys(value).length);
  return contexts.length === 1 ? contexts[0] : contexts;
}
const STRING_DATATYPES = new Set(['string', 'normalizedString', 'token', 'language', 'Name',
  'NCName', 'NMTOKEN', 'anyURI', 'xml', 'html', 'json', 'date', 'time', 'datetime', 'dateTime',
  'dateTimeStamp', 'gYearMonth', 'gYear', 'gMonthDay', 'gDay', 'gMonth', 'duration',
  'dayTimeDuration', 'yearMonthDuration', 'binary', 'base64Binary', 'hexBinary']);
const INTEGER_DATATYPES = new Set(['integer', 'long', 'int', 'short', 'byte',
  'nonNegativeInteger', 'positiveInteger', 'nonPositiveInteger', 'negativeInteger',
  'unsignedLong', 'unsignedInt', 'unsignedShort', 'unsignedByte']);
const NUMBER_DATATYPES = new Set(['number', 'double', 'float', 'decimal']);
function hasExactMetadataNumber(value) {
  if (object(value) && Object.hasOwn(value, 'exactJsonNumber')) return true;
  return Array.isArray(value) ? value.some(hasExactMetadataNumber) :
    object(value) && Object.values(value).some(hasExactMetadataNumber);
}
function projectedDatatype(original, spec, issues) {
  const fallback = ({ number: 'double' })[spec.type] ?? spec.type;
  if (!Object.hasOwn(original, 'datatype')) return fallback;
  const datatype = original.datatype;
  const base = typeof datatype === 'string' ? datatype : object(datatype) ? datatype.base ?? 'string' : null;
  const retained = ' Its complete definition remains in sourceDefinition.';
  const sourceOnly = (code, message) => {
    issues.push(issue(code, message + retained, spec.field, 'datatype')); return fallback;
  };
  if (spec.encoding !== 'native')
    return sourceOnly('SOURCE_DATATYPE_ENCODING_CHANGED',
      'The published ' + spec.encoding + ' text does not carry the original CSVW datatype.');
  if (meaningful(original.separator))
    return sourceOnly('SOURCE_LIST_DATATYPE_SOURCE_ONLY',
      'The source CSVW datatype applies to separated list members; the selected contract publishes one scalar.');
  const compatible = ['any', 'anyAtomicType'].includes(base) ||
    spec.type === 'string' && STRING_DATATYPES.has(base) ||
    spec.type === 'boolean' && base === 'boolean' ||
    spec.type === 'integer' && (INTEGER_DATATYPES.has(base) || NUMBER_DATATYPES.has(base)) ||
    spec.type === 'number' && NUMBER_DATATYPES.has(base);
  if (!compatible)
    return sourceOnly('SOURCE_DATATYPE_TYPE_MISMATCH',
      'The source CSVW datatype ' + String(base) + ' is incompatible with the published ' + spec.type + ' scalar contract.');
  // Native strings retain their lexical value, including date/time format constraints.
  // Typed JSON numbers and booleans have already lost any original CSV-specific formatting.
  if (spec.type !== 'string' && object(datatype) && meaningful(datatype.format))
    return sourceOnly('SOURCE_DATATYPE_FORMAT_NOT_PRESERVED',
      'The source CSVW format describes an original lexical form that the typed JSON scalar does not retain.');
  if (hasExactMetadataNumber(datatype))
    return sourceOnly('SOURCE_DATATYPE_EXACT_CONSTRAINT_SOURCE_ONLY',
      'A source datatype constraint needs an exact JSON number representation that this schema annotation cannot emit.');
  return datatype;
}
export function projectCkanSemantics(capture, projection) {
  const source = describeCkanSemantics(capture);
  if (!source.hasDefinitions) return null;
  projection = compileQueries({ dataset: { projection } }).dataset.projection;
  const aliases = new Map();
  for (const [name, spec] of Object.entries(projection)) {
    if (!object(spec) || typeof spec.field !== 'string') throw fault('CKAN_COLUMN_DECLARATION_INVALID');
    aliases.set(spec.field, [...(aliases.get(spec.field) ?? []), { name, encoding: spec.encoding ?? 'native' }]);
  }
  const fields = new Map(source.fields.map(field => [field.sourceField, field]));
  const issues = [...source.issues];
  const baseUrl = sourceTableUrl(source.context, source.source.schemaUrl, source.source.dataUrl);
  const columns = Object.entries(projection).map(([name, spec]) => {
    const field = fields.get(spec.field);
    if (!field) throw fault('CKAN_SELECTED_FIELD_MISSING');
    const original = field.sourceDefinition ?? {};
    const localIssues = [];
    const projected = { name, datatype: projectedDatatype(original, spec, localIssues),
      required: !spec.nullable, null: spec.nullable ? [''] : [] };
    const title = original.titles ?? field.dictionary?.label ?? spec.field;
    if (title !== undefined) projected.titles = title;
    if (field.dictionary?.notes) projected['dc:description'] = field.dictionary.notes;
    for (const [key, value] of Object.entries(original)) {
      if (key.includes(':') && !key.startsWith('@')) projected[key] = value;
    }
    for (const property of ['aboutUrl', 'propertyUrl', 'valueUrl']) {
      const mapped = rewriteTemplate(original[property], aliases, spec.field, property, localIssues, baseUrl);
      if (mapped !== null) projected[property] = mapped;
    }
    if (original.suppressOutput === true) {
      // Inclusion is the operator's reviewed decision; the source directive remains explicit.
      localIssues.push(issue('SOURCE_SUPPRESSED_FIELD_SELECTED', 'The selected field was marked suppressOutput by the source.', spec.field));
    }
    if (spec.encoding !== 'native') {
      localIssues.push(issue('TEXT_ENCODED_SOURCE_VALUE', 'The published scalar preserves the source as ' + spec.encoding + ' text; the source datatype remains in sourceDefinition.', spec.field));
      // A JSON wrapper changes URI expansion values, so retain these mappings in the source description.
      if (spec.encoding === 'json' && Object.hasOwn(projected, 'valueUrl')) {
        delete projected.valueUrl;
        localIssues.push(issue('JSON_VALUE_TEMPLATE_SOURCE_ONLY', 'The original value URI applies to the decoded source value.', spec.field, 'valueUrl'));
      }
    }
    issues.push(...localIssues);
    return { name, sourceField: spec.field, type: spec.type, nullable: spec.nullable ?? false,
      encoding: spec.encoding ?? 'native', dictionary: field.dictionary, sourceDefinition: field.sourceDefinition,
      projectedDefinition: projected, issues: localIssues };
  });
  const missingKey = source.primaryKey.filter(name => !aliases.has(name));
  const primaryKey = { source: source.primaryKey,
    projected: source.primaryKey.filter(name => aliases.has(name)).map(name => aliases.get(name)[0].name),
    complete: source.primaryKey.length > 0 && missingKey.length === 0 };
  for (const name of missingKey) issues.push(issue('PRIMARY_KEY_FIELD_NOT_SELECTED',
    'Select the original key field to retain complete observation identity.', name, 'primaryKey'));
  const aboutUrl = { source: source.aboutUrl,
    projected: rewriteTemplate(source.aboutUrl, aliases, null, 'aboutUrl', issues, baseUrl) };
  const virtualColumns = source.virtualColumns.map(original => {
    const projected = { name: original.name, virtual: true };
    let valid = true;
    for (const property of ['aboutUrl', 'propertyUrl', 'valueUrl']) {
      if (original[property] === undefined) continue;
      const mapped = rewriteTemplate(original[property], aliases, original.name, property, issues, baseUrl);
      if (mapped === null) valid = false; else projected[property] = mapped;
    }
    if (Object.hasOwn(original, 'default')) projected.default = original.default;
    if (Object.hasOwn(original, 'datatype')) projected.datatype = original.datatype;
    if (columns.some(column => column.name === projected.name)) {
      valid = false; issues.push(issue('VIRTUAL_COLUMN_ALIAS_CONFLICT', 'The source virtual column name conflicts with a selected alias.', original.name));
    }
    return { sourceDefinition: original, projectedDefinition: valid ? projected : null };
  });
  const tableSchema = { columns: [...columns.map(column => column.projectedDefinition),
    ...virtualColumns.map(column => column.projectedDefinition).filter(Boolean)] };
  if (primaryKey.complete) tableSchema.primaryKey = primaryKey.projected;
  if (aboutUrl.projected !== null) tableSchema.aboutUrl = aboutUrl.projected;
  const csvw = { '@context': projectedContext(source.context),
    url: 'data.csv', tableSchema };
  const definition = { schema: CKAN_SEMANTICS_SCHEMA,
    source: { ...source.source }, columns, primaryKey, aboutUrl, virtualColumns, issues, csvw };
  const definitionSha256 = identity({ ...definition, source: { ...definition.source, schemaSha256: undefined } });
  const value = { ...definition, source: { ...definition.source, captureManifestSha256: capture.manifestSha256 },
    definitionSha256 };
  return { ...value, sha256: identity(value) };
}
export function checkCkanSemanticReview(capture, query) {
  if (!query.semanticReview) return null;
  const semantics = projectCkanSemantics(capture, query.projection);
  if (!semantics || query.semanticReview.sha256 !== semantics.sha256 ||
      query.semanticReview.definitionSha256 !== semantics.definitionSha256)
    throw fault('CKAN_SEMANTIC_REVIEW_CHANGED', 'Reload the retained source meaning and field selection before continuing.', 409);
  return semantics;
}
export function compareCkanSemantics(before, after) {
  const left = describeCkanSemantics(before), right = describeCkanSemantics(after);
  const l = new Map(left.fields.map(field => [field.sourceField, field]));
  const r = new Map(right.fields.map(field => [field.sourceField, field]));
  const fields = [];
  for (const name of new Set([...l.keys(), ...r.keys()])) {
    if (identity(l.get(name) ?? null) !== identity(r.get(name) ?? null))
      fields.push({ field: name, before: l.get(name) ?? null, after: r.get(name) ?? null });
  }
  const properties = [];
  for (const key of ['primaryKey', 'aboutUrl', 'virtualColumns', 'context', 'issues']) {
    if (identity(left[key]) !== identity(right[key])) properties.push({ property: key, before: left[key], after: right[key] });
  }
  const attribution = value => ({ ...value.source, schemaSha256: undefined });
  if (identity(attribution(left)) !== identity(attribution(right)))
    properties.push({ property: 'sourceAttribution', before: attribution(left), after: attribution(right) });
  return { changed: left.definitionSha256 !== right.definitionSha256,
    sourceDocumentChanged: left.source.schemaSha256 !== right.source.schemaSha256,
    beforeDefinitionSha256: left.definitionSha256, afterDefinitionSha256: right.definitionSha256, fields, properties };
}
