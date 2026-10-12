import {NativeSourceError, createReadOnlyTransport, plain, textValue, integer, errorResult} from './native-http.mjs';

export const HORIZON_UPSTREAM = Object.freeze({
  repository: 'stellar/js-stellar-sdk', tag: 'v17.0.1',
  commit: '74ac883871396138e1882a3ca4bcec7e4ace76b5',
  docsRepository: 'stellar/stellar-docs', docsCommit: '0886fb75182106bdd1b33c3aeae52bb5fe122b0a',
  capsule: './source/horizon-api-source.json',
});
const LISTS = ['payments', 'operations', 'transactions'];
export const HORIZON_READ_KINDS = Object.freeze(['root', 'account', 'transaction', 'operation', 'ledger', ...LISTS]);
const SCOPES = ['accountId', 'transactionHash', 'ledger'];
function nativeId(value, kind) {
  const id = textValue(String(value ?? ''), kind + ' id', 255);
  if (kind === 'account' && !/^(?:G[A-Z2-7]{55}|M[A-Z2-7]{68})$/.test(id)) throw new NativeSourceError('INVALID_INPUT', 'Use an original Stellar G or M account identifier.');
  if (kind === 'transaction' && !/^[0-9a-fA-F]{64}$/.test(id)) throw new NativeSourceError('INVALID_INPUT', 'Use the original 64-character transaction hash.');
  if ((kind === 'operation' || kind === 'ledger') && !/^[1-9]\d*$/.test(id)) throw new NativeSourceError('INVALID_INPUT', 'Use the original positive native ' + kind + ' identifier.');
  return id;
}
export function normalizeHorizonRead(input = {}) {
  plain(input, 'request');
  if (!HORIZON_READ_KINDS.includes(input.kind)) throw new NativeSourceError('UNKNOWN_NATIVE_KIND', 'Select a supported Horizon read kind.', {kinds: HORIZON_READ_KINDS});
  const list = LISTS.includes(input.kind);
  const filters = {...plain(input.filters || {}, 'filters')};
  for (const key of Object.keys(filters)) if (filters[key] === undefined || filters[key] === null || filters[key] === '') delete filters[key];
  if (!list) {
    if (Object.keys(filters).length) throw new NativeSourceError('INVALID_FILTER', 'This native detail endpoint takes no collection filters.');
    if (input.cursor !== undefined && input.cursor !== null && input.cursor !== '') throw new NativeSourceError('INVALID_INPUT', 'This native detail endpoint is not paginated.');
    if (input.kind === 'root') {
      if (input.id !== undefined && input.id !== null) throw new NativeSourceError('INVALID_INPUT', 'The native root read takes no record ID.');
      return {kind: 'root', filters: {}, cursor: null};
    }
    return {kind: input.kind, id: nativeId(input.id, input.kind), filters: {}, cursor: null};
  }
  if (input.id !== undefined && input.id !== null) throw new NativeSourceError('INVALID_INPUT', 'Use a native collection filter instead of a detail ID.');
  const allowed = [...SCOPES, 'order', 'include_failed', ...(input.kind === 'transactions' ? [] : ['join'])];
  for (const key of Object.keys(filters)) if (!allowed.includes(key)) throw new NativeSourceError('INVALID_FILTER', 'The selected native Horizon route does not support this filter.', {field: key});
  const selectedScopes = SCOPES.filter(key => filters[key] !== undefined);
  if (selectedScopes.length > 1) throw new NativeSourceError('INVALID_FILTER', 'Select one native collection scope: account, transaction, or ledger.');
  if (input.kind === 'transactions' && filters.transactionHash !== undefined) throw new NativeSourceError('INVALID_FILTER', 'Use kind transaction for a single original transaction.');
  if (filters.accountId !== undefined) filters.accountId = nativeId(filters.accountId, 'account');
  if (filters.transactionHash !== undefined) filters.transactionHash = nativeId(filters.transactionHash, 'transaction');
  if (filters.ledger !== undefined) filters.ledger = nativeId(filters.ledger, 'ledger');
  filters.order ??= 'asc';
  filters.include_failed ??= true;
  if (!['asc', 'desc'].includes(filters.order)) throw new NativeSourceError('INVALID_FILTER', 'order must be asc or desc.');
  if (typeof filters.include_failed !== 'boolean') throw new NativeSourceError('INVALID_FILTER', 'include_failed must be a boolean.');
  if (input.kind !== 'transactions') {
    filters.join ??= 'transactions';
    if (filters.join !== 'transactions') throw new NativeSourceError('INVALID_FILTER', 'The maintained native join value is transactions.');
  }
  const cursor = input.cursor === undefined || input.cursor === null || input.cursor === '' ? null : textValue(input.cursor, 'cursor', 16384);
  return {kind: input.kind, filters, pageSize: integer(input.pageSize, 'pageSize', 100, 200), cursor};
}

export function openHorizonSource(connection) {
  const transport = createReadOnlyTransport('horizon', connection);
  function describe() {
    return {...transport.descriptor, upstream: HORIZON_UPSTREAM,
      networkBinding: 'Capture the original root response and bind network_passphrase before financial interpretation.',
      kinds: Object.fromEntries(HORIZON_READ_KINDS.map(kind => [kind, {
        shape: LISTS.includes(kind) ? 'page' : 'object',
        recordsPath: LISTS.includes(kind) ? '/_embedded/records' : '',
        filters: LISTS.includes(kind) ? [...(kind === 'transactions' ? ['accountId', 'ledger'] : SCOPES), 'order', 'include_failed', ...(kind === 'transactions' ? [] : ['join'])] : [],
        maximumPageSize: LISTS.includes(kind) ? 200 : null,
      }]))};
  }
  async function read(input) {
    const selected = normalizeHorizonRead(input);
    const list = LISTS.includes(selected.kind);
    let path = selected.kind === 'root' ? '/' : list ? '/' + selected.kind : '/' + ({account: 'accounts', transaction: 'transactions', operation: 'operations', ledger: 'ledgers'}[selected.kind]) + '/' + encodeURIComponent(selected.id);
    const query = {};
    if (list) {
      const f = selected.filters;
      if (f.accountId) path = '/accounts/' + encodeURIComponent(f.accountId) + path;
      else if (f.transactionHash) path = '/transactions/' + encodeURIComponent(f.transactionHash) + path;
      else if (f.ledger) path = '/ledgers/' + encodeURIComponent(f.ledger) + path;
      Object.assign(query, {limit: selected.pageSize, order: f.order, include_failed: f.include_failed});
      if (f.join) query.join = f.join;
    }
    let url = transport.urlFor(path, query);
    if (selected.cursor) {
      if (/^\d+$/.test(selected.cursor) || selected.cursor === 'now') url.searchParams.set('cursor', selected.cursor);
      else url = transport.continueURL(selected.cursor, url, 'cursor');
    }
    const request = {...selected, provider: 'horizon', sourceId: transport.descriptor.id, method: 'GET', path,
      query: Object.fromEntries(url.searchParams.entries())};
    const result = await transport.get(url, request, input.signal);
    if (result.error) return result;
    try {
      const value = plain(result.value, 'Horizon response');
      if (!list) {
        result.records = [value];
        if (selected.kind === 'root') {
          if (typeof value.network_passphrase !== 'string' || !value.network_passphrase.length) throw new NativeSourceError('NATIVE_SCHEMA_ERROR', 'The original Horizon root response has no network passphrase.');
          if (value.network_passphrase !== transport.descriptor.network) throw new NativeSourceError('NETWORK_MISMATCH', 'The original Horizon network differs from the selected connection.', {expectedNetwork: transport.descriptor.network, observedNetwork: value.network_passphrase});
          for (const key of ['history_latest_ledger', 'history_elder_ledger']) if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new NativeSourceError('NATIVE_SCHEMA_ERROR', 'The original Horizon root response has an invalid retained ledger boundary.', {field: key});
        }
        return result;
      }
      if (!value._embedded || !Array.isArray(value._embedded.records)) throw new NativeSourceError('NATIVE_SCHEMA_ERROR', 'The original Horizon page has no _embedded.records array.');
      const records = value._embedded.records;
      if (records.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new NativeSourceError('NATIVE_SCHEMA_ERROR', 'A native Horizon record is not an object.');
      const next = value._links?.next?.href;
      const before = url.searchParams.get('cursor');
      if (records.length) {
        if (typeof next !== 'string' || !next.length) throw new NativeSourceError('NATIVE_SCHEMA_ERROR', 'The native Horizon collection has records without its original next link.');
        const advance = before && /^\d+$/.test(before) ? before : null;
        const nextURL = transport.continueURL(next, url, 'cursor', {minimum: advance, order: selected.filters.order});
        const nextToken = nextURL.searchParams.get('cursor');
        const lastToken = records.at(-1).paging_token;
        if (typeof lastToken !== 'string' || nextToken !== lastToken) throw new NativeSourceError('NATIVE_CURSOR_MISMATCH', 'The original Horizon next link does not identify the last retained native record.');
        if (before === nextToken) throw new NativeSourceError('NATIVE_CURSOR_STALLED', 'The original Horizon next link did not advance.');
        result.continuation = {done: false, next: {...selected, cursor: next}};
      } else {
        // Empty Horizon collections end this observation. The complete original
        // next link remains in value, and can seed a later explicit capture.
        result.continuation = {done: true, next: null};
      }
      result.records = records;
      return result;
    } catch (error) {
      return errorResult(request, result.response, error.code || 'NATIVE_SCHEMA_ERROR', error.message, error.details || {}, result.value);
    }
  }
  return {describe, read};
}
