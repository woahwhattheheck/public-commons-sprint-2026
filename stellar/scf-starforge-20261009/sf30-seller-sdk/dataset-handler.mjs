// MIT. Query an operator-owned CSV snapshot through SF30's existing application seam.
// This module neither verifies payments nor signs, settles, or calls another service.
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = new Set(['string', 'integer', 'number', 'boolean']);
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const RESERVED = new Set(['constructor', 'prototype', '__proto__']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);

// MIT. One semantic identity contract for original typed dataset pages.
// The CSV/query/version engines retain their existing value and cursor behavior.
export const DATASET_SEMANTIC_SCHEMAS = Object.freeze([
  'stellar-forge.ckan-semantics.v1', 'stellar-forge.odata-semantics.v1',
]);
const HASH = /^[a-f0-9]{64}$/;
function need(condition, message) {
  if (!condition) throw Object.assign(new TypeError(message), { code: 'DATASET_SEMANTICS_INVALID' });
}
function canonical(value, depth = 0) {
  need(depth <= 128, 'Dataset semantic structure exceeds the supported nesting depth.');
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (object(value)) return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, canonical(value[key], depth + 1)]));
  need(value === null || typeof value === 'string' || typeof value === 'boolean' ||
    typeof value === 'number' && Number.isFinite(value), 'Dataset semantics require finite JSON values.');
  return value;
}
export function datasetSemanticIdentity(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function datasetSemanticHeader(binding) {
  return binding.schema === 'stellar-forge.ckan-semantics.v1'
    ? 'x-ckan-semantics-sha256' : 'x-dataset-semantics-sha256';
}
/** Validate the original physical declaration and both retained meaning identities. */
export function validateDatasetSemantics(value, columns) {
  if (value === undefined) return null;
  need(object(value) && DATASET_SEMANTIC_SCHEMAS.includes(value.schema) &&
    HASH.test(value.sha256 ?? '') && HASH.test(value.definitionSha256 ?? '') &&
    object(value.source) && HASH.test(value.source.captureManifestSha256 ?? '') &&
    (value.source.schemaSha256 === null || HASH.test(value.source.schemaSha256 ?? '')) &&
    Array.isArray(columns) && Array.isArray(value.columns) && value.columns.length === columns.length &&
    value.columns.length > 0 && value.columns.length <= 64 &&
    object(value.primaryKey) && Array.isArray(value.primaryKey.source) &&
    Array.isArray(value.primaryKey.projected) && typeof value.primaryKey.complete === 'boolean' &&
    object(value.aboutUrl) && Array.isArray(value.virtualColumns) && Array.isArray(value.issues) &&
    object(value.csvw) && object(value.csvw.tableSchema) && Array.isArray(value.csvw.tableSchema.columns),
    'Invalid retained dataset semantic document.');
  need(Buffer.byteLength(JSON.stringify(value)) <= 2 * 1024 * 1024,
    'Dataset semantic document exceeds 2 MiB.');
  const { sha256, definitionSha256, ...payload } = value;
  need(datasetSemanticIdentity({ ...payload, definitionSha256 }) === sha256,
    'Retained dataset semantic document digest changed.');
  const { captureManifestSha256, schemaSha256, ...sourceMeaning } = payload.source;
  need(datasetSemanticIdentity({ ...payload, source: sourceMeaning }) === definitionSha256,
    'Retained dataset semantic definition digest changed.');
  const names = new Set();
  for (let index = 0; index < columns.length; index++) {
    const meaning = value.columns[index], physical = columns[index];
    need(object(meaning) && object(physical) && meaning.name === physical.name &&
      !names.has(meaning.name) && meaning.type === physical.type &&
      meaning.nullable === physical.nullable && typeof meaning.sourceField === 'string' &&
      meaning.sourceField.length > 0 && ['native', 'text', 'json'].includes(meaning.encoding) &&
      object(meaning.projectedDefinition) && meaning.projectedDefinition.name === physical.name &&
      Array.isArray(meaning.issues), 'Retained semantic columns differ from the original dataset.');
    names.add(meaning.name);
  }
  const key = value.primaryKey;
  need([key.source, key.projected].every(list => list.every(name => typeof name === 'string' && name) &&
    new Set(list).size === list.length) && key.projected.every(name => names.has(name)) &&
    (!key.complete || key.source.length > 0 && key.source.length === key.projected.length),
    'Retained dataset semantic key is incomplete or changed.');
  if (value.schema === 'stellar-forge.odata-semantics.v1') {
    const source = value.source, csdl = value.csdl;
    need(source.provider === 'odata4' && ['4.0', '4.01'].includes(source.protocolVersion) &&
      ['serviceUrl', 'schemaUrl', 'entityContainer', 'entitySet', 'entityType'].every(name =>
        typeof source[name] === 'string' && source[name].length > 0) &&
      HASH.test(source.schemaSha256 ?? '') && object(csdl) &&
      csdl.entityType === source.entityType && Array.isArray(csdl.inheritance) &&
      csdl.inheritance.every(name => typeof name === 'string' && name) &&
      object(csdl.structuredTypes) && object(csdl.structuredTypes[source.entityType]) &&
      object(csdl.typeDefinitions) && object(csdl.enumTypes) && value.columns.length % 2 === 0,
      'Retained OData meaning requires its original source identifiers and CSDL types.');
    const valueColumns = new Map();
    for (let index = 0; index < value.columns.length; index += 2) {
      const column = value.columns[index], state = value.columns[index + 1], definition = column.sourceDefinition;
      need(column.role === 'value' && state.role === 'state' && column.stateColumn === state.name &&
        state.valueColumn === column.name && column.sourceField === state.sourceField &&
        state.type === 'string' && state.nullable === false && state.encoding === 'native' &&
        object(definition) && definition.sourcePath === column.sourceField &&
        definition.sourceEntityType === source.entityType && typeof definition.type === 'string' &&
        typeof definition.collection === 'boolean' && typeof definition.nullable === 'boolean' &&
        object(state.sourceDefinition) && state.sourceDefinition.sourcePath === column.sourceField &&
        state.sourceDefinition.role === 'source-presence' &&
        state.sourceDefinition.sourceNullable === definition.nullable &&
        datasetSemanticIdentity(state.sourceDefinition.values) === datasetSemanticIdentity(['value', 'null', 'missing']),
        'Retained OData value/state columns differ from their original source definition.');
      valueColumns.set(column.name, column);
    }
    need(key.projected.every(name => valueColumns.has(name)) &&
      (!key.complete || key.projected.every((name, index) =>
        valueColumns.get(name).sourceField === key.source[index])),
      'Retained OData entity keys must identify the corresponding value columns.');
  }
  const expected = [...value.columns.map(column => column.projectedDefinition),
    ...value.virtualColumns.map(column => {
      need(object(column) && (column.projectedDefinition === null || object(column.projectedDefinition)),
        'Invalid retained virtual column.');
      return column.projectedDefinition;
    }).filter(Boolean)];
  need(datasetSemanticIdentity(expected) === datasetSemanticIdentity(value.csvw.tableSchema.columns),
    'Retained CSVW definitions differ from the reviewed columns.');
  return { schema: value.schema, sha256, definitionSha256,
    captureManifestSha256: value.source.captureManifestSha256 };
}

const hash = text => createHash('sha256').update(text).digest('hex');
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const bad = message => { throw fail('INVALID_DATASET_QUERY', message); };
function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
function coerce(value, spec, label, quotedEmptyText = false) {
  if (value === '' && spec.nullable && !quotedEmptyText) return null;
  if (spec.type === 'string') return value;
  if (spec.type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  if (spec.type === 'integer' && /^-?(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)))
    return Number(value);
  if (spec.type === 'number' && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(value) && Number.isFinite(Number(value)))
    return Number(value);
  throw new TypeError(`${label} requires ${spec.type}${spec.nullable ? ' or an empty cell' : ''}`);
}

// Incremental CSV parser: quoted delimiters/newlines, escaped quotes, CRLF/LF/CR,
// and a final record without a newline. No eval, regex query engine, or dependencies.
function csvParser(onRecord, maxCellChars) {
  let row = [], quoteStates = [], quoted = false, cell = [], chunks = [], cellChars = 0, mode = 0, started = false, skipLF = false, first = true;
  const append = c => {
    cellChars += c.length; started = true;
    if (cellChars > maxCellChars) throw new RangeError('CSV cell exceeds maxCellChars');
    cell.push(c);
    // Bound temporary character references and retain flat strings between fields.
    if (cell.length === 2048) { chunks.push(cell.join('')); cell = []; }
  };
  const field = () => {
    if (cell.length) chunks.push(cell.join(''));
    row.push(chunks.join('')); quoteStates.push(quoted); quoted = false;
    cell = []; chunks = []; cellChars = 0; mode = 0; started = false;
    if (row.length > 256) throw new RangeError('CSV exceeds 256 columns');
  };
  const record = () => { field(); onRecord(row, quoteStates); row = []; quoteStates = []; };
  return {
    feed(text) {
      for (const c of text) {
        if (first) { first = false; if (c === '\uFEFF') continue; }
        if (skipLF) { skipLF = false; if (c === '\n') continue; }
        if (mode === 1) {
          if (c === '"') mode = 2; else append(c);
          continue;
        }
        if (mode === 2 && c === '"') { append('"'); mode = 1; continue; }
        if (c === ',') { field(); continue; }
        if (c === '\n' || c === '\r') { record(); skipLF = c === '\r'; continue; }
        if (mode === 2) throw new TypeError('CSV contains text after a closing quote');
        if (c === '"') {
          if (started) throw new TypeError('CSV quote must begin a field');
          mode = 1; started = true; quoted = true;
        } else append(c);
      }
    },
    end() {
      if (mode === 1) throw new TypeError('CSV contains an unterminated quoted field');
      if (started || cellChars || row.length || mode === 2) record();
    },
  };
}

// The SFTP source uses this same record parser before its reviewed projection.
export { csvParser as createCsvRecordParser };

/** Load one immutable snapshot. Only declared columns are retained and exposed. */
export async function loadCsvDataset({ file, name, columns, filters = [], ranges = [], sorts = [],
  maxBytes = 64 * 1024 * 1024, maxRows = 250000, maxCellChars = 65536,
  defaultLimit = 50, maxLimit = 250, maxPageBytes = 900 * 1024, semantics, nullEncoding = 'empty' } = {}) {
  if (!['empty', 'unquoted-empty'].includes(nullEncoding)) throw new TypeError('Choose empty or unquoted-empty CSV null encoding');
  if (typeof name !== 'string' || !name.trim() || name.length > 128 || /[\x00-\x1f\x7f]/.test(name))
    throw new TypeError('Dataset name must be printable text, 1–128 characters');
  if (typeof file !== 'string' && !(file instanceof URL)) throw new TypeError('An operator-owned CSV file is required');
  if (!object(columns) || !Object.keys(columns).length || Object.keys(columns).length > 64)
    throw new TypeError('Declare 1–64 exposed columns');
  const schema = Object.entries(columns).map(([key, raw]) => {
    const spec = typeof raw === 'string' ? { type: raw } : raw;
    if (!NAME.test(key) || RESERVED.has(key) || !object(spec) || !TYPES.has(spec.type) ||
        Object.keys(spec).some(k => !['type', 'nullable'].includes(k)) ||
        (spec.nullable !== undefined && typeof spec.nullable !== 'boolean'))
      throw new TypeError(`Invalid column declaration: ${key}`);
    return Object.freeze({ name: key, type: spec.type, nullable: spec.nullable ?? false });
  });
  const semanticDocument = semantics === undefined ? undefined : structuredClone(semantics);
  const semanticBinding = validateDatasetSemantics(semanticDocument, schema);
  const names = schema.map(s => s.name), byName = new Map(schema.map(s => [s.name, s]));
  if (!Array.isArray(filters) || filters.length > 8 || new Set(filters).size !== filters.length ||
      filters.some(key => !byName.has(key))) throw new TypeError('Choose up to eight unique exposed filter columns');
  filters = [...filters].sort();
  for (const [label, keys] of [['ranges', ranges], ['sorts', sorts]]) {
    if (!Array.isArray(keys) || keys.length > 8 || new Set(keys).size !== keys.length ||
        keys.some(key => !byName.has(key)))
      throw new TypeError(`${label} must contain up to eight unique exposed columns`);
  }
  if (ranges.some(key => byName.get(key).type === 'boolean'))
    throw new TypeError('Range filters require string, integer or number columns');
  ranges = [...ranges].sort(); sorts = [...sorts].sort();
  // Original SF30 Bazaar offers permit at most 32 advertised query parameters.
  if (3 + filters.length + 4 * ranges.length + (sorts.length ? 1 : 0) + (semanticBinding ? 1 : 0) > 32)
    throw new TypeError('Dataset capabilities exceed the native 32-query-parameter budget');
  integer(maxBytes, 'maxBytes', 1, 256 * 1024 * 1024);
  integer(maxRows, 'maxRows', 1, 1000000);
  integer(maxCellChars, 'maxCellChars', 1, 1024 * 1024);
  integer(maxLimit, 'maxLimit', 1, 1000);
  integer(defaultLimit, 'defaultLimit', 1, maxLimit);
  integer(maxPageBytes, 'maxPageBytes', 1024, 900 * 1024);
  const info = await stat(file);
  if (!info.isFile() || info.size > maxBytes) throw new TypeError('CSV must be a regular file within maxBytes');
  const rows = [], indexes = new Map(filters.map(key => [key, new Map()]));
  // Keep old snapshots/cursors byte-compatible when no new capability is enabled.
  const policy = { name, schema, filters, ...(ranges.length || sorts.length ? { ranges, sorts } : {}),
    ...(nullEncoding === 'unquoted-empty' ? { nullEncoding } : {}),
    ...(semanticBinding ? { semantics: semanticBinding.sha256 } : {}) };
  const digest = createHash('sha256').update(JSON.stringify(policy)).update('\0');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let headers, positions, recordNumber = 0, byteCount = 0;
  const parser = csvParser((cells, quoted) => {
    recordNumber++;
    if (!headers) {
      if (cells.some(h => h === '') || new Set(cells).size !== cells.length)
        throw new TypeError('CSV headers must be nonempty and unique');
      headers = cells;
      positions = names.map(key => {
        const i = headers.indexOf(key);
        if (i < 0) throw new TypeError(`CSV is missing declared column: ${key}`);
        return i;
      });
      return;
    }
    if (cells.length !== headers.length) throw new TypeError(`CSV record ${recordNumber} has a different column count`);
    if (rows.length >= maxRows) throw new RangeError('CSV exceeds maxRows');
    const row = Object.create(null);
    schema.forEach((spec, i) => {
      const value = cells[positions[i]], label = `CSV record ${recordNumber}, ${spec.name}`;
      if (nullEncoding === 'unquoted-empty' && value === '' && !quoted[positions[i]]) {
        if (!spec.nullable) throw new TypeError(`${label} requires a non-NULL value`);
        row[spec.name] = null;
      } else row[spec.name] = coerce(value, spec, label, nullEncoding === 'unquoted-empty' && quoted[positions[i]]);
    });
    for (const key of filters) {
      const index = indexes.get(key), value = row[key];
      if (!index.has(value)) index.set(value, []);
      index.get(value).push(rows.length);
    }
    rows.push(Object.freeze(row));
  }, maxCellChars);
  for await (const chunk of createReadStream(file)) {
    byteCount += chunk.length;
    if (byteCount > maxBytes) throw new RangeError('CSV exceeds maxBytes');
    digest.update(chunk); parser.feed(decoder.decode(chunk, { stream: true }));
  }
  parser.feed(decoder.decode()); parser.end();
  if (!headers) throw new TypeError('CSV requires a header record');
  const snapshot = digest.digest('hex');
  // One immutable index per ordered column; original record ID breaks equal-value ties.
  const compare = (a, b) => a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
  const ordered = new Map([...new Set([...ranges, ...sorts])].map(key => {
    const ids = Array.from({ length: rows.length }, (_, id) => id);
    ids.sort((a, b) => compare(rows[a][key], rows[b][key]) || a - b);
    let nonNull = ids.length;
    while (nonNull && rows[ids[nonNull - 1]][key] === null) nonNull--;
    return [key, { ids, nonNull }];
  }));
  function boundary(index, key, value, afterEqual) {
    let lo = 0, hi = index.nonNull;
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2);
      const c = compare(rows[index.ids[mid]][key], value);
      if (c < 0 || (afterEqual && c === 0)) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  function* candidateIds(view) {
    for (let i = view.start; i < view.end; i++) yield view.ids[i];
  }
  function* inOrder(key, direction) {
    const { ids, nonNull } = ordered.get(key);
    if (direction === 'asc') { yield* ids; return; }
    // Reverse groups, not records: descending ties retain CSV order; nulls stay last.
    let end = nonNull;
    while (end > 0) {
      let start = end - 1;
      while (start > 0 && rows[ids[start - 1]][key] === rows[ids[end - 1]][key]) start--;
      for (let i = start; i < end; i++) yield ids[i];
      end = start;
    }
    for (let i = nonNull; i < ids.length; i++) yield ids[i];
  }
  const description = Object.freeze({ name, snapshot, rowCount: rows.length,
    columns: Object.freeze(schema.map(s => Object.freeze({ ...s, filterable: filters.includes(s.name),
      ...(ranges.length || sorts.length ? { rangeFilterable: ranges.includes(s.name), sortable: sorts.includes(s.name) } : {}),
    }))),
    defaultLimit, maxLimit, order: 'csv-record-order',
    ...(nullEncoding === 'unquoted-empty' ? { nullEncoding } : {}),
    ...(semanticBinding ? { semanticSchema: semanticBinding.schema } : {}) });
  const describe = () => structuredClone(description);
  const rangeOps = ['gt', 'gte', 'lt', 'lte'];
  const permitted = new Set(['fields', 'limit', 'cursor', ...(semanticBinding ? ['semantics'] : []), ...filters.map(key => `where_${key}`),
    ...ranges.flatMap(key => rangeOps.map(op => `${op}_${key}`)), ...(sorts.length ? ['sort'] : [])]);
  const cached = new WeakMap();

  function prepare(query = {}) {
    if (!object(query)) bad('Query must contain scalar URL parameters');
    const entries = query instanceof URLSearchParams ? [...query] : Object.entries(query);
    const params = Object.create(null);
    for (const [key, value] of entries) {
      if (!permitted.has(key) || own(params, key)) bad('Unknown or repeated query parameter');
      if (typeof value !== 'string') bad('Each query parameter must occur once');
      params[key] = value;
    }
    if (own(params, 'semantics') && params.semantics !== semanticBinding?.sha256)
      throw fail('DATASET_SEMANTICS_CHANGED', 'Select the reviewed meaning of this retained dataset snapshot', 409);
    const fields = own(params, 'fields') ? params.fields.split(',') : names;
    if (!fields.length || new Set(fields).size !== fields.length || fields.some(key => !byName.has(key)))
      bad('fields must be a comma-separated selection of declared column names');
    const rawLimit = params.limit ?? String(defaultLimit);
    if (!/^[1-9][0-9]{0,6}$/.test(rawLimit)) bad('limit must be a positive integer');
    const limit = Number(rawLimit);
    if (limit > maxLimit) bad(`limit must not exceed ${maxLimit}`);
    const selectedFilters = [];
    for (const key of filters) {
      if (own(params, `where_${key}`)) {
        try { selectedFilters.push([key, coerce(params[`where_${key}`], byName.get(key), `where_${key}`)]); }
        catch (error) { bad(error.message); }
      }
    }
    const selectedRanges = [];
    for (const key of ranges) {
      if ((own(params, `gt_${key}`) && own(params, `gte_${key}`)) ||
          (own(params, `lt_${key}`) && own(params, `lte_${key}`)))
        bad(`Choose one lower and one upper range bound for ${key}`);
      for (const op of rangeOps) {
        const label = `${op}_${key}`;
        if (!own(params, label)) continue;
        let value;
        try { value = coerce(params[label], byName.get(key), label); }
        catch (error) { bad(error.message); }
        if (value === null) bad('Range bounds cannot be null; use equality to select nulls');
        selectedRanges.push([key, op, value]);
      }
    }
    let sort = null;
    if (own(params, 'sort')) {
      const desc = params.sort.startsWith('-'), key = desc ? params.sort.slice(1) : params.sort;
      if (!sorts.includes(key)) bad('sort must name one operator-enabled column, optionally prefixed with -');
      sort = { column: key, direction: desc ? 'desc' : 'asc', nulls: 'last', ties: 'csv-record-order' };
    }
    const queryHash = hash(JSON.stringify({ fields, filters: selectedFilters,
      ...(selectedRanges.length || sort ? { ranges: selectedRanges, sort } : {}) }));
    let offset = 0;
    if (own(params, 'cursor')) {
      const text = params.cursor;
      if (!/^[A-Za-z0-9_-]{1,512}$/.test(text)) bad('Invalid cursor');
      let cursor;
      try {
        const bytes = Buffer.from(text, 'base64url');
        if (bytes.toString('base64url') !== text) bad('Invalid cursor');
        cursor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch { bad('Invalid cursor'); }
      if (!object(cursor) || Object.keys(cursor).sort().join(',') !== 'n,q,s,v' || cursor.v !== 1 ||
          !Number.isSafeInteger(cursor.n) || cursor.n < 0 || typeof cursor.s !== 'string' || typeof cursor.q !== 'string')
        bad('Invalid cursor');
      if (cursor.s !== snapshot) throw fail('DATASET_SNAPSHOT_CHANGED', 'Start a new query against the current dataset snapshot', 409);
      if (cursor.q !== queryHash) bad('Cursor belongs to a different query, field selection or ordering');
      offset = cursor.n;
    }
    let candidates = null;
    const choose = view => {
      if (candidates === null || view.end - view.start < candidates.end - candidates.start) candidates = view;
    };
    for (const [key, value] of selectedFilters) {
      const ids = indexes.get(key).get(value) ?? [];
      choose({ ids, start: 0, end: ids.length });
    }
    for (const key of ranges) {
      const bounds = selectedRanges.filter(([column]) => column === key);
      if (!bounds.length) continue;
      const index = ordered.get(key);
      let start = 0, end = index.nonNull;
      for (const [, op, value] of bounds) {
        if (op === 'gt' || op === 'gte') start = boundary(index, key, value, op === 'gt');
        else end = boundary(index, key, value, op === 'lte');
      }
      choose({ ids: index.ids, start, end: Math.max(start, end) });
    }
    const matches = id => selectedFilters.every(([key, value]) => rows[id][key] === value) &&
      selectedRanges.every(([key, op, value]) => {
        const actual = rows[id][key];
        if (actual === null) return false;
        const c = compare(actual, value);
        return op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
      });
    let total = 0;
    const page = [];
    const project = id => Object.fromEntries(fields.map(key => [key, rows[id][key]]));
    if (!sort && !selectedRanges.length && candidates === null) {
      total = rows.length;
      for (let i = offset; i < Math.min(total, offset + limit); i++) page.push(project(i));
    } else {
      let scan;
      if (!sort && !selectedRanges.length && candidates !== null) {
        // Equality indexes already have CSV order; retain the original streaming path.
        scan = candidateIds(candidates);
      } else if (sort && (candidates === null || candidates.end - candidates.start > rows.length / 4)) {
        // Dense results walk a prebuilt ordered index, avoiding a per-page full sort.
        scan = inOrder(sort.column, sort.direction);
      } else if (candidates !== null) {
        // Selective equality/range results sort only their candidate record IDs.
        const ids = [...candidateIds(candidates)].filter(matches);
        if (sort) {
          const { column, direction } = sort;
          ids.sort((a, b) => {
            const av = rows[a][column], bv = rows[b][column];
            const c = compare(av, bv);
            return (av === null || bv === null || direction === 'asc' ? c : -c) || a - b;
          });
        } else ids.sort((a, b) => a - b);
        scan = ids;
      } else scan = rows.keys();
      for (const id of scan) {
        if (!matches(id)) continue;
        if (total >= offset && page.length < limit) page.push(project(id));
        total++;
      }
    }
    if (offset > total) bad('Cursor offset exceeds the filtered result count');
    const nextOffset = offset + page.length;
    const nextCursor = nextOffset < total ? Buffer.from(JSON.stringify({ v: 1, s: snapshot, q: queryHash, n: nextOffset })).toString('base64url') : null;
    const body = { schema: 'stellar-forge.dataset-page.v1', dataset: describe(), fields: [...fields],
      filters: Object.fromEntries(selectedFilters),
      ...(selectedRanges.length ? { ranges: selectedRanges.map(([column, operator, value]) => ({ column, operator, value })) } : {}),
      ...(sort ? { order: sort } : {}), rows: page,
      page: { limit, total, returned: page.length, nextCursor },
      ...(semanticBinding ? { semantics: structuredClone(semanticDocument) } : {}) };
    if (Buffer.byteLength(JSON.stringify(body)) > maxPageBytes)
      throw fail('DATASET_PAGE_TOO_LARGE', 'Use a smaller limit or select fewer fields', 413);
    return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8',
      'x-dataset-snapshot': snapshot,
      ...(semanticBinding ? { [datasetSemanticHeader(semanticBinding)]: semanticBinding.sha256 } : {}) }, body };
  }
  function errorResponse(error) {
    if (!error.code || ![400, 409, 413].includes(error.status)) throw error;
    return { status: error.status, body: { error: error.code, message: error.message } };
  }
  function admit(context) {
    try { cached.set(context, prepare(context.query)); return true; }
    catch (error) { return errorResponse(error); }
  }
  function handle(context) {
    try {
      const response = cached.get(context) ?? prepare(context.query);
      cached.delete(context);
      return response;
    } catch (error) { return errorResponse(error); }
  }
  return Object.freeze({ describe, admit, handle });
}

/** Resolve the CSV beside its operator-provided configuration, never from HTTP input. */
export async function loadDatasetConfig(configPath) {
  const path = configPath instanceof URL ? fileURLToPath(configPath) : resolve(configPath);
  const info = await stat(path);
  if (!info.isFile() || info.size > 65536) throw new TypeError('Dataset config must be a regular JSON file up to 64 KiB');
  const bytes = await readFile(path);
  if (bytes.length > 65536) throw new RangeError('Dataset config exceeds 64 KiB');
  const config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const keys = new Set(['schema', 'file', 'name', 'columns', 'filters', 'ranges', 'sorts', 'maxBytes', 'maxRows', 'maxCellChars', 'defaultLimit', 'maxLimit', 'maxPageBytes', 'semantics', 'nullEncoding']);
  if (!object(config) || config.schema !== 'stellar-forge.csv-dataset.v1' || typeof config.file !== 'string' ||
      !config.file || Object.keys(config).some(key => !keys.has(key))) throw new TypeError('Invalid csv-dataset.v1 configuration');
  return loadCsvDataset({ ...config, file: resolve(dirname(path), config.file) });
}
