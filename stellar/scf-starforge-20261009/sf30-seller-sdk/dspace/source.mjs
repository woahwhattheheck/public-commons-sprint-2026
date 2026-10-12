// MIT. Exact retained DSpace sources and explicit customer projections.
import { createHash } from 'node:crypto';

export const SOURCE_SCHEMA = 'dspace-source-capture/v1';
export const PROJECTION_SCHEMA = 'stellar-forge.dspace-projection.v1';
export const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const canonical = v => JSON.stringify(v, (_, value) => object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value);
export const fault = (code, message, status = 400) => Object.assign(new Error(message), {code, status});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = /^[A-Za-z0-9_]+(?:[.][A-Za-z0-9_-]+){1,4}$/;
const HAS = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const text = (v, label, max = 10000) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0'))
    throw fault('DSPACE_TEXT_REQUIRED', label + ' must be nonempty text within ' + max + ' characters.');
  return v;
};
function url(value, base) {
  let u; try { u = new URL(value, base); } catch { throw fault('DSPACE_SOURCE_URL', 'The source contains an invalid URL.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
    throw fault('DSPACE_SOURCE_URL', 'Use an HTTP(S) source URL without embedded credentials.');
  return u.href;
}
function decode(bytes) {
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { throw fault('DSPACE_SOURCE_ENCODING', 'The retained source must be complete UTF-8 JSON.'); }
}
function parse(text, label) {
  try { return JSON.parse(text); } catch { throw fault('DSPACE_SOURCE_JSON', label + ' is not complete JSON.'); }
}
function metadata(value) {
  if (!object(value)) throw fault('DSPACE_METADATA', 'A selected item requires an original metadata object.');
  for (const [field, values] of Object.entries(value)) {
    if (!FIELD.test(field) || !Array.isArray(values))
      throw fault('DSPACE_METADATA', 'Original metadata fields must contain arrays: ' + field);
    for (const entry of values) {
      if (!object(entry) || !HAS(entry, 'value') || !(typeof entry.value === 'string' || entry.value === null))
        throw fault('DSPACE_METADATA_VALUE', 'A DSpace metadata value must retain its native string or null.');
      for (const key of ['language', 'authority'])
        if (HAS(entry, key) && entry[key] !== null && typeof entry[key] !== 'string')
          throw fault('DSPACE_METADATA_VALUE', 'Native ' + key + ' must be string or null.');
      for (const key of ['confidence', 'place'])
        if (HAS(entry, key) && entry[key] !== null && !Number.isSafeInteger(entry[key]))
          throw fault('DSPACE_METADATA_VALUE', 'Native ' + key + ' must be an exact safe integer or null.');
      const check = v => {
        if (typeof v === 'number' && (!Number.isFinite(v) || Number.isInteger(v) && !Number.isSafeInteger(v)))
          throw fault('DSPACE_METADATA_PRECISION', 'An unsupported numeric metadata property must be retained in its original source.');
        if (Array.isArray(v)) v.forEach(check);
        else if (object(v)) Object.values(v).forEach(check);
      };
      check(entry);
    }
  }
  return value;
}
function walk(value, visit, pointer = '', depth = 0, counter = {n: 0}) {
  if (++counter.n > 2000000 || depth > 100)
    throw fault('DSPACE_SOURCE_STRUCTURE', 'The source structure exceeds the supported traversal size.');
  if (!value || typeof value !== 'object') return;
  visit(value, pointer);
  for (const [key, child] of Object.entries(value))
    if (child && typeof child === 'object')
      walk(child, visit, pointer + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'), depth + 1, counter);
}
function exactBody(request) {
  if (request.body_text === undefined || request.body_text === null) return null;
  if (typeof request.body_text !== 'string') throw fault('DSPACE_SOURCE_BODY', 'Retain original body_text, not a reconstructed object.');
  const bytes = Buffer.from(request.body_text);
  if (request.body_bytes !== undefined && request.body_bytes !== null && request.body_bytes !== bytes.length ||
      request.body_sha256 !== undefined && request.body_sha256 !== null && request.body_sha256 !== hash(bytes))
    throw fault('DSPACE_SOURCE_DIGEST', 'An original response body differs from its recorded bytes or digest.');
  return {bytes: bytes.length, sha256: hash(bytes), text: request.body_text};
}
function title(item) {
  const name = item.name ?? item.metadata?.['dc.title']?.[0]?.value;
  if (typeof name === 'string' && name) return name;
  const first = item.metadata?.['person.givenName']?.[0]?.value;
  const last = item.metadata?.['person.familyName']?.[0]?.value;
  return [first, last].filter(v => typeof v === 'string' && v).join(' ') || item.uuid;
}

/** Import uses the original captured HTTP bodies. Unknown HTTP facts stay null.
 * Variants of one UUID remain separate and must be explicitly selected. */
export function inspectDspaceSource(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) throw fault('DSPACE_SOURCE_SIZE', 'Select a complete source capture up to 256 MiB.');
  const document = parse(decode(bytes), 'The source capture');
  if (!object(document) || document.schema !== SOURCE_SCHEMA || !Array.isArray(document.requests) ||
      !document.requests.length || document.requests.length > 100000)
    throw fault('DSPACE_SOURCE_FORMAT', 'Select the original dspace-source-capture/v1 export.');
  const baseUrl = url(text(document.base_url, 'Repository base URL', 4096));
  const scopeUuid = UUID.test(document.scope?.uuid ?? '') ? document.scope.uuid.toLowerCase() : null;
  const variants = new Map(), requests = [], scopeItems = new Set(), pages = [];
  for (let index = 0; index < document.requests.length; index++) {
    const request = document.requests[index];
    if (!object(request)) throw fault('DSPACE_SOURCE_REQUEST', 'Each captured request must be an object.');
    const requestUrl = url(text(request.url, 'Request URL', 32768), baseUrl);
    const body = exactBody(request);
    const status = request.status ?? null;
    if (status !== null && (!Number.isSafeInteger(status) || status < 100 || status > 599))
      throw fault('DSPACE_SOURCE_STATUS', 'A recorded HTTP status must be valid or unknown.');
    const method = request.method ?? 'GET';
    const requestId = String(request.id ?? index + 1);
    const reference = {request_id: requestId, request_index: index, method, url: requestUrl,
      status, started_at: request.started_at ?? null, received_at: request.received_at ?? null,
      body_finished_at: request.body_finished_at ?? null, source_mode: request.source_mode ?? document.source?.body_kind ?? null,
      body_sha256: body?.sha256 ?? null, body_bytes: body?.bytes ?? null, error: request.error ?? null};
    requests.push(reference);
    if (!body || method !== 'GET' || request.error || status !== null && (status < 200 || status > 299)) continue;
    const native = parse(body.text, 'Response ' + requestId);
    const scopeRead = scopeUuid && new URL(requestUrl).searchParams.get('scope')?.toLowerCase() === scopeUuid;
    const found = new Set();
    walk(native, (value, pointer) => {
      if (scopeRead && object(value.page) && Number.isSafeInteger(value.page.number) &&
          Number.isSafeInteger(value.page.totalElements) && Number.isSafeInteger(value.page.totalPages))
        pages.push({...value.page, request_index: index});
      if (!object(value) || value.type !== 'item' || !UUID.test(value.uuid ?? '') || !object(value.metadata)) return;
      metadata(value.metadata);
      const uuid = value.uuid.toLowerCase(), digest = hash(canonical(value)), key = uuid + ':' + digest;
      const origin = {...reference, pointer};
      if (!variants.has(key)) variants.set(key, {uuid, object_sha256: digest, object: value, origins: []});
      variants.get(key).origins.push(origin); found.add(uuid);
    });
    if (scopeRead) found.forEach(id => scopeItems.add(id));
  }
  if (document.source_manifest?.body_text !== undefined) {
    const m = document.source_manifest, b = Buffer.from(m.body_text);
    if (m.bytes !== undefined && b.length !== m.bytes || m.sha256 && hash(b) !== m.sha256)
      throw fault('DSPACE_SOURCE_MANIFEST', 'The original source manifest bytes differ from its digest.');
  }
  const items = [...variants.values()].map(record => ({...record, name: title(record.object),
    entity_type: record.object.metadata['dspace.entity.type']?.[0]?.value ?? null,
    fields: Object.keys(record.object.metadata).sort(),
    metadata_count: Object.values(record.object.metadata).reduce((n, values) => n + values.length, 0),
    in_scope: scopeItems.has(record.uuid)}));
  const unique = new Set(items.map(v => v.uuid));
  const repeated = [...unique].filter(uuid => items.filter(item => item.uuid === uuid).length > 1);
  const uniquePages = new Map(pages.map(page => [page.number, page]));
  const totals = new Set(pages.map(page => page.totalElements)), pageTotals = new Set(pages.map(page => page.totalPages));
  const nativeComplete = !!scopeUuid && totals.size === 1 && pageTotals.size === 1 &&
    scopeItems.size === [...totals][0] && uniquePages.size === [...pageTotals][0] &&
    [...uniquePages.keys()].sort((a,b) => a-b).every((number,index) => number === index);
  return {schema: 'stellar-forge.dspace-source.v1', id: 'source-' + hash(bytes), sha256: hash(bytes), bytes: bytes.length,
    name: typeof document.name === 'string' ? document.name : 'DSpace source', base_url: baseUrl,
    recorded_at: document.recorded_at ?? null, source: document.source ?? null,
    declared_scope: document.scope ?? null, scope: {uuid: scopeUuid, observed_items: scopeItems.size,
      observed_pages: [...uniquePages.values()], complete: nativeComplete,
      declared_complete: document.scope?.complete ?? null},
    item_count: unique.size, variant_count: items.length, conflicting_uuids: repeated,
    requests, items, original_file_count: Array.isArray(document.files) ? document.files.length : 0};
}

export const MODES = Object.freeze({
  items: ['item_uuid','item_name','entity_type_json','metadata_json','metadata_count','source_sha256','source_url'],
  'metadata-values': ['item_uuid','item_name','field','ordinal','value_json','properties_json','source_sha256','source_url']
});
const csvCell = value => '"' + String(value).replaceAll('"', '""') + '"';
export function encodeCsv(fields, rows) {
  return Buffer.from([fields.map(csvCell).join(','), ...rows.map(row => fields.map(key => csvCell(row[key])).join(','))].join('\n') + '\n');
}

/** A saved projection names every selected source variant and metadata field.
 * JSON cells preserve complete native arrays or complete value objects. */
export function projectDspaceSources(sources, input) {
  if (!object(input) || !Object.hasOwn(MODES, input.mode))
    throw fault('DSPACE_PROJECTION_MODE', 'Choose items or metadata-values.');
  const name = text(input.name, 'Dataset name', 128);
  if (!Array.isArray(input.selection) || !input.selection.length || input.selection.length > 10000)
    throw fault('DSPACE_SELECTION', 'Select 1–10,000 original item variants.');
  if (!Array.isArray(input.metadataFields) || !input.metadataFields.length || input.metadataFields.length > 256 ||
      input.metadataFields.some(field => typeof field !== 'string' || !FIELD.test(field)) ||
      new Set(input.metadataFields).size !== input.metadataFields.length)
    throw fault('DSPACE_FIELDS', 'Select unique original metadata fields.');
  if (!object(input.rights)) throw fault('DSPACE_RIGHTS', 'Retain the source attribution and the intended distribution basis.');
  const rights = {attribution: text(input.rights.attribution, 'Attribution', 16000),
    basis: text(input.rights.basis, 'Distribution basis', 16000),
    reference: input.rights.reference ? url(input.rights.reference) : null};
  const sourceMap = new Map(sources.map(s => [s.id, s])), selected = [], used = new Set();
  for (const choice of input.selection) {
    if (!object(choice)) throw fault('DSPACE_SELECTION', 'Select an original source item.');
    const source = sourceMap.get(choice.sourceId);
    if (!source) throw fault('DSPACE_SOURCE_MISSING', 'A selected source is absent from this workspace.');
    const item = source.items.find(v => v.uuid === choice.uuid?.toLowerCase() && v.object_sha256 === choice.objectSha256);
    if (!item) throw fault('DSPACE_OBJECT_CHANGED', 'Choose the exact original UUID and source variant.', 409);
    if (used.has(item.uuid)) throw fault('DSPACE_DUPLICATE_ITEM', 'Select one explicit source variant per item UUID.');
    used.add(item.uuid); selected.push({source, item});
  }
  const fields = [...input.metadataFields].sort();
  for (const field of fields)
    if (!selected.some(({item}) => HAS(item.object.metadata, field)))
      throw fault('DSPACE_FIELD_MISSING', 'The selected cohort has no original metadata field ' + field + '.');
  const rows = [], records = [];
  for (const {source, item} of selected) {
    const selectedMetadata = Object.fromEntries(fields.filter(field => HAS(item.object.metadata, field))
      .map(field => [field, item.object.metadata[field]]));
    const sourceUrl = url(item.object._links?.self?.href ?? item.origins[0].url);
    const common = {item_uuid: item.uuid, item_name: item.name, source_sha256: source.sha256, source_url: sourceUrl};
    if (input.mode === 'items') {
      const row = {...common, entity_type_json: JSON.stringify(item.entity_type), metadata_json: JSON.stringify(selectedMetadata),
        metadata_count: Object.values(selectedMetadata).reduce((n, values) => n + values.length, 0)};
      rows.push(row); records.push({key: item.uuid, row});
    } else {
      for (const field of fields)
        for (const [ordinal, value] of (selectedMetadata[field] ?? []).entries()) {
          const row = {...common, field, ordinal, value_json: JSON.stringify(value.value), properties_json: JSON.stringify(value)};
          rows.push(row); records.push({key: JSON.stringify([item.uuid, field, ordinal]), row});
        }
    }
  }
  if (!rows.length) throw fault('DSPACE_EMPTY_PROJECTION', 'The selected fields produce no customer rows.');
  const names = MODES[input.mode], csv = encodeCsv(names, rows);
  if (csv.length > 256 * 1024 * 1024 || rows.length > 1000000)
    throw fault('DSPACE_DATASET_LIMIT', 'The projection exceeds the original dataset engine limits.');
  const columns = Object.fromEntries(names.map(key => [key, ['ordinal','metadata_count'].includes(key) ? 'integer' : 'string']));
  const filters = ['item_uuid', ...(input.mode === 'metadata-values' ? ['field'] : [])];
  const sorts = ['item_uuid', ...(input.mode === 'metadata-values' ? ['field','ordinal'] : ['metadata_count'])];
  const config = {schema:'stellar-forge.csv-dataset.v1', file:'data.csv', name, columns, filters, sorts,
    ranges: input.mode === 'metadata-values' ? ['ordinal'] : ['metadata_count'],
    maxBytes: Math.max(csv.length, 1), maxRows: Math.max(rows.length, 1), maxCellChars: 1024 * 1024,
    defaultLimit: 20, maxLimit: 100, maxPageBytes: 900 * 1024};
  const selection = selected.map(({source,item}) => ({sourceId:source.id, uuid:item.uuid, objectSha256:item.object_sha256}));
  return {schema:PROJECTION_SCHEMA, name, mode:input.mode, selection, metadataFields:fields, rights,
    columns:names, rows, records, csv, config, source_ids:[...new Set(selection.map(s=>s.sourceId))],
    item_count:selected.length, row_count:rows.length};
}

export function compareDspaceEditions(before, after) {
  if (before.mode !== after.mode) throw fault('DSPACE_COMPARE_MODE', 'Compare editions with the same row form.');
  const left = new Map(before.records.map(v=>[v.key,v.row])), right = new Map(after.records.map(v=>[v.key,v.row]));
  const changes=[],source_changes=[];
  const substantive=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['source_sha256','source_url'].includes(key)));
  for (const [key,row] of left) {
    const next=right.get(key);
    if (!next) changes.push({key,kind:'removed',before:row,after:null});
    else {
      if(row.source_sha256!==next.source_sha256||row.source_url!==next.source_url)
        source_changes.push({key,before:{sha256:row.source_sha256,url:row.source_url},after:{sha256:next.source_sha256,url:next.source_url}});
      if(canonical(substantive(row))!==canonical(substantive(next)))changes.push({key,kind:'changed',before:row,after:next,
        fields:[...new Set([...Object.keys(row),...Object.keys(next)])].filter(field=>!['source_sha256','source_url'].includes(field)&&canonical(row[field])!==canonical(next[field]))});
    }
  }
  for (const [key,row] of right) if (!left.has(key)) changes.push({key,kind:'added',before:null,after:row});
  return {schema:'stellar-forge.dspace-comparison.v1', before_id:before.id,after_id:after.id,
    before_sha256:before.sha256,after_sha256:after.sha256,mode:before.mode,
    counts:{added:changes.filter(v=>v.kind==='added').length,removed:changes.filter(v=>v.kind==='removed').length,
      changed:changes.filter(v=>v.kind==='changed').length,provenance_changed:source_changes.length,unchanged:left.size-changes.filter(v=>v.kind!=='added').length},
    metadata_fields_before:before.metadataFields,metadata_fields_after:after.metadataFields,
    rights_before:before.rights,rights_after:after.rights,source_changes,changes};
}
