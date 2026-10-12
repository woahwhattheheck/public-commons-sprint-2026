// MIT. Exact JSON-stat2 cells and original Eurostat dimension semantics.
export const EUROSTAT_SOURCE_SCHEMA = 'stellar-forge.eurostat-source.v1';
export const EUROSTAT_CAPTURE_SCHEMA = 'stellar-forge.eurostat-capture.v1';
export const EUROSTAT_QUERY_SCHEMA = 'stellar-forge.eurostat-query.v1';
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
export const MAX_CELLS = 250000;
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function fault(code, message = code, status = 400) { return Object.assign(new Error(message), { code, status }); }
export function need(ok, code, message, status) { if (!ok) throw fault(code, message, status); }
export const clone = value => JSON.parse(JSON.stringify(value));
export const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const stable = value => JSON.stringify(canonical(value));
export const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const INDEX = /^(?:0|[1-9][0-9]*)$/;
const has = (o, k) => Object.hasOwn(o, k);
class JsonNumber {
  constructor(text) { this.text = text; Object.freeze(this); }
}
function scalarText(value, label, { empty = true, maximum = 65536 } = {}) {
  need(typeof value === 'string' && (empty || value.length > 0) && value.length <= maximum &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value),
    'EUROSTAT_TEXT_INVALID', 'The original ' + label + ' must be valid Unicode text within its declared limit.');
  return value;
}
/** Parse the original numeric lexemes without first passing them through a double.
 * Duplicate object names and excessive nesting are rejected before interpretation. */
export function parseLosslessJson(text) {
  need(typeof text === 'string' && text.length <= MAX_RESPONSE_BYTES, 'EUROSTAT_JSON_SIZE', 'Use one complete JSON response within 32 MiB.');
  let at = 0, nodes = 0;
  const ws = () => { while (at < text.length && /[ \r\n\t]/.test(text[at])) at++; };
  function string() {
    const start = at++;
    for (; at < text.length; at++) {
      const c = text[at];
      if (c === '\\') { at++; continue; }
      if (c === '"') { at++; try { return scalarText(JSON.parse(text.slice(start, at)), 'JSON string'); } catch (error) { if (error.code) throw error; break; } }
      if (c.charCodeAt(0) < 32) break;
    }
    throw fault('EUROSTAT_JSON_INVALID', 'The original response contains an invalid JSON string.');
  }
  function value(depth) {
    need(depth <= 64 && ++nodes <= 2000000, 'EUROSTAT_JSON_COMPLEXITY', 'The response exceeds the supported JSON nesting or member count.');
    ws(); const c = text[at];
    if (c === '"') return string();
    if (c === '{') {
      at++; ws(); const out = Object.create(null);
      if (text[at] === '}') { at++; return out; }
      while (at < text.length) {
        ws(); need(text[at] === '"', 'EUROSTAT_JSON_INVALID', 'An object member name is required.');
        const key = string(); need(!has(out, key), 'EUROSTAT_JSON_DUPLICATE', 'Duplicate original JSON member: ' + key);
        ws(); need(text[at++] === ':', 'EUROSTAT_JSON_INVALID'); out[key] = value(depth + 1); ws();
        const close = text[at++]; if (close === '}') return out;
        need(close === ',', 'EUROSTAT_JSON_INVALID');
      }
    }
    if (c === '[') {
      at++; ws(); const out = [];
      if (text[at] === ']') { at++; return out; }
      while (at < text.length) {
        out.push(value(depth + 1)); ws(); const close = text[at++];
        if (close === ']') return out; need(close === ',', 'EUROSTAT_JSON_INVALID');
      }
    }
    for (const [token, decoded] of [['true', true], ['false', false], ['null', null]]) {
      if (text.slice(at, at + token.length) === token) { at += token.length; return decoded; }
    }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
    if (match) { at += match[0].length; return new JsonNumber(match[0]); }
    throw fault('EUROSTAT_JSON_INVALID', 'The original response is not complete valid JSON.');
  }
  const result = value(0); ws();
  need(at === text.length, 'EUROSTAT_JSON_TRAILING', 'The original JSON has trailing content.');
  return result;
}
export function losslessJson(value) {
  if (value instanceof JsonNumber) return value.text;
  if (Array.isArray(value)) return '[' + value.map(losslessJson).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).map(k => JSON.stringify(k) + ':' + losslessJson(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function integer(value, label, maximum = MAX_CELLS) {
  need(value instanceof JsonNumber, 'EUROSTAT_INTEGER_REQUIRED', 'The original ' + label + ' must be a JSON number.');
  const result = Number(value.text);
  need(Number.isSafeInteger(result) && result >= 0 && result <= maximum, 'EUROSTAT_INTEGER_RANGE', 'The original ' + label + ' exceeds the supported range.');
  return result;
}
function positionKeys(container, count, kind) {
  need(object(container), 'EUROSTAT_CELL_MAP', 'The original ' + kind + ' must be an array or position map.');
  return Object.keys(container).map(k => {
    need(INDEX.test(k) && Number.isSafeInteger(Number(k)) && Number(k) < count,
      'EUROSTAT_CELL_POSITION', 'An original ' + kind + ' position is outside its declared cube: ' + k);
    return k;
  });
}
function readCellValues(raw, count) {
  need(Array.isArray(raw) || object(raw), 'EUROSTAT_VALUES_REQUIRED', 'JSON-stat value must be an array or an object.');
  const metadataOnly = Array.isArray(raw) && raw.length === 0 && count > 0;
  if (Array.isArray(raw)) need(raw.length === count || metadataOnly, 'EUROSTAT_VALUE_LENGTH', 'A dense value array must cover the complete declared cube.');
  const keys = Array.isArray(raw) ? raw.map((_, i) => String(i)) : positionKeys(raw, count, 'value');
  const values = Object.create(null); let numericCount = 0, nullCount = 0;
  for (const key of keys) {
    const item = raw[key];
    need(item === null || item instanceof JsonNumber, 'EUROSTAT_VALUE_TYPE', 'Each observation must retain a JSON number or explicit null.');
    values[key] = item === null ? null : item.text;
    if (item === null) nullCount++; else numericCount++;
  }
  return { values, valueFormat: Array.isArray(raw) ? 'array' : 'object', metadataOnly,
    numericCount, nullCount, absentCount: count - keys.length };
}
function readStatuses(raw, count) {
  if (raw === undefined) return { statusFormat: 'absent', statuses: {} };
  if (typeof raw === 'string') return { statusFormat: 'global', globalStatus: scalarText(raw, 'status'), statuses: {} };
  need(Array.isArray(raw) || object(raw), 'EUROSTAT_STATUS_TYPE', 'Status must retain its native string, array or sparse object.');
  if (Array.isArray(raw)) need(raw.length === count, 'EUROSTAT_STATUS_LENGTH', 'A dense status array must cover the declared cube.');
  const keys = Array.isArray(raw) ? raw.map((_, i) => String(i)) : positionKeys(raw, count, 'status');
  const statuses = Object.create(null);
  for (const key of keys) {
    need(raw[key] === null || typeof raw[key] === 'string', 'EUROSTAT_STATUS_VALUE', 'Status values must be native strings or null.');
    statuses[key] = raw[key] === null ? null : scalarText(raw[key], 'status');
  }
  return { statusFormat: Array.isArray(raw) ? 'array' : 'object', statuses };
}
export function parseJsonStat(text, { maxCells = MAX_CELLS } = {}) {
  need(Number.isSafeInteger(maxCells) && maxCells >= 1 && maxCells <= MAX_CELLS, 'EUROSTAT_CELL_LIMIT');
  const raw = parseLosslessJson(text);
  need(object(raw), 'EUROSTAT_DATASET_REQUIRED');
  if (raw.warning || raw.error) {
    const payload = raw.warning || raw.error, status = payload?.status instanceof JsonNumber ? Number(payload.status.text) : Number(payload?.status);
    throw Object.assign(fault(status === 413 ? 'EUROSTAT_ASYNC_PENDING' : 'EUROSTAT_PROVIDER_ERROR',
      scalarText(payload?.label ?? 'Eurostat returned an original error response.', 'provider message'), status === 413 ? 409 : 422),
      { providerStatus: Number.isFinite(status) ? status : null, providerResponseJson: losslessJson(raw) });
  }
  need(raw.version === '2.0' && raw.class === 'dataset', 'EUROSTAT_JSONSTAT_VERSION', 'Use an original JSON-stat 2.0 dataset response.');
  need(Array.isArray(raw.id) && raw.id.length > 0 && raw.id.length <= 16 && new Set(raw.id).size === raw.id.length,
    'EUROSTAT_DIMENSIONS_INVALID', 'The cube needs its complete ordered dimension identities.');
  const ids = raw.id.map(x => scalarText(x, 'dimension ID', { empty: false, maximum: 128 }));
  need(Array.isArray(raw.size) && raw.size.length === ids.length && object(raw.dimension),
    'EUROSTAT_DIMENSIONS_INVALID');
  const size = raw.size.map((n, i) => integer(n, 'dimension size ' + ids[i]));
  let cellCount = 1;
  for (const n of size) { cellCount *= n; need(Number.isSafeInteger(cellCount) && cellCount <= maxCells, 'EUROSTAT_CUBE_TOO_LARGE',
    'Select a smaller complete source slice; this workspace supports up to ' + maxCells + ' declared cells.', 413); }
  const dimensions = ids.map((id, i) => {
    const dim = raw.dimension[id], category = dim?.category;
    need(object(dim) && object(category), 'EUROSTAT_DIMENSION_METADATA', 'Missing original dimension metadata: ' + id);
    const labels = category.label;
    need(labels === undefined || object(labels), 'EUROSTAT_CATEGORY_LABELS');
    let codes;
    if (Array.isArray(category.index)) codes = [...category.index];
    else if (object(category.index)) {
      const entries = Object.entries(category.index).map(([code, position]) => [code, integer(position, 'category position')]);
      need(new Set(entries.map(x => x[1])).size === entries.length, 'EUROSTAT_CATEGORY_POSITION_DUPLICATE');
      entries.sort((a, b) => a[1] - b[1]);
      need(entries.every((x, p) => x[1] === p), 'EUROSTAT_CATEGORY_POSITION_GAP');
      codes = entries.map(x => x[0]);
    } else {
      const keys = labels ? Object.keys(labels) : [];
      need(size[i] === 1 && keys.length === 1 || size[i] === 0 && keys.length === 0,
        'EUROSTAT_CATEGORY_INDEX_REQUIRED', 'Preserve the original category order for ' + id + '.');
      codes = keys;
    }
    need(codes.length === size[i] && new Set(codes).size === codes.length, 'EUROSTAT_CATEGORY_SIZE');
    const categories = codes.map((code, position) => {
      scalarText(code, 'category ID', { empty: false, maximum: 1024 });
      const label = labels && has(labels, code) ? scalarText(labels[code], 'category label') : code;
      return { code, position, label };
    });
    return { id, position: i, label: dim.label === undefined ? id : scalarText(dim.label, 'dimension label'),
      categories, metadataJson: losslessJson(dim) };
  });
  const vals = readCellValues(raw.value, cellCount), statuses = readStatuses(raw.status, cellCount);
  const meta = Object.fromEntries(Object.entries(raw).filter(([k]) => !['value', 'status'].includes(k)));
  const ext = raw.extension;
  const statusLabels = ext?.status?.label;
  const labels = object(statusLabels) ? Object.fromEntries(Object.entries(statusLabels).map(([k, v]) => [k, scalarText(v, 'status label')])) : {};
  return { schema: 'stellar-forge.eurostat-cube.v1', id: ids, size, cellCount, dimensions,
    label: raw.label === undefined ? '' : scalarText(raw.label, 'dataset label'),
    source: raw.source === undefined ? '' : scalarText(raw.source, 'source'),
    updated: raw.updated === undefined ? '' : scalarText(raw.updated, 'source update'),
    datasetCode: typeof ext?.id === 'string' ? ext.id : '',
    agencyId: typeof ext?.agencyId === 'string' ? ext.agencyId : '',
    metadataJson: losslessJson(meta), statusLabels: labels, ...vals, ...statuses };
}
export function inspectCube(cube) {
  const { values, statuses, ...summary } = cube;
  return { ...summary, state: cube.cellCount === 0 ? 'EMPTY_SELECTION' : cube.metadataOnly ? 'METADATA_ONLY' :
    cube.numericCount === 0 ? 'NO_OBSERVATIONS' : 'DATA',
    statusCount: cube.statusFormat === 'global' ? cube.cellCount : Object.keys(statuses).length };
}
export function cubeCell(cube, index) {
  need(Number.isSafeInteger(index) && index >= 0 && index < cube.cellCount, 'EUROSTAT_CELL_OUT_OF_RANGE');
  let remainder = index;
  const positions = new Array(cube.id.length);
  for (let d = cube.id.length - 1; d >= 0; d--) { positions[d] = remainder % cube.size[d]; remainder = Math.floor(remainder / cube.size[d]); }
  const dimensions = Object.fromEntries(cube.dimensions.map((dim, d) => [dim.id, dim.categories[positions[d]].code]));
  const labels = Object.fromEntries(cube.dimensions.map((dim, d) => [dim.id, dim.categories[positions[d]].label]));
  const present = has(cube.values, String(index)), value = present ? cube.values[index] : null;
  let status = null, statusState = 'ABSENT';
  if (cube.statusFormat === 'global') { status = cube.globalStatus; statusState = 'GLOBAL'; }
  else if (has(cube.statuses, String(index))) { status = cube.statuses[index]; statusState = status === null ? 'NULL' : 'PRESENT'; }
  return { index, dimensions, labels, value, valueState: !present ? 'ABSENT' : value === null ? 'NULL' : 'VALUE',
    status, statusState, statusLabel: status !== null && has(cube.statusLabels, status) ? cube.statusLabels[status] : null };
}
export function normalizeSelection(selection, cube) {
  need(object(selection) && Object.keys(selection).every(k => cube.id.includes(k)), 'EUROSTAT_SELECTION_DIMENSION',
    'Select actual dimension IDs from this original source.');
  return Object.fromEntries(cube.id.filter(k => has(selection, k)).map(k => {
    const codes = selection[k], dim = cube.dimensions.find(d => d.id === k);
    need(Array.isArray(codes) && codes.length > 0 && new Set(codes).size === codes.length &&
      codes.every(c => typeof c === 'string' && dim.categories.some(x => x.code === c)),
      'EUROSTAT_SELECTION_CATEGORY', 'Choose available original category codes for ' + k + '.');
    return [k, dim.categories.filter(c => codes.includes(c.code)).map(c => c.code)];
  }));
}
export function selectedCellIndexes(cube, selection = {}, { includeMissing = true } = {}) {
  selection = normalizeSelection(selection, cube);
  need(typeof includeMissing === 'boolean', 'EUROSTAT_MISSING_SELECTION');
  if (cube.metadataOnly) return [];
  const choices = cube.dimensions.map(dim => dim.categories.filter(c => !selection[dim.id] || selection[dim.id].includes(c.code)).map(c => c.position));
  const result = [];
  function walk(d, index) {
    if (d === choices.length) {
      if (includeMissing || has(cube.values, String(index)) && cube.values[index] !== null) result.push(index);
      return;
    }
    for (const pos of choices[d]) walk(d + 1, index * cube.size[d] + pos);
  }
  if (cube.cellCount) walk(0, 0);
  return result;
}
export function pageCube(cube, { selection = {}, includeMissing = true, offset = 0, limit = 100 } = {}) {
  need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000,
    'EUROSTAT_PAGE_INVALID');
  const indexes = selectedCellIndexes(cube, selection, { includeMissing });
  return { schema: 'stellar-forge.eurostat-cells-page.v1', total: indexes.length, offset, limit,
    next: offset + limit < indexes.length ? offset + limit : null,
    cells: indexes.slice(offset, offset + limit).map(i => cubeCell(cube, i)) };
}
export function queryColumns(cube) {
  const dimensions = cube.dimensions.flatMap((d, i) => [{ name: 'd' + i + '_code', kind: 'code', dimension: d.id, type: 'string', nullable: false },
    { name: 'd' + i + '_label', kind: 'label', dimension: d.id, type: 'string', nullable: false }]);
  return [{ name: 'cell_index', kind: 'index', type: 'integer', nullable: false }, ...dimensions,
    ...['value', 'value_state', 'status', 'status_state', 'dataset_code', 'source', 'source_updated'].map(name =>
      ({ name, kind: name, type: 'string', nullable: false }))];
}
export function cellRow(cube, index) {
  const cell = cubeCell(cube, index), row = { cell_index: String(index) };
  cube.dimensions.forEach((d, i) => { row['d' + i + '_code'] = cell.dimensions[d.id]; row['d' + i + '_label'] = cell.labels[d.id]; });
  return { ...row, value: cell.value ?? '', value_state: cell.valueState, status: cell.status ?? '',
    status_state: cell.statusState, dataset_code: cube.datasetCode, source: cube.source, source_updated: cube.updated };
}
export function normalizeQuery(value, cube) {
  need(object(value) && Object.keys(value).every(k => ['captureId', 'selection', 'includeMissing', 'review'].includes(k)),
    'EUROSTAT_QUERY_INVALID');
  need(typeof value.captureId === 'string' && /^[a-f0-9]{64}$/.test(value.captureId), 'EUROSTAT_CAPTURE_ID');
  need(cube.cellCount > 0 && !cube.metadataOnly && cube.numericCount > 0, 'EUROSTAT_DATA_SELECTION_REQUIRED',
    'This response has no usable observations. Keep its original metadata and select a populated source slice.');
  const selection = normalizeSelection(value.selection ?? {}, cube);
  const includeMissing = value.includeMissing ?? true;
  need(typeof includeMissing === 'boolean', 'EUROSTAT_MISSING_SELECTION');
  const review = value.review;
  need(object(review) && Object.keys(review).every(k => ['reviewer', 'note', 'use', 'rightsBasis', 'attribution', 'geographies', 'modifiedNotice'].includes(k)),
    'EUROSTAT_SOURCE_REVIEW_REQUIRED');
  const normalized = { reviewer: scalarText(review.reviewer, 'reviewer', { empty: false, maximum: 128 }),
    note: scalarText(review.note, 'source review', { empty: false, maximum: 4000 }),
    use: review.use, rightsBasis: scalarText(review.rightsBasis, 'source-specific reuse basis', { empty: false, maximum: 4000 }),
    attribution: scalarText(review.attribution, 'source attribution', { empty: false, maximum: 2000 }),
    modifiedNotice: scalarText(review.modifiedNotice ?? 'Selection and tabular presentation by the workspace operator. Eurostat is not responsible for these adaptations.', 'adaptation notice', { empty: false, maximum: 2000 }) };
  need(['commercial', 'noncommercial'].includes(normalized.use), 'EUROSTAT_REUSE_CHOICE');
  const geoDim = cube.dimensions.find(d => d.id.toLowerCase() === 'geo');
  const geographies = geoDim ? geoDim.categories.filter(c => !selection[geoDim.id] || selection[geoDim.id].includes(c.code)).map(c => c.code) : [];
  need(Array.isArray(review.geographies) && stable([...review.geographies].sort()) === stable([...geographies].sort()),
    'EUROSTAT_GEOGRAPHY_REVIEW', 'Retain the exact selected geography codes with their original reuse review.');
  normalized.geographies = geographies;
  return { captureId: value.captureId, selection, includeMissing, review: normalized };
}
export function compareCubes(before, after, { beforeSelection = {}, afterSelection = {}, offset = 0, limit = 100 } = {}) {
  need(stable([...before.id].sort()) === stable([...after.id].sort()), 'EUROSTAT_COMPARISON_DIMENSIONS',
    'The editions have different dimension identities; review their full metadata before selecting a comparable source.');
  need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000, 'EUROSTAT_PAGE_INVALID');
  const dims = [...before.id].sort();
  const key = cell => stable(dims.map(id => [id, cell.dimensions[id]]));
  const left = new Map(selectedCellIndexes(before, beforeSelection).map(i => { const c = cubeCell(before, i); return [key(c), c]; }));
  const right = new Map(selectedCellIndexes(after, afterSelection).map(i => { const c = cubeCell(after, i); return [key(c), c]; }));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort(compareText), changes = [];
  for (const k of keys) {
    const a = left.get(k), b = right.get(k);
    const result = !a ? 'ONLY_AFTER_SELECTION' : !b ? 'ONLY_BEFORE_SELECTION' :
      stable([a.valueState, a.value, a.statusState, a.status, a.labels]) !== stable([b.valueState, b.value, b.statusState, b.status, b.labels]) ? 'CHANGED' : 'UNCHANGED';
    if (result !== 'UNCHANGED') changes.push({ key: k, result, before: a ?? null, after: b ?? null });
  }
  const counts = {};
  for (const item of changes) counts[item.result] = (counts[item.result] ?? 0) + 1;
  return { schema: 'stellar-forge.eurostat-comparison.v1', matchedUniverse: keys.length, changes: changes.length,
    counts, beforeCoverage: beforeSelection, afterCoverage: afterSelection, beforeUpdated: before.updated, afterUpdated: after.updated,
    metadataChanged: before.metadataJson !== after.metadataJson, offset, limit, next: offset + limit < changes.length ? offset + limit : null,
    entries: changes.slice(offset, offset + limit) };
}
