import {NativeSourceError, createReadOnlyTransport, plain, textValue, integer, errorResult} from './native-http.mjs';

export const SDP_UPSTREAM = Object.freeze({
  repository: 'stellar/stellar-disbursement-platform-backend',
  commit: '4330f131e8a2638a10767ec8db50a98f22672a61',
  openapiRepository: 'stellar/stellar-docs',
  openapiCommit: '0886fb75182106bdd1b33c3aeae52bb5fe122b0a',
  openapiVersion: '7.0.0',
  capsule: './source/sdp-api-source.json',
});
const COMMON = ['q', 'status', 'created_at_after', 'created_at_before', 'sort', 'direction'];
const CATALOG = {
  payments: {path: '/payments', shape: 'page', filters: [...COMMON, 'type', 'receiver_id'], sort: 'updated_at', sorts: ['created_at', 'updated_at']},
  payment: {path: '/payments/{id}', shape: 'object', filters: []},
  disbursements: {path: '/disbursements', shape: 'page', filters: COMMON, sort: 'created_at', sorts: ['created_at', 'name']},
  disbursement: {path: '/disbursements/{id}', shape: 'object', filters: []},
  disbursementReceivers: {path: '/disbursements/{id}/receivers', shape: 'page', filters: ['sort', 'direction'], sort: 'updated_at', sorts: ['created_at', 'updated_at']},
  receivers: {path: '/receivers', shape: 'page', filters: COMMON, sort: 'updated_at', sorts: ['created_at', 'updated_at']},
  receiver: {path: '/receivers/{id}', shape: 'object', filters: []},
  assets: {path: '/assets', shape: 'array', filters: ['enabled']},
  wallets: {path: '/wallets', shape: 'array', filters: ['include_deleted', 'enabled', 'user_managed', 'supported_assets']},
  distributionWallets: {path: '/distribution-wallets', shape: 'array', filters: []},
  distributionWallet: {path: '/distribution-wallets/{id}', shape: 'object', filters: []},
  distributionWalletAudit: {path: '/distribution-wallets/{id}/audit', shape: 'array', filters: []},
  organization: {path: '/organization', shape: 'object', filters: []},
};
export const SDP_READ_KINDS = Object.freeze(Object.keys(CATALOG));
const PAYMENT_STATUSES = ['DRAFT', 'READY', 'PENDING', 'PAUSED', 'SUCCESS', 'FAILED', 'CANCELED'];
const DISBURSEMENT_STATUSES = ['DRAFT', 'READY', 'STARTED', 'PAUSED', 'COMPLETED', 'CANCELED'];
const RECEIVER_STATUSES = ['DRAFT', 'READY', 'REGISTERED', 'FLAGGED'];

function normalizeFilter(kind, key, value, entry) {
  if (['enabled', 'include_deleted', 'user_managed'].includes(key)) {
    if (typeof value !== 'boolean') throw new NativeSourceError('INVALID_FILTER', key + ' must be a boolean.');
    return value;
  }
  const result = textValue(value, key, 2048);
  if (key === 'direction' && !['asc', 'desc'].includes(result)) throw new NativeSourceError('INVALID_FILTER', 'direction must be asc or desc.');
  if (key === 'sort' && !entry.sorts.includes(result)) throw new NativeSourceError('INVALID_FILTER', 'The sort field is not supported by this native endpoint.', {kind, field: result});
  if (key === 'type' && !['DIRECT', 'DISBURSEMENT'].includes(result)) throw new NativeSourceError('INVALID_FILTER', 'Payment type must be DIRECT or DISBURSEMENT.');
  if (key === 'status') {
    const values = kind === 'disbursements' ? result.split(',').map(x => x.trim()) : [result];
    const valid = kind === 'payments' ? PAYMENT_STATUSES : kind === 'receivers' ? RECEIVER_STATUSES : DISBURSEMENT_STATUSES;
    if (values.some(x => !valid.includes(x))) throw new NativeSourceError('INVALID_FILTER', 'The status is not supported by this native endpoint.', {kind});
  }
  if (key.startsWith('created_at_') && (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result)) throw new NativeSourceError('INVALID_FILTER', key + ' must be a calendar date in YYYY-MM-DD form.');
  return result;
}
export function normalizeSDPRead(input = {}) {
  plain(input, 'request');
  const entry = CATALOG[input.kind];
  if (!entry) throw new NativeSourceError('UNKNOWN_NATIVE_KIND', 'Select a supported SDP read kind.', {kinds: SDP_READ_KINDS});
  const filters = {};
  for (const [key, value] of Object.entries(plain(input.filters || {}, 'filters'))) {
    if (!entry.filters.includes(key)) throw new NativeSourceError('INVALID_FILTER', 'The native SDP endpoint does not support this filter.', {kind: input.kind, field: key});
    if (value !== undefined && value !== null && value !== '') filters[key] = normalizeFilter(input.kind, key, value, entry);
  }
  if (entry.shape === 'page') {
    filters.sort ??= entry.sort;
    filters.direction ??= 'desc';
  }
  if (filters.created_at_after && filters.created_at_before && filters.created_at_after >= filters.created_at_before) throw new NativeSourceError('INVALID_FILTER', 'created_at_after must precede created_at_before.');
  let id = null;
  if (entry.path.includes('{id}')) {
    id = textValue(input.id, 'id', 255);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new NativeSourceError('INVALID_INPUT', 'The native record ID is not a safe path segment.');
  } else if (input.id !== undefined && input.id !== null) throw new NativeSourceError('INVALID_INPUT', 'This native read does not take an ID.');
  const pageSize = entry.shape === 'page' ? integer(input.pageSize, 'pageSize', 100, 100) : null;
  const cursor = input.cursor === undefined || input.cursor === null || input.cursor === '' ? null : textValue(input.cursor, 'cursor', 16384);
  if (cursor !== null && entry.shape !== 'page') throw new NativeSourceError('INVALID_INPUT', 'This native read is not paginated.');
  return {kind: input.kind, ...(id === null ? {} : {id}), filters, ...(pageSize === null ? {} : {pageSize}), cursor};
}

export function openSDPSource(connection) {
  const transport = createReadOnlyTransport('sdp', connection);
  function describe() {
    return {...transport.descriptor, upstream: SDP_UPSTREAM, networkBinding: 'configured; corroborate payment hashes with retained Horizon network data',
      paginationConsistency: 'SDP pages are observations of mutable rows; retain the original page, native next link, status history and observation time.',
      kinds: Object.fromEntries(Object.entries(CATALOG).map(([kind, value]) => [kind, {...value, recordsPath: value.shape === 'page' ? '/data' : '', maximumPageSize: value.shape === 'page' ? 100 : null}]))};
  }
  async function read(input) {
    const selected = normalizeSDPRead(input);
    const entry = CATALOG[selected.kind];
    const path = entry.path.replace('{id}', encodeURIComponent(selected.id || ''));
    const query = {...selected.filters};
    if (entry.shape === 'page') Object.assign(query, {page: 1, page_limit: selected.pageSize});
    let url = transport.urlFor(path, query);
    if (selected.cursor) {
      url = transport.continueURL(selected.cursor, url, 'page');
      const page = url.searchParams.get('page');
      if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) throw new NativeSourceError('INVALID_NATIVE_CURSOR', 'The retained SDP next link has an invalid page.');
    }
    const request = {...selected, provider: 'sdp', sourceId: transport.descriptor.id, method: 'GET', path,
      query: Object.fromEntries(url.searchParams.entries())};
    const result = await transport.get(url, request, input.signal);
    if (result.error) return result;
    try {
      const value = result.value;
      let records;
      if (entry.shape === 'page') {
        plain(value, 'SDP response'); plain(value.pagination, 'SDP pagination');
        if (!Array.isArray(value.data)) throw new NativeSourceError('NATIVE_SCHEMA_ERROR', 'The original SDP page has no data array.');
        records = value.data;
        const pagination = value.pagination;
        for (const key of ['pages', 'total']) if (!Number.isSafeInteger(pagination[key]) || pagination[key] < 0) throw new NativeSourceError('NATIVE_SCHEMA_ERROR', 'The SDP pagination count is invalid.', {field: key});
        const current = Number(url.searchParams.get('page'));
        if (pagination.next !== undefined && pagination.next !== null && pagination.next !== '') {
          const nextUrl = transport.continueURL(pagination.next, url, 'page', {minimum: String(current)});
          if (Number(nextUrl.searchParams.get('page')) !== current + 1) throw new NativeSourceError('NATIVE_CURSOR_SKIPPED', 'The original SDP next link skipped a native page.');
          result.continuation = {done: false, next: {...selected, cursor: pagination.next}};
        } else if (current < pagination.pages) {
          throw new NativeSourceError('NATIVE_SCHEMA_ERROR', 'The SDP response declares more pages without returning their native next link.');
        }
      } else if (entry.shape === 'array') {
        if (!Array.isArray(value)) throw new NativeSourceError('NATIVE_SCHEMA_ERROR', 'The original SDP endpoint did not return its native array.');
        records = value;
      } else { plain(value, 'SDP record'); records = [value]; }
      if (records.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new NativeSourceError('NATIVE_SCHEMA_ERROR', 'A native SDP record is not an object.');
      result.records = records;
      return result;
    } catch (error) {
      return errorResult(request, result.response, error.code || 'NATIVE_SCHEMA_ERROR', error.message, error.details || {}, result.value);
    }
  }
  return {describe, read};
}
