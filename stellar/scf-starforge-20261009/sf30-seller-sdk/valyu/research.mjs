// MIT. Valyu research views, edition comparisons and complete portable exports.
// Provider source: valyuAI/valyu-py@b735d8df4f612b603a61cd0613807d3f89bc814f.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {assertValyuDelivery} from './delivery.mjs';

export {assertValyuDelivery as assertResearchDelivery};
const DELIVERY_SCHEMA = 'stellar-forge.valyu-search-delivery.v1';
const EDITION_SCHEMA = 'stellar-forge.valyu-edition.v1';
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const hash = value => createHash('sha256').update(value).digest('hex');
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '') : null;
const scalar = value => typeof value === 'string' && value.trim() ? value : null;
const pretty = value => JSON.stringify(value, null, 2);
function requireValue(condition, code) {
  if (!condition) { const error = new Error(code); error.code = code; throw error; }
}

// Sort object keys only for semantic identity; retain array order and original
// JSON values. Saved byte hashes always use the actual response bytes instead.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

/** Return an HTTP(S) presentation link; the original URL remains in row.raw. */
export function safeHttpUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

const CITATION_FIELDS = ['id', 'title', 'url', 'doi', 'citation', 'citation_count', 'authors', 'publication_date', 'references'];
function identityFor(raw) {
  const source = scalar(raw?.source);
  if (scalar(raw?.id)) return {kind: 'provider-id', source, value: raw.id};
  if (scalar(raw?.url)) return {kind: 'url', source, value: raw.url};
  return {kind: 'content-hash', source, value: hash(canonical(raw))};
}

function rowFor(raw, index, {occurrenceId = null, disposition = 'immediate', duplicate = 0} = {}) {
  const valid = object(raw);
  const identity = identityFor(raw);
  const identityKey = canonical(identity);
  const present = valid && own(raw, 'content');
  const content = present ? raw.content : null;
  const contentType = !present ? 'missing' : typeof content === 'string' ? 'text' : Array.isArray(content) ? 'array' : object(content) ? 'object' : 'other';
  const citation = valid ? Object.fromEntries(CITATION_FIELDS.filter(key => own(raw, key)).map(key => [key, raw[key]])) : {};
  return {
    id: 'vr_' + hash(identityKey) + '_' + duplicate,
    occurrenceId, index, rank: index + 1, contentDisposition: disposition,
    identity, identityKey, fingerprint: hash(canonical(raw)),
    title: valid ? text(raw.title) : null,
    source: valid ? text(raw.source) : null,
    url: valid ? text(raw.url) : null,
    safeUrl: valid ? safeHttpUrl(raw.url) : null,
    description: valid ? text(raw.description) : null,
    contentType,
    contentText: present ? text(typeof content === 'string' ? content : pretty(content)) : '',
    content, citations: citation,
    authors: valid && Array.isArray(raw.authors) ? raw.authors.filter(author => typeof author === 'string').map(text) : [],
    citation: valid ? text(raw.citation) : null,
    doi: valid ? text(raw.doi) : null,
    publicationDate: valid ? text(raw.publication_date) : null,
    price: valid ? number(raw.price) : null,
    length: valid ? number(raw.length) : null,
    relevanceScore: valid ? number(raw.relevance_score) : null,
    valid, raw
  };
}

function withheldRow(entry, index) {
  const identity = {kind: 'occurrence', source: null, value: entry.occurrenceId};
  const identityKey = canonical(identity);
  return {
    id: 'vh_' + entry.occurrenceId, occurrenceId: entry.occurrenceId,
    index, rank: index + 1, contentDisposition: 'withheld', identity, identityKey,
    fingerprint: hash(canonical(entry)), title: null, source: null, url: null,
    safeUrl: null, description: null, contentType: 'withheld', contentText: '',
    content: null, citations: {}, authors: [], citation: null, doi: null,
    publicationDate: null, price: null, length: null, relevanceScore: null,
    valid: true, raw: null
  };
}

function summarize(rows, payload, delivered, warnings) {
  const sourceMap = new Map();
  const contentTypes = {};
  let missingSourceCount = 0;
  for (const row of rows) {
    contentTypes[row.contentType] = (contentTypes[row.contentType] ?? 0) + 1;
    if (row.contentDisposition === 'withheld') continue;
    const source = scalar(row.raw?.source);
    if (!source) { missingSourceCount++; continue; }
    if (!sourceMap.has(source)) sourceMap.set(source, {source, resultCount: 0, pricedResultCount: 0, listedResultPricesDollars: null, characterLength: null, lengthResultCount: 0});
    const item = sourceMap.get(source);
    item.resultCount++;
    if (row.price !== null) { item.pricedResultCount++; item.listedResultPricesDollars = (item.listedResultPricesDollars ?? 0) + row.price; }
    if (row.length !== null) { item.lengthResultCount++; item.characterLength = (item.characterLength ?? 0) + row.length; }
  }
  const usage = delivered ? payload.provider.usage : payload ?? {};
  return {
    resultCount: rows.length,
    retainedResultCount: delivered ? rows.filter(row => row.contentDisposition === 'durable').length : 0,
    immediateResultCount: delivered ? 0 : rows.length,
    withheldResultCount: rows.filter(row => row.contentDisposition === 'withheld').length,
    invalidResultCount: rows.filter(row => !row.valid).length,
    sourceCount: sourceMap.size, missingSourceCount,
    sourceSummaryScope: delivered ? 'retained-results' : 'immediate-results',
    unknownSourceResultCount: missingSourceCount + rows.filter(row => row.contentDisposition === 'withheld').length,
    sources: [...sourceMap.values()].sort((a, b) => a.source.localeCompare(b.source, 'en')),
    contentTypes,
    citedResultCount: rows.filter(row => Object.keys(row.citations).some(key => !['id', 'title'].includes(key) && row.citations[key] !== null)).length,
    warningCount: warnings.length,
    providerWarningCount: delivered ? payload.provider.warningCount ?? null : Array.isArray(payload?.warnings) ? payload.warnings.length : 0,
    providerErrorPresent: delivered ? payload.provider.errorPresent ?? null : payload?.error !== undefined && payload.error !== null && payload.error !== '',
    usage: {
      totalDeductionDollars: number(delivered ? usage.totalDeductionDollars : usage.total_deduction_dollars),
      totalCharacters: number(delivered ? usage.totalCharacters : usage.total_characters),
      providerResultCount: delivered ? number(usage.resultCount) : null,
      resultsBySource: !delivered && object(payload?.results_by_source) ? payload.results_by_source : null
    }
  };
}

/** Analyze a delivered envelope, or a raw native response for immediate use.
 * Rendering fields are text values, never trusted HTML. row.raw retains the
 * entire allowed original result, including future fields and content unions.
 */
export function analyzeValyuResponse(payload) {
  const delivered = object(payload) && payload.schema === DELIVERY_SCHEMA;
  if (delivered) assertValyuDelivery(payload);
  const validRoot = object(payload);
  const success = delivered ? payload.provider.success : validRoot && typeof payload.success === 'boolean' ? payload.success : null;
  const results = validRoot && Array.isArray(payload.results) ? payload.results : [];
  const warnings = validRoot && Array.isArray(payload.warnings) ? payload.warnings.map(value => text(typeof value === 'string' ? value : pretty(value))) : [];
  if (!delivered && success === true && payload?.error !== undefined && payload.error !== null && payload.error !== '') {
    warnings.push(text(typeof payload.error === 'string' ? payload.error : pretty(payload.error)));
  }
  const issues = [];
  if (!validRoot) issues.push('RESPONSE_OBJECT_REQUIRED');
  if (success === null) issues.push('PROVIDER_SUCCESS_REQUIRED');
  if (!Array.isArray(payload?.results)) issues.push('RESULTS_ARRAY_REQUIRED');
  const counts = new Map();
  const rows = results.map((entry, index) => {
    if (delivered && entry.contentDisposition === 'withheld') return withheldRow(entry, index);
    const raw = delivered ? entry.result : entry;
    const key = canonical(identityFor(raw));
    const duplicate = counts.get(key) ?? 0;
    counts.set(key, duplicate + 1);
    return rowFor(raw, index, {occurrenceId: delivered ? entry.occurrenceId : null, disposition: delivered ? 'durable' : 'immediate', duplicate});
  });
  if (rows.some(row => !row.valid)) issues.push('RESULT_OBJECT_REQUIRED');
  const status = success === false ? 'error' : issues.length ? 'invalid' : rows.length ? 'success' : 'empty';
  return {
    status, success, delivered, httpStatus: delivered ? payload.provider.httpStatus ?? null : null,
    txId: delivered ? payload.provider.txId : validRoot ? text(payload.tx_id) : null,
    query: delivered ? payload.request : validRoot ? payload.query ?? null : null,
    error: success === false ? payload.error ?? 'PROVIDER_SEARCH_FAILED' : null,
    warnings, issues, rows, summary: summarize(rows, payload, delivered, warnings),
    delivery: delivered ? payload.delivery : null,
    retentionMode: delivered ? payload.delivery.retentionMode : 'immediate',
    validUntil: delivered ? payload.delivery.validUntil : null,
    agreementReference: delivered ? payload.delivery.agreementReference : null,
    upstreamSha256: delivered ? payload.provider.upstreamSha256 : null,
    raw: payload
  };
}

function fieldChanges(before, after) {
  if (!object(before) || !object(after)) return isDeepStrictEqual(before, after) ? [] : ['result'];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter(key => own(before, key) !== own(after, key) || !isDeepStrictEqual(before[key], after[key]));
}

/** Compare retained originals by identity, preserving distinct duplicate rows.
 * Exact duplicate content pairs first, so a ranking change alone stays unchanged.
 * URL fallback can bridge a missing ID, but never overrides conflicting IDs.
 */
export function compareValyuResponses(leftPayload, rightPayload) {
  const left = analyzeValyuResponse(leftPayload), right = analyzeValyuResponse(rightPayload);
  const before = new Set(left.rows), after = new Set(right.rows);
  const pairs = [];
  const pair = (a, b, matchedBy) => { before.delete(a); after.delete(b); pairs.push({a, b, matchedBy}); };
  const keys = new Set([...left.rows, ...right.rows].map(row => row.identityKey));
  for (const key of keys) {
    const l = left.rows.filter(row => row.identityKey === key);
    const r = right.rows.filter(row => row.identityKey === key);
    for (const a of l) {
      const b = r.find(value => after.has(value) && value.fingerprint === a.fingerprint);
      if (b) pair(a, b, a.identity.kind);
    }
    const restLeft = l.filter(row => before.has(row)), restRight = r.filter(row => after.has(row));
    for (let i = 0; i < Math.min(restLeft.length, restRight.length); i++) pair(restLeft[i], restRight[i], restLeft[i].identity.kind);
  }
  for (const a of [...before]) {
    if (!a.occurrenceId) continue;
    const sameOccurrence = [...after].find(b => b.occurrenceId === a.occurrenceId);
    if (sameOccurrence) pair(a, sameOccurrence, 'occurrence');
  }
  for (const a of [...before]) {
    if (a.contentDisposition === 'withheld' || !scalar(a.raw?.url)) continue;
    const compatible = [...after].filter(b => b.contentDisposition !== 'withheld' && b.raw?.url === a.raw.url && scalar(b.raw?.source) === scalar(a.raw?.source) && (!scalar(a.raw?.id) || !scalar(b.raw?.id)));
    if (compatible.length !== 1) continue;
    const b = compatible[0];
    const reverse = [...before].filter(value => value.contentDisposition !== 'withheld' && value.raw?.url === b.raw.url && scalar(value.raw?.source) === scalar(b.raw?.source) && (!scalar(value.raw?.id) || !scalar(b.raw?.id)));
    if (reverse.length === 1) pair(a, b, 'url-fallback');
  }
  const changed = [], unchanged = [];
  for (const {a, b, matchedBy} of pairs) {
    const fields = fieldChanges(a.raw, b.raw);
    if (a.contentDisposition !== b.contentDisposition) fields.push('contentDisposition');
    const item = {before: a, after: b, matchedBy, changedFields: fields, moved: a.index !== b.index};
    (fields.length ? changed : unchanged).push(item);
  }
  const added = [...after], removed = [...before];
  const sourceChanges = [...new Set([...left.summary.sources, ...right.summary.sources].map(item => item.source))].sort().map(source => {
    const prior = left.summary.sources.find(item => item.source === source)?.resultCount ?? 0;
    const current = right.summary.sources.find(item => item.source === source)?.resultCount ?? 0;
    return {source, before: prior, after: current, delta: current - prior};
  });
  const delta = key => left.summary.usage[key] === null || right.summary.usage[key] === null ? null : right.summary.usage[key] - left.summary.usage[key];
  return {
    added, removed, changed, unchanged,
    summary: {added: added.length, removed: removed.length, changed: changed.length, unchanged: unchanged.length,
      moved: pairs.filter(({a, b}) => a.index !== b.index).length,
      leftStatus: left.status, rightStatus: right.status,
      leftResultCount: left.rows.length, rightResultCount: right.rows.length,
      opaqueAdded: added.filter(row => row.contentDisposition === 'withheld').length,
      opaqueRemoved: removed.filter(row => row.contentDisposition === 'withheld').length},
    sourceChanges,
    usageChange: {totalDeductionDollars: delta('totalDeductionDollars'), totalCharacters: delta('totalCharacters')},
    queryChanged: !isDeepStrictEqual(left.query, right.query),
    providerStatusChanged: left.success !== right.success,
    warningsChanged: !isDeepStrictEqual(left.warnings, right.warnings),
    deliveryChanged: !isDeepStrictEqual(left.delivery, right.delivery),
    left: {status: left.status, txId: left.txId, summary: left.summary, delivery: left.delivery},
    right: {status: right.status, txId: right.txId, summary: right.summary, delivery: right.delivery},
    scope: 'retained-originals-and-opaque-occurrences'
  };
}

function editionForExport(input) {
  const edition = object(input?.manifest) ? input.manifest : input;
  requireValue(object(edition) && edition.schema === EDITION_SCHEMA && object(edition.response) && object(edition.query), 'RESEARCH_EDITION_REQUIRED');
  const response = edition.response;
  assertValyuDelivery(response.payload);
  requireValue(typeof response.bodyBase64 === 'string', 'EDITION_EXACT_RESPONSE_REQUIRED');
  const raw = Buffer.from(response.bodyBase64, 'base64');
  requireValue(raw.toString('base64') === response.bodyBase64 && raw.length === response.bytes && hash(raw) === response.sha256, 'EDITION_RESPONSE_CHANGED');
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw)); }
  catch { requireValue(false, 'EDITION_RESPONSE_JSON_INVALID'); }
  requireValue(isDeepStrictEqual(parsed, response.payload), 'EDITION_PAYLOAD_CHANGED');
  requireValue(isDeepStrictEqual(parsed.request, edition.query.input), 'EDITION_REQUEST_CHANGED');
  requireValue(hash(Buffer.from(JSON.stringify(edition.query.input))) === edition.query.requestSha256, 'EDITION_REQUEST_CHANGED');
  return {edition, view: analyzeValyuResponse(parsed)};
}

const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const md = value => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]{}<>#!|]/g, '\\$&');
function fence(value, language = 'json') {
  const content = typeof value === 'string' ? value : pretty(value);
  const marker = String.fromCharCode(96);
  let longest = 0, count = 0;
  for (const char of content) { count = char === marker ? count + 1 : 0; longest = Math.max(longest, count); }
  const boundary = marker.repeat(Math.max(3, longest + 1));
  return boundary + language + '\n' + content + '\n' + boundary;
}

function metadata(edition, view) {
  return {editionId: edition.id, title: edition.title, createdAt: edition.createdAt,
    capturedAt: edition.response.capturedAt, status: view.status, httpStatus: view.httpStatus,
    txId: view.txId, responseSha256: edition.response.sha256, responseBytes: edition.response.bytes,
    upstreamSha256: view.upstreamSha256, retentionMode: view.retentionMode,
    validUntil: view.validUntil, agreementReference: view.agreementReference,
    delivery: view.delivery, provenance: edition.response.provenance};
}

function markdownEdition(edition, view) {
  const sections = ['# ' + md(edition.title || 'Research edition'),
    '## Edition', fence(metadata(edition, view)),
    '## Search request', fence(edition.query.input),
    '## Source and usage summary', fence(view.summary)];
  if (view.warnings.length) sections.push('## Delivery warnings', fence(view.warnings));
  for (const row of view.rows) {
    sections.push('## Result ' + row.rank + (row.title ? ': ' + md(row.title) : ''));
    sections.push('Disposition: ' + md(row.contentDisposition) + '.');
    if (row.occurrenceId) sections.push('Occurrence: ' + md(row.occurrenceId));
    if (row.safeUrl) sections.push('[Open original source](<' + row.safeUrl.replace(/>/g, '%3E') + '>)');
    if (Object.keys(row.citations).length) sections.push('### Citation fields', fence(row.citations));
    if (row.contentDisposition !== 'withheld') sections.push('### Content (' + md(row.contentType) + ')', fence(row.contentText || '', row.contentType === 'text' ? 'text' : 'json'));
    if (edition.annotations?.[row.id]) sections.push('### Research annotation', fence(edition.annotations[row.id]));
  }
  sections.push('## Complete saved edition', 'The embedded manifest carries the exact delivered response bytes as base64 and every retained original field.', fence(edition));
  return sections.join('\n\n') + '\n';
}

function csvCell(value) {
  let out = value === null || value === undefined ? '' : String(value);
  // Protect spreadsheet presentation cells. Exact values remain inside the JSON
  // record cells, whose leading object/array syntax is safe to open in a sheet.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(out) || /^[\t\r\n]/.test(out)) out = "'" + out;
  return '"' + out.replace(/"/g, '""') + '"';
}

function csvEdition(edition, view) {
  const columns = ['record_type', 'edition_id', 'captured_at', 'tx_id', 'retention_mode', 'agreement_reference', 'response_sha256', 'upstream_sha256',
    'result_id', 'occurrence_id', 'rank', 'content_disposition', 'title', 'source', 'url', 'content_type', 'content_text', 'citation_json', 'selected', 'note', 'tags_json', 'raw_result_json', 'record_json'];
  const base = {edition_id: edition.id, captured_at: edition.response.capturedAt, tx_id: view.txId,
    retention_mode: view.retentionMode, agreement_reference: view.agreementReference,
    response_sha256: edition.response.sha256, upstream_sha256: view.upstreamSha256};
  const records = [{...base, record_type: 'edition', record_json: JSON.stringify(edition)},
    {...base, record_type: 'summary', record_json: JSON.stringify(view.summary)}];
  for (const row of view.rows) {
    const annotation = edition.annotations?.[row.id] ?? {};
    records.push({...base, record_type: 'result', result_id: row.id, occurrence_id: row.occurrenceId, rank: row.rank,
      content_disposition: row.contentDisposition, title: row.title, source: row.source, url: row.url,
      content_type: row.contentType, content_text: row.contentText, citation_json: JSON.stringify(row.citations),
      selected: annotation.selected, note: annotation.note, tags_json: annotation.tags ? JSON.stringify(annotation.tags) : '',
      raw_result_json: row.raw === null ? '' : JSON.stringify(row.raw),
      record_json: JSON.stringify({occurrenceId: row.occurrenceId, resultId: row.id, annotation})});
  }
  return [columns.map(csvCell).join(','), ...records.map(record => columns.map(key => csvCell(record[key])).join(','))].join('\r\n') + '\r\n';
}

function htmlEdition(edition, view) {
  const details = (title, value) => '<details><summary>' + html(title) + '</summary><pre>' + html(pretty(value)) + '</pre></details>';
  const rows = view.rows.map(row => '<article><h2>Result ' + row.rank + (row.title ? ': ' + html(row.title) : '') + '</h2>' +
    '<p>Disposition: ' + html(row.contentDisposition) + '</p>' +
    (row.occurrenceId ? '<p class="mono">Occurrence: ' + html(row.occurrenceId) + '</p>' : '') +
    (row.safeUrl ? '<p><a rel="noreferrer noopener" href="' + html(row.safeUrl) + '">Open original source</a></p>' : '') +
    (Object.keys(row.citations).length ? details('Exact citation fields', row.citations) : '') +
    (row.contentDisposition !== 'withheld' ? '<h3>Content (' + html(row.contentType) + ')</h3><pre>' + html(row.contentText) + '</pre>' : '') +
    (edition.annotations?.[row.id] ? details('Research annotation', edition.annotations[row.id]) : '') + '</article>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
    '<title>' + html(edition.title || 'Research edition') + '</title>' +
    '<style>body{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#f7f7f7;margin:0}main{max-width:1080px;margin:auto;padding:32px}h1{font-size:26px}h2{font-size:19px}h3{font-size:15px}article,details{border:1px solid #bcbcbc;background:#fff;padding:16px;margin:16px 0}pre,.mono{font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#242424;text-underline-offset:3px}summary{cursor:pointer;font-weight:600}@media print{body{background:white}main{padding:0}details{display:block}}</style></head><body><main>' +
    '<h1>' + html(edition.title || 'Research edition') + '</h1>' +
    details('Edition metadata', metadata(edition, view)) + details('Search request', edition.query.input) + details('Source and usage summary', view.summary) +
    (view.warnings.length ? details('Delivery warnings', view.warnings) : '') + rows +
    '<h2>Complete saved edition</h2><p>The manifest includes the exact delivered response bytes and all retained original fields.</p>' +
    details('Saved edition manifest', edition) + '</main></body></html>\n';
}

/** Export only a validated, byte-bound delivered edition. Native raw responses
 * remain immediate inputs to analyzeValyuResponse and cannot pass this boundary.
 */
export function exportResearchEdition(input, format = 'json') {
  const {edition, view} = editionForExport(input);
  const formats = {
    json: ['application/json; charset=utf-8', 'json', () => pretty(edition) + '\n'],
    md: ['text/markdown; charset=utf-8', 'md', () => markdownEdition(edition, view)],
    markdown: ['text/markdown; charset=utf-8', 'md', () => markdownEdition(edition, view)],
    csv: ['text/csv; charset=utf-8', 'csv', () => csvEdition(edition, view)],
    html: ['text/html; charset=utf-8', 'html', () => htmlEdition(edition, view)]
  };
  requireValue(typeof format === 'string' && own(formats, format), 'RESEARCH_EXPORT_FORMAT_INVALID');
  const [type, extension, render] = formats[format];
  return {bytes: Buffer.from(render(), 'utf8'), type, extension};
}
