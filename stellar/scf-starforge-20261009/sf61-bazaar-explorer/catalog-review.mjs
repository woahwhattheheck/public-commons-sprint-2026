// SPDX-License-Identifier: MIT
// Complete retained-page selections shared by the grant reader and original Atlas workspace.
import { AtlasCaptureSearch, normalizeCaptureSearch, matchingCaptureAcceptIndexes } from './capture-search.mjs';

export const CATALOG_REVIEW_SCHEMA = 'stellar-forge.sf61.catalog-review.v1';
export const CATALOG_REVIEW_LIMITS = Object.freeze({ pageBytes: 1048576, packetBytes: 8 * 1048576, rows: 20000 });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digestOK = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clone = value => structuredClone(value);
function fail(code, message) { const error = new TypeError(message ?? code); error.code = code; throw error; }
function need(condition, code, message) { if (!condition) fail(code, message); }
function exactKeys(value, keys, code) {
  need(plain(value) && Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key)), code);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
function utf8(text, maximum, code) {
  need(typeof text === 'string', code);
  const bytes = new TextEncoder().encode(text);
  need(bytes.length > 0 && bytes.length <= maximum &&
    new TextDecoder('utf-8', { fatal: true }).decode(bytes) === text, code);
  return bytes;
}
async function sha256(bytes) {
  need(globalThis.crypto?.subtle, 'ATLAS_REVIEW_DIGEST_UNAVAILABLE', 'Use HTTPS, localhost or the maintained Node runtime to read the complete source digest.');
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}
function decode(text, code) { try { return JSON.parse(text); } catch { fail(code); } }
function rowsOf(page) {
  let rows;
  if (page?.mode === 'ORIGINAL_UNSIGNED_CATALOG') {
    need(['resources', 'items'].includes(page.sourceEnvelope) && typeof page.source === 'string' &&
      !Object.hasOwn(page, 'items') && !Object.hasOwn(page, 'resources'), 'ATLAS_SOURCE_PAGE_INVALID');
    rows = page.originalListings;
  } else if (page?.schema === 'scf61-observed-native-page-v1') {
    need(page.readOnly === true && page.paidOrSettled === false, 'ATLAS_SOURCE_PAGE_INVALID');
    rows = page.nativeProviderRows;
  } else {
    need(plain(page) && Object.hasOwn(page, 'resources') !== Object.hasOwn(page, 'items') &&
      !Object.hasOwn(page, 'originalListings'), 'ATLAS_SOURCE_PAGE_INVALID');
    rows = page.resources ?? page.items;
  }
  need(Array.isArray(rows) && rows.length <= CATALOG_REVIEW_LIMITS.rows && rows.every(plain), 'ATLAS_SOURCE_PAGE_INVALID');
  return rows;
}
function metadata(sourceUrl, capturedAt) {
  if (sourceUrl !== null) {
    need(typeof sourceUrl === 'string' && sourceUrl.length <= 4096 &&
      !/[\x00-\x20\x7f\\]/.test(sourceUrl), 'ATLAS_REVIEW_SOURCE_URL_INVALID');
    let url; try { url = new URL(sourceUrl); } catch { fail('ATLAS_REVIEW_SOURCE_URL_INVALID'); }
    need(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash,
      'ATLAS_REVIEW_SOURCE_URL_INVALID');
  }
  need(capturedAt === null || typeof capturedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(capturedAt) &&
    Number.isFinite(Date.parse(capturedAt)), 'ATLAS_REVIEW_CAPTURE_TIME_INVALID');
  return { sourceUrl, capturedAt };
}

/** Read one full retained page without fetching its advertised resources. */
export async function openCatalogReviewPage({ pageText, sourceUrl = null, capturedAt = null, expectedSha256 = null } = {}) {
  const selected = { pageText, ...metadata(sourceUrl, capturedAt), expectedSha256 };
  const bytes = utf8(selected.pageText, CATALOG_REVIEW_LIMITS.pageBytes, 'ATLAS_REVIEW_PAGE_TOO_LARGE');
  const page = decode(selected.pageText, 'ATLAS_SOURCE_PAGE_INVALID'), rows = rowsOf(page);
  need(selected.expectedSha256 === null || digestOK(selected.expectedSha256), 'ATLAS_REVIEW_SOURCE_DIGEST_INVALID');
  const pageSha256 = await sha256(bytes);
  need(selected.expectedSha256 === null || selected.expectedSha256 === pageSha256, 'ATLAS_REVIEW_SOURCE_CHANGED');
  const engine = new AtlasCaptureSearch();
  engine.addPage({ pageFile: 'page-000000.json', sha256: pageSha256, rows }); engine.finish();
  const source = { pageFile: 'page-000000.json', pageSha256, bytes: bytes.length, rows: rows.length,
    sourceUrl: selected.sourceUrl, capturedAt: selected.capturedAt, pageText: selected.pageText };
  const offset = Number.isSafeInteger(page.pagination?.offset) ? page.pagination.offset : null;
  const total = Number.isSafeInteger(page.pagination?.total) && page.pagination.total >= 0 ? page.pagination.total : null;
  const coverage = { receivedRows: rows.length, reportedTotal: total, offset,
    partialResults: typeof page.partialResults === 'boolean' ? page.partialResults : null,
    allReportedRowsPresent: total === null || offset === null ? null :
      offset === 0 && rows.length === total && page.partialResults !== true };
  return {
    source: clone(source), coverage: clone(coverage),
    search(input = {}) {
      const result = engine.select(input);
      return { ...result, coverage: clone(coverage), source: { ...source, pageText: undefined },
        offers: result.offers.map(reference => ({ ...reference, listing: clone(rows[reference.row]),
          matchingAcceptIndexes: matchingCaptureAcceptIndexes(rows[reference.row], result.request.filters) })) };
    },
    async createSelection({ row, acceptIndex, query = '', filters = {}, label } = {}) {
      // Freeze caller-owned fields before asynchronous hashing.
      const request = normalizeCaptureSearch({ query, filters: clone(filters) });
      need(Number.isSafeInteger(row) && row >= 0 && row < rows.length &&
        Number.isSafeInteger(acceptIndex) && acceptIndex >= 0 && plain(rows[row].accepts?.[acceptIndex]),
      'ATLAS_REVIEW_SELECTION_INVALID');
      need(typeof label === 'string' && label.trim().length > 0 && label.length <= 240 &&
        !/[\x00-\x1f\x7f]/.test(label), 'ATLAS_REVIEW_LABEL_REQUIRED');
      const accepted = matchingCaptureAcceptIndexes(rows[row], request.filters);
      need(accepted.includes(acceptIndex), 'ATLAS_REVIEW_PAYMENT_FILTER_MISMATCH');
      let selected = null, pageNumber = 0;
      do {
        const result = engine.select({ query: request.query, filters: request.filters, page: pageNumber, pageSize: 200 });
        selected = result.offers.find(reference => reference.row === row);
        if (selected || result.nextPage === null) break;
        pageNumber = result.nextPage;
      } while (pageNumber * 200 <= rows.length);
      need(selected, 'ATLAS_REVIEW_QUERY_SELECTION_MISMATCH');
      const payload = { schema: CATALOG_REVIEW_SCHEMA, label: label.trim(), source: clone(source),
        selection: { row, acceptIndex, catalogKey: selected.catalogKey },
        search: { query: request.query, filters: clone(request.filters) } };
      const packetId = await sha256(new TextEncoder().encode(JSON.stringify(canonical(payload))));
      const packet = { ...payload, packetId }, text = JSON.stringify(packet, null, 2) + '\n';
      const raw = utf8(text, CATALOG_REVIEW_LIMITS.packetBytes, 'ATLAS_REVIEW_PACKET_TOO_LARGE');
      return { packet: clone(packet), text, bytes: raw.length, sha256: await sha256(raw),
        listing: clone(rows[row]), acceptedTerms: clone(rows[row].accepts[acceptIndex]), rank: selected.rank };
    }
  };
}

/** Recompute the full source, exact option and query selection from an original review file. */
export async function inspectCatalogReview(text) {
  const raw = utf8(text, CATALOG_REVIEW_LIMITS.packetBytes, 'ATLAS_REVIEW_PACKET_TOO_LARGE');
  const packet = decode(text, 'ATLAS_REVIEW_JSON_INVALID');
  exactKeys(packet, ['schema', 'label', 'source', 'selection', 'search', 'packetId'], 'ATLAS_REVIEW_PACKET_INVALID');
  need(packet.schema === CATALOG_REVIEW_SCHEMA && digestOK(packet.packetId), 'ATLAS_REVIEW_PACKET_INVALID');
  exactKeys(packet.source, ['pageFile', 'pageSha256', 'bytes', 'rows', 'sourceUrl', 'capturedAt', 'pageText'], 'ATLAS_REVIEW_SOURCE_INVALID');
  exactKeys(packet.selection, ['row', 'acceptIndex', 'catalogKey'], 'ATLAS_REVIEW_SELECTION_INVALID');
  exactKeys(packet.search, ['query', 'filters'], 'ATLAS_REVIEW_SEARCH_INVALID');
  need(packet.source.pageFile === 'page-000000.json' && digestOK(packet.source.pageSha256) &&
    Number.isSafeInteger(packet.source.bytes) && Number.isSafeInteger(packet.source.rows), 'ATLAS_REVIEW_SOURCE_INVALID');
  const page = await openCatalogReviewPage({ pageText: packet.source.pageText,
    sourceUrl: packet.source.sourceUrl, capturedAt: packet.source.capturedAt, expectedSha256: packet.source.pageSha256 });
  need(page.source.bytes === packet.source.bytes && page.source.rows === packet.source.rows, 'ATLAS_REVIEW_SOURCE_CHANGED');
  const rebuilt = await page.createSelection({ ...packet.selection, ...packet.search, label: packet.label });
  need(rebuilt.packet.packetId === packet.packetId &&
    JSON.stringify(canonical(rebuilt.packet)) === JSON.stringify(canonical(packet)), 'ATLAS_REVIEW_SELECTION_CHANGED');
  return { packet: clone(packet), text, bytes: raw.length, sha256: await sha256(raw),
    listing: rebuilt.listing, acceptedTerms: rebuilt.acceptedTerms, rank: rebuilt.rank, coverage: clone(page.coverage) };
}

/** Small operational view; complete source text remains in the original packet. */
export function catalogReviewSummary(review) {
  const { packet } = review;
  return { schema: CATALOG_REVIEW_SCHEMA, packetId: packet.packetId, label: packet.label,
    bytes: review.bytes, sha256: review.sha256,
    source: Object.fromEntries(Object.entries(packet.source).filter(([key]) => key !== 'pageText')),
    selection: clone(packet.selection), search: clone(packet.search), rank: review.rank,
    coverage: clone(review.coverage ?? null), listing: clone(review.listing), acceptedTerms: clone(review.acceptedTerms) };
}
