// MIT. Typed-client implementation for the original authenticated native operator.
import {receiveNativeCatalogView} from './catalog-receiving.mjs';

export class NativeOperatorError extends Error {
  constructor(code, {status = null, method = null, path = null, cause} = {}) {
    super(code, cause === undefined ? undefined : {cause});
    this.name = 'NativeOperatorError';
    this.code = code; this.status = status; this.method = method; this.path = path;
  }
}
const need = (value, code) => {if (!value) throw new NativeOperatorError(code);};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const profileName = value => {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value),
    'FACILITATOR_PROFILE_NAME_INVALID');
  return value;
};

/** Use the actual original operator URL. Its token stays in this client closure. */
export function createNativeOperatorClient({operatorUrl, token, fetch:fetchImpl = globalThis.fetch,
  maxResponseBytes = 32 * 1024 * 1024} = {}) {
  let original;
  try {original = new URL(operatorUrl);} catch {throw new NativeOperatorError('FACILITATOR_OPERATOR_URL_INVALID');}
  need(original.protocol === 'http:' && original.hostname === '127.0.0.1' &&
    !original.username && !original.password && !original.search && original.pathname === '/' &&
    Number(original.port || 80) >= 1 && Number(original.port || 80) <= 65535,
  'FACILITATOR_OPERATOR_URL_INVALID');
  const fragment = original.hash ? /^#token=([a-f0-9]{64})$/.exec(original.hash) : null;
  need(!original.hash || fragment, 'FACILITATOR_OPERATOR_URL_INVALID');
  need(token === undefined || /^[a-f0-9]{64}$/.test(token), 'FACILITATOR_OPERATOR_TOKEN_INVALID');
  need(!fragment || token === undefined || token === fragment[1], 'FACILITATOR_OPERATOR_TOKEN_CHANGED');
  const secret = token ?? fragment?.[1], origin = original.origin;
  need(typeof secret === 'string', 'FACILITATOR_OPERATOR_TOKEN_REQUIRED');
  need(typeof fetchImpl === 'function' && Number.isSafeInteger(maxResponseBytes) && maxResponseBytes > 0,
    'FACILITATOR_OPERATOR_CLIENT_INVALID');

  async function request(path, {method = 'GET', body, signal, raw = false} = {}) {
    const headers = {authorization:'Bearer ' + secret, accept:'application/json'};
    let encoded;
    if (body !== undefined) {encoded = JSON.stringify(body); headers['content-type'] = 'application/json';}
    let response, source;
    try {
      response = await fetchImpl(origin + '/api/' + path, {method, headers, body:encoded,
        signal, redirect:'error', credentials:'omit', cache:'no-store'});
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) > maxResponseBytes) {
        await response.body?.cancel();
        throw new NativeOperatorError('FACILITATOR_OPERATOR_RESPONSE_TOO_LARGE');
      }
      need(response.body && typeof response.body.getReader === 'function',
        'FACILITATOR_OPERATOR_RESPONSE_INVALID');
      const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal:true});
      let size = 0; const chunks = [];
      try {
        for (;;) {
          const item = await reader.read(); if (item.done) break;
          size += item.value.byteLength;
          if (size > maxResponseBytes) {
            await reader.cancel();
            throw new NativeOperatorError('FACILITATOR_OPERATOR_RESPONSE_TOO_LARGE');
          }
          chunks.push(decoder.decode(item.value, {stream:true}));
        }
        chunks.push(decoder.decode()); source = chunks.join('');
      } finally {reader.releaseLock();}
    } catch (error) {
      if (error instanceof NativeOperatorError) {
        error.method = method; error.path = path; error.status = response?.status ?? null; throw error;
      }
      throw new NativeOperatorError('FACILITATOR_OPERATOR_REQUEST_INTERRUPTED',
        {method, path, status:response?.status ?? null, cause:error});
    }
    let value;
    try {value = JSON.parse(source);}
    catch (cause) {throw new NativeOperatorError('FACILITATOR_OPERATOR_RESPONSE_INVALID',
      {method, path, status:response.status, cause});}
    if (!response.ok) throw new NativeOperatorError(
      typeof value?.error === 'string' ? value.error : 'FACILITATOR_OPERATOR_REQUEST_FAILED',
      {method, path, status:response.status});
    return raw ? source : value;
  }
  const get = (path, options) => request(path, options);
  const post = (path, body, options) => request(path, {...options, method:'POST', body});
  const client = {
    origin,
    status:options => get('status', options),
    profiles({after = '', signal} = {}) {
      if (after) profileName(after);
      return get('profiles?' + new URLSearchParams({after}), {signal});
    },
    profile(name, options) {
      return get('profile?' + new URLSearchParams({name:profileName(name)}), options);
    },
    downloadProfile({name, sha256}, options) {
      return get('download?' + new URLSearchParams({name:profileName(name), sha256}),
        {...options, raw:true});
    },
    review(config, options) {return post('review', {config}, options);},
    save(input, options) {
      need(plain(input), 'FACILITATOR_REQUEST_FIELDS_INVALID');
      return post('save', input, options);
    },
    start(input, options) {
      need(plain(input), 'FACILITATOR_REQUEST_FIELDS_INVALID');
      return post('start', {port:0, ...input}, options);
    },
    stop(runtimeId, options) {return post('stop', {runtimeId}, options);},
    probe(input, options) {return post('probe', input, options);},
    catalog({runtimeId, query = '', expectedVersion = null}, options) {
      need(typeof runtimeId === 'string' && runtimeId.length > 0 &&
        typeof query === 'string' && query.length <= 4096 &&
        (expectedVersion === null || Number.isSafeInteger(expectedVersion) && expectedVersion >= 0),
      'FACILITATOR_CATALOG_QUERY_INVALID');
      const params = new URLSearchParams(query);
      need(!params.has('runtimeId') && !params.has('expectedVersion'), 'FACILITATOR_CATALOG_QUERY_INVALID');
      params.set('runtimeId', runtimeId);
      if (expectedVersion !== null) params.set('expectedVersion', String(expectedVersion));
      return get('catalog?' + params, options);
    },
    async exportCatalog(selection, {signal, onProgress} = {}) {
      const received = await receiveNativeCatalogView({...selection,
        readPage:input => client.catalog(input, {signal}), onProgress});
      return JSON.parse(received.parts.join(''));
    },
    async receiveCatalog(selection, {signal, onProgress} = {}) {
      return receiveNativeCatalogView({...selection,
        readPage:input => client.catalog(input, {signal}), onProgress});
    },
  };
  return Object.freeze(client);
}
