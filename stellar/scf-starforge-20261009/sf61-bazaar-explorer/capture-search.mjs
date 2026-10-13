// SPDX-License-Identifier: MIT
// Search projections never replace the original saved page or its selected row.
import { CatalogQueryIndex } from '../../../scf46-stellar-bazaar/src/query-index.mjs';
import { projectCatalogSearchEntry } from '../../../scf46-stellar-bazaar/src/entry-identity.mjs';

export const ATLAS_CAPTURE_SEARCH_SCHEMA = 'stellar-forge.sf61.capture-search.v1';
export const CAPTURE_FILTERS = Object.freeze(['type', 'payTo', 'network', 'scheme', 'asset', 'extensions']);
const PAYMENT_FILTERS = ['payTo', 'network', 'scheme', 'asset'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
function invalid(code) { const error = new RangeError(code); error.code = code; throw error; }

export function normalizeCaptureSearch(input = {}) {
  if (!plain(input) || Object.keys(input).some(key => !['captureId', 'query', 'filters', 'page', 'pageSize', 'snapshotId'].includes(key)))
    invalid('ATLAS_QUERY_INVALID');
  const { query = '', filters = {}, page = 0, pageSize = 50, snapshotId = null } = input;
  if (typeof query !== 'string' || query.length > 1024 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(query) ||
      !plain(filters) || Object.keys(filters).some(key => !CAPTURE_FILTERS.includes(key)) ||
      !Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200 ||
      !Number.isSafeInteger(page * pageSize) ||
      snapshotId !== null && (typeof snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(snapshotId)))
    invalid('ATLAS_QUERY_INVALID');
  const selected = {};
  for (const key of CAPTURE_FILTERS) if (Object.hasOwn(filters, key)) {
    const value = filters[key];
    if (typeof value !== 'string' || !value.length || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value) ||
        key === 'type' && !['http', 'mcp'].includes(value)) invalid('ATLAS_FILTER_INVALID');
    selected[key] = value;
  }
  return { captureId: input.captureId, query: query.trim(), filters: selected, page, pageSize, snapshotId };
}

/** Original accepts indexes, including repeated options. All payment filters
 * must match one actual option; values from different options never combine. */
export function matchingCaptureAcceptIndexes(listing, filters = {}) {
  const keys = PAYMENT_FILTERS.filter(key => Object.hasOwn(filters, key));
  return Array.isArray(listing?.accepts) ? listing.accepts.flatMap((option, index) =>
    plain(option) && keys.every(key => option[key] === filters[key]) ? [index] : []) : [];
}
function matchesUnindexed(listing, filters) {
  if (Object.hasOwn(filters, 'type') && listing.extensions?.bazaar?.info?.input?.type !== filters.type) return false;
  if (Object.hasOwn(filters, 'extensions') && !Object.hasOwn(listing.extensions ?? {}, filters.extensions)) return false;
  return !PAYMENT_FILTERS.some(key => Object.hasOwn(filters, key)) || matchingCaptureAcceptIndexes(listing, filters).length > 0;
}

/** Apply the shared catalog structure and search metadata to a saved original row.
 * Top-level Vellar metadata is lifted into its existing resource envelope.
 * This is a read projection, not an ownership or payment admission decision. */
export function projectCaptureListing(original) {
  if (!plain(original)) invalid('ATLAS_SOURCE_PAGE_INVALID');
  const resource = typeof original.resource === 'string' ? { url: original.resource }
    : plain(original.resource) ? { ...original.resource } : {};
  for (const key of ['description', 'serviceName', 'tags', 'iconUrl'])
    if (resource[key] === undefined && original[key] !== undefined) resource[key] = clone(original[key]);
  return projectCatalogSearchEntry({ ...original, resource });
}

function retainedFields(row) {
  // Keep only fields consumed by the maintained index. Full original listings
  // stay in the source files and are reread for each returned/selected page.
  return { resource: Object.fromEntries(['url', 'serviceName', 'tags', 'description'].filter(key => Object.hasOwn(row.resource, key)).map(key => [key, row.resource[key]])),
    accepts: row.accepts.map(option => Object.fromEntries(PAYMENT_FILTERS.filter(key =>
      Object.hasOwn(option, key)).map(key => [key, option[key]]))),
    extensions: Object.fromEntries(Object.keys(row.extensions).map(key => [key, key === 'bazaar'
      ? { info: { input: Object.fromEntries(['type', 'toolName', 'inputSchema', 'description'].filter(field => Object.hasOwn(row.extensions.bazaar.info.input, field)).map(field => [field, row.extensions.bazaar.info.input[field]])) }, schema: row.extensions.bazaar.schema } : true])) };
}

/** A private per-capture index. Its caller verifies complete page bytes and
 * owns the lifetime; only detached original page/row references leave this API. */
export class AtlasCaptureSearch {
  #references = [];
  #entries = new Map();
  #sourceByEntry = new Map();
  #unindexed = [];
  #queries;
  #finished = false;
  #pages = new Set();
  addPage({ pageFile, sha256, rows }) {
    if (this.#finished || typeof pageFile !== 'string' || !/^page-[0-9]{6}\.json$/.test(pageFile) ||
        !/^[a-f0-9]{64}$/.test(sha256) || !Array.isArray(rows) || !rows.every(plain) || this.#pages.has(pageFile))
      invalid('ATLAS_SEARCH_PAGE_INVALID');
    this.#pages.add(pageFile);
    for (const [row, listing] of rows.entries()) {
      const reference = { pageFile, pageSha256: sha256, row, catalogKey: null, searchable: false };
      let projected;
      try { projected = projectCaptureListing(listing); }
      catch (error) {
        reference.indexingError = { code: 'ATLAS_SEARCH_ROW_UNINDEXED', message: String(error.message).slice(0, 240) };
      }
      if (projected) {
        reference.catalogKey = projected.id; reference.searchable = true;
        // Keep duplicate observations as separate source rows. A canonical
        // service identity is not an instruction to discard an original page.
        reference.entry = retainedFields(projected.entry);
      } else {
        reference.filterRow = {
          accepts: Array.isArray(listing.accepts) ? listing.accepts.filter(plain).map(option =>
            Object.fromEntries(PAYMENT_FILTERS.filter(key => Object.hasOwn(option, key)).map(key => [key, option[key]]))) : [],
          extensions: plain(listing.extensions) ? Object.fromEntries(Object.keys(listing.extensions).map(key =>
            [key, key === 'bazaar' ? { info: { input: { type: listing.extensions?.bazaar?.info?.input?.type } } } : true])) : {}
        };
        this.#unindexed.push(reference);
      }
      this.#references.push(reference);
    }
  }
  finish() {
    if (this.#finished) return this;
    const counts = new Map();
    for (const reference of this.#references) if (reference.searchable)
      counts.set(reference.catalogKey, (counts.get(reference.catalogKey) ?? 0) + 1);
    for (const reference of this.#references) if (reference.searchable) {
      const key = counts.get(reference.catalogKey) === 1 ? reference.catalogKey
        : reference.catalogKey + '\u0000' + reference.pageFile + ':' + String(reference.row).padStart(12, '0');
      this.#entries.set(key, reference.entry);
      this.#sourceByEntry.set(reference.entry, reference);
    }
    this.#queries = new CatalogQueryIndex(this.#entries);
    this.#finished = true;
    return this;
  }
  select(input = {}) {
    if (!this.#finished) invalid('ATLAS_SEARCH_INDEX_NOT_READY');
    const request = normalizeCaptureSearch(input), { query, filters, page, pageSize } = request;
    let references;
    try {
      if (query) references = this.#queries.search(filters, query).map(row => this.#sourceByEntry.get(row));
      else if (!Object.keys(filters).length) references = this.#references;
      else {
        const eligible = new Set(this.#queries.list(filters).map(row => this.#sourceByEntry.get(row)));
        references = this.#references.filter(reference => reference.searchable ? eligible.has(reference)
          : matchesUnindexed(reference.filterRow, filters));
      }
    } catch (error) {
      if (error instanceof RangeError && !error.code) invalid('ATLAS_SEARCH_TERMS_REQUIRED');
      throw error;
    }
    const offset = page * pageSize, total = references.length;
    return {
      request, order: query ? 'relevance' : 'source',
      total, indexedRows: this.#entries.size, unindexedRows: this.#unindexed.length,
      offers: references.slice(offset, offset + pageSize).map((reference, index) => ({
        pageFile: reference.pageFile, pageSha256: reference.pageSha256, row: reference.row,
        catalogKey: reference.catalogKey, searchable: reference.searchable,
        ...(reference.indexingError ? { indexingError: clone(reference.indexingError) } : {}),
        rank: query ? offset + index + 1 : null
      })),
      nextPage: offset + pageSize < total ? page + 1 : null
    };
  }
  get stats() { return { ...this.#queries?.stats, originalRows: this.#references.length,
    indexedRows: this.#entries.size, unindexedRows: this.#unindexed.length }; }
}
