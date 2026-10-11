// MIT. Validate native _source projection paths separately from search field capabilities.
// Provider contracts: https://docs.opensearch.org/latest/search-plugins/searching-data/retrieve-specific-fields/
// https://docs.opensearch.org/latest/mappings/metadata-fields/source/
// Matching follows OpenSearch XContentMapValues: '*' wildcards and matched-object descendants.
import { fail } from './wire.mjs';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const primitive = new Set(['text', 'match_only_text', 'keyword', 'constant_keyword', 'wildcard',
  'boolean', 'byte', 'short', 'integer', 'long', 'unsigned_long', 'half_float', 'float', 'double',
  'scaled_float', 'date', 'date_nanos', 'ip', 'binary', 'token_count', 'rank_feature']);

// Simple wildcard matching with a finite set of positions, without regex backtracking.
function matches(pattern, text, prefix = false) {
  pattern = pattern.replace(/\*+/g, '*');
  function closure(states) {
    const result = new Set(states);
    for (const position of result) if (pattern[position] === '*') result.add(position + 1);
    return result;
  }
  let states = closure([0]);
  for (const character of text) {
    const next = new Set();
    for (const position of states) {
      if (pattern[position] === '*') next.add(position);
      else if (pattern[position] === character) next.add(position + 1);
    }
    states = closure(next);
    if (!states.size) return false;
  }
  return prefix ? states.size > 0 : states.has(pattern.length);
}
const covers = (pattern, path) => matches(pattern, path) || matches(pattern + '.*', path);
function patterns(value, queryName) {
  if (value === undefined) return [];
  const items = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(items) || items.some(item => typeof item !== 'string'))
    fail('OPENSEARCH_SOURCE_FILTER_INVALID', queryName);
  return [...new Set(items)].sort();
}
function catalog(mapping, queryName) {
  const paths = new Map(), copied = new Map();
  let count = 0;
  function walk(properties, prefix = '', multifield = false, depth = 0) {
    if (properties === undefined) return;
    if (!record(properties) || depth > 64) fail('OPENSEARCH_MAPPING_INVALID', queryName);
    for (const [key, definition] of Object.entries(properties)) {
      if (!key || !record(definition) || ++count > 100000) fail('OPENSEARCH_MAPPING_INVALID', queryName);
      const path = prefix ? prefix + '.' + key : key;
      const entry = { kind: multifield ? 'multifield' : definition.type === 'alias' ? 'alias' : 'source',
        type: definition.type ?? (record(definition.properties) ? 'object' : null),
        ...(definition.enabled === false ? { unparsed: true } : {}) };
      if (paths.has(path) && JSON.stringify(paths.get(path)) !== JSON.stringify(entry))
        fail('OPENSEARCH_MAPPING_PATH_AMBIGUOUS', queryName);
      paths.set(path, entry);
      const targets = typeof definition.copy_to === 'string' ? [definition.copy_to] : definition.copy_to ?? [];
      if (!Array.isArray(targets) || targets.some(target => typeof target !== 'string'))
        fail('OPENSEARCH_MAPPING_INVALID', queryName);
      for (const target of targets) {
        if (!copied.has(target)) copied.set(target, new Set());
        copied.get(target).add(path);
      }
      walk(definition.properties, path, multifield, depth + 1);
      walk(definition.fields, path, true, depth + 1);
    }
  }
  walk(mapping.properties);
  return { paths, copied };
}

/**
 * Consume the unfiltered native GET /<indices>/_mapping response.
 * Returns only the selected projection contract, suitable for pinning and inspect().
 * Callers retain field-capability checks for search/sort types separately.
 * Missing optional source values are valid. Copy targets and unmapped/unparsed
 * source paths are described, because mappings cannot prove their document values.
 */
export function validateOpenSearchProjection(response, fields, { queryName } = {}) {
  if (!record(response) || !Object.keys(response).length ||
      !Array.isArray(fields) || !fields.length || fields.some(field => typeof field !== 'string' || !field))
    fail('OPENSEARCH_MAPPING_INVALID', queryName);
  const result = Object.create(null);
  for (const index of Object.keys(response).sort()) {
    const mapping = response[index]?.mappings;
    if (!record(mapping)) fail('OPENSEARCH_MAPPING_INVALID', queryName);
    const source = mapping._source ?? {};
    if (!record(source) || source.enabled !== undefined && typeof source.enabled !== 'boolean')
      fail('OPENSEARCH_MAPPING_INVALID', queryName);
    if (source.enabled === false) fail('OPENSEARCH_SOURCE_DISABLED', queryName);
    const includes = patterns(source.includes, queryName), excludes = patterns(source.excludes, queryName);
    const { paths, copied } = catalog(mapping, queryName), selected = Object.create(null);
    for (const field of fields) {
      const ancestors = field.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.'));
      const prohibited = ancestors.map(path => paths.get(path)).find(entry =>
        entry?.kind === 'alias' || entry?.kind === 'multifield');
      if (prohibited?.kind === 'alias') fail('OPENSEARCH_SOURCE_ALIAS_UNAVAILABLE', queryName);
      if (prohibited?.kind === 'multifield') fail('OPENSEARCH_SOURCE_MULTIFIELD_UNAVAILABLE', queryName);
      const definition = paths.get(field), canContainProperties = !primitive.has(definition?.type);
      if (excludes.some(pattern => covers(pattern, field)) ||
          includes.length && !includes.some(pattern => covers(pattern, field) ||
            canContainProperties && matches(pattern, field + '.', true)))
        fail('OPENSEARCH_SOURCE_FIELD_PRUNED', queryName);
      const unparsed = mapping.enabled === false || ancestors.some(path => paths.get(path)?.unparsed);
      selected[field] = { kind: unparsed ? 'unparsed-source' : definition ? 'source' : 'unmapped-source',
        type: definition?.type ?? null,
        ...(copied.has(field) ? { copyToSources: [...copied.get(field)].sort() } : {}),
        ...(record(mapping.derived) && Object.hasOwn(mapping.derived, field) ? { derivedField: true } : {}) };
    }
    result[index] = { source: { enabled: true, includes, excludes }, fields: selected };
  }
  return result;
}
